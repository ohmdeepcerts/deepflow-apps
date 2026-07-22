// Certificates domain — dashboard, list/table, add/edit form, statistics,
// bulk reminders, CSV import/export, and PDF attachment handling for the
// Office App's Certificates tab. Extracted from main.js verbatim (Phase 5
// of the architecture migration, see ARCHITECTURE_REDESIGN_PROPOSAL.md
// Part 5) — no behaviour changes. Two functions that lived in this section
// but are actually generic date helpers used well beyond certs (daysDiff,
// formatDateUK) moved to @business/dates.js instead, imported by both this
// module and main.js.
//
// This module and main.js import from each other: main.js needs the
// cert functions its onclick handlers and job-completion flow call, and
// this module needs main.js's shared data repository, UI helpers, and app
// state. That's safe because every cross-module reference here is used
// only inside function bodies, never at module-evaluation time — so it
// doesn't matter which of the two finishes evaluating first.

import { SB_URL, SB_KEY } from '@core';
import { STATUS, daysDiff, formatDateUK } from '@business';
import {
  S, dAll, dGet, dPut, dDel, toast, confirm2, uid, TODAY, logActivity,
  updateBadges, nav, closeModal, openModal, _getJWT, setJDate, _sb,
  saveCertExpiry, skipCertExpiry, setPendCertJob,
} from './main.js';

let _certTab='dash';
let _ctPage=1,_ctblHidden=[];
let _editCertId=null,_selCertTypes=new Set();
let _cremMode='email',_cremEmailLink='';

export function getCertTab(){ return _certTab; }

// Storage upload — moved here with its one and only caller (uploadCertPdf).
async function sbStorage(path,file){
  const jwt=await _getJWT();
  const res=await fetch(`${SB_URL}/storage/v1/object/deepflow/${path}`,{
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':file.type||'application/octet-stream','x-upsert':'true'},
    body:file
  });
  if(!res.ok) throw new Error('Upload failed: '+(await res.text()).slice(0,200));
  return `${SB_URL}/storage/v1/object/public/deepflow/${path}`;
}

//  CERTIFICATES
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  CERTIFICATES DASHBOARD
// ════════════════════════════════════════════════════════════════


export function switchCertTab(tab,_skipFormInit){
  _certTab=tab;
  const tabs=['dash','list','form','rem','stats'];
  const panels={dash:'certs-dash-panel',list:'certs-list-panel',form:'certs-form-panel',rem:'certs-rem-panel',stats:'certs-stats-panel'};
  tabs.forEach(t=>{
    const el=document.getElementById('ctab-'+t);
    if(el) el.classList.toggle('active',t===tab);
    const pEl=document.getElementById(panels[t]);
    if(pEl) pEl.style.display=t===tab?'':'none';
  });
  if(tab==='dash')  renderCertDash();
  if(tab==='list')  renderCertTable();
  if(tab==='form'&&!_skipFormInit) openCertForm();
  if(tab==='rem')   initCertReminders();
  if(tab==='stats') renderCertStats();
}

export function filterCerts(status){
  switchCertTab('list');
  setTimeout(()=>{
    const s=document.getElementById('ct-status');
    if(s){
      // map old status values to new dropdown values
      const map={'':'all','ok':'active','expiring':'expiring','expired':'expired','no-expiry':'no-expiry','nr':'nr'};
      s.value=map[status]||status||'all';
      _ctPage=1; renderCertTable();
    }
  },50);
}

// ════════════════════════════════════════════════════════════════
//  CERT TABLE  (◈ Certificates tab)
// ════════════════════════════════════════════════════════════════



export function calcCertStatus(c){
  if(c.notResponding) return{label:'NO RESPONSE',cls:'cpill-nr'};
  if(!c.expiryDate)   return{label:'NO DATE',cls:'cpill-missing'};
  const d=daysDiff(c.expiryDate);
  if(d<0)   return{label:'EXPIRED',cls:'cpill-expired'};
  if(d<=30) return{label:'EXPIRING',cls:'cpill-soon'};
  return{label:'ACTIVE',cls:'cpill-active'};
}

export function ctblApplyColVisibility(){
  const tbl=document.getElementById('cert-main-table'); if(!tbl)return;
  const rows=tbl.rows;
  const cbs=document.querySelectorAll('#ct-col-drop input[type=checkbox]');
  cbs.forEach((cb,i)=>{ cb.checked=!_ctblHidden.includes(i+1); });
  for(let i=0;i<rows.length;i++){
    for(let j=1;j<rows[i].cells.length-1;j++){
      rows[i].cells[j].style.display=_ctblHidden.includes(j)?'none':'';
    }
  }
}

export function ctblToggleCol(n){
  _ctblHidden.includes(n)?_ctblHidden=_ctblHidden.filter(c=>c!==n):_ctblHidden.push(n);
  localStorage.setItem('ctblHidden',JSON.stringify(_ctblHidden));
  ctblApplyColVisibility();
}

export function toggleCtblColDropdown(){
  const d=document.getElementById('ct-col-drop');
  if(d)d.style.display=d.style.display==='block'?'none':'block';
}

export function ctblReset(){_ctPage=1;renderCertTable();}

export function clearCertFilters(){
  ['ct-search','ct-type','ct-status','ct-from','ct-to','ct-landlord','ct-agent'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.value=el.tagName==='SELECT'?'all':'';
  });
  ctblReset();
}

export function ctblGetFiltered(all){
  const q=(document.getElementById('ct-search')?.value||'').toLowerCase();
  const status=document.getElementById('ct-status')?.value||'all';
  const type=document.getElementById('ct-type')?.value||'all';
  const from=document.getElementById('ct-from')?.value||'';
  const to=document.getElementById('ct-to')?.value||'';
  const ll=(document.getElementById('ct-landlord')?.value||'').toLowerCase();
  const ag=(document.getElementById('ct-agent')?.value||'').toLowerCase();
  const sort=document.getElementById('ct-sort')?.value||'exp-asc';

  let list=all.filter(c=>{
    if(q){
      const blob=`${c.certNum||''} ${c.address||''} ${c.landlord||''} ${c.phone||''} ${c.agent||''}`.toLowerCase();
      if(!blob.includes(q))return false;
    }
    if(ll && !(c.landlord||'').toLowerCase().includes(ll))return false;
    if(ag && !(c.agent||'').toLowerCase().includes(ag))return false;
    if(type!=='all' && c.type!==type)return false;
    if(from && c.expiryDate && c.expiryDate<from)return false;
    if(to   && c.expiryDate && c.expiryDate>to)return false;
    const st=calcCertStatus(c);
    if(status==='active'   && st.label!=='ACTIVE')return false;
    if(status==='expired'  && st.label!=='EXPIRED')return false;
    if(status==='expiring' && st.label!=='EXPIRING')return false;
    if(status==='no-expiry'&& c.expiryDate)return false;
    if(status==='nr'       && !c.notResponding)return false;
    if(status==='month'){
      const now=new Date(),d=new Date(c.expiryDate||'');
      if(!c.expiryDate||d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())return false;
    }
    if(status==='next'){
      const nm=new Date();nm.setMonth(nm.getMonth()+1);
      const d=new Date(c.expiryDate||'');
      if(!c.expiryDate||d.getMonth()!==nm.getMonth()||d.getFullYear()!==nm.getFullYear())return false;
    }
    return true;
  });

  list.sort((a,b)=>{
    if(sort==='exp-asc')  return (a.expiryDate||'9999')>(b.expiryDate||'9999')?1:-1;
    if(sort==='exp-desc') return (a.expiryDate||'0000')<(b.expiryDate||'0000')?1:-1;
    if(sort==='addr')     return (a.address||'').localeCompare(b.address||'');
    if(sort==='type')     return (a.type||'').localeCompare(b.type||'');
    return 0;
  });
  return list;
}

