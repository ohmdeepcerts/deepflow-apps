# 25 — Master Excel Export: Phase 0/1 Data Audit

Written before any export code changed, per the "Step Zero — audit before writing code" requirement
of the Master Excel Export spec. Every fact below was checked directly against the live Supabase
project (`dzqyqpuhxdrrpipbehpk`) or the real source in this repo — nothing here is assumed. Where the
spec's own assumptions turned out to be wrong for this specific system, that's called out explicitly
rather than silently worked around.

## 0. Company handling (decided)

Verified live: `select table_name,column_name from information_schema.columns where column_name ilike
'%company%'` returns **zero rows** in the whole `public` schema. There is no `company_id` anywhere —
DeepFlow is a single-company system today (OHM Electrical Engineering Ltd), and multi-tenancy is
already tracked as a separate, deliberately deferred piece of work
(`docs/planning/24-multi-tenant-kickoff-prompt.md`).

**Decision (confirmed with Mandeep):** build for a single company now. Every exported row still carries
a `Company` column (populated from `S.coName`, Settings → Company Name) so the workbook's shape doesn't
change the day real multi-company data exists — but no OHM-vs-Company-B split sections, no per-company
VAT-vs-non-VAT dashboard block, no company-scoped filenames. That entire slice of the original spec is
out of scope until `company_id` is real.

## 1. Financial source of truth — the spec's own assumption doesn't hold here

The spec says: *"If DeepFlow stores Subtotal/VAT/Total/Paid, Excel displays those authoritative values.
Do not recalculate."* `invoices` does have `subtotal`, `vat_rate`, `vat_amount`, `total`, `paid_amount`
numeric columns. Checked their real fill rate across all 590 invoices:

| column | non-null/non-zero rows | verdict |
|---|---|---|
| `total` / `subtotal` | 368 / 590 (62%) | unreliable — 38% would show £0 |
| `paid_amount` | **0 / 590 (0%)** | dead column, never written, on every invoice including all 171 marked "Paid" |
| `items` (jsonb line items) | 590 / 590 (100%) | complete |

So the stored numeric columns are **not** the authoritative source in this system, despite existing.
The real authoritative definition is what Office itself shows when you open an invoice: `calcInvTotal()`
→ `calcLineItemsTotal(items, officeVatRate(S))` (`packages/business/invoice-total.js`) — computed from
line items against the **current** global VAT rate setting (`S.vatRate`), not a per-invoice stored rate.

**Decision:** the export computes every invoice total the exact same way, via the same shared
`calcLineItemsTotal`/`officeVatRate` functions from `@business` — not by reading `total`/`subtotal`. This
is what "reconciles with DeepFlow" actually means for this codebase: matching what Office shows right
now for that invoice, not a stored snapshot that 38% of rows don't even have.

**Paid vs Outstanding:** since `paid_amount` is always 0 and the `payments` table has only 3 rows against
590 invoices, there is no granular partial-payment tracking in real use. Status is a plain 3-value
enum today (`Draft` 46, `Awaiting Payment` 373, `Paid` 171 — no `Part Paid`, no `Credit Note`, no
`Cancelled` invoice status exists in real data, though the UI supports more). Outstanding = `0` if
`status==='Paid'`, else the full computed total. Payment method/date/reference come from the `payments`
table where a row exists (rare); otherwise blank/"Unknown" per the spec's own rule — never guessed.

## 2. Job classification (certificate-only vs additional work) — real signal found

`jobs.certtypes` is a real `jsonb` array of cert-type codes. The code→definition table already exists
and is the app's own authoritative source (`apps/office/main.js:470-474`):

| code | name | keywords used elsewhere in the app to detect this cert type from free text |
|---|---|---|
| ct1 | Gas Safety | gas, boiler, heating, gas safety, gas check, gas service |
| ct2 | Electrical (EICR) | electrical, electric, eicr, rewire, fuse, consumer unit |
| ct3 | Fire Alarm | fire alarm, smoke detector, fire, alarm |
| ct4 | Emergency Lighting | emergency light, emergency lighting, emerg light |
| ct5 | PAT Testing | pat, pat test, appliance test, portable appliance |

