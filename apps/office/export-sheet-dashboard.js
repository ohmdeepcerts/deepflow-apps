// "00 Dashboard" — built LAST (after every sheet it links to and
// summarizes exists), but its worksheet is reserved FIRST by
// export-workbook-builder.js so it physically appears as sheet 1 when the
// file opens. Every number here is computed with the exact same functions
// (computeInvoiceFinancials/certStatus/classifyJobWork) the other sheets
// use — so it reconciles with them by construction, not by copying totals
// across and hoping they stay in sync.
import { computeInvoiceFinancials, certStatus, classifyJobWork, jobsForPerson } from './export-model.js';
import { STATUS } from '@business';
import { PALETTE, fill, setColumnWidths, addSectionBar, internalLink, CURRENCY_FMT, DATE_FMT } from './export-styles.js';

const NAV_TARGETS = [
  ['01 Daily Jobs', 'DAILY JOBS'], ['02 Landlords', 'LANDLORDS'], ['03 Agency Summary', 'AGENCIES'],
  ['Certificates Dashboard', 'CERTIFICATES'], ['Properties', 'PROPERTIES'], ['Invoices & Payments', 'FINANCE'],
  ['Engineer Summary', 'ENGINEERS'], ['Clients', 'CLIENTS'], ['Data Quality', 'DATA QUALITY'],
];

