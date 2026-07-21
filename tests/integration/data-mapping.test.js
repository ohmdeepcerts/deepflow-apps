// Verifies every DB-side column name in the unified mapping (packages/data)
// actually exists in the live schema — the permanent, automated version of
// the manual SQL check done before this mapping was unified. Uses only the
// public anon key (the same one already embedded in all three apps; no new
// secret) via PostgREST's own column validation: a `select=col1,col2` query
// returns 400 with a clear "column does not exist" error if any requested
// column is wrong, regardless of RLS (RLS decides which *rows* come back,
// not whether the column list itself is valid) — confirmed directly against
// the live project before writing this test.
import { describe, it, expect } from 'vitest';
import { TO_DB } from '../../packages/data/mapping.js';
import { SB_URL, SB_KEY } from '../../packages/core/supabase.js';

describe('field mapping matches the live schema', () => {
  for (const [table, map] of Object.entries(TO_DB)) {
    const columns = Object.values(map);
    if (columns.length === 0) continue;

    it(`${table}: every mapped column exists`, async () => {
      const res = await fetch(
        `${SB_URL}/rest/v1/${table}?select=${columns.join(',')}&limit=1`,
        { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${table}: ${body.message || res.status} (columns: ${columns.join(', ')})`);
      }
      expect(res.ok).toBe(true);
    });
  }
});
