# 18 — Known Issues

A single, consolidated master list of every issue found across the full review of this project — the general software audit ([../AUDIT.md](../AUDIT.md)), the security audit ([15_Security.md](15_Security.md)), and the performance audit ([../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md)). Each item links to its full write-up rather than repeating it. Prioritised next steps for all of these: [19_Future_Roadmap.md](19_Future_Roadmap.md).

## 1. Current Bugs (confirmed, reproducible)

| Issue | Severity | Detail |
|---|---|---|
| Employee App reads the wrong settings table (`settings` instead of `app_settings`) — office WhatsApp number is always wrong | High | [../AUDIT.md](../AUDIT.md) §1.1 |
| Storage dashboard counts a `certificates` table that doesn't exist (real table: `certs`) | Low | [../AUDIT.md](../AUDIT.md) §1.2 |
| Duplicate, inconsistently-populated columns on `invoices` (`job_id`/`jobid`, `desc`/`description`, three address fields) | Medium | [../AUDIT.md](../AUDIT.md) §1.3 |
| Two definitions of the invoice status-colour map have drifted apart (same status renders different colours in different places) | Low | [../AUDIT.md](../AUDIT.md) §3.1 |
| Client Portal's "submit a request" feature is very likely failing in production (anonymous `INSERT` into `engineer_requests` is blocked, live-confirmed) | High | [15_Security.md](15_Security.md) §3.2 |

## 2. Hidden / Silent Bugs (no visible error, feature just doesn't work)

| Issue | Severity | Detail |
|---|---|---|
| Per-engineer visibility permissions (`engPerms`) are configured in the Office App but never read by the Employee App | High | [../AUDIT.md](../AUDIT.md) §2.1 |
| Three features read database tables that don't exist (`ratings`, `invoice_audit`, `invoice_payments`) — always silently show nothing | High | [../AUDIT.md](../AUDIT.md) §2.2 |
| Scheduled certificate reminders look set up (the log table exists) but the function that would populate it isn't installed | Medium | [../AUDIT.md](../AUDIT.md) §2.5, [07_SQL_Migrations.md](07_SQL_Migrations.md) |

## 3. Broken / Unfinished Logic

| Issue | Severity | Detail |
|---|---|---|
| `pinLock` off doesn't just skip login — it disables every permission check in the app | Critical | [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) §3 |
| The `Viewer` role logs in to a completely blank application | Medium | [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) §4 |
| No status state machine anywhere — any job/invoice status can transition to any other, including nonsensical ones | Medium | [13_Business_Rules.md](13_Business_Rules.md) §2.2 |
| P&L wage costs and payslip hours are flat-rate estimates presented alongside real figures, with no visual distinction | Medium | [13_Business_Rules.md](13_Business_Rules.md) §10 |
| VAT quarter report only ever totals output VAT — never a true input/output reconciliation | Medium | [13_Business_Rules.md](13_Business_Rules.md) §10.3 |

## 4. Duplicate Code

| Issue | Severity | Detail |
|---|---|---|
| The entire Supabase connection layer (URL, key, fetch wrapper, field-mapping) is copy-pasted independently into all three apps, not shared | High | [../AUDIT.md](../AUDIT.md) §5.1 |
| The same CSS block is repeated verbatim 7 times in the Employee App | Low | [../AUDIT.md](../AUDIT.md) §5.2 |

## 5. Dead Code

| Issue | Severity | Detail |
|---|---|---|
| A full custom session system (`_issueOfficeSession`/`_checkOfficeSession`), with matching live database columns, is never called | Medium | [../AUDIT.md](../AUDIT.md) §6.1 |
| A second, superseded certificate-expiry-prompt flow (with its own modal) coexists with, and is bypassed by, the current automatic flow | Low | [../AUDIT.md](../AUDIT.md) §6.2 |
| ~15 database columns across several tables exist with no application code reading or writing them | Low | [../AUDIT.md](../AUDIT.md) §6.3, [05_Database.md](05_Database.md) |

## 6. Performance Issues

| Issue | Severity | Detail |
|---|---|---|
| The Command Palette has no debounce and fires ~40+ full-table fetches for a typical search | High | [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §6.1 |
| No shared cache for any table except `jobs` — 172 redundant full-table fetch call sites counted | Medium | [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §6.2 |
| No server-side filtering for most reporting screens — full tables downloaded, filtered client-side | Medium | [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §7 |
| No confirmed database indexes beyond one | Medium | [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §7, [05_Database.md](05_Database.md) |
| No thumbnail generation; "HD" photo uploads skip compression entirely, with no size ceiling | Medium | [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) §8–9 |

## 7. Security Issues

Full detail and live-test evidence: [15_Security.md](15_Security.md). Summary, most severe first:

| Issue | Severity |
|---|---|
| Anonymous Storage access is fully open — upload, list, and **delete**, confirmed by direct test | **Critical** |
| `get_auth_users()` lets anyone list every staff email/ID with no login | **Critical** |
| Every database table is readable by anyone, no login required | **Critical** |
| Widespread unescaped HTML rendering (stored XSS) in the Office and Employee apps | **Critical** |
| `pinLock` off disables authentication and authorization entirely | **Critical** |
| Client Portal has no authentication mechanism at all | High |
| All authorization is client-side only; nothing is re-checked server-side | High |
| Hardcoded "emergency admin" email addresses visible in public page source | Medium |
| No file type/size validation at the point of upload | Medium |

## 8. Scalability Issues

- The entire application configuration (including the full Properties list) lives in one JSON blob in one database row — every settings change re-writes the whole blob, and the Properties list cannot be efficiently searched or paginated as it grows. See [05_Database.md](05_Database.md) Section 2.18.
- `dAll()`'s "fetch every row" pattern has a hard 50,000-row safety cap but no genuine pagination below that — a table approaching that size would load entirely into every user's browser on every relevant screen. See [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) Section 7.
- Name-based (not ID-based) relationships between most core records (Section 3 of [05_Database.md](05_Database.md)) become more fragile, not less, as the number of clients and jobs grows.

## 9. Maintainability Issues

- Three independent copies of core connection logic, already confirmed to have drifted apart in practice (Section 4 above).
- No automated tests of any kind (see [17_Testing_and_QA.md](17_Testing_and_QA.md)).
- No migration history for the database schema (see [07_SQL_Migrations.md](07_SQL_Migrations.md)).
- No CI/CD or deployment pipeline (see [16_Deployment.md](16_Deployment.md)).
- 2,308 inline `style=` attributes counted in the Office App alone, inflating both the generated HTML and the effort required to make a consistent visual change. See [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) Section 3.2.

## 10. Cross-Reference Index

| Full document | Covers |
|---|---|
| [../AUDIT.md](../AUDIT.md) | Bugs, hidden bugs, race conditions, broken logic, duplicate/dead code, memory leaks |
| [15_Security.md](15_Security.md) | Every security finding, including live-tested evidence |
| [../PERFORMANCE_AUDIT.md](../PERFORMANCE_AUDIT.md) | Slow pages, large scripts, API call volume, storage/image inefficiencies |
| [19_Future_Roadmap.md](19_Future_Roadmap.md) | What to actually do about all of the above, in priority order |
