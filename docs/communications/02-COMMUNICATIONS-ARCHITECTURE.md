# DeepFlow Communications — Target Architecture

**Status:** Draft for owner review. Grounded in DeepFlow's actual current patterns
(confirmed in §00), not a generic template. Several items are marked **OPEN QUESTION**
— genuine decisions, not filled in with a guess.

---

## 1. Design principle

DeepFlow stays the source of truth. Channels (Meta WhatsApp, email provider, Portal,
push) are dumb pipes DeepFlow decides to use — they never independently decide business
workflow. This mirrors how DeepFlow already treats every other integration (Stripe is a
payment rail, not a source of truth for what's owed; SendGrid is a transport, not a
decision-maker about who gets emailed).

## 2. Target flow

```
CUSTOMER WHATSAPP
      │
      ▼
META WHATSAPP CLOUD API
      │
      ├── inbound webhook ──▶ supabase/functions/whatsapp-webhook/
      │                            │
      │                            ├── verify signature, dedupe (idempotency key)
      │                            ├── identify contact (staff/engineer/customer?)
      │                            ├── load/create conversation + context
      │                            ├── if internal contact → log only, no AI, no reply
      │                            ├── if AI enabled → classify intent, extract fields,
      │                            │     draft reply (see §7)
      │                            └── write to `messages`, update `conversations`
      │
      ▼
DEEPFLOW COMMUNICATION GATEWAY (this project's new layer)
      │
      ├── comm_events queue (Postgres table, written by business-logic call sites)
      ├── scheduled processor (pg_cron / Supabase scheduled function, not a browser timer)
      │     │
      │     ├── rule evaluation (event → which channels, per §04's event catalogue)
      │     ├── suppression engine (quiet hours, frequency cap, preferences, opt-out,
      │     │     chase state) — see §07 of the BRD, detailed rules in a later doc
      │     └── channel adapters (send)
      │
      ├── whatsappProvider.send()  → Meta Cloud API
      ├── emailProvider.send()     → existing send-email Edge Function (unchanged)
      ├── portalProvider.notify()  → new `notifications` table row
      └── pushProvider.send()      → existing send-push Edge Function (unchanged)
```

Two existing pieces are reused as-is, not rebuilt: `send-email` and `send-push`. The new
work is everything upstream of them — deciding *whether* and *when* to call them, plus
the entirely-new WhatsApp Meta-direct transport.

## 3. Provider abstraction

One interface, channel-specific adapters, following the same "thin wrapper, one
implementation swap point" pattern `send-email` already uses for its two email
providers:

```
communicationProvider.send({
  channel: 'WHATSAPP' | 'EMAIL' | 'PORTAL' | 'PUSH',
  recipient: { entityTable, entityId, contactValue },
  template: templateKey,
  variables: { ...safeVariables },
  eventId: commEventId,       // for idempotency + audit linkage
})
```

