// Credit Notes — the credit-note modal (issue a credit against an
// existing invoice), its line-item editor, and save flow. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 8 —
// see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import {
  S, dAll, dGet, dPut, toast, uid, TODAY, logActivity, updateBadges,
  closeModal, openModal, calcInvTotal, renderInvList,
} from './main.js';

let _cnItems = [];

// ════════════════════════════════════════════════════════════════
//  CREDIT NOTES
// ════════════════════════════════════════════════════════════════

export async function openCreditNoteModal(){
  const invs = (await dAll('invoices')).filter(i => i.status !== 'Credit Note');
  const sel = document.getElementById('cn-inv');
  sel.innerHTML = '<option value="">— Select Invoice —</option>' +
    invs.sort((a,b)=>b.created-a.created).map(i=>`<option value="${i.id}">${i.number} · ${i.clientName||'—'} · £${calcInvTotal(i).grand.toFixed(2)}</option>`).join('');
  _cnItems = [];
  document.getElementById('cn-items').innerHTML = '';
  document.getElementById('cn-total').textContent = '£0.00';
  document.getElementById('cn-inv-info').style.display = 'none';
  document.getElementById('cn-notes').value = '';
  openModal('mo-credit');
}

// Wrapper for creating credit note from an invoice (backward compat)
export async function creditNote(invId){
  await openCreditNoteModal();
  if(invId){
    const sel = document.getElementById('cn-inv');
    if(sel) sel.value = invId;
    await fillCreditNote(invId);
  }
}

export async function fillCreditNote(invId){
  if(!invId){document.getElementById('cn-inv-info').style.display='none';_cnItems=[];renderCreditItems();return}
  const inv = await dGet('invoices', invId);
  if(!inv) return;
  const t = calcInvTotal(inv);
  document.getElementById('cn-inv-info').style.display = '';
  document.getElementById('cn-inv-info').innerHTML = `<strong>${inv.number}</strong> · ${inv.clientName||'—'} · Total: £${t.grand.toFixed(2)} · Status: ${inv.status}`;
  // Pre-fill items from original
  _cnItems = (inv.items||[]).map(i => ({...i}));
  renderCreditItems();
}

export function addCreditItem(){
  _cnItems.push({desc:'', qty:1, unit:0, vat:false});
  renderCreditItems();
}

export function renderCreditItems(){
  const c = document.getElementById('cn-items');
  c.innerHTML = _cnItems.map((it,i) => `
    <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
      <input class="fi" style="flex:2" value="${it.desc}" placeholder="Description" oninput="_cnItems[${i}].desc=this.value">
      <input class="fi" type="number" style="width:55px" value="${it.qty}" min="1" oninput="_cnItems[${i}].qty=+this.value;updCNTotal()">
      <input class="fi" type="number" style="width:80px" value="${it.unit}" min="0" step="0.01" placeholder="£" oninput="_cnItems[${i}].unit=+this.value;updCNTotal()">
      <button class="btn btn-red btn-xs" onclick="_cnItems.splice(${i},1);renderCreditItems()">✕</button>
    </div>`).join('');
  updCNTotal();
}

export function updCNTotal(){
  const total = _cnItems.reduce((s,i) => s + (i.qty||1)*(i.unit||0), 0);
  document.getElementById('cn-total').textContent = '£' + total.toFixed(2);
}

export async function saveCreditNote(){
  const invId = document.getElementById('cn-inv').value;
  if(!invId){toast('Select an invoice','error');return}
  if(!_cnItems.length){toast('Add at least one credit item','error');return}
  const origInv = await dGet('invoices', invId);
  const cn = {
    id: uid(),
    number: (S.invPrefix||'INV-') + 'CN-' + (origInv?.number||'').replace(S.invPrefix||'INV-',''),
    clientId: origInv?.clientId, clientName: origInv?.clientName,
    clientEmail: origInv?.clientEmail, clientAddr: origInv?.clientAddr,
    clientWA: origInv?.clientWA||'',
    date: TODAY(), dueDate: '',
    description: 'Credit Note for ' + (origInv?.number||''),
    notes: document.getElementById('cn-notes').value,
    items: JSON.parse(JSON.stringify(_cnItems)),
    status: 'Credit Note',
    linkedInvId: invId,
    reason: document.getElementById('cn-reason').value,
    created: Date.now()
  };
  await dPut('invoices', cn);
  // Full audit log
  const cnAmt = calcInvTotal(cn).grand;
  await logActivity(
    `Credit note ${cn.number} issued · £${cnAmt.toFixed(2)} reduction · Client: ${origInv?.clientName||'—'} · Reason: ${cn.reason||cn.notes||'not stated'}`,
    'credit',
    {
      invId: invId,
      invNum: origInv?.number||'',
      jobId: origInv?.linkedJobId||origInv?.jobId||'',
      jobNum: origInv?.jobNum||'',
      amount: cnAmt,
      staff: S.currentUser||S.adminName||'Admin',
      oldVal: `£${calcInvTotal(origInv||{}).grand.toFixed(2)}`,
      newVal: `£${(calcInvTotal(origInv||{}).grand - cnAmt).toFixed(2)} (after credit)`
    }
  );
  toast(`Credit note ${cn.number} issued`, 'success');
  closeModal('mo-credit');
  renderInvList();
  updateBadges();
}

// ════════════════════════════════════════════════════════════════
