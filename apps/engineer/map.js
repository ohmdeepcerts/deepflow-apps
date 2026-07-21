// Map — renders today's (or all) jobs on a Leaflet terrain map inside a
// blob-URL iframe, geocoding each address and optionally drawing an OSRM
// driving route between them. Extracted from main.js verbatim (Phase 5
// of the architecture migration, Employee App module 7) — no behaviour
// changes.
//
// _mapBlobUrl had no readers or writers anywhere else in main.js, so it
// moved wholly into this module. geocodeAddress is imported straight
// from geo-weather.js rather than round-tripping through main.js, since
// that's where it actually lives.

import { sb, getCurrentUser } from './main.js';
import { geocodeAddress } from './geo-weather.js';

let _mapBlobUrl = null;

export async function setMapView(view,btn){
  document.querySelectorAll('.map-tool-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const status=document.getElementById('map-status');
  const container=document.getElementById('map-container');
  status.textContent='Loading jobs…';
  container.innerHTML='<div class="loading-center"><div class="spin"></div></div>';
  try{
    const today=new Date().toISOString().split('T')[0];
    const enc=encodeURIComponent(getCurrentUser().name);
    let jobs=view==='all'
      ?await sb(`jobs?engineer=ilike.${enc}&select=*&limit=100&order=date.desc`)
      :await sb(`jobs?date=eq.${today}&engineer=ilike.${enc}&select=*`);
    jobs=jobs||[];
    if(!jobs.length){container.innerHTML='<div class="empty"><div class="empty-icon">📍</div><div class="empty-title">No jobs to map</div></div>';status.textContent='No jobs found';return;}
    status.textContent=`Geocoding ${jobs.length} addresses…`;
    const geo=[];
    for(const j of jobs){
      const c=await geocodeAddress(j.address);
      if(c)geo.push({...c,label:`${j.jobNum||'#'} — ${j.address}`,status:j.status,priority:j.priority});
    }
    if(!geo.length){container.innerHTML='<div class="empty"><div class="empty-icon">🗺</div><div class="empty-title">Could not locate addresses</div><div class="empty-sub">Ensure addresses include UK postcodes</div></div>';status.textContent='Geocoding failed';return;}
    let route=null;
    if(view==='route'&&geo.length>=2){status.textContent='Calculating route…';route=await _getRoute(geo);}
    const cLat=geo.reduce((s,p)=>s+p.lat,0)/geo.length;
    const cLng=geo.reduce((s,p)=>s+p.lng,0)/geo.length;
    status.textContent=`${geo.length} of ${jobs.length} jobs mapped`;
    _showMap(geo,cLat,cLng,view==='route'?12:11,route,container);
  }catch(e){
    container.innerHTML=`<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Map error</div><div class="empty-sub">${(e.message||'').slice(0,80)}</div></div>`;
    status.textContent='Error';
  }
}

async function _getRoute(pts){
  try{
    const coords=pts.map(p=>`${p.lng},${p.lat}`).join(';');
    const res=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const data=await res.json();
    if(data?.routes?.[0]){const r=data.routes[0];return{coords:r.geometry.coordinates,duration:Math.round(r.duration/60),distance:(r.distance/1000).toFixed(1)};}
  }catch(e){}return null;
}

function _showMap(pts,cLat,cLng,zoom,route,container){
  // Use OpenTopoMap for terrain tiles (free, no key, looks great)
  // Falls back to standard OSM if unavailable
  const tileUrl='https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
  const tileAttr='© OpenTopoMap (CC-BY-SA)';
  const markers=pts.map((p,i)=>{
    const col=p.priority==='Emergency'?'#f04444':p.status==='Completed'?'#22c55e':p.status==='Cannot Access'?'#f97316':'#4f8fff';
    const lbl=(p.label||'').replace(/'/g,"\\'").replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const num=route?`<div style="background:${col};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">${i+1}</div>`
      :`<div style="width:16px;height:16px;border-radius:50%;background:${col};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`;
    const iSize=route?[26,26]:[16,16];
    return`L.marker([${p.lat},${p.lng}],{icon:L.divIcon({className:'',html:'${num}',iconSize:[${iSize}],iconAnchor:[${iSize.map(v=>v/2)}]})}).addTo(map).bindPopup('<b style="font-family:sans-serif">${lbl}</b>');`;
  }).join('\n');
  const routeFn=route?`L.polyline([${route.coords.map(c=>`[${c[1]},${c[0]}]`).join(',')}],{color:'#4f8fff',weight:5,opacity:.8,dashArray:'10,5'}).addTo(map);`:'';
  const routeBox=route?`<div style="position:absolute;top:10px;right:10px;background:rgba(10,13,20,.9);backdrop-filter:blur(8px);border:1px solid #263047;border-radius:12px;padding:12px 16px;font-family:sans-serif;z-index:1000;pointer-events:none">
    <div style="font-size:10px;color:#8a9bbf;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Route Estimate</div>
    <div style="font-size:22px;font-weight:900;color:#4f8fff;font-family:monospace">${route.duration}m</div>
    <div style="font-size:12px;color:#4e6080">${route.distance} km · ${pts.length} stops</div>
  </div>`:'';
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>*{margin:0;padding:0}html,body,#m{height:100%;width:100%}</style>
</head><body><div id="m"></div>${routeBox}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
var map=L.map("m",{zoomControl:true}).setView([${cLat},${cLng}],${zoom});
// Try terrain tiles first, fallback to standard OSM
var terrain=L.tileLayer("${tileUrl}",{attribution:"${tileAttr}",maxZoom:17});
var osm=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19});
terrain.on("tileerror",function(){if(!map._fallback){map._fallback=true;map.removeLayer(terrain);osm.addTo(map);}});
terrain.addTo(map);
${routeFn}
${markers}
<\/script></body></html>`;
  if(_mapBlobUrl)try{URL.revokeObjectURL(_mapBlobUrl);}catch(e){}
  const blob=new Blob([html],{type:'text/html'});
  _mapBlobUrl=URL.createObjectURL(blob);
  container.innerHTML=`<iframe src="${_mapBlobUrl}" style="width:100%;height:calc(100vh - 260px);border:none;display:block"></iframe>`;
}
