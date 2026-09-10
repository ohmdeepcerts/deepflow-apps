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
};

function makeFixture() {
  const jobs = [
    { id: 'j1', jobNum: 'JOB-0001', date: '2026-09-10', engineer: 'Jawad', status: 'Invoiced', address: '1 Test Street', postcode: 'E1 1AA', referrer: 'John Doe', trade: 'Electrical', description: 'EICR', certTypes: ['ct2'], price: 150, invNumber: 'INV-1', created: 1000, modified: 2000 },
    { id: 'j2', jobNum: 'JOB-0002', date: '2026-09-10', engineer: 'Jawad', status: 'Completed', address: '2 Test Street', postcode: 'E1 1AB', referrer: 'John Doe', trade: 'Electrical', description: 'Consumer unit supply and fit', certTypes: ['ct2'], price: 400, created: 1000, modified: 2000 },
    { id: 'j3', jobNum: 'JOB-0003', date: '', engineer: '', status: 'Pending', address: '3 Test Street', postcode: '', referrer: '', trade: '', description: '', certTypes: [], price: 0, created: 1000, modified: 2000 },
  ];
  const invoices = [
    { id: 'i1', number: 'INV-1', jobId: 'j1', status: 'Paid', items: [{ qty: 1, unit: 150, vat: true }] },
  ];
  return {
    data: {
      jobs, invoices, certs: [], properties: [], persons: [], agencies: [], agents: [], payments: [], visits: [],
      snapshot: { generatedAt: new Date('2026-09-10T12:45:00Z') },
      counts: { jobs: 3, invoices: 1, certs: 0, properties: 0, persons: 0, agencies: 0, agents: 0, payments: 0, job_visits: 0 },
    },
    scope: {
      dateRange: resolveDateRange('all'),
      include: { dailyJobs: true, dataQuality: true },
    },
  };
}

describe('buildWorkbook — golden dataset', () => {
  it('produces a workbook with the expected sheets, reconciles cleanly, and colours rows by real classification', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });

    expect(result.allMatch).toBe(true);
    expect(result.reconciliation.every((r) => r.queried === r.exported)).toBe(true);

    const sheetNames = result.workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(['01 Daily Jobs', 'Data Quality', 'Export Audit']);

    // Re-serialize and re-read, like a real download would be opened —
    // proves the buffer round-trips as a real, valid .xlsx, not just an
    // in-memory object graph.
    const buffer = await result.workbook.xlsx.writeBuffer();
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(buffer);
    expect(reread.worksheets.map((ws) => ws.name)).toEqual(sheetNames);
  });

  it('colours the cert-only job green and the additional-work job red on Daily Jobs', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('01 Daily Jobs');

    let job1Row = null, job2Row = null, job3Found = false;
    ws.eachRow((row) => {
      const jobNum = row.getCell(3).value;
      if (jobNum === 'JOB-0001') job1Row = row;
      if (jobNum === 'JOB-0002') job2Row = row;
      if (jobNum === 'JOB-0003') job3Found = true;
    });

    expect(job1Row).not.toBeNull();
    expect(job2Row).not.toBeNull();
    // job3 (no date, no certTypes, no description) must still appear
    // somewhere — never silently dropped for lacking a date.
    expect(job3Found).toBe(true);

    const argb = (row) => row.getCell(3).fill.fgColor.argb;
    expect(argb(job1Row)).toBe('FFD7F5E3'); // green — certificate-only
    expect(argb(job2Row)).toBe('FFFBE0E0'); // red — additional work
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

  it('flags job j3 (no certTypes, no description) as needing review, not a guessed colour', async () => {
    const { data, scope } = makeFixture();
    const result = await buildWorkbook({ data, S, scope, requestedBy: 'Test User' });
    const ws = result.workbook.getWorksheet('01 Daily Jobs');
    let job3Row = null;
    ws.eachRow((row) => { if (row.getCell(3).value === 'JOB-0003') job3Row = row; });
    expect(job3Row.getCell(3).fill.fgColor.argb).toBe('FFECEEF1'); // grey — needs review
  });
});
