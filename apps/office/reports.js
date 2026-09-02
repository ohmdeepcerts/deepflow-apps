// Reports page — the Job Overview / Financial Summary / Trade / Engineer /
// Status / Top Addresses report grid, and its PDF export. Extracted from
// main.js verbatim (Phase 1 of the follow-up modularization pass — see the
// plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time. renderAgeingReport
// deliberately stays in main.js (it's genuinely Invoices-adjacent) — this
// file just imports it rather than moving it.

import { fromDb as _fromDb } from '@data';
import { STATUS, localDateStr } from '@business';
import { S, dAll, _sb, toast, sBadge, calcInvTotal, renderAgeingReport } from './main.js';

async function renderReports(){
  const days=parseInt(document.getElementById('rep-period')?.value||30);
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
  const cutoffStr=localDateStr(cutoff);
  // ISSUE 3 FIX: fetch only jobs within the report period — not all jobs ever
  const all=await _sb(`jobs?date=gte.${cutoffStr}&select=*`).then(r=>(r||[]).map(j=>_fromDb('jobs',j))).catch(()=>[]);
  const invs=await dAll('invoices');
  const period=all; // already filtered server-side
  const paidInvs=invs.filter(i=>i.status==='Paid'&&new Date(i.created)>=cutoff);
  const awaitInvs=invs.filter(i=>i.status==='Awaiting Payment');

  const totalJobs=period.length;
  // A job that's been auto-invoiced flips from Completed to Invoiced (see
  // onJobComplete/autoInvoice) within seconds of completion — counting only
  // strict Completed here meant this KPI permanently undercounted real
  // finished work for any job that had already been billed, understating
  // Completion Rate for an actively-invoicing business. Matches the same
  // "Completed or Invoiced both mean the work is done" treatment already
  // used elsewhere (see the missing-invoice check a few hundred lines up).
  const completedJobs=period.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).length;
  const revenue=paidInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const outstanding=awaitInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);

  // By trade
  const byTrade={};period.forEach(j=>{if(j.trade){if(!byTrade[j.trade])byTrade[j.trade]=0;byTrade[j.trade]++}});
  // By engineer
  const byEng={};period.forEach(j=>{if(j.engineer){if(!byEng[j.engineer])byEng[j.engineer]={jobs:0};byEng[j.engineer].jobs++}});
  // By status
  const bySt={};period.forEach(j=>{if(!bySt[j.status])bySt[j.status]=0;bySt[j.status]++});

  const grid=document.getElementById('rep-grid');
  grid.innerHTML=`
    <div class="rep-card">
      <div class="rep-title">📊 Job Overview — Last ${days} Days</div>
      <div class="rep-stat"><span>Total Jobs</span><span class="rep-stat-val" style="color:var(--acc)">${totalJobs}</span></div>
      <div class="rep-stat"><span>Completed</span><span class="rep-stat-val" style="color:var(--green)">${completedJobs}</span></div>
      <div class="rep-stat"><span>Completion Rate</span><span class="rep-stat-val">${totalJobs?Math.round(completedJobs/totalJobs*100):0}%</span></div>
    </div>
    <div class="rep-card">
      <div class="rep-title">💰 Financial Summary</div>
      <div class="rep-stat"><span>Revenue (Paid)</span><span class="rep-stat-val" style="color:var(--green)">£${revenue.toFixed(2)}</span></div>
      <div class="rep-stat"><span>Outstanding</span><span class="rep-stat-val" style="color:var(--yellow)">£${outstanding.toFixed(2)}</span></div>
      <div class="rep-stat"><span>Paid Invoices</span><span class="rep-stat-val">${paidInvs.length}</span></div>
      <div class="rep-stat"><span>Avg Invoice Value</span><span class="rep-stat-val">£${paidInvs.length?(revenue/paidInvs.length).toFixed(2):'0'}</span></div>
    </div>
    <div class="rep-card">
      <div class="rep-title">🔧 Jobs by Trade</div>
      ${Object.entries(byTrade).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`<div class="rep-stat"><span>${t}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">👷 Engineer Performance</div>
      ${Object.entries(byEng).sort((a,b)=>b[1].jobs-a[1].jobs).map(([e,v])=>`<div class="rep-stat"><span>${e}</span><span class="rep-stat-val">${v.jobs} jobs</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">📋 Jobs by Status</div>
      ${Object.entries(bySt).map(([s,n])=>`<div class="rep-stat"><span>${sBadge(s)}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">📅 Top Addresses</div>
      ${getTopAddresses(period,5).map(([a,n])=>`<div class="rep-stat"><span style="font-size:11px">${a}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>`;

  renderAgeingReport();
}

function getTopAddresses(jobs,n){
  const map={};jobs.forEach(j=>{if(j.address){if(!map[j.address])map[j.address]=0;map[j.address]++}});
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

async function exportReportPDF(){
  toast('Generating report PDF…','info');
  const days=parseInt(document.getElementById('rep-period')?.value||30);
  if(!window.jspdf){toast('PDF library not loaded — please check your internet connection and try again','error');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  doc.setFont('helvetica','bold');doc.setFontSize(18);
  doc.text(`${S.coName||'DeepFlow'} — Report`,20,20);
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} · Period: Last ${days} days`,20,30);
  doc.text('See app for full interactive analytics.',20,40);
  doc.save('DeepFlow-Report.pdf');
  toast('Report PDF exported','success');
}

export { renderReports, getTopAddresses, exportReportPDF };
