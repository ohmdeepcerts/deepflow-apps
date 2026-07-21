// Live Maps — the office-side engineer location tracking page and its
// route/heatmap/live-position rendering, plus the small "Engineer
// Locations" panel that reuses the same geocoding cache. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 4 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// The cleanest extraction so far: this domain only ever reads STATUS,
// escHtml, and the low-level _sb fetch wrapper — no shared app state (S,
// data repository, toast, etc.) at all.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { STATUS } from '@business';
import { escHtml } from '@ui';
import { _sb } from './main.js';

let _mapGeoCache = {};  // address → {lat,lng}
let _mapBlobUrl = null;
let _mapEngineers=[],_mapEngineersLoadedAt=0;




// ════════════════════════════════════════════════════════════════
//  LIVE MAPS & ENGINEER TRACKING
//  Uses OpenStreetMap (Nominatim geocoding) — FREE, no API key
// ════════════════════════════════════════════════════════════════



export function onMapViewChange() {
  const v = document.getElementById('map-view-sel')?.value;
  if (!v) return;
  const engFilter = document.getElementById('map-eng-filter');
  const dateFilter = document.getElementById('map-date-filter');
  if (engFilter) engFilter.style.display = (v === 'route') ? 'flex' : 'none';
  if (dateFilter) dateFilter.style.display = (v === 'route' || v === 'today') ? 'flex' : 'none';
  if (v === 'today' || v === 'route') {
    const inp = document.getElementById('map-date-inp');
    if (inp && !inp.value) inp.value = new Date().toISOString().split('T')[0];
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
    if (view === 'engineers') await _mapLiveEngineers(info, status);
    else if (view === 'today') await _mapJobsByDate(info, status, 'today');
    else if (view === 'upcoming') await _mapJobsByDate(info, status, 'upcoming');
    else if (view === 'route') await _mapEngineerRoute(info, status);
    else if (view === 'heatmap') await _mapHeatmap(info, status);
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

  // Build OpenStreetMap URL with markers
  const markers = sharing.map(u =>
    `marker=${u.last_lat.toFixed(5)},${u.last_lng.toFixed(5)}`).join('&');
  const centLat = sharing.reduce((s,u) => s+u.last_lat, 0) / sharing.length;
  const centLng = sharing.reduce((s,u) => s+u.last_lng, 0) / sharing.length;

  _buildAndShowMap(sharing.map(u => ({lat:u.last_lat,lng:u.last_lng,label:u.name,color:'green'})), centLat, centLng, 12);

  if (status) status.textContent = `${sharing.length} engineer${sharing.length!==1?'s':''} live · Updated ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
  _buildInfoPanel(info, sharing, offline, now);
}

// ── JOBS BY DATE ─────────────────────────────────────────────────
export async function _mapJobsByDate(info, status, mode) {
  const today = new Date().toISOString().split('T')[0];
  const dateInp = document.getElementById('map-date-inp')?.value || today;
  let jobs;
  if (mode === 'today') {
    jobs = await _sb(`jobs?date=eq.${dateInp}&select=id,jobnum,address,engineer,status,priority,timeslot`);
  } else {
    const next7 = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];
    jobs = await _sb(`jobs?date=gt.${today}&date=lte.${next7}&select=id,jobnum,address,engineer,status,priority,timeslot&order=date.asc`);
  }
  jobs = jobs || [];
  if (!jobs.length) {
    _showMapMessage(mode==='today' ? 'No jobs found for this date' : 'No upcoming jobs this week', '📋');
    if (status) status.textContent = '0 jobs found';
    return;
  }

  // Geocode addresses (batch, rate limited)
  // FIX 19: Add visible feedback when jobs exceed the 30-job cap so users know
  // they are not seeing all jobs, rather than silently missing them.
  const GEO_CAP = 30;
  const jobsToGeocode = jobs.slice(0, GEO_CAP);
  const truncated = jobs.length > GEO_CAP;
  if (status) status.textContent = `Geocoding ${jobsToGeocode.length}${truncated ? ` of ${jobs.length}` : ''} addresses…`;

  const geocoded = [];
  for (const j of jobsToGeocode) {
    const coords = await _geocode(j.address);
    if (coords) geocoded.push({ ...j, ...coords });
    await _sleep(300); // Nominatim rate limit: 1 req/sec
  }

  if (!geocoded.length) {
    _showMapMessage('Could not geocode job addresses', '⚠️');
    if (status) status.textContent = 'Geocoding failed — check addresses include postcode';
    return;
  }

  const centLat = geocoded.reduce((s,j)=>s+j.lat,0)/geocoded.length;
  const centLng = geocoded.reduce((s,j)=>s+j.lng,0)/geocoded.length;
  const points = geocoded.map(j => ({
    lat:j.lat, lng:j.lng,
    label: (j.jobnum||'') + ' ' + (j.engineer||''),
    color: j.status===STATUS.COMPLETED?'green':j.priority==='Emergency'?'red':'blue'
  }));

  _buildAndShowMap(points, centLat, centLng, 11);
  if (status) status.textContent = truncated
    ? `Showing ${geocoded.length} of ${jobs.length} jobs — geocoding capped at ${GEO_CAP} (Nominatim rate limit)`
    : `${geocoded.length} of ${jobs.length} jobs mapped`;

  // Info panel
  info.innerHTML = `
    <div style="padding:10px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
      ${mode==='today'?'Today':'Upcoming'} · ${geocoded.length} jobs mapped${truncated?` <span style="color:var(--yellow);font-weight:700">(${jobs.length - GEO_CAP} not shown — over ${GEO_CAP} limit)</span>`:''}
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

// ── ENGINEER ROUTE ──────────────────────────────────────────────
export async function _mapEngineerRoute(info, status) {
  const engName = document.getElementById('map-eng-sel')?.value;
  const dateVal = document.getElementById('map-date-inp')?.value || new Date().toISOString().split('T')[0];
  if (!engName) {
    _showMapMessage('Select an engineer from the dropdown above', '👷');
    if (status) status.textContent = 'Please select an engineer';
    return;
  }

  // Get engineer's jobs for the date + current location
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

  // Geocode all job addresses
  const geocoded = [];
  for (const j of jobList) {
    const coords = await _geocode(j.address);
    if (coords) geocoded.push({...j, ...coords});
    await _sleep(350);
  }

  if (!geocoded.length) {
    _showMapMessage('Could not geocode addresses', '⚠️');
    return;
  }

  // Build OSRM route URL (free routing API)
  const points = geocoded.map(j => `${j.lng},${j.lat}`).join(';');
  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson&steps=true`;

  let routeData = null;
  try {
    const rr = await fetch(routeUrl);
    routeData = await rr.json();
  } catch(e) { console.warn('Route API:', e); }

  const allPoints = [...geocoded.map(j => ({lat:j.lat,lng:j.lng,label:j.jobnum||j.address?.slice(0,20),color:j.status===STATUS.COMPLETED?'green':'blue'}))];
  if (eng?.last_lat && eng?.last_lng) {
    allPoints.unshift({lat:eng.last_lat, lng:eng.last_lng, label:engName+' (now)', color:'red'});
  }

  const centLat = allPoints.reduce((s,p)=>s+p.lat,0)/allPoints.length;
  const centLng = allPoints.reduce((s,p)=>s+p.lng,0)/allPoints.length;
  const routeCoords = routeData?.routes?.[0]?.geometry?.coordinates || null;
  _buildAndShowMap(allPoints, centLat, centLng, 12, routeCoords);

  // Build route info
  const now = Date.now();
  let html = `<div style="padding:10px 16px;font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)">
    👷 ${engName} · ${dateVal} · ${geocoded.length} jobs
    ${eng?.last_seen && (now-eng.last_seen)<3600000 ? '<span style="color:#22c55e;margin-left:8px">● Live</span>' : ''}
  </div>`;

  // Estimate times (assume 30min per job + travel)
  let estTime = new Date(dateVal + 'T08:00:00');
  html += geocoded.map((j, i) => {
    const done = j.status === 'Completed';
    const estStr = estTime.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
    estTime = new Date(estTime.getTime() + (j.hours||1)*3600000 + 1800000); // job hours + 30min travel
    return `<div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:center">
      <div style="width:22px;height:22px;border-radius:50%;background:${done?'#22c55e':'#4f8fff'};color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(j.address)}</div>
        <div style="font-size:10px;color:var(--txt3)">${j.timeSlot?'🕐 '+escHtml(j.timeSlot):('~'+estStr)} ${j.hours?'· '+j.hours+'h':''}</div>
      </div>
      <span style="font-size:10px;padding:2px 7px;border-radius:8px;background:${done?'rgba(34,197,94,.12)':'rgba(79,143,255,.12)'};color:${done?'#22c55e':'#4f8fff'}">${j.status||'Pending'}</span>
    </div>`;
  }).join('');

  info.innerHTML = html;
  if (routeData?.routes?.[0]) {
    const dist = (routeData.routes[0].distance/1000).toFixed(1);
    const dur  = Math.round(routeData.routes[0].duration/60);
    if (status) status.textContent = `Route: ${dist}km · ~${dur} min drive · ${geocoded.length} stops`;
  } else {
    if (status) status.textContent = `${geocoded.length} stops mapped`;
  }
}

// ── HEATMAP ─────────────────────────────────────────────────────
export async function _mapHeatmap(info, status) {
  const jobs = await _sb('jobs?select=address,status,date&order=date.desc&limit=200');
  if (!jobs?.length) { _showMapMessage('No jobs to show', '📊'); return; }

  const geocoded = [];
  for (const j of jobs.slice(0,40)) {
    const coords = await _geocode(j.address);
    if (coords) geocoded.push({...j,...coords});
    await _sleep(300);
  }

  if (!geocoded.length) { _showMapMessage('Could not geocode addresses', '⚠️'); return; }

  const centLat = geocoded.reduce((s,j)=>s+j.lat,0)/geocoded.length;
  const centLng = geocoded.reduce((s,j)=>s+j.lng,0)/geocoded.length;
  const points  = geocoded.map(j=>({lat:j.lat,lng:j.lng,label:j.status,color:j.status===STATUS.COMPLETED?'green':'blue'}));
  _buildAndShowMap(points, centLat, centLng, 10);
  if (status) status.textContent = `${geocoded.length} jobs mapped (last 200)`;
  info.innerHTML = `<div style="padding:12px 16px;font-size:12px;color:var(--txt2)">Showing last ${geocoded.length} geocoded jobs. Green = Completed · Blue = Pending/In Progress.</div>`;
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

  // Build each marker as JS
  const markersJs = points.map(function(p) {
    var col = p.color === 'green' ? '#22c55e' : p.color === 'red' ? '#f04444' : '#4f8fff';
    var lbl = (p.label || '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').slice(0,40);
    return 'L.circleMarker([' + p.lat + ',' + p.lng + '],{color:"' + col + '",fillColor:"' + col + '",fillOpacity:.85,radius:10,weight:2}).addTo(map).bindPopup("<b>' + lbl + '</b>");';
  }).join('\n');

  // Real road-following route line (OSRM geometry, [lng,lat] pairs) \u2014 drawn
  // underneath the dots. Previously this app fetched a real driving route
  // and even showed its distance/duration in the status text, but never
  // actually drew it on the map \u2014 only the plain dots ever rendered.
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
    + 'L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{attribution:"\u00a9 OpenStreetMap \u00a9 CARTO",maxZoom:19,subdomains:"abcd"}).addTo(map);'
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

