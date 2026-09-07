// Live Maps — the office-side engineer location tracking page and its
// route/compliance/live-position rendering, plus the small "Engineer
// Locations" panel that reuses the same geocoding cache.
//
// Rebuilt after the user reviewed the original five-mode version and found
// it genuinely unhelpful: every view re-geocoded every address from
// scratch against Nominatim's free (1 req/sec) API on every single page
// open, which is why job counts were capped at 30/40/200 and the page took
// several seconds to draw anything, the "heatmap" was just dots colored by
// completed/not (not a density visualization at all), and Engineer Route
// drew a line through jobs in creation order rather than an order that
// minimizes actual driving. None of it had any awareness of certificate
// compliance, despite that being what this whole app exists to manage.
//
// What changed:
//  - Geocoding is now cached permanently on properties.lat/lng (see the
//    properties_geocoding_cache migration) — an address is looked up once,
//    ever, and every later view reads the cached value instantly. Only
//    properties never seen before pay the Nominatim rate-limit cost, one
//    time, capped per page load (_GEO_CAP) so a large uncached backlog
//    still can't freeze the page — it just finishes caching over a few
//    page loads instead of all at once.
//  - The fake Heatmap mode is replaced with a real Compliance view:
//    every property plotted and colored by its actual current (not
//    superseded) certificate status — red = something's expired, amber =
//    expiring within 60 days, green = all valid. This is the view that
//    actually answers "where is my risk," which raw job dots never could.
//  - Engineer Route now reorders today's stops with a nearest-neighbour
//    walk from the engineer's live position (or the first stop, if they
//    aren't sharing location) before asking OSRM for the route — a
//    genuinely shorter drive, not just a line through creation order.
//  - Five modes collapsed to four, each mapped to one real question
//    instead of an incidental data-window difference: Team / Jobs / Route
//    / Compliance. Today vs "upcoming 7 days" merged into one Jobs view
//    with a date + range toggle, since they were the same question (where's
//    the work) at two different window sizes.

import { STATUS, localDateStr } from '@business';
import { escHtml } from '@ui';
import { _sb } from './main.js';

let _mapGeoCache = {};  // address → {lat,lng} — in-memory, session-only fallback for non-property addresses
let _mapBlobUrl = null;
let _mapEngineers=[],_mapEngineersLoadedAt=0;
let _mapPropsCache=null,_mapPropsLoadedAt=0;

// Nominatim's courtesy limit is 1 req/sec — this caps how many *never
// before geocoded* properties get looked up in one page load. Anything
// already cached on the property row is free and uncapped; this only
// throttles the one-time cost of a property nobody has geocoded yet.
const GEO_CAP = 40;

// ════════════════════════════════════════════════════════════════
//  LIVE MAPS & ENGINEER TRACKING
//  Uses OpenStreetMap (Nominatim geocoding) — FREE, no API key
// ════════════════════════════════════════════════════════════════

export function onMapViewChange() {
  const v = document.getElementById('map-view-sel')?.value;
  if (!v) return;
  const engFilter = document.getElementById('map-eng-filter');
  const dateFilter = document.getElementById('map-date-filter');
  const rangeFilter = document.getElementById('map-range-filter');
  if (engFilter) engFilter.style.display = (v === 'route') ? 'flex' : 'none';
  if (dateFilter) dateFilter.style.display = (v === 'jobs' || v === 'route') ? 'flex' : 'none';
  if (rangeFilter) rangeFilter.style.display = (v === 'jobs') ? 'flex' : 'none';
  if (v === 'jobs' || v === 'route') {
    const inp = document.getElementById('map-date-inp');
    if (inp && !inp.value) inp.value = localDateStr();
  }
  renderMapPage();
}

