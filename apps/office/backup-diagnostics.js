// Backup & diagnostics — the one-click compliance backup (jobs/invoices/
// certs snapshot), the jobs-list skeleton-screen placeholder, and the
// Settings "Guide" tab's pg_cron setup checker. Extracted from main.js
// verbatim (Phase 5 of the architecture migration, module 13 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// These three functions are non-contiguous in main.js: a large, unheaded,
// self-invoking bootstrap IIFE (the app's real login/session-restore
// entry point — reassigns the shared _appUser state, calls init()/
// applyUserPermissions()/startRealtimeSync()) sits between
// showJobsSkeleton and checkCronSetup with no section divider of its
// own. That bootstrap code is NOT part of this extraction and was left
// completely untouched in main.js — moving app-shell bootstrap code into
// a feature module would be a real behavioural change, not a relocation.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { dAll, toast, TODAY, updateBadges, calcInvTotal, _sb, exportBackup } from './main.js';

// ════════════════════════════════════════════════════════════════
//  ONE-CLICK COMPLIANCE BACKUP
// ════════════════════════════════════════════════════════════════
export async function oneClickBackup(format){
  if(format === 'json'){
    exportBackup();
    return;
  }
  // CSV — export all stores
  const jobs = await dAll('jobs');
  const invs = await dAll('invoices');
  const exps = await dAll('expenses');
  const certs = await dAll('certs');

  let out = '';

  out += '=== JOBS ===\n';
  const jRows = [['Job#','Date','Address','Referrer','Trade','Engineer','Description','Time Slot','Hours','Price (£)','Status','Priority','Notes']];
  jobs.forEach(j=>jRows.push([j.date,j.date,j.address,j.referrer||'',j.trade||'',j.engineer||'',j.description||'',j.timeSlot||'',j.hours||0,j.price||0,j.status,j.priority||'Normal',j.notes||'']));
  out += jRows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n') + '\n\n';

  out += '=== INVOICES ===\n';
  const iRows = [['Invoice#','Date','Due Date','Client','Description','Subtotal','VAT','Total','Status']];
  invs.forEach(i=>{const t=calcInvTotal(i);iRows.push([i.number,i.date,i.dueDate||'',i.clientName||'',i.description||'',t.sub.toFixed(2),t.vat.toFixed(2),t.grand.toFixed(2),i.status])});
  out += iRows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n') + '\n\n';

  out += '=== EXPENSES ===\n';
  const eRows = [['Date','Engineer','Category','Description','Cost (£)','Receipt']];
  exps.forEach(e=>eRows.push([e.date,e.engineer||'',e.category,e.desc,e.cost.toFixed(2),e.receipt||'']));
  out += eRows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n') + '\n\n';

  out += '=== CERTIFICATES ===\n';
  const cRows = [['Address','Type','Issue Date','Expiry Date','Landlord','Cert #','Notes']];
  certs.forEach(c=>cRows.push([c.address,c.type,c.issueDate,c.expiryDate,c.landlord||'',c.certNum||'',c.notes||'']));
  out += cRows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');

  const blob = new Blob([out],{type:'text/csv'});
  const a = document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`DeepFlow-Compliance-Backup-${TODAY()}.csv`;a.click();
  toast('✅ Compliance backup exported — all jobs, invoices, expenses, certs!', 'success', 5000);
}

// ════════════════════════════════════════════════════════════════
//  SKELETON SCREEN HELPERS
// ════════════════════════════════════════════════════════════════
export function showJobsSkeleton(){
  const scroll = document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  scroll.innerHTML = Array(6).fill(`<div style="padding:6px 12px"><div class="skeleton sk-text" style="width:140px;margin-bottom:5px"></div><div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;gap:8px"><div class="skeleton" style="width:4px;border-radius:2px;min-height:40px"></div><div style="flex:1"><div class="skeleton sk-text w80"></div><div class="skeleton sk-text w60" style="margin-top:4px"></div></div></div></div>`).join('');
}
// ════════════════════════════════════════════════════════════════
//  TASK 27: Check if pg_cron is active in Supabase
// ════════════════════════════════════════════════════════════════
export async function checkCronSetup(){
  const el=document.getElementById('cron-check-result');
  if(el) el.textContent='Checking…';
  try{
    // Honest 3-part check (table / function / cron schedule) — see
    // PHASE4_CERT_REMINDER_CHECK_SQL.md. The old version of this only ever
    // checked the table and called it "complete," which was misleading.
    const rows=await _sb('rpc/check_cert_reminder_setup',{method:'POST',body:{}});
    if(!Array.isArray(rows)||!rows.length) throw new Error('no data returned');
    const byStep={}; rows.forEach(r=>{byStep[r.step]={done:r.done,detail:r.detail};});
    const line=(ok,label)=>`<div>${ok?'✅':'❌'} ${escHtml(label)}</div>`;
    const allDone = !!(byStep.table?.done && byStep.function?.done && byStep.cron?.done);
    const html =
      line(byStep.table?.done,'Step 2 — cert_reminder_log table')+
      line(byStep.function?.done,'Step 3 — send_cert_reminders() function')+
      line(byStep.cron?.done, byStep.cron?.done?'Step 4 — scheduled daily at 9am UTC':'Step 4 — '+(byStep.cron?.detail||'not scheduled'))+
      `<div style="margin-top:6px;font-weight:700;color:${allDone?'var(--green)':'var(--yellow)'}">${allDone?'✅ Fully set up and running':'⚠️ Setup incomplete — run the missing SQL steps above'}</div>`;
    if(el) el.innerHTML=html;
  }catch(e){
    if(el) el.innerHTML='<span style="color:var(--yellow)">⚠️ Could not check — run PHASE4_CERT_REMINDER_CHECK_SQL.md first, then the Task 27 SQL above</span>';
  }
}
