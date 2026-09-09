// Sends transactional email (invoice reminders, cert expiry notices, etc.).
// Three providers are wired up:
//   - "resend" (default): needs a verified domain to email anyone but the
//     account owner. Kept fully intact, just dormant until a domain is
//     verified — see RESEND_API_KEY/RESEND_FROM below. Secret-configured.
//   - "sendgrid": uses Single Sender Verification (one verified email
//     address, no domain/DNS needed) and can email real recipients
//     immediately — this is the one turned on for now. Secret-configured.
//   - "brevo": configured entirely from the database (app_settings rows
//     email_provider/brevo_api_key/brevo_from), not secrets — the office
//     explicitly asked for this so rotating the key or switching Brevo
//     accounts is a Settings → Email edit, not a redeploy. RLS already
//     restricts those rows to office staff only (settings_office_only);
//     read here with the service key so a live edit takes effect on the
//     very next send. Also gated by app_settings.brevoEnabled, off by
//     default — configuring the key alone must not be enough to start
//     real sends while still testing.
// Reply-To is always set to the office's own email (S.coEmail) so a client
// hitting reply lands in a real inbox either way.
//
// Auth: Office App calls only, via a Supabase Auth JWT (checked manually —
// verify_jwt is off at the platform level, same pattern as the other
// functions in this project).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMAIL_PROVIDER_DEFAULT = (Deno.env.get('EMAIL_PROVIDER') || 'resend').toLowerCase();

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

async function sendViaResend(to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[], cc: string | undefined) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      cc: cc ? [cc] : undefined,
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

async function sendViaSendGrid(to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[], cc: string | undefined) {
  const from = parseFrom(SENDGRID_FROM!);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], cc: cc ? [{ email: cc }] : undefined }],
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

async function sendViaBrevo(apiKey: string, fromRaw: string, to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[], cc: string | undefined) {
  const from = parseFrom(fromRaw);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: from,
      to: [{ email: to }],
      cc: cc ? [{ email: cc }] : undefined,
      replyTo: replyTo ? { email: replyTo } : undefined,
      subject,
      htmlContent: html,
      // Brevo's attachment field is `name`, not `filename` — content is
      // base64 with no data: prefix, same shape the caller already sends.
      attachment: attachments.length
        ? attachments.map((a) => ({ content: a.content, name: a.filename }))
        : undefined,
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result?.message || `Brevo error ${res.status}`);
  return (result?.messageId as string) || 'sent';
}

type EmailSettings = { provider: string; brevoEnabled: boolean; brevoApiKey: string | null; brevoFrom: string | null };

// Everything the office can edit from Settings → Email — active provider,
// Brevo's own key/from, and the enable switch — lives in app_settings, not
// secrets, specifically so changing them is a Settings edit rather than a
// redeploy. RLS (settings_office_only) already restricts these rows to
// office staff; read here with the service key so an edit takes effect on
// the very next send, and so a bare SELECT with the anon/portal key (RLS
// only opens the '__all__' row to anon) can never see brevo_api_key at all.
// Defaults to the secret-based provider and Brevo disabled on any read
// failure — the safe direction, and identical to pre-database-config
// behaviour if these rows don't exist yet.
async function getEmailSettings(): Promise<EmailSettings> {
  const fallback: EmailSettings = { provider: EMAIL_PROVIDER_DEFAULT, brevoEnabled: false, brevoApiKey: null, brevoFrom: null };
  try {
    const supabase = createClient(SB_URL, SERVICE_KEY);
    const [{ data: allRow }, { data: rows }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', '__all__').maybeSingle(),
      supabase.from('app_settings').select('key,value').in('key', ['email_provider', 'brevo_api_key', 'brevo_from']),
    ]);
    const blob = allRow?.value ? JSON.parse(allRow.value) : {};
    const byKey: Record<string, string> = {};
    (rows || []).forEach((r: { key: string; value: string }) => { byKey[r.key] = r.value; });
    return {
      provider: (byKey.email_provider || EMAIL_PROVIDER_DEFAULT).toLowerCase(),
      brevoEnabled: blob?.brevoEnabled === true,
      brevoApiKey: byKey.brevo_api_key || null,
      brevoFrom: byKey.brevo_from || null,
    };
  } catch {
    return fallback;
  }
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
    to?: string; subject?: string; html?: string; replyTo?: string; cc?: string;
    attachments?: { filename?: string; content?: string }[];
  };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { to, subject, html, replyTo, cc, attachments } = body;
  if (!to || !subject || !html) return json({ error: 'to, subject and html are required' }, 400);

  const validAttachments: Attachment[] = (attachments || []).filter(
    (a): a is Attachment => !!a?.filename && !!a?.content
  );

  const settings = await getEmailSettings();

  try {
    if (settings.provider === 'brevo') {
      if (!settings.brevoEnabled) {
        return json({ error: 'Brevo sending is turned off — enable it in Settings → Email, then try again.' }, 503);
      }
      if (!settings.brevoApiKey || !settings.brevoFrom) {
        return json({ error: 'Brevo is not configured yet — add the API key and From address in Settings → Email.' }, 503);
      }
      const id = await sendViaBrevo(settings.brevoApiKey, settings.brevoFrom, to, subject, html, replyTo, validAttachments, cc);
      return json({ id });
    } else if (settings.provider === 'sendgrid') {
      if (!SENDGRID_API_KEY || !SENDGRID_FROM) {
        return json({ error: 'SendGrid is not configured yet — ask the office to finish setup.' }, 503);
      }
      const id = await sendViaSendGrid(to, subject, html, replyTo, validAttachments, cc);
      return json({ id });
    } else {
      if (!RESEND_API_KEY || !RESEND_FROM) {
        return json({ error: 'Email is not configured yet — ask the office to finish Resend setup.' }, 503);
      }
      const id = await sendViaResend(to, subject, html, replyTo, validAttachments, cc);
      return json({ id });
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
