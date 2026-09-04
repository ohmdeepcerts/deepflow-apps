# @comms

`communicationProvider.send({channel, content})` — the transport swap point for
customer communications (`docs/communications/02-COMMUNICATIONS-ARCHITECTURE.md` §3).
Phase B only: `EMAIL` and `PUSH`, each wrapping the existing `send-email`/`send-push`
Edge Functions with no behavior change. `WHATSAPP`/`PORTAL`, the `comm_events` queue,
and `comm_templates`-driven rendering are Phase D+
(`docs/communications/08-IMPLEMENTATION-PLAN.md`) and not built here.

**Depends on:** nothing (takes the caller's `sbUrl`/`sbKey`/`getJWT`/`fetchImpl` as
parameters, same injection pattern as `@data`'s `createRepository`).
**Depended on by:** apps, one call site migrated at a time per the Phase B plan.
