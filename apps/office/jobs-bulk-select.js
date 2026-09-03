// Jobs list bulk actions (assign/reschedule/copy/status/delete/priority),
// quick inline cell editing, row selection (click/Ctrl/Shift, select-all),
// keyboard navigation between rows, and the priority-dot filter/bulk-set
// toolbar. Extracted from main.js verbatim (Phase 5e-4 of the follow-up
// modularization pass — see the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { logAudit } from './audit.js';
import { STATUS, localDateStr } from '@business';
import {
  S, toast, _sb, dGet, dPut, dDel, uid, nextJobNum, TODAY, getUserPerm, logActivity,
  updateBadges, renderJobs, _invalidateJobCache, _jobRowData, openJobModal, selJobs,
  queueableSave, _concurrentEach, _applyStatusChange, _renderJobsKeepScroll,
  _setPriFilterState,
} from './main.js';

async function bulkAssignEngineer(){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  const engs=(S.engineers||[]).map(e=>e.name);
  if(!engs.length){toast('No engineers configured','error');return;}
  const name=await _pickFromList('Assign to engineer:',engs);
  if(!name) return;
  let done=0,failed=0;
  await _concurrentEach(ids, async id=>{
    try{
      await _sb(`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{engineer:name,modified:Date.now()},prefer:'return=minimal'});
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  });
  _invalidateJobCache();
  if(failed) toast(`⚠ ${done} of ${ids.length} assigned to ${name} — ${failed} failed`,'warn',5000);
  else toast(`✅ Assigned ${done} job${done!==1?'s':''} to ${name}`,'success');
  clearSel(); _renderJobsKeepScroll();
}

// ── Bulk reschedule to a new date ──
async function bulkReschedule(){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  const newDate=prompt('Move selected jobs to date (YYYY-MM-DD):',TODAY());
  if(!newDate||!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){toast('Invalid date','error');return;}
  let done=0,failed=0;
  await _concurrentEach(ids, async id=>{
    try{
      await _sb(`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{date:newDate,modified:Date.now()},prefer:'return=minimal'});
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  });
  _invalidateJobCache();
  if(failed) toast(`⚠ ${done} of ${ids.length} moved to ${newDate} — ${failed} failed`,'warn',5000);
  else toast(`✅ Moved ${done} job${done!==1?'s':''} to ${newDate}`,'success');
  clearSel(); _renderJobsKeepScroll();
}

