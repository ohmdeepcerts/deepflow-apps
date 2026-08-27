// Engineer Planner — Day/Week/Month drag-and-drop dispatch board.
// Visual design is the scoped, verbatim copy of the shared Jobs/Planner
// design (see dfplanner-styles in index.html's <head>) — this file only
// supplies real data and real behaviour underneath it. Phase 1: Day view.
//
// Deliberately does NOT reuse the demo's flat "client" field — every job's
// billed party is resolved the same way the rest of DeepFlow already does
// (Agency > Agent > Landlord > Referrer), so this stays consistent with the
// reclassification work already shipped rather than regressing to a single
// generic contact.

import { escHtml } from '@ui';
import { S, dAll, _sb, toast } from './main.js';
// openJobModal isn't an ES export of main.js (only exposed on window for
// inline HTML handlers), so it's called via window here rather than imported.

let dfpDate = TODAY();
let dfpMode = 'day';
let activeDragId = null;

function TODAY(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function isoDate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function parseLocalDate(s){ return new Date(`${s}T12:00:00`); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function prettyDate(s, opts={weekday:'short',day:'numeric',month:'short'}){
  return parseLocalDate(s).toLocaleDateString('en-GB',opts);
}
const el = id => document.getElementById(id);
const money = n => '£'+Number(n||0).toFixed(2);

// Same priority chain as billing-name resolution and the invoice sync logic
// elsewhere in main.js: Agency > Agent > Landlord > Referrer.
function resolveContact(j){
  const name = j.agencyName||j.agentName||j.landlordName||j.referrer||'';
  const phone = j.agencyPhone||j.agentPhone||j.landlordPhone||'';
  const email = j.agencyEmail||j.agentEmail||j.landlordEmail||'';
  return {name, phone, email};
}

// Job priority already carries Certificate/Repair/Urgent/Emergency as real
// values (see the job form's Priority select) — reused directly rather than
// inventing a parallel "type" field the demo has but DeepFlow doesn't.
function jobDataType(j){
  const p=(j.priority||'').toLowerCase();
  return ['certificate','repair','urgent','emergency'].includes(p) ? p : 'normal';
}

function invoiceFor(j, invoices){
  return invoices.find(i=>i.jobId===j.id||i.linkedJobId===j.id);
}

function compactInvoiceMarkup(j, invoices){
  const inv=invoiceFor(j, invoices);
  if(!inv||!inv.number){
    return `<div class="job-invoice-line">
      <span class="job-invoice-no">No invoice</span>
      <span class="job-invoice-status none">Not invoiced</span>
    </div>`;
  }
  const isPaid = inv.status==='Paid';
  const cls = isPaid?'paid':(inv.status==='Awaiting Payment'?'unpaid':'partial');
  const label = isPaid?'Paid':(inv.status==='Awaiting Payment'?'Unpaid':inv.status);
  return `<div class="job-invoice-line">
    <span class="job-invoice-no">${escHtml(inv.number)}</span>
    <span class="job-invoice-status ${cls}">${escHtml(label)}</span>
  </div>`;
}

function contactMarkup(j){
  const c = resolveContact(j);
  const phoneDigits=(c.phone||'').replace(/[^\d+]/g,'');
  const waLink = phoneDigits ? `https://wa.me/${phoneDigits.replace('+','')}?text=${encodeURIComponent(`Hello, regarding job ${j.jobNum||''} at ${j.address||''}.`)}` : '#';
  const callLink = phoneDigits ? `tel:${phoneDigits}` : '#';
  return `<div class="client-card">
    <div class="client-name">⌂ ${escHtml(c.name||'—')}</div>
    <div class="client-phone-line">
      <span class="client-phone">☎ ${escHtml(c.phone||'—')}</span>
      ${c.phone?`<button class="contact-icon-btn call" data-open="${callLink}" title="Call">☎</button>
      <button class="contact-icon-btn wa" data-open="${waLink}" title="WhatsApp">✆</button>`:''}
    </div>
  </div>`;
}

function dayJobRow(j, engName, showEngineer, rowCount, total, invoices, unassigned){
  return `<tr class="day-group-row clickable-job" draggable="true" data-job-id="${j.id}" data-type="${jobDataType(j)}">
    ${showEngineer ? `<td class="day-engineer-cell ${unassigned?'unassigned-cell':''}" rowspan="${rowCount}">
      <div class="day-engineer-box">
        <div class="eng-avatar ${unassigned?'unassigned-avatar':''}">${escHtml((engName||'?').slice(0,2).toUpperCase())}</div>
        <div class="engineer-meta">
          <strong>${escHtml(engName||'Unassigned')}</strong>
          <small>${unassigned?'Waiting to be allocated':'Engineer'}</small>
          <div class="eng-stats"><span class="eng-count-text">${rowCount} job${rowCount===1?'':'s'}</span><span class="eng-value-pill">${money(total)}</span></div>
        </div>
      </div>
    </td>` : ''}
    <td class="day-drag">⁙</td>
    <td>
      <div class="job-main-line"><span class="job-no job-no-link">${escHtml(j.jobNum||'')}</span></div>
      ${compactInvoiceMarkup(j, invoices)}
    </td>
    <td class="day-address">${escHtml(j.address||'')}</td>
    <td class="day-desc">${escHtml(j.description||'')}</td>
    <td class="day-access">${escHtml(j.access||'—')}</td>
    <td class="day-time">${escHtml(j.timeSlot||'—')}</td>
    <td class="day-amount">${money(j.price)}</td>
    <td class="day-client">${contactMarkup(j)}</td>
    <td class="day-status"><span class="status">${escHtml(j.status||'Pending')}</span></td>
    <td>
      <div class="day-actions">
        <button class="icon-btn dfp-edit-job" data-id="${j.id}" title="Edit">✎</button>
      </div>
    </td>
  </tr>`;
}

export async function renderPlanner(){
  document.querySelectorAll('#dfpModeToggle .planner-mode-btn').forEach(b=>b.classList.toggle('active', b.dataset.dfpMode===dfpMode));
  el('dfpWeekCalPanel').classList.toggle('show', dfpMode==='week');
  if(!el('dfpDate').value) el('dfpDate').value = dfpDate;
  if(dfpMode==='day') await renderDayPlanner();
  // Week/Month modes follow in the next pass — Day view is real and complete first.
}

async function renderDayPlanner(){
  const [jobs, invoices] = await Promise.all([dAll('jobs'), dAll('invoices')]);
  const dateJobs = jobs.filter(j=>j.date===dfpDate && j.status!=='Cancelled');
  el('dfpDateLabel').textContent = parseLocalDate(dfpDate).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  const engNames = (S.engineers||[]).map(e=>e.name);
  const groups = [...engNames, ''];

  const bodies = groups.map(eng=>{
    const unassigned = !eng;
    const list = dateJobs.filter(j=>(j.engineer||'')===eng);
    const total = list.reduce((s,j)=>s+Number(j.price||0),0);

    if(!list.length){
      return `<tbody class="day-group-body" data-engineer="${escHtml(eng)}">
        <tr class="day-empty-row">
          <td class="day-engineer-cell ${unassigned?'unassigned-cell':''}">
            <div class="day-engineer-box">
              <div class="eng-avatar ${unassigned?'unassigned-avatar':''}">${escHtml((eng||'?').slice(0,2).toUpperCase())}</div>
              <div class="engineer-meta">
                <strong>${escHtml(eng||'Unassigned')}</strong>
                <small>${unassigned?'Waiting to be allocated':'Engineer'}</small>
                <div class="eng-stats"><span class="eng-count-text">0 jobs</span><span class="eng-value-pill">${money(0)}</span></div>
              </div>
            </div>
          </td>
          <td colspan="9"><div class="day-empty-box">Drop a job here to assign it to ${escHtml(eng||'Unassigned')}</div></td>
        </tr>
      </tbody>`;
    }
    return `<tbody class="day-group-body" data-engineer="${escHtml(eng)}">
      ${list.map((j,i)=>dayJobRow(j, eng, i===0, list.length, total, invoices, unassigned)).join('')}
    </tbody>`;
  }).join('');

  el('dfpGrid').innerHTML = `<div class="day-table-wrap">
    <table class="day-table">
      <thead><tr>
        <th style="width:185px">Engineer</th><th style="width:24px"></th><th>Job / Invoice</th>
        <th>Address</th><th>Description</th><th>Access</th><th>Time</th>
        <th style="text-align:right">Amount</th><th>Client + Contact</th><th>Status</th><th>Actions</th>
      </tr></thead>
      ${bodies}
    </table>
  </div>`;

  wireDayDragDrop();
}

function wireDayDragDrop(){
  document.querySelectorAll('#dfpGrid .day-group-row').forEach(row=>{
    row.addEventListener('dragstart', e=>{
      activeDragId = row.dataset.jobId;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', activeDragId);
    });
    row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); activeDragId=null; });
  });

  document.querySelectorAll('#dfpGrid tbody.day-group-body').forEach(zone=>{
    zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e=>{
      e.preventDefault();
      zone.classList.remove('drag-over');
      const jobId = e.dataTransfer.getData('text/plain') || activeDragId;
      if(!jobId) return;
      const newEngineer = zone.dataset.engineer||'';
      const jobs = await dAll('jobs');
      const j = jobs.find(x=>x.id===jobId);
      if(!j || (j.engineer||'')===newEngineer) return;
      await _sb(`jobs?id=eq.${encodeURIComponent(jobId)}`,{method:'PATCH', body:{engineer:newEngineer}, prefer:'return=minimal'});
      toast(`${j.jobNum||'Job'} assigned to ${newEngineer||'Unassigned'}`,'success');
      renderPlanner();
    });
  });
}

