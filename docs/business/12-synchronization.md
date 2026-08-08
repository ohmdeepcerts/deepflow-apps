# 12 — Synchronization

How data actually stays consistent across `apps/office`, `apps/engineer`, and `apps/portal` while they
share one live Postgres database with no application server in between. This is the business-level
view — the worked "who sees what, and when" story — not a repeat of
[`docs/architecture/06-supabase.md` §6](../architecture/06-supabase.md#6-realtime), which already
covers the Realtime subscription and its publication requirement at the platform-config level. That
document confirms exactly one live `.channel()` subscription exists anywhere in the codebase — `public.jobs`,
Office only. This document starts from that fact and traces what actually happens around it: the
in-place DOM update path, the polling fallback and its real interval, how the other two apps stay
fresh without any subscription at all, the offline write queue, where (if anywhere) the UI updates
before the server confirms, and a worked trace of the two-stage completion handoff from
[`11-workflows.md`](11-workflows.md) through every layer that has to independently notice it.

**Methodology:** every claim below was checked directly against the current application source —
`apps/office/main.js`, `apps/office/audit.js`, `apps/engineer/main.js`, `apps/portal/main.js`,
`packages/offline/queue.js`, and `packages/data/repository.js` — by reading the actual function
bodies at the cited lines, not by inferring behavior from naming or from `06-supabase.md`'s
platform-level summary. Two findings below (§3.1, §6.4) directly correct claims made in
`docs/architecture/05-database.md` §3.17 and repeated in `06-supabase.md` §7 — both are called out
explicitly, with the exact source that overturns them, rather than silently preferred. Line numbers
are accurate as of commit `9604cdb` (2026-08-06) plus the `send-push` recovery commit `57ac519`
immediately after it; treat the named function as the durable anchor as the files drift.

---

## 0. The picture in one table

| App | Live push? | Fallback / primary freshness mechanism | Offline write queue? | Optimistic UI? |
|---|---|---|---|---|
| Office | Yes — `public.jobs` only | 5s sentinel poll when Realtime is down | Yes (`df_office_offline_queue`) | A few specific spots (§5), not the default |
| Engineer | No | 30s poll while tab visible, plus a manual refresh button | Yes (`df_eng_offline_queue`) | No — every write awaits the server (or queue) before updating local state |
| Portal | No (opt-in Web Push only, §3.1) | Reload the link — no background refresh of jobs/certs/invoices at all | No — no `createOfflineQueue` import anywhere under `apps/portal` | No — one write-then-`location.reload()` pattern (PIN set/verify) |

The rest of this document is the evidence for each cell.

---

## 1. Realtime, traced end to end (Office, `public.jobs` only)

`startRealtimeSync()` (`apps/office/main.js:10752`) opens exactly one channel, `jobs-realtime`,
subscribed to `event:'*'` on `public.jobs`. It's called twice — once after a fresh password login
(`main.js:1462`) and once after a restored session on page load (`main.js:12941`) — never re-called on
`visibilitychange`; reconnection after a drop is handled entirely by the retry logic below, not by
tab-focus events.

### 1.1 What another user's change looks like on screen

`handleRealtimeChange(payload)` (`main.js:10786`) branches on `eventType`:

- **INSERT** (`main.js:10789-10806`) — pushes the new row into `_jobRowData` and `_jobCache` (guarded
  against double-adding a job *this* session just created itself — the comment at `main.js:10793-10797`
  explains that without the guard, the Realtime echo of your own INSERT would duplicate the row you
  already added optimistically via `saveJob()`), fires a `_pushNotif('New job added', ...)` regardless
  of what page is open, and only calls `renderJobs()` — the actual visible re-render — if the Jobs page
  is the active page (`document.getElementById('pg-jobs').classList.contains('active')`).
- **DELETE** (`main.js:10808-10823`) — removes the row from both caches and, if its `<tr>` is currently
  in the DOM, fades and slides it out (`opacity:0`, `translateX(-20px)`, 300ms) before removing it —
  a real animated removal, not a silent disappearance.
- **UPDATE** (`main.js:10825-10884`) — this is the interesting one:
  - **If the job is open in *this* session's edit modal** (`editJid===id`, `main.js:10838-10844`): the
    incoming change is **not** applied to the open form at all. Instead a warning toast fires
    ("⚠️ This job was updated by another user. Save carefully to avoid overwriting their changes.")
    and the modal's border flashes amber (`box-shadow`, 3s) — this is the "real conflict-resolution
    warning" business-rules §1.8 refers to. The office user's in-progress edits are never silently
    clobbered by someone else's write, but they're also not merged — it's a heads-up, not a resolution.
  - **Otherwise**, `getChangedFields(prev, curr)` (`main.js:10888-10898`) diffs the old and new row
    across a fixed field list (`status, priority, date, engineer, timeSlot, address, price,
    description, jobNum, _sortOrder`). If nothing in that list changed, nothing re-renders at all —
    a `modified` timestamp bump alone produces no visible flicker.
  - **Small changes update in place, not via a full re-render.** If 3 or fewer tracked fields changed
    and `date` isn't one of them, `updateRowInPlace()` (`main.js:10901-…`) patches just that row's DOM
    — status stripe class, priority CSS class with a brief inset-shadow flash, the status dropdown,
    etc. — without touching the rest of the list or the scroll position. `date` is excluded from the
    in-place path on purpose: a date change moves the row to a different date-grouped section of the
    list, which an in-place patch can't do correctly, so it always falls through to a full,
    scroll-position-preserving `renderJobs()` instead.
  - **A change outside the field list, or too many fields at once, also falls back to a full
    re-render.** `updateRowInPlace()`'s own `HANDLED` list (`main.js:10907`) is narrower than
    `getChangedFields()`'s tracked-field list — anything tracked but not in `HANDLED` (e.g. `jobNum`,
    `_sortOrder`) forces the scroll-preserving full re-render path rather than silently doing nothing.
    The comment at `main.js:10902-10906` states this was a deliberate safety net: silently dropping an
    unhandled field from the screen is exactly the bug this fallback exists to prevent.
  - A status or priority change also fires a desktop-style in-app notification
    (`_pushNotif`, `main.js:10869-10883`) with status-specific phrasing — `"Engineer arrived —
    <name>"` for `In Progress`, `"Engineer completed & left — needs review — <name>"` for
    `Engineer Completed`, `"Job finalized"` for `Completed` — **regardless of which page is currently
    open**, same as the INSERT case.

