// Engineer Reports — the analytics/deep-report page: per-engineer ranking
// table, the tabbed "deep report" modal (jobs/certs/earnings/trend/
// activity), payslip PDF, deep-report PDF, and CSV export. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 5 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// Same as the Audit Log extraction: the original "ENGINEER REPORTS v2"
// section header in main.js also had the entire job-modal CRUD flow
// directly below it with no real boundary — that's core Jobs-domain code
// that stays in main.js. Confirmed the true edge (renderEngReportIfActive
// is the last function with any external caller before openJobModal takes
// over) before extracting only the genuine reports half.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS } from '@business';
import { S, dAll, toast, TODAY, nav, calcInvTotal } from './main.js';


// ══════════════════════════════════════════════════════════════
//  ENGINEER REPORTS  v2 — Comprehensive analytics & deep reports
// ══════════════════════════════════════════════════════════════

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
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=d.toISOString().slice(0,10);
      toDate=new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0).toISOString().slice(0,10);
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

    const kpi=(val,lbl,col='var(--acc)')=>`<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px 16px">
      <div style="font-size:20px;font-weight:900;color:${col};line-height:1;margin-bottom:3px">${val}</div>
      <div style="font-size:10px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.4px">${lbl}</div>
    </div>`;

    // Avatar colors (deterministic per engineer)
    const avatarColors=['#1d6fad','#15803d','#b45309','#7c3aed','#c2410c','#b91c1c','#0d9488','#4338ca'];
    const engColor= name=> avatarColors[ name.split('').reduce((s,c)=>s+c.charCodeAt(0),0) % avatarColors.length ];

    body.innerHTML=`
      <!-- Overall KPIs -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:20px">
        ${kpi((S.engineers||[]).filter(e=>e.name).length,'Total Engineers','var(--blue)')}
        ${kpi(jobsToday,'Jobs Today','var(--acc)')}
        ${kpi(jobsWeek,'Jobs This Week','var(--purple)')}
        ${kpi(allCompleted.length,'Total Completed','var(--green)')}
        ${kpi('£'+allRevenue.toLocaleString('en-GB',{maximumFractionDigits:0}),'Total Revenue','var(--acc)')}
      </div>

      ${engs.map(eng=>{
        const ac=engColor(eng.name);
        const recentJobs=eng.jobs.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);
        const engObj=(S.engineers||[]).find(e=>e.name===eng.name)||{};
        const phone=engObj.phone||'';
        const wa=engObj.wa||phone;
        return`<div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden">
          <!-- Engineer header -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--s2)">
            <div style="width:42px;height:42px;border-radius:50%;background:${ac}22;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:${ac};flex-shrink:0;border:2px solid ${ac}44">${(eng.name||'?')[0].toUpperCase()}</div>
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
                ${invoiced?`<div style="font-weight:700;color:var(--acc);min-width:50px;text-align:right;flex-shrink:0">£${invoiced.toFixed(0)}</div>`:'<div style="min-width:50px;flex-shrink:0"></div>'}
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
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:2px solid var(--border)">
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

