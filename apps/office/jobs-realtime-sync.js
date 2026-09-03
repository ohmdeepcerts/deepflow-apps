// Live updates for the Jobs list: Supabase polling fallback and Supabase
// Realtime (WebSocket) sync, including the in-place row-patch optimization
// that avoids a full re-render for small changes. Extracted from main.js
// verbatim (Phase 5e-2 of the follow-up modularization pass — see the plan
// file for scope) — no behaviour changes.
//
// The live-sync badge helpers (_setLiveBadge/_setSyncing/_setSynced/
// _setOffline/_flashSynced) stay in main.js — _sb() itself calls them
// defensively on every request, so they can't move without main.js's core
// fetch function depending on this module instead of the reverse. This
// module imports them back, same as it imports everything else it needs
// from main.js.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { escHtml } from '@ui';
import { fromDb as _fromDb } from '@data';
import { STATUS, getChangedFields } from '@business';
import { _pushNotif } from './notifications-panel.js';
import {
  _sb, _fix, S, _supaAuth, nav, toast, openJobModal, editJid,
  _jobRowData, _jobCache, _setJobCache, renderJobs, _invalidateJobCache,
  _setLiveBadge, _setSyncing, _setSynced, _setOffline,
} from './main.js';

let _notifPollInterval=null;

// ── Supabase polling for live updates ──────────────────────────
let _pollLastJobMod=0;
let _pollLastReqTs=0;
let _pollKnownJobs={};

// ── Live poll ─────────────────────────────────────────────────────────────────
// ISSUE 1 FIX: Old _pollTick fetched ALL jobs every 15s (full table scan).
// New approach: poll only a single sentinel row (max modified timestamp + count).
// If changed → fetch only the delta (new/changed jobs since last known state).
// Result: 1 tiny query every 15s instead of potentially MBs of data.

let _pollLastModified = 0; // timestamp of last known change
let _pollJobCount     = 0; // total job count for new-job detection

export async function startLivePoll(){
  if(_rtConnected) return; // Realtime is active — no need to poll
  if(_notifPollInterval) clearInterval(_notifPollInterval);
  // Seed initial state — just grab the sentinel, no full fetch
  try{
    const sentinel = await _sb('jobs?select=modified,created&order=modified.desc&limit=1');
    if(sentinel?.[0]) _pollLastModified = sentinel[0].modified || 0;
    const cnt = await _sb('jobs?select=id');
    _pollJobCount = cnt?.length || 0;
    // Seed known jobs map from cache if available (avoids extra fetch)
    if(_jobCache) _jobCache.forEach(j=>{ _pollKnownJobs[j.id]=j.status; });
    // Seed last engineer request timestamp
    const reqs = await _sb('engineer_requests?order=created.desc&limit=1');
    if(reqs?.[0]) _pollLastReqTs = reqs[0].created || 0;
  }catch(e){ console.warn('[DeepFlow] poll seed error', e); }
  _notifPollInterval = setInterval(_pollTick, 5000);
}

