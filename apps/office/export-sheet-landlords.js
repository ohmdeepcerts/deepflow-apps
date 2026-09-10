// "02 Landlords" sheet — one row per landlord/client with real activity
// (a job or invoice matched to them), never limited to whoever happens to
// carry a 'landlord' role tag (that tag is inconsistently applied — see
// docs/planning/25-excel-export-data-audit.md §4). Chase-up columns are
// intentionally blank (no structured chase history exists anywhere in
// DeepFlow today — flagged once, globally, on the Data Quality sheet
// rather than repeated as a caveat on every row here).
import { computeInvoiceFinancials, jobsForPerson } from './export-model.js';
import {
  PALETTE, fill, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink,
  applyRowFill, CURRENCY_FMT, DATE_FMT,
} from './export-styles.js';

const HEADERS = [
  'Landlord / Client', 'Phone', 'Email', 'Address', 'Agency', 'Agent', 'Property Count',
  'Total Jobs', 'Completed Jobs', 'Open Jobs', 'Total Invoiced £', 'Total Paid £', 'Outstanding £',
  'Overdue £', 'Last Payment Date', 'Last Payment Amount £', 'Payment Method', 'Payment Status',
  'Last Job Date', 'Last Chase', 'Chase Method', 'Chased By', 'Next Action', 'Comments',
];

function invoicesForPerson(invoices, person) {
  return invoices.filter((i) => i.clientName === person.name || i.clientPersonId === person.id || i.landlordName === person.name);
}

export function buildLandlordsSheet(workbook, { persons, jobs, invoices, payments, S }) {
  const ws = workbook.addWorksheet('02 Landlords');
  setColumnWidths(ws, [22, 14, 22, 28, 18, 16, 10, 9, 11, 9, 13, 12, 12, 12, 14, 15, 14, 14, 14, 12, 12, 12, 18, 24]);
  addBackToDashboardLink(ws);

  let r = 3;
  addSectionBar(ws, r, '02 — LANDLORDS', HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(ws, r, HEADERS); r += 1;

  const withActivity = persons.filter((p) => {
    const isLandlordRole = Array.isArray(p.roles) && (p.roles.includes('landlord') || p.roles.includes('builder') || p.roles.includes('client'));
    return isLandlordRole || jobsForPerson(jobs, p).length > 0 || invoicesForPerson(invoices, p).length > 0;
  });

  let exported = 0;
  withActivity.forEach((p) => {
    const pJobs = jobsForPerson(jobs, p);
    const pInvs = invoicesForPerson(invoices, p);
    const completed = pJobs.filter((j) => j.status === 'Completed' || j.status === 'Invoiced').length;
    const open = pJobs.length - completed;
    const propertyCount = new Set(pJobs.map((j) => j.propertyId).filter(Boolean)).size;

    let totalInvoiced = 0, totalPaid = 0, outstanding = 0, overdue = 0;
    let anyOverdue = false, anyUnpaid = false, allPaid = pInvs.length > 0;
    pInvs.forEach((inv) => {
      const f = computeInvoiceFinancials(inv, S);
      totalInvoiced += f.total; totalPaid += f.paid; outstanding += f.outstanding;
      if (f.daysOverdue > 0) { overdue += f.outstanding; anyOverdue = true; }
      if (f.outstanding > 0) { anyUnpaid = true; allPaid = false; }
    });
    const paymentStatus = !pInvs.length ? 'No Invoice' : anyOverdue ? 'Overdue' : allPaid ? 'Paid' : anyUnpaid ? 'Awaiting Payment' : 'Paid';

    const pPayments = payments.filter((pay) => pInvs.some((inv) => inv.id === pay.invId));
    const lastPayment = pPayments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null;

    const lastJob = pJobs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null;
    const agency = pJobs.find((j) => j.agencyName)?.agencyName || '';
    const agent = pJobs.find((j) => j.agentName)?.agentName || '';

    const row = ws.getRow(r);
    const values = [
      p.name || '', p.phone || '', p.email || '', p.address || '', agency, agent, propertyCount,
      pJobs.length, completed, open, totalInvoiced, totalPaid, outstanding, overdue,
      lastPayment ? new Date(lastPayment.date) : '', lastPayment ? lastPayment.amount : '', lastPayment ? lastPayment.method || '' : '',
      paymentStatus, lastJob ? new Date(lastJob.date) : '', '', '', '', '', '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    [11, 12, 13, 14, 16].forEach((c) => { row.getCell(c).numFmt = CURRENCY_FMT; });
    if (lastPayment) row.getCell(15).numFmt = DATE_FMT;
    if (lastJob) row.getCell(19).numFmt = DATE_FMT;

    const bg = paymentStatus === 'Paid' || paymentStatus === 'No Invoice' ? PALETTE.green
      : paymentStatus === 'Overdue' ? PALETTE.red : PALETTE.amber;
    const textColor = paymentStatus === 'Paid' || paymentStatus === 'No Invoice' ? PALETTE.greenText
      : paymentStatus === 'Overdue' ? PALETTE.redText : PALETTE.amberText;
    applyRowFill(row, HEADERS.length, bg, textColor);
    r += 1;
    exported += 1;
  });

  return { rowsWritten: exported, queriedCount: withActivity.length };
}
