// Directory CRUD — the agency/agent/person add-edit-delete modals, plus
// fillFromMatch/currentEditId (the two functions that read the edit-id
// state these modals own — moved here from the matching cluster rather
// than exporting mutable setters across a file boundary, see the plan
// file). Extracted from directory.js verbatim (Phase 2 of the follow-up
// modularization pass — see the plan file for scope) — no behaviour
// changes.
//
// This module and main.js/directory-sections.js/directory-matching.js
// import from each other, same as every other extracted module: safe
// because every cross-module reference is used only inside function
// bodies, never at module-evaluation time.

import {
  S, dAll, dGet, dPut, dDel, toast, confirm2, uid, logActivity,
  closeModal, openModal, sendToWA, saveSetting,
} from './main.js';
import { getCurDirSection, renderDir, renderDirSection } from './directory-sections.js';
import { showAutosaveBanner, wireAutoSave } from './directory-matching.js';

let editPid=null, editAgencyId=null, editAgentId=null;

// Map store → current edit id variable name
export function currentEditId(store){
  if(store==='persons')   return editPid||null;
  if(store==='agencies')  return editAgencyId||null;
  if(store==='agents')    return editAgentId||null;
  return null;
}

// Fill the form from a matched record
export async function fillFromMatch(store, id){
  const r = await dGet(store, id);
  if(!r) return;
  // Clear all match popups
  document.querySelectorAll('[id$="-dup"]').forEach(el=>el.innerHTML='');
  if(store==='persons'){
    editPid = id;
    document.getElementById('pf-name').value  = r.name||'';
    document.getElementById('pf-phone').value = r.phone||'';
    document.getElementById('pf-email').value = r.email||'';
    document.getElementById('pf-wa').value    = r.wa||'';
    document.getElementById('pf-addr').value  = r.address||'';
    document.getElementById('pf-notes').value = r.notes||'';
    document.getElementById('pf-rate').value  = r.rate||'';
    const roles = r.roles||[];
    document.getElementById('pf-ll').checked = roles.includes('landlord');
    document.getElementById('pf-cl').checked = roles.includes('client');
    document.getElementById('pf-sc').checked = roles.includes('subcontractor');
    document.getElementById('pf-agent').checked = roles.includes('agent');
    document.getElementById('pf-agency-grp').style.display = roles.includes('agent') ? '' : 'none';
    document.getElementById('mo-person-title').textContent = '✎ Edit Person';
    document.getElementById('btn-del-person').style.display = '';
    document.getElementById('btn-wa-person').style.display = r.wa?'':'none';
    const archBtn=document.getElementById('btn-archive-person');
    if(archBtn){ archBtn.style.display=''; archBtn.textContent=r.archived?'↩ Restore':'🗄 Archive'; }
  } else if(store==='agencies'){
    editAgencyId = id;
    document.getElementById('agf-name').value  = r.name||'';
    document.getElementById('agf-phone').value = r.phone||'';
    document.getElementById('agf-email').value = r.email||'';
    document.getElementById('agf-wa').value    = r.wa||'';
    document.getElementById('agf-addr').value  = r.address||'';
    document.getElementById('agf-web').value   = r.website||'';
    document.getElementById('agf-notes').value = r.notes||'';
    document.getElementById('mo-agency-title').textContent = '✎ Edit Agency';
    document.getElementById('btn-del-agency').style.display = '';
  } else if(store==='agents'){
    editAgentId = id;
    document.getElementById('agt-name').value  = r.name||'';
    document.getElementById('agt-phone').value = r.phone||'';
    document.getElementById('agt-wa').value    = r.wa||'';
    document.getElementById('agt-email').value = r.email||'';
    document.getElementById('agt-title').value = r.title||'';
    document.getElementById('agt-notes').value = r.notes||'';
    if(r.agencyId) document.getElementById('agt-agency').value = r.agencyId;
    document.getElementById('mo-agent-title').textContent = '✎ Edit Agent';
    document.getElementById('btn-del-agent').style.display = '';
  }
  showAutosaveBanner(`Loaded existing record — edit and it will auto-save`);
}

//  AGENCY CRUD
// ════════════════════════════════════════════════════════════════