/* ── Deep individual report modal ── */
export async function openEngDeepReport(engName){
  try{
    const overlay=document.getElementById('eng-deep-overlay');
    const nameEl=document.getElementById('eng-deep-name');
    const tradeEl=document.getElementById('eng-deep-trade');
    const avatarEl=document.getElementById('eng-deep-avatar');
    const statusDot=document.getElementById('eng-deep-status-dot');
    const statsEl=document.getElementById('eng-deep-stats');
    const chartEl=document.getElementById('eng-deep-chart');
    if(!overlay||!nameEl) return;

    overlay.dataset.engName=engName;

    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')||Promise.resolve([])]);
    const stats=_computeEngStats(engName,allJobs,allInvs,allCerts);
    const eng=stats.engRec;

    nameEl.textContent=engName;
    const rateInfo=[];
    if(eng.dayRate) rateInfo.push('Day: £'+eng.dayRate);
    if(eng.hourlyRate||eng.rate) rateInfo.push('Hr: £'+(eng.hourlyRate||eng.rate));
    if(eng.costRate) rateInfo.push('Cost: £'+eng.costRate+'/day');
    tradeEl.textContent=(eng.trade||stats.jobs[0]?.trade||'No trade')+' · '+stats.totalJobs+' lifetime jobs'+(rateInfo.length?' · '+rateInfo.join(' · '):'');
    avatarEl.textContent=(engName||'?')[0].toUpperCase();

    // Online status (green dot if last_seen within 10 min)
    const lastSeen=eng.last_seen||eng.lastSeen;
    if(lastSeen){
      const minsSince=Math.floor((Date.now()-new Date(lastSeen).getTime())/60000);
      statusDot.style.background=minsSince<10?'#22c55e':minsSince<60?'#f59e0b':'#94a3b8';
      statusDot.title=minsSince<10?'Online':minsSince<60?'Last seen '+minsSince+'m ago':'Last seen '+Math.floor(minsSince/60)+'h ago';
    }else{ statusDot.style.background='#94a3b8'; statusDot.title='No activity data'; }

    // Quick actions
    const phone=eng.phone||'';
    const wa=eng.wa||phone;
    const mapAddr=stats.jobs[0]?.address||'';
    document.getElementById('eng-deep-call').onclick=phone?()=>window.open('tel:'+phone):null;
    document.getElementById('eng-deep-call').style.opacity=phone?'1':'.3';
    document.getElementById('eng-deep-wa').onclick=wa?()=>window.open('https://wa.me/'+wa.replace(/\\D/g,'')):null;
    document.getElementById('eng-deep-wa').style.opacity=wa?'1':'.3';
    document.getElementById('eng-deep-map').onclick=mapAddr?()=>window.open('https://maps.google.com/?q='+encodeURIComponent(mapAddr)):null;
    document.getElementById('eng-deep-map').style.opacity=mapAddr?'1':'.3';
    document.getElementById('eng-deep-pdf').onclick=()=>downloadEngDeepReportPDF(engName);

    // Stats Dashboard (3x2 grid)
    const todayStr=TODAY();
    const statCard=(lbl,val,sub,col='var(--txt)')=>`<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
      <div style="font-size:10px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${lbl}</div>
      <div style="font-size:22px;font-weight:900;color:${col};line-height:1">${val}</div>
      ${sub?`<div style="font-size:10px;color:var(--txt3);margin-top:2px">${sub}</div>`:''}
    </div>`;

    const compColor=stats.compRate>=80?'var(--green)':stats.compRate>=50?'var(--yellow)':'var(--red)';
    statsEl.innerHTML=`
      ${statCard('Today',stats.todayJobs,stats.earnedToday?"£"+stats.earnedToday.toLocaleString('en-GB')+" earned":'',"var(--acc)")}
      ${statCard('This Week',stats.weekJobs,stats.earnedWeek?"£"+stats.earnedWeek.toLocaleString('en-GB')+" earned":'',"var(--purple)")}
      ${statCard('This Month',stats.monthJobs,stats.earnedMonth?"£"+stats.earnedMonth.toLocaleString('en-GB')+" earned":'',"var(--blue)")}
      ${statCard('Total Completed',stats.completed.toLocaleString('en-GB'),"",compColor)}
      ${statCard('Total Earned',"£"+stats.earnedTotal.toLocaleString('en-GB'),stats.invoicedTotal?"£"+stats.invoicedTotal.toLocaleString('en-GB')+" invoiced":"","var(--green)")}
      ${statCard('Completion Rate',stats.compRate+"%",stats.pending+" pending",compColor)}
    `;

    // Earnings Chart (CSS bar chart - last 6 months)
    const months=[];
    for(let i=5;i>=0;i--){
      const d=new Date(); d.setMonth(d.getMonth()-i);
      const ym=d.toISOString().slice(0,7);
      const monthJobs=stats.jobs.filter(j=>j.date&&j.date.startsWith(ym)&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
      const earned=monthJobs.reduce((s,j)=>s+Number(j.price||0),0);
      months.push({label:d.toLocaleString('en-GB',{month:'short'}),value:earned});
    }
    const maxVal=Math.max(...months.map(m=>m.value),1);
    chartEl.innerHTML=months.map(m=>{
      const pct=Math.round(m.value/maxVal*100);
      const h=Math.max(pct,4);
      return`<div class="eng2-chart-bar">
        <div class="eng2-chart-bar-value">${m.value?"£"+m.value.toLocaleString('en-GB'):''}</div>
        <div class="eng2-chart-bar-fill" style="height:${h}%"></div>
        <div class="eng2-chart-bar-label">${m.label}</div>
      </div>`;
    }).join('');

    _switchEngDeepTab('jobs');

    overlay.classList.add('open');
  }catch(e){ console.error('[openEngDeepReport]',e); toast('Failed to open report','error'); }
}

/* ── Tab switching ── */
export function _switchEngDeepTab(tab){
  document.querySelectorAll('.eng-tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.eng-tab-panel').forEach(p=>p.style.display=p.id==='eng-deep-tab-'+tab?'block':'none');
  const engName=document.getElementById('eng-deep-overlay')?.dataset.engName;
  if(!engName) return;
  if(tab==='jobs') _renderEngDeepJobsTab(engName);
  else if(tab==='certs') _renderEngDeepCertsTab(engName);
  else if(tab==='earnings') _renderEngDeepEarningsTab(engName);
  else if(tab==='trend') _renderEngDeepTrendTab(engName);
  else if(tab==='activity') _renderEngDeepActivityTab(engName);
}

/* ── Jobs Tab ── */
export async function _renderEngDeepJobsTab(engName){
  const el=document.getElementById('eng-deep-tab-jobs');
  if(!el) return;
  if(el.dataset.loaded==='1'&&el.dataset.eng===engName){return;}
  el.innerHTML='<div style="padding:20px;color:var(--txt3);font-size:12px;text-align:center">Loading jobs…</div>';
  try{
    const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const stats=_computeEngStats(engName,allJobs,allInvs,[]);
    const jobs=[...stats.jobs].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(!jobs.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--txt3)">No jobs found.</div>'; el.dataset.loaded='1'; el.dataset.eng=engName; return; }

    el.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <select id="eng-jobs-filter-status" onchange="_renderEngDeepJobsList('${engName.replace(/'/g,"\\'")}')" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--r)">
        <option value="">All Statuses</option>
        <option value="Pending">Pending</option>
        <option value="In Progress">In Progress</option>
        <option value="Completed">Completed</option>
        <option value="Invoiced">Invoiced</option>
        <option value="Cancelled">Cancelled</option>
      </select>
      <input type="text" id="eng-jobs-filter-search" placeholder="Search address/desc…" oninput="_renderEngDeepJobsList('${engName.replace(/'/g,"\\'")}')" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:var(--r);width:180px">
      <span style="margin-left:auto;font-size:11px;color:var(--txt3)">${jobs.length} jobs</span>
    </div>
    <div id="eng-jobs-list-container"></div>`;
    _renderEngDeepJobsList(engName);
    el.dataset.loaded='1'; el.dataset.eng=engName;
  }catch(e){ el.innerHTML='<div style="color:var(--red);padding:20px">Failed to load jobs.</div>'; }
}

export async function _renderEngDeepJobsList(engName){
  const container=document.getElementById('eng-jobs-list-container');
  if(!container) return;
  try{
    const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const stats=_computeEngStats(engName,allJobs,allInvs,[]);
    let jobs=[...stats.jobs];
    const statusF=document.getElementById('eng-jobs-filter-status')?.value||'';
    const searchF=(document.getElementById('eng-jobs-filter-search')?.value||'').toLowerCase();
    if(statusF) jobs=jobs.filter(j=>j.status===statusF);
    if(searchF) jobs=jobs.filter(j=>(j.address||'').toLowerCase().includes(searchF)||(j.description||'').toLowerCase().includes(searchF));
    jobs.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

    const statusColors={Pending:'#f59e0b','In Progress':'#3b82f6',Completed:'#22c55e',Invoiced:'#a855f7',Cancelled:'#94a3b8'};
    container.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="display:grid;grid-template-columns:80px 1fr 120px 90px 70px 80px 70px;font-size:9px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--s2)">
        <span>Date</span><span>Address / Description</span><span>Status</span><span>Trade</span><span style="text-align:right">Price</span><span style="text-align:right">Invoice</span><span style="text-align:right">Profit</span>
      </div>
      ${jobs.map(j=>{
        const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
        const invTotal=inv?calcInvTotal(inv).grand:0;
        const price=Number(j.price)||0;
        const profit=invTotal-price;
        const sc=statusColors[j.status]||'#94a3b8';
        const noInv=j.status===STATUS.COMPLETED&&!inv;
        return`<div style="display:grid;grid-template-columns:80px 1fr 120px 90px 70px 80px 70px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:11px;align-items:center" ondblclick="openJobModal('${j.id}')">
          <span style="font-size:10px;color:var(--txt3)">${j.date||'—'}</span>
          <div style="overflow:hidden;min-width:0">
            <div style="font-weight:600;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.address)||'—'}</div>
            <div style="font-size:10px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.description)||'—'}</div>
          </div>
          <span style="font-size:9px;font-weight:700;color:${sc};background:${sc}18;padding:2px 8px;border-radius:6px;text-align:center;white-space:nowrap">${j.status}</span>
          <span style="font-size:10px;color:var(--txt2)">${escHtml(j.trade)||'—'}</span>
          <span style="text-align:right;font-weight:600">${price?"£"+price.toFixed(0):"—"}</span>
          <span style="text-align:right;font-weight:700;color:${invTotal?"var(--acc)":"var(--txt3)"}">${invTotal?"£"+invTotal.toFixed(0):"—"}</span>
          <div style="text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:4px">
            ${profit>0?`<span style="color:var(--green);font-weight:700">+£${profit.toFixed(0)}</span>`:profit<0?`<span style="color:var(--red)">-£${Math.abs(profit).toFixed(0)}</span>`:'<span style="color:var(--txt3)">—</span>'}
            ${noInv?`<button class="btn btn-sm" style="font-size:9px;padding:2px 6px;background:var(--green);color:#fff" onclick="event.stopPropagation();createInvFromJob('${j.id}')" title="Create Invoice">£</button>`:''}
          </div>
        </div>`;
      }).join('')}
      ${jobs.length===0?'<div style="padding:20px;text-align:center;color:var(--txt3)">No matching jobs.</div>':''}
    </div>`;
  }catch(e){ container.innerHTML='<div style="color:var(--red)">Error loading jobs.</div>'; }
}

