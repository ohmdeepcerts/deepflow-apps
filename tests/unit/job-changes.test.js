// getChangedFields tests, written before extraction. Pins main.js's
// realtime-sync field-diff behavior exactly — this drives whether the Jobs
// list in-place-patches a row or does nothing at all when a Supabase
// Realtime change event arrives.
import { describe, it, expect } from 'vitest';
import { getChangedFields } from '../../packages/business/job-changes.js';

describe('getChangedFields', () => {
  it('no prev or no curr: reports "all" changed', () => {
    expect(getChangedFields(null, { status: 'Pending' })).toEqual(['all']);
    expect(getChangedFields({ status: 'Pending' }, null)).toEqual(['all']);
    expect(getChangedFields(undefined, undefined)).toEqual(['all']);
  });

  it('no changes at all: empty array', () => {
    const job = { status: 'Pending', priority: 'Normal', date: '2026-01-01' };
    expect(getChangedFields(job, { ...job })).toEqual([]);
  });

  it('detects a single changed tracked field', () => {
    const prev = { status: 'Pending', priority: 'Normal' };
    const curr = { status: 'Completed', priority: 'Normal' };
    expect(getChangedFields(prev, curr)).toEqual(['status']);
  });

  it('detects multiple changed tracked fields at once', () => {
    const prev = { status: 'Pending', engineer: 'Bob', price: 100 };
    const curr = { status: 'Completed', engineer: 'Alice', price: 150 };
    expect(getChangedFields(prev, curr)).toEqual(['status', 'engineer', 'price']);
  });

  it('detects a same-day drag reorder via _sortOrder', () => {
    const prev = { _sortOrder: 1 };
    const curr = { _sortOrder: 2 };
    expect(getChangedFields(prev, curr)).toEqual(['_sortOrder']);
  });

  it('only compares the fixed known field list — an untracked field changing produces no diff entry', () => {
    const prev = { status: 'Pending', notes: 'old note' };
    const curr = { status: 'Pending', notes: 'new note' };
    expect(getChangedFields(prev, curr)).toEqual([]);
  });

  it('covers every tracked field: status, priority, date, engineer, timeSlot, address, price, description, jobNum, _sortOrder', () => {
    const prev = { status: 'a', priority: 'a', date: 'a', engineer: 'a', timeSlot: 'a', address: 'a', price: 1, description: 'a', jobNum: 'a', _sortOrder: 1 };
    const curr = { status: 'b', priority: 'b', date: 'b', engineer: 'b', timeSlot: 'b', address: 'b', price: 2, description: 'b', jobNum: 'b', _sortOrder: 2 };
    expect(getChangedFields(prev, curr)).toEqual(['status','priority','date','engineer','timeSlot','address','price','description','jobNum','_sortOrder']);
  });
});
