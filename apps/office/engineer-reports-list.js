// Engineer Reports — the leaderboard landing page: per-engineer cards with
// overall KPIs, the ranking table beneath them (Feature 1.11), and the
// filter-bar's CSV/PDF export buttons. Extracted from engineer-reports.js
// verbatim (Phase 3 of the follow-up modularization pass) — no behaviour
// changes.
//
// This module and main.js (and the other engineer-reports-*.js files)
// import from each other, same as every other extracted module: safe
// because every cross-module reference is used only inside function bodies,
// never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS, localDateStr } from '@business';
import { S, dAll, toast, TODAY, calcInvTotal } from './main.js';
import { _weekStart, _computeEngStats } from './engineer-reports-core.js';

/* ── init ── */
export async function initEngReport(){
  try{
    const selEng=document.getElementById('engrep-eng');
    const selTrade=document.getElementById('engrep-trade');
    if(!selEng) return;

    // Populate engineer dropdown
    const engs=S.engineers||[];
    const existingEngs=Array.from(selEng.options).map(o=>o.value);
    engs.forEach(e=>{
      if(!existingEngs.includes(e.name)){
        const opt=document.createElement('option');
        opt.value=e.name; opt.textContent=e.name;
        selEng.appendChild(opt);
      }
    });

    // Populate trade dropdown from unique job trades
    if(selTrade){
      const allJobs=await dAll('jobs');
      const trades=[...new Set(allJobs.map(j=>j.trade).filter(Boolean))].sort();
      const existingTrades=Array.from(selTrade.options).map(o=>o.value);
      trades.forEach(t=>{
        if(!existingTrades.includes(t)){
          const opt=document.createElement('option');
          opt.value=t; opt.textContent=t;
          selTrade.appendChild(opt);
        }
      });
    }

    // Period change shows/hides custom dates
    const selPeriod=document.getElementById('engrep-period');
    if(selPeriod){
      selPeriod.addEventListener('change',function(){
        const cd=document.getElementById('engrep-custom-dates');
        if(cd) cd.style.display=this.value==='custom'?'flex':'none';
      });
    }

    await renderEngReport();
  }catch(e){ console.error('[initEngReport]',e); }
}

