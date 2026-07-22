// Properties — groups a client's jobs and certificates by address into
// collapsible cards, with search and sort. Extracted from main.js
// verbatim (Phase 5 of the architecture migration, Client Portal module
// 4) — no behaviour changes intended, except one real bug fixed along
// the way (see below). The original section header called this
// "DOCUMENTS", which doesn't match its content at all — vProperties() is
// the property-grouping view; nothing here handles documents. Left
// unrenamed elsewhere in the app, but noted here since it's exactly the
// kind of misleading-header trap this migration keeps finding.
//
// Bug fixed during this extraction: the search input and sort dropdown
// used inline handlers like `oninput="_propSearch=this.value;vProperties(_d)"`.
// Inline event-handler attributes execute in non-strict global scope, so
// that bare assignment created a disconnected `window._propSearch`
// instead of updating the module-scoped `_propSearch` this file's own
// vProperties() reads — and the vProperties(_d) call right after it
// threw a ReferenceError anyway, since vProperties was never in the
// window-exposure list. Net effect: typing in the search box or
// changing sort order silently did nothing. Fixed by routing both
// through new exported setPropSearch()/setPropSort() functions, matching
// the pattern every other stateful control in this app already uses
// (e.g. toggleAgentFilter, preFillRenewal) instead of a raw inline
// assignment.

import { escText as e } from '@ui';
import { _d, _S, dd, fd, jobCard, certCard, empty } from './main.js';

let _propSearch='',_propSort='jobs';

// Re-renders against the live portal data (main.js's _d), same as the
// original inline handlers did with `vProperties(_d)`.
export function setPropSearch(v){ _propSearch=v; vProperties(_d); }
export function setPropSort(v){ _propSort=v; vProperties(_d); }

export function vProperties(d){
  const map={};
  const addKey=(addr)=>{
    const k=(addr||'').trim(); if(!k) return null;
    if(!map[k]) map[k]={address:k,jobs:[],certs:[]};
    return map[k];
  };
  d.jobs.forEach(j=>{const p=addKey(j.address); if(p)p.jobs.push(j);});
  d.certs.forEach(c=>{const p=addKey(c.address); if(p)p.certs.push(c);});

  let list=Object.values(map);

  // If the office has since changed this property's Landlord field to
  // someone else (e.g. "Property Sold — Landlord Details Awaiting" after a
  // sale), stop showing it here — the old landlord's invoice/job history at
  // that address stays fully intact under Invoices, this only affects the
  // Properties grouping view. Landlord portals only — an agency/agent's own
  // name would never match a property's "landlord" field, so this check
  // would incorrectly hide everything for them.
  if(d.type==='landlord' && Array.isArray(_S?.properties) && _S.properties.length){
    const meNorm=(d.name||'').trim().toLowerCase();
    const propByAddr={};
    _S.properties.forEach(p=>{ if(p.address) propByAddr[p.address.trim().toLowerCase()]=p; });
    list=list.filter(p=>{
      const rec=propByAddr[p.address.trim().toLowerCase()];
      if(!rec || !rec.landlord) return true; // no office record, or no landlord set — show as before
      return rec.landlord.trim().toLowerCase()===meNorm;
    });
  }
  if(_propSearch) list=list.filter(p=>p.address.toLowerCase().includes(_propSearch.toLowerCase()));
  if(_propSort==='jobs') list.sort((a,b)=>b.jobs.length-a.jobs.length);
  else if(_propSort==='az') list.sort((a,b)=>a.address.localeCompare(b.address));
  else if(_propSort==='recent') list.sort((a,b)=>{
    const la=Math.max(0,...a.jobs.map(j=>new Date(j.date||0).getTime()),0);
    const lb=Math.max(0,...b.jobs.map(j=>new Date(j.date||0).getTime()),0);
    return lb-la;
  });
  else if(_propSort==='expiry') list.sort((a,b)=>{
    const nextExp=p=>{const ds=p.certs.filter(c=>!c.noExpiry&&c.expiryDate).map(c=>dd(c.expiryDate));return ds.length?Math.min(...ds):Infinity;};
    return nextExp(a)-nextExp(b);
  });
  else if(_propSort==='certs') list.sort((a,b)=>b.certs.length-a.certs.length);

  const rows=list.map(p=>{
    const expiring=p.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=60).length;
    const lastJob=p.jobs.length?p.jobs.reduce((a,b)=>new Date(a.date||0)>new Date(b.date||0)?a:b):null;
    return`<div class="pg">
      <div class="pg-hd" data-action="toggle-group">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="pg-addr"><i data-lucide="building-2" style="width:14px;height:14px;display:inline;vertical-align:-2px;margin-right:6px"></i>${e(p.address)}</div>
          <div class="pg-m">${p.jobs.length} job${p.jobs.length!==1?'s':''} · ${p.certs.length} cert${p.certs.length!==1?'s':''} ›</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${expiring?`<span class="pill p-s">${expiring} expiring</span>`:''}
          ${lastJob?`<span style="font-size:11px;color:var(--text-secondary)">Last job: ${fd(lastJob.date)}</span>`:''}
        </div>
      </div>
      <div class="pg-body collapsed">
        ${p.jobs.length?`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">Jobs</div>${p.jobs.map(j=>jobCard(j,d)).join('')}`:''}
        ${(()=>{
          // Job cards already show their own linked certificates inline — only
          // list certs here that aren't tied to one of this property's jobs,
          // so nothing shows up twice.
          const jobIds=new Set(p.jobs.map(j=>j.id));
          const standalone=p.certs.filter(c=>!c.jobId||!jobIds.has(c.jobId));
          return standalone.length?`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Certificates</div>${standalone.map(c=>certCard(c,d)).join('')}`:'';
        })()}
      </div>
    </div>`;
  }).join('');

  // Preserve focus + cursor position across re-render (search re-renders on every keystroke)
  const activeEl=document.activeElement;
  const wasSearchFocused=activeEl&&activeEl.id==='prop-search';
  const selStart=wasSearchFocused?activeEl.selectionStart:null;
  const selEnd=wasSearchFocused?activeEl.selectionEnd:null;

  document.getElementById('main').innerHTML=`
    <div class="sec">
      <div class="sec-hd"><div class="sec-t">Properties <span class="sec-n">${list.length}</span></div></div>
      <div class="fg" style="margin-bottom:12px">
        <input class="fi" id="prop-search" placeholder=" " value="${e(_propSearch)}" oninput="setPropSearch(this.value)">
        <label class="fl">Search by address</label>
      </div>
      <div class="sort-bar">
        <span class="sl">Sort:</span>
        <select class="ss" onchange="setPropSort(this.value)">
          <option value="jobs"${_propSort==='jobs'?' selected':''}>Most Jobs</option>
          <option value="az"${_propSort==='az'?' selected':''}>Address A–Z</option>
          <option value="recent"${_propSort==='recent'?' selected':''}>Most Recent Activity</option>
          <option value="expiry"${_propSort==='expiry'?' selected':''}>Certificate Expiry (Soonest)</option>
          <option value="certs"${_propSort==='certs'?' selected':''}>Most Certificates</option>
        </select>
      </div>
      ${rows||empty('building-2','No properties yet','Properties will appear here once jobs or certificates are recorded')}
    </div>`;

  if(wasSearchFocused){
    const inp=document.getElementById('prop-search');
    if(inp){ inp.focus(); inp.setSelectionRange(selStart,selEnd); }
  }
}
