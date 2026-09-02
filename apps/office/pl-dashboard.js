// P&L Dashboard — company finance overview (Overview / Cash Flow / Top
// Clients / Job Types / VAT / Reminders tabs). Extracted from main.js
// verbatim (Phase 1 of the follow-up modularization pass — see the plan
// file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time. The CSV/Xero/
// QuickBooks export functions and _sendPLReminder live in the sibling
// pl-exports.js — referenced here only via generated onclick="..." strings
// (window-resolved), so no direct import between the two is needed.

import { escHtml } from '@ui';
import { STATUS, localDateStr } from '@business';
import { S, dAll, TODAY, calcInvTotal, getVatRate } from './main.js';

/* ════════════════════════════════════════
   P&L DASHBOARD — Company Finance
   ════════════════════════════════════════ */

function _getPLPeriodDates(period){
  // The boundary math below (new Date(y,m,d)) was always correct in local
  // terms -- the bug was only ever in the final step, serializing that
  // already-correct local Date via toISOString() (UTC) instead of reading
  // its own local fields back via localDateStr(). During BST this silently
  // shifted every period by up to a full month (see 'last_month'/quarters).
  const now = new Date();
  const today = localDateStr(now);
  let start, end;
  switch(period){
    case 'this_month': start=today.slice(0,7)+'-01'; end=today; break;
    case 'last_month': {const d=new Date(now.getFullYear(),now.getMonth()-1,1); start=localDateStr(d).slice(0,7)+'-01'; const e=new Date(now.getFullYear(),now.getMonth(),0); end=localDateStr(e);} break;
    case 'this_quarter': {const q=Math.floor(now.getMonth()/3); start=localDateStr(new Date(now.getFullYear(),q*3,1)); end=today;} break;
    case 'last_quarter': {const q=Math.floor(now.getMonth()/3)-1; const y=q<0?now.getFullYear()-1:now.getFullYear(); const aq=q<0?q+4:q; start=localDateStr(new Date(y,aq*3,1)); end=localDateStr(new Date(y,aq*3+3,0));} break;
    case 'this_year': start=now.getFullYear()+'-01-01'; end=today; break;
    case 'last_year': {const ly=now.getFullYear()-1; start=ly+'-01-01'; end=ly+'-12-31';} break;
    default: start='2020-01-01'; end=today;
  }
  return {start, end};
}

function openPLDashboard(){
  let ov=document.getElementById('pl-overlay');
  if(ov) ov.remove();
  ov=document.createElement('div');
  ov.id='pl-overlay';
  ov.className='pl-overlay';
  ov.innerHTML=`<div class="pl-hd">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn btn-ghost" onclick="closePLDashboard()">&larr; Back</button>
      <h2>&#128202; Company Finance &amp; P&amp;L</h2>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <select id="pl-period" class="sel" onchange="renderPLDashboard()">
        <option value="this_month">This Month</option>
        <option value="last_month">Last Month</option>
        <option value="this_quarter">This Quarter</option>
        <option value="last_quarter">Last Quarter</option>
        <option value="this_year">This Year</option>
        <option value="last_year">Last Year</option>
        <option value="all">All Time</option>
      </select>
      <button class="btn btn-wa" onclick="exportPLCSV()">&#11015; CSV</button>
    </div>
  </div>
  <div class="pl-tabs">
    <div class="pl-tab active" onclick="_switchPLTab(this,'pl-overview')">Overview</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-cashflow')">Cash Flow</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-clients')">Top Clients</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-jobtypes')">Job Types</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-vat')">VAT</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-reminders')">Reminders</div>
  </div>
  <div class="pl-body" id="pl-body">
    <div id="pl-overview" class="pl-tab-section active"></div>
    <div id="pl-cashflow" class="pl-tab-section"></div>
    <div id="pl-clients" class="pl-tab-section"></div>
    <div id="pl-jobtypes" class="pl-tab-section"></div>
    <div id="pl-vat" class="pl-tab-section"></div>
    <div id="pl-reminders" class="pl-tab-section"></div>
  </div>`;
  document.body.appendChild(ov);
  renderPLDashboard();
}
function closePLDashboard(){ const el=document.getElementById('pl-overlay'); if(el) el.remove(); }
function _switchPLTab(tabEl, sectionId){
  document.querySelectorAll('.pl-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.pl-tab-section').forEach(s=>s.classList.remove('active'));
  tabEl.classList.add('active');
  const sec=document.getElementById(sectionId);
  if(sec) sec.classList.add('active');
}

