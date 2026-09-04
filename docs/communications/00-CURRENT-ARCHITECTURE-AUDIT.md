# DeepFlow Communications — Current Architecture Audit

**Status:** Draft, based on direct code inspection of `D:\DEEPFLOW` on 2026-09-03, plus
one confirmed fact from the project owner (Twilio Studio/Flex/Conversations is the
current WhatsApp system, configured entirely outside this repo).

This document exists to satisfy one hard rule for everything that follows it: **no
architecture or implementation decision in this project may be based on assumption.**
Every claim below is either a direct code citation or explicitly marked as unverified.

---

## 1. Headline finding

**DeepFlow's own codebase contains no Twilio integration, no Meta WhatsApp Cloud API
integration, and no AI conversation agent of any kind.** A full-repo search for
`twilio`, `graph.facebook.com`, `whatsapp.*cloud`, `WHATSAPP_TOKEN`, and related terms
returned zero matches outside one incidental substring hit (`raw_app_meta_data` in the
Postgres auth schema — not "Meta" the company).

The real WhatsApp AI system — the one producing the staff-chat misfire described by the
owner ("need to do VAT and deep certs" being misread as a customer certificate request)
— runs entirely in **Twilio Studio / Flex / Conversations**, configured through Twilio's
own console. It is not visible to this audit. Everything in §7 ("External system") is
therefore inference from what DeepFlow's code assumes about it, not direct observation,
and must be re-verified once Console access is available.

**Practical consequence:** "audit Twilio" cannot mean "grep this repo." It means
inspecting the live Twilio Console (Studio Flow canvas, Flex flow config, Conversations
webhooks, phone number configuration, connected AI/LLM service if any) directly. That
work is blocked on access (see §8).

---

## 2. WhatsApp — what exists in DeepFlow today

**Every WhatsApp touchpoint in the app is a `wa.me` / `api.whatsapp.com` deep link.**
DeepFlow builds a prefilled message string and opens it as a URL; a human on staff (or
an engineer, or a client viewing the Portal) manually presses send in their own WhatsApp
client. There is no outbound API call, no delivery status, no read receipt, and no
inbound message handling anywhere in this repo.

Confirmed present in 14 files across all three apps:
`apps/office/jobs-whatsapp.js`, `apps/office/invoices-misc-actions.js`,
`apps/office/planner-board.js`, `apps/office/planner-detail.js`,
`apps/office/engineer-reports-modal.js`, `apps/office/engineer-reports-list.js`,
`apps/office/certs-reminders.js`, `apps/office/certs-form.js`,
`apps/office/directory-sections.js`, `apps/office/client-portal-admin.js`,
`apps/office/pl-exports.js`, `apps/engineer/main.js`, `apps/portal/main.js`,
`apps/engineer/on-my-way.js`.

Representative functions (from `jobs-whatsapp.js`, extracted in this session's earlier
modularization work): `sendToWA`, `waSingleJobById`, `waJobsSelected`,
`waSingleEngJob`, `waEngineerAllJobs` — all build a message string via
`buildJobWhatsAppMessage()` (in `@business`) or a template (`fillTemplate()`), then
`window.open('https://wa.me/'+number+'?text='+encodeURIComponent(msg))`.

Template source: `S.waJobTpl`, `S.waInvTpl`, `S.waOverdueTpl`, `S.waTenantTpl`,
`S.waLandlordTpl` — plain strings stored in the `settings` table, filled via
`fillTemplate()` from `@business` with a fixed set of `{{placeholder}}`-style variables
(actually `{placeholder}` single-brace, confirmed in `previewWaTemplate` /
`copyWaTemplate` in `apps/office/invoices-misc-actions.js`). No template versioning, no
per-channel variants (the master prompt's proposed template model — WhatsApp/Email
Subject/Email Body/Portal Title/Portal Body/Push Title/Push Body per event — does not
exist; there is one WhatsApp-only string per template key).

