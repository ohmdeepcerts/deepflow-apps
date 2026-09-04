// Certificates stats + dashboard — the Statistics tab (KPIs, workload
// forecast, donut, type breakdown, top landlords/agents, at-risk table) and
// the Dashboard tab (KPI cards, renewal chase windows, 12-month timeline,
// expired/expiring/missing panels, by-type breakdown, per-property status
// grid). Extracted from certs.js verbatim — two non-adjacent ranges pulled
// into one file since neither calls into, nor is called by, anything in
// between them (Phase 2 of the follow-up modularization pass — see the
// plan file for scope) — no behaviour changes.
//
// This module and main.js (and the other certs-* files) import from each
// other, same as every other extracted module: safe because every cross-
// module reference is used only inside function bodies, never at module-
// evaluation time.

import { STATUS, daysDiff, localDateStr } from '@business';
import { S, dAll } from './main.js';
import { switchCertTab, filterCerts, goExpiryWindow } from './certs-list.js';
import { createRenewalJob } from './certs-appliances.js';
import { addExpiryToExistingCert } from './certs-pdf.js';

// ════════════════════════════════════════════════════════════════
//  STATISTICS  (📈 Statistics tab)
// ════════════════════════════════════════════════════════════════
export async function renderCertStats(){
  const all=await dAll('certs');
  const now=new Date();

  const total=all.length;
  const expired=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
  const expiring=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60);
  const active=all.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);
  const noDate=all.filter(c=>!c.expiryDate);
  const compPct=total?Math.round((active.length/total)*100):0;

  // KPI
  const kpiEl=document.getElementById('cst-kpis'); if(!kpiEl)return;
  const d30=new Date();d30.setDate(d30.getDate()+30);
  const d12m=new Date();d12m.setFullYear(d12m.getFullYear()+1);
  const wl30=all.filter(c=>{if(!c.expiryDate)return false;const d=new Date(c.expiryDate);return d>=now&&d<=d30;}).length;
  const wl12m=all.filter(c=>{if(!c.expiryDate)return false;const d=new Date(c.expiryDate);return d>=now&&d<=d12m;}).length;
  kpiEl.innerHTML=`
    <div class="pkpi" style="--pk:var(--acc)" onclick="switchCertTab('list')">
      <div class="pkpi-blob"></div><div class="pkpi-deco">📁</div>
      <div class="pkpi-ic">🗂️</div>
      <div class="pkpi-val">${total}</div>
      <div class="pkpi-lbl">Total Portfolio</div>
      <div class="pkpi-sub">All certificates</div>
    </div>
    <div class="pkpi" style="--pk:var(--green)" onclick="filterCerts('active')">
      <div class="pkpi-blob"></div><div class="pkpi-deco">🛡️</div>
      <div class="pkpi-ic">📈</div>
      <div class="pkpi-val" style="color:var(--green)">${compPct}%</div>
      <div class="pkpi-lbl">Compliance Score</div>
      <div class="pkpi-sub">${active.length} active certs</div>
    </div>
    <div class="pkpi" style="--pk:var(--red)" onclick="switchCertTab('expiring')">
      <div class="pkpi-blob"></div><div class="pkpi-deco">🚨</div>
      <div class="pkpi-ic">❌</div>
      <div class="pkpi-val" style="color:var(--red)">${expired.length}</div>
      <div class="pkpi-lbl">Critical — Expired</div>
      <div class="pkpi-sub">Requires action</div>
    </div>
    <div class="pkpi" style="--pk:var(--blue)" onclick="switchCertTab('expiring')">
      <div class="pkpi-blob"></div><div class="pkpi-deco">📆</div>
      <div class="pkpi-ic">🔮</div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-top:1px">
        <span class="pkpi-val" style="font-size:22px;color:var(--acc)">${wl30}</span>
        <span style="font-size:10px;color:var(--txt3)">30d</span>
        <span class="pkpi-val" style="font-size:22px;color:var(--blue)">${wl12m}</span>
        <span style="font-size:10px;color:var(--txt3)">12m</span>
      </div>
      <div class="pkpi-lbl">Workload Forecast</div>
    </div>`;

  // ── Workload Forecast bars (SVG-free, pure CSS) ──
  const period=document.getElementById('cst-period')?.value||'12m';
  let monthsToScan=12,startM=now.getMonth(),startY=now.getFullYear();
  if(period==='6m')monthsToScan=6;
  if(period==='thisYear'){monthsToScan=12;startM=0;}
  if(period==='nextYear'){monthsToScan=12;startM=0;startY=now.getFullYear()+1;}
  const mData=Array.from({length:monthsToScan},(_,i)=>{
    // new Date(y,m,1) is a local-midnight construction -- toISOString() is
    // UTC, so during BST this used to shift every forecast month back by
    // one (e.g. July's bar labeled/keyed as June), all day, every day.
    const d=new Date(startY,startM+i,1);
    const key=localDateStr(d).slice(0,7);
    return{key,label:d.toLocaleDateString('en-GB',{month:'short',year:period.includes('Year')?undefined:'2-digit'}),
      count:all.filter(c=>c.expiryDate&&c.expiryDate.startsWith(key)).length};
  });
  const maxM=Math.max(...mData.map(m=>m.count),1);
  const fcEl=document.getElementById('cst-forecast');
  const fcLblEl=document.getElementById('cst-forecast-lbl');
  if(fcEl&&fcLblEl){
    fcEl.innerHTML=mData.map(m=>{
      const h=Math.max(4,Math.round(m.count/maxM*96));
      const isNow=m.key===localDateStr(now).slice(0,7);
      return`<div class="cst-bar-wrap"><div class="cst-bar-seg" style="height:${h}px;background:${isNow?'var(--acc)':'rgba(245,166,35,.35)'}" title="${m.label}: ${m.count} expiries" onclick="filterCerts('expiring')"></div></div>`;
    }).join('');
    fcLblEl.innerHTML=mData.map(m=>`<div class="cst-bar-lbl" style="flex:1;text-align:center">${m.label}</div>`).join('');
  }

  // ── Donut (SVG) ──
  const donut=document.getElementById('cst-donut');
  const lgd=document.getElementById('cst-donut-lgd');
  if(donut&&total>0){
    const segs=[
      {val:active.length,col:'var(--green)',lbl:'Active'},
      {val:expiring.length,col:'var(--yellow)',lbl:'Expiring'},
      {val:expired.length,col:'var(--red)',lbl:'Expired'},
      {val:noDate.length,col:'#8a9bc0',lbl:'No Date'},
    ];
    let angle=-90,cx=60,cy=60,r=46,inner=30;
    const toRad=d=>d*Math.PI/180;
    const segments=segs.map(s=>({...s,pct:s.val/total*360}));
    let paths='';
    segments.forEach(s=>{
      if(!s.val)return;
      const a1=toRad(angle),a2=toRad(angle+s.pct);
      const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
      const x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
      const ix1=cx+inner*Math.cos(a1),iy1=cy+inner*Math.sin(a1);
      const ix2=cx+inner*Math.cos(a2),iy2=cy+inner*Math.sin(a2);
      const lg=s.pct>180?1:0;
      paths+=`<path d="M${ix1},${iy1} A${inner},${inner} 0 ${lg},1 ${ix2},${iy2} L${x2},${y2} A${r},${r} 0 ${lg},0 ${x1},${y1} Z" fill="${s.col}" opacity=".9" style="cursor:pointer" title="${s.lbl}: ${s.val}"/>`;
      angle+=s.pct;
    });
    donut.innerHTML=`${paths}<text x="60" y="56" text-anchor="middle" style="font-family:var(--fh);font-size:16px;font-weight:800;fill:var(--txt1)">${total}</text><text x="60" y="70" text-anchor="middle" style="font-size:9px;fill:var(--txt3)">total</text>`;
    if(lgd) lgd.innerHTML=segs.filter(s=>s.val).map(s=>`<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${s.col};flex-shrink:0"></span>${s.lbl}: <strong>${s.val}</strong></div>`).join('');
  }

  // ── Type stacked bars ──
  const types=(S.certTypes||[]).map(t=>t.name);
  const typeEl=document.getElementById('cst-type-stack');
  if(typeEl){
    const typeData=types.map(t=>{
      const tc=all.filter(c=>c.type===t);
      const tAct=tc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>0).length;
      const tExp=tc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<=0).length;
      return{t,total:tc.length,act:tAct,exp:tExp};
    }).filter(t=>t.total>0);
    const maxT=Math.max(...typeData.map(t=>t.total),1);
    typeEl.innerHTML=typeData.map(t=>{
      const ct=(S.certTypes||[]).find(c=>c.name===t.t)||{color:'var(--acc)'};
      return`<div class="cst-rank-row">
        <div style="width:120px;font-size:12px;font-weight:600;color:var(--txt1);display:flex;align-items:center;gap:5px;flex-shrink:0"><span style="width:8px;height:8px;border-radius:50%;background:${ct.color}"></span>${t.t}</div>
        <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden;display:flex">
          <div style="width:${Math.round(t.act/maxT*100)}%;background:var(--green)"></div>
          <div style="width:${Math.round(t.exp/maxT*100)}%;background:var(--red)"></div>
        </div>
        <div style="font-size:11px;color:var(--txt3);width:30px;text-align:right;flex-shrink:0">${t.total}</div>
      </div>`;
    }).join('');
  }

  // ── Top Landlords ──
  const renderRanking=(data,targetId)=>{
    const map={}; data.forEach(c=>{const k=c.landlord;if(k)map[k]=(map[k]||0)+1;});
    const top=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const el=document.getElementById(targetId); if(!el)return;
    if(!top.length){el.innerHTML='<div style="color:var(--txt3);font-size:12px;padding:10px 0">No data yet</div>';return;}
    el.innerHTML=top.map(([name,count],i)=>`<div class="cst-rank-row">
      <div class="cst-rank-n ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
        <div style="height:3px;background:var(--border);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.round(count/top[0][1]*100)}%;background:var(--acc)"></div></div>
      </div>
      <div style="font-weight:700;font-size:12px;color:var(--txt2);flex-shrink:0">${count}</div>
    </div>`).join('');
  };
  renderRanking(all,'cst-landlords');

  // Top Agents
  const agMap={}; all.forEach(c=>{if(c.agent)agMap[c.agent]=(agMap[c.agent]||0)+1;});
  const topAg=Object.entries(agMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const agEl=document.getElementById('cst-agents'); if(agEl){
    agEl.innerHTML=topAg.length?topAg.map(([name,count],i)=>`<div class="cst-rank-row">
      <div class="cst-rank-n ${i===0?'r1':i===1?'r2':i===2?'r3':''}">${i+1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
        <div style="height:3px;background:var(--border);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${Math.round(count/topAg[0][1]*100)}%;background:var(--blue)"></div></div>
      </div>
      <div style="font-weight:700;font-size:12px;color:var(--txt2);flex-shrink:0">${count}</div>
    </div>`).join(''):'<div style="color:var(--txt3);font-size:12px;padding:10px 0">No agents recorded</div>';
  }

  // ── At Risk ──
  const riskMap={}; expired.forEach(c=>{const n=c.landlord||c.agent||'Unknown';riskMap[n]=(riskMap[n]||0)+1;});
  const riskList=Object.entries(riskMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const riskEl=document.getElementById('cst-risk'); if(riskEl){
    riskEl.innerHTML=riskList.length?riskList.map(([name,count])=>`<tr style="cursor:pointer" onclick="filterCerts('expired')">
      <td style="padding:7px 4px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;color:var(--txt1)">${name}</td>
      <td style="padding:7px 4px;border-bottom:1px solid var(--border);text-align:right"><span style="background:rgba(224,82,82,.12);color:var(--red);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${count} exp.</span></td>
    </tr>`).join(''):'<tr><td colspan="2" style="padding:14px;text-align:center;color:var(--txt3);font-size:12px">✅ No expired certificates</td></tr>';
  }
}

export async function renderCertDash(){
  const allCerts=await dAll('certs');
  // Real properties table now (Records/CRM rearchitecture Phase 1) — was
  // S.properties, the manual-overrides-only settings blob, which never
  // included the vast majority of properties (those only ever derived
  // from job addresses, never manually edited).
  const allProps=await dAll('properties');
  const now=new Date();

  const expired=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
  const _cw1=S.certWarnDays||30;const _cw2=(S.certWarnDays2||14)+_cw1;
  const expiring30=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=_cw1);
  const expiring60=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>_cw1&&daysDiff(c.expiryDate)<=_cw2);
  // Excludes certs explicitly flagged noExpiry (permanent by design, e.g. some
  // EPC/Part-P records) — those aren't "missing" anything, they're done. Same
  // definition the Missing Details tab uses, so the two stay in sync instead
  // of disagreeing on the count when this KPI links straight there.
  const noExpiry=allCerts.filter(c=>!c.expiryDate&&!c.noExpiry);
  const valid=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);

  // ── KPI cards ──
  const kpiData=[
    {val:allCerts.length,lbl:'Total Certs',sub:'across all properties',pk:'var(--acc)',ic:'🗂️',deco:'📁',go:()=>switchCertTab('list')},
    {val:valid.length,lbl:'Valid',sub:'expiry > 60 days',pk:'var(--green)',ic:'✅',deco:'🛡️',go:()=>filterCerts('ok')},
    {val:expiring30.length+expiring60.length,lbl:'Expiring Soon',sub:'within 60 days',pk:'var(--yellow)',ic:'⏰',deco:'⏳',go:()=>switchCertTab('expiring')},
    {val:expired.length,lbl:'Expired',sub:'action required',pk:'var(--red)',ic:'❌',deco:'🚨',go:()=>switchCertTab('expiring')},
    {val:noExpiry.length,lbl:'Missing Dates',sub:'to fill in',pk:'#8a9bc0',ic:'📋',deco:'🗓️',go:()=>switchCertTab('missing')},
  ];
  window._certKpiGo=kpiData.map(k=>k.go); // onclick can't hold closures directly — indexed lookup instead
  document.getElementById('cd-kpis').innerHTML=kpiData.map((k,i)=>`
    <div class="pkpi" style="--pk:${k.pk}" onclick="_certKpiGo[${i}]()">
      <div class="pkpi-blob"></div><div class="pkpi-deco">${k.deco}</div>
      <div class="pkpi-ic">${k.ic}</div>
      <div class="pkpi-val">${k.val}</div>
      <div class="pkpi-lbl">${k.lbl}</div>
      <div class="pkpi-sub">${k.sub}</div>
    </div>`).join('');

  // ── Renewal chase windows — same certs deliberately counted in more than
  // one bucket (cumulative "due within N days", not exclusive bands) since
  // office staff ask "anything due this week?" and "anything due this
  // month?" as separate questions, not a partition of the same list. ──
  const windowDefs=[
    {days:7,lbl:'Within 7 Days',pk:'var(--red)',ic:'🔥'},
    {days:30,lbl:'Within 30 Days',pk:'var(--yellow)',ic:'⏰'},
    {days:60,lbl:'Within 60 Days',pk:'#f0a030',ic:'📆'},
    {days:90,lbl:'Within 90 Days',pk:'var(--blue)',ic:'🗓️'},
  ];
  window._certWindowGo=windowDefs.map(w=>w.days);
  document.getElementById('cd-windows').innerHTML=windowDefs.map((w,i)=>{
    const cnt=allCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=w.days).length;
    return`<div class="pkpi" style="--pk:${w.pk}" onclick="goExpiryWindow(_certWindowGo[${i}])">
      <div class="pkpi-blob"></div><div class="pkpi-deco">${w.ic}</div>
      <div class="pkpi-ic">${w.ic}</div>
      <div class="pkpi-val">${cnt}</div>
      <div class="pkpi-lbl">${w.lbl}</div>
      <div class="pkpi-sub">due for renewal</div>
    </div>`;
  }).join('');

  // ── Timeline: next 12 months ──
  const months=Array.from({length:12},(_,i)=>{
    const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+i);
    return{
      key:localDateStr(d).slice(0,7),
      label:d.toLocaleDateString('en-GB',{month:'short'}),
      year:d.getFullYear(),
      month:d.getMonth(),
    };
  });
  const monthCounts=months.map(m=>({
    ...m,
    expired:allCerts.filter(c=>c.expiryDate&&c.expiryDate.startsWith(m.key)&&daysDiff(c.expiryDate)<0).length,
    expiring:allCerts.filter(c=>c.expiryDate&&c.expiryDate.startsWith(m.key)&&daysDiff(c.expiryDate)>=0).length,
  }));
  const maxBar=Math.max(...monthCounts.map(m=>m.expired+m.expiring),1);
  const tl=document.getElementById('cd-timeline');
  const tll=document.getElementById('cd-timeline-labels');
  tl.innerHTML=monthCounts.map(m=>{
    const total=m.expired+m.expiring;
    const expH=total?Math.max(4,(m.expired/maxBar)*60):0;
    const expgH=total?Math.max(4,(m.expiring/maxBar)*60):0;
    const isNow=m.key===localDateStr(new Date()).slice(0,7);
    return`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;position:relative" title="${m.label}: ${m.expired} expired, ${m.expiring} expiring" onclick="filterCerts('expiring')">
      ${m.expired?`<div style="width:100%;height:${expH}px;background:var(--red);border-radius:3px 3px 0 0;opacity:.85"></div>`:''}
      ${m.expiring?`<div style="width:100%;height:${expgH}px;background:var(--yellow);border-radius:${m.expired?'0':'3px 3px'} 0 0;opacity:.85"></div>`:''}
      ${!total?`<div style="width:100%;height:4px;background:var(--border);border-radius:3px"></div>`:''}
      ${isNow?`<div style="width:2px;height:100%;background:var(--acc);position:absolute;top:0;left:50%;transform:translateX(-50%);pointer-events:none;opacity:.5;border-radius:1px"></div>`:''}
    </div>`;
  }).join('');
  tll.innerHTML=monthCounts.map(m=>`<div style="flex:1;text-align:center;font-size:9px;color:var(--txt3)">${m.label}</div>`).join('');

  // ── Expired panel ──
  const expEl=document.getElementById('cd-expired');
  if(expired.length){
    expEl.innerHTML=expired.slice(0,8).map(c=>{
      const d=Math.abs(daysDiff(c.expiryDate));
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'var(--red)'};
      return`<div class="cdash-row" onclick="switchCertTab('list')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||'var(--red)'};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type}${c.certNum?' · #'+c.certNum:''} · 👤 ${c.landlord||'—'}</div>
        </div>
        <div class="cdash-row-right">
          <div style="font-size:12px;font-weight:700;color:var(--red)">${d}d ago</div>
          <div style="font-size:10px;color:var(--txt3)">${c.expiryDate}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="createRenewalJob('${c.id}');event.stopPropagation()" style="font-size:10px;white-space:nowrap">Renew</button>
      </div>`;
    }).join('')+(expired.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="filterCerts('expired')">+${expired.length-8} more →</div>`:'');
  } else {
    expEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">No expired certificates</div></div>';
  }

  // ── Expiring panel ──
  const expiringAll=[...expiring30,...expiring60].sort((a,b)=>daysDiff(a.expiryDate)-daysDiff(b.expiryDate));
  const expgEl=document.getElementById('cd-expiring');
  if(expiringAll.length){
    expgEl.innerHTML=expiringAll.slice(0,8).map(c=>{
      const d=daysDiff(c.expiryDate);
      const col=d<=14?'var(--red)':d<=30?'var(--yellow)':'#f0a030';
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:col};
      return`<div class="cdash-row" onclick="switchCertTab('list')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||col};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type}${c.certNum?' · #'+c.certNum:''} · 👤 ${c.landlord||'—'}</div>
        </div>
        <div class="cdash-row-right">
          <div style="font-size:12px;font-weight:700;color:${col}">${d}d left</div>
          <div style="font-size:10px;color:var(--txt3)">${c.expiryDate}</div>
        </div>
        <button class="btn btn-acc btn-xs" onclick="createRenewalJob('${c.id}');event.stopPropagation()" style="font-size:10px;white-space:nowrap">Renew</button>
      </div>`;
    }).join('')+(expiringAll.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="filterCerts('expiring')">+${expiringAll.length-8} more →</div>`:'');
  } else {
    expgEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">Nothing expiring in 60 days</div></div>';
  }

  // ── Missing expiry panel ──
  const misEl=document.getElementById('cd-missing');
  if(noExpiry.length){
    misEl.innerHTML=noExpiry.slice(0,8).map(c=>{
      const ct=(S.certTypes||[]).find(t=>t.name===c.type)||{color:'#8a9bc0'};
      return`<div class="cdash-row" onclick="addExpiryToExistingCert('${c.id}')">
        <div style="width:8px;height:8px;border-radius:50%;background:${ct.color||'#8a9bc0'};flex-shrink:0"></div>
        <div class="cdash-row-main">
          <div class="cdash-row-addr">${c.address}</div>
          <div class="cdash-row-meta">${c.type} · 👤 ${c.landlord||'—'}${c.jobNum?' · Job: '+c.jobNum:''}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="addExpiryToExistingCert('${c.id}');event.stopPropagation()" style="color:var(--yellow);border-color:var(--yellow);font-size:10px;white-space:nowrap">+ Add Date</button>
      </div>`;
    }).join('')+(noExpiry.length>8?`<div style="padding:10px 16px;font-size:12px;color:var(--acc);cursor:pointer" onclick="switchCertTab('missing')">+${noExpiry.length-8} more →</div>`:'');
  } else {
    misEl.innerHTML='<div style="text-align:center;padding:28px 16px"><div style="font-size:28px">✅</div><div style="font-size:12px;color:var(--txt3);margin-top:6px">All certs have expiry dates</div></div>';
  }

  // ── By cert type breakdown ──
  const typeEl=document.getElementById('cd-by-type');
  const certTypes=S.certTypes||[];
  const typeData=certTypes.map(ct=>{
    const typeCerts=allCerts.filter(c=>c.type===ct.name);
    const typeExp=typeCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0).length;
    const typeExpg=typeCerts.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60).length;
    const typeMiss=typeCerts.filter(c=>!c.expiryDate).length;
    return{ct,total:typeCerts.length,expired:typeExp,expiring:typeExpg,missing:typeMiss};
  }).filter(t=>t.total>0);

  const maxType=Math.max(...typeData.map(t=>t.total),1);
  typeEl.innerHTML=typeData.length?`<div class="cdash-type-bar">`+typeData.map(t=>{
    const barW=Math.round(t.total/maxType*100);
    const expPct=t.total?Math.round(t.expired/t.total*100):0;
    const expgPct=t.total?Math.round(t.expiring/t.total*100):0;
    const missPct=t.total?Math.round(t.missing/t.total*100):0;
    const validPct=100-expPct-expgPct-missPct;
    return`<div class="cdash-type-row" onclick="switchCertTab('list');setTimeout(()=>{const s=document.getElementById('ct-type');if(s){s.value='${t.ct.name}';renderCertTable();}},60)" style="cursor:pointer">
      <div class="cdash-type-name">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${t.ct.color||'var(--acc)'};margin-right:5px"></span>
        ${t.ct.name}
      </div>
      <div class="cdash-type-track" title="${t.total} certs: ${t.expired} expired, ${t.expiring} expiring, ${t.missing} missing">
        <div style="display:flex;height:100%;width:100%">
          ${expPct?`<div style="width:${expPct}%;background:var(--red)"></div>`:''}
          ${expgPct?`<div style="width:${expgPct}%;background:var(--yellow)"></div>`:''}
          ${missPct?`<div style="width:${missPct}%;background:#8a9bc0"></div>`:''}
          ${validPct>0?`<div style="width:${validPct}%;background:var(--green)"></div>`:''}
        </div>
      </div>
      <div class="cdash-type-count">${t.total}</div>
    </div>`;
  }).join('')+'</div>'
  :'<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">No cert types configured yet</div>';

  // ── Properties cert status grid ──
  const propGrid=document.getElementById('cd-prop-grid');
  if(allProps.length){
    const allJobsDb=await dAll('jobs');
    propGrid.innerHTML=allProps.map(p=>{
      const key=(p.address||'').toLowerCase().slice(0,20);
      const pc=allCerts.filter(c=>c.address&&c.address.toLowerCase().includes(key));
      const pExp=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)<0);
      const pExpg=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0&&daysDiff(c.expiryDate)<=60);
      const pMiss=pc.filter(c=>!c.expiryDate);
      const pValid=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>60);
      const statusCol=pExp.length?'var(--red)':pExpg.length?'var(--yellow)':pMiss.length?'#8a9bc0':pc.length?'var(--green)':'var(--txt3)';
      const statusIco=pExp.length?'❌':pExpg.length?'⚠️':pMiss.length?'📋':pc.length?'✅':'—';
      const openJobs=(allJobsDb||[]).filter(j=>j.address&&j.address.toLowerCase().includes(key)&&(j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS));
      // Next expiry
      const nextExp=pc.filter(c=>c.expiryDate&&daysDiff(c.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate))[0];
      return`<div onclick="nav('props')" style="background:var(--s1);border:1px solid ${statusCol==='var(--txt3)'?'var(--border)':statusCol+'55'};border-left:3px solid ${statusCol};border-radius:var(--r2);padding:10px 12px;cursor:pointer;transition:all .15s" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s1)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px">
          <div style="font-size:12px;font-weight:700;color:var(--txt1);line-height:1.3">${p.address||'—'}</div>
          <span style="font-size:14px;flex-shrink:0">${statusIco}</span>
        </div>
        <div style="font-size:11px;color:var(--txt2);margin-bottom:6px">👤 ${p.landlord_name||'No landlord'}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${pc.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(37,213,142,.12);color:var(--green)">◈ ${pc.length} cert${pc.length===1?'':'s'}</span>`:'<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:var(--s2);color:var(--txt3)">No certs</span>'}
          ${pExp.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(224,82,82,.12);color:var(--red)">❌ ${pExp.length} expired</span>`:''}
          ${pExpg.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(240,192,48,.12);color:var(--yellow)">⚠️ ${pExpg.length} expiring</span>`:''}
          ${pMiss.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(138,155,192,.12);color:#8a9bc0">📋 ${pMiss.length} missing</span>`:''}
          ${openJobs.length?`<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(91,142,240,.12);color:var(--blue)">⊞ ${openJobs.length} open job${openJobs.length===1?'':'s'}</span>`:''}
        </div>
        ${nextExp?`<div style="font-size:10px;color:var(--txt3);margin-top:5px">Next expiry: <strong style="color:${daysDiff(nextExp.expiryDate)<=30?'var(--yellow)':'var(--txt2)'}">${nextExp.expiryDate}</strong> (${nextExp.type})</div>`:''}
      </div>`;
    }).join('');
  } else {
    propGrid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:28px;color:var(--txt3);font-size:13px">No properties added yet. <a onclick="nav(\'pg-props\')" style="color:var(--acc);cursor:pointer">Add properties →</a></div>';
  }
}
