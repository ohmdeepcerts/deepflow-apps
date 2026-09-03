// Job modal — duplicate-phone detection (warns when a typed phone number
// already belongs to a different Directory record), the landlord/agency
// person-resolvers saveJob() calls to auto-create/update Directory records,
// and the "Save to Directories" button handlers + landlord quick-WhatsApp.
// Extracted from main.js verbatim (Phase 5b of the follow-up modularization
// pass) — no behaviour changes.
//
// This module and main.js (and the other jobs-*.js files) import from each
// other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time.

import { S, dAll, dGet, dPut, toast, confirm2, uid } from './main.js';
import { fillLandlordFields } from './jobs-address-autofill.js';
import { sendToWA } from './jobs-whatsapp.js';

let _dupCheckTimer=null;

export async function checkDuplicatePhone(val, context){
  clearTimeout(_dupCheckTimer);
  if(!val || val.replace(/\D/g,'').length < 7) return;
  _dupCheckTimer = setTimeout(async ()=>{
    const clean = val.replace(/\s/g,'');
    const persons = await dAll('persons');

    if(context === 'landlord'){
      const match = persons.find(p => p.phone && p.phone.replace(/\s/g,'') === clean);
      if(!match) return;
      const currentName = document.getElementById('jf-ll-name').value.trim();
      if(match.name.toLowerCase() === currentName.toLowerCase()) return; // same person, no popup
      showDupPopup({
        existingName: match.name,
        existingPhone: match.phone,
        newName: currentName || '(no name entered)',
        context: 'landlord',
        existingId: match.id
      });
    } else if(context === 'agent'){
      const agents = await dAll('agents');
      const match = agents.find(ag => ag.phone && ag.phone.replace(/\s/g,'') === clean);
      if(!match) return;
      const currentName = document.getElementById('jf-agent').value.trim();
      if(match.name.toLowerCase() === currentName.toLowerCase()) return;
      showDupPopup({
        existingName: match.name,
        existingPhone: match.phone,
        newName: currentName || '(no name entered)',
        context: 'agent',
        existingId: match.id
      });
    } else if(context === 'agency'){
      const agencies = await dAll('agencies');
      const match = agencies.find(a => a.phone && a.phone.replace(/\s/g,'') === clean);
      if(!match) return;
      const currentName = document.getElementById('jf-agency').value.trim();
      if(match.name.toLowerCase() === currentName.toLowerCase()) return;
      showDupPopup({
        existingName: match.name,
        existingPhone: match.phone,
        newName: currentName || '(no name entered)',
        context: 'agency',
        existingId: match.id
      });
    }
  }, 600);
}

