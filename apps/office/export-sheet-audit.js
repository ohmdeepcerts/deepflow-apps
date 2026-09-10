// "Export Audit" sheet — always the LAST worksheet, per spec. Proves what
// was exported: for every scoped table, the count the export queried vs
// the count it actually wrote to a sheet. A mismatch is a real bug and is
// shown as a failure, never silently hidden — see validateReconciliation().
import { PALETTE, fill, setColumnWidths, addSectionBar, addBackToDashboardLink, ALL_BORDERS, DATE_FMT } from './export-styles.js';

export function buildAuditSheet(workbook, { exportMeta, reconciliation }) {
  const ws = workbook.addWorksheet('Export Audit');
  setColumnWidths(ws, [32, 40]);
  addBackToDashboardLink(ws);

  let r = 3;
  addSectionBar(ws, r, 'EXPORT AUDIT', 2, { size: 13 }); r += 2;

  const metaRows = [
    ['Export ID', exportMeta.exportId],
    ['Generated', exportMeta.generatedAt],
    ['Requested By', exportMeta.requestedBy],
    ['Company Filter', exportMeta.companyFilter],
    ['Date Range', exportMeta.dateRangeLabel],
  ];
  metaRows.forEach(([label, val]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    const cell = ws.getCell(r, 2);
    cell.value = val;
    if (label === 'Generated' && val instanceof Date) cell.numFmt = `${DATE_FMT} hh:mm`;
    r += 1;
  });
  r += 1;

  addSectionBar(ws, r, 'SOURCE / EXPORT COUNTS', 2, { size: 12 }); r += 1;
  const headerRow = ws.getRow(r);
  ['Record Type', 'Queried → Exported'].forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
    headerRow.getCell(i + 1).font = { bold: true, color: { argb: PALETTE.navyText } };
    headerRow.getCell(i + 1).fill = fill(PALETTE.navy);
  });
  r += 1;

  let allMatch = true;
  reconciliation.forEach(({ label, queried, exported }) => {
    const ok = queried === exported;
    if (!ok) allMatch = false;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 2).value = `${queried} queried  →  ${exported} exported`;
    const bg = ok ? PALETTE.green : PALETTE.red;
    const textColor = ok ? PALETTE.greenText : PALETTE.redText;
    [1, 2].forEach((c) => {
      const cell = ws.getCell(r, c);
      cell.fill = fill(bg);
      cell.font = { color: { argb: textColor }, bold: !ok };
      cell.border = ALL_BORDERS;
    });
    r += 1;
  });
  r += 1;

  const resultCell = ws.getCell(r, 1);
  ws.mergeCells(r, 1, r, 2);
  resultCell.value = allMatch
    ? '✓ All counts reconcile — nothing was silently dropped or duplicated.'
    : '❌ VALIDATION FAILED — one or more counts do not reconcile. Review before relying on this workbook.';
  resultCell.font = { bold: true, size: 12, color: { argb: allMatch ? PALETTE.greenText : PALETTE.redText } };
  resultCell.fill = fill(allMatch ? PALETTE.green : PALETTE.red);

  return { allMatch };
}

// Called once every sheet builder has reported its own queried/exported
// pair — this is the single source of truth for whether the workbook is
// safe to present as complete, consumed by both the Audit sheet above and
// the export controller's UI (which refuses to offer a clean "Download"
// state, per spec, when this is false).
export function validateReconciliation(reconciliation) {
  return reconciliation.every((r) => r.queried === r.exported);
}
