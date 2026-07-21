// Pure round-trip tests for the unified field mapping (packages/data) — no
// network needed. This is the permanent, automated version of the manual
// check that found the Credit Note and auto-invoice bugs earlier in this
// engagement: does every field the app writes actually have a real column
// to land in, and does reading it back reconstruct the same object?
import { describe, it, expect } from 'vitest';
import { TO_DB, FROM_DB, toDb, fromDb } from '../../packages/data/mapping.js';

describe('field mapping round-trips', () => {
  for (const table of Object.keys(TO_DB)) {
    it(`${table}: toDb → fromDb reconstructs the original object`, () => {
      const sample = {};
      for (const jsKey of Object.keys(TO_DB[table])) sample[jsKey] = `value-${jsKey}`;
      const dbShape = toDb(table, sample);
      const roundTripped = fromDb(table, dbShape);
      expect(roundTripped).toEqual(sample);
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
});
