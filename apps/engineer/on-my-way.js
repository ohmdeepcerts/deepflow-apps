// On My Way Messages — pre-filled WhatsApp messages an engineer sends to
// the tenant/client and to the office announcing they're travelling to a
// job, plus the live preview shown while composing. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, Employee App
// module 8) — no behaviour changes.
//
// currentJob/currentUser are reassigned elsewhere in main.js, read here
// through exported getters. OFFICE_WA_NUMBER is also reassigned
// elsewhere (_loadOfficeSettings(), called from showApp()) — it's read
// through a new getOfficeWaNumber() rather than the original
// `typeof OFFICE_WA_NUMBER!=='undefined'` guard, because that guard
// silently stopped working the moment this code left main.js's module
// scope (ES modules don't share lexical scope, so `typeof` on a name
// declared only in another module is always 'undefined' — not an error,
// just quietly wrong). S_CO had no readers or writers anywhere else in
// main.js, so it moved wholly into this module.

import { getCurrentJob, getCurrentUser, getOfficeWaNumber } from './main.js';

function _getEtaTime(mins){
  const d=new Date();d.setMinutes(d.getMinutes()+parseInt(mins||20));
  return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
export function updateOmwPreview(){
  const currentJob=getCurrentJob(), currentUser=getCurrentUser();
  const to=document.getElementById('omw-to')?.value||currentJob?.address||'the property';
  const eta=document.getElementById('omw-eta')?.value||20;
  const etaTime=_getEtaTime(eta);
  const engineer=currentUser?.name||'Your engineer';
  const msg=`Hi, this is ${engineer} from ${S_CO?.coName||'the office'}.

I'm on my way to:
📍 ${to}

🕐 I should arrive in approximately ${eta} minutes (around ${etaTime}).

Please make sure access is available. Thank you! 👷⚡`;
  const prev=document.getElementById('omw-preview');
  if(prev)prev.textContent=msg;
}
// S_CO fallback
let S_CO={coName:''};
try{const raw=localStorage.getItem('df_setting_coName');if(raw)S_CO.coName=JSON.parse(raw);}catch(e){}

export function sendOmwClient(){
  const currentJob=getCurrentJob(), currentUser=getCurrentUser();
  const to=document.getElementById('omw-to')?.value||currentJob?.address||'the property';
  const eta=document.getElementById('omw-eta')?.value||20;
  const etaTime=_getEtaTime(eta);
  const phone=currentJob?.contact?.replace(/\D/g,'')||currentJob?.tenantPhone?.replace(/\D/g,'')||'';
  const msg=encodeURIComponent(`Hi, this is ${currentUser?.name||'Your engineer'} from ${S_CO.coName||'the office'}.

I'm on my way to:
📍 ${to}

ETA: approx ${eta} mins (around ${etaTime}).

Please ensure access is available. Thank you! 👷⚡`);
  window.open(`https://wa.me/${phone}?text=${msg}`,'_blank');
  if(navigator.vibrate)navigator.vibrate(40);
}
export function sendOmwOffice(){
  const currentJob=getCurrentJob(), currentUser=getCurrentUser();
  const to=document.getElementById('omw-to')?.value||currentJob?.address||'—';
  const eta=document.getElementById('omw-eta')?.value||20;
  const etaTime=_getEtaTime(eta);
  const msg=encodeURIComponent(`🚗 *On My Way*
👷 ${currentUser?.name||'Engineer'}
📍 Heading to: ${to}
🕐 ETA: ~${eta} mins (${etaTime})`);
  const officeNum=getOfficeWaNumber()||'';
  window.open(`https://wa.me/${officeNum}?text=${msg}`,'_blank');
  if(navigator.vibrate)navigator.vibrate(40);
}

// Pre-fill On My Way with current job if open
export function _prefillOmw(){
  const currentJob=getCurrentJob();
  if(currentJob){
    const addr=document.getElementById('omw-to');
    if(addr&&!addr.value)addr.value=currentJob.address||'';
    updateOmwPreview();
  }
}
