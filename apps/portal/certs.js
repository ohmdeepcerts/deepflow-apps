// Certs — the certificates list/calendar view, sorting, cert cards (also
// used by properties.js), the PDF preview overlay, and the "renew this"
// shortcut into the Request Wizard. Extracted from main.js verbatim
// (Phase 5 of the architecture migration, Client Portal module 5) — no
// behaviour changes intended, except one real bug fixed along the way
// (see below).
//
// Bug fixed during this extraction: the List/Calendar toggle buttons and
// both sort dropdowns used inline handlers like
// `onclick="_certView='list';vCerts(_d)"` and
// `onchange="_cs=this.value;vCerts(_d)"`. Same root cause as the
// Properties page fix in the previous commit — inline event-handler
// attributes run in non-strict global scope, so those bare assignments
// created disconnected `window._certView`/`window._cs`/`window._cd`
// globals instead of updating the module-scoped variables vCerts()
// actually reads, and the vCerts(_d) call right after each one threw a
// ReferenceError anyway since vCerts was never window-exposed. The
// List/Calendar toggle and both sort dropdowns have been silently
// non-functional. Fixed with new exported setCertView()/setCertSort()/
// setCertDir() functions, same pattern as setPropSearch()/setPropSort().
//
// _previewCert is reassigned here but read externally by
// shareCurrentPreviewCert() (EXPORT & SHARE, stays in main.js), so it's
// read back out through a new getPreviewCert() — same getter pattern
// used throughout this migration for state written in one module and
// read in another.

import { escText as e, escAttr as ea } from '@ui';
import { _d, dd, empty, go } from './main.js';
import { setRenewalData } from './request-wizard.js';

let _cs='expiry', _cd='asc', _certView='list';

export function setCertView(v){ _certView=v; vCerts(_d); }
export function setCertSort(v){ _cs=v; vCerts(_d); }
export function setCertDir(v){ _cd=v; vCerts(_d); }

