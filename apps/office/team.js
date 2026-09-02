// Team management — the unified Supabase-Auth-linked team list (loadTeam),
// adding/re-roling/removing people from it, and the legacy stub aliases kept
// so old code calling them by an older name doesn't break (none are wired to
// any current UI — verified dead-but-harmless before moving). Extracted from
// main.js verbatim (Phase 1 of the follow-up modularization pass — see the
// plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.
//
// addAccessRow/addPropRow and changeUserRole/deleteUser/syncOfficeUsers
// deliberately stay in main.js — the former are unrelated Settings row-
// adders, the latter is a separate, still-live legacy roster system
// (operates on S.users, not the Supabase-Auth-based team this file covers).
//
// addEngineer() (a legacy shim below) calls showAddEngineerModal(), which
// lives in the sibling engineer-access.js — the first-planned instance of
// one extracted module importing directly from another rather than through
// main.js, same reasoning as engineer-access.js's own import of loadTeam.

import { escHtml } from '@ui';
import { S, toast, _sb, _supaAuth, getAppUser } from './main.js';
import { showAddEngineerModal } from './engineer-access.js';

// Shared by both engineer row templates below (auth-linked + phone-only) —
// same three states either way: has a working PIN, cleared and awaiting
// self-setup, or cleared and blocked until the office grants access back.
function _pinStatusBadge(u){
  if(u.pin_hash) return '<span style="font-size:10px;background:rgba(34,197,94,.1);color:#22c55e;padding:1px 7px;border-radius:10px;font-weight:700">✓ PIN set</span>';
  if(u.pin_reset_allowed) return '<span style="font-size:10px;background:rgba(245,166,35,.1);color:#f5a623;padding:1px 7px;border-radius:10px;font-weight:700">⏳ Awaiting setup</span>';
  return '<span style="font-size:10px;background:rgba(240,68,68,.1);color:#e05252;padding:1px 7px;border-radius:10px;font-weight:700">🔒 Blocked</span>';
}
function _pinActionButtons(u){
  const nameJson=escHtml(JSON.stringify(u.name||''));
  // Changing number is orthogonal to PIN state -- it just updates phone on
  // the SAME row (same id, same name, same pin_hash), so it's offered no
  // matter which of the three PIN states below applies.
  const changeNumBtn=`<button class="btn btn-ghost btn-xs" onclick="engineerChangePhone('${u.id}',${nameJson},${escHtml(JSON.stringify(u.phone||''))})">📱 Change Number</button>`;
  if(u.pin_hash){
    return `<button class="btn btn-ghost btn-xs" onclick="engineerResetPin('${u.id}',${nameJson})">🔄 Reset PIN</button>
      <button class="btn btn-ghost btn-xs" onclick="engineerForceLogout('${u.id}',${nameJson})">🚫 Force Logout</button>${changeNumBtn}`;
  }
  if(u.pin_reset_allowed){
    return `<button class="btn btn-ghost btn-xs" onclick="engineerRevokeAccess('${u.id}',${nameJson})">🔒 Revoke</button>${changeNumBtn}`;
  }
  return `<button class="btn btn-ghost btn-xs" onclick="engineerGrantAccess('${u.id}',${nameJson})">✅ Grant Access</button>${changeNumBtn}`;
}

