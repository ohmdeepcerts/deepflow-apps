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

import { escText as e, escAttr as ea } from '@ui';
import { _d, dd, fd, jobCard, empty } from './main.js';

let _propSearch='',_propSort='jobs';

// Re-renders against the live portal data (main.js's _d), same as the
// original inline handlers did with `vProperties(_d)`.
export function setPropSearch(v){ _propSearch=v; vProperties(_d); }
export function setPropSort(v){ _propSort=v; vProperties(_d); }

export function vProperties(d){
  // Grouped by the real property_id on each job when there is one (every
  // job gets one via Office's _resolvePropertyForJob), falling back to a
  // normalized address match only for the rare job that somehow lacks it.
  // This used to group by the raw address string alone — which looked fine
  // until a cert's own address differed from its renewal's by so much as a
  // comma ("Flat A, 58 Elgin Road" vs "...Road,"): the two addresses hashed
  // to different groups, so a superseded certificate's "N previous
  // certificates" note ended up nested under an unrelated-looking address
  // instead of the one holding its own replacement. property_id doesn't
  // care about punctuation, so this can't happen once jobs share one.
  const map={};
  const normAddrKey=(addr)=>(addr||'').trim().toLowerCase();
  const groupFor=(propertyId,addr)=>{
    const key=propertyId?('id:'+propertyId):('addr:'+normAddrKey(addr));
    if(key==='addr:') return null;
    if(!map[key]) map[key]={propertyId:propertyId||null,address:(addr||'').trim(),jobs:[],certs:[],certsHistory:[]};
    if(!map[key].address && addr) map[key].address=addr.trim();
    return map[key];
  };
  const jobById=new Map(d.jobs.map(j=>[j.id,j]));
  d.jobs.forEach(j=>{const p=groupFor(j.property_id,j.address); if(p)p.jobs.push(j);});
  // Superseded certs (an old one a renewal has replaced — see the
  // certs_superseding migration) go to certsHistory instead of certs, same
  // fix as vCerts() in certs.js: without it, a property renewed right on
  // time still showed its old, now-superseded certificate as permanently
  // "Expired" here, right next to its own valid replacement. Resolved via
  // the cert's own job's property_id, same as jobs are grouped above, so a
  // superseded cert lands in the exact same group as its replacement.
  d.certs.forEach(c=>{
    const job=c.jobId?jobById.get(c.jobId):null;
    const p=groupFor(job?.property_id,job?.address||c.address);
    if(p)(c.superseded_by?p.certsHistory:p.certs).push(c);
  });

  // Real properties table (portal_get_properties(), session-scoped) —
  // replaces the old app_settings.__all__ JSON blob this used to read,
  // which predates that table and nothing writes to any more (its own
  // "property sold" filter had been silently a no-op since the migration
  // shipped). Looked up by id first (matches a group's own property_id
  // directly — no punctuation-sensitivity at all), falling back to address
  // only for a group that never got a property_id.
  const propById={},propByAddr={};
  (d.properties||[]).forEach(p=>{
    propById[p.id]=p;
    if(p.address) propByAddr[p.address.trim().toLowerCase()]=p;
  });
  const recordFor=(p)=>(p.propertyId&&propById[p.propertyId])||propByAddr[p.address.trim().toLowerCase()]||null;

  let list=Object.values(map);

  // If the office has since changed this property's landlord to someone
  // else (e.g. after a sale), stop showing it here — the old landlord's
  // job/invoice history at that address stays fully intact under Billing,
  // this only affects the Properties grouping view. Landlord portals only —
  // an agency's own name would never match a property's landlord field.
  if(d.type==='landlord'){
    const meNorm=(d.name||'').trim().toLowerCase();
    list=list.filter(p=>{
      const rec=recordFor(p);
      if(!rec || !rec.landlord_name) return true; // no office record, or no landlord set — show as before
      return rec.landlord_name.trim().toLowerCase()===meNorm;
    });
  }
  // Enrich each group with the real property's type/bedrooms/notes when one
  // matches — genuinely new information Portal couldn't show before (the
  // old blob wasn't being read from anywhere real anyway).
  list.forEach(p=>{ p.record=recordFor(p); });
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
    const rec=p.record;
    const recBits=rec?[rec.property_type,rec.bedrooms?`${rec.bedrooms} bed`:null].filter(Boolean).join(' · '):'';
    return`<div class="pg">
      <div class="pg-hd" data-action="toggle-group">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="pg-addr"><i data-lucide="building-2" style="width:14px;height:14px;display:inline;vertical-align:-2px;margin-right:6px"></i>${e(p.address)}</div>
          <div class="pg-m">${p.jobs.length} job${p.jobs.length!==1?'s':''} · ${p.certs.length} cert${p.certs.length!==1?'s':''} ›</div>
          ${recBits?`<span class="pill" style="background:var(--accent-light);color:var(--accent)">${e(recBits)}</span>`:''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${expiring?`<span class="pill p-s">${expiring} expiring</span>`:''}
          ${lastJob?`<span style="font-size:11px;color:var(--text-secondary)">Last job: ${fd(lastJob.date)}</span>`:''}
        </div>
      </div>
      <div class="pg-body collapsed">
        ${rec?.notes?`<div style="font-size:12px;color:var(--text-secondary);background:var(--border-subtle);border-radius:8px;padding:8px 10px;margin-bottom:10px">${e(rec.notes)}</div>`:''}
        ${p.jobs.length?`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">Jobs</div>${p.jobs.map(j=>jobCard(j,d)).join('')}`:''}
        ${(()=>{
          // A landlord opening this wants one question answered per
          // certificate type — "is it current, and until when" — scannable
          // in one line each, the way a checklist reads. The first version
          // of this reused the full job-style certCard for the current
          // cert plus every single superseded one stacked underneath, which
          // for a type renewed every 6 months over several years meant a
          // wall of near-identical cards and a dozen expiry dates fighting
          // for attention on screen at once — exactly what a real landlord
          // would find confusing rather than reassuring. History is still
          // one tap away (the small counter on the right), it just isn't
          // sitting open by default competing with "is this compliant?".
          const IC={Gas:'flame',EICR:'zap',PAT:'plug',EPC:'home',Fire:'fire-extinguisher',Boiler:'thermometer',Legionella:'droplets',Asbestos:'skull'};
          const fmtDate=s=>s?new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'—';
          const byType=new Map();
          [...p.certs,...p.certsHistory].forEach(c=>{
            if(!byType.has(c.type))byType.set(c.type,{current:null,history:[]});
            const g=byType.get(c.type);
            if(c.superseded_by)g.history.push(c); else g.current=c;
          });
          if(!byType.size)return'';
          const rows=[...byType.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([type,g],i)=>{
            const c=g.current;
            const df=c&&!c.noExpiry&&c.expiryDate?dd(c.expiryDate):null;
            const isE=df!==null&&df<0,isS=df!==null&&df>=0&&df<=60;
            const color=!c?'var(--text-tertiary)':isE?'var(--danger)':isS?'var(--warning)':'var(--success)';
            const label=!c?'No certificate on file':isE?`Expired ${Math.abs(df)}d ago`:isS?`Expires in ${df}d`:c.noExpiry?'No expiry':'Valid';
            const icKey=Object.keys(IC).find(k=>(type||'').includes(k));
            const historyId='cert-hist-'+Math.random().toString(36).slice(2,9)+'-'+i;
            const history=g.history.sort((a,b)=>(b.expiryDate||b.issueDate||'').localeCompare(a.expiryDate||a.issueDate||''));
            return`<div style="display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--border-subtle)${c?';cursor:pointer':''}"${c?` onclick="previewCertPdf('${c.id}')"`:''}>
              <i data-lucide="${icKey?IC[icKey]:'file-text'}" style="width:15px;height:15px;flex-shrink:0;color:${color}"></i>
              <div style="flex:1;min-width:0;font-size:12.5px;font-weight:600;color:var(--text)">${e(type||'Certificate')}</div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:11px;font-weight:700;color:${color}">${label}</div>
                ${c&&!c.noExpiry&&c.expiryDate?`<div style="font-size:10.5px;color:var(--text-tertiary)">${fmtDate(c.expiryDate)}</div>`:''}
              </div>
              ${history.length?`<button class="dl g sm" style="flex-shrink:0" onclick="event.stopPropagation();var h=document.getElementById('${historyId}');h.style.display=h.style.display==='none'?'block':'none'" title="Certificate history"><i data-lucide="history" style="width:11px;height:11px"></i> ${history.length}</button>`:''}
            </div>
            ${history.length?`<div id="${historyId}" style="display:none;padding:2px 2px 8px 25px">
              ${history.map(h=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;font-size:11px;color:var(--text-tertiary)">
                <span>${fmtDate(h.issueDate)} – ${fmtDate(h.expiryDate)}</span>
                <button class="dl g sm" onclick="event.stopPropagation();previewCertPdf('${h.id}')" title="View"><i data-lucide="eye" style="width:11px;height:11px"></i></button>
              </div>`).join('')}
            </div>`:''}`;
          }).join('');
          return`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 4px">Certificates</div>${rows}`;
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
        <input class="fi" id="prop-search" placeholder=" " value="${ea(_propSearch)}" oninput="setPropSearch(this.value)">
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
