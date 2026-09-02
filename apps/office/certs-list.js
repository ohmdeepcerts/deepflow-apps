// Certificates list — the tab dispatcher (switchCertTab, which every other
// certs-* file's tab-open path routes through), the main cert table with
// its filters/columns/pagination, and its row-level bulk actions.
// Extracted from certs.js verbatim (Phase 2 of the follow-up modularization
// pass — see the plan file for scope) — no behaviour changes.
//
// This module and main.js (and the other certs-* files, for the tab
// dispatch) import from each other, same as every other extracted module:
// safe because every cross-module reference is used only inside function
// bodies, never at module-evaluation time.
//
// _certTab/getCertTab live here (not certs-core.js) because switchCertTab —
// the only thing that ever sets _certTab — lives here; same state-ownership
// reasoning as directory-sections.js owning curDirSection.

import { daysDiff, formatDateUK, localDateStr } from '@business';
import { S, dAll, dGet, dPut, dDel, toast, confirm2, updateBadges } from './main.js';
import { renderCertDash, renderCertStats } from './certs-stats-dashboard.js';
import { renderCertMissing, renderExpiringPanel } from './certs-missing-expiring.js';
import { openCertForm } from './certs-form.js';
import { initCertReminders } from './certs-reminders.js';

let _certTab='dash';
let _ctPage=1,_ctblHidden=[];

export function getCertTab(){ return _certTab; }

export function switchCertTab(tab,_skipFormInit){
  _certTab=tab;
  const tabs=['dash','missing','expiring','list','form','rem','stats'];
  const panels={dash:'certs-dash-panel',missing:'certs-missing-panel',expiring:'certs-expiring-panel',list:'certs-list-panel',form:'certs-form-panel',rem:'certs-rem-panel',stats:'certs-stats-panel'};
  tabs.forEach(t=>{
    const el=document.getElementById('ctab-'+t);
    if(el) el.classList.toggle('active',t===tab);
    const pEl=document.getElementById(panels[t]);
    if(pEl) pEl.style.display=t===tab?'':'none';
  });
  if(tab==='dash')     renderCertDash();
  if(tab==='missing')  renderCertMissing();
  if(tab==='expiring') renderExpiringPanel();
  if(tab==='list')     renderCertTable();
  if(tab==='form'&&!_skipFormInit) openCertForm();
  if(tab==='rem')      initCertReminders();
  if(tab==='stats')    renderCertStats();
}

// Jumps to the Expiring tab pre-filtered to a specific day-window (e.g. "due
// within 7 days") rather than the single 60-day default the tab normally
// opens to — lets office staff triage by urgency straight from the
// dashboard instead of manually setting the From/To filters every time.
export function goExpiryWindow(maxDays){
  switchCertTab('expiring');
  setTimeout(()=>{
    const from=document.getElementById('exp-from');
    const to=document.getElementById('exp-to');
    const status=document.getElementById('exp-status');
    if(from) from.value=localDateStr(new Date());
    if(to) to.value=localDateStr(new Date(Date.now()+maxDays*86400000));
    if(status) status.value='expiring';
    renderExpiringPanel();
  },50);
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
        ${(ct.hasAppliances&&(c.appliances||[]).length)?`<span class="ctbl-action-ico" title="Start a new test cycle" onclick="openRenewCertModal('${c.id}')">🔄</span>`:''}
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
  // Per-row try/catch so one bad row (RLS, network) can't abort the loop
  // mid-way and leave everything after it untouched with zero feedback --
  // same pattern as the job-side bulk actions (bulkSetStatus/bulkDeleteJobs).
  let done=0,failed=0;
  for(const cb of checked){
    try{
      const c=await dGet('certs',cb.value);
      if(c){c.notResponding=!c.notResponding;await dPut('certs',c);}
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow] bulkNRToggle failed for',cb.value,e); }
  }
  if(failed) toast(`⚠ NR toggled on ${done} of ${checked.length} — ${failed} failed`,'warn',5000);
  else toast(`NR toggled on ${done} cert(s)`,'success');
  renderCertTable();
}

export async function bulkDeleteCerts(){
  const checked=document.querySelectorAll('.ct-row-cb:checked');
  if(!checked.length)return toast('Select rows first','warn');
  confirm2('Delete Certs',`Delete ${checked.length} selected certificate(s)?`,async()=>{
    let done=0,failed=0;
    for(const cb of checked){
      try{ await dDel('certs',cb.value); done++; }
      catch(e){ failed++; console.warn('[DeepFlow] bulkDeleteCerts failed for',cb.value,e); }
    }
    if(failed) toast(`⚠ ${done} of ${checked.length} deleted — ${failed} failed`,'warn',5000);
    else toast(`${done} cert(s) deleted`,'warn');
    renderCertTable(); updateBadges();
  });
}

export async function editCertRecord(id){
  const c=await dGet('certs',id); if(!c)return;
  openCertForm(c);
}
