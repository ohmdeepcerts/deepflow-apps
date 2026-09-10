// "Engineer Summary" sheet — one row per engineer found on real jobs,
// cross-referenced against the S.engineers roster (app_settings, not a DB
// table) for context; a job's engineer field is free text, so the roster
// is supplementary, not the row source.
import { classifyJobWork } from './export-model.js';
import { STATUS } from '@business';
import { setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink, CURRENCY_FMT, DATE_FMT } from './export-styles.js';

const HEADERS = ['Engineer', 'Total Jobs', 'Completed', 'Submitted for Review', 'Cancelled / No Access', 'Certificate-Only Jobs', 'Repair / Works Jobs', 'Total Job Value £', 'Avg Jobs / Day', 'Most Recent Job'];

export function buildEngineerSummarySheet(workbook, { jobs, S }) {
  const ws = workbook.addWorksheet('Engineer Summary');
  setColumnWidths(ws, [18, 11, 11, 16, 16, 16, 16, 14, 12, 14]);
  addBackToDashboardLink(ws);
  let r = 3;
  addSectionBar(ws, r, 'ENGINEER SUMMARY', HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(ws, r, HEADERS); r += 1;

  const engineerNames = new Set(jobs.map((j) => j.engineer).filter(Boolean));
  (S.engineers || []).forEach((e) => { if (e.name) engineerNames.add(e.name); });

  let written = 0;
  [...engineerNames].sort().forEach((name) => {
    const eJobs = jobs.filter((j) => j.engineer === name);
    const completed = eJobs.filter((j) => j.status === STATUS.COMPLETED || j.status === STATUS.INVOICED).length;
    const submitted = eJobs.filter((j) => j.status === STATUS.ENGINEER_COMPLETED).length;
    const cancelled = eJobs.filter((j) => j.status === STATUS.CANCELLED || j.status === STATUS.CANNOT_ACCESS).length;
    const certOnly = eJobs.filter((j) => classifyJobWork(j, S) === 'cert_only').length;
    const workJobs = eJobs.filter((j) => classifyJobWork(j, S) === 'additional_work').length;
    const totalValue = eJobs.reduce((s, j) => s + (j.price || 0), 0);
    const dates = new Set(eJobs.map((j) => j.date).filter(Boolean));
    const dayRange = dates.size ? (new Date([...dates].sort().at(-1)) - new Date([...dates].sort()[0])) / 86400000 + 1 : 0;
    const avgPerDay = dayRange > 0 ? eJobs.length / dayRange : eJobs.length;
    const mostRecent = eJobs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

    const row = ws.getRow(r);
    const values = [name, eJobs.length, completed, submitted, cancelled, certOnly, workJobs, totalValue, +avgPerDay.toFixed(2), mostRecent?.date ? new Date(mostRecent.date) : ''];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    row.getCell(8).numFmt = CURRENCY_FMT;
    if (mostRecent?.date) row.getCell(10).numFmt = DATE_FMT;
    r += 1;
    written += 1;
  });

  return { rowsWritten: written, queriedCount: engineerNames.size };
}