No existing "certificate-only vs additional work" classifier exists anywhere in the app (confirmed —
zero matches for any such helper). Real sample data shows the ambiguity the spec anticipated:
`certtypes:[ct2]` + `description:"Consumer unit supply and fit"` is installation work wearing a cert
code; `certtypes:[ct2]` + `description:""` is a plausible cert-only job but an empty description is
also just as plausibly an engineer who didn't fill it in.

**Classification rule being built for the export (new, documented here since nothing reusable exists):**
a job is `CERTIFICATE ONLY` if its `description`/`notes`/`trade` text contains **no** tokens outside the
matched `certtypes`' own keyword lists (or is empty); `ADDITIONAL WORK` if it contains repair/install
vocabulary (replace, install, repair, fault, upgrade, fit, supply and fit, snagging, etc.) beyond the
cert keywords; anything that doesn't cleanly resolve either way is `Needs Review` and listed in Data
Quality — never guessed, per the spec's own instruction.

## 3. Status / lifecycle facts (verified against real data)

- `jobs.status` real distribution: Invoiced 3,902, Pending 192, Completed 53, In Progress 3, Cannot
  Access 2, Engineer Completed 1. **Zero Cancelled jobs exist today**, though `STATUS.CANCELLED` is a
  fully wired status (`packages/business/status.js`). The existing legacy export
  (`apps/office/master-xlsx-export.js`) applies no status filter — Cancelled jobs (if any existed) would
  already appear; the new export preserves that (never silently drops a job for its status), matching
  the spec's "never drop records" rule.