async function renderPLDashboard(){
  const period = document.getElementById('pl-period')?.value || 'this_month';
  const {start, end} = _getPLPeriodDates(period);

  const [jobs, invs, exps, payments] = await Promise.all([
    dAll('jobs'), dAll('invoices'), dAll('expenses'), dAll('payments')
  ]);

  const pJobs = jobs.filter(j => j.date >= start && j.date <= end);
  const pInvs = invs.filter(i => i.date >= start && i.date <= end);
  const pExps = exps.filter(e => e.date >= start && e.date <= end);

  _renderPLOverview(pJobs, pInvs, pExps, payments, start, end);
  _renderPLCashFlow(jobs, invs, exps, payments, start, end);
  _renderPLTopClients(jobs, invs, start, end);
  _renderPLJobTypes(pJobs);
  _renderPLVAT(invs, exps, start, end);
  _renderPLReminders(invs);
}

/* ── Overview: P&L Summary ── */
function _renderPLOverview(pJobs, pInvs, pExps, payments, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Revenue from paid invoices
  const paidInvs = pInvs.filter(i => i.status === 'Paid');
  const paidRev = paidInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);
  const pendInvs = pInvs.filter(i => i.status !== 'Paid');
  const pendRev = pendInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);
  const totalRev = paidRev + pendRev;

  // Expense breakdown by category
  const catMap = {};
  pExps.forEach(e => { const c=e.category||'Other'; catMap[c]=(catMap[c]||0)+(+(e.cost||0)); });
  const totalExp = pExps.reduce((s,e) => s+(+(e.cost||0)), 0);

  // Engineer wages from jobs — use each job's actually-logged hours for
  // hourly-rate engineers; only fall back to an estimate if none was
  // logged. (Previously this added the raw hourly rate once per job with
  // no hours multiplier at all, effectively treating it as a flat rate.)
  const WAGE_FALLBACK_HOURS=4;
  let totalWages = 0;
  pJobs.forEach(j => {
    if(j.engineer && S.engineers){
      const eng = S.engineers.find(e => e.name === j.engineer);
      if(eng && eng.dayRate) totalWages += +eng.dayRate;
      else if(eng && eng.rate) totalWages += +eng.rate * (Number(j.hours)||WAGE_FALLBACK_HOURS);
    }
  });

  const totalCosts = totalWages + totalExp;
  const netProfit = totalRev - totalCosts;

  document.getElementById('pl-overview').innerHTML = `
    <div class="pl-kpi-grid">
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--acc)">${fmt(paidRev)}</div>
        <div class="pl-kpi-lbl">Revenue (Paid)</div>
        <div class="pl-kpi-sub">${paidInvs.length} paid invoices</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--red)">${fmt(totalWages)}</div>
        <div class="pl-kpi-lbl">Engineer Wages</div>
        <div class="pl-kpi-sub">${pJobs.filter(j=>j.engineer).length} assigned jobs</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--orange)">${fmt(totalExp)}</div>
        <div class="pl-kpi-lbl">Expenses</div>
        <div class="pl-kpi-sub">${pExps.length} expense entries</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val ${netProfit>=0?'pl-positive':'pl-negative'}">${fmt(netProfit)}</div>
        <div class="pl-kpi-lbl">Net Profit</div>
        <div class="pl-kpi-sub">${((totalRev>0?(netProfit/totalRev)*100:0)).toFixed(1)}% margin</div>
      </div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128176; Revenue Breakdown</div>
      <div class="pl-row"><span class="pl-row-label">Invoice Revenue (Paid)</span><span class="pl-row-val pl-positive">${fmt(paidRev)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Invoice Revenue (Pending)</span><span class="pl-row-val" style="color:var(--yellow)">${fmt(pendRev)}</span></div>
      <div class="pl-total-row"><span>Total Revenue</span><span>${fmt(totalRev)}</span></div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128178; Cost Breakdown</div>
      <div class="pl-row"><span class="pl-row-label">Engineer Wages</span><span class="pl-row-val pl-negative">${fmt(totalWages)}</span></div>
      ${Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>
        `<div class="pl-row"><span class="pl-row-label">${cat}</span><span class="pl-row-val pl-negative">${fmt(amt)}</span></div>`
      ).join('')}
      <div class="pl-total-row"><span>Total Costs</span><span class="pl-negative">${fmt(totalCosts)}</span></div>
    </div>
    <div class="pl-section" style="text-align:center;padding:28px">
      <div style="font-size:13px;color:var(--txt3);margin-bottom:8px">NET PROFIT</div>
      <div style="font-family:var(--fh);font-size:42px;font-weight:900;${netProfit>=0?'color:#22c55e':'color:var(--red)'}">${fmt(netProfit)}</div>
      <div style="font-size:12px;color:var(--txt2);margin-top:6px">${start} &rarr; ${end}</div>
    </div>`;
}

