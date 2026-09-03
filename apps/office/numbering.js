// Shared sequence-numbering: job numbers (JOB-####, CR###), invoice numbers
// (INV-####/AGN-####), and proforma numbers (PF-###). Each touches exactly
// one table and none call each other, but they share the same
// atomic-RPC-with-scan-fallback shape, so they live together. Extracted
// from main.js verbatim (Phase 5d of the follow-up modularization pass —
// see the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { _sb, S, saveSetting, dAll } from './main.js';

// Mutex to prevent concurrent nextJobNum calls producing duplicate numbers
let _jobNumLock=false;

export async function nextJobNum(prefix){
  // Spin-wait if another call is in progress (simple mutex for async)
  const deadline = Date.now() + 5000;
  while(_jobNumLock && Date.now() < deadline){
    await new Promise(r=>setTimeout(r,80));
  }
  _jobNumLock = true;
  try{
    // CR-prefix mode (3-digit pad) — atomic DB sequence, falls back to the
    // old scan-based method if the RPC isn't available yet (SQL not run).
    if(prefix==='CR'){
      try{
        const n=await _sb('rpc/next_cr_num',{method:'POST',body:{}});
        if(typeof n==='number') return 'CR'+String(n).padStart(3,'0');
      }catch(e){ console.warn('[nextJobNum] next_cr_num RPC failed, using fallback',e); }
      const rows = await _sb('jobs?select=jobnum&limit=500') || [];
      let maxN=0;
      const re=/^CR(\d+)$/i;
      rows.forEach(r=>{
        const jn=r.jobnum||r.jobNum||'';
        const m=jn.match(re);
        if(m) maxN=Math.max(maxN,parseInt(m[1],10)||0);
      });
      return 'CR'+String(maxN+1).padStart(3,'0');
    }
    // Default: regular job numbering (e.g. JOB-0001, 4-digit pad) — atomic
    // DB sequence, falls back to the old scan-based method if unavailable.
    const jobPrefix=S.jobPrefix||'JOB-';
    try{
      // The sequence can drift behind the real max jobnum (e.g. after a bulk
      // SQL import that inserts jobs directly and never calls this RPC), in
      // which case nextval() hands back an already-used number. Guard against
      // that here rather than trusting the sequence blindly — cheap existence
      // check, capped retries so a genuinely broken sequence can't loop forever.
      for(let attempt=0; attempt<10; attempt++){
        const n=await _sb('rpc/next_job_num',{method:'POST',body:{}});
        if(typeof n!=='number') break;
        const candidate=jobPrefix+String(n).padStart(4,'0');
        const clash=await _sb(`jobs?select=id&jobnum=eq.${encodeURIComponent(candidate)}&limit=1`);
        if(!clash || !clash.length){
          S.jobNextNum=n+1;
          return candidate;
        }
        console.warn('[nextJobNum] sequence produced already-used', candidate, '— retrying');
      }
    }catch(e){ console.warn('[nextJobNum] next_job_num RPC failed, using fallback',e); }
    const rows = await _sb('jobs?select=jobnum&order=jobnum.desc&limit=500') || [];
    let maxN=S.jobNextNum||1001;
    rows.forEach(r=>{
      const jn = r.jobnum||r.jobNum||'';
      if(jn.startsWith(jobPrefix)){
        const parsed=parseInt(jn.replace(jobPrefix,''),10);
        if(!isNaN(parsed)&&parsed>=maxN) maxN=parsed+1;
      }
    });
    const chosen=maxN;
    S.jobNextNum=chosen+1;
    saveSetting('jobNextNum',S.jobNextNum);
    return jobPrefix+String(chosen).padStart(4,'0');
  }finally{
    _jobNumLock = false;
  }
}

export async function nextInvNum(isAgency=false){
  const prefix=isAgency?(S.agencyInvPrefix||'AGN-'):(S.invPrefix||'INV-');
  // Atomic DB sequence — agency and regular invoices now have genuinely
  // separate series. Falls back to the old scan-based method if the RPC
  // isn't available yet (SQL not run).
  try{
    const n=await _sb(isAgency?'rpc/next_agn_num':'rpc/next_inv_num',{method:'POST',body:{}});
    if(typeof n==='number'){
      if(!isAgency) S.invNextNum=n+1;
      return prefix+n;
    }
  }catch(e){ console.warn('[nextInvNum] RPC failed, using fallback',e); }
  // Scan ALL existing invoices to guarantee uniqueness — prevents duplicate numbers
  const allInvs=await dAll('invoices');
  let maxN=isAgency?(S.agencyInvStart||2001):(S.invNextNum||S.invStart||1001);
  allInvs.forEach(inv=>{
    if(inv.number&&inv.number.startsWith(prefix)){
      const parsed=parseInt(inv.number.replace(prefix,''),10);
      if(!isNaN(parsed)&&parsed>=maxN) maxN=parsed+1;
    }
  });
  const chosen=maxN;
  if(!isAgency){
    S.invNextNum=chosen+1;
    saveSetting('invNextNum',S.invNextNum);
  }
  return prefix+chosen;
}

// Get next proforma number
export async function nextProformaNum(){
  // Atomic DB sequence — falls back to the old scan-based method if the
  // RPC isn't available yet (SQL not run).
  try{
    const n=await _sb('rpc/next_proforma_num',{method:'POST',body:{}});
    if(typeof n==='number') return 'PF-'+String(n).padStart(3,'0');
  }catch(e){ console.warn('[nextProformaNum] RPC failed, using fallback',e); }
  try{
    const invs=await _sb('invoices?type=eq.proforma&order=number.desc&limit=1');
    const last=invs?.[0]?.number||'PF-000';
    const n=parseInt(last.replace(/[^0-9]/g,''))||0;
    return 'PF-'+String(n+1).padStart(3,'0');
  }catch(e){return 'PF-001';}
}
