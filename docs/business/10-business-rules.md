# 10 — Business Rules Catalog

This document extracts every real conditional business rule found in DeepFlow's **current** source
code — every "if this, then that," every threshold number, every permission check — across all
three apps (`apps/office`, `apps/engineer`, `apps/portal`) and the shared `packages/business`
module. Every rule below is grounded in a specific file and line number so it can be verified or
changed directly. Where the code has changed underneath a rule since it was last documented, that
history is called out explicitly, because "why does it do that" usually has a git-log answer.

**This replaces the old `docs/13_Business_Rules.md`.** That document is stale on several load-bearing
points — some rules it describes were deliberately redesigned, some were bugs that have since been
fixed, and some settings it described as enforced turned out never to have been wired up (or have
since been wired up). Each section below says explicitly where this document disagrees with the old
one and why.

**Cross-references:** end-to-end user journeys built from these rules live in
[`docs/business/11-workflows.md`](11-workflows.md) (not yet written); the full role/permission matrix
lives in [`docs/architecture/08-authentication-and-roles.md`](../architecture/08-authentication-and-roles.md)
(not yet written — Section 4 here is a summary only); table/column definitions live in
[`docs/architecture/05-database.md`](../architecture/05-database.md) (now written — see it for the
full schema). The fabricated-expiry-date data-quality item described in the old doc's context for
Section 2.4 turned out to be moot by the time of writing — see that section for why (short version: a
full production data reset on 2026-08-06 wiped the affected records along with everything else).

---

## 0. How to Read This Document

Every rule cites a file and, where useful, a line number or line range, e.g.
`apps/office/main.js:2949`. Line numbers are accurate as of commit `9604cdb` (2026-08-06) — the
tip of `main` at the time this document was written — and will drift as the file changes; the
function/variable name given alongside each citation is the more durable anchor.

Client-side-only caveat (still true, carried forward from the old doc): almost every rule below is
enforced in the browser, not by the database. There is no backend re-checking most of these rules
server-side. Read every rule as "this is what the app's interface does," not "this is what is
unbreakably enforced," unless a rule explicitly says otherwise (a Postgres RPC, an Edge Function
auth check, or an RLS policy).

---

## 1. Job Status & Lifecycle Rules

### 1.1 The Seven Statuses (not six)

The status enum, defined once and shared by all three apps and `@business`:

```js
// packages/business/status.js:12-20
export const STATUS = Object.freeze({
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  ENGINEER_COMPLETED: 'Engineer Completed',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CANNOT_ACCESS: 'Cannot Access',
  CANCELLED: 'Cancelled',
});
```

**This is a correction to the old doc**, which documented "The Six Statuses" (`13_Business_Rules.md`
§2.1) — that was accurate until `ENGINEER_COMPLETED` was added on 2026-08-05 (commit `6b053f7`,
"Add Engineer two-stage job completion"). `tests/unit/business.test.js:12-27` locks the full
seven-value enum and asserts it's frozen (`Object.isFrozen(STATUS)`), so a call site can't silently
mutate a shared status string.

### 1.2 The Two-Stage Completion Handoff (why `ENGINEER_COMPLETED` exists)

This is the single most important workflow change in the current codebase and is worth explaining
in full, because it's a deliberate design, not an accident of two apps evolving separately.

**The problem it solves:** before this existed, an engineer tapping "Done" on their phone
immediately set a job to literal `Completed` — and `Completed` is the status that fires certificate
and invoice automation (§1.3, §2.2, §3.3). That meant an engineer's own, unreviewed word that a job
was finished was enough to trigger a client-facing certificate placeholder and a draft invoice, with
no office review step in between.

**The fix:** the Engineer app no longer sets `Completed` directly. It sets the intermediate status
`Engineer Completed` instead:

- `apps/engineer/main.js:986` — the job-card "✅ Done" quick-action button calls
  `quickStatusUpdate(id, STATUS.ENGINEER_COMPLETED)`, never `STATUS.COMPLETED`.
- `apps/engineer/main.js:1300` — the job-detail status-pill row's "✅ Complete" button is wired to
  the same target status.
- `apps/engineer/main.js:1006` — while in this state, the job's status pill explicitly reads
  "✔ Awaiting Office Review", not "Done" — the UI itself signals this isn't final.

Office staff then review the job and — only when satisfied — explicitly finalize it via the
**status dropdown or the right-click context menu's "✅ Mark Completed (Finalize)"** action
(`apps/office/main.js:11336`, alongside a separate "🔷 Mark Engineer Completed" item at
`main.js:11335` for the reverse/manual case). That finalization is a normal `quickStatus(id,
'Completed')` call — no special code path.

**Why the two statuses collapse back into one trigger cleanly:** the automation gate in
`_applyStatusChange()` (`apps/office/main.js:2925`) is:

```js
if(status===STATUS.COMPLETED && old!==STATUS.COMPLETED) onJobComplete(j);
```

This checks only the *destination* status and that it's genuinely new — it does not care what the
*prior* status was. So finalizing a job from `Engineer Completed` → `Completed` fires
`onJobComplete()` through the exact same code path as finalizing directly from `Pending` or
`In Progress` → `Completed`. No special-casing was needed to make the two-stage flow work with the
existing automation — that was a deliberate design property, not a coincidence.

**Why it exists (the business reason):** office needs a quality-assurance gate before certificate
placeholders and auto-invoices go out on a job they haven't personally reviewed. An engineer saying
"I'm done" on-site is a signal, not a sign-off.

**Business-stat exclusion:** a job sitting in `ENGINEER_COMPLETED` is deliberately excluded from
every "completed"/"invoiced" business-stat check across the codebase (revenue, completion rate,
missing-invoice audits) because it isn't finalized yet — it's simply a different string than
`STATUS.COMPLETED`, so any check written as `job.status===STATUS.COMPLETED` naturally excludes it
with no extra code. Confirmed concretely at `apps/office/main.js:7751`, the Reports page's
"Completion Rate" KPI:

```js
const completedJobs=period.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).length;
```

— counts `Completed` or `Invoiced` (a job auto-invoiced flips from `Completed` to `Invoiced` within
seconds, per §3.3, so both must count as "done" — see the comment at `main.js:7744-7750` explaining
that fix), but never `Engineer Completed`.

