// "Invoices & Payments" (every invoice) and "Outstanding" (accounts
// receivable — unpaid only, sorted by overdue severity) sheets. Every
// financial figure is computeInvoiceFinancials() — never the stored
// total/subtotal/paid_amount columns, which are unreliable/dead in this
// database (see docs/planning/25-excel-export-data-audit.md §1).
import { computeInvoiceFinancials } from './export-model.js';
import { PALETTE, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink, applyRowFill, CURRENCY_FMT, DATE_FMT } from './export-styles.js';

const INV_HEADERS = ['Invoice Number', 'Company', 'Client', 'Agency', 'Agent', 'Job Number', 'Invoice Date', 'Due Date', 'Subtotal £', 'VAT Rate %', 'VAT £', 'Total £', 'Paid £', 'Outstanding £', 'Payment Status', 'Payment Method', 'Last Payment Date'];
const OUT_HEADERS = ['Client', 'Agency', 'Invoice', 'Company', 'Invoice Date', 'Due Date', 'Total £', 'Paid £', 'Outstanding £', 'Days Overdue', 'Last Chase', 'Next Chase', 'Comments'];

function paymentInfoFor(inv, payments) {
  const invPayments = payments.filter((p) => p.invId === inv.id);
  const last = invPayments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return { method: last?.method || '', lastDate: last?.date || '' };
}

export function buildInvoicesSheet(workbook, { invoices, payments, S }) {
  const ws = workbook.addWorksheet('Invoices & Payments');
  setColumnWidths(ws, [14, 16, 20, 18, 16, 12, 12, 12, 12, 10, 10, 12, 12, 14, 14, 14, 14]);
  addBackToDashboardLink(ws);
  let r = 3;
  addSectionBar(ws, r, 'INVOICES & PAYMENTS', INV_HEADERS.length, { size: 13 }); r += 1;
  ws.getCell(r, 1).value = 'Financial figures are computed from each invoice\'s line items against the live VAT rate — the same calculation Office itself shows — not the stored total/paid_amount columns (unreliable in this database; see Data Quality).';
  ws.mergeCells(r, 1, r, INV_HEADERS.length);
  ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: PALETTE.greyText } };
  r += 2;
  addTableHeaderRow(ws, r, INV_HEADERS); r += 1;

  let written = 0;
  invoices.forEach((inv) => {
    const f = computeInvoiceFinancials(inv, S);
    const { method, lastDate } = paymentInfoFor(inv, payments);
    const row = ws.getRow(r);
    const values = [
      inv.number || '', S.coName || '', inv.clientName || '', inv.agencyName || '', inv.agentName || '',
      inv.jobNum || '', inv.date ? new Date(inv.date) : '', inv.dueDate ? new Date(inv.dueDate) : '',
      f.subtotal, f.vatRate, f.vat, f.total, f.paid, f.outstanding, inv.status || '', method,
      lastDate ? new Date(lastDate) : '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (inv.date) row.getCell(7).numFmt = DATE_FMT;
    if (inv.dueDate) row.getCell(8).numFmt = DATE_FMT;
    if (lastDate) row.getCell(17).numFmt = DATE_FMT;
    [9, 11, 12, 13, 14].forEach((c) => { row.getCell(c).numFmt = CURRENCY_FMT; });
    const style = inv.status === 'Paid' ? { bg: PALETTE.green, text: PALETTE.greenText }
      : f.daysOverdue > 0 ? { bg: PALETTE.red, text: PALETTE.redText } : { bg: PALETTE.amber, text: PALETTE.amberText };
    applyRowFill(row, INV_HEADERS.length, style.bg, style.text);
    r += 1;
    written += 1;
  });

  return { rowsWritten: written, queriedCount: invoices.length };
}

export function buildOutstandingSheet(workbook, { invoices, S }) {
  const ws = workbook.addWorksheet('Outstanding');
  setColumnWidths(ws, [20, 18, 14, 16, 12, 12, 12, 12, 12, 12, 14, 14, 24]);
  addBackToDashboardLink(ws);
  let r = 3;
  addSectionBar(ws, r, 'OUTSTANDING (ACCOUNTS RECEIVABLE)', OUT_HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(ws, r, OUT_HEADERS); r += 1;

  const unpaid = invoices
    .map((inv) => ({ inv, f: computeInvoiceFinancials(inv, S) }))
    .filter(({ f }) => f.outstanding > 0)
    .sort((a, b) => b.f.daysOverdue - a.f.daysOverdue || (a.inv.clientName || '').localeCompare(b.inv.clientName || '') || (a.inv.dueDate || '').localeCompare(b.inv.dueDate || ''));

  unpaid.forEach(({ inv, f }) => {
    const row = ws.getRow(r);
    const values = [
      inv.clientName || '', inv.agencyName || '', inv.number || '', S.coName || '',
      inv.date ? new Date(inv.date) : '', inv.dueDate ? new Date(inv.dueDate) : '',
      f.total, f.paid, f.outstanding, f.daysOverdue, '', '', '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (inv.date) row.getCell(5).numFmt = DATE_FMT;
    if (inv.dueDate) row.getCell(6).numFmt = DATE_FMT;
    [7, 8, 9].forEach((c) => { row.getCell(c).numFmt = CURRENCY_FMT; });
    const style = f.daysOverdue > 30 ? { bg: PALETTE.red, text: PALETTE.redText }
      : f.daysOverdue > 0 ? { bg: PALETTE.amber, text: PALETTE.amberText } : { bg: PALETTE.blue, text: PALETTE.blueText };
    applyRowFill(row, OUT_HEADERS.length, style.bg, style.text);
    r += 1;
  });

  return { rowsWritten: unpaid.length, queriedCount: unpaid.length };
}
