# 14 — Certificate and Invoice Numbering Reference

This document consolidates every numbering/reference-number scheme in DeepFlow's Office app into
one place: invoice numbering (the primary subject — nothing else in the docs set walks through it
with worked examples), certificate reference numbers, job numbers, and a pointer to the non-sequential
schemes (portal tokens) that live elsewhere.

Everything below was verified directly against current source — `apps/office/main.js`,
`apps/office/certs.js`, `apps/office/credit-notes.js`, and `apps/office/index.html` — at commit
`9604cdb` (2026-08-06), not assumed from memory or from older docs. Where this document found
something that contradicts or extends `docs/business/10-business-rules.md` §1.7/§3.2 (the other
place these rules are described), that's called out explicitly.

**Purpose of this doc vs. `10-business-rules.md`:** that document explains *why* each rule exists as
part of a full business-rules catalog; this one is a narrower configuration/debugging reference —
where each setting lives in the UI, what the defaults are, and a worked numeric example for each
scheme, so "why did this invoice/job/cert get number X" has one place to check.

---

## 1. Invoice Numbering

DeepFlow runs **two independent, genuinely separate** invoice number series, plus two more schemes
(proforma, credit note) that build on top of them. All of it funnels through one function.

### 1.1 The core function: `nextInvNum(isAgency)`

`apps/office/main.js:3275-3302`

```js
async function nextInvNum(isAgency=false){
  const prefix=isAgency?(S.agencyInvPrefix||'AGN-'):(S.invPrefix||'INV-');
  try{
    const n=await _sb(isAgency?'rpc/next_agn_num':'rpc/next_inv_num',{method:'POST',body:{}});
    if(typeof n==='number'){
      if(!isAgency) S.invNextNum=n+1;
      return prefix+n;
    }
  }catch(e){ console.warn('[nextInvNum] RPC failed, using fallback',e); }
  // Scan ALL existing invoices to guarantee uniqueness — prevents duplicate numbers
  const allInvs=await dAll('invoices');
  let maxN=isAgency?(S.agencyInvStart||2001):(S.invNextNum||S.invStart||1001);
  ...
}
```

- **Landlord invoices** (`isAgency=false`): prefix `S.invPrefix` (default `'INV-'`), numbers drawn
  from an atomic Postgres sequence (`inv_num_seq`, via RPC `rpc/next_inv_num`).
- **Agency invoices** (`isAgency=true`): prefix `S.agencyInvPrefix` (default `'AGN-'`), numbers drawn
  from a **separate** sequence (`agn_num_seq`, via RPC `rpc/next_agn_num`).
- Both sequences are genuinely independent — creating agency invoices does not consume or skip
  numbers in the landlord series, and vice versa.
