// Master Excel Export — workbook orchestrator. Pure (no DOM, no fetch): takes
// already-gathered data plus the app's live settings object and returns a
// finished ExcelJS Workbook. This split (data gathering vs. workbook
// building) is what makes buildWorkbook() unit-testable with a Node ExcelJS
// import and a fixed fixture — see tests/integration/export-workbook.test.js
// — without needing a browser or a real login.
import ExcelJS from 'exceljs';
import { filterJobsByDateRange } from './export-data-service.js';
import { computeDataQualityIssues, buildDataQualitySheet } from './export-sheet-data-quality.js';
import { buildDailyJobsSheet } from './export-sheet-daily-jobs.js';
import { buildAuditSheet, validateReconciliation } from './export-sheet-audit.js';

export async function buildWorkbook({ data, S, scope, requestedBy }) {
  const { jobs, invoices, certs, properties, payments, visits } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = S.coName || 'DeepFlow';
  workbook.created = data.snapshot.generatedAt;

  const scopedJobs = filterJobsByDateRange(jobs, scope.dateRange);

  const dataQuality = computeDataQualityIssues({ jobs, invoices, certs, properties, payments, S });

  const reconciliation = [];
  const track = (label, queried, exported) => reconciliation.push({ label, queried, exported });

  if (scope.include.dailyJobs) {
    const result = buildDailyJobsSheet(workbook, {
      jobs: scopedJobs, invoices, visits, S, needsReviewJobIds: dataQuality.needsReviewJobIds,
    });
    track('Jobs (Daily Jobs sheet, selected scope)', scopedJobs.length, result.rowsWritten);
  }

  if (scope.include.dataQuality) {
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
