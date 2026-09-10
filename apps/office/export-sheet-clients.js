// "Clients" sheet — a unified persons+agencies+agents register. No such
// unified list exists anywhere in the Office app today (its own "All"
// directory tab only merges persons, not agencies/agents — see
// docs/planning/25-excel-export-data-audit.md §4) — built new here.
// "Portal Active" reflects a real PIN having been set (portal_pin_hash is
// actually written by the PIN flow), not the dead portal_enabled column.
import { computeInvoiceFinancials, jobsForPerson, jobsForAgency } from './export-model.js';
import { setColumnWidths, addSectionBar, addTableHeaderRow, addBackToDashboardLink, applyRowFill, PALETTE, CURRENCY_FMT, DATE_FMT } from './export-styles.js';

const HEADERS = ['Client ID', 'Name', 'Type', 'Phone', 'Email', 'Jobs', 'Invoices', 'Outstanding £', 'Portal Active', 'Last Job', 'Last Activity'];

function entityInvoices(invoices, name) {
  return invoices.filter((i) => i.clientName === name || i.landlordName === name || i.agencyName === name);
}

export function buildClientsSheet(workbook, { persons, agencies, agents, jobs, invoices, S }) {
  const ws = workbook.addWorksheet('Clients');
  setColumnWidths(ws, [14, 24, 12, 14, 22, 9, 10, 13, 12, 14, 14]);
  addBackToDashboardLink(ws);
  let r = 3;
  addSectionBar(ws, r, 'CLIENTS', HEADERS.length, { size: 13 }); r += 2;
  addTableHeaderRow(ws, r, HEADERS); r += 1;

  const writeEntity = (entity, type, entityJobs, entityInvs) => {
    let outstanding = 0;
    entityInvs.forEach((inv) => { outstanding += computeInvoiceFinancials(inv, S).outstanding; });
    const lastJob = entityJobs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const lastInv = entityInvs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const lastActivity = [lastJob?.date, lastInv?.date].filter(Boolean).sort().at(-1);

    const row = ws.getRow(r);
    const values = [
      entity.id, entity.name || '', type, entity.phone || '', entity.email || '',
      entityJobs.length, entityInvs.length, outstanding, entity.portal_pin_hash ? 'Yes' : 'No',
      lastJob?.date ? new Date(lastJob.date) : '', lastActivity ? new Date(lastActivity) : '',
    ];
    values.forEach((v, i) => { row.getCell(i + 1).value = v; });
    row.getCell(8).numFmt = CURRENCY_FMT;
    if (lastJob?.date) row.getCell(10).numFmt = DATE_FMT;
    if (lastActivity) row.getCell(11).numFmt = DATE_FMT;
    if (outstanding > 0) applyRowFill(row, HEADERS.length, PALETTE.amber, PALETTE.amberText);
    r += 1;
  };

  // Precompute the full "has real activity" set independently of the write
  // loop below, so queriedCount is a genuine expectation to check the
  // actual written row count against — not the same counter echoed twice.
  const withActivity = [
    ...persons.map((p) => ({ entity: p, type: 'Person', entityJobs: jobsForPerson(jobs, p), entityInvs: entityInvoices(invoices, p.name) })),
    ...agencies.map((a) => ({ entity: a, type: 'Agency', entityJobs: jobsForAgency(jobs, a), entityInvs: entityInvoices(invoices, a.name) })),
    ...agents.map((a) => ({ entity: a, type: 'Agent', entityJobs: jobs.filter((j) => j.agentName === a.name), entityInvs: [] })),
  ].filter((x) => x.entityJobs.length || x.entityInvs.length);

  let written = 0;
  withActivity.forEach(({ entity, type, entityJobs, entityInvs }) => {
    writeEntity(entity, type, entityJobs, entityInvs);
    written += 1;
  });

  return { rowsWritten: written, queriedCount: withActivity.length };
}
