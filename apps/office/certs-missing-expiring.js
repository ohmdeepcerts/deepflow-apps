// Certificates missing-details + expiring panels — the dedicated worklist
// for certs with no PDF and/or no expiry date, and the filterable/sortable
// card view of certs that are due or overdue. Extracted from certs.js
// verbatim (Phase 2 of the follow-up modularization pass — see the plan
// file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { daysDiff, formatDateUK } from '@business';
import { S, dAll } from './main.js';

// ════════════════════════════════════════════════════════════════
//  MISSING DETAILS (🧩 Missing Details tab) — certs with no PDF and/or
//  no expiry date, so the office can chase them down as a dedicated
//  worklist instead of spotting them buried in the full table.
// ════════════════════════════════════════════════════════════════

let _missingFilter='all';
export function setMissingFilter(mode){
  _missingFilter=mode;
  ['all','pdf','date'].forEach(m=>document.getElementById('cm-filter-'+m)?.classList.toggle('active',m===mode));
  renderCertMissing();
}

export async function renderCertMissing(){
  const all=await dAll('certs');
  const missingPdf=all.filter(c=>!c.pdfPath);
  const missingDate=all.filter(c=>!c.expiryDate&&!c.noExpiry);
  const missingBoth=all.filter(c=>!c.pdfPath&&!c.expiryDate&&!c.noExpiry);

  const kpiEl=document.getElementById('cm-kpis');
  if(kpiEl){
    const kpis=[
      {val:missingPdf.length,lbl:'Missing PDF',sub:'no document attached',pk:'var(--red)',ic:'📄',deco:'📎',mode:'pdf'},
      {val:missingDate.length,lbl:'Missing Dates',sub:'no expiry recorded',pk:'var(--yellow)',ic:'📅',deco:'🗓️',mode:'date'},
      {val:missingBoth.length,lbl:'Missing Both',sub:'needs full follow-up',pk:'#8a9bc0',ic:'⚠️',deco:'❗',mode:'all'},
    ];
    kpiEl.innerHTML=kpis.map(k=>`
      <div class="pkpi" style="--pk:${k.pk}" onclick="setMissingFilter('${k.mode}')">
        <div class="pkpi-blob"></div><div class="pkpi-deco">${k.deco}</div>
        <div class="pkpi-ic">${k.ic}</div>
        <div class="pkpi-val">${k.val}</div>
        <div class="pkpi-lbl">${k.lbl}</div>
        <div class="pkpi-sub">${k.sub}</div>
      </div>`).join('');
  }

  const byId=new Map();
  (_missingFilter==='pdf'?missingPdf:_missingFilter==='date'?missingDate:[...missingPdf,...missingDate])
    .forEach(c=>byId.set(c.id,c));
  const list=[...byId.values()].sort((a,b)=>(a.address||'').localeCompare(b.address||''));

  const listEl=document.getElementById('cm-list');
  if(!listEl)return;
  if(!list.length){
    listEl.innerHTML='<div style="text-align:center;padding:48px 16px"><div style="font-size:32px">✅</div><div style="font-size:13px;color:var(--txt3);margin-top:8px">Nothing missing — every certificate is fully documented</div></div>';
    return;
  }
  listEl.innerHTML=list.map(c=>{
    const noPdf=!c.pdfPath, noDate=!c.expiryDate&&!c.noExpiry;
    const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'var(--acc)'};
    return`<div class="prow" onclick="editCertRecord('${c.id}')">
      <div class="prow-ic" style="color:${ct.color||'var(--acc)'}">📄</div>
      <div class="prow-main">
        <div class="prow-title">${escHtml(c.address||'—')}</div>
        <div class="prow-meta">${escHtml(c.type||'Certificate')} · 👤 ${escHtml(c.landlord||'—')}${c.jobNum?' · Job: '+escHtml(c.jobNum):''}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${noPdf?`<span class="pbadge" style="background:rgba(185,28,28,.12);color:var(--red)">No PDF</span>`:''}
        ${noDate?`<span class="pbadge" style="background:rgba(180,83,9,.12);color:var(--yellow)">No Date</span>`:''}
      </div>
      ${!noPdf?`<button class="btn btn-ghost btn-xs" onclick="previewCertPdf('${c.pdfPath}');event.stopPropagation()">👁 Preview</button>`:''}
      <button class="btn btn-acc btn-xs" onclick="editCertRecord('${c.id}');event.stopPropagation()">${noPdf?'📤 Upload':'📅 Fill In'}</button>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
//  EXPIRING (⏰ Expiring tab) — a filterable, sortable, card-based view
//  of certs that are due or overdue, with a custom date range for
//  looking further ahead than the default 60-day window.
// ════════════════════════════════════════════════════════════════

export async function renderExpiringPanel(){
  const all=await dAll('certs');

  const typeEl=document.getElementById('exp-type');
  if(typeEl&&typeEl.options.length<=1){
    const types=[...new Set(all.map(c=>c.type).filter(Boolean))].sort();
    typeEl.innerHTML='<option value="all">All Types</option>'+types.map(t=>`<option value="${t}">${t}</option>`).join('');
  }
  const llList=document.getElementById('exp-ll-list');
  if(llList&&!llList.children.length){
    const lls=[...new Set(all.map(c=>c.landlord).filter(Boolean))].sort();
    llList.innerHTML=lls.map(l=>`<option value="${l}">`).join('');
  }
  const agList=document.getElementById('exp-ag-list');
  if(agList&&!agList.children.length){
    const ags=[...new Set(all.map(c=>c.agent).filter(Boolean))].sort();
    agList.innerHTML=ags.map(a=>`<option value="${a}">`).join('');
  }

  const q=(document.getElementById('exp-search')?.value||'').toLowerCase();
  const status=document.getElementById('exp-status')?.value||'both';
  const type=document.getElementById('exp-type')?.value||'all';
  const ll=(document.getElementById('exp-landlord')?.value||'').toLowerCase();
  const ag=(document.getElementById('exp-agent')?.value||'').toLowerCase();
  const from=document.getElementById('exp-from')?.value||'';
  const to=document.getElementById('exp-to')?.value||'';
  const sort=document.getElementById('exp-sort')?.value||'soonest';

  let list=all.filter(c=>{
    if(!c.expiryDate)return false; // this tab is about certs with a due/overdue date, not undated ones
    const d=daysDiff(c.expiryDate);
    if(status==='expiring'&&d<0)return false;
    if(status==='expired'&&d>=0)return false;
    if(status==='both'&&!to&&d>60)return false; // sane default window — an explicit "Exp. To" overrides it
    if(q){
      const blob=`${c.certNum||''} ${c.address||''} ${c.landlord||''} ${c.agent||''}`.toLowerCase();
      if(!blob.includes(q))return false;
    }
    if(type!=='all'&&c.type!==type)return false;
    if(ll&&!(c.landlord||'').toLowerCase().includes(ll))return false;
    if(ag&&!(c.agent||'').toLowerCase().includes(ag))return false;
    if(from&&c.expiryDate<from)return false;
    if(to&&c.expiryDate>to)return false;
    return true;
  });

  list.sort((a,b)=>{
    if(sort==='latest')return (a.expiryDate||'0000')<(b.expiryDate||'0000')?1:-1;
    if(sort==='addr')  return (a.address||'').localeCompare(b.address||'');
    return (a.expiryDate||'9999')>(b.expiryDate||'9999')?1:-1; // soonest first (default)
  });

  const countEl=document.getElementById('exp-count');
  if(countEl)countEl.textContent=`${list.length} cert${list.length===1?'':'s'}`;

  const grid=document.getElementById('exp-grid');
  if(!grid)return;
  if(!list.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:48px 16px"><div style="font-size:32px">✅</div><div style="font-size:13px;color:var(--txt3);margin-top:8px">Nothing matches these filters</div></div>';
    return;
  }
  grid.innerHTML=list.map(c=>{
    const d=daysDiff(c.expiryDate);
    const isExp=d<0;
    const pk=isExp?'var(--red)':d<=14?'var(--red)':d<=30?'var(--yellow)':'var(--blue)';
    const daysLbl=isExp?`${Math.abs(d)}d overdue`:`${d}d left`;
    return`<div class="exp-card" style="--pk:${pk}">
      <div class="exp-card-hd">
        <div class="exp-card-addr">${escHtml(c.address||'—')}</div>
        <div class="exp-card-days">${daysLbl}</div>
      </div>
      <div class="exp-card-meta">
        ${escHtml(c.type||'Certificate')}${c.certNum?' · #'+escHtml(c.certNum):''}<br>
        👤 ${escHtml(c.landlord||'—')}${c.agent?' · 🏢 '+escHtml(c.agent):''}<br>
        📅 ${formatDateUK(c.expiryDate)}
      </div>
      <div class="exp-card-actions">
        <button class="btn btn-acc btn-xs" onclick="createRenewalJob('${c.id}')">🔁 Renew</button>
        ${c.pdfPath?`<button class="btn btn-ghost btn-xs" onclick="previewCertPdf('${c.pdfPath}')">👁 View PDF</button>`:''}
        <button class="btn btn-ghost btn-xs" onclick="editCertRecord('${c.id}')">✎ Edit</button>
      </div>
    </div>`;
  }).join('');
}

export function clearExpiringFilters(){
  document.getElementById('exp-search').value='';
  document.getElementById('exp-status').value='both';
  document.getElementById('exp-type').value='all';
  document.getElementById('exp-landlord').value='';
  document.getElementById('exp-agent').value='';
  document.getElementById('exp-from').value='';
  document.getElementById('exp-to').value='';
  document.getElementById('exp-sort').value='soonest';
  renderExpiringPanel();
}
