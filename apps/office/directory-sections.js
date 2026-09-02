// Directory sections — the sub-nav that switches between Landlords/
// Agencies/Agents/Engineers/Subcontractors/All, each section's list
// renderer, the shared person-card builder, and the engineer detail modal.
// Extracted from directory.js verbatim (Phase 2 of the follow-up
// modularization pass — see the plan file for scope) — no behaviour
// changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { STATUS, formatDateUK } from '@business';
import {
  S, dAll, toast, TODAY, openModal, _sb, _notifTimeAgo, _renderRatingStrip,
  _sortPersons, calcInvTotal, getUserPerm, closeModal,
} from './main.js';

let curDirSection='landlords';

export function getCurDirSection(){ return curDirSection; }

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
  const showArchived = document.getElementById('dir-show-archived-landlords')?.checked||false;
  let ps = await dAll('persons');
  ps = ps.filter(p=>(p.roles||[]).includes('landlord'));
  const archivedCount = ps.filter(p=>p.archived).length;
  if(!showArchived) ps = ps.filter(p=>!p.archived);
  if(search) ps = ps.filter(p=>(p.name+p.phone+p.email).toLowerCase().includes(search));
  // Sort
  const sortMode=document.getElementById('dir-sort-landlords')?.value||'name';
  _sortPersons(ps, sortMode, await dAll('invoices'), await dAll('jobs'));
  const invs = await dAll('invoices');
  const jobs = await dAll('jobs');
  const grid = document.getElementById('dir-grid-landlords');
  if(!grid) return;
  const archiveHint = archivedCount ? `<div style="text-align:center;font-size:11px;color:var(--txt3);padding:8px 0;grid-column:1/-1">${archivedCount} archived landlord${archivedCount!==1?'s':''} ${showArchived?'shown':'hidden'} — <a href="#" onclick="event.preventDefault();const cb=document.getElementById('dir-show-archived-landlords');cb.checked=!cb.checked;renderDirSection('landlords')" style="color:var(--acc)">${showArchived?'hide':'show'} them</a></div>` : '';
  if(!ps.length){grid.innerHTML='<div class="empty"><div class="ei">🏠</div><p>No landlords yet. Click "+ Add Landlord" to get started.</p></div>'+archiveHint;return}
  grid.innerHTML = ps.map(p=>buildPersonCard(p, invs, 'var(--blue)', jobs)).join('')+archiveHint;
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
  const legacyAgents = await dAll('agents');
  const personAgents = (await dAll('persons')).filter(p=>(p.roles||[]).includes('agent'));
  const agencies = await dAll('agencies');
  const allJobs = await dAll('jobs');
  const allInvs = await dAll('invoices');

  // Populate agency filter dropdown
  const agFilt = document.getElementById('dir-agent-agency-filter');
  if(agFilt){
    const curVal = agFilt.value;
    agFilt.innerHTML = '<option value="">All Agencies</option>' + agencies.map(a=>`<option value="${a.id}" ${a.id===curVal?'selected':''}>${a.name}</option>`).join('');
  }

  // Two sources feed this list: the legacy `agents` table, and `persons`
  // records reclassified with the 'agent' role (the newer, editable-in-place
  // path — see openPersonModal). Merged here so reclassifying someone never
  // makes them disappear from the Agents view.
  let agents = [
    ...legacyAgents.map(ag=>({...ag,_src:'agents'})),
    ...personAgents.map(p=>({...p,_src:'persons'})),
  ];
  if(agencyFilter) agents = agents.filter(ag=>ag.agencyId===agencyFilter);
  if(search) agents = agents.filter(ag=>(ag.name+(ag.phone||'')+(ag.email||'')).toLowerCase().includes(search));
  const grid = document.getElementById('dir-grid-agents');
  if(!grid) return;
  if(!agents.length){grid.innerHTML='<div class="empty"><div class="ei">👔</div><p>No agents yet. Click "+ Add Agent", or mark an existing person as an Agent.</p></div>';return}
  grid.innerHTML = agents.map(ag=>{
    const agency = agencies.find(a=>a.id===ag.agencyId);
    const safeName = ag.name.replace(/'/g,"\\'");
    const editFn = ag._src==='persons' ? `openPersonModal('${ag.id}')` : `openAgentModal('${ag.id}')`;
    const agentJobs = allJobs.filter(j=>j.referrer===ag.name||j.agentName===ag.name||j.agentId===ag.id);
    const jobCount = agentJobs.length;
    const propertyCount = [...new Set(agentJobs.map(j=>j.address).filter(Boolean))].length;
    const agentInvs = allInvs.filter(i=>i.referrer===ag.name||i.agentName===ag.name||i.agentId===ag.id);
    const invTotal = agentInvs.reduce((s,i)=>s+(+(i.total||0)),0);
    return `<div class="dir-card-v2" style="--card-color:var(--purple);--card-color2:#a855f7" onclick="${editFn}">
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
          <button onclick="event.stopPropagation();${editFn}">✎ Edit</button>
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

  return`<div class="dir-card-v2" style="--card-color:${topColor};--card-color2:${roleCol}${p.archived?';opacity:.55;filter:grayscale(.4)':''}" onclick="${bulkMode?`togglePersonSelect('${p.id}')`:`openPersonModal('${p.id}')`}">
    <div class="card-top"></div>
    <!-- Bulk checkbox -->
    ${bulkMode?`<div class="bulk-chk ${isSelected?'on':''}" onclick="event.stopPropagation();togglePersonSelect('${p.id}')">${isSelected?'✓':''}</div>`:''}
    <!-- Owed badge -->
    ${owed>0?`<div class="owed-badge">£${owed.toFixed(0)} owed</div>`:''}
    ${p.archived?`<div class="owed-badge" style="background:var(--s2);color:var(--txt3);border-color:var(--border);left:8px;right:auto">🗄 Archived</div>`:''}
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