export async function renderCertTable(){
  const all=await dAll('certs');
  // Populate type dropdown
  const typeEl=document.getElementById('ct-type');
  if(typeEl&&typeEl.options.length<=1){
    const types=[...new Set(all.map(c=>c.type).filter(Boolean))].sort();
    typeEl.innerHTML='<option value="all">All Types</option>'+types.map(t=>`<option value="${t}">${t}</option>`).join('');
  }
  // Populate landlord datalist
  const llList=document.getElementById('ct-ll-list');
  if(llList){
    const lls=[...new Set(all.map(c=>c.landlord).filter(Boolean))].sort();
    llList.innerHTML=lls.map(l=>`<option value="${l}">`).join('');
  }
  // Populate agent datalist
  const agList=document.getElementById('ct-ag-list');
  if(agList){
    const ags=[...new Set(all.map(c=>c.agent).filter(Boolean))].sort();
    agList.innerHTML=ags.map(a=>`<option value="${a}">`).join('');
  }

  const filtered=ctblGetFiltered(all);
  const pgSize=parseInt(document.getElementById('ct-pgsize')?.value||'15');
  const totalPages=Math.max(1,Math.ceil(filtered.length/pgSize));
  if(_ctPage>totalPages)_ctPage=totalPages;
  const pageItems=filtered.slice((_ctPage-1)*pgSize,_ctPage*pgSize);

  document.getElementById('ct-pg-info').textContent=`${filtered.length} cert${filtered.length===1?'':'s'}`;
  document.getElementById('ct-total').textContent=filtered.length+' total';
  document.getElementById('ct-pg-num').textContent=`Page ${_ctPage} of ${totalPages}`;

  const tbody=document.getElementById('cert-tbody');
  if(!tbody)return;
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--txt3)"><div style="font-size:28px;margin-bottom:8px">◈</div>No certificates match filters</td></tr>`;
    return;
  }
  tbody.innerHTML=pageItems.map(c=>{
    const st=calcCertStatus(c);
    const d=c.expiryDate?daysDiff(c.expiryDate):null;
    const daysLbl=d===null?'—':d<0?`${Math.abs(d)}d ago`:`${d}d`;
    const daysColor=d===null?'var(--txt3)':d<0?'var(--red)':d<=30?'var(--yellow)':'var(--green)';
    const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'var(--acc)'};
    return`<tr>
      <td><input type="checkbox" class="ct-row-cb" value="${c.id}"></td>
      <td style="font-family:var(--fm);font-size:11px;color:var(--acc)">${c.certNum||'—'}</td>
      <td class="c-addr"><strong>${c.address||'—'}</strong></td>
      <td><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700"><span style="width:7px;height:7px;border-radius:50%;background:${ct.color};flex-shrink:0"></span>${c.type||'—'}</span></td>
      <td><span style="font-weight:700;color:${daysColor}">${formatDateUK(c.expiryDate)||'—'}</span><br><span style="font-size:10px;color:${daysColor}">${daysLbl}</span></td>
      <td><span class="cpill ${st.cls}">${st.label}</span></td>
      <td>${c.landlord||'—'}</td>
      <td>${c.phone?`<a href="tel:${c.phone}" style="color:var(--acc)">${c.phone}</a>`:'—'}</td>
      <td style="font-size:11px;color:var(--txt2)">${c.agent||'—'}</td>
      <td style="font-size:11px;color:var(--txt2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.notes||''}">${c.notes||''}</td>
      <td style="white-space:nowrap">
        ${c.email?`<span class="ctbl-action-ico" title="Email ${c.landlord||''}" onclick="certSendIndivEmail('${c.id}')">✉</span>`:''}
        ${c.phone?`<span class="ctbl-action-ico" title="WhatsApp ${c.phone}" onclick="certSendIndivWA('${c.id}')">📱</span>`:''}
        <span class="ctbl-action-ico" title="Edit" onclick="editCertRecord('${c.id}')">✎</span>
      </td>
    </tr>`;
  }).join('');
  ctblApplyColVisibility();
}

export function certPageNav(dir){
  _ctPage=Math.max(1,_ctPage+dir);
  renderCertTable();
}

export function toggleAllCerts(cb){
  document.querySelectorAll('.ct-row-cb').forEach(c=>c.checked=cb.checked);
}

export async function bulkNRToggle(){
  const checked=document.querySelectorAll('.ct-row-cb:checked');
  if(!checked.length)return toast('Select rows first','warn');
  for(const cb of checked){
    const c=await dGet('certs',cb.value);
    if(c){c.notResponding=!c.notResponding;await dPut('certs',c);}
  }
  toast(`NR toggled on ${checked.length} cert(s)`,'success');
  renderCertTable();
}

export async function bulkDeleteCerts(){
  const checked=document.querySelectorAll('.ct-row-cb:checked');
  if(!checked.length)return toast('Select rows first','warn');
  confirm2('Delete Certs',`Delete ${checked.length} selected certificate(s)?`,async()=>{
    for(const cb of checked) await dDel('certs',cb.value);
    toast(`${checked.length} cert(s) deleted`,'warn');
    renderCertTable(); updateBadges();
  });
}

export async function editCertRecord(id){
  const c=await dGet('certs',id); if(!c)return;
  openCertForm(c);
}

// ════════════════════════════════════════════════════════════════
//  CERT FORM (Add / Edit tab)
// ════════════════════════════════════════════════════════════════



export function openCertForm(existing){
  _editCertId=existing?.id||null;
  _selCertTypes=new Set(existing?.type?[existing.type]:[]);
  // Update title
  const titleEl=document.getElementById('cform-title');
  if(titleEl)titleEl.textContent=existing?`Edit Certificate — ${existing.certNum||existing.address||''}` :'Add Certificate';
  // Populate type chips
  renderCertTypeChips();
  // Fill fields
  const s=id=>document.getElementById(id);
  if(s('cf2-addr'))   s('cf2-addr').value=existing?.address||'';
  if(s('cf2-issue'))  s('cf2-issue').value=existing?.issueDate||TODAY();
  if(s('cf2-expiry')) s('cf2-expiry').value=existing?.expiryDate||'';
  if(s('cf2-certnum'))s('cf2-certnum').value=existing?.certNum||'';
  if(s('cf2-landlord'))s('cf2-landlord').value=existing?.landlord||'';
  if(s('cf2-email'))  s('cf2-email').value=existing?.email||'';
  if(s('cf2-phone'))  s('cf2-phone').value=existing?.phone||'+44';
  if(s('cf2-agent'))  s('cf2-agent').value=existing?.agent||'';
  if(s('cf2-notes'))  s('cf2-notes').value=existing?.notes||'';
  if(s('cf2-nr'))     s('cf2-nr').checked=existing?.notResponding||false;
  // PDF attachment status
  window._editCertModalId=_editCertId;
  renderCertPdfSection(_editCertId,existing?.pdfUrl||null);
  // Recent
  renderCertFormRecent();
  // Switch to form tab only if not already there
  switchCertTab('form',true);
}

export function renderCertTypeChips(){
  const grid=document.getElementById('ctype-grid-form'); if(!grid)return;
  const types=S.certTypes||[];
  const icoMap={'Gas Safety':'⛽','Electrical EICR':'⚡','Fire Alarm':'🔥','Emergency Lighting':'💡','PAT Testing':'🔌','EPC':'🏠','Legionella':'💧'};
  grid.innerHTML=types.map(t=>{
    const sel=_selCertTypes.has(t.name);
    return`<div class="ctype-btn ${sel?'sel':''}" style="--ct-col:${t.color||'var(--acc)'};${sel?`border-color:${t.color||'var(--acc)'}`:''}" onclick="ctypeToggle('${t.name}')">
      <div class="ctype-btn-ico">${icoMap[t.name]||'◈'}</div>
      <div class="ctype-btn-lbl">${t.name}</div>
      <div class="ctype-check" style="color:${t.color||'var(--acc)'}">✓</div>
    </div>`;
  }).join('');
}

export function ctypeToggle(name){
  if(_editCertId){ _selCertTypes.clear(); _selCertTypes.add(name); }
  else { _selCertTypes.has(name)?_selCertTypes.delete(name):_selCertTypes.add(name); }
  renderCertTypeChips();
}

