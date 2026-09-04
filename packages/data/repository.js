// Generic per-table repository (dGet/dAll/dPut/dDel) — the Office App's
// existing pattern, which was already the most complete of the three apps'
// data-access approaches (Employee App and Client Portal query their own
// sb() directly rather than through a repository layer; this is available
// for them to adopt later, not forced on them now).
//
// Takes the calling app's own fetch function as a parameter rather than
// importing one, because the three apps' fetch wrappers have real,
// deliberate behavioral differences (sync-state tracking, auth-token
// resolution) preserved from Phase 1 — this stays agnostic to that.
import { toDb, fromDb } from './mapping.js';

// dAll() read cache — every non-jobs table (persons, agencies, invoices,
// certs, etc.) had zero caching: each call re-fetched the entire table,
// and the same page routinely calls dAll() for the same table several
// times in quick succession (e.g. opening a job modal looks up the client
// in dAll('persons'), then the invoice preview looks it up again). jobs
// itself has its own dedicated windowed-loading path already (see the
// Jobs page's bounded rolling-window fetch) and is unaffected by this.
//
// Deliberately short TTL, not an indefinite cache: this is a multi-user
// app with no Realtime subscription on most tables, so an unbounded cache
// would mean one office session not seeing another's change until a full
// reload — a real staleness bug, not just a performance tradeoff. 30s caps
// that window to something short enough to be a non-issue in practice
// while still collapsing the common "several dAll() calls for the same
// table within one page render" pattern into a single fetch. Any write
// through this same repository instance (dPut/dDel) busts the cache for
// that table immediately, so a user never sees their own change go stale.
const CACHE_TTL_MS = 30000;

export function createRepository(sbFetch, { localTables = new Set(), uid } = {}) {
  const _cache = new Map(); // store -> { rows, ts }

  async function dGet(store, id) {
    if (localTables.has(store)) {
      const v = localStorage.getItem('df_' + store + '_' + id);
      return v ? JSON.parse(v) : undefined;
    }
    const r = await sbFetch(store + '?id=eq.' + encodeURIComponent(id) + '&limit=1');
    return r && r[0] ? fromDb(store, r[0]) : undefined;
  }

  async function dAll(store) {
    if (store === 'settings') return [];
    if (localTables.has(store)) {
      const v = localStorage.getItem('df_all_' + store);
      return v ? JSON.parse(v) : [];
    }
    const cached = _cache.get(store);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.rows.slice(); // copy — callers must not mutate the cached array
    }
    let allRows = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const chunk = (await sbFetch(store + `?limit=${limit}&offset=${offset}&order=created.desc&select=*`)) || [];
      if (chunk.length === 0) break;
      allRows = allRows.concat(chunk);
      if (chunk.length < limit) break;
      offset += limit;
      if (offset > 50000) {
        console.warn(`⚠️ Stopped fetching ${store} at 50k rows - implement proper filtering`);
        break;
      }
    }
    const mapped = allRows.map((r) => fromDb(store, r));
    // Don't cache a zero-row result. A genuinely empty table is cheap to
    // re-check next call; a WRONGLY empty result — e.g. the very first
    // request after login racing the JWT resolver and momentarily going out
    // as the anon key, which RLS silently filters to zero rows rather than
    // rejecting outright — is not an error dAll()'s caller can catch, so
    // caching it "successfully" for CACHE_TTL_MS previously froze real data
    // out of view for a full 30s (the actual cause of the office Dashboard
    // showing all-zero stats with no error on a fresh login/hard refresh
    // until something unrelated happened to outlast the cache window).
    if (mapped.length > 0) _cache.set(store, { rows: mapped, ts: Date.now() });
    return mapped.slice();
  }

  async function dPut(store, obj) {
    if (store === 'settings') {
      localStorage.setItem('df_setting_' + obj.key, JSON.stringify(obj.value));
      return;
    }
    if (localTables.has(store)) {
      const all = JSON.parse(localStorage.getItem('df_all_' + store) || '[]');
      const i = all.findIndex((x) => x.id === obj.id);
      i >= 0 ? (all[i] = obj) : all.push(obj);
      localStorage.setItem('df_all_' + store, JSON.stringify(all));
      return;
    }
    _cache.delete(store);
    await sbFetch(store, {
      method: 'POST',
      body: toDb(store, obj),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async function dDel(store, id) {
    if (store === 'settings') {
      localStorage.removeItem('df_setting_' + id);
      return;
    }
    if (localTables.has(store)) {
      const all = JSON.parse(localStorage.getItem('df_all_' + store) || '[]');
      localStorage.setItem('df_all_' + store, JSON.stringify(all.filter((x) => x.id !== id)));
      return;
    }
    _cache.delete(store);
    await sbFetch(store + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' });
  }

  return { dGet, dAll, dPut, dDel };
}
