// Pure round-trip tests for the unified field mapping (packages/data) — no
// network needed. This is the permanent, automated version of the manual
// check that found the Credit Note and auto-invoice bugs earlier in this
// engagement: does every field the app writes actually have a real column
// to land in, and does reading it back reconstruct the same object?
import { describe, it, expect } from 'vitest';
import { TO_DB, FROM_DB, toDb, fromDb } from '../../packages/data/mapping.js';

// fromDb() deliberately coerces these fields from the JSON string
// PostgREST serializes a Postgres `numeric` column as (see mapping.js's
// own comment on NUMERIC_FIELDS) into a real JS number — a round-trip
// test using an opaque placeholder string like every other field would
// get here can't survive that on purpose, so these use a realistic
// numeric-looking value and expect a number back instead.
const NUMERIC_SAMPLE_OVERRIDES = {
  invoices: { vatAmount: { in: '12.50', out: 12.5 } },
};

describe('field mapping round-trips', () => {
  for (const table of Object.keys(TO_DB)) {
    it(`${table}: toDb → fromDb reconstructs the original object`, () => {
      const overrides = NUMERIC_SAMPLE_OVERRIDES[table] || {};
      const sample = {};
      const expected = {};
      for (const jsKey of Object.keys(TO_DB[table])) {
        const override = overrides[jsKey];
        sample[jsKey] = override ? override.in : `value-${jsKey}`;
        expected[jsKey] = override ? override.out : sample[jsKey];
      }
      const dbShape = toDb(table, sample);
      const roundTripped = fromDb(table, dbShape);
      expect(roundTripped).toEqual(expected);
    });

    it(`${table}: every DB-side column name is unique (no two JS fields collide)`, () => {
      const dbNames = Object.values(TO_DB[table]);
      expect(new Set(dbNames).size).toBe(dbNames.length);
    });
  }

  it('unmapped tables pass objects through unchanged', () => {
    const obj = { foo: 'bar', baz: 1 };
    expect(toDb('not_a_real_table', obj)).toEqual(obj);
    expect(fromDb('not_a_real_table', obj)).toEqual(obj);
  });

  it('FROM_DB is the exact inverse of TO_DB for every table', () => {
    for (const [table, map] of Object.entries(TO_DB)) {
      for (const [jsKey, dbKey] of Object.entries(map)) {
        expect(FROM_DB[table][dbKey]).toBe(jsKey);
      }
    }
  });

  // Regression test for the actual bug this coercion exists to fix:
  // PostgREST serializes a `numeric` column as a JSON string, so summing
  // payment rows straight off the wire with `+` silently concatenates
  // instead of adding — "0" + "30.00" + "30.00" is the string
  // "030.0030.00", and Number() of that is NaN. A single payment happens
  // to survive by accident (one string, parses fine); this only shows up
  // once a second payment is recorded against the same invoice, which is
  // exactly the case that reached production before this fix.
  it('payments.amount arrives numeric, so a two-payment total actually adds up', () => {
    const p1 = fromDb('payments', { id: 'a', inv_id: 'inv1', amount: '30.00' });
    const p2 = fromDb('payments', { id: 'b', inv_id: 'inv1', amount: '30.00' });
    expect(typeof p1.amount).toBe('number');
    const totalPaid = [p1, p2].reduce((s, p) => s + p.amount, 0);
    expect(totalPaid).toBe(60);
  });

  // Same bug, same fix, two more real (not hypothetical) call sites found
  // by cross-checking every numeric-typed column in the live schema
  // against fromDb()'s NUMERIC_FIELDS: apps/office/main.js's dashboard
  // revenue chart summed jobs.price with `+`, and apps/office/expenses.js
  // summed expenses.cost with `+` — both silently wrong on any day/list
  // with more than one item, for the identical reason as payments.amount.
  it('jobs.price arrives numeric, so a multi-job revenue total actually adds up', () => {
    const j1 = fromDb('jobs', { id: 'a', price: '150.00' });
    const j2 = fromDb('jobs', { id: 'b', price: '200.00' });
    expect(typeof j1.price).toBe('number');
    const dayRevenue = [j1, j2].reduce((s, j) => s + j.price, 0);
    expect(dayRevenue).toBe(350);
  });

  it('expenses.cost arrives numeric, so a multi-expense total actually adds up', () => {
    const e1 = fromDb('expenses', { id: 'a', cost: '12.50' });
    const e2 = fromDb('expenses', { id: 'b', cost: '7.25' });
    expect(typeof e1.cost).toBe('number');
    const totalCost = [e1, e2].reduce((s, e) => s + e.cost, 0);
    expect(totalCost).toBe(19.75);
  });
});
