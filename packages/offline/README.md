# @offline

The offline write-queue pattern (typed data — notes, status, hours — never lost to a dropped connection). Built once for the Employee App, partially and separately re-ported to the Office App previously. Should be one implementation.

A real breaking point during migration (`ARCHITECTURE_REDESIGN_PROPOSAL.md` §1.7): a silent data-loss bug here — a technician's logged hours, gone — is worse than almost any other failure mode in the system. Handle with proportionate care.

**Depends on:** `@core`.
**Depended on by:** apps.

Populated in Phase 4.