### 1.3 What Happens Automatically the Moment a Status Becomes `Completed`

- **Rule:** `onJobComplete(j)` (`apps/office/main.js:2949`) fires automatically, exactly once, the
  instant a job's status changes *to* `Completed` *from something else* — same guard shown in §1.2.
  Re-saving an already-`Completed` job does not re-trigger it.
- It runs cert auto-detection/placeholder-creation synchronously, then schedules
  `autoInvoice(j)` via `setTimeout(...,1400)` (§3.3) — deliberately delayed so certificate writes
  finish first — then refreshes the Invoices page's "smart banner" via
  `setTimeout(updateInvSmartBanner,2000)`.
- **This rule fires identically no matter which app changed the status.** The trigger lives inside
  `_applyStatusChange()` in the Office app, reacting to a PATCH the Office app itself just made —
  the Engineer app never calls `onJobComplete` and, per §1.2, never even reaches `Completed`
  directly.

### 1.4 Engineer App: A Real State Machine (`STATUS_FLOW`)

Unlike the Office app (§1.5), the Engineer app enforces a genuine allow-list of transitions,
defined at `apps/engineer/main.js:1261-1269`:

```js
const STATUS_FLOW={
  'Pending':            ['In Progress','Cannot Access'],
  'In Progress':        [STATUS.ENGINEER_COMPLETED,'Cannot Access'],
  'Engineer Completed': ['In Progress'], // engineer can reopen if marked done by mistake
  'Completed':          [],           // LOCKED — finalized by the office, no going back
  'Cannot Access':      ['In Progress'], // office can reassign but engineer can re-attempt
  'Invoiced':           [],           // LOCKED
  'Cancelled':          []            // LOCKED
};
```

- **Rule:** `updateStatus(status, btn)` (`apps/engineer/main.js:1312`) checks the target status
  against `STATUS_FLOW[currentJob.status]` and refuses with a toast (`🔒 Cannot change from "X" to
  "Y"`) if it isn't in the allowed list — this is a genuine client-side state machine, not "any
  status can follow any status."
