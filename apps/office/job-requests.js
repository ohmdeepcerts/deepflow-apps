// Engineer Requests — the "Requests" nav page: portal/engineer request list,
// detail panel, and the actions that acknowledge/approve/reject/reopen a
// request or turn a Client Portal request into a real Job. Extracted from
// main.js verbatim (Phase 5b of the follow-up modularization pass) — no
// behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { _sb, nav, dAll, toast, openJobModal, nextJobNum } from './main.js';

// ── Job Requests — type state ─────────────────────────────────────────────────

let _reqType='all',_selectedReqId=null;

export function setReqType(type){
  _reqType = type;
  document.querySelectorAll('.inv-type-tab[id^="reqtype-"]').forEach(b=>{
    b.classList.toggle('active', b.id==='reqtype-'+type);
  });
  renderRequests();
}

export async function renderRequests(){
  const list = document.getElementById('req-list');
  const statusFilter = document.getElementById('req-status-filter')?.value||'';
  if(list) list.innerHTML='<div style="text-align:center;padding:40px;color:var(--txt3);font-size:12px">Loading…</div>';

  try{
    let url='engineer_requests?order=created.desc&limit=200';
    if(statusFilter) url+='&status=eq.'+statusFilter;
    let reqs = await _sb(url)||[];

    // Apply type filter
    if(_reqType==='portal') reqs=reqs.filter(r=>r.type==='portal_request');
    else if(_reqType==='eng') reqs=reqs.filter(r=>r.type!=='portal_request');

    // Update sidebar badge
    const allPending=(await _sb('engineer_requests?status=eq.pending&select=id')||[]).length;
    const badge=document.getElementById('nb-req');
    if(badge){ badge.textContent=allPending; badge.style.display=allPending?'inline':'none'; }

    // KPI strip
    _renderReqKPIs(reqs);

    if(!reqs.length){
      if(list) list.innerHTML=`<div style="text-align:center;padding:60px;color:var(--txt3)"><div style="font-size:32px;margin-bottom:10px">📬</div><div style="font-size:13px">${statusFilter==='pending'?'🎉 No pending requests — all clear!':'No requests found for this filter'}</div></div>`;
      return;
    }

    if(list) list.innerHTML = reqs.map(r=>_renderReqCard(r)).join('');

    // Re-select if one was previously selected
    if(_selectedReqId){
      const still=reqs.find(r=>r.id===_selectedReqId);
      if(still) _showReqDetail(still);
    }
  }catch(e){
    if(list) list.innerHTML=`<div style="text-align:center;padding:40px;color:var(--red);font-size:12px">❌ Failed to load: ${e.message}</div>`;
  }
}

function _renderReqKPIs(reqs){
  const el=document.getElementById('req-kpi-strip');
  if(!el) return;
  const pending=reqs.filter(r=>r.status==='pending').length;
  const approved=reqs.filter(r=>r.status==='approved').length;
  const rejected=reqs.filter(r=>r.status==='rejected').length;
  const jobCreated=reqs.filter(r=>r.status==='job_created').length;
  const portal=reqs.filter(r=>r.type==='portal_request').length;
  const kpi=(v,l,c,filter)=>`<div class="inv-topbar-kpi" onclick="document.getElementById('req-status-filter').value='${filter}';renderRequests()">
    <span class="k-val" style="color:${c}">${v}</span><span class="k-lbl">${l}</span><span class="k-arrow">›</span>
  </div>`;
  el.innerHTML=
    kpi(pending,'Pending','#f59e0b','pending')+
    kpi(approved,'Approved','#15803d','approved')+
    (rejected?kpi(rejected,'Rejected','#b91c1c','rejected'):'')+
    (jobCreated?kpi(jobCreated,'Job Created','#a855f7','job_created'):'')+
    kpi(portal,'Portal','#7c3aed','');
}