async function loadTeam(){
  // SECURITY: Only Admins can manage the team
  if(getAppUser()?.role !== 'Admin'){
    toast('❌ Only Admins can manage the team','error');
    return;
  }
  const el   = document.getElementById('team-list');
  const stat = document.getElementById('team-sync-status');
  const btn  = document.getElementById('btn-team-sync');
  if(!el) return;
  if(btn){btn.disabled=true;btn.textContent='🔄 Syncing…';}
  el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--txt3);font-size:12px"><div class="spin" style="width:20px;height:20px;border-width:2px;margin:0 auto 8px"></div>Loading…</div>';

  try{
    // 1. Get all Supabase Auth users
    let authUsers = [];
    try{
      const {data, error} = await _supaAuth.rpc('get_auth_users');
      if(!error && Array.isArray(data)) authUsers = data;
    }catch(e){
      el.innerHTML = `<div style="background:rgba(240,68,68,.08);border:1px solid rgba(240,68,68,.2);border-radius:8px;padding:14px;font-size:12px;color:#e05252">
        <strong>⚠️ Sync not set up yet.</strong><br>Run this SQL in Supabase first, then click Sync again:<br><br>
        <code style="background:var(--s2);padding:6px 10px;border-radius:6px;display:block;margin-top:6px;font-size:11px;user-select:all">
CREATE OR REPLACE FUNCTION get_auth_users() RETURNS TABLE(id uuid, email text, created_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = auth, public AS $$ BEGIN RETURN QUERY SELECT u.id, u.email::text, u.created_at FROM auth.users u ORDER BY u.created_at DESC; END; $$;</code>
      </div>`;
      return;
    }

    // 2. Get our users table rows
    const ourUsers = await _sb('users?select=*&active=eq.true&order=name.asc') || [];
    const byEmail  = {};
    const byAuthId = {};
    ourUsers.forEach(u => {
      if(u.email)   byEmail[u.email.toLowerCase()] = u;
      if(u.auth_id) byAuthId[u.auth_id] = u;
    });

    const roleInfo = {
      admin:    {icon:'👑',label:'Admin',   col:'#f5a623',bg:'rgba(245,166,35,.1)'},
      manager:  {icon:'🏢',label:'Manager', col:'#4f8fff',bg:'rgba(79,143,255,.1)'},
      staff:    {icon:'📋',label:'Staff',   col:'#22c55e',bg:'rgba(34,197,94,.1)'},
      viewer:   {icon:'👁',label:'Viewer',  col:'#a855f7',bg:'rgba(168,85,247,.1)'},
      engineer: {icon:'👷',label:'Engineer',col:'#14b8a6',bg:'rgba(20,184,166,.1)'},
    };

    const roleOpts = Object.entries(roleInfo).map(([v,r])=>`<option value="${v}">${r.icon} ${r.label}</option>`).join('');
    // Engineer role deliberately excluded from both dropdowns below: an
    // auth_id-linked account can never actually work as an engineer anymore
    // (Office App blocks the Engineer role outright in applyUserPermissions,
    // and the Engineer App dropped email+password login entirely) -- the
    // ONLY working path is phone+PIN via "👷 Add Engineer", which is also
    // the only path that runs the name-collision check jobs rely on.
    const roleOptsNoEng = Object.entries(roleInfo).filter(([v])=>v!=='engineer').map(([v,r])=>`<option value="${v}">${r.icon} ${r.label}</option>`).join('');
    const me = getAppUser()?.email;

    let rows = '';
    authUsers.forEach(au => {
      const profile = byAuthId[au.id] || byEmail[(au.email||'').toLowerCase()];
      const isMe    = (au.email||'').toLowerCase() === (me||'').toLowerCase();
      const ri      = profile ? (roleInfo[profile.role]||roleInfo.staff) : null;
      const lastSeen = profile?.last_seen
        ? new Date(profile.last_seen*1000).toLocaleDateString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
        : 'Never';

      if(profile){
        // Already in DeepFlow — show with role dropdown
        rows += `
        <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:${isMe?'rgba(245,166,35,.04)':'var(--s1)'};flex-wrap:wrap">
          <div style="width:36px;height:36px;border-radius:50%;background:${ri.bg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${ri.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${escHtml(profile.name||'—')}
              ${isMe?'<span style="font-size:10px;background:rgba(79,143,255,.15);color:#4f8fff;padding:1px 7px;border-radius:10px">YOU</span>':''}
              <span style="font-size:10px;background:${ri.bg};color:${ri.col};padding:1px 7px;border-radius:10px;font-weight:700">✓ Active</span>
            </div>
            <div style="font-size:11px;color:var(--txt3);margin-top:2px">${escHtml(au.email)} · Last seen: ${lastSeen}${profile.role==='engineer'?(profile.phone?` · 📱 ${escHtml(profile.phone)} · `+_pinStatusBadge(profile):' · <span style="color:#e05252">No phone number</span>'):''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            <select style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:12px" ${isMe?'disabled':''} onchange="teamChangeRole('${profile.id}',${escHtml(JSON.stringify(au.email))},this.value,this)">
              ${Object.entries(roleInfo).map(([v,r])=>`<option value="${v}" ${profile.role===v?'selected':''}>${r.icon} ${r.label}</option>`).join('')}
            </select>
            ${profile.role==='engineer'?(profile.phone?_pinActionButtons(profile):`<button class="btn btn-ghost btn-xs" onclick="enablePhoneLogin('${profile.id}',${escHtml(JSON.stringify(profile.name||au.email))},'')">📱 Enable Phone Login</button>`):''}
            ${!isMe?`<button class="btn btn-red btn-xs" onclick="teamRevoke('${profile.id}',${escHtml(JSON.stringify(profile.name||au.email))})">🗑 Remove</button>`:'<span style="font-size:11px;color:var(--txt3)">(you)</span>'}
          </div>
        </div>`;
      } else {
        // In Supabase Auth but NOT in DeepFlow yet — show Add row
        rows += `
        <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:8px;border:1px dashed rgba(79,143,255,.4);background:rgba(79,143,255,.04);flex-wrap:wrap" id="new-row-${au.id}">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(79,143,255,.12);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">👤</div>
          <div style="flex:1;min-width:0">
            <input type="text" id="tname-${au.id}" placeholder="Enter full name *"
              style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:12px;width:100%;max-width:200px;margin-bottom:3px">
            <div style="font-size:11px;color:var(--txt3)">${escHtml(au.email)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            <select id="trole-${au.id}" style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:12px">
              ${roleOptsNoEng}
            </select>
            <button class="btn btn-acc btn-sm" onclick="teamAdd('${au.id}',${escHtml(JSON.stringify(au.email))})">✅ Add</button>
          </div>
        </div>`;
      }
    });

    // Phone+PIN engineers have no Supabase Auth account at all — they'll
    // never appear in authUsers, so they need their own section straight
    // from ourUsers. is_engineer()/is_valid_engineer_token() both require
    // active=true, so "Remove" below just deactivates rather than deleting.
    const pinEngineers = ourUsers.filter(u=>u.role==='engineer' && !u.auth_id);
    if(pinEngineers.length){
      rows += `<div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">📱 Phone + PIN Engineers</div>`;
      pinEngineers.forEach(u=>{
        rows += `
        <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:8px;border:1px solid var(--border);background:var(--s1);flex-wrap:wrap">
          <div style="width:36px;height:36px;border-radius:50%;background:${roleInfo.engineer.bg};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${roleInfo.engineer.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              ${escHtml(u.name||'—')}
              ${_pinStatusBadge(u)}
            </div>
            <div style="font-size:11px;color:var(--txt3);margin-top:2px">${escHtml(u.phone||'No phone number set')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            ${_pinActionButtons(u)}
            <button class="btn btn-red btn-xs" onclick="teamRevoke('${u.id}',${escHtml(JSON.stringify(u.name||''))},true)">🗑 Remove</button>
          </div>
        </div>`;
      });
    }

    el.innerHTML = rows || '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">No Supabase Auth users found. Add users in Supabase first.</div>';
    if(stat) stat.textContent = `${authUsers.length} Supabase user${authUsers.length!==1?'s':''} · ${ourUsers.length} in DeepFlow — last synced ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;

    // Sync S.engineers + S.users for job dropdowns — save to localStorage so refresh works
    // Preserve existing rate fields (dayRate, hourlyRate, costRate) if already set
    S.engineers = ourUsers.filter(u=>u.role==='engineer').map(u=>{
      const existing=(S.engineers||[]).find(e=>e.name===u.name)||{};
      return{
        _sbId:u.id, name:u.name, phone:u.phone||'', rate:u.rate||existing.rate||0,
        dayRate:existing.dayRate||0, hourlyRate:existing.hourlyRate||0, costRate:existing.costRate||0,
        otRate:existing.otRate||0, wa:existing.wa||'', trade:existing.trade||'', capacity:existing.capacity||8, email:u.email||''
      };
    });
    localStorage.setItem('df_setting_engineers', JSON.stringify(S.engineers));

    const officeUsers = ourUsers.filter(u=>u.role!=='engineer');
    S.users = officeUsers.map(u=>({
      id:u.id, _sbId:u.id, name:u.name, email:u.email||'',
      role:{admin:'Admin',manager:'Manager',staff:'Staff',viewer:'Viewer'}[u.role]||'Staff',
      auth_id:u.auth_id||null,
      canEdit:u.can_edit!==false, canDelete:u.can_delete===true||u.role==='admin'||u.role==='manager',
      canInvoice:u.can_invoice!==false, canFinance:u.can_finance===true||u.role==='admin'||u.role==='manager',
      seeLandlord:u.see_landlord!==false, seeLandlordPhone:u.see_landlord_phone!==false,
      seeAgent:u.see_agent!==false, seeContact:u.see_contact!==false, seePrice:u.see_price!==false,
    }));
    localStorage.setItem('df_setting_users', JSON.stringify(S.users));

  }catch(e){
    el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:12px">❌ Failed: ${e.message}</div>`;
    console.error('loadTeam:',e);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='🔄 Sync from Supabase';}
  }
}

