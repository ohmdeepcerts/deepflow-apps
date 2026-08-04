// dAll()'s read cache — added to close the "no shared cache for any table
// except jobs, 172 redundant fetch call sites" performance gap. The risk
// with any cache in a multi-user app with no Realtime subscription on most
// tables is staleness: these tests exist specifically to pin down that a
// write through the same repository instance always invalidates the cache
// (so a user's own change is never stale), and that the TTL genuinely
// expires rather than caching forever.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRepository } from '../../packages/data/repository.js';

describe('createRepository dAll() cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const sbFetch = vi.fn().mockResolvedValue([{ id: '1', name: 'A' }]);
    const repo = createRepository(sbFetch);
    return { repo, sbFetch };
  }

  it('serves the second dAll() for the same table from cache, no second fetch', async () => {
    const { repo, sbFetch } = setup();
    await repo.dAll('persons');
    await repo.dAll('persons');
    expect(sbFetch).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the TTL has elapsed', async () => {
    const { repo, sbFetch } = setup();
    await repo.dAll('persons');
    vi.advanceTimersByTime(30001);
    await repo.dAll('persons');
    expect(sbFetch).toHaveBeenCalledTimes(2);
  });

  it('dPut invalidates the cache so the next dAll() re-fetches', async () => {
    const { repo, sbFetch } = setup();
    await repo.dAll('persons');
    await repo.dPut('persons', { id: '2', name: 'B' });
    await repo.dAll('persons');
    // 1 dAll fetch + 1 dPut write + 1 dAll fetch after invalidation
    expect(sbFetch).toHaveBeenCalledTimes(3);
  });

  it('dDel invalidates the cache so the next dAll() re-fetches', async () => {
    const { repo, sbFetch } = setup();
    await repo.dAll('persons');
    await repo.dDel('persons', '1');
    await repo.dAll('persons');
    expect(sbFetch).toHaveBeenCalledTimes(3);
  });

  it('caching one table does not serve stale data for a different table', async () => {
    const { repo, sbFetch } = setup();
    await repo.dAll('persons');
    await repo.dAll('agencies');
    expect(sbFetch).toHaveBeenCalledTimes(2);
  });

  it('returns a fresh array each call — mutating the result cannot corrupt the cache', async () => {
    const { repo, sbFetch } = setup();
    const first = await repo.dAll('persons');
    first.push({ id: 'injected' });
    const second = await repo.dAll('persons');
    expect(second).toEqual([{ id: '1', name: 'A' }]);
  });

  it('never caches the settings pseudo-table', async () => {
    const { repo, sbFetch } = setup();
    expect(await repo.dAll('settings')).toEqual([]);
    expect(sbFetch).not.toHaveBeenCalled();
  });

  it('localTables bypass the network cache entirely (read straight from localStorage)', async () => {
    localStorage.clear();
    const sbFetch = vi.fn().mockResolvedValue([{ id: '1' }]);
    const repo = createRepository(sbFetch, { localTables: new Set(['drafts']) });
    localStorage.setItem('df_all_drafts', JSON.stringify([{ id: 'd1' }]));
    const rows = await repo.dAll('drafts');
    expect(rows).toEqual([{ id: 'd1' }]);
    expect(sbFetch).not.toHaveBeenCalled();
  });
});
