// "Certificates Dashboard" + "Certificates" sheets. Current-state counts
// exclude superseded certs (a renewal has replaced them) — reused verbatim
// from certs-stats-dashboard.js's own rule — but the detail sheet keeps
// superseded rows too, labelled, as real history. Property/Agency/Postcode
// are matched by normalized address (certs has no property_id/agency FK) —
// best-effort, not a guaranteed link; genuinely ambiguous matches are left
// blank rather than guessed.
import { certStatus } from './export-model.js';
import { normAddr as normAddrBiz } from '@business';
import {
  PALETTE, fill, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink,
  applyRowFill, DATE_FMT,
} from './export-styles.js';

const STATUS_STYLE = {
  current: { bg: PALETTE.green, text: PALETTE.greenText, label: 'Current' },
  expiring: { bg: PALETTE.amber, text: PALETTE.amberText, label: 'Due Soon' },
  expired: { bg: PALETTE.red, text: PALETTE.redText, label: 'Expired' },
  missing: { bg: PALETTE.grey, text: PALETTE.greyText, label: 'Missing Expiry' },
  no_expiry: { bg: PALETTE.blue, text: PALETTE.blueText, label: 'No Expiry' },
};

function buildAddressIndex(properties) {
  const map = new Map();
  properties.forEach((p) => { map.set(normAddrBiz(p.address), p); });
  return map;
}

export function buildCertificatesDashboardSheet(workbook, { certs, jobs, S }) {
  const ws = workbook.addWorksheet('Certificates Dashboard');
  setColumnWidths(ws, [22, 12, 12, 12, 12]);
  addBackToDashboardLink(ws);
  const current = certs.filter((c) => !c.supersededBy);

  let r = 3;
  addSectionBar(ws, r, 'CERTIFICATES DASHBOARD', 5, { size: 13 }); r += 2;

  const counts = { current: 0, expiring: 0, expired: 0, missing: 0, no_expiry: 0 };
  current.forEach((c) => { counts[certStatus(c)] += 1; });
  const kpis = [
    ['Total Certificates', current.length], ['Current', counts.current], ['Due Soon (≤60 days)', counts.expiring],
    ['Expired', counts.expired], ['Missing Expiry', counts.missing], ['No Expiry (N/A)', counts.no_expiry],
  ];
  kpis.forEach(([label, val]) => {
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = val;
    r += 1;
  });
  r += 1;

  addSectionBar(ws, r, 'BY CERTIFICATE TYPE', 5, { size: 12 }); r += 1;
  addTableHeaderRow(ws, r, ['Type', 'Total', 'Current', 'Due Soon', 'Expired']); r += 1;
  (S.certTypes || []).forEach((ct) => {
    const typeCerts = current.filter((c) => c.type === ct.name);
    if (!typeCerts.length) return;
    const row = ws.getRow(r);
    row.getCell(1).value = ct.name;
    row.getCell(2).value = typeCerts.length;
    row.getCell(3).value = typeCerts.filter((c) => certStatus(c) === 'current').length;
    row.getCell(4).value = typeCerts.filter((c) => certStatus(c) === 'expiring').length;
    row.getCell(5).value = typeCerts.filter((c) => certStatus(c) === 'expired').length;
    r += 1;
  });

  return { rowsWritten: current.length, queriedCount: current.length };
}

export function buildCertificatesSheet(workbook, { certs, jobs, properties, S }) {
  const ws = workbook.addWorksheet('Certificates');
  setColumnWidths(ws, [14, 14, 24, 28, 10, 18, 16, 14, 18, 12, 12, 10, 12, 14, 10, 10, 12, 10, 10, 24]);
  addBackToDashboardLink(ws);
  const addrIndex = buildAddressIndex(properties);
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  let r = 3;
  addSectionBar(ws, r, 'CERTIFICATES', 20, { size: 13 }); r += 2;
  const headers = ['Certificate Number', 'Company', 'Property ID', 'Address', 'Postcode', 'Landlord / Client', 'Agency', 'Agent', 'Certificate Type', 'Issue Date', 'Expiry Date', 'Days Remaining', 'Status', 'Engineer', 'Linked Job', 'PDF Available', 'Reminder Status', 'No Response', 'Superseded', 'Comments'];
  addTableHeaderRow(ws, r, headers); r += 1;

  let written = 0;
  certs.forEach((c) => {
    const status = certStatus(c);
    const style = STATUS_STYLE[status];
    const prop = addrIndex.get(normAddrBiz(c.address || ''));
    const job = c.jobId ? jobsById.get(c.jobId) : null;
    const days = c.expiryDate ? Math.floor((new Date(c.expiryDate).getTime() - Date.now()) / 86400000) : '';

    const row = ws.getRow(r);
    const values = [
      c.certNum || '', S.coName || '', prop?.id || '', c.address || '', prop?.postcode || '', c.landlord || '',
      job?.agencyName || '', c.agent || '', c.type || '', c.issueDate ? new Date(c.issueDate) : '',
      c.expiryDate ? new Date(c.expiryDate) : '', days, c.supersededBy ? 'Superseded' : style.label,
      c.engineer || '', c.jobNum || '', (c.pdfUrl || c.pdfPath) ? 'Yes' : 'No', '', c.notResponding ? 'Yes' : 'No',
      c.supersededBy ? 'Yes' : 'No', c.notes || '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (c.issueDate) row.getCell(10).numFmt = DATE_FMT;
    if (c.expiryDate) row.getCell(11).numFmt = DATE_FMT;
    const rowStyle = c.supersededBy ? { bg: PALETTE.grey, text: PALETTE.greyText } : style;
    applyRowFill(row, headers.length, rowStyle.bg, rowStyle.text);
    r += 1;
    written += 1;
  });

  return { rowsWritten: written, queriedCount: certs.length };
}
