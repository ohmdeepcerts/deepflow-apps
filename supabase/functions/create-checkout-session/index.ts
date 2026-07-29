// Creates a Stripe Checkout Session for the outstanding balance on one
// invoice and returns its URL. Called from two places with two different
// auth paths, since the Client Portal has no Supabase Auth session:
//
//   - Client Portal: body includes {portalType, portalId} — portalId is the
//     same raw entity id the portal already uses for portal_get_invoices
//     (see apps/portal/main.js's `token`/`entity.id`). Verified server-side
//     against the invoice's client_person_id/client_agency_id, mirroring
//     the portal_get_invoices RPC's own resolution — never trust a client-
//     supplied match value alone (Production Readiness Audit, C-2).
//   - Office App: `Authorization: Bearer <supabase JWT>` header instead;
//     verified via supabase.auth.getUser().
//
// verify_jwt is OFF at the platform level (the portal path has no JWT to
// check) — this function does its own authorization inside the body.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const PORTAL_ORIGIN = Deno.env.get('PORTAL_ORIGIN') || 'https://ohmdeepcerts.github.io/deepflow-apps/portal/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let bodyIn: { invoiceId?: string; portalType?: string; portalId?: string };
  try { bodyIn = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { invoiceId, portalType, portalId } = bodyIn;
  if (!invoiceId) return json({ error: 'invoiceId is required' }, 400);

  const supabase = createClient(SB_URL, SERVICE_KEY);

  const { data: inv, error: invErr } = await supabase.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (invErr || !inv) return json({ error: 'Invoice not found' }, 404);

  // ---- Authorize the caller against this specific invoice ----
  let authorized = false;
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
    if (userData?.user) authorized = true; // office staff — any authenticated Supabase user
  }
  if (!authorized && portalType && portalId) {
    // Mirrors portal_get_invoices exactly: try the FK match first, then
    // fall back to matching the resolved landlord/agency name against the
    // invoice's own text fields (compared in JS, not interpolated into a
    // filter string, so a name containing a comma or special character
    // can't change the query's meaning). The FK columns are unpopulated
    // on today's real invoices, so the name fallback is the path that
    // actually authorizes real-world Pay Now clicks right now — matching
    // the RPC both ways keeps "can I see this invoice" and "can I pay it"
    // in sync.
    if (portalType === 'landlord') {
      if (inv.client_person_id === portalId) authorized = true;
      if (!authorized) {
        const { data: person } = await supabase.from('persons').select('name').eq('id', portalId).maybeSingle();
        if (person?.name && [inv.clientname, inv.landlordname, inv.billtoname].includes(person.name)) authorized = true;
      }
    } else if (portalType === 'agency') {
      if (inv.client_agency_id === portalId) authorized = true;
      if (!authorized) {
        const { data: agency } = await supabase.from('agencies').select('name').eq('id', portalId).maybeSingle();
        if (agency?.name && [inv.clientname, inv.agencyname, inv.billtoname].includes(agency.name)) authorized = true;
      }
    }
  }
  if (!authorized) return json({ error: 'Not authorized to pay this invoice' }, 403);
  if (inv.status === 'Cancelled' || inv.status === 'Disposable') return json({ error: 'This invoice is not payable' }, 400);

  // invoices.total is a stale, never-written column — every real invoice
  // reads 0 there. The real total is computed from `items` the same way
  // calcTotal()/calcInvTotal() do client-side; replicated here exactly
  // (packages/business/invoice-total.js's calcLineItemsTotal) rather than
  // trusting the column, or every invoice would look "already paid".
  const { data: settingsRow } = await supabase.from('app_settings').select('value').eq('key', '__all__').maybeSingle();
  let S: { vatEnabled?: boolean; vatRate?: number } = {};
  if (settingsRow?.value) { try { S = typeof settingsRow.value === 'string' ? JSON.parse(settingsRow.value) : settingsRow.value; } catch { /* use {} */ } }
  const vatRate = S.vatEnabled !== false ? (S.vatRate ?? 20) : 0;
  const items: Array<{ qty?: number; unit?: number; vat?: boolean }> = Array.isArray(inv.items) ? inv.items : [];
  const total = items.reduce((sum, it) => {
    const line = (it.qty || 1) * (it.unit || 0);
    return sum + line + (it.vat ? (line * vatRate) / 100 : 0);
  }, 0);

  const { data: payments } = await supabase.from('payments').select('amount').eq('inv_id', invoiceId);
  const alreadyPaid = (payments || []).reduce((s: number, p: { amount: number }) => s + Number(p.amount || 0), 0);
  const outstanding = Math.round((total - alreadyPaid) * 100) / 100;
  if (outstanding <= 0.01) return json({ error: 'This invoice is already fully paid' }, 400);
  if (!STRIPE_SECRET_KEY) return json({ error: 'Payments are not configured yet — ask the office to finish Stripe setup.' }, 503);

  // ---- Create the Stripe Checkout Session (direct REST call — no SDK) ----
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('client_reference_id', invoiceId);
  params.set('metadata[invoice_id]', invoiceId);
  params.set('metadata[invoice_number]', String(inv.number || ''));
  params.set('line_items[0][price_data][currency]', 'gbp');
  params.set('line_items[0][price_data][product_data][name]', `Invoice ${inv.number || invoiceId}`);
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(outstanding * 100)));
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', `${PORTAL_ORIGIN}?paid=1&inv=${encodeURIComponent(invoiceId)}`);
  params.set('cancel_url', `${PORTAL_ORIGIN}?paid=0`);
  if (inv.clientemail) params.set('customer_email', inv.clientemail);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const session = await stripeRes.json();
  if (!stripeRes.ok) return json({ error: session?.error?.message || 'Stripe error creating session' }, 502);

  return json({ url: session.url });
});
