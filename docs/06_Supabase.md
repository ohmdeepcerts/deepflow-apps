# 06 — Supabase

Everything DeepFlow uses Supabase for, why, what depends on it, and what breaks if a given piece is removed. Project reference: `dzqyqpuhxdrrpipbehpk`. Full live-testing methodology: [../DATABASE_HANDBOOK.md](../DATABASE_HANDBOOK.md) and [15_Security.md](15_Security.md).

## 1. Authentication

**What it is:** Supabase's built-in email + password login service. **Why it exists:** to avoid building and hosting a custom authentication system. **Used by:** Office App and Employee App only. **Users:** login identity is a Supabase Auth account (email/password); a **separate** `users` table row (linked by `auth_id`) supplies the actual role and permission flags DeepFlow cares about — Auth proves *who*, the `users` table row decides *what they can do*. Full detail: [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md). **JWT:** every authenticated request carries a bearer token issued by Supabase Auth, attached manually via an `Authorization` header by each app's own hand-written fetch wrapper (not by the Supabase JS library, which is used only for the login/logout/session calls themselves). **What breaks if removed:** nobody could log in to either app; the entire role/permission system would have nothing to attach to.

## 2. Users, Roles, Permissions

Covered in full in [05_Database.md](05_Database.md) (`users` table) and [08_Authentication_and_Roles.md](08_Authentication_and_Roles.md) (the complete role matrix). In short: five office roles (Admin/Manager/Finance/Staff/Viewer) plus a separate Engineer case, all stored as a `role` string and a set of boolean permission columns on one shared `users` table.

## 3. Storage Buckets

**Bucket:** `deepflow` — one bucket for the entire project. **Folder structure:** `jobs/<job id>/<timestamp>-<random 4 chars>.<extension>`. **Naming:** file names are generated, not user-chosen, specifically to avoid collisions and to keep every file's origin (which job) traceable from its path alone. **Public vs. private:** the bucket is configured public — files are reachable via a predictable public URL with no additional authentication step, which is how the apps display photos directly in `<img>` tags. **Signed URLs:** 🔴 not used anywhere in this codebase — every file reference is a plain public URL. **What breaks if removed:** every photo/document ever uploaded is lost; every `attachments` row pointing at it becomes a dead link. Full detail, including live-tested write-permission findings: [09_Storage.md](09_Storage.md) and [15_Security.md](15_Security.md) Section 5.

## 4. Storage Policies

🟢 Live-tested (see [15_Security.md](15_Security.md) Section 5 for the exact test performed): anonymous upload, listing, and deletion **all succeeded** against the bucket, on a path outside the app's normal folder convention. This means Storage's Row Level Security is currently **not restricting anonymous write access at all** — a materially more permissive posture than the database tables (Section 8 below), which were found to at least partially block anonymous writes.

## 5. Realtime

**What it is:** a live, push-based update mechanism built on Postgres's own replication stream, exposed over a WebSocket. **Used by:** the Office App only, subscribed to exactly one table — `jobs` — for every insert/update/delete, from any source (including changes made by the Employee App, since both apps write to the same table; the subscription doesn't care which app made the change). **Channel name:** `jobs-realtime`. **What breaks if removed:** the Office App would fall back to its existing polling mechanism (Section on Synchronization) — nothing stops working outright, updates simply become slightly delayed instead of instant. Full detail: [10_Synchronization.md](10_Synchronization.md) Section 1.6.

## 6. Database Functions / RPC Functions

Every custom function referenced anywhere in the application code, and its live status (tested directly, not assumed from documentation):

| Function | Live status | Purpose | Who can call it |
|---|---|---|---|
| `get_auth_users()` | 🟢 **Installed and working** | Lists every Supabase Auth account, for the Office App's Team-management "Sync from Supabase" feature | 🚨 Currently **`anon`** (anyone, no login) — should be `authenticated` only. See [15_Security.md](15_Security.md) Section 3.4. |
| `create_confirmed_user(email, password)` | 🟢 **Not installed** | Would let an admin create a new login that works immediately, no email confirmation needed | N/A |
| `send_cert_reminders()` | 🟢 **Not installed** | Would find certificates due a reminder and log them, intended to run daily via `pg_cron` | N/A |
| `exec_sql(query)` | 🟢 **Not installed** | A self-repair mechanism: lets the Office App attempt to create a missing table (`engineer_alerts`) by sending raw SQL from the browser | N/A — and should never be granted to `anon` if it ever is installed; see [15_Security.md](15_Security.md) Section 15.10. |
| `query_cron_jobs()` | 🟢 **Not installed** | Powers an admin "check if pg_cron is active" button | N/A |

**What depends on these:** the Team-management sync feature depends entirely on `get_auth_users()` — without it, admins would need to manually match Supabase Auth accounts to `users` rows themselves. The other four are all optional convenience features whose absence means the corresponding admin-panel button/instructions simply don't do anything yet — nothing else in the app depends on them.

## 7. Triggers

🔴 None found anywhere in the codebase's embedded SQL, and no evidence of any trigger-driven behaviour observed. See [07_SQL_Migrations.md](07_SQL_Migrations.md).

## 8. Edge Functions

🟢 **Confirmed: none exist and none are used.** No `/functions/v1/` URL pattern appears anywhere in any of the three apps' source, and there is no `supabase/functions` folder in the repository. All "server-side" logic in this project is either plain browser JavaScript or one of the Postgres functions in Section 6 above.

## 9. Cron Jobs

🔴 Cannot be verified directly (the `cron.job` system table requires elevated access this review did not have). What's known: the *documentation* for a scheduled `pg_cron` job (daily certificate reminders) exists in the Office App's admin panel, but its supporting function (`send_cert_reminders()`) is confirmed not installed, so even if `pg_cron` the extension is enabled on this project, there is nothing currently scheduled to call. See [07_SQL_Migrations.md](07_SQL_Migrations.md).

## 10. Secrets & Environment Variables

🔴 No environment variables exist — there is no build process to inject them into (Architecture document). The Supabase project URL and **anon** (public) key are hardcoded, identically, into all three application files — this is the normal, expected way to configure a Supabase frontend; the anon key is designed to be public. No `service_role` key was found anywhere in the codebase (correct — it must never be shipped to a browser). Full security assessment, including what *is* a genuine secrets concern in this project (a hardcoded list of "emergency admin" email addresses): [15_Security.md](15_Security.md) Section 8.

## 11. Migrations

🔴 **None exist.** No `supabase/migrations` folder, no `.sql` migration files, and no schema-version-tracking mechanism of any kind were found. The schema exists only as whatever has actually been run, by hand, over time, in the Supabase SQL Editor. Full detail: [07_SQL_Migrations.md](07_SQL_Migrations.md).

## 12. Why Each Piece Exists — Summary Table

| Supabase feature | Why DeepFlow uses it | What breaks without it |
|---|---|---|
| Auth | Avoid building custom login | Office/Employee apps can't authenticate anyone |
| Database + PostgREST | The entire data layer, with zero backend code to write | The whole system stops — there is no other data store |
| Storage | Host engineer-uploaded photos/documents | All uploaded files are lost; Office/Client Portal have nothing to display |
| Realtime | Instant multi-user awareness on the Jobs screen only | Office App falls back to 5-second polling — degraded, not broken |
| RPC functions | A handful of small server-side conveniences (Auth-user listing, optional reminder scheduling) | Team-sync feature breaks; optional reminder feature stays inactive (it already is) |
