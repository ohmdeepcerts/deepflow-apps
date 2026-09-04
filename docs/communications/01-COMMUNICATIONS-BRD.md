# DeepFlow Communications — Business Requirements

**Status:** Draft for owner review. Organizes the owner's master requirements prompt
against what §00 confirmed is real vs. what needs to be built, and flags every place a
business-policy decision is needed rather than guessing one.

**Business identity** (must be used consistently everywhere customer-facing text is
generated): customer-facing name **GB Electrical**; full legal name **GB Electrical
Engineering Ltd**; website **gbelectricals.co.uk**. Never "GB Electricals" — the extra
"s" exists only in the web domain. This is the same rule already codified as the first
and most critical message in the existing AI training pack
(`docs/meta-business-agent/01-company-identity.md`) — restated here only because every
generated template/notification in this platform needs it too, not because it's a new
requirement.

**AI conversation behavior in general** — intent handling, when to hand over to a
human, what the AI must never invent, tone — is governed by
`docs/meta-business-agent/` in full (29 ordered training messages, already live). This
document and its siblings cover the platform the AI behavior eventually plugs into, not
the behavior itself; §5.5 below and §07's state machine reference that pack rather than
duplicate it.

---

## 1. Problem statement

DeepFlow is the system of record for jobs, certificates, invoices, and clients. Customer
communication currently happens through three disconnected paths with no shared state:

1. **WhatsApp** — entirely manual (`wa.me` links) inside DeepFlow, plus a separate,
   AI-driven, externally-hosted system (Twilio Studio/Flex/Conversations) that DeepFlow
   has no visibility into and that has at least one confirmed failure mode (misreading
   internal staff chat as a customer certificate request).
2. **Email** — server-side and working, but fired ad-hoc from individual UI actions
   (a button click), not from a business event with a policy attached.
3. **Client Portal** — has its own polling-based "what's new" list and a working push
   opt-in, but nothing else in the business (email, WhatsApp) knows about or coordinates
   with it.

No component today asks "has this client already been contacted about this today, on
another channel?" before sending. No component enforces quiet hours. No component knows
that a customer said "I'll pay Friday" and should stop being chased.

## 2. Goal

One communications layer, inside DeepFlow, that:
- Is the single place business events (job booked, certificate ready, invoice overdue,
  etc.) turn into customer communications.
- Decides *which* channel(s) fire per event, respecting a client's preferences, quiet
  hours, and a cross-channel anti-spam budget — not "send everything everywhere."
- Replaces Twilio as the WhatsApp transport with Meta's WhatsApp Cloud API directly,
  migrated safely (§03), not by deleting Twilio first.
- Gives office staff one inbox for all inbound customer communication, with an AI
  first-pass that never touches internal/staff conversations and that always hands off
  when it should.
- Makes payment chasing a first-class, auditable, pausable workflow — not "send another
  WhatsApp."

## 3. Explicit non-goals (for this phase)

- Building a new UK address-lookup provider. §00 confirms `postcodes.io` is the current
  provider; the master prompt itself says this needs cost/benefit analysis and owner
  approval before any change — out of scope here, tracked as a future item only.
- WhatsApp Flows / interactive buttons on day one. Listed in the master prompt as
  "appropriate later" — defer until basic send/receive/AI-routing is stable.
- Meta cost/spend reporting beyond what the Cloud API exposes directly — no invented
  cost figures.
- SMS as a channel. Mentioned once in the master prompt's channel model as a future
  possibility; nothing today requires it.

## 4. Channels

| Channel | Today | Target |
|---|---|---|
| WhatsApp | Manual `wa.me` links (DeepFlow) + Twilio AI (external, unaudited) | Meta WhatsApp Cloud API direct, through one provider adapter |
| Email | Working, ad-hoc trigger | Same transport, event-driven trigger |
| Client Portal | Polling-based change list, no persisted notifications | Persisted notifications, still polling unless Realtime is deliberately adopted (see §02 open question) |
| Push | Working (Portal only, confirmed) | Extend event-driven triggers to existing push infra; confirm Office/Engineer parity |

## 5. Functional requirements by domain

### 5.1 Jobs
Job-related customer messages (received, appointment scheduled/changed, cannot access,
completed) must use customer-safe wording — **never** raw internal status strings.
`ENGINEER_COMPLETED` in particular must never reach a customer verbatim; it's an
internal review gate, not a customer-facing state (confirmed in §00 §6).

### 5.2 Appointments
`job.confirmed` is real (§00 §6) — usable as the source of truth for "confirmed"
wording, once its write path is audited (open item, §8). Until that audit is done, keep
existing safe wording rather than asserting a new "confirmed" guarantee.

### 5.3 Certificates
Certificate-ready / renewal-reminder / expiry messages must be driven from actual
certificate records, never inferred from `Job Completed` — a completed job and an issued
certificate are not the same event (existing `apps/office/certs-*.js` files already
enforce this distinction; the communications layer must not weaken it).

