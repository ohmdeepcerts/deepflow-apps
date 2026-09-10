// Master Excel Export — shared ExcelJS styling helpers + the corporate
// colour system (spec: "controlled palette, not excessive decorative
// colours"). Every sheet builder imports from here rather than picking its
// own colours, so green/red/amber mean the same thing on every sheet.
export const PALETTE = {
  navy: 'FF1F2A44',
  navyText: 'FFFFFFFF',
  mustard: 'FFF2C94C',
  mustardText: 'FF1F2A44',
  green: 'FFD7F5E3',
  greenText: 'FF1E7A46',
  red: 'FFFBE0E0',
  redText: 'FFB33A3A',
  amber: 'FFFDEFD3',
  amberText: 'FFB8860B',
  blue: 'FFDCEBFB',
  blueText: 'FF2563EB',
  grey: 'FFECEEF1',
  greyText: 'FF6B7280',
  white: 'FFFFFFFF',
  border: 'FFD8DEE8',
};

export function fill(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }

const THIN = { style: 'thin', color: { argb: PALETTE.border } };
export const ALL_BORDERS = { top: THIN, left: THIN, bottom: THIN, right: THIN };

export function setColumnWidths(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

// A "back to dashboard" link at A1 of every non-dashboard sheet, per spec.
export function addBackToDashboardLink(ws) {
  const cell = ws.getCell('A1');
  cell.value = { text: '← BACK TO DASHBOARD', hyperlink: "#'00 Dashboard'!A1" };
  cell.font = { color: { argb: PALETTE.blueText }, bold: true, underline: true, size: 10 };
  ws.getRow(1).height = 18;
}

export function internalLink(sheetName, text) {
  return { text, hyperlink: `#'${sheetName}'!A1` };
}

// A full-width merged section header bar (used for Dashboard titles, Daily
// Jobs date bars, per-agency/per-engineer sheet headers).
export function addSectionBar(ws, rowNum, text, lastCol, opts = {}) {
  const row = ws.getRow(rowNum);
  ws.mergeCells(rowNum, 1, rowNum, lastCol);
  const cell = row.getCell(1);
  cell.value = text;
  cell.font = { bold: true, size: opts.size || 12, color: { argb: opts.textColor || PALETTE.navyText } };
  cell.alignment = { vertical: 'middle', horizontal: opts.align || 'left', indent: 1 };
  cell.fill = fill(opts.bg || PALETTE.navy);
  row.height = opts.height || 22;
  return row;
}

// Standard header row for a data table sheet: bold white-on-navy, frozen,
// auto-filter enabled from this row down.
export function addTableHeaderRow(ws, rowNum, headers) {
  const row = ws.getRow(rowNum);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: PALETTE.navyText }, size: 10 };
    cell.fill = fill(PALETTE.navy);
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = ALL_BORDERS;
  });
  row.height = 20;
  ws.views = [{ state: 'frozen', ySplit: rowNum, xSplit: 0 }];
  ws.autoFilter = { from: { row: rowNum, column: 1 }, to: { row: rowNum, column: headers.length } };
}

export function applyRowFill(row, lastCol, bg, textColor) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.fill = fill(bg);
    if (textColor) cell.font = { ...(cell.font || {}), color: { argb: textColor } };
    cell.border = ALL_BORDERS;
  }
}

export const CURRENCY_FMT = '£#,##0.00';
export const DATE_FMT = 'dd/mm/yyyy';
