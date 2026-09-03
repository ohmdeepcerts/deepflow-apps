// Payment-reliability tests, written before extraction. Pins main.js's
// _paymentReliability behavior exactly.
import { describe, it, expect } from 'vitest';
import { paymentReliability } from '../../packages/business/payment-reliability.js';

const inv = (over) => ({ id: 'i1', items: [{ qty: 1, unit: 100 }], ...over });

describe('paymentReliability', () => {
  it('no client name: null', () => {
    expect(paymentReliability('', [], [])).toBe(null);
    expect(paymentReliability(null, [], [])).toBe(null);
  });

  it('no matching invoices for the client: null', () => {
    expect(paymentReliability('Nobody', [inv({ clientName: 'Someone Else' })], [])).toBe(null);
  });

  it('matches by clientName, landlordName, or agencyName', () => {
    expect(paymentReliability('Acme', [inv({ clientName: 'Acme' })], [])).not.toBe(null);
    expect(paymentReliability('Acme', [inv({ landlordName: 'Acme' })], [])).not.toBe(null);
    expect(paymentReliability('Acme', [inv({ agencyName: 'Acme' })], [])).not.toBe(null);
  });

  it('a zero-value invoice (no outstanding balance, nothing scored): label "New"', () => {
    const r = paymentReliability('Acme', [inv({ clientName: 'Acme', items: [{ qty: 1, unit: 0 }] })], []);
    expect(r.label).toBe('New');
    expect(r.color).toBe('var(--txt3)');
  });

  it('a client with an outstanding balance and no payments yet: "Awaiting first payment"', () => {
    const r = paymentReliability('Acme', [inv({ clientName: 'Acme', dueDate: '2099-01-01' })], []);
    expect(r.label).toBe('⏳ Awaiting first payment');
    expect(r.outstanding).toBe(100);
  });

  it('an invoice past its due date with an outstanding balance counts toward overdueCount and forces the "Overdue now" label regardless of payment history', () => {
    const r = paymentReliability('Acme', [inv({ clientName: 'Acme', dueDate: '2020-01-01' })], []);
    expect(r.overdueCount).toBe(1);
    expect(r.label).toBe('⚠️ Overdue now');
    expect(r.color).toBe('var(--red)');
  });

  it('a payment made on or before the due date counts as on-time', () => {
    const invoices = [inv({ id: 'i1', clientName: 'Acme', dueDate: '2026-06-15' })];
    const payments = [{ invId: 'i1', amount: 100, date: '2026-06-10' }];
    const r = paymentReliability('Acme', invoices, payments);
    expect(r.onTime).toBe(1);
    expect(r.late).toBe(0);
    expect(r.label).toBe('✅ Excellent');
  });

  it('a payment made after the due date counts as late, and avgDaysLate is computed from it', () => {
    const invoices = [inv({ id: 'i1', clientName: 'Acme', dueDate: '2026-06-01' })];
    const payments = [{ invId: 'i1', amount: 100, date: '2026-06-11' }];
    const r = paymentReliability('Acme', invoices, payments);
    expect(r.late).toBe(1);
    expect(r.onTime).toBe(0);
    expect(r.avgDaysLate).toBe(10);
  });

  it('on-time ratio >= 90%: "Excellent"; >= 60%: "Fair"; below 60%: "Poor"', () => {
    const mkPaidInvoice = (id, due) => inv({ id, clientName: 'Acme', dueDate: due });
    // 9 on-time, 1 late -> 90% on-time
    const invoices = Array.from({ length: 10 }, (_, i) => mkPaidInvoice('i' + i, '2026-06-15'));
    const payments = Array.from({ length: 9 }, (_, i) => ({ invId: 'i' + i, amount: 100, date: '2026-06-10' }))
      .concat([{ invId: 'i9', amount: 100, date: '2026-06-20' }]);
    const r = paymentReliability('Acme', invoices, payments);
    expect(r.label).toBe('✅ Excellent');
  });

  it('multiple payments on one invoice: only the latest payment date is compared to the due date', () => {
    const invoices = [inv({ id: 'i1', clientName: 'Acme', dueDate: '2026-06-01' })];
    const payments = [
      { invId: 'i1', amount: 50, date: '2026-05-20' },
      { invId: 'i1', amount: 50, date: '2026-06-15' },
    ];
    const r = paymentReliability('Acme', invoices, payments);
    expect(r.late).toBe(1);
    expect(r.onTime).toBe(0);
  });

  it('returns invoiceCount alongside the reliability stats', () => {
    const r = paymentReliability('Acme', [inv({ clientName: 'Acme' }), inv({ clientName: 'Acme' })], []);
    expect(r.invoiceCount).toBe(2);
  });
});