- `ENGINEER_COMPLETED` is deliberately excluded from every "completed" business-stat check elsewhere in
  the app (job isn't finalized until Office reviews it to `Completed`) — the export's KPIs follow the
  same rule for consistency with Office's own numbers.
- Invoice `type`/`invoicetype` real values: only `landlord` and `agency` — no credit notes or proformas
  exist in real data today, though the UI (`credit-notes.js`) supports them. The export handles those
  types generically (never crashes/drops on them) without needing bespoke real-data verification yet.

## 4. Relational data quality — what's reliable, what isn't

- **`jobs.client_person_id`** is written on every job save (`_resolveLandlordPerson`,
  `apps/office/main.js:3705`). **`jobs.client_agency_id`**, and **both FK columns on `invoices`**, are
  only populated inconsistently (only when an agency is present at save time — never backfilled
  historically). **Decision:** the export treats the free-text `landlordName`/`agencyName`/`agentName`
  fields as primary (these are complete back to the earliest records); the FK id columns are used only
  as a supplementary link where present, never relied on as the sole join key.
- **`properties`** (3,431 rows, `jobs.property_id` FK) is real and populated by the Phase 1 records
  rearchitecture — the "Properties" sheet is genuinely buildable from canonical data, not address-string
  grouping.
- **`properties.landlord_name`/`agency_name`** are themselves free text, not FK ids — so even the
  canonical property table can't guarantee a clean join to a `persons`/`agencies` row by id, only by
  name match. Documented as a Data Quality caveat, not silently patched over.
- **Duplicate-property detection** exists but is interactive-only: `_checkDuplicateProperty()`
  (`apps/office/main.js:3542`) fuzzy-matches a new address at save time and asks staff to confirm —
  nothing scans the stored 3,431 properties afterward for likely duplicates. The export's Data Quality
  sheet adds the first **batch** duplicate scan (reusing the same `normAddr`/fuzzy-score logic) — new,
  not previously existing, per the spec's explicit request for this exact gap.
- **`agents` table has 1 row** against 56 `agencies` and 810 `persons` — "which agent gave this job" is
  almost entirely carried by the free-text `jobs.agentName`, not a real FK-linked entity. Exported as-is;
  blank/"Unassigned" where absent, never invented.

## 5. Confirmed dead / unused columns (Data Quality will note these, not hide them)

- `invoices.paid_amount` — 0% fill rate, see §1.
- `agencies.portal_enabled`, `persons.portal_enabled`, `*.last_portal_access` — zero references anywhere
  in `apps/office`; no UI toggle exists. Not usable for the Clients sheet's "Portal Active" column as
  literally specified — that column will instead reflect whether a `portal_activation_tokens`/
  `portal_sessions` row exists for the entity (the mechanism actually in use), with the caveat documented
  inline.
- `payment_chase_state` table exists (schema-ready) but has **0 rows** — chase-up is 100% manual/
  untracked today (no field, log, or notes convention anywhere). The spec's "Chase-Up" columns
  (Last Chase, Chased By, Next Action, Comments) will be present but **blank with a Data Quality note**
  ("no structured chase history exists yet") rather than fabricated from invoice notes.

## 6. Reusable authoritative definitions (from real Office code, not reinvented)

- **Certificate status** (`apps/office/certs-stats-dashboard.js:26-38`): Expired = `daysDiff(expiryDate)
  < 0`; Expiring = `0 ≤ daysDiff ≤ 60` (configurable due-soon windows `_cw1`/`_cw2` also exist for a
  30/60 split); Current = `daysDiff > 60`; Missing = `!expiryDate && !noExpiry`; certs with `noExpiry`
  are their own bucket, never counted as "missing." **Superseded certs are excluded from all current-
  state counts** (`.filter(c=>!c.supersededBy)`) but kept in the full Certificates sheet as history,
  labeled `(superseded)` — this is Office's own existing rule for exactly this split, reused verbatim.
- **"Project"** = a job with 2+ `job_visits` rows sharing its `jobId` (`planner-projects.js:32`) — not a
  stored flag. The export groups visits the same way; there is no separate "project id," the job's own
  id/jobnum is the anchor.
- **Job numbering** (`apps/office/numbering.js`) is RPC-sequence-based with collision re-checking; no
  per-company prefix exists (single `S.jobPrefix`, default `'JOB-'`).
- **Engineer roster** lives in `app_settings.__all__.engineers` (not a DB table) — one entry per
  engineer: `{name, phone, rate, dayRate, hourlyRate, costRate, otRate, wa, trade, capacity}`. Engineer
  Summary sheet joins `jobs.engineer` (free text) against this list by name.

## 7. Library decision: SheetJS → ExcelJS

The current export (`apps/office/master-xlsx-export.js`) loads SheetJS (`xlsx.full.min.js` 0.18.5) from
a CDN at runtime. Its own `styleSheet()` helper only sets column widths — the free/community build of
SheetJS does not support writing cell fill colors, fonts, merged-cell styling, real conditional
formatting, or internal hyperlinks on `.xlsx` output. None of the spec's styling requirements (green/red
job rows, KPI dashboard, cross-sheet hyperlinks, freeze panes, Excel tables) are achievable with the
currently-loaded library.