// ── Bulk copy to a new date (keeps originals) ──
async function bulkCopyToDate(){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  const newDate=prompt('Copy selected jobs to date (YYYY-MM-DD):',TODAY());
  if(!newDate||!/^\d{4}-\d{2}-\d{2}$/.test(newDate)){toast('Invalid date','error');return;}
  let done=0,failed=0;
  await _concurrentEach(ids, async id=>{
    try{
      const j=await dGet('jobs',id);
      if(!j){ failed++; return; }
      const copy={...j,id:uid(),date:newDate,status:STATUS.PENDING,created:Date.now(),modified:Date.now(),jobNum:await nextJobNum()};
      delete copy.invNumber; delete copy.linkedInvId;
      await dPut('jobs',copy); done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  });
  _invalidateJobCache();
  if(failed) toast(`⚠ ${done} of ${ids.length} copied to ${newDate} — ${failed} failed`,'warn',5000);
  else toast(`✅ Copied ${done} job${done!==1?'s':''} to ${newDate}`,'success');
  clearSel(); _renderJobsKeepScroll();
}

// ── Bulk set status ── (shares _applyStatusChange with quickStatus so cert
// creation, notifications, and audit logging never drift between the two —
// see JS Refactoring Finding 9)
async function bulkSetStatus(){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  const status=await _pickFromList('Set status to:',['Pending','In Progress','Engineer Completed','Completed','Invoiced','Cannot Access','Cancelled']);
  if(!status) return;
  // Sequential, not concurrent: onJobComplete()/createCertEntry() coordinate
  // through a shared _pendCertJob global, so completing several jobs at
  // once in parallel would race and could attach a cert to the wrong job.
  let done=0,failed=0;
  for(const id of ids){
    const ok=await _applyStatusChange(id,status,{silent:true});
    if(ok) done++; else failed++;
  }
  if(failed) toast(`⚠ ${done} of ${ids.length} set to ${status} — ${failed} failed`,'warn',5000);
  else toast(`✅ ${done} job${done!==1?'s':''} → ${status}`,'success');
  clearSel(); _renderJobsKeepScroll(); updateBadges();
}

// ── Bulk delete ──
async function bulkDeleteJobs(){
  if(!getUserPerm('canDelete')){ toast('❌ You do not have permission to delete jobs','error'); return; }
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  if(!confirm(`Delete ${ids.length} selected job${ids.length!==1?'s':''}? This cannot be undone.`)) return;
  let done=0,failed=0;
  await _concurrentEach(ids, async id=>{
    try{
      const j=await dGet('jobs',id).catch(()=>null);
      await dDel('jobs',id);
      await logActivity('Job deleted','job');
      if(j) await logAudit('job_delete',{
        jobId:id, jobNum:j.jobNum||j.jobnum||'',
        address:j.address||'', note:`Status was: ${j.status||'unknown'} (bulk delete)`
      });
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  });
  _invalidateJobCache();
  if(failed) toast(`⚠ ${done} of ${ids.length} deleted — ${failed} failed`,'warn',5000);
  else toast(`✅ Deleted ${done} job${done!==1?'s':''}`,'success');
  clearSel(); _renderJobsKeepScroll();
}

// ── Quick inline time edit ──
// Shared mechanics for turning a "click to edit" cell into a real inline
// <input> — replaces the native prompt() dialog previously used here, which
// blocks the whole tab, can't be styled, and has no Escape-to-cancel or
// click-outside-to-cancel affordance a real spreadsheet cell would have
// (UX & Automation Finding 7). Field-specific validation/save logic stays
// in each caller; this only handles the DOM swap and focus/blur/Enter/Escape.
function _startInlineEditCell(spanEl,{value,inputType='text',onSave,formatDisplay}){
  if(spanEl._editing) return; // already editing — ignore a second click
  spanEl._editing=true;
  const input=document.createElement('input');
  input.type=inputType;
  input.value=value;
  input.style.cssText=`width:${Math.max(spanEl.offsetWidth,40)}px;font:inherit;color:inherit;background:var(--s1);border:1.5px solid var(--acc);border-radius:4px;padding:0 3px;box-sizing:border-box`;
  if(inputType==='number'){ input.step='0.01'; input.min='0'; }
  spanEl.insertAdjacentElement('afterend',input);
  spanEl.style.display='none';
  input.focus(); input.select();

  let settled=false;
  const finish=async(commit)=>{
    if(settled) return; settled=true;
    if(commit && input.value!==String(value)){
      try{
        await onSave(input.value);
        spanEl.textContent=formatDisplay(input.value);
      }catch(e){ toast('Update failed: '+(e.message||'').slice(0,80),'error'); }
    }
    input.remove();
    spanEl.style.display='';
    spanEl._editing=false;
  };
  input.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Enter'){ e.preventDefault(); finish(true); }
    else if(e.key==='Escape'){ e.preventDefault(); finish(false); }
  });
  input.addEventListener('click',e=>e.stopPropagation());
  input.addEventListener('blur',()=>finish(true));
}

function quickEditTime(id,current,spanEl){
  _startInlineEditCell(spanEl,{
    value:current||'',
    inputType:'text',
    formatDisplay:v=>v||'—',
    onSave:async newVal=>{
      const r=await queueableSave(`Time slot — ${newVal}`,`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{timeslot:newVal,modified:Date.now()},prefer:'return=minimal'});
      if(r.queued) toast('📴 Offline — will sync when back online','warn',3000);
      _invalidateJobCache();
    }
  });
}

// ── Quick inline price edit ──
function quickEditPrice(id,current,spanEl){
  _startInlineEditCell(spanEl,{
    value:current||'0',
    inputType:'number',
    formatDisplay:v=>{const n=parseFloat(v)||0;return n>0?'£'+n.toFixed(0):'—';},
    onSave:async newVal=>{
      const num=parseFloat(newVal)||0;
      const r=await queueableSave(`Price — £${num}`,`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{price:num,modified:Date.now()},prefer:'return=minimal'});
      if(r.queued) toast('📴 Offline — will sync when back online','warn',3000);
      _invalidateJobCache();
    }
  });
}

// ── Copy single job to next day ──
async function copyJobToNextDay(id){
  const j = await dGet('jobs',id);
  if(!j) return;
  // Same local-midnight-constructor issue as shiftDay() above -- wrong by a
  // full day, every time, during BST if serialized via toISOString().
  const d = new Date((j.date||TODAY())+'T00:00:00');
  d.setDate(d.getDate()+1);
  const nextDate = localDateStr(d);
  const copy = {...j, id:uid(), date:nextDate, status:STATUS.PENDING, created:Date.now(), modified:Date.now()};
  delete copy.invNumber; delete copy.linkedInvId;
  try{
    copy.jobNum = await nextJobNum();
    await dPut('jobs', copy);
    _invalidateJobCache();
    toast(`✅ Job copied to ${nextDate}`, 'success');
    renderJobs();
  }catch(e){ toast('Copy failed: '+e.message,'error'); }
}