/* ── Cash Flow Forecast ── */
function _renderPLCashFlow(jobs, invs, exps, payments, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
  const today = TODAY();

  // Incoming: pending invoices + uninvoiced completed jobs
  const pendingInvs = invs.filter(i => i.status !== 'Paid');
  const pendingIncoming = pendingInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);

  const completedJobs = jobs.filter(j => j.status === STATUS.COMPLETED && !j.invoiceId);
  const jobIncoming = completedJobs.reduce((s,j) => s+(+(j.price||0)), 0);

  const totalIncoming = pendingIncoming + jobIncoming;

  // Outgoing: known recurring costs (last 30 days avg, projected forward 30)
  const last30 = new Date(); last30.setDate(last30.getDate()-30);
  const recentExps = exps.filter(e => e.date >= localDateStr(last30));
  const monthlyExpAvg = recentExps.reduce((s,e) => s+(+(e.cost||0)), 0);

  // Wages for jobs in the next 30 days
  const next30 = new Date(); next30.setDate(next30.getDate()+30);
  const next30str = localDateStr(next30);
  const upcomingJobs = jobs.filter(j => j.date >= today && j.date <= next30str);
  let upcomingWages = 0;
  upcomingJobs.forEach(j => {
    if(j.engineer && S.engineers){
      const eng = S.engineers.find(e => e.name === j.engineer);
      if(eng && eng.dayRate) upcomingWages += +eng.dayRate;
      else if(eng && eng.rate) upcomingWages += +eng.rate;
    }
  });

  const totalOutgoing = monthlyExpAvg + upcomingWages;
  const netPosition = totalIncoming - totalOutgoing;

  let riskColor = '#22c55e', riskLabel = 'Healthy';
  if(netPosition < 0) { riskColor = 'var(--red)'; riskLabel = 'At Risk'; }
  else if(netPosition < totalOutgoing * 0.2) { riskColor = 'var(--yellow)'; riskLabel = 'Tight'; }

  document.getElementById('pl-cashflow').innerHTML = `
    <div class="pl-kpi-grid">
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--green)">${fmt(totalIncoming)}</div>
        <div class="pl-kpi-lbl">Expected Incoming</div>
        <div class="pl-kpi-sub">${pendingInvs.length} pending inv + ${completedJobs.length} jobs</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--red)">${fmt(totalOutgoing)}</div>
        <div class="pl-kpi-lbl">Expected Outgoing</div>
        <div class="pl-kpi-sub">Next 30 days projection</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:${riskColor}">${fmt(netPosition)}</div>
        <div class="pl-kpi-lbl">Net Position (30d)</div>
        <div class="pl-kpi-sub">${riskLabel}</div>
      </div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128181; Incoming Cash</div>
      <div class="pl-row"><span class="pl-row-label">Pending Invoices (${pendingInvs.length})</span><span class="pl-row-val pl-positive">${fmt(pendingIncoming)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Completed Jobs Not Invoiced (${completedJobs.length})</span><span class="pl-row-val pl-positive">${fmt(jobIncoming)}</span></div>
      <div class="pl-total-row"><span>Total Incoming</span><span class="pl-positive">${fmt(totalIncoming)}</span></div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128179; Outgoing Cash</div>
      <div class="pl-row"><span class="pl-row-label">Monthly Expenses (30d avg)</span><span class="pl-row-val pl-negative">${fmt(monthlyExpAvg)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Projected Wages (${upcomingJobs.length} jobs)</span><span class="pl-row-val pl-negative">${fmt(upcomingWages)}</span></div>
      <div class="pl-total-row"><span>Total Outgoing</span><span class="pl-negative">${fmt(totalOutgoing)}</span></div>
    </div>`;
}