async function _pollTick(){
  if(_rtConnected) return; // Realtime handles updates
  if(!navigator.onLine){ _setOffline(); return; }
  _setSyncing();
  try{
    // 1. LIGHTWEIGHT SENTINEL CHECK — one row, two columns
    const sentinel = await _sb('jobs?select=modified,created&order=modified.desc&limit=1');
    const latestMod = sentinel?.[0]?.modified || 0;
    const cnt = await _sb('jobs?select=id');
    const newCount = cnt?.length || 0;

    const hasChanges  = latestMod > _pollLastModified;
    const hasNewJobs  = newCount  > _pollJobCount;

    if(hasChanges || hasNewJobs){
      // Only now fetch the actual changed rows — jobs modified since last poll
      const since = _pollLastModified;
      const changed = await _sb(`jobs?modified=gt.${since}&select=id,status,jobnum,address,created,modified&order=modified.desc&limit=50`);
      _pollLastModified = latestMod;
      _pollJobCount     = newCount;

      (changed || []).forEach(j=>{
        const jc = _fromDb('jobs', j);
        const prev = _pollKnownJobs[jc.id];
        if(prev === undefined){
          // New job
          _pollKnownJobs[jc.id] = jc.status;
          if(Date.now() - (jc.created||0) < 90000){
            _pushNotif('New job added', `${jc.jobNum||''} ${jc.address||''}`.trim(), '➕', ()=>{ openJobModal(jc.id); nav('jobs'); });
          }
        } else if(prev !== jc.status){
          // Status changed
          _pollKnownJobs[jc.id] = jc.status;
          const icon = {[STATUS.COMPLETED]:'✅',[STATUS.IN_PROGRESS]:'🔨',[STATUS.INVOICED]:'◎',[STATUS.PENDING]:'⏳',[STATUS.CANCELLED]:'✕'}[jc.status]||'🔔';
          _pushNotif(`Job updated — ${jc.status}`, `${jc.jobNum||''} ${jc.address||''}`.trim(), icon, ()=>{ openJobModal(jc.id); nav('jobs'); });
        }
      });
      // Invalidate job cache so next render gets fresh data
      _invalidateJobCache();
    }

    // 2. Engineer requests — still lightweight (limit 50, newest first)
    try{
      const reqs = await _sb('engineer_requests?order=created.desc&limit=50');
      if(reqs?.length){
        const pending = reqs.filter(r=>r.status==='pending').length;
        const badge   = document.getElementById('nb-req');
        if(badge){ badge.textContent=pending; badge.style.display=pending?'inline':'none'; }
        reqs.forEach(r=>{
          if((r.created||0) > _pollLastReqTs){
            _pollLastReqTs = Math.max(_pollLastReqTs, r.created||0);
            const typeLabel = {overtime:'Overtime',leave:'Leave',other:'Other'}[r.type]||r.type||'request';
            _pushNotif(`📬 ${r.engineer_name||'Engineer'} — ${typeLabel}`, `${r.notes||''}`.slice(0,80), '🛠', ()=>{ nav('req'); });
          }
        });
      }
    }catch(e){ console.warn('[DeepFlow] poll requests error', e); }
    _setSynced(); // poll succeeded

  }catch(e){
    console.warn('[DeepFlow] poll tick error', e);
    if(!navigator.onLine) _setOffline();
    else _setLiveBadge('offline','Sync error — retrying');
  }
}

// ══════════════════════════════════════════════════════════════
//  SUPABASE REALTIME — live sync for multi-user collaboration
//  Replaces polling with WebSocket for sub-second updates
// ══════════════════════════════════════════════════════════════
let _rtChannel = null;
let _rtConnected = false;
let _rtReconnectTimer = null;

// Start Realtime (call this after login)
export function startRealtimeSync(){
  if(!_supaAuth) return;
  if(_rtChannel) { try{_rtChannel.unsubscribe();}catch(e){} }

  _rtChannel = _supaAuth
    .channel('jobs-realtime')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'jobs'
    }, payload => {
      handleRealtimeChange(payload);
    })
    .subscribe((status, err) => {
      if(status === 'SUBSCRIBED') {
        _rtConnected = true;
        _setLiveBadge('live','Real-time');
        console.log('[DeepFlow] Realtime connected');
        // Stop polling — Realtime is active
        if(_notifPollInterval) { clearInterval(_notifPollInterval); _notifPollInterval = null; }
      } else if(status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        _rtConnected = false;
        console.warn('[DeepFlow] Realtime disconnected:', err);
        _setLiveBadge('offline','Reconnecting…');
        // Fall back to polling
        startLivePoll();
        // Try to reconnect in 10 seconds
        if(_rtReconnectTimer) clearTimeout(_rtReconnectTimer);
        _rtReconnectTimer = setTimeout(startRealtimeSync, 10000);
      }
    });
}