export async function renderCertFormRecent(){
  const all=await dAll('certs');
  const recent=all.slice(-5).reverse();
  const el=document.getElementById('cf2-recent');
  if(!el)return;
  if(!recent.length){el.textContent='No recent additions';return;}
  el.innerHTML=recent.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:11px;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${c.address||'—'}</span>
    <span style="font-size:10px;background:var(--s2);padding:1px 6px;border-radius:8px;color:var(--txt3);flex-shrink:0">${c.type||''}</span>
  </div>`).join('');
}

export async function saveCertForm(){
  const g=id=>document.getElementById(id)?.value?.trim()||'';
  const addr=g('cf2-addr');
  if(!addr)return toast('Address is required','error');
  if(_selCertTypes.size===0)return toast('Select at least one cert type','error');

  const isSingle=_selCertTypes.size===1;
  let savedId=null;
  for(const type of _selCertTypes){
    const id=isSingle&&_editCertId ? _editCertId : uid();
    const c={
      id,
      address:addr, type,
      issueDate:g('cf2-issue'), expiryDate:g('cf2-expiry'),
      certNum:g('cf2-certnum'), landlord:g('cf2-landlord'),
      email:g('cf2-email'), phone:g('cf2-phone'),
      agent:g('cf2-agent'), notes:g('cf2-notes'),
      noExpiry:!g('cf2-expiry'),
      notResponding:document.getElementById('cf2-nr')?.checked||false
    };
    await dPut('certs',c);
    await logActivity(`Certificate ${_editCertId?'updated':'added'}: ${type} at ${addr}`,'cert');
    if(isSingle) savedId=id;
  }
  toast(`${_selCertTypes.size} certificate(s) saved`,'success');
  updateBadges();

  if(isSingle&&savedId){
    // Stay on the form so a PDF can be attached immediately — no need to
    // close and reopen just to unlock the upload button.
    _editCertId=savedId;
    window._editCertModalId=savedId;
    const saved=await dGet('certs',savedId);
    renderCertPdfSection(savedId,saved?.pdfUrl||null);
    renderCertFormRecent();
  }else{
    _editCertId=null; _selCertTypes=new Set();
    switchCertTab('list');
  }
}

export function cancelCertForm(){switchCertTab('list');}

// Address autofill
export async function updateCertAddrSugg(){
  const inp=document.getElementById('cf2-addr'); if(!inp)return;
  const val=inp.value.toLowerCase(); const drop=document.getElementById('cf2-addr-sugg'); if(!drop)return;
  if(val.length<2){drop.style.display='none';return;}
  const all=await dAll('certs');
  const matches=[...new Set(all.map(c=>c.address).filter(a=>a&&a.toLowerCase().includes(val)))].slice(0,6);
  if(!matches.length){drop.style.display='none';return;}
  drop.innerHTML=matches.map(m=>`<li onclick="document.getElementById('cf2-addr').value='${m.replace(/'/g,"\\'")}';document.getElementById('cf2-addr-sugg').style.display='none'" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">${m}</li>`).join('');
  drop.style.display='block';
}

// Contact autofill
export async function certContactSugg(fieldId){
  const inp=document.getElementById(fieldId); if(!inp)return;
  const val=inp.value.toLowerCase(); const drop=document.getElementById(fieldId+'-sugg'); if(!drop)return;
  if(val.length<2){drop.style.display='none';return;}
  const all=await dAll('certs');
  const seen=new Set(); const contacts=[];
  all.forEach(c=>{const sig=`${c.landlord}|${c.email}|${c.phone}`;if(!seen.has(sig)&&c.landlord){seen.add(sig);contacts.push(c);}});
  const field=fieldId.replace('cf2-','');
  const matches=contacts.filter(c=>(c[field]||'').toLowerCase().includes(val)).slice(0,5);
  if(!matches.length){drop.style.display='none';return;}
  drop.innerHTML=matches.map(c=>`<li onclick="certFillContact(${JSON.stringify({landlord:c.landlord,email:c.email,phone:c.phone,agent:c.agent}).replace(/"/g,'&quot;')})" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"><strong>${c.landlord||'—'}</strong><span style="color:var(--txt3);font-size:11px;margin-left:8px">${c.email||''}</span></li>`).join('');
  drop.style.display='block';
}

export function certFillContact(obj){
  const s=id=>document.getElementById(id);
  if(s('cf2-landlord'))s('cf2-landlord').value=obj.landlord||'';
  if(s('cf2-email'))   s('cf2-email').value=obj.email||'';
  if(s('cf2-phone'))   s('cf2-phone').value=obj.phone||'';
  if(s('cf2-agent'))   s('cf2-agent').value=obj.agent||'';
  document.querySelectorAll('.autofill-drop').forEach(d=>d.style.display='none');
  toast('Contact details auto-filled');
}

// Individual reminders from table
export async function certSendIndivEmail(id){
  const c=await dGet('certs',id); if(!c||!c.email)return toast('No email for this cert','warn');
  const diff=c.expiryDate?daysDiff(c.expiryDate):null;
  const expired=diff!==null&&diff<0;
  const subj=`${expired?'URGENT: ':'Reminder: '}Compliance Certificate — ${c.address}`;
  const body=`Hi ${c.landlord||'Client'},%0D%0A%0D%0AThe ${c.type} certificate for ${c.address} is ${expired?`EXPIRED (${Math.abs(diff)} days overdue)`:`expiring in ${diff} days on ${formatDateUK(c.expiryDate)}`}.%0D%0A%0D%0APlease confirm if you would like to book a renewal.%0D%0A%0D%0AThanks,\nDeepFlow`;
  window.location.href=`mailto:${c.email}?subject=${encodeURIComponent(subj)}&body=${body}`;
}

export async function certSendIndivWA(id){
  const c=await dGet('certs',id); if(!c||!c.phone)return toast('No phone for this cert','warn');
  const diff=c.expiryDate?daysDiff(c.expiryDate):null;
  const expired=diff!==null&&diff<0;
  let body=`*COMPLIANCE ALERT*\n\n*Property:* ${c.address}\n*Certificate:* ${c.type}\n`;
  body+=expired?`*Status:* EXPIRED (${formatDateUK(c.expiryDate)})\n\n`:`*Status:* Expiring on ${formatDateUK(c.expiryDate)}\n\n`;
  body+=`Please reply *YES* to renew.\n\nDeepFlow`;
  const phone=c.phone.replace(/\D/g,'').replace(/^0/,'44');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`,'_blank');
}