// ── Helper: pick from a dropdown list ──
function _pickFromList(title, options){
  return new Promise(resolve=>{
    const overlay = document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border2);border-radius:12px;padding:20px;min-width:280px;box-shadow:var(--sh2)">
      <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:var(--txt)">${title}</div>
      <select id="_pick-sel" class="fs" style="width:100%;margin-bottom:14px">
        ${options.map(o=>`<option value="${o}">${o}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="this.closest('div[style*=fixed]').remove();window._pickResolve(null)">Cancel</button>
        <button class="btn btn-acc btn-sm" onclick="window._pickResolve(document.getElementById('_pick-sel').value);this.closest('div[style*=fixed]').remove()">Confirm</button>
      </div>
    </div>`;
    window._pickResolve = resolve;
    document.body.appendChild(overlay);
    setTimeout(()=>document.getElementById('_pick-sel')?.focus(),50);
  });
}

// ── Keep bulk count in sync ──
let _origUpdateBulkBar=null;

function updateBulkBar(){
  // The #j-bulk toolbar (Assign/Move/Copy/Merge/Status/Delete) was never
  // actually being shown — nothing in the file ever set its display away
  // from the static markup's "display:none", so it was unreachable via the
  // UI regardless of how many jobs were selected. This is the fix.
  const bar=document.getElementById('j-bulk');
  if(bar) bar.style.display = selJobs.size>0 ? 'flex' : 'none';
  const countEl = document.getElementById('bulk-count');
  if(countEl) countEl.textContent = selJobs.size > 0 ? `${selJobs.size} selected` : '';
  // Call original if it exists and is different from this function
  if(_origUpdateBulkBar && _origUpdateBulkBar !== updateBulkBar){
    _origUpdateBulkBar();
  }
}

// ── Selection helpers ──
function clearSel(){
  document.querySelectorAll('.jsr3.jsr-selected').forEach(r=>r.classList.remove('jsr-selected'));
  selJobs.clear();
  _lastSelId=null;
  updateBulkBar();
  updatePriDotsVisibility();
  // Also clear checkboxes
  document.querySelectorAll('.jsr-sel-check').forEach(c=>{
    c.setAttribute('aria-checked','false');
    const d=c.querySelector('div');
    if(d){ d.style.cssText='width:14px;height:14px;border-radius:3px;border:1.5px solid var(--border2);background:transparent;'; d.innerHTML='&nbsp;'; }
  });
}

// Selects every job row currently rendered (i.e. matching whatever
// search/filter/date view is active) — the bulk toolbar had no fast way to
// select more than one row at a time short of Shift-click (UX & Automation
// Finding 2).
function selectAllVisibleJobs(){
  const rows=[...document.querySelectorAll('#jobs-list-scroll .jsr3[data-id]')];
  if(!rows.length){ toast('No jobs currently shown to select','info'); return; }
  rows.forEach(row=>{
    const id=row.dataset.id;
    if(!id||selJobs.has(id)) return;
    selJobs.add(id);
    row.classList.add('jsr-selected');
    const checkEl=row.querySelector('.jsr-sel-check');
    if(checkEl){
      checkEl.setAttribute('aria-checked','true');
      const checkDiv=checkEl.querySelector('div');
      if(checkDiv){ checkDiv.style.cssText='width:14px;height:14px;border-radius:3px;border:1.5px solid var(--acc);background:var(--acc);color:#fff;'; checkDiv.innerHTML='✓'; }
    }
  });
  _lastSelId=rows[rows.length-1].dataset.id;
  updateBulkBar();updatePriDotsVisibility();
  toast(`✅ Selected ${selJobs.size} job${selJobs.size!==1?'s':''}`,'success',1500);
}

function toggleSelRow(id,el){
  const div=el.querySelector('div');
  if(selJobs.has(id)){
    selJobs.delete(id);
    div.style.cssText='width:14px;height:14px;border-radius:3px;border:1.5px solid var(--border2);background:transparent;';
    div.innerHTML='&nbsp;';
    el.setAttribute('aria-checked','false');
    el.closest('.jsr3').classList.remove('jsr-selected');
  }else{
    selJobs.add(id);
    div.style.cssText='width:14px;height:14px;border-radius:3px;border:1.5px solid var(--acc);background:var(--acc);color:#fff;';
    div.innerHTML='✓';
    el.setAttribute('aria-checked','true');
    el.closest('.jsr3').classList.add('jsr-selected');
  }
  _lastSelId=id;updateBulkBar();updatePriDotsVisibility();
}

// Keyboard equivalent of drag-to-reorder — the drag handle previously had
// no non-mouse way to change a job's position within its day at all
// (Accessibility Finding 4). Renumbers the whole day's sortOrder the same
// way the mouse-drag drop handler does ((i+1)*1000, spaced), so it produces
// an identical result whether you dragged or pressed Arrow Up/Down.
async function _moveJobOrder(jobId,direction){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  const job=_jobRowData[jobId];
  if(!job) return;
  const dayRows=[...scroll.querySelectorAll('.jsr3[data-id]')].filter(r=>{
    const rj=_jobRowData[r.dataset.id];
    return rj && rj.date===job.date;
  });
  const idx=dayRows.findIndex(r=>r.dataset.id===jobId);
  const targetIdx=idx+direction;
  if(idx===-1||targetIdx<0||targetIdx>=dayRows.length) return; // already first/last
  const ids=dayRows.map(r=>r.dataset.id);
  [ids[idx],ids[targetIdx]]=[ids[targetIdx],ids[idx]];
  const now=Date.now();
  const saves=ids.map((id,i)=>{
    const j=_jobRowData[id]; if(!j) return null;
    const newOrd=(i+1)*1000;
    if(j._sortOrder===newOrd) return null;
    j._sortOrder=newOrd; j.modified=now;
    return _sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{sortorder:newOrd,modified:now},prefer:'return=minimal'});
  }).filter(Boolean);
  try{ await Promise.all(saves); }catch(e){ toast('Reorder failed: '+(e.message||'').slice(0,80),'error'); }
  _invalidateJobCache();
  _renderJobsKeepScroll();
  // Keep focus on the same job's handle so repeated Arrow presses keep moving it
  requestAnimationFrame(()=>{
    document.querySelector(`.jsr3[data-id="${jobId}"] .jsr-drag-handle`)?.focus();
  });
}

