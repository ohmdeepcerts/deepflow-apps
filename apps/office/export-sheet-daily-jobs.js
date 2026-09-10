// "01 Daily Jobs" sheet — the most detail-heavy sheet in the spec: grouped
// by DATE, then by ENGINEER within each date, coloured green (certificate-
// only) / red (additional work) / grey (needs review — see Data Quality),
// with an UNASSIGNED bucket per date and UNSCHEDULED jobs (no date at all —
// never silently dropped) as their own group at the top.
import { classifyJobWork, computeInvoiceFinancials, groupVisitsByJob } from './export-model.js';
import {
  PALETTE, fill, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink,
  applyRowFill, CURRENCY_FMT, DATE_FMT,
} from './export-styles.js';

const HEADERS = [
  'Date', 'Visit', 'Job Number', 'Status', 'Company', 'Engineer', 'Time', 'Address', 'Postcode',
  'Client / Landlord', 'Agency', 'Agent', 'Contact', 'Job / Work Type', 'Job Description',
  'Certificates Required', 'Price', 'Invoice Number', 'Payment Status', 'Access Notes', 'Job Notes',
  'Created Date', 'Last Updated',
];

function certLabel(certTypeCodes, S) {
  if (!certTypeCodes || !certTypeCodes.length) return '';
  const byId = new Map((S.certTypes || []).map((ct) => [ct.id, ct.name]));
  return certTypeCodes.map((c) => byId.get(c) || c).join(', ');
}

function invoiceForJob(job, invoicesByJobId) {
  return invoicesByJobId.get(job.id) || null;
}

// Expands each job into one or more display rows: a normal job (no
// job_visits rows) is exactly one row on its own date; a Project job (2+
// visits) becomes one row per (visit × engineer on that visit), dated and
// engineer-grouped by the VISIT, not the parent job — per spec: "Keep same
// Job number with correct Visit number."
function expandJobsToRows(jobs, visitsByJob) {
  const rows = [];
  jobs.forEach((job) => {
    const visits = (visitsByJob.get(job.id) || []).slice().sort((a, b) => (a.visitDate || '').localeCompare(b.visitDate || ''));
    if (!visits.length) {
      rows.push({ job, date: job.date || '', engineer: job.engineer || '', visitLabel: '' });
      return;
    }
    visits.forEach((visit, idx) => {
      const engs = (visit.engineers && visit.engineers.length) ? visit.engineers : [''];
      engs.forEach((eng) => {
        rows.push({ job, date: visit.visitDate || '', engineer: eng || '', visitLabel: `Visit ${idx + 1}` });
      });
    });
  });
  return rows;
}

function epochToDate(ms) { return ms ? new Date(ms) : null; }

