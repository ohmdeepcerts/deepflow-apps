// Engineer access management — the "Add Engineer" (phone + PIN) flow with
// its name-collision safety check, phone-login enablement for auth-linked
// engineers, and PIN reset/force-logout/grant/revoke/change-number actions.
// Extracted from main.js verbatim (Phase 1 of the follow-up modularization
// pass — see the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.
//
// Several actions here call loadTeam() afterward to refresh the list —
// loadTeam lives in the sibling team.js, which in turn imports
// showAddEngineerModal from here (for its addEngineer() legacy shim). That
// makes this the first sibling-to-sibling circular import in the app; safe
// for the same reason as every other cross-module reference — neither side
// is touched at module-evaluation time, only inside function bodies that
// run later, after both modules have finished loading.

import { escHtml } from '@ui';
import { toast, _sb, confirm2 } from './main.js';
import { loadTeam } from './team.js';

// ── ADD ENGINEER (phone + PIN) — no Supabase Dashboard step, ever ────────
function showAddEngineerModal(){
  closeAddEngineerModal();
  const div=document.createElement('div');
  div.id='add-eng-overlay';
  div.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  div.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:360px;width:100%">
      <div style="font-size:16px;font-weight:800;margin-bottom:14px">👷 Add Engineer</div>
      <input id="ae-name" placeholder="Full name *" style="width:100%;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:13px;margin-bottom:8px;box-sizing:border-box">
      <input id="ae-phone" placeholder="Phone number * (used to log in)" style="width:100%;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:13px;margin-bottom:14px;box-sizing:border-box">
      <div style="font-size:11px;color:var(--txt3);margin-bottom:14px">No PIN to set — they'll create their own the first time they open the Engineer App and enter this number. Trade, rate, and other settings can be added afterward in Settings → Engineers.</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="closeAddEngineerModal()">Cancel</button>
        <button class="btn btn-acc btn-sm" style="flex:1" onclick="submitAddEngineer()">Create</button>
      </div>
      <div id="ae-err" style="color:var(--red);font-size:12px;margin-top:8px"></div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(()=>document.getElementById('ae-name')?.focus(),50);
}
function closeAddEngineerModal(){ document.getElementById('add-eng-overlay')?.remove(); }

// Jobs link to an engineer by matching this exact name text (no stable id
// involved -- see PHASE7 investigation), so two engineer rows sharing a name
// aren't just a display mixup: they'd see and could edit each other's jobs,
// and an inactive row with the same name as someone leaving-and-returning is
// exactly how the same duplicate-Izhar-row situation piled up before. Check
// for a name collision before ever creating a fresh row, and let the office
// make an informed choice instead of finding out later.
async function submitAddEngineer(){
  const name  = (document.getElementById('ae-name')?.value||'').trim();
  const phone = (document.getElementById('ae-phone')?.value||'').trim();
  const err   = document.getElementById('ae-err');
  if(!name||!phone){ if(err)err.textContent='Name and phone number are required'; return; }

  // Fetch EVERY matching record, not just one -- a name can collide with
  // more than one row at once (e.g. an old inactive "Izhar" plus a
  // different, currently-active "Izhar" someone already added), and only
  // checking the first result back (in an unspecified row order) meant this
  // could silently pick the wrong one: either offering no way to reactivate
  // a dormant match that was sitting right there, or reactivating one
  // without ever checking it would collide with an already-active other.
  let matches=[];
  try{ matches = await _sb(`users?role=eq.engineer&name=ilike.${encodeURIComponent(name)}&select=id,name,phone,active,last_seen&order=active.desc,created.desc`)||[]; }
  catch(e){ /* lookup failing shouldn't block adding -- fall through to normal create */ }

  if(!matches.length){ await _createEngineerRow(name, phone, err); return; }
  _showEngineerNameCollisionModal(name, phone, matches, err);
}

