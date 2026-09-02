// PAT-style appliance test log — the per-cert table of tested appliances
// (add/edit/remove rows, bulk paste, photo extraction), certificate delete,
// and the two renewal flows (book a follow-up job, or start a fresh test
// cycle carrying the appliance list forward). Extracted from certs.js
// verbatim (Phase 2 of the follow-up modularization pass — see the plan file
// for scope), with one fix applied: delCert() previously read the
// module-private `_certTab` variable directly (broken — that variable lives
// in certs-list.js and was never reachable from here); it now goes through
// the already-exported `getCertTab()` accessor instead. `delCert` itself is
// exported but referenced nowhere in the app (confirmed dead code by the
// exploration pass) — moved verbatim rather than cleaned up, since removing
// dead code wasn't part of this modularization pass.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { SB_URL, SB_KEY } from '@core';
import { escAttr } from '@ui';
import { STATUS, formatDateUK, localDateStr } from '@business';
import {
  S, dGet, dPut, dDel, TODAY, toast, confirm2, uid, logActivity, closeModal,
  openModal, _getJWT, setJDate, nav, updateBadges,
} from './main.js';
import { getCertTab, renderCertTable } from './certs-list.js';
import { renderCertDash } from './certs-stats-dashboard.js';
import { _selCertTypes, _certAppliances, openCertForm } from './certs-form.js';

function calcNextTest(dateStr,months){
  if(!dateStr) return '';
  const [y,m,d]=dateStr.split('-').map(Number);
  if(!y||!m||!d) return '';
  const dt=new Date(y,m-1,d);
  dt.setMonth(dt.getMonth()+(Number(months)||12));
  return localDateStr(dt);
}

// Shown only when exactly one cert type is selected and that type has
// hasAppliances set — multi-type saves (new cert, several chips at once)
// each become a separate cert record, so there's no single record an
// appliance log could unambiguously belong to in that case.
export function toggleApplianceSection(){
  const section=document.getElementById('cf2-appliances-section');
  if(!section) return;
  const only = _selCertTypes.size===1 ? [..._selCertTypes][0] : null;
  const ct = only ? (S.certTypes||[]).find(c=>c.name===only) : null;
  section.style.display=ct?.hasAppliances?'':'none';
  if(ct?.hasAppliances) renderApplianceTable();
}

function renderApplianceTable(){
  const tbody=document.querySelector('#cf2-appliances-tbl tbody');
  if(!tbody) return;
  tbody.innerHTML=_certAppliances.map((a,i)=>`<tr>
    <td><input class="fi" value="${escAttr(a.assetId||'')}" style="padding:4px;width:70px" onchange="updateApplianceField(${i},'assetId',this.value)"></td>
    <td><input class="fi" value="${escAttr(a.description||'')}" style="padding:4px;min-width:150px" onchange="updateApplianceField(${i},'description',this.value)"></td>
    <td><input class="fi" value="${escAttr(a.testInstrument||'')}" style="padding:4px;width:100px" onchange="updateApplianceField(${i},'testInstrument',this.value)"></td>
    <td><input class="fi" type="date" value="${a.date||''}" style="padding:4px;width:130px" onchange="updateApplianceField(${i},'date',this.value)"></td>
    <td><input class="fi" type="number" value="${a.retestPeriod||12}" style="padding:4px;width:65px" onchange="updateApplianceField(${i},'retestPeriod',this.value)"></td>
    <td style="font-size:12px;color:var(--txt3);white-space:nowrap">${a.nextTest?formatDateUK(a.nextTest):'—'}</td>
    <td><select class="fs" style="padding:4px;width:80px" onchange="updateApplianceField(${i},'result',this.value)">
      <option ${a.result==='Pass'?'selected':''}>Pass</option>
      <option ${a.result==='Fail'?'selected':''}>Fail</option>
    </select></td>
    <td><button type="button" class="btn btn-red btn-xs" onclick="removeApplianceRow(${i})">✕</button></td>
  </tr>`).join('')||'<tr><td colspan="8" style="color:var(--txt3);font-size:12px;padding:8px">No appliances yet — add one below.</td></tr>';
}