// Handle incoming real-time changes
async function handleRealtimeChange(payload){
  const { eventType, new: newRow, old: oldRow } = payload;

  if(eventType === 'INSERT') {
    const job = _fix(newRow);
    _jobRowData[job.id] = job;
    _pollKnownJobs[job.id] = job.status;
    // Add to cache — but only if it isn't already there. When THIS session
    // creates a job, saveJob() already adds it locally and re-renders
    // before Realtime's echo of our own INSERT typically arrives back —
    // pushing unconditionally here duplicated every newly-created job in
    // the visible list until the next full refresh silently deduped it.
    if(_jobCache && !_jobCache.some(j=>j.id===job.id)) _jobCache.push(job);
    _pushNotif('New job added', `${job.jobNum||''} ${job.address||''}`.trim(), '➕', ()=>{ openJobModal(job.id); nav('jobs'); });
    // Only re-render if we're on the jobs page and the date range includes this job
    const jobsPage = document.getElementById('pg-jobs');
    if(jobsPage && jobsPage.classList.contains('active')) {
      renderJobs();
    }
    return;
  }

  if(eventType === 'DELETE') {
    const id = oldRow?.id;
    if(!id) return;
    delete _jobRowData[id];
    if(_jobCache) _setJobCache(_jobCache.filter(j => j.id !== id));
    delete _pollKnownJobs[id];
    // Remove from DOM with animation
    const row = document.querySelector(`.jsr3[data-id="${id}"]`);
    if(row) {
      row.style.transition = 'all .3s ease';
      row.style.opacity = '0';
      row.style.transform = 'translateX(-20px)';
      setTimeout(() => row.remove(), 300);
    }
    return;
  }

  if(eventType === 'UPDATE') {
    const id = newRow?.id;
    if(!id) return;
    const job = _fix(newRow);
    const prev = _jobRowData[id];
    _jobRowData[id] = job;
    if(_jobCache) {
      const idx = _jobCache.findIndex(j => j.id === id);
      if(idx >= 0) _jobCache[idx] = job;
    }
    _pollKnownJobs[id] = job.status;

    // Conflict detection: someone else updated a job we're editing
    if(editJid === id) {
      toast('⚠️ This job was updated by another user. Save carefully to avoid overwriting their changes.', 'warn', 8000);
      // Flash the modal border
      const mo = document.getElementById('mo-job');
      if(mo) { mo.style.boxShadow = '0 0 0 3px rgba(245,166,35,.5)'; setTimeout(()=>mo.style.boxShadow='',3000); }
      return;
    }

    // Smart in-place DOM update — only re-render the changed row
    const updatedFields = getChangedFields(prev, job);
    if(updatedFields.length === 0) return; // nothing visual changed

    const row = document.querySelector(`.jsr3[data-id="${id}"]`);
    // 'date' can never be patched in place — it moves the row to a different
    // date-grouped section of the list, which needs a full re-render to get
    // the grouping right, not a cell-level DOM patch.
    if(row && updatedFields.length <= 3 && !updatedFields.includes('date')) {
      // Small change — update in-place without full re-render
      updateRowInPlace(row, prev, job, updatedFields);
    } else {
      // Big change (date moved, etc.) — need full re-render
      const jobsPage = document.getElementById('pg-jobs');
      if(jobsPage && jobsPage.classList.contains('active')) {
        // Preserve scroll position
        const pane = document.getElementById('jobs-list-pane');
        const scrollTop = pane ? pane.scrollTop : 0;
        renderJobs();
        if(pane) pane.scrollTop = scrollTop;
      }
    }

    // Notification for status changes — arrival/departure phrased specially
    if(prev && prev.status !== job.status) {
      const icon = {[STATUS.COMPLETED]:'✅',[STATUS.ENGINEER_COMPLETED]:'🔷',[STATUS.IN_PROGRESS]:'🔨',[STATUS.INVOICED]:'◎',[STATUS.PENDING]:'⏳'}[job.status]||'🔔';
      let title;
      if(job.status===STATUS.IN_PROGRESS) title=`Engineer arrived — ${job.engineer||'Engineer'}`;
      else if(job.status===STATUS.ENGINEER_COMPLETED) title=`Engineer completed & left — needs review — ${job.engineer||'Engineer'}`;
      else if(job.status===STATUS.COMPLETED) title=`Job finalized`;
      else title=`Job updated — ${job.status}`;
      _pushNotif(title, `${job.jobNum||''} ${job.address||''}`.trim(), icon, ()=>{ openJobModal(job.id); nav('jobs'); });
    }

    // Notification for priority changes
    if(prev && prev.priority !== job.priority) {
      _pushNotif(`Priority changed — ${job.priority||'Normal'}`, `${job.jobNum||''} ${job.address||''}`.trim(), '🔔', ()=>{ openJobModal(job.id); nav('jobs'); });
    }
  }
}


