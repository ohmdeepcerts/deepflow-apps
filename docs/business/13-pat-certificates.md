# 13 — PAT Certificates Deep Dive

PAT (Portable Appliance Testing) is one of DeepFlow's seven certificate types (`S.certTypes`,
`apps/office/main.js:207-215`), but it's structurally unlike the other six. A Gas Safety, EICR, Fire
Alarm, Emergency Lighting, EPC, or Legionella certificate is a single pass/fail record for a property.
A PAT certificate tracks a whole **log of individually-tested electrical appliances** at that
property — each with its own asset ID, description, test instrument, test date, retest period, and
Pass/Fail result.

This entire subsystem — the appliance log's data shape, the PDF layout, the reference-number
algorithm, even the AI photo-scan prompt design — was ported from a standalone predecessor app,
referred to throughout the current code's own comments only as **"the standalone PAT-TEST app"**
(GitHub: `ohmdeepcerts/PAT-TEST`, same org as this repo). Historical PAT-TEST certificate reference
numbers were migrated into DeepFlow's database as part of this work (§7) — the current
reference-number algorithm was verified against them, not designed from scratch.

**A note on scope, read before relying on anything below:** the code comments and this document's own
investigation confirm the source app's name as `ohmdeepcerts/PAT-TEST` and confirm real historical
reference numbers were migrated in. They do **not** contain the words "Firebase" or "OHM PAT MANAGER"
anywhere in this repo (source code, comments, or the ~40 root-level `*.md` planning documents) — a
repo-wide search for both terms turned up nothing. If PAT-TEST was in fact Firebase-backed and called
"OHM PAT MANAGER," that's true information this repo simply doesn't carry evidence of; §7 documents
exactly what the code *does* confirm, and no more.

The five ported pieces, each covered in full below:

