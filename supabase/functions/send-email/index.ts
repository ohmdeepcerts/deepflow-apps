// Sends transactional email via Resend (invoice reminders, cert expiry
// notices, etc.) — direct REST call, no SDK, matching the same pattern as
// the Stripe functions in this project. Reply-To is always set to the
// office's own email (S.coEmail) so a client hitting reply lands in a real
// inbox, not a noreply black hole — that was the whole point of picking
// Resend over a marketing-focused provider.
//
// Auth: Office App calls only, via a Supabase Auth JWT — verify_jwt is ON
// (unlike the Stripe functions, nothing here needs to be called by an
// unauthenticated portal visitor).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM'); // e.g. "GB Electrical <invoices@yourdomain.co.uk>"

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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Not authorized' }, 401);
  const supabase = createClient(SB_URL, SERVICE_KEY);
  const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
  if (!userData?.user) return json({ error: 'Not authorized' }, 401);

  let body: { to?: string; subject?: string; html?: string; replyTo?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { to, subject, html, replyTo } = body;
  if (!to || !subject || !html) return json({ error: 'to, subject and html are required' }, 400);

  if (!RESEND_API_KEY || !RESEND_FROM) {
    return json({ error: 'Email is not configured yet — ask the office to finish Resend setup.' }, 503);
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
      reply_to: replyTo || undefined,
    }),
  });
  const result = await resendRes.json();
  if (!resendRes.ok) return json({ error: result?.message || 'Resend error sending email' }, 502);

  return json({ id: result.id });
});