export function addApplianceRow(){
  const today=TODAY();
  const period=12;
  // Auto-increment the asset ID from the last row, same convention as the
  // ported app: a trailing number gets incremented, e.g. A001 → A002.
  let nextId='';
  if(_certAppliances.length){
    const last=_certAppliances[_certAppliances.length-1];
    const m=(last.assetId||'').match(/^(.*?)(\d+)$/);
    nextId=m?m[1]+String(parseInt(m[2],10)+1).padStart(m[2].length,'0'):'';
  }
  _certAppliances.push({id:uid(),assetId:nextId,description:'',testInstrument:'',date:today,retestPeriod:period,nextTest:calcNextTest(today,period),result:'Pass'});
  renderApplianceTable();
}

export function updateApplianceField(i,field,value){
  const a=_certAppliances[i];
  if(!a) return;
  a[field]=field==='retestPeriod'?(+value||12):value;
  if(field==='date'||field==='retestPeriod') a.nextTest=calcNextTest(a.date,a.retestPeriod);
  renderApplianceTable();
}

export function removeApplianceRow(i){
  _certAppliances.splice(i,1);
  renderApplianceTable();
}

export function openBulkApplianceModal(){
  document.getElementById('ba-start-id').value='';
  document.getElementById('ba-descriptions').value='';
  openModal('mo-bulk-appliance');
}

export function submitBulkAppliances(){
  const startId=document.getElementById('ba-start-id').value.trim();
  const lines=document.getElementById('ba-descriptions').value.split('\n').map(l=>l.trim()).filter(Boolean);
  if(!lines.length){ toast('Enter at least one description','warn'); return; }
  const today=TODAY();
  const period=12;
  lines.forEach((desc,idx)=>{
    let assetId='';
    if(startId){
      const m=startId.match(/^(.*?)(\d+)$/);
      assetId=m?m[1]+String(parseInt(m[2],10)+idx).padStart(m[2].length,'0'):startId+(idx?'-'+(idx+1):'');
    }
    _certAppliances.push({id:uid(),assetId,description:desc,testInstrument:'',date:today,retestPeriod:period,nextTest:calcNextTest(today,period),result:'Pass'});
  });
  renderApplianceTable();
  closeModal('mo-bulk-appliance');
  toast(`${lines.length} appliance${lines.length>1?'s':''} added`,'success');
}

// Reads a photo of a (often handwritten) PAT appliance test log and
// appends one row per appliance found, via the extract-cert-data Edge
// Function with mode:'appliances' so it asks Gemini for a table of rows
// instead of one cert's header fields. Only assetId/description/result
// come back structured; instrument/date/retest period are filled with
// the same defaults addApplianceRow() uses, since a paper log essentially
// never varies those per row.
export async function extractAppliancesFromPhoto(inputEl){
  const file=inputEl.files[0];
  inputEl.value='';
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('Please choose a photo (JPG/PNG)','error'); return; }
  if(file.size>10*1024*1024){ toast(`File too large (${(file.size/1024/1024).toFixed(1)}MB) — 10MB max`,'error'); return; }
  const status=document.getElementById('cf2-appliance-scan-status');
  if(status) status.textContent='Reading appliance log…';
  try{
    const imageBase64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
      reader.onerror=reject;
      reader.readAsDataURL(file);
    });
    const jwt=await _getJWT();
    const res=await fetch(`${SB_URL}/functions/v1/extract-cert-data`,{
      method:'POST',
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
      body:JSON.stringify({imageBase64, mimeType:file.type, preferGemini:S.aiExtractEnabled!==false, mode:'appliances'})
    });
    const data=await res.json();
    if(!res.ok){ if(status) status.textContent=''; toast(data.error||'Could not read the appliance log','error'); return; }

    if(data.source==='gemini'){
      const rows=(data.appliances||[]).filter(a=>a.assetId||a.description);
      if(!rows.length){ if(status) status.textContent=''; toast('No appliances found in that photo','warn'); return; }
      const today=TODAY(), period=12;
      rows.forEach(a=>{
        _certAppliances.push({
          id:uid(), assetId:a.assetId||'', description:a.description||'',
          testInstrument:'', date:today, retestPeriod:period,
          nextTest:calcNextTest(today,period),
          result:a.result==='Pass'||a.result==='Fail'?a.result:'Pass',
        });
      });
      renderApplianceTable();
      if(status) status.textContent=`✅ ${rows.length} appliance${rows.length>1?'s':''} added — please double-check before saving`;
      toast(`📷 ${rows.length} appliance${rows.length>1?'s':''} read from photo`,'success');
    } else {
      // OCR fallback — text only, no structured rows. Show it so the user
      // can read the log off it and add rows manually.
      if(status) status.innerHTML=`⚠️ AI extraction unavailable — raw text below, please add rows manually:<div style="margin-top:6px;padding:8px;background:var(--s2);border-radius:6px;font-size:11px;white-space:pre-wrap;max-height:120px;overflow:auto">${(data.rawText||'').replace(/</g,'&lt;')}</div>`;
      toast('Could not auto-fill — showing raw text from the photo instead','warn');
    }
  }catch(e){
    if(status) status.textContent='';
    toast('❌ Extraction failed: '+(e.message||'').slice(0,80),'error');
  }
}

