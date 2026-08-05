// The job/invoice status enum — shared by the Office App, Employee App, and
// Client Portal (Portal only displays status strings, never transitions
// them, but imports this for the shared display-mapping helpers).
//
// ENGINEER_COMPLETED is an intermediate state: the Engineer app sets it
// instead of COMPLETED when a job is finished on-site. Office staff review
// and finalize it to COMPLETED themselves, which is what actually triggers
// cert/invoice automation (see onJobComplete in apps/office/main.js) — a
// job sitting in ENGINEER_COMPLETED is deliberately excluded from every
// "completed"/"invoiced" business-stat check across the codebase (revenue,
// completion rate, missing-invoice audits) since it isn't finalized yet.
export const STATUS = Object.freeze({
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  ENGINEER_COMPLETED: 'Engineer Completed',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CANNOT_ACCESS: 'Cannot Access',
  CANCELLED: 'Cancelled',
});
