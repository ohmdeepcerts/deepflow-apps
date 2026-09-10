// Tests for the Master Excel Export's business-definition layer
// (apps/office/export-model.js). Fixtures mirror the real shapes verified
// live against Supabase in docs/planning/25-excel-export-data-audit.md —
// not invented data.
import { describe, it, expect } from 'vitest';
import {
  computeInvoiceFinancials, certStatus, classifyJobWork, groupVisitsByJob,
  safeSheetName, findDuplicateProperties, jobsForAgency, jobsForPerson,
} from '../../apps/office/export-model.js';

const S = {
  vatEnabled: true, vatRate: 20,
  certTypes: [
    { id: 'ct1', name: 'Gas Safety', keywords: ['gas', 'boiler', 'heating', 'gas safety', 'gas check', 'gas service'] },
    { id: 'ct2', name: 'Electrical (EICR)', keywords: ['electrical', 'electric', 'eicr', 'rewire', 'fuse', 'consumer unit'] },
    { id: 'ct5', name: 'PAT Testing', keywords: ['pat', 'pat test', 'appliance test', 'portable appliance'] },
  ],
};

describe('computeInvoiceFinancials — real values only, never the dead stored columns', () => {
  it('computes total from items against the current VAT rate, ignoring stored total/subtotal/paid_amount', () => {
    const inv = { status: 'Awaiting Payment', items: [{ qty: 2, unit: 50, vat: true }], total: 999, subtotal: 999, paid_amount: 999 };
    const r = computeInvoiceFinancials(inv, S);
    expect(r.subtotal).toBe(100);
    expect(r.vat).toBe(20);
    expect(r.total).toBe(120);
    expect(r.paid).toBe(0);
    expect(r.outstanding).toBe(120);
  });

  it('a Paid invoice is fully paid with zero outstanding, regardless of the dead paid_amount column', () => {
    const inv = { status: 'Paid', items: [{ qty: 1, unit: 200, vat: true }], paid_amount: 0 };
    const r = computeInvoiceFinancials(inv, S);
    expect(r.paid).toBe(240);
    expect(r.outstanding).toBe(0);
  });

  it('flags days overdue only for an unpaid invoice past its due date', () => {
    const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const inv = { status: 'Awaiting Payment', items: [{ qty: 1, unit: 100, vat: false }], dueDate: past };
    const r = computeInvoiceFinancials(inv, S);
    expect(r.daysOverdue).toBeGreaterThanOrEqual(9);
  });

  it('a Paid invoice never shows overdue days even with a past due date', () => {
    const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    const inv = { status: 'Paid', items: [{ qty: 1, unit: 100, vat: false }], dueDate: past };
    expect(computeInvoiceFinancials(inv, S).daysOverdue).toBe(0);
  });
});

describe('certStatus — matches certs-stats-dashboard.js thresholds exactly', () => {
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  it('expired: expiry date already passed', () => { expect(certStatus({ expiryDate: days(-5) })).toBe('expired'); });
  it('expiring: within the due-soon window', () => { expect(certStatus({ expiryDate: days(30) })).toBe('expiring'); });
  it('current: beyond the due-soon window', () => { expect(certStatus({ expiryDate: days(120) })).toBe('current'); });
  it('missing: no expiry date and not flagged noExpiry', () => { expect(certStatus({ expiryDate: null })).toBe('missing'); });
  it('no_expiry: explicitly flagged as never expiring', () => { expect(certStatus({ expiryDate: null, noExpiry: true })).toBe('no_expiry'); });
  it('respects a custom due-soon window', () => { expect(certStatus({ expiryDate: days(45) }, 30)).toBe('current'); });
});

