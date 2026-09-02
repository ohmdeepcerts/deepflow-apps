// Engineer Reports deep-report modal — opens the per-engineer overlay
// (header, quick actions, stats grid, earnings chart), the tab switcher that
// dispatches to all five deep-report tabs, the Jobs and Certificates tabs
// themselves, and the "edit this engineer" jump-back-to-Team action.
// Extracted from engineer-reports.js verbatim (Phase 3 of the follow-up
// modularization pass) — no behaviour changes.
//
// This module and main.js (and the other engineer-reports-*.js files)
// import from each other, same as every other extracted module: safe
// because every cross-module reference is used only inside function bodies,
// never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS, localDateStr } from '@business';
import { dAll, toast, TODAY, nav } from './main.js';
import { _computeEngStats } from './engineer-reports-core.js';
import { _renderEngDeepEarningsTab, _renderEngDeepTrendTab } from './engineer-reports-financials.js';
import { _renderEngDeepActivityTab, downloadEngDeepReportPDF } from './engineer-reports-output.js';

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
      const ym=localDateStr(d).slice(0,7);
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
          <span style="text-align:right;font-weight:700;color:${invTotal?"var(--acc)":"var(--txt3)"}${invTotal?";cursor:pointer;text-decoration:underline;text-decoration-style:dotted":""}" ${invTotal?`onclick="event.stopPropagation();nav('inv');invNavSelect('all');setTimeout(()=>viewInv('${inv.id}'),300)" title="View invoice"`:''}>${invTotal?"£"+invTotal.toFixed(0):"—"}</span>
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