export function showDupPopup({existingName, existingPhone, newName, context, existingId}){
  // Remove any existing popup
  const old = document.getElementById('dup-popup-overlay');
  if(old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'dup-popup';
  overlay.id = 'dup-popup-overlay';

  const typeLabel = context === 'landlord' ? 'Landlord' : context === 'agent' ? 'Agent' : 'Agency';

  overlay.innerHTML = `
    <div class="dup-box">
      <div class="dup-box-title">⚠️ Phone Number Already Exists</div>
      <div class="dup-box-sub">
        The phone number <strong>${existingPhone}</strong> already exists in your database for:<br><br>
        <strong style="color:var(--acc)">${existingName}</strong> (${typeLabel})<br><br>
        You are currently entering a ${context} with name: <strong>${newName}</strong><br><br>
        What would you like to do?
      </div>
      <div class="dup-box-actions">
        <button class="btn btn-acc btn-sm" onclick="dupUseExisting('${existingId}','${context}')">
          ✅ Use "${existingName}" — Auto-fill
        </button>
        <button class="btn btn-ghost btn-sm" onclick="dupUpdateName('${existingId}','${context}')">
          ✎ Update name to "${newName}"
        </button>
        <button class="btn btn-red btn-sm" onclick="document.getElementById('dup-popup-overlay').remove()">
          ✕ Ignore — Keep as new
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  // Close on background click
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
}

export async function dupUseExisting(id, context){
  document.getElementById('dup-popup-overlay')?.remove();
  if(context === 'landlord'){
    const p = await dGet('persons', id);
    if(p) fillLandlordFields(p);
  } else if(context === 'agent'){
    const ag = await dGet('agents', id);
    if(ag){
      document.getElementById('jf-agent').value = ag.name||'';
      document.getElementById('jf-agent-phone').value = ag.phone||'';
      document.getElementById('jf-agent-email').value = ag.email||'';
    }
  } else if(context === 'agency'){
    const a = await dGet('agencies', id);
    if(a){
      document.getElementById('jf-agency').value = a.name||'';
      document.getElementById('jf-agency-phone').value = a.phone||'';
      document.getElementById('jf-agency-email').value = a.email||'';
    }
  }
  toast('Auto-filled from existing database record', 'success');
}

export async function dupUpdateName(id, context){
  document.getElementById('dup-popup-overlay')?.remove();
  if(context === 'landlord'){
    const newName = document.getElementById('jf-ll-name').value.trim();
    if(!newName){ toast('Enter a new name first', 'warn'); return; }
    const p = await dGet('persons', id);
    if(p){ p.name = newName; p.modified = Date.now(); await dPut('persons', p); toast('Landlord name updated in database!', 'success'); }
  } else if(context === 'agent'){
    const newName = document.getElementById('jf-agent').value.trim();
    if(!newName){ toast('Enter a new name first', 'warn'); return; }
    const ag = await dGet('agents', id);
    if(ag){ ag.name = newName; ag.modified = Date.now(); await dPut('agents', ag); toast('Agent name updated in database!', 'success'); }
  } else if(context === 'agency'){
    const newName = document.getElementById('jf-agency').value.trim();
    if(!newName){ toast('Enter a new name first', 'warn'); return; }
    const a = await dGet('agencies', id);
    if(a){ a.name = newName; a.modified = Date.now(); await dPut('agencies', a); toast('Agency name updated in database!', 'success'); }
  }
}

// Resolves a job's landlord fields to a real Directory person record and
// returns {id, cancelled}. id is the person's id for job.clientPersonId —
// null if there's nothing to link (no name/phone). cancelled is true only
// when the office backed out of a conflicting-contact-details prompt via
// the true Cancel button — callers must abort the whole save in that case,
// not just skip the link, so a typo can be fixed before anything commits.
//
// This used to only run when someone remembered to click the separate
// "Save to Directories" button below — saving the JOB itself never touched
// the persons table at all, so a brand-new landlord's details went nowhere
// unless that button was clicked, and typing an EXISTING landlord's name
// with different contact info (a typo, or a genuinely different person who
// happens to share the name) would either silently overwrite their real
// phone/email or silently create nothing — either way, invisible in
// Directory and impossible to invite to the Client Portal. Now this runs
// on every job save automatically, and asks before overwriting conflicting
// contact details instead of guessing.
//
// The conflict prompt is a real 3-way choice (update / save-as-new /
// cancel-and-fix), not the update-or-silently-create-new 2-way it started
// as. confirm2's Alt button always resolves onCancel first (to unblock the
// Promise) and then fires altAction ~50ms later — so a straight `resolve()`
// in each callback can't tell "true Cancel" apart from "Alt, mid-flight".
// Instead onCancel defers its resolve by 80ms (comfortably after Alt's
// 50ms), and altAction resolves immediately when it does fire — whichever
// resolves first wins, `finish()` guards against the loser firing after.
export async function _resolveLandlordPerson(name, phone, email, addr, wa, notes){
  if(!name && !phone) return {id:null};
  const persons = await dAll('persons');
  let existing = name ? persons.find(p=>p.name.toLowerCase()===name.toLowerCase()) : null;
  if(!existing && phone) existing = persons.find(p=>p.phone&&p.phone.replace(/\s/g,'')===phone.replace(/\s/g,''));

  if(existing){
    const phoneConflict = phone && existing.phone && existing.phone.replace(/\s/g,'')!==phone.replace(/\s/g,'');
    const emailConflict = email && existing.email && existing.email.toLowerCase()!==email.toLowerCase();
    // Matched by phone fallback (existing.name !== name is exactly how that
    // path is reached — an exact name match would have matched on line
    // 5089 already), so this is always a real name mismatch worth asking
    // about, not just when it happens to accompany a phone/email conflict.
    // Previously this fell through unconfirmed to the blind `existing.name
    // = name` overwrite below — meaning simply reopening and resaving any
    // job still holding a landlord's pre-rename name (its own snapshot,
    // never updated by a Directory rename — renaming doesn't cascade to
    // jobs at all, see savePerson) silently reverted a deliberate rename
    // the moment that old job was saved for any unrelated reason, with no
    // warning. A genuine rename should only ever happen through the
    // Directory's own edit form, not as a side effect of saving a job.
    const nameConflict = name && existing.name.toLowerCase()!==name.toLowerCase();
    if(phoneConflict || emailConflict || nameConflict){
      let resolved=false;
      const choice = await new Promise(resolve=>{
        const finish=v=>{ if(resolved)return; resolved=true; resolve(v); };
        confirm2(
          'Same landlord, or someone new?',
          `"${existing.name}" is already in your Directory${existing.phone?` — phone ${existing.phone}`:''}${existing.email?` — email ${existing.email}`:''}.\n\nThis job has different contact details on it${nameConflict?` (name "${name}")`:''}${phone?` (phone ${phone})`:''}${email?` (email ${email})`:''}.\n\nIs this the same landlord (their details just changed), a different person, or was it a typo on the job?`,
          ()=>finish('update'),
          ()=>setTimeout(()=>finish('cancel'),80),
          {okText:'Same person — update Directory', altText:'Different person — save as new', altAction:()=>finish('create')}
        );
      });
      if(choice==='cancel') return {id:null, cancelled:true};
      if(choice==='create') existing=null; // treat as a distinct person — falls through to creation below
      // choice==='update' falls through with `existing` set, to the merge below
    }
  }

  if(existing){
    if(name && existing.name !== name) existing.name = name;
    existing.phone = phone || existing.phone;
    existing.email = email || existing.email;
    existing.address = addr || existing.address;
    existing.wa = wa || existing.wa;
    existing.notes = notes || existing.notes;
    if(!(existing.roles||[]).includes('landlord')) existing.roles=[...(existing.roles||[]),'landlord'];
    await dPut('persons', existing);
    return {id:existing.id};
  } else {
    const p = {id:uid(), name:name||phone, phone, email, address:addr, wa, notes, roles:['landlord'], created:Date.now()};
    await dPut('persons', p);
    return {id:p.id};
  }
}

