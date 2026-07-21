# DeepFlow — Synchronization Handbook

How data actually moves between the three apps, who starts each movement, when it happens, and what protects against conflicts, duplicates, and failures.

## 0. The One Fact That Explains Everything Else Here

**None of the three apps ever send data directly to another app.** There is no direct connection between the Office app, the Engineer app, and the Client Portal at all. Every single thing described below as "syncing" is really one app writing to the shared Supabase database, and a second app either (a) being *pushed* that change automatically over a live connection — which only happens in exactly one place in the whole system — or (b), everywhere else, *asking* the database "has anything changed?" on its own separate schedule, or simply loading fresh data the next time it opens a screen. Keep that in mind through every section below: "syncing" almost always means **polling**, not pushing.

---

## 1. The Full Pipeline, Stage by Stage

### 1.1 Office App

The Office app is the most "connected" of the three — it's the only one with a live, standing connection to the database (Realtime, Section 1.6), and it is the origin point for the majority of data other apps eventually see: jobs, invoices, certificates, directory records, settings, broadcasts.

- **What it sends out:** every create/edit/delete a staff member makes, the instant they click Save/Delete — there is no batching or "sync later" queue on the write side; each action is its own immediate network request.
- **What it receives:** live pushes for the `jobs` table only (Section 1.6); everything else it learns about by polling on a 5-second cycle *only when Realtime isn't connected* (Section 7), or simply by loading a screen fresh.

### 1.2 Employee (Engineer) App

The Engineer app has **no live connection to anything**. Every piece of data it shows was fetched at a specific, scheduled moment in the past (up to 30 seconds stale, by design — Section 3).

- **What it sends out:** status changes, notes, hours, photos, GPS position, new jobs it creates itself, overtime/leave requests — each sent immediately as its own request, same as the Office app.
- **What it receives:** nothing pushed. It asks the database for its job list every 30 seconds, for broadcast alerts every 15 seconds, and lets the user pull-to-refresh at any time for an immediate check.

### 1.3 Client Portal

The Client Portal has the weakest synchronization of the three — effectively none.

- **What it sends out:** only when a client actively submits a new job request (writes to `engineer_requests` and `activity`). Nothing else the client does (viewing, downloading, exporting CSV) writes anything back.
- **What it receives:** everything, but only **once**, at the moment the page is first loaded. There is no timer, no poll, no live connection. A client who leaves the tab open for an hour is looking at data that is up to an hour (or however long they've had it open) out of date, until they manually reload.

### 1.4 Supabase

Supabase itself doesn't "do" anything proactively — it's the shared hub all three apps independently read from and write to, over its auto-generated REST API. It has no idea the three apps are conceptually related; as far as Supabase is concerned, it's just answering ordinary database requests from three different websites that happen to use the same project.

### 1.5 Storage

Storage only participates in one specific data flow: photos and documents. Files are written **once**, by the Engineer app, at upload time, and never modified afterward — only read (Office, Client Portal) or deleted (Office, and the engineer who uploaded them, from within the same session). There is no "sync" of file *content* — a file is either present or it's been deleted; nothing updates a file in place.

### 1.6 Realtime

Exactly one live wire exists in the entire system: the Office app's subscription to the `jobs` table, opened right after login. This is the only place where "the moment it happens elsewhere, it appears here too" is actually true, rather than "within the next poll interval." See Section 1.6.1 below and Section 6 for exactly what it does and doesn't cover.

#### 1.6.1 What the Realtime Connection Actually Delivers

- Every `INSERT`, `UPDATE`, and `DELETE` on `jobs`, from **any** source — this includes changes made by other Office-app browser tabs/computers, *and* changes made by the Engineer app (since the Engineer app writes to the same `jobs` table directly; the Office app's Realtime subscription doesn't know or care which app made the change).
- It does **not** cover any other table. A new certificate, a new invoice, a new broadcast alert, a new job request — none of these are pushed live, even though they're just as "important" as a job change. Only `jobs` was wired up this way.

### 1.7 Database

Postgres is the single source of truth. There is no caching layer, no message queue, no separate "sync service" sitting between the apps and the database — every app talks to the same tables, directly, every time.

### 1.8 Notifications

Notifications are the *visible result* of the sync mechanisms above, not a sync mechanism of their own. Three separate, unconnected notification systems exist:

- **Office in-app bell:** fed by whatever the Realtime connection (Section 1.6) or the 5-second poll fallback (Section 7) picks up. Exists only in browser memory, lost on refresh.
- **Engineer full-screen alert popup:** fed by the 15-second broadcast-alert poll (Section 3).
- **Browser-native push notification (both Office and Engineer apps):** fed by whichever of the above mechanisms first notices something new, then additionally calls the browser's own `Notification` API if permission was granted — this only fires while the relevant app is actually open in a tab (there is no background/service-worker push in this system; if the tab isn't open, nothing arrives at all, even if the browser normally supports push notifications).