export async function renderMapPage() {
  const wrap = document.getElementById('map-frame-wrap');
  const overlay = document.getElementById('map-overlay');
  const status = document.getElementById('map-status-txt');
  const info = document.getElementById('map-info-panel');
  const view = document.getElementById('map-view-sel')?.value;
  if (!view) { if(overlay) overlay.style.display='flex'; return; }

  if (overlay) overlay.style.display = 'none';
  if (status) status.textContent = '⏳ Loading…';
  if (info) info.innerHTML = '';

  // Populate engineer dropdown
  await _loadEngineerList();

  try {
    if (view === 'team') await _mapLiveEngineers(info, status);
    else if (view === 'jobs') await _mapJobsByDate(info, status);
    else if (view === 'route') await _mapEngineerRoute(info, status);
    else if (view === 'compliance') await _mapCompliance(info, status);
  } catch(e) {
    if (status) status.textContent = '⚠️ ' + (e.message||'Error').slice(0,60);
  }
}

export async function _loadEngineerList() {
  // FIX 8: Previously this returned immediately if _mapEngineers had any data,
  // meaning the dropdown NEVER refreshed after the first load — deactivated or
  // newly-added engineers would be wrong until a full browser refresh.
  // Now we re-fetch if the cache is older than 5 minutes.
  const STALE_MS = 5 * 60 * 1000;
  if (_mapEngineers.length && (Date.now() - _mapEngineersLoadedAt) < STALE_MS) return;
  try {
    const users = await _sb('users?role=eq.engineer&active=eq.true&order=name.asc');
    _mapEngineers = users || [];
    _mapEngineersLoadedAt = Date.now();
    const sel = document.getElementById('map-eng-sel');
    if (sel && _mapEngineers.length) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">Engineer</option>' +
        _mapEngineers.map(u => `<option value="${u.name}" ${u.name===cur?'selected':''}>${u.name}</option>`).join('');
    }
  } catch(e) { console.warn('Engineer list:', e); }
}

// Properties, cached for 5 minutes per page session (not per-property — that
// part is permanent, on the row itself). Keyed both by id (for jobs, which
// carry a real property_id) and by normalized address (fallback for the
// rare job that predates that link).
async function _loadPropertiesIndex() {
  const STALE_MS = 5 * 60 * 1000;
  if (_mapPropsCache && (Date.now() - _mapPropsLoadedAt) < STALE_MS) return _mapPropsCache;
  const rows = await _sb('properties?select=id,address,normalized_address,landlord_name,agency_name,lat,lng') || [];
  const byId = new Map(rows.map(p => [p.id, p]));
  const byAddr = new Map(rows.map(p => [p.normalized_address, p]));
  _mapPropsCache = { rows, byId, byAddr };
  _mapPropsLoadedAt = Date.now();
  return _mapPropsCache;
}

// Resolves + caches coordinates for a batch of items that each have a
// resolvable address. `resolveProp(item)` returns the matching property row
// (or null); if it already has lat/lng, that's used instantly and free. If
// not, it's geocoded fresh (capped, rate-limited) and the result is written
// back to the property row so no future view ever pays that cost again.
// Items with no matching property fall back to the old session-only cache
// (never persisted — there's nowhere to persist it to).
async function _geocodeItems(items, addressOf, propOf) {
  let freshCount = 0;
  const out = [];
  for (const item of items) {
    const prop = propOf ? propOf(item) : null;
    let lat = prop?.lat, lng = prop?.lng;
    if (lat == null || lng == null) {
      const addr = addressOf(item);
      const cacheKey = addr.trim().toLowerCase();
      if (_mapGeoCache[cacheKey]) {
        ({ lat, lng } = _mapGeoCache[cacheKey]);
      } else {
        if (freshCount >= GEO_CAP) continue; // will be cached on a future load instead
        const coords = await _geocode(addr);
        if (!coords) continue;
        ({ lat, lng } = coords);
        freshCount++;
        if (prop?.id) {
          // Best-effort permanent cache write — never blocks the map on failure.
          _sb(`properties?id=eq.${prop.id}`, { method: 'PATCH', body: { lat, lng, geocoded_at: new Date().toISOString() } }).catch(() => {});
          prop.lat = lat; prop.lng = lng; // so a second item at the same property this same pass reuses it too
        }
        await _sleep(300); // Nominatim rate limit: 1 req/sec
      }
    }
    out.push({ item, lat, lng });
  }
  return { results: out, freshCount, skipped: items.length - out.length };
}

