// Fuzzy-match tests, written before extraction. Pins main.js's
// fuzzyScore/hlMatch behavior exactly (address autocomplete).
import { describe, it, expect } from 'vitest';
import { fuzzyScore, highlightMatch } from '../../packages/business/fuzzy-match.js';

describe('fuzzyScore', () => {
  it('a direct substring match scores a perfect 1', () => {
    expect(fuzzyScore('high st', '12 High Street')).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('HIGH', 'the high street')).toBe(1);
  });

  it('a partial subsequence match (not every query char found) scores between 0 and 1', () => {
    // "h" and "s" are both found in sequence in "high street", but "z" never is —
    // 2 of 3 query characters matched.
    const s = fuzzyScore('hsz', 'high street');
    expect(s).toBeCloseTo(2 / 3, 5);
  });

  it('every query character found as an in-order subsequence (not a substring) still scores a full 1', () => {
    // "hst" is a subsequence of "high street" (h...s...t) even though it never
    // appears as a contiguous substring — the scoring is purely count-based.
    expect(fuzzyScore('hst', 'high street')).toBe(1);
  });

  it('no matching characters at all scores 0', () => {
    expect(fuzzyScore('zzz', 'high street')).toBe(0);
  });

  it('an empty query scores 1 (vacuously matches, divides by max(0,1)=1 with 0 matched chars)', () => {
    expect(fuzzyScore('', 'anything')).toBe(1);
  });
});

describe('highlightMatch', () => {
  it('wraps the first case-insensitive occurrence of the query in a <span class="fmatch">', () => {
    expect(highlightMatch('12 High Street', 'high')).toBe('12 <span class="fmatch">High</span> Street');
  });

  it('preserves the original text\'s casing inside the highlighted span', () => {
    expect(highlightMatch('HIGH STREET', 'high')).toBe('<span class="fmatch">HIGH</span> STREET');
  });

  it('returns the original text unchanged when there is no match', () => {
    expect(highlightMatch('12 High Street', 'zzz')).toBe('12 High Street');
  });
});
