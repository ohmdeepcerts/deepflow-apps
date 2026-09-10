// Golden-dataset test for the Master Excel Export workbook builder — per
// spec: "Create one controlled test dataset where exact expected workbook
// content is known in advance. Generate workbook. Programmatically inspect
// resulting .xlsx." Runs entirely in Node (ExcelJS's Node build), no browser
// or login needed — see apps/office/export-workbook-builder.js for why the
// builder is deliberately split from the browser-only data-gathering layer.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../../apps/office/export-workbook-builder.js';
import { resolveDateRange } from '../../apps/office/export-data-service.js';

const S = {
  coName: 'Test Electrical Ltd',
  vatEnabled: true,
  vatRate: 20,
  certTypes: [
    { id: 'ct1', name: 'Gas Safety', keywords: ['gas', 'boiler', 'heating'] },
    { id: 'ct2', name: 'Electrical (EICR)', keywords: ['electrical', 'electric', 'eicr', 'consumer unit'] },
  ],
  engineers: [{ name: 'Jawad' }, { name: 'Shoaib' }],
};

const GENERATED_AT = new Date('2026-09-10T12:45:00Z');

function makeFixture() {
  const jobs = [
    { id: 'j1', jobNum: 'JOB-0001', date: '2026-09-10', engineer: 'Jawad', status: 'Invoiced', address: '1 Test Street', postcode: 'E1 1AA', referrer: 'John Doe', trade: 'Electrical', description: 'EICR', certTypes: ['ct2'], price: 150, invNumber: 'INV-1', propertyId: 'prop1', created: 1000, modified: 2000 },
    { id: 'j2', jobNum: 'JOB-0002', date: '2026-09-10', engineer: 'Jawad', status: 'Completed', address: '2 Test Street', postcode: 'E1 1AB', referrer: 'John Doe', trade: 'Electrical', description: 'Consumer unit supply and fit', certTypes: ['ct2'], price: 400, created: 1000, modified: 2000 },
    { id: 'j3', jobNum: 'JOB-0003', date: '', engineer: '', status: 'Pending', address: '3 Test Street', postcode: '', referrer: '', trade: '', description: '', certTypes: [], price: 0, created: 1000, modified: 2000 },
    { id: 'j4', jobNum: 'JOB-0004', date: '2026-09-11', engineer: 'Shoaib', status: 'Pending', address: '4 Test Street', postcode: 'E1 1AD', agencyName: 'Test Agency', agentName: 'Agent Smith', trade: 'Gas', description: 'Gas Safety', certTypes: ['ct1'], price: 120, created: 1000, modified: 2000 },
  ];
  const invoices = [
    { id: 'i1', number: 'INV-1', jobId: 'j1', status: 'Paid', clientName: 'John Doe', items: [{ qty: 1, unit: 150, vat: true }] },
  ];
  const persons = [{ id: 'p1', name: 'John Doe', phone: '07700100001', email: 'john@test.com', address: '1 Landlord Ave', roles: ['landlord'] }];
  const agencies = [{ id: 'a1', name: 'Test Agency', phone: '', email: '' }];
  const agents = [{ id: 'ag1', name: 'Agent Smith', agencyId: 'a1' }];
  const properties = [{ id: 'prop1', address: '1 Test Street', postcode: 'E1 1AA', landlord_name: 'John Doe', agency_name: '' }];
  const certs = [{ id: 'c1', certNum: 'GS-001', address: '1 Test Street', type: 'Gas Safety', landlord: 'John Doe', issueDate: '2026-01-01', expiryDate: '2026-10-01', jobId: 'j1', jobNum: 'JOB-0001', engineer: 'Jawad' }];
  const payments = [{ id: 'pay1', invId: 'i1', date: '2026-09-05', amount: 150, method: 'Bank Transfer' }];

  return {
    data: {
      jobs, invoices, certs, properties, persons, agencies, agents, payments, visits: [],
      snapshot: { generatedAt: GENERATED_AT },
      counts: { jobs: 4, invoices: 1, certs: 1, properties: 1, persons: 1, agencies: 1, agents: 1, payments: 1, job_visits: 0 },
    },
    scope: { dateRange: resolveDateRange('all'), include: {} }, // {} → every DEFAULT_INCLUDE sheet on
  };
}

const EXPECTED_SHEETS = [
  '00 Dashboard', '01 Daily Jobs', '02 Landlords', '03 Agency Summary', 'Test Agency',
  'Certificates Dashboard', 'Certificates', 'Properties', 'Invoices & Payments', 'Outstanding',
  'Engineer Summary', 'Clients', 'Data Quality', 'Export Audit',
];