- **What's locked to an engineer:** `Completed`, `Invoiced`, and `Cancelled` all have an empty
  allowed-transitions list — once the office finalizes, invoices, or cancels a job, an engineer's
  app cannot move it anywhere. `_statusButtons()` (`main.js:1271-1310`) renders an explanatory
  banner instead of buttons for these three terminal states (e.g. "This job has been completed and
  finalized… Contact the office if changes are needed").
- **What an engineer *can* reverse:** `Engineer Completed` → `In Progress` (they marked done by
  mistake) and `Cannot Access` → `In Progress` (re-attempting after being turned away).
- **Server-side re-check before applying:** `updateStatus()` re-fetches the job's live status from
  Supabase immediately before patching (when online) and aborts with a toast if someone else
  changed it in the meantime (`main.js:1329-1347`) — narrows, but does not eliminate (no DB
  constraint backs it), a race between two devices.

### 1.5 Office App: Still No Formal State Machine

- **Rule:** `_applyStatusChange(id, status)` (`apps/office/main.js:2902`), the function every
  Office-side status change funnels through (`quickStatus()` for one job, bulk-set-status for many),
  contains exactly one check: `if(old===status) return true;` (no-op skip). **Nothing prevents an
  Office user from moving a job from any status to any other status**, including backwards — e.g.
  the right-click context menu (`main.js:11328-11340`) offers all of `Engineer Completed`,
  `Completed`, `In Progress`, `Cannot Access`, `Invoiced`, `Cancelled` as options regardless of the
  job's current state. This is unchanged from the old doc's §2.2 and is a deliberate asymmetry: the
  office is trusted with full control; an engineer's phone is not (§1.4).

### 1.6 "Confirmed" Is a Separate Flag From Status

Unchanged from the old doc: a job carries an independent `confirmed` true/false flag
(`quickConfirm`), unrelated to `status` — represents "has the client/tenant confirmed the
appointment," tracked alongside the main status, not instead of it.

### 1.7 Job Numbering — Now Has a Real Atomic Path, With a Fallback

- **Rule (updated from old doc):** `nextJobNum(prefix)` (`apps/office/main.js:3099`) first tries a
  Postgres RPC (`rpc/next_job_num`, or `rpc/next_cr_num` for the `CR-` prefix used by portal job
  requests) — an atomic, database-side sequence. **Only if that RPC call fails** (the SQL that
  creates it hasn't been run on this project yet — see `PHASE3_NUMBERING_SEQUENCES_SQL.md` at repo
  root) does it fall back to the old "scan every existing job number with this prefix, take the
  highest, add one" approach (`main.js:3134-3146`). The old doc described only the scan-based
  method as if it were the only one; the atomic path now exists in code but its real-world
  availability depends on whether that SQL migration has actually been applied to the live project
  (not verified as part of this document — check via `mcp_supabase` `list_migrations`/`execute_sql`
  if this matters for a specific deployment).
- **Prefix rule (unchanged):** default prefix `JOB-`, 4-digit pad; portal-submitted job requests get
  a `CR###` reference — no hyphen, 3-digit pad (e.g. `CR007`), confirmed against `nextJobNum('CR')`
  in `apps/office/main.js` and its parser regex `/^CR(\d+)$/i` — via the same dual-path mechanism.
  See [`docs/business/14-certificate-and-invoice-numbering.md` §3.2](14-certificate-and-invoice-numbering.md#32-portal-submitted-client-requests--cr)
  for the full numbering reference, including a related gotcha (§3.3) where a standalone-proforma's
  auto-created job was misleadingly *named* like it might get a `PR-` series but never actually did.

### 1.8 Manual Sort Order, Realtime Conflict Rules

Unchanged from the old doc §2.6–2.7: jobs on the same day can be manually drag-reordered
(`_sortOrder`, a real sort key after date/time-slot); a job open in someone's edit modal that
receives a live update from elsewhere shows a warning toast and border flash rather than silently
overwriting in-progress edits.

---

## 2. Certificate Rules

### 2.1 Certificate Types, Validity, and Reminder Windows (Shipped Defaults)

Verified current against `apps/office/main.js:207-215` (`S.certTypes`):

| Certificate Type | Validity | Reminder Starts | Prefix | Notes |
|---|---|---|---|---|
| Gas Safety | 12 months | 30 days before expiry | `GAS-` | |
| Electrical (EICR) | 60 months (5 yr) | 60 days before expiry | `EICR-` | |
| Fire Alarm | 12 months | 30 days before expiry | `FIRE-` | |
| Emergency Lighting | 12 months | 30 days before expiry | `EML-` | |
| PAT Testing | 12 months | 30 days before expiry | `PAT-` | `hasAppliances:true` — see §2.7 |
| EPC | 120 months (10 yr) | 90 days before expiry | `EPC-` | |
| Legionella | 24 months | 60 days before expiry | `LEG-` | |

These numbers are unchanged from the old doc and match today's code exactly. An Admin/Manager can
add/edit types and these numbers in Settings → Trades; each type also carries a keyword list used
for auto-detection (§2.2).

### 2.2 Automatic Certificate-Type Detection

- **Rule:** every cert type has keywords (e.g. Gas Safety → `gas, boiler, heating, gas safety, gas
  check, gas service`). At the moment a job is marked `Completed`, `onJobComplete()`
  (`apps/office/main.js:2949-2985`) lower-cases the job's description and checks it against every
  type's keyword list; any match adds that type to the set of certs to create. **This is additive**
  to whatever cert types were manually ticked on the job (`selectedIds` starts from
  `j.certTypes||[]`, keywords are added on top, never replace).

### 2.3 Duplicate Certificate Prevention

- **Rule:** `createCertEntry()` (`apps/office/main.js:3055-3067`) checks for an existing cert with
  the same `jobId` + same `type` before creating one (falls back to `address` + `type` matching if
  the caller has no real job id). If found, the call is a silent no-op.

### 2.4 Placeholder Certificate Creation — Fixed Bug (2026-08-06)

This is the most important correction in this section, and directly supersedes old doc §4.7/§2.3.

**What it used to do (bug):** the moment a job was marked `Completed`, `onJobComplete()` created a
placeholder certificate **and fabricated an expiry date** — `today + that cert type's validity
period` — even though no actual inspection had happened and no certificate PDF existed yet. To
anyone viewing that record (including a client in the Portal), a certificate with a real,
already-valid expiry date looks exactly like a certificate that was actually issued. It wasn't —
the placeholder was created purely because a keyword matched a job description or a box was ticked
on the job form.

**Current (fixed) behavior**, per `apps/office/main.js:2962-2985`:

```js
// Create placeholder certs silently — no modal, no asking — so office has
// a record that this job owes a certificate. Previously this also guessed
// an expiry date (today + the cert type's validity period) even though no
// actual inspection had happened yet and no PDF existed — that fabricated
// date looked like a real, already-valid certificate to anyone viewing it
// (including the client, in the Portal), when in fact nothing had been
// issued. Leaving expiryDate blank correctly routes these into the
// Certificates dashboard's existing "Missing Dates" tab instead...
```

- The placeholder cert is created with `expiryDate:''` and `noExpiry:false` (explicit — see
  `createCertEntry`, `main.js:3070-3083`, called with `noExpiry` argument `false` at `main.js:2976`).
- `noExpiry:false` + blank `expiryDate` is exactly the condition the Certificates dashboard's
  "Missing Dates" tab filters on: `!c.expiryDate && !c.noExpiry` (`apps/office/certs.js:1043,
  1211`) — so every auto-created placeholder now correctly surfaces there instead of silently
  looking "done." Office fills in the real issue/expiry date once the certificate is actually ready.
- `noExpiry:true` remains reserved for a genuinely different meaning: a certificate an office
  *deliberately* marks as never expiring (e.g. a one-off inspection with no renewal cycle) —
  distinguished by `createCertEntry.js:3049-3054`'s comment on the difference between "not known
  yet" (auto-creation path) and "reviewed and deliberately has none" (explicit skip-modal path).

**Known data-quality consequence — now moot, confirmed by direct query:** the original expectation
going into this fix was that roughly 12 real certificates already in production had been created
before it and still carried old fabricated expiry dates. That is no longer checkable, and no longer
matters: `certs` currently has **0 rows** (`select count(*) from certs` against the live project,
`dzqyqpuhxdrrpipbehpk`, run while writing this document), because a full production data reset
happened on 2026-08-06 (same day as this fix — see
[`docs/architecture/05-database.md`](../architecture/05-database.md) §1, which independently
confirms every table except `app_settings` and `users` is currently empty). Whatever fabricated-date
certificates existed were wiped along with everything else. **This is a correction to what this
document was originally briefed to report** — the "~12 certs with fabricated dates" data-quality
item does not need tracking in `docs/security/18-known-issues.md` as a live issue; it's historical.
The code fix itself remains real and current regardless: any certificate created from now on, in
this or any future reset, gets a blank `expiryDate` rather than a fabricated one.

### 2.5 Reminder Threshold Rule (Dashboard)

- **Rule:** `S.certWarnDays` (default 30, `apps/office/main.js:3499`) — certs expiring within this
  many days (and not yet expired) show as "expiring soon" on the Dashboard/Certificates screen.
  `S.certWarnDays2` (default 14) is a second, closer threshold used to visually distinguish "soon"
  from "very soon" bands in the cert dashboard stat tiles (`apps/office/certs.js:1204`).
- A separately-installed, scheduled server-side reminder function (60/30/14/7/1-day thresholds) was
  not found defined in `supabase/migrations/` at the time of writing — consistent with the old
  doc's finding that it wasn't installed on the live project; this document does not re-verify
  whether it has since been installed on any specific deployment.

### 2.6 Certificate Numbering — Two Separate Schemes (Real, Not a Simplification)

There are genuinely **two different, independently-triggered** certificate numbering mechanisms in
the current code. Conflating them would misdescribe the system, so they're kept separate here.

**Scheme A — auto-created placeholder certs** (from `onJobComplete()` → `createCertEntry()`,
§2.4), when no number is manually supplied:

```js
// apps/office/main.js:3069
const autoNum=certNum||(ct.prefix||'CERT-')+String(_pendCertJob.jobNum||'').replace(/\D/g,'')+'-'+String(Date.now()).slice(-4);
```

i.e. `<type prefix>` + digits pulled from the job number + the last 4 characters of the current
timestamp. Always active — no setting gates this path.

**Scheme B — the manual "Add Certificate" form**, and the newer, opt-in universal reference-number
generator (added 2026-08-05, `apps/office/certs.js:50-131`), used only when a cert is saved via
`saveCertForm()` with no reference number typed in **and** an admin has opted in by setting
`S.certRefSerial` in Settings (empty by default — auto-numbering off until then):

```js
// apps/office/certs.js:126-131
async function generateCertRef({address,appliances,hasAppliances,issueDate}){
  const base=await _nextCertBaseRef();
  const middle=hasAppliances?String((appliances||[]).length):_ddmmUnpadded(issueDate);
  const tag=addressRefPart(address);
  return tag?`${base}0${middle} / ${tag}`:`${base}0${middle}`;
}
```

Built from four pieces, in order:

1. **`base`** — an ever-incrementing serial (`S.certRefSerial`), *shared across every certificate
   type*, so no two certs of any type on any day ever land on the same base. This is what actually
   guarantees uniqueness — everything after it is decoration, not the uniqueness guarantee.
   `_nextCertBaseRef()` (`certs.js:116-124`) advances it with `_incStr()` (`certs.js:72-75`, which
   increments the trailing digit run and preserves its width — `"GBE1009"` → `"GBE1010"`, not
   `"GBE10010"`), then double-checks the chosen base against every existing `certNum` in the
   database (not just what this session has seen) before committing, and persists the new value via
   `saveAllSettings()`.
2. **A literal `"0"`** separator.
3. **`middle`** — for cert types with `hasAppliances:true` (currently only PAT Testing, §2.7), this
   is the appliance count on the certificate, as a string. For every other type, it's the issue
   date's day+month concatenated with no leading zeros and no separator (`_ddmmUnpadded()`,
   `certs.js:104-109` — e.g. 4 August → `"48"`).
4. **`tag`** — a short "[business name] door-number street" fragment extracted from the property
   address (`addressRefPart()`, `certs.js:83-99`), appended after a ` / ` separator if the address
   parsed to something non-empty.

This entire scheme (including `addressRefPart`'s parsing algorithm and `_incStr`'s digit-increment
behavior) is ported near-verbatim from the standalone PAT-TEST app it was generalized from, and was
verified against all 8 real historical PAT-TEST reference numbers migrated into this database —
every one decodes back to exactly this format (`certs.js:79-82`).

**Important:** Scheme B never overwrites a number on an edit-save (`saveCertForm()`,
`certs.js:480`: `if(!certNum&&!isEdit&&S.certRefSerial)`), and it is completely separate code from
Scheme A — a certificate auto-created by `onJobComplete()` always gets a Scheme-A number regardless
of whether `S.certRefSerial` is set; Scheme B only ever fires from the manual Add-Certificate form.

### 2.7 PAT (Portable Appliance Testing) Certificates — Behave Differently by Design

PAT is the one certificate type that tracks individual appliances rather than a single pass/fail —
worth a full section here (a dedicated deep-dive doc,
`docs/business/13-pat-certificates.md`, does not yet exist, so this section covers it fully).

- **The core rule:** cert types flagged `hasAppliances:true` in `S.certTypes` (currently only PAT
  Testing) get a working appliance-test-log editor (`_certAppliances`, `apps/office/certs.js:31-36`)
  shown/saved alongside the certificate, persisted as a `certs.appliances` JSONB array — each entry
  is `{id, assetId, description, testInstrument, date, retestPeriod, nextTest, result}`. Every
  other cert type keeps its `appliances` array empty and ignored (`certs.js:475, 495`).
- **PDF generation is a deliberate exception to the app's usual approach:** every other PDF in
  DeepFlow (invoices) is drawn as vector text (`packages/ui/pdf-vector.js`). PAT certificates
  instead render real HTML/CSS pages, screenshot them with `html2canvas` at scale 2.5, and assemble
  the images into a PDF with `jsPDF` — one page-image per A4 page
  (`packages/ui/pat-template.js:182-214`, `buildPatCertificatePages`/`renderPatCertificatePDF`).
  This was a deliberate choice, not an oversight: matching the source PAT-TEST app's exact pixel
  layout was the actual requirement, and screenshotting the same CSS was the only reliable way to
  guarantee that instead of re-matching it by eye in a different rendering system (comment,
  `pat-template.js:1-9`).
- **Pagination rule:** page 1 holds up to 14 appliance rows (`DEFAULTS.rowsP1`), continuation pages
  hold up to 24 (`DEFAULTS.rowsPN`) — a description that wraps to multiple lines (17-char wrap
  width, `wrapTxt()`, `pat-template.js:18-29`) counts as multiple "rows" against that cap. Page 1
  pads with blank rows all the way to its cap (so a lightly-populated cert still looks like a full
  form); a continuation page only pads up to 3 blank rows, to avoid an almost-entirely-empty sheet
  (`pat-template.js:144-152`).
- **Tamper-evidence hash:** every PAT PDF embeds a deterministic hash (`certVerifyCode()`,
  `pat-template.js:37-47`) of the cert's key facts (ref number, address, issue date, appliance
  count, fail count) in the PDF's hidden `keywords` metadata field, so a later dispute can check
  whether the visible appliance count/pass-fail split still matches what was actually issued.