**Net effect:** an Office user sees another Office user's (or an engineer's) change appear as a quiet
in-place row update within about a second, with no full-page flash, *if* they're on the Jobs page —
and gets a notification either way. If they're on a different page when the change arrives, the
underlying cache (`_jobRowData`/`_jobCache`) is already updated by the time they navigate to Jobs, so
the next `renderJobs()` call shows the fresh data immediately, with no extra fetch required.

### 1.2 Connection loss — the real fallback, not a guess

`startRealtimeSync()`'s `.subscribe()` callback (`main.js:10765-10782`) handles two states:

- **`SUBSCRIBED`** — sets `_rtConnected=true`, shows a "Real-time" live badge, and stops the polling
  interval if one happens to be running (`clearInterval(_notifPollInterval)`).
- **`CLOSED` / `CHANNEL_ERROR`** — sets `_rtConnected=false`, shows a "Reconnecting…" badge, calls
  `startLivePoll()` immediately (§2 below — polling starts within the same tick, not after a delay),
  and schedules a reconnect attempt via `setTimeout(startRealtimeSync, 10000)` — **exactly 10 seconds**,
  confirmed at `main.js:10780`. If that reconnect also fails, the same `CLOSED`/`CHANNEL_ERROR` branch
  fires again and schedules another 10-second retry — an indefinite retry loop, not a fixed number of
  attempts.

---

## 2. Office's polling fallback — the real interval and what it actually checks

`startLivePoll()` (`main.js:10659-10675`) is not a naive "just re-fetch everything" loop. It seeds
three lightweight sentinels once (most-recently-modified job's `modified` timestamp, total job count,
and the latest `engineer_requests.created` timestamp), then runs `_pollTick()` on a
**5-second interval** (`setInterval(_pollTick, 5000)`, `main.js:10674`) — confirmed, not the 20s+
interval used by other polling loops in this codebase (§4).

Each tick (`main.js:10677-10741`):
1. Bails immediately if Realtime is actually connected (`if(_rtConnected) return;`, `main.js:10678`) —
   this function keeps running on its interval the whole time Realtime is up, it just no-ops every
   tick, so there's no separate "stop polling" call needed when Realtime reconnects.
2. Fetches **one row, two columns** — `jobs?select=modified,created&order=modified.desc&limit=1` —
   plus a count-only `jobs?select=id` for the row count. Only if the sentinel's `modified` value is
   newer than last seen, or the count grew, does it do the expensive part: fetch the actual changed
   rows (`jobs?modified=gt.<since>&limit=50`) and diff each one against `_pollKnownJobs` to decide
   "new job" vs. "status changed," firing the same `_pushNotif()` calls Realtime would have fired.