// Add a Supabase Auth user to our users table
async function teamAdd(authId, email){
  const nameEl  = document.getElementById('tname-'+authId);
  const roleEl  = document.getElementById('trole-'+authId);
  const name    = nameEl?.value.trim();
  const role    = roleEl?.value || 'staff';

  if(!name){ toast('Enter a name first','error'); nameEl?.focus(); return; }
  // Defense in depth: the dropdown feeding this no longer offers "engineer"
  // at all (see roleOptsNoEng) since this path never ran the name-collision
  // check jobs rely on -- reject outright rather than trust the DOM wasn't
  // tampered with or a future edit re-adds the option.
  if(role==='engineer'){ toast('❌ Use "👷 Add Engineer" for engineers — this link is for office roles only','error',6000); return; }

  const isEng = role === 'engineer';
  const payload = {
    id: crypto.randomUUID(),
    name, email: email.toLowerCase(), role, active: true,
    auth_id: authId,
    can_edit:    !isEng && role!=='viewer',
    can_delete:  role==='admin'||role==='manager',
    can_invoice: !isEng && role!=='viewer',
    can_finance: role==='admin'||role==='manager',
    see_landlord:true, see_landlord_phone:!isEng,
    see_agent:   !isEng, see_contact:true, see_price:!isEng && role!=='viewer',
    created: Math.floor(Date.now()/1000),
  };

  try{
    await _sb('users',{method:'POST',body:payload,prefer:'return=minimal'});
    toast(`✅ ${name} added as ${role} — they can log in now`,'success',4000);
    loadTeam();
  }catch(e){
    let msg = e.message||'Unknown error';
    if(msg.includes('42501')||msg.includes('row-level security')){
      msg='RLS error — run the Fix SQL in Guide & SQL tab, then try again.';
    } else if(msg.includes('duplicate')||msg.includes('unique')){
      msg='This email is already in DeepFlow. Click Sync to refresh.';
    }
    toast('❌ '+msg,'error',6000);
  }
}

