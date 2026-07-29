// Receives Stripe's checkout.session.completed event, records the payment
// the same way the office app's own savePayment() does (insert into
// `payments`, then flip the invoice to Paid once fully covered), and
// nothing else — this is the one place a payment becomes real, so it
// deliberately mirrors that exact logic rather than introducing a second,
// possibly-drifting way to mark an invoice paid.
//
// Auth is Stripe's own signature scheme (Stripe-Signature header), not a
// Supabase JWT — verify_jwt is OFF for this function, same reasoning as
// create-checkout-session.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = parts['t'];
  const expectedSig = parts['v1'];
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // Stripe tolerates clock skew up to 5 minutes; reject anything older to
  // block replay of a captured request.
  const age = Date.now() / 1000 - Number(timestamp);
  if (age > 300 || age < -300) return false;
  return computedSig === expectedSig;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503 });

  const payload = await req.text();
  const sig = req.headers.get('Stripe-Signature');
  if (!sig || !(await verifyStripeSignature(payload, sig, STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }

  const event = JSON.parse(payload);
  if (event.type !== 'checkout.session.completed') {
    return new Response('ok', { status: 200 }); // ack, nothing to do
  }

  const session = event.data.object;
  const invoiceId = session.metadata?.invoice_id || session.client_reference_id;
  const paymentIntentId = session.payment_intent as string;
  const amountPaid = (session.amount_total || 0) / 100;
  if (!invoiceId || !paymentIntentId) return new Response('ok', { status: 200 });

  const supabase = createClient(SB_URL, SERVICE_KEY);

  // Idempotency — Stripe retries webhook delivery at-least-once.
  const { data: existing } = await supabase.from('payments').select('id').eq('ref', paymentIntentId).maybeSingle();
  if (existing) return new Response('ok', { status: 200 });

  const { data: inv } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!inv) return new Response('ok', { status: 200 });

  const today = new Date().toISOString().slice(0, 10);
  await supabase.from('payments').insert({
    id: crypto.randomUUID(),
    inv_id: invoiceId,
    date: today,
    amount: amountPaid,
    method: 'Card (Stripe)',
    ref: paymentIntentId,
    recorded_by: 'Stripe (automatic)',
    created: Date.now(),
  });

  const { data: payments } = await supabase.from('payments').select('amount').eq('inv_id', invoiceId);
  const totalPaid = (payments || []).reduce((s: number, p: { amount: number }) => s + Number(p.amount || 0), 0);
  if (totalPaid >= Number(inv.total || 0) - 0.01 && inv.status !== 'Paid') {
    await supabase.from('invoices').update({ status: 'Paid' }).eq('id', invoiceId);
  }

  return new Response('ok', { status: 200 });
});
