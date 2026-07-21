// Business-rule tests, written before extraction (per
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 4/5 — "this phase relocates
// logic; it does not change it"). These prove today's actual behavior,
// including a real, previously-undiscovered divergence between the Office
// App and Client Portal's VAT-rate resolution (see the last describe
// block) — found while comparing the two apps' otherwise-identical
// invoice-total math before unifying the shared part of it.
import { describe, it, expect } from 'vitest';
import { STATUS } from '../../packages/business/status.js';
import { calcLineItemsTotal } from '../../packages/business/invoice-total.js';

describe('STATUS', () => {
  it('has the six values both the Office App and Employee App relied on independently before this extraction', () => {
    expect(STATUS).toEqual({
      PENDING: 'Pending',
      IN_PROGRESS: 'In Progress',
      COMPLETED: 'Completed',
      INVOICED: 'Invoiced',
      CANNOT_ACCESS: 'Cannot Access',
      CANCELLED: 'Cancelled',
    });
  });

  it('is frozen — a call site can never silently mutate a shared enum value', () => {
    expect(Object.isFrozen(STATUS)).toBe(true);
  });
});

describe('calcLineItemsTotal — the math shared by calcInvTotal (Office App) and calcTotal (Client Portal)', () => {
  it('sums non-VAT line items with no VAT added', () => {
    const items = [{ qty: 2, unit: 50 }, { qty: 1, unit: 25 }];
    expect(calcLineItemsTotal(items, 20)).toEqual({ sub: 125, vat: 0, grand: 125 });
  });

  it('adds VAT only to items flagged vat:true, at the given rate', () => {
    const items = [
      { qty: 1, unit: 100, vat: true },
      { qty: 1, unit: 50, vat: false },
    ];
    expect(calcLineItemsTotal(items, 20)).toEqual({ sub: 150, vat: 20, grand: 170 });
  });

  it('defaults a missing qty to 1 and a missing unit to 0', () => {
    expect(calcLineItemsTotal([{ vat: true }], 20)).toEqual({ sub: 0, vat: 0, grand: 0 });
  });

  it('handles an empty or missing item list', () => {
    expect(calcLineItemsTotal([], 20)).toEqual({ sub: 0, vat: 0, grand: 0 });
    expect(calcLineItemsTotal(undefined, 20)).toEqual({ sub: 0, vat: 0, grand: 0 });
  });

  it('a 0% VAT rate produces zero VAT even on vat:true items', () => {
    expect(calcLineItemsTotal([{ qty: 1, unit: 100, vat: true }], 0)).toEqual({ sub: 100, vat: 0, grand: 100 });
  });
});

describe('VAT rate resolution — documented pre-existing divergence between apps (not changed by this extraction)', () => {
  // Office App: getVatRate() = (S.vatEnabled!==false) ? (S.vatRate||20) : 0
  function officeVatRate(S) { return (S.vatEnabled !== false) ? (S.vatRate || 20) : 0; }
  // Client Portal: _portalVatRate() = (_S?.vatEnabled!==false) ? (_S?.vatRate??20) : 0
  function portalVatRate(S) { return (S?.vatEnabled !== false) ? (S?.vatRate ?? 20) : 0; }

  it('both apps agree when VAT rate is unset (fall back to 20%)', () => {
    expect(officeVatRate({})).toBe(20);
    expect(portalVatRate({})).toBe(20);
  });

  it('both apps agree when VAT is disabled (0%, regardless of a configured rate)', () => {
    expect(officeVatRate({ vatEnabled: false, vatRate: 5 })).toBe(0);
    expect(portalVatRate({ vatEnabled: false, vatRate: 5 })).toBe(0);
  });

  it('DIVERGE: an explicit 0% rate with VAT enabled — Office App incorrectly falls back to 20%, Client Portal correctly shows 0%', () => {
    // `||` treats 0 as falsy (Office App); `??` only falls back on null/undefined (Client Portal).
    // A real, previously-undiscovered latent bug, found by comparing the two apps' logic
    // directly before unifying the shared math — flagged, not silently fixed here, per
    // the "relocate, don't change" rule for this phase.
    expect(officeVatRate({ vatEnabled: true, vatRate: 0 })).toBe(20); // wrong, but existing behavior
    expect(portalVatRate({ vatEnabled: true, vatRate: 0 })).toBe(0); // correct
  });
});
