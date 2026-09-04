# DeepFlow Communications — Rollback Plan

**Status:** Draft for owner review.

---

## 1. Principle

Every phase in §08 that touches live customer communication has a rollback path defined
*before* it ships, not improvised after something goes wrong. The one irreversible step
in the whole plan is Phase K (Twilio removal) — everything before it is designed to be
reversible.

## 2. Rollback by phase

**Phases A–C (data model, provider abstraction, Portal notifications):** Additive
schema and new code paths that don't replace anything live. Rollback = don't route
traffic through them yet, or drop the new tables if abandoned entirely. No customer
impact either way.

**Phase D (event engine, dry-run):** By definition sends nothing. Rollback = stop the
scheduled processor. Zero customer impact.

**Phase E (live Email/Portal/Push):** Rollback = global `PAUSE ALL AUTOMATED
COMMUNICATIONS` switch (BRD's kill switch), which the event processor checks before
every send. Existing ad-hoc email/push call sites this phase migrated can be reverted to
their pre-migration direct calls if the new engine misbehaves — kept possible by not
deleting the old call sites until Phase E has run stably for a defined period (proposed:
2 weeks minimum before removing the old direct-call paths).

**Phase F–G (Meta build, AI routing):** Runs entirely against a Meta test number.
Rollback = simply don't cut real traffic over. No live-number impact by construction.

**Phase H (dual-test):** Same — test number only. No live-number impact.

**Phase I (cutover) — the one that actually needs a real rollback mechanism:**
- `whatsappProvider` feature flag, `TWILIO` or `META`, never both simultaneously for the
  same outbound message (master prompt's own rule, kept — avoids double-sends and
  divergent conversation state).
- Rollback = flip the flag back to `TWILIO`. Requires Twilio to remain fully configured
  and untouched (not decommissioned) throughout Phase I and the stability period after
  it — this is *why* Twilio removal is a separate, later phase rather than part of
  cutover.
- **Stability period before Twilio removal is even considered**: proposed 2–4 weeks of
  Meta-direct handling real traffic with no material incident, owner sign-off required
  to shorten or waive this.
- Inbound message routing during Phase I: whichever provider currently holds the live
  number receives inbound webhooks — this isn't a per-message choice, it's tied to which
  BSP Meta considers authoritative for the number at that moment (a real Meta-side state,
  not a DeepFlow feature flag) — §03 (once buildable) needs to detail the exact
  mechanics of Meta's BSP-migration process here, since this is the part most likely to
  have real constraints DeepFlow can't route around.

**Phase J (payment chase activation):** Same dry-run-first, small-blast-radius-first
approach as Phase D/E. Rollback = pause switch, scoped to `payment_chase_state`
specifically if a narrower rollback is preferable to the global pause.

**Phase K (Twilio removal) — irreversible, so gated hardest:**
- Only proceeds after explicit owner approval, separate from the approval that started
  Phase I.
- Historical Twilio-provider message records are **not deleted** — `messages.channel`
  distinguishes `provider = 'twilio_legacy'` from `provider = 'meta'` (§02's `messages`
  table gets a `provider` column for exactly this). Removing Twilio removes the SDK,
  API calls, webhook routes, environment secrets, and dead code — not history.
- After removal, "rollback" in the Phase I sense no longer exists — this is the actual
  point of no return, which is why everything before it exists to build confidence
  first.

## 3. Circuit breakers (apply throughout, not just at cutover)

- Global pause switch, checked by every send path, not bypassable by any individual
  automation.
- Anomaly protection: an hourly/daily send-volume cap per channel, so a configuration
  mistake can't mass-message the customer base — master prompt's own requirement, kept
  as a hard requirement here, not optional.
- Dry-run mode available at any time, for any channel, independent of the global pause
  (lets you verify "what would fire" without needing to first turn everything off).

## 4. What this plan cannot promise

It cannot promise Twilio removal will be simple — that depends entirely on details this
audit couldn't see (§00 §7, §00 §8). It also can't promise a specific timeline, since
Phases F onward depend on owner-side Meta/Twilio account actions this project has no
control over. What it can promise is that no phase up to and including I is designed to
put the live WhatsApp number at risk of an unrecoverable state.