// ── Multi-Select Job Rows (Ctrl+click, Shift+click) ──
let _lastSelId=null;

function initJobMultiSelect(){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll||scroll._msInited)return;
  scroll._msInited=true;
  scroll.addEventListener('click',e=>{
    const row=e.target.closest('.jsr3[data-id]');
    if(!row)return;
    // Don't trigger if clicking buttons, selects, drag handle, or editable fields
    if(e.target.closest('button')||e.target.closest('select')||e.target.closest('.jsr-drag-handle')||e.target.closest('[onclick]'))return;
    const id=row.dataset.id;
    if(!id)return;
    if(e.ctrlKey||e.metaKey){
      e.preventDefault();e.stopPropagation();
      if(selJobs.has(id)){selJobs.delete(id);row.classList.remove('jsr-selected');}
      else{selJobs.add(id);row.classList.add('jsr-selected');_lastSelId=id;}
      updateBulkBar();updatePriDotsVisibility();return;
    }
    if(e.shiftKey&&_lastSelId){
      e.preventDefault();e.stopPropagation();
      const allRows=[...scroll.querySelectorAll('.jsr3[data-id]')];
      const idxFrom=allRows.findIndex(r=>r.dataset.id===_lastSelId);
      const idxTo=allRows.findIndex(r=>r.dataset.id===id);
      if(idxFrom>=0&&idxTo>=0){
        const [start,end]=idxFrom<idxTo?[idxFrom,idxTo]:[idxTo,idxFrom];
        for(let i=start;i<=end;i++){
          const rid=allRows[i].dataset.id;
          if(rid){selJobs.add(rid);allRows[i].classList.add('jsr-selected');}
        }
      }
      updateBulkBar();updatePriDotsVisibility();return;
    }
    // Normal click (no modifier) — if clicking an unselected row, clear others first
    if(!selJobs.has(id)){
      clearSel();
    }
  });
}

