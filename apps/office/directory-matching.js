// Directory smart-match + autosave — fuzzy name/phone matching as you type
// in the person/agency/agent forms, and the auto-save-1.2s-after-last-
// keystroke behaviour those forms use instead of an explicit save button.
// Extracted from directory.js verbatim (Phase 2 of the follow-up
// modularization pass — see the plan file for scope) — no behaviour
// changes, except one real bug fixed in the same move (see below).
//
// This module and main.js/directory-crud.js import from each other, same
// as every other extracted module: safe because every cross-module
// reference is used only inside function bodies, never at module-
// evaluation time.
//
// Live bug fixed here: matchDir/scheduleAutoSave referenced _matchTimers/
// _autoSaveTimers as if they were shared state, but neither was ever
// imported, declared locally, or exported from anywhere reachable — they
// were an unexported `let` sitting in main.js, orphaned from this file's
// perspective. Typing in a landlord/agency/agent name-match field has been
// throwing a ReferenceError. Fixed by declaring both locally here, their
// only real owner.

import { dAll, dGet } from './main.js';
import { openPersonModal, savePerson, saveAgency, saveAgent } from './directory-crud.js';

let _matchTimers = {};
let _autoSaveTimers = {};

export function openPersonModalFor(role){
  openPersonModal();
  setTimeout(()=>{
    // 'pf-'+role.slice(0,2) never actually matched a real checkbox id
    // (landlord -> "pf-la" vs the real "pf-ll", subcontractor -> "pf-su"
    // vs the real "pf-sc") -- cb was always null, so "+ Add Landlord" and
    // "+ Add Subcontractor" never pre-checked their role. Explicit map
    // instead of guessing from the string.
    const cbId={landlord:'pf-ll',client:'pf-cl',subcontractor:'pf-sc'}[role];
    const cb=cbId&&document.getElementById(cbId);
    if(cb){cb.checked=true;if(role==='subcontractor')document.getElementById('pf-eng-extra').style.display='';}
  },50);
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  DIRECTORY SMART MATCH + AUTOSAVE (v15)
//  — fuzzy match on name/phone as you type
//  — auto-save when name field has value (no button needed)
//  — partial phone match from last digits
// ════════════════════════════════════════════════════════════════

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
