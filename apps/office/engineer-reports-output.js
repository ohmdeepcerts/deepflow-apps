// Engineer Reports deep-report modal — the Activity tab's job/cert/login
// timeline, the payslip HTML export, and the full deep-report PDF export.
// Extracted from engineer-reports.js verbatim (Phase 3 of the follow-up
// modularization pass), with one fix applied: _renderEngDeepActivityTab
// called _notifTimeAgo() for the "last activity" timeline row without ever
// importing it — an unconditional ReferenceError for any engineer with real
// last_seen data, silently caught by the tab's own try/catch and shown as a
// generic "Failed to load activity" message. Now imported from main.js like
// every other cross-module helper.
//
// This module and main.js (and the other engineer-reports-*.js files)
// import from each other, same as every other extracted module: safe
// because every cross-module reference is used only inside function bodies,
// never at module-evaluation time.

import { STATUS, localDateStr } from '@business';
import { S, dAll, toast, TODAY, calcInvTotal, _notifTimeAgo } from './main.js';
import { _computeEngStats } from './engineer-reports-core.js';

/* ── Activity Tab ── */
export async function _renderEngDeepActivityTab(engName){
  const el=document.getElementById('eng-deep-tab-activity');
  if(!el) return;
  if(el.dataset.loaded==='1'&&el.dataset.eng===engName){return;}
  el.innerHTML='<div style="padding:20px;color:var(--txt3);font-size:12px;text-align:center">Loading activity…</div>';
  try{
    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')||Promise.resolve([])]);
    const stats=_computeEngStats(engName,allJobs,allInvs,allCerts);
    const events=[];
    stats.jobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).forEach(j=>{
      events.push({type:'job',date:j.date,title:'Job completed',detail:j.address||'—',icon:'✅'});
    });
    stats.certs.forEach(c=>{
      events.push({type:'cert',date:c.issueDate,title:(c.certType||c.type||'Certificate')+' issued',detail:c.address||'—',icon:'📜'});
    });
    const eng=stats.engRec;
    if(eng.last_seen||eng.lastSeen){
      events.push({type:'login',date:(eng.last_seen||eng.lastSeen).slice(0,10),title:'Last activity',detail:_notifTimeAgo(eng.last_seen||eng.lastSeen),icon:'👤'});
    }
    events.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

    if(!events.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--txt3)">No activity recorded.</div>'; el.dataset.loaded='1'; el.dataset.eng=engName; return; }

    el.innerHTML=`<div style="max-width:600px;margin:0 auto">
      ${events.slice(0,50).map(ev=>`<div class="eng2-timeline-item">
        <div class="eng2-timeline-dot" style="background:${ev.type==='job'?'var(--green)':ev.type==='cert'?'var(--purple)':'var(--acc)'};margin-top:6px"></div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span>${ev.icon}</span>
            <span style="font-weight:700;color:var(--txt)">${ev.title}</span>
            <span style="font-size:10px;color:var(--txt3);margin-left:auto">${ev.date||'—'}</span>
          </div>
          <div style="font-size:11px;color:var(--txt2)">${ev.detail}</div>
        </div>
      </div>`).join('')}
    </div>`;
    el.dataset.loaded='1'; el.dataset.eng=engName;
  }catch(e){ el.innerHTML='<div style="color:var(--red);padding:20px">Failed to load activity.</div>'; }
}

/* ── Payslip Export (Feature 1.10) ── */
export async function downloadEngPayslip(engName){
  try{
    const [allJobs,allInvs,allExps]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('expenses')]);
    const stats=_computeEngStats(engName,allJobs,allInvs,[]);
    const eng=(S.engineers||[]).find(e=>e.name===engName)||{};
    const engExps=allExps.filter(e=>e.engineer===engName);

    // Period: this month
    const now=new Date();
    const periodStart=new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString('en-GB');
    const periodEnd=now.toLocaleDateString('en-GB');

    // Completed jobs this month
    const thisMonthStart=localDateStr(now).slice(0,7)+'-01';
    const completedJobs=stats.jobs.filter(j=>j.date>=thisMonthStart&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));

    // Calculate wages — use each job's actually-logged hours where the
    // engineer recorded them; only fall back to an estimate for jobs with
    // no hours logged at all (previously this assumed 4h for every job
    // regardless of what was actually logged).
    const FALLBACK_HOURS_PER_JOB=4;
    const wages=completedJobs.reduce((s,j)=>{
      if(eng.dayRate) return s+Number(eng.dayRate||0);
      if(eng.hourlyRate||eng.rate){
        const actualHours=Number(j.hours)||FALLBACK_HOURS_PER_JOB;
        return s+(Number(eng.hourlyRate||eng.rate||0)*actualHours);
      }
      return s;
    },0);

    // Expense breakdown
    const byCat={};
    engExps.forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+Number(e.cost||0); });
    const materials=byCat['Materials']||0;
    const otherExp=(byCat['Van']||0)+(byCat['Fuel']||0)+(byCat['Tools']||0)+(byCat['Subcontractor']||0)+(byCat['Other']||0);
    const totalDeductions=materials+otherExp;
    const netPay=wages-totalDeductions;

    const w=window.open('','_blank');
    w.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Payslip - ${engName}</title><style>