// ── Keyboard navigation between job rows ──
// Rows now have tabindex="0" (see renderJobs' row template), so a keyboard
// user can Tab into the list and use arrow keys to browse it — previously
// the only way to reach a row at all was Tab-ing past its status <select>
// and action buttons one at a time (Accessibility Finding 1). Scoped to
// row-level navigation, not full per-cell grid navigation — moving between
// individual columns would need every cell to be independently focusable,
// a much larger restructure than this pass is taking on.
function initJobKeyboardNav(){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll||scroll._kbInited)return;
  scroll._kbInited=true;
  scroll.addEventListener('keydown',e=>{
    // Only handle when the ROW itself has focus — not a nested select,
    // button, checkbox, or inline-edit input, all of which have their own
    // native keyboard behavior that must not be hijacked.
    if(!e.target.classList || !e.target.classList.contains('jsr3')) return;
    const rows=[...scroll.querySelectorAll('.jsr3[data-id]')];
    const idx=rows.indexOf(e.target);
    if(idx===-1) return;
    if(e.key==='ArrowDown'){
      e.preventDefault();
      (rows[idx+1]||rows[idx]).focus();
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      (rows[idx-1]||rows[idx]).focus();
    } else if(e.key==='Home'){
      e.preventDefault();
      rows[0]?.focus();
    } else if(e.key==='End'){
      e.preventDefault();
      rows[rows.length-1]?.focus();
    } else if(e.key==='Enter'||e.key===' '){
      e.preventDefault();
      openJobModal(e.target.dataset.id);
    }
  });
}

// ── Priority Dot Toolbar ──
function updatePriDotsVisibility(){
  const bar=document.getElementById('pri-dots-bar');
  if(!bar)return;
  bar.style.display='flex';
  const label=bar.querySelector('.pri-dot-txt');
  if(label)label.textContent=selJobs.size>0?'Set Priority ('+selJobs.size+'):':'Filter:';
}

function handlePriDotClick(priority){
  if(selJobs.size>0){
    bulkSetPriority(priority);
  }else{
    setPriFilter(priority);
  }
}

function setPriFilter(priority){
  _setPriFilterState(priority||'');
  renderJobs();
  document.querySelectorAll('.pri-dot').forEach(d=>d.classList.toggle('on',d.dataset.pri===priority));
}

function priClass(p){
  return{'Certificate':'cert','Repair':'repair','Urgent':'urg','Emergency':'emg','Normal':'normal'}[p]||'';
}

async function bulkSetPriority(priority){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}

  // INSTANT visual update — no waiting
  const priMap={'Certificate':'jsr-cert','Repair':'jsr-repair','Urgent':'jsr-urg','Emergency':'jsr-emg','Normal':'jsr-normal','Low':'jsr-low'};
  const newClass=priMap[priority]||'';
  const prevPriority={}; // so a failed PATCH can be rolled back below instead of leaving the UI wrong
  ids.forEach(id=>{
    const row=document.querySelector('.jsr3[data-id="'+id+'"]');
    if(row){
      row.classList.remove('jsr-cert','jsr-repair','jsr-urg','jsr-emg','jsr-normal','jsr-low');
      if(newClass) row.classList.add(newClass);
      // Flash animation to show the change
      row.classList.add('jsr-pri-flash');
      setTimeout(()=>row.classList.remove('jsr-pri-flash'),600);
    }
    // Also update _jobRowData so the change persists
    const j=_jobRowData[id];
    if(j){ prevPriority[id]=j.priority; j.priority=priority; }
  });
  clearSel();

  // The success toast used to fire immediately here, based only on the
  // optimistic UI update above — even if every PATCH below then failed
  // silently (each had its own swallowed .catch). Wait for the real
  // results and report honestly instead (UX & Automation Finding 5).
  const now=Date.now();
  const results=await Promise.allSettled(ids.map(id=>
    _sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{priority:priority,modified:now},prefer:'return=minimal'})
  ));
  const failedIds=ids.filter((id,i)=>results[i].status==='rejected');
  if(failedIds.length){
    failedIds.forEach(id=>{ const j=_jobRowData[id]; if(j) j.priority=prevPriority[id]; });
    _invalidateJobCache();
    _renderJobsKeepScroll();
    toast(`⚠ ${ids.length-failedIds.length} of ${ids.length} set to ${priority} — ${failedIds.length} failed and were reverted`,'warn',6000);
  } else {
    toast(ids.length+' job'+(ids.length!==1?'s':'')+' → '+priority,'success',1500);
  }
}

export {
  bulkAssignEngineer, bulkReschedule, bulkCopyToDate, bulkSetStatus, bulkDeleteJobs,
  quickEditTime, quickEditPrice, copyJobToNextDay, updateBulkBar, clearSel,
  selectAllVisibleJobs, toggleSelRow, _moveJobOrder, initJobMultiSelect, initJobKeyboardNav,
  updatePriDotsVisibility, handlePriDotClick, setPriFilter, priClass, bulkSetPriority,
};
