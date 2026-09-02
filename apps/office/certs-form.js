// Certificates add/edit form — the certificate-type chip picker, job-link
// autofill, address/contact autofill, save/cancel, and the individual
// email/WhatsApp reminder senders from the list's row actions. Extracted
// from certs.js verbatim (Phase 2 of the follow-up modularization pass —
// see the plan file for scope) — no behaviour changes.
//
// This module and main.js (and the other certs-* files) import from each
// other, same as every other extracted module: safe because every cross-
// module reference is used only inside function bodies, never at module-
// evaluation time.
//
// Owns _editCertId/_selCertTypes/_formJobId/_formJobNum/_certAppliances —
// the form's own edit-state — since this is the only file that ever
// reassigns them. toggleApplianceSection (certs-appliances.js) and
// _currentCertHasAppliances (certs-pdf.js) read _selCertTypes/
// _certAppliances via live-binding imports, safe because they only ever
// read, never reassign.

import { escHtml } from '@ui';
import { daysDiff, formatDateUK } from '@business';
import { S, dAll, dGet, dPut, TODAY, toast, uid, logActivity, updateBadges } from './main.js';
import { generateCertRef } from './certs-core.js';
import { switchCertTab } from './certs-list.js';
import { renderCertPdfSection } from './certs-pdf.js';
import { toggleApplianceSection } from './certs-appliances.js';

export let _editCertId=null, _selCertTypes=new Set();
// The manual form has no job-picker field, so jobId/jobNum travel through
// as form-level state (same pattern as _editCertId) rather than a visible
// input — set from `existing` in openCertForm, read back in saveCertForm.
// Without this, renewCert()'s "new test cycle" draft (which goes through
// this exact same form) had no way to carry the original cert's job link
// forward at all, so every renewed certificate silently lost its jobId/
// jobNum/engineer — see renewCert's own comment for the concrete trigger.
export let _formJobId=null, _formJobNum='';
// Working copy of the currently-open cert's appliance test log (asset ID,
// description, instrument, date, retest period, calculated next-test date,
// Pass/Fail). Only ever shown/saved for cert types with hasAppliances set
// (see toggleApplianceSection()) — reset and populated in openCertForm(),
// written back in saveCertForm().
export let _certAppliances=[];

export function openCertForm(existing){
  _editCertId=existing?.id||null;
  _formJobId=existing?.jobId||null;
  _formJobNum=existing?.jobNum||'';
  _selCertTypes=new Set(existing?.type?[existing.type]:[]);
  _certAppliances=(existing?.appliances||[]).map(a=>({...a}));
  // Update title
  const titleEl=document.getElementById('cform-title');
  if(titleEl)titleEl.textContent=existing?`Edit Certificate — ${existing.certNum||existing.address||''}` :'Add Certificate';
  // Populate type chips
  renderCertTypeChips();
  toggleApplianceSection();
  // Fill fields
  const s=id=>document.getElementById(id);
  if(s('cf2-job')){
    s('cf2-job').value=_formJobId?`${_formJobNum||''} — ${existing?.address||''}`:'';
    if(s('cf2-job-sugg'))s('cf2-job-sugg').style.display='none';
  }
  if(s('cf2-job-linked'))s('cf2-job-linked').style.display=_formJobId?'block':'none';
  if(s('cf2-job-linked-txt')&&_formJobId)s('cf2-job-linked-txt').textContent=`✓ Linked to Job ${_formJobNum||_formJobId}`;
  if(s('cf2-addr'))   s('cf2-addr').value=existing?.address||'';
  if(s('cf2-issue'))  s('cf2-issue').value=existing?.issueDate||TODAY();
  if(s('cf2-expiry')) s('cf2-expiry').value=existing?.expiryDate||'';
  if(s('cf2-certnum'))s('cf2-certnum').value=existing?.certNum||'';
  if(s('cf2-landlord'))s('cf2-landlord').value=existing?.landlord||'';
  if(s('cf2-email'))  s('cf2-email').value=existing?.email||'';
  if(s('cf2-phone'))  s('cf2-phone').value=existing?.phone||'+44';
  if(s('cf2-agent'))  s('cf2-agent').value=existing?.agent||'';
  if(s('cf2-engineer'))s('cf2-engineer').value=existing?.engineer||'';
  if(s('cf2-notes'))  s('cf2-notes').value=existing?.notes||'';
  if(s('cf2-nr'))     s('cf2-nr').checked=existing?.notResponding||false;
  // PDF attachment status
  window._editCertModalId=_editCertId;
  renderCertPdfSection(_editCertId,existing?.pdfPath||null);
  // Recent
  renderCertFormRecent();
  // Switch to form tab only if not already there
  switchCertTab('form',true);
}