// Lists every existing engineer with this name (active or not) so the
// office can pick "this specific one is coming back" instead of the app
// guessing, and can't accidentally reactivate someone into a collision with
// a different, already-active same-named engineer without seeing that
// engineer listed right there in the same dialog.
function _showEngineerNameCollisionModal(name, phone, matches, err){
  const overlay=document.getElementById('eng-collision-overlay');
  if(overlay) overlay.remove();
  const hasActive = matches.some(m=>m.active);
  const rows = matches.map(m=>{
    if(m.active){
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid rgba(240,68,68,.3);background:rgba(240,68,68,.06);margin-bottom:8px">
        <div>
          <div style="font-weight:700;font-size:13px">${escHtml(m.name)} <span style="font-size:10px;background:rgba(34,197,94,.15);color:#22c55e;padding:1px 7px;border-radius:10px;margin-left:4px">● Active now</span></div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px">📱 ${escHtml(m.phone||'—')}</div>
        </div>
      </div>`;
    }
    const lastSeen = m.last_seen ? new Date(m.last_seen*1000).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : 'never logged in';
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--s2);margin-bottom:8px">
      <div>
        <div style="font-weight:700;font-size:13px">${escHtml(m.name)}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:2px">📱 ${escHtml(m.phone||'none on file')} · left, last seen ${lastSeen}</div>
      </div>
      <button class="btn btn-acc btn-xs" onclick="_reactivateInCollision(${escHtml(JSON.stringify(m.id))},${escHtml(JSON.stringify(m.name))},${escHtml(JSON.stringify(phone))},${hasActive})">🔄 This is them</button>
    </div>`;
  }).join('');

  const div=document.createElement('div');
  div.id='eng-collision-overlay';
  div.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px';
  div.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:420px;width:100%;max-height:85vh;overflow:auto">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">👤 "${escHtml(name)}" already exists</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:14px">${matches.length} record${matches.length>1?'s':''} found with this name. Is the new engineer one of these, or someone different?</div>
      ${rows}
      ${hasActive?`<div style="font-size:11px;color:#e05252;background:rgba(240,68,68,.08);border-radius:8px;padding:10px;margin:10px 0 4px">⚠️ An active engineer already has this exact name. If this is someone else, keep them separate below — otherwise they'll see and can edit each other's jobs, with no way to tell them apart.</div>`:''}
      <div style="margin-top:10px">
        <label class="fl" style="font-size:11px">None of these — add as a new person, named:</label>
        <input id="ecm-new-name" value="${escHtml(hasActive?name+' 2':name)}" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:13px;margin:6px 0;box-sizing:border-box">
        <button class="btn ${hasActive?'btn-ghost':'btn-acc'} btn-sm" style="width:100%" onclick="_confirmNewDespiteCollision(${escHtml(JSON.stringify(phone))})">➕ Add as new person</button>
      </div>
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px" onclick="document.getElementById('eng-collision-overlay')?.remove()">Cancel</button>
      <div id="ecm-err" style="color:var(--red);font-size:12px;margin-top:8px"></div>
    </div>`;
  document.body.appendChild(div);
}

// One more guard specifically for the multi-match case: reactivating a
// dormant record is normally safe, but if a DIFFERENT engineer with the
// same name is already active, doing so creates the exact two-active-
// same-name collision this whole flow exists to prevent -- silently,
// unless something stops to ask first.
function _reactivateInCollision(id, name, phone, hasActive){
  if(hasActive && !confirm(`"${name}" is currently active under a different account. Reactivating this one too means both will be active with the identical name — they'll see and can edit each other's jobs.\n\nContinue anyway?`)) return;
  document.getElementById('eng-collision-overlay')?.remove();
  _reactivateEngineer(id, name, phone, null);
}

function _confirmNewDespiteCollision(phone){
  const nameEl=document.getElementById('ecm-new-name');
  const name=(nameEl?.value||'').trim();
  const err=document.getElementById('ecm-err');
  if(!name){ if(err)err.textContent='Name is required'; return; }
  document.getElementById('eng-collision-overlay')?.remove();
  _createEngineerRow(name, phone, document.getElementById('ae-err'));
}

async function _createEngineerRow(name, phone, err){
  const payload = {
    id: crypto.randomUUID(),
    name, phone, role:'engineer', active:true, auth_id:null, email:'',
    pin_reset_allowed:true,
    can_edit:false, can_delete:false, can_invoice:false, can_finance:false,
    see_landlord:true, see_landlord_phone:false, see_agent:false, see_contact:true, see_price:false,
    created: Math.floor(Date.now()/1000),
  };
  try{
    await _sb('users',{method:'POST',body:payload,prefer:'return=minimal'});
    closeAddEngineerModal();
    toast(`✅ ${name} added — tell them to open the Engineer App and enter ${phone} to set up their PIN`,'success',6000);
    loadTeam();
  }catch(e){
    let msg=e.message||'Unknown error';
    if(msg.includes('users_phone_unique')||msg.includes('duplicate')) msg='That phone number is already in use by another account.';
    if(err)err.textContent=msg;
  }
}

// Reuses the SAME row (same id) instead of minting a new one -- this is what
// actually keeps a returning engineer linked to their history with zero
// extra work, and avoids piling up another dead same-named row the next
// time they leave and come back. PIN is cleared so they always land on a
// fresh self-setup screen rather than trusting a possibly-stale old PIN.
async function _reactivateEngineer(id, name, phone, err){
  try{
    await _sb(`users?id=eq.${id}`,{method:'PATCH',prefer:'return=minimal',body:{
      active:true, phone, pin_reset_allowed:true,
      pin_hash:null, session_token:null, session_expires:null, pin_fail_count:0, pin_locked_until:null,
    }});
    closeAddEngineerModal();
    toast(`✅ ${name} reactivated — tell them to open the Engineer App and enter ${phone} to set up a new PIN`,'success',6000);
    loadTeam();
  }catch(e){
    let msg=e.message||'Unknown error';
    if(msg.includes('users_phone_unique')||msg.includes('duplicate')) msg='That phone number is already in use by another account.';
    if(err)err.textContent=msg;
  }
}

// ── PHONE LOGIN SETUP for an existing (auth-linked) engineer who doesn't
// have a phone number yet — no PIN involved, they set their own on first
// visit, same as a brand-new engineer.
function enablePhoneLogin(id, name, phone){
  const overlay=document.getElementById('eng-pin-overlay');
  if(overlay) overlay.remove();
  const div=document.createElement('div');
  div.id='eng-pin-overlay';
  div.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  div.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:340px;width:100%">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">📱 Phone Login for ${escHtml(name)}</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:14px">No PIN to set — they'll create their own the first time they open the Engineer App and enter this number.</div>
      <input id="epl-phone" value="${escHtml(phone||'')}" placeholder="Phone number" style="width:100%;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:13px;margin-bottom:12px;box-sizing:border-box">
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="document.getElementById('eng-pin-overlay').remove()">Cancel</button>
        <button class="btn btn-acc btn-sm" style="flex:1" onclick="submitEnablePhoneLogin('${id}',${escHtml(JSON.stringify(name))})">Save</button>
      </div>
      <div id="epl-err" style="color:var(--red);font-size:12px;margin-top:8px"></div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(()=>document.getElementById('epl-phone')?.focus(),50);
}

async function submitEnablePhoneLogin(id, name){
  const phone=(document.getElementById('epl-phone')?.value||'').trim();
  const err=document.getElementById('epl-err');
  if(!phone){ if(err)err.textContent='Phone number is required'; return; }
  try{
    await _sb(`users?id=eq.${id}`,{method:'PATCH',prefer:'return=minimal',body:{phone,pin_reset_allowed:true}});
    document.getElementById('eng-pin-overlay')?.remove();
    toast(`✅ ${name} can now set up their PIN using ${phone}`,'success',5000);
    loadTeam();
  }catch(e){
    let msg=e.message||'Unknown error';
    if(msg.includes('users_phone_unique')||msg.includes('duplicate')) msg='That phone number is already in use by another account.';
    if(err)err.textContent=msg;
  }
}

// ── RESET / FORCE LOGOUT / GRANT / REVOKE — engineer_pin_clear and
// engineer_allow_pin_reset are both is_office()-gated server-side. Neither
// the office nor this app ever sees or transmits an actual PIN value again;
// the engineer always creates their own via the Engineer App's self-setup
// screen once access is granted.
function engineerResetPin(id, name){
  confirm2(
    'Reset PIN',
    `This immediately logs ${name} out. Next time they open the Engineer App, they'll be asked to create a brand new PIN themselves.`,
    async()=>{
      try{
        await _sb('rpc/engineer_pin_clear',{method:'POST',body:{p_id:id,p_allow_reset:true}});
        toast(`🔑 ${name}'s PIN was cleared — they'll set a new one on next visit`,'success',5000);
        loadTeam();
      }catch(e){ toast('Failed: '+(e.message||'').slice(0,100),'error',6000); }
    }
  );
}

