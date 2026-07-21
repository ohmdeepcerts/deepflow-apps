// Master XLSX Export — builds and downloads a multi-sheet Excel workbook
// (jobs/invoices/certs/payments) using the globally-loaded SheetJS (XLSX)
// library. Extracted from main.js verbatim (Phase 5 of the architecture
// migration, module 12 — see ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) —
// no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { S, dAll, toast } from './main.js';

// ════════════════════════════════════════════════════════════════
//  MASTER XLSX EXPORT — triggers download of Python-built workbook
// ════════════════════════════════════════════════════════════════
export async function exportMasterXLSX(){
  toast('Preparing workbook… please wait','info');
  // Gather all data
  const jobs=await dAll('jobs');
  const invoices=await dAll('invoices');
  const persons=await dAll('persons');
  const payments=await dAll('payments');
  const overtime=await dAll('overtime');
  const payload={
    jobs,invoices,persons,payments,overtime,
    settings:{
      coName:S.coName||'',appWord1:S.appWord1||'Deep',appWord2:S.appWord2||'Flow',
      engineers:S.engineers||[],trades:S.trades||[]
    }
  };
  // Encode and download as JSON for Python processing
  // Since we can't run Python in browser, we write a self-contained xlsx via SheetJS
  buildXLSX(payload);
}

