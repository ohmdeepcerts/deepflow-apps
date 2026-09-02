// Engineer Planner — the "＋ Add Visit from Projects" picker: a searchable
// list of jobs with 2+ real visits ("running projects"), used to jump back
// into an existing multi-visit job rather than starting a new one. Extracted
// from planner.js verbatim (Phase 4 of the follow-up modularization pass) —
// no behaviour changes.
//
// This module and main.js (and the other planner-*.js files) import from
// each other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time.

import { escHtml } from '@ui';
import { formatDateUK } from '@business';
import { dAll } from './main.js';
import { el, resolveContact } from './planner-core.js';
import { openJobDetails } from './planner-detail.js';
// openJobModal/toggleAddVisitForm aren't ES exports of main.js (only
// exposed on window for inline HTML handlers), so they're called via
// window here rather than imported.

// ════════════════════════════════════════════════════════════════
//  RUNNING PROJECTS PICKER — "＋ Add Visit from Projects"
// ════════════════════════════════════════════════════════════════

let _projectPickerCache = null;

async function loadProjectGroups(){
  const [jobs, visits] = await Promise.all([dAll('jobs'), dAll('job_visits')]);
  const byJob = {};
  visits.forEach(v=>{ (byJob[v.jobId]=byJob[v.jobId]||[]).push(v); });
  const groups = Object.entries(byJob)
    .filter(([,list])=>list.length>=2) // a "project" = 2+ real visits, not a status
    .map(([jobId,list])=>{
      const job = jobs.find(j=>j.id===jobId);
      if(!job) return null;
      // dAll('job_visits') returns mapped camelCase (visitDate), not the
      // raw column name (visit_date) — mixing the two up here would sort
      // by an always-undefined field and silently misorder "latest visit".
      list.sort((a,b)=>(a.visitDate||'').localeCompare(b.visitDate||''));
      const latest = list[list.length-1];
      const engs = [...new Set(list.flatMap(v=>v.engineers||[]))];
      return {job, visits:list, latest, engs};
    })
    .filter(Boolean)
    .sort((a,b)=>(b.latest.visitDate||'').localeCompare(a.latest.visitDate||''));
  return groups;
}

export async function openProjectPicker(){
  _projectPickerCache = await loadProjectGroups();
  el('dfpProjectPickerSearch').value='';
  renderProjectPickerList();
  el('dfpProjectPickerBackdrop').classList.add('show');
  setTimeout(()=>el('dfpProjectPickerSearch').focus(),40);
}

export function closeProjectPicker(){
  el('dfpProjectPickerBackdrop').classList.remove('show');
}

export function renderProjectPickerList(){
  const q=(el('dfpProjectPickerSearch').value||'').trim().toLowerCase();
  const contact = g=>resolveContact(g.job);
  const groups = (_projectPickerCache||[]).filter(g=>{
    if(!q) return true;
    const c=contact(g);
    return [g.job.jobNum,g.job.address,c.name].filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  el('dfpProjectPickerList').innerHTML = groups.length ? groups.map(g=>{
    const c=contact(g);
    return `<div class="project-pick-card">
      <div class="project-pick-job"><b>${escHtml(g.job.jobNum||'')}</b><span>${g.visits.length} visit${g.visits.length===1?'':'s'}</span></div>
      <div class="project-pick-main"><b>${escHtml(g.job.address||'')}</b><span>${escHtml(c.name||'—')} · ${g.engs.length} engineer${g.engs.length===1?'':'s'}</span></div>
      <div class="project-pick-meta"><small>Latest visit</small><b>${formatDateUK(g.latest.visitDate)||g.latest.visitDate||'—'}</b></div>
      <button class="open-project-btn" data-view-project="${g.job.id}">View</button>
      <button class="add-next-visit" data-add-project-visit="${g.job.id}">＋ Add Visit ${g.visits.length+1}</button>
    </div>`;
  }).join('') : `<div class="picker-empty">No running projects match this search.</div>`;
}

function startProjectVisit(jobId){
  closeProjectPicker();
  window.openJobModal(jobId);
  setTimeout(()=>window.toggleAddVisitForm && window.toggleAddVisitForm(), 200);
}

document.addEventListener('click', e=>{
  const addBtn = e.target.closest('#dfpProjectPickerList [data-add-project-visit]');
  if(addBtn){ startProjectVisit(addBtn.dataset.addProjectVisit); return; }
  const viewBtn = e.target.closest('#dfpProjectPickerList [data-view-project]');
  if(viewBtn){ closeProjectPicker(); openJobDetails(viewBtn.dataset.viewProject); return; }
});