/* ── Main landing: leader-board view ── */
export async function renderEngReport(){
  const body=document.getElementById('engrep-body');
  if(!body) return;
  body.innerHTML='<div style="text-align:center;padding:40px;color:var(--txt3);font-size:12px">Loading…</div>';

  try{
    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')||Promise.resolve([])]);
    const selEng=document.getElementById('engrep-eng')?.value||'';
    const selTrade=document.getElementById('engrep-trade')?.value||'';
    const searchText=(document.getElementById('engrep-search')?.value||'').toLowerCase().trim();
    const period=document.getElementById('engrep-period')?.value||'this_month';
    const sortBy=document.getElementById('engrep-sort')?.value||'earnings';

    // Date range
    const today=TODAY();
    let fromDate='', toDate=today;
    if(period==='this_month'){ fromDate=today.slice(0,7)+'-01'; }
    else if(period==='last_month'){
      // new Date(y,m,d) is local-midnight; toISOString() is UTC -- during
      // BST this shifted "last month" by a full month, every time, not
      // just near midnight (same bug as _getPLPeriodDates in main.js).
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=localDateStr(d);
      toDate=localDateStr(new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0));
    }else if(period==='this_year'){ fromDate=today.slice(0,4)+'-01-01'; }
    else if(period==='custom'){
      fromDate=document.getElementById('engrep-from')?.value||'';
      toDate=document.getElementById('engrep-to')?.value||today;
    }

    // Filter jobs by period + trade
    let periodJobs=allJobs.filter(j=>{
      if(fromDate && j.date && j.date<fromDate) return false;
      if(toDate && j.date && j.date>toDate) return false;
      if(selTrade && j.trade!==selTrade) return false;
      return true;
    });

    // Group by engineer from period-filtered jobs
    const engMap={};
    periodJobs.forEach(j=>{
      const n=j.engineer||'Unassigned';
      if(!engMap[n]) engMap[n]={name:n, trade:j.trade||'', jobs:[], totalInvoiced:0, totalPaid:0, completed:0, pending:0, invoiced:0 };
      engMap[n].jobs.push(j);
      if(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED) engMap[n].completed++;
      if(j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS) engMap[n].pending++;
      if(j.status===STATUS.INVOICED) engMap[n].invoiced++;
      const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
      if(inv) engMap[n].totalInvoiced+=calcInvTotal(inv).grand;
      if(j.price) engMap[n].totalPaid+=Number(j.price)||0;
    });

    // Also get ALL jobs for each engineer to compute overall stats
    const allEngNames=[...new Set(allJobs.map(j=>j.engineer||'Unassigned'))];
    allEngNames.forEach(name=>{
      if(!engMap[name]){
        const ej=allJobs.filter(j=>(j.engineer||'Unassigned')===name);
        const trade=ej[0]?.trade||'';
        engMap[name]={name, trade, jobs:[], totalInvoiced:0, totalPaid:0, completed:0, pending:0, invoiced:0 };
      }
    });

    let engs=Object.values(engMap);

    // Filter by engineer name
    if(selEng) engs=engs.filter(e=>e.name===selEng);

    // Filter by search text
    if(searchText) engs=engs.filter(e=>e.name.toLowerCase().includes(searchText));

    // Sorting
    engs.forEach(e=>{ e.compRate=e.jobs.length?Math.round(e.completed/e.jobs.length*100):0; });
    if(sortBy==='earnings'){ engs.sort((a,b)=>b.totalInvoiced-a.totalInvoiced); }
    else if(sortBy==='jobs'){ engs.sort((a,b)=>b.jobs.length-a.jobs.length); }
    else if(sortBy==='completion'){ engs.sort((a,b)=>b.compRate-a.compRate); }
    else if(sortBy==='name'){ engs.sort((a,b)=>a.name.localeCompare(b.name)); }

    // Overall KPIs
    const allCompleted=allJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED);
    const allRevenue=allCompleted.reduce((s,j)=>s+Number(j.price||0),0);
    const weekStart=_weekStart(today);
    const jobsToday=allJobs.filter(j=>j.date===today).length;
    const jobsWeek=allJobs.filter(j=>j.date>=weekStart).length;

    const kpi=(val,lbl,pk='var(--acc)',ic='◆',deco='✦')=>`<div class="pkpi" style="--pk:${pk};cursor:default">
      <div class="pkpi-blob"></div><div class="pkpi-deco">${deco}</div>
      <div class="pkpi-ic">${ic}</div>
      <div class="pkpi-val">${val}</div>
      <div class="pkpi-lbl">${lbl}</div>
    </div>`;

    // Avatar colors (deterministic per engineer)
    const avatarColors=['#1d6fad','#15803d','#b45309','#7c3aed','#c2410c','#b91c1c','#0d9488','#4338ca'];
    const engColor= name=> avatarColors[ name.split('').reduce((s,c)=>s+c.charCodeAt(0),0) % avatarColors.length ];

    body.innerHTML=`
      <!-- Overall KPIs -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px">
        ${kpi((S.engineers||[]).filter(e=>e.name).length,'Total Engineers','var(--blue)','👷','🛠️')}
        ${kpi(jobsToday,'Jobs Today','var(--acc)','📅','⚡')}
        ${kpi(jobsWeek,'Jobs This Week','var(--purple)','🗓️','📈')}
        ${kpi(allCompleted.length,'Total Completed','var(--green)','✅','🏆')}
        ${kpi('£'+allRevenue.toLocaleString('en-GB',{maximumFractionDigits:0}),'Total Revenue','var(--acc)','💷','💰')}
      </div>

      ${engs.map(eng=>{
        const ac=engColor(eng.name);
        const recentJobs=eng.jobs.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);
        const engObj=(S.engineers||[]).find(e=>e.name===eng.name)||{};
        const phone=engObj.phone||'';
        const wa=engObj.wa||phone;
        return`<div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden;transition:box-shadow .15s" onmouseenter="this.style.boxShadow='0 10px 26px rgba(0,0,0,.08)'" onmouseleave="this.style.boxShadow=''">
          <div style="height:3px;background:linear-gradient(90deg,${ac},var(--acc))"></div>
          <!-- Engineer header -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--s2)">
            <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,${ac},var(--acc));display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 4px 12px -2px ${ac}88">${(eng.name||'?')[0].toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:800;color:var(--txt)">${eng.name}</div>
              <div style="font-size:11px;color:var(--txt3)">${eng.trade||'No trade'} · ${eng.jobs.length} jobs · ${eng.compRate}% completion</div>
            </div>
            <div style="display:flex;gap:18px;text-align:right;flex-shrink:0">
              <div><div style="font-size:16px;font-weight:900;color:var(--acc)">£${eng.totalInvoiced.toLocaleString('en-GB',{maximumFractionDigits:0})}</div><div style="font-size:9px;color:var(--txt3);text-transform:uppercase;font-weight:600">Invoiced</div></div>
              <div><div style="font-size:16px;font-weight:900;color:var(--green)">${eng.completed}</div><div style="font-size:9px;color:var(--txt3);text-transform:uppercase;font-weight:600">Done</div></div>
              <div><div style="font-size:16px;font-weight:900;color:var(--yellow)">${eng.pending}</div><div style="font-size:9px;color:var(--txt3);text-transform:uppercase;font-weight:600">Pending</div></div>
            </div>
            <button class="btn btn-sm" style="background:var(--acc);color:#fff;font-size:11px;padding:6px 14px;flex-shrink:0" onclick="openEngDeepReport('${eng.name.replace(/'/g,"\\'")}')">View Full Report →</button>
          </div>
          <!-- Completion bar -->
          <div style="height:4px;background:var(--border)"><div style="height:100%;width:${eng.compRate}%;background:linear-gradient(90deg,var(--green),#22c55e);transition:width .4s ease;border-radius:0 2px 2px 0"></div></div>
          <!-- Recent jobs -->
          <div style="padding:12px 18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <div style="font-size:10px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">Recent Jobs</div>
              <div style="display:flex;gap:4px">
                ${phone?`<button class="eng2-action-btn" onclick="window.open('tel:${phone}')" title="Call">📞</button>`:''}
                ${wa?`<button class="eng2-action-btn" onclick="window.open('https://wa.me/${wa.replace(/\\D/g,'')}')" title="WhatsApp">💬</button>`:''}
              </div>
            </div>
            ${recentJobs.length?recentJobs.map(j=>{
              const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
              const invoiced=inv?calcInvTotal(inv).grand:0;
              const cost=Number(j.price)||0;
              const profit=invoiced-cost;
              const sc={Pending:'#f59e0b','In Progress':'#3b82f6',Completed:'#22c55e',Invoiced:'#a855f7',Cancelled:'#94a3b8'}[j.status]||'#94a3b8';
              return`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px">
                <div style="font-size:9px;font-weight:600;color:var(--txt3);min-width:70px;flex-shrink:0">${j.date||'—'}</div>
                <div style="flex:1;color:var(--txt);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${escHtml(j.address)||'—'}</div>
                <div style="color:var(--txt2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${escHtml(j.description)||'—'}</div>
                <div style="font-size:9px;font-weight:700;color:${sc};background:${sc}18;padding:2px 6px;border-radius:6px;white-space:nowrap;flex-shrink:0">${j.status}</div>
                ${invoiced?`<div style="font-weight:700;color:var(--acc);min-width:50px;text-align:right;flex-shrink:0;cursor:pointer;text-decoration:underline;text-decoration-style:dotted" onclick="event.stopPropagation();nav('inv');invNavSelect('all');setTimeout(()=>viewInv('${inv.id}'),300)" title="View invoice">£${invoiced.toFixed(0)}</div>`:'<div style="min-width:50px;flex-shrink:0"></div>'}
                ${profit>0?`<div style="font-size:9px;font-weight:700;color:var(--green);min-width:52px;text-align:right;flex-shrink:0">+£${profit.toFixed(0)}</div>`:profit<0?`<div style="font-size:9px;color:var(--red);min-width:52px;text-align:right;flex-shrink:0">-£${Math.abs(profit).toFixed(0)}</div>`:'<div style="min-width:52px;flex-shrink:0"></div>'}
              </div>`;
            }).join(''):'<div style="font-size:11px;color:var(--txt3);padding:8px 0">No jobs in selected period.</div>'}
            ${eng.jobs.length>5?`<div style="font-size:11px;color:var(--acc);margin-top:8px;cursor:pointer;font-weight:600" onclick="showAllEngJobs('${eng.name.replace(/'/g,"\\'")}')">View all ${eng.jobs.length} jobs →</div>`:''}
          </div>
        </div>`;
      }).join('')}

      ${engs.length===0?`<div style="text-align:center;padding:60px;color:var(--txt3)">No engineers found for the selected filters.</div>`:''}

      <!-- Engineer Ranking Table (Feature 1.11) -->
      <div id="eng-ranking-container" style="margin-top:28px"></div>`;

    // Render ranking table after the main cards
    setTimeout(()=>_renderEngRankingTable('eng-ranking-container'),50);

  }catch(e){
    console.error('[renderEngReport]',e);
    body.innerHTML='<div style="text-align:center;padding:60px;color:var(--red)">Failed to load engineer reports. Check console.</div>';
  }
}