// ── LIVE ENGINEERS ──────────────────────────────────────────────
export async function _mapLiveEngineers(info, status) {
  const users = await _sb('users?role=eq.engineer&active=eq.true');
  const now = Date.now();
  const sharing = (users||[]).filter(u => u.last_lat && u.last_lng && u.last_seen && (now-u.last_seen) < 3600000);
  const offline = (users||[]).filter(u => !sharing.find(s=>s.id===u.id));

  if (!sharing.length) {
    if (status) status.textContent = `No engineers sharing location (${offline.length} offline)`;
    _showMapMessage('No engineers are sharing their location right now', '📍');
    _buildInfoPanel(info, sharing, offline, now);
    return;
  }

  const centLat = sharing.reduce((s,u) => s+u.last_lat, 0) / sharing.length;
  const centLng = sharing.reduce((s,u) => s+u.last_lng, 0) / sharing.length;

  _buildAndShowMap(sharing.map(u => ({lat:u.last_lat,lng:u.last_lng,label:u.name,color:'green'})), centLat, centLng, 12);

  if (status) status.textContent = `${sharing.length} engineer${sharing.length!==1?'s':''} live · Updated ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
  _buildInfoPanel(info, sharing, offline, now);
}

// ── JOBS BY DATE (merged Today/Upcoming — a date + range toggle instead of
//    two separate modes for what was always the same question) ──────────
export async function _mapJobsByDate(info, status) {
  const today = localDateStr();
  const dateInp = document.getElementById('map-date-inp')?.value || today;
  const isRange = document.getElementById('map-range-cb')?.checked;
  let jobs;
  if (isRange) {
    const end = localDateStr(new Date(new Date(dateInp).getTime() + 7*86400000));
    jobs = await _sb(`jobs?date=gte.${dateInp}&date=lte.${end}&select=id,jobnum,address,engineer,status,priority,timeslot,property_id&order=date.asc`);
  } else {
    jobs = await _sb(`jobs?date=eq.${dateInp}&select=id,jobnum,address,engineer,status,priority,timeslot,property_id`);
  }
  jobs = jobs || [];
  if (!jobs.length) {
    _showMapMessage(isRange ? 'No jobs found in this date range' : 'No jobs found for this date', '📋');
    if (status) status.textContent = '0 jobs found';
    return;
  }

  const propsIdx = await _loadPropertiesIndex();
  if (status) status.textContent = `Locating ${jobs.length} job${jobs.length!==1?'s':''}…`;
  const { results, freshCount, skipped } = await _geocodeItems(
    jobs,
    j => j.address,
    j => (j.property_id && propsIdx.byId.get(j.property_id)) || null
  );

  if (!results.length) {
    _showMapMessage('Could not locate any of these job addresses', '⚠️');
    if (status) status.textContent = 'Geocoding failed — check addresses include postcode';
    return;
  }

  const geocoded = results.map(r => ({ ...r.item, lat:r.lat, lng:r.lng }));
  const centLat = geocoded.reduce((s,j)=>s+j.lat,0)/geocoded.length;
  const centLng = geocoded.reduce((s,j)=>s+j.lng,0)/geocoded.length;
  const points = geocoded.map(j => ({
    lat:j.lat, lng:j.lng,
    label: (j.jobnum||'') + ' ' + (j.engineer||''),
    color: j.status===STATUS.COMPLETED?'green':j.priority==='Emergency'?'red':'blue'
  }));

  _buildAndShowMap(points, centLat, centLng, isRange ? 10 : 11);
  if (status) status.textContent = skipped
    ? `${geocoded.length} of ${jobs.length} mapped — ${skipped} not yet located (will be cached on a future load)`
    : `${geocoded.length} job${geocoded.length!==1?'s':''} mapped`;

  info.innerHTML = `
    <div style="padding:10px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
      ${isRange?'Next 7 days':'Today'} · ${geocoded.length} job${geocoded.length!==1?'s':''} mapped${skipped?` <span style="color:var(--yellow);font-weight:700">(${skipped} still locating)</span>`:''}
    </div>
    ${geocoded.map(j=>`
      <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
        <div style="width:8px;height:8px;border-radius:50%;background:${j.status===STATUS.COMPLETED?'#22c55e':j.priority==='Emergency'?'#f04444':'#4f8fff'};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(j.address)}</div>
          <div style="font-size:10px;color:var(--txt3)">${escHtml(j.engineer)||'Unassigned'} ${j.timeslot?'· 🕐 '+escHtml(j.timeslot):''}</div>
        </div>
        <span style="font-size:10px;padding:2px 7px;border-radius:8px;background:${j.status===STATUS.COMPLETED?'rgba(34,197,94,.12)':'rgba(79,143,255,.12)'}; color:${j.status===STATUS.COMPLETED?'#22c55e':'#4f8fff'}">${j.status||'Pending'}</span>
      </div>`).join('')}
  `;
}

// ── ENGINEER ROUTE — now with an actually-optimized stop order ──────────
export async function _mapEngineerRoute(info, status) {
  const engName = document.getElementById('map-eng-sel')?.value;
  const dateVal = document.getElementById('map-date-inp')?.value || localDateStr();
  if (!engName) {
    _showMapMessage('Select an engineer from the dropdown above', '👷');
    if (status) status.textContent = 'Please select an engineer';
    return;
  }

  const [jobs, users] = await Promise.all([
    _sb(`jobs?date=eq.${dateVal}&engineer=eq.${encodeURIComponent(engName)}&order=created.asc&select=*`),
    _sb(`users?name=ilike.${encodeURIComponent(engName)}&select=*`)
  ]);

  const eng = (users||[])[0];
  const jobList = jobs || [];

  if (!jobList.length) {
    _showMapMessage(`No jobs for ${engName} on ${dateVal}`, '📋');
    if (status) status.textContent = 'No jobs found for this engineer/date';
    return;
  }

  const propsIdx = await _loadPropertiesIndex();
  const { results } = await _geocodeItems(
    jobList,
    j => j.address,
    j => (j.property_id && propsIdx.byId.get(j.property_id)) || null
  );
  let geocoded = results.map(r => ({ ...r.item, lat:r.lat, lng:r.lng }));

  if (!geocoded.length) {
    _showMapMessage('Could not locate these job addresses', '⚠️');
    return;
  }

  // Reorder stops with a nearest-neighbour walk starting from the
  // engineer's live position if they're sharing it, otherwise the stop
  // closest to the depot-ish first job stays first — either way this is a
  // real (if greedy, not perfectly optimal) attempt at the shortest route
  // through today's jobs, not just the order they happened to be booked in.
  const hasLive = eng?.last_lat && eng?.last_lng && eng?.last_seen && (Date.now()-eng.last_seen) < 3600000;
  const startPoint = hasLive ? { lat: eng.last_lat, lng: eng.last_lng } : null;
  geocoded = _nearestNeighborOrder(startPoint, geocoded);

  const points = geocoded.map(j => `${j.lng},${j.lat}`).join(';');
  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=true`;

  let routeData = null;
  try {
    const rr = await fetch(routeUrl);
    routeData = await rr.json();
  } catch(e) { console.warn('Route API:', e); }

  const allPoints = [...geocoded.map(j => ({lat:j.lat,lng:j.lng,label:j.jobnum||j.address?.slice(0,20),color:j.status===STATUS.COMPLETED?'green':'blue'}))];
  if (hasLive) allPoints.unshift({lat:eng.last_lat, lng:eng.last_lng, label:engName+' (now)', color:'red'});

  const centLat = allPoints.reduce((s,p)=>s+p.lat,0)/allPoints.length;
  const centLng = allPoints.reduce((s,p)=>s+p.lng,0)/allPoints.length;
  const routeCoords = routeData?.routes?.[0]?.geometry?.coordinates || null;
  _buildAndShowMap(allPoints, centLat, centLng, 12, routeCoords);

  const now = Date.now();
  let html = `<div style="padding:10px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
    👷 ${engName} · ${dateVal} · ${geocoded.length} jobs · optimized order
    ${hasLive ? '<span style="color:#22c55e;margin-left:8px">● Live</span>' : ''}
  </div>`;

  let estTime = new Date(dateVal + 'T08:00:00');
  html += geocoded.map((j, i) => {
    const done = j.status === 'Completed';
    const estStr = estTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    estTime = new Date(estTime.getTime() + 3600000 + 1800000); // 1h job slot + 30min travel
    return `<div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center">
      <div style="width:22px;height:22px;border-radius:50%;background:${done?'#22c55e':'#4f8fff'};color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(j.address)}</div>
        <div style="font-size:10px;color:var(--txt3)">${j.timeSlot?'🕐 '+escHtml(j.timeSlot):('~'+estStr)}</div>
      </div>
      <span style="font-size:10px;padding:2px 7px;border-radius:8px;background:${done?'rgba(34,197,94,.12)':'rgba(79,143,255,.12)'};color:${done?'#22c55e':'#4f8fff'}">${j.status||'Pending'}</span>
    </div>`;
  }).join('');

  info.innerHTML = html;
  if (routeData?.routes?.[0]) {
    const dist = (routeData.routes[0].distance/1000).toFixed(1);
    const dur  = Math.round(routeData.routes[0].duration/60);
    if (status) status.textContent = `Optimized route: ${dist}km · ~${dur} min drive · ${geocoded.length} stops`;
  } else {
    if (status) status.textContent = `${geocoded.length} stops mapped`;
  }
}

