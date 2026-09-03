// Job modal — address fuzzy-search, Postcodes.io lookup, and the smart
// autofill dropdown system that resolves a typed landlord/agency/agent name
// against the Directory. Extracted from main.js verbatim (Phase 5b of the
// follow-up modularization pass — see the plan file for scope) — no
// behaviour changes.
//
// This module and main.js (and the other jobs-*.js files) import from each
// other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time.

import { fuzzyScore, highlightMatch } from '@business';
import { allProps, dAll, toast, _renderRatingStrip, extractPostcode } from './main.js';

export function fuzzyAddr(inp){
  const q=inp.value.trim();
  const dd=document.getElementById('addr-drop');
  if(q.length<2){closeAddrDrop();return}
  const res=allProps.map(p=>({p,s:fuzzyScore(q,p.address)})).filter(r=>r.s>0.25).sort((a,b)=>b.s-a.s).slice(0,7);
  if(!res.length){closeAddrDrop();return}
  dd.innerHTML=res.map(r=>`
    <div class="fdi" onclick="selectAddr('${r.p.id}')">
      <span>${highlightMatch(r.p.address,q)}</span>
      <span class="fmeta">${r.p.landlord||''} · ${Math.round(r.s*100)}%</span>
    </div>`).join('');
  const rect=inp.getBoundingClientRect();
  dd.style.cssText=`display:block;top:${rect.bottom+window.scrollY+4}px;left:${rect.left}px;width:${Math.max(rect.width,300)}px`;
}

export async function selectAddr(pid){
  const p=allProps.find(x=>x.id===pid);
  if(!p)return;
  document.getElementById('jf-addr').value=p.address;
  closeAddrDrop();
  // Route the property's most recent referrer to whichever field actually
  // links it — a real landlord into the free-text Referrer field (with a
  // Directory auto-fill), an agency into the linked Agency Name field,
  // resolved to the real agencies-table record the same way manual entry
  // does (via _resolveAgency at save time). Deliberately read
  // landlordHistory/agency here rather than the merged `p.landlord`
  // display fallback, which exists only for the Properties page's generic
  // "who's associated with this address" label — using it here would
  // silently reintroduce the same lost-agency-link bug this replaces.
  const llName=p.landlordHistory?.[0]||'';
  if(llName){
    document.getElementById('jf-ll-name').value=llName;
    await autoFillLandlordByName(llName);
  }
  if(p.agency){
    document.getElementById('jf-agency').value=p.agency;
    const agencies=await dAll('agencies');
    const ag=agencies.find(a=>a.name===p.agency);
    if(ag){
      document.getElementById('jf-agency-phone').value=ag.phone||'';
      document.getElementById('jf-agency-email').value=ag.email||'';
      const agts=await dAll('agents');
      const linked=agts.filter(a=>a.agencyId===ag.id);
      if(linked.length===1){
        document.getElementById('jf-agent').value=linked[0].name;
        document.getElementById('jf-agent-phone').value=linked[0].phone||'';
        document.getElementById('jf-agent-email').value=linked[0].email||'';
      }
    }
  }
  toast(`Auto-filled: ${p.agency||llName||p.address}`,'success');
}
export function closeAddrDrop(){const d=document.getElementById('addr-drop');if(d)d.style.display='none'}
document.addEventListener('click',e=>{if(!e.target.closest('#addr-drop')&&!e.target.closest('#jf-addr'))closeAddrDrop()});

