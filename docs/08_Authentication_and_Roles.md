# 08 — Authentication & Roles

## 1. Two Different Authentication Models

| | Office App | Employee App | Client Portal |
|---|---|---|---|
| **Mechanism** | Supabase Auth (email + password) | Supabase Auth (email + password) | **None** |
| **Session length** | Managed entirely by the Supabase Auth library itself | A custom 30-day marker in `localStorage`, on top of Supabase's own session | No concept of a session at all |
| **Who can log in** | Any Supabase Auth account with a matching `users` row whose `role` is **not** `engineer` | Any Supabase Auth account with a matching `users` row whose `role` **is** `engineer` and `active = true` | Anyone with the right link |

## 2. Login Sequence (Office & Employee Apps)

1. Email + password submitted to Supabase Auth (`signInWithPassword`).
2. On success, the app looks up a matching row in the `users` table, first by `auth_id`, falling back to matching by `email` (and backfilling `auth_id` if it was missing).
3. The app checks the matched row's `role` against which app is running, and rejects the login (with an explanatory message) if it doesn't match — see Section 1.
4. **Office App only:** a hardcoded list of "emergency admin" email addresses always receives Admin access, auto-repairing their `users` row if it's missing or has been downgraded. This exists so the business owner can never be permanently locked out.
5. On success, the app builds an in-memory user object (`_appUser`) carrying the role and every permission flag, and the interface renders accordingly (Section 4).

## 3. The `pinLock` Setting — Read This Carefully

`S.pinLock` is a single setting, in the Office App only, that is far more consequential than its name suggests:

- **If on (the normal state):** the login screen is shown, and every permission check behaves as documented in Section 4.
- **If off:** the login screen is skipped entirely, and the app automatically signs in as the **first user found in the cached settings, with no password check of any kind.** Separately, but for the same underlying reason, **every single permission check in the app also automatically returns "allowed"** while this setting is off, regardless of any individual user's actual role or flags.

This is not two features — it's one flag controlling both. Anyone administering this system should treat `pinLock` as "is authentication and authorization active at all," not as a minor convenience toggle. Full technical detail: [../BUSINESS_RULES.md](../BUSINESS_RULES.md) Section 1.1, [../SECURITY_AUDIT.md](../SECURITY_AUDIT.md) Section 1.

## 4. The Complete Role Matrix (Office App)

| Role | Pages visible | Settings tabs visible | Notable restrictions |
|---|---|---|---|
| **Admin** | Everything | Everything | None |
| **Manager** | Everything except Engineer Reports, Audit Log | Everything except Company/Notifications/Data/Guide & SQL | Cannot manage users (a separate, specific rule even though Managers otherwise get "yes" to everything) |
| **Finance** | Dashboard, Invoices, Statements, Reports, Jobs (read-only), Directories, Properties, Settings | Invoicing only | Jobs page has its edit/delete controls hidden |
| **Staff** | Dashboard, Jobs, Invoices, Statements, Job Requests, Directories, Properties, Certificates, Client View | None — no Settings access at all | Individual field-visibility flags (see Section 5) further restrict what they see even on visible pages |
| **Viewer** | 🚨 **Nothing.** The permission-checking function denies this role everything, but the page-visibility logic has no rule for it at all, so it receives no menu items whatsoever. This looks unfinished, not deliberately designed. | — | Effectively unusable in its current state |
| **Engineer** | N/A — blocked entirely from the Office App, redirected in messaging to the Employee App | — | — |

## 5. Per-User Field-Visibility Flags (Staff role specifically)

Independent of the page-level role matrix above, each individual `users` row carries its own fine-grained flags: `see_landlord`, `see_landlord_phone`, `see_agent`, `see_contact`, `see_price`, `can_edit`, `can_delete`, `can_invoice`, `can_finance`. These only meaningfully vary for the Staff role (Admin/Manager get "yes" to everything automatically; Finance and Viewer have their own fixed rules). Defaults, when a new user is added via Team management: office roles get sensible defaults based on their role (e.g. Finance always sees price; a plain Staff addition defaults to seeing everything unless specifically turned off).

## 6. Per-Engineer Visibility Permissions — Configured, But Not Enforced

A separate mechanism (`S.engPerms`, stored inside the settings blob, not the `users` table) lets an Admin configure, per individual engineer, whether they can see price/landlord/tenant/agent/notes/invoice information. **This has no effect** — confirmed by exhaustive search, the Employee App contains no code that reads this configuration at all. See [03_Employee_App.md](03_Employee_App.md).

## 7. The Client Portal — No Authentication

Identity is established purely by an `id` (and a `type`) present in the portal's own URL, looked up directly against the `persons`/`agencies` tables. There is no password, no verification step, and — despite the portal's own "invalid or expired" error wording — no actual link expiry logic anywhere in the code. This is documented as a security finding, not just an architectural note, in [15_Security.md](15_Security.md) Section 1.

## 8. Session & Token Handling

- **Office App:** relies entirely on the Supabase Auth JS library's own session persistence and refresh. A separate, custom 12-hour session mechanism (`_issueOfficeSession`/`_checkOfficeSession`, with matching `session_token`/`session_expires` columns confirmed live on `users`) exists in the code but is dead — never called by anything else.
- **Employee App:** an additional 30-day session marker in `localStorage`, independent of and longer than Supabase Auth's own default session handling — a deliberate choice, on the reasoning that engineers shouldn't have to log in daily on a work phone.
- **Every authenticated API request** carries its token in an `Authorization: Bearer <token>` header, retrieved fresh from the Supabase Auth session on each call — not a cookie. This has a direct, positive security consequence explained in [15_Security.md](15_Security.md) Section 12 (CSRF).

## 9. Password Reset

Both the Office App and Employee App expose a "Forgot password?" link that calls Supabase Auth's own `resetPasswordForEmail`, sending a reset email via Supabase's own mail service — no custom email infrastructure is involved.

## 10. Cross-References

Full permission rule listing with exact conditions: [13_Business_Rules.md](13_Business_Rules.md) Section 1. Security assessment of everything in this document: [15_Security.md](15_Security.md) Sections 1–2. The underlying `users` table schema: [05_Database.md](05_Database.md) Section 2.2.
