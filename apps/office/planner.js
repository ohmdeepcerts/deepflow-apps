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

export function initPlanner(){
  el('dfpDate').value = dfpDate;
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
