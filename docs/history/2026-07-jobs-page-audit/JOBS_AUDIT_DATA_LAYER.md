# Jobs Page Data Layer / Supabase Audit — DeepFlow

**Scope:** Supabase schema, RLS policies, Realtime configuration, and query patterns behind the Jobs page in D:\DEEPFLOW\index.html
**Method:** Direct live queries against the production Supabase project (dzqyqpuhxdrrpipbehpk) via the Supabase management MCP tools, cross-referenced against the app's fetch/subscribe code.

---

## Scale reality check (read this before anything else in this report)

Direct query against the live project today: `jobs` = **7 rows**, `invoices` = 1, `certs` = 5, `agents` = 2, `agencies` = 1, `persons` = 0.

This is a small, early-stage live business — not remotely close to the "hundreds of thousands of records" scale the CTO brief's final goal aspires toward. Every finding below is labeled **[NOW]** if it's already causing real symptoms at 7 rows, or **[LATER]** if it's a real gap but not the cause of any pain a user could be feeling today at this row count. Prioritize [NOW] findings for immediate remediation and treat [LATER] findings as scale-readiness work to schedule deliberately, not urgently.

---

## Finding 1 — [LATER] Jobs page fetch is unscoped: the full `jobs` table is fetched, with filtering/sorting done client-side

**Current Findings**
The Jobs page's data-fetch path pulls the entire `jobs` table (no `LIMIT`, no server-side date-range/status scoping) rather than fetching only the rows relevant to the currently visible view.

**Problems**
At scale, this means every page load/refresh transfers and parses the entire table, and every filter/search operation works against an already-fully-loaded in-memory set rather than letting Postgres do the filtering.

**Root Cause**
The app was built around a "load everything once, filter in JS" model, which is a completely reasonable and often *faster* architecture at small row counts (avoids round-trips per filter change) but doesn't scale linearly.

**Evidence**
Direct comparison of the fetch call's query parameters against the full table schema — no `.gte('date', ...)`, `.eq('status', ...)`, or `.limit(...)` clauses are present on the Jobs page's primary fetch.

**Impact**
At 7 rows: zero impact — this is in fact the more responsive architecture at this scale (see Finding 3). At 10,000+ rows: every fetch becomes a multi-second, multi-megabyte transfer, and initial page load becomes the dominant complaint.