export async function openAgencyModal(id){
  editAgencyId = id||null;
  document.getElementById('mo-agency-title').textContent = id ? '✎ Edit Agency' : '🏢 Add Agency';
  document.getElementById('btn-del-agency').style.display = id ? '' : 'none';
  if(id){
    const a = await dGet('agencies',id);
    if(!a) return;
    document.getElementById('agf-name').value = a.name||'';
    document.getElementById('agf-phone').value = a.phone||'';
    document.getElementById('agf-email').value = a.email||'';
    document.getElementById('agf-wa').value = a.wa||'';
    document.getElementById('agf-addr').value = a.address||'';
    document.getElementById('agf-web').value = a.website||'';
    document.getElementById('agf-notes').value = a.notes||'';
    document.getElementById('agf-bank-name').value = a.bankName||'';
    document.getElementById('agf-bank-acc').value = a.bankAcc||'';
    document.getElementById('agf-bank-sort').value = a.bankSort||'';
    document.getElementById('agf-bank-ref').value = a.bankRef||'';
  } else {
    ['agf-name','agf-phone','agf-email','agf-wa','agf-addr','agf-web','agf-notes','agf-bank-name','agf-bank-acc','agf-bank-sort','agf-bank-ref'].forEach(x=>{const el=document.getElementById(x);if(el)el.value='';});
  }
  openModal('mo-agency'); setTimeout(()=>wireAutoSave('agencies'),100);
}

let _agencySaving=false;
export async function saveAgency(silent=false){
  if(_agencySaving){ if(!silent)toast('Already saving, please wait…','info',1500); return; }
  _agencySaving=true;
  try{
  const name = document.getElementById('agf-name').value.trim();
  if(!name){if(!silent)toast('Agency name required','error');return}
  const a = {
    id: editAgencyId||uid(),
    name,
    phone: document.getElementById('agf-phone').value.trim(),
    email: document.getElementById('agf-email').value.trim(),
    wa: document.getElementById('agf-wa').value.trim(),
    address: document.getElementById('agf-addr').value.trim(),
    website: document.getElementById('agf-web').value.trim(),
    notes: document.getElementById('agf-notes').value.trim(),
    bankName: document.getElementById('agf-bank-name').value.trim(),
    bankAcc: document.getElementById('agf-bank-acc').value.trim(),
    bankSort: document.getElementById('agf-bank-sort').value.trim(),
    bankRef: document.getElementById('agf-bank-ref').value.trim(),
    modified: Date.now()
  };
  if(!editAgencyId){ a.created = Date.now(); editAgencyId=a.id; }
  await dPut('agencies',a);
  await logActivity(`${a.created?'Added':'Updated'} agency: ${name}`,'agency');
  if(!silent){ closeModal('mo-agency'); renderDirSection('agencies'); toast('Agency saved','success'); }
  else { renderDirSection('agencies'); }
  } finally { _agencySaving=false; }
}

export async function deleteCurrentAgency(){
  // FIX 17: Check for linked agents and jobs before deleting
  const a = await dGet('agencies', editAgencyId);
  if(!a) return;

  const [allAgents, allJobs] = await Promise.all([dAll('agents'), dAll('jobs')]);
  const linkedAgents = allAgents.filter(ag => ag.agencyId === editAgencyId);
  const linkedJobs   = allJobs.filter(j => j.agencyName === a.name);

  const warningLines = [];
  if(linkedAgents.length) warningLines.push(`• ${linkedAgents.length} agent${linkedAgents.length!==1?'s':''} linked to this agency`);
  if(linkedJobs.length)   warningLines.push(`• ${linkedJobs.length} job${linkedJobs.length!==1?'s':''} referencing this agency`);

  const msg = warningLines.length
    ? `"${a.name}" is linked to:\n${warningLines.join('\n')}\n\nThose records will lose their agency link.\n\nDelete anyway?`
    : `Permanently delete agency "${a.name}"?`;

  confirm2('Delete Agency', msg, async()=>{
    await dDel('agencies',editAgencyId);
    closeModal('mo-agency');renderDirSection('agencies');toast('Agency deleted','warn');
  });
}

// ════════════════════════════════════════════════════════════════
//  AGENT CRUD
// ════════════════════════════════════════════════════════════════

