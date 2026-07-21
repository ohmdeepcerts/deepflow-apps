// Directory domain — landlord/agency/agent/engineer/subcontractor contact
// records, the sub-nav that switches between them, smart record matching +
// autosave, and the person/agency/agent CRUD modals. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 2 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as certs.js: safe
// because every cross-module reference is used only inside function
// bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS, formatDateUK } from '@business';
import {
  S, dAll, dGet, dPut, dDel, toast, confirm2, uid, TODAY, logActivity,
  nav, closeModal, openModal, _sb, sendToWA, _notifTimeAgo, _renderRatingStrip,
  _sortPersons, calcInvTotal, getUserPerm, saveSetting,
} from './main.js';

let editPid=null,curDirSection='landlords';

export function getCurDirSection(){ return curDirSection; }

// ════════════════════════════════════════════════════════════════
//  DIRECTORIES
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
//  DIRECTORY SECTIONS — Sub-nav switching
// ════════════════════════════════════════════════════════════════


export function switchDirSection(section){
  curDirSection = section;
  ['landlords','agencies','agents','engineers','subcontractors','all'].forEach(s=>{
    const tab=document.getElementById('dtab-'+s);
    if(tab) tab.classList.toggle('active', s===section);
  });
  document.querySelectorAll('.dir-section').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById('dir-sec-'+section);
  if(target) target.classList.add('active');
  const titles={landlords:'🏠 Landlords',agencies:'🏢 Agencies',agents:'👔 Agents',engineers:'👷 Engineers',subcontractors:'🔧 Subcontractors',all:'◉ All People'};
  document.getElementById('tb-title').textContent=titles[section]||'Directories';
  renderDirSection(section);
}

export async function updateDirTabBadges(){
  try{
    const ps=await dAll('persons');
    const landlords=ps.filter(p=>(p.roles||[]).includes('landlord')).length;
    const subs=ps.filter(p=>(p.roles||[]).includes('subcontractor')).length;
    const agencies=(await dAll('agencies')).length;
    const agents=(await dAll('agents')).length;
    const counts={landlords,agencies,agents,subcontractors:subs,all:ps.length};
    Object.entries(counts).forEach(([k,v])=>{
      const tab=document.getElementById('dtab-'+k);
      if(!tab) return;
      // Find or create badge span inside tab
      let badge=tab.querySelector('.dir-tab-badge');
      if(v>0){
        if(!badge){badge=document.createElement('span');badge.className='dir-tab-badge';tab.appendChild(badge);}
        badge.textContent=v;
      } else if(badge){badge.remove();}
    });
  }catch(e){ console.warn('[DeepFlow]', e); }
}

export async function renderDir(){
  // Render all sections, start with current
  updateDirTabBadges();
  renderDirSection(curDirSection);
}

export async function renderDirSection(section){
  if(section==='landlords') await renderLandlordsSection();
  else if(section==='agencies') await renderAgenciesSection();
  else if(section==='agents') await renderAgentsSection();
  else if(section==='engineers') await renderEngineersSection();
  else if(section==='subcontractors') await renderSubcontractorsSection();
  else await renderAllSection();
}

export async function renderLandlordsSection(){
  const search = (document.getElementById('dir-search-landlords')?.value||'').toLowerCase();
  let ps = await dAll('persons');
  ps = ps.filter(p=>(p.roles||[]).includes('landlord'));
  if(search) ps = ps.filter(p=>(p.name+p.phone+p.email).toLowerCase().includes(search));
  // Sort
  const sortMode=document.getElementById('dir-sort-landlords')?.value||'name';
  _sortPersons(ps, sortMode, await dAll('invoices'), await dAll('jobs'));
  const invs = await dAll('invoices');
  const jobs = await dAll('jobs');
  const grid = document.getElementById('dir-grid-landlords');
  if(!grid) return;
  if(!ps.length){grid.innerHTML='<div class="empty"><div class="ei">🏠</div><p>No landlords yet. Click "+ Add Landlord" to get started.</p></div>';return}
  grid.innerHTML = ps.map(p=>buildPersonCard(p, invs, 'var(--blue)', jobs)).join('');
}

