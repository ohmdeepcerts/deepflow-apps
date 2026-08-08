# 07 — SQL Migrations

This document covers `supabase/migrations/` specifically: what's in it, how it got there, and the convention for adding to it. It does not re-describe the schema itself — table structure, columns, relationships, and RLS policy content live in [05-database.md](05-database.md) and [06-supabase.md](06-supabase.md).

**Methodology:** every claim below was checked directly, not assumed. The 9 files in `supabase/migrations/` were read in full. Every file was grepped for `CREATE TABLE` (see Section 2). The live migration history was pulled directly from the Supabase project via the `list_migrations` MCP tool against `dzqyqpuhxdrrpipbehpk` and compared file-by-file against the repo folder (Section 3). `get_advisors` was run live to confirm the current security-lint state referenced in Section 5.

---

## 1. What's in `supabase/migrations/` today

9 `.sql` files plus `README.md`, timestamp-prefixed (`YYYYMMDDHHMMSS_description.sql`):

| File | Timestamp (UTC, from prefix) | Purpose |
|---|---|---|
| `20260718130728_add_postcode_column_to_jobs.sql` | 2026-07-18 13:07:28 | Adds `jobs.postcode`, backfills it by regex-extracting a UK postcode from the existing `address` text, and indexes it. |
| `20260720100129_add_jobs_to_realtime_publication.sql` | 2026-07-20 10:01:29 | Adds `jobs` to the `supabase_realtime` publication so row changes stream to subscribed clients. |
| `20260720142205_tighten_df_access_catchall_rls_policies.sql` | 2026-07-20 14:22:05 | Removes the blanket `df_access` policy ("any authenticated user or valid engineer token gets ALL access") from 6 tables (`jobs`, `users`, `attachments`, `engineer_requests`, `engineer_alerts`, `app_settings`) and replaces it with properly role-scoped policies — closes a bypass where any logged-in user of any role could read/write any row via the REST API directly, regardless of the app's own client-side permission checks. |
| `20260720174522_mark_rls_helper_functions_stable.sql` | 2026-07-20 17:45:22 | Marks 5 RLS helper functions (`is_office`, `is_engineer`, `is_valid_engineer_token`, `my_engineer_name`, `my_token_engineer_name`) `STABLE` instead of the default `VOLATILE`, so Postgres evaluates them once per query instead of once per row. |
| `20260720182314_drop_unused_duplicate_payments_invoice_columns.sql` | 2026-07-20 18:23:14 | Drops `payments.invid` and `payments.invoice_id` — dead duplicates of the one column the app actually reads/writes, `inv_id`. |
| `20260720183214_drop_orphaned_invoice_payments_table.sql` | 2026-07-20 18:32:14 | Drops the empty, effectively-unused `invoice_payments` table after its one real caller was fixed to query `payments` instead. |
| `20260721072317_add_credit_note_columns_to_invoices.sql` | 2026-07-21 07:23:17 | Adds `invoices.linkedinvid` and `invoices.reason` — without them, every credit-note save was silently failing PostgREST's schema check with an uncaught 400. |
| `20260729141702_drop_dead_unreferenced_settings_table.sql` | 2026-07-29 14:17:02 | Drops the empty `public.settings` table; app settings actually live in `app_settings` (Supabase) and `localStorage`, never this table. |
| `20260801000000_add_archived_flag_to_persons.sql` | 2026-08-01 00:00:00 | Adds `persons.archived` (`boolean`, default `false`) for soft-hiding Directory contacts (e.g. a landlord who's gone quiet) without deleting their linked job/invoice/cert history. |

`supabase/migrations/README.md` states these files were "pulled directly from `supabase_migrations.schema_migrations`" off the live project and "committed here for the first time" — i.e. this folder started life as a *capture* of already-applied SQL, not an authored-from-scratch migration set. One small inconsistency worth flagging: the README's own text still says "these **7** files" (`README.md:3`) even though the folder now holds 9 — the two most recent files (`20260729141702` and `20260801000000`) were added after the README was last updated and the count was never revised.

---

## 2. Critical finding: there is no baseline schema in this folder

**Every single file in `supabase/migrations/` is an `ALTER TABLE`, `CREATE INDEX`, `CREATE POLICY`, `DROP POLICY`, `CREATE OR REPLACE FUNCTION`, `ALTER FUNCTION`, or `DROP TABLE` statement that assumes its target table already exists.** None of them create a table from nothing.

Verified directly, not assumed:

```
$ grep -rc "CREATE TABLE" supabase/migrations/*.sql
20260718130728_add_postcode_column_to_jobs.sql:0
20260720100129_add_jobs_to_realtime_publication.sql:0
20260720142205_tighten_df_access_catchall_rls_policies.sql:0
20260720174522_mark_rls_helper_functions_stable.sql:0
20260720182314_drop_unused_duplicate_payments_invoice_columns.sql:0
20260720183214_drop_orphaned_invoice_payments_table.sql:0
20260721072317_add_credit_note_columns_to_invoices.sql:0
20260729141702_drop_dead_unreferenced_settings_table.sql:0
20260801000000_add_archived_flag_to_persons.sql:0
```

**`CREATE TABLE` appears zero times across all 9 files.** This matches exactly what `supabase/migrations/README.md` says about how the folder was created — it's a capture of incremental changes made *after* the schema already existed live, not a from-scratch build script. The oldest file in the folder (`20260718130728_add_postcode_column_to_jobs.sql`) opens with `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postcode text;` — it has no way to run successfully unless `jobs` is already there.

**Practical consequence:** running `supabase db push`, replaying these files in order via `apply_migration`, or any other "apply this folder" workflow against a genuinely empty, freshly created Supabase project will fail immediately on the first statement, because none of the 21 tables described in [05-database.md](05-database.md) exist yet to be altered. This folder is not a bootstrap script and was never intended to be one at the point it was captured.

This exact gap is independently documented — and reached the same conclusion by a different route — in [`docs/planning/23-developer-onboarding.md` §B2](../planning/23-developer-onboarding.md#b2-step-2--schema-a-real-confirmed-gap), which walks through what standing up a second, fresh instance for a different company would actually require. It is also tracked as a formal open item in [`docs/security/18-known-issues.md`](../security/18-known-issues.md) (being written separately). Treat all three references as describing the same one gap, not three different problems.

---

## 3. Live vs. repo: the folder is also missing 36 migrations that were actually applied

Item 4 of this document's brief was to confirm the live migration history matches the repo folder using the `list_migrations` MCP tool. It does not match — and the gap is large enough to be the more urgent finding of the two in this document.

`list_migrations` against `dzqyqpuhxdrrpipbehpk` returns **45 applied migrations**. The repo folder has **9 files**. Specifically:

- **7 files match exactly** (same timestamp, same name) — the first 7 rows of the table in Section 1, from `20260718130728_add_postcode_column_to_jobs` through `20260721072317_add_credit_note_columns_to_invoices`.
- **2 files match by name but not by timestamp:**
  | Repo file | Repo timestamp | Live `list_migrations` entry | Live timestamp |
  |---|---|---|---|
  | `20260729141702_drop_dead_unreferenced_settings_table.sql` | `141702` | `drop_dead_unreferenced_settings_table` | `141650` (52s earlier) |
  | `20260801000000_add_archived_flag_to_persons.sql` | `000000` | `add_archived_flag_to_persons` | `173235` |
  The second one in particular — a repo timestamp of exactly midnight (`000000`) against a live timestamp of `17:32:35` — looks like it was typed by hand rather than captured verbatim from `schema_migrations` the way the README describes for the rest of the folder.
- **36 migrations exist on the live project with no corresponding file in the repo at all** — everything from `20260722142212` through `20260805072152`. That's 80% of the live migration history unrepresented in version control:

| Version | Name |
|---|---|
| 20260722142212 | c1_c4_lock_down_admin_rpcs |
| 20260722142233 | c1_scope_catchall_rls_to_office |
| 20260722142348 | c2_scope_portal_rpcs_to_resolved_identity |
| 20260722143302 | c5_lock_down_storage_bucket |
| 20260722143521 | c2_drop_old_vulnerable_portal_rpc_signatures |
| 20260725151756 | add_missing_invoices_certtypes_column |
| 20260725153427 | add_missing_invoices_jobdate_column |
| 20260725153610 | add_missing_invoices_engineer_column |
| 20260725163831 | h1_revoke_dead_verify_engineer_login_rpc |
| 20260725163955 | harden_helper_function_search_paths |
| 20260725180218 | m9_wrap_rls_auth_calls_for_perf |
| 20260725180256 | m9_drop_duplicate_agencies_portal_token_index |
| 20260725180413 | m7_scope_attachments_engineer_policies_to_own_jobs |
| 20260725181008 | m1_m2_server_side_invoice_items_validation |
| 20260725205613 | l1_add_missing_fk_indexes |
| 20260726063219 | fix_portal_pin_rpcs_match_by_token_not_id |
| 20260726063914 | revert_portal_pin_rpcs_to_match_by_id |
| 20260726064042 | harden_portal_pin_functions_search_path |
| 20260726064259 | fix_portal_pin_search_path_include_extensions |
| 20260726225252 | engineer_pin_login_schema |
| 20260726225324 | engineer_token_rls_certs_and_storage |
| 20260726225353 | engineer_pin_login_rpcs |
| 20260726225446 | fix_engineer_pin_login_ambiguous_column |
| 20260726225632 | fix_engineer_pin_login_exception_rollback_bug_v2 |
| 20260727073853 | engineer_pin_self_service_reset_flow |
| 20260727141818 | tighten_office_only_rpc_grants |
| 20260728094411 | add_invoice_bill_to_override |
| 20260728115156 | add_invoice_pdf_path |
| 20260728130255 | fix_invoice_pdf_storage_upload_rls |
| 20260728130443 | add_storage_select_policy_deepflow |
| 20260730085423 | neutralize_real_looking_sample_emails |
| 20260803152939 | drop_jobs_hours_column |
| 20260804084625 | drop_dead_invoice_columns |
| 20260804093755 | add_certs_appliances_column |
| 20260805071459 | fix_portal_jobs_invoices_partial_link_bug |
| 20260805072152 | make_portal_name_matching_case_insensitive |

Reading the names alone, this missing stretch is not minor cleanup — it includes what looks like a severity-coded security remediation pass (`c1`/`c2`/`c5` = presumably Critical findings 1, 2, 5; `h1` = High finding 1; `m1`/`m2`/`m7`/`m9` = Medium findings; `l1` = Low finding 1 — inferred from the naming pattern itself, since no audit document in this repo currently spells out that key), the entire engineer PIN-login schema and RPC set (with three follow-up bugfix migrations against it), storage RLS fixes, and the invoice item-validation and FK-index work referenced elsewhere in [05-database.md](05-database.md). None of it is reproducible from this repo today.

**What this means in practice:** `supabase/migrations/README.md`'s stated goal — "so the repository and the live database never drift apart again" — has already not held. The repo was synced once (or twice, given the 7-vs-9 file history), and the live project has continued to receive migrations that were never captured back into it. The discipline described in the README is aspirational at this point, not something currently being followed consistently.

---

## 4. What a genuine fresh install would need

This section documents the gap; it does not attempt to close it. Two real options, neither implemented here:

- **(a) Generate one true baseline migration from the live project.** Run `supabase db dump --schema public -f baseline.sql` (or the equivalent through the Supabase dashboard) against `dzqyqpuhxdrrpipbehpk`, and commit the result as a new, earliest-timestamped file (e.g. `0000_initial_schema.sql`) ahead of everything in Section 1. This is the only approach that would make the folder genuinely replayable against an empty project, and it would also need to happen *before* any attempt to backfill the 36 missing migrations from Section 3, since some of those migrations alter objects (RPCs, RLS policies) that a straight schema dump would already capture in their current, final form.
- **(b) Reconstruct manually.** Read [05-database.md](05-database.md) plus the existing 9 migrations and hand-write the missing `CREATE TABLE` statements and any other setup this folder never captured. Slower and more error-prone than (a) — `05-database.md` itself is a description of the live schema, not something designed to be mechanically converted back into SQL.

Neither has been done. This is tracked as an open item in two places, not implemented here:
- [`docs/planning/23-developer-onboarding.md` §B2](../planning/23-developer-onboarding.md#b2-step-2--schema-a-real-confirmed-gap), which independently reaches the same conclusion while walking through what stands between here and a second, fresh instance for a different company.
- [`docs/security/18-known-issues.md`](../security/18-known-issues.md) (being written separately), where it's formally logged as a known limitation rather than left implicit in two architecture docs.

Related, smaller gap worth noting here: there is no `supabase/config.toml` and no `.supabase/` directory anywhere in this repo (`ls supabase/` shows only `migrations/` and `functions/`). The project has never been `supabase link`-ed locally. In practice this means the Supabase CLI's own migration commands (`supabase db push`, `supabase migration up`, etc.) aren't actually configured to run against `dzqyqpuhxdrrpipbehpk` from a clean checkout today — the real, working path is the Supabase MCP server's tools (Section 5), which don't need local project linkage at all.

---

## 5. Convention for future migrations

Based on the pattern already established by the 9 files in this folder and confirmed against the live project's history in Section 3:

- **Naming:** `YYYYMMDDHHMMSS_description.sql`, snake_case, generally starting with a verb (`add_`, `drop_`, `tighten_`, `mark_`, `fix_`, `harden_`) describing the change, matching what both the repo files and the 36 uncaptured live migrations in Section 3 use.
- **Location:** `supabase/migrations/` — one file per migration, not batched.
- **How to apply:** via the Supabase MCP server's `apply_migration` tool against project `dzqyqpuhxdrrpipbehpk` (the mechanism this session used to confirm live state — no local `supabase link` exists, see Section 4), or the Supabase CLI if a project link is set up first. Either way, **the applied SQL should also be committed to this folder as its own timestamped file in the same commit/session** — Section 3 is the concrete evidence of what happens when that second step is skipped.
- **Check `get_advisors` around schema changes that touch RLS.** This isn't inferred from a comment inside the 9 repo files themselves — none of them explicitly say "ran get_advisors" — but the practice is real and documented elsewhere: [`docs/planning/23-developer-onboarding.md` §A5](../planning/23-developer-onboarding.md#a5-the-supabase-connection-hardcoded-not-env-var-driven) records running the security advisor against `dzqyqpuhxdrrpipbehpk` to confirm RLS coverage, and this session's own `get_advisors` (security) run against the live project returned only the same two already-understood, accepted findings — `push_subscriptions` having RLS enabled with no policies (by design, Section 3.17 of [05-database.md](05-database.md)), and a set of `SECURITY DEFINER` RPCs being callable by `anon`/`authenticated` (the deliberate mechanism behind Client Portal and Engineer PIN sessions, per `20260720142205_tighten_df_access_catchall_rls_policies.sql`'s own header comment). The severity-coded names in Section 3's missing-migrations table (`c1`, `c2`, `c5`, `h1`, `m1`/`m2`/`m7`/`m9`, `l1`) are themselves consistent with a project that has been running a "fix a finding, migrate, re-check advisors" loop — just one whose migrations haven't all made it back into this folder.
- **Migration comments should say why, not just what.** Every file in Section 1 opens with a comment block explaining the problem being fixed and what was verified before the change (e.g. row counts checked before a `DROP TABLE`, which specific bug a missing column caused) — follow that pattern rather than an unexplained bare `ALTER`/`CREATE` statement.

---

## See also

- [05-database.md](05-database.md) — the schema itself: tables, columns, relationships, RLS policy counts
- [06-supabase.md](06-supabase.md) — Auth, Storage, Realtime, and full RLS policy detail (once written)
- [`supabase/migrations/README.md`](../../supabase/migrations/README.md) — the folder's own one-paragraph account of its origin
- [`docs/planning/23-developer-onboarding.md`](../planning/23-developer-onboarding.md) — Part B walks through the same baseline-schema gap from the angle of standing up a fresh instance
- [`docs/security/18-known-issues.md`](../security/18-known-issues.md) — formal tracking of this gap as an open item (being written separately)
