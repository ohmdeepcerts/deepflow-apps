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
import { _d, dd, empty, go, ptype, _blobUrlFor, toast } from './main.js';
import { setRenewalData } from './request-wizard.js';
import { payInvoice } from './invoice-pdf.js';

// A cert is locked until every invoice linked to its job is Paid — same
// test Office's own _isJobPaid (apps/office/certs.js) uses to decide
// whether to watermark a PAT cert or send the "pay to unlock" email. No
// job link at all means no invoice to gate on, so it's never locked; a
// job link with no invoice raised yet counts as locked (nothing paid).
// Takes `d` explicitly (same object certCard already reads d.jobs from)
// rather than closing over the module-level _d, so this stays a plain
// function of its inputs — _d is only null before the app finishes
// loading, and certCard is never called before then anyway, but there's
// no reason for this to depend on that timing when the caller already
// has d in hand.
function _certInvoices(c,d){
  if(!c.jobId) return [];
  return (d.invoices||[]).filter(i=>i.jobId===c.jobId||i.linkedJobId===c.jobId);
}
function _isCertLocked(c,d){
  if(!c.jobId) return false;
  // Per-client toggle (Directory → Edit → "Hold certificates until the
  // invoice is paid") — off means this client's certs are never held back
  // on payment status at all. Mirrors Office's own _lockCertsForJob
  // (apps/office/certs-pdf.js); d.entity is the real persons/agencies/
  // agents row (portal_get_person/_agency/_agent, SELECT *), so the raw
  // column is already here with no extra fetch needed.
  if(d.entity?.lockcertsuntilpaid===false) return false;
  const invs=_certInvoices(c,d);
  return !invs.length || !invs.every(i=>i.status==='Paid');
}
function _lockedInvoiceForCert(c,d){
  const invs=_certInvoices(c,d);
  return invs.find(i=>i.status!=='Paid')||invs[0]||null;
}

let _cs='expiry', _cd='asc', _certView='list', _showSuperseded=false;

export function setCertView(v){ _certView=v; vCerts(_d); }
export function setCertSort(v){ _cs=v; vCerts(_d); }
export function setCertDir(v){ _cd=v; vCerts(_d); }
export function toggleShowSuperseded(){ _showSuperseded=!_showSuperseded; vCerts(_d); }

export function vCerts(d){
  const OPTS=[{v:'expiry',l:'Expiry Date'},{v:'status',l:'Status (urgent first)'},{v:'type',l:'Cert Type'},{v:'address',l:'Address'},{v:'certnum',l:'Cert Number'},{v:'issuedate',l:'Issue Date'}];
  // Certificates renewals never used to link to what they replaced, so an
  // old, already-renewed certificate stayed listed here as "Expired"
  // forever, right alongside its own valid replacement — confusing to see
  // and wrong-looking even when a renewal was done right on schedule. The
  // main list/calendar now shows only the current one per type; history
  // stays genuinely visible via the toggle below (superseded_by set by the
  // supersede_prior_certs trigger — see the certs_superseding migration).
  const current=(d.certs||[]).filter(c=>!c.superseded_by);
  const superseded=(d.certs||[]).filter(c=>c.superseded_by);
  const sorted=sortCerts([...current]);
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
    const hasCert=current.some(c=>c.expiryDate===dateStr);
    const isToday=day===now.getDate();
    const cls=`cal-day ${hasCert?'has-expiry':''} ${hasJob?'has-job':''} ${isToday?'today':''}`;
    const title=(hasCert?'Certificate expiry':'')+(hasJob?' · Job scheduled':'');
    calHtml+=`<div class="${cls}" title="${title}">${day}</div>`;
  }
  calHtml+=`</div>`;

  document.getElementById('main').innerHTML=`<div class="sec">
    <div class="sec-hd">
      <div class="sec-t">Certificates <span class="sec-n">${current.length}</span></div>
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
    ${superseded.length?`<div style="margin-top:16px">
      <div style="font-size:12px;color:var(--text-tertiary);cursor:pointer;padding:8px 0" onclick="toggleShowSuperseded()"><i data-lucide="${_showSuperseded?'chevron-down':'chevron-right'}" style="width:12px;height:12px;display:inline;vertical-align:-2px"></i> ${superseded.length} previous certificate${superseded.length===1?'':'s'} (renewed)</div>
      ${_showSuperseded?`<div style="opacity:.7">${sortCerts([...superseded]).map(c=>certCard(c,d)).join('')}</div>`:''}
    </div>`:''}
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
  const locked=_isCertLocked(c,d);
  // The signed pdf_url/pdf_path/url is a working download link — while
  // locked, it must never end up in the page source at all, not just
  // unlinked. JSON.stringify(c) is used below for two different onclick
  // payloads (renew, the lock popup); a locked cert uses this stripped
  // copy for both so the URL can't be pulled straight out of the HTML,
  // e.g. via view-source, even though nothing renders it as a link.
  const cSafe=locked?(()=>{const{pdf_url,pdf_path,url,...rest}=c;return rest;})():c;
  // Renew, the expiry ring, and the actions button live together in one
  // tightly-packed .cc-meta group (see .cc in index.html) — renew comes
  // FIRST so when it's absent there's no dead reserved gap before the ring,
  // and since the group is right-aligned as a whole, "View Certificate"
  // still lines up consistently across rows either way.
  const renewBtn=(isS||isE)?`<button class="dl g cc-renew" onclick="preFillRenewal(${ea(JSON.stringify(cSafe))})" title="Renew Request"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>`:'';
  // Locked: never a working preview/download link, regardless of pdfUrl —
  // type and expiry date above still show (that's the "just the expiry
  // date" the popup explains), only the document itself is withheld.
  // Passes only the cert id — previewCertPdf looks the record (and its
  // signed pdf_url) up from _d itself, so the real storage link never
  // gets written into this onclick attribute's HTML source at all, not
  // just left unlinked. Same reasoning as cSafe above, applied to the
  // unlocked case too.
  const actionBtn=locked
    ? `<button class="dl g" onclick="showCertLockedPopup(${ea(JSON.stringify(cSafe))})" title="Pay the linked invoice to unlock"><i data-lucide="lock" style="width:12px;height:12px"></i> Locked</button>`
    : (pdfUrl?`<button class="dl" onclick="previewCertPdf(${ea(JSON.stringify(c.id))})">View Certificate</button>`:`<span class="dl g" style="cursor:default;opacity:.5;font-size:11px">No PDF</span>`);
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
    <div class="cc-meta">
      ${renewBtn}
      ${ringHTML}
      <div class="cc-actions">${actionBtn}</div>
    </div>
  </div>`;
}

