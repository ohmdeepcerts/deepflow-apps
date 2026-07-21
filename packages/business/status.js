// The job/invoice status enum — previously duplicated, byte-identical,
// between the Office App and Employee App (Client Portal never needed its
// own copy — it only displays status strings, never transitions them).
export const STATUS = Object.freeze({
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CANNOT_ACCESS: 'Cannot Access',
  CANCELLED: 'Cancelled',
});
