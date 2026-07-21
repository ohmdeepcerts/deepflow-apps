// Invoice line-item totals — the math shared, byte-for-byte, between the
// Office App's calcInvTotal() and Client Portal's calcTotal(). This is the
// genuinely-duplicated core; each app's VAT-rate *resolution* stays
// separate below because it was found (via the tests in
// tests/unit/business.test.js, written before this extraction) to
// genuinely diverge in one edge case — see officeVatRate/portalVatRate.
export function calcLineItemsTotal(items, vatRate) {
  let sub = 0, vat = 0;
  (items || []).forEach((i) => {
    const line = (i.qty || 1) * (i.unit || 0);
    sub += line;
    if (i.vat) vat += (line * vatRate) / 100;
  });
  return { sub, vat, grand: sub + vat };
}

// Office App's getVatRate(): S.vatRate||20 treats an explicit 0% as falsy
// and incorrectly falls back to 20%. This is the app's actual current
// behavior, preserved exactly — not fixed here (Phase 3 relocates logic,
// it doesn't change it; see tests/unit/business.test.js for the documented
// divergence this surfaced).
export function officeVatRate(S) {
  return S.vatEnabled !== false ? S.vatRate || 20 : 0;
}

// Client Portal's _portalVatRate(): vatRate??20 correctly treats an
// explicit 0% as a real rate. Kept as its own export, not merged into
// officeVatRate, because merging them would be a behavior change for
// whichever app didn't already have the "correct" version.
export function portalVatRate(S) {
  return S?.vatEnabled !== false ? (S?.vatRate ?? 20) : 0;
}