---

## 2. Who Starts Each Sync — Complete List

| Sync | Started by | Trigger type |
|---|---|---|
| A job appearing live on another Office screen | The person who saved/changed the job | Realtime push (instant) |
| Engineer's job list refreshing | The Engineer app itself | Timer — every 30 seconds while the tab is visible |
| Engineer's job list refreshing (manual) | The engineer | User gesture — pull-to-refresh |
| Engineer seeing a new broadcast alert | The Engineer app itself | Timer — every 15 seconds |
| Office falling back to polling for job changes | The Office app itself | Automatic — only when the Realtime connection is not in a `SUBSCRIBED` state |
| Office noticing a new job request from a client/engineer | The Office app itself | Same 5-second poll fallback cycle, or a fresh page load of the Job Requests screen |
| Client Portal showing anything at all | The client | User gesture — opening the link, or manually reloading the page |
| A photo appearing in the Office app's job view | Whoever next opens that job in the Office app | On-demand — happens only when that specific screen is opened, not automatically |
| Live Map showing an engineer's position | Whoever opens the Live Maps screen | On-demand read, of whatever position was last written |
| An engineer's GPS position updating in the database | The Engineer app itself | Automatic — the device's own location sensor firing a "position changed" event (not a fixed timer) |
| Settings changes reaching another device | Whoever next logs in or loads that app | On-demand — settings are only re-read at login/page-load, not pushed |

**The consistent pattern:** almost every sync in this system is either "an immediate write, triggered by a human action" or "a scheduled check, triggered by a timer" — genuine machine-to-machine push events are limited to the single Realtime channel described in Section 1.6.

---

## 3. What Data Moves, and When — Complete Table

| Data | Written by | Read by | When the reader actually sees it |
|---|---|---|---|
| Job created/edited/deleted | Office, Engineer (add-job, status/notes/hours only) | Office (instantly, via Realtime), Engineer (within 30 seconds, via poll) | Near-instant on Office; up to 30s delayed on Engineer |
| Job status → Completed | Office or Engineer | Office (instantly), and internally triggers automatic certificate + invoice creation (Section on the Business Rules doc) regardless of which app changed it | Instant on Office; the resulting new invoice/certificate is visible to whoever next loads those screens |
| Certificate created | Automatically (job completion) or manually, Office only | Office (next screen load — certs are not Realtime-enabled), Client Portal (next page load) | Not instant even on Office — requires a manual refresh/re-navigation to that screen |
| Invoice created/edited/paid | Office only | Office (next load), Client Portal (next page load) | Not instant anywhere — invoices are not Realtime-enabled |
| Photo/document uploaded | Engineer only | Office (next time that job is opened), Client Portal (next page load, if linked to a certificate/document) | Not instant — no notification tells Office "a new photo arrived," they simply see it whenever they next look |
| Photo/document deleted | Office (from the job view), or the uploading engineer (from within the same app session) | Same as above | Same as above |
| Broadcast alert sent | Office only | Engineer (within 15 seconds, via poll) | Up to 15s delayed |
| Job/overtime/leave request | Engineer or Client Portal | Office (within 5 seconds if polling is active, otherwise next screen load) | Up to 5s delayed if Realtime for jobs happens to be down (the request poll piggybacks on the same fallback cycle), otherwise on next manual visit to Job Requests |
| GPS position | Engineer only (automatic, continuous) | Office's Live Maps screen | On-demand — only refreshes when someone actually opens that screen |
| Settings (company info, templates, cert types, properties, engineer permissions) | Office only | All three apps, but only at their own startup/load moment | Office: next login or settings-reload point. Engineer: only certain settings, and only if present in that device's own local browser storage already (see the Architecture document's note on this weak link) — otherwise never, silently falling back to hardcoded defaults. Client Portal: fresh, every page load. |
| Directory records (persons/agencies/agents) | Office only | Office (next load), Client Portal (portal links point directly at these records, read fresh every page load) | Not instant on Office |

---

## 4. How Conflicts Are Prevented

There is **no field-level locking, no "someone else is editing this" indicator shown in advance, and no server-side conflict resolution** anywhere in this system. What exists instead is a set of smaller, targeted mitigations:

