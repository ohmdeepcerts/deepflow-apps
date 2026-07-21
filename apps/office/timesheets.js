// Timesheets — the weekly per-engineer timesheet view (jobs + overtime
// combined into hours/pay) and its WhatsApp summary export. Extracted
// from main.js verbatim (Phase 5 of the architecture migration, module 9
// — see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { fromDb as _fromDb } from '@data';
import { escHtml } from '@ui';
import { S, dAll, openModal, _sb, fmtDshort, sBadge } from './main.js';

let selEng=null,tsOff=0;

export function getTsOff(){ return tsOff; }

// ════════════════════════════════════════════════════════════════
//  TIMESHEETS
// ════════════════════════════════════════════════════════════════

export function getWeekDates(off){
  const now=new Date(),day=now.getDay(),mon=new Date(now);
  mon.setDate(now.getDate()-(day===0?6:day-1)+off*7);
  return Array.from({length:7},(_,i)=>{const d=new Date(mon);d.setDate(mon.getDate()+i);return d.toISOString().slice(0,10)});
}

export async function renderTS(){
  const el=document.getElementById('ts-eng-list');
  el.innerHTML=(S.engineers||[]).map(e=>`
    <div class="ts-eng-card ${selEng===e.name?'active':''}" onclick="selEngineer('${e.name}')">
      <div class="ts-eng-name">${e.name}</div>
      <div class="ts-eng-stat">£${e.rate||0}/hr${e.wa?` · 📱 ${e.wa}`:''}</div>
    </div>`).join('')||'<div class="empty"><div class="ei">👷</div><p>Add engineers in Settings</p></div>';

  // Week summary for all engineers
  const dates=getWeekDates(tsOff);
  const allJobs=await dAll('jobs');
  const weekJobs=allJobs.filter(j=>dates.includes(j.date));
  const totalHrs=weekJobs.reduce((s,j)=>s+(j.hours||0),0);
  const engSummary=(S.engineers||[]).map(e=>{
    const ejobs=weekJobs.filter(j=>j.engineer===e.name);
    const hrs=ejobs.reduce((s,j)=>s+(j.hours||0),0);
    return hrs>0?`<div class="rep-stat"><span>${e.name}</span><span class="rep-stat-val">${hrs}h · £${(hrs*(e.rate||0)).toFixed(0)}</span></div>`:'';
  }).join('');
  document.getElementById('ts-week-summary').innerHTML=engSummary||'<div style="color:var(--txt3);font-size:12px">No hours this week</div>';
}

export async function selEngineer(name){
  selEng=name;tsOff=0;
  renderTS();renderTSDetail();
}