/* ── Certificates Tab ── */
export async function _renderEngDeepCertsTab(engName){
  const el=document.getElementById('eng-deep-tab-certs');
  if(!el) return;
  if(el.dataset.loaded==='1'&&el.dataset.eng===engName){return;}
  el.innerHTML='<div style="padding:20px;color:var(--txt3);font-size:12px;text-align:center">Loading certificates…</div>';
  try{
    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')||Promise.resolve([])]);
    const stats=_computeEngStats(engName,allJobs,allInvs,allCerts);
    const certs=stats.certs;
    if(!certs.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--txt3)">No certificates linked to this engineer\'s jobs.</div>'; el.dataset.loaded='1'; el.dataset.eng=engName; return; }

    const todayStr=TODAY();
    el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
      ${certs.map(c=>{
        const daysUntil=c.expiryDate?Math.ceil((new Date(c.expiryDate)-new Date(todayStr))/86400000):null;
        let cls='eng2-cert-valid';
        let badge='<span style="font-size:10px;font-weight:700;color:var(--green)">Valid</span>';
        if(daysUntil!==null&&daysUntil<0){ cls='eng2-cert-expired'; badge='<span style="font-size:10px;font-weight:700;color:var(--red)">Expired</span>'; }
        else if(daysUntil!==null&&daysUntil<30){ cls='eng2-cert-warning'; badge='<span style="font-size:10px;font-weight:700;color:var(--yellow)">Expires in '+daysUntil+'d</span>'; }
        else if(daysUntil!==null){ badge='<span style="font-size:10px;font-weight:700;color:var(--green)">'+daysUntil+' days left</span>'; }
        return`<div class="eng2-cert-card ${cls}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:16px">📜</span>
            <div style="font-size:12px;font-weight:700;color:var(--txt)">${c.certType||c.type||'Certificate'}</div>
            <span style="margin-left:auto">${badge}</span>
          </div>
          <div style="font-size:11px;color:var(--txt2);margin-bottom:4px">${c.address||'—'}</div>
          <div style="font-size:10px;color:var(--txt3)">Issued: ${c.issueDate||'—'} · Expires: ${c.expiryDate||'No expiry'}</div>
          ${c.certNum?`<div style="font-size:10px;color:var(--txt3);margin-top:4px;font-family:var(--fm)">#${c.certNum}</div>`:''}
        </div>`;
      }).join('')}
    </div>`;
    el.dataset.loaded='1'; el.dataset.eng=engName;
  }catch(e){ el.innerHTML='<div style="color:var(--red);padding:20px">Failed to load certificates.</div>'; }
}

/* ── Earnings Tab ── */
export async function _renderEngDeepEarningsTab(engName){
  const el=document.getElementById('eng-deep-tab-earnings');
  if(!el) return;
  if(el.dataset.loaded==='1'&&el.dataset.eng===engName){return;}
  el.innerHTML='<div style="padding:20px;color:var(--txt3);font-size:12px;text-align:center">Loading earnings…</div>';
  try{
    const [allJobs,allInvs,allExps]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('expenses')]);
    const stats=_computeEngStats(engName,allJobs,allInvs,[]);
    const eng=stats.engRec||{};
    const engExps=allExps.filter(e=>e.engineer===engName);

    const todayStr=TODAY();
    const thisMonthStart=todayStr.slice(0,7)+'-01';
    const lastMonthEnd=new Date(new Date(thisMonthStart)-1).toISOString().slice(0,10);
    const lastMonthStart=lastMonthEnd.slice(0,7)+'-01';

    const thisMonthJobs=stats.jobs.filter(j=>j.date>=thisMonthStart&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
    const thisMonthEarnings=thisMonthJobs.reduce((s,j)=>s+Number(j.price||0),0);
    const thisMonthHours=thisMonthJobs.reduce((s,j)=>s+Number(j.hours||0),0);

    const lastMonthJobs=stats.jobs.filter(j=>j.date>=lastMonthStart&&j.date<=lastMonthEnd&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
    const lastMonthEarnings=lastMonthJobs.reduce((s,j)=>s+Number(j.price||0),0);

    // ── Revenue from invoices (lifetime) ──
    const revenue=allJobs.filter(j=>j.engineer===engName).reduce((s,j)=>{
      const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
      return s+(inv?calcInvTotal(inv).grand:Number(j.price||0));
    },0);

    // ── Wages calculation ──
    const hoursPerJob=4; // fallback estimate — used only when a job has no logged hours
    const completedJobs=allJobs.filter(j=>j.engineer===engName&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
    const wages=completedJobs.reduce((s,j)=>{
      if(eng.dayRate) return s+Number(eng.dayRate||0);
      if(eng.hourlyRate||eng.rate) return s+(Number(eng.hourlyRate||eng.rate||0)*(Number(j.hours)||hoursPerJob));
      return s;
    },0);

    // ── Expense deductions by category ──
    const byCat={};
    engExps.forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+Number(e.cost||0); });
    const totalExp=engExps.reduce((s,e)=>s+Number(e.cost||0),0);

    // ── Net profit ──
    const netProfit=revenue-wages-totalExp;
    const netColor=netProfit>=0?'var(--green)':'var(--red)';

    const hourlyRate=eng.hourlyRate||eng.rate||0;
    const labourValue=thisMonthHours*hourlyRate;
    const materialsCost=thisMonthJobs.reduce((s,j)=>s+Number(j.materialsCost||j.expenses||0),0);
    const netPay=thisMonthEarnings-materialsCost;

    const monthDiff=thisMonthEarnings-lastMonthEarnings;
    const diffColor=monthDiff>0?'var(--green)':monthDiff<0?'var(--red)':'var(--txt3)';
    const diffSign=monthDiff>0?'+':'';

    // ── Build expense deduction rows ──
    const catLabels={Materials:'Materials',Van:'Van',Fuel:'Fuel',Tools:'Tools',Subcontractor:'Subcontractor',Other:'Other'};
    const expenseRows=Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>`
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span style="color:var(--txt2)">${catLabels[cat]||cat}</span><span style="font-weight:700;color:var(--red)">-£${amt.toFixed(2)}</span>
      </div>`).join('');

    el.innerHTML=`<div style="max-width:640px;margin:0 auto">
      <!-- Download Payslip button -->
      <div style="text-align:right;margin-bottom:12px">
        <button class="btn btn-acc btn-sm" onclick="downloadEngPayslip('${engName.replace(/'/g,"\\'")}')">📄 Download Payslip</button>
      </div>

      <!-- This Month Header -->
      <div style="background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:20px 24px;margin-bottom:16px;text-align:center">
        <div style="font-size:12px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">This Month Earnings</div>
        <div style="font-size:36px;font-weight:900;color:var(--acc);line-height:1">£${thisMonthEarnings.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div style="font-size:12px;color:${diffColor};margin-top:4px;font-weight:600">${diffSign}£${Math.abs(monthDiff).toLocaleString('en-GB')} vs last month</div>
      </div>

      <!-- Earnings Breakdown -->
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Earnings Breakdown</div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Jobs completed</span><span style="font-weight:700">${thisMonthJobs.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Hours worked</span><span style="font-weight:700">${thisMonthHours.toFixed(1)} hrs</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Hourly rate</span><span style="font-weight:700">£${hourlyRate}/hr</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Day rate</span><span style="font-weight:700">${eng.dayRate?'£'+eng.dayRate:'—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Labour value</span><span style="font-weight:700">£${labourValue.toLocaleString('en-GB')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Materials / expenses</span><span style="font-weight:700;color:var(--red)">-£${materialsCost.toLocaleString('en-GB')}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:14px;font-weight:900;border-top:2px solid var(--border);margin-top:4px">
          <span>Net Pay</span><span style="color:var(--green)">£${netPay.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>

      <!-- NET PROFIT (Feature 1.8) -->
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Net Profit Analysis (Lifetime)</div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Invoice Revenue</span><span style="font-weight:700;color:var(--acc)">£${revenue.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Wages (${completedJobs.length} jobs × rate)</span><span style="font-weight:700;color:var(--red)">-£${wages.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">Expense Deductions</span><span style="font-weight:700;color:var(--red)">-£${totalExp.toFixed(2)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 0;font-size:16px;font-weight:900;border-top:2px solid var(--txt);margin-top:4px">
          <span>NET PROFIT</span><span style="color:${netColor}">£${netProfit.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>

      <!-- EXPENSE DEDUCTIONS BY CATEGORY (Feature 1.7) -->
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Expense Deductions by Category</div>
        ${expenseRows||'<div style="font-size:12px;color:var(--txt3);padding:8px 0">No expenses recorded.</div>'}
        ${expenseRows?`<div style="display:flex;justify-content:space-between;padding:10px 0;font-size:14px;font-weight:900;border-top:2px solid var(--border);margin-top:4px">
          <span>Total Deductions</span><span style="color:var(--red)">£${totalExp.toFixed(2)}</span>
        </div>`:''}
      </div>

      <!-- Monthly Comparison -->
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Monthly Comparison</div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--txt2)">This month</span><span style="font-weight:700">£${thisMonthEarnings.toLocaleString('en-GB')} <span style="color:var(--txt3);font-weight:400">(${thisMonthHours.toFixed(1)} hrs)</span></span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:12px">
          <span style="color:var(--txt2)">Last month</span><span style="font-weight:700">£${lastMonthEarnings.toLocaleString('en-GB')}</span>
        </div>
      </div>
    </div>`;
    el.dataset.loaded='1'; el.dataset.eng=engName;
  }catch(e){ console.error('[EarningsTab]',e); el.innerHTML='<div style="color:var(--red);padding:20px">Failed to load earnings.</div>'; }
}

/* ── Trend Tab (Feature 1.9: Month-on-Month Chart) ── */
export async function _renderEngDeepTrendTab(engName){
  const el=document.getElementById('eng-deep-tab-trend');
  if(!el) return;
  if(el.dataset.loaded==='1'&&el.dataset.eng===engName){return;}
  el.innerHTML='<div style="padding:20px;color:var(--txt3);font-size:12px;text-align:center">Loading trend data…</div>';
  try{
    const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const eng=(S.engineers||[]).find(e=>e.name===engName)||{};

    function _getMonthJobs(engName,allJobs,allInvs,yearMonth){
      const jobs=allJobs.filter(j=>j.engineer===engName&&j.date&&j.date.startsWith(yearMonth)&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED));
      const revenue=jobs.reduce((s,j)=>{
        const inv=allInvs.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
        return s+(inv?calcInvTotal(inv).grand:Number(j.price||0));
      },0);
      const hoursPerJob=4; // fallback estimate — used only when a job has no logged hours
      const wages=jobs.reduce((s,j)=>{
        if(eng.dayRate) return s+Number(eng.dayRate||0);
        if(eng.hourlyRate||eng.rate) return s+(Number(eng.hourlyRate||eng.rate||0)*(Number(j.hours)||hoursPerJob));
        return s;
      },0);
      const net=revenue-wages;
      return{jobs,revenue,wages,net,count:jobs.length};
    }

    const now=new Date();
    const thisMonth=now.toISOString().slice(0,7);
    const lastMonth=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString().slice(0,7);
    const sameMonthLastYear=new Date(now.getFullYear()-1,now.getMonth(),1).toISOString().slice(0,7);

    const m1=_getMonthJobs(engName,allJobs,allInvs,sameMonthLastYear);
    const m2=_getMonthJobs(engName,allJobs,allInvs,lastMonth);
    const m3=_getMonthJobs(engName,allJobs,allInvs,thisMonth);

    const months=[
      {label:sameMonthLastYear,jobs:m1.count,revenue:m1.revenue,wages:m1.wages,net:m1.net},
      {label:lastMonth,jobs:m2.count,revenue:m2.revenue,wages:m2.wages,net:m2.net},
      {label:thisMonth,jobs:m3.count,revenue:m3.revenue,wages:m3.wages,net:m3.net}
    ];

    const maxRev=Math.max(...months.map(m=>m.revenue),1);
    const maxWage=Math.max(...months.map(m=>m.wages),1);
    const maxNet=Math.max(...months.map(m=>Math.abs(m.net)),1);
    const maxVal=Math.max(maxRev,maxWage,maxNet,1);

    const bar=(val,col,max)=>{
      const pct=Math.round(Math.abs(val)/max*80);
      const h=Math.max(pct,4);
      return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;min-width:40px">
        <div style="font-size:10px;font-weight:700;color:${val>=0?'var(--txt)':'var(--red)'}">${val?'£'+(val>=0?'':'-')+Math.abs(val).toLocaleString('en-GB',{maximumFractionDigits:0}):'—'}</div>
        <div style="width:100%;border-radius:5px 5px 0 0;transition:height .5s ease;background:${col};opacity:.85;min-height:4px;height:${h}px"></div>
      </div>`;
    };

    const monthLabel=(ym)=>{
      const [y,m]=ym.split('-');
      return new Date(+y,+m-1,1).toLocaleString('en-GB',{month:'short',year:'2-digit'});
    };

    el.innerHTML=`<div style="max-width:640px;margin:0 auto">
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:20px 24px;margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px">Month-on-Month Comparison</div>
        <div style="display:flex;gap:24px;margin-bottom:8px">
          ${months.map(m=>`<div style="flex:1;text-align:center">
            <div style="font-size:11px;font-weight:800;color:var(--txt);margin-bottom:8px">${monthLabel(m.label)}</div>
            <div style="display:flex;align-items:flex-end;gap:3px;height:140px;padding:0 4px">
              ${bar(m.revenue,'var(--acc)',maxVal)}
              ${bar(m.wages,'var(--red)',maxVal)}
              ${bar(m.net,m.net>=0?'var(--green)':'#e05252',maxVal)}
            </div>
            <div style="display:flex;gap:3px;margin-top:4px;font-size:9px">
              <div style="flex:1;text-align:center;color:var(--acc);font-weight:700">Rev</div>
              <div style="flex:1;text-align:center;color:var(--red);font-weight:700">Wage</div>
              <div style="flex:1;text-align:center;color:var(--green);font-weight:700">Net</div>
            </div>
            <div style="margin-top:8px;font-size:11px;color:var(--txt2);font-weight:600">${m.jobs} jobs</div>
          </div>`).join('')}
        </div>
        <!-- Legend -->
        <div style="display:flex;gap:16px;justify-content:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:10px">
          <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:3px;background:var(--acc)"></div>Revenue</div>
          <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:3px;background:var(--red)"></div>Wages</div>
          <div style="display:flex;align-items:center;gap:4px"><div style="width:10px;height:10px;border-radius:3px;background:var(--green)"></div>Net Profit</div>
        </div>
      </div>

      <!-- Summary table -->
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px 20px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:12px">Summary</div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="border-bottom:2px solid var(--border)">
              <th style="text-align:left;padding:8px;color:var(--txt3);font-size:10px">Period</th>
              <th style="text-align:right;padding:8px;color:var(--txt3);font-size:10px">Jobs</th>
              <th style="text-align:right;padding:8px;color:var(--txt3);font-size:10px">Revenue</th>
              <th style="text-align:right;padding:8px;color:var(--txt3);font-size:10px">Wages</th>
              <th style="text-align:right;padding:8px;color:var(--txt3);font-size:10px">Net Profit</th>
            </tr></thead>
            <tbody>
              ${months.map(m=>`<tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px;font-weight:700">${monthLabel(m.label)}</td>
                <td style="padding:8px;text-align:right">${m.jobs}</td>
                <td style="padding:8px;text-align:right;color:var(--acc);font-weight:700">£${m.revenue.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td style="padding:8px;text-align:right;color:var(--red)">£${m.wages.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td style="padding:8px;text-align:right;font-weight:800;color:${m.net>=0?'var(--green)':'var(--red)'}">£${m.net.toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
    el.dataset.loaded='1'; el.dataset.eng=engName;
  }catch(e){ console.error('[TrendTab]',e); el.innerHTML='<div style="color:var(--red);padding:20px">Failed to load trend data.</div>'; }
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
    const thisMonthStart=now.toISOString().slice(0,7)+'-01';
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

/* ── Edit engineer from deep report ── */
export function _editEngFromDeep(){
  const engName=document.getElementById('eng-deep-overlay')?.dataset.engName;
  if(!engName) return;
  document.getElementById('eng-deep-overlay').classList.remove('open');
  nav('team');
  setTimeout(()=>{
    const cards=document.querySelectorAll('#eng-list .eng-card,#eng-list>[style*="border"]');
    cards.forEach(card=>{
      if(card.textContent.includes(engName)){
        card.scrollIntoView({behavior:'smooth',block:'center'});
        card.style.boxShadow='0 0 0 3px var(--acc)';
        setTimeout(()=>card.style.boxShadow='',2000);
      }
    });
  },300);
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
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=d.toISOString().slice(0,10);
      toDate=new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0).toISOString().slice(0,10);
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
      const d=new Date(new Date(today).getFullYear(),new Date(today).getMonth()-1,1);
      fromDate=d.toISOString().slice(0,10);
      toDate=new Date(new Date(today).getFullYear(),new Date(today).getMonth(),0).toISOString().slice(0,10);
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
