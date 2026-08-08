# 11 — Workflows

This document is the end-to-end **workflow narrative** companion to
[`docs/business/10-business-rules.md`](10-business-rules.md) (the rules catalog — every conditional,
threshold, and permission check, one at a time) and
[`docs/architecture/05-database.md`](../architecture/05-database.md) (the schema — every table/column
and what actually writes to it). Neither of those documents tries to show a whole journey from one end
to the other. This one does: six real, start-to-finish flows, each as a numbered sequence of actual
steps naming the actual function and file at each step, with every cross-app boundary called out
explicitly — because tracing "an office action → what an engineer sees → what a client sees" by
reading one app's source at a time is the single hardest thing about this codebase for a new
developer.

**This replaces the old `docs/12_Workflows.md`** (and the identical root `WORKFLOWS.md`, already
deleted). That version predates the PAT pipeline, auto-generated certificate reference numbers,
manual/automatic certificate emailing, and the Engineer two-stage completion handoff — and it still
described an hours-logged-on-a-job → invoice-line workflow that was deliberately deleted on
2026-08-03 (§3.1 of the business-rules doc). Jobs are priced per-job now; there is no "log hours,
build an invoice line from them" step anywhere below.

**How to read this:** every step cites a file and function, e.g. `apps/office/main.js:2949
onJobComplete()`. Line numbers are accurate as of commit `9604cdb` (2026-08-06); the function name is
the durable anchor if they drift. **Bold bracketed tags** — **[OFFICE]**, **[ENGINEER]**, **[PORTAL]**,
**[DATABASE]**, **[EDGE FUNCTION]** — mark which app or layer each step actually runs in, since that's
exactly the thing that's invisible if you're only looking at one app's source at a time.

`docs/business/13-pat-certificates.md` does not exist yet, so Workflow 3 below covers the PAT pipeline
fully rather than delegating to it.

---

## Workflow 1 — New Job, End to End

The backbone workflow: everything else in this document eventually connects back to a job's status
changing.

1. **[OFFICE]** A staff member opens the New Job modal and fills in address, trade, engineer,
   date/time slot, landlord/agency/agent contact details, and price —
   `apps/office/main.js:3573 openJobModal()`. A draft is autosaved to `localStorage` as they type, so
   a browser crash or accidental close doesn't lose a half-filled form.
2. **[OFFICE]** On Save, `apps/office/main.js:3935 saveJob()` runs:
   - Assigns a job number via `nextJobNum()` (`main.js:3099`) — tries the atomic `rpc/next_job_num`
     Postgres RPC first, falls back to a scan-highest-then-increment method if that RPC isn't
     installed on the live project (see business-rules §1.7).
   - Resolves (finds-or-creates) a `persons` Directory row for the landlord contact and links it via
     `job.clientPersonId` — `_resolveLandlordPerson()`, called at `main.js:4021-4025` inside
     `saveJob()` — including a real conflict-resolution prompt if the typed contact details disagree
     with an existing Directory entry of the same name.
   - Writes the row to `jobs` (**[DATABASE]**) with `status:'Pending'`.
3. **[DATABASE] → [ENGINEER]** The assigned engineer's app polls/loads and the new job appears. The
   Engineer app's `loadJobs()` (`apps/engineer/main.js:832`) runs three parallel queries filtered on
   `engineer=ilike.<name>` (case-insensitive, deliberately — see the `FIX 5` comment at `main.js:837`):
   `date=eq.<today>` → the **Today** tab, `date>today && date<=today+30d` → the **Upcoming** tab
   (grouped by date, `renderJobs(...,'upcoming')`, `main.js:891-897`), and a 60-row `status=in.(Engineer
   Completed,Completed,Cannot Access,Cancelled)` query → the **Done** tab. `TABS` is defined at
   `main.js:1680`.