// Change an existing user's role
async function teamChangeRole(userId, email, newRole, sel){
  // Same gap as teamAdd() had: this dropdown's onchange only fires on a
  // real value change, so reaching here with 'engineer' always means
  // converting an existing office/auth-linked user INTO an engineer --
  // which would set no phone, no pin_reset_allowed, and skip the name-
  // collision check entirely, creating a dead-end account with none of
  // the safety the real Add Engineer flow has. Route people there instead.
  if(newRole==='engineer'){
    toast('❌ Use "👷 Add Engineer" in Settings → Team to make someone an engineer','error',6000);
    if(sel) loadTeam(); // reset the dropdown back to their real current role
    return;
  }
  const isEng = newRole==='engineer';
  try{
    await _sb(`users?id=eq.${userId}`,{method:'PATCH',prefer:'return=minimal',body:{
      role:newRole,
      can_edit:    !isEng && newRole!=='viewer',
      can_delete:  newRole==='admin'||newRole==='manager',
      can_invoice: !isEng && newRole!=='viewer',
      can_finance: newRole==='admin'||newRole==='manager',
      see_landlord:true, see_landlord_phone:!isEng,
      see_agent:!isEng, see_price:!isEng && newRole!=='viewer',
    }});
    toast(`✅ Role updated to ${newRole}`,'success',2500);
    loadTeam();
  }catch(e){
    toast('❌ '+e.message,'error');
    loadTeam(); // reset
  }
}