There is one earlier, explicit architectural note on this exact topic:
`docs/history/sql-migration-notes/PHASE4_CERT_REMINDER_CHECK_SQL.md` (an older phase)
states outright: *"there's no WhatsApp Business API access from inside Postgres... the
app's own panel already documents the intended approach: a Make/Zapier/n8n webhook that
runs each morning, reads that day's `cert_reminder_log`..."* — i.e. the documented
historical plan was to bridge via an external no-code tool, consistent with what turned
out to be true (Twilio, external).

---

## 3. Email

Real, working, server-side. `supabase/functions/send-email/index.ts`:
- Two providers wired, switched by the `EMAIL_PROVIDER` secret, no code change needed:
  **SendGrid** (Single Sender Verification, live today) and **Resend** (needs a verified
  domain, code intact but dormant).
- Auth: Office App JWT only, manually verified inside the function (`verify_jwt` is off
  at the platform level — same pattern as every Edge Function in this project).
- Reply-To always set to the office's own email (`S.coEmail`).

Client-side sending logic (`_sendEmail`, `_brandedEmailShell`, and per-purpose HTML
builders) was extracted into `apps/office/invoice-documents.js` in this session's
modularization work. Existing email types already built: overdue-invoice reminder,
invoice-ready, payment-receipt, certificate-ready, certificate-locked. All go through
one shared branded HTML shell and one shared `_sendEmail()` call — this is already
close to the "single send path" the master prompt asks for; it just doesn't yet have an
event/rule layer deciding *when* to fire.

---

## 4. Push notifications