export function renderCertTypeChips(){
  const grid=document.getElementById('ctype-grid-form'); if(!grid)return;
  const types=S.certTypes||[];
  const icoMap={'Gas Safety':'⛽','Electrical EICR':'⚡','Fire Alarm':'🔥','Emergency Lighting':'💡','PAT Testing':'🔌','EPC':'🏠','Legionella':'💧'};
  grid.innerHTML=types.map(t=>{
    const sel=_selCertTypes.has(t.name);
    return`<div class="ctype-btn ${sel?'sel':''}" style="--ct-col:${t.color||'var(--acc)'};${sel?`border-color:${t.color||'var(--acc)'}`:''}" onclick="ctypeToggle('${t.name}')">
      <div class="ctype-btn-ico">${icoMap[t.name]||'◈'}</div>
      <div class="ctype-btn-lbl">${t.name}</div>
      <div class="ctype-check" style="color:${t.color||'var(--acc)'}">✓</div>
    </div>`;
  }).join('');
}

export function ctypeToggle(name){
  if(_editCertId){ _selCertTypes.clear(); _selCertTypes.add(name); }
  else { _selCertTypes.has(name)?_selCertTypes.delete(name):_selCertTypes.add(name); }
  renderCertTypeChips();
  toggleApplianceSection();
}