// Manual "Save to Directories" button — same resolver as the automatic
// save-on-job-save path, just triggered on demand and reading straight
// from the form (useful to save a landlord's details before the rest of
// the job form is filled in, or without saving the job at all).
// Same shape as _resolveLandlordPerson but for agencies — deliberately
// simpler (no phone/email conflict dialog): an agency record has much
// less personal-contact nuance than a landlord's, and this is a new
// resolver, not a rewrite of an existing one people already rely on.
// Populates jobs.client_agency_id / invoices.client_agency_id, which are
// now real foreign keys (see migration 20260809010000) instead of a
// permanently-empty loose reference — previously nothing ever wrote
// these columns at all.
export async function _resolveAgency(name, phone, email, notes){
  if(!name) return {id:null};
  const agencies = await dAll('agencies');
  const existing = agencies.find(a=>a.name.toLowerCase()===name.toLowerCase());
  if(existing){
    existing.phone = phone || existing.phone;
    existing.email = email || existing.email;
    existing.notes = notes || existing.notes;
    await dPut('agencies', existing);
    return {id:existing.id};
  }
  const a = {id:uid(), name, phone:phone||'', email:email||'', notes:notes||'', created:Date.now()};
  await dPut('agencies', a);
  return {id:a.id};
}

export async function saveLandlordFromJob(){
  const name = document.getElementById('jf-ll-name').value.trim();
  const phone = document.getElementById('jf-ll-phone').value.trim();
  const email = document.getElementById('jf-ll-email').value.trim();
  if(!name && !phone){toast('Enter at least a phone number or name','warn');return}
  const addr = document.getElementById('jf-ll-addr').value.trim();
  const wa = document.getElementById('jf-ll-wa').value.trim();
  const notes = document.getElementById('jf-ll-notes').value.trim();
  const r = await _resolveLandlordPerson(name, phone, email, addr, wa, notes);
  if(r.cancelled) return;
  if(r.id) toast(`Landlord saved${!name?' (phone as name)':''}`,'success');
}

// Save agency from job tab 3
export async function saveAgencyFromJob(){
  const name=document.getElementById('jf-agency').value.trim();
  if(!name){toast('Enter agency name first','warn');return}
  const agencies=await dAll('agencies');
  const existing=agencies.find(a=>a.name.toLowerCase()===name.toLowerCase());
  if(existing){
    existing.phone=document.getElementById('jf-agency-phone').value.trim()||existing.phone;
    existing.email=document.getElementById('jf-agency-email').value.trim()||existing.email;
    await dPut('agencies',existing);
    toast('Agency updated in directories','success');
  } else {
    const a={id:uid(),name,phone:document.getElementById('jf-agency-phone').value.trim(),email:document.getElementById('jf-agency-email').value.trim(),created:Date.now()};
    await dPut('agencies',a);
    toast('Agency saved to directories','success');
  }
}

// Save agent from job tab 3
export async function saveAgentFromJob(){
  const name=document.getElementById('jf-agent').value.trim();
  if(!name){toast('Enter agent name first','warn');return}
  const agencies=await dAll('agencies');
  const agencyName=document.getElementById('jf-agency').value.trim();
  const agency=agencies.find(a=>a.name.toLowerCase()===agencyName.toLowerCase());
  const agents=await dAll('agents');
  const existing=agents.find(ag=>ag.name.toLowerCase()===name.toLowerCase());
  if(existing){
    existing.phone=document.getElementById('jf-agent-phone').value.trim()||existing.phone;
    existing.email=document.getElementById('jf-agent-email').value.trim()||existing.email;
    if(agency&&!existing.agencyId)existing.agencyId=agency.id;
    await dPut('agents',existing);
    toast('Agent updated in directories','success');
  } else {
    const ag={id:uid(),name,phone:document.getElementById('jf-agent-phone').value.trim(),email:document.getElementById('jf-agent-email').value.trim(),agencyId:agency?.id||'',created:Date.now()};
    await dPut('agents',ag);
    toast('Agent saved to directories','success');
  }
}

// Landlord WA from job modal
export async function sendLandlordWA(){
  const name=document.getElementById('jf-ll-name').value.trim();
  const wa=document.getElementById('jf-ll-wa').value.trim();
  const addr=document.getElementById('jf-addr').value.trim();
  if(!wa){toast('No WhatsApp number for landlord','warn');return}
  const msg=`Hello *${name}*,\n\nThis is ${S.coName||'us'}.\n\nRegarding: ${addr}\n\nKind regards.`;
  sendToWA(wa,msg);
}