**Decision:** replace it with **ExcelJS**, added as a real `devDependencies`/`dependencies` package
(not a runtime CDN load) — full support for fills, fonts, borders, merged cells, internal hyperlinks,
freeze panes, number formats, and Excel Tables in the open-source build, which covers every spec
requirement except native charts (ExcelJS's chart support is unreliable) — matching the spec's own
fallback instruction to prioritize accurate data/styling over shaky chart hacks.

## 8. What this replaces

`apps/office/master-xlsx-export.js`'s existing `exportMasterXLSX()` has a genuine accuracy bug in
production right now: it sums the `payments` table (3 rows total) to compute "Paid £" per invoice, which
is wrong for essentially every real invoice (see §1) — every Paid invoice shows as £0 paid / fully
outstanding in today's export. This is being replaced, not patched, by the new export service.

## 9. Sheet → source mapping (abbreviated — full detail lives in the Workbook Builder code itself)

| Sheet | Primary source | Key derived fields |
|---|---|---|
| Export Audit | query counts at export time | queried vs exported row counts per table, reconciliation pass/fail |
| Data Quality | jobs/invoices/certs/properties cross-checks | missing invoice link, unclassified job, duplicate-property candidates, dead-column notes |
| Dashboard | aggregates of all sheets below | KPIs, agency/engineer/cert summary blocks, nav hyperlinks |
| Daily Jobs | `jobs` (+ `job_visits` for Projects) | date→engineer grouping, cert-only/additional-work colour, Unassigned bucket |
| Landlords | `persons` (role landlord/client) + `jobs` + `invoices` | totals via §1 computation, payment status, chase columns (blank+flagged, §5) |
| Agency Summary + one sheet per agency | `agencies` + `jobs`/`invoices` matched by `agencyName` | per-agency job/financial rollup, safe deterministic sheet-name generator (31-char Excel limit) |
| Certificates Dashboard / Certificates | `certs`, §6 rules | by-type counts, current/expiring/expired/missing, superseded history |
| Properties | `properties` (3,431 real rows) + `jobs.property_id` | job/cert counts per property, no address-string re-grouping |
| Invoices & Payments / Outstanding | `invoices` + `payments` | §1 computed totals, never stored `total`/`paid_amount` |
| Engineer Summary | `jobs.engineer` + `app_settings.engineers` | job counts, cert-only vs work split, avg jobs/day |
| Clients | `persons`+`agencies`+`agents` (no existing unified list — built new, §4) | job/invoice/outstanding rollup per entity |

## 10. Status (updated after the full build pass)

All 13 worksheet types the spec requires now exist and are wired into `export-workbook-builder.js`:
00 Dashboard, 01 Daily Jobs, 02 Landlords, 03 Agency Summary + one real worksheet per agency,
Certificates Dashboard, Certificates, Properties, Invoices & Payments, Outstanding, Engineer Summary,
Clients, Data Quality, Export Audit — built in that order (Dashboard's worksheet is reserved first so
it's physically sheet 1, but its content is written last, once every sheet it links to/summarizes
exists — same dependency order the spec itself mandates). 184 tests pass (166 unit + 18 integration),
including a golden-dataset test that builds a real 14-sheet workbook from a fixed fixture, re-reads the
actual `.xlsx` bytes, and checks real cell values/colours/hyperlinks/reconciliation — not a mock.

Every sheet-builder's reconciliation pair (tracked in `export-workbook-builder.js` and shown on the
Export Audit sheet) is a genuine check — each is computed from an independently pre-filtered array
compared against an actual per-row counter incremented during the write loop, not the same number
echoed twice. Verified `findDuplicateProperties()`'s O(n²) candidate scan is not a real performance risk
at current real scale (3,431 properties, ~88% with a postcode to bucket by) — `fuzzyScore()` itself is
a cheap linear greedy pass, not full edit-distance, so the whole scan is sub-second — but this should be
revisited if property count grows an order of magnitude.

**Not yet done / real remaining gaps:**
- No live browser click-test has been possible — this needs a real Office login, which the assistant
  building this will never do (password handling is out of bounds). Needs a real user test pass.
- No native Excel charts (per the spec's own fallback guidance, correct data took priority) — the
  Certificate monthly-forecast table exists without a chart.
- Job Number → real DeepFlow job route hyperlinks not added (spec says "only if stable URLs exist" —
  not yet confirmed one does for a specific job id in this app).
- No "Exports" history page/list in Office (spec's optional recommendation) — Export Audit metadata is
  the only record kept today, plus the new Activity Log entry on every export.
- Not stress-tested against the full real dataset (4,153 jobs / 590 invoices / 679 certs / 3,431
  properties / 56 agencies) end-to-end in a live browser — only unit/integration-tested and reasoned
  about for complexity.
- Company/date-range filter UI exists but only Daily Jobs actually respects the date range (deliberate,
  see §"Date-range scoping" in `export-data-service.js` — every financial rollup sheet stays all-time to
  avoid a misleading partial balance).