body{font-family:Arial,sans-serif;max-width:700px;margin:30px auto;padding:24px;color:#1e293b;background:#f8fafc}
.header{text-align:center;padding-bottom:20px;border-bottom:3px solid #2563eb;margin-bottom:24px}
.header h1{color:#2563eb;font-size:32px;margin:0;letter-spacing:2px}
.header p{color:#64748b;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:4px 0 0}
.card{background:#fff;border-radius:12px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.period{background:#f1f5f9;border-radius:8px;padding:12px 16px;text-align:center;margin-bottom:20px;font-size:13px;border:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}
th{text-align:left;padding:8px 10px;color:#64748b;font-size:10px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;font-weight:700}
td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
td:last-child{text-align:right;font-weight:600}
.total-row td{border-top:2px solid #1e293b;border-bottom:none;font-weight:800;font-size:15px;padding-top:10px}
.net-positive{color:#22c55e}
.net-negative{color:#e05252}
.footer{text-align:center;margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8}
.no-print{text-align:center;margin-top:20px}
@media print{body{margin:0;background:#fff}.no-print{display:none}}
</style></head><body>
<div class="card">
<div class="header">
<h1>DEEPFLOW</h1>
<p>Engineer Payment Summary</p>
</div>
<div class="period">
<strong style="font-size:15px;color:#0f172a">${engName}</strong><br>
<span style="color:#64748b">${eng.trade||'General'}</span><br>
Period: <strong>${periodStart}</strong> to <strong>${periodEnd}</strong>
</div>
<h3 style="font-size:14px;margin-bottom:10px;color:#334155">Jobs Completed (${completedJobs.length})</h3>
<table>
<tr><th>Date</th><th>Address</th><th>Description</th>${eng.dayRate?'':'<th>Hours</th>'}<th>Amount</th></tr>
${completedJobs.length?completedJobs.map(j=>{
const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
const amt=inv?calcInvTotal(inv).grand:Number(j.price||0);
const hoursCell=eng.dayRate?'':'<td>'+(Number(j.hours)?Number(j.hours)+'h':FALLBACK_HOURS_PER_JOB+'h (est.)')+'</td>';
return'<tr><td>'+(j.date||'—')+'</td><td>'+(j.address||'—')+'</td><td>'+(j.description||j.type||'—')+'</td>'+hoursCell+'<td>&pound;'+amt.toFixed(2)+'</td></tr>';
}).join(''):'<tr><td colspan="'+(eng.dayRate?4:5)+'" style="text-align:center;color:#94a3b8;padding:16px">No jobs completed this period</td></tr>'}
</table>
</div>
<div class="card">
<h3 style="font-size:14px;margin-bottom:10px;color:#334155">Payment Calculation</h3>
<table>
<tr><td>Gross Earnings (${eng.dayRate?'day rate':'hourly rate'})</td><td>&pound;${wages.toFixed(2)}</td></tr>
${materials?'<tr><td>Less: Materials</td><td style="color:#e05252">-&pound;'+materials.toFixed(2)+'</td></tr>':''}
${otherExp?'<tr><td>Less: Van / Fuel / Tools / Other</td><td style="color:#e05252">-&pound;'+otherExp.toFixed(2)+'</td></tr>':''}
<tr class="total-row"><td>NET PAYMENT</td><td class="${netPay>=0?'net-positive':'net-negative'}">&pound;${netPay.toFixed(2)}</td></tr>
</table>
</div>
<div class="card" style="background:#f8fafc;border:1px solid #e2e8f0">
<h3 style="font-size:13px;margin-bottom:8px;color:#64748b">Engineer Details</h3>
<div style="font-size:12px;color:#475569;line-height:1.8">
${eng.phone?'Phone: '+eng.phone+'<br>':''}
${eng.email?'Email: '+eng.email+'<br>':''}
${eng.dayRate?'Day Rate: &pound;'+eng.dayRate+'<br>':''}
${eng.hourlyRate||eng.rate?'Hourly Rate: &pound;'+(eng.hourlyRate||eng.rate)+'<br>':''}
Rate Type: ${eng.dayRate?'Per Day':'Per Hour'}<br>
Total Completed Jobs (lifetime): ${stats.completed}
</div>
</div>
<div class="footer">
Generated by DeepFlow on ${new Date().toLocaleDateString('en-GB')}<br>
DeepFlow Electrical Compliance Ltd
</div>
<div class="no-print">
<button onclick="window.print()" style="padding:12px 32px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:700">Print / Save as PDF</button>
</div>
</body></html>`);
    w.document.close();
  }catch(e){ console.error('[Payslip]',e); toast('Failed to generate payslip','error'); }
}

/* ── PDF Export ── */
export async function downloadEngDeepReportPDF(engName){
  try{
    if(!window.jspdf){ toast('PDF library not loading','error'); return; }
    const {jsPDF}=window.jspdf;
    toast('Generating report PDF…','info',3000);

    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')||Promise.resolve([])]);
    const stats=_computeEngStats(engName,allJobs,allInvs,allCerts);
    const eng=stats.engRec;
    const todayStr=TODAY();

    const doc=new jsPDF('p','mm','a4');
    const w=doc.internal.pageSize.getWidth();
    let y=14;

    doc.setFillColor(245,246,248);
    doc.rect(0,0,w,38,'F');
    doc.setFontSize(9); doc.setTextColor(120,120,120);
    doc.text(S.coName||'DeepFlow',14,y);
    y+=5;
    doc.setFontSize(18); doc.setTextColor(29,111,173);
    doc.setFont('helvetica','bold');
    doc.text('Engineer Report',14,y);
    doc.setFont('helvetica','normal');
    y+=6;
    doc.setFontSize(11); doc.setTextColor(60,60,60);
    doc.text(engName,14,y);
    y+=5;
    doc.setFontSize(9); doc.setTextColor(140,140,140);
    doc.text((eng.trade||'')+' · '+todayStr,14,y);
    y+=12;

    const boxW=(w-36)/3;
    const stats2=[
      {l:'Completed',v:stats.completed.toString()},
      {l:'Total Earned',v:"£"+stats.earnedTotal.toLocaleString('en-GB')},
      {l:'Completion Rate',v:stats.compRate+"%"}
    ];
    stats2.forEach((s,i)=>{
      const x=14+i*boxW;
      doc.setDrawColor(220,220,220);
      doc.roundedRect(x,y,boxW-4,18,2,2,'S');
      doc.setFontSize(8); doc.setTextColor(140,140,140);
      doc.text(s.l,x+4,y+7);
      doc.setFontSize(13); doc.setTextColor(29,111,173);
      doc.setFont('helvetica','bold');
      doc.text(s.v,x+4,y+14);
      doc.setFont('helvetica','normal');
    });
    y+=26;

    const sortedJobs=[...stats.jobs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,50);
    if(sortedJobs.length){
      doc.setFontSize(10); doc.setTextColor(60,60,60);
      doc.text('Job History',14,y); y+=4;

      const rows=sortedJobs.map(j=>{
        const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
        const invTotal=inv?calcInvTotal(inv).grand:0;
        return [j.date||'—',(j.address||'—').slice(0,35),j.status,invTotal?"£"+invTotal.toFixed(0):"—"];
      });

      doc.autoTable({
        startY:y, margin:{left:14,right:14},
        head:[['Date','Address','Status','Amount']],
        body:rows,
        theme:'grid', headStyles:{fillColor:[29,111,173],textColor:255,fontSize:9},
        bodyStyles:{fontSize:8}, alternateRowStyles:{fillColor:[250,250,250]},
        columnStyles:{0:{cellWidth:28},2:{cellWidth:30},3:{cellWidth:25}},
        styles:{cellPadding:2,fontSize:8,valign:'middle'}
      });
      y=doc.lastAutoTable.finalY+10;
    }

    if(y>250){ doc.addPage(); y=14; }
    doc.setFontSize(10); doc.setTextColor(60,60,60);
    doc.text('Earnings Summary',14,y); y+=8;
    const monthStart=todayStr.slice(0,7)+'-01';
    const monthEarned=stats.jobs.filter(j=>j.date>=monthStart&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)).reduce((s,j)=>s+Number(j.price||0),0);
    const summaries=[
      ['This Month','£'+monthEarned.toLocaleString('en-GB')],
      ['Total Lifetime','£'+stats.earnedTotal.toLocaleString('en-GB')],
      ['Invoiced Amount','£'+stats.invoicedTotal.toLocaleString('en-GB')],
      ['Pending Jobs',stats.pending.toString()]
    ];
    summaries.forEach(([k,v])=>{
      doc.setFontSize(9); doc.setTextColor(120,120,120);
      doc.text(k+':',14,y);
      doc.setFontSize(10); doc.setTextColor(40,40,40);
      doc.setFont('helvetica','bold');
      doc.text(v,50,y);
      doc.setFont('helvetica','normal');
      y+=6;
    });

    const pageCount=doc.internal.getNumberOfPages();
    for(let i=1;i<=pageCount;i++){
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(180,180,180);
      doc.text('Generated by DeepFlow · '+new Date().toLocaleString('en-GB'),14,w-8);
      doc.text('Page '+i+' / '+pageCount,w-30,w-8);
    }

    doc.save(engName.replace(/[^a-z0-9]/gi,'_')+'_Report_'+todayStr+'.pdf');
    toast('Report PDF downloaded','success');
  }catch(e){ toast('PDF failed: '+e.message,'error'); console.error('[downloadEngDeepReportPDF]',e); }
}