export function buildDailyJobsSheet(workbook, { jobs, invoices, visits, S, needsReviewJobIds }) {
  const ws = workbook.addWorksheet('01 Daily Jobs');
  setColumnWidths(ws, [12, 9, 12, 14, 14, 14, 12, 30, 10, 20, 18, 16, 16, 16, 32, 20, 10, 12, 14, 22, 24, 12, 12]);
  addBackToDashboardLink(ws);

  const invoicesByJobId = new Map();
  invoices.forEach((inv) => { if (inv.jobId) invoicesByJobId.set(inv.jobId, inv); });
  const { byJob: visitsByJob } = groupVisitsByJob(visits);

  let r = 3;
  addSectionBar(ws, r, '01 — DAILY JOBS', HEADERS.length, { size: 13 }); r += 1;
  ws.getCell(r, 1).value = 'GREEN = certificate/compliance-only visit';
  ws.getCell(r, 1).fill = fill(PALETTE.green);
  ws.getCell(r, 1).font = { color: { argb: PALETTE.greenText }, bold: true };
  ws.mergeCells(r, 1, r, 7);
  ws.getCell(r, 8).value = 'RED = repair / installation / additional work included';
  ws.getCell(r, 8).fill = fill(PALETTE.red);
  ws.getCell(r, 8).font = { color: { argb: PALETTE.redText }, bold: true };
  ws.mergeCells(r, 8, r, HEADERS.length);
  r += 2;

  const allRows = expandJobsToRows(jobs, visitsByJob);
  const unscheduled = allRows.filter((x) => !x.date);
  const scheduled = allRows.filter((x) => x.date);

  const dateGroups = new Map();
  scheduled.forEach((x) => { if (!dateGroups.has(x.date)) dateGroups.set(x.date, []); dateGroups.get(x.date).push(x); });
  const sortedDates = [...dateGroups.keys()].sort();

  let exportedJobIds = new Set();

  const writeJobRow = (x) => {
    const { job } = x;
    const cls = needsReviewJobIds.has(job.id) ? 'needs_review' : classifyJobWork(job, S);
    const inv = invoiceForJob(job, invoicesByJobId);
    const finance = inv ? computeInvoiceFinancials(inv, S) : null;
    const row = ws.getRow(r);
    const dateVal = x.date ? new Date(x.date) : null;
    const created = epochToDate(job.created);
    const updated = epochToDate(job.modified);
    const values = [
      dateVal, x.visitLabel, job.jobNum || '', job.status || '', S.coName || '', x.engineer || 'UNASSIGNED',
      job.timeSlot || '', job.address || '', job.postcode || '', job.landlordName || job.referrer || '',
      job.agencyName || '', job.agentName || '', job.contact || '', job.trade || '', job.description || '',
      certLabel(job.certTypes, S), job.price || 0, job.invNumber || '', finance ? finance.paid > 0 && finance.outstanding === 0 ? 'Paid' : 'Outstanding' : 'No Invoice',
      job.access || '', job.notes || '', created, updated,
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (dateVal) row.getCell(1).numFmt = DATE_FMT;
    row.getCell(17).numFmt = CURRENCY_FMT;
    if (created) row.getCell(22).numFmt = DATE_FMT;
    if (updated) row.getCell(23).numFmt = DATE_FMT;

    const style = cls === 'cert_only' ? { bg: PALETTE.green, text: PALETTE.greenText }
      : cls === 'additional_work' ? { bg: PALETTE.red, text: PALETTE.redText }
      : { bg: PALETTE.grey, text: PALETTE.greyText };
    applyRowFill(row, HEADERS.length, style.bg, style.text);
    r += 1;
    exportedJobIds.add(job.id);
  };

  if (unscheduled.length) {
    addSectionBar(ws, r, 'UNSCHEDULED / NO DATE SET', HEADERS.length, { bg: PALETTE.grey, textColor: PALETTE.greyText }); r += 1;
    addTableHeaderRow(ws, r, HEADERS); r += 1;
    unscheduled.forEach(writeJobRow);
    r += 2;
  }

  sortedDates.forEach((date) => {
    const items = dateGroups.get(date);
    const dateLabel = new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    addSectionBar(ws, r, dateLabel, HEADERS.length, { bg: PALETTE.mustard, textColor: PALETTE.mustardText, size: 13 }); r += 1;
    addTableHeaderRow(ws, r, HEADERS); r += 1;

    const byEngineer = new Map();
    items.forEach((x) => {
      const key = x.engineer || 'UNASSIGNED';
      if (!byEngineer.has(key)) byEngineer.set(key, []);
      byEngineer.get(key).push(x);
    });
    const engineerNames = [...byEngineer.keys()].filter((e) => e !== 'UNASSIGNED').sort();
    if (byEngineer.has('UNASSIGNED')) engineerNames.push('UNASSIGNED');

    engineerNames.forEach((eng) => {
      const engCell = ws.getCell(r, 1);
      engCell.value = eng;
      engCell.font = { bold: true, size: 11 };
      ws.mergeCells(r, 1, r, HEADERS.length);
      r += 1;
      byEngineer.get(eng).forEach(writeJobRow);
      r += 1; // one empty row between engineers
    });
    r += 1; // one extra empty row between dates (2 total)
  });

  return { rowsWritten: exportedJobIds.size, jobIdsWritten: exportedJobIds };
}