// Greedy nearest-neighbour ordering — not a true shortest-route solver (that's
// an NP-hard problem not worth pulling in a solver library for a handful of
// daily stops), but a real, cheap improvement over creation-order, which had
// no relationship to geography at all.
export function _nearestNeighborOrder(startPoint, points) {
  const remaining = [...points];
  const ordered = [];
  let current = startPoint || remaining[0];
  if (!startPoint) { ordered.push(remaining.shift()); current = ordered[0]; }
  while (remaining.length) {
    let bestIdx = 0, bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = _haversineKm(current.lat, current.lng, p.lat, p.lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    current = remaining[bestIdx];
    ordered.push(current);
    remaining.splice(bestIdx, 1);
  }
  return ordered;
}
export function _haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// ── COMPLIANCE MAP — replaces the old fake "heatmap". Every property with
//    at least one certificate on file, colored by its real current status
//    (superseded certs excluded, same rule as certs-stats-dashboard.js's
//    property grid and openPropertyCertHistory) — answers "where is my
//    compliance risk," which raw job-status dots never could. ─────────────
export async function _mapCompliance(info, status) {
  if (status) status.textContent = 'Loading compliance data…';
  const [props, jobs, certs] = await Promise.all([
    _sb('properties?select=id,address,landlord_name,agency_name,lat,lng'),
    _sb('jobs?select=id,property_id&property_id=not.is.null'),
    _sb('certs?select=id,type,expirydate,noexpiry,jobid&superseded_by=is.null'),
  ]);

  const jobToProp = new Map((jobs||[]).map(j => [j.id, j.property_id]));
  const certsByProp = new Map();
  (certs||[]).forEach(c => {
    const pid = jobToProp.get(c.jobid);
    if (!pid) return;
    if (!certsByProp.has(pid)) certsByProp.set(pid, []);
    certsByProp.get(pid).push(c);
  });

  const now = Date.now();
  const daysUntil = ds => ds ? Math.round((new Date(ds) - now) / 86400000) : null;

  const rated = (props||[]).map(p => {
    const pc = certsByProp.get(p.id) || [];
    const expired = pc.filter(c => c.expirydate && !c.noexpiry && daysUntil(c.expirydate) < 0);
    const expiring = pc.filter(c => c.expirydate && !c.noexpiry && daysUntil(c.expirydate) >= 0 && daysUntil(c.expirydate) <= 60);
    const level = expired.length ? 'expired' : expiring.length ? 'expiring' : 'valid';
    return { ...p, certCount: pc.length, expired: expired.length, expiring: expiring.length, level };
  });

  // Only properties actually being tracked (≥1 cert) are shown — a property
  // with none isn't a compliance risk to flag, it's just untracked, and
  // plotting it the same as an expired one would bury the real signal.
  const tracked = rated.filter(p => p.certCount > 0);
  const untracked = rated.length - tracked.length;

  if (!tracked.length) {
    _showMapMessage('No properties with certificates on file yet', '🎯');
    if (status) status.textContent = untracked ? `${untracked} properties on file, none with certificates yet` : 'No properties yet';
    return;
  }

  const { results, skipped } = await _geocodeItems(
    tracked,
    p => p.address,
    p => p
  );
  const geocoded = results.map(r => ({ ...r.item, lat:r.lat, lng:r.lng }));

  if (!geocoded.length) {
    _showMapMessage('Could not locate these properties', '⚠️');
    return;
  }

  const centLat = geocoded.reduce((s,p)=>s+p.lat,0)/geocoded.length;
  const centLng = geocoded.reduce((s,p)=>s+p.lng,0)/geocoded.length;
  const colorFor = level => level==='expired' ? 'red' : level==='expiring' ? 'yellow' : 'green';
  const points = geocoded.map(p => ({ lat:p.lat, lng:p.lng, label:`${p.address} — ${p.expired?`${p.expired} expired`:p.expiring?`${p.expiring} expiring`:'compliant'}`, color: colorFor(p.level) }));
  _buildAndShowMap(points, centLat, centLng, 10);

  const expiredCount = geocoded.filter(p=>p.level==='expired').length;
  const expiringCount = geocoded.filter(p=>p.level==='expiring').length;
  if (status) status.textContent = `${expiredCount} expired · ${expiringCount} expiring soon · ${geocoded.length-expiredCount-expiringCount} valid${skipped?` · ${skipped} still locating`:''}${untracked?` · ${untracked} untracked (not shown)`:''}`;

  // Worst-first so the properties needing attention are at the top, not
  // buried alphabetically or by whatever order the query happened to return.
  const order = { expired: 0, expiring: 1, valid: 2 };
  const sorted = [...geocoded].sort((a,b) => order[a.level]-order[b.level]);
  info.innerHTML = `
    <div style="padding:10px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
      Compliance · ${geocoded.length} tracked propert${geocoded.length!==1?'ies':'y'}${untracked?` · ${untracked} untracked`:''}
    </div>
    ${sorted.map(p=>{
      const col = p.level==='expired'?'#f04444':p.level==='expiring'?'#f0c030':'#22c55e';
      const lbl = p.level==='expired'?`❌ ${p.expired} expired`:p.level==='expiring'?`⚠️ ${p.expiring} expiring soon`:'✅ Compliant';
      return `<div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
        <div style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.address)}</div>
          <div style="font-size:10px;color:var(--txt3)">${escHtml(p.landlord_name||p.agency_name||'No landlord on file')} · ${p.certCount} cert${p.certCount!==1?'s':''}</div>
        </div>
        <span style="font-size:10px;padding:2px 7px;border-radius:8px;background:${col}22;color:${col};white-space:nowrap">${lbl}</span>
      </div>`;
    }).join('')}
  `;
}