export function buildDashboardSheet(workbook, { data, S, exportMeta, sheetNameByAgencyId }) {
  const ws = workbook.getWorksheet('00 Dashboard');
  setColumnWidths(ws, [22, 16, 16, 16, 16, 16]);
  const { jobs, invoices, certs, properties, persons, agencies } = data;

  let r = 1;
  const header = ws.getRow(r);
  ws.mergeCells(r, 1, r, 6);
  header.getCell(1).value = `${(S.coName || 'DEEPFLOW').toUpperCase()}\nBUSINESS OPERATIONS REPORT`;
  header.getCell(1).font = { bold: true, size: 16, color: { argb: PALETTE.navyText } };
  header.getCell(1).fill = fill(PALETTE.navy);
  header.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  header.height = 40;
  r += 2;

  [['Company', S.coName || 'All Companies'], ['Period', exportMeta.dateRangeLabel], ['Generated', exportMeta.generatedAt]].forEach(([label, val]) => {
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { bold: true, color: { argb: PALETTE.greyText } };
    const cell = ws.getCell(r, 2);
    cell.value = val;
    if (val instanceof Date) cell.numFmt = `${DATE_FMT} hh:mm`;
    r += 1;
  });
  r += 1;

  // ── KPIs ─────────────────────────────────────────────────────────────
  addSectionBar(ws, r, 'BUSINESS KPIs', 6, { size: 12 }); r += 1;
  const byStatus = (s) => jobs.filter((j) => j.status === s).length;
  const unassigned = jobs.filter((j) => !j.engineer).length;
  let totalInvoiced = 0, totalPaid = 0, outstanding = 0, overdue = 0;
  invoices.forEach((inv) => {
    const f = computeInvoiceFinancials(inv, S);
    totalInvoiced += f.total; totalPaid += f.paid; outstanding += f.outstanding;
    if (f.daysOverdue > 0) overdue += f.outstanding;
  });
  const currentCerts = certs.filter((c) => !c.supersededBy);
  const certCurrent = currentCerts.filter((c) => certStatus(c) === 'current').length;
  const certDue = currentCerts.filter((c) => certStatus(c) === 'expiring').length;
  const certExpired = currentCerts.filter((c) => certStatus(c) === 'expired').length;
  const landlordCount = persons.filter((p) => jobsForPerson(jobs, p).length > 0).length;
  const activeEngineers = new Set(jobs.filter((j) => j.engineer).map((j) => j.engineer)).size;

  const kpis = [
    ['Total Jobs', jobs.length], ['Completed Jobs', byStatus(STATUS.COMPLETED) + byStatus(STATUS.INVOICED)],
    ['Running Jobs', byStatus(STATUS.IN_PROGRESS)], ['Scheduled Jobs', byStatus(STATUS.PENDING)],
    ['Cancelled Jobs', byStatus(STATUS.CANCELLED)], ['Unassigned Jobs', unassigned],
    ['Total Invoiced', totalInvoiced], ['Total Paid', totalPaid], ['Outstanding', outstanding], ['Overdue', overdue],
    ['Certificates Current', certCurrent], ['Certificates Due Soon', certDue], ['Certificates Expired', certExpired],
    ['Properties', properties.length], ['Landlords', landlordCount], ['Agencies', agencies.length], ['Active Engineers', activeEngineers],
  ];
  for (let i = 0; i < kpis.length; i += 2) {
    const row = ws.getRow(r);
    for (let c = 0; c < 2; c++) {
      const item = kpis[i + c];
      if (!item) continue;
      const base = c * 3;
      row.getCell(base + 1).value = item[0];
      row.getCell(base + 1).font = { color: { argb: PALETTE.greyText }, size: 10 };
      const valCell = row.getCell(base + 2);
      valCell.value = item[1];
      valCell.font = { bold: true, size: 13 };
      if (['Total Invoiced', 'Total Paid', 'Outstanding', 'Overdue'].includes(item[0])) valCell.numFmt = CURRENCY_FMT;
    }
    r += 1;
  }
  r += 1;

  // ── Navigation ───────────────────────────────────────────────────────
  addSectionBar(ws, r, 'GO TO', 6, { size: 12 }); r += 1;
  const navRow = ws.getRow(r);
  NAV_TARGETS.slice(0, 6).forEach((t, i) => {
    const cell = navRow.getCell(i + 1);
    cell.value = internalLink(t[0], `[ ${t[1]} ]`);
    cell.font = { color: { argb: PALETTE.blueText }, bold: true, underline: true, size: 10 };
    cell.alignment = { horizontal: 'center' };
  });
  r += 1;
  const navRow2 = ws.getRow(r);
  NAV_TARGETS.slice(6).forEach((t, i) => {
    const cell = navRow2.getCell(i + 1);
    cell.value = internalLink(t[0], `[ ${t[1]} ]`);
    cell.font = { color: { argb: PALETTE.blueText }, bold: true, underline: true, size: 10 };
    cell.alignment = { horizontal: 'center' };
  });
  r += 2;

  // ── Agency section ───────────────────────────────────────────────────
  addSectionBar(ws, r, 'AGENCY PERFORMANCE', 6, { size: 12 }); r += 1;
  ['Agency', 'Jobs', 'Invoiced £', 'Paid £', 'Outstanding £'].forEach((h, i) => {
    ws.getCell(r, i + 1).value = h; ws.getCell(r, i + 1).font = { bold: true };
  });
  r += 1;
  agencies.forEach((agency) => {
    const aJobs = jobs.filter((j) => j.agencyName === agency.name);
    const jobIds = new Set(aJobs.map((j) => j.id));
    let invoiced = 0, paid = 0, out = 0;
    invoices.forEach((inv) => {
      if ((inv.jobId && jobIds.has(inv.jobId)) || (inv.linkedJobId && jobIds.has(inv.linkedJobId))) {
        const f = computeInvoiceFinancials(inv, S);
        invoiced += f.total; paid += f.paid; out += f.outstanding;
      }
    });
    if (!aJobs.length && !invoiced) return;
    const row = ws.getRow(r);
    const sheetName = sheetNameByAgencyId.get(agency.id);
    const nameCell = row.getCell(1);
    if (sheetName) { nameCell.value = internalLink(sheetName, agency.name); nameCell.font = { color: { argb: PALETTE.blueText }, underline: true }; }
    else nameCell.value = agency.name;
    row.getCell(2).value = aJobs.length;
    row.getCell(3).value = invoiced; row.getCell(3).numFmt = CURRENCY_FMT;
    row.getCell(4).value = paid; row.getCell(4).numFmt = CURRENCY_FMT;
    row.getCell(5).value = out; row.getCell(5).numFmt = CURRENCY_FMT;
    r += 1;
  });
  r += 1;

  // ── Engineer section ─────────────────────────────────────────────────
  addSectionBar(ws, r, 'ENGINEER ACTIVITY', 6, { size: 12 }); r += 1;
  ['Engineer', 'Jobs', 'Completed', 'Running'].forEach((h, i) => {
    ws.getCell(r, i + 1).value = h; ws.getCell(r, i + 1).font = { bold: true };
  });
  r += 1;
  [...new Set(jobs.map((j) => j.engineer).filter(Boolean))].sort().forEach((eng) => {
    const eJobs = jobs.filter((j) => j.engineer === eng);
    const row = ws.getRow(r);
    row.getCell(1).value = eng;
    row.getCell(2).value = eJobs.length;
    row.getCell(3).value = eJobs.filter((j) => j.status === STATUS.COMPLETED || j.status === STATUS.INVOICED).length;
    row.getCell(4).value = eJobs.filter((j) => j.status === STATUS.IN_PROGRESS).length;
    r += 1;
  });

  ws.views = [{ state: 'frozen', ySplit: 0, xSplit: 0 }];
  return { rowsWritten: 1 };
}