/* ── Top Clients ── */
function _renderPLTopClients(jobs, invs, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Build client map from invoices in period
  const clientMap = {};
  invs.filter(i => i.date >= start && i.date <= end).forEach(i => {
    const name = i.clientName || i.client || 'Unknown';
    if(!clientMap[name]) clientMap[name] = {name, revenue:0, outstanding:0, jobs:0, invs:0};
    const t = calcInvTotal(i);
    clientMap[name].revenue += t.grand;
    clientMap[name].invs++;
    if(i.status !== 'Paid') clientMap[name].outstanding += t.grand;
  });

  // Also count jobs linked to clients
  jobs.filter(j => j.date >= start && j.date <= end).forEach(j => {
    const name = j.clientName || j.client || j.landlordName || 'Unknown';
    if(!clientMap[name]) clientMap[name] = {name, revenue:0, outstanding:0, jobs:0, invs:0};
    clientMap[name].jobs++;
  });

  const sorted = Object.values(clientMap).sort((a,b) => b.revenue - a.revenue).slice(0, 20);
  const medals = ['&#129351;','&#129352;','&#129353;'];
  const rankColors = ['rgba(240,192,48,.2)', 'rgba(148,163,184,.2)', 'rgba(245,122,35,.15)'];

  document.getElementById('pl-clients').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#127941; Top Clients by Revenue</div>
      ${sorted.length === 0 ? '<div style="text-align:center;color:var(--txt3);padding:30px">No client data for this period</div>' :
        sorted.map((c,idx) => `
        <div class="pl-client-row">
          <div class="pl-client-rank" style="background:${idx<3?rankColors[idx]:'var(--s2)'};color:${idx<3?'var(--txt)':'var(--txt3)'}">${idx<3?medals[idx]:idx+1}</div>
          <div class="pl-client-info">
            <div class="pl-client-name">${escHtml(c.name)}</div>
            <div class="pl-client-meta">${c.jobs} jobs &bull; ${c.invs} invoices</div>
          </div>
          <div class="pl-client-amt" style="color:var(--acc)">${fmt(c.revenue)}</div>
          ${c.outstanding>0?`<div class="pl-client-amt pl-negative">${fmt(c.outstanding)} due</div>`:''}
        </div>
      `).join('')}
    </div>`;
}

/* ── Job Types Breakdown ── */
function _renderPLJobTypes(pJobs){
  const typeMap = {};
  pJobs.forEach(j => {
    const t = j.type || 'Other';
    if(!typeMap[t]) typeMap[t] = {count:0, revenue:0};
    typeMap[t].count++;
    typeMap[t].revenue += +(j.price||0);
  });

  const types = Object.entries(typeMap).sort((a,b) => b[1].count - a[1].count);
  const maxCount = types.length ? types[0][1].count : 1;
  const colors = ['var(--acc)','var(--green)','var(--blue)','var(--purple)','var(--orange)','var(--red)','var(--txt3)'];
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  document.getElementById('pl-jobtypes').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#128295; Job Type Breakdown</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">
        ${types.map(([t,d],i) => `
          <div class="pl-kpi" style="text-align:center">
            <div class="pl-kpi-val" style="color:${colors[i%colors.length]}">${d.count}</div>
            <div class="pl-kpi-lbl">${escHtml(t)}</div>
            <div class="pl-kpi-sub">${fmt(d.revenue)} revenue</div>
          </div>
        `).join('')}
        ${types.length===0?'<div style="text-align:center;color:var(--txt3);padding:20px;grid-column:1/-1">No job data for this period</div>':''}
      </div>
      <div style="margin-top:8px">
        ${types.map(([t,d],i) => {
          const pct = (d.count/maxCount*100).toFixed(0);
          return `<div class="pl-chart-row">
            <span class="pl-chart-label">${escHtml(t)}</span>
            <div style="flex:1;background:var(--border);border-radius:6px;overflow:hidden;height:18px">
              <div class="pl-chart-bar" style="width:${pct}%;background:${colors[i%colors.length]}"></div>
            </div>
            <span class="pl-chart-val">${d.count}</span>
            <span class="pl-chart-val" style="color:${colors[i%colors.length]}">${fmt(d.revenue)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── VAT Quarterly Summary ── */
function _renderPLVAT(invs, exps, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
  const vr = getVatRate();

  // Group invoices by quarter
  const qMap = {};
  invs.forEach(i => {
    if(!i.date) return;
    const d = new Date(i.date);
    const q = Math.floor(d.getMonth()/3)+1;
    const key = `Q${q} ${d.getFullYear()}`;
    if(!qMap[key]) qMap[key] = {label:key,collected:0,paid:0,count:0};
    const t = calcInvTotal(i);
    qMap[key].collected += t.vat;
    qMap[key].count++;
  });

  // Input VAT (estimate): there's no per-expense VAT field recorded, so
  // this assumes expense costs are VAT-inclusive at the standard rate and
  // back-calculates the VAT portion — necessarily an estimate (the UI
  // already labels this line "Input est."), not a figure from real
  // supplier invoices. Previously this was always exactly £0 because
  // nothing populated it at all, despite "Net VAT Due" implying it had
  // been accounted for.
  (exps||[]).forEach(e => {
    if(!e.date || vr<=0) return;
    const d = new Date(e.date);
    const q = Math.floor(d.getMonth()/3)+1;
    const key = `Q${q} ${d.getFullYear()}`;
    if(!qMap[key]) qMap[key] = {label:key,collected:0,paid:0,count:0};
    qMap[key].paid += Number(e.cost||0)*vr/(100+vr);
  });

  // Sort quarters reverse chronologically
  const quarters = Object.values(qMap).sort((a,b) => {
    const parse = s => { const m=s.match(/Q(\d) (\d{4})/); return m?[parseInt(m[2]),parseInt(m[1])]:[0,0]; };
    const [y1,q1] = parse(a.label); const [y2,q2] = parse(b.label);
    return y2-y1 || q2-q1;
  });

  document.getElementById('pl-vat').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#128179; VAT Summary</div>
      ${quarters.length===0?'<div style="text-align:center;color:var(--txt3);padding:30px">No invoice data available</div>':''}
      ${quarters.map(q => `
        <div class="pl-vat-q">
          <div class="pl-vat-q-hd">${q.label} <span style="font-size:11px;color:var(--txt3);font-weight:500">(${q.count} invoices)</span></div>
          <div class="pl-row"><span class="pl-row-label">VAT Collected (Output)</span><span class="pl-row-val" style="color:var(--green)">${fmt(q.collected)}</span></div>
          <div class="pl-row"><span class="pl-row-label">VAT Paid (Input est.)</span><span class="pl-row-val pl-negative">${fmt(q.paid)}</span></div>
          <div class="pl-total-row"><span>Net VAT Due</span><span style="color:${q.collected-q.paid>=0?'var(--acc)':'var(--red)'}">${fmt(q.collected-q.paid)}</span></div>
        </div>
      `).join('')}
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128227; VAT Filing Reminders</div>
      <div style="font-size:12px;color:var(--txt2);line-height:1.8">
        <p>VAT returns are due <strong>1 month and 7 days</strong> after the quarter end.</p>
        <p style="margin-top:6px"><strong>Current quarter:</strong> ${(()=>{const n=new Date();const q=Math.floor(n.getMonth()/3)+1;return `Q${q} ${n.getFullYear()}`;})()}</p>
        <p><strong>Next filing deadline:</strong> ${(()=>{const n=new Date();const q=Math.floor(n.getMonth()/3);const end=new Date(n.getFullYear(),(q+1)*3,0);const dl=new Date(end);dl.setDate(dl.getDate()+37);return dl.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});})()}</p>
      </div>
    </div>`;
}

/* ── Overdue Reminders ── */
function _renderPLReminders(invs){
  const today = new Date(TODAY());
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Find overdue invoices (status not Paid, past a reasonable due date)
  const overdue = invs.filter(i => {
    if(i.status === 'Paid' || i.status === 'Draft') return false;
    const invDate = new Date(i.date||i.created_at||TODAY());
    const daysOld = Math.floor((today - invDate)/(864e5));
    return daysOld > 7; // Overdue if older than 7 days
  }).map(i => {
    const invDate = new Date(i.date||i.created_at||TODAY());
    const daysOld = Math.floor((today - invDate)/(864e5));
    const t = calcInvTotal(i);
    let statusColor = '#f59e0b'; // amber day 7
    if(daysOld >= 30) statusColor = '#dc2626'; // red day 30
    else if(daysOld >= 14) statusColor = '#f97316'; // orange day 14
    return {...i, daysOld, total: t.grand, statusColor};
  }).sort((a,b) => b.daysOld - a.daysOld);

  const autoReminders = JSON.parse(localStorage.getItem('pl_auto_reminders')||'false');

  document.getElementById('pl-reminders').innerHTML = `
    <div class="pl-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="pl-section-hd" style="margin:0">&#9200; Overdue Invoice Reminders</div>
        <label class="fcheck" style="margin:0;font-size:12px">
          <input type="checkbox" ${autoReminders?'checked':''} onchange="localStorage.setItem('pl_auto_reminders',this.checked);toast('Auto-reminders '+(this.checked?'enabled':'disabled'),'info')">
          Auto-remind at Day 7, 14, 30
        </label>
      </div>
      ${overdue.length===0?'<div style="text-align:center;color:var(--txt3);padding:30px">No overdue invoices &mdash; great job!</div>'
        :`<div style="font-size:11px;color:var(--txt3);margin-bottom:10px">${overdue.length} overdue invoice(s) found</div>`
      }
      ${overdue.map(inv => `
        <div class="pl-reminder-row">
          <div class="pl-reminder-status" style="background:${inv.statusColor}"></div>
          <div class="pl-reminder-info">
            <div style="font-weight:700;font-size:13px">${escHtml(inv.invoiceNumber||inv.number||'INV-?')}</div>
            <div style="font-size:11px;color:var(--txt2)">${escHtml(inv.clientName||inv.client||'Unknown')} &bull; ${fmt(inv.total)}</div>
            <div style="font-size:10px;color:var(--txt3)">${inv.date||'No date'} &bull; <span style="color:${inv.statusColor};font-weight:700">${inv.daysOld} days overdue</span></div>
          </div>
          <div class="pl-reminder-action">
            <button class="btn btn-wa btn-sm" onclick="_sendPLReminder('${(inv.invoiceNumber||inv.number||'').replace(/'/g,"\\'")}','${(inv.clientName||inv.client||'').replace(/'/g,"\\'")}',${inv.total},${inv.daysOld})">&#128172; Send</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

export {
  _getPLPeriodDates, openPLDashboard, closePLDashboard, _switchPLTab, renderPLDashboard,
  _renderPLOverview, _renderPLCashFlow, _renderPLTopClients, _renderPLJobTypes, _renderPLVAT, _renderPLReminders,
};