### 5.4 Invoices & payment chasing
Source of truth is invoice status (`Draft / Awaiting Payment / Paid / Cancelled / Credit
Note`) plus `dueDate` for overdue calculation — confirmed accurate in §00 §6. The chase
engine must never use job completion as a proxy for invoice state.

Required behaviors (all from the master prompt, all genuinely necessary, none
speculative):
- **Promise to pay** — detect, record a promise date, suppress all channels until
  promise date + grace period.
- **Payment claimed** — never auto-mark Paid; pause reminders; create a
  human-verification task.
- **Dispute** — pause everything; human required.
- **Consolidated account reminders** for clients with multiple unpaid invoices (e.g.
  managing agents) — one message per channel per chase stage, not one per invoice.
- **Opt-out** — respected, recorded, does not auto-resume.

### 5.5 AI conversation routing (once Meta-direct exists)
- Internal/staff/engineer/supplier contacts must be excluded from customer-AI handling
  entirely — this is the fix for the confirmed staff-chat bug, and must exist as a
  first-class per-contact setting (`AI: ON / OFF / MANUAL`), not a heuristic.
- Conversation context must persist across messages within an active topic (the "add
  Varinder Kaur" example in the master prompt) — requires a real conversation-state
  model (§02, detailed in §07).
- AI must never invent price, availability, appointment confirmation, engineer identity,
  job/certificate/invoice/payment status — only report what DeepFlow's own data says.
  This exact rule already exists as `docs/meta-business-agent/27-never-invent.md`
  (the overriding rule the training order deliberately teaches second, right after
  company identity) — nothing new to decide here, just a platform obligation to
  actually give the AI verified data to check against instead of leaving it to comply
  by refusing to answer everything.
- Handover triggers, tone, and what counts as an emergency are fully specified in
  `docs/meta-business-agent/26-human-handover.md`, `15-electrical-emergencies.md`, and
  `02-ai-role-and-tone.md` — this platform's job is to make the technical handover
  mechanism (§07 §1.1–1.3) actually work, not to redefine when it should fire.

## 6. Non-functional requirements

- **Anti-spam is cross-channel**, not per-channel. One suppression engine checks quiet
  hours, frequency caps, client preferences, opt-outs, and current conversation/chase
  state before *any* automated send, on *any* channel.
- **Idempotency** on every automated send — duplicate webhook deliveries, cron retries,
  and server restarts must not double-send.
- **No browser-side scheduling.** Automated sends run server-side (Edge Function /
  Postgres cron — DeepFlow already has this pattern for cert-reminder checks, per the
  Phase 4 history doc referenced in §00).
- **Dry-run mode** is mandatory before any automation goes live, and new automations
  default OFF or dry-run, never LIVE.
- **Least-privilege AI context** — the AI must receive only what the current
  conversation needs, not a dump of the client/job/invoice database.
- **Security**: Meta tokens never reach frontend code, browser storage, or the git
  history (DeepFlow already has one documented VAPID-key leak-and-rotate incident — see
  `apps/portal/main.js` comment on the 2026-08-09 rotation; treat that as the standard
  this must meet, not a one-off).

## 7. Explicit approval gates (owner sign-off required before each)

1. Any WhatsApp traffic routing through Meta-direct instead of Twilio, even in test.
2. Any automation moving from `DRY RUN`/`OFF` to `LIVE`.
3. Removing Twilio code/credentials, once Meta-direct is confirmed stable.
4. Any change to the address-lookup provider.
5. Backfilling communications for historical (pre-launch) jobs/invoices/certificates —
   default is new-events-only.

## 8. Open items needing owner input (not blocking doc work, blocking build work)

- Twilio Console access or Studio Flow export (blocks §03 in detail).
- Which AI architecture: Meta's native "Teach me more" AI stays the engine, or DeepFlow
  builds its own LLM integration (§02 §7 — a real fork, not yet resolved).
- ~~Confirm what currently writes `job.confirmed` and how reliable that path is~~ —
  **resolved**: `quickConfirm()` in `apps/office/main.js`, real `PATCH`, defaults `true`
  on job creation (see §00 §8a). What remains open is a business-policy question, not a
  code question: should `APPOINTMENT_CONFIRMED` (§04) exist as an event at all given
  that default-true semantic, or is it not worth building until/unless the field's
  meaning changes.
- Confirm Office/Engineer app push-notification parity with the Portal.
- Reminder cadence, quiet-hours defaults, and per-event channel policy (§02/§04 will
  propose sensible defaults from the master prompt's own suggestions, but these are
  genuine business decisions the owner should confirm, not settings I should invent
  silently).
- **The 19 business-policy questions in `docs/meta-business-agent/
  OWNER-CONFIRMATIONS.md` are still open** (opening hours, geographic coverage,
  emergency call-out pricing, cancellation/refund policy, etc.) — this platform's
  channel-policy defaults (§04) don't depend on them, but the AI's actual answers to
  customers do, and they were already outstanding before this document set existed.
  Not this project's list to duplicate or re-ask — flagged here only so it doesn't get
  lost between two document sets.