export async function renderCertFormRecent(){
  const all=await dAll('certs');
  const recent=all.slice(-5).reverse();
  const el=document.getElementById('cf2-recent');
  if(!el)return;
  if(!recent.length){el.textContent='No recent additions';return;}
  el.innerHTML=recent.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)">
    <span style="font-size:11px;color:var(--txt1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${c.address||'—'}</span>
    <span style="font-size:10px;background:var(--s2);padding:1px 6px;border-radius:8px;color:var(--txt3);flex-shrink:0">${c.type||''}</span>
  </div>`).join('');
}

export async function saveCertForm(){
  const g=id=>document.getElementById(id)?.value?.trim()||'';
  const addr=g('cf2-addr');
  if(!addr)return toast('Address is required','error');
  if(_selCertTypes.size===0)return toast('Select at least one cert type','error');

  const isSingle=_selCertTypes.size===1;
  let savedId=null;
  for(const type of _selCertTypes){
    const isEdit=isSingle&&_editCertId;
    const id=isEdit ? _editCertId : uid();
    const ct=(S.certTypes||[]).find(t=>t.name===type);
    const appliances=isSingle&&ct?.hasAppliances?_certAppliances:[];
    let certNum=g('cf2-certnum');
    // Auto-generate only for a genuinely new cert with no number typed in,
    // and only once an admin has opted in via Settings — see
    // generateCertRef() above. Never overwrites a number on an edit-save.
    if(!certNum&&!isEdit&&S.certRefSerial){
      certNum=await generateCertRef({address:addr,appliances,hasAppliances:ct?.hasAppliances,issueDate:g('cf2-issue')||TODAY()});
    }
    const c={
      id,
      address:addr, type,
      // Carried through from openCertForm's `existing` (see _formJobId's
      // own comment) rather than left for dPut's merge-duplicates upsert
      // to implicitly preserve on an edit — renewCert's fresh-draft save
      // is an INSERT, not an edit, so there's no existing row for that to
      // fall back on; this is the one place these actually need setting.
      jobId:_formJobId, jobNum:_formJobNum,
      issueDate:g('cf2-issue'), expiryDate:g('cf2-expiry'),
      certNum, landlord:g('cf2-landlord'),
      email:g('cf2-email'), phone:g('cf2-phone'),
      agent:g('cf2-agent'), notes:g('cf2-notes'),
      // Only shown/filled for PAT-type certs (the appliance section, and
      // this field with it, only renders when hasAppliances is set) — a
      // manually-added cert has no linked job for generateCertPdf() to
      // pull an engineer name from otherwise, which was leaving the PDF's
      // Engineer box blank for every PAT cert added this way. Harmless
      // empty string for every other cert type, which never reads it.
      engineer:g('cf2-engineer'),
      noExpiry:!g('cf2-expiry'),
      notResponding:document.getElementById('cf2-nr')?.checked||false,
      // Only the single type that actually has an appliance log shown gets
      // the appliances array — every other cert type keeps behaving exactly
      // as before (empty array, ignored everywhere else).
      appliances,
    };
    await dPut('certs',c);
    await logActivity(`Certificate ${_editCertId?'updated':'added'}: ${type} at ${addr}`,'cert');
    if(isSingle) savedId=id;
  }
  toast(`${_selCertTypes.size} certificate(s) saved`,'success');
  updateBadges();

  if(isSingle&&savedId){
    // Stay on the form so a PDF can be attached immediately — no need to
    // close and reopen just to unlock the upload button.
    _editCertId=savedId;
    window._editCertModalId=savedId;
    const saved=await dGet('certs',savedId);
    renderCertPdfSection(savedId,saved?.pdfPath||null);
    renderCertFormRecent();
  }else{
    _editCertId=null; _selCertTypes=new Set();
    switchCertTab('list');
  }
}

export function cancelCertForm(){switchCertTab('list');}

// Job link — the only place a manually-added cert can get real auto-fill
// from a job. Previously the "+ Add Cert" form had no way to reference a
// job at all: its only "auto-fill" was suggesting values already typed
// into OTHER past certs (updateCertAddrSugg/certContactSugg below), so
// correcting or backfilling a cert for a specific job meant retyping
// everything by hand, and the resulting cert had no jobId — unlike the
// fully-automatic onJobComplete→createCertEntry path, which always links
// (see main.js). Selecting a job here sets _formJobId/_formJobNum (read
// by saveCertForm) and fills every field that path already auto-fills.
export async function updateCertJobSugg(){
  const inp=document.getElementById('cf2-job'); if(!inp)return;
  const val=inp.value.toLowerCase(); const drop=document.getElementById('cf2-job-sugg'); if(!drop)return;
  if(val.length<2){drop.style.display='none';return;}
  const jobs=await dAll('jobs');
  const matches=jobs.filter(j=>
    (j.address||'').toLowerCase().includes(val) ||
    (j.jobNum||'').toLowerCase().includes(val) ||
    (j.landlordName||'').toLowerCase().includes(val) ||
    (j.referrer||'').toLowerCase().includes(val)
  ).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,8);
  if(!matches.length){
    drop.innerHTML='<li style="padding:8px 12px;font-size:12px;color:var(--txt3)">No matching jobs</li>';
    drop.style.display='block';
    return;
  }
  drop.innerHTML=matches.map(j=>`<li onclick="certLinkJob('${j.id}')" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)">
    <strong>${escHtml(j.jobNum||'—')}</strong> — ${escHtml(j.address||'')}
    <div style="font-size:10px;color:var(--txt3)">${escHtml(j.landlordName||j.referrer||'')}${j.date?' · '+escHtml(j.date):''}</div>
  </li>`).join('');
  drop.style.display='block';
}

export async function certLinkJob(jobId){
  const job=await dGet('jobs',jobId);
  if(!job)return;
  _formJobId=job.id;
  _formJobNum=job.jobNum||'';
  const s=id=>document.getElementById(id);
  if(s('cf2-job'))s('cf2-job').value=`${job.jobNum||''} — ${job.address||''}`;
  if(s('cf2-job-sugg'))s('cf2-job-sugg').style.display='none';
  if(s('cf2-addr'))s('cf2-addr').value=job.address||'';
  if(s('cf2-landlord'))s('cf2-landlord').value=job.referrer||job.landlordName||'';
  // Same landlord→agency→agent precedence createCertEntry uses (main.js).
  if(s('cf2-email'))s('cf2-email').value=job.landlordEmail||job.agencyEmail||job.agentEmail||'';
  if(s('cf2-phone'))s('cf2-phone').value=job.landlordPhone||job.agencyPhone||job.agentPhone||'';
  if(s('cf2-agent'))s('cf2-agent').value=job.agentName||'';
  if(s('cf2-engineer'))s('cf2-engineer').value=job.engineer||'';
  const linkedEl=s('cf2-job-linked'), linkedTxt=s('cf2-job-linked-txt');
  if(linkedEl)linkedEl.style.display='block';
  if(linkedTxt)linkedTxt.textContent=`✓ Linked to Job ${job.jobNum||job.id} — fields below auto-filled`;
  toast('Details auto-filled from job','success');
}

export function certUnlinkJob(){
  _formJobId=null; _formJobNum='';
  const s=id=>document.getElementById(id);
  if(s('cf2-job'))s('cf2-job').value='';
  const linkedEl=s('cf2-job-linked');
  if(linkedEl)linkedEl.style.display='none';
}

// Address autofill
export async function updateCertAddrSugg(){
  const inp=document.getElementById('cf2-addr'); if(!inp)return;
  const val=inp.value.toLowerCase(); const drop=document.getElementById('cf2-addr-sugg'); if(!drop)return;
  if(val.length<2){drop.style.display='none';return;}
  const all=await dAll('certs');
  const matches=[...new Set(all.map(c=>c.address).filter(a=>a&&a.toLowerCase().includes(val)))].slice(0,6);
  if(!matches.length){drop.style.display='none';return;}
  drop.innerHTML=matches.map(m=>`<li onclick="document.getElementById('cf2-addr').value='${m.replace(/'/g,"\\'")}';document.getElementById('cf2-addr-sugg').style.display='none'" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)">${m}</li>`).join('');
  drop.style.display='block';
}

// Contact autofill
export async function certContactSugg(fieldId){
  const inp=document.getElementById(fieldId); if(!inp)return;
  const val=inp.value.toLowerCase(); const drop=document.getElementById(fieldId+'-sugg'); if(!drop)return;
  if(val.length<2){drop.style.display='none';return;}
  const all=await dAll('certs');
  const seen=new Set(); const contacts=[];
  all.forEach(c=>{const sig=`${c.landlord}|${c.email}|${c.phone}`;if(!seen.has(sig)&&c.landlord){seen.add(sig);contacts.push(c);}});
  const field=fieldId.replace('cf2-','');
  const matches=contacts.filter(c=>(c[field]||'').toLowerCase().includes(val)).slice(0,5);
  if(!matches.length){drop.style.display='none';return;}
  drop.innerHTML=matches.map(c=>`<li onclick="certFillContact(${JSON.stringify({landlord:c.landlord,email:c.email,phone:c.phone,agent:c.agent}).replace(/"/g,'&quot;')})" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"><strong>${c.landlord||'—'}</strong><span style="color:var(--txt3);font-size:11px;margin-left:8px">${c.email||''}</span></li>`).join('');
  drop.style.display='block';
}

export function certFillContact(obj){
  const s=id=>document.getElementById(id);
  if(s('cf2-landlord'))s('cf2-landlord').value=obj.landlord||'';
  if(s('cf2-email'))   s('cf2-email').value=obj.email||'';
  if(s('cf2-phone'))   s('cf2-phone').value=obj.phone||'';
  if(s('cf2-agent'))   s('cf2-agent').value=obj.agent||'';
  document.querySelectorAll('.autofill-drop').forEach(d=>d.style.display='none');
  toast('Contact details auto-filled');
}

// Individual reminders from table
export async function certSendIndivEmail(id){
  const c=await dGet('certs',id); if(!c||!c.email)return toast('No email for this cert','warn');
  const diff=c.expiryDate?daysDiff(c.expiryDate):null;
  const expired=diff!==null&&diff<0;
  const subj=`${expired?'URGENT: ':'Reminder: '}Compliance Certificate — ${c.address}`;
  const body=`Hi ${c.landlord||'Client'},%0D%0A%0D%0AThe ${c.type} certificate for ${c.address} is ${expired?`EXPIRED (${Math.abs(diff)} days overdue)`:`expiring in ${diff} days on ${formatDateUK(c.expiryDate)}`}.%0D%0A%0D%0APlease confirm if you would like to book a renewal.%0D%0A%0D%0AThanks,\nDeepFlow`;
  window.location.href=`mailto:${c.email}?subject=${encodeURIComponent(subj)}&body=${body}`;
}

export async function certSendIndivWA(id){
  const c=await dGet('certs',id); if(!c||!c.phone)return toast('No phone for this cert','warn');
  const diff=c.expiryDate?daysDiff(c.expiryDate):null;
  const expired=diff!==null&&diff<0;
  let body=`*COMPLIANCE ALERT*\n\n*Property:* ${c.address}\n*Certificate:* ${c.type}\n`;
  body+=expired?`*Status:* EXPIRED (${formatDateUK(c.expiryDate)})\n\n`:`*Status:* Expiring on ${formatDateUK(c.expiryDate)}\n\n`;
  body+=`Please reply *YES* to renew.\n\nDeepFlow`;
  const phone=c.phone.replace(/\D/g,'').replace(/^0/,'44');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`,'_blank');
}