/* ── Engineer Ranking Table (Feature 1.11) ── */
export async function _renderEngRankingTable(containerId){
  const container=document.getElementById(containerId);
  if(!container) return;
  container.innerHTML='<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">Loading rankings…</div>';
  try{
    const [allJobs,allInvs,allExps]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('expenses')]);
    const engineers=(S.engineers||[]).filter(e=>e.name).map(eng=>{
      const stats=_computeEngStats(eng.name,allJobs,allInvs,[]);
      const exps=allExps.filter(e=>e.engineer===eng.name);
      const totalExp=exps.reduce((s,e)=>s+Number(e.cost||0),0);
      const hoursPerJob=4; // fallback estimate — used only when a job has no logged hours
      const completedJobs=allJobs.filter(j=>j.engineer===eng.name&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
      const wages=completedJobs.reduce((s,j)=>{
        if(eng.dayRate) return s+Number(eng.dayRate||0);
        if(eng.hourlyRate||eng.rate) return s+(Number(eng.hourlyRate||eng.rate||0)*(Number(j.hours)||hoursPerJob));
        return s;
      },0);
      const netProfit=stats.earnedTotal-wages-totalExp;
      const compRate=stats.totalJobs?Math.round(stats.completed/stats.totalJobs*100):0;
      return{...stats,name:eng.name,trade:eng.trade,netProfit,totalExp,wages,compRate};
    });

    // Sort by earnedTotal (default)
    engineers.sort((a,b)=>b.earnedTotal-a.earnedTotal);

    const rankColors=['rgba(245,166,35,.12)','rgba(168,170,173,.12)','rgba(180,83,9,.1)'];
    const rankMedals=['🥇','🥈','🥉'];

    container.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-top:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:800;color:var(--txt)">🏆 Engineer Rankings</div>
        <div style="font-size:11px;color:var(--txt3)">Sorted by total revenue</div>
      </div>
      <div style="overflow-x:auto">
        <table class="eng-rank-tbl" style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:2px solid var(--border);background:var(--s2)">
            <th style="text-align:center;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase;width:40px">Rank</th>
            <th style="text-align:left;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Name</th>
            <th style="text-align:left;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Trade</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Jobs</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Done</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Revenue</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Wages</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Expenses</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Net Profit</th>
            <th style="text-align:right;padding:8px 6px;color:var(--txt3);font-size:10px;text-transform:uppercase">Comp %</th>
          </tr></thead>
          <tbody>
            ${engineers.map((eng,idx)=>{
              const rankBg=idx<3?rankColors[idx]:'';
              const medal=idx<3?rankMedals[idx]+' ':'';
              return`<tr style="border-bottom:1px solid var(--border);background:${rankBg}">
                <td style="padding:8px 6px;text-align:center;font-weight:800;color:var(--txt)">${idx+1}</td>
                <td style="padding:8px 6px;font-weight:700;color:var(--txt)">${medal}${eng.name}</td>
                <td style="padding:8px 6px;color:var(--txt2)">${eng.trade||'—'}</td>
                <td style="padding:8px 6px;text-align:right">${eng.totalJobs}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--green);font-weight:700">${eng.completed}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--acc);font-weight:700">£${eng.earnedTotal.toLocaleString('en-GB')}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--red)">£${eng.wages.toLocaleString('en-GB')}</td>
                <td style="padding:8px 6px;text-align:right;color:var(--red)">£${eng.totalExp.toFixed(0)}</td>
                <td style="padding:8px 6px;text-align:right;font-weight:800;color:${eng.netProfit>=0?'var(--green)':'var(--red)'}">£${eng.netProfit.toLocaleString('en-GB')}</td>
                <td style="padding:8px 6px;text-align:right">
                  <div style="display:inline-flex;align-items:center;gap:4px">
                    <div style="width:40px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
                      <div style="width:${eng.compRate}%;height:100%;background:${eng.compRate>=80?'var(--green)':eng.compRate>=50?'var(--yellow)':'var(--red)'};border-radius:2px"></div>
                    </div>
                    <span style="font-size:10px;font-weight:700">${eng.compRate}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }catch(e){ console.error('[RankingTable]',e); container.innerHTML=''; }
}

/* ── CSV Export ── */
export async function exportEngReport(){
  try{
    const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const selEng=document.getElementById('engrep-eng')?.value||'';
    const period=document.getElementById('engrep-period')?.value||'this_month';
    const today=TODAY();
    let fromDate='',toDate=today;
    if(period==='this_month'){ fromDate=today.slice(0,7)+'-01'; }
    else if(period==='last_month'){
      // new Date(y,m,d) is local-midnight; toISOString() is UTC -- during
      // BST this shifted "last month" by a full month, every time, not
      // just near midnight (same bug as _getPLPeriodDates in main.js).
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=localDateStr(d);
      toDate=localDateStr(new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0));
    }else if(period==='this_year'){ fromDate=today.slice(0,4)+'-01-01'; }
    else if(period==='custom'){
      fromDate=document.getElementById('engrep-from')?.value||'';
      toDate=document.getElementById('engrep-to')?.value||today;
    }

    let jobs=allJobs.filter(j=>{
      if(selEng && j.engineer!==selEng) return false;
      if(fromDate && j.date && j.date<fromDate) return false;
      if(toDate && j.date && j.date>toDate) return false;
      return true;
    });

    const rows=[['Engineer','Job #','Date','Address','Description','Status','Trade','Price','Invoice Amount','Profit']];
    jobs.forEach(j=>{
      const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
      const invoiced=inv?calcInvTotal(inv).grand:0;
      const cost=Number(j.price)||0;
      rows.push([j.engineer||'—',j.jobNum||'—',j.date||'—',j.address||'—',j.description||'—',j.status,j.trade||'—',cost.toFixed(2),invoiced.toFixed(2),(invoiced-cost).toFixed(2)]);
    });
    const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
    const a=document.createElement('a');
    a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
    a.download='engineer-report-'+today+'.csv';
    a.click();
    toast('Engineer report exported','success');
  }catch(e){ toast('Export failed: '+e.message,'error'); }
}

// The "📄 Export PDF" button next to Export CSV called exportEngReportPDF(),
// which didn't exist anywhere in the file — a real, always-broken button
// (ReferenceError on click). Built as a genuine PDF equivalent to the CSV
// export above, same filters/columns, following the same jsPDF+autoTable
// pattern already used by exportCertPDF()/downloadEngDeepReportPDF().
export async function exportEngReportPDF(){
  try{
    if(!window.jspdf){ toast('PDF library not loaded — please check your internet connection and try again','error'); return; }
    const {jsPDF}=window.jspdf;
    const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const selEng=document.getElementById('engrep-eng')?.value||'';
    const period=document.getElementById('engrep-period')?.value||'this_month';
    const today=TODAY();
    let fromDate='',toDate=today;
    if(period==='this_month'){ fromDate=today.slice(0,7)+'-01'; }
    else if(period==='last_month'){
      // new Date(y,m,d) is local-midnight; toISOString() is UTC -- during
      // BST this shifted "last month" by a full month, every time, not
      // just near midnight (same bug as _getPLPeriodDates in main.js).
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=localDateStr(d);
      toDate=localDateStr(new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0));
    }else if(period==='this_year'){ fromDate=today.slice(0,4)+'-01-01'; }
    else if(period==='custom'){
      fromDate=document.getElementById('engrep-from')?.value||'';
      toDate=document.getElementById('engrep-to')?.value||today;
    }
    const jobs=allJobs.filter(j=>{
      if(selEng && j.engineer!==selEng) return false;
      if(fromDate && j.date && j.date<fromDate) return false;
      if(toDate && j.date && j.date>toDate) return false;
      return true;
    });
    const doc=new jsPDF('l','mm','a4');
    doc.setFontSize(16);doc.text('DeepFlow — Engineer Report',14,18);
    doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} | ${selEng||'All engineers'} | ${jobs.length} jobs`,14,25);
    const rows=jobs.map(j=>{
      const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
      const invoiced=inv?calcInvTotal(inv).grand:0;
      const cost=Number(j.price)||0;
      return[j.engineer||'—',j.jobNum||'—',j.date||'—',j.address||'—',j.description||'—',j.status,cost.toFixed(2),invoiced.toFixed(2),(invoiced-cost).toFixed(2)];
    });
    doc.autoTable({startY:30,head:[['Engineer','Job #','Date','Address','Description','Status','Price','Invoiced','Profit']],body:rows,theme:'striped',styles:{fontSize:7},headStyles:{fillColor:[15,23,42]}});
    doc.save('engineer-report-'+today+'.pdf');
    toast('Engineer report PDF exported','success');
  }catch(e){ toast('PDF export failed: '+e.message,'error'); }
}

/* ── Show all jobs for one engineer ── */
export function showAllEngJobs(engName){
  const selEng=document.getElementById('engrep-eng');
  const selPeriod=document.getElementById('engrep-period');
  if(selEng) selEng.value=engName;
  if(selPeriod) selPeriod.value='all';
  const search=document.getElementById('engrep-search');
  if(search) search.value='';
  renderEngReport();
}

/* ── Conditional render ── */
export async function renderEngReportIfActive(){
  if(document.getElementById('pg-engrep')?.classList.contains('active')) await initEngReport();
}
