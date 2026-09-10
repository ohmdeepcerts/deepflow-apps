// Master Excel Export — data gathering layer. This is the ONLY place the
// export reads from the database: every table is fetched exactly once via
// dAll() (which itself paginates through the complete table, never the
// visible DOM/current search/current page — see packages/data/repository.js),
// so every sheet builder downstream works from the same single snapshot.
// This is what the spec's "consistent data snapshot" requirement means in
// practice: one gather pass, one Date.now() stamp, everything built from it.

// Tables queried for every export, regardless of scope — small/reference
// tables the sheets need for name-matching and settings context.
const CORE_TABLES = ['jobs', 'invoices', 'persons', 'agencies', 'agents', 'certs', 'properties', 'payments', 'job_visits'];

export async function gatherExportData(dAll, onProgress) {
  const snapshot = { generatedAt: new Date() };
  const data = {};
  const counts = {};
  for (const table of CORE_TABLES) {
    if (onProgress) onProgress(table, 'loading');
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential so
    // progress reporting reflects real stages, not a Promise.all blur; each
    // dAll() call is itself already a full paginated fetch of that table.
    const rows = await dAll(table);
    data[table] = rows;
    counts[table] = rows.length;
    if (onProgress) onProgress(table, 'done', rows.length);
  }
  return { ...data, counts, snapshot };
}

// ── Date-range scoping ───────────────────────────────────────────────────
// Only the Daily Jobs sheet is actually date-filtered — every financial
// rollup sheet (Landlords/Agencies/Outstanding/Dashboard) deliberately
// stays all-time regardless of the selected range, per the audit doc's
// explicit caution against producing a mathematically misleading balance
// by silently excluding invoices/payments outside the window. Each of
// those sheets labels itself "All-Time" so this is never ambiguous to the
// reader.
export function resolveDateRange(mode, customFrom, customTo, todayStr) {
  const today = new Date(todayStr || new Date().toISOString().slice(0, 10));
  const iso = (d) => d.toISOString().slice(0, 10);
  if (mode === 'today') return { from: iso(today), to: iso(today), label: 'Today' };
  if (mode === 'week') {
    const day = today.getDay() === 0 ? 7 : today.getDay(); // Monday-start week
    const monday = new Date(today); monday.setDate(today.getDate() - (day - 1));
    return { from: iso(monday), to: iso(today), label: 'This Week' };
  }
  if (mode === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: iso(first), to: iso(today), label: 'This Month' };
  }
  if (mode === 'custom') {
    if (!customFrom || !customTo) throw new Error('Custom date range requires both a From and To date');
    return { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` };
  }
  return { from: null, to: null, label: 'ALL AVAILABLE DATA' };
}

export function filterJobsByDateRange(jobs, range) {
  if (!range.from || !range.to) return jobs;
  return jobs.filter((j) => j.date && j.date >= range.from && j.date <= range.to);
}
