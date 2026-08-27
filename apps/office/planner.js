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
import { formatDateUK } from '@business';
import { S, dAll, _sb, toast, calcInvTotal, getAppUser } from './main.js';
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
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return x; }
function endOfWeek(d){ return addDays(startOfWeek(d),6); }
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
  if(dfpMode==='week') await renderWeekPlanner();
  if(dfpMode==='month') await renderMonthPlanner();
}

function confirmMoveJobDate(job, newDate){
  if(!job || !newDate || job.date===newDate) return false;
  const from=prettyDate(job.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const to=prettyDate(newDate,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  return window.confirm(`Move ${job.jobNum||'this job'} from ${from} to ${to}?`);
}

async function moveJobToDate(job, newDate){
  if(!job || !newDate || job.date===newDate) return false;
  if(!confirmMoveJobDate(job, newDate)) return false;
  await _sb(`jobs?id=eq.${encodeURIComponent(job.id)}`,{method:'PATCH', body:{date:newDate}, prefer:'return=minimal'});
  toast(`${job.jobNum||'Job'} moved to ${prettyDate(newDate)}`,'success');
  renderPlanner();
  return true;
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

function weekMiniJob(j, invoices){
  return `<article class="week-mini-job clickable-job" draggable="true" data-job-id="${j.id}" data-type="${jobDataType(j)}">
    <div class="week-mini-top">
      <span class="week-mini-no">${escHtml(j.jobNum||'')}</span>
      <span class="week-mini-time">${escHtml(j.timeSlot||'—')}</span>
    </div>
    <div class="week-mini-address">${escHtml(j.address||'')}</div>
    <div class="week-mini-desc">${escHtml(j.description||'')}</div>
    <div style="margin-top:4px">${compactInvoiceMarkup(j, invoices)}</div>
    <div class="week-mini-bottom">
      <span class="status" style="padding:2px 5px;font-size:7px">${escHtml(j.status||'Pending')}</span>
      <b class="week-mini-value">${money(j.price)}</b>
    </div>
  </article>`;
}

async function renderWeekPlanner(){
  const [jobs, invoices] = await Promise.all([dAll('jobs'), dAll('invoices')]);
  const selected = parseLocalDate(dfpDate);
  const weekStart = startOfWeek(selected);
  const weekEnd = endOfWeek(selected);
  const days = Array.from({length:7},(_,i)=>addDays(weekStart,i));
  const dayIsos = days.map(isoDate);
  const weekJobs = jobs.filter(j=>j.date>=dayIsos[0] && j.date<=dayIsos[6] && j.status!=='Cancelled');

  el('dfpDateLabel').textContent = `Week ${weekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${weekEnd.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;

  const engNames = (S.engineers||[]).map(e=>e.name);
  const groups = [...engNames, ''];

  const head = `<div class="week-grid-head">
    <div class="week-corner-head">Engineer</div>
    ${days.map((d,i)=>{
      const ds=dayIsos[i];
      const dayCount=weekJobs.filter(j=>j.date===ds).length;
      const dayValue=weekJobs.filter(j=>j.date===ds).reduce((s,j)=>s+Number(j.price||0),0);
      return `<div class="week-day-head">
        <b>${d.toLocaleDateString('en-GB',{weekday:'short'})} ${d.getDate()} ${d.toLocaleDateString('en-GB',{month:'short'})}</b>
        <span>${dayCount} job${dayCount===1?'':'s'} · ${money(dayValue)}</span>
      </div>`;
    }).join('')}
  </div>`;

  const rows = groups.map(eng=>{
    const unassigned = !eng;
    const allForEng = weekJobs.filter(j=>(j.engineer||'')===eng);
    const total = allForEng.reduce((s,j)=>s+Number(j.price||0),0);
    return `<div class="week-engineer-grid-row ${unassigned?'unassigned-row':''}">
      <div class="week-engineer-label">
        <div class="eng-avatar ${unassigned?'unassigned-avatar':''}">${escHtml((eng||'?').slice(0,2).toUpperCase())}</div>
        <div class="engineer-meta">
          <strong>${escHtml(eng||'Unassigned')}</strong>
          <small>${unassigned?'Waiting to be allocated':'Engineer'}</small>
          <div class="eng-stats"><span class="eng-count-text">${allForEng.length} job${allForEng.length===1?'':'s'}</span><span class="eng-value-pill">${money(total)}</span></div>
        </div>
      </div>
      ${dayIsos.map(ds=>{
        const list=allForEng.filter(j=>j.date===ds).sort((a,b)=>(a.timeSlot||'').localeCompare(b.timeSlot||''));
        const cellTotal=list.reduce((s,j)=>s+Number(j.price||0),0);
        return `<div class="week-day-cell" data-engineer="${escHtml(eng)}" data-date="${ds}">
          <div class="week-cell-top">
            <span class="week-cell-count">${list.length} job${list.length===1?'':'s'}</span>
            <span class="week-cell-total">${list.length?money(cellTotal):''}</span>
          </div>
          <div class="week-cell-jobs">
            ${list.length ? list.map(j=>weekMiniJob(j,invoices)).join('') : `<div class="week-cell-empty">Drop job here</div>`}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');

  el('dfpGrid').innerHTML = `<div class="week-board">${head}${rows}</div>`;
  renderMiniCalendar(weekStart, weekEnd, jobs);
  wireWeekDragDrop();
}

function renderMiniCalendar(weekStart, weekEnd, jobs){
  const selected = parseLocalDate(dfpDate);
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  const gridStart = startOfWeek(monthStart);
  el('dfpMiniCalTitle').textContent = selected.toLocaleDateString('en-GB',{month:'long',year:'numeric'});

  const dows = ['M','T','W','T','F','S','S'].map(d=>`<div class="mini-cal-dow">${d}</div>`).join('');
  let days='';
  for(let i=0;i<42;i++){
    const d=addDays(gridStart,i);
    const ds=isoDate(d);
    const count=jobs.filter(j=>j.date===ds && j.status!=='Cancelled').length;
    const other=d.getMonth()!==selected.getMonth();
    const inWeek=d>=weekStart && d<=weekEnd;
    const isSelected=ds===dfpDate;
    days+=`<div class="mini-cal-day ${other?'other':''} ${inWeek?'in-week':''} ${isSelected?'selected':''}" data-date="${ds}">
      ${d.getDate()}
      ${count?`<span class="mini-cal-count">${count}</span>`:''}
    </div>`;
  }
  el('dfpMiniCal').innerHTML = `<div class="mini-cal-grid">${dows}${days}</div>`;
}

async function renderMonthPlanner(){
  const jobs = await dAll('jobs');
  const selected = parseLocalDate(dfpDate);
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  const gridStart = startOfWeek(monthStart);
  el('dfpDateLabel').textContent = selected.toLocaleDateString('en-GB',{month:'long',year:'numeric'});

  const dows = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    .map(d=>`<div class="month-dow">${d}</div>`).join('');

  let days='';
  for(let i=0;i<42;i++){
    const d=addDays(gridStart,i);
    const ds=isoDate(d);
    const list=jobs.filter(j=>j.date===ds && j.status!=='Cancelled').sort((a,b)=>(a.timeSlot||'').localeCompare(b.timeSlot||''));
    const other=d.getMonth()!==selected.getMonth();
    const shown=list.slice(0,4);
    days+=`<div class="month-day ${other?'other':''} ${ds===dfpDate?'selected':''}" data-date="${ds}">
      <div class="month-date-num"><span>${d.getDate()}</span><span class="month-date-count">${list.length?`${list.length} job${list.length===1?'':'s'}`:''}</span></div>
      ${shown.map(j=>`<div class="month-job-chip clickable-job" draggable="true" data-job-id="${j.id}" data-type="${jobDataType(j)}">
        <b>${escHtml(j.jobNum||'')} · ${escHtml(j.timeSlot||'')}</b>
        ${escHtml(j.address||'')}
      </div>`).join('')}
      ${list.length>4?`<div class="month-more">+ ${list.length-4} more</div>`:''}
    </div>`;
  }

  el('dfpGrid').innerHTML = `<div class="month-wrap"><div class="month-dow-row">${dows}</div><div class="month-grid">${days}</div></div>`;
  wireMonthDragDrop();
}

function wireWeekDragDrop(){
  document.querySelectorAll('#dfpGrid .week-mini-job').forEach(item=>{
    item.addEventListener('dragstart', e=>{
      activeDragId=item.dataset.jobId;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', activeDragId);
    });
    item.addEventListener('dragend', ()=>{ item.classList.remove('dragging'); activeDragId=null; });
  });
  document.querySelectorAll('#dfpGrid .week-day-cell').forEach(cell=>{
    cell.addEventListener('dragover', e=>{ e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', ()=>cell.classList.remove('drag-over'));
    cell.addEventListener('drop', async e=>{
      e.preventDefault();
      cell.classList.remove('drag-over');
      const jobId = e.dataTransfer.getData('text/plain') || activeDragId;
      if(!jobId) return;
      const jobs = await dAll('jobs');
      const j = jobs.find(x=>x.id===jobId);
      if(!j) return;
      const newEngineer = cell.dataset.engineer||'';
      const newDate = cell.dataset.date;
      const sameSpot = (j.engineer||'')===newEngineer && j.date===newDate;
      if(sameSpot) return;
      if(j.date!==newDate && !confirmMoveJobDate(j,newDate)) return;
      await _sb(`jobs?id=eq.${encodeURIComponent(jobId)}`,{method:'PATCH', body:{date:newDate, engineer:newEngineer}, prefer:'return=minimal'});
      toast(`${j.jobNum||'Job'} moved to ${prettyDate(newDate)} · ${newEngineer||'Unassigned'}`,'success');
      renderPlanner();
    });
  });
  el('dfpMiniCal').querySelectorAll('.mini-cal-day').forEach(day=>{
    day.addEventListener('dragover', e=>{ e.preventDefault(); day.classList.add('drag-over'); });
    day.addEventListener('dragleave', ()=>day.classList.remove('drag-over'));
    day.addEventListener('drop', async e=>{
      e.preventDefault();
      day.classList.remove('drag-over');
      const jobId = e.dataTransfer.getData('text/plain') || activeDragId;
      if(!jobId) return;
      const jobs = await dAll('jobs');
      const j = jobs.find(x=>x.id===jobId);
      if(j) await moveJobToDate(j, day.dataset.date);
    });
  });
}

function wireMonthDragDrop(){
  document.querySelectorAll('#dfpGrid .month-job-chip').forEach(chip=>{
    chip.addEventListener('dragstart', e=>{
      activeDragId=chip.dataset.jobId;
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', activeDragId);
    });
    chip.addEventListener('dragend', ()=>{ chip.classList.remove('dragging'); activeDragId=null; });
  });
  document.querySelectorAll('#dfpGrid .month-day').forEach(day=>{
    day.addEventListener('dragover', e=>{ e.preventDefault(); day.classList.add('drag-over'); });
    day.addEventListener('dragleave', ()=>day.classList.remove('drag-over'));
    day.addEventListener('drop', async e=>{
      e.preventDefault();
      day.classList.remove('drag-over');
      const jobId = e.dataTransfer.getData('text/plain') || activeDragId;
      if(!jobId) return;
      const jobs = await dAll('jobs');
      const j = jobs.find(x=>x.id===jobId);
      if(j) await moveJobToDate(j, day.dataset.date);
    });
  });
}

document.addEventListener('click', e=>{
  const miniCalDay = e.target.closest('#dfpMiniCal .mini-cal-day');
  if(miniCalDay){ dfpDate=miniCalDay.dataset.date; el('dfpDate').value=dfpDate; renderPlanner(); return; }
  const monthDay = e.target.closest('#dfpGrid .month-day');
  if(monthDay && !e.target.closest('.month-job-chip')){ dfpDate=monthDay.dataset.date; el('dfpDate').value=dfpDate; renderPlanner(); return; }
});

document.addEventListener('click', e=>{
  const opener = e.target.closest('#dfpGrid [data-open]');
  if(opener){ const u=opener.dataset.open; if(u&&u!=='#') window.open(u,'_blank'); return; }
  const edit = e.target.closest('#dfpGrid .dfp-edit-job');
  if(edit){ window.openJobModal(edit.dataset.id); return; }
});

// ════════════════════════════════════════════════════════════════
//  JOB DETAIL MODAL — Overview / Activity-Visits / Invoices / Client
// ════════════════════════════════════════════════════════════════

let detailJobId = null;

function invoiceStatusLabel(inv){
  if(inv.status==='Paid') return 'Paid';
  if(inv.status==='Awaiting Payment') return 'Unpaid';
  return inv.status||'Draft';
}
function invoiceStatusClass(inv){
  if(inv.status==='Paid') return 'paid';
  if(inv.status==='Awaiting Payment') return 'unpaid';
  return 'partial';
}

export async function openJobDetails(jobId, tab='overview'){
  const jobs = await dAll('jobs');
  const job = jobs.find(x=>x.id===jobId);
  if(!job){ toast('Job not found — try refreshing','error'); return; }
  detailJobId = jobId;

  const [visits, allInvoices, allAttachments] = await Promise.all([
    _sb(`job_visits?jobid=eq.${encodeURIComponent(jobId)}&order=visit_date.asc,created.asc`),
    dAll('invoices'),
    _sb(`attachments?visit_id=not.is.null`),
  ]);
  const invoices = allInvoices.filter(i=>i.jobId===jobId||i.linkedJobId===jobId);
  const contact = resolveContact(job);

  el('dfpDetailTitle').textContent = job.jobNum||'Job';
  el('dfpDetailSubtitle').textContent = job.address||'';
  el('dfpDetailSummary').innerHTML = `
    <span class="summary-chip"><b>${visits.length}</b> visit${visits.length===1?'':'s'}</span>
    <span class="summary-chip"><b>${invoices.length}</b> invoice${invoices.length===1?'':'s'}</span>
    <span class="summary-chip"><b>${money(job.price)}</b> job value</span>
  `;
  el('dfpDetailAddVisit').onclick = ()=>{ closeJobDetails(); window.openJobModal(jobId); };

  // Overview
  el('dfpDetailOverview').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card">
        <div class="detail-card-label">Job number</div>
        <div class="detail-card-value">${escHtml(job.jobNum||'')}</div>
        <div class="detail-card-sub">${escHtml(job.status||'Pending')}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Visits logged</div>
        <div class="detail-card-value">${visits.length}</div>
        <div class="detail-card-sub">${visits.map((v,i)=>`Visit ${i+1} · ${formatDateUK(v.visit_date)||v.visit_date}`).join('<br>')||'None yet'}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Job date</div>
        <div class="detail-card-value">${formatDateUK(job.date)||job.date||'—'}</div>
        <div class="detail-card-sub">${escHtml(job.timeSlot||'—')}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Engineer</div>
        <div class="detail-card-value">${escHtml(job.engineer||'Unassigned')}</div>
        <div class="detail-card-sub">${invoices.length} invoice${invoices.length===1?'':'s'} issued</div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Property</div>
        <div class="detail-card-value">${escHtml(job.address||'')}</div>
        <div class="detail-card-sub">Access: ${escHtml(job.access||'—')}</div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Client</div>
        <div class="detail-card-value">${escHtml(contact.name||'—')}</div>
        <div class="detail-card-sub">${escHtml(contact.phone||'—')} · ${escHtml(contact.email||'—')}</div>
      </div>
      <div class="detail-card span4">
        <div class="detail-card-label">Description</div>
        <div class="detail-card-value">${escHtml(job.description||'—')}</div>
      </div>
    </div>`;

  // Activity / Visits — real comments (job_visits.comments) and real
  // photos (attachments.visit_id) rather than the fabricated feed a demo
  // would show; both render an honest empty state until populated.
  el('dfpDetailActivity').innerHTML = visits.length ? `
    <div class="activity-timeline">
      ${visits.map((v,i)=>{
        const comments = Array.isArray(v.comments) ? v.comments : [];
        const photos = allAttachments.filter(a=>a.visit_id===v.id);
        return `<article class="visit-detail-card">
          <div class="visit-detail-head">
            <div class="visit-number-block"><small>Visit</small><b>${i+1}</b></div>
            <div class="visit-head-main">
              <h3>${escHtml((v.engineers||[]).join(', ')||'No engineer assigned')}</h3>
              <p>${escHtml(v.notes||'No notes for this visit')}</p>
            </div>
            <div class="visit-head-meta">
              <b>${formatDateUK(v.visit_date)||v.visit_date}</b>
            </div>
          </div>
          <div class="visit-detail-body">
            <div class="visit-section-title">Comments <span class="count">${comments.length}</span></div>
            <div class="visit-comments">
              ${comments.length ? comments.map(c=>`
                <div class="visit-comment">
                  <div class="visit-eng-avatar">${escHtml((c.by||'?').slice(0,2).toUpperCase())}</div>
                  <div class="comment-who"><b>${escHtml(c.by||'Office')}</b><span>${escHtml(c.time||'')}</span></div>
                  <div class="comment-text">${escHtml(c.text||'')}</div>
                </div>`).join('') : `<div class="detail-empty" style="padding:12px">No comments on this visit yet.</div>`}
            </div>
            <div style="display:flex;gap:6px;margin-bottom:12px">
              <input type="text" class="dfp-comment-input" data-visit-id="${v.id}" placeholder="Add a comment about this visit…" style="flex:1;border:1px solid #dfe2e6;border-radius:7px;padding:7px 9px;font-size:11px">
              <button type="button" class="btn dfp-add-comment" data-visit-id="${v.id}">Add</button>
            </div>
            <div class="visit-section-title">Photos <span class="count">${photos.length}</span></div>
            <div class="visit-photos">
              ${photos.length ? photos.map(p=>`
                <div class="visit-photo" title="${escHtml(p.name||'')}">
                  <div class="visit-photo-preview">▧</div>
                  <div class="visit-photo-info"><b>${escHtml(p.name||'Photo')}</b><span>${escHtml(p.uploaded_by_name||'')}</span></div>
                </div>`).join('') : `<div class="detail-empty" style="grid-column:1/-1;padding:12px">No photos tagged to this visit yet — engineer-app photo tagging is next on the list.</div>`}
            </div>
          </div>
        </article>`;
      }).join('')}
    </div>` : `<div class="detail-empty">No visits logged for this job yet.</div>`;

  // Invoices — real invoices, real totals (no flattened job fields)
  el('dfpDetailInvoices').innerHTML = invoices.length ? `<table class="project-invoice-table">
    <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th>Outstanding</th></tr></thead>
    <tbody>
      ${invoices.map(inv=>{
        const t=calcInvTotal(inv);
        const outstanding = inv.status==='Paid' ? 0 : t.grand;
        return `<tr>
          <td><b>${escHtml(inv.number||'')}</b></td>
          <td>${formatDateUK(inv.date)||inv.date||'—'}</td>
          <td><b>${money(t.grand)}</b></td>
          <td><span class="invoice-status ${invoiceStatusClass(inv)}">${escHtml(invoiceStatusLabel(inv))}</span></td>
          <td>${money(outstanding)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>` : `<div class="detail-empty">No invoices have been issued for ${escHtml(job.jobNum||'this job')} yet.</div>`;

  // Client
  const phoneDigits=(contact.phone||'').replace(/[^\d+]/g,'');
  const callLink = phoneDigits ? `tel:${phoneDigits}` : '#';
  const waLink = phoneDigits ? `https://wa.me/${phoneDigits.replace('+','')}?text=${encodeURIComponent(`Hello, regarding job ${job.jobNum||''} at ${job.address||''}.`)}` : '#';
  el('dfpDetailClient').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card span2">
        <div class="detail-card-label">Client / Account</div>
        <div class="client-big-line">${escHtml(contact.name||'—')}</div>
        <div class="client-contact-line">☎ ${escHtml(contact.phone||'—')}</div>
        <div class="client-contact-line">✉ ${escHtml(contact.email||'—')}</div>
        <div class="client-detail-actions">
          ${contact.phone?`<button class="btn" data-open="${callLink}">Call</button><button class="btn" data-open="${waLink}">WhatsApp</button>`:''}
        </div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Property</div>
        <div class="detail-card-value">${escHtml(job.address||'')}</div>
        <div class="detail-card-sub">Access instructions: ${escHtml(job.access||'—')}</div>
      </div>
    </div>`;

  switchDetailTab(tab);
  el('dfpDetailBackdrop').classList.add('show');
}

function closeJobDetails(){
  el('dfpDetailBackdrop').classList.remove('show');
  detailJobId = null;
}

function switchDetailTab(tab){
  document.querySelectorAll('#dfpDetailTabs .detail-tab').forEach(b=>b.classList.toggle('active', b.dataset.dfpTab===tab));
  document.querySelectorAll('.job-detail-body .detail-panel').forEach(p=>p.classList.toggle('active', p.dataset.dfpPanel===tab));
}

async function addVisitComment(visitId, text){
  const trimmed=(text||'').trim();
  if(!trimmed) return;
  const rows = await _sb(`job_visits?id=eq.${encodeURIComponent(visitId)}&limit=1`);
  const visit = rows && rows[0];
  if(!visit) return;
  const comments = Array.isArray(visit.comments) ? visit.comments : [];
  comments.push({by: getAppUser()?.name||'Office', time: new Date().toLocaleString('en-GB',{hour:'2-digit',minute:'2-digit'}), text: trimmed});
  await _sb(`job_visits?id=eq.${encodeURIComponent(visitId)}`,{method:'PATCH', body:{comments}, prefer:'return=minimal'});
  toast('Comment added','success');
  if(detailJobId) openJobDetails(detailJobId, 'activity');
}

document.addEventListener('click', e=>{
  const opener = e.target.closest('.job-detail-body [data-open]');
  if(opener){ const u=opener.dataset.open; if(u&&u!=='#') window.open(u,'_blank'); return; }
  const addBtn = e.target.closest('.dfp-add-comment');
  if(addBtn){
    const input = document.querySelector(`.dfp-comment-input[data-visit-id="${addBtn.dataset.visitId}"]`);
    if(input){ addVisitComment(addBtn.dataset.visitId, input.value); input.value=''; }
    return;
  }
  if(e.target.closest('button,select,input,a')) return;
  const clickable = e.target.closest('#dfpGrid .clickable-job[data-job-id]');
  if(clickable) openJobDetails(clickable.dataset.jobId);
});
document.addEventListener('keydown', e=>{
  const input = e.target.closest('.dfp-comment-input');
  if(input && e.key==='Enter'){
    e.preventDefault();
    addVisitComment(input.dataset.visitId, input.value);
    input.value='';
  }
});

export function initPlanner(){
  el('dfpDate').value = dfpDate;
  el('dfpDetailClose').addEventListener('click', closeJobDetails);
  el('dfpDetailBackdrop').addEventListener('click', e=>{ if(e.target===el('dfpDetailBackdrop')) closeJobDetails(); });
  el('dfpDetailTabs').addEventListener('click', e=>{
    const b=e.target.closest('[data-dfp-tab]'); if(!b) return;
    switchDetailTab(b.dataset.dfpTab);
  });
  el('dfpModeToggle').addEventListener('click', e=>{
    const b=e.target.closest('[data-dfp-mode]'); if(!b) return;
    dfpMode = b.dataset.dfpMode;
    renderPlanner();
  });
  el('dfpToday').addEventListener('click', ()=>{ dfpDate=TODAY(); el('dfpDate').value=dfpDate; renderPlanner(); });
  el('dfpDate').addEventListener('change', ()=>{ dfpDate=el('dfpDate').value||TODAY(); renderPlanner(); });
  el('dfpPrev').addEventListener('click', ()=>shiftPlanner(-1));
  el('dfpNext').addEventListener('click', ()=>shiftPlanner(1));
}

function shiftPlanner(direction){
  const d=parseLocalDate(dfpDate);
  if(dfpMode==='day') d.setDate(d.getDate()+direction);
  if(dfpMode==='week') d.setDate(d.getDate()+(7*direction));
  if(dfpMode==='month') d.setMonth(d.getMonth()+direction);
  dfpDate=isoDate(d);
  el('dfpDate').value=dfpDate;
  renderPlanner();
}