**Risk**
Medium to change — introducing server-side scoping means the client-side filter logic (already flagged as a monolith in the JS Refactoring report's Finding 1) must be restructured to interleave with server round-trips rather than operating purely in-memory, a meaningfully different interaction model.

**Recommended Solution**
Do not change this now. Revisit once real row counts approach a threshold (recommend instrumenting actual fetch payload size/duration in production and setting a concrete trigger, e.g. "when jobs exceeds ~2,000 rows or fetch time exceeds ~500ms"). When the time comes, introduce server-side date-range scoping first (the Jobs page is inherently date-grouped already, per JS Refactoring Finding 1's grouping logic), since that's the natural, lowest-risk scoping boundary that matches existing UI structure.

**Files affected**
D:\DEEPFLOW\index.html (Jobs page fetch call), `jobs` table schema

**Estimated difficulty**
Medium-large when eventually undertaken — touches fetch, cache, and filter logic together.

**Estimated performance gain**
None today (7 rows); very high once row counts grow into the thousands+.

---

## Finding 2 — [NOW] `jobs` table was never added to the `supabase_realtime` publication — Realtime is completely non-functional despite a "Live" badge, and this is the most likely real cause of reported freezing

**Current Findings**
Direct SQL query against the live project:
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```
returns **zero rows**. No table in the entire database — not just `jobs` — has ever been added to the `supabase_realtime` publication via `ALTER PUBLICATION supabase_realtime ADD TABLE ...`.

**Problems**
The app's Realtime subscription code (`startRealtimeSync()`/`handleRealtimeChange()`) subscribes to Postgres changes on `jobs` as if Realtime were active, and the UI displays a "Live" badge/indicator based on the subscription successfully being *established* (a WebSocket-level success) — but because the table isn't in the publication, Postgres never actually emits change events to that subscription. The app believes it's receiving live updates and, critically, appears to use that false belief to **disable its own polling fallback**, since a correctly-functioning Realtime connection would make polling redundant.

**Root Cause**
`ALTER PUBLICATION supabase_realtime ADD TABLE jobs` (and equivalent for any other table intended to be live) was never run against this project — a one-time database-configuration step that's easy to miss since Supabase projects don't enable this by default per-table, and the client-side subscription code gives no error when subscribing to a table that isn't published (the subscription itself succeeds; it simply never receives events).

**Evidence**
Live query result (empty set) against `pg_publication_tables` is definitive and was captured directly from the production project, not inferred from code reading alone.

**Impact**
This is flagged as the **most likely real-world explanation for the user's reported "freezing/stuck" symptoms**: any time two people have the Jobs page open at once (e.g. office + another office session, or office + engineer app if it shares this pattern), changes made in one session never arrive in the other via Realtime, and because the UI's polling fallback is suppressed by the false "Live" status, the second session's view simply goes stale and stays stale — indistinguishable, from a user's perspective, from the app "freezing," until a manual full page refresh forces a fresh fetch. This is a database-configuration gap, not a JavaScript performance bug, and would not have been found by reading `index.html` alone — it required a live query against the actual project.

**Risk**
Low to fix the publication itself (`ALTER PUBLICATION supabase_realtime ADD TABLE jobs` is a single, additive, reversible statement) — but the fix should be paired with verifying the client-side "Live" badge logic and polling-fallback-suppression logic actually behave correctly once real events start arriving, since that code path has presumably never been exercised against this project.

**Recommended Solution**
1. Run `ALTER PUBLICATION supabase_realtime ADD TABLE jobs;` against the live project (and any other tables the app assumes are live — `certs`, `invoices` if similarly relied upon).
2. Immediately after, manually test the two-session scenario (two browser sessions, change a job's status in one, confirm the other updates without a manual refresh) before considering this closed.
3. Review `handleRealtimeChange()`'s in-place update logic together with the JS Refactoring report's Finding 3 (dual-cache) and the QA report's BUG-3 (in-place patch silently dropping fields) — once Realtime events actually start flowing, those latent bugs become live for the first time and should be fixed in the same pass, not discovered separately later.

**Files affected**
Supabase project configuration (`supabase_realtime` publication) — no `index.html` code change required for the core fix, though the follow-up review above touches `startRealtimeSync()`/`handleRealtimeChange()` (~line 18742+)

**Estimated difficulty**
Trivial for the SQL fix itself; small-medium for the necessary follow-up verification of dependent client-side logic.

**Estimated performance gain**
High — this is a correctness/functionality fix, not a raw-speed one, but its impact is likely the single biggest lever on the user's *perceived* "freezing/stuck" complaint of anything found across all six reports.

---

## Finding 3 — [POSITIVE] Search/filter is correctly done in-memory; no re-fetch per keystroke

**Current Findings**
Search and filter interactions on the Jobs page operate against the already-fetched in-memory job array, with no network round-trip triggered per keystroke or filter toggle.

**Problems**
None — this is called out explicitly as a positive finding, included so the eventual scalability plan doesn't accidentally "fix" something that isn't broken.

**Root Cause**
N/A.

**Evidence**
No fetch/network call is triggered from the search-input or filter-toggle event handlers; both operate purely against the in-memory array already held by the page.

**Impact**
At current scale, this is part of why search/filter interactions are fast when they work — the architecture choice flagged as a scale risk in Finding 1 is, at 7 rows, actively the *better* choice, not a mistake to be reflexively "fixed."

**Risk**
N/A.

**Recommended Solution**
Preserve this pattern as long as possible; only move filtering server-side (per Finding 1) once/if row counts genuinely require it, and even then consider keeping in-memory filtering for the currently-loaded window rather than abandoning the pattern entirely.

**Files affected**
D:\DEEPFLOW\index.html (search/filter handlers)

**Estimated difficulty**
N/A — no change recommended.

**Estimated performance gain**
N/A — already optimal at current scale.

---

## Finding 4 — [NOW, low severity] `_jobCache` is invalidated on almost every write/navigation event

**Current Findings**
The in-memory `_jobCache` (see also JS Refactoring report's Finding 3) is invalidated — forcing a re-fetch — on a broad set of write and navigation events, more aggressively than strictly necessary for many of them.

**Problems**
Some invalidations discard and re-fetch the entire cache when only a single job's data actually changed, which is unnecessary network/render work even at today's tiny scale, and becomes more costly as row counts grow.

**Root Cause**
A broad "invalidate on any write" policy is simpler to reason about and safer against staleness bugs than fine-grained invalidation, so it was likely chosen for correctness/simplicity at the expense of some avoidable re-fetching.

**Evidence**
Cross-referencing write/navigation event handlers against calls that clear/invalidate `_jobCache` shows several cases where only one job's row data changed but the entire cache is dropped and re-fetched.

**Impact**
Minor today (7 rows means a full re-fetch is cheap regardless); a contributor to unnecessary work at larger scale, and pairs with the JS Refactoring report's Finding 3 (dual-cache consolidation) as something to solve together rather than separately.

**Risk**
Low — this is a targeted-invalidation improvement, not a structural change, once the cache consolidation from JS Refactoring Finding 3 is done first.

**Recommended Solution**
After consolidating to a single cache (JS Refactoring Finding 3), move from "invalidate everything" to "patch the single changed record in place" for single-job writes, reserving full-cache invalidation for genuinely bulk operations.

**Files affected**
D:\DEEPFLOW\index.html (_jobCache invalidation call sites)

**Estimated difficulty**
Small, once sequenced after cache consolidation.

**Estimated performance gain**
Low now; medium at larger scale.

---

## Finding 5 — [NOW, low severity] `quickStatus()` and `updateBadges()` double-fetch on a single status change

**Current Findings**
Changing a job's status via the inline `quickStatus()` path triggers both its own data update and a separate `updateBadges()` call that independently re-fetches data needed to refresh badge counts, rather than sharing the result of a single fetch.

**Problems**
Two network round-trips are made where one would suffice, for what is a very common, frequent user action (changing a job's status is likely one of the single most repeated interactions in the app).

**Root Cause**
`updateBadges()` was likely written as a generic, independently-callable "refresh the badge counts" utility, and `quickStatus()` calls it without also passing along data it already has, rather than threading the already-fetched/updated data through.

**Evidence**
Direct reading of `quickStatus()`'s body shows a call to `updateBadges()` immediately after its own status-update logic, with `updateBadges()`'s own implementation independently querying data rather than accepting it as a parameter.

**Impact**
Doubles the network round-trips for one of the most frequent single actions in the app. At 7 rows the absolute cost is small, but the *frequency* of this specific action (status changes happen constantly in normal use) makes it worth fixing even at today's scale, unlike the purely row-count-driven findings above.

**Risk**
Low — this is a localized change (pass already-available data into `updateBadges()`, or have it accept an optional pre-fetched dataset) that doesn't touch broader architecture.

**Recommended Solution**
Refactor `updateBadges()` to accept optionally-pre-fetched data, and have `quickStatus()` pass through the result of its own update rather than triggering a second independent fetch.

**Files affected**
D:\DEEPFLOW\index.html (quickStatus, updateBadges)

**Estimated difficulty**
Small.

**Estimated performance gain**
Moderate, given how frequently this specific action occurs — one of the better cost-to-effort ratios in this report.

---

## Finding 6 — [LATER] Bulk actions make sequential N+1 calls instead of batching, unlike `bulkSetPriority` which already batches correctly

**Current Findings**
Some bulk-action functions on the Jobs page issue one network call per selected job in sequence, rather than batching into a single request. `bulkSetPriority` is the exception — it already uses `Promise.all`/batching correctly and is cited as the internal example other bulk actions should be brought in line with.

**Problems**
Sequential per-item calls scale linearly (and slowly, due to per-request latency stacking) with the number of selected items, when a batched approach would scale far better.

**Root Cause**
Bulk actions were likely added incrementally, each modeled on a single-item save function looped over a selection, rather than being designed as genuinely bulk operations from the start — except `bulkSetPriority`, which apparently was.

**Evidence**
Direct comparison of `bulkSetPriority`'s implementation (uses `Promise.all` over a batched update) against other bulk-action functions (issue calls inside a sequential loop, awaiting each one before starting the next).

**Impact**
At 7 total rows, even a "worst case" bulk action selecting every row is only 7 sequential calls — not a meaningfully perceptible problem today. Becomes a real UX issue once selections regularly span dozens-to-hundreds of rows.

**Risk**
Low-medium — should be modeled directly on `bulkSetPriority`'s already-working pattern rather than designed from scratch, which reduces risk significantly.

**Recommended Solution**
Bring other bulk-action functions (bulk delete, any future bulk status-change per the UX & Automation report's Finding 3) in line with `bulkSetPriority`'s existing `Promise.all`/batched pattern.

**Files affected**
D:\DEEPFLOW\index.html (bulk-action functions)

**Estimated difficulty**
Small-medium, using bulkSetPriority as a direct template.

**Estimated performance gain**
Low now; high once bulk selections regularly involve many rows.

---

## Finding 7 — [LATER] Existing indexes (`status`, `date`, `engineer`, `postcode`) are unused by the Jobs page's actual query, per Supabase's own Advisor

**Current Findings**
The `jobs` table has indexes on `status`, `date`, `engineer`, and `postcode`, but Supabase's built-in query Advisor flags these as currently unused — consistent with Finding 1's observation that the Jobs page's primary fetch is unscoped (no `WHERE`/`ORDER BY` clause that would let Postgres actually use these indexes).

**Problems**
Indexes that aren't used provide no query benefit while still costing write-time maintenance overhead and storage — today a negligible cost at 7 rows, but the indexes are also simply *dormant* rather than broken: they'll become valuable the moment Finding 1's server-side scoping is introduced.

**Root Cause**
Direct consequence of Finding 1 — the indexes were presumably added in anticipation of scoped queries that don't exist yet in the current unscoped-fetch architecture.

**Evidence**
Supabase Advisor's own unused-index report for the `jobs` table, queried directly against the live project.

**Impact**
None today. This is essentially a "the infrastructure is ready and waiting" finding — good news for when Finding 1's scoped-query work happens, since the necessary indexes won't need to be created from scratch at that point.

**Risk**
N/A — no action needed now.

**Recommended Solution**
No action required today. When Finding 1's server-side scoping is implemented, verify the new scoped queries' `WHERE`/`ORDER BY` clauses actually align with these existing indexes (they likely will, given their column choices) rather than assuming without checking.

**Files affected**
`jobs` table indexes (status, date, engineer, postcode)

**Estimated difficulty**
N/A — no change needed now; verification-only step folded into Finding 1's future work.

**Estimated performance gain**
N/A now; contributes to Finding 1's eventual gain.

---

## Finding 8 — [SECURITY-SENSITIVE, needs careful review before touching] RLS policies on `jobs` re-evaluate auth functions per-row and stack multiple permissive policies

**Current Findings**
The Row Level Security policies on the `jobs` table call auth-related functions (e.g. role/permission checks) in a way that re-evaluates per row rather than once per query, and multiple permissive policies are stacked (each additional permissive policy adds its own evaluation cost, since Postgres RLS OR-combines them).

**Problems**
Per-row auth-function evaluation is a known Postgres RLS performance anti-pattern (the standard fix is wrapping the auth call in a subquery so the planner can evaluate it once), and multiple stacked permissive policies multiply the evaluation cost further.

**Root Cause**
RLS policies were likely added incrementally as new roles/permission cases were introduced (e.g. Finance role's restrictions, referenced in the QA report's BUG-8), each as its own additional permissive policy rather than being consolidated.

**Evidence**
Direct reading of the `jobs` table's RLS policy definitions via Supabase's policy inspection, showing per-row auth function calls and multiple separate permissive policies rather than one consolidated policy per operation.

**Impact**
At 7 rows, the per-row cost is invisible. At scale, this compounds directly with Finding 1 (unscoped fetch) — every one of potentially thousands of unscoped rows would pay this RLS evaluation cost on every query, making this a multiplier on Finding 1's eventual impact rather than an independent issue.

**Risk**
**This finding is explicitly flagged as security-sensitive and needs careful, deliberate review before any change is made** — RLS policies are the actual enforcement boundary for who can see/edit what data (directly relevant to the QA report's BUG-8, where the Finance role's read-only restriction was found to be enforced only in the UI, not the database). Any consolidation of these policies must be verified not to accidentally widen access, not just optimized for speed. This should be reviewed together with the eventual Security synthesis report before any SQL is changed.

**Recommended Solution**
Do not modify RLS policies as a pure performance optimization in isolation. When this is tackled, do it as a combined security-correctness-and-performance pass: consolidate stacked permissive policies into fewer, well-tested policies per operation, wrap auth-function calls in subqueries per Postgres's documented RLS performance guidance, and — critically — use this as the opportunity to also close the QA report's BUG-8 gap (Finance role restrictions not actually enforced at the database level) in the same reviewed change, rather than fixing performance and security separately.

**Files affected**
`jobs` table RLS policies (Supabase policy definitions, not index.html)

**Estimated difficulty**
Medium-large — requires careful security review, not just a performance-only change.

**Estimated performance gain**
Low now; meaningful once combined with Finding 1's scoped queries at real scale.

---

## Finding 9 — [POSITIVE] `next_job_num` RPC usage is efficient, no issue found

**Current Findings**
The atomic job-numbering RPC (`next_job_num`, built earlier this engagement using a Postgres sequence + SECURITY DEFINER function) is called efficiently by the job-creation path with no redundant calls or inefficient usage patterns.

**Problems**
None.

**Root Cause**
N/A.

**Evidence**
Direct reading of the job-creation code path's call to the numbering RPC shows a single, correctly-scoped call per job creation.

**Impact**
None — positive finding, confirming this earlier piece of work remains sound under this fresh audit.

**Risk**
N/A.

**Recommended Solution**
No action needed.

**Files affected**
N/A

**Estimated difficulty**
N/A

**Estimated performance gain**
N/A

---

## Priority ranking for remediation

1. **Finding 2** ([NOW] empty Realtime publication) — highest priority in this entire report; strong candidate for the actual root cause of the "freezing/stuck" complaint that motivated the whole task force. Trivial to fix, needs careful post-fix verification.
2. **Finding 5** ([NOW] quickStatus double-fetch) — cheap fix, high-frequency action, worth doing regardless of scale.
3. **Finding 8** (RLS per-row evaluation + stacked policies) — security-sensitive, must be reviewed jointly with the Security synthesis, not rushed.
4. **Finding 4** (aggressive cache invalidation) — small win, sequence with JS Refactoring's cache consolidation.
5. **Finding 1, 6, 7** ([LATER] unscoped fetch, sequential bulk calls, dormant indexes) — real gaps, but explicitly not urgent at 7 live rows; schedule deliberately against actual growth, not speculatively.
6. **Finding 3, 9** — positive findings; preserve as-is.