- **Company Profiles — per-cert-type issuing identity override:** a certificate type can be
  assigned its own issuing company identity (name/address/logo/VAT number/etc.) instead of the main
  Company Profile — e.g. a PAT testing operation trading under a different business name.
  `resolveCompanyProfile(certType)` (`apps/office/main.js:11238-11253`) resolves this: if the cert
  type has a `companyProfileId` set and that profile still exists in `S.companyProfiles`, its fields
  are used; otherwise every cert type falls back to the main Company Profile fields
  (`S.coName`/`coAddr`/etc.), unchanged behavior for any type that's never had a profile assigned.
  `S.companyProfiles` is empty by default (`main.js:216-221`).
- **Renewal flow — "start a new test cycle," not just "book a follow-up job":** unlike the generic
  `createRenewalJob()` (`certs.js:1974-1985`, which just books a follow-up `Pending` job on today's
  grid for any cert type), PAT certs get a dedicated renewal path,
  `openRenewCertModal()`/`renewCert()` (`certs.js:1997-2033`): it opens the Add Certificate form
  pre-filled with the same property/client details **and the source cert's full appliance list**
  carried forward — descriptions/instrument/retest-period copied verbatim, `date` reset to today,
  `result` reset to `'Pass'` (nothing has actually been retested yet; office/engineer corrects any
  failures after the real test), and `nextTest` recalculated from each appliance's retest period. An
  optional "new starting asset ID" input can renumber the whole carried-forward list sequentially.
  It never auto-saves — office reviews and hits Save themselves, same as any other cert.
