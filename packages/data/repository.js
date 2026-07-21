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

export function createRepository(sbFetch, { localTables = new Set(), uid } = {}) {
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
    return allRows.map((r) => fromDb(store, r));
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
    await sbFetch(store + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', prefer: 'return=minimal' });
  }

  return { dGet, dAll, dPut, dDel };
}