describe('classifyJobWork — real ambiguous cases from the live database', () => {
  it('cert-only: description matches only the matched cert type’s own keywords', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: 'EICR' }, S)).toBe('cert_only');
  });
  it('cert-only: multiple certs, no extra work text', () => {
    expect(classifyJobWork({ certTypes: ['ct2', 'ct1'], description: 'EICR, GAS' }, S)).toBe('cert_only');
  });
  it('additional_work: real DB example — fusebox replacement alongside an EICR', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: 'EICR, FUSEBOX REPLACE WITH SPD' }, S)).toBe('additional_work');
  });
  it('additional_work: real DB example — consumer unit supply and fit', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: 'Consumer unit supply and fit' }, S)).toBe('additional_work');
  });
  it('additional_work: real DB example — tripping investigation with socket replacement', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: 'ELECTRIC TRIPPING - INVESTIGATED AND FOUND THE KITCHEN RING CIRCUIT WAS DAMAGED, REPLACED 3XRUSTY SOCKETS' }, S)).toBe('additional_work');
  });
  it('cert_only: empty description but real certTypes present (documented as the one ambiguous-but-resolved case)', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: '' }, S)).toBe('cert_only');
  });
  it('needs_review: no certTypes and no description at all — nothing to go on', () => {
    expect(classifyJobWork({ certTypes: [], description: '' }, S)).toBe('needs_review');
  });
  it('needs_review: substantial text that matches neither cert keywords nor work keywords', () => {
    expect(classifyJobWork({ certTypes: ['ct2'], description: 'Tenant requested a callback about parking access' }, S)).toBe('needs_review');
  });
});

describe('groupVisitsByJob — "Project" = 2+ visits on the same job, no stored flag', () => {
  it('flags a job with 2+ visits as a project', () => {
    const visits = [{ jobId: 'j1' }, { jobId: 'j1' }, { jobId: 'j2' }];
    const { projectJobIds } = groupVisitsByJob(visits);
    expect(projectJobIds.has('j1')).toBe(true);
    expect(projectJobIds.has('j2')).toBe(false);
  });
});

describe('safeSheetName — deterministic, unique, Excel-safe', () => {
  it('strips invalid characters and enforces the 31-char limit', () => {
    const used = new Set();
    const name = safeSheetName('Wentworth: Estates/Ltd [Managed]?', used);
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[:\\/?*[\]]/);
  });
  it('produces a deterministic unique suffix on collision, never silently overwrites', () => {
    const used = new Set();
    const first = safeSheetName('Finefair', used);
    const second = safeSheetName('Finefair', used);
    expect(first).toBe('Finefair');
    expect(second).toBe('Finefair (2)');
    expect(first).not.toBe(second);
  });
});

describe('findDuplicateProperties — batch version of the app’s own interactive fuzzy check', () => {
  it('groups two differently-typed addresses at the same postcode as a likely duplicate', () => {
    const props = [
      { id: 'p1', address: '11 Sibley Grove, E12 6SD', postcode: 'E12 6SD' },
      { id: 'p2', address: '11 Sibley Grove London E12 6SD', postcode: 'E12 6SD' },
      { id: 'p3', address: '99 Totally Different Road, SW1 1AA', postcode: 'SW1 1AA' },
    ];
    const groups = findDuplicateProperties(props);
    expect(groups.length).toBe(1);
    expect(groups[0].map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });
  it('does not group genuinely unrelated addresses', () => {
    const props = [
      { id: 'p1', address: '1 Oak Road', postcode: 'M1 1AA' },
      { id: 'p2', address: '99 Elm Street', postcode: 'B1 1AA' },
    ];
    expect(findDuplicateProperties(props)).toEqual([]);
  });
});

describe('jobsForAgency / jobsForPerson — free-text name is primary, FK id supplementary', () => {
  it('matches an agency job by free-text agencyName even with no FK id set', () => {
    const jobs = [{ id: 'j1', agencyName: 'Finefair' }, { id: 'j2', agencyName: 'Other' }];
    expect(jobsForAgency(jobs, { id: 'a1', name: 'Finefair' })).toHaveLength(1);
  });
  it('matches a landlord job by free-text landlordName/referrer', () => {
    const jobs = [{ id: 'j1', referrer: 'John Doe' }, { id: 'j2', landlordName: 'John Doe' }, { id: 'j3', referrer: 'Someone Else' }];
    expect(jobsForPerson(jobs, { id: 'p1', name: 'John Doe' })).toHaveLength(2);
  });
});
