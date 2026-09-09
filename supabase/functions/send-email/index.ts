// Sends transactional email (invoice reminders, cert expiry notices, etc.).
// Three providers are wired up, all configured from Settings → Email in the
// Office app (app_settings rows, not Deno secrets) — the office explicitly
// asked for this so rotating a key or switching accounts is a Settings
// edit, not a redeploy. RLS already restricts those rows to office staff
// only (settings_office_only); read here with the service key so a live
// edit takes effect on the very next send.
//   - "resend": needs a verified domain to email anyone but the account
//     owner. Falls back to the RESEND_API_KEY/RESEND_FROM secrets if no
//     resend_api_key/resend_from row exists yet (pre-database-config
//     compatibility — this was the original setup).
//   - "sendgrid": Twilio's email product (Twilio has no separate email
//     API of its own). Uses Single Sender Verification (one verified
//     email address, no domain/DNS needed). Falls back to
//     SENDGRID_API_KEY/SENDGRID_FROM secrets the same way.
//   - "brevo": database-only, no secret fallback (never had one). Also
//     gated by app_settings.brevoEnabled, off by default — configuring
//     the key alone must not be enough to start real sends while still
//     testing.
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

async function sendViaResend(apiKey: string, fromRaw: string, to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[], cc: string | undefined) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromRaw,
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

async function sendViaSendGrid(apiKey: string, fromRaw: string, to: string, subject: string, html: string, replyTo: string | undefined, attachments: Attachment[], cc: string | undefined) {
  const from = parseFrom(fromRaw);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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

type EmailSettings = {
  provider: string;
  brevoEnabled: boolean;
  resendApiKey: string | null; resendFrom: string | null;
  sendgridApiKey: string | null; sendgridFrom: string | null;
  brevoApiKey: string | null; brevoFrom: string | null;
};

// Everything the office can edit from Settings → Email — active provider,
// every provider's own key/from, and Brevo's enable switch — lives in
// app_settings, not secrets, specifically so changing any of it is a
// Settings edit rather than a redeploy. RLS (settings_office_only)
// already restricts these rows to office staff; read here with the
// service key so an edit takes effect on the very next send, and so a
// bare SELECT with the anon/portal key (RLS only opens the '__all__' row
// to anon) can never see any of these api_key rows at all. Each DB value
// falls back to the matching *_API_KEY/*_FROM secret when the row doesn't
// exist yet, so nothing broke for Resend/SendGrid the moment this shipped
// — only Brevo ever required the database path, since it never had
// secrets configured in the first place.
async function getEmailSettings(): Promise<EmailSettings> {
  const fallback: EmailSettings = {
    provider: EMAIL_PROVIDER_DEFAULT, brevoEnabled: false,
    resendApiKey: RESEND_API_KEY || null, resendFrom: RESEND_FROM || null,
    sendgridApiKey: SENDGRID_API_KEY || null, sendgridFrom: SENDGRID_FROM || null,
    brevoApiKey: null, brevoFrom: null,
  };
  try {
    const supabase = createClient(SB_URL, SERVICE_KEY);
    const [{ data: allRow }, { data: rows }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', '__all__').maybeSingle(),
      supabase.from('app_settings').select('key,value').in('key', [
        'email_provider', 'resend_api_key', 'resend_from', 'sendgrid_api_key', 'sendgrid_from', 'brevo_api_key', 'brevo_from',
      ]),
    ]);
    const blob = allRow?.value ? JSON.parse(allRow.value) : {};
    const byKey: Record<string, string> = {};
    (rows || []).forEach((r: { key: string; value: string }) => { byKey[r.key] = r.value; });
    return {
      provider: (byKey.email_provider || EMAIL_PROVIDER_DEFAULT).toLowerCase(),
      brevoEnabled: blob?.brevoEnabled === true,
      resendApiKey: byKey.resend_api_key || RESEND_API_KEY || null,
      resendFrom: byKey.resend_from || RESEND_FROM || null,
      sendgridApiKey: byKey.sendgrid_api_key || SENDGRID_API_KEY || null,
      sendgridFrom: byKey.sendgrid_from || SENDGRID_FROM || null,
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
      if (!settings.sendgridApiKey || !settings.sendgridFrom) {
        return json({ error: 'SendGrid is not configured yet — add the API key and From address in Settings → Email.' }, 503);
      }
      const id = await sendViaSendGrid(settings.sendgridApiKey, settings.sendgridFrom, to, subject, html, replyTo, validAttachments, cc);
      return json({ id });
    } else {
      if (!settings.resendApiKey || !settings.resendFrom) {
        return json({ error: 'Resend is not configured yet — add the API key and From address in Settings → Email.' }, 503);
      }
      const id = await sendViaResend(settings.resendApiKey, settings.resendFrom, to, subject, html, replyTo, validAttachments, cc);
      return json({ id });
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