// ── Postcode helper (Postcodes.io) ──
// Deliberately does NOT invent a full address: Postcodes.io has no
// building/door-number data (it's ONSPD administrative-geography data, not
// a property gazetteer), so this only (1) autocompletes/validates the
// postcode itself, catching typos immediately, (2) shows the area as a
// read-only hint for staff to visually confirm — never auto-inserted into
// the address text, since Postcodes.io's admin_district often isn't the
// real Royal Mail post town (e.g. RM6 reports "Barking and Dagenham", not
// "Romford") and writing that into a real address would be actively wrong —
// and (3) surfaces any of THIS business's own properties already on file
// at that postcode as one-click fills via the existing selectAddr(), since
// most day-to-day bookings are repeat landlords/properties.
let _postcodeTimer=null;
export function postcodeLookup(inp){
  clearTimeout(_postcodeTimer);
  const q=inp.value.trim();
  const dd=document.getElementById('postcode-drop');
  const hintEl=document.getElementById('postcode-hint');
  const matchEl=document.getElementById('postcode-matches');
  if(q.length<2){ closePostcodeDrop(); if(hintEl)hintEl.textContent=''; if(matchEl)matchEl.innerHTML=''; return; }
  _postcodeTimer=setTimeout(async()=>{
    try{
      const r=await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`);
      const j=await r.json();
      const results=j.result||[];
      if(!results.length){ closePostcodeDrop(); return; }
      dd.innerHTML=results.map(pc=>`<div class="fdi" onclick="confirmPostcode('${pc}')"><span>${pc}</span></div>`).join('');
      const rect=inp.getBoundingClientRect();
      dd.style.cssText=`display:block;top:${rect.bottom+window.scrollY+4}px;left:${rect.left}px;width:${Math.max(rect.width,220)}px`;
      // A single exact match (typed the full postcode) confirms itself —
      // no need to make someone click their own postcode in a dropdown.
      if(results.length===1 && results[0].replace(/\s+/g,'').toUpperCase()===q.replace(/\s+/g,'').toUpperCase()){
        confirmPostcode(results[0]);
      }
    }catch(e){ console.warn('[postcodeLookup] Postcodes.io request failed',e); }
  },350);
}
export async function confirmPostcode(postcode){
  closePostcodeDrop();
  document.getElementById('jf-postcode').value=postcode;
  const hintEl=document.getElementById('postcode-hint');
  const matchEl=document.getElementById('postcode-matches');
  try{
    const r=await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    const j=await r.json();
    if(j.result && hintEl){
      const area=[j.result.admin_ward,j.result.admin_district].filter(Boolean).join(', ');
      hintEl.innerHTML=`📍 ${area} <span style="color:var(--txt4)">— shown for confirmation only, not added to the address</span>`;
    }
  }catch(e){ console.warn('[confirmPostcode] Postcodes.io lookup failed',e); }
  const norm=postcode.replace(/\s+/g,'').toUpperCase();
  const matches=allProps.filter(p=>extractPostcode(p.address).replace(/\s+/g,'').toUpperCase()===norm);
  if(matchEl){
    matchEl.innerHTML = matches.length
      ? `<div style="font-size:11px;color:var(--txt3);margin-top:6px;margin-bottom:3px">You already have ${matches.length} propert${matches.length===1?'y':'ies'} here — click to use:</div>`+
        matches.slice(0,6).map(p=>`<div class="fdi" style="position:static;border:1px solid var(--border);border-radius:6px;margin-bottom:3px" onclick="selectAddr('${p.id}')">
          <span>${p.address}</span><span class="fmeta">${p.landlord||''}</span>
        </div>`).join('')
      : '';
  }
}
export function closePostcodeDrop(){const d=document.getElementById('postcode-drop');if(d)d.style.display='none'}
document.addEventListener('click',e=>{if(!e.target.closest('#postcode-drop')&&!e.target.closest('#jf-postcode'))closePostcodeDrop()});

// ════════════════════════════════════════════════════════════════
//  SMART AUTOFILL SYSTEM
// ════════════════════════════════════════════════════════════════

export function closeAllAutofillDrops(){
  ['ll-drop','ll-phone-drop','ll-email-drop','agency-drop','agent-phone-drop','agent-email-drop'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.autofill-drop')&&!e.target.closest('.fi')) closeAllAutofillDrops();
});

// Registry maps dropId → {items, onSelect} so onclick doesn't need serialised functions
const _autofillRegistry={};

export function showAutofillDrop(dropId, items, onSelect){
  const drop=document.getElementById(dropId);
  if(!drop){return;}
  if(!items||!items.length){drop.style.display='none';return;}

  // Store callback in registry — no function serialisation
  _autofillRegistry[dropId]={items, onSelect};

  drop.innerHTML=items.map((item,i)=>`
    <div class="autofill-item" data-drop="${dropId}" data-idx="${i}" tabindex="-1">
      <div class="autofill-item-main">${item.label||''}</div>
      ${item.sub?`<div class="autofill-item-sub">${item.sub}</div>`:''}
    </div>`).join('');

  // Click handler on each item
  drop.querySelectorAll('.autofill-item').forEach(el=>{
    el.addEventListener('mousedown', e=>{
      // mousedown fires before input blur, so we can capture the click
      e.preventDefault();
      const idx=parseInt(el.dataset.idx);
      const reg=_autofillRegistry[dropId];
      if(reg) reg.onSelect(reg.items[idx]);
      drop.style.display='none';
    });
  });

  // Position the dropdown flush under the input field
  // Walk backwards from the drop element to find the nearest .fi input sibling
  let anchor=drop.previousElementSibling;
  while(anchor&&!anchor.matches('input,textarea,select')) anchor=anchor.previousElementSibling;
  if(!anchor) anchor=drop.closest('.fg')?.querySelector('input,textarea');
  if(anchor){
    const rect=anchor.getBoundingClientRect();
    drop.style.position='fixed';
    drop.style.top=(rect.bottom+2)+'px';
    drop.style.left=rect.left+'px';
    drop.style.width=Math.max(rect.width,260)+'px';
    drop.style.display='block';
  } else {
    drop.style.display='block';
  }

  // Attach keyboard nav to the associated input (find it the same way)
  if(anchor && !anchor._autofillKeyBound){
    anchor._autofillKeyBound=true;
    anchor.addEventListener('keydown', e=>{
      const d=document.getElementById(dropId);
      if(!d||d.style.display==='none') return;
      const items=[...d.querySelectorAll('.autofill-item')];
      const cur=d.querySelector('.autofill-item.hovered');
      let idx=cur?parseInt(cur.dataset.idx):-1;
      if(e.key==='ArrowDown'){
        e.preventDefault();
        idx=Math.min(idx+1,items.length-1);
        items.forEach(el=>el.classList.remove('hovered'));
        items[idx]?.classList.add('hovered');
        items[idx]?.scrollIntoView({block:'nearest'});
      } else if(e.key==='ArrowUp'){
        e.preventDefault();
        idx=Math.max(idx-1,0);
        items.forEach(el=>el.classList.remove('hovered'));
        items[idx]?.classList.add('hovered');
        items[idx]?.scrollIntoView({block:'nearest'});
      } else if(e.key==='Enter'||e.key==='Tab'){
        const hov=d.querySelector('.autofill-item.hovered');
        if(hov){
          e.preventDefault();
          const i=parseInt(hov.dataset.idx);
          const reg=_autofillRegistry[dropId];
          if(reg) reg.onSelect(reg.items[i]);
          d.style.display='none';
        }
      } else if(e.key==='Escape'){
        d.style.display='none';
      }
    });
  }
}

export async function smartAutofill(type, val, context){
  if(!val||val.length<2){closeAllAutofillDrops();return}
  const ql=val.toLowerCase();
  const persons=await dAll('persons');
  const agencies=await dAll('agencies');
  const agents=await dAll('agents');

  if(type==='landlord'){
    // Search landlords, clients AND agents by name — one box, routed by
    // role on selection (see below) so reclassifying someone in Directory
    // (tick a different role checkbox) is all it takes to change which
    // panel they fill here, no separate "Agent" search to keep in sync.
    const matches=persons.filter(p=>(p.roles||[]).some(r=>['landlord','client','agent'].includes(r))&&p.name.toLowerCase().includes(ql)).slice(0,6);
    const items=matches.map(p=>({
      label:p.name,
      sub:(p.phone?'📞 '+p.phone:'')+(p.email?' · '+p.email:'')+(p.roles?.includes('agent')?' [Agent]':p.roles?.includes('landlord')?' [Landlord]':p.roles?.includes('client')?' [Client]':''),
      pid:p.id,name:p.name,phone:p.phone,email:p.email,wa:p.wa,address:p.address,notes:p.notes,
      roles:p.roles||[],agencyId:p.agencyId||''
    }));
    showAutofillDrop('ll-drop', items, function(item){
      if((item.roles||[]).includes('agent')) fillAgentFieldsFromPerson(item);
      else fillLandlordFields(item);
      closeAllAutofillDrops();
    });
  }
  else if(type==='phone' && context==='landlord'){
    const matches=persons.filter(p=>p.phone&&p.phone.replace(/\s/g,'').includes(val.replace(/\s/g,''))).slice(0,5);
    const items=matches.map(p=>({label:p.name,sub:'📞 '+p.phone,pid:p.id,name:p.name,phone:p.phone,email:p.email,wa:p.wa,address:p.address,notes:p.notes}));
    showAutofillDrop('ll-phone-drop',items,function(item){fillLandlordFields(item);closeAllAutofillDrops()});
  }
  else if(type==='email' && context==='landlord'){
    const matches=persons.filter(p=>p.email&&p.email.toLowerCase().includes(ql)).slice(0,5);
    const items=matches.map(p=>({label:p.name,sub:'✉ '+p.email,pid:p.id,name:p.name,phone:p.phone,email:p.email,wa:p.wa,address:p.address,notes:p.notes}));
    showAutofillDrop('ll-email-drop',items,function(item){fillLandlordFields(item);closeAllAutofillDrops()});
  }
  else if(type==='agency'){
    const matches=agencies.filter(a=>a.name.toLowerCase().includes(ql)).slice(0,6);
    const items=matches.map(a=>({label:a.name,sub:(a.phone?'📞 '+a.phone:'')+(a.email?' · '+a.email:''),aid:a.id,name:a.name,phone:a.phone,email:a.email}));
    showAutofillDrop('agency-drop',items,async function(item){
      document.getElementById('jf-agency').value=item.name;
      document.getElementById('jf-agency-phone').value=item.phone||'';
      document.getElementById('jf-agency-email').value=item.email||'';
      // Show agency rating at top
      const bar=document.getElementById('jm-ratings-bar');
      const agWrap=document.getElementById('jm-rating-ag-wrap');
      if(bar)bar.style.display='flex';
      if(agWrap)agWrap.style.display='block';
      _renderRatingStrip('jm-rating-ag', item.name);
      closeAllAutofillDrops();
      // Auto-load agents for this agency
      const agts=await dAll('agents');
      const linked=agts.filter(ag=>ag.agencyId===item.aid);
      if(linked.length===1){
        // Auto-fill the single agent
        document.getElementById('jf-agent').value=linked[0].name;
        document.getElementById('jf-agent-phone').value=linked[0].phone||'';
        document.getElementById('jf-agent-email').value=linked[0].email||'';
        toast(`Auto-filled agent: ${linked[0].name}`,'success');
      }
    });
  }
  else if(type==='phone' && context==='agent'){
    const matches=agents.filter(ag=>ag.phone&&ag.phone.replace(/\s/g,'').includes(val.replace(/\s/g,''))).slice(0,5);
    const items=matches.map(ag=>({label:ag.name,sub:'📞 '+ag.phone,agid:ag.id,name:ag.name,phone:ag.phone,email:ag.email}));
    showAutofillDrop('agent-phone-drop',items,function(item){document.getElementById('jf-agent-phone').value=item.phone;document.getElementById('jf-agent').value=item.name;document.getElementById('jf-agent-email').value=item.email||'';closeAllAutofillDrops()});
  }
  else if(type==='email' && context==='agent'){
    const matches=agents.filter(ag=>ag.email&&ag.email.toLowerCase().includes(ql)).slice(0,5);
    const items=matches.map(ag=>({label:ag.name,sub:'✉ '+ag.email,agid:ag.id,name:ag.name,phone:ag.phone,email:ag.email}));
    showAutofillDrop('agent-email-drop',items,function(item){document.getElementById('jf-agent-email').value=item.email;document.getElementById('jf-agent').value=item.name;document.getElementById('jf-agent-phone').value=item.phone||'';closeAllAutofillDrops()});
  }
  else if(type==='addr'){
    // This is handled by fuzzyAddr, but we also update landlord if property has one
    // Already handled in selectAddr
  }
}

export function fillLandlordFields(p){
  // Fill tab 2 landlord fields
  document.getElementById('jf-ll-name').value=p.name||'';
  document.getElementById('jf-ll-phone').value=p.phone||'';
  document.getElementById('jf-ll-email').value=p.email||'';
  document.getElementById('jf-ll-addr').value=p.address||'';
  document.getElementById('jf-ll-wa').value=p.wa||'';
  document.getElementById('jf-ll-notes').value=p.notes||'';
  // Show info box
  const box=document.getElementById('jm-ll-info');
  if(box){
    box.classList.add('visible');
    document.getElementById('jmi-ll-name').textContent=p.name||'—';
    document.getElementById('jmi-ll-phone').textContent=p.phone||'—';
    document.getElementById('jmi-ll-email').textContent=p.email||'—';
    document.getElementById('jmi-ll-addr').textContent=p.address||'—';
    document.getElementById('jmi-ll-wa').textContent=p.wa||'—';
  }
  const btn=document.getElementById('btn-wa-ll');
  if(btn)btn.style.display=p.wa?'':'none';
  // Show landlord rating at the TOP ratings bar
  const bar=document.getElementById('jm-ratings-bar');
  const llWrap=document.getElementById('jm-rating-ll-wrap');
  if(bar)bar.style.display='flex';
  if(llWrap)llWrap.style.display='block';
  _renderRatingStrip('jm-rating-ll', p.name);
  toast(`Landlord auto-filled: ${p.name}`,'success');
}

// Routed here (instead of fillLandlordFields) when the Contact box picks a
// person whose roles include 'agent'. Also pulls in their linked agency
// (persons.agencyId) so picking an agent fills both Column 3 fields at once.
export async function fillAgentFieldsFromPerson(p){
  document.getElementById('jf-agent').value=p.name||'';
  document.getElementById('jf-agent-phone').value=p.phone||'';
  document.getElementById('jf-agent-email').value=p.email||'';
  if(p.agencyId){
    const agencies=await dAll('agencies');
    const ag=agencies.find(a=>a.id===p.agencyId);
    if(ag){
      document.getElementById('jf-agency').value=ag.name||'';
      document.getElementById('jf-agency-phone').value=ag.phone||'';
      document.getElementById('jf-agency-email').value=ag.email||'';
    }
  }
  const box=document.getElementById('jm-ag-info');
  if(box){
    box.classList.add('visible');
    document.getElementById('jmi-ag-name').textContent=document.getElementById('jf-agency').value||'—';
    document.getElementById('jmi-agent-name').textContent=p.name||'—';
    document.getElementById('jmi-agent-phone').textContent=p.phone||'—';
    document.getElementById('jmi-agent-email').textContent=p.email||'—';
  }
  const bar=document.getElementById('jm-ratings-bar');
  const agentWrap=document.getElementById('jm-rating-agent-wrap');
  if(bar)bar.style.display='flex';
  if(agentWrap)agentWrap.style.display='block';
  _renderRatingStrip('jm-rating-agent', p.name);
  toast(`Agent auto-filled: ${p.name}`,'success');
}

export async function autoFillLandlordByName(name){
  const persons=await dAll('persons');
  const p=persons.find(x=>x.name.toLowerCase()===name.toLowerCase()&&(x.roles||[]).includes('landlord'));
  if(p) fillLandlordFields(p);
}
