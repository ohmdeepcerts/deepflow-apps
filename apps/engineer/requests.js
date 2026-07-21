// Requests — engineer-submitted overtime and leave requests: list view
// (with office replies) plus the two submission forms. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, Employee App
// module 4) — no behaviour changes.
//
// currentUser is reassigned in main.js's AUTH section (login/logout), so
// this module reads it through the exported getCurrentUser() getter
// rather than importing a live binding — same pattern as setWeather()
// in geo-weather.js.

import { sb, toast, closeModal, _setBadge, _fd, _clearDraft, getCurrentUser } from './main.js';

export async function loadRequests(){
  const el=document.getElementById('requests-list');if(!el)return;
  try{
    const reqs=await sb(`engineer_requests?engineer_name=eq.${encodeURIComponent(getCurrentUser().name)}&order=created.desc&limit=50`).catch(()=>[]);
    if(!reqs?.length){el.innerHTML='<div class="empty"><div class="empty-icon">📤</div><div class="empty-title">No requests yet</div><div class="empty-sub">Use the buttons above to submit overtime or leave requests.</div></div>';return;}
    _setBadge('requests',reqs.filter(r=>r.status==='pending').length);
    el.innerHTML=reqs.map(r=>`<div class="req-card">
      <div class="req-card-hd"><div><div class="req-title">${r.type==='overtime'?'⏱ Overtime':'📆 Time Off'}</div>
      <div class="req-meta">${r.date?`📅 ${r.date}`:''} ${r.hours?`⏱ ${r.hours}h`:''} ${r.leave_from&&r.leave_to?`${r.leave_from} → ${r.leave_to}`:''}</div></div>
      <span class="req-badge rb-${r.status||'pending'}">${r.status||'pending'}</span></div>
      ${r.notes?`<div class="req-note">${r.notes}</div>`:''}
      ${r.office_reply?`<div class="req-note" style="background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.2);color:var(--green)">💬 Office: ${r.office_reply}</div>`:''}
      <div style="font-size:10px;color:var(--txt3);margin-top:8px">${_fd(r.created)}</div>
    </div>`).join('');
  }catch(e){el.innerHTML='<div style="padding:20px;text-align:center;color:var(--txt3)">Unable to load requests.</div>';}
}

export function openOvertimeForm(){
  document.getElementById('ot-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('ot-hours').value='';
  document.getElementById('ot-job').value='';
  document.getElementById('ot-notes').value='';
  document.getElementById('ot-modal').classList.add('open');
}
export function openLeaveForm(){
  const t=new Date().toISOString().split('T')[0];
  document.getElementById('leave-from').value=t;
  document.getElementById('leave-to').value=t;
  document.getElementById('leave-notes').value='';
  document.getElementById('leave-modal').classList.add('open');
}
export async function submitOvertimeRequest(){
  const date=document.getElementById('ot-date').value;
  const hours=parseFloat(document.getElementById('ot-hours').value);
  const rate=document.getElementById('ot-rate').value;
  const job=document.getElementById('ot-job').value.trim();
  const notes=document.getElementById('ot-notes').value.trim();
  if(!date||isNaN(hours)||hours<=0){toast('Please fill in date and hours','error');return;}
  try{
    await sb('engineer_requests',{method:'POST',body:{id:`req-${Date.now()}`,engineer_name:getCurrentUser().name,type:'overtime',date,hours,rate,job,notes,status:'pending',created:Date.now()}});
    _clearDraft('ot-notes');closeModal('ot-modal');toast('✅ Overtime request sent!','success');if(navigator.vibrate)navigator.vibrate([50,30,80]);loadRequests();
  }catch(e){toast('❌ '+(e.message||'').slice(0,80),'error');if(navigator.vibrate)navigator.vibrate([80]);}
}
export async function submitLeaveRequest(){
  const type=document.getElementById('leave-type').value;
  const from=document.getElementById('leave-from').value;
  const to=document.getElementById('leave-to').value;
  const notes=document.getElementById('leave-notes').value.trim();
  if(!from||!to){toast('Please select dates','error');return;}
  try{
    await sb('engineer_requests',{method:'POST',body:{id:`req-${Date.now()}`,engineer_name:getCurrentUser().name,type:'leave',leave_type:type,leave_from:from,leave_to:to,notes,status:'pending',created:Date.now()}});
    closeModal('leave-modal');toast('✅ Leave request sent!','success');if(navigator.vibrate)navigator.vibrate([50,30,80]);loadRequests();
  }catch(e){toast('❌ '+(e.message||'').slice(0,80),'error');if(navigator.vibrate)navigator.vibrate([80]);}
}
