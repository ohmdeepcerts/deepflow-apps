// Expenses / Materials — per-job expense tracking (materials, fuel,
// other costs), its add/edit modal, and CSV export. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 7 —
// see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import {
  S, dAll, dGet, dPut, dDel, toast, confirm2, uid, TODAY, logActivity,
  closeModal, openModal, calcInvTotal,
} from './main.js';

let editExpId = null;

// ════════════════════════════════════════════════════════════════
//  EXPENSES / MATERIALS
// ════════════════════════════════════════════════════════════════

export async function openExpenseModal(id){
  editExpId = id || null;
  // Fill engineer dropdown
  const engSel = document.getElementById('expf-eng');
  engSel.innerHTML = '<option value="">— Select Engineer —</option>' + (S.engineers||[]).map(e=>`<option>${e.name}</option>`).join('');
  // Fill jobs dropdown
  const jobSel = document.getElementById('expf-job');
  const jobs = await dAll('jobs');
  const invs = await dAll('invoices');
  jobSel.innerHTML = '<option value="">— None —</option>' +
    jobs.sort((a,b)=>b.created-a.created).slice(0,50).map(j=>`<option value="job:${j.id}">${j.date} · ${escHtml(j.address)}</option>`).join('') +
    invs.sort((a,b)=>b.created-a.created).slice(0,30).map(i=>`<option value="inv:${i.id}">${i.number} · ${i.clientName||'—'}</option>`).join('');

  const btnDel = document.getElementById('btn-del-expense');
  if(id){
    const exp = await dGet('expenses', id);
    if(!exp) return;
    document.getElementById('expf-date').value = exp.date;
    document.getElementById('expf-eng').value = exp.engineer||'';
    document.getElementById('expf-job').value = exp.jobRef||'';
    document.getElementById('expf-desc').value = exp.desc||'';
    document.getElementById('expf-cat').value = exp.category||'Materials';
    document.getElementById('expf-cost').value = exp.cost||'';
    document.getElementById('expf-receipt').value = exp.receipt||'';
    btnDel.style.display = '';
  } else {
    document.getElementById('expf-date').value = TODAY();
    document.getElementById('expf-eng').value = '';
    document.getElementById('expf-job').value = '';
    document.getElementById('expf-desc').value = '';
    document.getElementById('expf-cat').value = 'Materials';
    document.getElementById('expf-cost').value = '';
    document.getElementById('expf-receipt').value = '';
    btnDel.style.display = 'none';
  }
  openModal('mo-expense');
}

export async function saveExpense(){
  const desc = document.getElementById('expf-desc').value.trim();
  const cost = parseFloat(document.getElementById('expf-cost').value)||0;
  if(!desc){toast('Description required','error');return}
  const exp = {
    id: editExpId || uid(),
    date: document.getElementById('expf-date').value,
    engineer: document.getElementById('expf-eng').value,
    jobRef: document.getElementById('expf-job').value,
    desc, category: document.getElementById('expf-cat').value,
    cost, receipt: document.getElementById('expf-receipt').value.trim(),
    created: editExpId ? undefined : Date.now(),
    modified: Date.now()
  };
  if(!editExpId) exp.created = Date.now();
  await dPut('expenses', exp);
  await logActivity(`Expense logged: ${desc} £${cost.toFixed(2)}`, 'expense');
  toast('Expense saved', 'success');
  closeModal('mo-expense');
  renderExpenses();
}

export async function deleteCurrentExpense(){
  confirm2('Delete Expense','Remove this expense permanently?', async()=>{
    await dDel('expenses', editExpId);
    closeModal('mo-expense');
    renderExpenses();
    toast('Expense deleted','warn');
  });
}

export async function renderExpenses(){
  const engineerF = document.getElementById('exp-filter-eng')?.value||'';
  const jobF = document.getElementById('exp-filter-job')?.value||'';

  // Fill filters
  const engSel = document.getElementById('exp-filter-eng');
  if(engSel){
    const cv = engSel.value;
    engSel.innerHTML = '<option value="">Engineer</option>' + (S.engineers||[]).map(e=>`<option ${e.name===cv?'selected':''}>${e.name}</option>`).join('');
  }

  let exps = await dAll('expenses');
  if(engineerF) exps = exps.filter(e => e.engineer===engineerF);
  if(jobF) exps = exps.filter(e => e.jobRef===jobF);
  exps.sort((a,b) => b.date.localeCompare(a.date));

  // Summary cards
  const totalCost = exps.reduce((s,e)=>s+e.cost,0);
  const byCategory = {};
  exps.forEach(e => { byCategory[e.category] = (byCategory[e.category]||0) + e.cost; });
  const topCat = Object.entries(byCategory).sort((a,b)=>b[1]-a[1])[0];

  // Get linked revenue for P&L
  const jobs = await dAll('jobs');
  const invs = await dAll('invoices');
  const linkedRev = exps.reduce((s,e)=>{
    if(!e.jobRef) return s;
    const [type, id] = (e.jobRef||'').split(':');
    if(type==='job'){const j=jobs.find(x=>x.id===id);return s+(j?.price||0)}
    if(type==='inv'){const i=invs.find(x=>x.id===id);return s+calcInvTotal(i||{}).grand}
    return s;
  },0);
  const profit = linkedRev - totalCost;

  const sumEl = document.getElementById('exp-summary');
  if(sumEl) sumEl.innerHTML = `
    <div class="exp-card"><div class="exp-card-label">Total Expenses</div><div class="exp-card-val" style="color:var(--red)">£${totalCost.toFixed(2)}</div></div>
    <div class="exp-card"><div class="exp-card-label">Top Category</div><div class="exp-card-val" style="font-size:16px;color:var(--acc)">${topCat?topCat[0]+' (£'+topCat[1].toFixed(0)+')':'—'}</div></div>
    <div class="exp-card"><div class="exp-card-label">Linked Revenue</div><div class="exp-card-val" style="color:var(--green)">£${linkedRev.toFixed(2)}</div></div>
    <div class="exp-card"><div class="exp-card-label">Est. Profit</div><div class="exp-card-val ${profit>=0?'pl-pos':'pl-neg'}">£${profit.toFixed(2)}</div></div>
  `;

  const tbody = document.getElementById('exp-tbody');
  if(!tbody) return;
  if(!exps.length){
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><div class="ei">🧾</div><p>No expenses logged yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = exps.map(e => `<tr>
    <td>${e.date}</td>
    <td style="font-size:11px;color:var(--txt2)">${e.jobRef?e.jobRef.split(':')[0]+' linked':'—'}</td>
    <td style="font-family:var(--fh);font-weight:600">${e.desc}</td>
    <td><span class="tag t-sc">${e.category}</span></td>
    <td>${e.engineer||'—'}</td>
    <td style="font-family:var(--fh);font-weight:700;color:var(--red)">£${Number(e.cost).toFixed(2)}</td>
    <td style="font-size:11px;color:var(--txt3)">${e.receipt||'—'}</td>
    <td><button class="btn-icon" onclick="openExpenseModal('${e.id}')">✎</button></td>
  </tr>`).join('');
}

export async function exportExpensesCSV(){
  const exps = await dAll('expenses');
  let rows = [['Date','Engineer','Category','Description','Cost (£)','Receipt','Job Ref']];
  exps.forEach(e => rows.push([e.date,e.engineer||'',e.category,e.desc,e.cost.toFixed(2),e.receipt||'',e.jobRef||'']));
  const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`DeepFlow-Expenses-${TODAY()}.csv`;a.click();
  toast('Expenses CSV exported','success');
}

