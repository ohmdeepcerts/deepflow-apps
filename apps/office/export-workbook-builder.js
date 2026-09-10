// Master Excel Export — workbook orchestrator. Pure (no DOM, no fetch): takes
// already-gathered data plus the app's live settings object and returns a
// finished ExcelJS Workbook. This split (data gathering vs. workbook
// building) is what makes buildWorkbook() unit-testable with a Node ExcelJS
// import and a fixed fixture — see tests/integration/export-workbook.test.js
// — without needing a browser or a real login.
//
// Sheet order follows the spec exactly: 00 Dashboard is added FIRST (empty)
// so it's physically sheet 1 in the file, then filled in LAST once every
// sheet it links to/summarizes actually exists — Export Audit is always
// last, after every other sheet has reported its own queried/exported pair.
import ExcelJS from 'exceljs';
import { filterJobsByDateRange } from './export-data-service.js';
import { computeDataQualityIssues, buildDataQualitySheet } from './export-sheet-data-quality.js';
import { buildDailyJobsSheet } from './export-sheet-daily-jobs.js';
import { buildLandlordsSheet } from './export-sheet-landlords.js';
import { buildAgencySheets } from './export-sheet-agencies.js';
import { buildCertificatesDashboardSheet, buildCertificatesSheet } from './export-sheet-certificates.js';
import { buildPropertiesSheet } from './export-sheet-properties.js';
import { buildInvoicesSheet, buildOutstandingSheet } from './export-sheet-invoices.js';
import { buildEngineerSummarySheet } from './export-sheet-engineers.js';
import { buildClientsSheet } from './export-sheet-clients.js';
import { buildDashboardSheet } from './export-sheet-dashboard.js';
import { buildAuditSheet, validateReconciliation } from './export-sheet-audit.js';

export const DEFAULT_INCLUDE = {
  dashboard: true, dailyJobs: true, landlords: true, agencies: true, certificates: true,
  properties: true, finance: true, engineers: true, clients: true, dataQuality: true,
};

export async function buildWorkbook({ data, S, scope, requestedBy }) {
  const { jobs, invoices, certs, properties, persons, agencies, agents, payments, visits } = data;
  const include = { ...DEFAULT_INCLUDE, ...(scope.include || {}) };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = S.coName || 'DeepFlow';
  workbook.created = data.snapshot.generatedAt;

  const scopedJobs = filterJobsByDateRange(jobs, scope.dateRange);

  const reconciliation = [];
  const track = (label, queried, exported) => reconciliation.push({ label, queried, exported });

  // Computed once, reused by both Daily Jobs (needsReviewJobIds — a job
  // classifyJobWork() can't confidently resolve) and the Data Quality
  // sheet itself, so the two never disagree about which jobs were flagged.
  const dataQuality = computeDataQualityIssues({ jobs, invoices, certs, properties, payments, S });

  // Reserve sheet 1 now; content is written by buildDashboardSheet() at the
  // very end, once every sheet below exists to link to and summarize.
  if (include.dashboard) workbook.addWorksheet('00 Dashboard');

  if (include.dailyJobs) {
    const result = buildDailyJobsSheet(workbook, {
      jobs: scopedJobs, invoices, visits, S, needsReviewJobIds: dataQuality.needsReviewJobIds,
    });
    track('Jobs (Daily Jobs sheet, selected scope)', scopedJobs.length, result.rowsWritten);
  }

  if (include.landlords) {
    const result = buildLandlordsSheet(workbook, { persons, jobs, invoices, payments, S });
    track('Landlords with real activity', result.queriedCount, result.rowsWritten);
  }

  let sheetNameByAgencyId = new Map();
  if (include.agencies) {
    const result = buildAgencySheets(workbook, { agencies, agents, jobs, invoices, S });
    sheetNameByAgencyId = result.sheetNameByAgencyId;
    track('Agencies (summary rows + one sheet each)', agencies.length, result.rowsWritten);
    track('Agency worksheets created', agencies.length, result.sheetsCreated);
  }

  if (include.certificates) {
    // Certificates Dashboard is an aggregate KPI page, not a one-row-per-
    // record table — the Certificates detail sheet below is the real
    // per-record reconciliation check for this table.
    buildCertificatesDashboardSheet(workbook, { certs, jobs, S });
    const detail = buildCertificatesSheet(workbook, { certs, jobs, properties, S });
    track('Certificates (all, detail sheet)', detail.queriedCount, detail.rowsWritten);
  }

  if (include.properties) {
    const result = buildPropertiesSheet(workbook, { properties, jobs, invoices, certs, S });
    track('Properties', result.queriedCount, result.rowsWritten);
  }

  if (include.finance) {
    const inv = buildInvoicesSheet(workbook, { invoices, payments, S });
    track('Invoices', inv.queriedCount, inv.rowsWritten);
    const out = buildOutstandingSheet(workbook, { invoices, S });
    track('Outstanding invoices', out.queriedCount, out.rowsWritten);
  }

  if (include.engineers) {
    const result = buildEngineerSummarySheet(workbook, { jobs, S });
    track('Engineers', result.queriedCount, result.rowsWritten);
  }

  if (include.clients) {
    const result = buildClientsSheet(workbook, { persons, agencies, agents, jobs, invoices, S });
    track('Clients (persons+agencies+agents with activity)', result.queriedCount, result.rowsWritten);
  }

  if (include.dataQuality) {
    const result = buildDataQualitySheet(workbook, dataQuality);
    track('Data Quality issues listed', dataQuality.issues.length, result.rowsWritten);
  }

  const exportMeta = {
    exportId: `EXP-${data.snapshot.generatedAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`,
    generatedAt: data.snapshot.generatedAt,
    requestedBy: requestedBy || 'Unknown',
    companyFilter: S.coName || 'All Companies',
    dateRangeLabel: scope.dateRange.label,
  };

  if (include.dashboard) {
    buildDashboardSheet(workbook, { data, S, exportMeta, sheetNameByAgencyId });
  }

  const auditResult = buildAuditSheet(workbook, { exportMeta, reconciliation });

  return {
    workbook,
    exportMeta,
    reconciliation,
    allMatch: auditResult.allMatch && validateReconciliation(reconciliation),
    dataQualityIssueCount: dataQuality.issues.length,
  };
}

export async function workbookToBlob(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