- **Fallback path:** if the RPC call fails (the sequence-creating SQL migration,
  `PHASE3_NUMBERING_SEQUENCES_SQL.md` at repo root, hasn't been run on that Supabase project), the
  code falls back to scanning every existing invoice, finding the highest number with that prefix,
  and adding 1. This is a real, working fallback, not just an error path — it produces the same
  numbers the atomic path would, just without the race-condition protection.
- **This is not a monthly or annual counter.** There is no reset — `invNextNum`/`agencyInvStart`
  keeps climbing forever from whatever starting number was configured. "The 5th invoice this month"
  and "the 5th invoice ever" are the same thing unless you manually fast-forward the sequence (§1.2).

### 1.2 Where to configure it — Settings → Invoicing tab

`apps/office/index.html:3355-3364` (tab id `stab-invoicing`, nav button `◎ Invoicing`):

| Field (UI label) | Element id | Setting | Default |
|---|---|---|---|
| Invoice Prefix *(landlord jobs)* | `s-inv-prefix` | `S.invPrefix` | `INV-` |
| Invoice Starting Number | `s-inv-start` | `S.invNextNum` (see note below) | `1001` |
| Agency Invoice Prefix *(for agent jobs)* | `s-agency-inv-prefix` | `S.agencyInvPrefix` | `AGN-` |
| Agency Starting Number | `s-agency-inv-start` | `S.agencyInvStart` | `2001` |

**Note on the two "start" settings:** the app object actually has both `S.invStart` and
`S.invNextNum` (both seeded to `1001` in the defaults block, `main.js:239`), and `nextInvNum()`'s
fallback path reads `S.invNextNum||S.invStart||1001` — `invNextNum` wins. The Settings UI field
(`s-inv-start`) only ever writes to `S.invNextNum` (`main.js:9152-9158`); `S.invStart` is effectively
a dead legacy fallback that the UI cannot set. Don't be confused if you see both keys in the raw
settings JSON — only `invNextNum` is live.

**Changing a starting number after invoices already exist:** saving a new value in either "Starting
Number" field calls `rpc/admin_set_seq` (`main.js:9156,9164`), which does
`ALTER SEQUENCE ... RESTART WITH <new_start>` on the underlying Postgres sequence — a real
fast-forward (or rewind), not just a local default. Restricted server-side to the five known
sequence names (`job_num_seq`, `job_cr_seq`, `inv_num_seq`, `agn_num_seq`, `proforma_num_seq`) so it
can't be abused to run arbitrary SQL.

### 1.3 Worked examples

With defaults untouched (`invPrefix='INV-'`, starting number `1001`):

| Invoice # (landlord series) | Number issued |
|---|---|
| 1st landlord invoice ever created | `INV-1001` |
| 2nd | `INV-1002` |
| 5th | `INV-1005` |

If an admin instead sets **Invoice Starting Number** to `2001` before any landlord invoices exist
(and prefix stays `INV-`): the 1st is `INV-2001`, the 5th is `INV-2005` — this is the shape of
example the "5th invoice becomes INV-2005" framing implies, but note it only lands on a round number
like that because the *starting* number was set to `2001`, not because of any monthly reset.

Agency series, defaults untouched (`agencyInvPrefix='AGN-'`, start `2001`): 1st agency invoice is
`AGN-2001`, 5th is `AGN-2005` — running in parallel with, and independent of, the landlord series
above. If the shop had already issued 40 landlord invoices (`INV-1001`...`INV-1040`) and zero agency
invoices, the next agency invoice is still `AGN-2001`, not `AGN-1041`.

### 1.4 Which series a job's invoice lands on

`_autoInvoiceInner()` (`main.js:3226`) decides landlord vs. agency by:

```js
number:await nextInvNum(!!(j.agencyName||j.agentName)),
```

i.e. a job with **either** an agency name or an agent name on it gets an `AGN-` number; everything
else gets `INV-`. (`docs/business/10-business-rules.md` §3.2 documents this as a fixed historical
bug — the call used to always pass no argument, silently defaulting every auto-created invoice to
the landlord series regardless of who the job was actually for. Confirmed fixed in current source.)

**Manually creating an invoice from the Invoices screen** (`main.js:12541`,
`nextInvNum(invoiceData.invoiceType==='agency')`) decides the series from an explicit
`invoiceType` field the user picks in the invoice form, not from job data — a different code path
from auto-invoice, worth knowing if a manually-created invoice's series doesn't match what you'd
expect from the job's agency/landlord fields.

### 1.5 Proforma invoices

Proformas are quotations — draft-only documents that don't consume the `INV-`/`AGN-` series at all.
They have their own prefix, sequence, and RPC.

`nextProformaNum()` (`main.js:3309-3322`):

```js
async function nextProformaNum(){
  try{
    const n=await _sb('rpc/next_proforma_num',{method:'POST',body:{}});
    if(typeof n==='number') return 'PF-'+String(n).padStart(3,'0');
  }catch(e){ ... }
  ...
  return 'PF-'+String(n+1).padStart(3,'0');
}
```

- Fixed prefix `PF-` (**not** configurable in Settings — no UI field exists for it).
- 3-digit zero-padded (`PF-001`, `PF-002`, ... `PF-042`).
- Own atomic sequence (`proforma_num_seq` / `rpc/next_proforma_num`), same RPC-then-scan-fallback
  pattern as invoices.
- Two creation paths, both landing in this same series:
  - `createProforma(jobId)` (`main.js:3325-3367`) — proforma generated from an existing job.
  - `createStandaloneProforma(...)` (`main.js:3432-3463`) — proforma with no job yet; this path also
    auto-creates a linked job (see §3.3 below — that job's number has a real gotcha).

**Worked example:** the 3rd proforma ever created (regardless of which of the two creation paths
made it) is `PF-003`.

### 1.6 Converting a proforma into a real invoice

`convertProformaToInvoice(proformaId)` (`main.js:3466-3480`):

```js
async function convertProformaToInvoice(proformaId){
  const inv=await dGet('invoices',proformaId);
  if(!inv){toast('Proforma not found','error');return;}
  if(inv.type!=='proforma'){toast('Not a proforma invoice','error');return;}
  const isAgency=inv.agentName?true:false;
  const realNum=await nextInvNum(isAgency);
  ...
  await _sb('invoices?id=eq.'+proformaId,{method:'PATCH',body:{type:'invoice',number:realNum,status:'Draft',proformaConverted:true,convertedAt:now,modified:now}});
  await _sb('invoice_audit',{method:'POST',body:{invoiceId:proformaId,action:'converted',from:'proforma',to:realNum,user:_appUser?.name||'System',timestamp:now}});
  ...
}
```

Confirmed exactly as expected:
- The same database row is reused (`PATCH` on `proformaId`) — the proforma doesn't get deleted and
  recreated, it's mutated in place: `type` flips from `'proforma'`→`'invoice'`, it's given a brand-new
  real invoice number from the appropriate series, `status` resets to `'Draft'`, and
  `proformaConverted:true` / `convertedAt` are stamped for traceability.
- The original `PF-###` number is **never reused** — once converted, that proforma number is retired
  for good (the row that had it no longer has `type:'proforma'`, so it won't show up in proforma
  listings, but the number itself isn't recycled back into the `PF-` sequence either).
- **Confirmed:** a row is written to `invoice_audit` with `action:'converted'`, `from:'proforma'`,
  `to:<new invoice number>`, `user`, and `timestamp` — exactly as expected.

**A real inconsistency worth flagging, verified from source:** the series decision here checks only
`inv.agentName` — *not* `inv.agencyName` (compare to §1.4's auto-invoice check, which checks
`j.agencyName||j.agentName`, both fields). This turns out to be self-consistent rather than a bug in
practice, because `createProforma()`'s invoice body (`main.js:3339-3362`) only ever copies
`agentName:job.agentName||''` onto the proforma — it never copies `job.agencyName` at all. So a job
that was referred purely through an **agency** (an `agencyName` but no separate `agentName`) will:
- get an `AGN-` invoice if auto-invoiced directly from the job (§1.4), but
- get an `INV-` (landlord-series) invoice if a proforma is created from that same job and later
  converted — because the proforma never carried the agency name forward for the conversion check to
  see.

Worth knowing if you ever see a proforma-converted invoice land in the wrong series for a job you'd
expect to be agency-billed.

### 1.7 Credit notes

`apps/office/credit-notes.js:78-119`, `saveCreditNote()`. A credit note is **not** drawn from any
number sequence — its number is derived deterministically from the invoice it's issued against:

```js
number: (S.invPrefix||'INV-') + 'CN-' + (origInv?.number||'').replace(S.invPrefix||'INV-',''),
```

**Worked example:** a credit note issued against `INV-1042` (with default `S.invPrefix='INV-'`)
becomes `INV-CN-1042` — take the original number, strip the landlord prefix off the front, and
rebuild it as `<landlord prefix>CN-<stripped number>`.

Two things worth knowing, both verified directly from the line above:

- **It always uses `S.invPrefix` (the landlord prefix), even against an agency invoice.** The
  `.replace()` only strips `S.invPrefix` (`'INV-'`) — if the original invoice is `AGN-2007`, that
  string doesn't start with `'INV-'`, so nothing gets stripped, and the result is
  `'INV-' + 'CN-' + 'AGN-2007'` = **`INV-CN-AGN-2007`**, not a clean `AGN-CN-2007`. Cosmetically odd
  but not a uniqueness problem — the number is still unique per source invoice.
- **No collision guard if two credit notes are issued against the same invoice.** The formula is
  purely a function of the original invoice's number — nothing checks for an existing credit note
  with that number before saving. Two credit notes against `INV-1042` would both be saved with
  `number:'INV-CN-1042'` (each still gets its own unique `id`/uid internally, so neither write fails,
  but the human-facing reference number is duplicated). If your business process allows more than one
  credit note per invoice, this is a real, currently-unhandled edge case — not a hypothetical.

### 1.8 Disposable invoices

Confirmed real, not a leftover concept — `S` filters an `_invType==='disposable'` tab
(`main.js:6328`: `filter(i=>i.disposable===true)`).

`createDisposableInv(clientName, amount, desc)` (`main.js:3370-3390`):

```js
async function createDisposableInv(clientName, amount, desc){
  const now=Date.now();
  const num=await nextInvNum(false);
  ...
  const body={
    type:'invoice',status:'Draft',number:num,
    ...
    disposable:true,created:now,modified:now
  };
  ...
}
```

- **Disposable is a boolean flag on a normal invoice row, not a separate type or number series.**
  `nextInvNum(false)` is called exactly the same as any other landlord invoice — a disposable
  invoice consumes the next number in the regular `INV-` sequence, interleaved with ordinary landlord
  invoices in the same running count. There's no `DISP-` prefix or separate counter.
  - **Worked example:** if the landlord sequence is currently at `INV-1050`, creating a "quick,
    minimal-detail" disposable invoice next produces `INV-1051` — indistinguishable by number alone
    from a regular landlord invoice; only the `disposable:true` flag (and the Disposable filter tab)
    marks it as such.
- Intended for quick one-off invoices with minimal details ("may be deleted" per the source comment)
  — always lands on the landlord series (`nextInvNum(false)` is hardcoded, never agency).

---

## 2. Certificate Reference Numbers

**Note:** as of this writing, `docs/business/13-pat-certificates.md` (the planned PAT-specific
deep-dive) does not exist yet in this repo — only `docs/business/10-business-rules.md` §2.6/§2.7
covers this today, in more narrative depth than the summary below. If that file is created later,
the algorithm walkthrough here should be trimmed to a cross-link rather than kept in parallel.

Certificates use a completely separate scheme from invoices, defined in `apps/office/certs.js:50-131`.

**The universal, opt-in serial — `S.certRefSerial` / `generateCertRef()`:**

```js
// certs.js:126-131
async function generateCertRef({address,appliances,hasAppliances,issueDate}){
  const base=await _nextCertBaseRef();
  const middle=hasAppliances?String((appliances||[]).length):_ddmmUnpadded(issueDate);
  const tag=addressRefPart(address);
  return tag?`${base}0${middle} / ${tag}`:`${base}0${middle}`;
}
```

Key facts, verified from source:

- **Applies to every certificate type**, not just PAT — the incrementing serial (`S.certRefSerial`)
  is shared across all cert types, so no two certificates of any type, issued on any day, ever land
  on the same base. That base is what guarantees uniqueness; everything appended after it
  (appliance-count-or-date, address tag) is decoration, not the uniqueness mechanism.
- **Opt-in, not default-on.** `S.certRefSerial` defaults to `''` (empty) in `S` (`main.js:227`).
  Auto-numbering for this scheme only fires when a cert is saved via the manual "Add Certificate"
  form with the Reference Number field left blank **and** `S.certRefSerial` has been set
  (`certs.js:480`: `if(!certNum&&!isEdit&&S.certRefSerial)`). Leave it blank in Settings and manual
  reference-number entry keeps working exactly as before.
- **Configured in Settings → Trades & Services tab** (not Invoicing) — field "Auto Reference Starting
  Serial (optional)", element id `s-cert-ref-serial` (`index.html:3330-3334`), under the Certificate
  Types section. This is a common point of confusion since it's a numbering setting living outside
  the Invoicing tab.
- **Worked example** (matching the UI's own placeholder text): starting serial `GBE1000` → next cert
  saved gets base `GBE1001` → the one after that `GBE1002`, and so on. The increment
  (`_incStr()`, `certs.js:72-75`) preserves the digit run's width, so `GBE1009`→`GBE1010`, not
  `GBE10010`.
- **Never overwrites on edit** — re-saving an existing certificate does not regenerate or touch its
  reference number.
- This is a **different, separate** code path from the auto-generated reference certain jobs get when
  a certificate is auto-created straight from job completion (`(ct.prefix||'CERT-')+<digits from job
  number>+'-'+<last 4 digits of timestamp>`, `certs.js`/`main.js` around the job-completion cert
  flow) — that path is always active regardless of `S.certRefSerial`, and only the manual
  Add-Certificate-form path respects the opt-in serial described above.

---

## 3. Job Numbers

`nextJobNum(prefix)` (`main.js:3099-3150`) — guarded by an in-memory mutex (`_jobNumLock`) so two
concurrent calls in the same tab can't produce duplicate numbers while awaiting the RPC.

### 3.1 Regular jobs — `JOB-####`

```js
const jobPrefix=S.jobPrefix||'JOB-';
...
return jobPrefix+String(chosen).padStart(4,'0');
```

- Default prefix `S.jobPrefix='JOB-'` (`main.js:231`), 4-digit zero-padded, default start `1001`
  (`S.jobNextNum`).
- Atomic sequence `job_num_seq` via `rpc/next_job_num`, scan-based fallback otherwise — same pattern
  as invoices.
- **There is no Settings UI field for the job prefix or starting number** — unlike every invoice
  series above, `S.jobPrefix`/`S.jobNextNum` can only be changed by editing the settings object
  directly (e.g. via SQL or the raw settings JSON), not through the Settings screen. Confirmed absent
  from `index.html` (no `s-job-prefix` or equivalent element exists) and explicitly called out as a
  known gap in `PHASE3_NUMBERING_SEQUENCES_SQL.md`.
- **Worked example:** with defaults untouched, the 50th job ever created is `JOB-1050`.

### 3.2 Portal-submitted client requests — `CR###`

```js
if(prefix==='CR'){
  ...
  if(typeof n==='number') return 'CR'+String(n).padStart(3,'0');
  ...
  return 'CR'+String(maxN+1).padStart(3,'0');
}
```

- Triggered by calling `nextJobNum('CR')` — used when the office converts an engineer/client request
  submitted through the portal into a real job (`_reqCreateJob()`, `main.js:7662`).
- **No hyphen** — the format is `CR` directly followed by a 3-digit zero-padded number (`CR001`,
  `CR042`), confirmed by both the generator (`'CR'+String(n).padStart(3,'0')`) and the parser regex
  used in the fallback scan (`/^CR(\d+)$/i`, `main.js:3116`). **This corrects
  `docs/business/10-business-rules.md` §1.7**, which describes the format as `CR-####` (with a
  hyphen, 4-digit pad) — current source does not match that description; it's `CR` + 3 digits, no
  hyphen.
- Own separate atomic sequence (`job_cr_seq` via `rpc/next_cr_num`) — entirely independent of the
  regular `JOB-` counter; creating `CR` jobs never consumes or skips regular job numbers.
- **Worked example:** the 7th portal-originated job request converted to a job is `CR007`.

### 3.3 A real gotcha: the "PR job" from a standalone proforma does not actually get a `PR-` number

`createStandaloneProforma()` (`main.js:3448`) calls:

```js
const prNum=await nextJobNum('PR');
```

expecting (per the variable name and the surrounding comment, "Auto-create a PR job linked to this
proforma") a `PR`-prefixed job number. **This is not what happens.** Re-reading `nextJobNum()`
(§3 above): the function only special-cases the literal string `'CR'`. Any other argument — including
`'PR'` — falls straight through to the default branch, which **ignores the `prefix` parameter
entirely** and always uses `S.jobPrefix||'JOB-'`:

```js
async function nextJobNum(prefix){
  ...
  if(prefix==='CR'){ ... return 'CR'+... }
  // Default branch — prefix argument is never read here
  const jobPrefix=S.jobPrefix||'JOB-';
  ...
  return jobPrefix+String(chosen).padStart(4,'0');
}
```

So a job auto-created from a standalone proforma gets an ordinary `JOB-####` number, drawn from —
and consuming a slot in — the exact same sequence as every other regular job, not a distinct `PR-`
series. The `prNum` variable name, the `'PR'` argument, and the code comment all imply a dedicated
series that does not exist in the current implementation. This is a genuine, source-verified
discrepancy between intent and behavior (not present in `10-business-rules.md`, which doesn't
mention this code path), worth knowing if you're ever trying to explain why a proforma-linked job's
number looks like every other job's.

---

## 4. Other reference schemes found while investigating

- **Engineer request references:** no separate reference-number scheme exists for engineer/client
  portal requests beyond the `CR###` job number they become once approved (§3.2) — searched
  `apps/office/engineer-reports.js` and the request-handling code in `main.js`; there is no
  independent "request ID" format distinct from the job number assigned at conversion.
- **Portal invite links / auth tokens:** these exist (`showPortalInviteModal()` etc.,
  `main.js:13540-13660`) but are **not** sequential or human-facing reference numbers — they're
  opaque auth tokens embedded in a shareable link/QR "visiting card." They're out of scope for this
  numbering reference; see `docs/architecture/08-authentication-and-roles.md` for the auth-token
  design. **That file does not exist yet in this repo either** — the only current write-up of
  session/token handling lives in the older `docs/08_Authentication_and_Roles.md`, which briefly
  covers token handling in its "Session & Token Handling" section but not portal invite links
  specifically.

---

## Summary table

| Scheme | Prefix (default) | Padding | Sequence | Settings location | Resets? |
|---|---|---|---|---|---|
| Landlord invoice | `INV-` | none (raw int) | `inv_num_seq` | Settings → Invoicing | Never |
| Agency invoice | `AGN-` | none | `agn_num_seq` | Settings → Invoicing | Never |
| Disposable invoice | `INV-` (same as landlord) | none | `inv_num_seq` (shared) | Settings → Invoicing | Never |
| Proforma | `PF-` (fixed) | 3-digit | `proforma_num_seq` | Not configurable | Never |
| Credit note | `INV-CN-<orig #>` (derived) | n/a | none — deterministic | Not configurable | n/a |
| Certificate (universal opt-in) | admin-defined (e.g. `GBE`) | none (trailing digits) | `S.certRefSerial` in settings row | Settings → Trades & Services | Never |
| Job (regular) | `JOB-` | 4-digit | `job_num_seq` | Not configurable in UI | Never |
| Job (portal request) | `CR` (no hyphen) | 3-digit | `job_cr_seq` | Not configurable | Never |
| Job (standalone-proforma-linked) | `JOB-` (despite `'PR'` argument — see §3.3) | 4-digit | `job_num_seq` (shared with regular jobs) | Not configurable | Never |
