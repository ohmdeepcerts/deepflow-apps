// Geo & Weather — device-independent location helpers for the Employee
// App: address geocoding (postcodes.io, falling back to Nominatim) with a
// 24h localStorage cache, weather (Open-Meteo), a Land Registry property-
// type lookup, and a haversine distance helper. Extracted from main.js
// verbatim (Phase 5 of the architecture migration, continuing into the
// Employee App — see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no
// behaviour changes.
//
// _hdist was physically the last function of the previous PHOTO UPLOAD
// section with zero callers there — it's a pure distance helper used only
// by the job-list's sort-by-distance feature, so it moved here instead.
//
// This module and main.js import from each other, same pattern as the
// Office App modules: safe because every cross-module reference is used
// only inside function bodies, never at module-evaluation time.

import { setWeather } from './main.js';

const GEO_LS_KEY = 'df_geocache';
const GEO_TTL    = 24 * 60 * 60 * 1000; // 24 h in ms
export let _geoCache = {};   // runtime map — loaded from localStorage on init

export function _hdist(lat1,lng1,lat2,lng2){
  const R=6371,dL=(lat2-lat1)*Math.PI/180,dN=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dN/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ══════════════════════════════════════════════════════════════
//  GEOCODING — postcodes.io (instant) + Nominatim fallback
//  Results persisted to localStorage with 24-hour TTL so the
//  same 20 addresses never hit the API twice in a working day.
// ══════════════════════════════════════════════════════════════

export function _loadGeoCache(){
  try{
    const raw = localStorage.getItem(GEO_LS_KEY);
    if(!raw) return;
    const stored = JSON.parse(raw);           // { key: {lat,lng,ts} }
    const now    = Date.now();
    let changed  = false;
    for(const [k,v] of Object.entries(stored)){
      if(now - (v.ts||0) < GEO_TTL){
        _geoCache[k] = {lat:v.lat, lng:v.lng}; // strip ts from runtime obj
      } else {
        changed = true; // expired — don't load, will be pruned on next save
      }
    }
    if(changed) _saveGeoCache();
  }catch(e){ localStorage.removeItem(GEO_LS_KEY); }
}

export function _saveGeoCache(){
  try{
    // Merge runtime cache with any existing LS entries, keeping ts
    const raw     = localStorage.getItem(GEO_LS_KEY);
    const stored  = raw ? JSON.parse(raw) : {};
    const now     = Date.now();
    // Write new entries, preserve existing timestamps
    for(const [k,v] of Object.entries(_geoCache)){
      if(!stored[k] || !stored[k].ts){
        stored[k] = {lat:v.lat, lng:v.lng, ts:now};
      }
    }
    // Prune expired
    for(const k of Object.keys(stored)){
      if(now - (stored[k].ts||0) >= GEO_TTL) delete stored[k];
    }
    localStorage.setItem(GEO_LS_KEY, JSON.stringify(stored));
  }catch(e){} // quota exceeded — silently skip
}

export async function geocodeAddress(address){
  if(!address) return null;
  const key = address.toLowerCase().trim();
  if(_geoCache[key]) return _geoCache[key];  // runtime hit

  const pcMatch = address.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  if(pcMatch){
    try{
      const pc  = pcMatch[1].replace(/\s+/g,'').toUpperCase();
      const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
      const data= await res.json();
      if(data.status===200 && data.result){
        const coords = {lat:data.result.latitude, lng:data.result.longitude};
        _geoCache[key] = coords;
        _saveGeoCache();
        return coords;
      }
    }catch(e){}
  }
  try{
    await new Promise(r=>setTimeout(r,300));
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=gb`,{headers:{'User-Agent':'DeepFlow/1.0'}});
    const data = await res.json();
    if(data?.[0]){
      const coords = {lat:parseFloat(data[0].lat), lng:parseFloat(data[0].lon)};
      _geoCache[key] = coords;
      _saveGeoCache();
      return coords;
    }
  }catch(e){}
  return null;
}

// ══════════════════════════════════════════════════════════════
//  WEATHER — Open-Meteo, no key
// ══════════════════════════════════════════════════════════════
export async function fetchWeather(lat,lng){
  try{
    const res=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,weathercode,windspeed_10m,precipitation&timezone=Europe%2FLondon`);
    const data=await res.json();
    if(data?.current){
      const c=data.current.weathercode;
      const w={temp:Math.round(data.current.temperature_2m),wind:Math.round(data.current.windspeed_10m),rain:data.current.precipitation>0,
        icon:c===0?'☀️':c<=2?'⛅':c<=3?'☁️':c<=49?'🌫':c<=59?'🌦':c<=69?'🌧':'⛈'};
      setWeather(w);
      return w;
    }
  }catch(e){}return null;
}

// ══════════════════════════════════════════════════════════════
//  LAND REGISTRY — free, no key
// ══════════════════════════════════════════════════════════════
export async function fetchLandRegistry(postcode){
  if(!postcode)return null;
  try{
    const pc=postcode.replace(/\s+/g,'').toUpperCase();
    const res=await fetch(`https://landregistry.data.gov.uk/data/ppi/address-search?postcode=${encodeURIComponent(pc)}&_view=basic&_pageSize=3&_format=json`);
    if(!res.ok)return null;
    const data=await res.json();
    const items=data?.result?.items;
    if(!items?.length)return null;
    return{type:items[0]?.propertyType?.prefLabel?.[0]?.value||'Residential'};
  }catch(e){return null;}
}