// ════════════════════════════════════════════════════════════════
//  STATISTICS  (📈 Statistics tab)
// ════════════════════════════════════════════════════════════════
export async function renderCertStats(){
  const all=await dAll('certs');
  const now=new Date();

  const total=all.length;
  const expired=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
  const expiring=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60);
  const active=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);
  const noDate=all.filter(c=>!c.expiryDate);
  const compPct=total?Math.round((active.length/total)*100):0;

  // KPI
  const kpiEl=document.getElementById('cst-kpis'); if(!kpiEl)return;
  const d30=new Date();d30.setDate(d30.getDate()+30);
  const d12m=new Date();d12m.setFullYear(d12m.getFullYear()+1);
  const wl30=all.filter(c=>{if(!c.expiryDate)return false;const d=new Date(c.expiryDate);return d>=now&&d<=d30;}).length;
  const wl12m=all.filter(c=>{if(!c.expiryDate)return false;const d=new Date(c.expiryDate);return d>=now&&d<=d12m;}).length;
  kpiEl.innerHTML=`
    <div class="cst-card" style="cursor:pointer" onclick="filterCerts('')">
      <div class="cst-title">Total Portfolio</div>
      <div style="font-family:var(--fh);font-size:28px;font-weight:800">${total}</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:3px">All certificates</div>
    </div>
    <div class="cst-card" style="cursor:pointer" onclick="filterCerts('active')">
      <div class="cst-title">Compliance Score</div>
      <div style="font-family:var(--fh);font-size:28px;font-weight:800;color:var(--green)">${compPct}%</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:3px">${active.length} active certs</div>
    </div>
    <div class="cst-card" style="cursor:pointer" onclick="filterCerts('expired')">
      <div class="cst-title">Critical — Expired</div>
      <div style="font-family:var(--fh);font-size:28px;font-weight:800;color:var(--red)">${expired.length}</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:3px">Requires action</div>
    </div>
    <div class="cst-card">
      <div class="cst-title">Workload Forecast</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:4px">
        <span style="font-family:var(--fh);font-size:24px;font-weight:800;color:var(--acc)">${wl30}</span>
        <span style="font-size:11px;color:var(--txt3)">next 30d</span>
        <span style="font-family:var(--fh);font-size:24px;font-weight:800;color:var(--blue)">${wl12m}</span>
        <span style="font-size:11px;color:var(--txt3)">next 12m</span>
      </div>
    </div>`;

  // ── Workload Forecast bars (SVG-free, pure CSS) ──
  const period=document.getElementById('cst-period')?.value||'12m';
  let monthsToScan=12,startM=now.getMonth(),startY=now.getFullYear();
  if(period==='6m')monthsToScan=6;
  if(period==='thisYear'){monthsToScan=12;startM=0;}
  if(period==='nextYear'){monthsToScan=12;startM=0;startY=now.getFullYear()+1;}
  const mData=Array.from({length:monthsToScan},(_,i)=>{
    const d=new Date(startY,startM+i,1);
    const key=d.toISOString().slice(0,7);
    return{key,label:d.toLocaleDateString('en-GB',{month:'short',year:period.includes('Year')?undefined:'2-digit'}),
      count:all.filter(c=>c.expiryDate&&c.expiryDate.startsWith(key)).length};
  });
  const maxM=Math.max(...mData.map(m=>m.count),1);
  const fcEl=document.getElementById('cst-forecast');
  const fcLblEl=document.getElementById('cst-forecast-lbl');
  if(fcEl&&fcLblEl){
    fcEl.innerHTML=mData.map(m=>{
      const h=Math.max(4,Math.round(m.count/maxM*96));
      const isNow=m.key===now.toISOString().slice(0,7);
      return`<div class="cst-bar-wrap"><div class="cst-bar-seg" style="height:${h}px;background:${isNow?'var(--acc)':'rgba(245,166,35,.35)'}" title="${m.label}: ${m.count} expiries" onclick="filterCerts('expiring')"></div></div>`;
    }).join('');
    fcLblEl.innerHTML=mData.map(m=>`<div class="cst-bar-lbl" style="flex:1;text-align:center">${m.label}</div>`).join('');
  }

  // ── Donut (SVG) ──
  const donut=document.getElementById('cst-donut');
  const lgd=document.getElementById('cst-donut-lgd');
  if(donut&&total>0){
    const segs=[
      {val:active.length,col:'var(--green)',lbl:'Active'},
      {val:expiring.length,col:'var(--yellow)',lbl:'Expiring'},
      {val:expired.length,col:'var(--red)',lbl:'Expired'},
      {val:noDate.length,col:'#8a9bc0',lbl:'No Date'},
    ];
    let angle=-90,cx=60,cy=60,r=46,inner=30;
    const toRad=d=>d*Math.PI/180;
    const segments=segs.map(s=>({...s,pct:s.val/total*360}));
    let paths='';
    segments.forEach(s=>{
      if(!s.val)return;
      const a1=toRad(angle),a2=toRad(angle+s.pct);
      const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
      const x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
      const ix1=cx+inner*Math.cos(a1),iy1=cy+inner*Math.sin(a1);
      const ix2=cx+inner*Math.cos(a2),iy2=cy+inner*Math.sin(a2);
      const lg=s.pct>180?1:0;
      paths+=`<path d="M${ix1},${iy1} A${inner},${inner} 0 ${lg},1 ${ix2},${iy2} L${x2},${y2} A${r},${r} 0 ${lg},0 ${x1},${y1} Z" fill="${s.col}" opacity=".9" style="cursor:pointer" title="${s.lbl}: ${s.val}"/>`;
      angle+=s.pct;
    });
    donut.innerHTML=`${paths}<text x="60" y="56" text-anchor="middle" style="font-family:var(--fh);font-size:16px;font-weight:800;fill:var(--txt1)">${total}</text><text x="60" y="70" text-anchor="middle" style="font-size:9px;fill:var(--txt3)">total</text>`;
    if(lgd) lgd.innerHTML=segs.filter(s=>s.val).map(s=>`<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${s.col};flex-shrink:0"></span>${s.lbl}: <strong>${s.val}</strong></div>`).join('');
  }

  // ── Type stacked bars ──
  const types=(S.certTypes||[]).map(t=>t.name);
  const typeEl=document.getElementById('cst-type-stack');
  if(typeEl){
    const typeData=types.map(t=>{
      const tc=all.filter(c=>c.type===t);
      const tAct=tc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>0).length;
      const tExp=tc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<=0).length;
      return{t,total:tc.length,act:tAct,exp:tExp};
    }).filter(t=>t.total>0);
    const maxT=Math.max(...typeData.map(t=>t.total),1);
    typeEl.innerHTML=typeData.map(t=>{
      const ct=(S.certTypes||[]).find(c=>c.name===t.t)||{color:'var(--acc)'};
      return`<div class="cst-rank-row">
        <div style="width:120px;font-size:12px;font-weight:600;color:var(--txt1);display:flex;align-items:center;gap:5px;flex-shrink:0"><span style="width:8px;height:8px;border-radius:50%;background:${ct.color}"></span>${t.t}</div>
        <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden;display:flex">
          <div style="width:${Math.round(t.act/maxT*100)}%;background:var(--green)"></div>
          <div style="width:${Math.round(t.exp/maxT*100)}%;background:var(--red)"></div>
        </div>
        <div style="font-size:11px;color:var(--txt3);width:30px;text-align:right;flex-shrink:0">${t.total}</div>
      </div>`;
    }).join('');
  }

  // ── Top Landlords ──
  const renderRanking=(data,targetId)=>{
    const map={}; data.forEach(c=>{const k=c.landlord;if(k)map[k]=(map[k]||0)+1;});
    const top=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const el=document.getElementById(targetId); if(!el)return;
    if(!top.length){el.innerHTML='<div style="color:var(--txt3);font-size:12px;padding:10px 0">No data yet</div>';return;}
    el.innerHTML=top.map(([name,count],i)=>`<div class="cst-rank-row">
      <div class="cst-rank-n ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
        <div style="height:3px;background:var(--border);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.round(count/top[0][1]*100)}%;background:var(--acc)"></div></div>
      </div>
      <div style="font-weight:700;font-size:12px;color:var(--txt2);flex-shrink:0">${count}</div>
    </div>`).join('');
  };
  renderRanking(all,'cst-landlords');

  // Top Agents
  const agMap={}; all.forEach(c=>{if(c.agent)agMap[c.agent]=(agMap[c.agent]||0)+1;});
  const topAg=Object.entries(agMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const agEl=document.getElementById('cst-agents'); if(agEl){
    agEl.innerHTML=topAg.length?topAg.map(([name,count],i)=>`<div class="cst-rank-row">
      <div class="cst-rank-n ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
        <div style="height:3px;background:var(--border);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.round(count/topAg[0][1]*100)}%;background:var(--blue)"></div></div>
      </div>
      <div style="font-weight:700;font-size:12px;color:var(--txt2);flex-shrink:0">${count}</div>
    </div>`).join(''):'<div style="color:var(--txt3);font-size:12px;padding:10px 0">No agents recorded</div>';
  }

  // ── At Risk ──
  const riskMap={}; expired.forEach(c=>{const n=c.landlord||c.agent||'Unknown';riskMap[n]=(riskMap[n]||0)+1;});
  const riskList=Object.entries(riskMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const riskEl=document.getElementById('cst-risk'); if(riskEl){
    riskEl.innerHTML=riskList.length?riskList.map(([name,count])=>`<tr style="cursor:pointer" onclick="filterCerts('expired')">
      <td style="padding:7px 4px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:var(--txt1)">${name}</td>
      <td style="padding:7px 4px;border-bottom:1px solid var(--border);text-align:right"><span style="background:rgba(224,82,82,.12);color:var(--red);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${count} exp.</span></td>
    </tr>`).join(''):'<tr><td colspan="2" style="padding:14px;text-align:center;color:var(--txt3);font-size:12px">✅ No expired certificates</td></tr>';
  }
}

// ════════════════════════════════════════════════════════════════
//  REMINDERS (📣 Reminders tab)
// ════════════════════════════════════════════════════════════════



export async function initCertReminders(){
  const all=await dAll('certs');
  const lls=[...new Set(all.map(c=>c.landlord).filter(Boolean))].sort();
  const ags=[...new Set(all.map(c=>c.agent).filter(Boolean))].sort();
  const llEl=document.getElementById('crem-landlord');
  const agEl=document.getElementById('crem-agent');
  if(llEl)llEl.innerHTML='<option value="">— Select Landlord —</option>'+lls.map(l=>`<option>${l}</option>`).join('');
  if(agEl)agEl.innerHTML='<option value="">— Select Agent —</option>'+ags.map(a=>`<option>${a}</option>`).join('');
}

export function setCremMode(mode){
  _cremMode=mode;
  document.getElementById('crem-btn-email')?.classList.toggle('active',mode==='email');
  document.getElementById('crem-btn-wa')?.classList.toggle('active',mode==='wa');
  document.getElementById('crem-output').style.display='none';
}

export async function generateBulkReminder(){
  const ll=document.getElementById('crem-landlord')?.value||'';
  const ag=document.getElementById('crem-agent')?.value||'';
  const cutoff=document.getElementById('crem-cutoff')?.value||'';
  if(!ll&&!ag)return toast('Select a landlord or agent first','warn');

  let all=await dAll('certs');
  let filtered=all.filter(c=>(ll&&c.landlord===ll)||(ag&&c.agent===ag));
  if(cutoff)filtered=filtered.filter(c=>c.expiryDate&&c.expiryDate<=cutoff);
  if(!filtered.length)return toast('No certificates found for this client','warn');
  filtered.sort((a,b)=>(a.expiryDate||'')>(b.expiryDate||'')?1:-1);

  const clientName=ll||ag||'Client';

  // FIX 9: Look up contact details from the directory (persons or agencies table) using
  // the selected name — NOT from filtered[0] which was reading the first cert's fields
  // and would use the wrong contact if certs came from different jobs with mixed details.
  let email='', phone='';
  if(ll){
    const persons=await dAll('persons');
    const match=persons.find(p=>p.name===ll||(p.roles||[]).includes('landlord')&&p.name===ll)
      || persons.find(p=>p.name===ll);
    email=match?.email||'';
    phone=match?.phone||match?.wa||'';
  } else if(ag){
    const agencies=await dAll('agencies');
    const agents=await dAll('agents');
    const agencyMatch=agencies.find(a=>a.name===ag);
    const agentMatch=agents.find(a=>a.name===ag);
    const contact=agencyMatch||agentMatch;
    email=contact?.email||'';
    phone=contact?.phone||contact?.wa||'';
  }
  // Fallback: if not found in directory, try the cert fields as last resort
  if(!email) email=filtered[0]?.email||'';
  if(!phone) phone=filtered[0]?.phone||'';

  const out=document.getElementById('crem-output');
  const preview=document.getElementById('crem-preview');
  const sendBtn=document.getElementById('crem-btn');
  const sendLink=document.getElementById('crem-link');
  out.style.display='block';

  if(_cremMode==='email'){
    _cremEmailLink=`mailto:${email}?subject=${encodeURIComponent('Urgent: Compliance Update — '+clientName)}`;
    let html=`<div style="font-family:Arial,sans-serif;color:#1e293b;font-size:14px;line-height:1.5">
      <p>Hi ${clientName},</p>
      <p>Please review the following certificates in your portfolio:</p>
      <table style="width:auto;min-width:400px;border-collapse:collapse;margin:16px 0;border:1px solid #cbd5e1">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:10px;border:1px solid #cbd5e1;text-align:left">Address</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Type</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Expiry</th>
          <th style="padding:10px;border:1px solid #cbd5e1">Status</th>
        </tr></thead><tbody>`;
    filtered.forEach(c=>{
      const diff=c.expiryDate?daysDiff(c.expiryDate):null;
      const isExp=diff!==null&&diff<0;
      const statusTxt=diff===null?'No Date':isExp?`${Math.abs(diff)} DAYS OVERDUE`:`${diff} days left`;
      const statusCol=diff===null?'#94a3b8':isExp?'#dc2626':diff<=30?'#d97706':'#16a34a';
      html+=`<tr><td style="padding:10px;border:1px solid #e2e8f0"><strong>${c.address||'—'}</strong></td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center">${c.type||'—'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center">${formatDateUK(c.expiryDate)||'—'}</td><td style="padding:10px;border:1px solid #e2e8f0;text-align:center;font-weight:800;color:${statusCol}">${statusTxt}</td></tr>`;
    });
    html+=`</tbody></table><p>Please confirm if we should proceed with renewal.</p><p>Thanks,<br><strong>DeepFlow</strong></p></div>`;
    preview.innerHTML=html;
    document.getElementById('crem-lbl').textContent='Email Preview (rich HTML)';
    if(sendBtn)sendBtn.textContent='Send Email';
    if(sendLink)sendLink.removeAttribute('href');
  } else {
    let body=`*COMPLIANCE ALERT*\n\nDear ${clientName},\n\nPlease review your expiring certificates:\n\n`;
    filtered.forEach(c=>{
      const isExp=c.expiryDate&&daysDiff(c.expiryDate)<0;
      body+=`*Property:* ${c.address}\n*Type:* ${c.type}\n*Status:* ${isExp?'*EXPIRED*':'Expiring'} (${formatDateUK(c.expiryDate)||'No date'})\n\n`;
    });
    body+=`Please reply *YES* to authorise renewal.\n\nDeepFlow`;
    preview.style.fontFamily='var(--fm)';
    preview.textContent=body;
    document.getElementById('crem-lbl').textContent='WhatsApp Message Preview';
    if(sendBtn){sendBtn.textContent='Open WhatsApp';}
    const cleanPhone=phone.replace(/\D/g,'').replace(/^0/,'44');
    if(sendLink&&phone)sendLink.href=`https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
  }
}

export function copyCremMsg(){
  const preview=document.getElementById('crem-preview');
  if(_cremMode==='email'){
    const range=document.createRange();range.selectNode(preview);
    window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    document.execCommand('copy');window.getSelection().removeAllRanges();
    toast('HTML copied — paste into Outlook/Gmail');
  } else {
    navigator.clipboard.writeText(preview.textContent||'').then(()=>toast('Message copied!')).catch(()=>toast('Could not copy','warn'));
  }
}

export function certSendEmail(e){
  if(_cremMode!=='email')return;
  e.preventDefault();
  const preview=document.getElementById('crem-preview');
  const range=document.createRange();range.selectNode(preview);
  window.getSelection().removeAllRanges();window.getSelection().addRange(range);
  document.execCommand('copy');window.getSelection().removeAllRanges();
  toast('Table copied! Opening email client…');
  setTimeout(()=>window.location.href=_cremEmailLink,500);
}

// ════════════════════════════════════════════════════════════════
//  IMPORT / EXPORT
// ════════════════════════════════════════════════════════════════
export function parseDateSmart(v){
  if(!v)return null;
  const s=v.trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const parts=s.split(/[\/\-\.]/);
  if(parts.length===3){
    let d=parseInt(parts[0]),m=parseInt(parts[1]),y=parseInt(parts[2]);
    if(parts[0].length===4){y=parseInt(parts[0]);m=parseInt(parts[1]);d=parseInt(parts[2]);}
    else if(y<100)y+=2000;
    if(m>=1&&m<=12&&d>=1&&d<=31)return`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const dt=new Date(s);
  if(!isNaN(dt.getTime()))return dt.toISOString().split('T')[0];
  return null;
}

export async function importCertCSV(event){
  const file=event.target.files[0]; if(!file)return;
  const overlay=document.getElementById('cimport-overlay');
  const title=document.getElementById('cimport-title');
  const sub=document.getElementById('cimport-sub');
  const fill=document.getElementById('cimport-fill');
  const reasons=document.getElementById('cimport-reasons');
  const closeBtn=document.getElementById('cimport-close');
  overlay.style.display='flex';
  title.textContent='Reading file…'; sub.textContent='Please wait…';
  fill.style.width='0%'; reasons.style.display='none'; reasons.innerHTML=''; closeBtn.style.display='none';

  const reader=new FileReader();
  reader.onload=async function(e){
    title.textContent='Parsing data…'; fill.style.width='20%';
    const lines=e.target.result.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<=1){overlay.style.display='none';return toast('Empty CSV','error');}

    const parseLine=line=>{
      const parts=[]; let cur=''; let inQ=false;
      for(const ch of line){
        if(ch==='"')inQ=!inQ;
        else if(ch===','&&!inQ){parts.push(cur.trim());cur='';}
        else cur+=ch;
      }
      parts.push(cur.trim()); return parts;
    };

    const header=parseLine(lines[0]);
    const colMap={}; header.forEach((h,i)=>colMap[h.toLowerCase().replace(/['"]/g,'').trim()]=i);
    const gi=names=>{for(const n of names)if(colMap[n]!==undefined)return colMap[n];return -1;};
    const idx={addr:gi(['address','property address','addr']),type:gi(['type','certificate type','cert type']),
      exp:gi(['expiry','expiry date','expiry_date','date']),landlord:gi(['landlord','landlord name']),
      email:gi(['email','email address']),phone:gi(['phone','phone number','mobile']),
      agent:gi(['agent','agent details','agency']),notes:gi(['notes','comments','comment']),
      certnum:gi(['cert no','cert #','certificate number','cert number'])};

    const existing=await dAll('certs');
    let added=0,skipped=0; const skipLog=[];

    for(let i=1;i<lines.length;i++){
      const p=parseLine(lines[i]);
      const addr=idx.addr>=0?p[idx.addr]?.replace(/^"|"$/g,'')?.trim():'';
      const type=idx.type>=0?p[idx.type]?.replace(/^"|"$/g,'')?.trim():'';
      const expRaw=idx.exp>=0?p[idx.exp]?.replace(/^"|"$/g,'')?.trim():'';
      if(!addr||!type){skipped++;skipLog.push(`Row ${i+1}: Missing address or type`);continue;}
      const exp=parseDateSmart(expRaw);
      if(expRaw&&!exp){skipped++;skipLog.push(`Row ${i+1}: Invalid date "${expRaw}"`);continue;}
      // Duplicate check
      const isDup=existing.some(c=>
        (c.address||'').toLowerCase()===(addr||'').toLowerCase()&&
        (c.type||'').toLowerCase()===(type||'').toLowerCase()&&
        c.expiryDate===exp
      );
      if(isDup){skipped++;skipLog.push(`Row ${i+1}: Duplicate (${addr})`);continue;}

      const rec={id:uid(),address:addr,type,expiryDate:exp||'',noExpiry:!exp,
        landlord:idx.landlord>=0?p[idx.landlord]?.replace(/^"|"$/g,'')||'':'',
        email:idx.email>=0?p[idx.email]?.replace(/^"|"$/g,'')||'':'',
        phone:idx.phone>=0?p[idx.phone]?.replace(/^"|"$/g,'')||'':'',
        agent:idx.agent>=0?p[idx.agent]?.replace(/^"|"$/g,'')||'':'',
        notes:idx.notes>=0?p[idx.notes]?.replace(/^"|"$/g,'')||'':'',
        certNum:idx.certnum>=0?p[idx.certnum]?.replace(/^"|"$/g,'')||'':'',
        notResponding:false,issueDate:''};
      await dPut('certs',rec);
      existing.push(rec);
      added++;
      const pct=20+Math.round((i/lines.length)*70);
      fill.style.width=pct+'%';
      sub.textContent=`Added: ${added} | Skipped: ${skipped}`;
    }

    fill.style.width='100%';
    title.textContent='Import Complete! ✅';
    sub.textContent=`Added: ${added} | Skipped: ${skipped}`;
    if(skipLog.length){reasons.style.display='block';reasons.innerHTML='<strong>Skipped info:</strong><br>'+skipLog.slice(0,60).join('<br>')+(skipLog.length>60?`<br>… +${skipLog.length-60} more`:'');}
    closeBtn.style.display='inline-block';
    updateBadges(); await logActivity(`CSV import: ${added} certs added`,'cert');
    event.target.value='';
  };
  reader.readAsText(file);
}

export async function exportCertCSV(){
  const all=await dAll('certs');
  const filtered=ctblGetFiltered(all);
  let csv='Cert No,Address,Type,Expiry,Status,Landlord,Email,Phone,Agent,Notes\n';
  filtered.forEach(c=>{
    const st=calcCertStatus(c);
    csv+=`"${c.certNum||''}","${c.address||''}","${c.type||''}","${formatDateUK(c.expiryDate)}","${st.label}","${c.landlord||''}","${c.email||''}","${c.phone||''}","${c.agent||''}","${(c.notes||'').replace(/"/g,'""')}"\n`;
  });
  const b=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`Certs_Export_${TODAY()}.csv`;a.click();
  toast(`${filtered.length} certs exported`,'success');
}

export async function exportCertPDF(){
  if(!window.jspdf)return toast('PDF library not loaded','error');
  if(!window.jspdf){toast('PDF library not loaded — please check your internet connection and try again','error');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('l','mm','a4');
  const all=await dAll('certs');
  const filtered=ctblGetFiltered(all);
  doc.setFontSize(16);doc.text('DeepFlow — Compliance Certificate Report',14,18);
  doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | ${filtered.length} records`,14,25);
  const rows=filtered.map(c=>{
    const st=calcCertStatus(c);
    return[c.certNum||'—',c.address||'—',c.type||'—',formatDateUK(c.expiryDate)||'—',st.label,c.landlord||'—',c.agent||'—'];
  });
  doc.autoTable({startY:30,head:[['Cert #','Address','Type','Expiry','Status','Landlord','Agent']],body:rows,theme:'striped',styles:{fontSize:8},headStyles:{fillColor:[15,23,42]}});
  doc.save(`Certs_Report_${TODAY()}.pdf`);
  toast(`PDF generated (${filtered.length} records)`,'success');
}

export function downloadCertTemplate(){
  const csv='Cert No,Address,Type,Expiry,Landlord,Email,Phone,Agent,Notes\n"GAS-001","10 Example Street, London","Gas Safety","31/12/2025","John Smith","john@example.com","+44 7700 000000","ABC Agency","Annual check"';
  const b=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='CertImport_Template.csv';a.click();
}

// waCertReminder — merged: full implementation is below at waCertReminder(id) line ~9828

export async function renderCertDash(){
  const allCerts=await dAll('certs');
  const allProps=S.properties||[];
  const now=new Date();

  const expired=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
  const _cw1=S.certWarnDays||30;const _cw2=(S.certWarnDays2||14)+_cw1;
  const expiring30=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=_cw1);
  const expiring60=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>_cw1&&daysDiff(c.expiryDate)<=_cw2);
  const noExpiry=allCerts.filter(c=>!c.expiryDate);
  const valid=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);

  // ── KPI cards ──
  const kpiData=[
    {val:allCerts.length,lbl:'Total Certs',sub:'across all properties',color:'var(--acc)',bar:'var(--acc)',filter:''},
    {val:valid.length,lbl:'Valid',sub:'expiry > 60 days',color:'var(--green)',bar:'var(--green)',filter:'ok'},
    {val:expiring30.length+expiring60.length,lbl:'Expiring Soon',sub:'within 60 days',color:'var(--yellow)',bar:'var(--yellow)',filter:'expiring'},
    {val:expired.length,lbl:'Expired',sub:'action required',color:'var(--red)',bar:'var(--red)',filter:'expired'},
    {val:noExpiry.length,lbl:'Missing Dates',sub:'to fill in',color:'#8a9bc0',bar:'#8a9bc0',filter:'no-expiry'},
  ];
  document.getElementById('cd-kpis').innerHTML=kpiData.map(k=>`
    <div class="cdash-kpi" onclick="filterCerts('${k.filter}')">
      <div class="cdash-kpi-val" style="color:${k.color}">${k.val}</div>
      <div class="cdash-kpi-lbl">${k.lbl}</div>
      <div class="cdash-kpi-sub">${k.sub}</div>
      <div class="cdash-kpi-bar" style="background:${k.bar}"></div>
    </div>`).join('');

  // ── Timeline: next 12 months ──
  const months=Array.from({length:12},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+i);
    return{
      key:d.toISOString().slice(0,7),
      label:d.toLocaleDateString('en-GB',{month:'short'}),
      year:d.getFullYear(),
      month:d.getMonth(),
    };
  });
  const monthCounts=months.map(m=>({
    ...m,
    expired:allCerts.filter(c=>c.expiryDate&&c.expiryDate.startsWith(m.key)&&daysDiff(c.expiryDate)<0).length,
    expiring:allCerts.filter(c=>c.expiryDate&&c.expiryDate.startsWith(m.key)&&daysDiff(c.expiryDate)>=0).length,
  }));
  const maxBar=Math.max(...monthCounts.map(m=>m.expired+m.expiring),1);
  const tl=document.getElementById('cd-timeline');
  const tll=document.getElementById('cd-timeline-labels');
  tl.innerHTML=monthCounts.map(m=>{
    const total=m.expired+m.expiring;
    const expH=total?Math.max(4,(m.expired/maxBar)*60):0;
    const expgH=total?Math.max(4,(m.expiring/maxBar)*60):0;
    const isNow=m.key===new Date().toISOString().slice(0,7);
    return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;position:relative" title="${m.label}: ${m.expired} expired, ${m.expiring} expiring" onclick="filterCerts('expiring')">
      ${m.expired?`<div style="width:100%;height:${expH}px;background:var(--red);border-radius:3px 3px 0 0;opacity:.85"></div>`:''}
      ${m.expiring?`<div style="width:100%;height:${expgH}px;background:var(--yellow);border-radius:${m.expired?'0':'3px 3px'} 0 0;opacity:.85"></div>`:''}
      ${!total?`<div style="width:100%;height:4px;background:var(--border);border-radius:3px"></div>`:''}
      ${isNow?`<div style="width:2px;height:100%;background:var(--acc);position:absolute;top:0;left:50%;transform:translateX(-50%);pointer-events:none;opacity:.5;border-radius:1px"></div>`:''}
    </div>`;
  }).join('');
  tll.innerHTML=monthCounts.map(m=>`<div style="flex:1;text-align:center;font-size:9px;color:var(--txt3)">${m.label}</div>`).join('');

  // ── Expired panel ──
  const expEl=document.getElementById('cd-expired');
  if(expired.length){
    expEl.innerHTML=expired.slice(0,8).map(c=>{
      const d=Math.abs(daysDiff(c.expiryDate));
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'var(--red)'};
      return`<div class="cdash-row" onclick="switchCertTab('list')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||'var(--red)'};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type}${c.certNum?' · #'+c.certNum:''} · 👤 ${c.landlord||'—'}</div>
        </div>
        <div class="cdash-row-right">
          <div style="font-size:12px;font-weight:700;color:var(--red)">${d}d ago</div>
          <div style="font-size:10px;color:var(--txt3)">${c.expiryDate}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="createRenewalJob('${c.id}');event.stopPropagation()" style="font-size:10px;white-space:nowrap">Renew</button>
      </div>`;
    }).join('')+(expired.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="filterCerts('expired')">+${expired.length-8} more →</div>`:'');
  } else {
    expEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">No expired certificates</div></div>';
  }

  // ── Expiring panel ──
  const expiringAll=[...expiring30,...expiring60].sort((a,b)=>daysDiff(a.expiryDate)-daysDiff(b.expiryDate));
  const expgEl=document.getElementById('cd-expiring');
  if(expiringAll.length){
    expgEl.innerHTML=expiringAll.slice(0,8).map(c=>{
      const d=daysDiff(c.expiryDate);
      const col=d<=14?'var(--red)':d<=30?'var(--yellow)':'#f0a030';
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:col};
      return`<div class="cdash-row" onclick="switchCertTab('list')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||col};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type}${c.certNum?' · #'+c.certNum:''} · 👤 ${c.landlord||'—'}</div>
        </div>
        <div class="cdash-row-right">
          <div style="font-size:12px;font-weight:700;color:${col}">${d}d left</div>
          <div style="font-size:10px;color:var(--txt3)">${c.expiryDate}</div>
        </div>
        <button class="btn btn-acc btn-xs" onclick="createRenewalJob('${c.id}');event.stopPropagation()" style="font-size:10px;white-space:nowrap">Renew</button>
      </div>`;
    }).join('')+(expiringAll.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="filterCerts('expiring')">+${expiringAll.length-8} more →</div>`:'');
  } else {
    expgEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">Nothing expiring in 60 days</div></div>';
  }

  // ── Missing expiry panel ──
  const misEl=document.getElementById('cd-missing');
  if(noExpiry.length){
    misEl.innerHTML=noExpiry.slice(0,8).map(c=>{
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'#8a9bc0'};
      return`<div class="cdash-row" onclick="addExpiryToExistingCert('${c.id}')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||'#8a9bc0'};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type} · 👤 ${c.landlord||'—'}${c.jobNum?' · Job: '+c.jobNum:''}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="addExpiryToExistingCert('${c.id}');event.stopPropagation()" style="color:var(--yellow);border-color:var(--yellow);font-size:10px;white-space:nowrap">+ Add Date</button>
      </div>`;
    }).join('')+(noExpiry.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="filterCerts('no-expiry')">+${noExpiry.length-8} more →</div>`:'');
  } else {
    misEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">All certs have expiry dates</div></div>';
  }

  // ── By cert type breakdown ──
  const typeEl=document.getElementById('cd-by-type');
  const certTypes=S.certTypes||[];
  const typeData=certTypes.map(ct=>{
    const typeCerts=allCerts.filter(c=>c.type===ct.name);
    const typeExp=typeCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0).length;
    const typeExpg=typeCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60).length;
    const typeMiss=typeCerts.filter(c=>!c.expiryDate).length;
    return{ct,total:typeCerts.length,expired:typeExp,expiring:typeExpg,missing:typeMiss};
  }).filter(t=>t.total>0);

  const maxType=Math.max(...typeData.map(t=>t.total),1);
  typeEl.innerHTML=typeData.length?`<div class="cdash-type-bar">`+typeData.map(t=>{
    const barW=Math.round(t.total/maxType*100);
    const expPct=t.total?Math.round(t.expired/t.total*100):0;
    const expgPct=t.total?Math.round(t.expiring/t.total*100):0;
    const missPct=t.total?Math.round(t.missing/t.total*100):0;
    const validPct=100-expPct-expgPct-missPct;
    return`<div class="cdash-type-row" onclick="switchCertTab('list');setTimeout(()=>{const s=document.getElementById('ct-type');if(s){s.value='${t.ct.name}';renderCertTable();}},60)" style="cursor:pointer">
      <div class="cdash-type-name">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.ct.color||'var(--acc)'};margin-right:5px"></span>
        ${t.ct.name}
      </div>
      <div class="cdash-type-track" title="${t.total} certs: ${t.expired} expired, ${t.expiring} expiring, ${t.missing} missing">
        <div style="display:flex;height:100%;width:100%">
          ${expPct?`<div style="width:${expPct}%;background:var(--red)"></div>`:''}
          ${expgPct?`<div style="width:${expgPct}%;background:var(--yellow)"></div>`:''}
          ${missPct?`<div style="width:${missPct}%;background:#8a9bc0"></div>`:''}
          ${validPct>0?`<div style="width:${validPct}%;background:var(--green)"></div>`:''}
        </div>
      </div>
      <div class="cdash-type-count">${t.total}</div>
    </div>`;
  }).join('')+'</div>'
  :'<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">No cert types configured yet</div>';

  // ── Properties cert status grid ──
  const propGrid=document.getElementById('cd-prop-grid');
  if(allProps.length){
    const allJobsDb=await dAll('jobs');
    propGrid.innerHTML=allProps.map(p=>{
      const key=(p.address||'').toLowerCase().slice(0,20);
      const pc=allCerts.filter(c=>c.address&&c.address.toLowerCase().includes(key));
      const pExp=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
      const pExpg=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60);
      const pMiss=pc.filter(c=>!c.expiryDate);
      const pValid=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);
      const statusCol=pExp.length?'var(--red)':pExpg.length?'var(--yellow)':pMiss.length?'#8a9bc0':pc.length?'var(--green)':'var(--txt3)';
      const statusIco=pExp.length?'❌':pExpg.length?'⚠️':pMiss.length?'📋':pc.length?'✅':'—';
      const openJobs=(allJobsDb||[]).filter(j=>j.address&&j.address.toLowerCase().includes(key)&&(j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS));
      // Next expiry
      const nextExp=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate))[0];
      return`<div onclick="nav('props')" style="background:var(--s1);border:1px solid ${statusCol==='var(--txt3)'?'var(--border)':statusCol+'55'};border-left:3px solid ${statusCol};border-radius:var(--r2);padding:10px 12px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s1)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px">
          <div style="font-size:12px;font-weight:700;color:var(--txt1);line-height:1.3">${p.address||'—'}</div>
          <span style="font-size:14px;flex-shrink:0">${statusIco}</span>
        </div>
        <div style="font-size:11px;color:var(--txt2);margin-bottom:6px">👤 ${p.landlord||'No landlord'}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${pc.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(37,213,142,.12);color:var(--green)">◈ ${pc.length} cert${pc.length===1?'':'s'}</span>`:'<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--s2);color:var(--txt3)">No certs</span>'}
          ${pExp.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(224,82,82,.12);color:var(--red)">❌ ${pExp.length} expired</span>`:''}
          ${pExpg.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(240,192,48,.12);color:var(--yellow)">⚠️ ${pExpg.length} expiring</span>`:''}
          ${pMiss.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(138,155,192,.12);color:#8a9bc0">📋 ${pMiss.length} missing</span>`:''}
          ${openJobs.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(91,142,240,.12);color:var(--blue)">⊞ ${openJobs.length} open job${openJobs.length===1?'':'s'}</span>`:''}
        </div>
        ${nextExp?`<div style="font-size:10px;color:var(--txt3);margin-top:5px">Next expiry: <strong style="color:${daysDiff(nextExp.expiryDate)<=30?'var(--yellow)':'var(--txt2)'}">${nextExp.expiryDate}</strong> (${nextExp.type})</div>`:''}
      </div>`;
    }).join('');
  } else {
    propGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:28px;color:var(--txt3);font-size:13px">No properties added yet. <a onclick="nav(\'pg-props\')" style="color:var(--acc);cursor:pointer">Add properties →</a></div>';
  }
}

export function filterMissingExpiry(){filterCerts('no-expiry');}

export async function addExpiryToExistingCert(id){
  const c=await dGet('certs',id);
  if(!c)return;
  const ctDef=(S.certTypes||[]).find(ct=>ct.name===c.type)||{validity:12};
  const defExp=new Date();defExp.setMonth(defExp.getMonth()+(ctDef.validity||12));
  // Use the cert expiry modal in single-cert mode
  window._editCertId=id;
  window._currentCertType={name:c.type,color:ctDef.color||'var(--acc)',prefix:ctDef.prefix||''};
  setPendCertJob({address:c.address,referrer:c.landlord||''});
  document.getElementById('ce-type-name').textContent=c.type;
  document.getElementById('ce-address').textContent=c.address;
  document.getElementById('ce-remaining').textContent='Adding expiry date to existing certificate';
  document.getElementById('ce-expiry').value=defExp.toISOString().slice(0,10);
  document.getElementById('ce-certnum').value=c.certNum||'';
  document.getElementById('ce-issue').value=c.issueDate||TODAY();
  document.getElementById('ce-color-dot').style.background=ctDef.color||'var(--acc)';
  const _moCE=document.getElementById('mo-cert-expiry');
  const _saveBtn=_moCE.querySelector('.btn.btn-acc');
  const _skipBtn=_moCE.querySelector('.btn.btn-ghost');
  const _restoreDefaults=()=>{
    // Undo both overrides below so this single-cert-edit mode can never leak
    // into the separate (currently unused) multi-cert queue flow, which
    // relies on these same two buttons pointing at saveCertExpiry/skipCertExpiry.
    _saveBtn.onclick=saveCertExpiry;
    _skipBtn.onclick=skipCertExpiry;
    window._editCertId=null;
    setPendCertJob(null);
  };
  _saveBtn.onclick=async function(){
    const expiry=document.getElementById('ce-expiry').value;
    const certNum=document.getElementById('ce-certnum').value;
    const issue=document.getElementById('ce-issue').value;
    c.expiryDate=expiry;c.certNum=certNum||c.certNum;c.issueDate=issue;c.noExpiry=!expiry;
    await dPut('certs',c);
    closeModal('mo-cert-expiry');
    if(_certTab==='list')renderCertTable();else if(_certTab==='dash')renderCertDash();
    toast('Expiry date saved','success');
    _restoreDefaults();
  };
  // BUG FIX: this button previously still ran the default skipCertExpiry(),
  // which calls createCertEntry() using the placeholder {address,referrer}
  // object above (no real job id). createCertEntry()'s duplicate guard
  // compares against that missing id, never matches the certificate we're
  // actually editing, and silently creates a brand-new duplicate certificate
  // with no expiry date every time "Skip" was clicked here. In this
  // edit-an-existing-certificate mode there is nothing to skip-and-create —
  // the certificate already exists — so this just closes the modal.
  _skipBtn.onclick=function(){
    closeModal('mo-cert-expiry');
    _restoreDefaults();
  };
  openModal('mo-cert-expiry');
}

export async function openEditCert(id){
  const c=await dGet('certs',id);
  if(!c)return;
  // Use the add cert modal for editing
  document.getElementById('cf-addr').value=c.address||'';
  document.getElementById('cf-ll').value=c.landlord||'';
  document.getElementById('cf-issue').value=c.issueDate||TODAY();
  document.getElementById('cf-expiry').value=c.expiryDate||'';
  document.getElementById('cf-num').value=c.certNum||'';
  document.getElementById('cf-notes').value=c.notes||'';
  // Set type select
  const ts=document.getElementById('cf-type');
  if(ts) ts.value=c.type||ts.options[0]?.value||'';
  window._editCertModalId=id;
  renderCertPdfSection(id,c.pdfUrl||null);
  openModal('mo-cert');
}

// ── Certificate PDF upload/remove/status — lets office staff attach the
// actual signed compliance document so the client can download it from their
// portal. Upload requires a real, already-saved certificate id (Storage
// writes need something stable to attach to), so this is only available when
// editing an existing certificate — a brand-new one shows a short message
// instead until it's been saved once.
export function renderCertPdfSection(certId,url){
  const wraps=['cf-pdf-wrap','cf2-pdf-wrap'].map(id=>document.getElementById(id)).filter(Boolean);
  if(!wraps.length) return;
  if(!certId){
    wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px">Save the certificate first, then reopen it to attach a PDF.</span>`);
    return;
  }
  if(url){
    wraps.forEach(wrap=>wrap.innerHTML=`<button type="button" class="btn btn-ghost btn-sm" onclick="previewCertPdf('${url}')">📄 View Current PDF</button>
      <button class="btn btn-red btn-xs" onclick="removeCertPdf()" style="margin-left:6px">Remove</button>
      <label class="btn btn-ghost btn-xs" style="margin-left:6px;cursor:pointer">Replace<input type="file" accept="application/pdf" style="display:none" onchange="uploadCertPdf(this)"></label>`);
  }else{
    wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px;margin-right:8px">No document uploaded yet</span>
      <label class="btn btn-acc btn-sm" style="cursor:pointer">⬆ Upload PDF<input type="file" accept="application/pdf" style="display:none" onchange="uploadCertPdf(this)"></label>`);
  }
}

export function previewCertPdf(url){
  document.getElementById('pdf-preview-frame').src=url;
  document.getElementById('pdf-preview-open').href=url;
  document.getElementById('pdf-preview-download').href=url;
  openModal('mo-pdf-preview');
}

export async function uploadCertPdf(inputEl){
  const certId=window._editCertModalId;
  if(!certId){ toast('Save the certificate first, then attach the PDF','warn'); inputEl.value=''; return; }
  const file=inputEl.files[0];
  inputEl.value='';
  if(!file) return;
  const looksLikePdf=(file.type==='application/pdf')||file.name.toLowerCase().endsWith('.pdf');
  if(!looksLikePdf){ toast('Please choose a PDF file','error'); return; }
  if(file.size>25*1024*1024){ toast(`File too large (${(file.size/1024/1024).toFixed(1)}MB) — 25MB max`,'error'); return; }
  const wraps=['cf-pdf-wrap','cf2-pdf-wrap'].map(id=>document.getElementById(id)).filter(Boolean);
  wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px">Uploading…</span>`);
  try{
    const path=`certs/${certId}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.pdf`;
    const url=await sbStorage(path,file);
    await _sb(`certs?id=eq.${encodeURIComponent(certId)}`,{method:'PATCH',body:{pdf_url:url,pdf_path:path},prefer:'return=minimal'});
    renderCertPdfSection(certId,url);
    toast('✅ Certificate PDF uploaded','success');
    logActivity(`Certificate PDF uploaded for ${document.getElementById('cf-addr')?.value||'certificate'}`,'cert');
  }catch(e){
    toast('❌ Upload failed: '+(e.message||'').slice(0,80),'error');
    renderCertPdfSection(certId,null);
  }
}

export async function removeCertPdf(){
  const certId=window._editCertModalId;
  if(!certId) return;
  confirm2('Remove Certificate PDF','Delete the uploaded PDF for this certificate? The client will no longer be able to download it.',async()=>{
    try{
      const c=await dGet('certs',certId);
      if(c?.pdfPath){
        const jwt=await _getJWT();
        fetch(`${SB_URL}/storage/v1/object/deepflow/${c.pdfPath}`,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt}}).catch(()=>{});
      }
      await _sb(`certs?id=eq.${encodeURIComponent(certId)}`,{method:'PATCH',body:{pdf_url:null,pdf_path:null},prefer:'return=minimal'});
      renderCertPdfSection(certId,null);
      toast('PDF removed','warn');
    }catch(e){ toast('Could not remove PDF','error'); }
  });
}

export async function waCertReminder(id){
  const c=await dGet('certs',id);
  if(!c)return;
  const d=daysDiff(c.expiryDate);
  const msg=`Hello,\n\nThis is a reminder from *${S.coName||'Us'}* that your *${c.type} Certificate* for the property at *${c.address}* is ${d<0?'expired!':'expiring in '+d+' days.'}\n\nExpiry Date: *${c.expiryDate}*\n\nPlease contact us to arrange a renewal.\n📞 ${S.coPhone||''}\n\nThank you.`;
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value='';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

export function openCertModal(){
  window._editCertModalId=null;
  window._certLinkedJob=null;
  const d=new Date();d.setFullYear(d.getFullYear()+1);
  document.getElementById('cf-addr').value='';document.getElementById('cf-ll').value='';
  document.getElementById('cf-issue').value=TODAY();document.getElementById('cf-expiry').value=d.toISOString().slice(0,10);
  document.getElementById('cf-num').value='';document.getElementById('cf-notes').value='';
  document.getElementById('cf-job-id').value='';
  document.getElementById('cf-job-num').value='';
  document.getElementById('cf-job-banner').style.display='none';
  // Populate type dropdown from S.certTypes
  const ts=document.getElementById('cf-type');
  if(ts) ts.innerHTML=(S.certTypes||[]).map(ct=>`<option value="${ct.name}">${ct.name}</option>`).join('')||'<option>Other</option>';
  renderCertPdfSection(null,null);
  openModal('mo-cert');
}

// FIX 10 helper: open cert form pre-filled and linked to a specific job.
// Call this instead of openCertModal() when creating a cert from a completed job.
export async function openCertModalFromJob(jobId, jobNum, prefill={}){
  openCertModal(); // resets everything first
  window._certLinkedJob={id:jobId, jobnum:jobNum};
  document.getElementById('cf-job-id').value=jobId||'';
  document.getElementById('cf-job-num').value=jobNum||'';
  if(jobNum){
    document.getElementById('cf-job-banner').style.display='block';
    document.getElementById('cf-job-banner-num').textContent=jobNum;
  }
  // Pre-fill address, landlord etc from job if provided
  if(prefill.address) document.getElementById('cf-addr').value=prefill.address;
  if(prefill.landlord) document.getElementById('cf-ll').value=prefill.landlord;
  if(prefill.type){
    const ts=document.getElementById('cf-type');
    if(ts){const opt=[...ts.options].find(o=>o.value===prefill.type);if(opt)ts.value=opt.value;}
  }
}
export async function saveCert(){
  const certId=window._editCertModalId||uid();

  // FIX 10: Capture optional job link. When the cert modal is opened from a job context
  // (e.g. the future "create cert from completed job" prompt), the caller sets
  // window._certLinkedJob = {id, jobnum}. We store both fields on the cert record so
  // certs and jobs are permanently linked and can be navigated between.
  const linkedJob=window._certLinkedJob||null;

  const c={
    id:certId,
    address:document.getElementById('cf-addr').value.trim(),
    type:document.getElementById('cf-type').value,
    landlord:document.getElementById('cf-ll').value.trim(),
    issueDate:document.getElementById('cf-issue').value,
    expiryDate:document.getElementById('cf-expiry').value,
    certNum:document.getElementById('cf-num').value,
    notes:document.getElementById('cf-notes').value,
    noExpiry:!document.getElementById('cf-expiry').value,
    // Job link fields — null when cert created standalone, populated when from a job
    jobId:linkedJob?.id||document.getElementById('cf-job-id')?.value||null,
    jobNum:linkedJob?.jobnum||document.getElementById('cf-job-num')?.value||null,
  };
  if(!c.address){toast('Address required','error');return}
  await dPut('certs',c);
  await logActivity(`Certificate ${window._editCertModalId?'updated':'added'}: ${c.type} at ${c.address}${c.jobNum?' (Job '+c.jobNum+')':''}`, 'cert');
  window._editCertModalId=null;
  window._certLinkedJob=null;
  closeModal('mo-cert');
  if(_certTab==='list')renderCertTable();else if(_certTab==='dash')renderCertDash();
  updateBadges();
  toast('Certificate saved'+(c.jobNum?' — linked to job '+c.jobNum:''),'success');
}
export async function delCert(id){
  confirm2('Delete Certificate','Remove this certificate permanently?',async()=>{
    await dDel('certs',id);if(_certTab==='list')renderCertTable();else if(_certTab==='dash')renderCertDash();updateBadges();toast('Deleted','warn');
  });
}
export async function createRenewalJob(certId){
  const c=await dGet('certs',certId);
  if(!c)return;
  const j={id:uid(),date:TODAY(),address:c.address,referrer:c.landlord||'',trade:'Gas',engineer:'',
    description:c.type+' Renewal',timeSlot:'',access:'',contact:'',hours:0,price:0,
    notes:'Auto-created from certificate renewal. Expiry was: '+c.expiryDate,
    priority:'Normal',status:STATUS.PENDING,created:Date.now(),modified:Date.now()};
  await dPut('jobs',j);
  await logActivity(`Renewal job created for ${c.address}`,'job');
  toast('Renewal job created on today\'s grid!','success');
  setJDate(TODAY());nav('jobs');
}

// ════════════════════════════════════════════════════════════════