export async function openAgentModal(id){
  editAgentId = id||null;
  document.getElementById('mo-agent-title').textContent = id ? '✎ Edit Agent' : '👔 Add Agent';
  document.getElementById('btn-del-agent').style.display = id ? '' : 'none';
  // Fill agency dropdown
  const agencies = await dAll('agencies');
  const agtSel = document.getElementById('agt-agency');
  agtSel.innerHTML = '<option value="">— Select Agency —</option>' + agencies.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if(id){
    const ag = await dGet('agents',id);
    if(!ag) return;
    document.getElementById('agt-name').value = ag.name||'';
    document.getElementById('agt-agency').value = ag.agencyId||'';
    document.getElementById('agt-phone').value = ag.phone||'';
    document.getElementById('agt-wa').value = ag.wa||'';
    document.getElementById('agt-email').value = ag.email||'';
    document.getElementById('agt-title').value = ag.title||'';
    document.getElementById('agt-notes').value = ag.notes||'';
  } else {
    ['agt-name','agt-phone','agt-wa','agt-email','agt-title','agt-notes'].forEach(x=>{const el=document.getElementById(x);if(el)el.value='';});
    agtSel.value='';
  }
  openModal('mo-agent'); setTimeout(()=>wireAutoSave('agents'),100);
}

let _agentSaving=false;
export async function saveAgent(silent=false){
  if(_agentSaving){ if(!silent)toast('Already saving, please wait…','info',1500); return; }
  _agentSaving=true;
  try{
  const name = document.getElementById('agt-name').value.trim();
  if(!name){if(!silent)toast('Agent name required','error');return}
  const ag = {
    id: editAgentId||uid(),
    name,
    agencyId: document.getElementById('agt-agency').value,
    phone: document.getElementById('agt-phone').value.trim(),
    wa: document.getElementById('agt-wa').value.trim(),
    email: document.getElementById('agt-email').value.trim(),
    title: document.getElementById('agt-title').value.trim(),
    notes: document.getElementById('agt-notes').value.trim(),
    modified: Date.now()
  };
  if(!editAgentId){ ag.created = Date.now(); editAgentId=ag.id; }
  await dPut('agents',ag);
  await logActivity(`${ag.created?'Added':'Updated'} agent: ${name}`,'agent');
  if(!silent){ closeModal('mo-agent'); renderDirSection('agents'); toast('Agent saved','success'); }
  else { renderDirSection('agents'); }
  } finally { _agentSaving=false; }
}

export async function deleteCurrentAgent(){
  // FIX 17: Check for linked jobs before deleting
  const ag = await dGet('agents', editAgentId);
  if(!ag) return;

  const allJobs = await dAll('jobs');
  const linkedJobs = allJobs.filter(j => j.agentName === ag.name);

  const msg = linkedJobs.length
    ? `"${ag.name}" is referenced in ${linkedJobs.length} job${linkedJobs.length!==1?'s':''}.\n\nThose jobs will lose their agent link.\n\nDelete anyway?`
    : `Permanently delete agent "${ag.name}"?`;

  confirm2('Delete Agent', msg, async()=>{
    await dDel('agents',editAgentId);
    closeModal('mo-agent');renderDirSection('agents');toast('Agent deleted','warn');
  });
}

// ════════════════════════════════════════════════════════════════
//  UPGRADED PERSON MODAL — with agency field
// ════════════════════════════════════════════════════════════════