function _renderReqCard(r){
  const isPortal = r.type==='portal_request';
  const isPending = r.status==='pending';
  const isRejected = r.status==='rejected';
  const isJobCreated = r.status==='job_created';
  const statusCol={pending:'#f59e0b',approved:'#15803d',rejected:'#b91c1c',job_created:'#a855f7',acknowledged:'#0ea5e9'}[r.status]||'#94a3b8';
  const statusLabel={pending:'⏳ Pending',approved:'✅ Approved',rejected:'❌ Rejected',job_created:'🔧 Job Created',acknowledged:'👀 Seen'}[r.status]||r.status;
  const typeLabel = isPortal ? '🏠 Client Portal' : r.type==='overtime'?'🕐 Overtime':r.type==='leave'?'🏖 Leave':'📝 Engineer';
  const dt = r.created?new Date(r.created*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}):''
  const isSelected = _selectedReqId===r.id;

  // Extract CR number from notes
  const crMatch = (r.notes||'').match(/\[(CR-\d+)\]/);
  const crNum = crMatch ? crMatch[1] : null;

  // Parse portal notes
  let parsed={};
  if(isPortal && r.notes){
    const lines=r.notes.split('\n');
    const get=k=>{const l=lines.find(x=>x.toLowerCase().startsWith(k.toLowerCase()+':'));return l?l.slice(k.length+1).trim():''};
    parsed={service:get('Service'),address:get('Address'),date:get('Preferred date'),access:get('Access'),notes:get('Notes')};
  }

  return`<div onclick="_showReqDetail(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="border:1px solid ${isSelected?'var(--acc)':isPending?'rgba(245,158,11,.3)':'var(--border)'};border-left:3px solid ${statusCol};border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer;background:${isSelected?'var(--acc-soft)':'var(--s1)'};transition:.12s">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      ${crNum?`<span style="font-size:10px;font-weight:800;color:var(--acc);background:var(--acc-soft);padding:1px 8px;border-radius:6px;font-family:monospace">${crNum}</span>`:''}
      <span style="font-size:11px;font-weight:700;color:var(--txt)">${r.engineer_name||'Unknown'}</span>
      <span style="font-size:9px;font-weight:700;color:${statusCol};background:${statusCol}18;padding:1px 6px;border-radius:6px">${statusLabel}</span>
      ${isPending?`<span style="font-size:9px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,.1);padding:1px 6px;border-radius:6px;animation:pulse 2s infinite">● ACTION NEEDED</span>`:''}
      <span style="font-size:10px;color:var(--txt3);margin-left:auto">${dt}</span>
    </div>
    <div style="font-size:11px;color:var(--acc);font-weight:600;margin-bottom:2px">${typeLabel}</div>
    <div style="font-size:11px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      ${isPortal?(parsed.service||'')+(parsed.address?' · '+parsed.address:''):r.notes||'—'}
    </div>
    ${r.office_reply?`<div style="font-size:10px;color:var(--txt3);margin-top:4px">💼 ${r.office_reply}</div>`:''}
  </div>`;
}
export function _showReqDetail(r){
  if(typeof r==='string') try{r=JSON.parse(r)}catch(e){return}
  _selectedReqId=r.id;
  const el=document.getElementById('req-detail-body');
  if(!el) return;

  const isPortal=r.type==='portal_request';
  const isPending=r.status==='pending';
  const isRejected=r.status==='rejected';
  const isJobCreated=r.status==='job_created';
  const statusCol={pending:'#f59e0b',approved:'#15803d',rejected:'#b91c1c',job_created:'#a855f7'}[r.status]||'#94a3b8';
  const statusLabel={pending:'⏳ Pending',approved:'✅ Approved',rejected:'❌ Rejected',job_created:'📋 Job Created'}[r.status]||r.status;
  const dt=r.created?new Date(r.created*1000).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';

  let parsed={};
  if(isPortal && r.notes){
    const lines=r.notes.split('\n');
    const get=k=>{const l=lines.find(x=>x.toLowerCase().startsWith(k.toLowerCase()+':'));return l?l.slice(k.length+1).trim():''};
    parsed={service:get('Service'),address:get('Address'),date:get('Preferred date'),access:get('Access'),notes:get('Notes'),ref:(lines[0]||'').match(/\[([^\]]+)\]/)?.[1]||''};
  }

  const field=(ico,label,val)=>val?`<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
    <span style="font-size:13px;flex-shrink:0">${ico}</span>
    <div><div style="font-size:9px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:1px">${label}</div><div style="color:var(--txt);font-weight:500">${val}</div></div>
  </div>`:'';

  el.innerHTML=`
    <!-- Header -->
    <div style="margin-bottom:14px">
      <div style="font-size:14px;font-weight:800;color:var(--txt);margin-bottom:4px">${r.engineer_name||'Unknown'}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;color:${statusCol};background:${statusCol}18;padding:2px 8px;border-radius:6px">${statusLabel}</span>
        ${isPortal?'<span style="font-size:10px;font-weight:600;color:#7c3aed;background:rgba(124,58,237,.08);padding:2px 8px;border-radius:6px">🏠 Portal Request</span>':'<span style="font-size:10px;font-weight:600;color:var(--blue);background:rgba(29,111,173,.08);padding:2px 8px;border-radius:6px">👷 Engineer</span>'}
        ${parsed.ref?`<span style="font-size:10px;color:var(--txt3)">${parsed.ref}</span>`:''}
      </div>
      <div style="font-size:10px;color:var(--txt3);margin-top:4px">${dt}</div>
    </div>

    <!-- Details -->
    <div style="margin-bottom:14px">
      ${field('🔧','Service / Request',isPortal?parsed.service:r.type==='overtime'?`${r.hours||0} hrs @ £${r.rate||0}/hr = £${((r.hours||0)*(r.rate||0)).toFixed(2)}`:r.type)}
      ${field('📍','Address',isPortal?parsed.address:'')}
      ${field('📅','Preferred Date',isPortal?parsed.date:r.date||'')}
      ${field('🔑','Access',isPortal?parsed.access:'')}
      ${field('💬','Notes / Details',isPortal?parsed.notes:r.notes||'')}
      ${field('✉️','Client Email',r.email||'')}
      ${field('📞','Client Phone',r.phone||'')}
    </div>

    ${r.office_reply?`<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px"><div style="font-size:9px;font-weight:700;color:var(--txt3);text-transform:uppercase;margin-bottom:4px">Office Reply (visible to client)</div><div style="color:var(--txt)">${r.office_reply}</div></div>`:''}

    <!-- CLIENT PORTAL STATUS — what the client sees -->
    <div style="background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:10px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">What client sees on their portal</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="font-size:14px">${{pending:'⏳',approved:'✅',rejected:'❌',job_created:'📋'}[r.status]||'•'}</span>
        <div>
          <div style="font-weight:600;color:var(--txt)">${{pending:'Your request is being reviewed',approved:'Request acknowledged — we will be in touch',rejected:'Request declined',job_created:'Job booked — your engineer is confirmed'}[r.status]||statusLabel}</div>
          ${r.office_reply?`<div style="color:var(--txt2);margin-top:2px">"${r.office_reply}"</div>`:''}
        </div>
      </div>
    </div>

    <!-- ACTIONS -->
    <div style="display:flex;flex-direction:column;gap:6px">
      ${isPending && isPortal?`
        <button class="btn btn-acc btn-sm" style="width:100%;justify-content:center" onclick="_reqCreateJob('${r.id}','${encodeURIComponent(JSON.stringify(parsed))}','${(r.engineer_name||'').replace(/'/g,"\\'")}')">📋 Create Job from this Request</button>
        <button class="btn btn-green btn-sm" style="width:100%;justify-content:center" onclick="_reqAcknowledge('${r.id}')">✅ Acknowledge (reply to client)</button>
        <button class="btn btn-red btn-sm" style="width:100%;justify-content:center" onclick="_reqReject('${r.id}')">✕ Decline Request</button>
      `:isPending?`
        <button class="btn btn-green btn-sm" style="width:100%;justify-content:center" onclick="_reqApproveEng('${r.id}')">✅ Approve</button>
        <button class="btn btn-red btn-sm" style="width:100%;justify-content:center" onclick="_reqReject('${r.id}')">❌ Reject</button>
      `:''}
      ${isRejected?`
        <button class="btn btn-acc btn-sm" style="width:100%;justify-content:center" onclick="_reqReopen('${r.id}')">↺ Re-open (undo rejection)</button>
      `:''}
      ${isJobCreated||r.status==='approved'?`
        <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center" onclick="_reqReopen('${r.id}')">↺ Revert to Pending</button>
      `:''}
      <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center;margin-top:4px" onclick="_reqSendReply('${r.id}')">💬 Update Reply to Client</button>
    </div>`;

  // Highlight selected card
  document.querySelectorAll('#req-list > div').forEach(d=>{
    d.style.background=d.onclick?.toString().includes(r.id)?'var(--acc-soft)':'var(--s1)';
    d.style.borderColor=d.onclick?.toString().includes(r.id)?'var(--acc)':'var(--border)';
  });
}

// ── Request actions ───────────────────────────────────────────────────────────
export async function _reqCreateJob(id, parsedEnc, clientName){
  let p; try{p=JSON.parse(decodeURIComponent(parsedEnc));}catch(e){p={};}

  // Generate a proper sequential CR number from the jobs table (ignores whatever the portal sent)
  const crNum=await nextJobNum('CR');

  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'job_created',office_reply:'Job booked — your engineer is confirmed. We will contact you with details shortly.'},prefer:'return=minimal'});
  nav('jobs');
  await new Promise(r=>setTimeout(r,350));
  openJobModal(null);
  await new Promise(r=>setTimeout(r,200));
  const f=id=>document.getElementById(id);
  if(p.address&&f('jf-addr'))  f('jf-addr').value=p.address;
  if(p.service&&f('jf-desc'))  f('jf-desc').value=p.service;
  // Store CR number — will be used as job number when saved
  if(crNum) window._pendingCRNum=crNum;
  const noteLines=[p.access?`Access: ${p.access}`:'',p.notes||''].filter(Boolean);
  if(noteLines.length&&f('jf-notes')) f('jf-notes').value=noteLines.join('\n');
  if(clientName){
    const persons=await dAll('persons').catch(()=>[]);
    const match=persons.find(x=>x.name.toLowerCase()===clientName.toLowerCase());
    if(f('jf-landlord')) f('jf-landlord').value=match?match.name:clientName;
  }
  toast(`📋 Job pre-filled as ${crNum||'portal request'} — review and save`,'info',5000);
}

export async function _reqAcknowledge(id){
  const reply=prompt('Reply to client (they will see this):','Thank you for your request. We will be in touch shortly to confirm your booking.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'approved',office_reply:reply},prefer:'return=minimal'});
  toast('✅ Request acknowledged — client notified','success');
  renderRequests();
}

export async function _reqApproveEng(id){
  const reply=prompt('Reply to engineer (optional):','Approved — will be processed on the next payslip.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'approved',office_reply:reply||'Approved'},prefer:'return=minimal'});
  toast('✅ Request approved','success');
  renderRequests();
}

export async function _reqReject(id){
  const reply=prompt('Reason for declining (client/engineer will see this):','We are unable to accommodate this request at this time.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'rejected',office_reply:reply||'Declined'},prefer:'return=minimal'});
  toast('Request declined','warn');
  renderRequests();
}

export async function _reqReopen(id){
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'pending',office_reply:''},prefer:'return=minimal'});
  toast('↺ Request re-opened — set back to Pending','success');
  renderRequests();
}

export async function _reqSendReply(id){
  const reply=prompt('Update reply (client/engineer will see this):','');
  if(reply===null||reply==='') return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{office_reply:reply},prefer:'return=minimal'});
  toast('💬 Reply updated','success');
  renderRequests();
}

// Legacy aliases so old code still works
export async function approvePortalReq(id){ await _reqAcknowledge(id); }
export async function approveRequest(id){ await _reqApproveEng(id); }
export async function rejectRequest(id){ await _reqReject(id); }
export async function createJobFromPortalReq(id, parsedJson){
  const p=typeof parsedJson==='string'?JSON.parse(parsedJson):parsedJson;
  await _reqCreateJob(id, encodeURIComponent(JSON.stringify(p)), p.clientName||'');
}