export async function renderSubcontractorsSection(){
  const search = (document.getElementById('dir-search-subcontractors')?.value||'').toLowerCase();
  let ps = await dAll('persons');
  ps = ps.filter(p=>(p.roles||[]).includes('subcontractor'));
  if(search) ps = ps.filter(p=>(p.name+p.phone+p.email).toLowerCase().includes(search));
  // Sort
  const sortMode=document.getElementById('dir-sort-subcontractors')?.value||'name';
  const allJobs = await dAll('jobs');
  const allInvs = await dAll('invoices');
  _sortPersons(ps, sortMode, allInvs, allJobs);
  const grid = document.getElementById('dir-grid-subcontractors');
  if(!grid) return;
  if(!ps.length){grid.innerHTML='<div class="empty"><div class="ei">🔧</div><p>No subcontractors yet.</p></div>';return}
  grid.innerHTML = ps.map(p=>{
    const subJobs = allJobs.filter(j=>j.subcontractor===p.name||j.subcontractorId===p.id);
    const jobsDone = subJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).length;
    const totalJobs = subJobs.length;
    const earned = subJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).reduce((s,j)=>s+(+(j.price||0)),0);
    return `<div class="dir-card-v2" style="--card-color:var(--purple);--card-color2:#ec4899" onclick="openPersonModal('${p.id}')">
      <div class="card-top"></div>
      <div class="card-body">
        <div class="card-head">
          <div class="card-avatar">🔧</div>
          <div class="card-info">
            <div class="card-name">${p.name}</div>
            <div class="card-role" style="color:#ec4899">SUBCONTRACTOR</div>
          </div>
        </div>
        <div class="card-meta">
          ${p.phone?`<div>📞 <a href="tel:${p.phone}" onclick="event.stopPropagation()">${p.phone}</a></div>`:''}
          ${p.email?`<div>✉ <a href="mailto:${p.email}" onclick="event.stopPropagation()">${p.email}</a></div>`:''}
          ${p.wa?`<div style="color:#25d366">📱 ${p.wa}</div>`:''}
          ${p.address?`<div style="color:var(--txt3)">📍 ${p.address}</div>`:''}
          ${p.notes?`<div style="color:var(--txt2);margin-top:4px;font-size:10px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${p.notes}</div>`:''}
        </div>
        <div class="card-stats">
          <div class="card-stat"><div class="card-stat-val" style="color:#22c55e">${jobsDone}</div><div class="card-stat-lbl">Done</div></div>
          <div class="card-stat"><div class="card-stat-val">${totalJobs}</div><div class="card-stat-lbl">Jobs</div></div>
          <div class="card-stat"><div class="card-stat-val" style="color:var(--green)">${earned>0?'£'+earned.toLocaleString():'—'}</div><div class="card-stat-lbl">Earned</div></div>
        </div>
        <div class="card-actions">
          <button onclick="event.stopPropagation();openPersonModal('${p.id}')">✎ Edit</button>
          ${p.phone?`<button onclick="event.stopPropagation();window.location.href='tel:${p.phone}'">📞 Call</button>`:''}
          ${p.wa?`<button onclick="event.stopPropagation();window.open('https://wa.me/${p.wa.replace(/\D/g,'').replace(/^0/,'44')}','_blank')">💬 WA</button>`:''}
          ${p.email?`<button onclick="event.stopPropagation();window.location.href='mailto:${p.email}'">✉ Email</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

export async function renderAgenciesSection(){
  const search = (document.getElementById('dir-search-agencies')?.value||'').toLowerCase();
  let agencies = await dAll('agencies');
  if(search) agencies = agencies.filter(a=>(a.name+a.phone+a.email).toLowerCase().includes(search));
  const agents = await dAll('agents');
  const allJobs = await dAll('jobs');
  const grid = document.getElementById('dir-grid-agencies');
  if(!grid) return;
  if(!agencies.length){grid.innerHTML='<div class="empty"><div class="ei">🏢</div><p>No agencies yet. Click "+ Add Agency" to get started.</p></div>';return}
  grid.innerHTML = agencies.map(a=>{
    const agentCount = agents.filter(ag=>ag.agencyId===a.id).length;
    const agencyJobs = allJobs.filter(j=>j.referrer===a.name||j.agencyName===a.name);
    const jobCount = agencyJobs.length;
    const propertyCount = [...new Set(agencyJobs.map(j=>j.address).filter(Boolean))].length;
    const safeName = a.name.replace(/'/g,"\\'");
    return `<div class="dir-card-v2" style="--card-color:var(--acc);--card-color2:#3b82f6" onclick="openAgencyModal('${a.id}')">
      <div class="card-top"></div>
      <div class="card-body">
        <div class="card-head">
          <div class="card-avatar">🏢</div>
          <div class="card-info">
            <div class="card-name">${a.name}</div>
            <div class="card-role" style="color:#3b82f6">AGENCY</div>
          </div>
        </div>
        <div class="card-meta">
          ${a.phone?`<div>📞 <a href="tel:${a.phone}" onclick="event.stopPropagation()">${a.phone}</a></div>`:''}
          ${a.email?`<div>✉ <a href="mailto:${a.email}" onclick="event.stopPropagation()">${a.email}</a></div>`:''}
          ${a.wa?`<div style="color:#25d366">📱 ${a.wa}</div>`:''}
          ${a.address?`<div style="color:var(--txt3)">📍 ${a.address}</div>`:''}
          ${a.website?`<div>🌐 <a href="${a.website.startsWith('http')?a.website:'https://'+a.website}" target="_blank" onclick="event.stopPropagation()">${a.website.replace(/^https?:\/\//,'')}</a></div>`:''}
          ${a.notes?`<div style="color:var(--txt2);margin-top:4px;font-size:10px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${a.notes}</div>`:''}
        </div>
        <div class="card-stats">
          <div class="card-stat"><div class="card-stat-val">${agentCount}</div><div class="card-stat-lbl">Agents</div></div>
          <div class="card-stat"><div class="card-stat-val">${propertyCount}</div><div class="card-stat-lbl">Properties</div></div>
          <div class="card-stat"><div class="card-stat-val">${jobCount}</div><div class="card-stat-lbl">Jobs</div></div>
        </div>
        <div class="card-actions">
          <button onclick="event.stopPropagation();openAgencyModal('${a.id}')">✎ Edit</button>
          <button onclick="event.stopPropagation();showPortalInviteModal('${a.id}','${safeName}','agency')">🔗 Portal</button>
          ${a.phone?`<button onclick="event.stopPropagation();copyText('${a.phone.replace(/'/g,"\\'")}')">📋 Copy</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

export async function renderAgentsSection(){
  const search = (document.getElementById('dir-search-agents')?.value||'').toLowerCase();
  const agencyFilter = document.getElementById('dir-agent-agency-filter')?.value||'';
  let agents = await dAll('agents');
  const agencies = await dAll('agencies');
  const allJobs = await dAll('jobs');
  const allInvs = await dAll('invoices');

  // Populate agency filter dropdown
  const agFilt = document.getElementById('dir-agent-agency-filter');
  if(agFilt){
    const curVal = agFilt.value;
    agFilt.innerHTML = '<option value="">All Agencies</option>' + agencies.map(a=>`<option value="${a.id}" ${a.id===curVal?'selected':''}>${a.name}</option>`).join('');
  }

  if(agencyFilter) agents = agents.filter(ag=>ag.agencyId===agencyFilter);
  if(search) agents = agents.filter(ag=>(ag.name+ag.phone+ag.email).toLowerCase().includes(search));
  const grid = document.getElementById('dir-grid-agents');
  if(!grid) return;
  if(!agents.length){grid.innerHTML='<div class="empty"><div class="ei">👔</div><p>No agents yet. Click "+ Add Agent" to get started.</p></div>';return}
  grid.innerHTML = agents.map(ag=>{
    const agency = agencies.find(a=>a.id===ag.agencyId);
    const safeName = ag.name.replace(/'/g,"\\'");
    const agentJobs = allJobs.filter(j=>j.referrer===ag.name||j.agentName===ag.name||j.agentId===ag.id);
    const jobCount = agentJobs.length;
    const propertyCount = [...new Set(agentJobs.map(j=>j.address).filter(Boolean))].length;
    const agentInvs = allInvs.filter(i=>i.referrer===ag.name||i.agentName===ag.name||i.agentId===ag.id);
    const invTotal = agentInvs.reduce((s,i)=>s+(+(i.total||0)),0);
    return `<div class="dir-card-v2" style="--card-color:var(--purple);--card-color2:#a855f7" onclick="openAgentModal('${ag.id}')">
      <div class="card-top"></div>
      <div class="card-body">
        <div class="card-head">
          <div class="card-avatar">👔</div>
          <div class="card-info">
            <div class="card-name">${ag.name}</div>
            ${agency?`<div class="card-role" style="color:#a855f7;cursor:pointer" onclick="event.stopPropagation();document.getElementById('dir-agent-agency-filter').value='${agency.id}';renderAgentsSection();">🏢 ${agency.name}</div>`:`<div class="card-role" style="color:#a855f7">AGENT</div>`}
          </div>
        </div>
        ${ag.title?`<div style="font-size:11px;color:var(--txt3);margin-bottom:4px;margin-top:-4px;font-weight:600">${ag.title}</div>`:''}
        <div class="card-meta">
          ${ag.phone?`<div>📞 <a href="tel:${ag.phone}" onclick="event.stopPropagation()">${ag.phone}</a></div>`:''}
          ${ag.email?`<div>✉ <a href="mailto:${ag.email}" onclick="event.stopPropagation()">${ag.email}</a></div>`:''}
          ${ag.wa?`<div style="color:#25d366">📱 ${ag.wa}</div>`:''}
        </div>
        <div class="card-stats">
          <div class="card-stat"><div class="card-stat-val">${propertyCount}</div><div class="card-stat-lbl">Properties</div></div>
          <div class="card-stat"><div class="card-stat-val">${jobCount}</div><div class="card-stat-lbl">Jobs</div></div>
          <div class="card-stat"><div class="card-stat-val">${invTotal>0?'£'+invTotal.toLocaleString():'—'}</div><div class="card-stat-lbl">Invoiced</div></div>
        </div>
        <div class="card-actions">
          <button onclick="event.stopPropagation();openAgentModal('${ag.id}')">✎ Edit</button>
          ${ag.wa?`<button onclick="event.stopPropagation();window.open('https://wa.me/${ag.wa.replace(/\D/g,'').replace(/^0/,'44')}','_blank')">💬 WA</button>`:''}
          ${ag.email?`<button onclick="event.stopPropagation();window.location.href='mailto:${ag.email}'">✉ Email</button>`:''}
          <button onclick="event.stopPropagation();showPortalInviteModal('${ag.id}','${safeName}','agent','${safeName}')">🔗 Portal</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

export async function renderEngineersSection(){
  const search=(document.getElementById('dir-search-engineers')?.value||'').toLowerCase();
  // Pull fresh from Supabase users table
  let engs=[];
  try{
    const sbEngs=await _sb('users?role=eq.engineer&active=eq.true&order=name.asc&select=id,name,phone,pin,role,active,last_seen,last_lat,last_lng');
    if(sbEngs&&sbEngs.length){
      // Merge with S.engineers for rate/trade/wa extras
      engs=sbEngs.map(sbe=>{
        const loc=(S.engineers||[]).find(e=>e._sbId===sbe.id||e.name===sbe.name)||{};
        return {...loc,...sbe,_sbId:sbe.id};
      });
      // Also update S.engineers with fresh data
      S.engineers=engs.map(e=>({...e}));
      localStorage.setItem('df_setting_engineers',JSON.stringify(S.engineers));
    } else {
      engs=S.engineers||[];
    }
  }catch(e){ engs=S.engineers||[]; }

  if(search) engs=engs.filter(e=>(e.name+e.phone+e.trade+'').toLowerCase().includes(search));
  const grid=document.getElementById('dir-grid-engineers');
  if(!grid) return;

  if(!engs.length){
    grid.innerHTML=`<div class="empty" style="grid-column:1/-1"><div class="ei">👷</div><p>No engineers yet.<br><button class="btn btn-acc btn-sm" style="margin-top:8px" onclick="nav('set');setTimeout(()=>switchSetTab('team'),300);setTimeout(addEngRow,300)">+ Add First Engineer</button></p></div>`;
    return;
  }

  // Get today's jobs per engineer
  const today=TODAY();
  const allJobs=await dAll('jobs');
  const todayJobs=allJobs.filter(j=>j.date===today);

  const palette=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623','#ec4899'];
  grid.innerHTML=engs.map((e,i)=>{
    const col=palette[i%palette.length];
    const todayCount=todayJobs.filter(j=>j.engineer===e.name).length;
    const totalJobs=allJobs.filter(j=>j.engineer===e.name).length;
    const doneToday=todayJobs.filter(j=>j.engineer===e.name&&(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)).length;
    const lastSeen=e.last_seen?_notifTimeAgo(e.last_seen*1000):'Never';
    const hasLocation=e.last_lat&&e.last_lng;
    const initials=(e.name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
    return `<div class="dir-card-v2" style="--card-color:${col};--card-color2:#22c55e" onclick="openEngDir('${e._sbId||e.name}')">
      <div class="card-top"></div>
      <div class="card-body">
        <div class="card-head">
          <div class="card-avatar" style="font-size:14px">${initials}</div>
          <div class="card-info">
            <div class="card-name">${e.name}</div>
            <div class="card-role" style="color:${col}">${e.trade||'General'}${e.rate?' · £'+e.rate+'/hr':''}</div>
          </div>
        </div>
        <div class="card-meta">
          ${e.phone?`<div>📞 <a href="tel:${e.phone}" onclick="event.stopPropagation()">${e.phone}</a></div>`:''}
          ${e.wa?`<div style="color:#25d366">📱 ${e.wa}</div>`:''}
        </div>
        <div class="card-stats">
          <div class="card-stat"><div class="card-stat-val" style="color:var(--acc)">${todayCount}</div><div class="card-stat-lbl">Today</div></div>
          <div class="card-stat"><div class="card-stat-val" style="color:#22c55e">${doneToday}</div><div class="card-stat-lbl">Done</div></div>
          <div class="card-stat"><div class="card-stat-val" style="color:var(--txt2)">${totalJobs}</div><div class="card-stat-lbl">Total</div></div>
        </div>
        <div class="card-actions">
          ${hasLocation?`<button onclick="event.stopPropagation();window.open('https://maps.google.com/?q=${e.last_lat},${e.last_lng}','_blank')">📍 Map</button>`:''}
          ${e.phone?`<button onclick="event.stopPropagation();window.location.href='tel:${e.phone}'">📞 Call</button>`:''}
          ${e.wa?`<button onclick="event.stopPropagation();window.open('https://wa.me/${e.wa.replace(/\D/g,'').replace(/^0/,'44')}','_blank')">💬 WA</button>`:''}
          <button onclick="event.stopPropagation();nav('set');setTimeout(()=>switchSetTab('team'),300)">⚙ Edit & Pay Rate</button>
        </div>
        <div style="font-size:10px;color:var(--txt3);margin-top:8px;text-align:center">Last seen: ${lastSeen}</div>
      </div>
    </div>`;
  }).join('');
}
export async function openEngDir(sbIdOrName){
  // Find engineer from S.engineers or refetch
  let eng=(S.engineers||[]).find(e=>e._sbId===sbIdOrName||e.name===sbIdOrName);
  if(!eng) try{
    const r=await _sb(`users?id=eq.${encodeURIComponent(sbIdOrName)}&select=*`);
    if(r&&r.length) eng=r[0];
  }catch(e){ console.warn('[DeepFlow]', e); }
  if(!eng){toast('Engineer not found','error');return;}

  // Get their jobs
  const allJobs=await dAll('jobs');
  const engJobs=allJobs.filter(j=>j.engineer===eng.name);
  const today=TODAY();
  const todayJobs=engJobs.filter(j=>j.date===today);
  const pendingJobs=engJobs.filter(j=>j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS);
  const completedJobs=engJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED);

  const col=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623','#ec4899']
    [(S.engineers||[]).findIndex(e=>e.name===eng.name)%8]||'var(--acc)';
  const initials=(eng.name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  const lastSeen=eng.last_seen?_notifTimeAgo(eng.last_seen*1000):'Never logged in';

  // Build recent jobs list (last 8)
  const recentJobs=[...engJobs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,8);

  openModal('mo-eng-dir');
  const body=document.getElementById('mo-eng-dir-body');
  if(!body) return;
  body.innerHTML=`
    <!-- Header -->
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div style="width:64px;height:64px;border-radius:50%;background:${col}22;border:3px solid ${col};display:flex;align-items:center;justify-content:center;font-family:var(--fh);font-weight:900;font-size:24px;color:${col};flex-shrink:0">${initials}</div>
      <div style="flex:1">
        <div style="font-family:var(--fh);font-size:22px;font-weight:900;color:var(--txt)">${eng.name}</div>
        <div style="font-size:13px;color:var(--txt3)">${eng.trade||'General'} Engineer${eng.rate?' · £'+eng.rate+'/hr':''}</div>
        <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
          ${eng.phone?`<a href="tel:${eng.phone}" style="font-size:12px;color:var(--acc);text-decoration:none">📞 ${eng.phone}</a>`:''}
          ${eng.wa?`<a href="https://wa.me/${eng.wa}" target="_blank" style="font-size:12px;color:#25d366;text-decoration:none">📱 WhatsApp</a>`:''}
        </div>
      </div>
      ${(getUserPerm('canEdit'))?`<button class="btn btn-ghost btn-sm" onclick="closeModal('mo-eng-dir');nav('set');setTimeout(()=>switchSetTab('team'),300)">⚙ Edit</button>`:''}
    </div>

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--acc)">${todayJobs.length}</div>
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-top:2px">Today</div>
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:#f97316">${pendingJobs.length}</div>
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-top:2px">Pending</div>
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:#22c55e">${completedJobs.length}</div>
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-top:2px">Completed</div>
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px;text-align:center">
        <div style="font-family:var(--fh);font-size:24px;font-weight:900;color:var(--txt2)">${engJobs.length}</div>
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-top:2px">All Time</div>
      </div>
    </div>

    <!-- Location & Portal info -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
      <div style="background:var(--s2);border-radius:10px;padding:12px">
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-bottom:6px">📍 Last Location</div>
        <div style="font-size:12px;color:var(--txt2)">${lastSeen}</div>
        ${eng.last_lat&&eng.last_lng?`<a href="https://maps.google.com/?q=${eng.last_lat},${eng.last_lng}" target="_blank" class="btn btn-ghost btn-xs" style="margin-top:8px;display:inline-block">Open in Maps</a>`:'<div style="font-size:11px;color:var(--txt3);margin-top:4px">No GPS data yet</div>'}
      </div>
      <div style="background:var(--s2);border-radius:10px;padding:12px">
        <div style="font-size:10px;color:var(--txt3);font-weight:700;text-transform:uppercase;margin-bottom:6px">🔑 Portal Access</div>
        <div style="font-size:12px;color:var(--txt2)">${eng.pin?'PIN set — can log in to engineer portal':'No PIN — cannot access portal'}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:4px">${eng.capacity||8} hr/day capacity · OT: £${eng.otRate||0}/hr</div>
      </div>
    </div>

    <!-- Recent jobs -->
    <div style="font-size:11px;color:var(--txt3);font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Recent Jobs</div>
    ${recentJobs.length?recentJobs.map(j=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--s2);border-radius:8px;margin-bottom:6px;cursor:pointer" onclick="closeModal('mo-eng-dir');openJobModal('${j.id}')">
        <div style="font-size:10px;color:var(--txt3);width:72px;flex-shrink:0">${j.date||''}</div>
        <div style="flex:1;font-size:12px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(j.address)||'No address'}</div>
        <div style="font-size:11px;color:var(--txt2);white-space:nowrap">${j.description?escHtml(j.description.slice(0,30))+(j.description.length>30?'…':''):''}</div>
        <div class="badge b-${(j.status||'pending').toLowerCase().replace(' ','-')}" style="font-size:9px;flex-shrink:0">${j.status||'Pending'}</div>
      </div>`).join('')
    :'<div style="text-align:center;color:var(--txt3);font-size:13px;padding:20px">No jobs assigned yet</div>'}

    <!-- Dispatch button -->
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      ${eng.wa?`<a href="https://wa.me/${eng.wa}" target="_blank" class="btn btn-green btn-sm">📱 WhatsApp ${eng.name.split(' ')[0]}</a>`:''}
      <button class="btn btn-acc btn-sm" onclick="closeModal('mo-eng-dir');nav('jobs')">📋 View All Jobs</button>
    </div>
  `;
}

export async function renderAllSection(){
  const filter = document.getElementById('dir-filter')?.value||'';
  const search = (document.getElementById('dir-search')?.value||'').toLowerCase();
  let ps = await dAll('persons');
  if(filter) ps = ps.filter(p=>(p.roles||[]).includes(filter));
  if(search) ps = ps.filter(p=>(p.name+p.phone+p.email).toLowerCase().includes(search));
  // Sort
  const sortMode=document.getElementById('dir-sort-all')?.value||'name';
  const invs = await dAll('invoices');
  const jobs = await dAll('jobs');
  _sortPersons(ps, sortMode, invs, jobs);
  const grid = document.getElementById('dir-grid');
  if(!grid) return;
  if(!ps.length){grid.innerHTML='<div class="empty"><div class="ei">◉</div><p>No people yet</p></div>';return}
  const roleColors={landlord:'var(--blue)',client:'var(--green)',engineer:'var(--acc)',subcontractor:'var(--purple)'};
  grid.innerHTML = ps.map(p=>buildPersonCard(p, invs, roleColors[(p.roles||[])[0]]||'var(--border)', jobs)).join('');
}

export function buildPersonCard(p, invs, topColor, jobs){
  const tags=(p.roles||[]).map(r=>`<span class="tag t-${r.slice(0,2)}">${r[0].toUpperCase()+r.slice(1)}</span>`).join('');
  const personInvs=invs.filter(i=>i.clientId===p.id);
  const owed=personInvs.filter(i=>i.status==='Awaiting Payment').reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const invTotal=personInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const isLandlord=(p.roles||[]).includes('landlord');
  const ratingId='dir-rating-'+p.id;
  // Job stats
  const personJobs=jobs?jobs.filter(j=>j.referrer===p.name||j.clientId===p.id||j.landlordName===p.name):[];
  const jobCount=personJobs.length;
  const lastActivity=personJobs.length?personJobs.sort((a,b)=>(b.date||'').localeCompare(a.date||''))[0].date:null;
  // Render rating asynchronously after card is inserted
  setTimeout(()=>_renderRatingStrip(ratingId, p.name), 0);
  // Bulk mode
  const bulkMode=window._dirBulkMode&&window._dirBulkMode[curDirSection];
  const isSelected=window._dirBulkSelected&&window._dirBulkSelected.has(p.id);
  // Avatar initials
  const initials=(p.name||'?').split(' ').map(n=>n[0]).join('').toUpperCase().slice(0,2);
  // Role color
  const roleCol=isLandlord?'var(--blue)':(p.roles||[]).includes('client')?'var(--green)':(p.roles||[]).includes('engineer')?'var(--acc)':'var(--purple)';

  return`<div class="dir-card-v2" style="--card-color:${topColor};--card-color2:${roleCol}" onclick="${bulkMode?`togglePersonSelect('${p.id}')`:`openPersonModal('${p.id}')`}">
    <div class="card-top"></div>
    <!-- Bulk checkbox -->
    ${bulkMode?`<div class="bulk-chk ${isSelected?'on':''}" onclick="event.stopPropagation();togglePersonSelect('${p.id}')">${isSelected?'✓':''}</div>`:''}
    <!-- Owed badge -->
    ${owed>0?`<div class="owed-badge">£${owed.toFixed(0)} owed</div>`:''}
    <div class="card-body">
      <div class="card-head">
        <div class="card-avatar">${initials}</div>
        <div class="card-info">
          <div class="card-name">${p.name}</div>
          <div class="card-role" style="color:${roleCol}">${(p.roles||[]).join(' · ')||'Person'}</div>
        </div>
      </div>
      <div class="card-meta">
        ${p.phone?`<div>📞 <a href="tel:${p.phone}" onclick="event.stopPropagation()">${p.phone}</a></div>`:''}
        ${p.email?`<div>✉ <a href="mailto:${p.email}" onclick="event.stopPropagation()">${p.email}</a></div>`:''}
        ${p.address?`<div style="color:var(--txt3)">📍 ${p.address}</div>`:''}
        ${p.wa?`<div style="color:#25d366">📱 ${p.wa}</div>`:''}
        ${p.notes?`<div style="color:var(--txt2);margin-top:4px">${p.notes}</div>`:''}
      </div>
      <!-- Stats row -->
      <div class="card-stats">
        <div class="card-stat"><div class="card-stat-val">${jobCount}</div><div class="card-stat-lbl">Jobs</div></div>
        <div class="card-stat"><div class="card-stat-val">${personInvs.length}</div><div class="card-stat-lbl">Invoices</div></div>
        <div class="card-stat"><div class="card-stat-val">${lastActivity?formatDateUK(lastActivity):'—'}</div><div class="card-stat-lbl">Last Active</div></div>
      </div>
      <!-- Quick actions -->
      <div class="card-actions">
        ${p.phone?`<button onclick="event.stopPropagation();window.location.href='tel:${p.phone}'">📞 Call</button>`:''}
        ${p.wa?`<button onclick="event.stopPropagation();window.open('https://wa.me/${p.wa.replace(/\\D/g,'').replace(/^0/,'44')}','_blank')">💬 WA</button>`:''}
        ${p.email?`<button onclick="event.stopPropagation();window.location.href='mailto:${p.email}'">✉ Email</button>`:''}
        ${isLandlord?`<button onclick="event.stopPropagation();showPortalInviteModal('${p.id}','${p.name.replace(/'/g,"\\'")}','landlord')">🔗 Portal</button>`:''}
        <button onclick="event.stopPropagation();openPersonModal('${p.id}')">✎ Edit</button>
      </div>
      <div id="${ratingId}" style="margin-top:8px"></div>
    </div>
  </div>`;
}

export function openPersonModalFor(role){
  openPersonModal();
  setTimeout(()=>{
    const cb=document.getElementById('pf-'+role.slice(0,2));
    if(cb){cb.checked=true;if(role==='engineer'||role==='subcontractor')document.getElementById('pf-eng-extra').style.display='';}
  },50);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  DIRECTORY SMART MATCH + AUTOSAVE (v15)
//  — fuzzy match on name/phone as you type
//  — auto-save when name field has value (no button needed)
//  — partial phone match from last digits
// ════════════════════════════════════════════════════════════════

// Map store → current edit id variable name
export function currentEditId(store){
  if(store==='persons')   return editPid||null;
  if(store==='agencies')  return editAgencyId||null;
  if(store==='agents')    return editAgentId||null;
  return null;
}

// Compute match score 0-100 between two strings
export function _matchScore(a, b){
  if(!a||!b) return 0;
  a = a.toLowerCase().replace(/\s+/g,' ').trim();
  b = b.toLowerCase().replace(/\s+/g,' ').trim();
  if(!a||!b) return 0;
  if(a===b) return 100;
  // Exact contains
  if(b.includes(a)||a.includes(b)) return 90;
  // Phone: partial match from END (last N digits)
  const aDigits = a.replace(/\D/g,'');
  const bDigits = b.replace(/\D/g,'');
  if(aDigits.length>=4 && bDigits.length>=4){
    const tail = Math.min(aDigits.length, bDigits.length);
    if(bDigits.endsWith(aDigits.slice(-tail)) || aDigits.endsWith(bDigits.slice(-tail))){
      const pct = Math.round((tail/Math.max(aDigits.length,bDigits.length))*80)+10;
      return Math.min(pct, 88);
    }
    // Any digit sequence overlap
    for(let len=4;len<=Math.min(aDigits.length,bDigits.length);len++){
      if(bDigits.includes(aDigits.slice(-len))) return Math.round(len/bDigits.length*75)+10;
    }
  }
  // Word overlap
  const aw = a.split(/\s+/); const bw = b.split(/\s+/);
  const shared = aw.filter(w=>w.length>1&&bw.some(bv=>bv.includes(w)||w.includes(bv)));
  if(shared.length) return Math.round((shared.length/Math.max(aw.length,bw.length))*70)+15;
  // Char n-gram similarity
  const bigrams = s=>{const r=new Set();for(let i=0;i<s.length-1;i++)r.add(s.slice(i,i+2));return r;};
  const ab=bigrams(a),bb=bigrams(b);
  const inter=[...ab].filter(g=>bb.has(g)).length;
  const score = inter/(ab.size+bb.size-inter)*100;
  return Math.round(score);
}


export async function matchDir(store, field, val, targetId, excludeId){
  clearTimeout(_matchTimers[targetId]);
  const el = document.getElementById(targetId);
  if(!el) return;
  if(!val || val.length < 2){ el.innerHTML=''; return; }
  _matchTimers[targetId] = setTimeout(async()=>{
    const all = await dAll(store);
    const results = all
      .filter(r=> !excludeId || r.id !== excludeId)
      .map(r=>{
        const fieldVal = r[field]||'';
        const nameVal  = r.name||r.agencyName||'';
        // Score against the typed field, plus bonus if other fields also match
        let score = _matchScore(val, fieldVal);
        // For phone search, also show name if phone matches
        if(field==='phone' && score < 20) score = _matchScore(val, r.phone||r.wa||'');
        return {r, score};
      })
      .filter(x=>x.score>=20)
      .sort((a,b)=>b.score-a.score)
      .slice(0,6);

    if(!results.length){ el.innerHTML=''; return; }

    const icon = store==='agencies'?'🏢':store==='agents'?'👔':'👤';
    el.innerHTML = `<div class="dup-popup">
      <div class="dup-popup-hd">⚠ Possible match in database</div>
      ${results.map(({r,score})=>{
        const cls = score>=80?'match-high':score>=50?'match-med':'match-low';
        const detail = r.phone||r.wa||r.email||r.address||'';
        const detailShort = detail.length>30?detail.slice(0,28)+'…':detail;
        return `<div class="dup-item" onclick="fillFromMatch('${store}','${r.id}')">
          <span class="dup-match-badge ${cls}">${score}%</span>
          <div style="flex:1;min-width:0">
            <div class="dup-item-name">${icon} ${r.name||'—'}</div>
            ${detailShort?`<div class="dup-item-detail">${detailShort}</div>`:''}
          </div>
          <span style="font-size:10px;color:var(--acc);font-family:var(--fh);flex-shrink:0">↑ Use this</span>
        </div>`;
      }).join('')}
    </div>`;

    // Auto-dismiss when clicking outside
    const dismiss = ev=>{
      if(!el.contains(ev.target)) { el.innerHTML=''; document.removeEventListener('click',dismiss); }
    };
    setTimeout(()=>document.addEventListener('click',dismiss),60);
  }, 220);
}

// Fill the form from a matched record
export async function fillFromMatch(store, id){
  const r = await dGet(store, id);
  if(!r) return;
  // Clear all match popups
  document.querySelectorAll('[id$="-dup"]').forEach(el=>el.innerHTML='');
  if(store==='persons'){
    editPid = id;
    document.getElementById('pf-name').value  = r.name||'';
    document.getElementById('pf-phone').value = r.phone||'';
    document.getElementById('pf-email').value = r.email||'';
    document.getElementById('pf-wa').value    = r.wa||'';
    document.getElementById('pf-addr').value  = r.address||'';
    document.getElementById('pf-notes').value = r.notes||'';
    document.getElementById('pf-rate').value  = r.rate||'';
    const roles = r.roles||[];
    document.getElementById('pf-ll').checked = roles.includes('landlord');
    document.getElementById('pf-cl').checked = roles.includes('client');
    document.getElementById('pf-en').checked = roles.includes('engineer');
    document.getElementById('pf-sc').checked = roles.includes('subcontractor');
    document.getElementById('mo-person-title').textContent = '✎ Edit Person';
    document.getElementById('btn-del-person').style.display = '';
    document.getElementById('btn-wa-person').style.display = r.wa?'':'none';
  } else if(store==='agencies'){
    editAgencyId = id;
    document.getElementById('agf-name').value  = r.name||'';
    document.getElementById('agf-phone').value = r.phone||'';
    document.getElementById('agf-email').value = r.email||'';
    document.getElementById('agf-wa').value    = r.wa||'';
    document.getElementById('agf-addr').value  = r.address||'';
    document.getElementById('agf-web').value   = r.website||'';
    document.getElementById('agf-notes').value = r.notes||'';
    document.getElementById('mo-agency-title').textContent = '✎ Edit Agency';
    document.getElementById('btn-del-agency').style.display = '';
  } else if(store==='agents'){
    editAgentId = id;
    document.getElementById('agt-name').value  = r.name||'';
    document.getElementById('agt-phone').value = r.phone||'';
    document.getElementById('agt-wa').value    = r.wa||'';
    document.getElementById('agt-email').value = r.email||'';
    document.getElementById('agt-title').value = r.title||'';
    document.getElementById('agt-notes').value = r.notes||'';
    if(r.agencyId) document.getElementById('agt-agency').value = r.agencyId;
    document.getElementById('mo-agent-title').textContent = '✎ Edit Agent';
    document.getElementById('btn-del-agent').style.display = '';
  }
  showAutosaveBanner(`Loaded existing record — edit and it will auto-save`);
}

// ── Auto-save: fires 1.2s after last keystroke on any field ──

export function scheduleAutoSave(store, delay=1200){
  clearTimeout(_autoSaveTimers[store]);
  _autoSaveTimers[store] = setTimeout(()=>_autoSaveStore(store), delay);
}

export async function _autoSaveStore(store){
  if(store==='persons'){
    const name = document.getElementById('pf-name')?.value.trim();
    if(!name) return;
    await savePerson(true);
    showAutosaveBanner('✓ Auto-saved to database');
  } else if(store==='agencies'){
    const name = document.getElementById('agf-name')?.value.trim();
    if(!name) return;
    await saveAgency(true);
    showAutosaveBanner('✓ Auto-saved to database');
  } else if(store==='agents'){
    const name = document.getElementById('agt-name')?.value.trim();
    if(!name) return;
    await saveAgent(true);
    showAutosaveBanner('✓ Auto-saved to database');
  }
}

export function showAutosaveBanner(msg){
  document.querySelectorAll('.autosave-banner').forEach(b=>b.remove());
  const el = document.createElement('div');
  el.className = 'autosave-banner';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 2500);
}

// ── Wire autosave oninput to all dir form fields ──
// Called after each modal opens
export function wireAutoSave(store){
  const fieldMap = {
    persons:  ['pf-name','pf-phone','pf-email','pf-wa','pf-addr','pf-notes','pf-rate'],
    agencies: ['agf-name','agf-phone','agf-email','agf-wa','agf-addr','agf-web','agf-notes'],
    agents:   ['agt-name','agt-phone','agt-wa','agt-email','agt-title','agt-notes'],
  };
  (fieldMap[store]||[]).forEach(fid=>{
    const el = document.getElementById(fid);
    if(!el) return;
    el.addEventListener('input', ()=>scheduleAutoSave(store), {once:false});
  });
}

//  AGENCY CRUD
// ════════════════════════════════════════════════════════════════

export async function openAgencyModal(id){
  editAgencyId = id||null;
  document.getElementById('mo-agency-title').textContent = id ? '✎ Edit Agency' : '🏢 Add Agency';
  document.getElementById('btn-del-agency').style.display = id ? '' : 'none';
  if(id){
    const a = await dGet('agencies',id);
    if(!a) return;
    document.getElementById('agf-name').value = a.name||'';
    document.getElementById('agf-phone').value = a.phone||'';
    document.getElementById('agf-email').value = a.email||'';
    document.getElementById('agf-wa').value = a.wa||'';
    document.getElementById('agf-addr').value = a.address||'';
    document.getElementById('agf-web').value = a.website||'';
    document.getElementById('agf-notes').value = a.notes||'';
    document.getElementById('agf-bank-name').value = a.bankName||'';
    document.getElementById('agf-bank-acc').value = a.bankAcc||'';
    document.getElementById('agf-bank-sort').value = a.bankSort||'';
    document.getElementById('agf-bank-ref').value = a.bankRef||'';
  } else {
    ['agf-name','agf-phone','agf-email','agf-wa','agf-addr','agf-web','agf-notes','agf-bank-name','agf-bank-acc','agf-bank-sort','agf-bank-ref'].forEach(x=>{const el=document.getElementById(x);if(el)el.value='';});
  }
  openModal('mo-agency'); setTimeout(()=>wireAutoSave('agencies'),100);
}

export async function saveAgency(silent=false){
  const name = document.getElementById('agf-name').value.trim();
  if(!name){if(!silent)toast('Agency name required','error');return}
  const a = {
    id: editAgencyId||uid(),
    name,
    phone: document.getElementById('agf-phone').value.trim(),
    email: document.getElementById('agf-email').value.trim(),
    wa: document.getElementById('agf-wa').value.trim(),
    address: document.getElementById('agf-addr').value.trim(),
    website: document.getElementById('agf-web').value.trim(),
    notes: document.getElementById('agf-notes').value.trim(),
    bankName: document.getElementById('agf-bank-name').value.trim(),
    bankAcc: document.getElementById('agf-bank-acc').value.trim(),
    bankSort: document.getElementById('agf-bank-sort').value.trim(),
    bankRef: document.getElementById('agf-bank-ref').value.trim(),
    modified: Date.now()
  };
  if(!editAgencyId){ a.created = Date.now(); editAgencyId=a.id; }
  await dPut('agencies',a);
  await logActivity(`${a.created?'Added':'Updated'} agency: ${name}`,'agency');
  if(!silent){ closeModal('mo-agency'); renderDirSection('agencies'); toast('Agency saved','success'); }
  else { renderDirSection('agencies'); }
}

export async function deleteCurrentAgency(){
  // FIX 17: Check for linked agents and jobs before deleting
  const a = await dGet('agencies', editAgencyId);
  if(!a) return;

  const [allAgents, allJobs] = await Promise.all([dAll('agents'), dAll('jobs')]);
  const linkedAgents = allAgents.filter(ag => ag.agencyId === editAgencyId);
  const linkedJobs   = allJobs.filter(j => j.agencyName === a.name);

  const warningLines = [];
  if(linkedAgents.length) warningLines.push(`• ${linkedAgents.length} agent${linkedAgents.length!==1?'s':''} linked to this agency`);
  if(linkedJobs.length)   warningLines.push(`• ${linkedJobs.length} job${linkedJobs.length!==1?'s':''} referencing this agency`);

  const msg = warningLines.length
    ? `"${a.name}" is linked to:\n${warningLines.join('\n')}\n\nThose records will lose their agency link.\n\nDelete anyway?`
    : `Permanently delete agency "${a.name}"?`;

  confirm2('Delete Agency', msg, async()=>{
    await dDel('agencies',editAgencyId);
    closeModal('mo-agency');renderDirSection('agencies');toast('Agency deleted','warn');
  });
}

// ════════════════════════════════════════════════════════════════
//  AGENT CRUD
// ════════════════════════════════════════════════════════════════

export async function openAgentModal(id){
  editAgentId = id||null;
  document.getElementById('mo-agent-title').textContent = id ? '✎ Edit Agent' : '👔 Add Agent';
  document.getElementById('btn-del-agent').style.display = id ? '' : 'none';
  // Fill agency dropdown
  const agencies = await dAll('agencies');
  const agtSel = document.getElementById('agt-agency');
  agtSel.innerHTML = '<option value="">— Select Agency —</option>' + agencies.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  if(id){
    const ag = await dGet('agents',id);
    if(!ag) return;
    document.getElementById('agt-name').value = ag.name||'';
    document.getElementById('agt-agency').value = ag.agencyId||'';
    document.getElementById('agt-phone').value = ag.phone||'';
    document.getElementById('agt-wa').value = ag.wa||'';
    document.getElementById('agt-email').value = ag.email||'';
    document.getElementById('agt-title').value = ag.title||'';
    document.getElementById('agt-notes').value = ag.notes||'';
  } else {
    ['agt-name','agt-phone','agt-wa','agt-email','agt-title','agt-notes'].forEach(x=>{const el=document.getElementById(x);if(el)el.value='';});
    agtSel.value='';
  }
  openModal('mo-agent'); setTimeout(()=>wireAutoSave('agents'),100);
}

export async function saveAgent(silent=false){
  const name = document.getElementById('agt-name').value.trim();
  if(!name){if(!silent)toast('Agent name required','error');return}
  const ag = {
    id: editAgentId||uid(),
    name,
    agencyId: document.getElementById('agt-agency').value,
    phone: document.getElementById('agt-phone').value.trim(),
    wa: document.getElementById('agt-wa').value.trim(),
    email: document.getElementById('agt-email').value.trim(),
    title: document.getElementById('agt-title').value.trim(),
    notes: document.getElementById('agt-notes').value.trim(),
    modified: Date.now()
  };
  if(!editAgentId){ ag.created = Date.now(); editAgentId=ag.id; }
  await dPut('agents',ag);
  await logActivity(`${ag.created?'Added':'Updated'} agent: ${name}`,'agent');
  if(!silent){ closeModal('mo-agent'); renderDirSection('agents'); toast('Agent saved','success'); }
  else { renderDirSection('agents'); }
}

export async function deleteCurrentAgent(){
  // FIX 17: Check for linked jobs before deleting
  const ag = await dGet('agents', editAgentId);
  if(!ag) return;

  const allJobs = await dAll('jobs');
  const linkedJobs = allJobs.filter(j => j.agentName === ag.name);

  const msg = linkedJobs.length
    ? `"${ag.name}" is referenced in ${linkedJobs.length} job${linkedJobs.length!==1?'s':''}.\n\nThose jobs will lose their agent link.\n\nDelete anyway?`
    : `Permanently delete agent "${ag.name}"?`;

  confirm2('Delete Agent', msg, async()=>{
    await dDel('agents',editAgentId);
    closeModal('mo-agent');renderDirSection('agents');toast('Agent deleted','warn');
  });
}

// ════════════════════════════════════════════════════════════════
//  UPGRADED PERSON MODAL — with agency field
// ════════════════════════════════════════════════════════════════

export async function openPersonModal(id){
  editPid=id||null;
  document.getElementById('pf-en').onchange=function(){document.getElementById('pf-eng-extra').style.display=this.checked?'':''};
  document.getElementById('pf-sc').onchange=function(){document.getElementById('pf-eng-extra').style.display=(this.checked||document.getElementById('pf-en').checked)?'':'none'};
  // Fill trade dropdown for person
  const td=document.getElementById('pf-trade');
  td.innerHTML='<option value="">—</option>'+(S.trades||[]).map(t=>`<option>${t.name}</option>`).join('');
  // Fill agency dropdown for person
  const agencies = await dAll('agencies');
  const agSel = document.getElementById('pf-agency');
  if(agSel) agSel.innerHTML = '<option value="">— None —</option>' + agencies.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');

  if(id){
    const p=await dGet('persons',id);
    document.getElementById('mo-person-title').textContent='✎ Edit — '+p.name;
    document.getElementById('pf-name').value=p.name||'';
    document.getElementById('pf-phone').value=p.phone||'';
    document.getElementById('pf-email').value=p.email||'';
    document.getElementById('pf-wa').value=p.wa||'';
    document.getElementById('pf-addr').value=p.address||'';
    document.getElementById('pf-notes').value=p.notes||'';
    document.getElementById('pf-rate').value=p.rate||'';
    if(document.getElementById('pf-bank-name')) document.getElementById('pf-bank-name').value=p.bankName||'';
    if(document.getElementById('pf-bank-acc'))  document.getElementById('pf-bank-acc').value=p.bankAcc||'';
    if(document.getElementById('pf-bank-sort')) document.getElementById('pf-bank-sort').value=p.bankSort||'';
    if(document.getElementById('pf-bank-ref'))  document.getElementById('pf-bank-ref').value=p.bankRef||'';
    document.getElementById('pf-trade').value=p.trade||'';
    document.getElementById('pf-ll').checked=(p.roles||[]).includes('landlord');
    document.getElementById('pf-cl').checked=(p.roles||[]).includes('client');
    document.getElementById('pf-en').checked=(p.roles||[]).includes('engineer');
    document.getElementById('pf-sc').checked=(p.roles||[]).includes('subcontractor');
    const showExtra=(p.roles||[]).some(r=>r==='engineer'||r==='subcontractor');
    document.getElementById('pf-eng-extra').style.display=showExtra?'':'none';
    if(agSel) agSel.value = p.agencyId||'';
    // Show agency field if they have a linked agency
    const agGrp = document.getElementById('pf-agency-grp');
    if(agGrp) agGrp.style.display = agencies.length ? '' : 'none';
    document.getElementById('btn-del-person').style.display='';
    document.getElementById('btn-wa-person').style.display=p.wa?'':'none';
  } else {
    document.getElementById('mo-person-title').textContent='👤 Add Person';
    ['pf-name','pf-phone','pf-email','pf-wa','pf-addr','pf-notes','pf-rate'].forEach(x=>document.getElementById(x).value='');
    ['pf-ll','pf-cl','pf-en','pf-sc'].forEach(x=>document.getElementById(x).checked=false);
    document.getElementById('pf-eng-extra').style.display='none';
    if(agSel) agSel.value='';
    const agGrp = document.getElementById('pf-agency-grp');
    if(agGrp) agGrp.style.display = agencies.length ? '' : 'none';
    document.getElementById('btn-del-person').style.display='none';
    document.getElementById('btn-wa-person').style.display='none';
  }
  openModal('mo-person'); setTimeout(()=>wireAutoSave('persons'),100);
}

export async function savePerson(silent=false){
  const name=document.getElementById('pf-name').value.trim();
  if(!name){if(!silent)toast('Name required','error');return}
  const roles=[];
  if(document.getElementById('pf-ll').checked)roles.push('landlord');
  if(document.getElementById('pf-cl').checked)roles.push('client');
  if(document.getElementById('pf-en').checked)roles.push('engineer');
  if(document.getElementById('pf-sc').checked)roles.push('subcontractor');
  const p={
    id:editPid||uid(),name,
    phone:document.getElementById('pf-phone').value.trim(),
    email:document.getElementById('pf-email').value.trim(),
    wa:document.getElementById('pf-wa').value.replace(/[^0-9]/g,''),
    address:document.getElementById('pf-addr').value.trim(),
    notes:document.getElementById('pf-notes').value.trim(),
    rate:parseFloat(document.getElementById('pf-rate').value)||0,
    trade:document.getElementById('pf-trade').value,
    agencyId:document.getElementById('pf-agency')?.value||'',
    bankName:document.getElementById('pf-bank-name')?.value.trim()||'',
    bankAcc:document.getElementById('pf-bank-acc')?.value.trim()||'',
    bankSort:document.getElementById('pf-bank-sort')?.value.trim()||'',
    bankRef:document.getElementById('pf-bank-ref')?.value.trim()||'',
    roles
  };
  if(!editPid){ editPid=p.id; }
  await dPut('persons',p);
  // Sync engineers to settings
  if(roles.includes('engineer')||roles.includes('subcontractor')){
    const engs=S.engineers||[];
    const idx=engs.findIndex(e=>e.name===name);
    const engObj={name,phone:p.phone,rate:p.rate,wa:p.wa,trade:p.trade};
    if(idx>=0)engs[idx]=engObj;else engs.push(engObj);
    await saveSetting('engineers',engs);
  }
  await logActivity(`${p.id===editPid&&!silent?'Updated':'Added'} person: ${name}`,'person');
  if(!silent){ closeModal('mo-person');renderDir();renderDirSection(curDirSection);toast('Saved','success'); }
  else { renderDir();renderDirSection(curDirSection); }
}

export async function deleteCurrentPerson(){
  // FIX 17: Check for dependent records before deleting — previously this deleted
  // immediately with no warning, orphaning all linked jobs, invoices, and certs.
  const p = await dGet('persons', editPid);
  if(!p) return;

  const [allJobs, allInvs, allCerts] = await Promise.all([
    dAll('jobs'), dAll('invoices'), dAll('certs')
  ]);
  const linkedJobs  = allJobs.filter(j => j.referrer === p.name || j.landlordName === p.name);
  const linkedInvs  = allInvs.filter(i => i.clientName === p.name || i.clientId === editPid);
  const linkedCerts = allCerts.filter(c => c.landlord === p.name);

  const hasLinks = linkedJobs.length || linkedInvs.length || linkedCerts.length;
  const warningLines = [];
  if(linkedJobs.length)  warningLines.push(`• ${linkedJobs.length} job${linkedJobs.length!==1?'s':''}`);
  if(linkedInvs.length)  warningLines.push(`• ${linkedInvs.length} invoice${linkedInvs.length!==1?'s':''}`);
  if(linkedCerts.length) warningLines.push(`• ${linkedCerts.length} certificate${linkedCerts.length!==1?'s':''}`);

  const msg = hasLinks
    ? `"${p.name}" is linked to:\n${warningLines.join('\n')}\n\nDeleting will NOT remove those records but they will lose their contact link.\n\nDelete anyway?`
    : `Permanently delete "${p.name}"?`;

  confirm2('Delete Person', msg, async()=>{
    await dDel('persons',editPid);
    closeModal('mo-person');renderDir();toast('Person deleted','warn');
  });
}

export async function openPersonWA(){
  const p=await dGet('persons',editPid);
  if(!p||!p.wa)return;
  const msg=`Hello *${p.name}*, this is ${S.coName||'us'}.`;
  sendToWA(p.wa,msg);
}

export function openImportModal(){toast('CSV import: paste person data as Name,Phone,Email,Role (one per line)','info',5000)}

// ════════════════════════════════════════════════════════════════