export async function delCert(id){
  confirm2('Delete Certificate','Remove this certificate permanently?',async()=>{
    await dDel('certs',id);if(getCertTab()==='list')renderCertTable();else if(getCertTab()==='dash')renderCertDash();updateBadges();toast('Deleted','warn');
  });
}
export async function createRenewalJob(certId){
  const c=await dGet('certs',certId);
  if(!c)return;
  const j={id:uid(),date:TODAY(),address:c.address,referrer:c.landlord||'',trade:'Gas',engineer:'',
    description:c.type+' Renewal',timeSlot:'',access:'',contact:'',price:0,
    notes:'Auto-created from certificate renewal. Expiry was: '+c.expiryDate,
    priority:'Normal',status:STATUS.PENDING,created:Date.now(),modified:Date.now()};
  await dPut('jobs',j);
  await logActivity(`Renewal job created for ${c.address}`,'job');
  toast('Renewal job created on today\'s grid!','success');
  setJDate(TODAY());nav('jobs');
}

// ── PAT RENEWAL — start a new test cycle ────────────────────────
// Unlike createRenewalJob() above (which just books a follow-up job),
// this starts a fresh certificate for a PAT-style cert: opens the Add
// Certificate form pre-filled with the same property/client details and
// appliance list as the source cert, ready for the engineer to actually
// retest. Descriptions/instrument/retest-period carry forward verbatim;
// date resets to today, result resets to Pass (nothing has been retested
// yet — office/engineer corrects any that fail after the real test), and
// next-test is recalculated. Never auto-saves — the office reviews and
// hits Save themselves, same as any other cert.
export function openRenewCertModal(certId){
  window._renewSourceCertId=certId;
  const el=document.getElementById('rc-start-id'); if(el) el.value='';
  openModal('mo-renew-cert');
}

export async function submitRenewCert(){
  const certId=window._renewSourceCertId;
  const newStartAssetId=(document.getElementById('rc-start-id')?.value||'').trim();
  closeModal('mo-renew-cert');
  await renewCert(certId,newStartAssetId||null);
}

export async function renewCert(certId,newStartAssetId){
  const c=await dGet('certs',certId);
  if(!c)return;
  const today=TODAY();
  const appliances=(c.appliances||[]).map((a,i)=>{
    let assetId=a.assetId||'';
    if(newStartAssetId){
      const m=newStartAssetId.match(/^(.*?)(\d+)$/);
      assetId=m?m[1]+String(parseInt(m[2],10)+i).padStart(m[2].length,'0'):newStartAssetId+(i?'-'+(i+1):'');
    }
    const retestPeriod=a.retestPeriod||12;
    return{id:uid(),assetId,description:a.description||'',testInstrument:a.testInstrument||'',
      date:today,retestPeriod,nextTest:calcNextTest(today,retestPeriod),result:'Pass'};
  });
  const ctDef=(S.certTypes||[]).find(t=>t.name===c.type);
  const expDate=new Date();expDate.setMonth(expDate.getMonth()+(ctDef?.validity||12));
  openCertForm({
    type:c.type, address:c.address, landlord:c.landlord, email:c.email, phone:c.phone,
    agent:c.agent, notes:c.notes,
    // Previously omitted — a renewed cert is a fresh INSERT (see
    // _formJobId's comment), not an edit of the original, so leaving
    // these out meant every renewed certificate silently lost its job
    // link and engineer, even though the cert it was renewed from had
    // both. engineer flows through the normal cf2-engineer form field
    // (openCertForm already populates that from `existing.engineer`);
    // jobId/jobNum have no visible field, so they need the explicit
    // _formJobId/_formJobNum path instead.
    jobId:c.jobId, jobNum:c.jobNum, engineer:c.engineer,
    issueDate:today, expiryDate:localDateStr(expDate),
    appliances,
  });
  toast(`New test cycle started — review the ${appliances.length} carried-forward appliance${appliances.length===1?'':'s'} before saving`,'info');
}
