# Software Findings (from this audit)

Per the workstream rules, nothing below was fixed — this is a record of what the audit turned up, kept separate from production work. Each item explains why it matters for the Meta training pack, not just that it exists.

## 1. Certificate reminder log is not being populated
`cert_reminder_log` (the table meant to record when a renewal reminder was actually sent to a client) has been found empty in earlier work on this system. **Training impact:** Meta must not assume a property's expiring certificate has already been proactively chased — it hasn't reliably been happening. `20-certificates.md` reflects this.

## 2. Single invoice per job, not multi-invoice
The job/invoice relationship is currently one-to-one (a job auto-creates at most one invoice, on completion). A "quoted total, multiple invoices raised against the same project" model was designed and discussed but is not built. **Training impact:** `21-invoices.md` explicitly forbids Meta from describing progressive/partial invoicing as a live capability.

## 3. Photo-per-visit tagging is schema-ready but not populated
The database can link a photo to a specific visit, but the engineer mobile app's upload flow doesn't yet let an engineer choose which visit a photo belongs to. **Training impact:** `19-projects-and-visits.md` tells Meta not to promise visit-specific photo retrieval.

## 4. Appointment-confirmation flag exists, but defaults to "confirmed" on every new job
CORRECTED 2026-09-04 (this earlier version of this finding was wrong and had already been
taught to the live Meta AI — see the correction pasted into `16-appointments.md` and the
follow-up correction message sent to Meta directly, both same date). A `confirmed`
boolean column genuinely exists on `jobs` (`supabase/migrations/0000_initial_schema.sql:262`,
`confirmed boolean DEFAULT true`), present since 2026-07-21, written via a real `PATCH`
in `quickConfirm()` (`apps/office/main.js`). The safety-relevant nuance is different from
what was originally claimed: the field defaults to `true` the instant a job is created —
before any date/time has actually been agreed with the customer — and office staff
manually flip it to `false` as their own internal reminder that a date still needs
firming up. So the field cannot be read as "this specific date/time was confirmed with
the customer"; it's closer to "staff haven't flagged this as needing a follow-up call."
**Training impact:** `16-appointments.md`'s core behavioural rule (never tell a customer
their appointment is confirmed in real time) stays correct and unchanged — what changed
is *why* it's correct, not the resulting instruction to the AI.

## 5. "Completed" vs "Invoiced" job status overlap is not clearly documented
Both exist as distinct job statuses, and some reporting logic treats them interchangeably as "done" states, but the code doesn't document a clean rule for when a job should be "Invoiced" rather than "Completed." Recommend office clarify this internally — it doesn't block the training pack (Meta is told to report status as-is either way) but it's worth a quick internal decision so staff apply it consistently.

## 6. Full-table data loading on several office screens (performance, not correctness)
Persons, Certificates, Invoices, and Activity screens currently load their entire table into the browser rather than the specific records needed, with a hard 50,000-row safety cutoff in the code. Not a data-accuracy risk today (all tables are well under that limit), but flagged because if this system's data volume matters to how confidently Meta should describe "the system," the answer today is: the system is accurate at current scale, but this is a known, already-identified piece of technical debt separate from this workstream.

## 7. Legacy `agents` table alongside the newer role-based model
Agents can currently exist as either a standalone legacy record or as a `persons` record with an "agent" role (the newer, current-preferred path, added this session). Both are unioned together in the office Directory view so nothing is invisible, but it means "how many agents do we have" could technically be answered two slightly different ways depending on which table is queried. Doesn't affect the training pack (Meta never queries this directly), noted for completeness.

## 8. Referrer field — historical data only
Now fully computed automatically (Agency → Agent → Landlord priority) rather than manually typed. Older job records may carry a referrer value entered before this changed. Not a bug, just context for anyone auditing old data and wondering why some referrer values look inconsistent with the current Landlord/Agency/Agent fields on the same record.
