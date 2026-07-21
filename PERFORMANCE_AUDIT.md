# DeepFlow — Performance Audit

A dedicated performance review of all three applications. Every finding below is backed by something directly measured in the source (a count, a file size, a specific function) — not a general guess about what "might" be slow. No code was modified while producing this document.

**Important framing up front:** per the Database Handbook, this project's live data is currently tiny (single-digit to low-double-digit rows in most tables). **Almost nothing in this document is a performance problem *today*.** Every finding here is about what will start to hurt as the business's real data grows — this is a forward-looking audit, not a report of a system currently struggling.

---

## 1. Slow Pages (or: pages that will become slow first)

Ranked by how much work they do relative to how the app currently loads data (Section 6 explains the "no shared cache" mechanism behind why these are especially exposed):

| Page/Feature | Why it's exposed |
|---|---|
| **Command Palette (global search)** | The most acute issue in the whole app — see Finding 6.1. Currently fires a burst of full-table fetches on every keystroke; this gets worse, not better, as `jobs`/`invoices`/`persons`/`expenses`/`certs` grow, since each keystroke fetches *all* current rows of all five tables. |
| **P&L Dashboard** | Loads the full `jobs`, `invoices`, `expenses`, and `payments` tables (not scoped to the selected period at the database level — the period filter is applied client-side, after everything is downloaded), then runs six separate aggregation passes (Overview, Cash Flow, Top Clients, Job Types, VAT, Reminders) over that same in-memory data. |
| **Engineer Reports (ranking/leaderboard view)** | Computes full statistics for *every* engineer, from the *entire* jobs/invoices/certs history, every time the screen is opened — there is no per-engineer lazy loading; the ranking table needs everyone's numbers before it can sort and display any of them. |
| **Client View (360°)** | Fetches five full tables in parallel (`jobs`, `invoices`, `certs`, `payments`, `agents`) for every single lookup, even though only a handful of rows in each table will actually belong to the one client being viewed — the filtering down to "this one client" happens after the full download, not as part of the request. |
| **Certificates Dashboard** | Loads the entire `certs` table to compute dashboard summary tiles, then loads it again (a separate `dAll('certs')` call) for the actual table/list view a moment later on the same screen, per the redundant-call pattern in Finding 6.2. |
| **Jobs screen search/filter** | Comparatively well-built — has a proper 200ms typing debounce and searches against an already-cached in-memory list rather than re-querying the database on every keystroke (this is the pattern the Command Palette above should have copied, and didn't). |

---

## 2. Large Scripts

| File | Size | Lines | Notes |
|---|---|---|---|
| `index.html` / `office.html` | 1.31 MB (each) | 22,809 | One single inline `<script>` block contains effectively the entire Office application's logic — every feature, every screen, every helper function, all parsed and evaluated by the browser before anything can run. |
| `engineer.html` | 209 KB | 3,682 | Smaller, but still one monolithic script covering login, job management, photo pipeline, GPS, three electrical calculators, and mapping — all loaded regardless of which of those a given engineer actually uses that day. |
| `client-portal.html` | 140 KB | 2,061 | Smallest of the three, same single-script pattern. |

- **No code-splitting is possible in the current architecture.** Because there's no build tool (Architecture document, Section 3), there's no mechanism to load only "the Jobs screen's code" or "the electrical calculators' code" on demand — every byte of every feature ships on every page load, whether that user ever touches that feature or not.
- **No minification.** The source is shipped exactly as written — readable variable names, comments, and formatting all included in what the browser downloads (mitigated somewhat in practice by standard HTTP gzip/brotli compression during transfer, which text like this compresses well, but the browser still has to parse and hold the full, uncompressed source in memory once received).
- **`office.html` and `index.html` are byte-identical** (Architecture document) — meaning this 1.31MB payload is hosted and would be cached **twice**, as two entirely separate files, for zero functional benefit.

---

## 3. Repeated Code (performance-relevant instances)

Beyond the general code-quality duplication already catalogued in the earlier software Audit (the copy-pasted Supabase connection layer across all three apps, and the 7-times-repeated CSS block in `engineer.html`), two further instances specifically matter for performance/consistency:

### 3.1 — The same status-colour mapping is defined separately, in at least two places, with different values
`index.html` line ~10514 defines `_statusColors` for invoice status badges as `{'Awaiting Payment': '#3b82f6', ...}` (blue); a second, separate definition at line ~11905 defines what is meant to be the same mapping as `{'Awaiting Payment': '#f59e0b', ...}` (amber) — **these have actually drifted apart**, not just been duplicated identically. Depending on which rendering code path a given screen uses, the same invoice status can appear as a different colour in different parts of the app. This is exactly the kind of inconsistency that duplicated-instead-of-shared logic tends to produce over time.

### 3.2 — Inline styling repeated at massive scale instead of CSS classes
**2,308 separate `style="..."` inline-style attributes** were counted directly in `index.html`'s source — the large majority generated dynamically, per-row/per-card, inside JavaScript template strings (e.g. every KPI tile, every directory card, every P&L row rebuilds its full inline style string from scratch, in full, every single time it renders), rather than applying a reusable CSS class. This inflates the size of every generated HTML string, the size of the resulting DOM (each element carries its own full style declaration rather than sharing one class rule the browser can compute once), and the amount of JavaScript string-building work done on every re-render.

---

## 4. Heavy DOM Operations

- **Full-table re-renders via `innerHTML` replacement** are the standard rendering pattern throughout this app (Architecture document, Section 3) — there is no virtual DOM, no diffing, and (outside the one Realtime-driven single-row-patch optimisation on the Jobs screen, Business Rules document Section 7.3) no partial-update mechanism anywhere else. Every other screen redraw discards and rebuilds its entire visible section from scratch, even if only one value actually changed.
- **No virtualization/windowing on any list.** The Jobs table, invoice lists, certificate tables, directory card grids, and the P&L's client-ranking list all render every matching row into the DOM at once. At the project's current small scale this is invisible; a jobs table showing, say, several thousand historical rows (a wide date range, or a "show all" / search view rather than a single day) would build and hold that many DOM nodes simultaneously, with no offscreen-row recycling.
- **Large HTML strings built via chained `.map(...).join('')`** are the standard pattern for every list/table/card-grid render — functionally fine, but for large arrays this means holding one very large string in memory before the single `innerHTML` assignment that follows it, rather than incrementally appending nodes.

---

## 5. Poor Rendering (rendering-specific inefficiencies, distinct from "heavy DOM" above)

- **Client-side, on-the-fly recomputation of values that don't change between renders.** Invoice totals (`calcInvTotal`), star ratings (`_calcClientStars`), and P&L aggregates are all recalculated from raw data every time a screen renders, rather than being cached/memoised even within a single page session — for example, opening the same client's profile twice in a row recomputes their entire star rating from their full invoice history both times, from the same underlying data, because no result caching exists anywhere in this codebase.
- **Inline `onmouseover`/`onmouseout` handlers that manually toggle a style property** are used for hover effects throughout the generated HTML (e.g. `onmouseover="this.style.background='var(--s2)'"`), instead of a CSS `:hover` rule — functionally equivalent for the user, but it means every hoverable row/card carries extra inline JavaScript-attribute overhead that a plain CSS rule would handle for free, at the browser's own optimised rendering layer, without any per-element JS execution at all.
- **No `requestAnimationFrame`-batched or debounced resize handling was confirmed for every canvas-based animation** (the login-screen network animation, the client-portal hero canvas) — these do rebuild their internal point/star arrays on a `resize` listener, which is correct, but whether that specific handler is itself debounced against rapid resize events (e.g. dragging a window edge) was not confirmed either way for every instance.

---

## 6. Unnecessary API Calls

### 6.1 — The Command Palette has no debounce and re-fetches five entire tables on every keystroke — the single largest concrete finding in this audit
Already identified in the earlier software Audit (Section 9.1), restated here in full because it belongs squarely in a performance review: the job-search box has a 200ms debounce; the command-palette search box does not. Once a typed query passes one character, every keystroke independently triggers `await dAll('jobs')`, `dAll('persons')`, `dAll('invoices')`, `dAll('expenses')`, and `dAll('certs')` — five full-table downloads — with no cancellation of the previous, now-outdated request already in flight. A ten-character search fires on the order of 40+ full-table network round-trips in a few seconds, several of them overlapping and racing each other.

### 6.2 — No caching layer for anything except jobs
Counted directly: `dAll('invoices')` is called **59 separate times** across `index.html`; `dAll('jobs')` **57 times**; `dAll('certs')` **31 times**; `dAll('persons')` **27 times**; `dAll('agencies')` **17**; `dAll('payments')` **15**; `dAll('agents')` **13**; `dAll('expenses')` **10**. Jobs specifically have a dedicated in-memory cache (`_getJobs()`/`_jobCache`, explicitly invalidated on writes and Realtime events — Synchronization document, Section 7.4) — **no equivalent cache exists for any other table.** Every one of the other 172 calls is an independent, fresh network request, even when the exact same full table was already downloaded moments earlier by an adjacent feature on the same screen (Finding 1's Certificates Dashboard double-load is one direct example of this in practice, not just a theoretical one).

### 6.3 — Settings are always re-saved in full
Already covered in the earlier software Audit (Section 9.3): because every setting lives in one JSON blob, changing a single toggle re-sends the *entire* configuration object (company details, every certificate type, every WhatsApp template, the whole properties list) as one write, every time, rather than a small, targeted update.

### 6.4 — Polling continues even when nothing is happening
The Office app's 5-second polling fallback (used only when Realtime is disconnected) and the Engineer app's 30-second job poll and 15-second alert poll all run on fixed timers regardless of whether the user is actively looking at a relevant screen — for example, the Engineer app's alert poll keeps running every 15 seconds even while the user is deep in the electrical calculators tab, where a new alert wouldn't be shown differently than if it arrived a few seconds later.

---

## 7. Slow SQL (and, more precisely, a lack of server-side filtering at all)

Framed carefully: this project has almost no traditional "slow query" risk in the classic sense, because — as Finding 6 already shows — **most of the app doesn't ask the database to filter anything in the first place.** It downloads full tables and filters them in the browser instead. This has a different, but related, performance cost profile:

- **No confirmed indexes exist beyond one** (Database Handbook, Section 6) — the SQL documented in the app's own admin panel includes exactly one `CREATE INDEX` statement, for the optional certificate-reminder feature, and no others were found anywhere in the codebase for the columns this system actually searches/filters on most (`jobs.address`, `jobs.engineer`, `persons.name`, `persons.phone`, invoice client names).
- **Case-insensitive text searches (`ilike`) are used throughout** (e.g. the Engineer app's job-list queries, `engineer=ilike.<name>`) — a plain B-tree index (the default kind) does not accelerate `ILIKE` pattern searches efficiently; that would need either a functional index on the lower-cased column or a trigram (`pg_trgm`) index, neither of which was found documented or evidenced anywhere.
- **The `dAll()` pagination approach fetches every row of a table, 1,000 at a time, up to a 50,000-row safety cap**, regardless of how many rows the calling feature actually needs — a screen that only wants "this one client's 12 jobs" still triggers the same full-table download machinery as a screen that genuinely needs everything.
- **Client-side text filtering happening entirely in JavaScript, after the full download**, is functionally "search," but is the slowest possible way to implement it once a table grows past a small size — it does not benefit from an index at all, no matter how well-indexed the underlying columns are, because the filtering step never reaches the database.

---

## 8. Storage Inefficiencies

- **No thumbnail/preview generation.** Every photo, once uploaded, is compressed once to a maximum of 1200px (Business Rules document, Section 12.1) — but that same 1200px file is what gets downloaded and displayed **even in small thumbnail-grid contexts** (e.g. a 3-column photo grid on the Engineer app's job detail, or a small preview tile on the Office app), where a genuinely small thumbnail (e.g. 150–300px) would be visually indistinguishable but a small fraction of the data transferred.
- **No cleanup of orphaned files.** Per the earlier software Audit (Section 14.1), deleting a job does not delete its Storage files — they remain in the bucket, permanently, contributing to storage cost and to the size of every future "list everything in this bucket" operation (including the app's own admin Storage Usage dashboard), with no expiry, archival, or cleanup mechanism found anywhere.
- **"HD mode" uploads skip compression entirely, not partially.** The upload code's compression step is a single `if(!_uploadHD)` gate — when HD mode is on, the *original, unmodified camera file* is uploaded as-is, with no resizing and no re-encoding at all, rather than, say, compressing to a higher-but-still-bounded quality/resolution. A modern phone photo in this mode can be several megabytes; taken repeatedly across many jobs, this has a direct, uncapped, compounding effect on both Storage cost and how long each such upload takes on a poor mobile connection.
- **No lifecycle policy or archival tier** was found configured or referenced anywhere — every file, from the very first test upload onward, is expected to live in the same "hot" storage tier indefinitely.

---

## 9. Large Images

- **The compression ceiling (1200px, 80% quality) is a reasonable default for normal viewing**, but — per Finding 8 — is entirely bypassed by the HD toggle, and is not further reduced for the smaller contexts (thumbnails) it's frequently displayed in.
- **The visible watermark stamp is drawn using the browser's `<canvas>` at full image resolution** before the final compression/encoding step — this is correct for image quality, but means the stamping step itself is doing full-resolution pixel work on every photo, on the engineer's own device, which is where any performance cost of this step is actually felt (a slower/older phone would notice this most).
- **No responsive image delivery** (e.g. serving a smaller variant to a smaller viewport, or using `srcset`) was found anywhere — the same single stored file is what every consumer (Office desktop screen, Engineer phone screen, Client Portal on any device) downloads, regardless of how large that consumer actually intends to display it.

---

## 10. Unused Assets

- **`jsPDF` and `jsPDF-AutoTable` are loaded unconditionally, on every single page load**, in both `index.html` and `client-portal.html` — for every visit where the user never once clicks "Download PDF" during that session (the majority of visits, most likely), this is pure dead weight downloaded and parsed for nothing.
- **The Lucide icon library is loaded in full on every Client Portal page load**, regardless of how many of its icons that specific page actually renders.
- **Multiple font weights are requested per app that may not all be used.** For example, `index.html` requests "Familjen Grotesk" in five weight/style combinations and "JetBrains Mono" in four weights; `engineer.html` requests "DM Sans" in six weights, plus "JetBrains Mono" in two more weights, plus "Orbitron" in two weights. Whether every one of these specific weights is actually used somewhere in each app's CSS was not exhaustively cross-referenced line-by-line, but requesting a wide spread of weights "to be safe" — a common pattern in hand-written CSS without a build step to prune what's unused — is a very plausible source of a few genuinely unused font-file downloads per app.
- **`office.html`, in its entirety, is an unused (duplicate) asset.** It is not a different version or a fallback — it is a second, complete, 1.31MB copy of `index.html`, byte-for-byte, serving no purpose that a URL redirect/alias couldn't achieve for a fraction of the hosting and cache footprint.

---

## 11. Suggested Improvements

Ranked by impact relative to effort, since this review — like the security audit — was specifically asked to suggest improvements (no code was changed; these are recommendations only).

### High impact, low effort

1. **Add the same debounce pattern already used for job search (`debounceRenderJobs`, 200ms) to the Command Palette's input handler.** This alone would eliminate the single largest source of unnecessary network traffic in the entire application, with a well-understood, already-proven-in-this-codebase technique.
2. **Cancel/ignore stale in-flight command-palette searches** when a newer keystroke supersedes them (e.g. tracking a request ID/token and discarding results that arrive after a newer search has started) — reduces wasted work further, especially important once the debounce above is in place but a user is still typing quickly.
3. **Stop hosting `office.html` as a separate file** — serve it as a redirect/alias to `index.html` at the hosting layer instead, halving that portion of the deployed footprint for zero loss of functionality.

### Medium impact, medium effort

4. **Introduce a small, shared in-memory cache (with the same explicit invalidate-on-write pattern already used for jobs) for `invoices`, `persons`, `certs`, `agencies`, `agents`, `payments`, and `expenses`.** Given `dAll()` is already the single, unified access point for every table, this could plausibly be added at that one layer rather than needing to touch every one of the 172 individual call sites separately.
5. **Scope heavy reporting screens (P&L, Engineer Reports, Client View) to fetch only what they need**, where the database can help — for example, filtering jobs/invoices to the selected date range as part of the request itself, rather than downloading the full table and filtering client-side afterward.
6. **Consolidate the duplicated status-colour maps (Finding 3.1) into one shared constant**, which also resolves the colour-inconsistency bug that duplication has already caused.
7. **Reduce the requested font-weight list per app to only the weights actually used in each file's CSS**, and audit whether `jsPDF`/`jsPDF-AutoTable`/Lucide could be loaded only at the moment a PDF/icon-heavy feature is actually invoked, rather than on every page load — both straightforward, given no build tooling is required to simply move a `<script>` tag or trim a Google Fonts URL parameter.

### Longer-term / structural

8. **Add a smaller, second compressed variant specifically for thumbnail contexts**, generated at the same upload-time step that already produces the main compressed image — avoids the cost of building a separate image-processing pipeline later, since the compression code already exists and runs at upload time regardless.
9. **Cap or better-explain the "HD" upload mode** — even a generous but real ceiling (e.g. 2500px instead of no limit at all) would bound the worst case while still meaningfully improving on the current default for anyone who genuinely needs higher quality.
10. **Introduce a periodic or on-demand cleanup pass for orphaned Storage files** (files whose `attachments` row, or whose job entirely, no longer exists) — directly reduces both storage cost and the size of every future storage-listing operation.
11. **If/when this project ever adopts a build step for other reasons** (e.g. as part of addressing the code-duplication findings from the earlier software Audit), minification and code-splitting would both become available "for free" as a side effect, meaningfully reducing the 1.3MB/209KB/140KB figures in Section 2 for first-time visitors.
12. **Reduce the very high inline-`style=` count** (Finding 3.2) by moving the most frequently-repeated style patterns (KPI tiles, directory cards, table rows) into real CSS classes — reduces both the size of every generated HTML string and the size of the resulting DOM.

---

*This audit is a static review of the application source, cross-referenced against the live project's currently-small data scale (Database Handbook, Section 0). It intentionally does not include a dynamic performance trace (e.g. actual browser profiling, Lighthouse scores, or real network waterfalls under load) — those would be the natural next step to validate and prioritise these findings against real, measured numbers once the tooling to run them is available. No code was modified in the process of producing this document.*
