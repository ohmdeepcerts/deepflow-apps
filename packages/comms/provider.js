// communicationProvider — the one place business/UI code asks for a
// customer communication to go out, so a future transport swap (Twilio ->
// Meta for WhatsApp, or a different email vendor) is an adapter change
// here, not a rewrite of every call site. See
// docs/communications/02-COMMUNICATIONS-ARCHITECTURE.md §3.
//
// Phase B scope only (docs/communications/08-IMPLEMENTATION-PLAN.md):
// EMAIL and PUSH channels, each a thin wrapper around the existing
// send-email/send-push Edge Functions — no new external integration.
// WHATSAPP/PORTAL channels, event-driven dispatch (`comm_events`), and
// template-key/variable rendering (`comm_templates`) are Phase D+ and
// deliberately not built here — adding an unused `template`/`variables`/
// `eventId` parameter now, with no caller to populate it, would be a
// half-finished implementation. `send()`'s second phase D argument shape
// can grow to add those once there's a real event queue to feed it.
//
// Same dependency-injection shape as packages/data/repository.js's
// createRepository(sbFetch, ...): takes the calling app's own JWT
// resolver and fetch rather than importing one, since Office/Engineer/
// Portal each have real, deliberate auth differences preserved since
// Phase 1.

export function createCommunicationProvider({ sbUrl, sbKey, getJWT, fetchImpl = fetch }) {
  async function sendEmail(content) {
    const { to, subject, html, replyTo, cc, attachments } = content || {};
    if (!to || !subject || !html) throw new Error('EMAIL requires to, subject and html');
    const jwt = await getJWT();
    const res = await fetchImpl(`${sbUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, cc, subject, html, attachments, replyTo }),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: (await res.json().catch(() => ({}))).error || 'Email send failed' };
  }

  async function sendPush(content) {
    const jwt = await getJWT();
    const res = await fetchImpl(`${sbUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify(content || {}),
    });
    if (res.ok) return { ok: true, ...(await res.json().catch(() => ({}))) };
    return { ok: false, error: (await res.json().catch(() => ({}))).error || 'Push send failed' };
  }

  async function send({ channel, content }) {
    if (channel === 'EMAIL') return sendEmail(content);
    if (channel === 'PUSH') return sendPush(content);
    throw new Error(`communicationProvider: channel "${channel}" is not wired yet (Phase B covers EMAIL/PUSH only)`);
  }

  return { send };
}
