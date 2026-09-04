# DeepFlow Communications — Security & Privacy

**Status:** Draft for owner review.

---

## 1. Credentials

Meta WhatsApp Cloud API requires: a permanent access token (system user token, not a
short-lived user token), a phone number ID, a WhatsApp Business Account ID, an app ID,
and a webhook verify token you choose.

**Rule, no exceptions:** none of these live in frontend JS, browser storage, localStorage,
or committed to git. They live only as Supabase Edge Function environment secrets —
exactly the pattern `send-email` and `send-push` already use (`Deno.env.get(...)`,
never hardcoded, never returned to the client). This repo already has one real incident
to learn from: a VAPID private key was committed in plaintext in an earlier history doc
and had to be rotated (`apps/portal/main.js`, comment on the 2026-08-09 rotation,
GitGuardian-flagged). The Meta token is far more consequential to leak — treat it with
at least that level of care from day one, not after an incident.

Token rotation: document the rotation procedure once the Meta app is provisioned
(who can generate a new system user token, how the Edge Function secret gets updated,
whether there's downtime during rotation). Not fillable yet — depends on Meta Business
Manager setup this document can't see.

## 2. Webhook security

The inbound WhatsApp webhook (`supabase/functions/whatsapp-webhook/` per §02) must:
- Verify Meta's webhook signature (`X-Hub-Signature-256`) on every request, reject
  anything that doesn't match, computed using the app secret (also an Edge Function
  env secret, never client-side).
- Implement the GET verification handshake Meta requires on webhook setup
  (`hub.verify_token` challenge-response) using the chosen verify token.
- Deduplicate: Meta can and does redeliver webhooks. Every inbound message carries a
  Meta message ID — use it as the idempotency key before writing to `messages`, not
  after (check-then-insert inside one transaction, or a unique constraint that makes a
  duplicate insert a no-op rather than a duplicate row).
- Rate-limit at the Edge Function level as a defense-in-depth measure, separate from
  Meta's own rate limits.
- Fail closed: a signature-verification failure or a malformed payload gets logged and
  a `200 OK` returned (so Meta doesn't retry-storm a persistently malformed request) but
  triggers no business-logic side effects.

## 3. Multi-tenant isolation

Two different isolation models are in play, and the new communications tables need to
respect both correctly:

- **Office/Engineer side**: existing `is_office()`/`is_engineer()` RLS policies, real
  Supabase Auth sessions. New tables (`conversations`, `messages`, `comm_events`,
  `payment_chase_state`, etc.) follow this pattern directly — office staff can see
  everything, engineers see only what existing policies already scope them to.
- **Client Portal side**: token-in-URL model, confirmed in §02 — `token` *is* the
  entity ID, optionally gated by a PIN. This has a real, pre-existing property worth
  naming plainly: **the token is not a secret in the cryptographic sense** — it's a
  database primary key, and primary keys in this schema are (per earlier audit
  findings referenced in the codebase) sequential-ish or otherwise not designed as
  unguessable capability tokens. The PIN is what actually gates sensitive access today.
  Any new Portal-facing data (`notifications` in particular) must go through the same
  `SECURITY DEFINER` RPC pattern as existing Portal endpoints — never a direct
  `SELECT` grant on the raw table — and must not expose anything the existing PIN-gated
  RPCs wouldn't already expose. Do not introduce a new, weaker access path.
- **Cross-check, not an assumption**: audit whether `portal_get_payment_totals` and
  siblings actually enforce the PIN today or rely on the token alone — if the PIN is
  optional/not-always-set, that's an existing risk this project inherits and should
  flag to the owner rather than silently working around.

## 4. AI context — least privilege

The AI must be handed only: the current conversation's message history, the specific
DeepFlow records the conversation is actively about (one job, one invoice, one
certificate — fetched fresh, not cached indefinitely), and business policy text (service
list, standard wording). It must never receive a raw client/job/invoice database export,
another client's data, or staff-internal notes not meant for a customer-facing model.
This is a prompt-construction discipline, not a technology choice — applies regardless
of which LLM provider is chosen (§07 will lay out the interface).

## 5. Media / attachments

Customers can send photos, PDFs, screenshots via WhatsApp. Before storing:
- Validate declared MIME type against actual file signature (don't trust the
  `Content-Type` Meta reports blindly) — reuse whatever validation the existing
  attachment/upload paths already do (`apps/office/certs-pdf.js`,
  `apps/office/client-portal-admin.js` both handle file uploads today) rather than
  writing a second, possibly-inconsistent validator.
- Enforce a size cap before download, not after.
- Store via the existing Supabase Storage pattern (same private-bucket + signed-URL
  approach `invoice-documents.js` already uses for invoice PDFs — confirmed working
  this session), not a new storage mechanism.
- Never auto-attach an inbound document to a guessed job/property — per BRD, requires
  explicit office/AI-confirmed linkage (see §07's conversation-context model).

## 6. Audit

Every automated or AI-drafted send needs: actor (`system`/`ai`/`human` + which staff
member if human), event, channel, template used, timestamp, provider message ID,
delivery status, and — critically — the *reason* if suppressed rather than sent (the
`comm_suppressions` table from §02). This is what makes "why didn't Client X get
reminded" answerable after the fact, and what the Twilio migration's rollback plan (§09)
depends on for confidence the new path behaves correctly before cutover.

## 7. Data retention

Follow existing retention posture — this project doesn't currently document a formal
retention policy elsewhere in the repo, so don't invent an aggressive new one. Store
message bodies and attachment references, not duplicate binary copies where a signed-URL
reference to existing Storage suffices.