Business logic (job/invoice/cert code) never calls Meta, SendGrid, or web-push
directly — it only ever emits an event (§5) or, for a manual one-off ("Office clicks
Send Now"), calls the gateway with an explicit channel. Provider-specific field names
(Meta's `to`/`type`/`template.name`, SendGrid's `personalizations`, etc.) live only
inside each adapter, never in business logic — this is what lets Twilio↔Meta be a swap
of one adapter, not a rewrite of every call site.

## 4. Data model additions

All new tables, RLS following the existing `is_office()`/`is_engineer()` pattern from
`packages/business` policies. None of these replace existing tables — `activity` stays
the general audit log; these are communications-specific and structured for the fields
communications actually need (channel, template, delivery status, suppression reason)
that `activity`'s generic `{msg, type, ts}` shape doesn't carry.

- **`conversations`** — one row per WhatsApp thread. `contact_phone`, `contact_type`
  (`customer`/`staff`/`engineer`/`supplier`/`unknown`), linked entity
  (`client_id`/`job_id`/`invoice_id`/`certificate_id`, nullable), `ai_enabled` (bool),
  `human_takeover` (bool), `current_intent`, `context_summary`, `last_customer_message_at`,
  `last_business_message_at`.
- **`messages`** — one row per message, either direction. `conversation_id`, `channel`,
  `direction` (`in`/`out`), `sender` (`customer`/`ai`/`human`/`system`), `body`,
  `media_url`, `provider_message_id`, `status`
  (`queued`/`sent`/`delivered`/`read`/`failed`), `created_at`.
- **`notifications`** — persisted Client Portal notifications (replaces the current
  in-memory-only list in `portal/main.js`). `entity_table`/`entity_id` (who it's for,
  same pattern as `push_subscriptions`), `type`, `title`, `body`, `link`, `read_at`,
  `created_at`.
- **`comm_events`** — the event queue. `event_type` (from §04's catalogue),
  `entity_table`/`entity_id`, `payload` (jsonb), `status`
  (`pending`/`processed`/`suppressed`/`failed`), `processed_at`, idempotency key
  (unique constraint on `event_type` + entity + a dedupe field appropriate to the event).
- **`comm_suppressions`** — audit trail of *why* a send didn't happen. `comm_event_id`,
  `channel`, `reason` (enum from the master prompt's list —
  `GLOBAL_PAUSE`/`QUIET_HOURS`/`RATE_LIMIT`/`PROMISE_ACTIVE`/etc.), `created_at`.
- **`client_comm_preferences`** — per-client channel on/off, AI mode, custom cadence
  overrides. `client_table`/`client_id` (persons/agencies/agents — same entity-reference
  pattern as `push_subscriptions`), `channel`, `enabled`, `ai_mode`.
- **`payment_chase_state`** — one row per invoice under active chasing. `invoice_id`,
  `stage`, `status` (`active`/`paused`/`promised`/`claimed`/`disputed`/`escalated`/
  `stopped`), `promise_date`, `last_contact_at`, `next_scheduled_at`,
  `reminders_sent`, `paused_reason`.
- **`comm_templates`** — replaces the current flat `S.waJobTpl` etc. settings strings
  with a proper per-event, per-channel template table: `event_type`, `channel`,
  `subject` (email only), `body`, `is_active`. Existing `S.wa*Tpl` strings become the
  seed/migration data for this table's WhatsApp rows, not thrown away.

**Confirmed, not speculative:** Client Portal access is a **token-in-URL model**, not
Supabase Auth. `apps/portal/main.js`: `token=P.get('id')` — the URL's `id` parameter is
literally the `persons`/`agencies`/`agents` row ID itself, plus `ptype` selecting which
table. An optional PIN layer (`portal_pin_verify`/`portal_pin_set`/`portal_pin_status`
RPCs) can additionally gate access. Data fetches (`portal_get_payment_totals`, etc.) are
Postgres RPC calls that presumably validate the token/PIN server-side (`SECURITY
DEFINER` — **not yet confirmed which; worth a quick migration read before writing
`notifications`' access function**, but the shape of the mechanism is now clear).

This means `notifications` **cannot use `auth.uid()`-based RLS** the way office-side
tables do — there is no Supabase Auth session for a Portal visitor. It needs the same
pattern the existing Portal RPCs use: a `SECURITY DEFINER` function
(`portal_get_notifications(p_table, p_id, p_pin?)`) that validates the token (and PIN,
if the entity has one set) server-side and returns only that entity's rows, called the
same way `portal_get_payment_totals` already is. Direct table RLS on `notifications`
should deny all anonymous access; the RPC is the only door in, same as every other
Portal data path today.

## 5. Event emission — where business code plugs in

DeepFlow has no event bus today; automation cascades happen via direct function calls
(`onJobComplete` → `createCertEntry`/`autoInvoice`, still intentionally unsplit in
`main.js` per the modularization work this session). Rather than introduce a heavyweight
event-sourcing rewrite, add one call at each existing decision point:

```js
await emitCommEvent('CERTIFICATE_READY', { certificateId, jobId, clientId });
```

`emitCommEvent` just inserts a `comm_events` row (client-side call, but the row is inert
until the server-side processor picks it up — no browser timer does any sending). This
matches the exact pattern the Phase 4 cert-reminder history doc already established for
`cert_reminder_log`: *log now, a separate reliable process reads and acts later.*

Call sites to add (from the event catalogue in §04, non-exhaustive here): after
`saveJob`'s status transitions, after certificate PDF generation, after
`generateAndStoreInvoicePDF`, after `markInvPaid`/payment recording, and the invoice-due/
overdue transitions (which need a scheduled sweep, not a call site — due dates pass
without any user action).

## 6. Server-side processing

**OPEN QUESTION — scheduler choice.** DeepFlow doesn't currently have a general-purpose
cron layer visible in this repo (the Phase 4 cert-reminder doc describes an *external*
Make/Zapier/n8n webhook doing the daily read, not a Supabase-native scheduled function).
Two real options:
- **Supabase scheduled Edge Functions / `pg_cron`** — fully in-house, no external
  dependency, consistent with "no browser timers, server-side automation" requirement.
- **Keep the existing external-webhook pattern** (Make/Zapier/n8n) if that's already
  paid for and working for cert reminders — extend it to poll `comm_events` too.

Recommend the first (in-house `pg_cron`) for anything that must be tightly coupled to
suppression/idempotency logic living in Postgres anyway, but this is worth a deliberate
choice, not a default.

## 7. AI routing

**OPEN QUESTION — is there still an LLM call to build at all, or does Meta's own AI stay
the conversational engine?** This wasn't clear until `docs/meta-business-agent/` turned
up: the AI currently misfiring on staff chats is trained through Meta's own native
WhatsApp Business "Teach me more" feature — a Meta-hosted, Meta-controlled conversational
AI configured by pasting natural-language training messages, not a DeepFlow-built LLM
integration. That changes what "AI routing" in this section actually means, and it forks
two ways:

- **(a) Meta's AI stays the conversational engine.** DeepFlow's job becomes gating
  (deciding per-contact whether Meta's AI is even allowed to see/answer a message —
  plausible via the same webhook that would receive inbound messages either way, holding
  a message back from customer-AI processing for internal contacts) and, where Meta's
  platform allows it, injecting live DeepFlow facts into what the AI can reference. No
  separate LLM provider decision needed; the "propose options" LLM-provider question from
  the owner conversation may not apply at all under this path.
- **(b) DeepFlow builds its own conversational AI**, calling a chosen LLM directly from
  `whatsapp-webhook`, and Meta's built-in AI is retired in favour of it. This is the
  scenario the rest of this section (and the "propose LLM options" answer) assumes.

Whichever path, the non-negotiables from the BRD apply regardless: least-privilege
context (only the current conversation + explicitly-fetched DeepFlow facts, never a
database dump), never inventing values not present in DeepFlow's own data (already
codified as `docs/meta-business-agent/27-never-invent.md`), and a hard
`ai_enabled=false` short-circuit for internal contacts checked *before* any AI
involvement — Meta's or a directly-integrated LLM's — not as a post-hoc filter on output.

**This fork needs resolving before §03 (Meta migration plan) or any AI-routing code
gets written** — it changes what "Meta direct" even means for the AI piece specifically
(the WhatsApp *transport* moving off Twilio is one migration; whether the *AI* stays
Meta-native or becomes DeepFlow-built is a separate decision this document shouldn't
make unilaterally).

## 8. Office UI additions

Following the existing sibling-module pattern (every other office feature is a small ES
module importing shared state from `main.js` — see `apps/office/*.js`, ~70 files
already split this way):

- `apps/office/comms-inbox.js` — the shared inbox (Settings §"COMMUNICATIONS" nav entry
  per the BRD's `PTITLES` pattern).
- `apps/office/comms-settings.js` — Settings → Communications (global controls, channel
  pause, quiet hours, client exceptions).
- `apps/office/comms-templates.js` — template management, replacing the current flat
  `S.wa*Tpl` settings fields with `comm_templates` CRUD.
- `apps/office/payment-chase.js` — Invoices → Follow-Ups view + per-invoice chase panel.

Each imports `_sb`, `dGet`/`dPut`/`dAll`, `toast`, `openModal`/`closeModal` from
`main.js`, same as every extraction this session — no new architectural pattern needed
for the UI layer, just new files fitting the existing one.

## 9. What this document deliberately does not decide

Reminder cadences, quiet-hours defaults, per-event channel policy, and template copy —
these are §04's job (event catalogue) and are business decisions the owner should
confirm, proposed as defaults there rather than invented here.