1. [Company Profiles](#1-company-profiles--per-cert-type-issuing-identity) — issue a cert type under a different company identity
2. [The appliance test log](#2-the-appliance-test-log-certsappliances) — `certs.appliances`, CRUD, calculated next-test dates
3. [AI photo-scan extraction](#3-ai-photo-scan-extraction) — turning a photo of a paper log into appliance rows
4. [PDF generation](#4-pdf-generation-html2canvas--jspdf-not-vector) — html2canvas + jsPDF, deliberately not vector text
5. [The renewal flow](#5-the-renewal-flow--starting-a-new-test-cycle) — starting a new test cycle, carrying appliances forward
6. [Universal certificate reference numbers](#6-universal-certificate-reference-numbers-brief) — PAT-shaped, generalized to every cert type (brief — full treatment lives in [`10-business-rules.md`](10-business-rules.md))
7. [Historical PAT-TEST migration](#7-historical-pat-test-migration) — what's verifiable, what isn't

---

## 1. Company Profiles — per-cert-type issuing identity

**The problem this solves:** GB Electrical's main Company Profile (`S.coName`/`S.coAddr`/`S.coEmail`/
etc., set once in Settings → Company) is the identity every certificate and invoice is issued under —
except PAT testing may be carried out and certified under a *different* trading identity. Company
Profiles let one specific certificate **type** (built primarily for PAT, but not hardcoded to it) be
issued under an alternate company name/address/logo/VAT number instead.

### Data shape

```js
// apps/office/main.js:221 — empty by default
companyProfiles: []

// One profile, added via addCompanyProfileRow() (main.js:11213-11217):
{
  id: 'a1b2c3...',       // uid()
  name: 'New Company',
  address: '', email: '', phone: '',
  vatNum: '', regNum: '', website: '',
  logoUrl: '',            // data: URL, set via uploadProfileLogo() (main.js:11219-11231)
}
```

A cert **type** (`S.certTypes[]` entry) opts into a profile via one field, `companyProfileId`, set
from the Settings → Trades & Services → Certificate Types table's dropdown
(`apps/office/main.js:8134-8137`):

```html
<!-- main.js:8134-8137 -->
<select onchange="S.certTypes[i].companyProfileId=this.value||null">
  <option value="">— Default —</option>
  <!-- one <option> per S.companyProfiles entry -->
</select>
```

### `resolveCompanyProfile(certType)` — the fallback logic

```js
// apps/office/main.js:11238-11253
export function resolveCompanyProfile(certType){
  const ct = typeof certType==='string'
    ? (S.certTypes||[]).find(c=>c.id===certType||c.name===certType)
    : certType;
  const profile = ct?.companyProfileId ? (S.companyProfiles||[]).find(p=>p.id===ct.companyProfileId) : null;
  if(profile) return {
    name:profile.name||'', address:profile.address||'', email:profile.email||'',
    phone:profile.phone||'', vatNum:profile.vatNum||'', regNum:profile.regNum||'',
    website:profile.website||'', logoUrl:profile.logoUrl||'',
  };
  return {
    name:S.coName||'', address:S.coAddr||'', email:S.coEmail||'',
    phone:S.coPhone||'', vatNum:S.coVatNum||'', regNum:S.coReg||'',
    website:S.coWeb||'', logoUrl:S.logoData||'',
  };
}
```

- **Input is flexible**: accepts a cert-type *id*, a cert-type *name* (string, matched against both
  `id` and `name`), or an already-resolved `certTypes[]` object — the caller doesn't need to know
  which it has.
- **Fallback path**: if the type has no `companyProfileId`, or that id no longer matches any entry in
  `S.companyProfiles` (e.g. the profile was deleted after being assigned), it falls straight through
  to the main Company Profile fields — `S.coName`, `S.coAddr`, `S.coEmail`, `S.coPhone`, `S.coVatNum`,
  `S.coReg`, `S.coWeb`, `S.logoData`. Every cert type that's never had a profile assigned behaves
  exactly as if this feature didn't exist.
- **`S.coReg`/`S.coWeb` are real settings** (bound in Settings → Company, `main.js:7938-7939`,
  `9145-9146`) even though they aren't present in the default `S` object literal at `main.js:205-264`
  — they simply default to `undefined` until an admin fills them in, same as any other unset setting.
- **The only consumer today**: `generateCertPdf()` (`apps/office/certs.js:1532`) —
  `const profile=resolveCompanyProfile(cert.type)` — passed straight into
  `renderPatCertificatePDF()` (§4). This is currently the only place in the app that reads a resolved
  company identity through this function; invoices and every other document still read `S.co*`
  directly.

---

## 2. The appliance test log (`certs.appliances`)

### Column and shape

`certs.appliances` is a `jsonb` column, default `'[]'` — confirmed against the live schema in
[`docs/architecture/05-database.md`](../architecture/05-database.md) §5. Only populated for cert
*types* with `hasAppliances: true` in `S.certTypes[]` — by default only PAT Testing (`ct5`,
`main.js:212`), but this is a checkbox in Settings (`main.js:8138`), not a hardcoded name check, so
any cert type can opt in.

One appliance entry, real example (also cross-checked against
[`05-database.md`](../architecture/05-database.md) §5):

```json
{
  "id": "b6b6f2a1-3c9d-4e21-9a11-7f3d0c9e2b44",
  "assetId": "0001",
  "description": "Kettle",
  "testInstrument": "Seaward PrimeTest 250",
  "date": "2026-08-01",
  "retestPeriod": 12,
  "nextTest": "2027-08-01",
  "result": "Pass"
}
```

`nextTest` is **calculated, not entered** — `calcNextTest(dateStr, months)`
(`apps/office/certs.js:1738-1745`):

```js
function calcNextTest(dateStr,months){
  if(!dateStr) return '';
  const [y,m,d]=dateStr.split('-').map(Number);
  if(!y||!m||!d) return '';
  const dt=new Date(y,m-1,d);
  dt.setMonth(dt.getMonth()+(Number(months)||12));
  return localDateStr(dt);   // local, not UTC — see @business/dates.js
}
```

`calcNextTest('2026-08-01', 12)` → `'2027-08-01'`. It's recalculated automatically any time `date` or
`retestPeriod` changes (`updateApplianceField()`, below) — a user never types the next-test date
directly; there's no input for it, only a read-only display (`certs.js:1769`).

### CRUD functions (`apps/office/certs.js`)

All of these operate on module-scoped state, `_certAppliances` (`certs.js:36`) — the working copy of
the currently-open certificate's appliance list, reset in `openCertForm()`, populated from the record
being edited, and written back into the `appliances` field on save (`saveCertForm()`,
`certs.js:463-500`).

- **`toggleApplianceSection()`** (`certs.js:1751-1758`) — shows/hides the appliance table section.
  Only shown when *exactly one* cert type is selected **and** that type has `hasAppliances` set —
  a multi-type save (several type chips ticked at once on a new cert) creates one separate cert record
  per type, so there's no single record an appliance log could unambiguously belong to.
- **`addApplianceRow()`** (`certs.js:1778-1791`) — appends a blank-ish row: today's date, a
  hardcoded 12-month `retestPeriod`, `result:'Pass'`. Auto-increments `assetId` from the *last* row's
  trailing digits (`A001` → `A002`); if the log is empty, or the last row's asset ID doesn't end in
  digits, the new row's asset ID is left blank.
- **`updateApplianceField(i, field, value)`** (`certs.js:1793-1799`) — the onchange handler behind
  every appliance-row input. Coerces `retestPeriod` to a number (falling back to 12), and
  recalculates `nextTest` whenever `date` or `retestPeriod` is the field that changed.
- **`removeApplianceRow(i)`** (`certs.js:1801-1804`) — splices the row out, re-renders.
- **`openBulkApplianceModal()` / `submitBulkAppliances()`** (`certs.js:1806-1829`) — a small modal
  taking a starting asset ID and a textarea of descriptions (one per line); each line becomes one row,
  with the asset ID sequentially incremented from the starting value (same trailing-digit convention
  as `addApplianceRow`) and every other field defaulted the same way (today's date, 12-month period,
  Pass). Built for quickly entering a paper log's descriptions without a photo.

### Real-example flow

Adding two appliances by hand on 2026-08-01, one Pass one Fail:

```
addApplianceRow() → { assetId:'', description:'', testInstrument:'', date:'2026-08-01', retestPeriod:12, nextTest:'2027-08-01', result:'Pass' }
updateApplianceField(0,'assetId','0001')
updateApplianceField(0,'description','Kettle')
updateApplianceField(0,'testInstrument','Seaward PrimeTest 250')

addApplianceRow() → assetId auto-increments from '0001' to '0002'
updateApplianceField(1,'description','Extension Lead')
updateApplianceField(1,'result','Fail')
```

**Office-only feature, verified:** a repo-wide search of `apps/engineer/` and `apps/portal/` finds
zero references to `appliances` or `hasAppliances` in either app. The Engineer app never sees or edits
an appliance log, and the Client Portal only ever downloads the finished PDF (§4) — neither app
touches `certs.appliances` directly.

---

## 3. AI photo-scan extraction

The Edge Function is `supabase/functions/extract-cert-data/index.ts` (112 lines) — one function, two
prompts, selected by a `mode` field in the request body. This is confirmed accurate against the actual
source, matching the summary already in
[`10-business-rules.md`](10-business-rules.md#27-pat-portable-appliance-testing-certificates--behave-differently-by-design):
**Gemini first, OCR.space fallback.**

```js
// index.ts:91-92
const wantGemini = preferGemini !== false && !!GEMINI_API_KEY;
const prompt = mode === 'appliances' ? EXTRACT_APPLIANCES_PROMPT : EXTRACT_PROMPT;
```

- **`wantGemini` is false** when the caller explicitly sent `preferGemini:false` (driven by
  `S.aiExtractEnabled` in Settings) **or** the `GEMINI_API_KEY` secret isn't configured on the Edge
  Function.
- **When Gemini is attempted and fails for any reason** (bad response, rate limit, network error),
  the function silently falls through to OCR.space rather than erroring out (`index.ts:94-101`,
  explicit comment: *"Gemini being down/rate-limited shouldn't leave the user with nothing"*).
- **OCR.space is text-only** — no structured field/row extraction, just raw OCR text handed back to
  the caller for the user to read and type from manually. Only attempted if
  `OCR_SPACE_API_KEY` is configured; if neither key is available, the function returns a 503 telling
  the office to add one (`index.ts:111`).
- **The actual Gemini model is `gemini-2.0-flash`** (`index.ts:45`), called with
  `response_mime_type: 'application/json'` so the model returns parseable structured JSON directly,
  no separate parsing step.
- **Auth is genuinely server-enforced** — one of the few such checks in the whole system
  (`index.ts:80-84`): a missing/invalid `Authorization: Bearer <JWT>` header returns 401 before any
  AI call is attempted, verified via `supabase.auth.getUser()` against the service-role client.

### The two prompts are deliberately different shapes

**`mode:'cert'` (default)** — reads a photographed *certificate's* header fields:

```
index.ts:32 — {"certNum","certType","issueDate","expiryDate","propertyAddress"}
```

**`mode:'appliances'`** — reads a photographed (often handwritten) PAT *appliance log*:

```
index.ts:34-41 — {"appliances":[{"assetId","description","result"}]}
```

The appliance-log prompt deliberately does **not** ask for `testInstrument`/`date`/`retestPeriod` per
row — the comment at `index.ts:36-40` explains why: on a real paper log those three values are almost
always the same for the whole sheet (one instrument, one test session, one standard retest period),
not written out per appliance, so asking an LLM to guess/hallucinate them per row would be actively
worse than just defaulting them once. `extractAppliancesFromPhoto()` (below) fills them with the same
defaults `addApplianceRow()` uses, and the office corrects them once if needed.

### Client-side wiring — `extractAppliancesFromPhoto()` (`apps/office/certs.js:1838-1887`)

```js
const res=await fetch(`${SB_URL}/functions/v1/extract-cert-data`,{
  method:'POST',
  headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
  body:JSON.stringify({imageBase64, mimeType:file.type, preferGemini:S.aiExtractEnabled!==false, mode:'appliances'})
});
```

- 10MB file-size cap, image-type check, before ever hitting the network (`certs.js:1842-1843`).
- On a Gemini response: filters out any returned row with neither `assetId` nor `description` (junk
  rows), pushes one `_certAppliances` entry per remaining row with `testInstrument:''`,
  `date:TODAY()`, `retestPeriod:12` and `nextTest` calculated from those, `result` defaulted to
  `'Pass'` unless the model returned an exact `'Pass'`/`'Fail'` string.
- On an OCR fallback response: no rows are added automatically — the raw OCR text is shown inline so
  the office can read the log and add rows by hand (or via Bulk Add, §2).
- Wired to a real, live control: the "📷 Scan From Photo" button inside the *live* certificate form's
  appliance section (`apps/office/index.html:2881`, id `cf2-appliances-section` — the `cf2-*`-prefixed
  form opened by `openCertForm()`/`saveCertForm()`, which is the one and only "Add Certificate"
  button in the app calls, `index.html:2780`).

### A verified dead-code caveat, worth flagging explicitly

The *other* extraction function, **`extractCertFromPhoto()`** (`mode:'cert'`, header-field
extraction, `certs.js:1566-1609`), lives inside a **different, older certificate modal**
(`id="mo-cert"`, `apps/office/index.html:4555-4602`, fields prefixed `cf-*` not `cf2-*`) opened by
`openCertModal()`/`openEditCert()`/`saveCert()`. A repo-wide search for every caller of
`openCertModal(`, `openEditCert(`, and `openModal('mo-cert')` turns up **no reachable trigger
anywhere in the live UI** — the only "Add Certificate" button in the app opens the newer `cf2-*` form
instead (`openCertForm()`, confirmed at `index.html:2780`). This matches a commit message that already
flags exactly this: *"an earlier pass mistakenly targeted the dead mo-cert modal/openCertModal code
path, which is unreachable in production"* (`a6e4209`, Phase 1-2 of the PAT integration).

Concretely, this means:
- `extractCertFromPhoto()`, `openCertModal()`, `openEditCert()`, and `saveCert()` are dead code —
  present in `certs.js`, exported, wired to onclick handlers inside `mo-cert`'s markup, but that
  modal is never opened by anything reachable in the current UI.
- Even if `mo-cert` were somehow opened, its appliance table (`id="cf-appliances-tbl"`,
  `index.html:4581`) wouldn't populate — `renderApplianceTable()` (`certs.js:1760-1776`) only ever
  targets `#cf2-appliances-tbl tbody` (`certs.js:1761`), the *other* form's table id. The two forms'
  appliance sections are not actually interchangeable, despite sharing the same `_certAppliances`
  module state and the same `addApplianceRow()`/`openBulkApplianceModal()` buttons.
- **Practical takeaway for a future change:** if a "scan the certificate's own header fields from a
  photo" feature is wanted on the live `cf2-*` form, it needs to be wired in fresh (a new button
  calling `extractCertFromPhoto()` against `cf2-*` element ids) — the existing function and its modal
  are not a working starting point to extend, only a reference for the extraction logic itself.

---

## 4. PDF generation: html2canvas + jsPDF, not vector

`packages/ui/pat-template.js` (214 lines) renders a PAT certificate as **real HTML/CSS pages,
screenshotted with `html2canvas`, assembled into a PDF with `jsPDF`** — one full-page raster image per
A4 page. This is a deliberate, explained exception to how every other PDF in DeepFlow is built.

### Why not vector, like invoices

`packages/ui/pdf-vector.js` draws the invoice body as real jsPDF vector text and shapes — selectable,
searchable, a few KB per document — with only the decorative masthead rendered as an image
(`pdf-vector.js:1-6`). PAT certificates go the opposite way entirely, and the file's own header
comment states the reason plainly:

```js
// pat-template.js:1-9
// PAT (Portable Appliance Test) certificate template — ported near-verbatim
// from the standalone PAT-TEST app (ohmdeepcerts/PAT-TEST) so the printed
// certificate is unchanged: real HTML/CSS pages captured with html2canvas
// and assembled into a PDF with jsPDF, one page-image per .a4 page — NOT
// drawn as vector text like packages/ui/pdf-vector.js. That's a deliberate
// exception to this app's usual vector-PDF approach: matching PAT-TEST's
// exact pixels was the actual requirement, and a screenshot of literally
// the same CSS is the only way to guarantee that instead of re-matching it
// by eye in a different rendering system.
```

This is a **business requirement, not a technical shortcut**: office staff and clients already know
what a PAT-TEST-issued certificate looks like — pixel-identical output was the actual ask. Re-drawing
the same layout by hand in jsPDF's vector primitives (rectangles, text runs, manual line-wrapping)
would require constantly eyeballing it against the original to catch drift; screenshotting the exact
same CSS the original app's layout was built from removes that entire class of "does it still look
right" risk. The tradeoff accepted in exchange: a PAT PDF is a raster image, not searchable/selectable
text, and is meaningfully larger per page than a vector document — judged an acceptable cost for a
compliance certificate that's printed/viewed as a whole document, not text-searched.

### Pagination

`DEFAULTS` (`pat-template.js:76-81`):

```js
const DEFAULTS = {
  colHeader: '#1e3a5f', colHText: '#ffffff', colRow: '#f8fafc',
  certTitle: 'PORTABLE APPLIANCE TEST REPORT', sigLabel: 'Authorised Signature',
  regText: 'Electricity at Work Regulations 1989', cop: 'IET Code of Practice (5th Edition)',
  rowsP1: 14, rowsPN: 24,
};
```

- **Page 1 holds up to 14 rows**, continuation pages up to 24 — page 1 has less room because it
  carries the header block (logo, company box, landlord/client/address box, engineer/signature box).
- **A description that wraps counts as multiple "rows"** against that cap: `wrapTxt(desc, 17)`
  (`pat-template.js:18-29`) word-wraps the appliance description at a fixed 17-character width — the
  *same* width the source app used, because the row-height/pagination math below counts wrapped lines,
  so a mismatched wrap width would paginate differently than the original. The row's "cost"
  (`_c`, `pat-template.js:108`) is `Math.max(1, lines)` — a two-line-wrapped description costs 2 rows
  of the page's cap, not 1.
- **Page-break decision** (`pat-template.js:110`): `if (rowsUsed + cost > cap && pageItems.length)` —
  a new page starts only once the *next* appliance genuinely wouldn't fit, and never on an empty page
  (the `pageItems.length` guard prevents an infinite empty-page loop if a single appliance's
  description alone exceeds a page's cap).

### The two real bugs, fixed 2026-08-04 (not 08-05/06)

Both were fixed in a single commit, `184d266`, **"Fix PAT PDF quality: missing font, near-blank
continuation pages, oversized files"** — timestamped **2026-08-04 17:00**, one commit after the
PDF-generation feature itself first shipped (`5860051`, same day, 11:34). Both were caught by testing
with a realistic 20-appliance certificate; the original verification had only ever used 1-2 appliances,
so neither bug was visible until then.

**Bug 1 — DM Sans was never actually loaded.** The template's CSS specifies
`font-family:'DM Sans',Arial,sans-serif` (`pat-template.js:50`), but `apps/office/index.html` only
requested Familjen Grotesk and JetBrains Mono from Google Fonts — DM Sans silently fell back to plain
Arial in every rendered certificate. Fixed by adding DM Sans to the same font `<link>`
(`apps/office/index.html`, one-line diff in `184d266`):

```diff
- <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:...&family=JetBrains+Mono:...&display=swap" rel="stylesheet">
+ <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:...&family=JetBrains+Mono:...&family=DM+Sans:ital,wght@0,400;0,500;0,700;0,900;1,400&display=swap" rel="stylesheet">
```

The commit message calls this bug *"very likely the whole 'looks like a cheap copy' complaint on its
own."* Verified fixed live via `document.fonts` confirming DM Sans as the actually-resolved font.

**Bug 2 — continuation pages padded to the full row cap, producing near-blank pages.** Page 1 is
*meant* to pad with blank rows all the way to its 14-row cap, so a lightly-populated certificate still
reads as a complete form. Continuation pages inherited the identical padding behavior, up to their
24-row cap — for a 20-appliance certificate where page 1 takes 14 and page 2 holds the remaining 6,
that meant page 2 padded 18 blank striped rows onto 6 real ones: 90% empty filler. Fixed at
`pat-template.js:144-152`:

```js
// Page 1 pads all the way to its cap so a lightly-populated cert still
// reads as a proper full-size form. A continuation page exists purely
// to hold whatever overflowed page 1, though — padding IT to a full
// 24-row cap as well produces a page that's almost entirely empty
// filler once there are only a few leftover rows (e.g. 6 real rows on
// a 24-row page). Capping the filler at a handful of rows there keeps
// a little visual headroom without wasting most of a sheet.
const realRows = pg.items.reduce((s, a) => s + a._c, 0);
const empty = pi === 0 ? (pg.cap - realRows) : Math.min(pg.cap - realRows, 3);
```

Only page 1 (`pi === 0`) still pads to its full remaining cap; every later page caps its blank-row
buffer at 3, regardless of how much cap room is technically left.

**A third change bundled into the same commit, also worth knowing:** the html2canvas capture scale
was reduced from the source app's own `4` to `2.5`. At scale 4 a real multi-page certificate was
landing close to 1MB with no visible sharpness gain over 2.5 at normal print/screen viewing — the
same scale-vs-file-size tradeoff `pdf-vector.js` already makes for the invoice masthead (scale 2
there, for a much smaller decorative band). Verified live: the same 20-appliance test certificate
dropped from 956KB to 542KB (43% smaller) with no visible quality loss. The current code
(`pat-template.js:205`) uses `scale: 2.5`; a code comment at `pat-template.js:198-204` still notes
this is a deliberate departure from *"PAT-TEST's own setting"* of 4.

**Correction to the brief this document was written against:** the two bugs were assumed to have been
fixed "2026-08-05/06." The actual commit (`184d266`) is dated **2026-08-04 17:00**, the same day as
the rest of the PAT integration work (Company Profiles, the appliance log, PDF generation itself,
photo extraction, and the renewal flow all landed across commits `a6e4209` through `184d266`, all on
2026-08-04). 2026-08-05's commits (`6b053f7`) and 2026-08-06's (`9604cdb`) are unrelated — the
Engineer two-stage completion flow and the portal/cert-expiry fixes documented in
[`10-business-rules.md`](10-business-rules.md).

### Tamper-evidence hash

Every generated PDF embeds a deterministic hash of the certificate's key facts in the PDF's hidden
`keywords` metadata field (`certVerifyCode()`, `pat-template.js:37-47`, ported verbatim from
PAT-TEST's own `shortHash`/`certVerifyCode`):

```js
export function certVerifyCode(cert) {
  const apps = cert.appliances || [];
  const key = [cert.certNum, (cert.address || '').trim(), cert.issueDate, apps.length,
    apps.filter(a => a.result === 'Fail').length].join('|');
  return shortHash(key);
}
```

A later dispute over whether a certificate's visible appliance count or pass/fail split still matches
what was actually issued can be checked by recomputing this hash from the current record and comparing
it against the value embedded in the PDF a client received (readable via any PDF reader's document
Properties panel).

### The generation call itself

`generateCertPdf()` (`apps/office/certs.js:1522-1549`) is available whenever the open certificate's
type has an appliance log (`_currentCertHasAppliances()`, `certs.js:1489-1493`) and there's at least
one appliance to render:

```js
const profile=resolveCompanyProfile(cert.type);              // §1
let engineerName='';
if(cert.jobId){ const job=await dGet('jobs',cert.jobId); engineerName=job?.engineer||''; }
const doc=await renderPatCertificatePDF(window.jspdf.jsPDF,window.html2canvas,{cert,profile,engineerName});
const blob=doc.output('blob');
const path=`certs/${certId}/${_certFilename(cert)}`;          // ref-number-based filename
const url=await sbStorage(path,blob);
await _sb(`certs?id=eq.${...}`,{method:'PATCH',body:{pdf_url:url,pdf_path:path},...});
```

It uploads through the **exact same** storage path and `pdf_url`/`pdf_path` PATCH that a manual PDF
upload uses (`uploadCertPdf()`), and always sits *alongside*, never replacing, the manual "Upload PDF"
button — so a certificate type with an appliance log can still have a hand-uploaded PDF if generation
ever isn't wanted. Neither the Engineer nor Portal app calls `renderPatCertificatePDF` — the Client
Portal only ever downloads the finished, already-stored PDF. jsPDF/html2canvas are loaded globally via
CDN `<script>` tags in `apps/office/index.html` (not bundled by Vite), consistent with how invoice
PDF generation loads them.

**A verified gotcha with the "Engineer" box on the PDF:** it's only ever populated when `cert.jobId`
is set (`certs.js:1534`, `if(cert.jobId){ const job=await dGet('jobs',cert.jobId); engineerName=job?.engineer||''; }`
— otherwise the template shows an em-dash (`pat-template.js:99`, `const eng = engineerName || '—';`).
A repo-wide search for every place `jobId` is written onto a *cert* record found exactly one live
site: `createCertEntry()` (`apps/office/main.js:3055-3093`), the auto-placeholder-creation path that
fires when a job is marked `Completed` (see [`10-business-rules.md`](10-business-rules.md) §2.2-2.4).
The manual "Add Certificate" form's save path, `saveCertForm()` (`certs.js:463-500`), never writes
`jobId` at all — its saved object has no such field. **Practical effect:** a PAT certificate created
by hand via "Add Certificate" and then PDF-generated will always show a blank Engineer box, even if
the office types an engineer's name into a notes field elsewhere; only a certificate that originated
as an auto-placeholder from a completed job (then had its appliance log filled in and a PDF generated)
gets the Engineer box populated automatically. (The *other* `jobId`-writing site, `certs.js:1951`
inside `saveCert()`, is the same dead `mo-cert` modal path flagged in §3 — not reachable today.)

---

## 5. The renewal flow — starting a new test cycle

PAT certificates get a **dedicated** renewal path, distinct from the generic one every other cert type
uses.

**Generic path — `createRenewalJob(certId)`** (`certs.js:1974-1985`), reachable from "Renew" buttons
across the Certificates dashboard/list (`certs.js:1176, 1280, 1305`, and `main.js:11949`): books a
plain follow-up `Pending` job on today's grid, referencing the expired cert's address/landlord. Works
for any cert type; carries forward no appliance data because most cert types have none.

**PAT-specific path — `openRenewCertModal()` → `submitRenewCert()` → `renewCert()`**
(`certs.js:1997-2033`), shown only as a "🔄 Start a new test cycle" icon on cert-list rows where the
type has `hasAppliances` **and** the cert actually has appliances (`certs.js:337`):

```js
export async function renewCert(certId,newStartAssetId){
  const c=await dGet('certs',certId);
  const today=TODAY();
  const appliances=(c.appliances||[]).map((a,i)=>{
    let assetId=a.assetId||'';
    if(newStartAssetId){
      const m=newStartAssetId.match(/^(.*?)(\d+)$/);
      assetId=m?m[1]+String(parseInt(m[2],10)+i).padStart(m[2].length,'0'):newStartAssetId+(i?'-'+(i+1):'');
    }
    const retestPeriod=a.retestPeriod||12;
    return{id:uid(),assetId,description:a.description||'',testInstrument:a.testInstrument||'',
      date:today,retestPeriod,nextTest:calcNextTest(today,retestPeriod),result:'Pass'};
  });
  const ctDef=(S.certTypes||[]).find(t=>t.name===c.type);
  const expDate=new Date();expDate.setMonth(expDate.getMonth()+(ctDef?.validity||12));
  openCertForm({ type:c.type, address:c.address, landlord:c.landlord, email:c.email, phone:c.phone,
    agent:c.agent, notes:c.notes, issueDate:today, expiryDate:localDateStr(expDate), appliances });
}
```

### What carries forward vs. what's fresh

| Field | Behavior |
|---|---|
| `description`, `testInstrument`, `retestPeriod` | **Carried forward verbatim** — the same appliances are being retested, so what they are and how they're tested doesn't change |
| `assetId` | Carried forward **unless** an optional new starting ID is supplied (below) |
| `date` | **Reset to today** — this is a new test session |
| `nextTest` | **Recalculated** from today's date + the (carried-forward) `retestPeriod` |
| `result` | **Reset to `'Pass'`** for every row — nothing has actually been retested yet; office/engineer corrects any that actually fail after the real test happens |
| Cert-level `issueDate`/`expiryDate` | Reset to today / today + the cert type's validity period |
| Property/contact fields (`address`,`landlord`,`email`,`phone`,`agent`,`notes`) | Carried forward unchanged |

### Optional asset-ID renumbering

If an office user enters a "new starting asset ID" (e.g. `B001`) in the renewal modal
(`rc-start-id`, `index.html:4662`), every carried-forward appliance is renumbered sequentially from
that starting point using the same trailing-digit-increment convention `addApplianceRow()` and
`submitBulkAppliances()` use — `B001`, `B002`, `B003`, … Leaving it blank keeps every appliance's
original asset ID untouched.

### Never auto-saves

`renewCert()` calls `openCertForm({...})` — the same live "Add Certificate" form every other new
certificate goes through — pre-filled but with no `id`, so it opens in **Add** mode, not Edit. Nothing
is written to the database until office reviews the carried-forward list and clicks Save themselves,
same as any other certificate.

---

## 6. Universal certificate reference numbers (brief)

**This applies to every certificate type, not just PAT** — but the entire algorithm (base serial +
appliance-count-or-date + address fragment) was modeled on PAT-TEST's own numbering scheme and then
generalized. `docs/business/14-certificate-and-invoice-numbering.md` does not exist yet in this repo,
so — per this document's brief — the algorithm is covered here in full; if that doc is written later,
this section should point to it instead of duplicating.
[`10-business-rules.md` §2.6](10-business-rules.md#26-certificate-numbering--two-separate-schemes-real-not-a-simplification)
covers the same ground at the level of "how certificate numbering works generally" (including the
separate, older Scheme A used only for auto-created placeholder certs) — this section is the
PAT-specific detail underneath it.

### The algorithm

```js
// apps/office/certs.js:126-131
async function generateCertRef({address,appliances,hasAppliances,issueDate}){
  const base=await _nextCertBaseRef();
  const middle=hasAppliances?String((appliances||[]).length):_ddmmUnpadded(issueDate);
  const tag=addressRefPart(address);
  return tag?`${base}0${middle} / ${tag}`:`${base}0${middle}`;
}
```

`base` + `"0"` + `middle` + (` / ` + `addressTag`, if the address parsed to anything).

- **`base`** — `_nextCertBaseRef()` (`certs.js:116-124`) advances the single shared serial,
  `S.certRefSerial`, via `_incStr()` (`certs.js:72-75`) — increments the trailing digit run,
  preserving width: `_incStr('GBE1009')` → `'GBE1010'` (verified by direct execution), not
  `'GBE10010'`. It's **one continuous counter shared across every certificate type** — a Gas Safety
  cert and a PAT cert created back-to-back both advance the same serial — which is what actually
  guarantees no two certs of any type ever collide; everything appended after it is for a human to
  eyeball-verify, not part of the uniqueness guarantee. Before committing, it also cross-checks the
  chosen base against every existing `certNum` already in the database (not just what this session has
  seen), so a manually-typed number that happens to collide with the next serial still gets skipped.
- **`middle`** — for `hasAppliances:true` types (PAT, by default), this is the real appliance count on
  *this* certificate, as a string — a 5-appliance PAT cert gets `middle='5'`. For every other type,
  it's `_ddmmUnpadded(issueDate)`: the issue date's day+month, concatenated, no leading zeros, no
  separator. Verified by direct execution: `_ddmmUnpadded('2026-08-04')` → `'48'`;
  `_ddmmUnpadded('2026-01-04')` → `'41'`.
- **`addressTag`** — `addressRefPart(addr)` (`certs.js:83-99`), ported verbatim (algorithm, not just
  intent) from PAT-TEST's own function of the same purpose. Real examples, verified by direct
  execution of the actual function:

  | Input address | Output tag |
  |---|---|
  | `"42 Oak Avenue, Manchester, M1 2AB"` | `"42 Oak Avenue"` |
  | `"The Fox Inn\n15 High Street\nLeeds\nLS1 4HT"` | `"The Fox Inn 15 High Street"` |
  | `"Kings Head Hotel, 8 Market Square, York, YO1 7LP"` | `"Kings Head Hotel 8 Market Square"` |
  | `"12 Elm Close"` | `"12 Elm Close"` |
  | `"Flat 3, 22 Kings Road, Bristol"` | `"Flat 3 22 Kings Road"` |

  The algorithm: split on real line breaks first (falling back to comma-splitting DeepFlow's usual
  single-line address if there's only one line); if the first line starts with a digit, treat the
  whole thing as a street line with no business name; otherwise treat the first line as a business
  name and search the remaining lines for the first one that starts with a digit to use as the street
  line. From the street line, pull the leading `\d+\w*` (house/unit number) plus its next one or two
  words. **A real, verified quirk**: because "starts with a digit" is the only signal used to decide
  "is this a business name," a residential `"Flat 3, ..."` address gets `"Flat 3"` folded into the
  business-name slot exactly like a real trading name would — the algorithm has no concept of
  "this is a unit descriptor, not a business," since it was designed for PAT-TEST's largely commercial
  context. Worth knowing if this reference scheme is ever relied on for residential-heavy work.

### Opt-in behavior

```js
// certs.js:480 — inside saveCertForm()
if(!certNum&&!isEdit&&S.certRefSerial){
  certNum=await generateCertRef({...});
}
```

Auto-numbering only fires for a **genuinely new** certificate (`!isEdit`) with a **blank** Reference
Number field (`!certNum`), and **only once `S.certRefSerial` has been set** in Settings — empty by
default (`main.js:227`), meaning every certificate's `certNum` stays fully manual, exactly as before
this feature existed, until an admin explicitly opts in by typing a starting serial (e.g. `GBE1000`).
It never overwrites a number on an edit-save, regardless of the setting.

---

## 7. Historical PAT-TEST migration

**What's directly confirmed by the current code:** the reference-number algorithm in §6 was verified,
at the time it was built, against **8 real historical PAT-TEST reference numbers already present in
this database** — `addressRefPart()`'s own header comment states *"Verified against all 8 of the real
historical PAT-TEST refs migrated into this database — every one decodes back to exactly this"*
(`certs.js:81-82`), and the commit that introduced the universal numbering scheme (`c911a47`,
2026-08-04) repeats the same claim in its message. This confirms that PAT-TEST certificate data —
at minimum, reference numbers, and very plausibly full certificate records given the reference number
alone wouldn't otherwise be present — was migrated into DeepFlow's `certs` table at some point before
that commit.

**What is not confirmed by anything in this repo:**

- **No migration script is checked in anywhere** — not in `supabase/migrations/` (9 tracked SQL files,
  none PAT/Firebase-related), not as a one-off script anywhere in the tree, and not mentioned in any of
  the ~40 root-level `PHASE*.md`/audit planning documents. A repo-wide search for "firebase,"
  "PAT-TEST," "OHM," and "migrat[ed/ion]" across every tracked file surfaces only the code comments
  already quoted above and unrelated hits (e.g. an "Online Users Panel (ready for Firebase)" comment
  in `main.js:895` that predates and is unrelated to PAT). The conclusion this document draws: **this
  was a one-off, live data operation performed directly against the database — not a repeatable,
  version-controlled process** — consistent with how several other one-off SQL changes in this
  codebase are tracked only as root-level `PHASE*_SQL.md` files rather than `supabase/migrations/`
  entries.
- **The specific claim that PAT-TEST was "Firebase-backed"** and named **"OHM PAT MANAGER"** — real
  information this document was briefed with, but not independently verifiable from anything in this
  repository. The only name this repo's own comments ever use for the predecessor is "the standalone
  PAT-TEST app" / `ohmdeepcerts/PAT-TEST` (a sibling GitHub repo under the same org as
  `ohmdeepcerts/deepflow-apps`, this project's own repo). If a definitive source for the
  Firebase/OHM-PAT-MANAGER detail exists, it lives outside this codebase (the PAT-TEST repo itself, or
  institutional knowledge) — treat it as unverified context here, not as something this document
  independently confirms.
- **Whether any migrated historical PAT-TEST certificates still exist in production today** — almost
  certainly not: [`10-business-rules.md`](10-business-rules.md) §2.4 documents a full production data
  reset on 2026-08-06 that left the live `certs` table at 0 rows. Whatever was migrated in was wiped
  along with everything else. What survives is the *algorithm*, verified against that historical data
  before the reset, not the historical data itself.

**Practical implication for a future migration of this kind:** if PAT-TEST (or another predecessor
system) needs a second historical-data import in the future, there is no existing script in this repo
to reuse or adapt — it would need to be built from scratch, most likely as a one-off script against
Supabase directly (see `mcp_supabase`'s `execute_sql`/`apply_migration` tools used elsewhere in this
project's workflow) rather than a tracked migration, matching how the first import evidently happened.

---

## Related documents

- [`docs/business/10-business-rules.md`](10-business-rules.md) — the certificate rules catalog this
  document sits underneath; §2.6 covers certificate numbering generally (both schemes, not just the
  PAT-modeled one), §2.7 is the summary version of this entire document, §2.4 documents the 2026-08-06
  production data reset referenced in §7 above.
- `docs/business/11-workflows.md` — end-to-end job → certificate → invoice pipelines (**not yet
  written** — if it's written later, the renewal flow in §5 above and the job→cert link
  (`cert.jobId`/`cert.jobNum`) belong there too).
- `docs/business/14-certificate-and-invoice-numbering.md` — a dedicated numbering-schemes doc
  (**not yet written** — §6 above covers the PAT-modeled algorithm fully in the meantime; if this doc
  is written, move the general algorithm there and leave only the PAT-specific detail here).
- `docs/architecture/09-storage.md` — Supabase Storage bucket layout, cert PDF paths
  (`certs/<certId>/<filename>.pdf`), access rules (**not yet written** — §4 above notes the storage
  call sites in the meantime).
- [`docs/architecture/05-database.md`](../architecture/05-database.md) §5 — the `certs.appliances`
  JSONB shape, independently documented and cross-checked against the same example used in §2 above.
- [`docs/architecture/01-system-architecture.md`](../architecture/01-system-architecture.md) §7 — where
  `packages/ui`'s PDF rendering (`pat-template.js` and `pdf-vector.js`) sits in the shared-package
  layout.

---

*Every claim in this document was verified directly against current source — `apps/office/main.js`,
`apps/office/certs.js`, `packages/ui/pat-template.js`, `packages/ui/pdf-vector.js`,
`supabase/functions/extract-cert-data/index.ts` — cross-checked against `git log`/`git show` for every
dated claim, and against direct execution of the pagination/reference-number/address-parsing functions
for every worked example, not just read and assumed correct. Accurate as of commit `9604cdb`
(2026-08-05), the tip of `main` at the time of writing; line numbers will drift with future edits — the
named function is the durable anchor. See [`docs/README.md`](../README.md) for the full documentation
index.*
