// Engineer Reports deep-report modal — the Earnings and Trend tabs: the
// per-engineer payment breakdown (revenue, wages, expense deductions, net
// profit) and the three-month revenue/wages/net comparison chart. Extracted
// from engineer-reports.js verbatim (Phase 3 of the follow-up modularization
// pass) — no behaviour changes.
//
// This module and main.js (and the other engineer-reports-*.js files)
// import from each other, same as every other extracted module: safe
// because every cross-module reference is used only inside function bodies,
// never at module-evaluation time.

import { STATUS, localDateStr } from '@business';
import { S, dAll, TODAY, calcInvTotal } from './main.js';
import { _computeEngStats } from './engineer-reports-core.js';

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
    const thisMonth=localDateStr(now).slice(0,7);
    // Both of these are local-midnight constructions -- always off by a
    // full month during BST if serialized via toISOString() instead of
    // reading local fields back.
    const lastMonth=localDateStr(new Date(now.getFullYear(),now.getMonth()-1,1)).slice(0,7);
    const sameMonthLastYear=localDateStr(new Date(now.getFullYear()-1,now.getMonth(),1)).slice(0,7);

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
