// Two small job-related popups: the job audit trail modal and the
// property-certificates lookup modal. Extracted from main.js verbatim
// (Phase 5e-5 of the follow-up modularization pass — see the plan file for
// scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS, daysDiff } from '@business';
import { dGet, dAll, openModal } from './main.js';

export async function showJobAudit(jobId){
  const job=await dGet('jobs',jobId);
  if(!job) return;
  const allActs=await dAll('activity');
  const jobActs=allActs
    .filter(a=>a.jobId===job.id||a.jobNum===job.jobNum||
      (a.msg&&(a.msg.includes(job.jobNum||'~~')||a.msg.includes(job.address||'~~'))))
    .sort((a,b)=>b.ts-a.ts).slice(0,50);

  const typeIcon={sync:'🔗',warn:'⚠️',invoice:'◎',job:'🔧',payment:'💳',info:'ℹ️'};
  document.getElementById('audit-job-info').innerHTML=`
    <strong>${job.jobNum||''}</strong> · ${job.address||''} · <span style="color:var(--txt2)">${job.description||'—'}</span>
    <span class="badge b-${job.status===STATUS.COMPLETED?'completed':job.status===STATUS.ENGINEER_COMPLETED?'engcompleted':job.status===STATUS.PENDING?'pending':'invoiced'}" style="margin-left:8px">${job.status}</span>
  `;

  document.getElementById('audit-list').innerHTML=jobActs.length?jobActs.map(a=>`
    <div class="audit-item">
      <div class="audit-dot" style="background:${a.type==='warn'?'var(--red)':a.type==='sync'?'var(--acc)':a.type==='payment'?'var(--green)':'var(--acc)'}"></div>
      <div class="audit-msg">
        <div>${typeIcon[a.type]||'•'} ${escHtml(a.msg)}</div>
        ${(a.oldVal||a.newVal)?`<div style="font-size:10px;color:var(--txt3);margin-top:2px">
          ${a.oldVal?`<span style="color:var(--red)">"${escHtml(String(a.oldVal).slice(0,50))}"</span>`:''}
          ${a.newVal?`<span style="color:var(--green)"> → "${escHtml(String(a.newVal).slice(0,50))}"</span>`:''}
        </div>`:''}
        ${a.invNum?`<div style="font-size:10px;color:var(--acc);margin-top:1px">Invoice: ${escHtml(a.invNum)}</div>`:''}
      </div>
      <div class="audit-ts">${new Date(a.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    </div>
  `).join(''):`<div style="color:var(--txt3);font-size:12px;padding:20px 0;text-align:center">No audit history for this job yet</div>`;

  openModal('mo-audit');
}

export async function showPropertyCerts(address){
  if(!address) return;
  const allCerts=await dAll('certs');
  const propCerts=allCerts.filter(c=>c.address&&c.address.toLowerCase().includes(address.toLowerCase().slice(0,15)));

  document.getElementById('propcerts-addr').innerHTML=`📍 ${address}`;

  if(!propCerts.length){
    document.getElementById('propcerts-list').innerHTML=`<div style="color:var(--txt3);font-size:12px;padding:20px 0;text-align:center">No certificates found for this property</div>`;
  } else {
    document.getElementById('propcerts-list').innerHTML=propCerts.map(c=>{
      const d=daysDiff(c.expiryDate);
      const col=d<0?'var(--red)':d<=30?'var(--yellow)':'var(--green)';
      const txt=d<0?`⚠ Expired ${Math.abs(d)}d ago`:d===0?'Expires Today!':d+'d left';
      return`<div class="propcert-item">
        <div style="font-size:20px">${{Gas:'⛽',Electrical:'⚡',EPC:'🏠'}[c.type?.split(' ')[0]]||'📄'}</div>
        <div style="flex:1">
          <div class="propcert-type">${c.type}</div>
          <div style="font-size:10px;color:var(--txt2)">Expires: ${c.expiryDate} ${c.certNum?'· #'+c.certNum:''}</div>
        </div>
        <div class="propcert-days" style="color:${col}">${txt}</div>
        ${d<=60?`<button class="btn btn-acc btn-xs" onclick="createRenewalJob('${c.id}');closeModal('mo-propcerts')">Renew</button>`:''}
      </div>`;
    }).join('');
  }
  openModal('mo-propcerts');
}