- **AI photo-scan extraction** (`supabase/functions/extract-cert-data/index.ts`): two distinct
  extraction modes behind one Edge Function, gated by a `mode` field in the request body —
  `mode:'cert'` (default) reads a photographed certificate's header fields (cert number, type,
  issue/expiry date, property address); `mode:'appliances'` reads a photographed (often handwritten)
  PAT appliance log — asset ID, description, and pass/fail per row — deliberately *not* asking for
  instrument/date/retest-period per row, since those are almost always constant across a whole paper
  sheet rather than written per appliance, so the caller fills them in once via bulk-add defaults
  instead of guessing them per row (`index.ts:34-41`). Tries Gemini first (multimodal — one call
  reads the image and returns structured JSON); falls back to OCR.space (text-only, no field
  extraction) if the caller's AI-extraction setting is off, `GEMINI_API_KEY` isn't configured, or
  the Gemini call fails for any reason (`index.ts:91-101`). Requires a valid Supabase Auth JWT —
  this is one of the few genuinely server-enforced checks in the system (`index.ts:80-84`).

### 2.8 Manual vs. Automatic Certificate Emailing (added 2026-08-05)

- **Rule:** `_maybeEmailCertReady(certId, pdfUrl, {manual})` (`apps/office/certs.js:1652-1687`)
  fires automatically the moment a certificate PDF is uploaded/generated
  (`uploadCertPdf()`, `certs.js:1637`), **unless** `S.certAutoEmail` has been explicitly set to
  `false` in Settings → Certificates (default: on — `S.certAutoEmail!==false`,
  `main.js:7991`). When auto-send is off, the certificate is still generated/stored; it just isn't
  emailed until someone clicks the explicit **"Send to Client"** button
  (`sendCertToClient()`, `certs.js:1692-1701`), which works regardless of the `certAutoEmail`
  setting — so a manual-mode office can still send on demand, and an auto-mode office can resend.
- **Recipient resolution:** prefers the certificate's own `.email` field; most certs created
  straight from a job never have that filled in, so it falls back to the linked job's
  `landlordEmail`/`agencyEmail` (`certs.js:1656-1660`). If no email can be found at all, the send
  is skipped with `reason:'no-email'` — no error thrown, no email attempted.
- **PDF attached, not just linked:** the actual PDF is fetched and base64-attached (up to 15MB;
  larger falls back to a link-only email with a console warning, `certs.js:1662-1674`) — the
  download link is also always included in the email body as a fallback.
- **Every outcome is logged, not just successes:** a successful send, a "no email on file" skip,
  and a genuine send failure are each written to `logActivity()` under the `'cert'` type
  (`certs.js:1682, 1685`), so office staff can see in the Audit Trail exactly what did or didn't go
  out and why.

### 2.9 Invoice-Side Email Audit Trail (`invoice_audit`, added 2026-08-05)

A dedicated table, `invoice_audit`, records every invoice-related email/state event — separate from
the general `audit_log` table (which tracks job deletions and status changes, per
[`docs/architecture/05-database.md`](../architecture/05-database.md)). Confirmed write sites:

- `apps/office/main.js:7150` — a failed invoice-email send: `{action:'failed', details:'Email to
  … failed: …'}`.
- `apps/office/main.js:7155` — a successful invoice-email send: `{action:'sent', details:'Emailed
  to … (CC: …)'}`.
- `apps/office/main.js:3477` — a proforma-to-invoice conversion: `{action:'converted', from:
  'proforma', to:<new invoice number>}`.

Each row is timestamped and carries `invoiceId`, `user` (the logged-in `_appUser.name`, or
`'System'` for automated actions), and action-specific `details`. Read back and rendered per-invoice
at `apps/office/main.js:5517` (`invoice_audit?invoiceId=eq.…&order=timestamp.desc`) — this is the
"Invoice Email Trail" tab visible in Settings → Data (`main.js:8998`) alongside the general Audit
Log (`main.js:8997`).

---

## 3. Invoice & VAT Rules

### 3.1 Jobs Are Priced Per-Job — Hourly Billing Was Removed (2026-08-03)

**Correction to the old doc**, which described an hours × hourly-rate invoice-line-construction
priority order (old doc §5.4) plus an "Hours" field on the job form. That entire subsystem was
deliberately deleted:

```
d3f2816  Remove hourly billing and hours-tracking — jobs are priced per-job, payroll is contract-based
90209bf  Remove Hours field from job form — jobs are priced per-job, not hourly
```

Confirmed in the current auto-invoice line-item builder — a single flat-price line, no hours logic
anywhere in it:

```js
// apps/office/main.js:3214-3216
// Jobs are priced per-job, not per-hour — one line item at the job's price.
const jobPrice=Number(j.price)||0;
const items=[{desc:j.description||'Labour',qty:1,unit:jobPrice,vat:true}];
```

`jobs.price` is a single flat number; there is no hours field on the job form or in the invoice
line-building logic anymore.

**A genuine remnant does still exist**, and is worth flagging rather than silently omitting: the
**P&L Dashboard's Engineer Wages cost estimate** still references a per-job `hours` value that no
UI can populate anymore:

