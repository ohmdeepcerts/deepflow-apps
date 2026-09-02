// Engineer Reports — shared stats computation. _computeEngStats is the one
// place that turns a raw job/invoice/cert list into the per-engineer numbers
// every other engineer-reports-*.js file renders (ranking table, deep report
// modal, all five deep-report tabs, payslip, PDF export). Extracted from
// engineer-reports.js verbatim (Phase 3 of the follow-up modularization pass
// — same split rationale as Phase 2's directory.js/certs.js) — no behaviour
// changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { STATUS } from '@business';
import { S, TODAY, calcInvTotal } from './main.js';

export function _weekStart(dateStr){
  const d=new Date(dateStr); const day=d.getDay();
  d.setDate(d.getDate()-(day===0?6:day-1));
  return d.toISOString().slice(0,10);
}

export function _computeEngStats(engName, allJobs, allInvs, allCerts){
  const today=TODAY();
  const engJobs=allJobs.filter(j=>j.engineer===engName);
  const weekStart=_weekStart(today);
  const monthStart=today.slice(0,7)+'-01';

  const todayJobs=engJobs.filter(j=>j.date===today);
  const weekJobs=engJobs.filter(j=>j.date>=weekStart);
  const monthJobs=engJobs.filter(j=>j.date>=monthStart);
  const completed=engJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED);
  const pending=engJobs.filter(j=>j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS);

  const earnedTotal=completed.reduce((s,j)=>s+Number(j.price||0),0);
  const earnedMonth=monthJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).reduce((s,j)=>s+Number(j.price||0),0);
  const earnedWeek=weekJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).reduce((s,j)=>s+Number(j.price||0),0);
  const earnedToday=todayJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).reduce((s,j)=>s+Number(j.price||0),0);

  const invoicedTotal=engJobs.reduce((s,j)=>{
    const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
    return s+(inv?calcInvTotal(inv).grand:0);
  },0);

  const compRate=engJobs.length?Math.round(completed.length/engJobs.length*100):0;

  // Certs linked to engineer's jobs (by address match)
  const engJobAddrs=new Set(engJobs.map(j=>j.address).filter(Boolean));
  const engCerts=(allCerts||[]).filter(c=>engJobAddrs.has(c.address));

  // Get engineer record for contact details
  const engRec=(S.engineers||[]).find(e=>e.name===engName)||{};

  return{
    totalJobs:engJobs.length, todayJobs:todayJobs.length, weekJobs:weekJobs.length,
    monthJobs:monthJobs.length, completed:completed.length, pending:pending.length,
    earnedTotal, earnedMonth, earnedWeek, earnedToday, invoicedTotal, compRate,
    jobs:engJobs, certs:engCerts, engRec
  };
}