// Update a single row in-place without re-rendering the entire list
function updateRowInPlace(row, prev, job, changedFields){
  // Safety net: if a field changed that this function has no branch for
  // (e.g. jobNum, or anything added to getChangedFields() in future without
  // a matching branch here), silently doing nothing would drop the change
  // from the screen — the exact bug this replaces. Fall back to a full,
  // scroll-preserving re-render instead whenever that happens.
  const HANDLED=['priority','status','engineer','timeSlot','price','address','description'];
  if(changedFields.some(f=>!HANDLED.includes(f))){
    const jobsPage = document.getElementById('pg-jobs');
    if(jobsPage && jobsPage.classList.contains('active')) {
      const pane = document.getElementById('jobs-list-pane');
      const scrollTop = pane ? pane.scrollTop : 0;
      renderJobs();
      if(pane) pane.scrollTop = scrollTop;
    }
    return;
  }

  // Priority change — update CSS class with smooth transition
  if(changedFields.includes('priority')) {
    row.classList.remove('jsr-cert','jsr-repair','jsr-urg','jsr-emg','jsr-normal','jsr-low');
    const priMap = {'Certificate':'jsr-cert','Repair':'jsr-repair','Urgent':'jsr-urg','Emergency':'jsr-emg','Normal':'jsr-normal','Low':'jsr-low'};
    if(priMap[job.priority||'Normal']) row.classList.add(priMap[job.priority||'Normal']);
    row.style.transition = 'background .4s ease, border-left-color .4s ease';
    // Brief flash to draw attention
    row.style.boxShadow = 'inset 0 0 20px rgba(245,166,35,.15)';
    setTimeout(() => row.style.boxShadow = '', 1500);
  }

  // Status change — update status stripe + dropdown
  if(changedFields.includes('status')) {
    const stripe = row.querySelector('.jsr-stripe');
    if(stripe) {
      stripe.className = 'jsr-stripe';
      const sc = {'Pending':'jsr-stripe-pending','In Progress':'jsr-stripe-progress','Completed':'jsr-stripe-done','Invoiced':'jsr-stripe-invoiced','Cannot Access':'jsr-stripe-noaccess','Cancelled':'jsr-stripe-cancelled','Emergency':'jsr-stripe-emg'}[job.status]||'jsr-stripe-pending';
      stripe.classList.add(sc);
    }
    // Update status dropdown
    const sel = row.querySelector('.jsr-sel');
    if(sel) sel.value = job.status;
  }

  // Engineer change — update engineer cell + colour bar
  if(changedFields.includes('engineer')) {
    const engCell = row.querySelector('.jsr3-cell-eng');
    if(engCell) {
      const palette=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623','#ec4899','#06b6d4'];
      const engs=(S.engineers||[]);
      const idx=engs.findIndex(e=>e.name===job.engineer);
      const col=palette[idx>=0?idx%palette.length:Math.abs((job.engineer||' ').charCodeAt(0))%palette.length];
      engCell.innerHTML = job.engineer ? `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0"></span>${job.engineer}</span>` : '—';
    }
  }

  // Time slot change
  if(changedFields.includes('timeSlot')) {
    const timeCell = row.querySelector('.jsr3-cell-time span');
    if(timeCell) timeCell.textContent = job.timeSlot || '—';
  }

  // Price change
  if(changedFields.includes('price')) {
    const priceCell = row.querySelector('.jsr3-cell-price span');
    if(priceCell) priceCell.textContent = job.price ? `£${Number(job.price).toFixed(0)}` : '—';
  }

  // Address change
  if(changedFields.includes('address')) {
    const addrCell = row.querySelector('.jsr3-cell-addr');
    if(addrCell) {
      addrCell.innerHTML = job.address
        ? escHtml(job.address)
        : `<em style="color:var(--txt3);font-size:10px;font-style:normal">No address</em>`;
    }
  }

  // Description change
  if(changedFields.includes('description')) {
    const descCell = row.querySelector('.jsr3-cell-desc');
    if(descCell) {
      const descFull=(job.description||'').trim();
      descCell.textContent = descFull ? (descFull.length>80?descFull.slice(0,80)+'…':descFull) : '—';
    }
  }

  // Visual flash so a row updated by another session is actually noticeable,
  // not just silently different next time you happen to look at it.
  row.style.transition = 'background-color .3s ease';
  row.style.backgroundColor = 'rgba(79,143,255,.18)';
  setTimeout(() => { row.style.backgroundColor = ''; }, 1200);
}

// Refresh when returning to tab after being away
document.addEventListener('visibilitychange', () => {
  if(!document.hidden && _rtConnected) {
    // Quick cache refresh to catch any missed updates
    _invalidateJobCache();
    if(document.getElementById('pg-jobs')?.classList.contains('active')) {
      renderJobs();
    }
  }
});
