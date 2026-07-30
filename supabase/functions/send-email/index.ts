// Sends transactional email (invoice reminders, cert expiry notices, etc.).
// Two providers are wired up, switched purely by the EMAIL_PROVIDER secret —
// no code change needed to flip between them:
//   - "resend" (default): needs a verified domain to email anyone but the
//     account owner. Kept fully intact, just dormant until a domain is
//     verified — see RESEND_API_KEY/RESEND_FROM below.
//   - "sendgrid": uses Single Sender Verification (one verified email
//     address, no domain/DNS needed) and can email real recipients
//     immediately — this is the one turned on for now.
// Reply-To is always set to the office's own email (S.coEmail) so a client
// hitting reply lands in a real inbox either way.
//
// Auth: Office App calls only, via a Supabase Auth JWT (checked manually —
// verify_jwt is off at the platform level, same pattern as the other
// functions in this project).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_PROVIDER = (Deno.env.get('EMAIL_PROVIDER') || 'resend').toLowerCase();

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM = Deno.env.get('RESEND_FROM'); // e.g. "GB Electrical <invoices@yourdomain.co.uk>"

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDGRID_FROM = Deno.env.get('SENDGRID_FROM'); // e.g. "GB Electrical <you@gmail.com>" — must be a Single-Sender-verified address

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// "Name <email>" or a bare email — used by both providers' FROM secrets.
function parseFrom(str: string): { name?: string; email: string } {
  const m = str.match(/^\s*(.*?)\s*<(.+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2] } : { email: str.trim() };
}

type Attachment = { filename: string; content: string };

async function sendViaResend(to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[]) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
      reply_to: replyTo || undefined,
      // attachments[].content is base64 (no data: prefix) — Resend's REST API takes it as-is.
      attachments: attachments.length ? attachments : undefined,
    }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result?.message || 'Resend error sending email');
  return result.id as string;
}

async function sendViaSendGrid(to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[]) {
  const from = parseFrom(SENDGRID_FROM!);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from,
      reply_to: replyTo ? { email: replyTo } : undefined,
      subject,
      content: [{ type: 'text/html', value: html }],
      attachments: attachments.length
        ? attachments.map((a) => ({ content: a.content, filename: a.filename, type: 'application/pdf', disposition: 'attachment' }))
        : undefined,
    }),
  });
  // SendGrid returns 202 with an empty body on success, and the message id in a header.
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result?.errors?.[0]?.message || `SendGrid error ${res.status}`);
  }
  return res.headers.get('x-message-id') || 'sent';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Not authorized' }, 401);
  const supabase = createClient(SB_URL, SERVICE_KEY);
  const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
  if (!userData?.user) return json({ error: 'Not authorized' }, 401);

  let body: {
    to?: string; subject?: string; html?: string; replyTo?: string;
    attachments?: { filename?: string; content?: string }[];
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { to, subject, html, replyTo, attachments } = body;
  if (!to || !subject || !html) return json({ error: 'to, subject and html are required' }, 400);

  const validAttachments: Attachment[] = (attachments || []).filter(
    (a): a is Attachment => !!a?.filename && !!a?.content
  );

  try {
    if (EMAIL_PROVIDER === 'sendgrid') {
      if (!SENDGRID_API_KEY || !SENDGRID_FROM) {
        return json({ error: 'SendGrid is not configured yet — ask the office to finish setup.' }, 503);
      }
      const id = await sendViaSendGrid(to, subject, html, replyTo, validAttachments);
      return json({ id });
    } else {
      if (!RESEND_API_KEY || !RESEND_FROM) {
        return json({ error: 'Email is not configured yet — ask the office to finish Resend setup.' }, 503);
      }
      const id = await sendViaResend(to, subject, html, replyTo, validAttachments);
      return json({ id });
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
