# DeepFlow Communications — Event Catalogue & Channel Policy

**Status:** Draft proposal for owner sign-off. Every cadence, channel choice, and quiet-hours
default below is a **proposal**, not a decision — marked `PROPOSED DEFAULT` throughout.
Nothing here goes live without explicit confirmation (per BRD §7).

---

## 1. Design rule (from the BRD, restated because it's the one most worth repeating)

**Not every event uses every channel.** The failure mode this catalogue exists to
prevent is a client getting an email, a WhatsApp, a push, and a Portal notification for
the same event within the same hour. Each row below picks the smallest set of channels
that actually serves the event, not "all of them to be safe."

## 2. Global settings (PROPOSED DEFAULTS)

| Setting | Proposed default |
|---|---|
| Quiet hours | 09:00–17:30, Europe/London |
| Quiet hours apply on weekends | Yes — no automated sends Sat/Sun by default |
| Min. time between non-critical automated direct messages (same client, any channel) | 4 hours |
| Max. automated direct messages per client per day | 3 |
| Max. automated direct messages per client per week | 8 |
| New automation on first enable | `DRY RUN` for 7 days, then owner reviews the dry-run log before flipping to `LIVE` |
| Historical backfill on go-live | None — new events only, from activation date forward |
| Emergency events (electrical/gas) | Exempt from quiet hours and frequency caps — human notification, not automated customer messaging (see §3, `EMERGENCY_*`) |

## 3. Event catalogue

Format: **Event** → trigger condition → channels (proposed) → notes.

### Jobs

| Event | Trigger | Channels (proposed) | Notes |
|---|---|---|---|
| `JOB_CREATED` | New job saved with a client contact | Portal | No email/WhatsApp by default — booking confirmation is a separate, deliberate event below once appointment details exist |
| `JOB_SCHEDULE_CHANGED` | `date`/`timeSlot` changed on an existing job | Portal + WhatsApp | Customer already expects prompt notice of a date/time change |
| `JOB_REMINDER_DUE` | 1 day before scheduled job date | WhatsApp | Highest-value single reminder; matches existing `sendTenantWA`/`sendLandlordComplete` template intent already in the codebase |
| `ENGINEER_COMPLETED` | Job status → `Engineer Completed` | **None (internal only)** | Per BRD §5.1 — never customer-facing; office review gate |
| `JOB_COMPLETED` | Job status → `Completed` (office-finalized) | Portal | Certificate/invoice events (below) carry the substantive follow-up; this is just a status update |
| `APPOINTMENT_CANCELLED` | Job cancelled with a prior scheduled date | WhatsApp + Portal | |

### Certificates

| Event | Trigger | Channels (proposed) | Notes |
|---|---|---|---|
| `CERTIFICATE_READY` | Cert PDF generated + linked invoice paid (or no invoice gate applies) | Email + Portal | Matches existing `_certReadyEmailHtml` already built in `invoice-documents.js` |
| `CERTIFICATE_LOCKED` | Cert ready but linked invoice unpaid | Email + Portal | Matches existing `_certLockedEmailHtml` |
| `CERTIFICATE_EXPIRING` | Configurable window before `expiryDate` (existing settings already have expiry-alert thresholds per `certs-reminders.js`) | Email + Portal | This is the exact "EICR expiring in 30 days" example from your notes — reuses the existing expiry-check logic, just adds Portal as a second channel alongside the email that (per §00) already exists |

### Invoices (non-chase events — see §4 for the payment chase engine specifically)

| Event | Trigger | Channels (proposed) | Notes |
|---|---|---|---|
| `INVOICE_CREATED` | Invoice saved, status `Draft` | None | Internal only until sent |
| `INVOICE_SENT` | Office sends invoice (existing `sendInvEmail`/`openInvSendModal` flow) | Email + Portal | This is Chase Stage 1 — see §4, not a separate uncoordinated send |
| `PAYMENT_RECEIVED` | Invoice marked `Paid` | Email + Portal | Receipt — matches existing `_maybeSendPaymentReceipt`, already built |

### Appointments (distinct from job-schedule events above — booking-flow specific)

| Event | Trigger | Channels (proposed) | Notes |
|---|---|---|---|
| `APPOINTMENT_CONFIRMED` | `job.confirmed` set true | Portal | **Blocked on the open item in BRD §8** — do not enable until `confirmed`'s write path is audited and trusted |

### System / internal (no customer channels — listed for completeness of the event model)

| Event | Trigger | Channels |
|---|---|---|
| `PORTAL_DOCUMENT_AVAILABLE` | Generic — any new file becomes visible on the Portal | Portal only |
| `HUMAN_HANDOVER_REQUESTED` | AI hands a WhatsApp conversation to a human | Internal (office inbox), never customer |

## 4. Payment chase engine — reminder stages (PROPOSED DEFAULT SCHEDULE)

This is the schedule from your notes, kept as given since it's specific and reasonable,
with the channel choices it already specifies:

| Stage | Trigger | Channels |
|---|---|---|
| 1. Invoice Sent | Office sends invoice | Email + Portal |
| 2. Friendly Reminder | 3 days before due date | Portal only |
| 3. Due Date | Due date reached, still unpaid | Email + Portal |
| 4. 2 Days Overdue | 2 days past due | WhatsApp |
| 5. 5 Days Overdue | 5 days past due | Email + Portal |
| 6. 10 Days Overdue | 10 days past due | Email |
| 7. Accounts Escalation | Beyond stage 6, still unpaid | Human task, no automated send |

Each stage is **one chase event**, even when it uses multiple channels (BRD §4/§07 rule)
— stage 1 firing Email+Portal counts as one follow-up, not two.

**Suppressed entirely, at any stage, when:** a `PROMISE_ACTIVE` state exists (until
promise date + grace period), a `PAYMENT_CLAIMED` verification is pending, a
`DISPUTE` is open, the client has opted out, or the invoice belongs to a client with
`payment_chase_state` manually paused.

**Grace period after a promise date (PROPOSED DEFAULT):** 2 days, then resume at the
stage the invoice was at when the promise was made (not restart from stage 1).

## 5. Consolidated account reminders

For a client with multiple unpaid invoices (BRD §5.4), a chase-stage trigger fires
**once per client per stage**, not once per invoice, and the message content lists all
qualifying invoices together. An invoice only enters a consolidated reminder if it's
independently eligible for that stage on its own due date — a not-yet-due invoice
doesn't get pulled into a reminder for an unrelated overdue one.

## 6. What needs your sign-off before this becomes real

1. All `PROPOSED DEFAULT` values above (quiet hours, frequency caps, chase schedule,
   grace period).
2. Whether `JOB_REMINDER_DUE`'s single-WhatsApp-reminder default is right, or whether
   you want Email/Portal alongside it.
3. Whether `APPOINTMENT_CONFIRMED` should exist at all before the `job.confirmed`
   write-path audit is done — my proposal is to build the event but leave it disabled
   until that audit clears it.