3. Separately polls `engineer_requests` (limit 50, newest first) every tick to update the request-badge
   count and notify on genuinely new requests.
4. Invalidates the job cache (`_invalidateJobCache()`) whenever it detects a change, so the next render
   picks up fresh data rather than the 5-minute-TTL cache (§6.2).

So the practical answer to "what's the poll interval" is **5 seconds for the sentinel check**, with
the actual row-level diff only happening on top of that when the sentinel says something changed —
not a flat "re-fetch every 5 seconds" cost.

---

## 3. How Engineer and Portal stay fresh without Realtime

Neither app has a `.channel(` call anywhere (confirmed by the same grep `06-supabase.md` ran) — both
rely entirely on polling, refresh-on-focus, and manual refresh, and each does this differently.

### 3.0 Engineer App

- **Background poll while the tab is visible:** `setInterval(()=>{if(currentUser&&
  document.visibilityState!=='hidden'){loadJobs();checkBroadcastAlerts();_checkSessionAlive();}},
  30000)` (`apps/engineer/main.js:751`) — every **30 seconds**, but only while the tab isn't hidden and
  someone's logged in. `loadJobs()` (`main.js:832`, cited in Workflow 1 §3) re-runs the same three
  Today/Upcoming/Done queries from scratch each time — no sentinel/diff step the way Office's poll has;
  this is a real, if coarser, "just re-fetch" pattern.
- **A separate, faster poll for office broadcast alerts:** `setInterval(()=>{if(currentUser)
  checkBroadcastAlerts();},15000)` (`main.js:752`) — every 15 seconds, independent of the 30s jobs poll,
  covers office-to-engineer announcement messages (`engineer_alerts` table) rather than job data.
- **A connectivity indicator, not a data-freshness mechanism:** `setInterval(()=>{if(currentUser)
  checkOfficeConnection();},120000)` (`main.js:753`) pings `users?limit=1` every 2 minutes purely to
  color a "Connected"/"No Connection" dot green or red (`main.js:639-654`) — it never triggers a data
  reload itself.
- **Refresh-on-focus:** `document.addEventListener('visibilitychange',()=>{if(document.
  visibilityState==='visible'&&currentUser)_checkSessionAlive();})` (`main.js:756`) — this re-checks
  the session is still valid (catches the case where office force-logged the engineer out while their
  tab was backgrounded), not a jobs refresh in itself, but a stale/killed session is exactly the thing
  that would otherwise silently stop the 30s poll from working.
- **A real manual refresh, wired to a visible control:** `refreshAll()` (`main.js:763-...`) — bound to
  the user-menu's refresh row (`onclick="refreshAll();closeUserMenu()"`,
  `apps/engineer/index.html:540`) — re-runs `loadJobs()` plus whatever the current tab needs
  (`loadDash()`, `loadRequests()`), spins a refresh icon while in flight, and stamps an "Updated
  HH:MM" timestamp on completion. A real pull-style refresh action exists; it's a menu item, not a
  swipe gesture.
- **The service worker itself is also kept current on an interval:** `setInterval(()=>reg.update(),
  30*60*1000)` (`main.js:1872`) plus a `visibilitychange`-triggered `reg.update()` — this refreshes the
  installed PWA build, not application data, but it's worth distinguishing from the data-freshness
  mechanisms above since both live in the same file.

**In short:** an engineer sees another job (or a job reassigned to them, or an office edit to a job
they already have open in their list) within 30 seconds worst case, sooner if they background and
refocus the tab, or instantly if they hit the manual refresh.

### 3.1 Client Portal — genuinely different, and worth stating plainly

The Client Portal has **no periodic data refresh of jobs/certs/invoices at all.** `init()`
(`apps/portal/main.js:348`) runs once, on page load, resolves the visitor's identity via the
`portal_get_*` RPCs (Workflow 5), and renders. There is no `setInterval` anywhere in
`apps/portal/main.js` that re-fetches jobs, certs, or invoices, and no `visibilitychange` listener
that triggers a data reload either. The only interval-driven polling in the file
(`_startPinWatchdog()`, `main.js:325-345`, a 20-second `setInterval` plus a `visibilitychange` check)
exists purely to catch a **server-side PIN reset** — it calls `rpc/portal_pin_status` and, if the PIN
has been cleared since the tab opened, kicks the visitor back to the PIN-setup screen. It never
touches job/cert/invoice data; the comment at `main.js:316-324` explicitly frames this as "a client
viewing jobs/certs doesn't need a websocket open for this" — deliberately lightweight, on purpose.