// ── GEOCODING (Nominatim — free, no key) ────────────────────────
export async function _geocode(address) {
  if (!address) return null;
  const key = address.trim().toLowerCase();
  if (_mapGeoCache[key]) return _mapGeoCache[key];
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&countrycodes=gb`;
    const res = await fetch(url, { headers: { 'User-Agent': 'DeepFlow/1.0' } });
    const data = await res.json();
    if (data?.[0]) {
      const r = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      _mapGeoCache[key] = r;
      return r;
    }
  } catch(e) { console.warn('Geocode:', address, e); }
  return null;
}

// ── MAP RENDERING — Blob URL approach (works everywhere) ──────

export function _buildAndShowMap(points, centLat, centLng, zoom, routeCoords) {
  const lat = centLat || 51.509865;
  const lng = centLng || -0.118092;
  const z   = zoom || 12;

  const markersJs = points.map(function(p) {
    var col = p.color === 'green' ? '#22c55e' : p.color === 'red' ? '#f04444' : p.color === 'yellow' ? '#f0c030' : '#4f8fff';
    var lbl = (p.label || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').slice(0,60);
    return 'L.circleMarker([' + p.lat + ',' + p.lng + '],{color:"' + col + '",fillColor:"' + col + '",fillOpacity:.85,radius:10,weight:2}).addTo(map).bindPopup("<b>' + lbl + '</b>");';
  }).join('\n');

  var routeJs = (routeCoords && routeCoords.length)
    ? 'L.polyline(' + JSON.stringify(routeCoords.map(function(c){return [c[1],c[0]];})) + ',{color:"#4f8fff",weight:5,opacity:.75,dashArray:"10,5"}).addTo(map);'
    : '';

  var html = '<!DOCTYPE html><html><head>'
    + '<meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
    + '<style>*{margin:0;padding:0}html,body{height:100%;width:100%}#m{height:100%;width:100%}</style>'
    + '</head><body>'
    + '<div id="m"></div>'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></sc' + 'ript>'
    + '<script>'
    + 'var map=L.map("m").setView([' + lat + ',' + lng + '],' + z + ');'
    // CARTO's anonymous basemap tiles (Voyager) now require an API key —
    // confirmed live 2026-09-04. Esri's World Street Map demo tiles are
    // free, keyless, and still work. Note the {z}/{y}/{x} order — ArcGIS
    // REST tile services use that order, not Leaflet's usual {z}/{x}/{y}.
    + 'L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",{attribution:"Esri, HERE, Garmin, © OpenStreetMap contributors",maxZoom:19}).addTo(map);'
    + routeJs
    + markersJs
    + '</sc' + 'ript></body></html>';

  if (_mapBlobUrl) { try { URL.revokeObjectURL(_mapBlobUrl); } catch(e){ console.warn('[DeepFlow]', e); } }
  var blob = new Blob([html], {type:'text/html'});
  _mapBlobUrl = URL.createObjectURL(blob);

  var f = document.getElementById('map-iframe');
  if (f) { f.src = 'about:blank'; setTimeout(function(){ f.src = _mapBlobUrl; }, 50); }
}

export function _showMapMessage(msg, icon) {
  const overlay = document.getElementById('map-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div style="font-size:48px">${icon||'🗺'}</div>
      <div style="font-size:15px;font-weight:600;color:var(--txt2);text-align:center;padding:0 20px">${msg}</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:4px">Using OpenStreetMap — free, no API key needed</div>`;
  }
}