- **Targeted updates instead of full overwrites:** the most common change — a status update — is sent as a `PATCH` touching only the `status` and `modified` fields, deliberately, specifically so that if two people are looking at the same job, one changing its status doesn't wipe out a note the other person just typed into a different field a moment earlier. Saving the full job form is the one action that *does* overwrite everything at once — this remains a real, if narrower, window for conflict.
- **After-the-fact warning, not before-the-fact locking:** if a job that's currently open in someone's edit window gets changed by someone else in the meantime, the Realtime connection notices and shows a warning ("this job was updated by another user, save carefully") with a flashing border — but it does **not** stop them from saving anyway, and does not merge the two sets of changes for them. It's a heads-up, not a safety net.
- **Invoice-vs-job drift handling:** if a job's price/description changes after an invoice already exists for it, and that invoice hasn't been paid yet, the invoice is automatically nudged back to `Draft` status rather than silently left showing stale figures — forcing a human to look at it again before it goes out. (Full detail in the Business Rules document, Section 5.10.)
- **Smart partial re-rendering:** when a live change does arrive, the app decides whether to patch just one row or redraw the whole list, and — when redrawing — explicitly preserves the user's current scroll position, so an incoming background sync doesn't disorient someone actively working further down the list.
- **What is genuinely *not* prevented:** two people changing the *same* field on the *same* record within the same few seconds. Whoever's write reaches the database last simply overwrites the other — there is no merge, no version number, and no lock. This system relies on the fact that, in normal daily use, it's uncommon for two staff members to edit the exact same job field at the exact same instant, rather than on any technical guarantee that it can't happen.

---

## 5. How Duplicate Records Are Prevented

- **Saving the same record twice is handled at the database-write level, not just in the app:** every save (`dPut`) uses `POST` with `Prefer: resolution=merge-duplicates` — this tells Postgres "if a row with this same ID already exists, update it instead of rejecting the request as a duplicate." This is what makes editing and creating safely go through the exact same code path.
- **Human-readable numbers (job numbers, invoice numbers, certificate numbers, client-request reference numbers) are never generated by a database sequence.** Every one of them is produced the same way: scan every existing record with the relevant prefix, find the highest number in use, add one. This guarantees no duplicate number *among what the app can currently see*, but is not airtight against two people creating a record in the same instant — see Section 8.10 for a worked-through example of exactly when this could theoretically go wrong.
- **The automatic invoice-creation feature specifically guards against creating a second invoice for a job that already has one** — it checks for an existing linked invoice before creating a new one. This check and the resulting write are two separate steps, not one atomic operation.
- **Directory duplicate detection** (matching phone numbers typed into a job form against existing landlords/agents/agencies) is a *warning*, shown to a human, not an automatic block — the system does not refuse to save a genuine duplicate person record if the user dismisses the warning and continues anyway.
- **Certificates specifically check for an existing certificate of the same type on the same job** before creating a new one, preventing the automatic-detection feature from generating five "Gas Safety" certificates for the same job if it's saved and re-completed multiple times.
- **Self-healing table creation is itself duplicate-safe:** the one place the system tries to *create database structure* on the fly (the broadcast-alerts self-repair, Database Handbook Section 9) uses `CREATE TABLE IF NOT EXISTS` and a policy-existence check before creating, specifically so that running it more than once doesn't error out or duplicate anything.

---

## 6. How Deleted Records Propagate

This is one of the weaker areas of the system, worth understanding clearly:

