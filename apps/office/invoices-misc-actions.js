// Misc invoice actions (bulk mark paid, recurring/duplicate invoice,
// save-and-send, duplicate cleanup, CSV export) plus WhatsApp template
// preview/copy/send-all-overdue. Extracted from main.js verbatim (Phase
// 5f-2 of the follow-up modularization pass — see the plan file for
// scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { localDateStr, fillTemplate } from '@business';
import {
  S, TODAY, dAll, dGet, dPut, dDel, uid, toast, calcInvTotal, getAppUser,
  nextInvNum, renderInvList, renderInvKPIs, updateBadges, viewInv,
  openInvSendModal, saveInvWithJobSync, curInvId, _lastOpenedJob,
} from './main.js';

// ── Bulk mark Awaiting Payment → Paid ──
export async function bulkMarkPaid(){
  const filter = document.getElementById('inv-filter')?.value||'';
  const search = (document.getElementById('inv-search')?.value||'').toLowerCase();
  let invs = await dAll('invoices');
  invs = invs.filter(i=>i.status==='Awaiting Payment');
  if(filter && filter!=='Awaiting Payment') invs = invs.filter(i=>i.status===filter);
  if(search) invs = invs.filter(i=>(i.clientName+i.number+i.description).toLowerCase().includes(search));
  if(!invs.length){ toast('No unpaid invoices to mark','info'); return; }
  if(!confirm(`Mark ${invs.length} invoice${invs.length!==1?'s':''} as Paid?\n\nThis will create a payment record for each.`)) return;
  const btn = document.querySelector('[onclick="bulkMarkPaid()"]');
  if(btn){btn.disabled=true;btn.textContent='Marking…';}
  let done=0;
  try{
    for(const inv of invs){
      const t=calcInvTotal(inv);
      await dPut('payments',{id:uid(),invId:inv.id,date:TODAY(),amount:t.grand,method:'Bank Transfer',ref:inv.number,recorded_by:getAppUser()?.name||'Office',created:Date.now()});
      await dPut('invoices',{...inv,status:'Paid'});
      done++;
    }
    toast(`✅ ${done} invoice${done!==1?'s':''} marked as Paid`,'success');
  }catch(e){
    toast('❌ Bulk paid failed: '+e.message.slice(0,80),'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='✓ Bulk Paid';}
    renderInvList();
    updateBadges();
  }
}

// ── Create a recurring invoice (copy with next month's dates) ──
export async function createRecurringInv(id){
  const inv = await dGet('invoices', id);
  if(!inv) return;
  // Preserve the original invoice's numbering series — was always calling
  // nextInvNum() with no argument, so a recurring AGENCY invoice silently
  // got a landlord-series number instead of continuing the AGN- series.
  const newNum = await nextInvNum(inv.invoiceType==='agency');
  // Advance dates by 1 month
  const advanceMonth = (dateStr) => {
    if(!dateStr) return TODAY();
    const d = new Date(dateStr);
    d.setMonth(d.getMonth()+1);
    return d.toISOString().slice(0,10);
  };
  const newInv = {
    ...inv,
    id: uid(),
    number: newNum,
    date: advanceMonth(inv.date),
    dueDate: advanceMonth(inv.dueDate),
    status: 'Draft',
    created: Date.now(),
  };
  await dPut('invoices', newInv);
  toast(`✅ Recurring invoice created: ${newNum}`, 'success');
  renderInvList();
  setTimeout(()=>viewInv(newInv.id), 200);
}

// ── Send invoice via email immediately after saving ──
export async function saveAndSendInv(){
  await saveInvWithJobSync();
  if(curInvId) setTimeout(()=>openInvSendModal(curInvId), 400);
}


// ── Find and delete duplicate invoices (same job ref + same amount + same date) ──
export async function deleteDuplicateInvoices(){
  const invs = await dAll('invoices');
  // Group by: date + jobRef + clientName + total amount
  const seen = {};
  const dupes = [];
  invs.sort((a,b)=>a.created-b.created); // keep oldest
  invs.forEach(inv=>{
    const t = calcInvTotal(inv);
    const key = [inv.date||'', inv.jobRef||'', inv.clientName||'', t.grand.toFixed(2), inv.description||''].join('|');
    if(seen[key]){
      dupes.push(inv); // this one is a duplicate — mark for deletion
    } else {
      seen[key] = inv.id;
    }
  });
  if(!dupes.length){ toast('✅ No duplicate invoices found!','success'); return; }
  if(!confirm(`Found ${dupes.length} duplicate invoice${dupes.length!==1?'s':''} (same date, job, client and amount).\n\nThe oldest copy of each will be kept, duplicates will be deleted.\n\nProceed?`)) return;
  let deleted=0;
  for(const inv of dupes){
    try{ await dDel('invoices',inv.id); deleted++; }catch(e){ console.warn('[DeepFlow]', e); }
  }
  toast(`✅ Deleted ${deleted} duplicate invoice${deleted!==1?'s':''}. ${dupes.length-deleted>0?`${dupes.length-deleted} failed — try again.`:''}`, 'success', 5000);
  renderInvList();
  renderInvKPIs();
  updateBadges();
}


// ── Duplicate an invoice ──
export async function duplicateInv(id){
  const inv = await dGet('invoices', id);
  if(!inv) return;
  // Same fix as createRecurringInv — keep the original's numbering series.
  const newNum = await nextInvNum(inv.invoiceType==='agency');
  const newInv = {
    ...inv,
    id: uid(),
    number: newNum,
    date: TODAY(),
    status: 'Draft',
    created: Date.now(),
  };
  // Set due date from settings
  const dd = new Date(); dd.setDate(dd.getDate()+(S.dueDays||14));
  newInv.dueDate = localDateStr(dd);
  await dPut('invoices', newInv);
  toast(`✅ Invoice copied as ${newNum}`, 'success');
  renderInvList();
  setTimeout(()=>viewInv(newInv.id), 200);
}

// ── Export all visible invoices to CSV ──
export async function exportInvsCSV(){
  const filter = document.getElementById('inv-filter')?.value||'';
  const search = (document.getElementById('inv-search')?.value||'').toLowerCase();
  let invs = await dAll('invoices');
  if(filter) invs = invs.filter(i=>i.status===filter);
  if(search) invs = invs.filter(i=>(i.clientName+i.number+i.description).toLowerCase().includes(search));
  invs.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  const allPmts = await dAll('payments');
  const rows = [['Invoice #','Date','Due Date','Client','Description','Subtotal','VAT','Total','Paid','Outstanding','Status','Job Ref']];
  invs.forEach(inv=>{
    const t = calcInvTotal(inv);
    const paid = allPmts.filter(p=>p.invId===inv.id).reduce((s,p)=>s+p.amount,0);
    rows.push([
      inv.number, inv.date||'', inv.dueDate||'',
      inv.clientName||'', (inv.description||'').replace(/,/g,' '),
      t.sub.toFixed(2), t.vat.toFixed(2), t.grand.toFixed(2),
      paid.toFixed(2), Math.max(0,t.grand-paid).toFixed(2),
      inv.status||'', inv.jobRef||''
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'invoices-'+TODAY()+'.csv';
  a.click();
  toast(`✅ ${invs.length} invoices exported to CSV`, 'success');
}

// ── Send all overdue reminders via WhatsApp at once ──
// ── WhatsApp template preview & copy ────────────────────────────────────────
export function previewWaTemplate(type){
  const tpls={job:S.waJobTpl,inv:S.waInvTpl,overdue:S.waOverdueTpl,tenant:S.waTenantTpl,landlord:S.waLandlordTpl};
  const tpl=tpls[type]||'(No template saved)';
  const vars={
    engineer_name:'Izhar Ahmed', address:'44 Myrtle Street, London, E1 1EU',
    time_slot:'9:00 – 11:00 AM', access:'Keys in office', contact:'07700 900123',
    description:'EICR Full Inspection', referrer:'Mandeep', company_name:S.coName||'Your Company',
    company_phone:S.coPhone||'+44 7865 753925',
    client_name:'N&N Properties', invoice_num:'INV-2009', amount:'£150.00',
    due_date:'21/07/2026', bank_details:`${S.bankName||'Barclays'} | ${S.bankAcc||'12345678'} | ${S.bankSort||'20-00-00'}`,
    days_overdue:'16', due_date_str:'05/07/2026',
    tenant_name:'John Smith', date:'Wednesday 18 Mar', engineer:'Izhar Ahmed',
    landlord_name:'Mandeep Singh',
  };
  const filled=fillTemplate(tpl,vars);
  const existing=document.getElementById('wa-preview-modal');
  if(existing) existing.remove();
  const div=document.createElement('div');
  div.id='wa-preview-modal';
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  div.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border2);border-radius:14px;padding:20px;max-width:420px;width:90%;box-shadow:var(--sh2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--txt)">📱 Preview — how it will look</div>
      <button onclick="document.getElementById('wa-preview-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--txt3)">✕</button>
    </div>
    <div style="background:#dcfce7;border-radius:10px 10px 0 10px;padding:12px 14px;font-size:12px;line-height:1.7;white-space:pre-wrap;color:#1a1a1a;max-height:300px;overflow-y:auto">${filled.replace(/</g,'&lt;')}</div>
    <div style="font-size:10px;color:var(--txt3);margin-top:8px">Sample data used for preview. Real data filled at send time.</div>
    <button onclick="navigator.clipboard.writeText(${JSON.stringify(filled)});toast('Copied!','success',1500)" class="btn btn-ghost btn-sm" style="margin-top:10px">📋 Copy this message</button>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener('click',e=>{ if(e.target===div) div.remove(); });
}

export async function copyWaTemplate(type){
  const tpls={tenant:S.waTenantTpl,landlord:S.waLandlordTpl};
  const tpl=tpls[type];
  if(!tpl){ toast('No template saved — save it first','warn'); return; }
  // Use last opened job if available
  const j=_lastOpenedJob||{};
  const vars={
    tenant_name:j.tenantName||j.tenantContact||'—',
    landlord_name:j.landlordName||'—',
    address:j.address||'—', date:j.date||'—', time_slot:j.timeSlot||'—',
    engineer:j.engineer||'—', description:j.description||'—',
    company_name:S.coName||'Your Company', company_phone:S.coPhone||'',
  };
  const msg=fillTemplate(tpl,vars);
  await navigator.clipboard.writeText(msg);
  toast('📋 Template copied with job data — paste into WhatsApp','success',3000);
}

export async function sendAllOverdueWA(){
  const invs = await dAll('invoices');
  const today = TODAY();
  const overdue = invs.filter(i=>i.status==='Awaiting Payment' && i.dueDate && i.dueDate < today);
  if(!overdue.length){ toast('No overdue invoices to remind','info'); return; }
  const confirmed = confirm(`Send WhatsApp overdue reminders to ${overdue.length} client${overdue.length!==1?'s':''}?`);
  if(!confirmed) return;
  let sent = 0;
  for(const inv of overdue){
    const t = calcInvTotal(inv);
    const daysOver = Math.ceil((new Date(today)-new Date(inv.dueDate))/86400000);
    const msg = (S.waOverdueTpl||'Invoice {invoice_num} for £{amount} is {days_overdue} days overdue. Please arrange payment.')
      .replace('{invoice_num}',inv.number)
      .replace('{amount}',t.grand.toFixed(2))
      .replace('{days_overdue}',daysOver)
      .replace('{client_name}',inv.clientName||'')
      .replace('{due_date}',inv.dueDate||'')
      .replace('{company_name}',S.coName||'');
    const wa = inv.clientWA||'';
    if(wa){ window.open('https://wa.me/'+wa.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg),'_blank'); sent++; await new Promise(r=>setTimeout(r,600)); }
  }
  toast(`📱 Opened ${sent} WhatsApp reminders`, 'success');
}