function engineerForceLogout(id, name){
  confirm2(
    'Force Logout',
    `This immediately logs ${name} out and blocks them from logging back in — they'll see "not authorised" until you grant access again.`,
    async()=>{
      try{
        await _sb('rpc/engineer_pin_clear',{method:'POST',body:{p_id:id,p_allow_reset:false}});
        toast(`🚫 ${name} logged out and blocked`,'warn',5000);
        loadTeam();
      }catch(e){ toast('Failed: '+(e.message||'').slice(0,100),'error',6000); }
    }
  );
}

async function engineerGrantAccess(id, name){
  try{
    await _sb('rpc/engineer_allow_pin_reset',{method:'POST',body:{p_id:id,p_allow:true}});
    toast(`✅ ${name} can now set a PIN and log back in`,'success',5000);
    loadTeam();
  }catch(e){ toast('Failed: '+(e.message||'').slice(0,100),'error',6000); }
}

async function engineerRevokeAccess(id, name){
  try{
    await _sb('rpc/engineer_allow_pin_reset',{method:'POST',body:{p_id:id,p_allow:false}});
    toast(`🔒 Access revoked for ${name}`,'warn',4000);
    loadTeam();
  }catch(e){ toast('Failed: '+(e.message||'').slice(0,100),'error',6000); }
}

