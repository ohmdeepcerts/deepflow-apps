# @auth

Session handling and permission/role-checking **primitives** — deliberately *not* identity establishment. The Office/Employee apps use real Supabase Auth; the Client Portal uses a URL token + PIN. Those are different identity models solving different problems, not the same logic written twice (`ARCHITECTURE_REDESIGN_PROPOSAL.md` §1.6). This package shares the logic that *consumes* an identity (role checks, permission gates), not how identity is established.

**Depends on:** `@core`.
**Depended on by:** apps.

Populated in Phase 3.