```js
// apps/office/main.js:13905-13911
const WAGE_FALLBACK_HOURS=4;
let totalWages = 0;
pJobs.forEach(j => {
  if(j.engineer && S.engineers){
    const eng = S.engineers.find(e => e.name === j.engineer);
    if(eng && eng.dayRate) totalWages += +eng.dayRate;
    else if(eng && eng.rate) totalWages += +eng.rate * (Number(j.hours)||WAGE_FALLBACK_HOURS);
  }
});
```

For an engineer configured with an hourly (not day) rate, this multiplies by `j.hours` if present,
else falls back to a hardcoded `WAGE_FALLBACK_HOURS=4`. Since no code path writes `j.hours` anymore
(the field was removed from the job form in `90209bf`), this branch will, in practice, **always**
use the 4-hour fallback for any job created after 2026-08-03 — the "use actual logged hours" half of
this code is now dead weight left over from before the hours-removal, quietly downgraded to "always
assume 4 hours." This does not affect invoicing (§3.1's flat-price line item is unaffected) — it
only affects the P&L Dashboard's wage *cost estimate*, which was already explicitly labelled an
estimate. Worth a cleanup pass, not urgent.

### 3.2 Invoice Numbering — Landlord vs. Agency Series, Proforma, Credit Notes

- **Regular invoices:** `nextInvNum(isAgency)` (`apps/office/main.js:3275-3302`) uses a genuinely
  separate numbering series depending on who's billed — `S.invPrefix` (default `INV-`) for
  landlord-billed jobs, `S.agencyInvPrefix` (default `AGN-`) for agency/agent-referred jobs. Like
  job numbering (§1.7), it tries an atomic Postgres RPC first (`rpc/next_inv_num` /
  `rpc/next_agn_num`), falling back to the scan-highest-then-increment method if that RPC isn't
  installed.
  - **A real historical bug, now fixed:** `_autoInvoiceInner()` used to call `nextInvNum()` with no
    argument at all, so every auto-created invoice always landed on the landlord `INV-` series
    regardless of who the job was actually for. Fixed at `main.js:3226` —
    `number:await nextInvNum(!!(j.agencyName||j.agentName))`.
- **Proformas:** `nextProformaNum()` (`main.js:3309-3322`) uses a fixed `PF-` prefix, 3-digit pad
  (`PF-001`), via its own RPC (`rpc/next_proforma_num`) with a scan-based fallback reading directly
  from existing `type='proforma'` rows.
- **Credit notes:** built in `apps/office/credit-notes.js:saveCreditNote()` (`credit-notes.js:78-119`),
  numbered `(S.invPrefix||'INV-') + 'CN-' + <original invoice number with the prefix stripped>` —
  e.g. `INV-CN-1042`. **A minor correction to the old doc:** the old doc stated a credit note is
  "flagged `status:'Credit Note'` + `isCreditNote:true`." The current code only ever sets
  `status:'Credit Note'` on creation (`credit-notes.js:93`) — `isCreditNote` is never actually
  assigned `true` anywhere in the codebase (confirmed by repo-wide search); every place that filters
  on `i.isCreditNote` (e.g. `main.js:5567, 6392, 6542, 12421`) only ever matches through the
  `status==='Credit Note'` half of that OR condition in practice. Not a functional bug — status is
  the real discriminator everywhere it's checked — but the `isCreditNote` flag as described in the
  old doc is effectively dead/unset code, not a second source of truth.
- **Proforma → real invoice conversion:** `convertProformaToInvoice()` (`main.js:3466-3480`)
  generates a brand-new real invoice number at conversion time (the `PF-###` number is never
  reused), flips `type:'proforma'→'invoice'`, resets `status:'Draft'`, and stamps
  `proformaConverted:true`/`convertedAt` for traceability. Logged to `invoice_audit` (§2.9).

### 3.3 Automatic Invoice Creation on Completion

- **Trigger:** `onJobComplete()` → `setTimeout(()=>autoInvoice(j), 1400)` (`main.js:2988`) — 1.4
  seconds after a job becomes `Completed`, deliberately after certificate creation so certs finish
  writing first.
- **Guard conditions, all must hold:**
  1. `S.autoInvOnComplete` is not explicitly `false` (`autoInvoice()`, `main.js:3170`).
  2. No invoice already references this job by `jobId` or `linkedJobId` (checked twice — once at
     the top of `_autoInvoiceInner()`, `main.js:3183`, and again immediately before the write at
     `main.js:3256`, to narrow — not eliminate, no DB constraint backs it — the window for two
     near-simultaneous triggers).
  3. A billable client can be identified: `j.agencyName || j.agentName || j.landlordName ||
     j.referrer` (`main.js:3191`) — agency/agent name takes priority (they're who's actually billed
     for agency-referred work). If none of the four exist, nothing is created, with a toast
     explaining why (`main.js:3210`) — **fixed from a prior silent no-op** that gave no indication a
     job had no invoice because it had no billable party on it at all.
  4. If no matching `persons` record exists for that billed name, one is created on the spot from
     whatever landlord/agent/agency contact fields are on the job (`main.js:3195-3205`), so the
     auto-invoice always has somewhere to attach.
- **Line items (confirmed, §3.1):** exactly one line — `{desc: j.description||'Labour', qty:1,
  unit: Number(j.price)||0, vat:true}`.
- **Real edge case — a job with no price produces a genuine £0 line item.** If `j.price` is unset
  at the moment of completion (e.g. office hasn't priced the job yet), the auto-created Draft
  invoice's single line item is £0, and its grand total is £0. This is a real, known, and currently
  *accepted* state — not a bug being asked to be fixed here — because the invoice still needs to
  exist as a placeholder office can price later. What changed (2026-08-06) is how it's *displayed*:
  - **Client Portal** (`apps/portal/main.js:1023-1053`, `vInvoices()`): a Draft invoice whose
    calculated total is exactly zero is now detected (`const pending=inv.status==='Draft' &&
    t.grand===0;`, `main.js:1030`) and rendered as **"Invoicing in progress"** instead of "£0.00" —
    showing a genuine zero to a client previously read as an error, not a work-in-progress state
    (comment, `portal/main.js:1027-1029`). The Preview/Pay action buttons are also suppressed for a
    pending invoice (`main.js:1049-1050`).
  - **Office App** shows the real £0 draft as-is on the Invoices screen — office is expected to see
    and price it; only the client-facing Portal needed the friendlier treatment.
- **On success:** the job's `status` is flipped to `Invoiced` and `linkedinvid` set via a raw
  (non-`dPut`) PATCH — note this bypasses the usual camelCase→snake_case column mapping, so the
  literal DB column name `linkedinvid` is used directly (comment at `main.js:3259-3264` documents a
  prior real bug here: sending `linkedInvId` instead silently failed the whole PATCH because
  PostgREST rejected the unknown column, and the `.catch()` swallowed it — invoices were created but
  jobs never flipped to `Invoiced`). A PDF is generated and stored in the background
  (`generateAndStoreInvoicePDF`).
- **Not auto-emailed:** creating the draft never sends anything to the client — see §3.5 on why
  `S.invEmailAuto` doesn't actually gate this (it's a dead setting).