export async function buildXLSX(d){
  // Load SheetJS if not present - WITH PROPER RACE CONDITION FIX
  if(typeof XLSX==='undefined'){
    await new Promise((ok,er)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=()=>{
        // Wait for XLSX to actually be defined (race condition fix)
        const checkXLSX = setInterval(()=>{
          if(typeof XLSX !== 'undefined'){
            clearInterval(checkXLSX);
            ok();
          }
        }, 50); // Check every 50ms
        // Timeout after 5 seconds
        setTimeout(()=>{
          clearInterval(checkXLSX);
          if(typeof XLSX === 'undefined') er(new Error('XLSX failed to load'));
          else ok();
        }, 5000);
      };
      s.onerror=er;
      document.head.appendChild(s);
    });
  }
  if(typeof XLSX === 'undefined'){
    toast('❌ Failed to load Excel library','error');
    throw new Error('XLSX library not loaded');
  }
  const wb=XLSX.utils.book_new();
  const coName=d.settings.coName||(d.settings.appWord1+' '+d.settings.appWord2)||'Company';

  // ── SHEET 1: ALL JOBS ──────────────────────────────────────
  const jobRows=[['Date','Job #','Address','Referrer','Landlord','Trade','Engineer','Description','Time Slot','Access','Contact','Hours','Price £','Status','Priority','Notes']];
  d.jobs.forEach((j,i)=>{
    jobRows.push([
      j.date||'',i+1,j.address||'',j.referrer||'',j.landlord||'',j.trade||'',
      j.engineer||'',j.description||'',j.timeSlot||'',j.access||'',j.contact||'',
      j.hours||0,j.price||0,j.status||'',j.priority||'Normal',j.notes||''
    ]);
  });
  const wsJobs=XLSX.utils.aoa_to_sheet(jobRows);
  styleSheet(wsJobs,[14,4,28,18,18,12,14,30,14,16,18,7,10,14,10,25]);
  wsJobs['!freeze']={xSplit:0,ySplit:1};
  XLSX.utils.book_append_sheet(wb,wsJobs,'📋 All Jobs');

  // ── SHEET 2: DAILY JOBS (today + next 30 days) ─────────────
  const today=new Date().toISOString().slice(0,10);
  const todayJobs=d.jobs.filter(j=>j.date>=today);
  todayJobs.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const dayRows=[['Date','Address','Engineer','Trade','Description','Time Slot','Status','Priority','Price £','Paid?']];
  todayJobs.forEach(j=>{
    const inv=d.invoices.find(i=>i.jobId===j.id);
    const paid=inv?.status==='Paid'?'✓ Paid':inv?'⚠ Unpaid':'—';
    dayRows.push([j.date,j.address||'',j.engineer||'',j.trade||'',j.description||'',j.timeSlot||'',j.status||'',j.priority||'Normal',j.price||0,paid]);
  });
  const wsDay=XLSX.utils.aoa_to_sheet(dayRows);
  styleSheet(wsDay,[12,28,14,12,30,14,14,10,10,10]);
  XLSX.utils.book_append_sheet(wb,wsDay,'📅 Daily Schedule');

  // ── SHEET 3: INVOICES ──────────────────────────────────────
  const invRows=[['Invoice #','Date','Due Date','Client','Address','Description','Subtotal £','VAT £','Total £','Paid £','Outstanding £','Status','Days Overdue']];
  d.invoices.forEach(inv=>{
    const sub=inv.lineItems?inv.lineItems.reduce((s,l)=>s+(l.qty||1)*(l.rate||0),0):inv.amount||0;
    const vatR=(inv.vatRate||0)/100;
    const vat=sub*vatR;
    const total=sub+vat;
    const paidItems=d.payments.filter(p=>p.invId===inv.id);
    const paid=paidItems.reduce((s,p)=>s+(p.amount||0),0);
    const outstanding=Math.max(0,total-paid);
    const due=inv.dueDate||'';
    const daysOver=due?Math.max(0,Math.floor((Date.now()-new Date(due))/(86400000))):0;
    invRows.push([
      inv.number||'',inv.date||'',due,inv.clientName||'',inv.address||'',
      (inv.lineItems||[]).map(l=>l.description).join('; ')||inv.description||'',
      +sub.toFixed(2),+vat.toFixed(2),+total.toFixed(2),+paid.toFixed(2),+outstanding.toFixed(2),
      inv.status||'',inv.status==='Paid'?0:daysOver
    ]);
  });
  const wsInv=XLSX.utils.aoa_to_sheet(invRows);
  styleSheet(wsInv,[12,12,12,20,28,35,12,10,12,12,14,14,12]);
  XLSX.utils.book_append_sheet(wb,wsInv,'◎ Invoices');

  // ── SHEET 4+: ENGINEER / SUBCONTRACTOR SHEETS ─────────────
  const engs=[...new Set(d.jobs.map(j=>j.engineer).filter(Boolean))];
  engs.forEach(eng=>{
    const engJobs=d.jobs.filter(j=>j.engineer===eng);
    const rows=[
      [`ENGINEER: ${eng}  —  ${coName}`],
      [],
      ['Date','Address','Trade','Description','Hours','Rate £/hr','OT Rate','Pay £','Invoice #','Invoice Status','Paid £','Outstanding £','Notes']
    ];
    const engCfg=(d.settings.engineers||[]).find(e=>e.name===eng)||{};
    let totalPay=0,totalPaid=0;
    engJobs.sort((a,b)=>a.date<b.date?-1:1);
    engJobs.forEach(j=>{
      const inv=d.invoices.find(i=>i.jobId===j.id);
      const invPay=d.payments.filter(p=>p.invId===inv?.id).reduce((s,p)=>s+(p.amount||0),0);
      const invTotal=inv?((inv.lineItems||[]).reduce((s,l)=>s+(l.qty||1)*(l.rate||0),0)||(inv.amount||0)):0;
      const outstanding=Math.max(0,invTotal-invPay);
      const hrs=j.hours||0;
      const rate=engCfg.rate||0;
      const pay=+(hrs*rate).toFixed(2);
      totalPay+=pay;totalPaid+=invPay;
      rows.push([
        j.date||'',j.address||'',j.trade||'',j.description||'',hrs,rate,engCfg.otRate||0,
        pay,inv?.number||'—',inv?.status||'—',+invPay.toFixed(2),+outstanding.toFixed(2),j.notes||''
      ]);
    });
    // OT entries
    const otEntries=d.overtime.filter(o=>o.engineer===eng);
    if(otEntries.length){
      rows.push([]);
      rows.push(['OVERTIME ENTRIES','','','','Hours','','Rate','Pay','','','','','']);
      otEntries.forEach(o=>{
        const pay=+(o.hours*(engCfg.otRate||0)).toFixed(2);
        totalPay+=pay;
        rows.push([o.date||'','OVERTIME',o.type||'',o.note||'',o.hours||0,'',engCfg.otRate||0,pay,'','','','','']);
      });
    }
    rows.push([]);
    rows.push(['TOTAL','','','','','','',`=SUM(H4:H${rows.length})` ,'','','','','']);
    const ws=XLSX.utils.aoa_to_sheet(rows);
    styleSheet(ws,[12,28,12,30,7,10,10,10,12,14,12,14,20]);
    XLSX.utils.book_append_sheet(wb,ws,`👷 ${eng.slice(0,24)}`);
  });

  // ── SHEET: LANDLORD / BUILDER TRACKER ─────────────────────
  const landlords=[...new Set([...d.jobs.map(j=>j.referrer),...d.persons.filter(p=>p.roles?.includes('landlord')||p.roles?.includes('builder')).map(p=>p.name)].filter(Boolean))];
  landlords.forEach(ll=>{
    const llJobs=d.jobs.filter(j=>j.referrer===ll||j.landlord===ll);
    if(!llJobs.length) return;
    const rows=[
      [`${ll}  —  ${coName}`],
      [],
      ['Date','Address','Trade','Description','Engineer','Status','Invoice #','Invoice Date','Due Date','Invoice Total £','Paid £','Outstanding £','Payment Status','Days Overdue','Comments']
    ];
    let grandTotal=0,grandPaid=0;
    llJobs.sort((a,b)=>a.date<b.date?-1:1);
    llJobs.forEach(j=>{
      const inv=d.invoices.find(i=>i.jobId===j.id);
      const paidItems=d.payments.filter(p=>p.invId===inv?.id);
      const paid=paidItems.reduce((s,p)=>s+(p.amount||0),0);
      const total=inv?((inv.lineItems||[]).reduce((s,l)=>s+(l.qty||1)*(l.rate||0),0)||(inv.amount||0)):0;
      const due=inv?.dueDate||'';
      const daysOver=due&&inv?.status!=='Paid'?Math.max(0,Math.floor((Date.now()-new Date(due))/86400000)):0;
      const outstanding=Math.max(0,total-paid);
      grandTotal+=total;grandPaid+=paid;
      const payStatus=inv?.status==='Paid'?'✓ PAID':inv?.status==='Awaiting Payment'?(daysOver>0?`⚠ OVERDUE ${daysOver}d`:'Awaiting'):inv?inv.status:'No Invoice';
      rows.push([
        j.date||'',j.address||'',j.trade||'',j.description||'',j.engineer||'',
        j.status||'',inv?.number||'—',inv?.date||'',due,+total.toFixed(2),
        +paid.toFixed(2),+outstanding.toFixed(2),payStatus,daysOver,j.notes||''
      ]);
    });
    rows.push([]);
    rows.push(['TOTAL','','','','','','','','',+grandTotal.toFixed(2),+grandPaid.toFixed(2),+(grandTotal-grandPaid).toFixed(2),'','','']);
    const ws=XLSX.utils.aoa_to_sheet(rows);
    styleSheet(ws,[12,28,12,30,14,14,12,12,12,14,12,14,16,12,25]);
    const safeN=(ll||'Unknown').replace(/[\\/*?[\]:]/g,'').slice(0,28);
    XLSX.utils.book_append_sheet(wb,ws,`👤 ${safeN}`);
  });

  // ── SHEET: PAYMENTS SUMMARY ───────────────────────────────
  const payRows=[['Invoice #','Client','Date Paid','Amount £','Method','Reference','Notes']];
  d.payments.forEach(p=>{
    const inv=d.invoices.find(i=>i.id===p.invId);
    payRows.push([inv?.number||'',inv?.clientName||'',p.date||'',p.amount||0,p.method||'',p.ref||'',p.notes||'']);
  });
  const wsPay=XLSX.utils.aoa_to_sheet(payRows);
  styleSheet(wsPay,[12,20,12,12,14,18,25]);
  XLSX.utils.book_append_sheet(wb,wsPay,'💳 Payments');

  // ── WRITE FILE ─────────────────────────────────────────────
  const date=new Date().toISOString().slice(0,10);
  const fname=`${(d.settings.appWord1||'Business')}-Master-${date}.xlsx`;
  XLSX.writeFile(wb,fname);
  toast('Master workbook downloaded ✓','success');
}

export function styleSheet(ws,widths){
  if(!ws['!cols']) ws['!cols']=[];
  (widths||[]).forEach((w,i)=>{ws['!cols'][i]={wch:w}});
}
