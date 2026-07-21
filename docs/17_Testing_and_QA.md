# 17 — Testing & QA

## 1. Current State: No Automated Testing Exists

🔴 A full review of all three application files found **no unit tests, no integration tests, no end-to-end tests, and no test framework of any kind** referenced, imported, or configured anywhere in the repository. There is no `test/` folder, no testing library loaded from any CDN, and no CI configuration that would run tests even if they existed (see [16_Deployment.md](16_Deployment.md) Section 5). Every feature currently works — or doesn't — based entirely on manual use and the original developer's own testing during development.

This is a normal, if risky, state for a project built by a single developer without a formal QA process, and it is one of the most consequential gaps for a new team to close early, given how much of this system's correctness depends on precise conditional logic (see [13_Business_Rules.md](13_Business_Rules.md)) with no automated safety net protecting it from regressions.

## 2. What This Means Practically

- Every change to any of the three files carries an unknown risk of silently breaking an unrelated feature elsewhere in the same file (all logic for one app lives in one script block — see [01_System_Architecture.md](01_System_Architecture.md)).
- The three apps' independently-duplicated core logic (Section 5.1 of [02_Office_App.md](02_Office_App.md)) means a bug fixed in one app is not automatically verified as fixed (or even present) in the others.
- Several confirmed bugs in this documentation set (the `settings`/`app_settings` mismatch, the `certificates`/`certs` mismatch, the unenforced `engPerms`) are exactly the kind of issue a basic automated test — or even a documented manual QA checklist — would have caught before reaching production. See [18_Known_Issues.md](18_Known_Issues.md).

## 3. Recommended Testing Strategy for a New Team

Given the codebase's current architecture (no build tools, no framework), a pragmatic, incremental approach is more realistic than attempting to retrofit a full modern test suite immediately:

### Phase 1 — Manual QA Checklist (immediate, no tooling required)
Before any release, manually walk through the highest-risk workflows end to end, using the exact steps already documented in [12_Workflows.md](12_Workflows.md) — that document was written precisely so it could double as a manual test script. Priority order: login (all three apps), job creation → completion → auto-invoice/auto-cert chain (the system's most business-critical automated behaviour), photo upload, and the Client Portal's request form (currently suspected broken — see [15_Security.md](15_Security.md) Section 3.2 and [04_Client_Portal.md](04_Client_Portal.md)).

### Phase 2 — Smoke Tests Against a Staging Environment
Once a staging deployment exists ([16_Deployment.md](16_Deployment.md) Section 6), a small number of scripted browser tests (e.g. using Playwright or Cypress, which need no changes to the application itself — they drive the existing pages exactly as a user would) covering: can each app's login screen be reached and submitted, does the Jobs screen render, does a job save successfully. This catches the most catastrophic class of regression (a typo that breaks the whole app) cheaply, without needing to test every business rule.

### Phase 3 — Business-Rule Regression Tests
Because so much of this system's correctness lives in precise conditional logic (VAT calculation, star-rating formula, invoice numbering, certificate expiry math — all catalogued exactly in [13_Business_Rules.md](13_Business_Rules.md)), the highest-value next step is testing these specific calculations directly. Since the logic is currently embedded inline in the app and not exposed as separately-callable functions, this would likely require either (a) refactoring the calculation functions to be testable in isolation first, or (b) driving them indirectly through the UI with a browser-automation tool, asserting on the displayed result.

### Phase 4 — Security Regression Tests
Given the live, tested findings in [15_Security.md](15_Security.md) (particularly the anonymous Storage write access and the anonymously-callable `get_auth_users()` function), a small, repeatable script re-running exactly those safe tests (documented in full in that section) after any Supabase policy change would catch a regression back to an insecure state immediately, rather than relying on someone remembering to re-check manually.

## 4. What Should Never Be Tested Against the Live Production Database

Every live test performed while producing this documentation set used a strict safety rule: only test against tables/paths confirmed to hold no real data, and always reverse the action immediately. Any future automated testing should adopt the same discipline — ideally by pointing test automation at a **separate Supabase project** seeded with synthetic data, not the real production project, to remove this constraint entirely rather than working around it test-by-test.

## 5. Bug Reporting & Tracking

🔴 No issue tracker, bug database, or structured reporting process was found referenced anywhere in this project. [18_Known_Issues.md](18_Known_Issues.md) is, as of this documentation set, the closest thing to a bug tracker this project has — a new team should migrate its contents into a real issue tracker (GitHub Issues, Jira, Linear, or similar) as one of the first onboarding tasks.

## 6. Cross-References

The complete list of currently-known bugs this testing strategy should prioritise catching a recurrence of: [18_Known_Issues.md](18_Known_Issues.md). The prioritised order in which to actually act on all of this: [19_Future_Roadmap.md](19_Future_Roadmap.md).
