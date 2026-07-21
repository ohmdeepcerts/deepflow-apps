# CTO Scalability Estimate — Jobs Page — DeepFlow

**Purpose:** The original brief's final goal was responsiveness at "hundreds of thousands of records." The live database has **7 job rows today.** This document is deliberately honest about that gap: it explains what breaks, at what row count, and why — grounded entirely in the Rendering & Memory and Data Layer reports' direct findings, not speculation. It is not a recommendation to build for 500K rows now; it's the information needed to make that call deliberately instead of by accident.

---

## The two mechanisms that actually determine the ceiling

Everything in this estimate reduces to two facts, both confirmed by direct code reading against `renderJobs()`:

1. **No server-side query scoping.** The Jobs page fetches the *entire* `jobs` table client-side and filters/sorts in memory (Data Layer Finding 1). The default view (`_jRange='all'`) applies no bound at all (Rendering & Memory Finding 3).
2. **No DOM virtualization.** Every job that survives the filter gets ~37-40 real DOM elements, built fresh on every render, with no windowing/recycling (Rendering & Memory Finding 3).

Both are currently *correct* architectural choices at low row counts — the Data Layer report explicitly flags in-memory filtering as a **positive finding** (Finding 3) precisely because it avoids network round-trips per keystroke, which is the faster approach until the data itself becomes the bottleneck. The estimate below is about identifying that crossover point, not condemning the current design.

---

## Row-count-by-row-count breakdown

### ~7 rows (today's live reality)
No part of this is measurable. Full fetch: instant. Full DOM rebuild: ~280 nodes, sub-millisecond. This is why none of the six reports found any row-count-driven symptom actually reproducing today — **the "gets stuck / freezes" complaint that started this whole initiative is not caused by data volume at all** (see the Release Plan document for what the task force believes actually causes it).

### ~1,000 rows
Fetch payload: still small (low hundreds of KB depending on field sizes), sub-second on any reasonable connection. DOM rebuild: ~1,000 × ~40 ≈ 40,000 nodes per full render. This is the first point where a full re-render (every search keystroke, every filter toggle) becomes *perceptible* — not broken, but no longer instant. `attachJobTooltips()`'s per-render `document.querySelectorAll` + 6 listeners/row (Rendering & Memory Finding 2) adds up to 6,000 `addEventListener` calls per render at this point, still cheap individually but no longer free in aggregate.

### ~10,000 rows
Fetch: multi-second, multi-hundred-KB to low-MB payload on every page load and every cache invalidation (Data Layer Finding 4's aggressive invalidation policy means this happens often). DOM rebuild: ~400,000 nodes per full render — this is the range where a full re-render on every keystroke becomes the dominant, obviously-felt lag, matching the "delayed filtering/searching" language in the original brief. This is realistically **1-3 years of normal operating history** for a small compliance/electrical business doing a handful of jobs per working day — not a hypothetical, an eventual certainty if the business keeps operating and nothing changes architecturally.

### ~50,000 rows
Fetch: tens of seconds to load the full table on a cold cache; likely to hit browser memory pressure holding the full unfiltered array (`allJobs`) plus both parallel caches (`_jobCache` and `_jobRowData`, both full-table copies per Rendering & Memory Finding 4 / JS Refactoring Finding 3 / Data Layer Finding 4 — this is the point where the "two independent full copies" design choice stops being free). DOM rebuild at this scale (2,000,000 nodes) would very likely hang the tab's main thread for multiple seconds on a single keystroke — this is past "slow," into "looks frozen," which is a literal, not approximate, match for the original bug report's language.

### ~100,000+ rows
The current architecture does not function at this scale in any meaningful sense — full-table fetch and full-DOM-rebuild are fundamentally O(n) operations with no bound, and n has grown past what either the network or the DOM can absorb synchronously. This is not a "slower" version of the current app; it requires the structural changes below before the page would load at all in a reasonable time.

### 250,000 – 500,000+ rows
Same conclusion as 100,000+, more severely. Not included as a separate tier because nothing new is learned past the point where the current architecture has already fully broken down — the fix required is identical, just more urgently needed.

---

## What actually has to change, and at what row count each becomes necessary

| Fix | Addresses | Necessary starting around | Report source |
|---|---|---|---|
| Fix the `_dragInited` listener leak | Correctness + responsiveness bug that's already live at 7 rows | **Now, regardless of scale** | Rendering & Memory Finding 1 |
| Cap the default view (`_jRange` default away from `'all'`) | Prevents the worst case (unbounded render) cheaply | ~1,000-2,000 rows | Rendering & Memory Finding 3 |
| Server-side date-range/status query scoping | Removes full-table fetch cost | ~2,000-5,000 rows (recommended trigger: instrument real fetch time/payload size and act at ~500ms) | Data Layer Finding 1 |
| Consolidate `_jobCache`/`_jobRowData` into one backing store | Halves steady-state memory footprint; must preserve drag-drop's poll-immunity guarantee | Worth doing alongside the query-scoping work, not before | Rendering & Memory Finding 4, JS Refactoring Finding 3 |
| DOM virtualization / windowed rendering | The actual ceiling-breaker; without this, no row-count fix elsewhere prevents the multi-second freeze at ~50K+ | ~10,000-20,000 rows | Rendering & Memory Finding 3 |
| RLS query-plan optimization (subquery-wrapped auth calls, consolidated policies) | Makes server-side scoping actually fast once introduced, not just present | Same time as query scoping | Data Layer Finding 8 |

The ordering above is deliberate: **query scoping without virtualization just moves the bottleneck from "fetch" to "render"** — at 10K+ rows, even a perfectly scoped query returning, say, "last 90 days" could still return thousands of rows in a busy period, and those still each cost ~40 DOM nodes on render. Virtualization is the one fix with no natural substitute; everything else buys time before it's needed.

---

## Recommendation

Do not build for 500,000 rows now. Build the trigger, not the destination:

1. Fix the drag-listener leak immediately — it's free, low-risk, and already causing real problems at today's scale.
2. Instrument actual production fetch time and rendered-row count (a few lines of logging, not a project) so the "~1,000-2,000 rows" and "~10,000 rows" thresholds above are measured against this specific business's real growth curve, not estimated in the abstract.
3. Treat query-scoping and virtualization as scheduled work triggered by that instrumentation crossing defined thresholds — not urgent today, not ignored indefinitely either.

This keeps effort proportional to the business's actual size (7 rows today) while making sure nobody has to rediscover this analysis from scratch when the business has genuinely grown enough for it to matter.
