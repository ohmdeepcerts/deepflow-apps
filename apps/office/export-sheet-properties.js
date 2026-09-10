// "Properties" sheet — one row per canonical property record (the real
// `properties` table from the Phase 1 records rearchitecture, joined to
// jobs via the real `property_id` FK — not address-string re-grouping).
// Note: the `properties` table itself is the one place in this schema that
// keeps snake_case field names in JS (no TO_DB/FROM_DB entry exists for it
// — see packages/data/mapping.js), so p.landlord_name/p.agency_name/
// p.created_at are correct here, not a mapping bug.
import { computeInvoiceFinancials, certStatus } from './export-model.js';
import { normAddr } from '@business';
import { PALETTE, setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink, applyRowFill, CURRENCY_FMT } from './export-styles.js';

const HEADERS = ['Property ID', 'Canonical Address', 'Postcode', 'Client / Landlord', 'Agency', 'Total Jobs', 'Open Jobs', 'Last Job Date', 'Certificates Current', 'Certificates Due Soon', 'Certificates Expired', 'Outstanding £', 'Access Summary'];

export function buildPropertiesSheet(workbook, { properties, jobs, invoices, certs, S }) {
  const ws = workbook.addWorksheet('Properties');
  setColumnWidths(ws, [14, 30, 10, 20, 18, 9, 9, 14, 12, 14, 12, 12, 28]);
  addBackToDashboardLink(ws);

  const certsByAddr = new Map();
  certs.filter((c) => !c.supersededBy).forEach((c) => {
    const key = normAddr(c.address || '');
    if (!certsByAddr.has(key)) certsByAddr.set(key, []);
    certsByAddr.get(key).push(c);
  });

  let r = 3;
  addSectionBar(ws, r, 'PROPERTIES', HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(ws, r, HEADERS); r += 1;

  let written = 0;
  properties.forEach((p) => {
    const pJobs = jobs.filter((j) => j.propertyId === p.id);
    const open = pJobs.filter((j) => j.status !== 'Completed' && j.status !== 'Invoiced' && j.status !== 'Cancelled').length;
    const lastJob = pJobs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const pCerts = certsByAddr.get(normAddr(p.address || '')) || [];
    const certCurrent = pCerts.filter((c) => certStatus(c) === 'current').length;
    const certDue = pCerts.filter((c) => certStatus(c) === 'expiring').length;
    const certExpired = pCerts.filter((c) => certStatus(c) === 'expired').length;

    const jobIds = new Set(pJobs.map((j) => j.id));
    let outstanding = 0;
    invoices.forEach((inv) => {
      if ((inv.jobId && jobIds.has(inv.jobId)) || (inv.linkedJobId && jobIds.has(inv.linkedJobId))) {
        outstanding += computeInvoiceFinancials(inv, S).outstanding;
      }
    });

    const row = ws.getRow(r);
    const values = [
      p.id, p.address || '', p.postcode || '', p.landlord_name || '', p.agency_name || '',
      pJobs.length, open, lastJob ? new Date(lastJob.date) : '', certCurrent, certDue, certExpired,
      outstanding, lastJob?.access || '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    if (lastJob) row.getCell(8).numFmt = 'dd/mm/yyyy';
    row.getCell(12).numFmt = CURRENCY_FMT;
    if (certExpired > 0) applyRowFill(row, HEADERS.length, PALETTE.red, PALETTE.redText);
    else if (certDue > 0) applyRowFill(row, HEADERS.length, PALETTE.amber, PALETTE.amberText);
    r += 1;
    written += 1;
  });

  return { rowsWritten: written, queriedCount: properties.length };
}
