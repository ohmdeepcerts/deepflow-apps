// Client credit-rating tests, written before extraction. Pins main.js's
// _clientStarsFromInvoices behavior exactly — the same star-threshold math
// showClientCreditCheck (main.js:13572) independently reimplemented; both
// call sites now share this one function (verified byte-for-byte identical
// logic before consolidating — see the Phase 5a plan).
import { describe, it, expect } from 'vitest';
import { STATUS } from '../../packages/business/status.js';
import { clientCreditRating } from '../../packages/business/client-rating.js';

const inv = (over) => ({ status: 'Awaiting Payment', dueDate: null, items: [{ qty: 1, unit: 100 }], ...over });

describe('clientCreditRating', () => {
  it('no invoices at all: null', () => {
    expect(clientCreditRating([])).toBe(null);
    expect(clientCreditRating(null)).toBe(null);
  });

  it('no overdue, no unpaid: full 5 stars, LOW RISK', () => {
    const r = clientCreditRating([inv({ status: 'Paid' })]);
    expect(r.stars).toBe(5);
    expect(r.risk).toBe('LOW RISK');
    expect(r.color).toBe('#25d58e');
  });

  it('1-3 overdue (not very overdue): -1 star', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
    const r = clientCreditRating([inv({ dueDate: yesterday })]);
    expect(r.stars).toBe(4);
  });

  it('more than 3 overdue (not very overdue): -2 stars for the count tier, -1 more from the amount tier (unavoidable when every invoice is unpaid — unpaidAmt/avg equals the invoice count)', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const invs = [1, 2, 3, 4].map(() => inv({ dueDate: yesterday }));
    const r = clientCreditRating(invs);
    expect(r.stars).toBe(2);
  });

  it('1-3 very-overdue (>60 days): -2 stars, overrides the not-very-overdue tier', () => {
    const longAgo = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    const r = clientCreditRating([inv({ dueDate: longAgo })]);
    expect(r.stars).toBe(3);
  });

  it('more than 3 very-overdue: -3 stars for the count tier (worst tier), -1 more from the amount tier for the same structural reason as above', () => {
    const longAgo = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    const invs = [1, 2, 3, 4].map(() => inv({ dueDate: longAgo }));
    const r = clientCreditRating(invs);
    expect(r.stars).toBe(1);
    expect(r.risk).toBe('HIGH RISK');
  });

  it('unpaid amount over 5x the average invoice: -2 stars (stacks with the paid-history +1 bonus below)', () => {
    // 10 paid invoices at £1 each pull the average down to ~£91.8; one £1000
    // unpaid invoice is well over 5x that average (£459), crossing the tier.
    const paidInvs = Array.from({ length: 10 }, () => inv({ status: 'Paid', items: [{ qty: 1, unit: 1 }] }));
    const invs = [...paidInvs, inv({ items: [{ qty: 1, unit: 1000 }] })];
    const r = clientCreditRating(invs);
    expect(r.unpaidAmt).toBe(1000);
    // -2 for the amount tier, +1 for paid(10) > unpaid(1) && paid>3 = net 4
    expect(r.stars).toBe(4);
  });

  it('unpaid amount over 3x but under 5x the average: -1 star, no bonus (only 3 paid, needs >3)', () => {
    // 3 paid invoices at £0.01 pull the average to ~£25; a £100 unpaid
    // invoice is ~4x that average — between the 3x (£75.02) and 5x (£125.04)
    // thresholds exactly.
    const paidInvs = Array.from({ length: 3 }, () => inv({ status: 'Paid', items: [{ qty: 1, unit: 0.01 }] }));
    const invs = [...paidInvs, inv({ items: [{ qty: 1, unit: 100 }] })];
    const r = clientCreditRating(invs);
    expect(r.unpaidAmt).toBe(100);
    expect(r.stars).toBe(4);
  });

  it('paid count exceeds unpaid count and paid > 3: +1 star bonus, clamped at 5', () => {
    const invs = [1, 2, 3, 4].map(() => inv({ status: 'Paid' }));
    const r = clientCreditRating(invs);
    expect(r.stars).toBe(5); // already 5, bonus clamps rather than exceeding
  });

  it('stars are always clamped to the 1-5 range', () => {
    const longAgo = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    const invs = [1, 2, 3, 4, 5].map(() => inv({ dueDate: longAgo, items: [{ qty: 1, unit: 100000 }] }));
    const r = clientCreditRating(invs);
    expect(r.stars).toBeGreaterThanOrEqual(1);
    expect(r.stars).toBeLessThanOrEqual(5);
  });

  it('cancelled invoices are excluded from the unpaid/overdue pool', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = clientCreditRating([inv({ status: STATUS.CANCELLED, dueDate: yesterday })]);
    expect(r.stars).toBe(5);
    expect(r.overdue).toBe(0);
  });

  it('returns invCount/paid/overdue/unpaidAmt alongside stars/color/risk', () => {
    const r = clientCreditRating([inv({ status: 'Paid' }), inv()]);
    expect(r).toMatchObject({ invCount: 2, paid: 1, overdue: 0 });
    expect(typeof r.unpaidAmt).toBe('number');
  });
});