Real, working, VAPID-based (no third-party push service, no vendor lock-in).
`supabase/functions/send-push/index.ts`:
- Auth: requires a real Supabase Auth session (explicitly rejects the anon-key JWT —
  documented in the function's own comment as a deliberate anti-spam guard).
- Targeting: by entity — `persons` (landlord), `agencies`, `agents` (fuzzy name match),
  or `users`/staff (exact name or role list). Subscriptions live in
  `push_subscriptions`, keyed by `entity_table` + `entity_id`.
- Auto-cleanup: a `410`/`404` from a push send (expired/invalid subscription) deletes
  the row.

**Client Portal already has a working push opt-in flow** — `initPush()` /
`enablePushNotifications()` in `apps/portal/main.js`, registering the portal's own
service worker and subscribing via the VAPID public key. This directly contradicts the
master prompt's framing of push as something to "design separately and report what is
required" — it's built and live today for the Portal. Not yet confirmed whether Office
or Engineer apps have the equivalent (see §9 open items).

---

## 5. Client Portal notification system

**Not Supabase Realtime.** The master prompt assumes "use existing Supabase Realtime if
appropriate... a logged-in client should see a new notification without refresh." The
actual mechanism, in `apps/portal/main.js`:

- `_startLiveUpdatePolling()` runs `setInterval(_pollPortalUpdates, _POLL_INTERVAL_MS)`
  — a client-side poll, not a realtime subscription.
- Each tick re-fetches the client's jobs/certs/invoices and diffs them against the
  previous snapshot (`_computeChangesSinceLastVisit`), the same diff function also used
  for "what changed since you last opened this link."
- Changes are prepended to an **in-memory, session-only** array
  (`_d.changesSinceLastVisit`) — there is no persisted `notifications` table. Refreshing
  the page loses the list (though the underlying "what's new since last visit" data is
  presumably recomputed from real state, not lost).
- A bell icon + dot (`#notif-btn` / `#notif-dot`) become visible when changes exist.
- Additionally catches up immediately on `visibilitychange` (tab returning from
  background) rather than waiting for the next poll tick.

No dedicated `notifications` table exists anywhere in the schema — confirmed via a
migration search for `CREATE TABLE.*notif`. The only notification-adjacent table is
`push_subscriptions`.

Separately, the **Office App** has its own, different, staff-facing notification system
(`apps/office/notifications-panel.js`, extracted in an earlier modularization phase) —
this is an internal "job updated / engineer request submitted" panel for staff, backed
by polling against `jobs`/`engineer_requests` tables (see `startLivePoll`/`_pollTick` in
`apps/office/jobs-realtime-sync.js`, also extracted this session) with a **Supabase
Realtime** fallback-to-primary path (`startRealtimeSync`, WebSocket subscription to the
`jobs` table's `postgres_changes`). This is the one place Realtime genuinely is wired up
today — for staff job-list sync, not client communications.

---

## 6. Job / Invoice / Certificate state — verified against code, not assumed

The master prompt repeatedly says "verify current code, don't assume." Two direct
corrections to its own assumptions:

**Job status enum** (`packages/business/status.js`, shared by all three apps):
```
PENDING · IN_PROGRESS · ENGINEER_COMPLETED · COMPLETED · INVOICED · CANNOT_ACCESS · CANCELLED
```
`ENGINEER_COMPLETED` is a deliberate intermediate state — the Engineer app sets it on
finishing on-site; office staff review and finalize to `COMPLETED` themselves, and only
that finalization triggers cert/invoice automation (`onJobComplete`, still in
`apps/office/main.js` — this cluster was deliberately left unsplit this session, see
`project_deepflow_phase5_status` memory, as the "must stay together" core).

**Invoice status** is not a frozen enum like jobs — it's string literals used directly
throughout: `Draft · Awaiting Payment · Paid · Cancelled · Credit Note`, with "overdue"
computed from `dueDate` rather than stored as its own status. This matches the master
prompt's guess, confirmed.

**Appointment confirmation state exists and is real** — the master prompt explicitly
flags this as possibly-fictional ("previous audit found no formal confirmed/unconfirmed
appointment state... verify current code... do not tell customers 'confirmed' unless
the system actually supports and stores this state reliably"). It does: jobs have a real
`confirmed` boolean field, filtered on directly (`j.confirmed===false`) in at least two
places in `apps/office/main.js` (unconfirmed-jobs view toggle, unconfirmed count). This
needs a closer look at exactly what sets it true/false and whether that write path is
reliable before any customer-facing "your appointment is confirmed" message trusts it,
but the field itself is real, not absent.

---

## 7. External system (Twilio) — unverified, inference only

Everything in this section is **not observed** — it's what DeepFlow's absence of
integration code implies, or what's typical for Twilio Studio/Flex/Conversations
deployments generally. Treat as hypothesis to confirm once Console access exists, not
fact.

- The business's WhatsApp number is very likely provisioned through Twilio acting as a
  Meta-approved BSP (Business Solution Provider) — i.e. Twilio holds the actual Meta
  WhatsApp Business Account (WABA) on the business's behalf. "Going Meta direct" means
  the business becoming its own Tech Provider / managing the WABA directly via the Meta
  Cloud API, which Meta supports as a formal BSP-to-direct migration (a real, documented
  Meta process — not something DeepFlow can execute unilaterally; it requires action in
  Meta Business Manager under the account's own admin).
- The AI logic (the thing misreading staff messages as customer certificate requests)
  most plausibly lives in a Twilio Studio Flow (visual flow builder) with either a
  Twilio-native AI product or a custom webhook out to an LLM. Twilio's own former
  "Autopilot" product was sunset; a newer "Twilio Assistants" or a bespoke Function+LLM
  webhook are both plausible. **Cannot be narrowed further without Console access.**
- No webhook endpoint in this repo receives Twilio callbacks (status, inbound message,
  etc.) — confirmed by the same repo-wide search in §1. If DeepFlow is meant to
  eventually receive inbound WhatsApp events, that endpoint doesn't exist yet in any
  form (Twilio-shaped or Meta-shaped).

---

## 8. What's blocking further audit work

1. **Twilio Console access** (or a detailed export of the current Studio Flow / Flex
   config / Conversations webhook + connected AI logic) — needed before touching the
   staff-chat bug, before scoping the Meta migration in detail, and before this document
   can honestly claim to cover "current Twilio usage" rather than "current absence of
   Twilio usage in one specific repo."
2. **Meta Business Manager access** — needed to know whether a WABA already exists
   (very likely, under Twilio's BSP relationship) and what App Review / template
   category approvals would be needed for a direct migration.
3. Two smaller open items worth a quick owner confirmation rather than more code
   archaeology: whether Office/Engineer apps have push opt-in parity with the Portal,
   and exactly what currently sets `job.confirmed` (which flow, how reliably).

None of these block the DeepFlow-side architecture and event-catalogue design work
(next documents in this series) — that work is useful regardless of which BSP ends up
carrying WhatsApp traffic, and carries zero production risk since it touches no live
credentials or customer-facing systems.

---

## 8a. Addendum — `docs/meta-business-agent/` already exists

Discovered after this document's first draft, not before: a substantial, independently-
produced Meta "Teach me more" WhatsApp AI training pack already exists in this repo
(`docs/meta-business-agent/`), written earlier the same day (13:09, ~6.5 hours before
this audit began), already pasted into the live AI. It contains 29 ordered training
messages, an `OWNER-CONFIRMATIONS.md` (17 open business-policy questions, e.g. pricing,
opening hours, cancellation policy — none of which this communications-platform effort
should answer either; same open items apply), `SOFTWARE-FINDINGS.md`, and a 115-case,
31-category `TEST-CONVERSATIONS.md` test suite covering most of what the master prompt's
own "REAL WORLD TEST CASE" and "TEST SUITE" sections ask for.

One confirmed factual error was found and corrected in that pack as a direct result of
this audit (see `docs/meta-business-agent/SOFTWARE-FINDINGS.md` §4 and
`16-appointments.md`'s correction note): the pack had taught the live AI that no
appointment-confirmation field exists in the software at all, which is false — a real
`confirmed` boolean column has existed on `jobs` since 2026-07-21. The AI's resulting
*behavior* (never assert a real-time booking confirmation to a customer) turned out to
still be correct for a different, more nuanced reason — the field defaults to `true` on
every new job before any date/time is actually agreed, so it was never usable as
proof of a confirmed slot anyway — but teaching an AI an incorrect fact about its own
business's software is the exact failure mode this whole effort exists to prevent, so it
was corrected regardless.

**Division of ownership going forward** (owner-confirmed): `docs/meta-business-agent/`
remains the authoritative source for AI conversation *behavior* — what the AI should
say, when it hands over, what it must never invent. `docs/communications/` (this
document set) covers the *platform* — data model, provider abstraction, event-driven
automation, payment chasing, and the technical integration that eventually connects the
two. Where this document set's later sections reference AI behavior, they defer to the
training pack rather than restate it.

## 9. Summary table

| Channel | Status | Mechanism | Realtime? | Notes |
|---|---|---|---|---|
| WhatsApp (outbound) | Manual only | `wa.me` deep link, human presses send | N/A | No API, no delivery tracking, in-repo |
| WhatsApp (AI/inbound) | Unverified | Twilio Studio/Flex/Conversations | Unknown | Entirely external, misfiring on staff chats |
| Email | Working | Edge Function, SendGrid live / Resend dormant | N/A (request/response) | Extracted to `invoice-documents.js` this session |
| Push (Portal) | Working | VAPID web-push, entity-targeted | N/A (push is inherently async) | Opt-in flow live in `portal/main.js` |
| Push (Office/Engineer) | Unconfirmed | — | — | Needs a quick check |
| Portal notifications | Working, but polling not Realtime | Client-side diff poll, in-memory list | No (polls every `_POLL_INTERVAL_MS`) | No persisted `notifications` table |
| Office staff notifications | Working, hybrid | Polling with Realtime upgrade for `jobs` table | Partial (Realtime for job changes only) | Separate system from Portal notifications |
| Job status | Real enum | `packages/business/status.js` | — | 7 states, `ENGINEER_COMPLETED` is the finalize gate |
| Invoice status | Real, string literals | `Draft/Awaiting Payment/Paid/Cancelled/Credit Note` | — | Overdue computed from `dueDate` |
| Appointment confirmed state | Real | `job.confirmed` boolean, `quickConfirm()` PATCH | — | Defaults `true` on creation, not proof of an agreed date/time — see §8a |
