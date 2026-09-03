// Right-click context menu on job rows — status shortcuts, quick actions,
// and the global listeners that close it (outside click, Escape). Extracted
// from main.js verbatim (Phase 5e-3 of the follow-up modularization pass —
// see the plan file for scope) — no behaviour changes.
//
// The menu's own onclick-string actions (quickStatus, openJobModal, etc.)
// are resolved on window at click time, same as every other generated-HTML
// onclick string in this app — this module doesn't need to import them.

import { dGet } from './main.js';

let ctxJobId=null;
document.addEventListener('contextmenu',async e=>{
  const row=e.target.closest('.jsr3[data-id]')||e.target.closest('#jtbody tr[data-id]');
  if(!row) return;
  e.preventDefault();
  ctxJobId=row.dataset.id;
  const job=await dGet('jobs',ctxJobId);
  if(!job) return;

  const menu=document.getElementById('ctx-menu');
  const statusOpts=['Pending','In Progress','Completed','Invoiced','Cancelled'];
  menu.innerHTML=`
    <div style="padding:8px 14px 6px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--fh);font-weight:800;font-size:12px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${job.address||'Job'}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">${job.jobNum||''} ${job.date||''}</div>
    </div>
    <div style="padding:4px 0">
      <div class="ctx-item" onclick="quickStatus('${job.id}','Engineer Completed');closeCtx()">🔷 Mark Engineer Completed</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Completed');closeCtx()">✅ Mark Completed (Finalize)</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','In Progress');closeCtx()">🔨 Mark In Progress</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Cannot Access');closeCtx()">🚫 Mark Cannot Access</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Invoiced');closeCtx()">◎ Mark Invoiced</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Cancelled');closeCtx()">✕ Mark Cancelled</div>
    </div>
    <div class="ctx-sep"></div>
    ${job.confirmed===false
      ? `<div class="ctx-item" onclick="closeCtx();quickConfirm('${job.id}',true)">✅ Mark as Confirmed</div>`
      : `<div class="ctx-item" onclick="closeCtx();quickConfirm('${job.id}',false)">⏳ Mark as Unconfirmed</div>`
    }
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();openJobModal('${job.id}')">✎ Open & Edit Job</div>
    <div class="ctx-item" onclick="closeCtx();openJobForInvoice('${job.id}')">◎ Create Invoice</div>
    <div class="ctx-item" onclick="closeCtx();duplicateJob('${job.id}')">⊞ Duplicate to Today</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();waSingleJobById('${job.id}')">📱 WhatsApp Engineer</div>
    <div class="ctx-item" onclick="closeCtx();sendTenantWA('${job.id}')">📅 Tenant Booking Confirm</div>
    <div class="ctx-item" onclick="closeCtx();sendLandlordComplete('${job.id}')">🏠 Landlord Work Done</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();ctxCopyAddr('${job.id}')">📋 Copy Address</div>
    <div class="ctx-item" onclick="closeCtx();showPropertyCerts('${job.address}')">◈ View Property Certs</div>
    <div class="ctx-item" onclick="closeCtx();showJobAudit('${job.id}')">🕐 Audit Trail</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" onclick="closeCtx();deleteJobById('${job.id}')">🗑 Delete Job</div>
  `;

  // Position menu
  let x=e.clientX, y=e.clientY;
  menu.style.display='block';
  const mw=menu.offsetWidth, mh=menu.offsetHeight;
  if(x+mw>window.innerWidth) x=window.innerWidth-mw-8;
  if(y+mh>window.innerHeight) y=window.innerHeight-mh-8;
  menu.style.left=x+'px'; menu.style.top=y+'px';
});

export function closeCtx(){
  document.getElementById('ctx-menu').style.display='none';
  ctxJobId=null;
}

document.addEventListener('click',()=>closeCtx());
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCtx()});