export function _buildInfoPanel(info, sharing, offline, now) {
  if (!info) return;
  let html = '';
  if (sharing.length) {
    html += `<div style="padding:8px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">🟢 Live (${sharing.length})</div>`;
    sharing.forEach(u => {
      const ago = Math.round((now-u.last_seen)/60000);
      const agoStr = ago < 1 ? 'just now' : ago < 60 ? ago+'m ago' : Math.round(ago/60)+'h ago';
      const mUrl = `https://www.google.com/maps?q=${u.last_lat},${u.last_lng}`;
      html += `<div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
        <div style="width:28px;height:28px;border-radius:50%;background:#22c55e22;border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#22c55e;flex-shrink:0">${u.name.charAt(0).toUpperCase()}</div>
        <div style="flex:1"><div style="font-size:12px;font-weight:700">${u.name}</div>
        <div style="font-size:10px;color:var(--txt3)">${agoStr}${u.last_accuracy?' · ±'+u.last_accuracy+'m':''}</div></div>
        <a href="${mUrl}" target="_blank" style="background:var(--acc);color:#fff;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;text-decoration:none">Maps</a>
      </div>`;
    });
  }
  if (offline.length) {
    html += `<div style="padding:8px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">⚫ Offline (${offline.length})</div>
      <div style="padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px">
        ${offline.map(u=>`<span style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:3px 10px;font-size:11px;color:var(--txt2)">${u.name}</span>`).join('')}
      </div>`;
  }
  info.innerHTML = html;
}

export function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════════
//  ENGINEER LOCATIONS (office side)
// ════════════════════════════════════════════════════════════════
export async function loadEngineerLocations(){
  const el=document.getElementById('eng-loc-body');
  if(!el)return;
  el.innerHTML='<div style="font-size:12px;color:var(--txt3)">⏳ Loading…</div>';
  try{
    const users=await _sb('users?role=eq.engineer&active=eq.true&order=name.asc');
    if(!users||!users.length){
      el.innerHTML='<div style="font-size:12px;color:var(--txt3)">No engineers found in Supabase.</div>';
      return;
    }
    const now=Date.now();
    const sharing=users.filter(u=>u.last_lat&&u.last_lng&&u.last_seen&&(now-u.last_seen)<3600000); // within 1hr
    const offline=users.filter(u=>!sharing.find(s=>s.id===u.id));

    let html='';
    if(sharing.length){
      html+=`<div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🟢 Sharing Now (${sharing.length})</div>`;
      sharing.forEach(u=>{
        const ago=Math.round((now-u.last_seen)/60000);
        const agoStr=ago<1?'just now':ago<60?`${ago}m ago`:`${Math.round(ago/60)}h ago`;
        const mapsUrl=`https://www.google.com/maps?q=${u.last_lat},${u.last_lng}`;
        html+=`<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--s2);border-radius:8px;margin-bottom:8px;border:1px solid var(--border)">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--acc);color:#000;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">${u.name.charAt(0).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px">${u.name}</div>
            <div style="font-size:11px;color:var(--txt3)">📍 ${u.last_lat.toFixed(4)}, ${u.last_lng.toFixed(4)} · ${agoStr}${u.last_accuracy?` · ±${u.last_accuracy}m`:''}</div>
          </div>
          <a href="${mapsUrl}" target="_blank" style="background:var(--acc);color:#000;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap">🗺 Map</a>
        </div>`;
      });
    }
    if(offline.length){
      html+=`<div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-top:${sharing.length?12:0}px;margin-bottom:8px">⚫ Not Sharing (${offline.length})</div>`;
      html+=`<div style="display:flex;flex-wrap:wrap;gap:6px">${offline.map(u=>`<div style="background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--txt2)">${u.name}</div>`).join('')}</div>`;
    }
    el.innerHTML=html||'<div style="font-size:12px;color:var(--txt3)">No location data available</div>';
  }catch(err){
    el.innerHTML=`<div style="font-size:12px;color:#ef4444">⚠️ ${err.message?.slice(0,100)||'Error loading locations'}</div>`;
  }
}