**What this means concretely:** if a landlord has the Portal open in a browser tab and office marks
their job `Completed` five minutes later, the landlord's open tab shows no change whatsoever until
they reload the page or re-open the link — there is no live update path for the actual business data.
The two things that make a *re-opened* Portal visit feel current are:
1. **A full reload, always.** Because the load-once model means a fresh page load is the only path
   to fresh data, that reload also happens automatically after PIN setup/entry succeeds —
   `location.reload()` at `main.js:248` and `main.js:280` — so the very first screen the client ever
   sees after unlocking their PIN is guaranteed current data, even though nothing refreshes after that.
2. **"Updates since your last visit."** `_computeChangesSinceLastVisit()` (`main.js:77-112`) diffs the
   freshly-loaded jobs/certs/invoices against a snapshot saved to `localStorage` (key
   `df_portal_seen_<token>`, `main.js:75`) from the *previous* visit, and surfaces a short changelog
   ("Job at 12 High St is now Completed," "New certificate ready: EICR," "Invoice INV-1042 is now
   Awaiting Payment") — a free, no-infrastructure "what changed since you were last here" feature that
   substitutes for a live feed, at the cost of only working across separate page loads, never within
   one open tab.

---

## 4. The offline write queue (`packages/offline/queue.js`)

`createOfflineQueue(queueKey, {sbFetch, onQueueChange, onSynced})` (`packages/offline/queue.js:16-74`)
is a small, generic wrapper — no table-specific knowledge lives in the package itself. Confirmed by
grepping `createOfflineQueue` across the whole repo: it's instantiated in exactly **two** places,
`apps/office/main.js:117` (`_officeQueue`, key `df_office_offline_queue`) and
`apps/engineer/main.js:344` (`_engQueue`, key `df_eng_offline_queue`). **The Client Portal never
imports it** — no `createOfflineQueue`/`@offline` reference anywhere under `apps/portal`, consistent
with the Portal having no concept of a logged-in session whose writes would need protecting the same
way, and with `packages/data/repository.js`'s own comment noting the Portal "queries `sb()` directly."

### 4.1 What actually gets queued

`queueableSave(label, path, opts)` (`queue.js:34-47`) tries the write immediately; only on a
connectivity-shaped failure (`isNetworkError(e)` — `!navigator.onLine`, a `TypeError` from `fetch()`
itself, or a "failed to fetch"/"networkerror"/"load failed" message, `queue.js:10-14`) does it push
`{qid, label, path, opts, ts}` onto a `localStorage`-backed array and report `{queued:true}` instead of
throwing. A genuine server-side rejection (validation error, RLS denial, etc.) is **not** queued — it
re-throws so the caller's existing error handling (a toast, usually) fires normally. This is a
deliberate distinction: only "the request never reached the server" is treated as retryable.

Confirmed call sites — every one is a targeted, single-purpose PATCH, never a full record write:

| App | What's queued | Call site |
|---|---|---|
| Office | Job status change | `_applyStatusChange()`, `main.js:2912` |
| Office | Job time-slot inline edit | `main.js:1995` |
| Office | Job price inline edit | `main.js:2010` |
| Engineer | Job status change (quick-action button) | `quickStatusUpdate()`, `main.js:959` |
| Engineer | Job status change (detail-view button) | `updateStatus()`, `main.js:1374` |
| Engineer | On-site notes save | `saveNotes()`, `main.js:1451` |
| Engineer | Audit-log write for the offline-capable actions above | `main.js:249` |

**What's conspicuously not in this list:** photo uploads (`apps/engineer/photos.js`), the New Job
form, invoice edits, certificate saves — none of these route through `queueableSave`. A dropped
connection while filling in a job form is instead covered by the separate `localStorage` autosave-draft
mechanism cited in Workflow 1 step 1 (`openJobModal()`), a different mechanism with a different
purpose (recover an unsaved form, not retry a write that already looked complete to the user).

### 4.2 When it flushes — identical pattern in both apps

Both instantiations wire the exact same three flush triggers, confirmed at `main.js:143-145` (Office)
and `main.js:370-372` (Engineer):

```js
window.addEventListener('online', _flushOfflineQueue);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') _flushOfflineQueue(); });
setInterval(_flushOfflineQueue, 20000);
```

i.e. the moment the browser's own `online` event fires, the moment the tab becomes visible again, and
every 20 seconds regardless, as a catch-all for cases where neither event reliably fires (a flaky
connection that never technically goes "offline" from the browser's point of view). `flush()`
(`queue.js:50-71`) processes the queue strictly in order, stopping (not discarding) on the first item
that still fails for a connectivity reason, but discarding and logging any item the server outright
rejects (`console.warn('[OfflineQueue] dropping unsendable item', ...)`, `queue.js:62`) — a save that
was valid when queued but has since become invalid (e.g. the job was deleted in the meantime) doesn't
block every subsequent queued item behind it forever.

**One real, documented difference between the two apps' behavior on a full sync**, called out in both
files' own comments (`main.js:113-116` Office, `main.js:340-342` Engineer): Office's `onSynced`
callback shows a toast *and* calls `_invalidateJobCache()` + `_renderJobsKeepScroll()` so the Jobs list
visibly reflects everything that just synced; Engineer's `onSynced` only shows the toast — it relies on
the next `loadJobs()` poll tick (within 30s) to actually refresh the list, not on the queue's own
`onSynced`.

---

## 5. Optimistic UI updates — real, but the exception, not the rule

The default pattern across all three apps is **await-then-update**: `quickStatus()`
(`main.js:2940-2943`) and `_applyStatusChange()` (`main.js:2902-2938`) in Office, and
`quickStatusUpdate()`/`updateStatus()` in Engineer, all `await` the PATCH (or the queue's decision to
queue it) before touching local state (`j.status=status`) or calling a re-render. There is no
speculative "flip the status pill immediately, reconcile later" behavior on the single most common
write in the system.

That said, genuine optimistic-update-with-rollback code does exist, in a small number of specific,
higher-friction interactions where waiting for a round-trip per item would feel bad:

- **`bulkSetPriority()`** (`main.js:2276-2316`) — sets every selected row's CSS class and flashes it
  **before** any network call, explicitly commented `// INSTANT visual update — no waiting`
  (`main.js:2280`). It snapshots each job's previous priority into `prevPriority` first
  (`main.js:2283`), fires all the PATCHes via `Promise.allSettled()`, and on any failure, reverts just
  the failed jobs' `priority` back to their snapshotted value, re-renders, and reports precisely how
  many succeeded vs. were reverted (`"⚠ 4 of 6 set to Urgent — 2 failed and were reverted"`,
  `main.js:2312`). The comment at `main.js:2299-2302` documents that this rollback path is itself a
  fix — the success toast used to fire unconditionally right after the instant visual update,
  regardless of whether the PATCHes that followed actually succeeded.
- **`deletePortalContact()`** (`main.js:9682-9696`, Settings → Portal Contacts) — removes the row from
  the in-memory list and re-renders immediately, then calls `dDel()`; on failure it restores the
  previous array, re-renders again, and toasts the failure. The comment (`main.js:9688-9691`) again
  frames this as a fix to a previously *silent* optimistic delete with no rollback at all.
- **Same-day drag-to-reorder** (`main.js:10437-10473`, and the multi-select variant at
  `10396-10435`) — dragging a job row mutates `_jobRowData[id]._sortOrder`/`.date` and calls
  `renderJobs()` immediately (toast: "↕ Order saved" fires before the network calls resolve), with the
  actual `PATCH` array running afterward via `Promise.all(saves)`. Its `.catch()` doesn't do a targeted
  per-item rollback the way `bulkSetPriority()` does — it calls `_invalidateJobCache()` and
  `renderJobs()` again, which forces a fresh fetch on next read rather than reverting each dragged
  job's fields by hand. Functionally still a rollback (the screen ends up showing server-truth, not the
  optimistic guess), just implemented as "force a refetch" rather than "restore the snapshot."

**Why this matters for a reader of this document:** don't assume every status-change button in
DeepFlow is optimistic just because a few well-known "many items at once" interactions are — the
two-stage completion handoff, the single-job status dropdown, and the vast majority of writes in this
codebase all wait for the server (or the offline queue's decision) before the UI moves.

---

## 6. Cache invalidation — two independent layers, one of them partly dead code

There isn't one caching layer in DeepFlow — there are two, with different scopes, different TTLs, and
different apps using them.

### 6.1 `@data`'s repository cache — Office only, 30-second TTL

`createRepository()` (`packages/data/repository.js:32-108`) is imported only by Office
(`export const {dGet,dAll,dPut,dDel} = createRepository(_sb,{localTables:_LOCAL})`,
`apps/office/main.js:202`) — confirmed absent from both `apps/engineer/main.js` and any file under
`apps/portal`. It keeps an in-memory `Map` (`_cache`, `repository.js:33`) keyed per table, with a flat
**30-second TTL** (`CACHE_TTL_MS = 30000`, `repository.js:30`) for `dAll(store)` reads. The comment at
`repository.js:20-29` explains the tradeoff directly: this is a multi-user app with Realtime only on
`jobs`, so an unbounded cache on every other table (`persons`, `invoices`, `certs`, `agencies`, …)
would mean one office session not seeing another's change for an unbounded time — 30 seconds caps
that exposure while still collapsing the common case of one page render calling `dAll()` for the same
table several times in quick succession into a single fetch.

**Self-invalidation on write, but only through this same repository's own functions.** `dPut()` and
`dDel()` each call `_cache.delete(store)` (`repository.js:85`, `103`) *before* making their own write —
so a write made through `dPut`/`dDel` always busts that table's cache immediately, guaranteeing the
writer never sees their own change go stale. **A write made via a raw, targeted `_sb(...)` PATCH —
which is the majority pattern in this codebase, precisely because targeted PATCHes avoid clobbering
fields another user just changed (§1.1, business-rules §1.4) — does *not* go through `dPut` and does
*not* bust this cache.** That's a real, narrow staleness window: for up to 30 seconds after a targeted
PATCH to, say, `invoices`, a different `dAll('invoices')` call elsewhere in the same session could
still return the pre-PATCH cached rows.

### 6.2 The Jobs list's own cache — separate code, 5-minute TTL

Independently of the above, Office's Jobs page keeps its own cache: `_getJobs(forceRefresh)`
(`main.js:2318-2327`) checks `_jobCache`/`_jobCacheTs` against `JOB_CACHE_TTL = 300000` — **5 minutes**
(`main.js:1779`) — before falling back to a real `dAll('jobs')` fetch. `repository.js`'s own comment
(`repository.js:17-19`) explicitly acknowledges this: "jobs itself has its own dedicated windowed-
loading path already... and is unaffected by this [the 30s repository cache]." `_invalidateJobCache()`
(`main.js:2329-2332`) is the one function that actually clears it, and it's called from a lot of
places that change job data outside the repository's own write path: the Realtime poll tick (§2), every
targeted status/price/timeslot PATCH (§4.1's Office rows), drag-reorder's rollback path (§5), and —
per the next finding — `_invalidateCache('invoices')`.

### 6.3 `_invalidateCache()` — half of it is dead code

`_invalidateCache(store)` (`main.js:7130-7133`) is the function this document's brief specifically
asked to trace (it's the same function `_storeInvoicePDF()` and several invoice-edit paths call after
a write):

```js
// apps/office/main.js:7130-7133
function _invalidateCache(store){
  if(typeof _cacheInvalidate==='function') _cacheInvalidate(store);
  if(store==='invoices'&&typeof _invalidateJobCache==='function') _invalidateJobCache();
}
```

**A repo-wide grep for `_cacheInvalidate` (not `_invalidateCache`, the different name one line above)
finds exactly one hit in the entire codebase: this line itself.** No function, variable, or import
named `_cacheInvalidate` is ever defined anywhere — not in `main.js`, not in `packages/data`, not
re-exported from anywhere. `typeof _cacheInvalidate==='function'` therefore always evaluates to
`false` at runtime (a bare reference to an undeclared identifier inside `typeof` doesn't throw, it just
reads as `'undefined'`), so **the first line of `_invalidateCache()` never executes its body — the
call was clearly meant to reach into `@data`'s repository cache (§6.1) and bust it, and never
actually does.** The function's only real effect, every single time it's called, is the second
line: if `store==='invoices'`, clear the *Jobs* list's cache (§6.2) — which is a real, useful side
effect for the "job → auto-invoice" relationship, but not what the function's own name or its first
line promise. Every call site of `_invalidateCache('invoices')` (7 of them, including
`main.js:7003, 7027, 7067, 7117, 7126, 7293`) is, in practice, only clearing the Jobs cache, not the
`invoices` table's own 30-second repository cache — which means a stale `dAll('invoices')` read for up
to 30 seconds after these particular writes is a real, currently-live gap, not a hypothetical one.

---

## 7. Cross-app consistency, worked example: `ENGINEER_COMPLETED`

Tying the mechanisms above together against the concrete case named in this document's brief — an
engineer taps **✅ Done** on-site, setting a job to `Engineer Completed` (Workflow 1 steps 4-5). Who
learns about it, through which mechanism, and how fast:

1. **The engineer's own device** sees it instantly — `quickStatusUpdate()` (`apps/engineer/main.js:955`)
   updates `_allJobs` locally right after the PATCH/queue call resolves (§5 — this is the
   await-then-update pattern, not optimistic), and the status pill immediately reads "✔ Awaiting Office
   Review" (business-rules §1.2).
2. **If the engineer is offline at that moment**, the PATCH is queued (§4) instead of lost — the app
   shows "📶 Offline — status will sync to 'Engineer Completed' once back online" and the change reaches
   the server the next time `online` fires, the tab regains visibility, or the 20-second flush interval
   ticks over — whichever comes first.
3. **Any other open Office session** learns about it two possible ways, and it genuinely depends on
   whether that session's Realtime channel is currently connected:
   - **Realtime connected (the common case):** the `jobs-realtime` channel's `UPDATE` event fires
     `handleRealtimeChange()` (§1.1) within roughly a second of the PATCH landing. `_jobRowData`/
     `_jobCache` update immediately regardless of what page that Office session has open; a
     `_pushNotif()` reading `"Engineer completed & left — needs review — <engineer name>"` fires
     regardless of page; and the visible Jobs list row only actually re-renders in place if that
     session is currently on the Jobs page.
   - **Realtime disconnected:** the same information arrives via the 5-second sentinel poll (§2)
     instead — within 5 seconds in the worst case, since the sentinel check runs continuously as a
     fallback whenever `_rtConnected` is false.
4. **Other Engineer sessions** (a different engineer, or the same engineer on a second device) learn
   about it only through their own 30-second poll (§3.0) or a manual refresh — there's no push from one
   engineer's change to another's screen. In practice this rarely matters, since each engineer's
   `loadJobs()` query is scoped to jobs assigned to *them* (Workflow 1 step 3) — a job moving to
   `Engineer Completed` is usually only visible to the one engineer who was on it and to Office.
5. **Office review and finalization** (`Engineer Completed → Completed`, Workflow 1 step 6) is entirely
   an Office-side action with no special cross-app signaling of its own — it flows back out through
   exactly the same three paths above (this session's own state update, other Office sessions'
   Realtime/poll, other Engineer sessions' 30s poll) once it happens, because it's just another `jobs`
   row UPDATE from the platform's point of view. Workflow 1 step 6's point that "the engineer only sees
   the end state on their next refresh" is the direct, confirmed consequence of §3.0 — there is no
   faster path available to the Engineer App even if one existed for this specific transition.
6. **The Client Portal does not learn about any of this while a tab is open** — per §3.1, there is no
   live update path for Portal at all. The client sees the job's new status the next time they reload
   or re-open their link, at which point `_computeChangesSinceLastVisit()` (§3.1) will surface it as
   "Job at `<address>` is now `Engineer Completed`" if that status is one the Portal renders distinctly
   — **unless** the client has separately opted into Web Push (§3.2, below) and office has separately
   turned on server-side push notifications, in which case a real push notification can reach their
   phone within seconds of the status change, independent of the tab being open at all.

---

## 8. A genuine correction to the sibling docs: Portal Web Push is real, wired, two-way code

`docs/architecture/05-database.md` §3.17 describes `push_subscriptions` as "pre-built schema for a
not-yet-shipped feature that would need server-side (Edge Function) access only," and
`docs/architecture/06-supabase.md`'s Edge Function table repeats that conclusion for `send-push`: "no
application code currently *writes* to `push_subscriptions`, so this function currently has no real
subscriptions to send to in production." **Both statements are incorrect about the code**, even though
their practical bottom line (zero rows in the live table right now) is very likely still accurate,
since `05-database.md`'s own row-count table shows `push_subscriptions` at 0 following the 2026-08-06
data reset.

The write path is real, complete, and reachable by an anonymous Portal visitor today:

- **The client side is live UI, not dead code.** `apps/portal/index.html:449` renders a real button
  (`🔔 Get notified on your phone`, inside `#notif-push-row`) wired to `onclick="enablePushNotifications()"`.
  `initPush()` (`apps/portal/main.js:133-144`) — itself called unconditionally from `init()` at
  `main.js:577` on every Portal page load — shows that row whenever the browser supports Web Push, the
  user hasn't previously denied notification permission, and this device isn't already subscribed.
- **Clicking it does write to `push_subscriptions`.** `enablePushNotifications()`
  (`main.js:146-176`) requests browser notification permission, subscribes via
  `reg.pushManager.subscribe()` with the app's real VAPID public key (`main.js:120`), and POSTs the
  resulting endpoint/keys to `rpc/portal_push_subscribe` (`main.js:163-166`) — a `SECURITY DEFINER`
  RPC that `06-supabase.md` §3.5 itself already lists as one of the 22 functions callable by `anon`,
  which is exactly what makes an unauthenticated Portal visitor able to write into an RLS-protected
  table with zero policies (§3.1 of that same document) in the first place.
- **The send side is wired too, from both staff-facing apps.** `sendPushNotification()` exists nearly
  identically in `apps/office/audit.js:73-106` and `apps/engineer/main.js:281-306`, called from
  `_applyStatusChange()` (`apps/office/main.js:2934`) and `quickStatusUpdate()`/`updateStatus()`
  (`apps/engineer/main.js:964, ~1381`) on every job status change. Both `POST` directly to the
  `send-push` Edge Function with a status-specific title/message ("Engineer has arrived," "Job
  completed," etc.) and the job's landlord/agency/agent name for the function's fuzzy-match resolution
  step (`06-supabase.md` §7's own description of `send-push`).

**What's genuinely still true, and the likely reason this got mis-stated:** push is **off by default**
on the sending side — `S.notifPushEnabled` defaults to `false` (`apps/office/main.js:233`) and must be
explicitly turned on in Settings → Notifications — and, separately, the table really is empty right
now because of the same data reset that zeroed every other table in the project
(`05-database.md` §1). So *as of this snapshot*, no push has ever actually been sent in production and
no client has (yet) re-subscribed since the reset — the sibling docs' real-world conclusion holds. But
"no application code writes to this table" is a different, stronger, and — per the source above —
false claim about the code itself. This mirrors exactly the distinction Workflow 4 §5 draws for
Stripe: **the code path is real and complete; what can't be verified from source alone is whether
anyone has actually exercised it in production yet.**

---

## 9. Summary — freshness by scenario

| Scenario | Who notices, and how fast |
|---|---|
| Office A changes a job while Office B has it open in the list (not editing it) | Office B: in-place DOM patch within ~1s (Realtime) or up to 5s (poll fallback) |
| Office A changes a job Office B currently has open *in the edit modal* | Office B: no auto-merge — a warning toast + amber border flash; Office B's own in-progress edit is untouched |
| Engineer completes a job | Office: same as above. Other engineers: up to 30s (their own poll), or instant on manual refresh |
| Office edits a job assigned to an engineer (reschedule, reassign) | That engineer: up to 30s poll, or instant on tab refocus/manual refresh |
| A dropped connection mid-write (status/notes/price/timeslot only) | Queued locally, retried on `online`/tab-visible/20s interval — never silently lost |
| A client has the Portal open when their job/cert/invoice changes | Nothing, until they reload or re-open the link — no live update path exists — *unless* they've opted into Web Push and office has push notifications enabled, in which case a real push can arrive within seconds |
| A client re-opens their Portal link after being away | Full fresh load, plus an explicit "what changed since your last visit" list built from a `localStorage` snapshot |

---

## See also

- [`docs/architecture/06-supabase.md` §6](../architecture/06-supabase.md#6-realtime) — the Realtime
  subscription's platform-level configuration (the `supabase_realtime` publication, the migration that
  added `jobs` to it) — not repeated here.
- [`docs/architecture/06-supabase.md` §7](../architecture/06-supabase.md#7-edge-functions--overview) —
  the `send-push` Edge Function's own auth model and fuzzy-name resolution logic.
- [`docs/business/11-workflows.md`](11-workflows.md) — Workflow 1 (the two-stage completion handoff
  this document's §7 traces end to end) and Workflow 6 (the Engineer App's own day, including the same
  handoff from the engineer's side).
- [`docs/business/10-business-rules.md` §1.8](10-business-rules.md#18-manual-sort-order-realtime-conflict-rules) —
  the one-line summary this document's §1.1 expands into the full conflict-toast/border-flash mechanism.
- [`packages/offline/README.md`](../../packages/offline/README.md) — the offline queue package's own
  short design note (why it exists, what a silent data-loss bug here would mean).
- [`docs/README.md`](../README.md) — full documentation index.

*Every mechanism described above was traced directly through the current application source, not
inferred from file/function names. Two claims in sibling documents (§6.4/§8 above) were found to be
incorrect about the code itself during this tracing and are corrected here with the exact source that
overturns them, following the same house convention `10-business-rules.md` and `11-workflows.md` use
when a claim in an older or sibling document doesn't hold up against current source.*