- **A deleted job disappears live** from any other open Office session immediately (it's the one table on Realtime — the row animates out). It disappears from the Engineer app's list on that engineer's next 30-second poll.
- **Nothing else cascades automatically.** Deleting a job does **not**:
  - Delete its certificates, invoices, comments, or attachments — they become "orphaned," still sitting in their own tables, still referencing a job ID that no longer resolves to anything.
  - Delete the actual photo files sitting in Storage — those remain, taking up space, with no job left to view them from inside the app (though they'd still be directly reachable if someone had the exact file URL).
- **Deleting a directory record (a landlord, agency, or agent) does not touch any job or invoice that referenced them by name.** Because most links in this system are by name-matching rather than a real reference (see the Business Rules document, Section 6.4 and the Architecture document's relationships section), a job still shows "landlord: John Smith" perfectly normally even after the `persons` row for John Smith has been deleted — the historical text was copied onto the job at the time, not fetched live.
- **Deleting a directory record does immediately break that person's Client Portal link.** Since the portal identifies someone purely by looking up their ID at page-load time, a deleted record simply means "not found" the next time anyone (including the person the link was originally sent to) tries to open it — there is no warning shown beforehand, and no grace period.
- **The one deliberate exception to "nothing cascades":** deleting a photo/attachment *from inside the app* (as opposed to a job being deleted, which leaves attachments as silent orphans) does properly remove both the database record *and* the underlying file in Storage together, in the same action — this is the one place a "delete" was built to clean up after itself completely.

---

## 7. How Failed Syncs Recover

### 7.1 The Save-in-Progress Indicator

Every write anywhere in the Office app increments a shared counter (`_pendingSaves`) the instant it starts, and decrements it the instant it finishes (success **or** failure) — a small badge in the top bar reflects this in real time:

- **While at least one save is in flight:** badge shows "Syncing…"
- **The instant the last pending save finishes successfully:** badge flashes "✓ Synced" for 2 seconds, then settles back to "Live."
- **If a write fails specifically because the browser is offline:** badge switches to "Offline — check connection," and a toast explicitly warns the user their changes may not have saved.

### 7.2 Being Warned Before You Lose Work

If someone tries to close the browser tab while `_pendingSaves` is still greater than zero, the browser itself is asked to show its native "are you sure you want to leave — changes may not be saved" confirmation prompt. This is the system's only real protection against a save being silently lost mid-flight.

### 7.3 Reacting to the Network Itself Going Up or Down

The Office app listens directly for the browser's own `online` and `offline` events (which fire when the device's actual network connection changes, independent of any specific request):

- **Going offline:** badge immediately switches to "Offline," and a longer, more insistent error toast appears.
- **Coming back online:** badge immediately switches back to "Live," a success toast confirms it, and — since the poll/Realtime logic checks `navigator.onLine` before every attempt — normal syncing simply resumes on its own next cycle, with no manual action needed.

### 7.4 Realtime Connection Recovery

If the live Realtime connection is ever lost (network blip, server restart, anything), the app:
1. Immediately falls back to the 5-second polling cycle described below, so updates keep arriving (just slower) even while the live connection is down.
2. Automatically attempts to reconnect the live connection every **10 seconds**, silently, in the background, until it succeeds — at which point polling stops again and Realtime takes back over.

### 7.5 Polling Recovery (the fallback mechanism itself)

When Realtime isn't connected, the Office app doesn't just blindly re-fetch everything every 5 seconds — it's built to be efficient about *detecting* that something changed before doing the expensive work of fetching it:

1. Every 5 seconds, ask for just two small pieces of information: the single most-recently-modified job's timestamp, and the total current job count.
2. Compare both numbers to what was seen last time.
3. **Only if either number has changed** does it go and fetch the actual changed rows (everything modified since the last known timestamp) and process them into notifications/UI updates.
4. This same lightweight "has anything changed at all?" check is what keeps the fallback from being wasteful, even though it's running every 5 seconds continuously.

### 7.6 Engineer App Recovery

The Engineer app has no live connection to lose, so its "recovery" is simpler: if a request fails, the relevant action shows an error toast and the user can retry manually (or wait for the next scheduled 30-second/15-second cycle to naturally try again). Its one extra safety net is completely local and doesn't involve the network at all: unsaved text typed into a notes box is periodically written to the browser's own local storage as a draft, specifically so that if the app is closed or crashes before a real save reaches the database, the typed text isn't lost when it's reopened.

### 7.7 Upload Failure Recovery

Photo uploads are not automatically retried if they fail partway through (e.g. connection drops mid-upload). The engineer sees a specific "❌ File failed" toast naming which file in a multi-file batch failed, while any other files in the same batch that succeeded are kept — a failed upload does not roll back or discard successful ones from the same action, and the failed one simply has to be manually re-attempted.

---

## 8. Every Scenario, Walked Through

### 8.1 Office creates a job; a second office computer has the Jobs screen open

The first computer's `POST` completes and Supabase's Realtime service pushes an `INSERT` event out over the open WebSocket connection. The second computer's `handleRealtimeChange()` receives it, adds the job straight into its own in-memory cache, and — because the Jobs page happens to be the currently active screen — calls `renderJobs()` to redraw the list. The second staff member sees the new job appear with no action of their own, typically within well under a second.

### 8.2 Office creates a job while genuinely offline

The `fetch()` call fails immediately (no network). The write's `_pendingSaves` counter is decremented back down, the "Offline" badge appears, and — critically — **the job is not saved anywhere and is not queued to retry automatically.** There is no offline-write queue in this system. If the browser tab is closed or refreshed before connectivity returns, that job's data is gone and would need to be re-entered by hand. (The only thing softening this is the unrelated 5-second job-form autosave-to-`localStorage` draft feature, which would preserve *typed form field values*, but only if the same job modal is reopened again before the draft expires or is overwritten.)

### 8.3 Engineer marks a job Complete with no signal

Same underlying failure as 8.2 — the `PATCH` fails, an error toast appears, and the status change is **not** applied anywhere, including not locally (the app doesn't optimistically show it as Completed before confirming the server accepted it). The engineer sees the job still showing its previous status and would need to try again once they have signal — commonly, this means waiting until they're back in range and manually re-tapping the status button, or using pull-to-refresh once connectivity looks restored to confirm the true current state before retrying.

### 8.4 Two office staff open the exact same job and both edit different fields, saving a few seconds apart

Whoever saves first writes successfully and — since a full job save writes the *entire* form, not just changed fields — the second person's save will overwrite the first person's changes to any field the second person's form still had the old value for, even in fields they personally never touched, because their copy of the form was loaded before the first person's save happened. If the second person happens to still have the modal open when the first person's change arrives via Realtime, they get the "updated by someone else" warning banner — but nothing stops them from saving over it anyway if they proceed. This is the sharpest edge case in the whole conflict-prevention story (Section 4): the warning is advisory, not blocking.

### 8.5 An engineer uploads a job photo; office deletes the job moments later, before ever seeing it

The photo file and its `attachments` database row are both written successfully by the Engineer app; deleting the job does not touch either. The photo becomes a permanent orphan — technically still sitting in Storage and still listed in `attachments` pointing at a `jobid` that no longer matches any real job — invisible in every app's normal interface from that point on, since every screen that shows attachments looks them up starting from a job.

### 8.6 A client has the portal open; office marks their invoice Paid while they're looking at it

The client's page does not update. They continue to see "Awaiting Payment" until they manually reload the page — there is no indication anything changed, and no prompt suggesting they refresh. If they proceed to submit an unrelated new job request during this window, that action still works fine (it's a fresh write, not dependent on the stale invoice data they're looking at) — only the display is stale, not their ability to interact.

### 8.7 The Office app's Realtime connection drops mid-session (e.g. laptop briefly loses wifi) and comes back a minute later

The badge shows "Reconnecting…"/"Offline" during the gap; the 5-second poll fallback keeps the Jobs screen roughly current (up to 5 seconds behind) throughout the outage; a reconnect attempt fires automatically every 10 seconds in the background; once one succeeds, the badge returns to "Live," polling stops, and the app is back to instant updates — all without the user needing to refresh the page or do anything themselves.

### 8.8 An admin deletes a landlord's `persons` record while that landlord's portal link is open in their browser

If they already had the page loaded before the deletion, nothing happens immediately — their already-loaded data stays visible (Section 8.6's staleness applies here too). If they reload the page, or open the link fresh, after the deletion, they now get the portal's "Not Found — this link is invalid" screen, with no more specific explanation than that.

### 8.9 Office sends an urgent broadcast alert to a specific engineer who is currently offline (app closed / phone off)

The alert row is written successfully to `engineer_alerts` with its normal one-hour expiry countdown starting immediately from the moment it was sent — **not** from whenever the engineer eventually sees it. If the engineer doesn't open their app again until, say, 90 minutes later, the alert has already expired and its polling query (which explicitly filters to non-expired alerts) will no longer return it at all — the engineer never sees that alert, silently, with no record on their end that they missed anything.

### 8.10 Two jobs are created in the same second from two different apps (e.g. office creates one manually while, at the same moment, an engineer submits their own new job via "Add New Job")

Both apps independently run the same "scan existing job numbers, take the highest, add one" logic (Section 5) at nearly the same instant, based on whatever the database looked like a moment before either write happened. In the rare case both reads happen before either write completes, **both could compute the same "next" number**, and both would then save successfully with that duplicate number, since job numbers are not enforced as unique by the database itself — only the underlying `id` (which is always freshly and independently generated per job, in different formats depending on which app created it, per the Business Rules document Section 15) is guaranteed unique. The practical result would be two distinct job records, each with the same human-readable `jobnum`, which would be confusing on any report or search but would not cause either write to fail or corrupt the other job's data.

---

*This document describes the synchronization behaviour exactly as implemented in the current code — including the gaps (no offline queue, no field-level locking, no delete cascade) — rather than how a more robust version of this system might ideally behave. Where a scenario in Section 8 describes a real risk, cross-reference the Database Handbook's Recommendations appendix for the suggested fix.*