4. **[ENGINEER]** On site, the engineer taps **▶ Start** — `quickStatusUpdate(id,'In Progress')`
   (`apps/engineer/main.js:936`, wired from the job card's quick-action row, `main.js:987`) — a
   targeted `PATCH jobs?id=eq.<id>` setting `status` and `modified` only, so it can't clobber a field
   another user just changed. This transition is allowed by the Engineer app's own state machine,
   `STATUS_FLOW['Pending']=['In Progress','Cannot Access']` (`main.js:1261-1269`, enforced in
   `updateStatus()`, `main.js:1312`).
5. **[ENGINEER]** When finished, the engineer taps **✅ Done** — `quickStatusUpdate(id,
   STATUS.ENGINEER_COMPLETED)` (`main.js:936`, called from `main.js:986`), **not**
   `STATUS.COMPLETED`. **Why this indirection exists:** before it did, an engineer's own,
   unreviewed "I'm done" tap immediately set `status:'Completed'`, which is the literal status that
   fires certificate-placeholder and auto-invoice creation (next steps) — with no office review in
   between. The fix adds an intermediate status, `Engineer Completed`, that the office must explicitly
   finalize. While in this state the job card shows **"✔ Awaiting Office Review"**, not "Done"
   (`main.js:1006`) — the UI itself signals this isn't final. The Engineer app's state machine also
   locks the job at this point: `Engineer Completed` can only go back to `In Progress`
   (`main.js:1261-1269`) — an engineer's own app can never push a job all the way to `Completed`,
   `Invoiced`, or `Cancelled` (all three have an empty allowed-transitions list).
6. **[OFFICE]** Office reviews the finished job and finalizes it — via the status dropdown, or the
   job-list right-click context menu's **"✅ Mark Completed (Finalize)"** item
   (`apps/office/main.js:11336`, next to a separate **"🔷 Mark Engineer Completed"** item at
   `main.js:11335` for the reverse/manual case). Both call `quickStatus(id,status)`
   (`main.js:2940`) → `_applyStatusChange(id,status)` (`main.js:2902`) — an ordinary PATCH with **no**
   special-casing for the two-stage flow. The automation gate is simply:
   ```js
   // apps/office/main.js:2925
   if(status===STATUS.COMPLETED && old!==STATUS.COMPLETED) onJobComplete(j);
   ```
   which checks only the *destination* status, not what it came from — so finalizing from `Engineer
   Completed` fires the exact same code path as finalizing directly from `Pending`. The Office app has
   no equivalent state machine to the Engineer app's — any status can go to any other status here
   (`main.js:2902`'s only real check is a same-status no-op skip).
7. **[OFFICE]** `onJobComplete(j)` (`main.js:2949`) fires, synchronously:
   - Scans the job's description against every certificate type's keyword list, additive to whatever
     cert types were manually ticked on the job form (`main.js:2950-2960`).
   - For each matched/selected cert type, calls `createCertEntry(ct,null,null,TODAY(),false)`
     (`main.js:3055`) — creates a placeholder `certs` row (**[DATABASE]**) with **`expiryDate:''`** and
     **`noExpiry:false`** (explicit). This is a 2026-08-06 bug fix: it used to fabricate an expiry date
     (`today + validity period`) even though no inspection had happened yet, which made an
     unissued placeholder look like a real, already-valid certificate to anyone viewing it — including
     a client in the Portal. A blank expiry now correctly routes the placeholder into the Certificates
     dashboard's "Missing Dates" tab (`!c.expiryDate && !c.noExpiry`, `apps/office/certs.js:1043,
     1211`) instead of silently looking done. See Workflow 2 for what happens next to this placeholder.
   - Schedules `autoInvoice(j)` via `setTimeout(...,1400)` (`main.js:2988`) — **1.4 seconds later**,
     deliberately after the cert writes above finish.
   - Schedules a `updateInvSmartBanner` refresh 2 seconds later, so the Invoices page's "needs a
     draft" banner picks up the newly-completed job.
8. **[OFFICE], ~1.4s later** `autoInvoice(j)` (`main.js:3168`) checks `S.autoInvOnComplete!==false`
   (`main.js:3170`) then calls `_autoInvoiceInner(j)` (`main.js:3180`), which:
   - Re-checks no invoice already exists for this job (checked at `main.js:3183` and again immediately
     before the write at `main.js:3256`, narrowing but not eliminating a race between two
     near-simultaneous triggers — no DB constraint backs it).
   - Picks a billable client — `j.agencyName || j.agentName || j.landlordName || j.referrer`
     (`main.js:3191`) — creating a new `persons` row on the spot if none matches an existing Directory
     entry (`main.js:3195-3205`). If none of the four exist, nothing is created and office is told why
     via toast (`main.js:3210`) rather than a silent no-op.
   - Builds exactly one flat-price line item — `{desc:j.description||'Labour', qty:1,
     unit:Number(j.price)||0, vat:true}` (`main.js:3216`) — jobs are priced per-job, not per-hour;
     there is no hours-to-invoice-line logic anywhere in this path (the old per-hour subsystem was
     removed 2026-08-03, commits `d3f2816`/`90209bf`).
   - Assigns the invoice number from the correct series — `nextInvNum(!!(j.agencyName||j.agentName))`
     (`main.js:3226`, function at `main.js:3275`) — agency/agent-referred jobs get the `AGN-` series,
     landlord-billed jobs get `INV-`.
   - Writes the `Draft` invoice row (**[DATABASE]**), then flips the job's `status` to `Invoiced` and
     sets `linkedinvid` via a raw PATCH (`main.js:3265` — note the literal lower-case DB column name,
     not `linkedInvId`; a prior real bug here sent the wrong case and PostgREST silently rejected the
     whole PATCH).
   - Generates and stores a real invoice PDF in the background (`generateAndStoreInvoicePDF`, see
     Workflow 4) and shows a toast: `📄 Draft invoice <number> created — review in Invoices`.
   - **Never auto-emails** the client at this point — see Workflow 4, step 2.
9. **[DATABASE] → [PORTAL]** The next time the client (landlord/agency/agent) opens their Portal link,
   they see the job's status reflected on their Overview/Jobs tab, the certificate placeholder (once
   office has filled in real dates — Workflow 2) on their Certificates tab, and the Draft invoice on
   their Invoices tab — shown as **"Invoicing in progress"** rather than "£0.00" if the job had no
   price set at completion time (`apps/portal/main.js:1030`, `const pending=inv.status==='Draft' &&
   t.grand===0`) — see Workflow 4 for the full invoice lifecycle from here.

---

## Workflow 2 — Certificate Issuance, Standard Type (Gas Safety / EICR / Fire Alarm / Emergency Lighting / EPC / Legionella)

This is every certificate type **except** PAT Testing — PAT has a genuinely different pipeline,
covered in Workflow 3. Picks up from the placeholder `certs` row created in Workflow 1, step 7.

1. **[OFFICE]** Office opens the Certificates screen, finds the placeholder on the **"Missing Dates"**
   tab (`apps/office/certs.js:1043,1211` — the filter that surfaces any cert with a blank `expiryDate`
   and `noExpiry:false`), and opens it for editing — `openCertModal()`/the edit-cert form
   (`apps/office/certs.js:1889`+).
2. **[OFFICE]** Office fills in the real issue date and expiry date once the actual inspection/test has
   happened. Optionally, office can photograph a paper certificate and let AI pre-fill the form fields
   instead of typing them — `extractCertFromPhoto()` (`certs.js:1566`) POSTs the image to the
   `extract-cert-data` **[EDGE FUNCTION]** (`supabase/functions/extract-cert-data/index.ts`, default
   `mode:'cert'`), which tries Gemini first (multimodal, reads cert number/type/issue/expiry
   date/property address in one call) and falls back to OCR.space (plain text only, no structured
   fields) if AI extraction is off, `GEMINI_API_KEY` isn't configured, or Gemini fails. This is a
   pre-fill only — nothing is saved until office reviews and hits Save.
3. **[OFFICE]** On save, `saveCertForm()` (`certs.js:463`) checks whether a reference number was
   typed in. If left blank **and** an admin has opted in by setting `S.certRefSerial` in Settings
   (empty/off by default), `generateCertRef()` (`certs.js:126-131`) builds one automatically:
   `<ever-incrementing serial>` + `"0"` + `<issue date's day+month, no separator>` + optionally
   ` / <short address tag>`. This scheme is shared across every certificate type (not just PAT) and
   never overwrites a number on an edit-save (`certs.js:480`: `if(!certNum&&!isEdit&&S.certRefSerial)`)
   — see business-rules §2.6 for the full byte-for-byte breakdown and how this differs from the
   separate, always-on auto-numbering scheme used for placeholders in Workflow 1.
4. **[OFFICE]** Office uploads a PDF (`uploadCertPdf()`, `certs.js:1618` — up to 25MB) or, for a cert
   type with an appliance log (PAT only, `hasAppliances:true`), generates one (see Workflow 3). The
   file is stored in Supabase Storage at `certs/<certId>/<certNum-or-type>.pdf`
   (`_certFilename()`, `certs.js:46-48`) and the row's `pdf_url`/`pdf_path` are PATCHed
   (**[DATABASE]**).
5. **[OFFICE], automatically, same call chain** The moment the PDF is stored, both `uploadCertPdf()`
   and `generateCertPdf()` call `_maybeEmailCertReady(certId, pdfUrl)` (`certs.js:1652`). This fires
   the client email automatically **unless** `S.certAutoEmail` has been explicitly set to `false` in
   Settings → Certificates — the shipped default is **on** (`S.certAutoEmail!==false`,
   `main.js:7991`). Recipient resolution: the cert's own `.email` field first, falling back to the
   linked job's `landlordEmail`/`agencyEmail` (`certs.js:1656-1660`) — most certs created straight
   from a job never have `.email` filled in directly, so the fallback is the common real path. The
   actual PDF is fetched and base64-attached (up to 15MB; larger falls back to a link-only email,
   `certs.js:1662-1674`) — a download link is always included in the body regardless.
6. **[OFFICE], alternative to step 5** If auto-email is off (or office wants to resend), the same
   underlying function fires from the explicit **"✉ Send to Client"** button —
   `sendCertToClient()` (`certs.js:1692`), which calls `_maybeEmailCertReady(certId, c.pdfUrl,
   {manual:true})` — works regardless of the `certAutoEmail` setting.
7. **[OFFICE] → [DATABASE]** Every outcome from steps 5/6 — a successful send, a "no email on file"
   skip, or a genuine send failure — is written to `logActivity()` under the `'cert'` type
   (`certs.js:1682,1685`), visible in the Audit Trail. This is a separate log from the invoice-side
   `invoice_audit` table (Workflow 4).
8. **[DATABASE] → [PORTAL]** The client's Portal Certificates tab (`vCerts`, `apps/portal/main.js`
   near line 1015) shows the finished certificate with a **Download** link built off `c.url` (mapped
   from `c.pdf_url||c.url`, `apps/portal/main.js:1135`) and a share button. Same as invoices (Workflow
   4), the Portal never re-renders a certificate independently — it always shows the one PDF office
   generated and stored.

---

## Workflow 3 — PAT Testing Certificate, Full Pipeline

PAT (Portable Appliance Testing) is the one certificate type that tracks individual appliances rather
than a single pass/fail, and it is a genuinely different, richer pipeline than Workflow 2 — not a
simplification of it. `S.certTypes` flags PAT with `hasAppliances:true`; every other type keeps its
`appliances` array empty and ignored (`certs.js:475,495`).

1. **[OFFICE]** From the auto-created placeholder (Workflow 1, step 7) or the manual Add Certificate
   form, office opens the PAT cert for editing. Because `hasAppliances:true`, the form shows a working
   appliance-test-log editor (`_certAppliances`, `certs.js:31-36`), persisted as `certs.appliances`
   JSONB — each row `{id, assetId, description, testInstrument, date, retestPeriod, nextTest,
   result}`.
2. **[OFFICE]** Appliance rows are populated one of three ways:
   - **One at a time** — `addApplianceRow()` (`certs.js:1778`), which auto-increments the asset ID
     from the previous row (`A001`→`A002`, same convention as the standalone app this was ported
     from).
   - **Bulk paste** — `openBulkApplianceModal()`/`submitBulkAppliances()` (`certs.js:1806,1812`): one
     description per line, an optional starting asset ID that increments per line.
   - **Photo scan** — `extractAppliancesFromPhoto()` (`certs.js:1838`), the same `extract-cert-data`
     **[EDGE FUNCTION]** as Workflow 2 but called with `mode:'appliances'`. Reads a (often handwritten)
     paper PAT log and returns asset ID/description/pass-fail per row. Deliberately does **not** try
     to extract instrument/date/retest-period per row — those are almost always constant across a
     whole paper sheet, so the caller fills them in once via the same defaults `addApplianceRow()`
     uses, rather than the AI guessing per-row values it was never given (`extract-cert-data/index.ts:
     34-41`). Falls back to plain-text OCR (no structured rows) under the same conditions as Workflow
     2's cert-header extraction.
3. **[OFFICE]** `resolveCompanyProfile(certType)` (`apps/office/main.js:11238-11253`) resolves *which
   business identity* the certificate should be issued under. If the PAT cert type has a
   `companyProfileId` set (Settings → Company Profiles — e.g. a PAT operation trading under a
   different business name) and that profile still exists, its name/address/logo/VAT/reg number are
   used; otherwise it falls back to the main Company Profile fields. This resolution happens at PDF
   generation time (next step), not at save time.
4. **[OFFICE]** Office generates the certificate PDF — `generateCertPdf()` (`certs.js:1522`), which
   calls `renderPatCertificatePDF(jsPDF, html2canvas, {cert, profile, engineerName})`
   (`packages/ui/pat-template.js:182-214`, `buildPatCertificatePages`/`renderPatCertificatePDF`).
   **This is a deliberate exception to how every other PDF in DeepFlow is built:** invoices
   (Workflow 4) are drawn as real vector text via `packages/ui/pdf-vector.js` — small file size, real
   selectable text. PAT certificates instead render actual HTML/CSS pages, screenshot them with
   `html2canvas` at scale 2.5, and assemble the images into a PDF with `jsPDF`, one page-image per A4
   sheet. **Why:** the requirement was pixel-fidelity with the standalone PAT-TEST app this replaced —
   matching its exact layout by eye in a different rendering system was judged less reliable than
   screenshotting the same CSS that already matched it (`pat-template.js:1-9`). Concretely:
   - Page 1 holds up to 14 appliance rows, continuation pages up to 24 (`DEFAULTS.rowsP1`/`rowsPN`) —
     a description that wraps past 17 characters counts as multiple "rows" against that cap
     (`wrapTxt()`, `pat-template.js:18-29`). Page 1 pads with blank rows to its full cap (so a
     lightly-populated cert still looks like a complete form); a continuation page pads only up to 3
     blank rows, to avoid an almost-empty sheet.
   - Every PDF embeds a deterministic tamper-evidence hash (`certVerifyCode()`, `pat-template.js:
     37-47`) of the cert's key facts (ref number, address, issue date, appliance count, fail count) in
     the PDF's hidden `keywords` metadata field.
   - The rendered PDF is stored through the exact same path a manual upload uses
     (`certs/<certId>/<filename>.pdf`, `sbStorage()`), so the cert list, Client Portal, and expiry
     reminders can't tell a generated PAT cert from an uploaded one afterwards.
5. **[OFFICE], same as Workflow 2** Once the PDF is stored, `_maybeEmailCertReady()` fires
   automatically (or via "Send to Client") exactly as in Workflow 2, steps 5–7 — PAT certs use the
   identical email/audit-trail path, nothing PAT-specific there.
6. **[PORTAL]** Same as Workflow 2, step 8 — the client sees the finished, downloadable PDF on their
   Certificates tab.
7. **Renewal — a new test cycle, not just a follow-up booking.** PAT gets its own dedicated renewal
   path rather than the generic `createRenewalJob()` (`certs.js:1974-1985`, which just books a
   follow-up `Pending` job for any cert type): `openRenewCertModal()`/`renewCert()`
   (`certs.js:1997/2010`). It opens the Add Certificate form pre-filled with the same
   property/client details **and the source cert's full appliance list carried forward** —
   description/instrument/retest-period copied verbatim, `date` reset to today, `result` reset to
   `'Pass'` (nothing has actually been retested yet — office/engineer corrects any failures after the
   real test happens), `nextTest` recalculated per appliance from its retest period. An optional "new
   starting asset ID" (`rc-start-id` in the renewal modal) renumbers the whole carried-forward list
   sequentially, same increment convention as step 2. It never auto-saves — office reviews and hits
   Save themselves, same as any other cert edit.

---

## Workflow 4 — Invoice Lifecycle

Picks up from the auto-created Draft invoice in Workflow 1, step 8 (the same lifecycle applies to a
manually-created invoice from this point on).

1. **Draft.** The invoice exists, has a number, and (usually) one flat-price line item. Office can
   still edit price/description/line items freely at this stage.
2. **[OFFICE] → Awaiting Payment.** Office clicks **Send** — `sendInvEmail()` (`main.js:7134`):
   - Requires `inv.clientEmail` to be on file; refuses with a toast otherwise.
   - Builds the real PDF — `_buildInvoicePDFDoc(inv)` (`main.js:7194`) calls `renderInvoicePDF()`
     (`packages/ui/pdf-vector.js`) — **vector text and shapes**, not a screenshot (contrast with PAT
     in Workflow 3): the masthead is the only rendered image (a CSS gradient + particle scatter,
     matching the login screen), everything else is real jsPDF/jsPDF-AutoTable text, which is what
     keeps the file a few tens of KB instead of the few hundred a full-page screenshot would cost
     (`main.js:7200-7204`).
   - Emails the PDF as a base64 attachment via `_sendEmail()`. On success: `inv.status='Awaiting
     Payment'`, a `sent` row written to `invoice_audit` (`main.js:7155`, **[DATABASE]**), and the PDF
     is (re-)stored via `_storeInvoicePDF()` in the background. On failure: a `failed` row is written
     instead (`main.js:7150`) with the error detail, and status is left unchanged.
   - **Note:** creating the Draft in Workflow 1 never auto-sends this email — `S.invEmailAuto` looks
     like it should gate that, but no code anywhere actually reads it to gate a send (business-rules
     §3.5); an invoice only leaves Draft when a human clicks Send (or WhatsApp-sends, `sendInvWA()`,
     `main.js:7162`, same status flip but no PDF attachment).
   - Independently of the Send button, `generateAndStoreInvoicePDF(id)` (`main.js:7254`, exported) is
     the function called automatically after any edit that changes what the invoice looks like — it
     rebuilds and re-stores the PDF via `_storeInvoicePDF()` (`main.js:7241`), which PATCHes
     `pdf_url`/`pdf_path` onto the `invoices` row (**[DATABASE]**). This is the file every other
     surface (Portal, bulk download, resend) reads — nothing downstream re-renders its own copy from
     raw invoice data as a matter of course.
3. **[DATABASE] → [PORTAL]** The client opens their Portal Invoices tab (`vInvoices()`,
   `apps/portal/main.js:1023`) and clicks Preview — `previewInv(id)`
   (`apps/portal/invoice-pdf.js:45`). **This is a deliberate architecture decision, not an oversight:**
   if `inv.pdfUrl` is set, the Portal shows that exact stored file in an iframe
   (`invoice-pdf.js:56-61`) — it does **not** re-render the invoice from `items`/`clientName`/etc. in
   the browser. Only an invoice from *before* server-side PDF storage existed falls through to a
   client-side HTML rebuild (`invoice-pdf.js:64-108`) as a legacy fallback. **Why this matters:**
   guarantees the PDF the client sees, downloads, and could dispute later is byte-identical to what
   office generated and can also see — no risk of the Portal's independent rendering logic drifting
   from the Office app's (different VAT rounding, different line-item order, a stale line-item edit
   that didn't make it into a second render path, etc.).
4. **[PORTAL] → Paid, path A (manual).** Office (not the client) records payment — `markInvPaid(id)`
   (`main.js:7275`): writes a `payments` row for the full remaining balance if one doesn't already
   cover it (so every `Paid` invoice always has at least one payment record with a date/method/amount),
   sets `inv.status='Paid'`, and regenerates/re-stores the PDF so the stored file reflects the paid
   state (`generateAndStoreInvoicePDF`, same call as step 2).
5. **[PORTAL] → Paid, path B (Stripe) — verified end-to-end, genuinely wired.** The Portal's **Pay
   Now** button (rendered when `_payable(inv)` — landlord/agency portal only, not agent, and status
   isn't `Paid`/`Cancelled`/`Disposable`, `invoice-pdf.js:23`) calls `payInvoice(id)`
   (`invoice-pdf.js:25`), which does a genuine `fetch` to the **[EDGE FUNCTION]**
   `create-checkout-session` (`supabase/functions/create-checkout-session/index.ts`) with
   `{invoiceId, portalType, portalId}` and redirects the browser to the returned Stripe Checkout URL.
   Server-side, that function:
   - Authorizes the caller two ways: a Supabase JWT (office staff) or, for the Portal's case, matching
     `portalId` against the invoice's `client_person_id`/`client_agency_id` **or**, since those FK
     columns are never actually populated by any application code today, falling back to matching the
     resolved landlord/agency name against the invoice's free-text `clientname`/`landlordname`/
     `agencyname`/`billtoname` fields (`index.ts:54-77`) — a direct code comment states plainly this
     name-fallback "is the path that actually authorizes real-world Pay Now clicks right now."
   - Recomputes the real outstanding total from `items` (never trusts the stale `invoices.total`
     column, which is always 0), checks it's not already covered by existing `payments` rows, and
     creates a Stripe Checkout Session for the outstanding balance (`index.ts:81-121`).
   - Returns `503 Payments are not configured yet` if `STRIPE_SECRET_KEY` isn't set as an Edge
     Function secret (`index.ts:100`).

   On successful payment, Stripe calls the **[EDGE FUNCTION]** `stripe-webhook`
   (`supabase/functions/stripe-webhook/index.ts`), which verifies the `Stripe-Signature` HMAC itself
   (returns `503` if `STRIPE_WEBHOOK_SECRET` isn't configured, `index.ts:37`), is idempotent against
   Stripe's at-least-once retry behavior (checks for an existing `payments` row with the same
   `ref`=payment-intent-id first), inserts a `payments` row (`method:'Card (Stripe)'`,
   `recorded_by:'Stripe (automatic)'`), and flips the invoice to `Paid` once the recomputed total is
   covered — mirroring `markInvPaid()`'s own logic exactly rather than a second, possibly-drifting
   implementation.

   **Verification note, since this was explicitly flagged as uncertain going into this document:**
   the *code path is real and complete* — both Edge Functions exist, are fully implemented, correctly
   authorize the Portal caller, correctly recompute totals from `items` rather than the dead `total`
   column, and the Portal's Pay Now button genuinely calls `create-checkout-session` rather than
   just simulating payment. **What is not verifiable from source alone** is whether
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are actually set as live secrets on the deployed
   Supabase project — neither this document nor the tools used to write it can read Edge Function
   secret values. If those two secrets aren't set, both functions degrade cleanly to an explicit
   `503` rather than failing silently or falsely succeeding — so it's safe either way, but whoever
   deploys this should confirm the secrets are set before relying on the Pay Now button in production.
6. **Credit note — a correction against an existing invoice, not a status.** Office opens the credit
   note form, picks the original invoice, enters credit line items, and saves —
   `saveCreditNote()` (`apps/office/credit-notes.js:78`). This creates a **new** `invoices` row (not a
   mutation of the original) with `status:'Credit Note'`, `linkedInvId:<original id>`, and a number
   built as `<invPrefix>CN-<original number with prefix stripped>` (e.g. `INV-CN-1042`). **Correction
   worth repeating from the business-rules doc:** despite what older docs claimed, `isCreditNote` is
   never actually set to `true` anywhere in the codebase — `status==='Credit Note'` is the real, only
   discriminator everywhere this is checked. The full reduction amount and reason are written to
   `logActivity()` under the `'credit'` type with old/new invoice totals for audit purposes
   (`credit-notes.js:99-114`).

---

## Workflow 5 — Client Portal Access

How a landlord, agency, or individual agent actually gets into (and stays inside) their Portal.

1. **[OFFICE]** Office generates a Portal link for a Directory entry (landlord/agency/agent) — a URL
   of the form `?id=<persons.id or agencies.id or agents.id>&type=landlord|agency|agent`. **The `id`
   query parameter is the row's own primary key** — `export const token=P.get('id')`
   (`apps/portal/main.js:113`). This confirms the distinction called out in the database doc still
   holds: the schema's separate `portal_token` column (on `jobs`/`agencies`) is confirmed dead —
   unread and unwritten by any of the three apps — the real identifier in the URL is just the row id
   itself.
2. **[PORTAL] → [DATABASE]** On load, the entity is resolved via a `SECURITY DEFINER` RPC keyed on
   that id — `rpc/portal_get_person` for a landlord (`apps/portal/main.js:508`), `rpc/portal_get_agency`
   for an agency, matched purely server-side (the RPC only ever returns the one row asked for; it does
   not accept or trust a client-supplied name/search term). This is deliberate: an older version
   matched by a client-suppliable name via `ILIKE` across several columns, which meant anyone with the
   public anon key could pass a wildcard and read every client's data — fixed by resolving strictly by
   id inside the RPC instead (comment, `main.js:479-481, 593-598`).
3. **[PORTAL]** Before any real data loads, `ensurePortalPin()` (`apps/portal/main.js:296`) gates
   access:
   - **First visit ever** (no PIN set yet): `rpc/portal_pin_status` reports this, and
     `_pinRenderSetup()` (`main.js:259`) asks the visitor to choose and confirm a 6-digit PIN, saved
     via `rpc/portal_pin_set` (`main.js:278`, `_pinSubmitSetup()`, `main.js:271`).
   - **Subsequent visits, same link:** `_pinRenderEntry()` (`main.js:227`) asks for the existing PIN,
     verified via `rpc/portal_pin_verify` (`main.js:245`, `_pinSubmitEntry()`, `main.js:240`) —
     `crypt()`-hashed server-side (`pgcrypto`), never stored or returned in plaintext. Five wrong
     attempts locks the PIN out for a period, surfaced via `_pinRenderLocked()` (`main.js:286`).
   - A successful verify/set stores a flag in `sessionStorage` (not `localStorage` — cleared when the
     browser tab closes) so the PIN isn't re-asked every page load within the same session.
   - **Why this layer exists at all, on top of the id-based link:** a bare `?id=` link has no
     expiry and no revoke mechanism by itself — the PIN is what actually lets office cut off access
     to an old copy of the link without changing it.
4. **[OFFICE] → PIN reset.** If a client forgets their PIN (or office wants to invalidate anyone
   holding an old copy of the link), office clicks **"🔑 Reset PIN"** from the Directory entry —
   `resetPortalPin(id,type,name)` (`apps/office/main.js:505`), which calls `rpc/portal_pin_reset`.
   This **deletes** the stored PIN hash rather than revealing it (it's a one-way hash — there is
   nothing to reveal). The client's link keeps working exactly as before; they'll simply be walked
   through the first-visit PIN-setup screen again (step 3) the next time they open it.
5. **[PORTAL] → [DATABASE]** Once past the PIN gate, jobs/certs/invoices/attachments load through
   further `SECURITY DEFINER` RPCs — `rpc/portal_get_jobs` (`main.js:620`), `rpc/portal_get_attachments`,
   `rpc/portal_get_certs`, and the invoice equivalent (Workflow 4) — all resolving by the same `id`,
   never by a client-suppliable name filter, for the same reason as step 2.

---

## Workflow 6 — Engineer's Day

Told from the Engineer app's side; step 5 below is Workflow 1's two-stage handoff (steps 4–6) from the
engineer's own perspective.

1. **[ENGINEER] Login.** The Engineer app uses **phone + 6-digit PIN, verified through a custom
   Postgres RPC — not Supabase Auth.** A code comment states this explicitly:
   ```js
   // apps/engineer/main.js:496
   // Phone+PIN login is the only way in — no Supabase Auth account involved,
   // no email/password to reset or forget.
   ```
   `doPinLogin()` (`main.js:533`) calls `rpc/engineer_pin_login` with `{p_phone, p_pin}`. The RPC
   checks the PIN server-side (bcrypt, same lockout shape as the Portal's PIN gate) and returns a
   random `session_token`, which an existing RLS layer (`is_valid_engineer_token()`/
   `my_token_engineer_name()`) uses to authorize subsequent requests — no JWT involved.
   `_applyPinSession()` (`main.js:504`) stores the token/session in `localStorage` and drops the
   engineer into the app. A phone number with no PIN set yet (brand-new engineer, or an
   office-triggered reset) is not treated as an error — `needs_setup` routes to `_showPinSetup()`
   (`main.js:525`) → `doPinSetup()` (`main.js:565`, `rpc/engineer_pin_self_setup`) instead of a login
   failure.
2. **[ENGINEER] Today's jobs.** `loadJobs()` (`main.js:832`) runs the three parallel queries described
   in Workflow 1 step 3 — Today (`date=eq.<today>`), Upcoming (next 30 days, grouped by date), and
   Done (a 60-row history including `Engineer Completed`, `Completed`, `Cannot Access`, and
   `Cancelled` — from the engineer's own point of view, "Engineer Completed" already reads as done;
   office finalizing it later to `Completed` deliberately does not make it disappear from or reappear
   in this list, per the comment at `main.js:843-846`).
3. **[ENGINEER] On-site actions, from the job detail view:**
   - **Photos** — before/after pairs sharing a `photo_slot`, uploaded via `handleUpload()`/
     `_handleBAUpload()` (`apps/engineer/photos.js`, wired at `main.js:1153-1155`), auto-stamped (UI
     label "AUTO-STAMPED", `main.js:1142`).
   - **Notes** — `saveNotes()` (`main.js:1421`), a targeted PATCH of `jobs.notes` only.
   - **Status updates** — `quickStatusUpdate()`/`updateStatus()` (`main.js:936,1312`), gated by the
     `STATUS_FLOW` state machine (business-rules §1.4): `Pending→{In Progress, Cannot Access}`,
     `In Progress→{Engineer Completed, Cannot Access}`, `Engineer Completed→{In Progress}` (self-
     correctable if marked done by mistake), `Cannot Access→{In Progress}` (re-attempt). `Completed`,
     `Invoiced`, `Cancelled` are all locked — empty transition lists — once the office has finalized,
     invoiced, or cancelled a job, the Engineer app renders an explanatory banner instead of buttons
     (`_statusButtons()`, `main.js:1271-1310`).
   - **Check-in/check-out** — the `jobs.checkin_time`/`checkout_time`/`checkin_location` columns exist
     in the schema but are confirmed unreferenced by any application code, including this recent
     two-stage-completion work; **not a feature this app actually uses**, despite the schema being
     prepared for it.
4. **[ENGINEER] Submitting requests.** From the **Requests** tab (one of the eight tabs in `TABS`,
   `main.js:1680`), overtime and leave requests both write into the single shared `engineer_requests`
   table, distinguished only by `type` — `submitOvertimeRequest()`/`submitLeaveRequest()`
   (`apps/engineer/requests.js:45,57`), each a plain `POST engineer_requests` with `status:'pending'`.
   Office responds to either kind from the same "Job Requests" inbox that also handles Portal-submitted
   `type:'portal_request'` rows (a separate, unrelated use of the same table). The engineer sees the
   office's reply (`office_reply` field) and status change the next time `loadRequests()`
   (`apps/engineer/requests.js:17`) runs. Separately, an engineer can also report a brand-new job
   directly from the field via the **Add Job** FAB — `submitAddJob()` (`main.js:1448`) — which writes
   straight to the `jobs` table with an `ENG-`-prefixed number and pings the office over WhatsApp; this
   is a different, job-creation path, not a request that needs office approval before it exists.
5. **[ENGINEER] The two-stage completion handoff, from this side.** This is Workflow 1's steps 4–6
   told from the engineer's own screen: tapping **✅ Done** sets `Engineer Completed`, never
   `Completed` directly (`main.js:936,986`) — the status pill explicitly reads **"✔ Awaiting Office
   Review"** (`main.js:1006`), not "Done," so the engineer isn't left thinking the job is fully closed
   out. From here the job is locked from the engineer's side except to reopen it back to `In
   Progress` if it was marked done by mistake (`STATUS_FLOW`, step 3 above). Everything that happens
   next — office review, finalization, certificate placeholders, the auto-draft invoice — happens
   entirely in the Office app and is invisible to the Engineer app in real time; the engineer only
   sees the end state (job moves into the `Completed`/`Invoiced` bucket of their Done tab) on their
   next refresh.

---

*Every step above was verified directly against the current application source across
`apps/office`, `apps/engineer`, `apps/portal`, and `supabase/functions/` — not carried over from the
old `12_Workflows.md`, which several of these flows (the two-stage handoff, PAT pipeline, cert
reference numbers, manual/auto cert email, Stripe checkout) postdate entirely. Line numbers are
accurate as of commit `9604cdb` (2026-08-06) and will drift with future edits — treat the named
function as the durable anchor. See [`docs/README.md`](../README.md) for the full documentation
index, [`docs/business/10-business-rules.md`](10-business-rules.md) for every conditional rule cited
above in full detail, and [`docs/architecture/05-database.md`](../architecture/05-database.md) for the
underlying schema.*