// "Pay to unlock" — shown instead of the real document until the linked
// invoice is paid, same rule apply to the emailed copy (see
// _maybeEmailCertReady/_certLockedEmailHtml in office/certs.js). Only
// landlord/agency portals can pay (matches _payable in invoice-pdf.js —
// agents don't hold the invoice's money), so an agent view gets a plain
// message instead of a Pay button.
export function showCertLockedPopup(c){
  const inv=_lockedInvoiceForCert(c,_d);
  const canPay=inv&&(ptype==='landlord'||ptype==='agency');
  document.getElementById('cert-lock-bd').innerHTML=`
    <div style="text-align:center;padding:6px 4px 2px">
      <i data-lucide="lock" style="width:34px;height:34px;color:var(--warning)"></i>
      <div style="font-size:14px;color:var(--text);line-height:1.55;margin:14px 0 18px">
        This ${e(c.type||'certificate')} is ready but held until the linked invoice is paid.
      </div>
      ${canPay
        ?`<button class="dl" style="width:100%;justify-content:center;background:var(--success,#16a34a)" onclick="closeCertLockModal();payInvoice(${ea(JSON.stringify(inv.id))})">Pay Invoice to Unlock</button>`
        :`<div style="font-size:12px;color:var(--text-secondary)">Please ask your landlord/agency to settle the outstanding invoice.</div>`}
    </div>`;
  document.getElementById('cert-lock-overlay').classList.add('show');
}
export function closeCertLockModal(ev){
  if(ev&&ev.target!==document.getElementById('cert-lock-overlay'))return;
  document.getElementById('cert-lock-overlay').classList.remove('show');
}

let _previewCert=null;
export function getPreviewCert(){ return _previewCert; }

// Blob URL for whatever's currently open in the preview modal — revoked
// on close and before loading the next one, so nothing outlives the view
// it was created for. See _blobUrlFor in main.js for why this exists.
let _previewBlobUrl=null;

export async function previewCertPdf(certId){
  const cert=(_d.certs||[]).find(c=>c.id===certId);
  if(!cert){ toast('No PDF on file for this certificate'); return; }
  // certCard() already hides this behind a "Locked" button when unpaid,
  // but previewCertPdf is exposed on window (see main.js's Object.assign)
  // like every other inline-onclick handler, so it's directly callable
  // from devtools with any cert id — this re-checks the same lock state
  // certCard used to decide which button to render, so calling it that
  // way lands on the same locked popup instead of quietly fetching the
  // real PDF. Checked BEFORE the pdf_url check below: the actual
  // enforcement is server-side (portal-sign-url now refuses to sign an
  // unpaid cert's path at all, so a locked cert's pdf_url is genuinely
  // absent, not just unlinked) — if this ran after, a locked cert would
  // hit the generic "No PDF on file" message instead of the real reason.
  if(_isCertLocked(cert,_d)){ showCertLockedPopup(cert); return; }
  if(!cert.pdf_url){ toast('No PDF on file for this certificate'); return; }
  _previewCert=cert;
  const shareBtn=document.getElementById('cp-pdf-share');
  if(shareBtn) shareBtn.style.display='inline-flex';
  const frame=document.getElementById('cp-pdf-frame');
  const openBtn=document.getElementById('cp-pdf-open');
  const dlBtn=document.getElementById('cp-pdf-download');
  frame.srcdoc='<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font:13px system-ui;color:#888">Loading…</body>';
  openBtn.removeAttribute('href');
  dlBtn.removeAttribute('href');
  document.getElementById('cp-pdf-overlay').classList.add('show');
  if(_previewBlobUrl){ URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl=null; }
  try{
    const blobUrl=await _blobUrlFor(cert.pdf_url);
    _previewBlobUrl=blobUrl;
    frame.removeAttribute('srcdoc');
    frame.src=blobUrl;
    openBtn.href=blobUrl;
    dlBtn.href=blobUrl;
    dlBtn.setAttribute('download',(cert.certNum||cert.type||'certificate')+'.pdf');
  }catch(err){
    frame.srcdoc='<body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font:13px system-ui;color:#c00">Could not load this certificate — please try again</body>';
  }
}
export function closeCertPdfPreview(ev){
  if(ev&&ev.target!==document.getElementById('cp-pdf-overlay'))return;
  document.getElementById('cp-pdf-overlay').classList.remove('show');
  document.getElementById('cp-pdf-frame').src='';
  if(_previewBlobUrl){ URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl=null; }
}

export function preFillRenewal(c){
  setRenewalData({type:c.type,address:c.address});
  go('request');
}