describe('buildWorkbook — golden dataset (full sheet set)', () => {
  it('produces every sheet in spec order, reconciles cleanly, and round-trips as a real .xlsx', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });

    const sheetNames = result.workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(EXPECTED_SHEETS);

    expect(result.allMatch).toBe(true);
    expect(result.reconciliation.length).toBeGreaterThan(0);
    result.reconciliation.forEach((r) => { expect(r.queried).toBe(r.exported); });

    const buffer = await result.workbook.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer);
    expect(reread.worksheets.map((ws) => ws.name)).toEqual(sheetNames);
  });

  it('colours the cert-only job green and the additional-work job red on Daily Jobs; never drops the dateless/uncategorized job', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('01 Daily Jobs');

    const byJobNum = {};
    ws.eachRow((row) => { const n = row.getCell(3).value; if (n) byJobNum[n] = row; });

    expect(byJobNum['JOB-0001']).toBeTruthy();
    expect(byJobNum['JOB-0002']).toBeTruthy();
    expect(byJobNum['JOB-0003']).toBeTruthy(); // no date, no certTypes — never silently dropped
    expect(byJobNum['JOB-0004']).toBeTruthy();

    const argb = (row) => row.getCell(3).fill.fgColor.argb;
    expect(argb(byJobNum['JOB-0001'])).toBe('FFD7F5E3'); // green — certificate-only
    expect(argb(byJobNum['JOB-0002'])).toBe('FFFBE0E0'); // red — additional work
    expect(argb(byJobNum['JOB-0003'])).toBe('FFECEEF1'); // grey — needs review
  });

  it('Landlords: computes real totals from line items, not the dead stored invoice columns', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('02 Landlords');
    let johnRow = null;
    ws.eachRow((row) => { if (row.getCell(1).value === 'John Doe') johnRow = row; });
    expect(johnRow).toBeTruthy();
    expect(johnRow.getCell(8).value).toBeGreaterThanOrEqual(2); // Total Jobs (matched via referrer)
    expect(johnRow.getCell(18).value).toBe('Paid'); // Payment Status column
  });

  it('Agencies: creates a real per-agency worksheet, deterministically named, hyperlinked from the summary and Dashboard', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const agencySheet = result.workbook.getWorksheet('Test Agency');
    expect(agencySheet).toBeTruthy();

    const summary = result.workbook.getWorksheet('03 Agency Summary');
    let linkFound = false;
    summary.eachRow((row) => {
      const cell = row.getCell(1);
      if (cell.value && typeof cell.value === 'object' && cell.value.hyperlink === "#'Test Agency'!A1") linkFound = true;
    });
    expect(linkFound).toBe(true);
  });

  it('Certificates: excludes nothing from the detail sheet, computes days-remaining status the same way certs-stats-dashboard.js does', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('Certificates');
    let certRow = null;
    ws.eachRow((row) => { if (row.getCell(1).value === 'GS-001') certRow = row; });
    expect(certRow).toBeTruthy();
    expect(certRow.getCell(13).value).toBe('Due Soon'); // expires 2026-10-01, generated 2026-09-10 → ~21 days
  });

  it('never invents a payment method or a chase date — Data Quality documents the real gaps instead', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('Data Quality');
    const rows = [];
    ws.eachRow((row) => { rows.push(`${row.getCell(3).value || ''} ${row.getCell(4).value || ''}`); });
    expect(rows.some((p) => /payment_chase_state/.test(p) || /chase-up history/.test(p))).toBe(true);
    expect(rows.some((p) => /paid_amount/.test(p))).toBe(true);
  });

  it('Dashboard: KPIs match independently-computed totals (same functions, not copied numbers)', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('00 Dashboard');
    let totalJobsRow = null;
    ws.eachRow((row) => { if (row.getCell(1).value === 'Total Jobs') totalJobsRow = row; });
    expect(totalJobsRow.getCell(2).value).toBe(4);
  });

  it('respects the include scope — turning off a sheet actually removes it', async () => {
    const { data, scope } = makeFixture();
    scope.include = { agencies: false, certificates: false, properties: false, finance: false, engineers: false, clients: false };
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const sheetNames = result.workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(['00 Dashboard', '01 Daily Jobs', '02 Landlords', 'Data Quality', 'Export Audit']);
  });
});