export async function openPersonModal(id){
  editPid=id||null;
  document.getElementById('pf-sc').onchange=function(){document.getElementById('pf-eng-extra').style.display=this.checked?'':'none'};
  document.getElementById('pf-agent').onchange=function(){document.getElementById('pf-agency-grp').style.display=this.checked?'':'none'};
  // Fill trade dropdown for person
  const td=document.getElementById('pf-trade');
  td.innerHTML='<option value="">—</option>'+(S.trades||[]).map(t=>`<option>${t.name}</option>`).join('');
  // Fill agency dropdown for person
  const agencies = await dAll('agencies');
  const agSel = document.getElementById('pf-agency');
  if(agSel) agSel.innerHTML = '<option value="">— None —</option>' + agencies.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');

  if(id){
    const p=await dGet('persons',id);
    document.getElementById('mo-person-title').textContent='✎ Edit — '+p.name;
    document.getElementById('pf-name').value=p.name||'';
    document.getElementById('pf-phone').value=p.phone||'';
    document.getElementById('pf-email').value=p.email||'';
    document.getElementById('pf-wa').value=p.wa||'';
    document.getElementById('pf-addr').value=p.address||'';
    document.getElementById('pf-notes').value=p.notes||'';
    document.getElementById('pf-rate').value=p.rate||'';
    if(document.getElementById('pf-bank-name')) document.getElementById('pf-bank-name').value=p.bankName||'';
    if(document.getElementById('pf-bank-acc'))  document.getElementById('pf-bank-acc').value=p.bankAcc||'';
    if(document.getElementById('pf-bank-sort')) document.getElementById('pf-bank-sort').value=p.bankSort||'';
    if(document.getElementById('pf-bank-ref'))  document.getElementById('pf-bank-ref').value=p.bankRef||'';
    document.getElementById('pf-trade').value=p.trade||'';
    document.getElementById('pf-ll').checked=(p.roles||[]).includes('landlord');
    document.getElementById('pf-cl').checked=(p.roles||[]).includes('client');
    document.getElementById('pf-sc').checked=(p.roles||[]).includes('subcontractor');
    document.getElementById('pf-agent').checked=(p.roles||[]).includes('agent');
    const showExtra=(p.roles||[]).includes('subcontractor');
    document.getElementById('pf-eng-extra').style.display=showExtra?'':'none';
    if(agSel) agSel.value = p.agencyId||'';
    // Show agency field only when this person is classified as an agent
    const agGrp = document.getElementById('pf-agency-grp');
    if(agGrp) agGrp.style.display = (p.roles||[]).includes('agent') ? '' : 'none';
    document.getElementById('btn-del-person').style.display='';
    document.getElementById('btn-wa-person').style.display=p.wa?'':'none';
    const archBtn=document.getElementById('btn-archive-person');
    if(archBtn){
      archBtn.style.display='';
      archBtn.textContent=p.archived?'↩ Restore':'🗄 Archive';
      archBtn.title=p.archived?'Bring this person back into the active list':'Hide from the active list — keeps all jobs, invoices and certs intact';
    }
  } else {
    document.getElementById('mo-person-title').textContent='👤 Add Person';
    ['pf-name','pf-phone','pf-email','pf-wa','pf-addr','pf-notes','pf-rate'].forEach(x=>document.getElementById(x).value='');
    ['pf-ll','pf-cl','pf-sc','pf-agent'].forEach(x=>document.getElementById(x).checked=false);
    document.getElementById('pf-eng-extra').style.display='none';
    if(agSel) agSel.value='';
    const agGrp = document.getElementById('pf-agency-grp');
    if(agGrp) agGrp.style.display = 'none';
    document.getElementById('btn-del-person').style.display='none';
    document.getElementById('btn-wa-person').style.display='none';
    const archBtn=document.getElementById('btn-archive-person');
    if(archBtn) archBtn.style.display='none';
  }
  openModal('mo-person'); setTimeout(()=>wireAutoSave('persons'),100);
}

export async function toggleArchivePerson(){
  if(!editPid) return;
  const p = await dGet('persons', editPid);
  if(!p) return;
  const next = !p.archived;
  confirm2(
    next?'Archive this landlord?':'Restore this landlord?',
    next
      ? `"${p.name}" will be hidden from the active Landlords list. Their jobs, invoices and certificates all stay exactly as they are — this isn't a delete, and you can restore them any time.`
      : `"${p.name}" will reappear in the active Landlords list.`,
    async()=>{
      // dPut's upsert is a genuine INSERT ... ON CONFLICT DO UPDATE, not a
      // column-level PATCH — a payload missing NOT NULL columns like `name`
      // fails constraint validation before the conflict branch even runs,
      // so this has to carry the full row, not just {id, archived}.
      await dPut('persons',{...p, archived:next});
      await logActivity(`${next?'Archived':'Restored'} person: ${p.name}`,'person');
      closeModal('mo-person');
      renderDir(); renderDirSection(getCurDirSection());
      toast(next?'Landlord archived':'Landlord restored','success');
    }
  );
}

