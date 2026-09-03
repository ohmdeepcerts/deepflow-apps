// Property-derivation tests, written before extraction (same "relocate,
// don't change" rule as tests/unit/business.test.js). Pins main.js's
// current _normAddr/_deriveProperties behavior exactly.
import { describe, it, expect } from 'vitest';
import { normAddr, deriveProperties } from '../../packages/business/job-properties.js';

describe('normAddr', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normAddr('  12 High Street  ')).toBe('12 high street');
  });

  it('strips commas and periods, then collapses the resulting double space', () => {
    expect(normAddr('12 High St., London')).toBe('12 high st london');
  });

  it('handles empty/missing input', () => {
    expect(normAddr('')).toBe('');
    expect(normAddr(undefined)).toBe('');
  });
});

describe('deriveProperties', () => {
  it('groups jobs by normalized address into one property each', () => {
    const jobs = [
      { address: '12 High Street', date: '2026-01-01' },
      { address: '12 High Street.', date: '2026-02-01' },
      { address: '5 Low Road', date: '2026-01-05' },
    ];
    const props = deriveProperties(jobs, []);
    expect(props.length).toBe(2);
  });

  it('skips jobs with no address', () => {
    const jobs = [{ date: '2026-01-01' }, { address: '5 Low Road', date: '2026-01-05' }];
    expect(deriveProperties(jobs, []).length).toBe(1);
  });

  it('a manual property with no matching job still appears, marked not-auto', () => {
    const manual = [{ id: 'm1', address: '99 Manual Ave' }];
    const props = deriveProperties([], manual);
    expect(props.length).toBe(1);
    expect(props[0]._isAuto).toBe(false);
    expect(props[0].id).toBe('m1');
  });

  it('an auto-derived property (no manual record) is marked _isAuto true, with a generated id', () => {
    const props = deriveProperties([{ address: '5 Low Road', date: '2026-01-05' }], []);
    expect(props[0]._isAuto).toBe(true);
    expect(props[0].id).toMatch(/^auto_/);
  });

  it('landlord history and agency history are tracked separately, most-recent-date first', () => {
    const jobs = [
      { address: '1 A St', date: '2026-01-01', landlordName: 'Old Landlord' },
      { address: '1 A St', date: '2026-06-01', landlordName: 'New Landlord' },
      { address: '1 A St', date: '2026-03-01', agencyName: 'Some Agency' },
    ];
    const [prop] = deriveProperties(jobs, []);
    expect(prop.landlordHistory).toEqual(['New Landlord', 'Old Landlord']);
    expect(prop.agencyHistory).toEqual(['Some Agency']);
    expect(prop.landlord).toBe('New Landlord');
    expect(prop.agency).toBe('Some Agency');
  });

  it('when there is no landlord history at all, landlord falls back to the most recent agency', () => {
    const jobs = [{ address: '1 A St', date: '2026-01-01', agencyName: 'Only Agency' }];
    const [prop] = deriveProperties(jobs, []);
    expect(prop.landlord).toBe('Only Agency');
  });

  it('a manual record\'s own address/landlord/postcode/notes override the auto-derived ones', () => {
    const jobs = [{ address: '1 A St', date: '2026-01-01', landlordName: 'Auto Landlord', postcode: 'AA1 1AA' }];
    const manual = [{ address: '1 A St', landlord: 'Manual Landlord', postcode: 'BB2 2BB', notes: 'manual note' }];
    const [prop] = deriveProperties(jobs, manual);
    expect(prop.landlord).toBe('Manual Landlord');
    expect(prop.postcode).toBe('BB2 2BB');
    expect(prop.notes).toBe('manual note');
    expect(prop._isAuto).toBe(false);
  });

  it('falls back to the postcode of the first job at the address that has one', () => {
    const jobs = [
      { address: '1 A St', date: '2026-01-01' },
      { address: '1 A St', date: '2026-02-01', postcode: 'CC3 3CC' },
    ];
    const [prop] = deriveProperties(jobs, []);
    expect(prop.postcode).toBe('CC3 3CC');
  });

  it('results are sorted alphabetically by address', () => {
    const jobs = [
      { address: 'Zebra Close', date: '2026-01-01' },
      { address: 'Apple Road', date: '2026-01-01' },
    ];
    const props = deriveProperties(jobs, []);
    expect(props.map(p => p.address)).toEqual(['Apple Road', 'Zebra Close']);
  });
});
