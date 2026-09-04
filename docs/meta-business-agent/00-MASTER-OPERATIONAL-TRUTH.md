# GB Electrical — Master Operational Truth

Source of truth for the Meta Business Agent training pack. Every claim below is grounded in the live DeepFlow codebase (`D:\DEEPFLOW`), not invented. Where a fact comes from configuration rather than fixed code (meaning it could differ in the live database from what's shown here), it's marked **CONFIGURABLE — VERIFY LIVE**. Where no code or documentation answers a question, it's marked **UNKNOWN** and copied into `OWNER-CONFIRMATIONS.md` — nothing here was guessed to fill a gap.

---

## 1. Company identity

| Context | Name to use | Source |
|---|---|---|
| Customer-facing / WhatsApp / normal conversation | **GB Electrical** | Owner instruction, this workstream |
| Legal / formal / contracts / accounts / procurement | **GB Electrical Engineering Ltd** | Owner instruction, this workstream |
| Website | gbelectricals.co.uk | Owner instruction, this workstream |

The app's own Settings page stores a single free-text company profile (`coName`, `coEmail`, `coPhone`, `coAddr`, `coVatNum` — `apps/office/main.js:366`) used on every invoice and email. **CONFIGURABLE — VERIFY LIVE**: confirm the live value of `coName` in Settings actually reads "GB Electrical" and not "GB Electricals" — this is exactly the kind of drift the owner flagged as having caused confusion before, and it's a plain text field an office user could have typed either way.

There is also a newer, unused-by-default `companyProfiles` array (`apps/office/main.js:352`) that lets a specific certificate type (e.g. PAT testing) be issued under a *different* named company/logo than the main profile. It's empty by default — every cert type uses the main profile unless an admin has explicitly set one up. **CONFIGURABLE — VERIFY LIVE** if this is in use.

---

## 2. Client types (how "who is this job for" is modelled)

The software does not have a single generic "customer" record. It has three distinct real entities, plus a free-text fallback, and every job resolves to exactly one of them for billing purposes, in this priority order:

**Agency → Agent → Landlord → Referrer (free text)**

(`apps/office/main.js`, the resolution chain `j.agencyName||j.agentName||j.landlordName||j.referrer`, used identically for invoice billing name, portal linking, and Directory search — this exact chain appears at multiple call sites, e.g. `main.js:3374`.)

- **Agency** — a company (e.g. a letting/managing agency), stored as its own record with name/phone/email/address/bank details. Not a person.
- **Agent** — a person who works *for* an agency. As of this session, an Agent is modelled as a `persons` record with the role `agent` and a link to which agency they belong to (`agencyId`). Picking an agent on a job auto-fills their agency too.
- **Landlord** — a private property owner, modelled as a `persons` record with role `landlord` (a person can also simultaneously hold the `client` or `subcontractor` role).
- **Referrer** — a free-text fallback field on the job, no longer manually typed by staff (it's computed automatically from whichever of Agency/Agent/Landlord is filled in) but still present on older job records where nothing more specific was ever captured.

There is no separate "Tenant" client-type record — a tenant is captured only as free text in the job's `access`/`contact` fields (who to call for access), never as a billing party.

There is no distinct "Commercial client" record type in the schema — a commercial client is simply an Agency or Landlord record used for a non-residential property; nothing in the software distinguishes commercial from residential structurally.

**Fields actually available on a person/agency/agent record:** name, phone, email, WhatsApp number, address, notes, bank details (name/account/sort code/reference). Agencies additionally have a website field. There is no "account manager", "credit limit", "payment terms override", or "preferred contact method" field on any client record.

---

## 3. Property model

Properties are **not** a fully independent database entity with their own dedicated record — the app derives a running "property history" by matching job addresses (`apps/office/main.js`, `allProps` built from job address history in `_refreshAllProps()`). A property's history (past jobs, past landlord/agency association, certificates) is assembled by looking up every past job at that exact address string, not by a stable property ID.

Practical implication for the AI: if a customer refers to "the property" or "my flat," the system identifies it by matching the address text, not by a property reference number. There is no formal "property reference" field distinct from the address itself, and no field the AI should call a "property ID."

Address autocomplete/lookup exists via postcodes.io (a free UK postcode API) — it can suggest an address for a postcode but does **not** provide door-number-level detail; users may need to type/confirm the exact address line themselves.

---

## 4. Job model — fields actually on a job record

Reconstructed directly from the New Job form (`apps/office/index.html`, job modal) and the save function (`saveJob()`, `apps/office/main.js`):

| Field | Category | Notes |
|---|---|---|
| Job number (`jobNum`) | SYSTEM GENERATED | Auto-sequenced, prefix "JOB-" by default (`jobPrefix`, `jobNextNum` in Settings — **CONFIGURABLE — VERIFY LIVE**). Self-healing against duplicates. |
| Property address | REQUIRED | Free-text with autocomplete against past properties/postcode lookup. |
| Postcode | OPTIONAL | Helper field to speed up address entry; not stored as a separate authoritative field from the address line. |
| Job date | REQUIRED | A single calendar date — see §7 on what this date does and does not mean. |
| Time slot | OPTIONAL | Free text (e.g. "Morning 08:00–12:00"), not a strict start/end time pair. |
| Description | OPTIONAL but usually present | Free text; certificate types are auto-detected from keywords in this text (e.g. typing "gas" suggests the Gas Safety cert type). |
| Access | OPTIONAL | Free text or a picklist of common values (Key Safe, Landlord Present, Tenant Home, Vacant – Call Before) — **CONFIGURABLE — VERIFY LIVE** exact live list. |
| Contact | OPTIONAL | Free text — typically the on-site contact name/number/access code, distinct from the billing party. |
| Price | INTERNAL ONLY — never customer-facing without confirmation | See §12, Pricing. |
| Priority | REQUIRED (defaults to Normal) | One of: Normal, Emergency, Urgent, Certificate, Repair, Low. This field also drives the visual "job type" colour-coding in office tools — it is **not** a separate "job type" field, it's overloaded to mean both urgency and category. |
| Certificate types required | CONDITIONAL | Zero or more of the configured certificate types (§9), multi-select, auto-suggested from the description text. |
| Engineer | OPTIONAL | Single "lead" engineer field on the job itself. See §8 and §11 for how additional engineers on later visits are handled — they are **not** the same field. |
| Status | SYSTEM MANAGED, staff-editable | See §6 — exactly 7 values, no others exist. |
| Notes | OPTIONAL | Free text, internal. |
| Landlord / Agency / Agent fields | CONDITIONAL | See §2 — whichever one applies, with sub-fields (phone/email/address/WhatsApp/notes) that auto-fill from the Directory when an existing contact is selected. |
| Confirmed | Not present as a job field. | The demo reference design the office reviewed had a "confirmed" appointment indicator; **the live software does not currently track a confirmed/unconfirmed appointment state on a job.** Do not train Meta to reference appointment confirmation status as if it's a real, checkable field — see §7. |

**Fields the customer should never be asked to provide directly:** job number (system-generated), status (staff-set), price (staff-confirmed, never customer-supplied), internal notes.

---

## 5. Job status lifecycle

Exactly seven statuses exist in the codebase (`packages/business/status.js`) — no others:

1. **Pending** — job created, not yet actioned.
2. **In Progress** — an engineer has started.
3. **Engineer Completed** — the engineer has finished on-site work and left, but office has not yet reviewed/finalised it.
4. **Completed** — office has finalised the job. This is the trigger that auto-creates a Draft invoice (see §13) and auto-creates placeholder certificate records for any selected certificate types (with no expiry date yet — see §9).
5. **Invoiced** — used in some reporting contexts as an alternate "done" state alongside Completed; the exact distinction between "Completed" and "Invoiced" as a *job* status (as opposed to the invoice's own status) is not fully documented in the code comments and should be confirmed with office staff rather than assumed by Meta.
6. **Cannot Access** — engineer attended but could not gain entry/access.
7. **Cancelled** — job cancelled. A job moving *out of* a "final" status (e.g. Completed → something earlier) is specifically logged as a "status reversion" for audit purposes, meaning reversions are unusual enough that the software treats them as noteworthy events, not routine.

**There is no "Confirmed", "Scheduled", "Awaiting Parts", "On Hold", or "Quoted" status.** If a customer or agent uses any of that language, Meta must map it to the real statuses above or say it doesn't have a matching status to report, rather than inventing one.

---

## 6. Appointment model — critical, read carefully

This is the single most important distinction for the AI to get right.

**A job has exactly one field for "when": a job date, plus an optional free-text time slot.** There is no separate "requested date" vs "confirmed date" vs "provisional date" field structure in the software. A date on a job is simply *the date currently on the job* — set either when the job was created or changed later by office staff (including via drag-and-drop in the internal planner).

**There is no confirmation flag.** The software does not currently store whether an appointment has been "confirmed" with the customer as distinct from just having a date. This means:

- Meta must **never** say an appointment is "confirmed" as if that's a verified system state — the system has no such state to check.
- The most accurate, safe language is: *"the date currently booked for this job is [X]"* — stating what the record shows, not implying a separate confirmation step happened.
- If a customer gives a *preferred* date in their first message ("Thursday 10–12"), that preference should be collected and passed to office, but Meta must not tell the customer their job *is* booked for that date — only that GB Electrical will confirm it.
- Time slots are free text, not strict start/end times — never promise a precise arrival time (e.g. "10:00 exactly") when the system only holds a range or a loose slot description.

**Rescheduling:** changing a job's date is a normal, unrestricted staff action (including drag-and-drop in the internal scheduling views) — there is no separate "reschedule request" record type or approval workflow in the software. A reschedule request from a customer is simply routed to office as a normal message; Meta should not imply there's a formal reschedule ticket system, because there isn't one.

---

## 7. Engineers

- `S.engineers` — the live list of engineers is loaded from the real user accounts in the system (Supabase `users` table), **never hardcoded**. Meta must never invent an engineer name.
- A job has **one** "lead engineer" field.
- As of this session, a **visit** (§8) can have **multiple** engineers attached (a real array field, `engineers`, on each visit record) — this is where genuine multi-engineer attendance is modelled, not on the job's single `engineer` field.
- There is no engineer telephone/location/ETA field exposed anywhere in the job or visit data that Meta could read. **Never state an engineer's phone number, live location, or estimated arrival time** — none of that is tracked by the software at all, so there is nothing to truthfully report even under a "verified data" exception.
- Engineers are not skill-tagged by service type in the software (there's no "this engineer is Gas Safe registered" flag on the engineer record) — do not assume or state that a specific engineer is qualified for a specific service.

---

## 8. Projects and multi-visit jobs

This exists in the live software, built this session, and works as follows:

- A **job stays exactly one job record, with one job number, for its entire life** — it is never split into JOB-1234, JOB-1235, JOB-1236 for multiple site visits. All visits belong to the same job number.
- A **Visit** is a separate linked record (`job_visits` table) — each visit has its own date, its own set of engineers (array, supports multiple), free-text notes, and now engineer comments (a running log of remarks tied to that specific visit, added by office staff).
- Visits are numbered by their chronological order (Visit 1, Visit 2, Visit 3, ...) — this is computed by position, not a manually-entered field.
- **"Project" is not a separate status or a separate entity from "Job."** Internally, a job is treated as a genuine multi-visit project simply once it has 2 or more visits logged against it — there is no toggle staff have to flip to "convert" a job into a project; adding a second visit *is* what makes it one. When Meta needs to describe this state to a customer, "this is an ongoing job with multiple visits" is accurate; "project" as a distinct formal status does not exist in the underlying data model, only as a UI grouping label.
- Photos can, in principle, be tagged to a specific visit (the database supports it) but **the photo-upload flow from the engineer's mobile app does not yet let an engineer choose which visit a photo belongs to** — as of this audit, newly uploaded photos are not reliably linked to an individual visit. Do not tell a customer "here are the photos from Visit 2" as a guaranteed capability; treat visit-specific photo retrieval as **not yet reliable** and escalate to office if a customer asks for it.

---

## 9. Certificates

- Certificate *types* are configurable (`S.certTypes`), each with a name, a validity period in months, a reminder window, and a prefix used for auto-generated reference numbers. The current default configuration (from the software's shipped defaults — **CONFIGURABLE — VERIFY LIVE**, the office may have changed this) is:

  | Certificate | Validity | Prefix |
  |---|---|---|
  | Gas Safety | 12 months | GAS- |
  | Electrical (EICR) | 60 months (5 years) | EICR- |
  | Fire Alarm | 12 months | FIRE- |
  | Emergency Lighting | 12 months | EML- |
  | PAT Testing | 12 months | PAT- |
  | EPC | 120 months (10 years) | EPC- |
  | Legionella | 24 months | LEG- |

- A certificate is auto-created as a **placeholder** (no expiry date yet) the moment office marks a job "Completed" with that certificate type selected. It does **not** get an expiry date, a pass/fail result, or a PDF automatically — a human has to add the real inspection outcome and upload/generate the document afterwards.
- **Meta must never state a certificate's result (pass/fail/satisfactory), expiry date, or delivery status unless that specific data is confirmed present on the record.** A "Completed" job does not mean a finished, issued certificate exists yet.
- Certificates can be linked back to a job and, through the job, to a property's history.
- Renewal reminders exist as a concept (a `reminder` window per cert type, and an expiry dashboard) but the underlying reminder-log table was found to be unpopulated in earlier work on this system — do not assume every property with an aging certificate has already been proactively contacted; that has not reliably been happening.

---

## 10. Invoices

- Exactly five invoice statuses exist in the code: **Draft, Awaiting Payment, Paid, Cancelled, Credit Note.** No "Overdue" status exists as a stored state — "overdue" is *computed* on the fly (an invoice whose status is still "Awaiting Payment" past its due date), not a status a record is ever actually set to.
- Two invoice **types** exist: a normal `invoice`, and a `proforma` (a pre-invoice quote-like document) which can later be converted into a real invoice.
- **As of this audit, a job supports being linked to one invoice at a time, auto-created when the job is marked Completed.** Genuine progressive multi-invoice billing against a single job/project (e.g. an £8,000 invoice then a £6,000 invoice against the same £20,000 quoted project) is a **planned but not yet built** capability — do not tell a customer "here is invoice 2 of 3 for your project" as if that workflow already exists; verify with office before this workstream assumes it's live.
- VAT is **disabled by default** (`vatEnabled:false` in Settings) — **CONFIGURABLE — VERIFY LIVE** whether the business has since turned this on. Never state whether VAT applies without checking the live setting.
- Default payment terms text in the software: "Payment due within 14 days" — **CONFIGURABLE — VERIFY LIVE**, this is an editable Settings field, not a fixed company policy fact.
- An invoice's `billToName` can be deliberately different from the real linked landlord/agency (a display-only override, e.g. showing a different trading name on the paperwork) — if a customer disputes who an invoice is addressed to, this is a real, intentional feature, not necessarily an error, and should be escalated to office rather than Meta guessing why.

---

## 11. Payments

- Payments are recorded against an invoice; an invoice's status (Paid vs Awaiting Payment) reflects whether it's been marked paid — there is no separate detailed partial-payment ledger status distinct from the invoice status list in §10 (i.e. there is no dedicated "Part Paid" status value in the code — if a customer or the office ever uses the term "part paid," clarify it against the real status list rather than assuming the software has a matching state).
- **Never state an invoice is paid because the job is complete.** Job completion and invoice payment are two entirely separate, unrelated facts in the data model — confirmed independently.
- No payment card, bank login, or authentication detail is ever collected or stored in this software. Meta must never request card numbers, PINs, or banking passwords from a customer under any circumstance — the business has no legitimate reason to need them via WhatsApp, and the software has nowhere to put them anyway.

---

## 12. Pricing

- A job has a single internal `price` field — this is not customer-visible by default (it's gated behind a `seePrice` permission flag internally, meaning some staff roles can't even see it) and is **never** auto-calculated from a rate card, service type, or client tier. Every price is a manually entered figure by office.
- There is **no fixed price list, no per-service standard price, no automatic client-specific or agency-specific pricing rule anywhere in the software.** Any "our EICRs are usually £X" figure is not something the system can confirm — it would only ever come from a human's memory, and per the owner's explicit instruction, a human's past casual remark is not the same as verified company pricing.
- **Meta must never quote, estimate, or imply a price.** The only correct behaviour when asked "how much will this cost" is: collect the job details, tell the customer GB Electrical will confirm the price, and do not offer a number, range, or "typically around" figure under any circumstance.

---

## 13. Access / security data the software holds

Job records can contain: access instructions (key safe codes, alarm codes, "landlord present," tenant contact details), free-text notes, and contact phone numbers for people who are not the billing party. This is sensitive operational information. See `27-privacy.md` for the specific handling rules — the short version: Meta should treat access codes and tenant contact details as things to *collect and pass to the assigned engineer/office*, not to *repeat back or confirm out loud* to an unverified party in chat, since WhatsApp does not verify who is on the other end of a conversation claiming to be "the landlord."

---

## 14. What this audit could NOT determine from the software (see `OWNER-CONFIRMATIONS.md` for the full list)

The software has no field, setting, or record for: opening hours, emergency call-out charges or policy, geographic coverage area, weekend/out-of-hours surcharge, cancellation policy, certificate turnaround-time commitment, refund policy, or a service-level agreement. None of these can be answered from code — they are business decisions that must come from the owner directly, not inferred.

---

## 15. Known discrepancies between what was previously planned/discussed and what is actually live

- **Referrer field**: earlier design iterations had a manually-typed "Referrer" field separate from Landlord/Agency/Agent. As of this session it has been removed from the visible form and is now auto-derived — old job records may still carry a referrer value from before that change, but new jobs never populate it manually.
- **Project financial model** (Quoted Total vs multiple invoices, e.g. §10 above): discussed and designed this session, **not yet built**. Do not train Meta on it as a live capability.
- **Photo-per-visit tagging** (§8): schema supports it, the actual engineer-app upload flow does not populate it yet.
- **"Confirmed" appointment flag** (§6): does not exist in the live job record, despite being present in an earlier reference design the office reviewed.