export async function renderTSDetail(){
  const panel=document.getElementById('ts-detail-panel');
  if(!selEng){panel.innerHTML='<div class="empty"><div class="ei">◷</div><p>Select an engineer</p></div>';return}
  const dates=getWeekDates(tsOff);
  const dateFrom=dates[0]; const dateTo=dates[dates.length-1];
  // ISSUE 3 FIX: fetch only this engineer's jobs in this week — not all jobs
  const allJobs=await _sb(`jobs?engineer=eq.${encodeURIComponent(selEng)}&date=gte.${dateFrom}&date=lte.${dateTo}&select=*`).then(r=>(r||[]).map(j=>_fromDb('jobs',j))).catch(()=>[]);
  const allOTentries=await dAll('overtime');
  const ejobs=allJobs.filter(j=>j.engineer===selEng&&dates.includes(j.date));
  const eotEntries=allOTentries.filter(o=>o.engineer===selEng&&dates.includes(o.date));
  const eng=(S.engineers||[]).find(e=>e.name===selEng)||{};
  const totalHrs=ejobs.reduce((s,j)=>s+(j.hours||0),0);
  const totalOT=eotEntries.filter(o=>o.hours>0).reduce((s,o)=>s+o.hours,0);
  const totalPay=totalHrs*(eng.rate||0)+totalOT*(eng.otRate||eng.rate||0);
  const wkLbl=`${fmtDshort(dates[0])} – ${fmtDshort(dates[6])}`;

  panel.innerHTML=`<div class="ts-detail">
    <div class="ts-det-hd">
      <button class="btn btn-ghost btn-sm" onclick="tsOff--;renderTSDetail()">‹ Prev</button>
      <div class="ts-det-title">${selEng} — ${wkLbl}</div>
      <button class="btn btn-ghost btn-sm" onclick="tsOff++;renderTSDetail()">Next ›</button>
      <button class="btn btn-acc btn-sm" onclick="openOvertimeModal('${selEng}')">⏱ Log OT/Absence</button>
      <button class="btn btn-wa btn-sm" onclick="waTimesheetSummary()">📱 Send Summary</button>
    </div>
    <table class="ts-table">
      <thead><tr><th>Date</th><th>Address</th><th>Description</th><th>Trade</th><th>Hours</th><th>Status</th><th>Pay</th></tr></thead>
      <tbody>
        ${dates.map(date=>{
          const dj=ejobs.filter(j=>j.date===date);
          const ot=eotEntries.filter(o=>o.date===date);
          let rows='';
          if(!dj.length&&!ot.length)return`<tr><td style="color:var(--txt3);font-size:11px">${fmtDshort(date)}</td><td colspan="6" style="color:var(--txt3)">—</td></tr>`;
          dj.forEach(j=>{rows+=`<tr>
            <td style="font-size:11px">${fmtDshort(j.date)}</td>
            <td style="font-family:var(--fh);font-weight:600">${escHtml(j.address)}</td>
            <td>${escHtml(j.description)||'—'}</td>
            <td>${escHtml(j.trade)||'—'}</td>
            <td>${j.hours||0}h</td>
            <td>${sBadge(j.status)}</td>
            <td style="color:var(--green);font-family:var(--fh);font-weight:600">£${((j.hours||0)*(eng.rate||0)).toFixed(2)}</td>
          </tr>`});
          ot.forEach(o=>{
            const otPay=o.hours>0?o.hours*(eng.otRate||eng.rate||0):0;
            rows+=`<tr style="background:rgba(245,166,35,.04)">
              <td style="font-size:11px">${fmtDshort(o.date)}</td>
              <td colspan="3" style="color:var(--acc)"><span class="ot-type ${o.type.includes('absent')||o.type==='halfday'?'ot-absent ot-halfday':'ot-overtime'}">${o.label}</span> ${o.notes?'· '+o.notes:''}</td>
              <td>${o.hours>0?o.hours+'h':'—'}</td>
              <td><span class="badge" style="background:rgba(245,166,35,.1);color:var(--acc)">OT/Absence</span></td>
              <td style="color:${otPay>0?'var(--acc)':'var(--red)'};font-family:var(--fh);font-weight:600">${otPay>0?'£'+otPay.toFixed(2):'Absent'}</td>
            </tr>`;
          });
          return rows;
        }).join('')}
      </tbody>
    </table>
    <div class="ts-footer">
      <div style="font-size:12px;color:var(--txt2)">Regular Hours: <strong>${totalHrs}h</strong> · OT: <strong style="color:var(--acc)">${totalOT}h</strong></div>
      <div style="font-family:var(--fh);font-size:20px;font-weight:700;color:var(--green)">£${totalPay.toFixed(2)}</div>
    </div>
  </div>`;
}

export function waTimesheetSummary(){
  if(!selEng)return;
  const dates=getWeekDates(tsOff);
  dAll('jobs').then(allJobs=>{
    const ejobs=allJobs.filter(j=>j.engineer===selEng&&dates.includes(j.date));
    const eng=(S.engineers||[]).find(e=>e.name===selEng)||{};
    const totalHrs=ejobs.reduce((s,j)=>s+(j.hours||0),0);
    const totalPay=totalHrs*(eng.rate||0);
    const lines=ejobs.map(j=>`📍 ${j.address} — ${j.hours||0}h (£${((j.hours||0)*(eng.rate||0)).toFixed(2)})`).join('\n');
    const msg=`*Weekly Timesheet — ${selEng}*\nWeek: ${fmtDshort(dates[0])} to ${fmtDshort(dates[6])}\n\n${lines||'No jobs this week'}\n\n*Total Hours: ${totalHrs}h*\n*Total Pay: £${totalPay.toFixed(2)}*\n\n— ${S.coName||''}`;
    const engObj=(S.engineers||[]).find(e=>e.name===selEng);
    document.getElementById('wa-preview-text').textContent=msg;
    document.getElementById('wa-send-to').value=engObj?.wa||'';
    window._waPendingMsg=msg;
    openModal('mo-wa');
  });
}
