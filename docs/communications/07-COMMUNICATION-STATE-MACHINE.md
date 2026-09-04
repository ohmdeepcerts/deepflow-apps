# DeepFlow Communications — Conversation & Chase State Machines

**Status:** Draft for owner review. Two distinct state machines: WhatsApp conversation
state (AI/human handling) and payment-chase state (already introduced in §04, detailed
fully here).

---

## 1. Conversation state

### 1.1 Conversation-level state (`conversations.ai_enabled` / `.human_takeover`)

```
        ┌─────────────┐
        │  AI ACTIVE  │◀──────────────┐
        └──────┬──────┘               │
               │ handover trigger      │ office clicks
               │ (§1.3) OR office      │ "Return to AI"
               │ clicks "Take Over"    │
               ▼                       │
        ┌─────────────┐                │
        │HUMAN ACTIVE │────────────────┘
        └──────┬──────┘
               │ office sets AI: OFF
               │ for this contact
               ▼
        ┌─────────────┐
        │  AI PAUSED  │  (contact-level, not conversation-level —
        └─────────────┘   persists across future conversations too)
```

Hard rule, not a heuristic: while `human_takeover = true`, the AI must not generate or
send *any* reply into that conversation, full stop. No race window where both an AI
draft and a human reply could go out — the webhook handler checks `human_takeover`
before invoking the AI at all, not after generating a reply and discarding it.

### 1.2 Contact-level classification (checked *before* state above even applies)

`contact_type`: `customer` | `staff` | `engineer` | `supplier` | `unknown`. For anything
other than `customer`, AI is force-disabled at the contact level regardless of
conversation state — this is the direct fix for the confirmed staff-chat bug. Office can
override per-contact (`AI: ON / OFF / MANUAL ONLY`) as the master prompt specifies, but
the *default* for a newly-seen, unclassified number should be conservative: treat as
`unknown`, AI drafts held for review (§1.4) rather than auto-sent, until classified.

### 1.3 Handover triggers (AI ACTIVE → HUMAN ACTIVE)

Full list and exact wording already specified in
`docs/meta-business-agent/26-human-handover.md` (electrical/gas emergency, complaint,
certificate-content dispute, payment/billing dispute, a request needing information the
AI doesn't have confirmed, explicit human request or frustration, anything outside
trained scope). This state-machine doc's job is only to make sure the *mechanism* fires
reliably when the training pack's *conditions* are met — not to re-specify the
conditions. All handovers happen *after* whatever useful intake was already
gathered — not by discarding context, per §1.5 — matching `26-human-handover.md`'s own
"capture what's useful before handing over" instruction.

### 1.4 AI send mode (global default + per-client/per-conversation override)

`AUTO SEND` | `REVIEW BEFORE SEND` | `OFF`. Proposed rollout default: **`REVIEW BEFORE
SEND` for all customer conversations during initial rollout**, narrowing to `AUTO SEND`
per-category only once dry-run/shadow data shows the classifier is reliable for that
category. This is the master prompt's own suggestion, kept as-is since it's a sound
staged-rollout pattern, not something needing a redesign.

### 1.5 Conversation context (what makes "please add the name" → "Varinder Kaur" work)

`conversations.current_intent`, `active_job_id`/`active_invoice_id`/
`active_certificate_id`/`active_property`, `collected_fields` (jsonb),
`missing_fields`, `context_summary` — per the model already sketched in §02's
`conversations` table. The rule this exists to enforce: **a new inbound message is
interpreted against the active context first**, and only starts a fresh
`NEW_JOB`/intake flow if nothing in the current context plausibly continues it. This is
a classifier-prompt discipline (feed the AI the current context summary + last N
messages, ask it to decide "continuation or new topic" before anything else) rather than
a purely structural guarantee — flagged here so the eventual AI-prompt design work
treats it as a first-class requirement, not an afterthought.

### 1.6 Top-level intents (for classification)

`INTERNAL_OR_STAFF` `NEW_JOB` `EXISTING_JOB` `CERTIFICATE_REQUEST`
`CERTIFICATE_AMENDMENT` `CERTIFICATE_QUERY` `APPOINTMENT_QUERY` `RESCHEDULE`
`CANCELLATION` `INVOICE_QUERY` `PAYMENT_QUERY` `PAYMENT_PROMISE` `PAYMENT_CLAIMED`
`INVOICE_DISPUTE` `COMPLAINT` `EMERGENCY_ELECTRICAL` `EMERGENCY_GAS`
`GENERAL_BUSINESS_QUERY` `HUMAN_REQUEST` `UNRELATED` `UNKNOWN` — kept as specified in
the master prompt; this list is genuinely comprehensive and doesn't need rework.

This is a *routing* taxonomy (what a classifier tags one message as), and it's a
different shape from — not a replacement for — `docs/meta-business-agent/
TEST-CONVERSATIONS.md`'s 31 *test-scenario* categories (client-type coverage like
Tenants/Homeowners/Commercial, robustness coverage like Misspellings/Confusing
Messages/Short Agent Messages, alongside the same core scenarios). Both are needed:
this list for whatever does the routing, that suite as the concrete 115 test cases to
validate against once anything real gets built — reuse it rather than write new test
cases from scratch in §08's implementation plan.

## 2. Payment chase state

```
                    ┌────────┐
        ┌──────────▶│ ACTIVE │◀─────────────┐
        │           └───┬────┘              │
        │               │                    │ promise date + grace
        │   "I'll pay   │                    │ period elapses, still
        │    Friday"    ▼                    │ unpaid
        │          ┌──────────┐              │
        │          │ PROMISED │──────────────┘
        │          └────┬─────┘
        │               │ promised date passes,
        │               │ payment recorded
        │               ▼
        │          ┌────────┐
        │          │  PAID  │  (terminal — stage exits chase entirely)
        │          └────────┘
        │
        │   "Paid       ┌─────────┐
        ├──────────────▶│ CLAIMED │──── office verifies ────▶ PAID
        │   yesterday"  └─────────┘         or reverts to ACTIVE
        │                                    if not actually paid
        │
        │  "Invoice     ┌───────────┐
        ├──────────────▶│ DISPUTED  │──── office resolves ────▶ ACTIVE or PAID
        │   is wrong"   └───────────┘
        │
        │  office        ┌────────┐
        └───────────────▶│ PAUSED │──── office resumes ────▶ ACTIVE
           manual pause   └────────┘
                              │
                   stage 6 exhausted, still ACTIVE
                              ▼
                     ┌─────────────┐
                     │  ESCALATED  │  (human accounts task, no automation)
                     └─────────────┘
```

Every transition is logged (who/what triggered it, timestamp) — this is the audit trail
the Invoice → Payment Follow-Up UI (BRD, master prompt's office UI section) reads
directly, and it doubles as evidence during the Meta migration's dual-test phase that
the new chase logic behaves identically to intended policy before real customers are
exposed to it.

**`CLAIMED` never auto-transitions to `PAID`.** This is deliberate and non-negotiable
per BRD §5.4 — a customer's word alone doesn't change the financial record; only an
office-confirmed payment (the existing `markInvPaid`/payment-recording flow, unchanged
by this project) does.
