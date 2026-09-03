// Invoice "extras": Credit Notes admin overview, partial-payment recording,
// the ageing report, and the invoice Kanban board. Extracted from main.js
// verbatim (Phase 5c of the follow-up modularization pass — see the plan
// file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { TO_DB as _TO_DB } from '@data';
import { regenerateCertsForPaidJob } from './certs-pdf.js';
import {
  dAll, dGet, dPut, calcInvTotal, toast, openModal, closeModal, TODAY, uid,
  curInvId, viewInv, renderInvList, updateBadges, logActivity,
  generateAndStoreInvoicePDF, _maybeSendPaymentReceipt,
} from './main.js';

// ── Credit Notes Admin Panel ──────────────────────────────────────────────────
export async function renderCreditNotesAdmin(){
  const el = document.getElementById('inv-special-view');
  el.innerHTML=`<div style="font-size:12px;color:var(--txt3)">Loading credit notes…</div>`;

  const [allInvs, allActs] = await Promise.all([dAll('invoices'), dAll('activity')]);
  const cns = allInvs.filter(i=>i.status==='Credit Note'||i.isCreditNote);

  const totalLoss = cns.reduce((s,cn)=>s+calcInvTotal(cn).grand, 0);
  const byStaff = {};
  const byClient = {};
  cns.forEach(cn=>{
    const staff = cn.issuedBy||cn.staff||'Unknown';
    const client = cn.clientName||'Unknown';
    byStaff[staff] = (byStaff[staff]||0) + calcInvTotal(cn).grand;
    byClient[client] = (byClient[client]||0) + calcInvTotal(cn).grand;
  });

  const kpi=(val,lbl,col='var(--acc)')=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:20px;font-weight:900;color:${col}">${val}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.3px">${lbl}</div>
    </div>`;

  el.innerHTML=`
    <div style="max-width:900px">
      <div style="font-size:15px;font-weight:800;margin-bottom:16px">↩ Credit Notes — Admin Overview</div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px">
        ${kpi(cns.length,'Total credit notes','#7c3aed')}
        ${kpi('£'+totalLoss.toFixed(2),'Total company loss','var(--red)')}
        ${kpi(Object.keys(byStaff).length,'Staff involved','var(--yellow)')}
        ${kpi(Object.keys(byClient).length,'Clients affected','var(--txt2)')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Loss by Staff</div>
          ${Object.entries(byStaff).sort((a,b)=>b[1]-a[1]).map(([name,amt])=>`
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${name}</span><span style="font-weight:700;color:var(--red)">£${amt.toFixed(2)}</span>
            </div>`).join('') || '<div style="font-size:11px;color:var(--txt3)">No data</div>'}
        </div>
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Loss by Client</div>
          ${Object.entries(byClient).sort((a,b)=>b[1]-a[1]).map(([name,amt])=>`
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${name}</span><span style="font-weight:700;color:var(--red)">£${amt.toFixed(2)}</span>
            </div>`).join('') || '<div style="font-size:11px;color:var(--txt3)">No data</div>'}
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">All Credit Notes</div>
      ${cns.sort((a,b)=>b.created-a.created).map(cn=>{
        const amt = calcInvTotal(cn).grand;
        const act = allActs.filter(a=>a.invId===cn.id||a.invNum===cn.number).sort((a,b)=>b.ts-a.ts)[0];
        return`<div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:6px;display:flex;gap:14px;align-items:center">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:700;color:#7c3aed;font-family:monospace">${cn.number}</span>
              <span style="font-size:11px;color:var(--txt3)">${cn.date||''}</span>
              ${cn.issuedBy||cn.staff?`<span style="font-size:11px;color:var(--txt2)">by ${cn.issuedBy||cn.staff}</span>`:''}
            </div>
            <div style="font-size:12px;font-weight:600">${cn.clientName||'—'}</div>
            <div style="font-size:11px;color:var(--txt2);margin-top:2px">${cn.reason||cn.notes||cn.description||'No reason recorded'}</div>
            ${act?`<div style="font-size:10px;color:var(--txt3);margin-top:3px">Last activity: ${act.msg.slice(0,60)}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:16px;font-weight:900;color:var(--red)">-£${amt.toFixed(2)}</div>
            ${cn.linkedInvId?`<div style="font-size:10px;color:var(--acc);cursor:pointer;margin-top:3px" onclick="invNavSelect('all');setTimeout(()=>viewInv('${cn.linkedInvId}'),300)">View original →</div>`:''}
          </div>
        </div>`;
      }).join('') || `<div style="text-align:center;padding:30px;color:var(--txt3)">No credit notes issued</div>`}
    </div>`;
}

// ════════════════════════════════════════════════════════════════
//  PARTIAL PAYMENTS
// ════════════════════════════════════════════════════════════════
let _payInvId=null;

export async function openPaymentModal(invId){
  _payInvId=invId;
  const inv=await dGet('invoices',invId);
  if(!inv) return;
  const t=calcInvTotal(inv);
  const payments=await dAll('payments');
  const invPayments=payments.filter(p=>p.invId===invId);
  const paid=invPayments.reduce((s,p)=>s+p.amount,0);
  const outstanding=t.grand-paid;

  document.getElementById('payment-inv-info').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><strong>${inv.number}</strong> · ${inv.clientName}</div>
      <div style="font-family:var(--fh);font-weight:700;font-size:18px">£${t.grand.toFixed(2)}</div>
    </div>
    <div style="margin-top:6px;font-size:11px;color:var(--txt2)">Paid: £${paid.toFixed(2)} · Outstanding: <strong style="color:${outstanding>0?'var(--yellow)':'var(--green)'}">${outstanding<=0?'FULLY PAID':'£'+outstanding.toFixed(2)}</strong></div>
  `;

  document.getElementById('pay-amount').value=outstanding>0?outstanding.toFixed(2):'';
  document.getElementById('pay-date').value=TODAY();
  document.getElementById('pay-method').value='Bank Transfer';
  document.getElementById('pay-ref').value='';

  // Progress bar
  const pct=t.grand>0?Math.min(100,paid/t.grand*100):0;
  document.getElementById('pay-bar').style.width=pct+'%';
  document.getElementById('pay-progress-txt').textContent=`${pct.toFixed(0)}% paid (£${paid.toFixed(2)} of £${t.grand.toFixed(2)})`;

  // Existing payments
  if(invPayments.length){
    document.getElementById('existing-payments').innerHTML=`
      <div style="font-size:10px;color:var(--txt3);letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600;margin-bottom:6px">Payment History</div>
      <table class="plog-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
        <tbody>${invPayments.map(p=>`<tr><td>${p.date}</td><td style="color:var(--green);font-weight:700">£${p.amount.toFixed(2)}</td><td>${p.method}</td><td style="color:var(--txt3)">${p.ref||'—'}</td></tr>`).join('')}</tbody>
      </table>
    `;
  } else {
    document.getElementById('existing-payments').innerHTML='';
  }
  openModal('mo-payment');
}

// M-4: savePayment() had no submit-lock at all — a double-click, or a slow
// connection making the office wonder if the first click registered and
// clicking again, could record the same payment twice with no warning.
let _savingPayment=false;
export async function savePayment(){
  if(_savingPayment) return;
  const invId=_payInvId;
  const amount=parseFloat(document.getElementById('pay-amount').value)||0;
  if(amount<=0){toast('Enter a valid amount','error');return}
  _savingPayment=true;
  const btn=document.getElementById('btn-save-payment');
  if(btn){ btn.disabled=true; btn.textContent='Recording…'; }
  try{
    const payment={
      id:uid(),invId,
      date:document.getElementById('pay-date').value,
      amount,
      method:document.getElementById('pay-method').value,
      ref:document.getElementById('pay-ref').value,
      created:Date.now()
    };
    await dPut('payments',payment);

    // Check if fully paid
    const inv=await dGet('invoices',invId);
    const t=calcInvTotal(inv);
    const allPmts=await dAll('payments');
    const invPmts=allPmts.filter(p=>p.invId===invId);
    const totalPaid=invPmts.reduce((s,p)=>s+p.amount,0);

    if(totalPaid>=t.grand-0.01){
      inv.status='Paid';
      await dPut('invoices',inv);
      _maybeSendPaymentReceipt(inv, totalPaid);
      toast('Invoice fully paid! Status updated.','success');
      const invJobId=inv.jobId||inv.linkedJobId;
      if(invJobId) regenerateCertsForPaidJob(invJobId).catch(e=>console.warn('[DeepFlow] Cert release after payment failed',e));
    } else {
      toast(`Payment of £${amount.toFixed(2)} recorded. Outstanding: £${(t.grand-totalPaid).toFixed(2)}`,'success');
    }
    // Both branches: the stored PDF (what the Client Portal shows — it
    // never renders its own copy) carries a Paid/Partial/Unpaid stamp, so
    // it goes stale the moment a payment changes which of those is true,
    // not just when it flips to fully Paid.
    generateAndStoreInvoicePDF(invId).catch(e=>console.warn('[DeepFlow] PDF regen after payment failed',e));
    await logActivity(`Payment £${amount.toFixed(2)} recorded for ${inv.number}`,'invoice');
    closeModal('mo-payment');
    renderInvList();
    if(curInvId===invId) viewInv(invId);
    updateBadges();
  } finally {
    _savingPayment=false;
    if(btn){ btn.disabled=false; btn.textContent='Record Payment'; }
  }
}

// ════════════════════════════════════════════════════════════════
//  AGEING REPORT
// ════════════════════════════════════════════════════════════════
let _ageSelected=null;

export async function renderAgeingReport(){
  const invs=await dAll('invoices');
  const outstanding=invs.filter(i=>i.status==='Awaiting Payment');
  const now=new Date();

  const buckets={
    '0–30':{label:'0–30 days',invs:[],color:'var(--green)'},
    '31–60':{label:'31–60 days',invs:[],color:'var(--yellow)'},
    '61–90':{label:'61–90 days',invs:[],color:'var(--orange)'},
    '90+':{label:'Over 90 days',invs:[],color:'var(--red)'},
  };

  outstanding.forEach(inv=>{
    const due=inv.dueDate?new Date(inv.dueDate):new Date(inv.date);
    const days=Math.ceil((now-due)/(1000*60*60*24));
    if(days<=30) buckets['0–30'].invs.push({...inv,daysOver:days});
    else if(days<=60) buckets['31–60'].invs.push({...inv,daysOver:days});
    else if(days<=90) buckets['61–90'].invs.push({...inv,daysOver:days});
    else buckets['90+'].invs.push({...inv,daysOver:days});
  });

  const grid=document.getElementById('age-grid');
  if(!grid) return;

  grid.innerHTML=Object.entries(buckets).map(([key,b])=>{
    const total=b.invs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
    return`<div class="age-bucket" onclick="showAgeBucket('${key}')">
      <div class="age-bucket-label">${b.label}</div>
      <div class="age-bucket-val" style="color:${b.color}">£${total.toFixed(0)}</div>
      <div class="age-bucket-count">${b.invs.length} invoice${b.invs.length!==1?'s':''}</div>
    </div>`;
  }).join('');

  // Store for bucket detail
  window._ageBuckets=buckets;
}

export function showAgeBucket(key){
  const b=window._ageBuckets?.[key];
  const detail=document.getElementById('age-detail');
  if(!b||!detail) return;
  if(_ageSelected===key){
    _ageSelected=null;
    detail.innerHTML='';
    return;
  }
  _ageSelected=key;
  if(!b.invs.length){detail.innerHTML='';return}
  detail.innerHTML=`
    <div class="age-detail">
      <div style="font-family:var(--fh);font-weight:700;margin-bottom:12px">${b.label} — ${b.invs.length} invoices</div>
      <table class="plog-table">
        <thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Due Date</th><th>Days Over</th><th>Action</th></tr></thead>
        <tbody>${b.invs.sort((a,c)=>c.daysOver-a.daysOver).map(inv=>{
          const t=calcInvTotal(inv);
          return`<tr>
            <td style="font-family:var(--fh);font-weight:700;color:var(--acc)">${inv.number}</td>
            <td>${inv.clientName||'—'}</td>
            <td style="font-family:var(--fh);font-weight:700">£${t.grand.toFixed(2)}</td>
            <td>${inv.dueDate||'—'}</td>
            <td style="color:var(--red);font-weight:700">${inv.daysOver}d</td>
            <td><button class="btn btn-wa btn-xs" onclick="sendOverdueWA('${inv.id}')">📱 Remind</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  INVOICE KANBAN BOARD
// ════════════════════════════════════════════════════════════════
export let invViewMode = 'list';
let _kanbanDragId = null;

export function setInvView(mode){
  invViewMode = mode;
  const listView = document.getElementById('inv-list-view');
  const kanbanView = document.getElementById('inv-kanban-view');
  const btnList = document.getElementById('btn-inv-list');
  const btnKanban = document.getElementById('btn-inv-kanban');
  if(mode === 'kanban'){
    listView.style.display = 'none';
    kanbanView.style.display = 'flex';
    btnKanban.style.background = 'var(--acc)';btnKanban.style.color='#000';
    btnList.style.background = '';btnList.style.color='';
    renderKanban();
  } else {
    listView.style.display = '';
    kanbanView.style.display = 'none';
    btnList.style.background = 'var(--acc)';btnList.style.color='#000';
    btnKanban.style.background = '';btnKanban.style.color='';
    renderInvList();
  }
}

export async function renderKanban(){
  const board = document.getElementById('kanban-board');
  if(!board) return;

  const cols = [
    {key:'Draft', label:'📝 Draft', color:'var(--purple)'},
    {key:'Awaiting Payment', label:'📤 Sent / Awaiting', color:'var(--yellow)'},
    {key:'Paid', label:'✅ Paid', color:'var(--green)'},
    {key:'Cancelled', label:'⊘ Cancelled', color:'var(--txt3)'},
    {key:'Credit Note', label:'↩ Credit Notes', color:'var(--purple)'},
  ];

  const invs = await dAll('invoices');
  const byStatus = {};
  cols.forEach(c => byStatus[c.key] = []);
  invs.forEach(inv => {
    const key = inv.status || 'Draft';
    if(byStatus[key]) byStatus[key].push(inv);
    else byStatus['Draft'].push(inv);
  });

  board.innerHTML = cols.map(col => {
    const cards = byStatus[col.key] || [];
    const total = cards.reduce((s,i) => s + calcInvTotal(i).grand, 0);
    return `<div class="kanban-col" data-status="${col.key}" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,'${col.key}')" ondragleave="this.classList.remove('drag-over')">
      <div class="kanban-col-hd">
        <div class="kanban-col-title" style="color:${col.color}">${col.label}</div>
        <div class="kanban-col-count">${cards.length}</div>
        ${total>0?`<div style="font-size:11px;font-family:var(--fh);font-weight:700;color:${col.color}">£${total.toFixed(0)}</div>`:''}
      </div>
      <div class="kanban-col-body">
        ${cards.sort((a,b)=>b.created-a.created).map(inv => {
          const t = calcInvTotal(inv);
          return `<div class="kanban-card" draggable="true" data-id="${inv.id}"
            ondragstart="kanbanDragStart(event,'${inv.id}')"
            ondragend="this.classList.remove('dragging')"
            onclick="viewInv('${inv.id}');setInvView('list')">
            <div class="kanban-card-num">${inv.number}${(inv.isCreditNote||inv.status==='Credit Note')?` <span style="font-size:9px;color:var(--purple)">[CN]</span>`:''}</div>
            <div class="kanban-card-client">${inv.clientName||'—'}</div>
            <div class="kanban-card-meta">${inv.date}${inv.dueDate?' · Due: '+inv.dueDate:''}</div>
            <div class="kanban-card-amt" style="color:${col.color}">£${t.grand.toFixed(2)}</div>
          </div>`;
        }).join('')}
        ${cards.length===0?`<div style="padding:20px;text-align:center;color:var(--txt3);font-size:12px">Drop here</div>`:''}
      </div>
    </div>`;
  }).join('');
}

export function kanbanDragStart(e, id){
  _kanbanDragId = id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
export function kanbanDragOver(e, col){
  e.preventDefault();
  col.classList.add('drag-over');
}
export async function kanbanDrop(e, newStatus){
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drag-over'));
  if(!_kanbanDragId) return;
  const inv = await dGet('invoices', _kanbanDragId);
  if(!inv) return;
  inv.status = newStatus;
  // Try full save first; if a column doesn't exist, strip it and retry
  try{
    await dPut('invoices', inv);
  }catch(colErr){
    if(colErr.message?.includes('PGRST204')||colErr.message?.includes('not find')){
      // Extract which column is missing and strip it
      const missingCol = (colErr.message.match(/not find the '(\w+)' column/)||[])[1];
      if(missingCol){
        const stripped = {...inv};
        // Try to find the camelCase key for this DB column
        const dbMap = Object.entries(_TO_DB.invoices||{});
        const camelKey = dbMap.find(([k,v])=>v===missingCol)?.[0] || missingCol;
        delete stripped[camelKey];
        delete stripped[missingCol];
        toast(`ℹ️ Column '${missingCol}' not in DB yet — saving without it. Run the SQL in Guide & SQL to add it.`,'warn',5000);
        await dPut('invoices', stripped);
      } else {
        throw colErr;
      }
    } else {
      throw colErr;
    }
  }
  await logActivity(`Invoice ${inv.number} moved to ${newStatus}`, 'invoice');
  toast(`${inv.number} → ${newStatus}`, 'success');
  renderKanban();
  updateBadges();
  _kanbanDragId = null;
}