export function vCerts(d){
  const OPTS=[{v:'expiry',l:'Expiry Date'},{v:'status',l:'Status (urgent first)'},{v:'type',l:'Cert Type'},{v:'address',l:'Address'},{v:'certnum',l:'Cert Number'},{v:'issuedate',l:'Issue Date'}];
  const sorted=sortCerts([...d.certs]);
  const now=new Date();
  const month=now.getMonth();
  const year=now.getFullYear();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDay=new Date(year,month,1).getDay();

  let calHtml=`<div class="cal-grid">`;
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>calHtml+=`<div style="font-weight:700;color:var(--text-tertiary);padding:8px">${d}</div>`);
  for(let i=0;i<firstDay;i++)calHtml+=`<div></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const hasJob=d.jobs.some(j=>j.date===dateStr);
    const hasCert=d.certs.some(c=>c.expiryDate===dateStr);
    const isToday=day===now.getDate();
    const cls=`cal-day ${hasCert?'has-expiry':''} ${hasJob?'has-job':''} ${isToday?'today':''}`;
    const title=(hasCert?'Certificate expiry':'')+(hasJob?' · Job scheduled':'');
    calHtml+=`<div class="${cls}" title="${title}">${day}</div>`;
  }
  calHtml+=`</div>`;

  document.getElementById('main').innerHTML=`<div class="sec">
    <div class="sec-hd">
      <div class="sec-t">Certificates <span class="sec-n">${d.certs.length}</span></div>
      <div style="display:flex;gap:6px">
        <button class="dl g sm ${_certView==='list'?'active':''}" onclick="setCertView('list')" style="${_certView==='list'?'border-color:var(--accent);color:var(--accent)':''}"><i data-lucide="list" style="width:12px;height:12px"></i> List</button>
        <button class="dl g sm ${_certView==='calendar'?'active':''}" onclick="setCertView('calendar')" style="${_certView==='calendar'?'border-color:var(--accent);color:var(--accent)':''}"><i data-lucide="calendar" style="width:12px;height:12px"></i> Calendar</button>
        <button class="dl g sm" onclick="exportCSV('certs')"><i data-lucide="download" style="width:12px;height:12px"></i> CSV</button>
      </div>
    </div>
    <div class="sort-bar">
      <span class="sl">Sort:</span>
      <select class="ss" onchange="setCertSort(this.value)">${OPTS.map(o=>`<option value="${o.v}"${_cs===o.v?' selected':''}>${o.l}</option>`).join('')}</select>
      <select class="ss" onchange="setCertDir(this.value)">
        <option value="asc"${_cd==='asc'?' selected':''}>↑ Ascending</option>
        <option value="desc"${_cd==='desc'?' selected':''}>↓ Descending</option>
      </select>
    </div>
    ${_certView==='calendar'?calHtml:sorted.length?sorted.map(c=>certCard(c,d)).join(''):empty('file-check','No certificates','Certificates will appear here after inspections')}
  </div>`;
}

function sortCerts(a){
  const FAR=new Date('2099-01-01');
  return a.sort((x,y)=>{
    if(_cs==='expiry'){const vx=x.noExpiry||!x.expiryDate?FAR:new Date(x.expiryDate);const vy=y.noExpiry||!y.expiryDate?FAR:new Date(y.expiryDate);return _cd==='asc'?vx-vy:vy-vx;}
    if(_cs==='issuedate'){const vx=x.issueDate?new Date(x.issueDate):new Date(0);const vy=y.issueDate?new Date(y.issueDate):new Date(0);return _cd==='asc'?vx-vy:vy-vx;}
    if(_cs==='status'){const r=c=>!c.expiryDate||c.noExpiry?3:dd(c.expiryDate)<0?0:dd(c.expiryDate)<=30?1:dd(c.expiryDate)<=60?2:4;const vx=r(x),vy=r(y);return _cd==='asc'?vx-vy:vy-vx;}
    const map={type:'type',address:'address',certnum:'certNum'};const fld=map[_cs];
    if(!fld)return 0;const vx=(x[fld]||'').toLowerCase(),vy=(y[fld]||'').toLowerCase();
    const c=vx<vy?-1:vx>vy?1:0;return _cd==='asc'?c:-c;
  });
}

export function certCard(c,d){
  const IC={Gas:'flame',EICR:'zap',PAT:'plug',EPC:'home',Fire:'fire-extinguisher',Boiler:'thermometer',Legionella:'droplets',Asbestos:'skull'};
  const COL={Gas:'#f97316',EICR:'#eab308',PAT:'#3b82f6',EPC:'#22c55e',Fire:'#ef4444',Boiler:'#f43f5e',Legionella:'#06b6d4',Asbestos:'#71717a'};
  const icKey=Object.keys(IC).find(k=>(c.type||'').includes(k));
  const ic=icKey?IC[icKey]:'file-text';
  const col=icKey?COL[icKey]:'var(--text-secondary)';
  const df=!c.noExpiry&&c.expiryDate?dd(c.expiryDate):null;
  const isE=df!==null&&df<0,isS=df!==null&&df>=0&&df<=60;
  const pc=isE?'p-e':isS?'p-s':df===null?'p-n':'p-ok';
  const pt=isE?`Expired ${Math.abs(df)}d ago`:isS?`${df}d left`:c.noExpiry?'No expiry':'Valid';
  const jf=d.jobs.find(j=>j.id===c.jobId);
  let ringHTML='';
  if(!c.noExpiry&&c.expiryDate){
    const totalDays=365;
    const remaining=Math.max(0,Math.min(totalDays,df!==null?(df<0?0:df):totalDays));
    const pct=(remaining/totalDays)*100;
    const color=isE?'var(--danger)':isS?'var(--warning)':'var(--success)';
    const r=18,circ=2*Math.PI*r;
    const dash=circ*(pct/100);
    ringHTML=`<div class="expiry-ring">
      <svg width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" stroke="var(--border)" stroke-width="4" fill="none"/>
      <circle cx="24" cy="24" r="${r}" stroke="${color}" stroke-width="4" fill="none" stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/></svg>
      <div class="val">${df!==null?Math.abs(df):'∞'}</div>
    </div>`;
  }else{ringHTML=`<div class="expiry-ring"><div class="val" style="font-size:10px;color:var(--text-tertiary)">N/A</div></div>`;}
  const pdfUrl=c.pdf_url||c.url;
  return`<div class="cc">
    <div class="cc-ic" style="background:${col}22;color:${col};border-color:${col}44"><i data-lucide="${ic}" style="width:20px;height:20px"></i></div>
    <div class="cc-body">
      <div class="cc-t">${e(c.type||'Certificate')}</div>
      <div class="cc-a">${e(c.address||(jf?.address)||'—')}</div>
      <div class="cc-m">
        <span class="pill ${pc}">${pt}</span>
        ${!c.noExpiry&&c.expiryDate?`<span style="font-size:11px;color:var(--text-secondary)">Exp. ${new Date(c.expiryDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>`:''}
        ${c.certNum?`<span style="font-size:11px;color:var(--text-secondary)">Ref: ${e(c.certNum)}</span>`:''}
      </div>
    </div>
    ${ringHTML}
    <div style="display:flex;gap:6px;flex-shrink:0;justify-content:flex-end">
      ${pdfUrl?`<button class="dl" onclick="previewCertPdf(${ea(JSON.stringify(pdfUrl))},${ea(JSON.stringify(c))})">View Certificate</button>`:`<span class="dl g" style="cursor:default;opacity:.5;font-size:11px">No PDF</span>`}
      ${isS||isE?`<button class="dl g" onclick="preFillRenewal(${ea(JSON.stringify(c))})" title="Renew Request"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>`:''}
    </div>
  </div>`;
}

let _previewCert=null;
export function getPreviewCert(){ return _previewCert; }

export function previewCertPdf(url,certJson){
  _previewCert=certJson||null;
  const shareBtn=document.getElementById('cp-pdf-share');
  if(shareBtn) shareBtn.style.display=_previewCert?'inline-flex':'none';
  document.getElementById('cp-pdf-frame').src=url;
  document.getElementById('cp-pdf-open').href=url;
  document.getElementById('cp-pdf-download').href=url;
  document.getElementById('cp-pdf-overlay').classList.add('show');
}
export function closeCertPdfPreview(ev){
  if(ev&&ev.target!==document.getElementById('cp-pdf-overlay'))return;
  document.getElementById('cp-pdf-overlay').classList.remove('show');
  document.getElementById('cp-pdf-frame').src='';
}

export function preFillRenewal(c){
  setRenewalData({type:c.type,address:c.address});
  go('request');
}