// Remove a user from DeepFlow (they stay in Supabase Auth — delete there to block login)
async function teamRevoke(userId, name, isPinEngineer){
  // Phone+PIN engineers have no Supabase Auth account to separately clean
  // up — is_engineer()/is_valid_engineer_token() both require active=true,
  // so deactivating alone fully and immediately blocks all access. The
  // Team list only ever shows active=true rows, so a deactivated row won't
  // reappear there -- but Add Engineer's name-collision picker (see
  // _showEngineerNameCollisionModal) still finds and can reactivate it by
  // name. Clearing phone here still matters: it frees the number
  // immediately for a *different* new engineer, rather than leaving it
  // reserved by a dormant row until someone specifically re-types this
  // exact name to rediscover it.
  if(isPinEngineer){
    if(!confirm(`Remove "${name}" from DeepFlow?\n\nThis immediately blocks their Engineer App login — no Supabase cleanup needed.\nTheir phone number will be free to use again for a new or re-added engineer.`)) return;
    try{
      await _sb(`users?id=eq.${userId}`,{method:'PATCH',prefer:'return=minimal',body:{
        active:false, session_token:null, session_expires:null, phone:null,
        pin_hash:null, pin_reset_allowed:false, pin_fail_count:0, pin_locked_until:null,
      }});
      toast(`✅ ${name} removed — their login is blocked immediately and their number is free to reuse`,'success');
      loadTeam();
    }catch(e){ toast('❌ '+e.message,'error'); }
    return;
  }
  if(!confirm(`Remove "${name}" from DeepFlow?\n\nThis removes their profile and permissions.\nTo block login completely, also delete them in Supabase Auth → Users.`)) return;
  try{
    await _sb(`users?id=eq.${userId}`,{method:'DELETE',prefer:'return=minimal'});
    toast(`✅ ${name} removed from DeepFlow`,'success');
    loadTeam();
  }catch(e){ toast('❌ '+e.message,'error'); }
}

// Legacy stubs — keep so old code calling these doesn't break
async function loadAuthUsers(){ await loadTeam(); }
async function loadEngineers(){ await loadTeam(); }
async function syncFromSupabaseAuth(){ await loadTeam(); }
async function syncEngineersFromSupabase(){ await loadTeam(); }
async function addOfficeStaff(){ toast('Use Sync from Supabase to add users','info'); }
async function addEngineer(){ showAddEngineerModal(); }
async function inviteEngineer(){ return addEngineer(); }
async function importAuthUser(id,email){ await teamAdd(id,email); }
async function addEngFromAuth(id,email){ await teamAdd(id,email); }
function _showInvStatus(msg,type){ toast(msg,type); }
function _showEngInvStatus(msg,type){ toast(msg,type); }
async function fixUserAuth(){ await loadTeam(); }
async function resetStaffPassword(){ toast('Go to Supabase Auth → find user → send reset email','info'); }
async function setEngPwd(){ toast('Go to Supabase Auth → find user → reset password there','info'); }
async function deleteEngineer(id,name){ await teamRevoke(id,name); }
async function revokeEngineer(id,name){ await teamRevoke(id,name); }
async function revokeUser(id,name){ await teamRevoke(id,name); }
async function updateUserRole(id,role,sel){ await teamChangeRole(id,'',role,sel); }
async function syncEngineers(){ await loadTeam(); return (S.engineers||[]).length; }
async function resetEngPassword(id,name,email){ toast('Go to Supabase Auth → find '+email+' → reset password','info',5000); }

export {
  _pinStatusBadge, _pinActionButtons, loadTeam, teamAdd, teamChangeRole, teamRevoke,
  loadAuthUsers, loadEngineers, syncFromSupabaseAuth, syncEngineersFromSupabase, addOfficeStaff,
  addEngineer, inviteEngineer, importAuthUser, addEngFromAuth, _showInvStatus, _showEngInvStatus,
  fixUserAuth, resetStaffPassword, setEngPwd, deleteEngineer, revokeEngineer, revokeUser,
  updateUserRole, syncEngineers, resetEngPassword,
};