### 3.4 VAT Calculation Rule, Including a Real, Documented App-to-App Divergence

The shared math (`packages/business/invoice-total.js`):

```js
// calcLineItemsTotal — used byte-for-byte by both apps
export function calcLineItemsTotal(items, vatRate) {
  let sub = 0, vat = 0;
  (items || []).forEach((i) => {
    const line = (i.qty || 1) * (i.unit || 0);
    sub += line;
    if (i.vat) vat += (line * vatRate) / 100;
  });
  return { sub, vat, grand: sub + vat };
}
```

- **Per-line, not blanket:** every line item carries its own `vat:true/false`; the invoice total is
  the sum of every line's price plus VAT calculated only on VAT-flagged lines — not one VAT rate
  applied indiscriminately to the whole invoice.
- **VAT-rate *resolution*, however, genuinely diverges between the two apps** — confirmed still
  real and current, and deliberately *not* unified (comment, `invoice-total.js:1-6`, describes this
  was found via `tests/unit/business.test.js`, written before extraction, specifically to prove
  today's actual behavior including this divergence):

  ```js
  // Office App — S.vatRate||20 treats an explicit 0% as falsy, wrongly
  // falling back to 20%. Preserved exactly, not fixed, by this extraction.
  export function officeVatRate(S) {
    return S.vatEnabled !== false ? S.vatRate || 20 : 0;
  }

  // Client Portal — vatRate??20 correctly treats an explicit 0% as real.
  export function portalVatRate(S) {
    return S?.vatEnabled !== false ? (S?.vatRate ?? 20) : 0;
  }
  ```

  `tests/unit/business.test.js:74-81` locks the exact divergence: with `{vatEnabled:true,
  vatRate:0}`, `officeVatRate()` returns `20` (wrong — an admin who explicitly configured 0% VAT
  sees 20% applied in the Office App) while `portalVatRate()` correctly returns `0`. This is a real,
  currently-live latent bug in the Office App specifically, flagged and preserved (not silently
  fixed) by the Phase 3 extraction that pulled this math into `@business` — the extraction's stated
  rule was "relocate logic, don't change it."
- **Where each is wired up:** Office App's `getVatRate()` (`apps/office/main.js:3158`) is a thin
  wrapper: `function getVatRate(){return officeVatRate(S);}` — kept as a wrapper rather than a
  rename because 13 call sites in `main.js` reference it by that name. Portal's `_portalVatRate()`
  (`apps/portal/main.js:59`) is the equivalent thin wrapper around `portalVatRate(S)`.
- **Default rate:** `S.vatRate` defaults to `20`; `S.vatEnabled` defaults to `false` in the shipped
  settings object (`apps/office/main.js:232` — `vatRate:20,vatEnabled:false`), meaning VAT is
  **off by default** for a brand-new install until explicitly turned on in Settings.

### 3.5 A Dead Setting: `S.invEmailAuto`

Worth documenting precisely because it looks like it should do something and doesn't. `S.invEmailAuto`
is a real setting (default `true`, `apps/office/main.js:252`), has a real Settings-page checkbox
bound to it (`main.js:8030`), and is included in the settings-save whitelist (`main.js:9207`) — but
a repo-wide search finds **no code anywhere that reads `S.invEmailAuto` to gate an actual send.**
Auto-created invoices (§3.3) are never auto-emailed regardless of this setting; sending an invoice
email is always the explicit, manual `sendInvEmail()` action (`main.js:7134`) via the "Send" button.
This is the same "configured but not enforced" pattern the old doc found with `S.engPerms` (see
§4.3 — that one has since been partially fixed; this one has not).

### 3.6 "Missing Invoice" Detection — Two Independent Mechanisms With Different Thresholds

Worth separating carefully; the old doc's §5.9 described these as one rule with one threshold. They
are, in the current code, two separate mechanisms:

- **The Invoices page "smart banner"** (`updateInvSmartBanner()`, `main.js:629-649`) and its
  companion bulk action **"Create drafts for all completed jobs"** (`createDraftsForCompleted()`,
  `main.js:656-681`) both flag *every* `Completed` job with no linked invoice, with **no day-count
  threshold at all** — a job completed five minutes ago with no invoice yet shows up immediately.
- **The notification-bell / dashboard reminder preview** (`renderNotifPreview()`,
  `main.js:3513-3529`) applies a real threshold, `S.missingInvDays` (default 3,
  `main.js:3503`): a completed-and-uninvoiced job only counts toward this specific "Missing
  invoices" reminder count once it's been at least that many days since the job's date
  (`main.js:3526`).

Both mechanisms exist and are both real; they just serve different purposes (an always-visible
work-queue on the Invoices page itself, vs. a delayed "this has been sitting too long" reminder) and
should not be conflated into a single threshold when describing the system.

### 3.7 Overdue Rule

Unchanged from the old doc: an invoice counts as overdue when `status==='Awaiting Payment'` **and**
it has a `dueDate` **and** that date is before today. `S.invReminderDays` (default 7,
`main.js:3501`) is the separate "how many days overdue before this is an *urgent* reminder"
threshold used by the notification preview (`main.js:3524`).

### 3.8 "Fully Paid" and Credit-Note/Proforma Rules

Unchanged from the old doc's §5.7 and §5.11–5.12 in substance; see §3.2 above for the corrected
credit-note field detail (`isCreditNote` never actually set) and the confirmed proforma-conversion
numbering behavior.

---

## 4. Role & Permission Rules (Summary — Full Matrix in a Separate Doc)

The complete role/permission matrix (pages visible per role, Settings tab visibility per role,
per-user `can_edit`/`can_delete`/`can_invoice`/`can_finance`/`see_*` flag semantics, and the
Engineer-app equivalents) belongs in
[`docs/architecture/08-authentication-and-roles.md`](../architecture/08-authentication-and-roles.md)
(not yet written). This section only covers what's genuinely new or corrected since the old
`13_Business_Rules.md` was written, so a reader isn't misled by the old doc's headline claims in the
meantime.

### 4.1 Correction: `pinLock` No Longer Bypasses Permissions

The old doc's §1.1 ("The Master Switch") and §0 ("The One Rule That Governs All the Others") both
described `getUserPerm()` as beginning with `if(!S.pinLock || !_appUser) return true;` — meaning
turning the PIN lock off made every permission check return `true` for everyone. **This is no
longer true.** The current implementation:

```js
// apps/office/main.js:1689-1715
// Get current user's permissions — always evaluated against the real logged-in
// user's role/flags. This is intentionally NOT gated on S.pinLock: whether a
// login prompt is shown and what a logged-in user is allowed to do are two
// separate questions, and conflating them previously meant turning pinLock off
// silently granted every permission to everyone, regardless of role.
export function getUserPerm(perm){
  if(!_appUser) return false;
  ...
}
```

`S.pinLock` now only controls whether the login overlay is shown at startup (`main.js:9498`). If it's
off and no one is logged in, the app no longer signs in as a real named user at all — it builds a
synthetic, minimal-trust guest identity with **every** `can*`/`see*` flag defaulted to `false`
(`main.js:9507-9512`, comment: "must NEVER silently sign in as a real staff member — that was a
genuine security bug"). This is a materially different, already-fixed security posture from what the
old doc described, and worth knowing before repeating the old doc's headline warning.

### 4.2 Emergency/Protected Admin Rule (unchanged)

`PROTECTED_ADMINS`/`EMERGENCY_ADMINS` (`main.js:8845-8846`) — a hardcoded pair of email addresses
that always resolve to Admin, cannot be demoted via the UI (`main.js:8857, 8893`), and are always
visible to Managers even though Managers otherwise can't see Admin accounts in Team (`main.js:323,
327`). Same rationale as before: the business owner can never be locked out by an accidental
permission change.

### 4.3 Correction: Per-Engineer Field-Visibility (`engPerms`) Is Now *Partially* Enforced

The old doc's §1.12 stated the Engineer app's source "contains zero references to `engPerms`
anywhere" and that this configuration "currently has no effect." **That has since been partially
fixed.** The Engineer app now loads and applies per-engineer overrides:

```js
// apps/engineer/main.js:413-427
// Per-engineer visibility permissions (Office app → Settings → Job Controls
// → Engineer Visibility Controls). Was configured there but never actually
// read/enforced anywhere in this app — every engineer saw everything
// regardless of what an admin had toggled off for them.
...
const override=(engId&&s.engPerms&&s.engPerms[engId])||{};
fields.forEach(f=>{ _engVisPerms[f]=override[f]!==undefined?override[f]:globalDefaults[f]; });
```

But **only 3 of the 6 configurable fields actually gate anything in the rendered UI** — confirmed by
searching every use of `_engVisPerms` in the file:

| Field | Actually enforced? | Where |
|---|---|---|
| `seeNotes` | Yes | `apps/engineer/main.js:1095` — gates the job description/"Details" block |
| `seeLandlord` | Yes | `apps/engineer/main.js:1113` — gates the Landlord section |
| `seeAgent` | Yes | `apps/engineer/main.js:1121` — gates the Agency section |
| `seePrice` | **No** | loaded into `_engVisPerms` but the Engineer app never renders `j.price` anywhere, gated or not |
| `seeTenant` | **No** | loaded but no gating usage found |
| `seeInvoice` | **No** | loaded but no gating usage found |

So this is neither "fully enforced" (as the setting's UI implies) nor "completely inert" (as the old
doc found) — it's a real, partial fix. Worth knowing precisely which three fields actually do
something before telling an office admin their per-engineer price/tenant/invoice visibility toggle
works.

### 4.4 A Likely-Dead Expression Worth Flagging: `seePrice` Default

`apps/office/main.js:341`, building each Office user's default permissions from Supabase:

```js
seePrice: local.seePrice !== undefined ? local.seePrice : isAdmin||true,
```

`isAdmin||true` evaluates to `true` unconditionally regardless of `isAdmin`'s value — the `isAdmin||`
portion has no effect. Not a security issue (the *default* for every role ends up `true` either
way, which — combined with per-user override support — matches the old doc's stated intent that
Staff `seePrice` defaults to `true` unless explicitly turned off), just a piece of dead-looking logic
worth a cleanup pass.

---

## 5. Cross-Cutting Notes

### 5.1 Settings Are Still All-or-Nothing

Unchanged from the old doc: company settings, invoice preferences, WhatsApp templates, certificate
types, company profiles, the properties list, and per-engineer permission overrides are all stored
inside one JSON blob per `app_settings` row (`key='__all__'`, `_pushAllSettingsToDb()`,
`main.js:364-391`). Saving any one setting re-saves the entire blob.

### 5.2 Duplicate-Invoice Guard Is Check-Then-Write, Not Atomic

Unchanged in substance from the old doc: §3.3 above documents the current double-check
(`main.js:3183` and `3256`), which narrows but does not eliminate a near-simultaneous double-trigger
race — no database constraint backs it.

---

*Every rule in this document was extracted directly from the current application source across all
three apps and `packages/business`, cross-checked against `tests/unit/business.test.js` where a test
exists, cross-checked against a live query of the production database
(`dzqyqpuhxdrrpipbehpk`) where a claim depended on current data rather than code, and dated against
`git log` where a specific change explains the current behavior. Line numbers are accurate as of
commit `9604cdb` (2026-08-06) and will drift with future edits — treat the named function/variable as
the durable anchor. See [`docs/README.md`](../README.md) for the full documentation index.*