document.addEventListener('click', e=>{
  const opener = e.target.closest('#dfpGrid [data-open]');
  if(opener){ const u=opener.dataset.open; if(u&&u!=='#') window.open(u,'_blank'); return; }
  const edit = e.target.closest('#dfpGrid .dfp-edit-job');
  if(edit){ window.openJobModal(edit.dataset.id); return; }
});

export function initPlanner(){
  el('dfpDate').value = dfpDate;
  el('dfpModeToggle').addEventListener('click', e=>{
    const b=e.target.closest('[data-dfp-mode]'); if(!b) return;
    dfpMode = b.dataset.dfpMode;
    renderPlanner();
  });
  el('dfpToday').addEventListener('click', ()=>{ dfpDate=TODAY(); el('dfpDate').value=dfpDate; renderPlanner(); });
  el('dfpDate').addEventListener('change', ()=>{ dfpDate=el('dfpDate').value||TODAY(); renderPlanner(); });
  el('dfpPrev').addEventListener('click', ()=>{ dfpDate=isoDate(addDays(parseLocalDate(dfpDate),-1)); el('dfpDate').value=dfpDate; renderPlanner(); });
  el('dfpNext').addEventListener('click', ()=>{ dfpDate=isoDate(addDays(parseLocalDate(dfpDate),1)); el('dfpDate').value=dfpDate; renderPlanner(); });
}
