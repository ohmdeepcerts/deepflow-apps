// "Data Quality" sheet — mandatory per spec. Surfaces real gaps found
// during the audit (docs/planning/25-excel-export-data-audit.md) instead of
// silently repairing or hiding them. Returns the issue list so other sheet
// builders (Daily Jobs) can also flag a "Needs Review" job consistently.
import { classifyJobWork, findDuplicateProperties } from './export-model.js';
import { PALETTE, fill, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink, applyRowFill } from './export-styles.js';

const SEVERITY_STYLE = {
  High: { bg: PALETTE.red, text: PALETTE.redText },
  Medium: { bg: PALETTE.amber, text: PALETTE.amberText },
  Low: { bg: PALETTE.grey, text: PALETTE.greyText },
  Info: { bg: PALETTE.blue, text: PALETTE.blueText },
};

export function computeDataQualityIssues({ jobs, invoices, certs, properties, payments, S }) {
  const issues = [];
  const add = (severity, recordType, recordId, problem, suggestedReview) =>
    issues.push({ severity, recordType, recordId, problem, suggestedReview });

  // Jobs missing a property link despite having a real address.
  jobs.forEach((j) => {
    if (j.address && !j.propertyId) add('Low', 'Job', j.jobNum || j.id, 'Job has an address but no linked Property record', 'Re-save the job so it resolves/creates a property row');
  });

  // Job classification ambiguity — needs_review only (cert_only/additional_work are fine).
  const needsReviewJobIds = new Set();
  jobs.forEach((j) => {
    const cls = classifyJobWork(j, S);
    if (cls === 'needs_review') {
      needsReviewJobIds.add(j.id);
      add('Medium', 'Job', j.jobNum || j.id, 'Could not determine certificate-only vs additional-work from description text', 'Review the job description; Daily Jobs sheet shows this row uncoloured/grey pending review');
    }
  });

  // Duplicate job numbers.
  const jobNumCounts = new Map();
  jobs.forEach((j) => { if (j.jobNum) jobNumCounts.set(j.jobNum, (jobNumCounts.get(j.jobNum) || 0) + 1); });
  jobNumCounts.forEach((n, num) => { if (n > 1) add('High', 'Job', num, `Job number appears ${n} times`, 'Investigate duplicate job numbering'); });

  // Invoices missing a job link entirely.
  invoices.forEach((inv) => {
    if (!inv.jobId && !inv.linkedJobId) add('Low', 'Invoice', inv.number || inv.id, 'Invoice has no linked Job', 'Confirm this invoice was meant to stand alone (e.g. ad-hoc billing)');
  });

  // Duplicate invoice numbers.
  const invNumCounts = new Map();
  invoices.forEach((i) => { if (i.number) invNumCounts.set(i.number, (invNumCounts.get(i.number) || 0) + 1); });
  invNumCounts.forEach((n, num) => { if (n > 1) add('High', 'Invoice', num, `Invoice number appears ${n} times`, 'Investigate duplicate invoice numbering'); });

  // Payments missing an invoice link or a payment method.
  payments.forEach((p) => {
    if (!p.invId) add('Medium', 'Payment', p.id, 'Payment has no linked Invoice', 'Link this payment to the correct invoice');
    if (!p.method) add('Low', 'Payment', p.id, 'Payment method not recorded', 'Left as blank/Unknown — not guessed');
  });

  // Certificates missing expiry (and not flagged as never-expiring).
  certs.forEach((c) => {
    if (!c.expiryDate && !c.noExpiry) add('Medium', 'Certificate', c.certNum || c.id, 'Certificate has no expiry date and is not flagged "no expiry"', 'Confirm expiry date or mark as no-expiry');
    if (!c.jobId) add('Low', 'Certificate', c.certNum || c.id, 'Certificate has no linked Job', 'Confirm this certificate was issued outside the normal job flow');
  });

  // Possible duplicate properties — batch version of the app's own
  // interactive fuzzy check (see export-model.js findDuplicateProperties).
  const dupGroups = findDuplicateProperties(properties);
  dupGroups.forEach((group) => {
    add('Medium', 'Property', group.map((p) => p.address).join(' | '), `Possible duplicate property (${group.length} similar addresses)`, 'Confirm whether these are the same property; not auto-merged');
  });

  // Structural/known gaps — informational, one row each, not per-record
  // (see audit doc §5 — these are real, verified facts about this system,
  // not guesses).
  add('Info', 'System', 'invoices.paid_amount', 'This column is never populated (0% across all invoices) — export uses computed totals against invoice status instead', 'No action needed; documented behaviour');
  add('Info', 'System', 'payment_chase_state', 'Table exists but has zero rows — no structured chase-up history exists in DeepFlow today', 'Chase columns on the Landlords sheet are intentionally blank, not fabricated from notes');
  add('Info', 'System', 'portal_enabled / last_portal_access', 'Columns are never read or written anywhere in the Office app — treated as unused', 'Clients sheet "Portal Active" instead reflects real activation/session rows');

  return { issues, needsReviewJobIds, dupGroups };
}

export function buildDataQualitySheet(workbook, dataQuality) {
  const ws = workbook.addWorksheet('Data Quality');
  setColumnWidths(ws, [10, 14, 28, 48, 40]);
  addBackToDashboardLink(ws);

  let r = 3;
  addSectionBar(ws, r, 'DATA QUALITY', 5, { size: 13 }); r += 1;
  ws.getCell(r, 1).value = 'The export never silently repairs or hides data problems — every issue found is listed below rather than corrected automatically.';
  ws.mergeCells(r, 1, r, 5);
  ws.getCell(r, 1).font = { italic: true, color: { argb: PALETTE.greyText }, size: 10 };
  r += 2;

  const headers = ['Severity', 'Record Type', 'Record ID', 'Problem', 'Suggested Review'];
  addTableHeaderRow(ws, r, headers); r += 1;

  const order = { High: 0, Medium: 1, Low: 2, Info: 3 };
  const sorted = [...dataQuality.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  sorted.forEach((issue) => {
    const row = ws.getRow(r);
    row.getCell(1).value = issue.severity;
    row.getCell(2).value = issue.recordType;
    row.getCell(3).value = issue.recordId;
    row.getCell(4).value = issue.problem;
    row.getCell(5).value = issue.suggestedReview;
    const style = SEVERITY_STYLE[issue.severity] || SEVERITY_STYLE.Low;
    applyRowFill(row, 5, style.bg, style.text);
    r += 1;
  });

  if (!sorted.length) {
    ws.getCell(r, 1).value = 'No data quality issues found in this export.';
    ws.mergeCells(r, 1, r, 5);
  }

  return { rowsWritten: sorted.length };
}