// ── CHANGE NUMBER — same person, new phone. Unlike enablePhoneLogin() (which
// is for granting a first-time/no-PIN engineer initial access and always
// sets pin_reset_allowed:true), this only PATCHes phone on the SAME row --
// id, name, and pin_hash are all untouched. engineer_pin_login() looks up by
// phone alone (WHERE phone = p_phone), so their existing PIN keeps working
// immediately on the new number with zero re-setup and zero identity churn
// (no new row, so no risk of a second same-name row down the line).
function engineerChangePhone(id, name, currentPhone){
  const overlay=document.getElementById('eng-pin-overlay');
  if(overlay) overlay.remove();
  const div=document.createElement('div');
  div.id='eng-pin-overlay';
  div.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  div.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:340px;width:100%">
      <div style="font-size:15px;font-weight:800;margin-bottom:4px">📱 Change Number for ${escHtml(name)}</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:14px">Their PIN stays the same — they just log in with the new number next time.</div>
      <input id="ecp-phone" value="${escHtml(currentPhone||'')}" placeholder="New phone number" style="width:100%;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:13px;margin-bottom:12px;box-sizing:border-box">
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="document.getElementById('eng-pin-overlay').remove()">Cancel</button>
        <button class="btn btn-acc btn-sm" style="flex:1" onclick="submitEngineerChangePhone('${id}',${escHtml(JSON.stringify(name))})">Save</button>
      </div>
      <div id="ecp-err" style="color:var(--red);font-size:12px;margin-top:8px"></div>
    </div>`;
  document.body.appendChild(div);
  setTimeout(()=>{const el=document.getElementById('ecp-phone');el?.focus();el?.select();},50);
}

async function submitEngineerChangePhone(id, name){
  const phone=(document.getElementById('ecp-phone')?.value||'').trim();
  const err=document.getElementById('ecp-err');
  if(!phone){ if(err)err.textContent='Phone number is required'; return; }
  try{
    await _sb(`users?id=eq.${id}`,{method:'PATCH',prefer:'return=minimal',body:{phone}});
    document.getElementById('eng-pin-overlay')?.remove();
    toast(`✅ ${name}'s number updated — same PIN still works on ${phone}`,'success',5000);
    loadTeam();
  }catch(e){
    let msg=e.message||'Unknown error';
    if(msg.includes('users_phone_unique')||msg.includes('duplicate')) msg='That phone number is already in use by another account.';
    if(err)err.textContent=msg;
  }
}

export {
  showAddEngineerModal, closeAddEngineerModal, submitAddEngineer,
  _showEngineerNameCollisionModal, _reactivateInCollision, _confirmNewDespiteCollision,
  _createEngineerRow, _reactivateEngineer, enablePhoneLogin, submitEnablePhoneLogin,
  engineerResetPin, engineerForceLogout, engineerGrantAccess, engineerRevokeAccess,
  engineerChangePhone, submitEngineerChangePhone,
};