let _personSaving=false;
export async function savePerson(silent=false){
  if(_personSaving){ if(!silent)toast('Already saving, please wait…','info',1500); return; }
  _personSaving=true;
  try{
  const name=document.getElementById('pf-name').value.trim();
  if(!name){if(!silent)toast('Name required','error');return}
  const roles=[];
  if(document.getElementById('pf-ll').checked)roles.push('landlord');
  if(document.getElementById('pf-cl').checked)roles.push('client');
  if(document.getElementById('pf-sc').checked)roles.push('subcontractor');
  if(document.getElementById('pf-agent').checked)roles.push('agent');
  const p={
    id:editPid||uid(),name,
    phone:document.getElementById('pf-phone').value.trim(),
    email:document.getElementById('pf-email').value.trim(),
    wa:document.getElementById('pf-wa').value.replace(/[^0-9]/g,''),
    address:document.getElementById('pf-addr').value.trim(),
    notes:document.getElementById('pf-notes').value.trim(),
    rate:parseFloat(document.getElementById('pf-rate').value)||0,
    trade:document.getElementById('pf-trade').value,
    agencyId:document.getElementById('pf-agency')?.value||'',
    bankName:document.getElementById('pf-bank-name')?.value.trim()||'',
    bankAcc:document.getElementById('pf-bank-acc')?.value.trim()||'',
    bankSort:document.getElementById('pf-bank-sort')?.value.trim()||'',
    bankRef:document.getElementById('pf-bank-ref')?.value.trim()||'',
    roles
  };
  if(!editPid){ editPid=p.id; }
  await dPut('persons',p);
  // Sync subcontractors into the job-assignment dropdown data (S.engineers)
  // -- "engineer" used to be pushable here too via a Person-form checkbox,
  // duplicating the real Team/phone+PIN system with a phantom, unlinked
  // name entry that vanished on the next Team sync. Checkbox removed;
  // subcontractor behaviour here is unchanged.
  if(roles.includes('subcontractor')){
    const engs=S.engineers||[];
    const idx=engs.findIndex(e=>e.name===name);
    const engObj={name,phone:p.phone,rate:p.rate,wa:p.wa,trade:p.trade};
    if(idx>=0)engs[idx]=engObj;else engs.push(engObj);
    await saveSetting('engineers',engs);
  }
  await logActivity(`${p.id===editPid&&!silent?'Updated':'Added'} person: ${name}`,'person');
  if(!silent){ closeModal('mo-person');renderDir();renderDirSection(getCurDirSection());toast('Saved','success'); }
  else { renderDir();renderDirSection(getCurDirSection()); }
  } finally { _personSaving=false; }
}

export async function deleteCurrentPerson(){
  // FIX 17: Check for dependent records before deleting — previously this deleted
  // immediately with no warning, orphaning all linked jobs, invoices, and certs.
  const p = await dGet('persons', editPid);
  if(!p) return;

  const [allJobs, allInvs, allCerts] = await Promise.all([
    dAll('jobs'), dAll('invoices'), dAll('certs')
  ]);
  const linkedJobs  = allJobs.filter(j => j.referrer === p.name || j.landlordName === p.name);
  const linkedInvs  = allInvs.filter(i => i.clientName === p.name || i.clientId === editPid);
  const linkedCerts = allCerts.filter(c => c.landlord === p.name);

  const hasLinks = linkedJobs.length || linkedInvs.length || linkedCerts.length;
  const warningLines = [];
  if(linkedJobs.length)  warningLines.push(`• ${linkedJobs.length} job${linkedJobs.length!==1?'s':''}`);
  if(linkedInvs.length)  warningLines.push(`• ${linkedInvs.length} invoice${linkedInvs.length!==1?'s':''}`);
  if(linkedCerts.length) warningLines.push(`• ${linkedCerts.length} certificate${linkedCerts.length!==1?'s':''}`);

  const msg = hasLinks
    ? `"${p.name}" is linked to:\n${warningLines.join('\n')}\n\nDeleting will NOT remove those records but they will lose their contact link.\n\nDelete anyway?`
    : `Permanently delete "${p.name}"?`;

  confirm2('Delete Person', msg, async()=>{
    await dDel('persons',editPid);
    closeModal('mo-person');renderDir();toast('Person deleted','warn');
  });
}

export async function openPersonWA(){
  const p=await dGet('persons',editPid);
  if(!p||!p.wa)return;
  const msg=`Hello *${p.name}*, this is ${S.coName||'us'}.`;
  sendToWA(p.wa,msg);
}

export function openImportModal(){toast('CSV import: paste person data as Name,Phone,Email,Role (one per line)','info',5000)}
