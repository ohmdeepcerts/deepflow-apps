// "03 Agency Summary" + one worksheet per agency — mandatory per spec,
// generated dynamically from real `agencies` rows (never hardcoded names).
// Worksheet names go through safeSheetName() for the real 31-char/invalid-
// character Excel limit, with deterministic unique suffixes on collision.
import { computeInvoiceFinancials, jobsForAgency, safeSheetName } from './export-model.js';
import {
  PALETTE, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink,
  applyRowFill, internalLink, CURRENCY_FMT, DATE_FMT,
} from './export-styles.js';

const SUMMARY_HEADERS = ['Agency', 'Agents', 'Properties', 'Jobs', 'Open Jobs', 'Completed', 'Invoiced £', 'Paid £', 'Outstanding £', 'Overdue £', 'Last Job', 'Last Payment'];
const JOB_HEADERS = ['Date', 'Job Number', 'Company', 'Address', 'Property ID', 'Agent', 'Engineer', 'Work Type', 'Certificates', 'Status', 'Price £', 'Invoice Number', 'Invoice Status', 'Amount £', 'Paid £', 'Outstanding £', 'Payment Method'];

function agencyFinancials(agencyJobs, invoices, S) {
  const jobIds = new Set(agencyJobs.map((j) => j.id));
  const relevantInvoices = invoices.filter((inv) => (inv.jobId && jobIds.has(inv.jobId)) || (inv.linkedJobId && jobIds.has(inv.linkedJobId)));
  let invoiced = 0, paid = 0, outstanding = 0, overdue = 0;
  relevantInvoices.forEach((inv) => {
    const f = computeInvoiceFinancials(inv, S);
    invoiced += f.total; paid += f.paid; outstanding += f.outstanding;
    if (f.daysOverdue > 0) overdue += f.outstanding;
  });
  return { invoiced, paid, outstanding, overdue, relevantInvoices };
}

function buildOneAgencySheet(workbook, agency, agencyJobs, invoices, S, usedNames) {
  const sheetName = safeSheetName(agency.name, usedNames);
  const ws = workbook.addWorksheet(sheetName);
  setColumnWidths(ws, [12, 12, 14, 28, 14, 16, 14, 16, 16, 14, 10, 14, 14, 10, 10, 12, 14]);
  addBackToDashboardLink(ws);

  const { invoiced, paid, outstanding, overdue } = agencyFinancials(agencyJobs, invoices, S);
  const propertyCount = new Set(agencyJobs.map((j) => j.propertyId).filter(Boolean)).size;
  const open = agencyJobs.filter((j) => j.status !== 'Completed' && j.status !== 'Invoiced' && j.status !== 'Cancelled').length;

  let r = 3;
  addSectionBar(ws, r, agency.name.toUpperCase(), JOB_HEADERS.length, { size: 13 }); r += 2;
  const kpis = [
    ['Properties', propertyCount], ['Jobs', agencyJobs.length], ['Open Jobs', open],
    ['Total Invoiced', invoiced], ['Paid', paid], ['Outstanding', outstanding], ['Overdue', overdue],
  ];
  kpis.forEach(([label, val]) => {
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = val;
    if (typeof val === 'number' && label !== 'Properties' && label !== 'Jobs' && label !== 'Open Jobs') ws.getCell(r, 2).numFmt = CURRENCY_FMT;
    r += 1;
  });
  r += 1;

  addTableHeaderRow(ws, r, JOB_HEADERS); r += 1;
  agencyJobs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach((job) => {
    const inv = invoices.find((i) => i.jobId === job.id || i.linkedJobId === job.id);
    const f = inv ? computeInvoiceFinancials(inv, S) : null;
    const row = ws.getRow(r);
    const values = [
      job.date ? new Date(job.date) : '', job.jobNum || '', S.coName || '', job.address || '', job.propertyId || '',
      job.agentName || '', job.engineer || '', job.trade || '', (job.certTypes || []).join(', '), job.status || '',
      job.price || 0, inv?.number || '', inv?.status || 'No Invoice', f ? f.total : '', f ? f.paid : '', f ? f.outstanding : '', '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (job.date) row.getCell(1).numFmt = DATE_FMT;
    [11, 14, 15, 16].forEach((c) => { row.getCell(c).numFmt = CURRENCY_FMT; });
    r += 1;
  });

  return sheetName;
}

export function buildAgencySheets(workbook, { agencies, agents, jobs, invoices, S }) {
  const summaryWs = workbook.addWorksheet('03 Agency Summary');
  setColumnWidths(summaryWs, [22, 9, 11, 8, 10, 10, 13, 12, 14, 12, 12, 14]);
  addBackToDashboardLink(summaryWs);
  let r = 3;
  addSectionBar(summaryWs, r, '03 — AGENCY SUMMARY', SUMMARY_HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(summaryWs, r, SUMMARY_HEADERS); r += 1;

  const usedNames = new Set(['03 Agency Summary']);
  const sheetNameByAgencyId = new Map();
  let exported = 0;
  agencies.forEach((agency) => {
    const agencyJobs = jobsForAgency(jobs, agency);
    const { invoiced, paid, outstanding, overdue } = agencyFinancials(agencyJobs, invoices, S);
    const agentCount = agents.filter((a) => a.agencyId === agency.id).length;
    const propertyCount = new Set(agencyJobs.map((j) => j.propertyId).filter(Boolean)).size;
    const completed = agencyJobs.filter((j) => j.status === 'Completed' || j.status === 'Invoiced').length;
    const open = agencyJobs.length - completed;
    const lastJob = agencyJobs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

    const sheetName = buildOneAgencySheet(workbook, agency, agencyJobs, invoices, S, usedNames);
    sheetNameByAgencyId.set(agency.id, sheetName);

    const row = summaryWs.getRow(r);
    const linkCell = row.getCell(1);
    linkCell.value = internalLink(sheetName, agency.name);
    linkCell.font = { color: { argb: PALETTE.blueText }, underline: true, bold: true };
    const values = [null, agentCount, propertyCount, agencyJobs.length, open, completed, invoiced, paid, outstanding, overdue, lastJob ? new Date(lastJob.date) : '', ''];
    values.forEach((v, i) => { if (i === 0) return; row.getCell(i + 1).value = v; });
    [7, 8, 9, 10].forEach((c) => { row.getCell(c).numFmt = CURRENCY_FMT; });
    if (lastJob) row.getCell(11).numFmt = DATE_FMT;
    if (outstanding === 0) applyRowFill(row, SUMMARY_HEADERS.length, PALETTE.green, PALETTE.greenText);
    else if (overdue > 0) applyRowFill(row, SUMMARY_HEADERS.length, PALETTE.red, PALETTE.redText);
    r += 1;
    exported += 1;
  });

  return { rowsWritten: exported, sheetsCreated: usedNames.size - 1, sheetNameByAgencyId };
}
