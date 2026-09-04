# DeepFlow Communications — Implementation Plan

**Status:** Draft for owner review.

---

## 1. On the master prompt's "20-specialist multi-agent team"

Worth addressing directly rather than silently ignoring: a swarm of 20 named
specialist agents isn't how this actually gets built reliably. What works — demonstrated
repeatedly across this project's earlier modularization phases (Directory, Certs,
Engineer-Reports, Planner, and this session's Jobs/Invoices follow-up work) — is a
sequence of tightly-scoped phases, each one: researched against real code first,
implemented, verified byte-for-byte where extraction is involved, build+test+live-browser
checked, then committed. That discipline is what this plan follows. Different phases
below do call for different kinds of attention (data modeling vs. webhook security vs.
UI), but that's handled by scoping each phase narrowly, not by role-playing a department.

## 2. Phase sequence

Each phase ships independently, gets verified before the next starts, and nothing
customer-facing goes live without the explicit approval gates from BRD §7.

### Phase A — Data model (this doc set is Phase 0; this is the first code phase)
New tables from §02 (`conversations`, `messages`, `notifications`, `comm_events`,
`comm_suppressions`, `client_comm_preferences`, `payment_chase_state`,
`comm_templates`), RLS policies, seed `comm_templates` from existing `S.wa*Tpl` strings.
**Zero behavior change** — purely additive schema. Lowest-risk possible starting point.

### Phase B — Provider abstraction, Email + Push only
Build `communicationProvider.send()` (§02 §3) with adapters wrapping the *existing*
`send-email` and `send-push` Edge Functions — no new external integration yet. Proves
the abstraction pattern against transports that already work, before WhatsApp/Meta adds
real complexity. Existing ad-hoc email/push call sites are migrated to go through the
new provider one at a time, verified each still behaves identically.

### Phase C — Portal notification centre
`notifications` table live, `portal_get_notifications` RPC (matching the existing
token+PIN access pattern per §02/§05), bell icon backed by real persisted rows instead
of the current in-memory poll-diff list. The existing poll (`_pollPortalUpdates`) can
keep computing "what changed" for the live-update toast; `notifications` becomes the
durable record behind the bell separately, no forced Realtime adoption unless a later
phase deliberately revisits that trade-off.

### Phase D — Event engine (dry-run only)
`comm_events` queue, `emitCommEvent()` call sites wired at the points in §02 §5, the
scheduled processor (`pg_cron` or the alternative chosen per §02's open question), rule
evaluation against §04's event catalogue, suppression engine. **Runs in `DRY RUN`
globally for this entire phase** — every decision logged to `comm_suppressions`/an
equivalent "would have sent" log, nothing actually dispatched. This is where the event
catalogue's proposed defaults get validated against real data before they can affect a
real customer.

### Phase E — Live activation, Email/Portal/Push only
Once Phase D's dry-run log looks right (owner review), flip to `LIVE` for the channels
that already work — Email, Portal, Push. WhatsApp stays `wa.me`-manual, unaffected.
This alone delivers real value (coordinated, policy-driven, suppressible customer
communication) without touching Twilio or Meta at all — worth treating as a genuine
milestone, not just a stepping stone.

### Phase F — Meta WhatsApp Cloud API (build only, not production traffic)
Depends on owner action: Meta Business Manager / WhatsApp Business Platform app
provisioning, System User token, a **test phone number** (Meta provides these free for
development — this is how the build gets tested without touching the live number).
Build: webhook receiver (`whatsapp-webhook` Edge Function, §05's security requirements),
`whatsappProvider` adapter, template submission/approval workflow (§06). All testing
against the Meta test number.

### Phase G — AI conversation routing (against the test number)
First: resolve the fork in §02 §7 — does Meta's own "Teach me more" AI stay the
conversational engine (gating/context-injection only) or does DeepFlow build its own
LLM integration and retire it? That decision shapes everything else in this phase.
Then: contact classification, conversation state (§07 §1), intent classification,
context retention, handover logic, shared inbox UI (`comms-inbox.js`). `REVIEW BEFORE
SEND` default (§07 §1.4). **Test suite: `docs/meta-business-agent/TEST-CONVERSATIONS.md`
— 115 cases across 31 categories, already written** — run these against the test number
before Phase H, rather than inventing new test cases; add to that suite only for
gaps genuinely specific to the new platform layer (e.g. suppression-engine behavior)
that the existing conversation-focused suite wouldn't cover.

### Phase H — Dual-test
Test-number Meta flow running in parallel with the live Twilio number, same inbound
message types replayed/simulated against both, comparing behavior. This is where
Twilio's actual current Studio Flow finally gets inspected in detail (blocked on access
per §00/§03) — Phase H can't complete without it, since "compare against current
behavior" requires knowing current behavior.

### Phase I — Controlled cutover
Feature flag (`whatsappProvider: TWILIO | META`), the live number's traffic
switched — not duplicated to both. Rollback path stays live (§09) until a stability
period passes.

### Phase J — Payment chase activation
Dry-run first (matching Phase D's pattern, scoped to `payment_chase_state`
specifically), smallest reasonable blast radius first (e.g. one client segment) before
full activation, per BRD §7's "no automatic backfill" and "no automation defaults to
LIVE" rules.

### Phase K — Twilio removal
Only after Phase I's stability period + explicit owner approval. Per §09.

## 3. What's real work vs. what's owner-side setup

Phases A–E are entirely code, no external account setup needed, could start now. Phase
F is blocked on Meta Business Manager access (owner-side). Phase H is blocked on Twilio
Console access (owner-side, flagged since §00). Everything else follows from those two.
