import { SB_URL, SB_KEY, restFetch, createSupaAuthClient, makeJwtResolver } from '@core';
import { escHtml } from '@ui';
import { toDb as _toDb, fromDb as _fromDb, createRepository, TO_DB as _TO_DB } from '@data';
import { STATUS, calcLineItemsTotal, officeVatRate, daysDiff, formatDateUK } from '@business';
import { createOfflineQueue } from '@offline';
import {
  getCertTab, switchCertTab, filterCerts, clearCertFilters, renderCertTable, certPageNav,
  toggleAllCerts, bulkNRToggle, bulkDeleteCerts, editCertRecord, openCertForm, ctypeToggle,
  saveCertForm, cancelCertForm, updateCertAddrSugg, certContactSugg, certFillContact,
  certSendIndivEmail, certSendIndivWA, renderCertStats, setCremMode, generateBulkReminder,
  copyCremMsg, importCertCSV, exportCertCSV, exportCertPDF, downloadCertTemplate, renderCertDash,
  addExpiryToExistingCert, previewCertPdf, uploadCertPdf, removeCertPdf, saveCert, createRenewalJob,
} from './certs.js';
import {
  getCurDirSection, switchDirSection, renderDir, renderDirSection, updateDirTabBadges,
  openPersonModal, openPersonModalFor, savePerson, deleteCurrentPerson, openPersonWA,
  openAgencyModal, saveAgency, deleteCurrentAgency, openAgentModal, saveAgent, deleteCurrentAgent,
  openEngDir, matchDir, fillFromMatch, openImportModal,
} from './directory.js';
import {
  logAudit, sendNotificationWebhook, sendPushNotification, notifyNextTenantEta,
  switchAuditTab, renderAuditLog, exportAuditLog, initAuditLog, testNotifWebhook,
} from './audit.js';
import { onMapViewChange, renderMapPage, loadEngineerLocations } from './maps.js';
import {
  initEngReport, renderEngReport, openEngDeepReport, downloadEngPayslip, exportEngReport,
  exportEngReportPDF, showAllEngJobs, _switchEngDeepTab, _editEngFromDeep, _renderEngDeepJobsList,
} from './engineer-reports.js';
import {
  stmtQuickRange, stmtClearFilters, renderStmt, stmtToggleSel, stmtToggleAll,
  bulkDownloadPDFs, printFilteredInvoices,
} from './statements.js';
import {
  openExpenseModal, saveExpense, deleteCurrentExpense, renderExpenses, exportExpensesCSV,
} from './expenses.js';
import { openCreditNoteModal, addCreditItem, fillCreditNote, saveCreditNote } from './credit-notes.js';
import {
  getWeekDates, renderTS, selEngineer, renderTSDetail, waTimesheetSummary, getTsOff,
} from './timesheets.js';
import { renderInvCustomTexts, addInvCustomText, removeInvCustomText } from './invoice-custom-text.js';
import { renderSqlSnippets, copySql } from './sql-guide.js';
import { exportMasterXLSX } from './master-xlsx-export.js';
import { oneClickBackup, showJobsSkeleton, checkCronSetup } from './backup-diagnostics.js';

// ════════════════════════════════════════════════════════════════
//  DATABASE — Supabase
//  Schema field names match the app exactly — no mapping needed
// ════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════
//  DeepFlow v2.7 — Production build
//  © 2024-2026 DeepFlow. Internal use only.
// ═══════════════════════════════════════════
const DF_VERSION = '2.7';

// Global unhandled error catcher — surfaces silent failures in production
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
});
window.onerror = (msg, src, line) => {
  console.error(`JS error: ${msg} (${src}:${line})`);
};

// ══════════════════════════════════════════════════════════════
// DEEPFLOW CORE — credentials, STATUS constants, field mapping,
// unified fetch layer, event bus. All in one file — no external deps.
// ══════════════════════════════════════════════════════════════

// SB_URL/SB_KEY/restFetch now live in @core (imported at the top of
// main.js — see ARCHITECTURE_REDESIGN_PROPOSAL.md Phase 1). STATUS, the
// field mapping, and escHtml below stay local/imported per the same
// Phase 1 vs Phase 2 split used for the other two apps.
const _supaAuth = createSupaAuthClient();
if(!_supaAuth){console.error('[DeepFlow] Supabase client failed to load. Check internet connection.');}

// STATUS now lives in @business (Phase 3) — was byte-identical to the
// Employee App's own copy before this extraction.

// ── FIELD MAPPING: camelCase JS ↔ lowercase Supabase columns ─
// Now lives in @data (Phase 2 — see ARCHITECTURE_REDESIGN_PROPOSAL.md);
// this file's copy WAS the source that @data's mapping was taken from
// (already the most complete of the three apps'), so this is a pure
// extraction with no field-list changes. _toDb/_fromDb are imported above,
// aliased to their original names since 11 call sites throughout this file
// reference them directly.
export function _fix(j){if(!j||typeof j!=='object')return j;return _fromDb('jobs',j);}

// ── UNIFIED FETCH LAYER ──────────────────────────────────────
export const _getJWT = makeJwtResolver(_supaAuth);
export async function _sb(path,opts={}){
  const isWrite = opts.method&&opts.method!=='GET';
  if(isWrite){ _pendingSaves=(_pendingSaves||0)+1; if(typeof _setSyncing==='function')_setSyncing(); }
  const jwt=await _getJWT();
  try{
  const res=await restFetch(path,opts,jwt);
  const txt=await res.text();
  if(!res.ok){
    if(isWrite){ _pendingSaves=Math.max(0,(_pendingSaves||1)-1); if(typeof _setOffline==='function'&&!navigator.onLine)_setOffline(); }
    throw new Error(`[DeepFlow] ${path} → ${res.status}: ${txt}`);
  }
  if(isWrite){
    _pendingSaves=Math.max(0,(_pendingSaves||1)-1);
    if((_pendingSaves||0)===0&&typeof _flashSynced==='function') _flashSynced();
  }
  return txt?JSON.parse(txt):null;
  }catch(e){
    if(isWrite){ _pendingSaves=Math.max(0,(_pendingSaves||1)-1); }
    if(!navigator.onLine&&typeof _setOffline==='function') _setOffline();
    throw e;
  }
}

// ── Offline write queue — now in @offline (Phase 4). Badge rendering stays
// local (own DOM id/CSS position), as does what happens on a fully-synced
// flush (this app also refreshes the Jobs list — the Employee App's
// equivalent does not, see tests/unit/offline-queue.test.js).
const _officeQueue = createOfflineQueue('df_office_offline_queue', {
  sbFetch: _sb,
  onQueueChange: (count) => _renderOfflineBadge(count),
  onSynced: () => { toast('✅ Synced — all offline changes saved','success'); _invalidateJobCache(); _renderJobsKeepScroll(); },
});
const queueableSave = _officeQueue.queueableSave;
const _flushOfflineQueue = _officeQueue.flush;

function _renderOfflineBadge(count){
  let el=document.getElementById('offline-queue-badge');
  if(!count){
    if(el) el.remove();
    return;
  }
  if(!el){
    el=document.createElement('div');
    el.id='offline-queue-badge';
    el.style.cssText=`position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9998;
      background:#78350f;color:#fde68a;border:1px solid #d97706;border-radius:20px;
      padding:8px 16px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px;
      box-shadow:0 4px 16px rgba(0,0,0,.3);`;
    document.body.appendChild(el);
  }
  el.innerHTML=`⏳ ${count} change${count!==1?'s':''} waiting to sync`;
}

window.addEventListener('online', _flushOfflineQueue);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') _flushOfflineQueue(); });
setInterval(_flushOfflineQueue, 20000);
// Restore badge on load if a previous offline session left items queued
_renderOfflineBadge(_officeQueue.getQueue().length);

// ── EVENT BUS — replaces setTimeout coordination hacks ───────
// df.on('jobSaved', fn)  df.emit('jobSaved')  df.once('navDone:jobs', fn)
const df=(()=>{
  const _L={};
  function on(ev,fn,opts={}){if(!_L[ev])_L[ev]=[];_L[ev].push({fn,once:!!opts.once});}
  function off(ev,fn){if(_L[ev])_L[ev]=_L[ev].filter(l=>l.fn!==fn);}
  function emit(ev,...args){
    if(!_L[ev])return;
    const run=[..._L[ev]];
    _L[ev]=_L[ev].filter(l=>!l.once);
    run.forEach(l=>{try{l.fn(...args);}catch(e){console.warn('[DeepFlow] bus error',ev,e);}});
  }
  function once(ev,fn){on(ev,fn,{once:true});}
  return{on,off,emit,once};
})();

// Auto-save job form draft every 5 seconds
setInterval(()=>{
  const mo=document.getElementById('mo-job');
  if(mo&&mo.classList.contains('open')){
    const d={};
    const ids=['jf-addr','jf-ref','jf-desc','jf-time','jf-eng','jf-date','jf-access','jf-contact','jf-hours','jf-price','jf-priority','jf-status','jf-notes','jf-ll-name','jf-ll-phone','jf-ll-email','jf-ll-addr','jf-ll-wa','jf-agency','jf-agent'];
    ids.forEach(id=>{const el=document.getElementById(id);if(el)d[id]=el.value;});
    localStorage.setItem('df_job_draft',JSON.stringify(d));
  }
},5000);

// These stores live in localStorage — no network calls
// FIX BUG1: payments, expenses, overtime all moved to Supabase.
// properties live in the app_settings blob (via saveSetting) so dAll('properties') is never called.
// Only 'settings' remains local — it is managed entirely through S/saveSetting/saveAllSettings.
const _LOCAL = new Set(['settings']);

// uid() and TODAY() are office-only utilities
export const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random()*16|0;
  return (c==='x' ? r : (r&0x3|0x8)).toString(16);
});
export const TODAY = () => new Date().toISOString().slice(0,10);

// dGet/dAll/dPut/dDel now come from @data's generic repository (Phase 2) —
// this was already byte-for-byte what that factory implements (it was
// built from this exact code, being the most complete of the three apps'
// data-access patterns). Bound to this app's own _sb, matching the
// factory's design of taking the caller's fetch function as a parameter
// rather than assuming one, since Phase 1 preserved each app's fetch
// wrapper as deliberately different (sync-state tracking here, none in the
// other two apps).
export const { dGet, dAll, dPut, dDel } = createRepository(_sb, { localTables: _LOCAL });

// ── Settings cache ──
export let S = {
  trades:[{name:'Gas',color:'#5b8ef0',defPrice:120},{name:'Electrical',color:'#f0c030',defPrice:150},{name:'Plumbing',color:'#25d5a8',defPrice:100},{name:'General',color:'#b06ef0',defPrice:80}],
  certTypes:[
    {id:'ct1',name:'Gas Safety',validity:12,reminder:30,keywords:['gas','boiler','heating','gas safety','gas check','gas service'],color:'#5b8ef0',prefix:'GAS-'},
    {id:'ct2',name:'Electrical (EICR)',validity:60,reminder:60,keywords:['electrical','electric','eicr','rewire','fuse','consumer unit'],color:'#f0c030',prefix:'EICR-'},
    {id:'ct3',name:'Fire Alarm',validity:12,reminder:30,keywords:['fire alarm','smoke detector','fire','alarm'],color:'#e05252',prefix:'FIRE-'},
    {id:'ct4',name:'Emergency Lighting',validity:12,reminder:30,keywords:['emergency light','emergency lighting','emerg light'],color:'#f07030',prefix:'EML-'},
    {id:'ct5',name:'PAT Testing',validity:12,reminder:30,keywords:['pat','pat test','appliance test','portable appliance'],color:'#25d58e',prefix:'PAT-'},
    {id:'ct6',name:'EPC',validity:120,reminder:90,keywords:['epc','energy performance','energy certificate'],color:'#b06ef0',prefix:'EPC-'},
    {id:'ct7',name:'Legionella',validity:24,reminder:60,keywords:['legionella','water risk','water assessment'],color:'#25d5a8',prefix:'LEG-'},
  ],
  engineers:[], // Loaded from Supabase users table on startup — never hardcoded
  access:['Key Safe','Landlord Present','Tenant Home','Vacant – Call Before'],
  properties:[],
  jobPrefix:'JOB-', jobNextNum:1001,
  vatRate:20,vatEnabled:false,
  notifWebhookEnabled:false,notifWebhookUrl:'',notifOnStatusChange:true,notifOnCertReady:true,notifPushEnabled:false,notifNextTenantEta:false,
  coName:'',coEmail:'',coPhone:'',coAddr:'',coVatNum:'',
  owner:'Boss',
  logoData:'',
  payTerms:'Payment due within 14 days',
  invPrefix:'INV-',invStart:1001,invNextNum:1001,
  invNotes:'Thank you for your business!',
  bankName:'',bankAcc:'',bankSort:'',bankIBAN:'',
  waJobTpl:`*{company_name}* — Job Dispatch 📋\n\nHi *{engineer_name}*, here are your jobs:\n\n{jobs_list}\n\nPlease confirm receipt ✅`,
  waInvTpl:`Hello *{client_name}*,\n\nPlease find below your invoice from *{company_name}*:\n\n📄 Invoice: *{invoice_num}*\n📝 For: {description}\n💰 Amount: *£{amount}*\n📅 Due: {due_date}\n\nPlease make payment to:\n{bank_details}\n\nThank you! 🙏`,
  waTenantTpl:`Hello *{tenant_name}*,\n\n*{company_name}* will be visiting:\n\n🏠 {address}\n📅 {date}\n🕐 {time_slot}\n👷 Engineer: {engineer}\n\nPlease ensure access is available.\n📞 {company_phone}\n\nThank you!`,
  waLandlordTpl:`Hello *{landlord_name}*,\n\nWork has been completed at *{address}*.\n\n✅ Job: {description}\n👷 Engineer: {engineer}\n\nAll works were completed satisfactorily.\n\nKind regards,\n*{company_name}*\n📞 {company_phone}`,
  waOverdueTpl:'',
  savedViews:[],
  dashNotes:'',
  // v3 additions
  invShowVat:true, invShowBank:true, invShowLogo:true, invShowTerms:true,
  invShowNotes:true, invShowJobref:true, invShowAgent:true, invShowPayref:true,
  invShowSubtotal:true, invShowSig:false, invEmailAuto:true, invCCAgent:true,
  invWatermarkPaid:true, invPdfColor:'#15803d',
  invFooter:'', invSubtitle:'Tax Invoice', invSigLabel:'Authorised Signature:',
  invCustomTexts:[], // [{id,label,content,enabled}]
  themeMode:'manual', // manual | auto | scheduled
  themeLightStart:'07:00', themeLightEnd:'20:00',
  // Invoice sync & automation settings (v10)
  invSyncAmount:true,
  invSyncDesc:true,
  invDraftOnJobChange:true,
  invAutoDraftOnComplete:true,
  invNotifyAdminOnEdit:true,
  invShowAuditTrail:true,
};

async function initDB(){ /* no-op — Supabase REST needs no initialisation */ }

async function loadSettings(){
  // 1. Load from localStorage first (instant, works offline)
  for(const k of Object.keys(S)){
    if(k==='users'||k==='engineers') continue;
    const v=localStorage.getItem('df_setting_'+k);
    if(v!=null){try{S[k]=JSON.parse(v)}catch(e){ console.warn('[DeepFlow]', e); }}
  }
  // 2. Load from Supabase DB — overrides localStorage so all users see same settings
  await _loadSettingsFromDb();
  // 2. Fetch ALL users from Supabase — single source of truth for every device
  // Explicitly get the JWT first to avoid timing gap with session restore
  try{
    const _jwt = await _getJWT();
    const allSbUsers = await (async()=>{
      const res = await fetch(`${SB_URL}/rest/v1/users?active=eq.true&order=name.asc&select=*`, {
        headers: {'apikey':SB_KEY,'Authorization':'Bearer '+_jwt,'Content-Type':'application/json'}
      });
      if(!res.ok) throw new Error(await res.text());
      return (await res.json()) || [];
    })();
    if(allSbUsers&&allSbUsers.length){
      const sbEngs=allSbUsers.filter(u=>u.role==='engineer');
      const sbOffice=allSbUsers.filter(u=>u.role!=='engineer');

      // Engineers: merge Supabase identity with cached local extras (rate/wa/trade)
      const localEngs=JSON.parse(localStorage.getItem('df_setting_engineers')||'[]');
      S.engineers=sbEngs.map(sbe=>{
        const local=localEngs.find(e=>e._sbId===sbe.id||e.name===sbe.name)||{};
        return {
          ...local, _sbId:sbe.id,
          name:sbe.name,
          phone:sbe.phone||local.phone||'',
          pin:sbe.pin||local.pin||'',
          rate:local.rate||0, otRate:local.otRate||0,
          wa:local.wa||sbe.wa||'',
          trade:local.trade||'', capacity:local.capacity||8,
        };
      });
      localStorage.setItem('df_setting_engineers',JSON.stringify(S.engineers));

      // Office users: rebuild entirely from Supabase, preserve local permission overrides
      const localUsers=JSON.parse(localStorage.getItem('df_setting_users')||'[]');
      // Managers cannot see Admin accounts
    const visibleUsers = (_appUser?.role==='Manager')
      ? sbOffice.filter(su=>su.role!=='admin' && !PROTECTED_ADMINS.includes((su.email||'').toLowerCase()))
      : sbOffice;
    S.users=visibleUsers.map(su=>{
        const local=localUsers.find(u=>u._sbId===su.id||u.name===su.name)||{};
        const isProtected=PROTECTED_ADMINS.includes((su.email||'').toLowerCase());
        // Protected admins are ALWAYS Admin regardless of what's in DB or local cache
        const role=isProtected?'Admin':su.role==='admin'?'Admin':su.role==='manager'?'Manager':su.role==='viewer'?'Viewer':su.role==='engineer'?'Engineer':'Staff';
        const isAdmin=role==='Admin'||role==='Manager';
        return {
          id:su.id, _sbId:su.id, name:su.name, email:su.email||'', pin:su.pin||'', role,
          canEdit:   local.canEdit   !==undefined ? local.canEdit   : true,
          canDelete: local.canDelete !==undefined ? local.canDelete : isAdmin,
          canInvoice:local.canInvoice!==undefined ? local.canInvoice: true,
          canFinance:local.canFinance!==undefined ? local.canFinance: isAdmin,
          seeLandlord:     local.seeLandlord      !==undefined ? local.seeLandlord     : true,
          seeLandlordPhone:local.seeLandlordPhone !==undefined ? local.seeLandlordPhone: true,
          seeAgent:        local.seeAgent         !==undefined ? local.seeAgent        : true,
          seeContact:      local.seeContact       !==undefined ? local.seeContact      : true,
          seePrice:        local.seePrice         !==undefined ? local.seePrice        : isAdmin||true,
        };
      });
      localStorage.setItem('df_setting_users',JSON.stringify(S.users));
    }
  }catch(e){
    console.warn('Supabase user fetch failed, using cached data:',e.message);
    try{S.engineers=JSON.parse(localStorage.getItem('df_setting_engineers')||'[]');}catch(x){}
    try{S.users    =JSON.parse(localStorage.getItem('df_setting_users')||'[]');}catch(x){}
  }
}
export async function saveSetting(k,v){
  S[k]=v;
  localStorage.setItem('df_setting_'+k,JSON.stringify(v));
}

async function saveAllSettings(){
  // 1. Save everything to localStorage
  for(const[k,v]of Object.entries(S)) localStorage.setItem('df_setting_'+k,JSON.stringify(v));
  // 2. Save everything to Supabase as ONE row (key='__all__')
  await _pushAllSettingsToDb();
}

async function _pushAllSettingsToDb(){
  const skip=['users','engineers'];
  const snapshot={};
  for(const[k,v]of Object.entries(S)){
    if(!skip.includes(k)) snapshot[k]=v;
  }
  try{
    const jwt=await _getJWT();
    const headers={
      'apikey':SB_KEY,
      'Authorization':'Bearer '+jwt,
      'Content-Type':'application/json',
      'Prefer':'resolution=merge-duplicates,return=minimal'
    };
    // Single POST with upsert — inserts if not exists, updates if exists
    const res=await fetch(`${SB_URL}/rest/v1/app_settings`,{
      method:'POST', headers,
      body:JSON.stringify({key:'__all__',value:JSON.stringify(snapshot),updated:Math.floor(Date.now()/1000)})
    });
    if(!res.ok){
      const err=await res.text();
      console.warn('Settings save failed:',res.status,err);
    } else {
      }
  }catch(e){
    console.warn('Settings push failed:',e.message);
  }
}

async function _loadSettingsFromDb(){
  try{
    const rows=await _sb('app_settings?key=eq.__all__&select=value');
    if(!rows||!rows.length) return false;
    const snapshot=JSON.parse(rows[0].value);
    const skip=['users','engineers'];
    for(const[k,v]of Object.entries(snapshot)){
      if(skip.includes(k)) continue;
      S[k]=v;
      localStorage.setItem('df_setting_'+k,JSON.stringify(v));
    }
    return true;
  }catch(e){
    console.warn('Settings DB load failed, using localStorage:',e.message);
    return false;
  }
}

// ── Activity log ──
export async function logActivity(msg, type='info', refs={}){
  // refs: {jobId, invId, jobNum, invNum, staff, amount, oldVal, newVal}
  await dPut('activity',{id:uid(), msg, type, ts:Date.now(), ...refs}).catch(()=>{});
}

// ════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════
const PTITLES={dash:'Dashboard',jobs:'Job Management',inv:'Invoices',stmt:'Statements',exp:'Expenses & Materials',ts:'Timesheets',rep:'Reports',req:'Job Requests',dir:'Directories',props:'Properties',certs:'Certificates',client:'Client View',set:'Settings',map:'Live Maps & Engineer Tracking',team:'Team',engrep:'Engineer Reports',audit:'Audit Log'};
let curPg='dash';


// ════════════════════════════════════════════════════════════════
//  CLIENT PORTAL SHARING
// ════════════════════════════════════════════════════════════════
export function _portalBaseUrl() {
  // Auto-detect: works on GitHub Pages or local file
  const loc = window.location.href;
  // If on GitHub Pages
  if (loc.includes('github.io')) {
    return loc.substring(0, loc.lastIndexOf('/') + 1) + 'client-portal.html';
  }
  // If running locally, use same folder
  return loc.substring(0, loc.lastIndexOf('/') + 1) + 'client-portal.html';
}

function _buildPortalUrl(id, type, name) {
  const base = `${_portalBaseUrl()}?id=${encodeURIComponent(id)}&type=${type}`;
  // Agent portals need name in URL — agents table has no anon RLS policy
  // so the portal can't look up the agent by ID. Name is the lookup key.
  return name ? base + `&name=${encodeURIComponent(name)}` : base;
}

function shareClientPortal(id, name, type, agentName) {
  const url = _buildPortalUrl(id, type, agentName);
  if (navigator.share) {
    navigator.share({ title: `${name} — DeepFlow Portal`, url })
      .catch(() => _copyPortalFallback(url, name));
  } else {
    _copyPortalFallback(url, name);
  }
}

function copyClientPortal(id, name, type, agentName) {
  const url = _buildPortalUrl(id, type, agentName);
  _copyPortalFallback(url, name);
}

function _copyPortalFallback(url, name) {
  navigator.clipboard.writeText(url).then(() => {
    toast(`📋 Portal link copied for ${name}`, 'success', 4000);
  }).catch(() => {
    // Legacy fallback
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast(`📋 Portal link copied for ${name}`, 'success', 4000);
  });
}

// ── CLIENT PORTAL — PERMANENT LINK + QR CODE ─────────────────────────────
// Backward compat: delegates to the new visiting card design
function showPortalLinkModal(id, name, type, agentName) {
  showPortalInviteModal(id, name, type, agentName);
}

function _generateQR(url) {
  const wrap = document.getElementById('qr-wrap');
  if (!wrap) return;

  // Build QR using Google Charts API (no library needed)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=1e3a5f&qzone=1`;
  const img = document.createElement('img');
  img.src = qrUrl;
  img.style.cssText = 'width:130px;height:130px;border-radius:12px';
  img.onload = () => { wrap.innerHTML = ''; wrap.appendChild(img); };
  img.onerror = () => { wrap.innerHTML = '<div style="font-size:10px;color:#999;text-align:center;padding:10px">QR unavailable<br>(offline?)</div>'; };
}

function _downloadQR(name) {
  const img = document.querySelector('#qr-wrap img');
  if (!img) { toast('QR not ready yet', 'warn'); return; }
  const a = document.createElement('a');
  a.href = img.src;
  a.download = `${name.replace(/[^a-z0-9]/gi, '_')}_portal_qr.png`;
  a.target = '_blank';
  a.click();
  toast('📥 QR code downloading...', 'success');
}

// Resets a client's portal PIN — see PHASE5_PORTAL_PIN_AUTH_SQL.md. This
// deletes the stored (hashed) PIN rather than revealing it; the client will
// be asked to set a brand new one the next time they open their link. The
// link itself never changes.
function _portalPinTableFor(type){ return type==='agency'?'agencies':(type==='agent'?'agents':'persons'); }

function resetPortalPin(id, type, name){
  confirm2(
    'Reset Portal PIN',
    `This will remove ${name}'s current PIN. Their portal link keeps working, but they'll be asked to set a brand new PIN the next time they open it — use this if they forgot it or you want to cut off anyone who only has the old one.`,
    async()=>{
      try{
        await _sb('rpc/portal_pin_reset',{method:'POST',body:{p_table:_portalPinTableFor(type),p_id:id}});
        toast(`🔑 PIN reset for ${name} — they'll set a new one on next visit`,'success',5000);
      }catch(e){
        toast('Failed to reset PIN: '+(e.message||'').slice(0,100),'error',6000);
      }
    }
  );
}

function _copyPortalLink(url, name, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = orig, 2000);
    toast(`📋 Portal link copied for ${name}`, 'success', 3000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    toast(`📋 Portal link copied for ${name}`, 'success', 3000);
  });
}

function _waPortalShare(url, name, btn) {
  const text = `Hi ${name},\n\nHere is your secure portal link to view your jobs, certificates and invoices:\n\n${url}\n\nThis link is permanent — you can bookmark it and use it any time.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

function _emailPortalShare(url, name, btn) {
  const subject = `Your ${_S?.coName || 'DeepFlow'} Client Portal`;
  const body = `Dear ${name},\n\nPlease use the link below to access your secure client portal where you can view your jobs, certificates and invoices:\n\n${url}\n\nThis link is permanent — please bookmark it for easy access.\n\nKind regards,\n${_S?.coName || 'Your Service Provider'}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function nav(pg){
  hideTip(); // Always hide tooltip when navigating — prevents it sticking across pages
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
  document.getElementById('pg-'+pg).classList.add('active');
  const navEl = document.querySelector(`[data-pg="${pg}"]`);
  if(navEl) navEl.classList.add('active');
  document.getElementById('tb-title').textContent=PTITLES[pg]||pg;
  curPg=pg;
  setTopbarActions(pg);
  if(pg==='dash') renderDash();
  if(pg==='jobs') {_invalidateJobCache();renderJobs();renderSavedViews();}
  if(pg==='inv') { renderInvSubnavKPIs(); invNavSelect('dashboard'); updateInvSmartBanner(); }
  if(pg==='stmt') renderStmt();
  if(pg==='exp') renderExpenses();
  if(pg==='ts') renderTS();
  if(pg==='rep') renderReports();
  if(pg==='engrep'){initEngReport();renderEngReport();}
  if(pg==='audit'){ if(_appUser?.role==='Admin') initAuditLog(); else { toast('❌ Admin only','error'); return; } }
  // SECURITY: Block non-admins from Settings entirely
  if(pg==='set' && _appUser?.role !== 'Admin' && _appUser?.role !== 'Manager' && _appUser?.role !== 'Finance'){
    toast('❌ Settings is restricted','error');
    return;
  }
  // Finance: read-only jobs
  if(pg==='jobs' && _appUser?.role==='Finance'){
    // Allow but will be read-only — handled in applyUserPermissions
  }
  // Block pages not in role's allowed list
  const rolePages={
    Admin: null, // null = all pages allowed
    Manager: ['dash','jobs','inv','stmt','rep','req','dir','props','certs','client','set','map'],
    Finance: ['dash','jobs','inv','stmt','rep','dir','props','set'],
    Staff:   ['dash','jobs','inv','stmt','req','dir','props','certs','client'],
  };
  const allowed=rolePages[_appUser?.role];
  if(allowed && !allowed.includes(pg)){
    toast('❌ You do not have access to this page','error');
    return;
  }
  if(pg==='req') renderRequests();
  if(pg==='dir') renderDir();
  if(pg==='props') renderProps();
  if(pg==='certs'){switchCertTab(getCertTab()||'dash');}
  if(pg==='client'){renderClientPicker();}
  if(pg==='set'){renderSettings();setTimeout(loadStorageStats,400);setTimeout(loadEngineerLocations,800);}
  if(pg==='map'){setTimeout(()=>{onMapViewChange();},50);}
  // ISSUE 9 FIX: emit navDone so df.once('navDone:X') subscribers fire instead of setTimeout hacks
  // Use requestAnimationFrame to ensure the render above has painted before listeners fire
  requestAnimationFrame(()=>{ df.emit('navDone', pg); df.emit(`navDone:${pg}`); });
}
function setTopbarActions(pg){
  const a=document.getElementById('tb-actions');
  a.innerHTML='';
  if(pg==='jobs'){
    a.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="openCmd()">⌕ Search</button>
    <button class="btn btn-acc btn-sm" onclick="openJobModal()">+ New Job</button>`;
  }
  if(pg==='dir'){
    a.innerHTML=`<button class="btn btn-acc btn-sm" onclick="openPersonModal()">+ Add Person</button>
    <button class="btn btn-ghost btn-sm" onclick="openAgencyModal()">+ Agency</button>
    <button class="btn btn-ghost btn-sm" onclick="openAgentModal()">+ Agent</button>`;
  }
}
document.querySelectorAll('.ni').forEach(n=>n.addEventListener('click',()=>{
  const pg=n.dataset.pg;
  nav(pg);
}));

// ═══════════════════════════════════════════════════════════════
//  SMART NOTIFICATION BANNER — completed jobs needing invoices
// ═══════════════════════════════════════════════════════════════
async function updateInvSmartBanner(){
  const banner=document.getElementById('inv-smart-banner');
  const countEl=document.getElementById('inv-smart-count');
  if(!banner||!countEl)return;
  try{
    // Was filtering on jobs.invoiced — no table in the schema has that
    // column, so this query always errored and the catch below silently
    // hid the banner, meaning it never once displayed. Fixed to use the
    // same jobId/linkedJobId cross-reference the rest of the app already
    // uses to determine "needs invoicing" (e.g. the Dashboard widget).
    const [jobs,invs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const invoicedIds=new Set([...invs.map(i=>i.jobId),...invs.map(i=>i.linkedJobId)].filter(Boolean));
    const missing=jobs.filter(j=>j.status===STATUS.COMPLETED&&!invoicedIds.has(j.id)).length;
    if(missing>0){
      countEl.textContent=missing;
      banner.style.display='flex';
    }else{
      banner.style.display='none';
    }
  }catch(e){banner.style.display='none';}
}
function dismissInvBanner(){
  const b=document.getElementById('inv-smart-banner');
  if(b)b.style.display='none';
}

// Create drafts for all completed jobs without invoices
async function createDraftsForCompleted(){
  try{
    // Same invoiced-column fix as updateInvSmartBanner() above, plus two
    // compounding bugs in the loop below: autoInvoice() expects a full job
    // object (it reads j.address, j.agencyName, etc.) but was being passed
    // job.id — a bare string — so it always fell through to "no landlord/
    // agent/agency name" and never created anything. And autoInvoice()
    // itself never returned a value, so `created` would have stayed 0
    // even if it had worked. Also call _autoInvoiceInner() directly rather
    // than the autoInvoice() wrapper: this is a manual, explicitly-clicked
    // bulk action, so it shouldn't be silently skipped just because the
    // "auto-create on completion" setting happens to be off.
    const [jobs,invs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
    const invoicedIds=new Set([...invs.map(i=>i.jobId),...invs.map(i=>i.linkedJobId)].filter(Boolean));
    const needDrafts=jobs.filter(j=>j.status===STATUS.COMPLETED&&!invoicedIds.has(j.id)).slice(0,50);
    if(!needDrafts.length){toast('No jobs need drafts','warn');return;}
    let created=0;
    for(const job of needDrafts){
      const r=await _autoInvoiceInner(job);
      if(r)created++;
    }
    toast('Created '+created+' draft invoice(s)','success');
    renderInvList();
    dismissInvBanner();
  }catch(e){toast('Failed: '+e.message,'error');}
}

// ── Legacy COL_DEFS/FCOL_DEFS column manager removed (ISSUE 5) ──
// JOB_COLS system (below) is the sole column manager now.


// ── Column resize ──

document.addEventListener('mousedown', e=>{
  const handle = e.target.closest('.col-resize-handle');
  if(!handle) return;
  e.preventDefault();
  const th = handle.closest('th');
  if(!th) return;
  const colId = th.dataset.col;
  const startX = e.clientX;
  const startW = th.offsetWidth;
  th.classList.add('resizing');
  _resizing = {th, colId, startX, startW};
});
document.addEventListener('mousemove', e=>{
  if(!_resizing) return;
  const diff = e.clientX - _resizing.startX;
  const newW = Math.max(40, _resizing.startW + diff);
  _resizing.th.style.width    = newW + 'px';
  _resizing.th.style.minWidth = newW + 'px';
  // Legacy fluid col preview — no-op (tables are hidden stubs)
});
document.addEventListener('mouseup', ()=>{
  if(!_resizing) return;
  _resizing.th.classList.remove('resizing');
  _resizing = null;
});

// ════════════════════════════════════════════════════════════════
//  DESCRIPTION TOOLTIP (hover popup)
// ════════════════════════════════════════════════════════════════



function showDescTip(e, el){
  // Read from data-desc attribute — 100% safe against quotes, apostrophes, backticks, any special chars
  const text = (el.dataset && el.dataset.desc) ? el.dataset.desc : (el.getAttribute ? el.getAttribute('data-desc') : '') || '';
  if(!text || text==='—') return;
  clearTimeout(_descTipTimer);
  _descTipTimer = setTimeout(()=>{
    if(!_descTipEl){
      _descTipEl = document.createElement('div');
      _descTipEl.className = 'desc-tooltip';
      document.body.appendChild(_descTipEl);
    }
    _descTipEl.innerHTML = `<div class="desc-tooltip-title">📝 Full Description</div><div class="desc-tooltip-body"></div>`;
    // Use textContent so any character renders safely — no escaping needed
    _descTipEl.querySelector('.desc-tooltip-body').textContent = text;
    _descTipEl.style.display = 'block';
    const x = Math.min(e.clientX + 16, window.innerWidth - 360);
    const y = e.clientY + 20;
    _descTipEl.style.left = x+'px';
    _descTipEl.style.top  = y+'px';
    requestAnimationFrame(()=>{
      if(!_descTipEl) return;
      const rect = _descTipEl.getBoundingClientRect();
      if(rect.bottom > window.innerHeight - 12)
        _descTipEl.style.top = (e.clientY - rect.height - 12)+'px';
      if(rect.right > window.innerWidth - 8)
        _descTipEl.style.left = (window.innerWidth - rect.width - 8)+'px';
    });
  }, 200);
}

function hideDescTip(){
  clearTimeout(_descTipTimer);
  if(_descTipEl) _descTipEl.style.display = 'none';
}

// ════════════════════════════════════════════════════════════════
//  JOB COMMENTS (per-job threaded notes)
// ════════════════════════════════════════════════════════════════


function toggleJobComments(jobId, cellEl){
  const tr = cellEl.closest('tr');
  if(!tr) return;
  // If same row is already open, close it
  if(_openCommentJobId === jobId){
    const existing = tr.nextElementSibling;
    if(existing && existing.classList.contains('comments-panel-row')){
      existing.remove();
    }
    _openCommentJobId = null;
    return;
  }
  // Close any other open comment panels
  document.querySelectorAll('.comments-panel-row').forEach(r=>r.remove());
  _openCommentJobId = jobId;
  _renderCommentPanel(jobId, tr);
}

async function _renderCommentPanel(jobId, afterRow){
  const job = await dGet('jobs', jobId);
  if(!job) return;
  const comments = job.comments || [];
  const panelRow = document.createElement('tr');
  panelRow.className = 'comments-panel-row';
  // Count visible columns
  const visibleCols = afterRow.querySelectorAll('td:not([style*="display: none"]):not([style*="display:none"])').length;
  panelRow.innerHTML = `<td colspan="${visibleCols||15}" style="padding:0;border-bottom:2px solid var(--border2)">
    <div class="comments-panel">
      <div style="font-family:var(--fh);font-size:12px;font-weight:700;color:var(--txt2);margin-bottom:8px;display:flex;align-items:center;gap:8px">
        💬 Job Comments
        <span style="font-size:10px;color:var(--txt3);font-weight:400">${comments.length} comment${comments.length!==1?'s':''} · visible to all users</span>
        <button onclick="document.querySelectorAll('.comments-panel-row').forEach(r=>r.remove());_openCommentJobId=null" style="margin-left:auto;background:none;border:none;cursor:pointer;color:var(--txt3);font-size:14px" title="Close">✕</button>
      </div>
      <div id="cmt-list-${jobId}">
        ${comments.length ? comments.map(c=>`
          <div class="comment-row" data-cid="${c.id}">
            <div class="comment-avatar">${(c.author||'?')[0].toUpperCase()}</div>
            <div class="comment-body">
              <span class="comment-author">${c.author||'Unknown'}</span>
              <span class="comment-time">${_fmtCommentTime(c.ts)}</span>
              <div class="comment-text">${_escHtml(c.text)}</div>
            </div>
            ${c.author===S.owner?`<button onclick="deleteComment('${jobId}','${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--txt3);font-size:12px;padding:2px 4px;align-self:flex-start;opacity:.5" title="Delete">✕</button>`:''}
          </div>`).join('')
          : `<div style="font-size:12px;color:var(--txt3);padding:8px 0">No comments yet — be the first to add a note.</div>`}
      </div>
      <div class="comment-input-row">
        <input class="comment-input" id="cmt-inp-${jobId}" placeholder="Add a comment… (Enter to send)" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();postComment('${jobId}')}">
        <button class="btn btn-acc btn-xs" onclick="postComment('${jobId}')">Send</button>
      </div>
    </div>
  </td>`;
  afterRow.after(panelRow);
  // Focus the input
  setTimeout(()=>document.getElementById(`cmt-inp-${jobId}`)?.focus(), 50);
}

async function postComment(jobId){
  const inp = document.getElementById(`cmt-inp-${jobId}`);
  if(!inp) return;
  const text = inp.value.trim();
  if(!text) return;
  const job = await dGet('jobs', jobId);
  if(!job) return;
  const comment = {
    id: uid(),
    author: S.owner||'User',
    text,
    ts: Date.now()
  };
  job.comments = [...(job.comments||[]), comment];
  await dPut('jobs', job);
  inp.value = '';
  // Refresh panel
  const list = document.getElementById(`cmt-list-${jobId}`);
  if(list){
    list.innerHTML = job.comments.map(c=>`
      <div class="comment-row" data-cid="${c.id}">
        <div class="comment-avatar">${(c.author||'?')[0].toUpperCase()}</div>
        <div class="comment-body">
          <span class="comment-author">${c.author||'Unknown'}</span>
          <span class="comment-time">${_fmtCommentTime(c.ts)}</span>
          <div class="comment-text">${_escHtml(c.text)}</div>
        </div>
        ${c.author===S.owner?`<button onclick="deleteComment('${jobId}','${c.id}')" style="background:none;border:none;cursor:pointer;color:var(--txt3);font-size:12px;padding:2px 4px;align-self:flex-start;opacity:.5" title="Delete">✕</button>`:''}
      </div>`).join('');
  }
  // Update the counter badge in the cell
  const cell = document.querySelector(`tr[data-id="${jobId}"] td[data-col="comments"] .job-comments-count`);
  if(cell){
    cell.textContent = `💬 ${job.comments.length}`;
    cell.classList.add('has-comments');
  }
  toast('Comment added','success');
}

async function deleteComment(jobId, commentId){
  const job = await dGet('jobs', jobId);
  if(!job) return;
  job.comments = (job.comments||[]).filter(c=>c.id!==commentId);
  await dPut('jobs', job);
  document.querySelector(`.comment-row[data-cid="${commentId}"]`)?.remove();
  const cell = document.querySelector(`tr[data-id="${jobId}"] td[data-col="comments"] .job-comments-count`);
  if(cell){
    cell.textContent = `💬 ${job.comments.length||'+'}`;
    cell.classList.toggle('has-comments', job.comments.length>0);
  }
}

function _fmtCommentTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = (now - d)/1000;
  if(diff < 60)  return 'just now';
  if(diff < 3600) return Math.floor(diff/60)+'m ago';
  if(diff < 86400) return Math.floor(diff/3600)+'h ago';
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function _escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

// ════════════════════════════════════════════════════════════════
//  AUTO-GROW TEXTAREA (v10)
// ════════════════════════════════════════════════════════════════
function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, 42) + 'px';
}
function autoGrowById(id){
  const el = document.getElementById(id);
  if(el && el.tagName === 'TEXTAREA') autoGrow(el);
}

// ════════════════════════════════════════════════════════════════
//  ONLINE USERS PANEL (ready for Firebase)
// ════════════════════════════════════════════════════════════════
function toggleOnlinePanel(){
  const p=document.getElementById('online-panel');
  if(!p) return;
  const open=p.style.display==='none'||p.style.display==='';
  p.style.display=open?'block':'none';
  if(open) updateOnlinePanel();
}
async function updateOnlinePanel(){
  // Write own last_seen to Supabase so others can see us
  if(_appUser?._sbId){
    try{ await _sb('users?id=eq.'+_appUser._sbId,{method:'PATCH',body:{last_seen:Math.floor(Date.now()/1000)},prefer:'return=minimal'}); }catch(e){ console.warn('[DeepFlow]', e); }
  }
  // Fetch all users seen in last 5 minutes
  const fiveMinAgo=Math.floor(Date.now()/1000)-300;
  try{
    const active=await _sb(`users?last_seen=gte.${fiveMinAgo}&active=eq.true&order=last_seen.desc&select=id,name,role,last_seen`);
    const countEl=document.getElementById('online-count');
    const listEl=document.getElementById('online-list');
    const n=active?.length||1;
    if(countEl) countEl.textContent=n+' online';
    if(listEl&&active?.length){
      const roleIcons={admin:'👑',manager:'🏢',staff:'📋',viewer:'👁',engineer:'👷'};
      listEl.innerHTML=active.map(u=>{
        const secsAgo=Math.floor(Date.now()/1000)-(u.last_seen||0);
        const when=secsAgo<30?'just now':secsAgo<60?secsAgo+'s ago':Math.floor(secsAgo/60)+'m ago';
        const isMe=u.id===_appUser?._sbId;
        const ico=roleIcons[u.role]||'👤';
        return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span style="width:7px;height:7px;border-radius:50%;background:${secsAgo<60?'#22c55e':'#f5a623'};flex-shrink:0"></span>
          <span style="font-size:13px">${ico}</span>
          <span style="font-weight:600;color:var(--txt1);flex:1;font-size:12px">${u.name}${isMe?' (you)':''}</span>
          <span style="font-size:10px;color:var(--txt3)">${when}</span>
        </div>`;
      }).join('');
    }
  }catch(e){
    const countEl=document.getElementById('online-count');
    if(countEl) countEl.textContent='1 online';
  }
}
// Heartbeat — write last_seen every 2 minutes
setInterval(()=>{
  if(_appUser?._sbId) _sb('users?id=eq.'+_appUser._sbId,{method:'PATCH',body:{last_seen:Math.floor(Date.now()/1000)},prefer:'return=minimal'}).catch(()=>{});
  // Also refresh the count quietly
  (async()=>{
    const fiveMinAgo=Math.floor(Date.now()/1000)-300;
    try{
      const active=await _sb(`users?last_seen=gte.${fiveMinAgo}&active=eq.true&select=id`);
      const n=active?.length||1;
      const countEl=document.getElementById('online-count');
      if(countEl) countEl.textContent=n+' online';
    }catch(e){ console.warn('[DeepFlow]', e); }
  })();
},30000);

// ════════════════════════════════════════════════════════════════
//  DATE in topbar (replaces clock)
// ════════════════════════════════════════════════════════════════
function tick(){
  // Keep date shown in dash greeting updated
  const n=new Date();
  const dateEl=document.getElementById('dg-date');
  if(dateEl) dateEl.textContent=n.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
setInterval(tick,60000); tick();

// ════════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════════
function showToast(m,t){toast(m,t)}
export function toast(msg,type='info',dur=3500){
  const c=document.getElementById('toasts');
  // Deduplicate: if identical message is already visible, just reset its timer
  const existing=[...c.querySelectorAll('.toast')].find(t=>t.dataset.msg===msg);
  if(existing){ existing.style.opacity='1'; return; }
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.dataset.msg=msg; // store for dedup check
  const ico={success:'✓',error:'✕',info:'ℹ',warn:'⚠',wa:'📱'}[type]||'ℹ';
  t.innerHTML=`<span style="font-size:15px">${ico}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>t.style.opacity='0',dur-300);
  setTimeout(()=>t.remove(),dur);
}

// ════════════════════════════════════════════════════════════════
//  CONFIRM  —  with Escape-key safety to prevent Promise deadlocks
// ════════════════════════════════════════════════════════════════
let _confirm2CancelFn = null; // tracks current cancel callback for Escape handling

export function confirm2(title,msg,onOk,onCancel,opts={}){
  document.getElementById('conf-title').textContent=title;
  const msgEl=document.getElementById('conf-msg');
  // Format message — preserve line breaks, strip HTML
  if(typeof msg==='string'){
    msgEl.innerHTML=msg.replace(/<strong>/g,'').replace(/<\/strong>/g,'').replace(/<br\/>/g,'\n').replace(/<br>/g,'\n').replace(/<[^>]+>/g,'').replace(/\n/g,'<br>');
  }else{
    msgEl.textContent=msg||'';
  }
  // Store cancel callback so Escape can resolve it
  _confirm2CancelFn = onCancel;

  // OK button (primary action)
  const okBtn=document.getElementById('conf-ok');
  okBtn.textContent=opts.okText||'Confirm';
  okBtn.className=opts.okClass||'btn btn-acc';
  okBtn.style.cssText=opts.okStyle||'';
  okBtn.onclick=()=>{closeModal('mo-confirm');_hideConfAlt();_confirm2CancelFn=null;if(opts.onBeforeAlt)opts.onBeforeAlt();if(onOk)onOk();};
  // Cancel button
  const cancelBtn=document.getElementById('conf-cancel');
  cancelBtn.onclick=()=>{closeModal('mo-confirm');_hideConfAlt();_confirm2CancelFn=null;if(opts.onBeforeAlt)opts.onBeforeAlt();if(onCancel)onCancel();};
  // Alt button (3rd option — e.g. "Open Invoice")
  const altBtn=document.getElementById('conf-alt');
  if(opts.altText){
    altBtn.textContent=opts.altText;
    altBtn.style.display='inline-flex';
    altBtn.style.opacity=opts.altFaded?'.5':'1';
    altBtn.className=opts.altFaded?'btn btn-ghost':'btn btn-wa';
    // CRITICAL: alt must resolve the Promise (via onCancel) so code doesn't hang
    altBtn.onclick=()=>{
      closeModal('mo-confirm');_hideConfAlt();_confirm2CancelFn=null;
      if(opts.onBeforeAlt)opts.onBeforeAlt(); // e.g. clear "Saving…" indicator
      if(onCancel)onCancel(); // resolve the hanging Promise first
      setTimeout(()=>{try{if(opts.altAction)opts.altAction();}catch(e){console.warn('[DeepFlow] altAction failed:',e);}},50);
    };
  }else{_hideConfAlt();}
  openModal('mo-confirm');
}
function _hideConfAlt(){const a=document.getElementById('conf-alt');if(a)a.style.display='none';}

// ════════════════════════════════════════════════════════════════
//  MODALS
// ════════════════════════════════════════════════════════════════
// Focus management for every modal in the app (shared openModal/closeModal
// utility — was previously a two-line classList toggle with no focus
// handling at all). Fixes: focus silently staying wherever it was when a
// modal opened (no screen-reader "dialog opened" cue), focus not returning
// anywhere sensible on close, and Shift+Tab from a modal's first field
// escaping into the page behind the overlay (the backdrop is purely visual
// — the real page content underneath was never removed from the tab order).
function _getFocusable(container){
  return [...container.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>el.offsetParent!==null);
}
let _modalTriggerEl=null;
export function openModal(id){
  const el=document.getElementById(id);
  if(!el) return;
  _modalTriggerEl=document.activeElement;
  if(!el.hasAttribute('role')) el.setAttribute('role','dialog');
  el.setAttribute('aria-modal','true');
  el.classList.add('open');
  const focusable=_getFocusable(el);
  // Wait a frame — some modals populate their own fields/visibility right
  // after opening, which can affect what's actually focusable/visible yet.
  requestAnimationFrame(()=>{ (focusable[0]||el).focus(); });
}
export function closeModal(id){
  const el=document.getElementById(id);
  if(el) el.classList.remove('open');
  if(_modalTriggerEl && document.contains(_modalTriggerEl) && typeof _modalTriggerEl.focus==='function'){
    _modalTriggerEl.focus();
  }
  _modalTriggerEl=null;
}
// Closes every currently-open modal — used by Escape and by the backdrop
// click handler below. (Previously called from the keyboard-shortcuts
// listener further down as closeAllModals() with no definition anywhere in
// the file — a real ReferenceError on every Escape press outside a text
// field. Defining it here, routed through closeModal() so focus-restore
// applies on Escape too, not just on an explicit close button.)
function closeAllModals(){
  document.querySelectorAll('.overlay.open').forEach(m=>closeModal(m.id));
}
document.querySelectorAll('.overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
// Focus trap: while a modal is open, Tab/Shift+Tab cycle within it instead
// of escaping into the page behind the (purely visual) backdrop.
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab') return;
  const openOverlays=[...document.querySelectorAll('.overlay.open')];
  if(!openOverlays.length) return;
  const topOverlay=openOverlays[openOverlays.length-1];
  const focusable=_getFocusable(topOverlay);
  if(!focusable.length) return;
  const first=focusable[0], last=focusable[focusable.length-1];
  if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    // Resolve any pending confirm2 Promise BEFORE closing modals — prevents deadlocks
    if(_confirm2CancelFn){ try{_confirm2CancelFn();}catch(ex){} _confirm2CancelFn=null; }
    closeAllModals();
    closeAddrDrop();
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openCmd()}
});

// ════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  // Don't trigger when typing in inputs
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  if(e.key==='Escape'){closeAllModals();return;}
  if(e.ctrlKey||e.metaKey){
    if(e.key==='k'){e.preventDefault();openCmd();return;}
    if(e.key==='d'){e.preventDefault();nav('dash');return;}
    if(e.key==='j'){e.preventDefault();nav('jobs');return;}
    if(e.key==='i'){e.preventDefault();nav('inv');return;}
    if(e.key==='f'){e.preventDefault();document.getElementById('j-search')?.focus();return;}
    return;
  }
  if(curPg==='jobs'){
    if(e.key==='n'){e.preventDefault();openJobModal();return;}
    if(e.key==='t'){e.preventDefault();setJRange('default');jPickDate(TODAY());renderJobs();return;}
    if(e.key==='ArrowLeft'){e.preventDefault();shiftDay(-1);return;}
    if(e.key==='ArrowRight'){e.preventDefault();shiftDay(1);return;}
  }
});

// ════════════════════════════════════════════════════════════════
//  JOBS
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  ADMIN LOGIN SYSTEM
// ════════════════════════════════════════════════════════════════
let _appUser = null;
export function getAppUser(){ return _appUser; }
// ── All globals at top to prevent TDZ "before initialization" errors ──
let _tipEl=null,_tipTimeout=null;
let _jobCache=null,_jobCacheTs=0;
let _invType='all',_invNavMode='dashboard',_invSaveTimer={};
let _reqType='all',_selectedReqId=null;
let _hiddenCols=[];
let _pendingSaves=0;
let _lastOpenedJob=null;

let editJid=null,selJobs=new Set(),allProps=[],_jobSortCol='created';
// Captured when the edit-job modal is opened — lets saveJob() detect if
// someone else saved a change to this job while the form was open.
let _editJobBaselineModified=null;
// Default is a bounded rolling window (past 7 days → next 30 days), not
// unbounded 'all'. At real volume (30-50 new jobs/day) an unbounded default
// render keeps growing forever as history accumulates — this financial
// year it might be a few hundred rows, next year several thousand, the
// year after that tens of thousands, all rendered as real DOM nodes on
// every page load and every keystroke. A rolling window stays a bounded,
// roughly-constant size regardless of how many years of history pile up
// behind it. 'All'/'7d'/'30d'/'Past' remain one click away for anyone who
// deliberately wants the full history — this only changes what loads by
// default before you ask for something else.
let _jRange='default',_jcalMonth=null,_jcalJobDates={};
// How many extra days before the rolling window's normal 7-day-back edge
// the user has asked to see, via the "Load earlier jobs" banner at the top
// of the list — scrolling up alone doesn't fetch anything further back,
// this is what makes "further back" an actual, deliberate, working action
// instead of a silent dead end at the top of the list.
let _jPastExtensionDays=0;
let _calPaneVisible=true,_jUnbookedOnly=false,_jUnconfirmedOnly=false;
let _pendCertQueue=[],_pendCertJob=null,_jobNumLock=false,_jobCertTypes=[];
export function setPendCertJob(v){ _pendCertJob=v; }
let _dupCheckTimer=null;
let editInvId=null,invItems=[],curInvId=null;
let _matchTimers={},_autoSaveTimers={};
let editAgencyId=null,editAgentId=null;

let _resizing=null;
let _descTipEl=null,_descTipTimer=null;
let _openCommentJobId=null;
let _origUpdateBulkBar=null;

// ── UI helpers for login screen ──
function togglePwVis(inputId, btn){
  const el=document.getElementById(inputId);
  if(!el)return;
  if(el.type==='password'){el.type='text';btn.textContent='🙈';}
  else{el.type='password';btn.textContent='👁';}
}
function _loginMsg(msg, type='error'){
  const el=document.getElementById('login-err');
  if(!el)return;
  el.style.display='block';
  el.style.background=type==='success'?'rgba(34,197,94,.1)':type==='info'?'rgba(79,143,255,.1)':'rgba(239,68,68,.1)';
  el.style.border=type==='success'?'1px solid rgba(34,197,94,.3)':type==='info'?'1px solid rgba(79,143,255,.3)':'1px solid rgba(239,68,68,.2)';
  el.style.color=type==='success'?'#22c55e':type==='info'?'#4f8fff':'#ef4444';
  el.textContent=msg;
}

// ── Login screen animation: cyan network + gold 4-point star twinkle ────────
function initLoginCanvas(){
  const canvas=document.getElementById('login-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  let W,H,nodes,packets,stars,raf=null;

  function build(){
    const bg=ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#0d1f3c');bg.addColorStop(.5,'#1e3a5f');bg.addColorStop(1,'#0a1628');
    canvas._bg=bg;

    nodes=Array.from({length:60},()=>({
      x:Math.random()*W,y:Math.random()*H,
      vx:(Math.random()-.5)*.05,vy:(Math.random()-.5)*.05,
      r:Math.random()<.12?3.5:1.6,pulse:Math.random()*Math.PI*2
    }));

    packets=Array.from({length:18},()=>({
      fi:Math.floor(Math.random()*nodes.length),
      ti:Math.floor(Math.random()*nodes.length),
      t:Math.random(),speed:.0015+Math.random()*.003
    }));

    stars=Array.from({length:100},()=>({
      x:Math.random()*W,y:Math.random()*H,
      sz:1.2+Math.random()*3.8,
      phase:Math.random()*Math.PI*2,
      speed:.002+Math.random()*.006
    }));
  }

  function drawStar(x,y,r,a){
    ctx.save();
    // Glow halo
    const g=ctx.createRadialGradient(x,y,0,x,y,r*5);
    g.addColorStop(0,`rgba(255,215,60,${a*.7})`);
    g.addColorStop(1,'rgba(212,175,55,0)');
    ctx.beginPath();ctx.arc(x,y,r*5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
    // 4-point star shape
    ctx.fillStyle=`rgba(255,235,100,${Math.min(1,a*1.3)})`;
    ctx.beginPath();
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4-Math.PI/8;
      const rad=i%2===0?r:r*.28;
      i===0?ctx.moveTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad)
           :ctx.lineTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad);
    }
    ctx.closePath();ctx.fill();
    // Bright centre dot
    ctx.beginPath();ctx.arc(x,y,r*.3,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,248,200,${Math.min(1,a*1.4)})`;ctx.fill();
    ctx.restore();
  }

  function draw(){
    // If overlay is hidden, stop animating
    if(document.getElementById('pin-overlay').style.display==='none'){raf=null;return;}
    ctx.fillStyle=canvas._bg;ctx.fillRect(0,0,W,H);

    // Edges
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
      const n=nodes[i],m=nodes[j],d=Math.hypot(n.x-m.x,n.y-m.y);
      if(d<W*.2){ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(m.x,m.y);ctx.strokeStyle='rgba(125,211,252,.25)';ctx.lineWidth=1;ctx.stroke();}
    }

    // Nodes
    nodes.forEach(n=>{
      n.pulse+=.011;n.x+=n.vx;n.y+=n.vy;
      if(n.x<0||n.x>W)n.vx*=-1;if(n.y<0||n.y>H)n.vy*=-1;
      const a=.6+Math.sin(n.pulse)*.3;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a})`;ctx.fill();
      if(n.r>2){ctx.beginPath();ctx.arc(n.x,n.y,n.r*3,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a*.2})`;ctx.fill();}
    });

    // Cyan packets
    packets.forEach(p=>{
      p.t+=p.speed;if(p.t>=1){p.t=0;p.fi=p.ti;p.ti=Math.floor(Math.random()*nodes.length);}
      const n=nodes[p.fi],m=nodes[p.ti];
      if(!n||!m)return;
      const x=n.x+(m.x-n.x)*p.t,y=n.y+(m.y-n.y)*p.t;
      const g=ctx.createRadialGradient(x,y,0,x,y,10);
      g.addColorStop(0,'rgba(180,240,255,.9)');g.addColorStop(1,'rgba(125,211,252,0)');
      ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle='rgba(220,245,255,.95)';ctx.fill();
    });

    // Gold 4-point star twinkle
    stars.forEach(s=>{
      s.phase+=s.speed;
      const a=Math.max(0,.5+Math.sin(s.phase)*.5);
      if(a>.02) drawStar(s.x,s.y,s.sz,Math.min(1,a*1.4));
    });

    raf=requestAnimationFrame(draw);
  }

  function start(){
    if(raf) return;
    W=canvas.width=Math.max(canvas.parentElement?.offsetWidth||0,window.innerWidth*.7,800);
    H=canvas.height=Math.max(canvas.parentElement?.offsetHeight||0,window.innerHeight,600);
    build();draw();
  }
  function stop(){if(raf){cancelAnimationFrame(raf);raf=null;}}

  const overlay=document.getElementById('pin-overlay');
  new MutationObserver(()=>overlay.style.display!=='none'?start():stop())
    .observe(overlay,{attributes:true,attributeFilter:['style']});
  window.addEventListener('resize',()=>{if(raf){stop();start();}});
  if(overlay.style.display==='flex') start();
  window._loginCanvasStart=start;
  window._loginCanvasStop=stop;
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(initLoginCanvas,400));

  function resize(){
    W=canvas.width=window.innerWidth;
    H=canvas.height=window.innerHeight;
    buildNetwork();
  }

  function buildNetwork(){
    nodes=[];
    const cols=12,rows=9;
    const gx=W/cols,gy=H/rows;
    for(let r=0;r<=rows;r++){
      for(let c=0;c<=cols;c++){
        nodes.push({
          x:c*gx+(Math.random()-.5)*gx*.5,
          y:r*gy+(Math.random()-.5)*gy*.5,
          r:Math.random()<.15?2.5:1,
          pulse:Math.random()*Math.PI*2,
          pulseSpeed:.008+Math.random()*.015
        });
      }
    }
    nodes.forEach((n,i)=>{
      n.edges=[];
      nodes.forEach((m,j)=>{
        if(i===j)return;
        const d=Math.hypot(n.x-m.x,n.y-m.y);
        if(d<W*.15&&n.edges.length<3)n.edges.push(j);
      });
    });
    packets=[];
    for(let i=0;i<28;i++)spawnPacket();
  }

  function spawnPacket(){
    const fi=Math.floor(Math.random()*nodes.length);
    const n=nodes[fi];
    if(!n||!n.edges.length)return;
    const ti=n.edges[Math.floor(Math.random()*n.edges.length)];
    const isRight = n.x > W * .72; // right panel area
    packets.push({fi,ti,t:Math.random(),speed:.002+Math.random()*.004,sz:1.2+Math.random()*1.8,bright:Math.random()>.4,gold:isRight&&Math.random()>.3});
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    // Edges
    nodes.forEach((n,i)=>{
      n.edges.forEach(j=>{
        const m=nodes[j];
        ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(m.x,m.y);
        ctx.strokeStyle='rgba(125,211,252,.1)';ctx.lineWidth=.8;ctx.stroke();
      });
    });
    // Nodes
    nodes.forEach(n=>{
      n.pulse+=n.pulseSpeed;
      const a=.3+Math.sin(n.pulse)*.2;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(125,211,252,${a})`;ctx.fill();
      if(n.r>2){
        ctx.beginPath();ctx.arc(n.x,n.y,n.r*3,0,Math.PI*2);
        ctx.fillStyle=`rgba(125,211,252,${a*.15})`;ctx.fill();
      }
    });
    // Packets
    packets.forEach((p,idx)=>{
      p.t+=p.speed;
      if(p.t>=1){
        const prev=p.fi;p.fi=p.ti;p.t=0;
        const n=nodes[p.fi];
        const next=(n.edges||[]).filter(e=>e!==prev);
        p.ti=next.length?next[Math.floor(Math.random()*next.length)]:(n.edges||[])[0];
        if(p.ti===undefined){packets.splice(idx,1);spawnPacket();return;}
      }
      const n=nodes[p.fi],m=nodes[p.ti];
      if(!n||!m)return;
      const x=n.x+(m.x-n.x)*p.t,y=n.y+(m.y-n.y)*p.t;
      const c1=p.bright?'rgba(180,240,255,.95)':'rgba(125,211,252,.8)';
      const g=ctx.createRadialGradient(x,y,0,x,y,p.sz*5);
      g.addColorStop(0,c1);g.addColorStop(1,'rgba(125,211,252,0)');
      ctx.beginPath();ctx.arc(x,y,p.sz*5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.beginPath();ctx.arc(x,y,p.sz,0,Math.PI*2);
      ctx.fillStyle=p.bright?'rgba(220,245,255,.98)':'rgba(125,211,252,.9)';ctx.fill();
    });
    while(packets.length<28)spawnPacket();
    raf=requestAnimationFrame(draw);
  }

  function start(){
    if(raf) return;
    const parent = canvas.parentElement;
    W = canvas.width = parent ? parent.offsetWidth || window.innerWidth * 0.72 : window.innerWidth * 0.72;
    H = canvas.height = parent ? parent.offsetHeight || window.innerHeight : window.innerHeight;
    buildNetwork();
    draw();
  }
  function stop(){
    if(raf){cancelAnimationFrame(raf);raf=null;}
  }


document.addEventListener('DOMContentLoaded',()=>setTimeout(initLoginCanvas,400));



async function doLogin(){
  const email=(document.getElementById('login-email')?.value||'').trim().toLowerCase();
  const password=(document.getElementById('login-password')?.value||'');
  const errEl=document.getElementById('login-err');
  if(errEl)errEl.style.display='none';

  if(!email||!password){_loginMsg('Enter your email and password');return;}
  if(!_supaAuth){_loginMsg('Auth client not ready — check internet connection');return;}

  const btnEl=document.getElementById('login-btn');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Signing in…';}

  try{
    // Step 1: Supabase Auth — server-side verification
    const {data:authData, error:authErr} = await _supaAuth.auth.signInWithPassword({email, password});
    if(authErr){
      if(authErr.message?.includes('Invalid login')||authErr.message?.includes('invalid_credentials')){
        _loginMsg('❌ Wrong email or password');
      } else if(authErr.message?.includes('Email not confirmed')){
        _loginMsg('⚠️ Check your email and click the confirmation link first');
      } else {
        _loginMsg('❌ '+authErr.message);
      }
      return;
    }

    const authUser = authData.user;
    if(!authUser){_loginMsg('❌ Login failed — no user returned');return;}

    // EMERGENCY ADMINS defined globally above
    const isEmergencyAdmin = EMERGENCY_ADMINS.includes(email);

    // Step 2: Load profile from our users table using auth UID
    let profile = null;
    try{
      const rows = await _sb(`users?auth_id=eq.${authUser.id}&select=*`);
      profile = rows?.[0] || null;
    }catch(e){ console.warn('[DeepFlow]', e); }

    if(!profile){
      try{
        const rows = await _sb(`users?email=eq.${encodeURIComponent(email)}&select=*`);
        profile = rows?.[0] || null;
        if(profile){
          _sb(`users?id=eq.${profile.id}`,{method:'PATCH',body:{auth_id:authUser.id},prefer:'return=minimal'}).catch(()=>{});
        }
      }catch(e){ console.warn('[DeepFlow]', e); }
    }

    // EMERGENCY FALLBACK — if no profile found but email is a protected admin
    // create a temporary in-memory admin profile and log them in
    let emergencyMode = false;
    if(!profile && isEmergencyAdmin){
      emergencyMode = true;
      profile = {
        id: authUser.id,
        auth_id: authUser.id,
        name: 'Mandeep',
        email: email,
        role: 'admin',
        active: true,
        can_edit: true, can_delete: true, can_invoice: true, can_finance: true,
        see_landlord: true, see_landlord_phone: true, see_agent: true,
        see_contact: true, see_price: true
      };
      // Try to restore the profile row in Supabase automatically
      _sb('users',{method:'POST',body:{
        auth_id: authUser.id,
        name: 'Mandeep',
        email: email,
        role: 'admin',
        active: true,
        can_edit: true, can_delete: true, can_invoice: true, can_finance: true,
        see_landlord: true, see_landlord_phone: true, see_agent: true,
        see_contact: true, see_price: true
      },prefer:'return=minimal'}).catch(()=>{});
    }

    // If profile found but role was changed — force admin for protected emails
    if(profile && isEmergencyAdmin && profile.role !== 'admin'){
      emergencyMode = true;
      profile.role = 'admin';
      // Restore correct role in Supabase
      _sb(`users?email=eq.${encodeURIComponent(email)}`,{method:'PATCH',body:{role:'admin',active:true},prefer:'return=minimal'}).catch(()=>{});
    }

    if(!profile){
      _loginMsg('⚠️ Your account exists but has no profile. Ask your Admin to set up your profile in Settings → Users.');
      await _supaAuth.auth.signOut();
      return;
    }

    // Step 3: Block engineers — they must use the engineer portal, not this app
    if(profile.role === 'engineer'){
      await _supaAuth.auth.signOut();
      _loginMsg('⚠️ Engineer accounts use the Engineer Portal, not this app.\n\nAsk your office manager for the Engineer Portal link.');
      return;
    }

    // Build _appUser from profile
    const roleMap={admin:'Admin',manager:'Manager',finance:'Finance',staff:'Staff',viewer:'Viewer',engineer:'Engineer'};
    const role=roleMap[profile.role]||'Staff';
    const isAdmin=role==='Admin';
    const isMgr=role==='Manager';
    _appUser={
      name:profile.name||authUser.email,
      email:authUser.email,
      role,
      _sbId:profile.id,
      _authId:authUser.id,
      canEdit:   profile.can_edit   !== false,
      canDelete: isAdmin || (profile.can_delete === true),
      canInvoice:profile.can_invoice!== false,
      canFinance:isAdmin||isMgr||(profile.can_finance===true),
      seeLandlord:     profile.see_landlord      !== false,
      seeLandlordPhone:profile.see_landlord_phone!== false,
      seeAgent:        profile.see_agent         !== false,
      seeContact:      profile.see_contact       !== false,
      seePrice:        profile.see_price         !== false,
    };

    // Step 4: Update last_seen
    _sb(`users?id=eq.${profile.id}`,{method:'PATCH',body:{last_seen:Math.floor(Date.now()/1000)},prefer:'return=minimal'}).catch(()=>{});

    // Step 5: Close overlay and enter app
    const overlay=document.getElementById('pin-overlay');
    if(overlay)overlay.style.display='none';
    // Stop login canvas animation to save CPU
    if(window._loginCanvasStop)window._loginCanvasStop();
    applyUserPermissions();
    _refreshAdminNavVisibility(); // Show/hide admin-only nav items
    if(emergencyMode){
      setTimeout(()=>toast('⚠️ Emergency admin access used — profile auto-restored. Check Settings → Team.','warn',8000),1000);
    } else {
      toast(`👋 Welcome, ${_appUser.name}!`,'success');
    }
    // NOW reload settings from Supabase — user is authenticated, RLS passes
    // This makes every computer always get the latest settings on login
    _loadSettingsFromDb().then(loaded=>{
      if(loaded){
        renderSettings();
        applyTheme(localStorage.getItem('df_theme')||S.theme||'light');
        if(S.accent) setAccent(S.accent);
        if(S.fontSize) setFontSize(S.fontSize);
        updateLogo();
      }
    }).catch(()=>{});
    // Start real-time sync for multi-user collaboration
    startRealtimeSync();

  }catch(e){
    _loginMsg('⚠️ Connection error — check internet');
    console.error('Login error:',e);
  }finally{
    if(btnEl){btnEl.disabled=false;btnEl.textContent='Sign In →';}
  }
}

async function doResetPassword(){
  const email=(document.getElementById('login-email')?.value||'').trim().toLowerCase();
  if(!email){_loginMsg('Enter your email address first, then click Forgot password','info');return;}
  if(!_supaAuth){_loginMsg('Not connected');return;}
  const btnEl=document.getElementById('login-btn');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Sending…';}
  try{
    const {error}=await _supaAuth.auth.resetPasswordForEmail(email,{
      redirectTo: window.location.href.split('?')[0]
    });
    if(error){_loginMsg('❌ '+error.message);return;}
    _loginMsg('✅ Password reset email sent — check your inbox','success');
  }catch(e){_loginMsg('❌ Failed to send reset email');}
  finally{if(btnEl){btnEl.disabled=false;btnEl.textContent='Sign In →';}}
}

function applyUserPermissions(){
  if(!_appUser) return;
  const appEl=document.getElementById('app');
  if(appEl) appEl.style.display='';
  const u=_appUser;
  const role=u.role; // Admin | Manager | Finance | Staff | Engineer

  const isAdmin   = role==='Admin';
  const isManager = role==='Manager';
  const isFinance = role==='Finance';
  const isStaff   = role==='Staff';

  // ── ENGINEER: immediate block ──────────────────────────────────────────────
  if(role==='Engineer'){
    doLogout();
    setTimeout(()=>{
      _loginMsg('⚠️ Engineer accounts use the Engineer Portal — not this app.\n\nAsk your manager for the Engineer Portal link.');
    },200);
    return;
  }

  // ── Helper: show/hide nav items ───────────────────────────────────────────
  const showNav=(pgs,show)=>pgs.forEach(pg=>
    document.querySelectorAll(`.ni[data-pg="${pg}"]`).forEach(el=>el.style.display=show?'':'none')
  );

  // Hide ALL nav items first, then show only what this role can see
  const ALL_PAGES=['dash','jobs','inv','stmt','exp','ts','rep','req','dir','props','certs','client','set','map','engrep','audit','team'];
  showNav(ALL_PAGES, false);

  // ── Per-role nav visibility ───────────────────────────────────────────────
  if(isAdmin){
    showNav(ALL_PAGES, true);
  } else if(isManager){
    showNav(['dash','jobs','inv','stmt','rep','req','dir','props','certs','client','set','map'], true);
  } else if(isFinance){
    showNav(['dash','inv','stmt','rep','jobs','dir','props','set'], true);
  } else if(isStaff){
    showNav(['dash','jobs','inv','stmt','req','dir','props','certs','client'], true);
  } else if(role==='Viewer'){
    // Read-only role: getUserPerm() already denies every edit/delete/finance/
    // invoice permission for Viewer — this just makes sure they land on a nav
    // with something in it, instead of every page hidden and a blank app.
    showNav(['dash','jobs','inv','stmt','rep','dir','props','certs','client'], true);
  }

  // ── Settings tab visibility per role ─────────────────────────────────────
  // Admin: all tabs
  // Manager: Appearance, WhatsApp, Trades, Job Controls, Invoicing only
  // Finance: Invoicing only
  // Staff: no settings at all
  const setTabs={
    company:      isAdmin,
    appearance:   isAdmin||isManager,
    team:         isAdmin||isManager,
    trades:       isAdmin||isManager,
    invoicing:    isAdmin||isManager||isFinance,
    whatsapp:     isAdmin||isManager,
    jobs:         isAdmin||isManager,
    notifications:isAdmin,
    data:         isAdmin,
    guide:        isAdmin,
  };
  Object.entries(setTabs).forEach(([tab,show])=>{
    document.querySelectorAll(`.set-tab[data-tab="${tab}"]`).forEach(el=>el.style.display=show?'':'none');
  });

  // ── Manager: hide Admin accounts in Team tab ──────────────────────────────
  // Done in loadTeam() — managers only see non-admin users

  // Finance: full edit access to Jobs (same as Staff) — the only restriction
  // is canDelete, which defaults to false for every non-Admin/Manager user
  // and is enforced directly in deleteJobById/deleteCurrentJob/bulkDeleteJobs.

  // ── Staff: no Settings nav item at all ───────────────────────────────────
  if(isStaff){
    document.querySelectorAll('.ni[data-pg="set"]').forEach(el=>el.style.display='none');
  }

  // ── Top-right user pill ───────────────────────────────────────────────────
  const roleIcon ={Admin:'👑',Manager:'🏢',Finance:'💰',Staff:'📋',Engineer:'🔧'}[role]||'👤';
  const roleColor={Admin:'var(--acc)',Manager:'#4f8fff',Finance:'#22c55e',Staff:'#f59e0b',Engineer:'#a855f7'}[role]||'var(--txt3)';
  const avatar=document.getElementById('user-pill-avatar');
  if(avatar){avatar.textContent=roleIcon;avatar.style.background=roleColor+'22';avatar.style.border='2px solid '+roleColor;avatar.style.color=roleColor;}
  const pillName=document.getElementById('user-pill-name');
  const pillRole=document.getElementById('user-pill-role');
  const umName=document.getElementById('um-name');
  const umRole=document.getElementById('um-role');
  if(pillName) pillName.textContent=u.name;
  if(pillRole){pillRole.textContent=role;pillRole.style.color=roleColor;}
  if(umName) umName.textContent=u.name;
  if(umRole){umRole.textContent=role;umRole.style.color=roleColor;}

  // ── Storage dashboard: admin only ─────────────────────────────────────────
  const storagePanelWrap=document.getElementById('storage-dashboard-wrap');
  if(storagePanelWrap) storagePanelWrap.style.display=isAdmin?'':'none';

  // ── Hook Settings sub-tabs on click ───────────────────────────────────────
  if(isAdmin){
    const dataTab=document.querySelector('.set-tab[data-tab="data"]');
    if(dataTab&&!dataTab._storageHooked){dataTab._storageHooked=true;dataTab.addEventListener('click',()=>{setTimeout(loadStorageDashboard,300);});}
  }
  if(isAdmin||isManager){
    const teamTab=document.querySelector('.set-tab[data-tab="team"]');
    if(teamTab&&!teamTab._teamHooked){teamTab._teamHooked=true;teamTab.addEventListener('click',()=>{setTimeout(loadTeam,200);});}
  }

  // ── Write last_seen ───────────────────────────────────────────────────────
  if(u._sbId){
    _sb('users?id=eq.'+u._sbId,{method:'PATCH',body:{last_seen:Math.floor(Date.now()/1000)},prefer:'return=minimal'}).catch(()=>{});
  }
  setTimeout(updateOnlinePanel,800);
}


function doLogout(){
  _appUser = null;
  localStorage.removeItem('df_office_sess');
  // Sign out from Supabase Auth (invalidates the server-side session)
  if(_supaAuth)_supaAuth.auth.signOut().catch(()=>{});
  // Clear login fields
  const em=document.getElementById('login-email');
  const pw=document.getElementById('login-password');
  const e=document.getElementById('login-err');
  if(em) em.value='';
  if(pw) pw.value='';
  if(e) e.style.display='none';
  // Show unified login overlay
  const overlay=document.getElementById('pin-overlay');
  if(overlay) overlay.style.display='flex';
  setTimeout(()=>{ if(window._loginCanvasStart) window._loginCanvasStart(); const f=document.getElementById('login-email'); if(f) f.focus(); }, 180);
}
// Keep logoutUser as alias for any remaining references
function logoutUser(){ doLogout(); }

async function checkSecurityStatus(){
  const el=document.getElementById('sec-status-result');
  if(el) el.textContent='🔍 Checking…';
  const issues=[];
  const ok=[];
  // Check PIN lock
  if(S.pinLock) ok.push('✅ PIN lock is ON — login required to access the app');
  else issues.push('🚨 PIN lock is OFF — anyone with the URL can access your data without a password');
  // Check users exist
  if((S.users||[]).length>0) ok.push(`✅ ${S.users.length} user(s) configured`);
  else issues.push('⚠️ No users configured — first-time setup mode is active');
  // Check admin count
  const admins=(S.users||[]).filter(u=>u.role==='Admin'||u.role==='Manager');
  if(admins.length>0) ok.push(`✅ ${admins.length} admin user(s) set`);
  // Check Supabase connection
  try{
    await _sb('jobs?limit=1');
    ok.push('✅ Supabase connection working');
  }catch(e){ issues.push('🚨 Supabase connection failed — data may not be loading'); }
  // Check engineers
  if((S.engineers||[]).length>0) ok.push(`✅ ${S.engineers.length} engineer(s) loaded from Supabase`);
  else issues.push('⚠️ No engineers loaded — add engineers in Settings → Users and click Sync');
  const out=[...issues,...ok].join('<br>');
  if(el) el.innerHTML=out;
  if(issues.length){
    toast(`⚠️ ${issues.length} security issue(s) found — check Settings → Data`,'error',6000);
  } else {
    toast('✅ Security status looks good','success');
  }
}

function checkPinLock(){
  if(!S.pinLock)return;
  const overlay=document.getElementById('pin-overlay');
  if(!overlay)return;
  const emailInput=document.getElementById('login-email');
  const pwInput=document.getElementById('login-password');
  if(emailInput) emailInput.value='';
  if(pwInput) pwInput.value='';
  const errEl=document.getElementById('login-err');
  if(errEl){
    const users=S.users||[];
    if(users.length===0){
      errEl.textContent='ℹ️ No users set up yet — contact your system administrator.';
      errEl.style.display='block';
      errEl.style.color='var(--acc)';
      errEl.style.background='rgba(245,166,35,.1)';
    } else {
      errEl.style.display='none';
    }
  }
  overlay.style.display='flex';
}

// Get current user's permissions — always evaluated against the real logged-in
// user's role/flags. This is intentionally NOT gated on S.pinLock: whether a
// login prompt is shown and what a logged-in user is allowed to do are two
// separate questions, and conflating them previously meant turning pinLock off
// silently granted every permission to everyone, regardless of role.
export function getUserPerm(perm){
  if(!_appUser) return false;
  const u=_appUser;
  if(u.role==='Admin') return true;              // Admin: always yes
  if(u.role==='Viewer') return false;            // Viewer: always no for write perms
  if(u.role==='Manager'){
    if(perm==='canManageUsers') return false;    // Managers cannot manage users
    return true;                                 // Managers: yes for everything else
  }
  // Staff: per-permission
  if(perm==='seeLandlord')      return u.seeLandlord!==false;
  if(perm==='seeLandlordPhone') return u.seeLandlordPhone!==false;
  if(perm==='seeAgent')         return u.seeAgent!==false;
  if(perm==='seeContact')       return u.seeContact!==false;
  if(perm==='seePrice')         return u.seePrice!==false;
  if(perm==='canEdit')          return u.canEdit===true;
  if(perm==='canDelete')        return u.canDelete===true;
  if(perm==='canInvoice')       return u.canInvoice===true;
  if(perm==='canFinance')       return u.canFinance===true;
  if(perm==='canManageUsers')   return false;
  return true;
}

// Show/hide admin-only sidebar nav items based on user role
function _refreshAdminNavVisibility(){
  const isAdminOrManager = !_appUser || _appUser.role==='Admin' || _appUser.role==='Manager';
  document.querySelectorAll('.admin-only-nav').forEach(el=>{
    el.style.display = isAdminOrManager ? '' : 'none';
  });
}

let jDate=TODAY();
export function setJDate(v){ jDate=v; }





let _jobSortDir=1; // 1=asc -1=desc

function sortJobs(col){
  if(_jobSortCol===col) _jobSortDir*=-1; else{_jobSortCol=col;_jobSortDir=1;}
  // update sort icons
  document.querySelectorAll('.sort-ico').forEach(el=>{
    if(el.dataset.col===col) el.textContent=_jobSortDir===1?' ▲':' ▼';
    else el.textContent='';
  });
  renderJobs();
}

function jdo(d){const dt=new Date(jDate);dt.setDate(dt.getDate()+d);jDate=dt.toISOString().slice(0,10);renderJobs()}
function jToday(){jDate=TODAY();renderJobs()}
function jPickDate(v){jDate=v;renderJobs()}

function fmtD(s){
  try{const d=new Date(s+'T00:00:00');return d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}catch{return s}
}
export function fmtDshort(s){
  try{const d=new Date(s+'T00:00:00');return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}catch{return s}
}

const sEmoji={Pending:'🔴','In Progress':'🟡',Completed:'🟢',Invoiced:'🔵','Cannot Access':'🚫',Cancelled:'⚪'};
export const sBadge=(s)=>{const cls={Pending:'b-pending','In Progress':'b-progress',Completed:'b-completed',Invoiced:'b-invoiced','Cannot Access':'b-noaccess',Cancelled:'b-cancelled'}[s]||'';return`<span class="badge ${cls}">${sEmoji[s]||'⚪'} ${s}</span>`};
const tradeColor=(t)=>{const f=(S.trades||[]).find(x=>x.name===t);return f?f.color:'#4a5570'};

// ════════════════════════════════════════════════════════════════
//  SCROLL LIST JOBS VIEW
// ════════════════════════════════════════════════════════════════




// ── In-memory job cache — avoids a Supabase round-trip on every filter/search/render ──

// Was 30 seconds — meaning every 30s of active use, ANY render (including
// typing in search) would trigger a full-table re-fetch. That's harmless
// at a handful of rows but becomes a recurring multi-second stall once job
// history spans years. Now that Realtime is properly enabled (jobs was
// added to the supabase_realtime publication), the cache is kept correct
// in real time by INSERT/UPDATE/DELETE events rather than needing to be
// re-fetched wholesale this often — this TTL is now a safety-net refresh,
// not the primary freshness mechanism, so it can safely be much longer.
const JOB_CACHE_TTL = 300000; // 5 minutes
// _jobRowData: stores full job objects keyed by id, populated every renderJobs().
// Used by drag-drop so it NEVER depends on _jobCache (which poll can nullify mid-drag).
const _jobRowData = {};


// ══════════════════════════════════════════════════════════════
//  JOBS — NEW FEATURES
// ══════════════════════════════════════════════════════════════

// ── Day navigation: shift jDate by N days ──
function shiftDay(n){
  const d = new Date((jDate||TODAY())+'T00:00:00');
  d.setDate(d.getDate()+n);
  jDate = d.toISOString().slice(0,10);
  // Update range to show just that day if we're navigating
  _jRange = '7';
  ['all','7','30','past'].forEach(k=>{
    const b=document.getElementById('jrange-btn-'+k);
    if(b) b.classList.toggle('active', k==='7');
  });
  renderJobs();
  // Scroll to the date group
  setTimeout(()=>{
    const el=document.querySelector(`[data-date-group="${jDate}"]`);
    if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
  },120);
}

// ── Keyboard arrow navigation ──
document.addEventListener('keydown', e=>{
  if(document.activeElement?.tagName==='INPUT'||document.activeElement?.tagName==='TEXTAREA'||document.activeElement?.tagName==='SELECT') return;
  if(document.querySelector('.overlay.open')) return;
  const pg = document.querySelector('.page.active');
  if(!pg || pg.id !== 'pg-jobs') return;
  if(e.key==='ArrowLeft'){ e.preventDefault(); shiftDay(-1); }
  if(e.key==='ArrowRight'){ e.preventDefault(); shiftDay(1); }
});

// ── Bulk assign engineer ──
async function bulkAssignEngineer(){
  const ids=[...selJobs];
  if(!ids.length){toast('Select jobs first','error');return;}
  const engs=(S.engineers||[]).map(e=>e.name);
  if(!engs.length){toast('No engineers configured','error');return;}
  const name=await _pickFromList('Assign to engineer:',engs);
  if(!name) return;
  let done=0,failed=0;
  for(const id of ids){
    try{
      await _sb(`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{engineer:name,modified:Date.now()},prefer:'return=minimal'});
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  }
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
  for(const id of ids){
    try{
      await _sb(`jobs?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:{date:newDate,modified:Date.now()},prefer:'return=minimal'});
      done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  }
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
  for(const id of ids){
    try{
      const j=await dGet('jobs',id);
      if(!j){ failed++; continue; }
      const copy={...j,id:uid(),date:newDate,status:STATUS.PENDING,created:Date.now(),modified:Date.now(),jobNum:await nextJobNum()};
      delete copy.invNumber; delete copy.linkedInvId;
      await dPut('jobs',copy); done++;
    }catch(e){ failed++; console.warn('[DeepFlow]', e); }
  }
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
  const status=await _pickFromList('Set status to:',['Pending','In Progress','Completed','Invoiced','Cannot Access','Cancelled']);
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
  for(const id of ids){
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
  }
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
  const d = new Date((j.date||TODAY())+'T00:00:00');
  d.setDate(d.getDate()+1);
  const nextDate = d.toISOString().slice(0,10);
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
let _priFilter='';
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
  _priFilter=priority||'';
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

async function _getJobs(forceRefresh=false){
  const now = Date.now();
  if(!forceRefresh && _jobCache && (now - _jobCacheTs) < JOB_CACHE_TTL){
    return _jobCache;
  }
  const rows = await dAll('jobs');
  _jobCache = rows;
  _jobCacheTs = now;
  return rows;
}

function _invalidateJobCache(){
  _jobCache = null;
  _jobCacheTs = 0;
}


function toggleCalPane(){
  _calPaneVisible = !_calPaneVisible;
  const pane = document.getElementById('jobs-cal-pane');
  const btn  = document.getElementById('btn-cal-toggle');
  if(pane) pane.classList.toggle('cal-hidden', !_calPaneVisible);
  if(btn)  btn.classList.toggle('active', _calPaneVisible);
}

function setJRange(r){
  _jRange = r;
  _jPastExtensionDays = 0; // start fresh — don't carry over a stale "loaded earlier" extension into a newly-picked range
  _jUnbookedOnly = false;
  const btnUn = document.getElementById('btn-unassigned');
  if(btnUn){ btnUn.classList.remove('btn-acc'); btnUn.classList.add('btn-ghost'); }
  ['all','7','30','past'].forEach(k=>{
    const b = document.getElementById('jrange-btn-'+k);
    if(b) b.classList.toggle('active', k===r);
  });
  renderJobs();
}

// Extends the default rolling window another 30 days into the past —
// called from the "Load earlier jobs" banner at the top of the list, since
// scrolling up alone never fetches anything further back on its own.
function loadEarlierJobs(){
  _jPastExtensionDays += 30;
  renderJobs();
}



function toggleUnassignedView(){
  if(!_jUnbookedOnly&&!_jUnconfirmedOnly){ _jUnbookedOnly=true; _jUnconfirmedOnly=false; }
  else if(_jUnbookedOnly){ _jUnbookedOnly=false; _jUnconfirmedOnly=true; }
  else { _jUnbookedOnly=false; _jUnconfirmedOnly=false; }
  const btn=document.getElementById('btn-unassigned');
  if(btn){
    if(_jUnbookedOnly){ btn.classList.add('btn-acc'); btn.classList.remove('btn-ghost'); btn.textContent='📋 Unbooked ✕'; }
    else if(_jUnconfirmedOnly){ btn.classList.add('btn-acc'); btn.classList.remove('btn-ghost'); btn.textContent='⏳ Unconfirmed ✕'; }
    else { btn.classList.remove('btn-acc'); btn.classList.add('btn-ghost'); btn.textContent='📋 Unbooked'; }
  }
  renderJobs();
}

function jcalShiftMonth(d){
  if(!_jcalMonth) _jcalMonth = new Date();
  _jcalMonth = new Date(_jcalMonth.getFullYear(), _jcalMonth.getMonth()+d, 1);
  renderMiniCal();
}

function renderMiniCal(){
  const grid = document.getElementById('jcal-grid');
  const lbl  = document.getElementById('jcal-month-lbl');
  if(!grid || !lbl) return;
  if(!_jcalMonth) _jcalMonth = new Date();
  const y = _jcalMonth.getFullYear();
  const m = _jcalMonth.getMonth();
  lbl.textContent = new Date(y, m, 1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const today = TODAY();
  const firstDay = new Date(y, m, 1).getDay();
  const startOffset = (firstDay === 0) ? 6 : firstDay - 1;
  const daysInMonth = new Date(y, m+1, 0).getDate();
  let html = ['M','T','W','T','F','S','S'].map(d=>`<div class="jcal-dow">${d}</div>`).join('');
  for(let i=0;i<startOffset;i++) html += `<div class="jcal-day jcal-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const jobs = _jcalJobDates[iso] || [];
    const isToday = iso === today;
    const isSel   = iso === jDate;
    const isPast  = iso < today;
    let cls = 'jcal-day';
    if(isToday)     cls += ' jcal-today';
    else if(isSel)  cls += ' jcal-selected';
    if(isPast)      cls += ' jcal-past';
    if(jobs.length) cls += ' jcal-has-jobs';
    const statusColors = {Pending:'#f5a623','In Progress':'#4f8fff',Completed:'#22c55e',Invoiced:'#a855f7',Emergency:'#e05252'};
    const dotSet = [...new Set(jobs.map(j=>j.status).slice(0,3))];
    const dots = dotSet.map(s=>`<div class="jcal-dot" style="background:${statusColors[s]||'#4e6080'}"></div>`).join('');
    html += `<div class="${cls}" onclick="jCalPickDate('${iso}');${jobs.length ? `setJRange('all');renderJobs();` : ''}" title="${iso}" style="${jobs.length ? 'cursor:pointer' : ''}">${d}${dots ? `<div class="jcal-dots">${dots}</div>` : ''}</div>`;
  }
  grid.innerHTML = html;
}

function jCalPickDate(iso){
  jDate = iso;
  renderMiniCal();
  renderJobs();
  setTimeout(()=>{
    const el = document.querySelector(`[data-date-group="${iso}"]`);
    if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
  }, 80);
}

// Debounced render for search performance
let _rjTimer;
function debounceRenderJobs(){clearTimeout(_rjTimer);_rjTimer=setTimeout(renderJobs,200);}
let _cmdTimer;
function debounceRenderCmd(q){clearTimeout(_cmdTimer);_cmdTimer=setTimeout(()=>renderCmd(q),200);}

async function renderJobs(){
  const lbl = document.getElementById('j-date-lbl');
  if(lbl) lbl.textContent = fmtD(jDate);
  const dp = document.getElementById('j-datepick');
  if(dp) dp.value = jDate;

  const ef = document.getElementById('j-eng-filter');
  const curEf = ef ? ef.value : '';
  if(ef) ef.innerHTML = '<option value="">Engineer</option>'+(S.engineers||[]).map(e=>`<option ${e.name===curEf?'selected':''}>${e.name}</option>`).join('');

  const search = (document.getElementById('j-search')?.value||'').toLowerCase().trim();
  const efVal  = ef ? ef.value : '';
  const sfVal  = document.getElementById('j-status-filter')?.value||'';
  const pfVal  = _priFilter||''; // set by priority dot toolbar (dropdown removed)

  let allJobs;
  // Search always scans every job ever created, regardless of the default
  // rolling-window view — but that means a search can trigger a full-table
  // fetch that takes a real moment once job history spans years. Rather
  // than leaving the screen looking blank/stuck while that happens, show a
  // clear "searching" state — but only if it's actually taking a moment
  // (a short delay before showing it avoids a flash on the common fast/
  // cached case, which is most of the time thanks to Realtime keeping the
  // cache warm).
  let _searchWaitTimer=null;
  if(search){
    _searchWaitTimer=setTimeout(()=>{
      const scroll=document.getElementById('jobs-list-scroll');
      if(scroll) scroll.innerHTML=`<div style="padding:48px;text-align:center;color:var(--txt3)"><div style="font-size:28px;margin-bottom:12px">⌕</div><div style="font-family:var(--fh);font-weight:700;font-size:14px;margin-bottom:6px">Searching all jobs…</div><div style="font-size:12px">Checking every year on record — this can take a moment for older jobs</div></div>`;
    },250);
  }
  try{
    allJobs = await _getJobs();
  }catch(err){
    clearTimeout(_searchWaitTimer);
    const scroll=document.getElementById('jobs-list-scroll');
    if(scroll) scroll.innerHTML=`<div style="padding:48px;text-align:center;color:var(--red)"><div style="font-size:28px;margin-bottom:12px">⚠️</div><div style="font-family:var(--fh);font-weight:700;font-size:14px;margin-bottom:6px">Could not load jobs</div><div style="font-size:12px;color:var(--txt3)">${(err.message||'Network error').slice(0,120)}</div><div style="margin-top:16px"><button class="btn btn-acc btn-sm" onclick="renderJobs()">Retry</button></div></div>`;
    return;
  }
  clearTimeout(_searchWaitTimer);
  const today = TODAY();

  _jcalJobDates = {};
  allJobs.forEach(j=>{ if(j.date){ (_jcalJobDates[j.date]=_jcalJobDates[j.date]||[]).push(j); } });
  renderMiniCal();
  renderCalEngSummary(allJobs, today);

  let jobs = allJobs;
  if(search){
    jobs = jobs.filter(j=>(j.address+' '+j.description+' '+j.referrer+' '+j.engineer+' '+(j.notes||'')+' '+(j.jobNum||'')+' '+(j.contact||'')+' '+(j.landlordName||'')+' '+(j.trade||'')).toLowerCase().includes(search));
  } else {
    if(_jRange === '7'){
      const lim = new Date(today); lim.setDate(lim.getDate()+7);
      const limStr = lim.toISOString().slice(0,10);
      jobs = jobs.filter(j=>j.date >= today && j.date <= limStr);
    } else if(_jRange === '30'){
      const lim = new Date(today); lim.setDate(lim.getDate()+30);
      const limStr = lim.toISOString().slice(0,10);
      jobs = jobs.filter(j=>j.date >= today && j.date <= limStr);
    } else if(_jRange === 'past'){
      jobs = jobs.filter(j=>j.date < today);
    } else if(_jRange === 'default'){
      // Rolling window: last 7 days → next 30 days, extendable further back
      // via the "Load earlier jobs" banner (_jPastExtensionDays) instead of
      // scrolling up hitting a silent dead end. Bounded regardless of how
      // much history accumulates — see the comment on _jRange's declaration
      // for why this matters at real growth rates.
      const from = new Date(today); from.setDate(from.getDate()-7-_jPastExtensionDays);
      const fromStr = from.toISOString().slice(0,10);
      const to = new Date(today); to.setDate(to.getDate()+30);
      const toStr = to.toISOString().slice(0,10);
      jobs = jobs.filter(j=>j.date >= fromStr && j.date <= toStr);
    }
  }
  if(_jUnbookedOnly){
    jobs = jobs.filter(j=>!j.date || j.date==='' || !j.engineer || j.engineer==='');
  } else if(_jUnconfirmedOnly){
    jobs = jobs.filter(j=>j.confirmed===false);
  } else {
    if(efVal) jobs = jobs.filter(j=>j.engineer===efVal);
  }
  if(sfVal) jobs = jobs.filter(j=>j.status===sfVal);
  if(pfVal) jobs = jobs.filter(j=>j.priority===pfVal);

  // Populate _jobRowData with every job object — gives drag-drop reliable access
  // to job data WITHOUT depending on _jobCache (which poll can nullify mid-drag)
  if(allJobs) allJobs.forEach(j=>{ _jobRowData[j.id]=j; });

  // Sort: date → manual sortOrder (user drag order) → timeSlot → created
  // _sortOrder MUST come before timeSlot — otherwise saved drag order is silently undone
  // by timeSlot alphabetical sort. timeSlot is only used as a tiebreaker when no manual order set.
  jobs.sort((a,b)=>{
    const dc=(a.date||'').localeCompare(b.date||'');
    if(dc) return dc;
    const aOrd=a._sortOrder||0; const bOrd=b._sortOrder||0;
    if(aOrd||bOrd) return aOrd-bOrd; // manual order wins when either has it
    return (a.timeSlot||'').localeCompare(b.timeSlot||'') || (a.created||0)-(b.created||0);
  });

  const scroll = document.getElementById('jobs-list-scroll');
  if(!scroll) return;

  if(!jobs.length){
    const showLoadEarlier = _jRange==='default' && !search;
    scroll.innerHTML = `<div style="padding:48px;text-align:center;color:var(--txt3)"><div style="font-size:36px;margin-bottom:12px">⊞</div><div style="font-family:var(--fh);font-weight:700;font-size:14px;margin-bottom:6px">${search?'No jobs match your search':'No jobs in this range'}</div><div style="font-size:12px">Try a different filter or <span style="color:var(--acc);cursor:pointer" onclick="openJobModal()">add a new job</span></div>${showLoadEarlier?`<div style="margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="loadEarlierJobs()">⬆ Load earlier jobs</button></div>`:''}</div>`;
    updateBulkBar(); return;
  }

  const groups = {};
  const groupOrder = [];
  jobs.forEach(j=>{ const d=j.date||'TBC'; if(!groups[d]){groups[d]=[];groupOrder.push(d);} groups[d].push(j); });

  const stripeClass = s => ({'Pending':'jsr-stripe-pending','In Progress':'jsr-stripe-progress','Completed':'jsr-stripe-done','Invoiced':'jsr-stripe-invoiced','Cannot Access':'jsr-stripe-noaccess','Cancelled':'jsr-stripe-cancelled','Emergency':'jsr-stripe-emg'}[s]||'jsr-stripe-pending');
  const statusSel = (jid,s,label) => `<select class="jsr-sel" aria-label="Status for ${escHtml(label||'job')}" onchange="quickStatus('${jid}',this.value)" onclick="event.stopPropagation()">${['Pending','In Progress','Completed','Invoiced','Cannot Access','Cancelled'].map(st=>`<option ${s===st?'selected':''}>${st}</option>`).join('')}</select>`;

  // Scrolling to the top of the bounded default view doesn't fetch anything
  // further back on its own — this banner is the actual way to see earlier
  // jobs, so the boundary is a clear, deliberate stop, not a silent dead end.
  let html = (_jRange==='default' && !search)
    ? `<div style="text-align:center;padding:10px;border-bottom:1px solid var(--border)">
         <button class="btn btn-ghost btn-sm" onclick="loadEarlierJobs()">⬆ Load earlier jobs (currently showing from ${_jPastExtensionDays?(_jPastExtensionDays+7)+' days back':'7 days back'})</button>
       </div>`
    : '';
  groupOrder.forEach(dateKey=>{
    const gjobs = groups[dateKey];
    const isToday = dateKey === today;
    let dayLabel = '';
    if(dateKey === 'TBC') dayLabel = 'Date TBC';
    else {
      const d = new Date(dateKey+'T00:00:00');
      const diffDays = Math.round((d - new Date(today+'T00:00:00'))/(1000*60*60*24));
      if(diffDays===0) dayLabel='Today';
      else if(diffDays===-1) dayLabel='Yesterday';
      else if(diffDays===1) dayLabel='Tomorrow';
      else dayLabel=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',year:'2-digit'});
    }
    const doneCount = gjobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).length;
    const countLabel = `${gjobs.length} job${gjobs.length!==1?'s':''}${doneCount?` · ${doneCount} done`:''}`;
    const dateShort = (dateKey!=='TBC')?new Date(dateKey+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'}):'';

    html += `<div class="jsg-hd ${isToday?'today-group':''}" data-date-group="${dateKey}">
      <span class="jsg-hd-label">${dayLabel}${dateShort&&dayLabel!=='Today'&&dayLabel!=='Yesterday'&&dayLabel!=='Tomorrow'?'':dateShort?` <span style="opacity:.5;font-weight:400">${dateShort}</span>`:''}</span>
      <div class="jsg-hd-line"></div>
      <span class="jsg-hd-count">${countLabel}</span>
    </div><div class="jsg-rows" data-date="${dateKey}">`;

    gjobs.forEach(j=>{
      const isPastJob = j.date < today;
      const isEmg = j.priority==='Emergency';

      // LINE 1: job# · full address · cert pills · timeslot · engineer
      const certPills=(j.certTypes||[]).map(id=>{ const ct=(S.certTypes||[]).find(c=>(c.id||c.name)===id)||{name:id}; return `<span class="jsr-chip jsr-chip-cert" style="font-size:10px">${ct.name}</span>`; }).join('');
      // Priority was previously conveyed by row background tint/border ALONE
      // (this pill was wired up but always empty) — a WCAG 1.4.1 failure and
      // useless to screen reader users. Normal (the default/majority case)
      // intentionally gets no pill, matching how the tint system already
      // treats it as the visually-quietest state; every other priority now
      // has a real text label.
      const priLabels={'Emergency':'🚨 Emergency','Urgent':'🔥 Urgent','Certificate':'📋 Cert','Repair':'🔧 Repair','Low':'▽ Low'};
      const prtyPill=priLabels[j.priority]||'';
      const statusCls={'Pending':'jsr-chip-pend','In Progress':'jsr-chip-time','Completed':'jsr-chip-done','Invoiced':'jsr-chip-inv','Cancelled':''}[j.status]||'';
      const statusLabel={'Pending':'⏳','In Progress':'🔨','Completed':'✓','Invoiced':'◎','Cancelled':'✕'}[j.status]||'';

      // ROW 2: compact info — desc + only the contact details that exist
      // Escaped here, once, at extraction — every render use below (contact
      // pills, the single-line summary, etc.) reads from these already-safe
      // values instead of re-reading raw j.* fields into HTML.
      const descFull=(j.description||'').trim();
      const descShort=escHtml(descFull.length>80?descFull.slice(0,80)+'…':descFull);

      // Build contact pills — only show if data exists
      const llName=escHtml(j.landlordName||(j.referrer&&j.referrer!==''?j.referrer:''));
      const llPhone=escHtml(j.landlordPhone||j.landlordWA||'');
      const agentName=escHtml(j.agentName||'');
      const agencyName=escHtml(j.agencyName||'');
      const accessInfo=escHtml(j.access||'');
      const contact=escHtml(j.contact||'');

      const contactPills=[]
      if(llName)   contactPills.push(`<span class="jsr3-cpill">🏠 ${llName}${llPhone?' '+llPhone:''}</span>`);
      if(agentName||agencyName) contactPills.push(`<span class="jsr3-cpill">🏢 ${agentName||(agencyName)}</span>`);
      if(accessInfo) contactPills.push(`<span class="jsr3-cpill">🔑 ${accessInfo}</span>`);
      if(contact)  contactPills.push(`<span class="jsr3-cpill">📞 ${contact}</span>`);

      const hasRow2=descFull||contactPills.length>0;
      const priceStr=j.price?`£${Number(j.price).toFixed(0)}`:'';

      // contact: pick the most relevant single-line label (landlord > agent > contact)
      const contactLine = llName ? (llName+(llPhone?' · '+llPhone:''))
                        : (agentName||agencyName) ? (agentName||(agencyName))
                        : contact ? contact
                        : accessInfo ? '🔑 '+accessInfo : '';

      const isUrg = j.priority==='Urgent';
      const isCert = j.priority==='Certificate';
      const isRepair = j.priority==='Repair';
      const isUnconfirmed = j.confirmed===false;
      const isNormal = j.priority==='Normal'||!j.priority;
      const isLow = j.priority==='Low';
      const rowPriClass = isEmg?'jsr-emg':isUrg?'jsr-urg':isCert?'jsr-cert':isRepair?'jsr-repair':isNormal?'jsr-normal':isLow?'jsr-low':'';
      const isSelected = selJobs.has(j.id);
      html += `<div class="jsr3 ${isPastJob&&!isToday?'jsr-past':''} ${rowPriClass}${isSelected?' jsr-selected':''}" data-id="${j.id}" onclick="openJobModal('${j.id}')" tabindex="0" role="button" aria-label="${escHtml((j.address||'Job')+' — '+(j.status||'Pending'))}" style="cursor:pointer;position:relative">
        <div class="jsr-drag-handle" title="Drag to reorder, or focus + Arrow Up/Down" draggable="true" tabindex="0" role="button" aria-label="Reorder job — use Arrow Up or Arrow Down" onclick="event.stopPropagation()" onkeydown="if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();_moveJobOrder('${j.id}',event.key==='ArrowUp'?-1:1)}">⠿</div>
        <div class="jsr-sel-check" tabindex="0" role="checkbox" aria-checked="${isSelected}" aria-label="Select job" onclick="event.stopPropagation();toggleSelRow('${j.id}',this)" onkeydown="if(event.key===' '||event.key==='Enter'){event.preventDefault();event.stopPropagation();toggleSelRow('${j.id}',this)}" style="display:flex;align-items:center;justify-content:center;width:16px;flex-shrink:0;cursor:pointer;opacity:${isSelected?1:0.35};transition:opacity .15s">
          <div style="width:14px;height:14px;border-radius:3px;border:1.5px solid ${isSelected?'var(--acc)':'var(--border2)'};display:flex;align-items:center;justify-content:center;transition:all .15s;${isSelected?'background:var(--acc);color:#fff;':''}">${isSelected?'✓':'&nbsp;'}</div>
        </div>
        <div class="jsr-stripe ${stripeClass(isEmg?'Emergency':j.status)}"></div>
        ${(()=>{const palette=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623','#ec4899','#06b6d4'];const engs=(S.engineers||[]);const idx=engs.findIndex(e=>e.name===j.engineer);const col=palette[idx>=0?idx%palette.length:Math.abs((j.engineer||' ').charCodeAt(0))%palette.length];return j.engineer?'<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:'+col+';border-radius:0 2px 2px 0"></div>':''})()}

        <!-- COL 1: Job # + priority pill -->
        <div class="jsr3-cell" data-col="jobnum" style="padding:5px 6px" onclick="event.stopPropagation()">
          ${j.jobNum?`<span class="jsr3-jobnum">${escHtml(j.jobNum)}</span>`:`<span style="color:var(--txt3);font-size:10px">—</span>`}
          ${prtyPill?`<span style="font-size:11px">${prtyPill}</span>`:''}
          ${isUnconfirmed?`<span class="jsr-unconfirmed">⏳ Unconfirmed</span>`:''}
        </div>

        <!-- COL 2: Address -->
        <div class="jsr3-cell jsr3-cell-addr" data-col="address">${j.address
          ? escHtml(j.address)
          : `<em style="color:var(--txt3);font-size:10px;font-style:normal">No address</em>`
        }</div>

        <!-- COL 3: Description -->
        <div class="jsr3-cell jsr3-cell-desc" data-col="desc">${descShort||'—'}</div>

        <!-- COL 4: Access — Keys info / Tenant info / both with slash -->
        <div class="jsr3-cell jsr3-cell-access" data-col="access">${(()=>{
          const aType = escHtml(j.access||'');
          const aDetail = escHtml(j.contact||'');
          if(!aType && !aDetail) return '<span style="color:var(--txt3);font-size:10px">—</span>';
          const isKey = aType.toLowerCase().includes('key');
          const isTenant = aType.toLowerCase().includes('tenant');
          const isVacant = aType.toLowerCase().includes('vacant');
          let parts=[];
          if(isKey && aDetail) parts.push('🔑 '+aDetail);
          else if(isKey) parts.push('🔑 Keys');
          if(isTenant && aDetail) parts.push('👤 '+aDetail);
          else if(isTenant) parts.push('👤 Tenant');
          if(isVacant) parts.push('🚪 Vacant');
          if(!parts.length && aDetail) parts.push(aDetail);
          else if(!parts.length && aType) parts.push(aType);
          return parts.join(' / ');
        })()}</div>

        <!-- COL 5: Time slot -->
        <div class="jsr3-cell jsr3-cell-time" data-col="time" onclick="event.stopPropagation()" title="Click to edit time slot">
          <span onclick="quickEditTime('${j.id}','${escHtml(j.timeSlot||'')}',this)" style="cursor:text;min-width:40px;display:inline-block">${escHtml(j.timeSlot)||'—'}</span>
        </div>

        <!-- COL 6: Engineer -->
        <div class="jsr3-cell jsr3-cell-eng" data-col="eng">${j.engineer?`<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${(()=>{const palette=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623','#ec4899','#06b6d4'];const engs=(S.engineers||[]);const idx=engs.findIndex(e=>e.name===j.engineer);return palette[idx>=0?idx%palette.length:Math.abs(j.engineer.charCodeAt(0))%palette.length];})()};flex-shrink:0"></span>${escHtml(j.engineer)}</span>`:'—'}</div>

        <!-- COL 7: Amount -->
        <div class="jsr3-cell jsr3-cell-price" data-col="price" onclick="event.stopPropagation()" title="Click to edit price">
          <span onclick="quickEditPrice('${j.id}','${j.price||0}',this)" style="cursor:text;min-width:32px;display:inline-block">${priceStr||'—'}</span>
        </div>

        <!-- COL 8: Referrer — landlord > agent > agency > referrer field -->
        <div class="jsr3-cell jsr3-cell-referrer" data-col="referrer">${(()=>{
          if(j.landlordName) return '🏠 '+escHtml(j.landlordName);
          if(j.agentName)    return '👤 '+escHtml(j.agentName);
          if(j.agencyName)   return '🏢 '+escHtml(j.agencyName);
          if(j.referrer)     return escHtml(j.referrer);
          return '<span style="color:var(--txt3);font-size:10px">—</span>';
        })()}</div>

        <!-- COL 9: Status dropdown -->
        <div class="jsr3-cell jsr3-cell-sel" data-col="sel" onclick="event.stopPropagation()">${statusSel(j.id,j.status,j.jobNum||j.address||'')}</div>

        <!-- COL 10: Actions — fixed 5-slot grid so buttons never shift position -->
        <div class="jsr3-cell jsr3-cell-actions" data-col="actions" onclick="event.stopPropagation()">
          ${(()=>{
            const slaDays=j.status==='Pending'&&j.created?Math.floor((Date.now()-j.created)/86400000):0;
            const slaColor=slaDays>=7?'#b91c1c':slaDays>=3?'#d97706':'';
            const hasSLA=slaDays>=3;
            const slaHTML=hasSLA?`<span style="font-size:9px;font-weight:700;color:${slaColor};background:${slaDays>=7?'rgba(185,28,28,.1)':'rgba(217,119,6,.1)'};padding:1px 4px;border-radius:3px;white-space:nowrap">${slaDays}d</span>`:'<span style="width:1px"></span>';
            const noInv=(j.status===STATUS.COMPLETED)&&!(j.linkedInvId||j.invNumber);
            const invHTML=noInv?`<button class="jsr-btn" onclick="createInvFromJob('${j.id}')" style="color:var(--green)" title="Create invoice" aria-label="Create invoice">◎</button>`:'';
            return `<div class="jsr-act-slot">${slaHTML}</div><div class="jsr-act-slot">${invHTML}</div>`;
          })()}
          <div class="jsr-act-slot"><button class="jsr-btn" title="Edit" aria-label="Edit job" onclick="openJobModal('${j.id}')">✎</button></div>
          <div class="jsr-act-slot"><button class="jsr-btn" title="Copy to next day" aria-label="Copy to next day" onclick="copyJobToNextDay('${j.id}')">⧉</button></div>
          <div class="jsr-act-slot"><button class="jsr-btn" title="WhatsApp" aria-label="Send WhatsApp" onclick="waSingleJobById('${j.id}')">📱</button></div>
        </div>
      </div>`;
    });

    if(dateKey !== 'TBC'){
      const addLabel = new Date(dateKey+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
      html += `<div class="jsg-add" onclick="jDate='${dateKey}';openJobModal()"><span style="font-size:16px;color:var(--acc)">+</span> Add job for ${addLabel}</div>`;
    }
    html += `</div>`;
  });

  hideTip(); // Always hide any active tooltip before rebuilding the DOM — prevents orphan tooltips after re-render
  scroll.innerHTML = html;
  // Rebuild header from JOB_COLS (keeps it in sync after every render)
  renderJobsHeader();
  // Apply template to all newly rendered rows
  applyColTemplate();
  initScrollListDrag();
  initJobMultiSelect();
  initJobKeyboardNav();
  updateBulkBar();
  updatePriDotsVisibility();
  setTimeout(attachJobTooltips,100);
}

function renderCalEngSummary(allJobs, today){
  // ── Today's engineers summary ──
  const el = document.getElementById('jcal-engs');
  if(el){
    const dayJobs = allJobs.filter(j=>j.date===today);
    if(!dayJobs.length){ el.innerHTML=''; }
    else {
      const palette=['#a855f7','#14b8a6','#f97316','#4f8fff','#22c55e','#e05252','#f5a623'];
      const engColors={};
      (S.engineers||[]).forEach((e,i)=>{ engColors[e.name]=palette[i%palette.length]; });
      const byEng={};
      dayJobs.forEach(j=>{ const k=j.engineer||'Unassigned'; byEng[k]=(byEng[k]||0)+1; });
      el.innerHTML=`<div class="jcal-eng-hd">Today's Engineers</div>`+
        Object.entries(byEng).map(([name,count])=>
          `<div class="jcal-eng-row"><div class="jcal-eng-dot" style="background:${engColors[name]||'#4e6080'}"></div><span class="jcal-eng-name">${name}</span><span class="jcal-eng-count">${count} job${count!==1?'s':''}</span></div>`
        ).join('');
    }
  }

  // ── Portal Requests (fetched live) ────────────────────────────────────
  const prEl = document.getElementById('insights-portal-requests');
  if(prEl){
    prEl.innerHTML=`<div style="font-size:10px;font-weight:700;color:var(--txt3)">🔄 Loading requests…</div>`;
    _sb('engineer_requests?type=eq.portal_request&status=eq.pending&order=created.desc&limit=10')
      .then(reqs=>{
        if(!reqs||!reqs.length){
          prEl.innerHTML=`<div style="font-size:10px;color:var(--txt3)">✓ No pending portal requests</div>`;
          return;
        }
        const hd=`<div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
          <span>🏠 Portal Requests</span>
          <span style="background:#7c3aed22;color:#7c3aed;border-radius:10px;padding:1px 7px;font-family:var(--fm)">${reqs.length}</span>
        </div>`;
        const rows=reqs.map(r=>{
          const lines=(r.notes||'').split('\n');
          const get=k=>{const l=lines.find(x=>x.toLowerCase().startsWith(k.toLowerCase()+':'));return l?l.slice(k.length+1).trim():'';};
          const ref=(lines[0]||'').match(/\[([^\]]+)\]/)?.[1]||'';
          const svc=get('Service')||'—';
          const addr=get('Address')||'—';
          const parsedPortal=JSON.stringify({ref,service:svc,address:addr,date:get('Preferred date'),access:get('Access'),extraNotes:get('Notes'),clientName:(r.engineer_name||'').replace(/\s*\([^)]+\)\s*$/,'').trim()});
          return`<div style="padding:6px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:11px;font-weight:700;color:var(--txt);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(r.engineer_name||'Client').replace(/\s*\([^)]+\)/,'')}</div>
            <div style="font-size:10px;color:#7c3aed;font-weight:600;margin-bottom:3px">${svc.slice(0,40)}</div>
            <div style="font-size:10px;color:var(--txt3);margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${addr}</div>
            <div style="display:flex;gap:5px">
              <button onclick="createJobFromPortalReq('${r.id}',${JSON.stringify(parsedPortal).replace(/"/g,'&quot;')})" style="flex:1;background:var(--acc);color:#fff;border:none;border-radius:5px;padding:4px 6px;font-size:10px;font-weight:700;cursor:pointer">➕ Create Job</button>
              <button onclick="approvePortalReq('${r.id}')" style="flex:1;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:5px;padding:4px 6px;font-size:10px;font-weight:700;cursor:pointer">✓ Ack</button>
            </div>
          </div>`;
        }).join('');
        prEl.innerHTML=hd+rows+`<div style="margin-top:6px"><button onclick="nav('req')" style="width:100%;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px;font-size:10px;color:var(--txt3);cursor:pointer">View all in Requests →</button></div>`;
      })
      .catch(()=>{ prEl.innerHTML=`<div style="font-size:10px;color:var(--txt3)">✓ No pending portal requests</div>`; });
  }

  // ── Smart Insights Panel ──────────────────────────────────────────
  const _ins = (id, html) => { const e=document.getElementById(id); if(e) e.innerHTML=html; };
  const _insHd = (icon, label, count, color) =>
    `<div style="font-size:10px;font-weight:700;color:${color||'var(--txt2)'};margin-bottom:6px;display:flex;align-items:center;justify-content:space-between">
       <span>${icon} ${label}</span>
       <span style="background:${color||'var(--accent)'}22;color:${color||'var(--txt2)'};border-radius:10px;padding:1px 7px;font-family:var(--fm)">${count}</span>
     </div>`;

  // 1. Unbooked jobs (no date OR no engineer)
  const unbooked = allJobs.filter(j=>!j.date||j.date===''||!j.engineer||j.engineer==='');
  if(document.getElementById('insights-unbooked')){
    if(!unbooked.length){
      _ins('insights-unbooked',`<div style="font-size:10px;color:var(--txt3)">✓ All jobs booked & assigned</div>`);
    } else {
      const rows = unbooked.slice(0,5).map(j=>{
        const reason = (!j.date||j.date==='')?'No date':(!j.engineer||j.engineer==='')?'No engineer':'';
        const addr = (j.address||'No address').slice(0,26);
        return `<div onclick="df.once('navDone:jobs',()=>openJobModal('${j.id}'));nav('jobs')"
          style="padding:5px 0;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px"
          onmouseenter="this.style.opacity='.7'" onmouseleave="this.style.opacity='1'">
          <span style="font-size:11px;color:var(--txt);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${addr}</span>
          <span style="font-size:9px;color:var(--red);background:var(--red-soft,#fee2e2);border-radius:8px;padding:1px 6px;white-space:nowrap;flex-shrink:0">${reason}</span>
        </div>`;
      }).join('');
      // "toggleUnbooked()" doesn't exist anywhere — the real function is
      // toggleUnassignedView() (used correctly by the sidebar's "Unbooked
      // Jobs" menu item). This link threw a ReferenceError and did nothing.
      // Fixed to match the row-click pattern just above: navigate to Jobs,
      // then apply the unbooked filter once the page has actually loaded.
      const more = unbooked.length>5?`<div style="font-size:10px;color:var(--txt3);margin-top:4px;text-align:center;cursor:pointer" onclick="df.once('navDone:jobs',()=>toggleUnassignedView());nav('jobs')">${unbooked.length-5} more →</div>`:'';
      _ins('insights-unbooked', _insHd('📌','Unbooked',unbooked.length,'var(--red)') + rows + more);
    }
  }

  // 2. Active jobs with no notes (Pending or In Progress, no description, no notes)
  const nonotes = allJobs.filter(j=>
    (j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS) &&
    (!j.description||j.description.trim()==='') &&
    (!j.notes||j.notes.trim()==='')
  );
  if(document.getElementById('insights-nonotes')){
    if(!nonotes.length){
      _ins('insights-nonotes',`<div style="font-size:10px;color:var(--txt3)">✓ All active jobs have notes</div>`);
    } else {
      const rows = nonotes.slice(0,4).map(j=>{
        const addr = (j.address||'No address').slice(0,26);
        const dateStr = j.date?j.date.slice(5):'—';
        return `<div onclick="df.once('navDone:jobs',()=>openJobModal('${j.id}'));nav('jobs')"
          style="padding:5px 0;border-bottom:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px"
          onmouseenter="this.style.opacity='.7'" onmouseleave="this.style.opacity='1'">
          <span style="font-size:11px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${addr}</span>
          <span style="font-size:9px;color:var(--txt3);white-space:nowrap">${dateStr}</span>
        </div>`;
      }).join('');
      _ins('insights-nonotes', _insHd('📝','No Notes',nonotes.length,'var(--yellow,#f59e0b)') + rows);
    }
  }
}


async function quickConfirm(id, confirmed){
  try{
    await _sb(`jobs?id=eq.${encodeURIComponent(id)}`,{
      method:'PATCH',
      body:{confirmed, modified:Date.now()},
      prefer:'return=minimal'
    });
    _invalidateJobCache();
    renderJobs();
    toast(confirmed ? '✅ Job marked as Confirmed' : '⏳ Job marked as Unconfirmed', 'success', 2000);
  }catch(e){ toast('Could not update confirmation status','error'); }
}

// A job moving OUT of one of these "final" statuses is a reversion, not a
// normal forward step — tracked separately in the Audit Trail's Status
// Reversions tab so Admin has one place to review these without them being
// mixed into every other routine status change. No functional restriction
// is applied — staff can still change status freely; this is visibility only.
const FINAL_STATUSES=['Completed','Invoiced','Cancelled'];
function logStatusRevertIfNeeded(details){
  if(FINAL_STATUSES.includes(details.oldStatus) && details.oldStatus!==details.newStatus){
    logAudit('job_status_revert',details);
  }
}

// Re-renders the Jobs list without losing the user's place in it. Every
// save/status-change/delete/bulk-action used to call renderJobs() directly,
// which rebuilds the whole list and silently resets scroll to the top —
// disruptive when you're working down a long list one job at a time. Only
// use this for actions that keep the user on the same date/filter view;
// actions that intentionally jump the view elsewhere (e.g. duplicateJob
// switching to today) should keep calling renderJobs() directly.
function _renderJobsKeepScroll(){
  const pane=document.getElementById('jobs-list-pane');
  const scrollTop=pane?pane.scrollTop:0;
  renderJobs();
  if(pane) pane.scrollTop=scrollTop;
}

// The actual status-change work (PATCH + cache + cert-creation + audit +
// notifications), with no rendering — shared by quickStatus (one job) and
// bulkSetStatus (many jobs) so this cascade exists in exactly one place
// instead of being copy-pasted per entry point (see JS Refactoring Finding
// 9). Returns true/false rather than throwing so callers can count
// successes/failures without a try/catch per job.
async function _applyStatusChange(id,status,opts){
  const silent=opts&&opts.silent;
  const j=await dGet('jobs',id);
  if(!j) return false;
  const old=j.status;
  if(old===status) return true; // no-op, not a failure
  // Use targeted PATCH (only update status+modified) rather than full PUT
  // This avoids overwriting fields another user may have just changed
  let queued=false;
  try{
    const r=await queueableSave(`Status → ${status} — ${j.address||''}`, `jobs?id=eq.${encodeURIComponent(id)}`,{
      method:'PATCH',
      body:{status,modified:Date.now()},
      prefer:'return=minimal'
    });
    queued=r.queued;
  }catch(e){
    if(!silent) toast('Status update failed: '+( e.message||'').slice(0,80),'error');
    return false;
  }
  if(queued && !silent) toast('📴 Offline — status change saved, will sync when back online','warn',4000);
  j.status=status;j.modified=Date.now();
  _invalidateJobCache();
  if(status===STATUS.COMPLETED&&old!==STATUS.COMPLETED) onJobComplete(j);
  await logActivity(`Job "${j.address}" → ${status}`,'job');
  logAudit('job_status_change',{jobId:id,jobNum:j.jobNum,address:j.address,oldStatus:old,newStatus:status});
  logStatusRevertIfNeeded({jobId:id,jobNum:j.jobNum,address:j.address,oldStatus:old,newStatus:status,staffName:_appUser?.name||''});
  {
    const notifPayload={jobId:id,jobNum:j.jobNum,address:j.address,oldStatus:old,newStatus:status,
      landlordName:j.landlordName||j.referrer||'',landlordPhone:j.landlordPhone||'',landlordEmail:j.landlordEmail||'',
      agencyName:j.agencyName||'',agentName:j.agentName||'',agentPhone:j.agentPhone||''};
    sendNotificationWebhook('job_status_change',notifPayload);
    sendPushNotification('job_status_change',notifPayload);
    if(status===STATUS.COMPLETED) notifyNextTenantEta(j);
  }
  return true;
}

async function quickStatus(id,status){
  const ok=await _applyStatusChange(id,status);
  if(ok){ _renderJobsKeepScroll();updateBadges(); }
}

// ── Pending cert queue for expiry date prompts after job complete ──



function onJobComplete(j){
  const allCertTypes=S.certTypes||[];
  const descL=(j.description||'').toLowerCase();

  // ALWAYS start with manually selected cert types on the job
  const selectedIds=new Set(j.certTypes||[]);

  // ALWAYS ALSO scan description keywords — additive, not either/or
  allCertTypes.forEach(ct=>{
    const kws=ct.keywords||[];
    if(kws.some(kw=>kw.trim()&&descL.includes(kw.trim().toLowerCase()))) selectedIds.add(ct.id||ct.name);
  });

  // Create all matching certs silently — no modal, no asking
  if(selectedIds.size){
    _pendCertJob=j;
    selectedIds.forEach(id=>{
      const ct=allCertTypes.find(c=>(c.id||c.name)===id)||{name:String(id),validity:12,color:'#f5a623',prefix:'CERT-'};
      // Calculate default expiry from validity months
      let defaultExpiry=null;
      if(ct.validity){
        const d=new Date();d.setMonth(d.getMonth()+(ct.validity||12));
        defaultExpiry=d.toISOString().slice(0,10);
      }
      createCertEntry(ct,defaultExpiry,null,TODAY());
    });
    const count=selectedIds.size;
    setTimeout(()=>{
      updateBadges();
      if(getCertTab()==='dash')renderCertDash();else if(getCertTab()==='list')renderCertTable();
      toast(`✅ ${count} certificate${count!==1?'s':''} auto-created — review in Certificates`,'success',5000);
      _pendCertJob=null;
    },800);
  }

  // Auto-create invoice (delayed so certs finish first)
  setTimeout(()=>autoInvoice(j),1400);

  // Refresh smart banner to show newly completed job needing invoice
  setTimeout(updateInvSmartBanner,2000);
}

function promptNextCertExpiry(){
  if(!_pendCertQueue.length||!_pendCertJob){
    updateBadges();if(getCertTab()==='dash')renderCertDash();else if(getCertTab()==='list')renderCertTable();else if(getCertTab()==='stats')renderCertStats();
    if(_pendCertJob){
      toast(`✅ Cert entries created — add expiry dates anytime in Certificates`,'info',5000);
    }
    _pendCertJob=null;
    return;
  }
  const ct=_pendCertQueue.shift();
  const mo=document.getElementById('mo-cert-expiry');
  if(!mo){
    // Fallback: create cert without expiry
    createCertEntry(ct,null,null);
    promptNextCertExpiry();
    return;
  }
  // Fill modal
  document.getElementById('ce-type-name').textContent=ct.name;
  document.getElementById('ce-address').textContent=_pendCertJob.address;
  document.getElementById('ce-remaining').textContent=_pendCertQueue.length?`${_pendCertQueue.length} more after this`:'Last certificate';
  document.getElementById('ce-expiry').value='';
  document.getElementById('ce-certnum').value='';
  document.getElementById('ce-issue').value=TODAY();
  // Default expiry = today + validity months
  if(ct.validity){
    const d=new Date();d.setMonth(d.getMonth()+(ct.validity||12));
    document.getElementById('ce-expiry').value=d.toISOString().slice(0,10);
  }
  document.getElementById('ce-color-dot').style.background=ct.color||'var(--acc)';
  // Store current for save
  window._currentCertType=ct;
  openModal('mo-cert-expiry');
}

export function saveCertExpiry(){
  const ct=window._currentCertType;
  if(!ct||!_pendCertJob)return;
  const expiry=document.getElementById('ce-expiry').value||null;
  const certNum=document.getElementById('ce-certnum').value||null;
  const issue=document.getElementById('ce-issue').value||TODAY();
  createCertEntry(ct,expiry,certNum,issue);
  closeModal('mo-cert-expiry');
  setTimeout(()=>promptNextCertExpiry(),300);
}

export function skipCertExpiry(){
  const ct=window._currentCertType;
  if(ct&&_pendCertJob){
    createCertEntry(ct,null,null); // create entry with no expiry date
  }
  closeModal('mo-cert-expiry');
  setTimeout(()=>promptNextCertExpiry(),300);
}

async function createCertEntry(ct,expiry,certNum,issueDate){
  if(!_pendCertJob)return;
  // Guard: don't create a duplicate cert for the same job + same type.
  // Matches by job id when we have a real one (the normal case); falls back
  // to matching by address + type when we don't (e.g. a caller that only has
  // a placeholder job-like object) — without this fallback, a caller passing
  // an object with no .id made this check compare against `undefined`, which
  // never matches a real certificate and let duplicates through silently.
  const allCerts=await dAll('certs');
  const isDup = _pendCertJob.id
    ? allCerts.some(c=>c.jobId===_pendCertJob.id&&c.type===ct.name)
    : allCerts.some(c=>c.address===_pendCertJob.address&&c.type===ct.name);
  if(isDup) return;
  // Auto-generate cert number if not provided
  const autoNum=certNum||(ct.prefix||'CERT-')+String(_pendCertJob.jobNum||'').replace(/\D/g,'')+'-'+String(Date.now()).slice(-4);
  const cert={
    id:uid(),
    address:_pendCertJob.address,
    type:ct.name,
    landlord:_pendCertJob.referrer||_pendCertJob.landlordName||'',
    issueDate:issueDate||TODAY(),
    expiryDate:expiry||'',
    certNum:autoNum,
    jobId:_pendCertJob.id,
    jobNum:_pendCertJob.jobNum||'',
    engineer:_pendCertJob.engineer||'',
    notes:'Auto-created on job completion',
    noExpiry:!expiry,
  };
  await dPut('certs',cert);
  await logActivity(`Cert created: ${ct.name} at ${_pendCertJob.address}${expiry?` · Exp: ${expiry}`:''}`, 'cert');
  {
    const notifPayload={certId:cert.id,certType:ct.name,address:cert.address,expiryDate:cert.expiryDate,
      jobId:_pendCertJob.id,jobNum:_pendCertJob.jobNum||'',
      landlordName:_pendCertJob.landlordName||_pendCertJob.referrer||'',landlordPhone:_pendCertJob.landlordPhone||'',landlordEmail:_pendCertJob.landlordEmail||''};
    sendNotificationWebhook('cert_ready',notifPayload);
    sendPushNotification('cert_ready',notifPayload);
  }
}


// Mutex to prevent concurrent nextJobNum calls producing duplicate numbers


async function nextJobNum(prefix){
  // Spin-wait if another call is in progress (simple mutex for async)
  const deadline = Date.now() + 5000;
  while(_jobNumLock && Date.now() < deadline){
    await new Promise(r=>setTimeout(r,80));
  }
  _jobNumLock = true;
  try{
    // CR-prefix mode (3-digit pad) — atomic DB sequence, falls back to the
    // old scan-based method if the RPC isn't available yet (SQL not run).
    if(prefix==='CR'){
      try{
        const n=await _sb('rpc/next_cr_num',{method:'POST',body:{}});
        if(typeof n==='number') return 'CR'+String(n).padStart(3,'0');
      }catch(e){ console.warn('[nextJobNum] next_cr_num RPC failed, using fallback',e); }
      const rows = await _sb('jobs?select=jobnum&limit=500') || [];
      let maxN=0;
      const re=/^CR(\d+)$/i;
      rows.forEach(r=>{
        const jn=r.jobnum||r.jobNum||'';
        const m=jn.match(re);
        if(m) maxN=Math.max(maxN,parseInt(m[1],10)||0);
      });
      return 'CR'+String(maxN+1).padStart(3,'0');
    }
    // Default: regular job numbering (e.g. JOB-0001, 4-digit pad) — atomic
    // DB sequence, falls back to the old scan-based method if unavailable.
    const jobPrefix=S.jobPrefix||'JOB-';
    try{
      const n=await _sb('rpc/next_job_num',{method:'POST',body:{}});
      if(typeof n==='number'){
        S.jobNextNum=n+1;
        return jobPrefix+String(n).padStart(4,'0');
      }
    }catch(e){ console.warn('[nextJobNum] next_job_num RPC failed, using fallback',e); }
    const rows = await _sb('jobs?select=jobnum&order=jobnum.desc&limit=500') || [];
    let maxN=S.jobNextNum||1001;
    rows.forEach(r=>{
      const jn = r.jobnum||r.jobNum||'';
      if(jn.startsWith(jobPrefix)){
        const parsed=parseInt(jn.replace(jobPrefix,''),10);
        if(!isNaN(parsed)&&parsed>=maxN) maxN=parsed+1;
      }
    });
    const chosen=maxN;
    S.jobNextNum=chosen+1;
    saveSetting('jobNextNum',S.jobNextNum);
    return jobPrefix+String(chosen).padStart(4,'0');
  }finally{
    _jobNumLock = false;
  }
}

// ── VAT helper ──
// Thin wrapper — the actual rate logic (including the `S.vatRate||20`
// quirk that treats an explicit 0% as falsy, documented and preserved
// exactly in tests/unit/business.test.js) now lives in @business as
// officeVatRate(). 13 call sites throughout this file reference
// getVatRate() by this name, so kept as a wrapper rather than renaming them.
function getVatRate(){return officeVatRate(S);}

// In-progress guard for autoInvoice() — prevents the same job from being
// auto-invoiced twice if it's called twice in quick succession within this
// tab (e.g. a duplicate completion event). This does NOT cover two separate
// Office tabs/devices racing each other — there's no DB constraint backing
// this (see AUDIT.md 3.2); the re-check immediately before the write below
// narrows that window but doesn't eliminate it.
const _autoInvoiceInProgress=new Set();

async function autoInvoice(j){
  // Respect the "auto-create invoice on completion" setting
  if(S.autoInvOnComplete===false) return;
  if(_autoInvoiceInProgress.has(j.id)) return;
  _autoInvoiceInProgress.add(j.id);
  try{
    return await _autoInvoiceInner(j);
  } finally {
    _autoInvoiceInProgress.delete(j.id);
  }
}

async function _autoInvoiceInner(j){
  // Guard: skip if an invoice already exists for this job
  const allInvs=await dAll('invoices');
  if(allInvs.some(i=>i.jobId===j.id||i.linkedJobId===j.id)) return;

  // Find client — agency/agent name takes priority (they're who's actually
  // billed for agency-referred work), then landlord name, then referrer.
  // This used to only check referrer/landlordName, so a job referred purely
  // through an agent (no separate landlord or referrer filled in — e.g. an
  // agency-instructed job) matched no client and created none, so autoInvoice
  // silently did nothing with no error explaining why no draft ever appeared.
  const billName=j.agencyName||j.agentName||j.landlordName||j.referrer||'';
  const persons=await dAll('persons');
  let client=persons.find(p=>p.name&&p.name===billName);
  // If no existing person, create one from job data so invoice always generates
  if(!client && billName){
    client={
      id:uid(),
      name:billName,
      email:j.landlordEmail||j.agentEmail||j.agencyEmail||'',
      phone:j.landlordPhone||j.agentPhone||j.agencyPhone||j.contact||'',
      address:j.address||'',
      wa:j.landlordWA||''
    };
    await dPut('persons',client);
  }
  if(!client){
    // Previously a silent no-op — the cert would auto-create fine (no
    // client dependency) while the invoice just never appeared, with
    // nothing telling the office why. At least surface it now.
    toast(`⚠ No draft invoice created for ${j.address||'this job'} — no landlord, agent, or agency name on the job`,'warn',6000);
    return;
  }

  // TASK 24: Build line items intelligently:
  // 1. Labour line from engineer hours × hourly rate (if hours were logged)
  // 2. Fallback to job price field if no hours, or as a separate materials line
  const engObj=(S.engineers||[]).find(e=>e.name===j.engineer);
  const hourlyRate=engObj?.rate||0;
  const hours=parseFloat(j.hours)||0;
  const jobPrice=Number(j.price)||0;

  const items=[];
  if(hours>0&&hourlyRate>0){
    // Hours logged + rate known → Labour line
    items.push({desc:`Labour — ${j.description||j.trade||'Works'} (${hours}h @ £${hourlyRate}/h)`,qty:hours,unit:hourlyRate,vat:true});
    // If job also has a separate price (materials), add it as a second line
    if(jobPrice>0&&Math.abs(jobPrice-(hours*hourlyRate))>0.01){
      items.push({desc:`Materials / Additional — ${j.description||j.address}`,qty:1,unit:jobPrice,vat:true});
    }
  } else if(hours>0){
    // Hours logged but no rate → show hours, zero price so office can fill in
    items.push({desc:`Labour — ${j.description||j.trade||'Works'} (${hours}h)`,qty:hours,unit:0,vat:true});
    if(jobPrice>0) items.push({desc:`Works at ${j.address}`,qty:1,unit:jobPrice,vat:true});
  } else {
    // No hours — use job price as a single line
    items.push({desc:j.description||'Labour',qty:1,unit:jobPrice,vat:true});
  }
  // description field = combined line item descs (single source of truth)
  const invDescription = items.map(i=>i.desc).filter(Boolean).join('; ');

  const inv={
    id:uid(),
    // Agency/agent-referred jobs must get an AGN- number from the agency
    // series, not the landlord INV- series — this was always being called
    // with no argument here, so every auto-created invoice silently used
    // the landlord series regardless of who the job was actually for.
    number:await nextInvNum(!!(j.agencyName||j.agentName)),
    clientId:client.id,
    clientName:client.name,
    clientEmail:client.email||'',
    clientAddr:client.address||'',
    clientWA:client.wa||'',
    date:TODAY(),
    dueDate:'',
    description:invDescription||j.description||'',
    jobId:j.id,
    linkedJobId:j.id,
    jobNum:j.jobNum||'',
    jobAddress:j.address||'',          // property address — always saved now
    propertyAddress:j.address||'',
    jobDate:j.date||'',               // job completion date
    engineer:j.engineer||'',          // engineer name
    certTypes:(j.certTypes||[]).join(', '), // cert types done
    landlordName:j.landlordName||j.referrer||'',
    agencyName:j.agencyName||'',
    agentName:j.agentName||'',
    invoiceType:j.agencyName||j.agentName?'agency':'landlord',
    billToName:billName,
    items,
    status:'Draft',
    created:Date.now(),
  };
  // Re-check immediately before writing — narrows (does not eliminate, no
  // DB constraint backs this) the window where a second Office tab could
  // have passed the earlier check and created its own invoice for this job
  // in the time it took to build the line items above.
  const recheck=await _sb(`invoices?select=id&or=(jobid.eq.${encodeURIComponent(j.id)},linkedjobid.eq.${encodeURIComponent(j.id)})&limit=1`).catch(()=>null);
  if(recheck && recheck.length) return;
  await dPut('invoices',inv);
  // Update job status to Invoiced. This is a raw _sb() call (not dPut()),
  // so it bypasses _toDb()'s camelCase→snake_case mapping — the real column
  // is `linkedinvid`, not `linkedInvId`. Sending the wrong case here meant
  // PostgREST rejected the entire PATCH (unknown column), silently swallowed
  // by the .catch() below, so auto-created invoices never actually flipped
  // the job's status to Invoiced or recorded the link back to the invoice.
  await _sb(`jobs?id=eq.${encodeURIComponent(j.id)}`,{method:'PATCH',body:{status:STATUS.INVOICED,linkedinvid:inv.id,modified:Date.now()},prefer:'return=minimal'}).catch(()=>{});
  await logActivity(`Draft invoice ${inv.number} auto-created for ${client.name} (${hours?hours+'h':('£'+jobPrice)})`, 'invoice');
  toast(`📄 Draft invoice ${inv.number} created — review in Invoices`,'info',5000);
  updateBadges();
  return true;
}


async function nextInvNum(isAgency=false){
  const prefix=isAgency?(S.agencyInvPrefix||'AGN-'):(S.invPrefix||'INV-');
  // Atomic DB sequence — agency and regular invoices now have genuinely
  // separate series. Falls back to the old scan-based method if the RPC
  // isn't available yet (SQL not run).
  try{
    const n=await _sb(isAgency?'rpc/next_agn_num':'rpc/next_inv_num',{method:'POST',body:{}});
    if(typeof n==='number'){
      if(!isAgency) S.invNextNum=n+1;
      return prefix+n;
    }
  }catch(e){ console.warn('[nextInvNum] RPC failed, using fallback',e); }
  // Scan ALL existing invoices to guarantee uniqueness — prevents duplicate numbers
  const allInvs=await dAll('invoices');
  let maxN=isAgency?(S.agencyInvStart||2001):(S.invNextNum||S.invStart||1001);
  allInvs.forEach(inv=>{
    if(inv.number&&inv.number.startsWith(prefix)){
      const parsed=parseInt(inv.number.replace(prefix,''),10);
      if(!isNaN(parsed)&&parsed>=maxN) maxN=parsed+1;
    }
  });
  const chosen=maxN;
  if(!isAgency){
    S.invNextNum=chosen+1;
    saveSetting('invNextNum',S.invNextNum);
  }
  return prefix+chosen;
}

// ══════════════════════════════════════════════════════════════
//  PROFORMA INVOICES — quotation/disposable invoices
// ══════════════════════════════════════════════════════════════

// Get next proforma number
async function nextProformaNum(){
  // Atomic DB sequence — falls back to the old scan-based method if the
  // RPC isn't available yet (SQL not run).
  try{
    const n=await _sb('rpc/next_proforma_num',{method:'POST',body:{}});
    if(typeof n==='number') return 'PF-'+String(n).padStart(3,'0');
  }catch(e){ console.warn('[nextProformaNum] RPC failed, using fallback',e); }
  try{
    const invs=await _sb('invoices?type=eq.proforma&order=number.desc&limit=1');
    const last=invs?.[0]?.number||'PF-000';
    const n=parseInt(last.replace(/[^0-9]/g,''))||0;
    return 'PF-'+String(n+1).padStart(3,'0');
  }catch(e){return 'PF-001';}
}

// Create proforma from job
async function createProforma(jobId){
  const job=_jobRowData[jobId];
  if(!job){toast('Job not found','error');return;}
  const now=Date.now();
  const num=await nextProformaNum();
  const vr=getVatRate();
  const price=Number(job.price)||0;
  const vat=price*vr/100;
  const body={
    type:'proforma',
    status:'Draft',
    number:num,
    date:TODAY(),
    dueDate:TODAY(),
    billToName:job.llName||job.clientName||'',
    billToAddress:job.llAddr||job.address||'',
    jobId:job.id,
    jobNum:job.jobNum||'',
    jobDate:job.date||'',
    jobAddress:job.address||'',
    propertyAddress:job.address||'',
    engineer:job.engineer||'',
    certTypes:job.certTypes||'',
    agentName:job.agentName||'',
    clientName:job.llName||job.clientName||'',
    clientEmail:job.llEmail||job.clientEmail||'',
    items:[{desc:job.description||job.certTypes||'Work',qty:1,unit:price,vat:true}],
    subtotal:price,
    vat:vat,
    total:price+vat,
    created:now,modified:now
  };
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(r?.[0]){toast('Proforma '+num+' created','success');renderInvList();return r[0];}
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Create disposable invoice (quick, minimal details, may be deleted)
async function createDisposableInv(clientName, amount, desc){
  const now=Date.now();
  const num=await nextInvNum(false);
  const vr=getVatRate();
  const price=Number(amount)||0;
  const vatAmt=price*vr/100;
  const body={
    type:'invoice',status:'Draft',number:num,
    date:TODAY(),dueDate:TODAY(),
    clientName:clientName||'TBC',billToName:clientName||'TBC',
    description:desc||'Disposable invoice',
    items:[{desc:desc||'Item',qty:1,unit:price,vat:vr>0}],
    // DO NOT send subtotal/vat/total — these are NOT database columns
    // They are computed from items[] on the fly
    disposable:true,created:now,modified:now
  };
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(r?.[0]){toast('Disposable invoice '+num+' created','success',3000);renderInvList();return r[0];}
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Open standalone Proforma modal
function openStandaloneProformaModal(){
  document.getElementById('pf-client').value='';
  document.getElementById('pf-desc').value='';
  document.getElementById('pf-amount').value='';
  document.getElementById('pf-due').value=TODAY();
  document.getElementById('pfx-notes').value='';
  openModal('mo-proforma');
}
// Save standalone Proforma from modal
async function saveStandaloneProforma(){
  const client=document.getElementById('pf-client').value.trim();
  const desc=document.getElementById('pf-desc').value.trim();
  const amount=parseFloat(document.getElementById('pf-amount').value)||0;
  const notes=document.getElementById('pfx-notes').value.trim();
  if(!client){toast('Enter client name','warn');return;}
  if(amount<=0){toast('Enter a valid amount','warn');return;}
  closeModal('mo-proforma');
  await createStandaloneProforma(client,desc,amount,notes);
}
// Open Disposable Invoice modal
function openDisposableModal(){
  document.getElementById('dp-client').value='';
  document.getElementById('dp-desc').value='';
  document.getElementById('dp-amount').value='';
  document.getElementById('dp-due').value=TODAY();
  openModal('mo-disposable');
}
// Save Disposable Invoice from modal
async function saveDisposableInvoice(){
  const client=document.getElementById('dp-client').value.trim();
  const desc=document.getElementById('dp-desc').value.trim();
  const amount=parseFloat(document.getElementById('dp-amount').value)||0;
  if(!client){toast('Enter client name','warn');return;}
  if(amount<=0){toast('Enter a valid amount','warn');return;}
  closeModal('mo-disposable');
  await createDisposableInv(client,amount,desc);
}

// Create standalone proforma (no job) — creates PR job after save
async function createStandaloneProforma(clientName,desc,price,notes){
  const now=Date.now();
  const num=await nextProformaNum();
  const body={
    type:'proforma',status:'Draft',number:num,
    date:TODAY(),dueDate:TODAY(),
    billToName:clientName||'',clientName:clientName||'',
    notes:notes||'',
    items:[{desc:desc||'Work',qty:1,unit:Number(price)||0,vat:true}],
    created:now,modified:now
  };
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(!r?.[0]){toast('Failed to create proforma','error');return;}
    const inv=r[0];
    // Auto-create a PR job linked to this proforma
    const prNum=await nextJobNum('PR');
    const jobBody={
      jobNum:prNum,status:'Pending',priority:'Normal',
      description:desc||'Work from proforma',
      address:'TBC',price:Number(price)||0,
      date:TODAY(),certTypes:'Proforma',modified:now,created:now
    };
    const jr=await _sb('jobs',{method:'POST',body:jobBody});
    if(jr?.[0]){
      // Link the proforma to the PR job
      await _sb('invoices?id=eq.'+inv.id,{method:'PATCH',body:{jobId:jr[0].id,jobNum:prNum,modified:now}});
      toast('Proforma '+num+' created + Job '+prNum+' added','success');
    }
    renderInvList();return inv;
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Convert proforma to real invoice
async function convertProformaToInvoice(proformaId){
  const inv=await dGet('invoices',proformaId);
  if(!inv){toast('Proforma not found','error');return;}
  if(inv.type!=='proforma'){toast('Not a proforma invoice','error');return;}
  const isAgency=inv.agentName?true:false;
  const realNum=await nextInvNum(isAgency);
  const now=Date.now();
  try{
    await _sb('invoices?id=eq.'+proformaId,{method:'PATCH',body:{type:'invoice',number:realNum,status:'Draft',proformaConverted:true,convertedAt:now,modified:now}});
    toast('Converted to '+realNum,'success');
    // Log in audit
    await _sb('invoice_audit',{method:'POST',body:{invoiceId:proformaId,action:'converted',from:'proforma',to:realNum,user:_appUser?.name||'System',timestamp:now}});
    viewInv(proformaId);
    renderInvList();
  }catch(e){toast('Conversion failed: '+e.message,'error');}
}

// Print proforma
function printProforma(id){
  window.print();
}

// ════════════════════════════════════════════════════════════════
//  JOB MODAL — 3-tab layout
// ════════════════════════════════════════════════════════════════
// switchJobTab is kept for backward compat but no longer needed (3-col layout)
function switchJobTab(tab){ /* no-op — layout is now always 3-col side-by-side */ }

// ── Notification settings — wire to actual logic ─────────────────────────────
async function saveNotifSettings(){
  S.notifyDash  = document.getElementById('s-notify-dash')?.checked !== false;
  S.notifyBadge = document.getElementById('s-notify-badge')?.checked !== false;
  S.slaDash     = document.getElementById('s-sla-dash')?.checked !== false;
  S.certWarnDays    = parseInt(document.getElementById('s-cert-warn')?.value)||30;
  S.certWarnDays2   = parseInt(document.getElementById('s-cert-warn2')?.value)||14;
  S.invReminderDays  = parseInt(document.getElementById('s-inv-reminder')?.value)||7;
  S.invReminderDays2 = parseInt(document.getElementById('s-inv-reminder2')?.value)||14;
  S.missingInvDays   = parseInt(document.getElementById('s-missing-inv-days')?.value)||3;
  S.jobRemindHrs     = parseInt(document.getElementById('s-job-remind-hrs')?.value)||24;
  const keys={notifyDash:S.notifyDash,notifyBadge:S.notifyBadge,slaDash:S.slaDash,
    certWarnDays:S.certWarnDays,certWarnDays2:S.certWarnDays2,
    invReminderDays:S.invReminderDays,invReminderDays2:S.invReminderDays2,
    missingInvDays:S.missingInvDays,jobRemindHrs:S.jobRemindHrs};
  for(const[k,v] of Object.entries(keys)) await saveSetting(k,v);
  document.querySelectorAll('.nbadge').forEach(b=>b.style.display=S.notifyBadge?'':'none');
}

async function renderNotifPreview(){
  const el=document.getElementById('notif-preview-body');
  if(!el) return;
  el.innerHTML='<div style="font-size:12px;color:var(--txt3)">Loading…</div>';
  const [certs,invs,jobs]=await Promise.all([dAll('certs'),dAll('invoices'),dAll('jobs')]);
  const today=TODAY();
  const warn1=S.certWarnDays||30;
  const overdueDays=S.invReminderDays||7;
  const missingDays=S.missingInvDays||3;
  const expiring=certs.filter(c=>{if(!c.expiryDate)return false;const d=Math.ceil((new Date(c.expiryDate)-new Date(today))/86400000);return d<=warn1&&d>0;});
  const expired=certs.filter(c=>c.expiryDate&&c.expiryDate<today);
  const overdueInvs=invs.filter(i=>i.status==='Awaiting Payment'&&i.dueDate&&i.dueDate<today&&Math.ceil((new Date(today)-new Date(i.dueDate))/86400000)>=overdueDays);
  const invoicedIds=new Set([...invs.map(i=>i.jobId),...invs.map(i=>i.linkedJobId)].filter(Boolean));
  const missingInvJobs=jobs.filter(j=>j.status===STATUS.COMPLETED&&!invoicedIds.has(j.id)&&j.date&&Math.ceil((new Date(today)-new Date(j.date))/86400000)>=missingDays);
  const row=(ico,lbl,n,col)=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><span>${ico}</span><span style="flex:1">${lbl}</span><span style="font-weight:800;color:${col};background:${col}18;padding:2px 8px;border-radius:5px;font-size:11px">${n}</span></div>`;
  el.innerHTML=row('📜','Certificates expired',expired.length,'#b91c1c')+row('⚠️',`Expiring within ${warn1} days`,expiring.length,'#d97706')+row('💰',`Invoices overdue ${overdueDays}+ days`,overdueInvs.length,'#b91c1c')+row('◎',`Missing invoices (${missingDays}+ days)`,missingInvJobs.length,'#f97316')+'<div style="font-size:10px;color:var(--txt3);margin-top:8px">Based on current data and your settings</div>';
}

// ── Engineer permissions ─────────────────────────────────────────────────────
async function saveEngDefaults(){
  const d={engSeePrice:!!document.getElementById('s-eng-see-price')?.checked,engSeeLandlord:document.getElementById('s-eng-see-landlord')?.checked!==false,engSeeTenant:document.getElementById('s-eng-see-tenant')?.checked!==false,engSeeAgent:document.getElementById('s-eng-see-agent')?.checked!==false,engSeeNotes:document.getElementById('s-eng-see-notes')?.checked!==false,engSeeInvoice:!!document.getElementById('s-eng-see-invoice')?.checked};
  Object.assign(S,d);
  for(const[k,v] of Object.entries(d)) await saveSetting(k,v);
  toast('Engineer defaults saved','success');
}

async function loadEngPerms(){
  const el=document.getElementById('eng-perms-list');
  if(!el) return;
  const engineers=(S.engineers||[]).filter(e=>e.name);
  if(!engineers.length){el.innerHTML='<div style="font-size:12px;color:var(--txt3)">No engineers found — add them in the Team tab first.</div>';return;}
  const perms=S.engPerms||{};
  const fields=[{key:'seePrice',label:'Price'},{key:'seeLandlord',label:'Landlord'},{key:'seeTenant',label:'Tenant'},{key:'seeAgent',label:'Agent'},{key:'seeNotes',label:'Notes'},{key:'seeInvoice',label:'Invoice'}];
  el.innerHTML=engineers.map(eng=>{
    // Key by _sbId (the real Supabase users.id) — not eng.id, which is never
    // actually set anywhere engineers get loaded/added, so every engineer's
    // overrides used to collide under the same undefined key.
    const engId=eng._sbId;
    const ep=perms[engId]||{};
    return`<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px"><div style="font-size:12px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px"><span style="width:26px;height:26px;border-radius:50%;background:var(--acc-soft);display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--acc)">${(eng.name||'?')[0].toUpperCase()}</span>${eng.name} <span style="font-size:10px;font-weight:400;color:var(--txt3)">${eng.trade||''}</span></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px 14px">${fields.map(f=>{const dflt=S['engSee'+f.key[3].toUpperCase()+f.key.slice(4)]!==false;const val=ep[f.key]!==undefined?ep[f.key]:dflt;return`<label class="fcheck" style="font-size:11px"><input type="checkbox" ${val?'checked':''} onchange="updateEngPerm('${engId}','${f.key}',this.checked)"> ${f.label}</label>`;}).join('')}</div></div>`;
  }).join('');
}

async function updateEngPerm(engId,field,val){
  if(!S.engPerms) S.engPerms={};
  if(!S.engPerms[engId]) S.engPerms[engId]={};
  S.engPerms[engId][field]=val;
  await saveSetting('engPerms',S.engPerms);
  toast('Permission updated','success',1500);
}

async function openJobModal(id){
  editJid=id||null;
  _editJobBaselineModified=null;
  _jobCertTypes=[];
  // Reset the multi-item-invoice price/description lock every open — this
  // must never carry over from whichever job was last edited in this modal.
  document.getElementById('jf-price').readOnly=false;
  document.getElementById('jf-price').style.background='';
  document.getElementById('jf-desc').readOnly=false;
  document.getElementById('jf-desc').style.background='';
  document.getElementById('jf-multiinv-note')?.remove();
  fillJobDropdowns();
  switchJobTab('details');
  const f=v=>document.getElementById(v);
  // Restore draft if exists (only for new jobs)
  if(!id){
    const draft=localStorage.getItem('df_job_draft');
    if(draft){try{const d=JSON.parse(draft);
      if(d['jf-addr'])f('jf-addr').value=d['jf-addr'];
      if(d['jf-ref'])f('jf-ref').value=d['jf-ref'];
      if(d['jf-desc'])f('jf-desc').value=d['jf-desc'];
      if(d['jf-time'])f('jf-time').value=d['jf-time'];
      if(d['jf-eng'])f('jf-eng').value=d['jf-eng'];
      if(d['jf-date'])f('jf-date').value=d['jf-date'];
      if(d['jf-access'])f('jf-access').value=d['jf-access'];
      if(d['jf-contact'])f('jf-contact').value=d['jf-contact'];
      if(d['jf-hours'])f('jf-hours').value=d['jf-hours'];
      if(d['jf-price'])f('jf-price').value=d['jf-price'];
      if(d['jf-priority'])f('jf-priority').value=d['jf-priority'];
      if(d['jf-status'])f('jf-status').value=d['jf-status'];
      if(d['jf-notes'])f('jf-notes').value=d['jf-notes'];
      if(d['jf-ll-name'])f('jf-ll-name').value=d['jf-ll-name'];
      if(d['jf-ll-phone'])f('jf-ll-phone').value=d['jf-ll-phone'];
      if(d['jf-ll-email'])f('jf-ll-email').value=d['jf-ll-email'];
      if(d['jf-ll-addr'])f('jf-ll-addr').value=d['jf-ll-addr'];
      if(d['jf-ll-wa'])f('jf-ll-wa').value=d['jf-ll-wa'];
      if(d['jf-agency'])f('jf-agency').value=d['jf-agency'];
      if(d['jf-agent'])f('jf-agent').value=d['jf-agent'];
    }catch(e){}}
    // Smart defaults
    const now=new Date();
    const hour=now.getHours();
    const tomorrow=new Date(now);tomorrow.setDate(tomorrow.getDate()+1);
    f('jf-date').value = hour>=16 ? tomorrow.toISOString().slice(0,10) : TODAY();
    f('jf-status').value='Pending';
    f('jf-priority').value='Normal';
    // Default time slot from settings
    f('jf-time').value=S.defTimeSlot||'9:00 AM – 5:00 PM';
  }
  // Show CR banner if pre-filled from portal request
  const crBanner=document.getElementById('mo-job-cr-banner');
  if(!id && window._pendingCRNum){
    document.getElementById('mo-job-title').textContent=`📋 New Job from Portal · ${window._pendingCRNum}`;
    if(crBanner) crBanner.style.display='flex';
    if(crBanner) crBanner.textContent=`🏠 Portal Request ${window._pendingCRNum} — this job number will be saved as ${window._pendingCRNum}`;
  } else {
    document.getElementById('mo-job-title').textContent=id?'✎ Edit Job':'+ New Job';
    if(crBanner) crBanner.style.display='none';
    // Hide all top ratings for new jobs
    const bar=document.getElementById('jm-ratings-bar');
    if(bar)bar.style.display='none';
    ['jm-rating-ll-wrap','jm-rating-ag-wrap','jm-rating-agent-wrap'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  }
  if(id){
    dGet('jobs',id).then(async j=>{
      if(!j)return;
      _editJobBaselineModified=j.modified||null;
      document.getElementById('mo-job-title').textContent=`✎ Edit Job ${j.jobNum?'· '+j.jobNum:''}`;
      f('jf-addr').value=j.address||'';f('jf-ref').value=j.referrer||'';
      f('jf-trade').value=j.trade||'';f('jf-eng').value=j.engineer||'';
      f('jf-date').value=j.date||jDate;
      f('jf-desc').value=j.description||'';setTimeout(()=>autoGrowById('jf-desc'),10);f('jf-time').value=j.timeSlot||'';
      f('jf-access').value=j.access||'';f('jf-contact').value=j.contact||'';
      f('jf-hours').value=j.hours||'';f('jf-price').value=getUserPerm('seePrice')?(j.price||''):'';
      f('jf-notes').value=j.notes||'';f('jf-status').value=j.status||'Pending';
      f('jf-priority').value=j.priority||'Normal';
      // If linked to a multi-item invoice, that invoice is the single source
      // of truth for amount/description — lock these two fields here so
      // there's exactly one place to change them, with no way to make the
      // job and invoice disagree by accident or on purpose (saveJob() also
      // enforces this server-side, this is the matching UI-side explanation).
      const _linkedInvsForLock=await dAll('invoices');
      const _linkedInvForLock=_linkedInvsForLock.find(i=>i.linkedJobId===j.id||i.jobId===j.id);
      if(_linkedInvForLock && (_linkedInvForLock.items||[]).length>1){
        const priceEl=f('jf-price'), descEl=f('jf-desc');
        priceEl.readOnly=true; priceEl.style.background='var(--s2)';
        descEl.readOnly=true; descEl.style.background='var(--s2)';
        const note=document.createElement('div');
        note.id='jf-multiinv-note';
        note.style.cssText='margin-top:6px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:11px;color:#1d4ed8;display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap';
        note.innerHTML=`<span>🔗 Linked to a multi-item invoice — amount and description are set there, not here.</span>
          <button type="button" class="btn btn-ghost btn-sm" onclick="closeModal('mo-job');openInvoiceForJob('${j.id}')">Open Invoice →</button>`;
        descEl.insertAdjacentElement('afterend', note);
      }
      // Restore cert chip selections
      renderCertChips(j.certTypes||[]);
      // Tab 2 — Landlord
      f('jf-ll-name').value=getUserPerm('seeLandlord')?(j.landlordName||j.referrer||''):'[Hidden]';
      f('jf-ll-phone').value=getUserPerm('seeLandlordPhone')?(j.landlordPhone||''):'[Hidden]';
      f('jf-ll-email').value=getUserPerm('seeLandlord')?(j.landlordEmail||''):'[Hidden]';
      f('jf-ll-addr').value=j.landlordAddr||'';
      f('jf-ll-wa').value=j.landlordWA||'';
      f('jf-ll-notes').value=j.landlordNotes||'';
      // Tab 3 — Agency
      f('jf-agency').value=j.agencyName||'';
      f('jf-agency-phone').value=j.agencyPhone||'';
      f('jf-agency-email').value=j.agencyEmail||'';
      f('jf-agent').value=j.agentName||'';
      f('jf-agent-phone').value=j.agentPhone||'';
      f('jf-agent-email').value=j.agentEmail||'';
      f('jf-agency-notes').value=j.agencyNotes||'';
      fillLandlordInfoBox(j);
      fillAgencyInfoBox(j);
      document.getElementById('btn-delete-job').style.display='';
      document.getElementById('btn-wa-this-job').style.display='';
      document.getElementById('btn-wa-ll').style.display=j.landlordWA?'':'none';
      openModal('mo-job');
      // Load photos/files uploaded by engineers
      loadJobAttachments(id);
    });
  } else {
    document.getElementById('mo-job-title').textContent='📋 New Job';
    ['jf-addr','jf-ref','jf-desc','jf-time','jf-contact','jf-hours','jf-price','jf-notes',
     'jf-ll-name','jf-ll-phone','jf-ll-email','jf-ll-addr','jf-ll-wa','jf-ll-notes',
     'jf-agency','jf-agency-phone','jf-agency-email','jf-agent','jf-agent-phone','jf-agent-email','jf-agency-notes'
    ].forEach(x=>f(x).value='');
    f('jf-date').value=jDate;f('jf-status').value='Pending';f('jf-priority').value='Normal';
    f('jf-trade').value='';f('jf-eng').value='';f('jf-access').value='';
    _jobCertTypes=[];
    renderCertChips([]);
    document.getElementById('btn-delete-job').style.display='none';
    document.getElementById('jm-photos-panel').style.display='none';
    document.getElementById('btn-wa-this-job').style.display='none';
    document.getElementById('btn-wa-ll').style.display='none';
    document.getElementById('jm-ll-info').classList.remove('visible');
    document.getElementById('jm-ag-info').classList.remove('visible');
    openModal('mo-job');
  }
}

function fillLandlordInfoBox(j){
  const box=document.getElementById('jm-ll-info');
  if(!box) return;
  const hasData=j.landlordName||j.landlordPhone||j.landlordEmail;
  box.classList.toggle('visible',!!hasData);
  if(hasData){
    const g=id=>document.getElementById(id);
    g('jmi-ll-name').textContent=j.landlordName||'—';
    g('jmi-ll-phone').textContent=j.landlordPhone||'—';
    g('jmi-ll-email').textContent=j.landlordEmail||'—';
    g('jmi-ll-addr').textContent=j.landlordAddr||'—';
    g('jmi-ll-wa').textContent=j.landlordWA||'—';
    // Show ratings at the TOP for landlord, agency, and agent
    const bar=document.getElementById('jm-ratings-bar');
    if(bar)bar.style.display='flex';
    if(j.landlordName){
      showClientCreditCheck(j.landlordName);
      const llWrap=document.getElementById('jm-rating-ll-wrap');
      if(llWrap)llWrap.style.display='block';
      _renderRatingStrip('jm-rating-ll', j.landlordName);
    }
    if(j.agencyName){
      const agWrap=document.getElementById('jm-rating-ag-wrap');
      if(agWrap)agWrap.style.display='block';
      _renderRatingStrip('jm-rating-ag', j.agencyName);
    }
    if(j.agentName){
      const agentWrap=document.getElementById('jm-rating-agent-wrap');
      if(agentWrap)agentWrap.style.display='block';
      _renderRatingStrip('jm-rating-agent', j.agentName);
    }
  } else {
    // Hide credit check if no landlord
    const creditPanel = document.getElementById('credit-check-panel');
    if(creditPanel) creditPanel.style.display = 'none';
  }
}

function fillAgencyInfoBox(j){
  const box=document.getElementById('jm-ag-info');
  if(!box) return;
  const hasData=j.agencyName||j.agentName;
  box.classList.toggle('visible',!!hasData);
  if(hasData){
    const g=id=>document.getElementById(id);
    g('jmi-ag-name').textContent=j.agencyName||'—';
    g('jmi-agent-name').textContent=j.agentName||'—';
    g('jmi-agent-phone').textContent=j.agentPhone||'—';
    g('jmi-agent-email').textContent=j.agentEmail||'—';
  }
}

function fillJobDropdowns(){
  const ts=document.getElementById('jf-trade');
  const cv=ts?ts.value:'';
  if(ts) ts.innerHTML='<option value="">— Trade —</option>'+(S.trades||[]).map(t=>`<option ${t.name===cv?'selected':''}>${t.name}</option>`).join('');
  const es=document.getElementById('jf-eng');
  const ce=es.value;
  es.innerHTML='<option value="">— Engineer —</option>'+(S.engineers||[]).map(e=>`<option ${e.name===ce?'selected':''}>${e.name}</option>`).join('');
  const as=document.getElementById('jf-access');
  const ca=as.value;
  as.innerHTML='<option value="">— Access —</option>'+(S.access||[]).map(a=>`<option ${a===ca?'selected':''}>${a}</option>`).join('');
  renderCertChips();
}

// Selected cert types for current job (array of cert type IDs)


function renderCertChips(preSelected){
  if(preSelected!==undefined) _jobCertTypes=[...preSelected];
  const container=document.getElementById('jf-cert-chips');
  if(!container)return;
  const types=S.certTypes||[];
  container.innerHTML=types.map(ct=>{
    const sel=_jobCertTypes.includes(ct.id||ct.name);
    return`<div class="cert-chip ${sel?'cert-chip-sel':''}" onclick="toggleCertChip('${ct.id||ct.name}')"
      style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;border:2px solid ${sel?ct.color||'var(--acc)':'var(--border)'};background:${sel?`${ct.color||'#f5a623'}22`:'var(--s1)'};color:${sel?ct.color||'var(--acc)':'var(--txt2)'};transition:all .15s;user-select:none">
      ${sel?'✓ ':''}${ct.name}
    </div>`;
  }).join('');
  if(!types.length) container.innerHTML='<span style="font-size:12px;color:var(--txt3)">No cert types in settings. Click + New Type to add.</span>';
}

function toggleCertChip(id){
  const idx=_jobCertTypes.indexOf(id);
  if(idx>=0) _jobCertTypes.splice(idx,1);
  else _jobCertTypes.push(id);
  renderCertChips();
}

function autoDetectCertTypes(desc){
  const dl=desc.toLowerCase();
  const types=S.certTypes||[];
  const autoIds=[];
  types.forEach(ct=>{
    const kws=ct.keywords||[];
    if(kws.some(kw=>dl.includes(kw.toLowerCase()))) autoIds.push(ct.id||ct.name);
  });
  if(autoIds.length){
    // Merge auto-detected into current selection
    autoIds.forEach(id=>{ if(!_jobCertTypes.includes(id)) _jobCertTypes.push(id); });
    renderCertChips();
  }
}

function addCertTypeInline(){
  const name=prompt('New certificate type name:');
  if(!name||!name.trim())return;
  const n=name.trim();
  if((S.certTypes||[]).some(ct=>ct.name===n)){toast('Already exists','warn');return;}
  const newCt={id:uid(),name:n,validity:12,reminder:30,keywords:[n.toLowerCase()],color:'#f5a623',prefix:n.slice(0,3).toUpperCase()+'-'};
  S.certTypes=[...(S.certTypes||[]),newCt];
  saveSetting('certTypes',S.certTypes);
  _jobCertTypes.push(newCt.id);
  renderCertChips();
  toast(`"${n}" added to cert types`,'success');
}


function handleAccess(sel){
  const v=sel.value;
  const lbl=document.getElementById('jf-contact-lbl');
  if(v==='Key Safe'){
    lbl.textContent='Key Safe Code & Location';
    openModal('mo-ks');
    document.getElementById('ks-code').value='';document.getElementById('ks-loc').value='';
  } else if(v.includes('Landlord')||v.includes('Tenant')){
    lbl.textContent='Phone Number';
    document.getElementById('jf-contact').placeholder='Contact phone number';
  } else {
    lbl.textContent='Contact / Code';
    document.getElementById('jf-contact').placeholder='';
  }
}

function confirmKS(){
  const c=document.getElementById('ks-code').value;
  const l=document.getElementById('ks-loc').value;
  document.getElementById('jf-contact').value=`Code: ${c}${l?' | '+l:''}`;
  closeModal('mo-ks');
}

function clearJobForm(){
  // Clear ALL form fields
  const fields=['jf-addr','jf-ref','jf-desc','jf-time','jf-eng','jf-access','jf-contact','jf-hours','jf-price','jf-priority','jf-status','jf-notes','jf-ll-name','jf-ll-phone','jf-ll-email','jf-ll-addr','jf-ll-wa','jf-ll-notes','jf-agency','jf-agency-phone','jf-agency-email','jf-agent','jf-agent-phone','jf-agent-email','jf-agency-notes'];
  fields.forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  // Reset job date to today, engineer to default
  document.getElementById('jf-date').value=TODAY();
  document.getElementById('jf-eng').value='';
  // Reset cert chips
  _jobCertTypes=[];renderCertChips();
  // Reset title
  document.getElementById('mo-job-title').textContent='+ New Job';
  // Hide CR banner
  const crBanner=document.getElementById('mo-job-cr-banner');
  if(crBanner)crBanner.style.display='none';
  // Hide delete + WhatsApp buttons
  document.getElementById('btn-delete-job').style.display='none';
  document.getElementById('btn-wa-this-job').style.display='none';
  // Clear edit state
  editJid=null;
  // Hide ALL rating panels and clear their HTML
  const bar=document.getElementById('jm-ratings-bar');
  if(bar)bar.style.display='none';
  ['jm-rating-ll-wrap','jm-rating-ag-wrap','jm-rating-agent-wrap'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
  document.getElementById('jm-rating-ll').innerHTML='';
  document.getElementById('jm-rating-ag').innerHTML='';
  document.getElementById('jm-rating-agent').innerHTML='';
  // Hide landlord info box
  const box=document.getElementById('jm-ll-info');
  if(box)box.classList.remove('visible');
  // Hide agency info box
  const agBox=document.getElementById('jm-ag-info');
  if(agBox)agBox.classList.remove('visible');
  toast('Form cleared — ready for new job','info',2000);
}

// UK postcode, pulled out of whatever's typed in the address field — kept
// in its own column purely as background data for other features (routing,
// area grouping, more accurate property matching) to use later. The
// visible address field itself is completely untouched.
function extractPostcode(address){
  if(!address) return '';
  const m=String(address).match(/([A-Za-z]{1,2}[0-9][0-9A-Za-z]?\s*[0-9][A-Za-z]{2})\s*$/);
  return m ? m[1].toUpperCase().replace(/\s+/g,' ').trim() : '';
}

async function saveJob(){
  const addr=document.getElementById('jf-addr').value.trim();
  if(!addr){toast('Address is required','error');return;}
  const desc=document.getElementById('jf-desc').value.trim();
  autoDetectCertTypes(desc);
  let tradeVal=document.getElementById('jf-trade').value||'';
  if(!tradeVal&&_jobCertTypes.length){
    const ct=(S.certTypes||[]).find(c=>(c.id||c.name)===_jobCertTypes[0]);
    if(ct) tradeVal=ct.name;
  }
  const isNew=!editJid;
  const existingJob=editJid?await dGet('jobs',editJid):null;
  // If this job is linked to a multi-item invoice, the invoice is the single
  // source of truth for price/description (openJobModal locks these fields
  // in the UI for the same reason) — ignore whatever the form holds for them
  // here too, so the lock can't be bypassed by a stale form or a bug.
  let _lockedByMultiItemInv=false;
  if(existingJob){
    const _linkedInvs=await dAll('invoices');
    const _linkedInv=_linkedInvs.find(i=>i.linkedJobId===existingJob.id||i.jobId===existingJob.id);
    if(_linkedInv && (_linkedInv.items||[]).length>1) _lockedByMultiItemInv=true;
  }
  // Concurrent-edit guard: if someone else saved a change to this job after
  // this form was opened, the freshly-fetched `modified` timestamp here will
  // no longer match what we captured at open time. Ask before overwriting
  // their change instead of silently clobbering it.
  if(!isNew && existingJob && _editJobBaselineModified!=null && existingJob.modified && existingJob.modified!==_editJobBaselineModified){
    const proceed=confirm('⚠️ This job was changed by someone else while you were editing it (status or other details may be different now).\n\nClick OK to save your changes anyway (overwriting theirs), or Cancel to stop and reload the latest version.');
    if(!proceed){
      const btn0=document.querySelector('#mo-job .modal-actions .btn-acc');
      if(btn0){btn0.disabled=false;btn0.textContent='Save Job';}
      toast('Reloading latest version…','info');
      openJobModal(editJid);
      return;
    }
  }
  // Use CR number if pre-set from portal request, otherwise generate next job number
  const jobNum=existingJob?.jobNum||(window._pendingCRNum||(isNew?await nextJobNum():''));
  window._pendingCRNum=null; // clear after use
  const j={
    id:editJid||uid(),
    jobNum,
    date:document.getElementById('jf-date').value||jDate,
    address:addr,
    postcode:extractPostcode(addr),
    referrer:document.getElementById('jf-ref').value.trim(),
    trade:tradeVal,
    certTypes:[..._jobCertTypes],
    engineer:document.getElementById('jf-eng').value,
    description:_lockedByMultiItemInv?(existingJob.description||''):desc,
    timeSlot:document.getElementById('jf-time').value.trim(),
    access:document.getElementById('jf-access').value,
    contact:document.getElementById('jf-contact').value.trim(),
    hours:parseFloat(document.getElementById('jf-hours').value)||0,
    // seePrice/seeLandlord/seeLandlordPhone gate what the form DISPLAYS
    // (see openJobModal: hidden fields show '' / '[Hidden]' placeholders).
    // A user without that permission must never have those placeholders
    // written back over the real stored value on save.
    price:_lockedByMultiItemInv?(existingJob.price||0):(getUserPerm('seePrice')?(parseFloat(document.getElementById('jf-price').value)||0):(existingJob?.price??0)),
    notes:document.getElementById('jf-notes').value.trim(),
    priority:document.getElementById('jf-priority').value,
    status:document.getElementById('jf-status').value,
    landlordName:getUserPerm('seeLandlord')?document.getElementById('jf-ll-name').value.trim():(existingJob?.landlordName||''),
    landlordPhone:getUserPerm('seeLandlordPhone')?document.getElementById('jf-ll-phone').value.trim():(existingJob?.landlordPhone||''),
    landlordEmail:getUserPerm('seeLandlord')?document.getElementById('jf-ll-email').value.trim():(existingJob?.landlordEmail||''),
    landlordAddr:document.getElementById('jf-ll-addr').value.trim(),
    landlordWA:document.getElementById('jf-ll-wa').value.trim(),
    landlordNotes:document.getElementById('jf-ll-notes').value.trim(),
    agencyName:document.getElementById('jf-agency').value.trim(),
    agencyPhone:document.getElementById('jf-agency-phone').value.trim(),
    agencyEmail:document.getElementById('jf-agency-email').value.trim(),
    agentName:document.getElementById('jf-agent').value.trim(),
    agentPhone:document.getElementById('jf-agent-phone').value.trim(),
    agentEmail:document.getElementById('jf-agent-email').value.trim(),
    agencyNotes:document.getElementById('jf-agency-notes').value.trim(),
    created:existingJob?.created||Date.now(),
    modified:Date.now(),
  };
  const btn=document.querySelector('#mo-job .modal-actions .btn-acc');
  if(btn){btn.disabled=true;btn.textContent='Saving...';}
  try{
    await dPut('jobs',j);
    _invalidateJobCache();
    if(existingJob&&existingJob.status!==j.status){
      logAudit('job_status_change',{jobId:j.id,jobNum:j.jobNum,address:j.address,oldStatus:existingJob.status,newStatus:j.status});
      logStatusRevertIfNeeded({jobId:j.id,jobNum:j.jobNum,address:j.address,oldStatus:existingJob.status,newStatus:j.status,staffName:_appUser?.name||''});
      const notifPayload={jobId:j.id,jobNum:j.jobNum,address:j.address,oldStatus:existingJob.status,newStatus:j.status,
        landlordName:j.landlordName||j.referrer||'',landlordPhone:j.landlordPhone||'',landlordEmail:j.landlordEmail||'',
        agencyName:j.agencyName||'',agentName:j.agentName||'',agentPhone:j.agentPhone||''};
      sendNotificationWebhook('job_status_change',notifPayload);
      sendPushNotification('job_status_change',notifPayload);
      if(j.status===STATUS.COMPLETED) notifyNextTenantEta(j);
    }

    // ── REVERSE SYNC: Job → Invoice ──────────────────────────────
    // Find linked invoice and update description/address/status
    await _syncJobToInvoice(j);

    // AUTO-SAVE to directories: if landlord/agency/agent details were filled in
    // and the name doesn't already exist in the database, save them automatically.
    // This runs in the background — job is already saved, this is bonus housekeeping.
    (async()=>{
      try{
        // Auto-save landlord
        const llName=j.landlordName;
        if(llName){
          const persons=await dAll('persons');
          const exists=persons.find(p=>p.name.toLowerCase()===llName.toLowerCase());
          if(!exists){
            await dPut('persons',{id:uid(),name:llName,phone:j.landlordPhone||'',
              email:j.landlordEmail||'',address:j.landlordAddr||'',
              wa:j.landlordWA||'',notes:j.landlordNotes||'',
              roles:['landlord'],created:Date.now()});
            console.info('[DeepFlow] Auto-saved new landlord:',llName);
          }
        }
        // Auto-save agency
        const agencyName=j.agencyName;
        if(agencyName){
          const agencies=await dAll('agencies');
          const exists=agencies.find(a=>a.name.toLowerCase()===agencyName.toLowerCase());
          if(!exists){
            await dPut('agencies',{id:uid(),name:agencyName,phone:j.agencyPhone||'',
              email:j.agencyEmail||'',notes:j.agencyNotes||'',created:Date.now()});
            console.info('[DeepFlow] Auto-saved new agency:',agencyName);
          }
        }
        // Auto-save agent
        const agentName=j.agentName;
        if(agentName){
          const agents=await dAll('agents');
          const exists=agents.find(a=>a.name.toLowerCase()===agentName.toLowerCase());
          if(!exists){
            // Find agency id if agency was also saved
            const agencies2=await dAll('agencies');
            const agency2=agencies2.find(a=>a.name.toLowerCase()===(agencyName||'').toLowerCase());
            await dPut('agents',{id:uid(),name:agentName,phone:j.agentPhone||'',
              email:j.agentEmail||'',agencyId:agency2?.id||'',created:Date.now()});
            console.info('[DeepFlow] Auto-saved new agent:',agentName);
          }
        }
      }catch(e){ console.warn('[DeepFlow] Auto-save directory entry failed',e); }
    })();

    if(j.status===STATUS.COMPLETED&&existingJob?.status!==STATUS.COMPLETED) onJobComplete(j);
    try{await logActivity((isNew?'Created':'Updated')+' job: '+j.address+' ('+jobNum+')','job');}catch(_){ /* intentional no-op */ }
    closeModal('mo-job');closeAddrDrop();closeAllAutofillDrops();
    localStorage.removeItem('df_job_draft');
    _renderJobsKeepScroll();updateBadges();
    toast((isNew?'Job saved · ':'Job updated · ')+jobNum,'success');
  }catch(err){
    console.error('saveJob error:',err);
    let msg=err.message||'Unknown error';
    try{const e=JSON.parse(msg);msg=e.message||e.details||msg;}catch(_){ /* intentional no-op */ }
    toast('Save failed: '+msg.slice(0,100),'error',7000);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Save Job';}
  }
}

async function loadJobAttachments(jobId){
  const panel=document.getElementById('jm-photos-panel');
  const grid=document.getElementById('jm-photos-grid');
  const countEl=document.getElementById('jm-photos-count');
  if(!panel||!grid) return;
  panel.style.display='';
  grid.innerHTML='<div style="color:var(--txt3);font-size:12px;padding:16px 0">Loading…</div>';
  try{
    const atts=await _sb('attachments?jobid=eq.'+encodeURIComponent(jobId)+'&order=created.asc');
    if(!atts||!atts.length){
      panel.style.display='none'; // hide panel if no attachments
      return;
    }
    countEl.textContent='('+atts.length+')';
    const photos=atts.filter(a=>a.type==='photo'||a.mime?.startsWith('image/'));
    const docs=atts.filter(a=>a.type!=='photo'&&!a.mime?.startsWith('image/'));
    let html='';
    photos.forEach(a=>{
      html+=`<div style="position:relative;border-radius:8px;overflow:hidden;background:var(--s2);aspect-ratio:1;cursor:pointer" title="${a.name}">
        <img src="${a.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy" onclick="window.open('${a.url}','_blank')" onerror="this.parentElement.innerHTML='<div style=&quot;display:flex;align-items:center;justify-content:center;height:100%;color:var(--txt3);font-size:24px&quot;>🖼️</div>'">
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.5);color:#fff;font-size:9px;padding:3px 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${a.uploaded_by_name||'Engineer'}</div>
        <button onclick="event.stopPropagation();deleteAttachment('${a.id}','${a.storage_path||''}')" style="position:absolute;top:4px;right:4px;background:rgba(220,38,38,.85);border:none;border-radius:50%;width:22px;height:22px;color:#fff;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding:0" title="Delete photo">✕</button>
      </div>`;
    });
    docs.forEach(a=>{
      html+=`<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px;display:flex;align-items:center;gap:8px;cursor:pointer;grid-column:span 2" onclick="window.open('${a.url}','_blank')">
        <span style="font-size:24px">📄</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.name}</div>
          <div style="font-size:10px;color:var(--txt3)">${a.uploaded_by_name||'Engineer'} · <span style="color:var(--acc)">Open PDF</span></div>
        </div>
      </div>`;
    });
    grid.innerHTML=html||'<div style="color:var(--txt3);font-size:12px">No files yet</div>';
  }catch(err){
    console.error('loadJobAttachments:',err);
    grid.innerHTML='<div style="color:var(--txt3);font-size:12px">Could not load files</div>';
  }
}

async function deleteAttachment(attId, storagePath){
  if(!confirm('Delete this photo?')) return;
  try{
    // Delete from storage if path exists
    if(storagePath){
      await fetch(`${SB_URL}/storage/v1/object/deepflow/${storagePath}`,{
        method:'DELETE',
        headers:{'apikey':SB_KEY,'Authorization':'Bearer '+(await _getJWT())}
      }).catch(()=>{});
    }
    // Delete from attachments table
    await _sb(`attachments?id=eq.${attId}`,{method:'DELETE'});
    toast('Photo deleted','success',2000);
    // Reload photos for current job
    if(editJid) loadJobAttachments(editJid);
  }catch(e){ toast('Delete failed: '+e.message,'error'); }
}

// The modal's delete button used to duplicate deleteJobById's logic without
// the audit-log write, so a job deleted from the modal left no audit trail
// entry while the exact same action from the row context menu did — now
// there's exactly one delete implementation for both entry points.
async function deleteCurrentJob(){
  if(!editJid) return;
  await deleteJobById(editJid);
}

// ── Fuzzy Address Search ──
async function initProps(){allProps=S.properties||[]}

function fuzzyScore(q,h){
  q=q.toLowerCase();h=h.toLowerCase();
  if(h.includes(q))return 1;
  let s=0,j=0;
  for(let i=0;i<q.length&&j<h.length;i++){
    while(j<h.length&&h[j]!==q[i])j++;
    if(j<h.length){s++;j++}
  }
  return s/Math.max(q.length,1);
}
function hlMatch(t,q){
  const tl=t.toLowerCase(),ql=q.toLowerCase(),i=tl.indexOf(ql);
  if(i===-1)return t;
  return t.slice(0,i)+`<span class="fmatch">${t.slice(i,i+q.length)}</span>`+t.slice(i+q.length);
}

function fuzzyAddr(inp){
  const q=inp.value.trim();
  const dd=document.getElementById('addr-drop');
  if(q.length<2){closeAddrDrop();return}
  const res=allProps.map(p=>({p,s:fuzzyScore(q,p.address)})).filter(r=>r.s>0.25).sort((a,b)=>b.s-a.s).slice(0,7);
  if(!res.length){closeAddrDrop();return}
  dd.innerHTML=res.map(r=>`
    <div class="fdi" onclick="selectAddr('${r.p.id}')">
      <span>${hlMatch(r.p.address,q)}</span>
      <span class="fmeta">${r.p.landlord||''} · ${Math.round(r.s*100)}%</span>
    </div>`).join('');
  const rect=inp.getBoundingClientRect();
  dd.style.cssText=`display:block;top:${rect.bottom+window.scrollY+4}px;left:${rect.left}px;width:${Math.max(rect.width,300)}px`;
}

async function selectAddr(pid){
  const p=allProps.find(x=>x.id===pid);
  if(!p)return;
  document.getElementById('jf-addr').value=p.address;
  document.getElementById('jf-ref').value=p.landlord||'';
  closeAddrDrop();
  // Auto-fill landlord details from directories
  if(p.landlord){
    await autoFillLandlordByName(p.landlord);
  }
  toast(`Auto-filled: ${p.landlord||p.address}`,'success');
}
function closeAddrDrop(){const d=document.getElementById('addr-drop');if(d)d.style.display='none'}
document.addEventListener('click',e=>{if(!e.target.closest('#addr-drop')&&!e.target.closest('#jf-addr'))closeAddrDrop()});

// ════════════════════════════════════════════════════════════════
//  SMART AUTOFILL SYSTEM
// ════════════════════════════════════════════════════════════════

function closeAllAutofillDrops(){
  ['ref-drop','ll-drop','ll-phone-drop','ll-email-drop','agency-drop','agent-drop','agent-phone-drop','agent-email-drop'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.style.display='none';
  });
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.autofill-drop')&&!e.target.closest('.fi')) closeAllAutofillDrops();
});

// Registry maps dropId → {items, onSelect} so onclick doesn't need serialised functions
const _autofillRegistry={};

function showAutofillDrop(dropId, items, onSelect){
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

async function smartAutofill(type, val, context){
  if(!val||val.length<2){closeAllAutofillDrops();return}
  const ql=val.toLowerCase();
  const persons=await dAll('persons');
  const agencies=await dAll('agencies');
  const agents=await dAll('agents');

  if(type==='ref' || type==='landlord'){
    // Search landlords and clients by name
    const matches=persons.filter(p=>(p.roles||[]).some(r=>['landlord','client'].includes(r))&&p.name.toLowerCase().includes(ql)).slice(0,6);
    const items=matches.map(p=>({
      label:p.name,
      sub:(p.phone?'📞 '+p.phone:'')+(p.email?' · '+p.email:'')+(p.roles?.includes('landlord')?' [Landlord]':''),
      pid:p.id,name:p.name,phone:p.phone,email:p.email,wa:p.wa,address:p.address,notes:p.notes
    }));
    const dropId=type==='ref'?'ref-drop':'ll-drop';
    showAutofillDrop(dropId, items, function(item){
      fillLandlordFields(item);
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
  else if(type==='agent'){
    const matches=agents.filter(ag=>ag.name.toLowerCase().includes(ql)).slice(0,6);
    const items=await Promise.all(matches.map(async ag=>{
      const agency=agencies.find(a=>a.id===ag.agencyId);
      return{label:ag.name,sub:(agency?'🏢 '+agency.name:'')+(ag.phone?' · 📞 '+ag.phone:''),agid:ag.id,name:ag.name,phone:ag.phone,email:ag.email,wa:ag.wa,agencyId:ag.agencyId,agencyName:agency?.name||'',agencyPhone:agency?.phone||'',agencyEmail:agency?.email||''};
    }));
    showAutofillDrop('agent-drop',items,function(item){
      document.getElementById('jf-agent').value=item.name;
      document.getElementById('jf-agent-phone').value=item.phone||'';
      document.getElementById('jf-agent-email').value=item.email||'';
      // Show agent rating at top
      const bar=document.getElementById('jm-ratings-bar');
      const agentWrap=document.getElementById('jm-rating-agent-wrap');
      if(bar)bar.style.display='flex';
      if(agentWrap)agentWrap.style.display='block';
      _renderRatingStrip('jm-rating-agent', item.name);
      // Also fill agency if empty
      if(!document.getElementById('jf-agency').value&&item.agencyName){
        document.getElementById('jf-agency').value=item.agencyName;
        document.getElementById('jf-agency-phone').value=item.agencyPhone||'';
        document.getElementById('jf-agency-email').value=item.agencyEmail||'';
        // Also show agency rating
        const agWrap=document.getElementById('jm-rating-ag-wrap');
        if(agWrap)agWrap.style.display='block';
        _renderRatingStrip('jm-rating-ag', item.agencyName);
      }
      closeAllAutofillDrops();
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

// ── CLIENT STAR RATING — reusable across the whole app ──────────────────────
async function _calcClientStars(clientName){
  if(!clientName) return null;
  const nl=clientName.toLowerCase();
  const [allInvs]=await Promise.all([dAll('invoices')]);
  const invs=allInvs.filter(i=>(i.clientName||i.billToName||'').toLowerCase()===nl||(i.landlordName||'').toLowerCase()===nl||(i.agencyName||'').toLowerCase()===nl);
  if(!invs.length) return null;
  const now=new Date();
  const unpaid=invs.filter(i=>i.status!=='Paid'&&i.status!==STATUS.CANCELLED);
  const overdue=unpaid.filter(i=>i.dueDate&&new Date(i.dueDate)<now);
  const paid=invs.filter(i=>i.status==='Paid');
  const veryOverdue=overdue.filter(i=>Math.floor((now-new Date(i.dueDate))/86400000)>60);
  let stars=5;
  if(veryOverdue.length>3) stars-=3; else if(veryOverdue.length>0) stars-=2;
  else if(overdue.length>3) stars-=2; else if(overdue.length>0) stars-=1;
  const avg=invs.length>0?invs.reduce((s,i)=>s+calcInvTotal(i).grand,0)/invs.length:0;
  const unpaidAmt=unpaid.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  if(unpaidAmt>avg*5) stars-=2; else if(unpaidAmt>avg*3) stars-=1;
  if(paid.length>unpaid.length&&paid.length>3) stars+=1;
  stars=Math.max(1,Math.min(5,stars));
  const C={1:'#e05252',2:'#f59e0b',3:'#f0c030',4:'#a3e635',5:'#25d58e'};
  return{stars,color:C[stars],risk:stars<=2?'HIGH RISK':stars===3?'MEDIUM RISK':'LOW RISK',invCount:invs.length,paid:paid.length,overdue:overdue.length,unpaidAmt};
}

function _starsHtml(stars,color,risk,compact=false){
  let h='';const c=color||'#94a3b8';
  for(let i=1;i<=5;i++) h+=i<=stars?`<span style="color:${c}">★</span>`:'<span style="color:#d1d5db">☆</span>';
  return compact?`<span style="font-size:14px;letter-spacing:1px">${h}</span>`
    :`<span style="font-size:14px;letter-spacing:1px">${h}</span><span style="font-size:10px;font-weight:700;color:${c};margin-left:5px">${stars}/5 — ${risk}</span>`;
}

export async function _renderRatingStrip(containerId,clientName){
  const el=document.getElementById(containerId);
  if(!el||!clientName)return;
  el.innerHTML=`<div style="font-size:10px;color:var(--txt3);padding:6px 0">⏳ Loading…</div>`;
  try{
    const r=await _calcClientStars(clientName);
    if(!r){el.innerHTML=`<div style="font-size:10px;color:var(--txt3);padding:6px 0">No invoice history</div>`;return;}
    el.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;border:1.5px solid ${r.color}50;background:${r.color}09;${r.stars<=2?`border-left:3px solid ${r.color};`:''}">
        <div>
          <div>${_starsHtml(r.stars,r.color,r.risk)}</div>
          ${r.overdue>0?`<div style="font-size:10px;color:var(--red);margin-top:3px">⚠ ${r.overdue} overdue · £${r.unpaidAmt.toFixed(0)} unpaid</div>`:r.stars>=4?`<div style="font-size:10px;color:var(--green);margin-top:3px">✓ Good payment record</div>`:''}
        </div>
        <div style="font-size:10px;color:var(--txt3);text-align:right;flex-shrink:0;margin-left:8px">${r.invCount} inv<br>${r.paid} paid</div>
      </div>`;
  }catch(e){el.innerHTML='';}
}

function fillLandlordFields(p){
  // Fill referrer field
  const refEl=document.getElementById('jf-ref');
  if(refEl&&!refEl.value) refEl.value=p.name||'';
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

async function autoFillLandlordByName(name){
  const persons=await dAll('persons');
  const p=persons.find(x=>x.name.toLowerCase()===name.toLowerCase()&&(x.roles||[]).includes('landlord'));
  if(p) fillLandlordFields(p);
}

// ════════════════════════════════════════════════════════════════
//  DUPLICATE PHONE DETECTION
// ════════════════════════════════════════════════════════════════

async function checkDuplicatePhone(val, context){
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

function showDupPopup({existingName, existingPhone, newName, context, existingId}){
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

async function dupUseExisting(id, context){
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

async function dupUpdateName(id, context){
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

// Save landlord from job — saves even without a name (uses phone as identifier)
async function saveLandlordFromJob(){
  const name = document.getElementById('jf-ll-name').value.trim();
  const phone = document.getElementById('jf-ll-phone').value.trim();
  const email = document.getElementById('jf-ll-email').value.trim();

  // Must have at least phone or name
  if(!name && !phone){toast('Enter at least a phone number or name','warn');return}

  // Display name: use name if available, otherwise use phone
  const displayName = name || phone;

  const persons = await dAll('persons');
  // Match by name first, then by phone
  let existing = name ? persons.find(p=>p.name.toLowerCase()===name.toLowerCase()) : null;
  if(!existing && phone) existing = persons.find(p=>p.phone&&p.phone.replace(/\s/g,'')===phone.replace(/\s/g,''));

  if(existing){
    if(name && existing.name !== name) existing.name = name; // update name if provided
    existing.phone = phone || existing.phone;
    existing.email = email || existing.email;
    existing.address = document.getElementById('jf-ll-addr').value.trim() || existing.address;
    existing.wa = document.getElementById('jf-ll-wa').value.trim() || existing.wa;
    existing.notes = document.getElementById('jf-ll-notes').value.trim() || existing.notes;
    if(!(existing.roles||[]).includes('landlord')) existing.roles=[...(existing.roles||[]),'landlord'];
    await dPut('persons', existing);
    toast('Landlord updated in directories','success');
  } else {
    const p = {id:uid(), name:displayName,
      phone, email,
      address: document.getElementById('jf-ll-addr').value.trim(),
      wa: document.getElementById('jf-ll-wa').value.trim(),
      notes: document.getElementById('jf-ll-notes').value.trim(),
      roles:['landlord'], created:Date.now()};
    await dPut('persons', p);
    toast(`Landlord saved${!name?' (phone as name)':''}`,'success');
  }
}

// Save agency from job tab 3
async function saveAgencyFromJob(){
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
async function saveAgentFromJob(){
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
async function sendLandlordWA(){
  const name=document.getElementById('jf-ll-name').value.trim();
  const wa=document.getElementById('jf-ll-wa').value.trim();
  const addr=document.getElementById('jf-addr').value.trim();
  if(!wa){toast('No WhatsApp number for landlord','warn');return}
  const msg=`Hello *${name}*,\n\nThis is ${S.coName||'us'}.\n\nRegarding: ${addr}\n\nKind regards.`;
  sendToWA(wa,msg);
}


// ════════════════════════════════════════════════════════════════
//  WHATSAPP — JOB DISPATCH
// ════════════════════════════════════════════════════════════════
function buildJobWAMsg(jobs, engName){
  const tpl = S.waJobTpl || '';
  const jobLines = jobs.map((j,i)=>{
    const num = i+1;
    const ordinals=['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'];
    const ord = ordinals[i]||`${num}th`;
    // FIX 20: Access code and contact person are now on separate labelled lines.
    // Previously merged as "🔑 access · contact" which was ambiguous.
    const accessPart = j.access ? `\n🔑 *Access:* ${j.access}` : '';
    const contactPart = j.contact ? `\n👤 *Contact:* ${j.contact}` : '';
    return `*${ord} Job — ${j.timeSlot||'Time TBC'}*\n📍 *Address:* ${j.address}\n👤 *Referrer:* ${j.referrer||'—'}\n🔧 *Work:* ${j.description||'—'}${accessPart}${contactPart}\n📝 *Notes:* ${j.notes||'—'}`;
  }).join('\n\n─────────────────\n\n');

  if(tpl.includes('{jobs_list}')){
    return tpl
      .replace('{company_name}', S.coName||'Your Company')
      .replace('{engineer_name}', engName)
      .replace('{jobs_list}', jobLines);
  }
  return `*${S.coName||'Job Dispatch'}* 📋\n\nHi *${engName}*, here are your jobs for today:\n\n${jobLines}\n\n✅ Please confirm receipt.`;
}

async function showWaPanel(){
  const panel=document.getElementById('wa-panel');
  const btn=document.getElementById('btn-wa-panel');
  if(panel.style.display!=='none'){panel.style.display='none';if(btn)btn.textContent='📱 Send to Engineer';return}
  if(btn)btn.textContent='✕ Close Panel';

  const jobs=(await dAll('jobs')).filter(j=>j.date===jDate);
  if(!jobs.length){toast('No jobs for this date','warn');panel.style.display='none';if(btn)btn.textContent='📱 Send to Engineer';return}

  // Group by engineer
  const byEng={};
  jobs.forEach(j=>{const e=j.engineer||'Unassigned';if(!byEng[e])byEng[e]=[];byEng[e].push(j)});
  const engs=Object.keys(byEng);

  panel.style.display='block';
  panel.innerHTML=`<div class="wa-panel">
    <div class="wa-panel-title">📱 Send Jobs to Engineers — ${fmtD(jDate)}</div>
    <div class="wa-eng-tabs" id="wa-eng-tabs">
      ${engs.map((e,i)=>`<div class="wa-eng-tab ${i===0?'active':''}" onclick="waShowEng('${e}',this)">${e} (${byEng[e].length})</div>`).join('')}
    </div>
    <div id="wa-preview-area"></div>
  </div>`;

  window._waJobsByEng=byEng;
  if(engs.length>0) waShowEng(engs[0], panel.querySelector('.wa-eng-tab'));
}

function waShowEng(engName, tabEl){
  document.querySelectorAll('.wa-eng-tab').forEach(t=>t.classList.remove('active'));
  if(tabEl) tabEl.classList.add('active');
  const jobs=window._waJobsByEng[engName]||[];
  const msg=buildJobWAMsg(jobs, engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  const waNum=engObj?.wa||'';

  const area=document.getElementById('wa-preview-area');
  area.innerHTML=`
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:var(--txt3);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600">Job Cards — ${engName}</div>
      <div class="wa-job-cards">
        ${jobs.map((j,i)=>{
          const ords=['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','10th'];
          // FIX 20: Previously access and contact were merged on one line with 🔑 making
          // it unclear whether the contact field is an access code or a person's name.
          // Now rendered as two distinct lines with clear labels when both are present.
          const accessLine = j.access ? `🔑 ${escHtml(j.access)}` : '';
          const contactLine = j.contact ? `👤 Contact: ${escHtml(j.contact)}` : '';
          return `<div class="wa-job-card">
            <div class="wa-job-num">${ords[i]||i+1+'th'} Job ${j.timeSlot?'· '+escHtml(j.timeSlot):''}</div>
            <div class="wa-job-addr">${escHtml(j.address)}</div>
            <div class="wa-job-meta">
              👤 ${escHtml(j.referrer)||'—'}<br>
              🔧 ${escHtml(j.description)||'—'}<br>
              ${accessLine?accessLine+'<br>':''}
              ${contactLine?contactLine+'<br>':''}
              ${j.notes?'📝 '+escHtml(j.notes):''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div style="font-size:10px;color:var(--txt3);margin-bottom:6px;letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600">Message Preview</div>
    <div class="wa-msg-preview">${escHtml(msg)}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div class="fg" style="margin:0;flex:1;max-width:260px">
        <input type="text" class="fi" id="wa-eng-num-inp" value="${waNum}" placeholder="WhatsApp number (447...)">
      </div>
      <button class="btn btn-ghost btn-sm" onclick="copyText(${JSON.stringify(msg)})">📋 Copy</button>
      <button class="btn btn-wa" onclick="sendToWA(document.getElementById('wa-eng-num-inp').value, ${JSON.stringify(msg)})">📱 Open WhatsApp</button>
    </div>
  `;
}

async function waSingleJobById(id){
  const j=await dGet('jobs',id);
  if(!j)return;
  const msg=buildJobWAMsg([j], j.engineer||'Engineer');
  const engObj=(S.engineers||[]).find(e=>e.name===j.engineer);
  const waNum=engObj?.wa||'';
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=waNum;
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

function waSingleJob(){waSingleJobById(editJid)}

async function waJobsSelected(){
  const ids=[...selJobs];
  const jobs=await Promise.all(ids.map(id=>dGet('jobs',id)));
  if(!jobs.length)return;
  const msg=buildJobWAMsg(jobs,'Engineer');
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value='';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

function openWhatsApp(){
  const num=(document.getElementById('wa-send-to').value||'').replace(/[^0-9]/g,'');
  const msg=window._waPendingMsg||'';
  sendToWA(num,msg);
  closeModal('mo-wa');
}

export function sendToWA(num,msg){
  const enc=encodeURIComponent(msg);
  const n=num.replace(/[^0-9]/g,'');
  const url=n?`https://wa.me/${n}?text=${enc}`:`https://wa.me/?text=${enc}`;
  window.open(url,'_blank');
  toast('Opening WhatsApp…','wa');
}

function copyText(txt){navigator.clipboard?.writeText(txt).then(()=>toast('Copied to clipboard','success')).catch(()=>{const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();toast('Copied','success')})}
function copyWAText(){copyText(window._waPendingMsg||'')}
// escHtml is now imported from @ui.

// ════════════════════════════════════════════════════════════════
//  INVOICES
// ════════════════════════════════════════════════════════════════




export async function renderInvList(){
  renderInvKPIs();
  const filter=document.getElementById('inv-filter')?.value||'';
  const search=(document.getElementById('inv-search')?.value||'').toLowerCase();
  const list=document.getElementById('inv-list');
  const sMap={'Draft':'b-draft','Awaiting Payment':'b-awaiting','Paid':'b-paid','Cancelled':'b-cancelled','Credit Note':'b-credit'};

  // Special: Overdue invoices
  if(filter==='__overdue__'){
    let allInvs2=await dAll('invoices');
    allInvs2=_filterByType(allInvs2);
    const today2=TODAY();
    const overdue=allInvs2.filter(i=>i.status==='Awaiting Payment'&&i.dueDate&&i.dueDate<today2);
    if(!overdue.length){
      list.innerHTML='<div class="empty"><div class="ei">✓</div><p>No overdue invoices!</p></div>';
      return;
    }
    // Re-render as normal list with overdue filter applied
    const _allPmts2=await dAll('payments');
    const today3=TODAY();
    list.innerHTML=overdue.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(inv=>{
      const t=calcInvTotal(inv);
      const paid=_allPmts2.filter(p=>p.invId===inv.id).reduce((s,p)=>s+p.amount,0);
      const outstanding=Math.max(0,t.grand-paid);
      const daysOver=Math.ceil((new Date(today3)-new Date(inv.dueDate))/86400000);
      const _stColor='#e05252',_stIcon='⚠';
      return `<div class="inv-card ${inv.id===curInvId?'active':''}" data-id="${inv.id}" onclick="viewInv('${inv.id}')">
        <div class="inv-accent" style="background:${_stColor}"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-left:8px">
          <div class="inv-num">${inv.number}</div>
          <div class="inv-status-pill" style="background:${_stColor}15;color:${_stColor};border-color:${_stColor}30">${_stIcon} ${daysOver}d overdue</div>
          <div style="margin-left:auto;font-family:var(--fh);font-weight:800;font-size:18px;color:#1e293b">£${outstanding.toFixed(2)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-left:8px">
          <div class="inv-avatar" style="background:linear-gradient(135deg,var(--acc),#3b82f6)">${(inv.clientName||'?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.clientName||'—'}</div>
            <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.propertyAddress||inv.jobAddress||''}</div>
          </div>
        </div>
        <div class="inv-bottom-bar" style="padding-left:8px">
          <div class="inv-meta">Due: ${inv.dueDate} · ${inv.description||'—'}</div>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button class="inv-action-btn" onclick="markInvPaid('${inv.id}');renderInvList()" title="Mark paid">✓</button>
            <button class="inv-action-btn" onclick="openPaymentModal('${inv.id}')" title="Part pay">💳</button>
            <button class="inv-action-btn" onclick="sendOverdueWA('${inv.id}')" title="Chase">📱</button>
            <button class="inv-action-btn" onclick="downloadInvPDFById('${inv.id}')" title="PDF">📄</button>
          </div>
        </div>
      </div>`;
    }).join('');
    return;
  }

  // Special: Missed Invoices — completed/invoiced jobs with no linked invoice
  if(filter==='__missed__'){
    const allJobs=await dAll('jobs');
    const allInvs=await dAll('invoices');
    const allPersons=await dAll('persons');
    const missedJobs=allJobs.filter(j=>{
      const eligible=j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED;
      if(!eligible)return false;
      // FIX 4: Single canonical check using linkedJobId.
      // jobRef is kept as a legacy fallback for older records.
      // The previous third check (j.invNumber === i.number) was unreliable —
      // it compared in the wrong direction and caused false "not invoiced" results.
      const linked=allInvs.some(i=>i.linkedJobId===j.id||i.jobRef===j.id);
      return!linked;
    });

    function getMissingDetails(j){
      const issues=[];
      const hints=[];
      if(!j.price||Number(j.price)===0){
        issues.push({icon:'💷',label:'No price set',fix:'Open job → set the job price / labour cost'});
        hints.push('price');
      }
      const client=allPersons.find(p=>p.name===j.referrer);
      if(!j.referrer||!client){
        issues.push({icon:'👤',label:`Client "${escHtml(j.referrer)||'unknown'}" not in contacts`,fix:'Open job → ensure referrer matches a person in Contacts'});
        hints.push('client');
      } else {
        if(!client.email){
          issues.push({icon:'📧',label:'Client has no email address',fix:`Go to Contacts → find ${escHtml(client.name)} → add their email`});
          hints.push('email');
        }
      }
      if(!j.description){
        issues.push({icon:'📝',label:'No job description',fix:'Open job → add a description of the work done'});
        hints.push('desc');
      }
      return{issues,hints,client};
    }

    let displayed=search
      ? missedJobs.filter(j=>(j.address+j.referrer+j.description).toLowerCase().includes(search))
      : missedJobs;

    if(!displayed.length){
      list.innerHTML=missedJobs.length
        ?'<div class="empty"><div class="ei">🔍</div><p>No missed invoices matching search</p></div>'
        :'<div class="empty"><div class="ei">✓</div><p>No missed invoices — all completed jobs are invoiced!</p></div>';
      return;
    }

    list.innerHTML=`
      <div style="background:rgba(240,192,48,.08);border:1px solid rgba(240,192,48,.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:var(--txt2)">
        <strong style="color:var(--yellow)">⚠️ ${displayed.length} job${displayed.length===1?'':'s'} completed but never invoiced.</strong>
        Each card below shows exactly what's blocking invoice creation and how to fix it.
      </div>
      ${displayed.map(j=>{
        const {issues,hints,client}=getMissingDetails(j);
        const canCreate=issues.length===0;
        const statusColor=canCreate?'var(--green)':'var(--yellow)';
        return`<div class="inv-card" style="border-left:4px solid ${statusColor};margin-bottom:14px">
          <div class="inv-card-row">
            <div style="font-weight:700;font-size:15px;color:var(--acc)">${escHtml(j.address)||'No address'}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="badge" style="background:${canCreate?'rgba(37,213,142,.15)':'rgba(240,192,48,.15)'};color:${statusColor}">${canCreate?'✅ Ready to invoice':'⚠️ Needs info'}</span>
            </div>
          </div>
          <div class="inv-meta" style="margin:4px 0 10px">
            📅 ${escHtml(j.date)||'—'} &nbsp;·&nbsp; 👤 ${escHtml(j.referrer)||'No client'} &nbsp;·&nbsp; 🔧 ${escHtml(j.trade)||'—'} &nbsp;·&nbsp; 💷 £${(j.price||0).toFixed(2)}
            ${j.engineer?` &nbsp;·&nbsp; 👷 ${escHtml(j.engineer)}`:''}
          </div>
          ${j.description?`<div style="font-size:12px;color:var(--txt2);margin-bottom:10px;font-style:italic">"${escHtml(j.description)}"</div>`:''}

          ${issues.length?`
          <div style="background:var(--s2);border-radius:8px;padding:10px 12px;margin-bottom:12px">
            <div style="font-size:11px;font-weight:700;color:var(--txt3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">❌ Why this job is not invoiced</div>
            ${issues.map(iss=>`
              <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;padding:8px;background:var(--s1);border-radius:6px;border:1px solid var(--border)">
                <span style="font-size:18px;line-height:1">${iss.icon}</span>
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--txt1);margin-bottom:2px">${iss.label}</div>
                  <div style="font-size:12px;color:var(--acc)">→ Fix: ${iss.fix}</div>
                </div>
              </div>`).join('')}
          </div>`:
          `<div style="background:rgba(37,213,142,.08);border:1px solid rgba(37,213,142,.2);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--green)">
            ✅ All required info is present. Click "Create Invoice" to generate it now.
          </div>`}

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-acc btn-sm" onclick="createInvFromJob('${j.id}');event.stopPropagation()">
              🧾 Create Invoice${issues.length?' (as draft)':''}
            </button>
            <button class="btn btn-ghost btn-sm" onclick="createProforma('${j.id}');event.stopPropagation()">📄 Create Proforma</button>
            <button class="btn btn-ghost btn-sm" onclick="openJobModal('${j.id}');event.stopPropagation()">✎ Open Job to Fix</button>
            ${client?`<button class="btn btn-ghost btn-sm" onclick="nav('dir');event.stopPropagation()">👤 View Client in Contacts</button>`:''}
          </div>
        </div>`;
      }).join('')}`;
    return;
  }

  let invs=await dAll('invoices');
  invs=_filterByType(invs); // apply Agency / Landlord / All toggle
  if(filter)invs=invs.filter(i=>i.status===filter);
  if(search)invs=invs.filter(i=>(i.clientName+i.number+i.description+(i.jobRef||'')).toLowerCase().includes(search));
  // Sort invoices
  const invSortEl=document.getElementById('inv-sort');
  const invSortBy=invSortEl?invSortEl.value:'date_desc';
  invs.sort((a,b)=>{
    switch(invSortBy){
      case 'date_asc':  return (a.date||'').localeCompare(b.date||'');
      case 'date_desc': return (b.date||'').localeCompare(a.date||'');
      case 'amount_desc': return calcInvTotal(b).grand - calcInvTotal(a).grand;
      case 'amount_asc':  return calcInvTotal(a).grand - calcInvTotal(b).grand;
      case 'num_desc': return (b.number||'').localeCompare(a.number||'');
      case 'client': return (a.clientName||'').localeCompare(b.clientName||'');
      default: return b.created-a.created;
    }
  });
  if(!invs.length){list.innerHTML='<div class="empty"><div class="ei">◎</div><p>No invoices yet</p></div>';return}
  // Pre-load payments for overdue/paid progress display
  const _allPmts = await dAll('payments');
  const today = TODAY();

  list.innerHTML=invs.map(inv=>{
    const t=calcInvTotal(inv);
    const invPmts = _allPmts.filter(p=>p.invId===inv.id);
    const paid = invPmts.reduce((s,p)=>s+(p.amount||0),0);
    const outstanding = Math.max(0, t.grand - paid);
    const pct = t.grand>0 ? Math.min(100, paid/t.grand*100) : 0;
    const isOverdue = inv.status==='Awaiting Payment' && inv.dueDate && inv.dueDate < today;
    const daysOver = isOverdue ? Math.ceil((new Date(today)-new Date(inv.dueDate))/(86400000)) : 0;

    const _statusColors={'Draft':'#94a3b8','Awaiting Payment':'#3b82f6','Paid':'#22c55e','Overdue':'#e05252','Cancelled':'#e05252','Credit Note':'#7c3aed'};
    const _statusIcons={'Draft':'📝','Awaiting Payment':'📤','Paid':'✓','Overdue':'⚠','Cancelled':'✕','Credit Note':'↩'};
    const _statusColor=_statusColors[inv.status]||'#94a3b8';
    const _statusIcon=_statusIcons[inv.status]||'📝';
    const _dateStr=inv.date||'—';
    const _dueStr=inv.dueDate||'—';
    return `<div class="inv-card ${inv.id===curInvId?'active':''}" data-id="${inv.id}" onclick="viewInv('${inv.id}')">
      <div class="inv-accent" style="background:${isOverdue?'#e05252':_statusColor}"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-left:8px">
        <div class="inv-num">${inv.number}</div>
        ${isOverdue?`<div class="inv-status-pill" style="background:#e0525215;color:#e05252;border-color:#e0525230">⚠ ${daysOver}d overdue</div>`:`<div class="inv-status-pill" style="background:${_statusColor}15;color:${_statusColor};border-color:${_statusColor}30">${_statusIcon} ${inv.type==='proforma'?'PROFORMA':inv.status}</div>`}
        <div style="margin-left:auto;font-family:var(--fh);font-weight:800;font-size:18px;color:#1e293b;white-space:nowrap">£${t.grand.toFixed(2)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-left:8px">
        <div class="inv-avatar" style="background:linear-gradient(135deg,var(--acc),#3b82f6)">${(inv.clientName||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.clientName||'—'}</div>
          <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inv.propertyAddress||inv.jobAddress||inv.description||''}</div>
        </div>
        ${inv.jobNum?`<div class="inv-job-link" onclick="event.stopPropagation();openJobModalByNum('${inv.jobNum}')" title="Open job ${inv.jobNum}">🔗 ${inv.jobNum}</div>`:inv.jobRef?`<div class="inv-job-link" onclick="event.stopPropagation();openJobModalByNum('${inv.jobRef}')" title="Open job ${inv.jobRef}">🔗 ${inv.jobRef}</div>`:''}
      </div>
      ${pct>0&&pct<100&&inv.type!=='proforma'?`<div style="height:3px;background:#e2e8f0;border-radius:2px;overflow:hidden;margin:0 8px 8px 8px"><div style="height:100%;width:${pct.toFixed(0)}%;background:var(--acc);border-radius:2px"></div></div>`:''}
      <div class="inv-bottom-bar" style="padding-left:8px">
        <div class="inv-meta">${_dateStr} · Due ${_dueStr}${outstanding>0&&inv.status==='Awaiting Payment'&&inv.type!=='proforma'?` · <span style="color:var(--yellow);font-weight:700">£${outstanding.toFixed(2)} owed</span>`:''}${inv.status==='Paid'?` · <span style="color:var(--green);font-weight:700">✓ Fully paid</span>`:''}</div>
        <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
          ${inv.type==='proforma'?`<button class="inv-action-btn" onclick="convertProformaToInvoice('${inv.id}')" title="Convert to invoice">🧾</button>`:''}
          ${inv.status==='Draft'&&inv.type!=='proforma'?`<button class="inv-action-btn" onclick="markInvSent('${inv.id}')" title="Mark sent">📤</button>`:''}
          ${inv.status!=='Paid'&&inv.status!==STATUS.CANCELLED&&inv.type!=='proforma'?`<button class="inv-action-btn" onclick="event.stopPropagation();markInvPaid('${inv.id}');renderInvList()" title="Mark paid">✓</button>`:''}
          <button class="inv-action-btn" onclick="duplicateInv('${inv.id}')" title="Duplicate">⧉</button>
          <button class="inv-action-btn" onclick="downloadInvPDFById('${inv.id}')" title="PDF">📄</button>
          <button class="inv-action-btn" onclick="openInvSendModal('${inv.id}')" title="Send">📱</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function createInvFromJob(jobId){
  try{
    const j=await dGet('jobs',jobId);
    if(!j){toast('Job not found — try refreshing','error');return;}

    // Build line items from job data
    const engObj=(S.engineers||[]).find(e=>e.name===j.engineer);
    const hourlyRate=engObj?.rate||0;
    const hours=parseFloat(j.hours)||0;
    const jobPrice=Number(j.price)||0;

    if(hours>0&&hourlyRate>0){
      invItems=[{desc:`Labour — ${j.description||j.trade||'Works'} (${hours}h @ £${hourlyRate}/h)`,qty:hours,unit:hourlyRate,vat:true}];
      if(jobPrice>0&&Math.abs(jobPrice-(hours*hourlyRate))>0.01)
        invItems.push({desc:`Materials — ${j.address}`,qty:1,unit:jobPrice,vat:true});
    } else if(hours>0){
      invItems=[{desc:`Labour — ${j.description||j.trade||'Works'} (${hours}h)`,qty:hours,unit:0,vat:true}];
      if(jobPrice>0) invItems.push({desc:`Works at ${j.address}`,qty:1,unit:jobPrice,vat:true});
    } else {
      invItems=[{desc:j.description||j.address||'Works',qty:1,unit:jobPrice,vat:true}];
    }

    editInvId=null;
    window._pendingJobLink=jobId;
    window._linkedJobOriginalPrice=jobPrice; // for cross-sync change detection

    // Extract fields — handles both camelCase (JS) and lowercase (DB)
    const jobNumber    = j.jobNum||'';
    const agentName    = (j.agentName||'').trim();
    const agentEmail   = (j.agentEmail||'').trim();
    const agencyName   = (j.agencyName||'').trim();
    const landlordName = (j.landlordName||j.referrer||'').trim();
    const propertyAddr = (j.address||'').trim();
    const hasAgency    = !!(agencyName||agentName);

    window._newInvoiceData={
      invoiceType:hasAgency?'agency':'landlord',
      billToName:hasAgency?agencyName:landlordName,
      billToAddress:hasAgency?(j.agencyAddr||''):propertyAddr,
      jobAddress:hasAgency?propertyAddr:'',
      agentName:hasAgency?agentName:'',
      agentEmail:hasAgency?agentEmail:'',
      agencyName,landlordName,propertyAddress:propertyAddr,jobNum:jobNumber
    };

    // Find client from persons table
    const ps=await dAll('persons');
    const cl=ps.find(p=>p.name===landlordName||p.name===j.referrer)||{};

    document.getElementById('mo-inv-title').textContent=`◎ Invoice for ${j.jobNum||j.address||'Job'}`;
    document.getElementById('if-date').value=j.date||TODAY();
    document.getElementById('if-desc').value=j.description||j.address||'';
    document.getElementById('if-notes').value=S.invNotes||'';
    document.getElementById('if-terms').value=S.payTerms||'';
    document.getElementById('if-status').value='Draft';
    const dd=new Date();dd.setDate(dd.getDate()+(S.dueDays||14));
    document.getElementById('if-due').value=dd.toISOString().slice(0,10);
    const jobRefEl=document.getElementById('if-jobref');if(jobRefEl)jobRefEl.value=jobNumber;
    const agentEl=document.getElementById('if-agent');if(agentEl)agentEl.value=hasAgency?agentName:'';
    const agentCCEl=document.getElementById('if-agent-cc');if(agentCCEl)agentCCEl.value=hasAgency?agentEmail:'';

    await fillInvClientDrop(cl.id);
    const clientAddrLbl=document.getElementById('if-client-addr-label');
    const clientAddrEl=document.getElementById('if-client-addr');
    const jobAddrWrap=document.getElementById('if-job-addr-container');
    const jobAddrEl=document.getElementById('if-job-addr');
    if(hasAgency){
      if(clientAddrLbl)clientAddrLbl.textContent='Agency Address';
      if(clientAddrEl){clientAddrEl.value=j.agencyAddr||'';clientAddrEl.placeholder='Agency office address';}
      if(jobAddrWrap)jobAddrWrap.style.display='';
      if(jobAddrEl)jobAddrEl.value=propertyAddr;
    }else{
      if(clientAddrLbl)clientAddrLbl.textContent='Property Address';
      if(clientAddrEl){clientAddrEl.value=propertyAddr;clientAddrEl.placeholder='Property address';}
      if(jobAddrWrap)jobAddrWrap.style.display='none';
    }

    renderInvItems();
    document.getElementById('if-vat-pct').textContent=getVatRate();
    _showInvJobSyncBanner(j);
    openModal('mo-inv');
  }catch(err){
    toast('❌ Could not open invoice: '+(err.message||'').slice(0,80),'error');
    console.error('[DeepFlow] createInvFromJob error:',err);
  }
}

// ── Invoice ↔ Job cross-sync system ──────────────────────────────────────────
// Shows a banner inside the invoice modal when it's linked to a job.
// Overrides updInvTotals to detect amount changes and warn before syncing.

function _showInvJobSyncBanner(j){
  // Remove any existing banner
  document.getElementById('_inv-sync-banner')?.remove();

  const wrap=document.getElementById('if-items')?.closest('.modal-body,.modal-scroll,form')||
             document.getElementById('if-items')?.parentElement;
  if(!wrap)return;

  const jobTotal=Number(j.price)||0;
  const banner=document.createElement('div');
  banner.id='_inv-sync-banner';
  banner.style.cssText='display:flex;align-items:center;gap:8px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:9px 13px;margin-bottom:12px;font-size:12px;color:#1d4ed8;font-weight:500';
  banner.innerHTML=`<span style="font-size:16px">🔗</span>
    <div style="flex:1">
      <div style="font-weight:700;margin-bottom:2px">Linked to ${j.jobNum||'Job'} — Live Sync Active</div>
      <div style="opacity:.8">Changes to amounts here will update the job price. Job's current price: <strong>£${jobTotal.toFixed(2)}</strong></div>
    </div>`;

  // Insert banner at top of modal content (before first field group)
  const firstFg=document.getElementById('if-date')?.closest('div[style*="margin"],[class*="fg"],[class*="form"]');
  if(firstFg&&firstFg.parentElement)
    firstFg.parentElement.insertBefore(banner, firstFg);
  else
    document.getElementById('if-items')?.before(banner);

  // Override updInvTotals to intercept changes for the linked job
  window._invSyncJobId=j.id;
  window._invSyncOrigPrice=jobTotal;
  window._invSyncJobNum=j.jobNum||'Job';
}

// Patched updInvTotals — intercepts amount changes when linked to a job
function updInvTotals(){
  const vr=getVatRate();let sub=0,vat=0;
  invItems.forEach(i=>{const l=(i.qty||1)*(i.unit||0);sub+=l;if(i.vat)vat+=l*vr/100;});
  document.getElementById('if-sub').textContent='£'+sub.toFixed(2);
  document.getElementById('if-vat').textContent='£'+vat.toFixed(2);
  document.getElementById('if-total').textContent='£'+(sub+vat).toFixed(2);
  const vatRow=document.getElementById('if-vat-row');
  if(vatRow)vatRow.style.display=(S.vatEnabled!==false)?'':'none';

  // Cross-sync: update the linked job badge if amount differs from original
  if(window._invSyncJobId && Math.abs(sub-window._invSyncOrigPrice)>0.001){
    let badge=document.getElementById('_inv-sync-diff');
    if(!badge){
      badge=document.createElement('div');
      badge.id='_inv-sync-diff';
      badge.style.cssText='margin-top:4px;font-size:11px;color:#d97706;font-weight:600';
      document.getElementById('_inv-sync-banner')?.appendChild(badge);
    }
    badge.textContent=`⚠ Job price will update: £${window._invSyncOrigPrice.toFixed(2)} → £${sub.toFixed(2)} on save`;
  } else {
    document.getElementById('_inv-sync-diff')?.remove();
  }
}

// Called by saveInvWithJobSync — patches the job price when invoice amount changes
// ── Invoice → Job live sync ───────────────────────────────────────────────────
// Called after every invoice field save. Finds the linked job and updates the
// corresponding job field automatically. Price changes still show a popup.
// No popup for description, address, date — those sync silently.

// Maps invoice DB field name → job DB field name (for silent sync to the JOB record)
// billToAddress syncs separately to persons/agencies table (see _syncInvoiceFieldToJob)
const _INV_TO_JOB_FIELD = {
  description:     'description',   // invoice description ↔ job description
  jobaddress:      'address',        // property address ↔ job address
  propertyaddress: 'address',
  date:            'date',           // invoice date ↔ job date
  clientname:      'landlordname',   // bill-to name ↔ job landlord
  billtoname:      'landlordname',
  agentname:       'agentname',      // agent ↔ job agent
  agencyname:      'agencyname',
  // EXCLUDED from job sync (handled separately or invoice-only):
  // billtoaddress → syncs to persons.address or agencies.address (see _syncBillToAddress)
  // notes, duedate, clientemail, clientwa, number, status, terms → invoice only
};

async function _syncInvoiceFieldToJob(invId, dbField, dbVal){
  const fieldLower = dbField.toLowerCase();
  const isItemsChange = fieldLower === 'items';

  // billToAddress syncs to the landlord/agency record — not the job
  if(fieldLower === 'billtoaddress'){
    _syncBillToAddress(invId, dbVal).catch(()=>{});
    return;
  }

  const jobField = _INV_TO_JOB_FIELD[fieldLower];
  if(!jobField && !isItemsChange) return; // field not mapped — skip

  const inv = await dGet('invoices', invId);
  if(!inv) return;
  const linkedJobId = inv.linkedJobId || inv.jobId;
  if(!linkedJobId) return;
  const job = await dGet('jobs', linkedJobId);
  if(!job) return;

  const patchBody = {};

  // Always patch the mapped job field silently — no popup for text fields
  if(jobField && !isItemsChange && dbVal !== undefined){
    patchBody[jobField] = dbVal;
  }

  // Price sync — always forced, single item or multi-item alike. The invoice
  // is the single source of truth for amount once a job is linked to one;
  // there is no "notice, maybe sync later" path any more, so job and invoice
  // can never be left showing two different prices by accident or on purpose.
  if(isItemsChange){
    const newTotal = calcInvTotal(inv).sub;
    const prevPrice = Number(job.price||0);
    if(Math.abs(newTotal - prevPrice) > 0.01){
      patchBody['price'] = newTotal;
      toast(`🔗 Job price updated to £${newTotal.toFixed(2)}`,'success',2000);
    }
  }

  if(Object.keys(patchBody).length === 0) return;

  try{
    await _sb(`jobs?id=eq.${encodeURIComponent(linkedJobId)}`, {
      method:'PATCH', body:patchBody, prefer:'return=minimal'
    });
    _invalidateJobCache();
    const jobNumStr = job.jobNum||job.jobnum||'';
    toast(`🔗 Job ${jobNumStr} synced (${Object.keys(patchBody).join(', ')})`,'success',2500);
  }catch(e){ console.warn('[DeepFlow] job sync failed', e); }
}

// Sync billToAddress back to the landlord (persons) or agency record
async function _syncBillToAddress(invId, newAddr){
  if(!newAddr) return;
  const inv = await dGet('invoices', invId);
  if(!inv) return;
  const isAgency = inv.invoiceType === 'agency';
  const clientName = inv.billToName || inv.clientName || inv.agencyName || '';
  if(!clientName) return;
  try{
    if(isAgency){
      const agencies = await dAll('agencies');
      const agency = agencies.find(a=>(a.name||'').toLowerCase()===clientName.toLowerCase());
      if(agency){
        await _sb(`agencies?id=eq.${encodeURIComponent(agency.id)}`,{method:'PATCH',body:{address:newAddr},prefer:'return=minimal'});
        toast(`🔗 Agency address updated for ${clientName}`,'success',2000);
      }
    } else {
      const persons = await dAll('persons');
      const person = persons.find(p=>(p.name||'').toLowerCase()===clientName.toLowerCase());
      if(person){
        await _sb(`persons?id=eq.${encodeURIComponent(person.id)}`,{method:'PATCH',body:{address:newAddr},prefer:'return=minimal'});
        toast(`🔗 Landlord address updated for ${clientName}`,'success',2000);
      }
    }
  }catch(e){ console.warn('[DeepFlow] billToAddress sync failed',e); }
}

async function _syncInvoicePriceToJob(linkedJobId, newTotal, newDesc){
  // Always syncs silently — single item or multi-item alike. The invoice is
  // the source of truth for amount/description once linked to a job, so
  // there's no "notice, maybe sync later" path: job and invoice can never
  // show two different prices or descriptions after this runs.
  if(!linkedJobId) return;
  const origPrice=window._invSyncOrigPrice;
  if(origPrice===undefined||Math.abs(newTotal-origPrice)<0.001) return;

  const patchBody={price:newTotal};
  if(newDesc) patchBody.description=newDesc;

  await _sb(`jobs?id=eq.${encodeURIComponent(linkedJobId)}`,{
    method:'PATCH',
    body:patchBody,
    prefer:'return=minimal'
  });
  window._invSyncOrigPrice=newTotal;
  _invalidateJobCache();
  toast('🔗 Job synced to £'+newTotal.toFixed(2),'success',2500);
}

// ── Per-invoice audit trail ───────────────────────────────────────────────────
async function _renderInvAuditTrail(invId, inv){
  const box=document.getElementById('inv-audit-trail-'+invId);
  if(!box)return;
  try{
    const audits=await _sb('invoice_audit?invoiceId=eq.'+invId+'&order=timestamp.desc');
    // Was querying invoice_payments — a separate, entirely empty table
    // nothing ever writes to. Every real payment recorded anywhere in the
    // app goes into the `payments` table (with inv_id, not invoiceId), so
    // this timeline's "Payment recorded" entries never showed anything,
    // even for invoices with genuine recorded payments.
    const payments=await _sb('payments?inv_id=eq.'+invId+'&order=created.desc');

    // Build timeline
    let html='<div style="position:relative;padding-left:20px">';
    html+='<div style="position:absolute;left:6px;top:0;bottom:0;width:2px;background:var(--border)"></div>';

    // Payment entries
    (payments||[]).forEach(p=>{
      html+=_auditEntry('💳','green','Payment recorded','£'+Number(p.amount||0).toFixed(2)+' via '+(p.method||'?'),p.created);
    });

    // Audit entries
    (audits||[]).forEach(a=>{
      const icons={edit:'✎',convert:'◎',sync:'↔',created:'+',deleted:'🗑',sent:'✉',paid:'✓',status:'◉'};
      const colors={edit:'blue',convert:'purple',sync:'orange',created:'green',deleted:'red',sent:'blue',paid:'green',status:'amber'};
      html+=_auditEntry(icons[a.action]||'●',colors[a.action]||'grey',a.action?.toUpperCase(),a.details||'',a.timestamp);
    });

    // Creation entry
    html+=_auditEntry('+','green','CREATED',inv.type==='proforma'?'Proforma created':'Invoice created',inv.created);

    html+='</div>';
    box.innerHTML=html;
  }catch(e){box.innerHTML='<div style="font-size:11px;color:var(--txt3)">No audit entries yet</div>';}
}

function _auditEntry(icon,color,title,detail,ts){
  const time=ts?new Date(ts).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
  const dotColors={green:'#22c55e',blue:'#3b82f6',orange:'#f97316',purple:'#a855f7',red:'#e05252',amber:'#f59e0b',grey:'#94a3b8'};
  const dc=dotColors[color]||'#94a3b8';
  return `<div style="position:relative;margin-bottom:12px;padding-left:12px">
    <div style="position:absolute;left:-17px;top:2px;width:12px;height:12px;border-radius:50%;background:${dc};display:flex;align-items:center;justify-content:center;color:#fff;font-size:7px;font-weight:700;z-index:2">${icon}</div>
    <div style="font-size:10px;font-weight:700;color:var(--txt2);text-transform:uppercase;letter-spacing:.5px">${title}</div>
    ${detail?`<div style="font-size:11px;color:var(--txt3);margin-top:1px">${detail}</div>`:''}
    ${time?`<div style="font-size:9px;color:var(--txt3);opacity:.6;margin-top:1px">${time}</div>`:''}
  </div>`;
}

// ── Credit Notes Admin Panel ──────────────────────────────────────────────────
async function renderCreditNotesAdmin(){
  const el = document.getElementById('inv-special-view');
  el.innerHTML=`<div style="font-size:12px;color:var(--txt3)">Loading credit notes…</div>`;

  const [allInvs, allActs] = await Promise.all([dAll('invoices'), dAll('activity')]);
  const cns = allInvs.filter(i=>i.status==='Credit Note'||i.isCreditNote);

  const totalLoss = cns.reduce((s,cn)=>s+calcInvTotal(cn).grand, 0);
  const byStaff = {};
  const byClient = {};
  cns.forEach(cn=>{
    const staff = cn.issuedBy||cn.staff||'Unknown';
    const client = cn.clientName||'Unknown';
    byStaff[staff] = (byStaff[staff]||0) + calcInvTotal(cn).grand;
    byClient[client] = (byClient[client]||0) + calcInvTotal(cn).grand;
  });

  const kpi=(val,lbl,col='var(--acc)')=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:20px;font-weight:900;color:${col}">${val}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:.3px">${lbl}</div>
    </div>`;

  el.innerHTML=`
    <div style="max-width:900px">
      <div style="font-size:15px;font-weight:800;margin-bottom:16px">↩ Credit Notes — Admin Overview</div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px">
        ${kpi(cns.length,'Total credit notes','#7c3aed')}
        ${kpi('£'+totalLoss.toFixed(2),'Total company loss','var(--red)')}
        ${kpi(Object.keys(byStaff).length,'Staff involved','var(--yellow)')}
        ${kpi(Object.keys(byClient).length,'Clients affected','var(--txt2)')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Loss by Staff</div>
          ${Object.entries(byStaff).sort((a,b)=>b[1]-a[1]).map(([name,amt])=>`
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${name}</span><span style="font-weight:700;color:var(--red)">£${amt.toFixed(2)}</span>
            </div>`).join('') || '<div style="font-size:11px;color:var(--txt3)">No data</div>'}
        </div>
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Loss by Client</div>
          ${Object.entries(byClient).sort((a,b)=>b[1]-a[1]).map(([name,amt])=>`
            <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${name}</span><span style="font-weight:700;color:var(--red)">£${amt.toFixed(2)}</span>
            </div>`).join('') || '<div style="font-size:11px;color:var(--txt3)">No data</div>'}
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">All Credit Notes</div>
      ${cns.sort((a,b)=>b.created-a.created).map(cn=>{
        const amt = calcInvTotal(cn).grand;
        const act = allActs.filter(a=>a.invId===cn.id||a.invNum===cn.number).sort((a,b)=>b.ts-a.ts)[0];
        return`<div style="background:var(--s1);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:6px;display:flex;gap:14px;align-items:center">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:700;color:#7c3aed;font-family:monospace">${cn.number}</span>
              <span style="font-size:11px;color:var(--txt3)">${cn.date||''}</span>
              ${cn.issuedBy||cn.staff?`<span style="font-size:11px;color:var(--txt2)">by ${cn.issuedBy||cn.staff}</span>`:''}
            </div>
            <div style="font-size:12px;font-weight:600">${cn.clientName||'—'}</div>
            <div style="font-size:11px;color:var(--txt2);margin-top:2px">${cn.reason||cn.notes||cn.description||'No reason recorded'}</div>
            ${act?`<div style="font-size:10px;color:var(--txt3);margin-top:3px">Last activity: ${act.msg.slice(0,60)}</div>`:''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:16px;font-weight:900;color:var(--red)">-£${amt.toFixed(2)}</div>
            ${cn.linkedInvId?`<div style="font-size:10px;color:var(--acc);cursor:pointer;margin-top:3px" onclick="invNavSelect('all');setTimeout(()=>viewInv('${cn.linkedInvId}'),300)">View original →</div>`:''}
          </div>
        </div>`;
      }).join('') || `<div style="text-align:center;padding:30px;color:var(--txt3)">No credit notes issued</div>`}
    </div>`;
}

async function _renderInvPayments(invId, invTotal){
  const box = document.getElementById('inv-detail-box');
  if(!box) return;
  try{
    const allPmts = await dAll('payments');
    const pmts = allPmts.filter(p=>p.invId===invId).sort((a,b)=>a.date.localeCompare(b.date));
    const totalPaid = pmts.reduce((s,p)=>s+p.amount,0);
    const outstanding = Math.max(0, invTotal.grand - totalPaid);
    const pct = invTotal.grand>0 ? Math.min(100, totalPaid/invTotal.grand*100) : 0;

    const section = document.createElement('div');
    section.style.cssText = 'margin:0 18px 18px;border:1px solid var(--border);border-radius:10px;overflow:hidden';
    section.innerHTML = `
      <div style="background:var(--s2);padding:12px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-size:12px;font-weight:700;color:var(--txt2)">💳 Payment Status</div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--txt3)">Paid: <strong style="color:var(--green)">£${totalPaid.toFixed(2)}</strong></span>
          <span style="font-size:12px;color:var(--txt3)">Outstanding: <strong style="color:${outstanding>0?'var(--yellow)':'var(--green)'}">${outstanding<=0?'£0 ✓':'£'+outstanding.toFixed(2)}</strong></span>
          <span style="font-size:12px;color:var(--txt3)">Total: <strong>£${invTotal.grand.toFixed(2)}</strong></span>
        </div>
      </div>
      <div style="padding:8px 14px;background:var(--s1)">
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;width:${pct.toFixed(0)}%;background:${pct>=100?'var(--green)':'var(--acc)'};border-radius:3px;transition:width .3s"></div>
        </div>
        <div style="font-size:10px;color:var(--txt3)">${pct.toFixed(0)}% paid</div>
      </div>
      ${pmts.length ? `
      <div style="padding:10px 14px">
        <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">Payment History</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:4px 8px 6px 0;color:var(--txt3);font-weight:600;font-size:10px">DATE</th>
            <th style="text-align:left;padding:4px 8px 6px;color:var(--txt3);font-weight:600;font-size:10px">AMOUNT</th>
            <th style="text-align:left;padding:4px 8px 6px;color:var(--txt3);font-weight:600;font-size:10px">METHOD</th>
            <th style="text-align:left;padding:4px 8px 6px;color:var(--txt3);font-weight:600;font-size:10px">REFERENCE</th>
          </tr></thead>
          <tbody>${pmts.map(p=>`
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:6px 8px 6px 0">${p.date||'—'}</td>
              <td style="padding:6px 8px;color:var(--green);font-weight:700">£${p.amount.toFixed(2)}</td>
              <td style="padding:6px 8px;color:var(--txt2)">${p.method||'—'}</td>
              <td style="padding:6px 8px;color:var(--txt3)">${p.ref||'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div style="padding:12px 14px;font-size:12px;color:var(--txt3)">No payments recorded yet.</div>`}
    `;
    // Append after the actions bar
    box.appendChild(section);
  }catch(e){ /* non-critical */ }
}


// ── Bulk mark Awaiting Payment → Paid ──
async function bulkMarkPaid(){
  const filter = document.getElementById('inv-filter')?.value||'';
  const search = (document.getElementById('inv-search')?.value||'').toLowerCase();
  let invs = await dAll('invoices');
  invs = invs.filter(i=>i.status==='Awaiting Payment');
  if(filter && filter!=='Awaiting Payment') invs = invs.filter(i=>i.status===filter);
  if(search) invs = invs.filter(i=>(i.clientName+i.number+i.description).toLowerCase().includes(search));
  if(!invs.length){ toast('No unpaid invoices to mark','info'); return; }
  if(!confirm(`Mark ${invs.length} invoice${invs.length!==1?'s':''} as Paid?\n\nThis will create a payment record for each.`)) return;
  const btn = document.querySelector('[onclick="bulkMarkPaid()"]');
  if(btn){btn.disabled=true;btn.textContent='Marking…';}
  let done=0;
  try{
    for(const inv of invs){
      const t=calcInvTotal(inv);
      await dPut('payments',{id:uid(),invId:inv.id,date:TODAY(),amount:t.grand,method:'Bank Transfer',ref:inv.number,recorded_by:_appUser?.name||'Office',created:Date.now()});
      await dPut('invoices',{...inv,status:'Paid'});
      done++;
    }
    toast(`✅ ${done} invoice${done!==1?'s':''} marked as Paid`,'success');
  }catch(e){
    toast('❌ Bulk paid failed: '+e.message.slice(0,80),'error');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='✓ Bulk Paid';}
    renderInvList();
    updateBadges();
  }
}

// ── Create a recurring invoice (copy with next month's dates) ──
async function createRecurringInv(id){
  const inv = await dGet('invoices', id);
  if(!inv) return;
  // Preserve the original invoice's numbering series — was always calling
  // nextInvNum() with no argument, so a recurring AGENCY invoice silently
  // got a landlord-series number instead of continuing the AGN- series.
  const newNum = await nextInvNum(inv.invoiceType==='agency');
  // Advance dates by 1 month
  const advanceMonth = (dateStr) => {
    if(!dateStr) return TODAY();
    const d = new Date(dateStr);
    d.setMonth(d.getMonth()+1);
    return d.toISOString().slice(0,10);
  };
  const newInv = {
    ...inv,
    id: uid(),
    number: newNum,
    date: advanceMonth(inv.date),
    dueDate: advanceMonth(inv.dueDate),
    status: 'Draft',
    created: Date.now(),
  };
  await dPut('invoices', newInv);
  toast(`✅ Recurring invoice created: ${newNum}`, 'success');
  renderInvList();
  setTimeout(()=>viewInv(newInv.id), 200);
}

// ── Send invoice via email immediately after saving ──
async function saveAndSendInv(){
  await saveInvWithJobSync();
  if(curInvId) setTimeout(()=>openInvSendModal(curInvId), 400);
}


// ── Find and delete duplicate invoices (same job ref + same amount + same date) ──
async function deleteDuplicateInvoices(){
  const invs = await dAll('invoices');
  // Group by: date + jobRef + clientName + total amount
  const seen = {};
  const dupes = [];
  invs.sort((a,b)=>a.created-b.created); // keep oldest
  invs.forEach(inv=>{
    const t = calcInvTotal(inv);
    const key = [inv.date||'', inv.jobRef||'', inv.clientName||'', t.grand.toFixed(2), inv.description||''].join('|');
    if(seen[key]){
      dupes.push(inv); // this one is a duplicate — mark for deletion
    } else {
      seen[key] = inv.id;
    }
  });
  if(!dupes.length){ toast('✅ No duplicate invoices found!','success'); return; }
  if(!confirm(`Found ${dupes.length} duplicate invoice${dupes.length!==1?'s':''} (same date, job, client and amount).\n\nThe oldest copy of each will be kept, duplicates will be deleted.\n\nProceed?`)) return;
  let deleted=0;
  for(const inv of dupes){
    try{ await dDel('invoices',inv.id); deleted++; }catch(e){ console.warn('[DeepFlow]', e); }
  }
  toast(`✅ Deleted ${deleted} duplicate invoice${deleted!==1?'s':''}. ${dupes.length-deleted>0?`${dupes.length-deleted} failed — try again.`:''}`, 'success', 5000);
  renderInvList();
  renderInvKPIs();
  updateBadges();
}


// ── Duplicate an invoice ──
async function duplicateInv(id){
  const inv = await dGet('invoices', id);
  if(!inv) return;
  // Same fix as createRecurringInv — keep the original's numbering series.
  const newNum = await nextInvNum(inv.invoiceType==='agency');
  const newInv = {
    ...inv,
    id: uid(),
    number: newNum,
    date: TODAY(),
    status: 'Draft',
    created: Date.now(),
  };
  // Set due date from settings
  const dd = new Date(); dd.setDate(dd.getDate()+(S.dueDays||14));
  newInv.dueDate = dd.toISOString().slice(0,10);
  await dPut('invoices', newInv);
  toast(`✅ Invoice copied as ${newNum}`, 'success');
  renderInvList();
  setTimeout(()=>viewInv(newInv.id), 200);
}

// ── Export all visible invoices to CSV ──
async function exportInvsCSV(){
  const filter = document.getElementById('inv-filter')?.value||'';
  const search = (document.getElementById('inv-search')?.value||'').toLowerCase();
  let invs = await dAll('invoices');
  if(filter) invs = invs.filter(i=>i.status===filter);
  if(search) invs = invs.filter(i=>(i.clientName+i.number+i.description).toLowerCase().includes(search));
  invs.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  const allPmts = await dAll('payments');
  const rows = [['Invoice #','Date','Due Date','Client','Description','Subtotal','VAT','Total','Paid','Outstanding','Status','Job Ref']];
  invs.forEach(inv=>{
    const t = calcInvTotal(inv);
    const paid = allPmts.filter(p=>p.invId===inv.id).reduce((s,p)=>s+p.amount,0);
    rows.push([
      inv.number, inv.date||'', inv.dueDate||'',
      inv.clientName||'', (inv.description||'').replace(/,/g,' '),
      t.sub.toFixed(2), t.vat.toFixed(2), t.grand.toFixed(2),
      paid.toFixed(2), Math.max(0,t.grand-paid).toFixed(2),
      inv.status||'', inv.jobRef||''
    ]);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'invoices-'+TODAY()+'.csv';
  a.click();
  toast(`✅ ${invs.length} invoices exported to CSV`, 'success');
}

// ── Send all overdue reminders via WhatsApp at once ──
// ── WhatsApp template preview & copy ────────────────────────────────────────
function _fillWaTpl(tpl, vars){
  return tpl.replace(/\{(\w+)\}/g, (m,k)=>vars[k]||m);
}

function previewWaTemplate(type){
  const tpls={job:S.waJobTpl,inv:S.waInvTpl,overdue:S.waOverdueTpl,tenant:S.waTenantTpl,landlord:S.waLandlordTpl};
  const tpl=tpls[type]||'(No template saved)';
  const vars={
    engineer_name:'Izhar Ahmed', address:'44 Myrtle Street, London, E1 1EU',
    time_slot:'9:00 – 11:00 AM', access:'Keys in office', contact:'07700 900123',
    description:'EICR Full Inspection', referrer:'Mandeep', company_name:S.coName||'GB Electricals',
    company_phone:S.coPhone||'+44 7865 753925',
    client_name:'N&N Properties', invoice_num:'INV-2009', amount:'£150.00',
    due_date:'21/07/2026', bank_details:`${S.bankName||'Barclays'} | ${S.bankAcc||'12345678'} | ${S.bankSort||'20-00-00'}`,
    days_overdue:'16', due_date_str:'05/07/2026',
    tenant_name:'John Smith', date:'Wednesday 18 Mar', engineer:'Izhar Ahmed',
    landlord_name:'Mandeep Singh',
  };
  const filled=_fillWaTpl(tpl,vars);
  const existing=document.getElementById('wa-preview-modal');
  if(existing) existing.remove();
  const div=document.createElement('div');
  div.id='wa-preview-modal';
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  div.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border2);border-radius:14px;padding:20px;max-width:420px;width:90%;box-shadow:var(--sh2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:var(--txt)">📱 Preview — how it will look</div>
      <button onclick="document.getElementById('wa-preview-modal').remove()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--txt3)">✕</button>
    </div>
    <div style="background:#dcfce7;border-radius:10px 10px 0 10px;padding:12px 14px;font-size:12px;line-height:1.7;white-space:pre-wrap;color:#1a1a1a;max-height:300px;overflow-y:auto">${filled.replace(/</g,'&lt;')}</div>
    <div style="font-size:10px;color:var(--txt3);margin-top:8px">Sample data used for preview. Real data filled at send time.</div>
    <button onclick="navigator.clipboard.writeText(${JSON.stringify(filled)});toast('Copied!','success',1500)" class="btn btn-ghost btn-sm" style="margin-top:10px">📋 Copy this message</button>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener('click',e=>{ if(e.target===div) div.remove(); });
}

async function copyWaTemplate(type){
  const tpls={tenant:S.waTenantTpl,landlord:S.waLandlordTpl};
  const tpl=tpls[type];
  if(!tpl){ toast('No template saved — save it first','warn'); return; }
  // Use last opened job if available
  const j=_lastOpenedJob||{};
  const vars={
    tenant_name:j.tenantName||j.tenantContact||'—',
    landlord_name:j.landlordName||'—',
    address:j.address||'—', date:j.date||'—', time_slot:j.timeSlot||'—',
    engineer:j.engineer||'—', description:j.description||'—',
    company_name:S.coName||'GB Electricals', company_phone:S.coPhone||'',
  };
  const msg=_fillWaTpl(tpl,vars);
  await navigator.clipboard.writeText(msg);
  toast('📋 Template copied with job data — paste into WhatsApp','success',3000);
}

async function sendAllOverdueWA(){
  const invs = await dAll('invoices');
  const today = TODAY();
  const overdue = invs.filter(i=>i.status==='Awaiting Payment' && i.dueDate && i.dueDate < today);
  if(!overdue.length){ toast('No overdue invoices to remind','info'); return; }
  const confirmed = confirm(`Send WhatsApp overdue reminders to ${overdue.length} client${overdue.length!==1?'s':''}?`);
  if(!confirmed) return;
  let sent = 0;
  for(const inv of overdue){
    const t = calcInvTotal(inv);
    const daysOver = Math.ceil((new Date(today)-new Date(inv.dueDate))/86400000);
    const msg = (S.waOverdueTpl||'Invoice {invoice_num} for £{amount} is {days_overdue} days overdue. Please arrange payment.')
      .replace('{invoice_num}',inv.number)
      .replace('{amount}',t.grand.toFixed(2))
      .replace('{days_overdue}',daysOver)
      .replace('{client_name}',inv.clientName||'')
      .replace('{due_date}',inv.dueDate||'')
      .replace('{company_name}',S.coName||'');
    const wa = inv.clientWA||'';
    if(wa){ window.open('https://wa.me/'+wa.replace(/[^0-9]/g,'')+'?text='+encodeURIComponent(msg),'_blank'); sent++; await new Promise(r=>setTimeout(r,600)); }
  }
  toast(`📱 Opened ${sent} WhatsApp reminders`, 'success');
}

// ── Invoice KPI summary for the header ──
// ── Job → Invoice reverse sync ────────────────────────────────────────────────
// Called directly from saveJob (awaited). Finds the linked invoice by jobId
// or linkedJobId and patches it when description/address changes.
async function _syncJobToInvoice(j){
  try{
    // Fetch all invoices fresh from Supabase (no cache)
    const rows = await _sb(`invoices?or=(linkedjobid.eq.${encodeURIComponent(j.id)},jobid.eq.${encodeURIComponent(j.id)})&limit=5`) || [];
    if(!rows.length) return; // No linked invoice — nothing to do

    const linked = _fromDb('invoices', rows[0]);
    const invPatch = {};
    const auditEntries = [];
    let needsDraft = false;

    // Description changed?
    const oldDesc = (linked.description||'').trim();
    const newDesc = (j.description||'').trim();
    if(newDesc && newDesc !== oldDesc){
      invPatch['description'] = newDesc;
      // Also update the first line item desc to match — line items ARE the description
      const updatedItems = JSON.parse(JSON.stringify(linked.items||[]));
      if(updatedItems.length > 0){
        updatedItems[0].desc = newDesc;
      } else {
        updatedItems.push({desc:newDesc, qty:1, unit:Number(linked.price)||0, vat:true});
      }
      invPatch['items'] = updatedItems;
      needsDraft = true;
      auditEntries.push({
        msg:`Job ${j.jobNum||''} description changed → Invoice "${linked.number}" updated`,
        type:'sync', oldVal:oldDesc, newVal:newDesc
      });
    }

    // Address changed?
    const oldAddr = (linked.jobAddress||linked.propertyAddress||'').trim();
    const newAddr = (j.address||'').trim();
    if(newAddr && newAddr !== oldAddr){
      invPatch['jobaddress'] = newAddr;
      invPatch['propertyaddress'] = newAddr;
      auditEntries.push({
        msg:`Job ${j.jobNum||''} address changed → Invoice "${linked.number}" property address updated`,
        type:'sync', oldVal:oldAddr, newVal:newAddr
      });
    }

    // Price changed? — sync to invoice with multi-item awareness
    const jobPrice = Number(j.price||0);
    const invTotal = calcInvTotal(linked).sub;
    if(jobPrice > 0 && Math.abs(jobPrice - invTotal) > 0.01){
      const itemCount = (linked.items||[]).length;
      if(itemCount <= 1){
        // Single item — update invoice freely (only send {items}, never computed totals)
        const updatedItems = JSON.parse(JSON.stringify(linked.items||[]));
        if(updatedItems.length > 0){
          updatedItems[0].unit = jobPrice;
        } else {
          updatedItems.push({desc:j.description||j.certTypes||'Work', qty:1, unit:jobPrice, vat:true});
        }
        invPatch['items'] = updatedItems;
        needsDraft = true;
        auditEntries.push({
          msg:`Job ${j.jobNum||''} price £${invTotal.toFixed(2)} → £${jobPrice.toFixed(2)} → Invoice "${linked.number}" updated`,
          type:'sync', oldVal:'£'+invTotal.toFixed(2), newVal:'£'+jobPrice.toFixed(2)
        });
      } else {
        // Multi-item invoice — show persistent notification, DON'T change anything automatically
        _showInvoiceMismatchNotice(linked.id, linked.number, itemCount, invTotal, jobPrice, j.description||'Work');
        auditEntries.push({
          msg:`Job ${j.jobNum||''} price £${jobPrice.toFixed(2)} differs from invoice "${linked.number}" total £${invTotal.toFixed(2)} — ${itemCount} items, user notified`,
          type:'warn'
        });
      }
    }

    // Move to Draft for review if something changed and not already Paid
    if(needsDraft && linked.status !== 'Draft' && linked.status !== 'Paid'){
      invPatch['status'] = 'Draft';
      auditEntries.push({
        msg:`Invoice "${linked.number}" moved back to Draft — job description changed, please review before sending`,
        type:'warn'
      });
    }

    if(!Object.keys(invPatch).length) return;

    // PATCH directly with lowercase DB column names
    await _sb(`invoices?id=eq.${encodeURIComponent(linked.id)}`,{
      method:'PATCH', body:invPatch, prefer:'return=minimal'
    });

    // Audit log
    const refs = {jobId:j.id, invId:linked.id, jobNum:j.jobNum||'', invNum:linked.number||''};
    for(const entry of auditEntries){
      await logActivity(entry.msg, entry.type, {...refs, oldVal:entry.oldVal||'', newVal:entry.newVal||''});
    }

    // User-visible toast
    const changed = [];
    if(invPatch.description) changed.push('description');
    if(invPatch.jobaddress)  changed.push('address');
    if(invPatch.items) changed.push('price updated');
    if(invPatch.status==='Draft') changed.push('↩ moved to Draft');
    toast(`🔗 ${linked.number} synced: ${changed.join(' · ')}`,'success',4000);

    // If the invoice preview is open, refresh it live after modal closes
    const _linkedInvId = linked.id;
    setTimeout(()=>{ if(typeof curInvId!=='undefined'&&curInvId===_linkedInvId) viewInv(_linkedInvId); }, 300);

  }catch(e){
    console.error('[DeepFlow] _syncJobToInvoice failed:', e);
    toast('⚠ Job saved but invoice sync failed — check console','warn',5000);
  }
}

// Persistent bottom-right notice when job price differs from multi-item invoice
// Much simpler than confirm2+Promise — user clicks "Open Invoice" at their leisure
function _showInvoiceMismatchNotice(invId, invNum, itemCount, invTotal, jobPrice, jobDesc){
  _ensureMismatchStyle(); // lazy-init animation style
  const existing = document.getElementById('inv-mismatch-'+invId);
  if(existing) existing.remove();
  const n = document.createElement('div');
  n.id = 'inv-mismatch-'+invId;
  n.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#fff;border:2px solid #f59e0b;border-radius:14px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.18);max-width:340px;font-size:13px;font-family:var(--fh);cursor:default;animation:_slideIn .3s ease';
  const itemLines = (function(){
    try{
      const inv = _invRowData?.[invId];
      if(!inv || !inv.items || !Array.isArray(inv.items)) return '';
      return inv.items.map((it,i) => `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:11px;color:#64748b"><span>${i+1}. ${it?.desc||'Item'}</span><span style="font-weight:600">£${(((it?.qty||1)*(it?.unit||0))||0).toFixed(2)}</span></div>`).join('');
    }catch(e){ return ''; }
  })();
  n.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <span style="font-size:20px">⚠️</span>
      <span style="font-weight:800;color:#92400e;font-size:14px">Amount Mismatch</span>
      <button onclick="document.getElementById('inv-mismatch-${invId}').remove()" style="margin-left:auto;background:none;border:none;font-size:16px;cursor:pointer;color:#94a3b8">✕</button>
    </div>
    <div style="background:#fef3c7;border-radius:8px;padding:10px 12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#64748b;font-size:11px">Job price</span><span style="font-weight:700;color:#1e293b">£${(Number(jobPrice)||0).toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:#64748b;font-size:11px">Invoice ${invNum}</span><span style="font-weight:700;color:#1e293b">£${(Number(invTotal)||0).toFixed(2)}</span></div>
      <div style="font-size:10px;color:#94a3b8;margin-top:4px">${itemCount||0} item${(itemCount||0)!==1?'s':''} in invoice</div>
    </div>
    ${itemLines ? `<div style="margin-bottom:10px;border-top:1px solid #e5e7eb;padding-top:8px">${itemLines}</div>` : ''}
    <button onclick="_openInvoiceFromJobSync('${invId}')" style="width:100%;background:var(--acc);color:#fff;border:none;border-radius:10px;padding:10px;font-weight:700;font-size:13px;cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">◎ Open Invoice</button>
  `;
  document.body.appendChild(n);
  // Auto-remove after 60 seconds
  setTimeout(() => { const el = document.getElementById('inv-mismatch-'+invId); if(el) el.remove(); }, 60000);
}

// Global function: close job modal → go to invoice → show specific invoice
// This is called from the mismatch notice OR from context menu
window._openInvoiceFromJobSync = function(invId){
  // 1. Remove the mismatch notice
  const notice = document.getElementById('inv-mismatch-'+invId);
  if(notice) notice.remove();
  // 2. Close job edit modal if open
  closeModal('mo-job');
  // 3. Navigate to invoice page
  nav('inv');
  // 4. Wait for invoice page to fully render, then switch to list view and show the invoice
  setTimeout(function(){
    // Switch from dashboard to "All Invoices" list view
    invNavSelect('all');
    // Now show the specific invoice in the preview panel
    setTimeout(function(){
      viewInv(invId);
    }, 200);
  }, 500);
};

// CSS animation for the notice — lazy singleton, safe for module-level
let _mismatchStyle = null;
function _ensureMismatchStyle(){
  if(_mismatchStyle) return;
  _mismatchStyle = document.createElement('style');
  _mismatchStyle.textContent = '@keyframes _slideIn{from{transform:translateX(120px);opacity:0}to{transform:translateX(0);opacity:1}}';
  if(document.head) document.head.appendChild(_mismatchStyle);
}

// Open job modal by job number (used from invoice cards)
async function openJobModalByNum(jobNum){
  if(!jobNum)return;
  const jobs=await dAll('jobs');
  const j=jobs.find(x=>(x.jobNum||x.jobnum||'')===jobNum);
  if(j){openJobModal(j.id);nav('jobs');}
  else{toast('Job '+jobNum+' not found','warn');}
}

// Open invoice by job ID (used from job context menu)
async function openInvoiceForJob(jobId){
  if(!jobId)return;
  const invs=await dAll('invoices');
  const inv=invs.find(i=>i.jobId===jobId||i.linkedJobId===jobId);
  if(inv){viewInv(inv.id);nav('inv');}
  else{toast('No invoice for this job yet','warn');}
}

// Toggle per-invoice sync with job
function toggleInvSync(enabled){
  const el=document.getElementById('inv-sync-indicator');
  if(el)el.textContent=enabled?'↔ Sync ON':'⊘ Sync OFF';
  toast(enabled?'Invoice will sync with job':'Invoice sync disabled','info',1500);
}



// ── Invoice type toggle ───────────────────────────────────────────────────────
function setInvType(type){
  _invType=type;
  document.querySelectorAll('.inv-type-tab').forEach(b=>{
    b.classList.toggle('active', b.id==='invtype-'+type);
  });
  renderInvSubnavKPIs();
  invNavSelect(_invNavMode);
}

// Filter invoices by current type toggle
function _filterByType(invs){
  if(_invType==='all') return invs;
  if(_invType==='agency')    return invs.filter(i=>i.invoiceType==='agency'||(i.agencyName&&!i.invoiceType));
  if(_invType==='landlord')  return invs.filter(i=>i.invoiceType==='landlord'||(!i.agencyName&&!i.invoiceType)||i.invoiceType==='');
  if(_invType==='proforma')  return invs.filter(i=>i.type==='proforma');
  if(_invType==='disposable')return invs.filter(i=>i.disposable===true);
  return invs;
}

// ── Invoice nav ───────────────────────────────────────────────────────────────
function invNavSelect(mode){
  _invNavMode=mode;
  document.querySelectorAll('.inv-nav-item').forEach(el=>{
    el.classList.toggle('active', el.id==='invnav-'+mode);
  });
  const special   = document.getElementById('inv-special-view');
  const listView  = document.getElementById('inv-list-view');
  const kanban    = document.getElementById('inv-kanban-view');
  const toolbar   = document.getElementById('inv-toolbar');
  const filterEl  = document.getElementById('inv-filter');

  // Hide everything first
  special.style.display='none';
  listView.style.display='none';
  kanban.style.display='none';
  if(toolbar) toolbar.style.display='';

  if(mode==='dashboard'){
    special.style.display='block';
    if(toolbar) toolbar.style.display='none';
    renderInvDashboard();
    return;
  }
  if(mode==='missing'){
    special.style.display='block';
    if(toolbar) toolbar.style.display='none';
    renderMissingInvoices();
    return;
  }
  if(mode==='jobsearch'){
    special.style.display='block';
    if(toolbar) toolbar.style.display='';
    renderJobNumberSearch();
    return;
  }
  if(mode==='creditadmin'){
    special.style.display='block';
    if(toolbar) toolbar.style.display='none';
    renderCreditNotesAdmin();
    return;
  }

  // List views
  const modeMap={all:'',draft:'Draft',unpaid:'Awaiting Payment',overdue:'__overdue__',paid:'Paid',cancelled:'Cancelled',disposable:'',creditadmin:''};  if(filterEl) filterEl.value=modeMap[mode]||'';

  if(invViewMode==='kanban'){
    kanban.style.display='';
  } else {
    listView.style.display='';
  }
  renderInvList();
}

// ── Invoice Dashboard ─────────────────────────────────────────────────────────
async function renderInvDashboard(){
  const el=document.getElementById('inv-special-view');
  el.innerHTML=`<div style="font-size:12px;color:var(--txt3)">Loading dashboard…</div>`;

  const [allInvs,allPmts,allJobs]=await Promise.all([dAll('invoices'),dAll('payments'),dAll('jobs')]);
  const invs=_filterByType(allInvs.filter(i=>!i.isCreditNote&&i.status!=='Credit Note'));
  const now=new Date();
  const today=TODAY();
  const thisMonth=today.slice(0,7);

  const byStatus=(s)=>invs.filter(i=>i.status===s);
  const draft      = byStatus('Draft');
  const unpaid     = byStatus('Awaiting Payment');
  const paid       = byStatus('Paid');
  const overdue    = unpaid.filter(i=>i.dueDate&&i.dueDate<today);
  const monthInvs  = invs.filter(i=>(i.date||'').startsWith(thisMonth));
  const sum=(arr)=>arr.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const paidAmt    = sum(paid);
  const unpaidAmt  = sum(unpaid);
  const monthAmt   = sum(monthInvs);
  const overdueAmt = sum(overdue);
  const paidThisMonth = allPmts.filter(p=>(p.date||'').startsWith(thisMonth)).reduce((s,p)=>s+p.amount,0);

  // Missing invoices count (type-aware)
  const invoicedJobIds=new Set([...allInvs.map(i=>i.jobId),...allInvs.map(i=>i.linkedJobId)].filter(Boolean));
  const completedJobs=allJobs.filter(j=>(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)&&!invoicedJobIds.has(j.id));
  const missingFiltered=_invType==='agency'?completedJobs.filter(j=>j.agencyName||j.agentName):
    _invType==='landlord'?completedJobs.filter(j=>!j.agencyName&&!j.agentName):completedJobs;

  const typeLbl=_invType==='agency'?'Agency':_invType==='landlord'?'Landlord':'All';

  const kpi=(val,lbl,col,onclick='')=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px 16px;cursor:${onclick?'pointer':'default'}" ${onclick?`onclick="${onclick}"`:''}
      onmouseover="if('${onclick}')this.style.borderColor='var(--acc)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="font-size:22px;font-weight:900;color:${col};line-height:1;margin-bottom:4px">${val}</div>
      <div style="font-size:10px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.4px">${lbl}</div>
    </div>`;

  const recentInvs=invs.slice(0,5);
  const topClients={};
  invs.forEach(i=>{const c=i.clientName||i.billToName||'—';topClients[c]=(topClients[c]||0)+calcInvTotal(i).grand;});
  const topClientsList=Object.entries(topClients).sort((a,b)=>b[1]-a[1]).slice(0,5);

  el.innerHTML=`
    <div style="max-width:900px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:17px;font-weight:800">${typeLbl} Invoice Dashboard</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:2px">${invs.length} invoices · ${thisMonth}</div>
        </div>
        <button class="btn btn-acc btn-sm" onclick="invNavSelect('jobsearch')">+ Invoice from Job No.</button>
      </div>

      <!-- KPIs row 1 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">
        ${kpi('£'+monthAmt.toLocaleString('en-GB',{maximumFractionDigits:0}),'Invoiced this month','var(--acc)',"invNavSelect('all')")}
        ${kpi('£'+paidThisMonth.toLocaleString('en-GB',{maximumFractionDigits:0}),'Collected this month','var(--green)',"invNavSelect('paid')")}
        ${kpi('£'+unpaidAmt.toLocaleString('en-GB',{maximumFractionDigits:0}),'Outstanding','var(--yellow)',"invNavSelect('unpaid')")}
        ${kpi('£'+overdueAmt.toLocaleString('en-GB',{maximumFractionDigits:0}),'Overdue','var(--red)',"invNavSelect('overdue')")}
      </div>
      <!-- KPIs row 2 -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${kpi(draft.length,'Draft',    'var(--txt2)' ,"invNavSelect('draft')")}
        ${kpi(unpaid.length,'Unpaid',  'var(--yellow)',"invNavSelect('unpaid')")}
        ${kpi(overdue.length,'Overdue','var(--red)'  ,"invNavSelect('overdue')")}
        ${kpi(missingFiltered.length,'Missing invoices','#f97316',"invNavSelect('missing')")}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Recent invoices -->
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;display:flex;justify-content:space-between">
            Recent invoices <span style="color:var(--acc);cursor:pointer;font-weight:500" onclick="invNavSelect('all')">View all →</span>
          </div>
          ${recentInvs.map(i=>{
            const t=calcInvTotal(i);
            const sc={Draft:'#94a3b8','Awaiting Payment':'#f59e0b',Paid:'#25d58e',Cancelled:'#e05252'}[i.status]||'#94a3b8';
            return`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="invNavSelect('all');setTimeout(()=>viewInv('${i.id}'),300)">
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;font-weight:700;color:var(--acc)">${i.number}</div>
                <div style="font-size:11px;color:var(--txt2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.clientName||'—'}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:12px;font-weight:700">£${t.grand.toFixed(0)}</div>
                <div style="font-size:9px;font-weight:700;color:${sc}">${i.status}</div>
              </div>
            </div>`;
          }).join('') || '<div style="font-size:11px;color:var(--txt3)">No invoices</div>'}
        </div>

        <!-- Top clients -->
        <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:14px">
          <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Top clients by value</div>
          ${topClientsList.map(([name,amt],i)=>`
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="width:18px;height:18px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#1a1a1a;flex-shrink:0">${i+1}</div>
              <div style="flex:1;font-size:11px;color:var(--txt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
              <div style="font-size:12px;font-weight:700">£${amt.toLocaleString('en-GB',{maximumFractionDigits:0})}</div>
            </div>`).join('') || '<div style="font-size:11px;color:var(--txt3)">No data</div>'}
        </div>
      </div>

      ${overdue.length?`
      <div style="background:rgba(224,82,82,.06);border:1px solid rgba(224,82,82,.25);border-radius:10px;padding:14px;margin-top:16px">
        <div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;display:flex;justify-content:space-between">
          🔴 Overdue (${overdue.length}) <span style="cursor:pointer;font-weight:500" onclick="invNavSelect('overdue')">View all →</span>
        </div>
        ${overdue.slice(0,3).map(i=>{
          const days=Math.ceil((now-new Date(i.dueDate))/86400000);
          return`<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(224,82,82,.15);font-size:11px;cursor:pointer" onclick="invNavSelect('all');setTimeout(()=>viewInv('${i.id}'),300)">
            <span style="font-weight:700;color:var(--acc)">${i.number}</span>
            <span style="flex:1;color:var(--txt)">${i.clientName||'—'}</span>
            <span style="color:var(--red);font-weight:700">${days}d overdue</span>
            <span style="font-weight:700">£${calcInvTotal(i).grand.toFixed(0)}</span>
          </div>`;}).join('')}
        ${overdue.length>3?`<div style="font-size:10px;color:var(--txt3);margin-top:6px;text-align:center">+ ${overdue.length-3} more overdue invoices</div>`:''}
      </div>`:''}
    </div>`;
}

async function renderInvSubnavKPIs(){
  const allInvs=await dAll('invoices');

  // Proforma-specific KPIs
  if(_invType==='proforma'){
    const proformas=allInvs.filter(i=>i.type==='proforma');
    const draft=proformas.filter(i=>i.status==='Draft').length;
    const sent=proformas.filter(i=>i.status==='Sent'||i.status==='Awaiting Payment').length;
    const converted=proformas.filter(i=>i.proformaConverted).length;
    const totalVal=proformas.reduce((s,i)=>s+calcInvTotal(i).grand,0);
    const topEl=document.getElementById('inv-topbar-kpis');
    if(topEl){
      topEl.innerHTML=`
      <div class="inv-topbar-kpi" onclick="setInvFilter('Draft');renderInvList()" title="Draft proformas">
        <span class="k-val" style="color:#94a3b8">${draft}</span>
        <span class="k-lbl">Draft</span><span class="k-arrow">›</span>
      </div>
      <div class="inv-topbar-kpi" onclick="setInvFilter('Awaiting Payment');renderInvList()" title="Sent proformas">
        <span class="k-val" style="color:#f59e0b">${sent}</span>
        <span class="k-lbl">Sent</span><span class="k-arrow">›</span>
      </div>
      <div class="inv-topbar-kpi" title="Converted to invoices" style="${converted?'':'opacity:.45;pointer-events:none'}">
        <span class="k-val" style="color:var(--green)">${converted}</span>
        <span class="k-lbl">Converted</span>${converted?'<span class="k-arrow">›</span>':''}
      </div>
      <div class="inv-topbar-kpi" title="Total proforma value">
        <span class="k-val" style="color:#a855f7">£${totalVal.toLocaleString('en-GB',{maximumFractionDigits:0})}</span>
        <span class="k-lbl">Total Value</span>
      </div>`;
    }
    const el=document.getElementById('inv-subnav-kpis');
    if(el) el.innerHTML='';
    return;
  }

  const invs=_filterByType(allInvs.filter(i=>!i.isCreditNote&&i.status!=='Credit Note'));
  const now=new Date();
  const today=TODAY();
  const draft=invs.filter(i=>i.status==='Draft').length;
  const unpaid=invs.filter(i=>i.status==='Awaiting Payment').length;
  const overdue=invs.filter(i=>i.status==='Awaiting Payment'&&i.dueDate&&i.dueDate<today).length;
  const paidAmt=invs.filter(i=>i.status==='Paid').reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const unpaidAmt=invs.filter(i=>i.status==='Awaiting Payment').reduce((s,i)=>s+calcInvTotal(i).grand,0);

  // Topbar KPI strip — always visible, all items clickable
  const topEl=document.getElementById('inv-topbar-kpis');
  if(topEl){
    // Count missing invoices for the strip
    const allJobs2=await dAll('jobs');
    const allInvs2=await dAll('invoices');
    const invoicedIds2=new Set([...allInvs2.map(i=>i.jobId),...allInvs2.map(i=>i.linkedJobId)].filter(Boolean));
    const missing2=_filterByType(allJobs2.filter(j=>(j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)&&!invoicedIds2.has(j.id))).length;

    topEl.innerHTML=`
    <div class="inv-topbar-kpi" onclick="invNavSelect('draft')"  title="View Draft invoices — click to open">
      <span class="k-val" style="color:#94a3b8">${draft}</span>
      <span class="k-lbl">Draft</span><span class="k-arrow">›</span>
    </div>
    <div class="inv-topbar-kpi" onclick="invNavSelect('unpaid')" title="View Awaiting Payment — click to open">
      <span class="k-val" style="color:#f59e0b">${unpaid}</span>
      <span class="k-lbl">Unpaid</span><span class="k-arrow">›</span>
    </div>
    <div class="inv-topbar-kpi" onclick="invNavSelect('overdue')" title="View Overdue invoices — click to open" style="${overdue?'':'opacity:.45;pointer-events:none'}">
      <span class="k-val" style="color:var(--red)">${overdue}</span>
      <span class="k-lbl">Overdue</span>${overdue?'<span class="k-arrow">›</span>':''}
    </div>
    <div class="inv-topbar-kpi" onclick="invNavSelect('paid')"   title="View Paid invoices — click to open">
      <span class="k-val" style="color:var(--green)">£${paidAmt.toLocaleString('en-GB',{maximumFractionDigits:0})}</span>
      <span class="k-lbl">Paid</span><span class="k-arrow">›</span>
    </div>
    <div class="inv-topbar-kpi" onclick="invNavSelect('unpaid')" title="Total outstanding — click to open" style="${unpaidAmt>0?'':'opacity:.45;pointer-events:none'}">
      <span class="k-val" style="color:#f59e0b">£${unpaidAmt.toLocaleString('en-GB',{maximumFractionDigits:0})}</span>
      <span class="k-lbl">Outstanding</span>${unpaidAmt>0?'<span class="k-arrow">›</span>':''}
    </div>
    <div class="inv-topbar-kpi" onclick="invNavSelect('missing')" title="Jobs without invoices — click to open" style="${missing2?'':'opacity:.45;pointer-events:none'}">
      <span class="k-val" style="color:#f97316">${missing2}</span>
      <span class="k-lbl">Missing</span>${missing2?'<span class="k-arrow">›</span>':''}
    </div>`;
  }

  const el=document.getElementById('inv-subnav-kpis');
  if(el) el.innerHTML='';
}

async function renderMissingInvoices(){
  const el=document.getElementById('inv-special-view');
  el.innerHTML=`<div style="font-size:15px;font-weight:800;margin-bottom:16px">⚠️ Jobs Without Invoices</div><div style="color:var(--txt3);font-size:12px">Scanning…</div>`;
  const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
  const invoicedIds=new Set([
    ...allInvs.map(i=>i.jobId).filter(Boolean),
    ...allInvs.map(i=>i.linkedJobId).filter(Boolean),
    ...allJobs.filter(j=>j.invNumber||j.linkedInvId).map(j=>j.id)
  ]);
  let missing=allJobs.filter(j=>
    (j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED)&&
    !invoicedIds.has(j.id)
  );
  // Apply type filter
  if(_invType==='agency')   missing=missing.filter(j=>j.agencyName||j.agentName);
  if(_invType==='landlord') missing=missing.filter(j=>!j.agencyName&&!j.agentName);
  missing=missing.sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  if(!missing.length){
    el.innerHTML=`<div style="text-align:center;padding:40px 0">
      <div style="font-size:40px;margin-bottom:10px">✅</div>
      <div style="font-size:16px;font-weight:700;color:var(--green)">All completed jobs have invoices!</div>
    </div>`;
    return;
  }
  el.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div>
        <div style="font-size:15px;font-weight:800">⚠️ Missing Invoices</div>
        <div style="font-size:12px;color:var(--txt3);margin-top:3px">${missing.length} completed job${missing.length!==1?'s':''} without an invoice</div>
      </div>
    </div>
    ${missing.map(j=>`
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:14px;box-shadow:var(--sh)">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <span style="font-size:10px;font-weight:700;color:var(--acc);font-family:ui-monospace,monospace;background:var(--acc-soft);padding:2px 7px;border-radius:4px">${escHtml(j.jobNum)||'—'}</span>
            <span style="font-size:11px;color:var(--txt3)">${j.date?new Date(j.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}</span>
            ${j.engineer?`<span style="font-size:11px;color:var(--txt2)">👷 ${escHtml(j.engineer)}</span>`:''}
          </div>
          <div style="font-size:14px;font-weight:700;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.address)||'—'}</div>
          <div style="font-size:12px;color:var(--txt2)">${escHtml(j.description)||''}</div>
          <div style="font-size:11px;color:var(--txt3);margin-top:3px">${escHtml(j.landlordName||j.referrer||'')} ${j.agencyName?'· '+escHtml(j.agencyName):''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <span style="font-size:14px;font-weight:900;color:var(--txt)">£${Number(j.price||0).toFixed(2)}</span>
          <button class="btn btn-acc btn-sm" onclick="createInvFromJob('${j.id}')">+ Create Invoice</button>
        </div>
      </div>`).join('')}`;
}

async function renderJobNumberSearch(){
  const el=document.getElementById('inv-special-view');
  el.innerHTML=`
    <div style="max-width:500px">
      <div style="font-size:15px;font-weight:800;margin-bottom:6px">🔍 Find Invoice by Job Number</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:16px">Enter a job number to find its invoice or create one</div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        <input class="fi" id="job-inv-search-inp" placeholder="e.g. JOB-1082" style="flex:1" onkeydown="if(event.key==='Enter')searchJobForInvoice()">
        <button class="btn btn-acc" onclick="searchJobForInvoice()">Search</button>
      </div>
      <div id="job-inv-search-result"></div>
    </div>`;
}

async function searchJobForInvoice(){
  const val=(document.getElementById('job-inv-search-inp')?.value||'').trim().toUpperCase();
  const res=document.getElementById('job-inv-search-result');
  if(!val||!res)return;
  res.innerHTML=`<div style="color:var(--txt3);font-size:12px">Searching…</div>`;
  const [allJobs,allInvs]=await Promise.all([dAll('jobs'),dAll('invoices')]);
  const job=allJobs.find(j=>(j.jobNum||'').toUpperCase()===val||(j.jobNum||'').toUpperCase().includes(val));
  if(!job){res.innerHTML=`<div style="color:var(--red);font-size:13px;padding:12px 0">❌ No job found matching "${val}"</div>`;return;}
  const inv=allInvs.find(i=>i.jobId===job.id||i.linkedJobId===job.id||(i.jobNum||'').toUpperCase()===(job.jobNum||'').toUpperCase());
  res.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Job Found</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">${job.address||'—'}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--txt2);margin-bottom:6px">
        <span>${job.jobNum||''}</span>
        <span>${job.date||''}</span>
        <span>${job.description||''}</span>
        <span>${job.engineer?'👷 '+job.engineer:''}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:700">£${Number(job.price||0).toFixed(2)}</span>
        <span style="font-size:11px;color:var(--txt3)">${job.landlordName||job.referrer||''}</span>
      </div>
    </div>
    ${inv?`
    <div style="background:var(--gbg);border:1px solid var(--gbd);border-radius:var(--r2);padding:14px;display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">✅ Invoice Exists</div>
        <div style="font-size:14px;font-weight:700">${inv.number}</div>
        <div style="font-size:12px;color:var(--txt2)">Status: ${inv.status} · £${calcInvTotal(inv).grand.toFixed(2)}</div>
      </div>
      <button class="btn btn-acc btn-sm" onclick="viewInv('${inv.id}');invNavSelect('all')">Open Invoice</button>
    </div>`:`
    <div style="background:var(--ybg);border:1px solid var(--ybd);border-radius:var(--r2);padding:14px;display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <div style="font-size:10px;font-weight:700;color:var(--yel);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">⚠️ No Invoice Yet</div>
        <div style="font-size:12px;color:var(--txt2)">This job has no invoice. Click to create one.</div>
      </div>
      <button class="btn btn-acc btn-sm" onclick="createInvFromJob('${job.id}')">Create Invoice</button>
      <button class="btn btn-ghost btn-sm" onclick="createProforma('${job.id}')">📄 Proforma</button>
    </div>`}`;
}

async function renderInvKPIs(){
  renderInvSubnavKPIs();
  const el=document.getElementById('inv-kpis');
  if(el) el.innerHTML='';
  // Populate the new KPI card row
  try{
    const invs=await dAll('invoices');
    const filtered=_filterByType?(_filterByType(invs)||invs):invs;
    const now=new Date();
    const monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
    let total=0,outstanding=0,overdue=0,drafts=0,paidMonth=0;
    filtered.forEach(inv=>{
      const t=calcInvTotal(inv);
      total+=t.grand;
      if(inv.status==='Draft') drafts++;
      else if(inv.status==='Paid'&&inv.paidDate&&new Date(inv.paidDate).getTime()>=monthStart) paidMonth+=t.grand;
      else if(inv.status==='Overdue') overdue+=t.grand;
      else if(inv.status==='Awaiting Payment') outstanding+=t.grand;
    });
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
    set('inv-kpi-total','£'+total.toLocaleString('en-GB',{maximumFractionDigits:0}));
    set('inv-kpi-outstanding','£'+outstanding.toLocaleString('en-GB',{maximumFractionDigits:0}));
    set('inv-kpi-overdue','£'+overdue.toLocaleString('en-GB',{maximumFractionDigits:0}));
    set('inv-kpi-drafts',String(drafts));
    set('inv-kpi-paid-month','£'+paidMonth.toLocaleString('en-GB',{maximumFractionDigits:0}));
  }catch(e){console.warn('KPI render error',e);}
}

function setInvFilter(val){
  const el=document.getElementById('inv-filter');
  if(el)el.value=val;
  // Update pill visuals
  document.querySelectorAll('.inv-pill').forEach(p=>p.classList.remove('active'));
  const pillMap={'':'invpill-all','Draft':'invpill-draft','Awaiting Payment':'invpill-awaiting','Paid':'invpill-paid','__overdue__':'invpill-overdue'};
  const pid=pillMap[val||''];
  if(pid){const p=document.getElementById(pid);if(p)p.classList.add('active');}
  renderInvList();
}


// Thin wrapper — the math itself now lives in @business as
// calcLineItemsTotal(), shared with Client Portal's calcTotal(). 84 call
// sites throughout this file reference calcInvTotal() by this name.
export function calcInvTotal(inv){
  return calcLineItemsTotal(inv.items||[], getVatRate());
}

async function viewInv(id){
  curInvId=id;
  const inv=await dGet('invoices',id);
  if(!inv)return;
  const t=calcInvTotal(inv);
  const vr=getVatRate();
  const box=document.getElementById('inv-detail-box');
  const isPaid=inv.status==='Paid';
  const logo=S.logoData?`<img src="${S.logoData}" style="height:44px;object-fit:contain;margin-bottom:6px;display:block">`:
    `<div style="font-size:24px;font-weight:900;color:var(--acc);letter-spacing:-1px">${S.coName||'DF'}</div>`;
  const statusColors={'Draft':'#94a3b8','Awaiting Payment':'#f59e0b','Paid':'#25d58e','Cancelled':'#e05252','Credit Note':'#7c3aed'};
  const sc=inv.type==='proforma'?'#a855f7':(statusColors[inv.status]||'#94a3b8');

  // Editable field helper — click to edit, blur to save
  const ef=(field,val,opts={})=>{
    const tag=opts.multi?'textarea':'input';
    const style=opts.style||'';
    const cls=opts.cls||'';
    return `<${tag} class="inv-live-field ${cls}" data-field="${field}" data-invid="${id}"
      style="background:transparent;border:none;outline:none;width:100%;font:inherit;color:inherit;resize:none;padding:0;${style}"
      ${opts.multi?`rows="2"`:`type="${opts.type||'text'}"`}
      onfocus="this.style.background='#fff8f0';this.style.borderBottom='2px solid var(--acc)';this.style.borderRadius='3px'"
      onblur="this.style.background='transparent';this.style.borderBottom='';this.style.borderRadius='';_saveInvField(this)"
      onkeydown="if(!event.shiftKey&&event.key==='Enter'){event.preventDefault();this.blur()}"
      value="${(val||'').replace(/"/g,'&quot;')}">${opts.multi?(val||''):''}${opts.multi?`</${tag}>`:''}`;
  };

  box.innerHTML=`
  <div style="background:#fff;font-family:'Segoe UI',system-ui,sans-serif;border-radius:var(--r2);overflow:hidden;box-shadow:0 0 0 1px var(--border);position:relative">

    <!-- LIVE EDIT BANNER -->
    <div style="background:linear-gradient(90deg,var(--acc),#3b82f6);color:#fff;padding:6px 16px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:8px">
      <span>✏️ Live Preview — click any field to edit · autosaves</span>
      <span style="margin-left:auto;font-size:10px;opacity:.8;display:flex;align-items:center;gap:6px">
        <span id="inv-save-indicator"></span>
        <span id="inv-sync-indicator" style="font-size:10px;color:var(--green)">↔ Sync ON</span>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px">
          <input type="checkbox" id="inv-sync-toggle" checked onchange="toggleInvSync(this.checked)" style="margin:0">
          Sync with job
        </label>
      </span>
    </div>

    <!-- INVOICE HEADER -->
    <div style="padding:22px 24px 16px;background:linear-gradient(135deg,#fafafa,#fff);border-bottom:1px solid #e5e7eb;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start">
      <div>
        ${logo}
        <div style="font-weight:800;font-size:14px;color:#1e293b;margin-bottom:2px">${S.coName||'Your Company'}</div>
        <div style="font-size:11px;color:#64748b">${S.coAddr||''}</div>
        <div style="font-size:11px;color:#64748b">${S.coPhone||''} ${S.coEmail?'· '+S.coEmail:''}${S.coWeb?' · '+S.coWeb:''}</div>
        ${(S.coVatNum&&S.vatEnabled!==false)?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">VAT: ${S.coVatNum}</div>`:''}
        ${S.coReg?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">Company No: ${S.coReg}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:2px">${inv.type==='proforma'?'PROFORMA INVOICE':'TAX INVOICE'}</div>
        <div style="font-size:26px;font-weight:900;color:var(--acc);letter-spacing:-1px">${inv.number}</div>
        <div style="display:inline-block;background:${sc}20;color:${sc};border:1px solid ${sc}40;border-radius:20px;padding:3px 12px;font-size:11px;font-weight:700;margin-top:4px">${inv.status}</div>
        ${inv.proformaOf?`<div style="font-size:10px;color:#94a3b8;margin-top:4px">Based on job: ${inv.proformaOf}</div>`:''}
        <div style="margin-top:8px;font-size:11px;color:#64748b">
          <div>Issued: ${ef('date',inv.date,{style:'font-size:11px;text-align:right;width:130px',type:'date'})}</div>
          <div>Due: ${ef('dueDate',inv.dueDate,{style:'font-size:11px;text-align:right;width:130px',type:'date'})}</div>
        </div>
      </div>
    </div>

    <!-- LINKED JOB CARD (compact, prominent) -->
    ${inv.jobId?`<div style="padding:10px 24px;background:#f0f7ff;border-bottom:1px solid #dbeafe;display:flex;align-items:center;gap:12px">
      <div style="font-size:18px">🔗</div>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:#1e293b">Linked to ${inv.jobNum||'Job'}</div>
        <div style="font-size:10px;color:#64748b">${inv.jobAddress||''} · ${inv.engineer||''} · ${inv.certTypes||''}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="openJobModal('${inv.jobId}')" style="font-size:11px">View Job</button>
    </div>`:''}

    <!-- BILL TO + PROPERTY + JOB DETAILS (3 columns) -->
    <div style="padding:14px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;border-bottom:1px solid #e5e7eb;background:#f8fafc">
      <!-- BILL TO -->
      <div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">BILL TO</div>
        <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:3px">${ef('clientName',inv.clientName||inv.billToName||'',{style:'font-size:13px;font-weight:700'})}</div>
        <div style="font-size:11px;color:#64748b">${ef('billToAddress',inv.billToAddress||inv.clientAddr||'',{style:'font-size:11px;color:#64748b',multi:true})}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:3px">${ef('clientEmail',inv.clientEmail||'',{style:'font-size:11px;color:#64748b'})}</div>
      </div>
      <!-- PROPERTY -->
      <div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">PROPERTY</div>
        <div style="font-size:12px;font-weight:600;color:#1e293b">${ef('jobAddress',inv.jobAddress||inv.propertyAddress||'',{style:'font-size:12px',multi:true})}</div>
        ${inv.agentName?`<div style="font-size:11px;color:#64748b;margin-top:4px">Agent: ${ef('agentName',inv.agentName,{style:'font-size:11px'})}</div>`:''}
      </div>
      <!-- JOB DETAILS -->
      <div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">JOB DETAILS</div>
        <div style="font-size:11px;color:#64748b;line-height:1.8">
          ${inv.jobNum?`<div>Job No: <strong>${inv.jobNum}</strong></div>`:''}
          ${inv.jobDate?`<div>Completed: <strong>${new Date(inv.jobDate+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</strong></div>`:''}
          ${inv.engineer?`<div>Engineer: <strong>${inv.engineer}</strong></div>`:''}
          ${inv.certTypes?`<div>Work: <strong>${inv.certTypes}</strong></div>`:''}
        </div>
      </div>
    </div>

    <!-- LINE ITEMS -->
    <div style="padding:14px 24px;border-bottom:1px solid #e5e7eb" id="inv-live-items-${id}">
      <div style="display:grid;grid-template-columns:1fr 60px 90px ${S.vatEnabled!==false?'60px ':'0px '}90px 28px;gap:4px;margin-bottom:6px">
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px">Description</div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;text-align:center">Qty</div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;text-align:right">Unit £</div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;text-align:center;${S.vatEnabled!==false?'':'display:none!important'}">VAT</div>
        <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;text-align:right">Total</div>
        <div></div>
      </div>
      ${_renderLiveItems(inv,id)}
      <button onclick="_addLiveItem('${id}')" style="margin-top:8px;background:transparent;border:1px dashed var(--border2);border-radius:6px;padding:5px 12px;font-size:11px;color:var(--txt3);cursor:pointer;width:100%;transition:.15s" onmouseover="this.style.borderColor='var(--acc)';this.style.color='var(--acc)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--txt3)'">+ Add line item</button>
    </div>

    <!-- TOTALS -->
    <div style="padding:14px 24px;display:flex;justify-content:flex-end;border-bottom:1px solid #e5e7eb">
      <div style="min-width:220px">
        <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:#64748b"><span>Subtotal</span><span>£${t.sub.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;color:#64748b;${S.vatEnabled!==false?'':'display:none!important'}"><span>VAT (${vr}%)</span><span>£${t.vat.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0 3px;font-size:16px;font-weight:900;color:#1e293b;border-top:2px solid #1e293b;margin-top:4px" id="inv-live-total-${id}"><span>TOTAL</span><span>£${t.grand.toFixed(2)}</span></div>
        ${isPaid?'<div style="text-align:right;color:#25d58e;font-size:11px;font-weight:700;margin-top:4px">✓ PAID</div>':''}
      </div>
    </div>

    <!-- NOTES / TERMS -->
    <div style="padding:10px 24px 12px;border-bottom:1px solid #e5e7eb;background:#fafafa">
      <div style="font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Payment Notes &amp; Terms <span style="font-size:8px;color:#94a3b8;font-weight:600">invoice only</span></div>
      ${ef('notes',inv.notes||S.invNotes||S.payTerms||'',{style:'font-size:12px;color:#64748b;line-height:1.6',multi:true})}
    </div>

    <!-- PAYMENT REF -->
    ${inv.type==='proforma'?`
    <div style="padding:10px 24px;background:linear-gradient(90deg,#f3e8ff,#fff);border-bottom:1px solid #d8b4fe;font-size:11px;color:#7e22ce;font-weight:600">
      📄 This is a <strong>PROFORMA INVOICE</strong> (quotation) — not a final tax invoice
    </div>`:`
    <div style="padding:10px 24px;background:linear-gradient(90deg,#fffbeb,#fff);border-bottom:1px solid #fde68a;font-size:11px;color:#92400e;font-weight:600">
      💳 Please use invoice number <strong>${inv.number}</strong> as your payment reference
    </div>`}

    <!-- BANKING -->
    ${S.bankName||S.bankAcc?`<div style="padding:10px 24px;font-size:11px;color:#64748b;border-bottom:1px solid #e5e7eb;display:flex;gap:20px;flex-wrap:wrap">
      <span>🏦 ${S.bankName||''}</span>
      ${S.bankAcc?`<span>Acc: ${S.bankAcc}</span>`:''}
      ${S.bankSort?`<span>Sort: ${S.bankSort}</span>`:''}
      ${S.bankIBAN?`<span>IBAN: ${S.bankIBAN}</span>`:''}
    </div>`:''}

    <!-- ACTIONS -->
    <div style="padding:10px 14px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:var(--s2);border-top:2px solid var(--border)">
      ${inv.type==='proforma'?`<button class="btn btn-acc btn-sm" onclick="convertProformaToInvoice('${id}')">🧾 Convert to Invoice</button>`:''}
      ${inv.clientName&&inv.type!=='proforma'?`<button class="btn btn-ghost btn-sm" onclick="nav('stmt');setTimeout(()=>{const el=document.getElementById('stmt-landlord');if(el){el.value='${(inv.clientName||'').replace(/'/g,"\\'")}';renderStmt();}},300)">📋 Client Stmt</button>`:''}
      ${!isPaid&&inv.type!=='proforma'?`<button class="btn btn-green btn-sm" onclick="markInvPaid('${id}')">✓ Mark Paid</button>`:''}
      ${!isPaid&&inv.type!=='proforma'?`<button class="btn btn-blue btn-sm" onclick="openPaymentModal('${id}')">💳 Record Payment</button>`:''}
      ${isPaid?`<button class="btn btn-ghost btn-sm" onclick="markInvUnpaid('${id}')">↩ Unpaid</button>`:''}
      ${inv.status==='Draft'&&inv.type!=='proforma'?`<button class="btn btn-ghost btn-sm" onclick="markInvSent('${id}')">Mark Sent</button>`:''}
      <button class="btn btn-wa btn-sm" onclick="openInvSendModal('${id}')">📱 Send / Share</button>
      <button class="btn btn-ghost btn-sm" onclick="downloadInvPDFById('${id}')">⬇ PDF</button>
      ${inv.type!=='proforma'?`<button class="btn btn-ghost btn-sm" onclick="createRecurringInv('${id}')">↻ Recurring</button>`:''}
      ${inv.type==='proforma'?`<button class="btn btn-ghost btn-sm" onclick="printProforma('${id}')">🖨 Print</button>`:''}
      <button class="btn btn-red btn-sm" style="margin-left:auto" onclick="deleteInv('${id}')">Delete</button>
    </div>

    <!-- PAYMENT STATUS -->
    <div style="padding:12px 18px" id="inv-payment-status-${id}">
      <div style="font-size:10px;font-weight:700;color:var(--txt3);margin-bottom:6px">PAYMENT STATUS</div>
    </div>

    <!-- AUDIT TRAIL -->
    <div style="padding:12px 18px;border-top:1px solid var(--border)" id="inv-audit-trail-${id}">
      <div style="font-size:10px;font-weight:700;color:var(--txt3);margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        AUDIT TRAIL
        <span style="font-size:9px;font-weight:400;opacity:.7">auto-updates</span>
      </div>
      <div style="font-size:11px;color:var(--txt3)">Loading…</div>
    </div>
  </div>`;

  _renderInvPayments(id,t);
  _renderInvAuditTrail(id, inv);
}

// ── Live invoice editing helpers ──────────────────────────────────────────────
function _renderLiveItems(inv,id){
  const vr=getVatRate();
  const vatOn=S.vatEnabled!==false;
  return (inv.items||[]).map((item,i)=>{
    const l=(item.qty||1)*(item.unit||0);
    const v=item.vat?l*vr/100:0;
    return`<div style="display:grid;grid-template-columns:1fr 60px 90px ${vatOn?'60px ':'0px '}90px 28px;gap:4px;margin-bottom:4px;align-items:center" id="inv-item-row-${id}-${i}">
      <input class="inv-live-item" data-invid="${id}" data-idx="${i}" data-key="desc"
        style="font-size:12px;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:4px 7px;width:100%"
        value="${(item.desc||'').replace(/"/g,'&quot;')}"
        onblur="_saveLiveItem(this)" onkeydown="if(event.key==='Enter')this.blur()">
      <input class="inv-live-item" data-invid="${id}" data-idx="${i}" data-key="qty" type="number"
        style="font-size:12px;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:4px 5px;text-align:center;width:100%"
        value="${item.qty||1}" oninput="_updateLiveTotal('${id}')" onblur="_saveLiveItem(this)">
      <input class="inv-live-item" data-invid="${id}" data-idx="${i}" data-key="unit" type="number" step="0.01"
        style="font-size:12px;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:4px 5px;text-align:right;width:100%"
        value="${Number(item.unit||0).toFixed(2)}" oninput="_updateLiveTotal('${id}')" onblur="_saveLiveItem(this)">
      <div style="text-align:center;${vatOn?'':'display:none!important'}">
        <input type="checkbox" ${item.vat?'checked':''} class="inv-live-item" data-invid="${id}" data-idx="${i}" data-key="vat"
          style="accent-color:var(--acc)" onchange="_saveLiveItem(this);_updateLiveTotal('${id}')">
      </div>
      <div style="font-size:12px;font-weight:700;text-align:right;color:#1e293b" id="inv-item-total-${id}-${i}">£${(l+v).toFixed(2)}</div>
      <button onclick="_removeLiveItem('${id}',${i})" style="background:transparent;border:none;color:#e05252;cursor:pointer;font-size:14px;padding:0;line-height:1" title="Remove">✕</button>
    </div>`;
  }).join('');
}



async function _saveInvField(el){
  const field=el.dataset.field;
  const invId=el.dataset.invid;
  if(!field||!invId)return;
  const val=el.type==='checkbox'?el.checked:(el.value||'');
  const ind=document.getElementById('inv-save-indicator');
  if(ind)ind.textContent='Saving…';
  clearTimeout(_invSaveTimer[invId]);
  _invSaveTimer[invId]=setTimeout(async()=>{
    try{
      // Map camelCase field name to Supabase lowercase column name
      const _dbField=(_TO_DB.invoices||{})[field]||field;
      const _body={[_dbField]:val};
      await _sb(`invoices?id=eq.${encodeURIComponent(invId)}`,{method:'PATCH',body:_body,prefer:'return=minimal'});
      _invalidateCache('invoices');
      if(ind)ind.textContent='✓ Saved';
      setTimeout(()=>{if(ind)ind.textContent='';},2000);
      // Audit log for description changes
      if(_dbField==='description'){
        const inv=await dGet('invoices',invId);
        logActivity(`Invoice description edited`,`sync`,{invId,invNum:inv?.number||'',jobId:inv?.linkedJobId||'',jobNum:inv?.jobNum||''});
      }
      // Sync field change to linked job (silently for text, popup for price)
      try{await _syncInvoiceFieldToJob(invId, _dbField, val);}catch(e){console.warn('[DeepFlow] Invoice→Job sync failed:',e);toast('⚠ Sync failed — check console','warn',3000);}
    }catch(e){if(ind)ind.textContent='⚠ Save failed';console.warn('[DeepFlow]',e);}
  },600);
}

async function _saveLiveItem(el){
  const invId=el.dataset.invid;
  const idx=parseInt(el.dataset.idx);
  const key=el.dataset.key;
  const inv=await dGet('invoices',invId);
  if(!inv)return;
  const items=JSON.parse(JSON.stringify(inv.items||[]));
  if(!items[idx])return;
  if(key==='vat') items[idx].vat=el.checked;
  else if(key==='qty') items[idx].qty=parseFloat(el.value)||1;
  else if(key==='unit') items[idx].unit=parseFloat(el.value)||0;
  else items[idx][key]=el.value;
  const ind=document.getElementById('inv-save-indicator');
  if(ind)ind.textContent='Saving…';
  clearTimeout(_invSaveTimer[invId+'items']);
  _invSaveTimer[invId+'items']=setTimeout(async()=>{
    try{
      await _sb(`invoices?id=eq.${encodeURIComponent(invId)}`,{method:'PATCH',body:{items},prefer:'return=minimal'});
      // Combined description = all line item descs joined — this IS the job description
      const combinedDesc = items.map(i=>i.desc).filter(Boolean).join('; ');
      if(combinedDesc){
        await _sb(`invoices?id=eq.${encodeURIComponent(invId)}`,{method:'PATCH',body:{description:combinedDesc},prefer:'return=minimal'});
      }
      _invalidateCache('invoices');
      if(ind)ind.textContent='✓ Saved';
      setTimeout(()=>{if(ind)ind.textContent='';},2000);
      // Audit log for price/amount changes
      if(key==='unit'||key==='qty'){
        const inv2=await dGet('invoices',invId).catch(()=>null);
        if(inv2){
          const oldTotal=calcInvTotal(inv).grand;
          const newTotal=calcInvTotal({...inv2,items}).grand;
          if(Math.abs(oldTotal-newTotal)>0.01){
            await logAudit('inv_amount',{
              invId, invNum:inv2.number||'',
              jobId:inv2.linkedJobId||'', jobNum:inv2.jobNum||'',
              oldVal:oldTotal.toFixed(2), newVal:newTotal.toFixed(2)
            });
          }
        }
      }
      // Sync description + price to linked job
      try{await _syncInvoiceFieldToJob(invId, 'description', combinedDesc);}catch(e){console.warn('[DeepFlow] desc sync failed:',e);}
      try{await _syncInvoiceFieldToJob(invId, 'items', items);}catch(e){console.warn('[DeepFlow] items sync failed:',e);toast('⚠ Price sync failed — check console','warn',3000);}
    }catch(e){if(ind)ind.textContent='⚠ Save failed';console.warn('[DeepFlow]',e);}
  },600);
}

function _updateLiveTotal(invId){
  // Recalculate totals from current DOM inputs without saving
  const vr=getVatRate();
  let sub=0,vat=0;
  // Only iterate once per item row — use qty elements as the anchor
  document.querySelectorAll(`.inv-live-item[data-invid="${invId}"][data-key="qty"]`).forEach(el=>{
    const idx=parseInt(el.dataset.idx);
    const rowQty=parseFloat(el.value)||1;
    const rowUnit=parseFloat(document.querySelector(`.inv-live-item[data-invid="${invId}"][data-idx="${idx}"][data-key="unit"]`)?.value||0);
    const rowVat=document.querySelector(`.inv-live-item[data-invid="${invId}"][data-idx="${idx}"][data-key="vat"]`)?.checked;
    const l=rowQty*rowUnit;
    const v=rowVat?l*vr/100:0;
    sub+=l; vat+=v;
    const totEl=document.getElementById(`inv-item-total-${invId}-${idx}`);
    if(totEl) totEl.textContent='£'+(l+v).toFixed(2);
  });
  const grandEl=document.getElementById(`inv-live-total-${invId}`);
  if(grandEl) grandEl.querySelector('span:last-child').textContent='£'+(sub+vat).toFixed(2);
}

async function _addLiveItem(invId){
  const inv=await dGet('invoices',invId);
  if(!inv)return;
  const items=[...(inv.items||[]),{desc:'',qty:1,unit:0,vat:true}];
  await _sb(`invoices?id=eq.${encodeURIComponent(invId)}`,{method:'PATCH',body:{items},prefer:'return=minimal'});
  _invalidateCache('invoices');
  viewInv(invId);
}

async function _removeLiveItem(invId,idx){
  const inv=await dGet('invoices',invId);
  if(!inv)return;
  const items=(inv.items||[]).filter((_,i)=>i!==idx);
  await _sb(`invoices?id=eq.${encodeURIComponent(invId)}`,{method:'PATCH',body:{items},prefer:'return=minimal'});
  _invalidateCache('invoices');
  viewInv(invId);
}

function _invalidateCache(store){
  if(typeof _cacheInvalidate==='function') _cacheInvalidate(store);
  if(store==='invoices'&&typeof _invalidateJobCache==='function') _invalidateJobCache();
}

async function openInvSendModal(id){
  curInvId=id;
  const inv=await dGet('invoices',id);
  document.getElementById('inv-send-title').textContent=`Send — ${inv.number}`;
  document.getElementById('inv-send-wa').value=inv.clientWA||'';
  window._sendInvId=id;
  // Show agent CC row if applicable
  const ccRow=document.getElementById('inv-send-cc-row');
  const ccVal=document.getElementById('inv-send-cc-val');
  if(inv.agentCC){
    ccRow.style.display='';
    ccVal.textContent=inv.agentCC;
  } else {
    ccRow.style.display='none';
  }
  openModal('mo-inv-send');
}

async function sendInvEmail(){
  const id=window._sendInvId;
  await downloadInvPDFById(id);
  const inv=await dGet('invoices',id);
  const t=calcInvTotal(inv);
  const sub=encodeURIComponent(`Invoice ${inv.number} from ${S.coName||'Us'}`);
  const body=encodeURIComponent(`Dear ${inv.clientName},\n\nPlease find your invoice ${inv.number} for £${t.grand.toFixed(2)} attached.\n\nPlease use invoice number ${inv.number} as your payment reference.\n\n${S.payTerms||''}\n\nKind regards,\n${S.coName||''}\n${S.coPhone||''}`);
  const ccPart=inv.agentCC?`&cc=${encodeURIComponent(inv.agentCC)}`:'';
  window.open(`mailto:${inv.clientEmail||''}?subject=${sub}&body=${body}${ccPart}`);
  inv.status='Awaiting Payment';await dPut('invoices',inv);
  renderInvList();viewInv(id);updateBadges();
  closeModal('mo-inv-send');
  toast(`PDF downloaded. Mail client opened.${inv.agentCC?' Agent CC: '+inv.agentCC:''}`, 'success');
}

async function sendInvWA(){
  const id=window._sendInvId;
  const inv=await dGet('invoices',id);
  const t=calcInvTotal(inv);
  const bankDet=[S.bankName,S.bankAcc?'Acc: '+S.bankAcc:'',S.bankSort?'Sort: '+S.bankSort:''].filter(Boolean).join(' | ');
  const msg=(S.waInvTpl||'')
    .replace('{client_name}',inv.clientName||'')
    .replace('{invoice_num}',inv.number||'')
    .replace('{amount}',t.grand.toFixed(2))
    .replace('{due_date}',inv.dueDate||'ASAP')
    .replace('{company_name}',S.coName||'')
    .replace('{description}',inv.description||'')
    .replace('{bank_details}',bankDet||'See attachment');

  const waNum=(document.getElementById('inv-send-wa').value||inv.clientWA||'').replace(/[^0-9]/g,'');
  inv.status='Awaiting Payment';await dPut('invoices',inv);
  renderInvList();viewInv(id);updateBadges();
  closeModal('mo-inv-send');
  sendToWA(waNum,msg);
}

async function downloadInvPDF(){
  if(!curInvId)return;
  await downloadInvPDFById(curInvId);
}

export async function downloadInvPDFById(id){
  const inv=await dGet('invoices',id);
  if(!inv){toast('Invoice not found','error');return;}
  if(!window.jspdf){toast('PDF library not loaded — check your internet and try again','error');return;}

  const t=calcInvTotal(inv);
  const vr=getVatRate();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210, H=297, M=18, RW=W-M*2;
  const accent=[245,166,35], dark=[22,24,35], mid=[80,85,110], light=[245,246,250];

  // ── Helper: safe text with word wrap ──
  const safeText=(txt,x,y,maxW)=>{
    if(!txt)return;
    const lines=doc.splitTextToSize(String(txt),maxW||80);
    doc.text(lines,x,y);
    return lines.length;
  };

  // ── TOP COLOUR BAR ──
  doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');

  // ── LOGO ──
  let logoBottom=M;
  if(S.logoData){
    try{
      doc.addImage(S.logoData,'PNG',M,M+4,36,18,'','FAST');
      logoBottom=M+24;
    }catch(e){ console.warn('[DeepFlow]', e); }
  }

  // ── COMPANY DETAILS (left) ──
  let cy=logoBottom+4;
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.setTextColor(...dark);
  doc.text(S.coName||'Your Company',M,cy); cy+=5;
  doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...mid);
  if(S.coAddr){safeText(S.coAddr,M,cy,70);cy+=4*(S.coAddr.split(',').length);}
  if(S.coPhone){doc.text(S.coPhone,M,cy);cy+=4;}
  if(S.coEmail){doc.text(S.coEmail,M,cy);cy+=4;}
  if(S.coWeb){doc.text(S.coWeb,M,cy);cy+=4;}
  if(S.coVatNum&&S.vatEnabled!==false){doc.text('VAT No: '+S.coVatNum,M,cy);cy+=4;}
  if(S.coReg){doc.text('Company No: '+S.coReg,M,cy);}

  // ── INVOICE META (right) ──
  doc.setFont('helvetica','bold');doc.setFontSize(28);doc.setTextColor(...accent);
  doc.text('INVOICE',W-M,M+10,{align:'right'});
  doc.setFontSize(10);doc.setTextColor(...dark);
  doc.text(inv.number,W-M,M+20,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...mid);
  doc.text('Issue date: '+(inv.date||'—'),W-M,M+28,{align:'right'});
  if(inv.dueDate)doc.text('Due date:    '+inv.dueDate,W-M,M+34,{align:'right'});
  doc.setFont('helvetica','bold');
  const statusColour={'Paid':[34,197,94],'Awaiting Payment':[245,166,35],'Cancelled':[200,60,60],'Draft':[120,130,150]}[inv.status]||mid;
  doc.setTextColor(...statusColour);
  doc.text(inv.status||'Draft',W-M,M+42,{align:'right'});

  // ── DIVIDER ──
  let y=Math.max(cy+6, 62);
  doc.setDrawColor(220,220,230);doc.setLineWidth(0.3);doc.line(M,y,W-M,y);y+=6;

  // ══════════════════════════════════════════════════════════════
  // BILL TO SECTION - Uses SAVED invoice data (not temporary vars)
  // ══════════════════════════════════════════════════════════════
  const colW=(RW-10)/2;
  
  // CRITICAL: Determine invoice type from SAVED data, not temporary variables
  const isAgency = inv.invoiceType === 'agency';

  // BILL TO header
  doc.setFillColor(...light);doc.rect(M,y,colW,6,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
  doc.text('BILL TO',M+3,y+4);
  y+=9;
  
  // Bill To Name (Agency or Landlord)
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(...dark);
  const billToName = inv.billToName || inv.clientName || '—';
  doc.text(billToName,M,y);
  let clientY = y+5;
  
  // Bill To Address (Agency address or Property address)
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  if(billToAddr){
    doc.setFontSize(8.5);doc.setTextColor(...mid);
    const addrLines=doc.splitTextToSize(billToAddr,colW);
    doc.text(addrLines,M,clientY);clientY+=addrLines.length*4.5;
  }
  
  // Email
  if(inv.clientEmail){
    doc.setFontSize(8);doc.setTextColor(...mid);
    doc.text(inv.clientEmail,M,clientY);clientY+=5;
  }
  
  // PROPERTY ADDRESS — always show regardless of invoice type
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  if(propAddr && propAddr.trim()){
    // For landlord invoices, property IS the billing address so show separately
    // For agency invoices, property is already shown as JOB ADDRESS below Bill To
    if(!isAgency){
      clientY += 4;
      doc.setFillColor(...light);doc.rect(M,clientY-2,colW,6,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
      doc.text('PROPERTY ADDRESS',M+3,clientY+2);
      clientY += 7;
      doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...dark);
      const propLines=doc.splitTextToSize(propAddr,colW);
      doc.text(propLines,M,clientY);clientY+=propLines.length*4.5;
    }
  }

  // JOB ADDRESS section for agencies
  if(isAgency && inv.jobAddress && inv.jobAddress.trim()){
    clientY += 4;
    doc.setFillColor(...light);doc.rect(M,clientY-2,colW,6,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
    doc.text('PROPERTY ADDRESS',M+3,clientY+2);
    clientY += 7;
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...mid);
    const jobAddrLines=doc.splitTextToSize(inv.jobAddress,colW);
    doc.text(jobAddrLines,M,clientY);clientY+=jobAddrLines.length*4.5;
  }

  // JOB DETAILS (right column — alongside Bill To)
  const detailX = M + colW + 10;
  const detailW = colW;
  let detailY = y - (clientY - y) - 6; // align top with Bill To
  detailY = Math.max(y, detailY);

  // Job details block (right column)
  doc.setFillColor(...light);doc.rect(detailX,y-9,detailW,6,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
  doc.text('JOB DETAILS',detailX+3,y-9+4);
  let djY = y - 1;

  const djRow=(lbl,val)=>{
    if(!val) return;
    doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
    doc.text(lbl,detailX,djY);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...dark);
    const vLines=doc.splitTextToSize(String(val),detailW-22);
    doc.text(vLines,detailX+22,djY);
    djY+=vLines.length*4.5+1;
  };

  djRow('Job No:',   inv.jobNum||inv.jobRef||'');
  djRow('Date:',     inv.jobDate?new Date(inv.jobDate+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'');
  djRow('Engineer:', inv.engineer||'');
  djRow('Work done:',inv.certTypes||inv.description||'');
  if(inv.agentName&&isAgency) djRow('Agent:',inv.agentName);

  y = clientY + 4;

  // ── LINE ITEMS TABLE ──
  doc.setDrawColor(220,220,230);doc.line(M,y,W-M,y);y+=2;
  // Header row
  doc.setFillColor(...dark);doc.rect(M,y,RW,6.5,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(200,200,220);
  const cols=[M+2,M+90,M+113,M+133,W-M-2];
  const hdrs=['DESCRIPTION','QTY','UNIT PRICE','VAT','TOTAL'];
  const aligns=['left','left','left','left','right'];
  hdrs.forEach((h,i)=>doc.text(h,cols[i],y+4.5,aligns[i]==='right'?{align:'right'}:null));
  y+=8;

  // Item rows
  (inv.items||[]).forEach((item,ii)=>{
    const l=(item.qty||1)*(item.unit||0);
    const v=item.vat?l*vr/100:0;
    const rowH=7;
    if(y>H-50){doc.addPage();doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');y=14;}
    if(ii%2===0){doc.setFillColor(249,249,252);doc.rect(M,y-3,RW,rowH,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...dark);
    const dTxt=String(item.desc||'');
    const dLines=doc.splitTextToSize(dTxt,82);
    doc.text(dLines[0]+(dLines.length>1?'…':''),M+2,y+1);
    doc.text(String(item.qty||1),cols[1],y+1);
    doc.text('£'+Number(item.unit||0).toFixed(2),cols[2],y+1);
    doc.setTextColor(item.vat?100:160,item.vat?120:160,item.vat?160:160);
    doc.text(item.vat?vr+'%':'—',cols[3],y+1);
    doc.setTextColor(...dark);
    doc.text('£'+(l+v).toFixed(2),cols[4],y+1,{align:'right'});
    y+=rowH;
  });
  y+=3;doc.setDrawColor(220,220,230);doc.line(M,y,W-M,y);y+=6;

  // ── TOTALS (right aligned) ──
  const tCol=W-M-50;
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...mid);
  doc.text('Subtotal:',tCol,y);doc.text('£'+t.sub.toFixed(2),W-M,y,{align:'right'});y+=5.5;
  doc.text(`VAT (${vr}%):`,tCol,y);doc.text('£'+t.vat.toFixed(2),W-M,y,{align:'right'});y+=2;
  doc.setDrawColor(220,220,230);doc.line(tCol,y,W-M,y);y+=5;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...accent);
  doc.text('TOTAL:',tCol,y);doc.text('£'+t.grand.toFixed(2),W-M,y,{align:'right'});y+=8;

  // ── PAID WATERMARK ──
  if(inv.status==='Paid'){
    doc.saveGraphicsState();
    doc.setGState(doc.GState({opacity:0.08}));
    doc.setFont('helvetica','bold');doc.setFontSize(80);doc.setTextColor(34,197,94);
    doc.text('PAID',W/2,H/2,{align:'center',angle:35});
    doc.restoreGraphicsState();
  }

  // ── PAYMENT DETAILS ──
  if(S.bankName||S.bankAcc){
    y+=2;
    doc.setFillColor(...light);doc.rect(M,y,RW,5.5,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(...mid);
    doc.text('PAYMENT DETAILS',M+3,y+3.8);y+=7;
    doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...dark);
    if(S.bankName)doc.text('Bank: '+S.bankName,M,y);
    if(S.bankAcc)doc.text('Acc: '+S.bankAcc+(S.bankSort?' · Sort: '+S.bankSort:''),M+55,y);y+=5;
    if(S.bankIBAN)doc.text('IBAN: '+S.bankIBAN,M,y);
  }

  // ── PAYMENT REFERENCE BOX ──
  y+=8;
  doc.setFillColor(254,248,235);doc.setDrawColor(...accent);doc.setLineWidth(0.5);
  doc.roundedRect(M,y-3,RW,9,2,2,'FD');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(100,70,10);
  doc.text('Please quote reference: '+inv.number+' with your payment',M+3,y+2.5);
  y+=13;

  // ── TERMS & NOTES ──
  if(S.payTerms||S.invNotes){
    doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(...mid);
    if(S.payTerms){safeText(S.payTerms,M,y,RW);y+=5;}
    if(S.invNotes){safeText(S.invNotes,M,y,RW);y+=5;}
  }

  // ── FOOTER LINE - Company · Agent (only for agencies) ──
  doc.setDrawColor(220,220,230);doc.line(M,H-14,W-M,H-14);
  doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(170,175,195);
  const footParts=[];
  
  // Add company name
  if(S.coName) footParts.push(S.coName);
  
  // Add agent name ONLY if this is an agency job (use isAgency from above)
  if(isAgency && inv.agentName && inv.agentName.trim()) {
    footParts.push('Agent: ' + inv.agentName.trim());
  }
  
  doc.text(footParts.join(' · '),M,H-9);
  doc.text('Generated by DeepFlow',W-M,H-9,{align:'right'});

  // ── BOTTOM COLOUR BAR ──
  doc.setFillColor(...accent);doc.rect(0,H-4,W,4,'F');

  doc.save((inv.number||'invoice')+'.pdf');
  await logActivity('PDF downloaded: '+inv.number,'invoice');
  toast('✅ PDF downloaded — '+inv.number,'success');
}

async function markInvPaid(id){
  const inv=await dGet('invoices',id);
  if(!inv) return;
  const t=calcInvTotal(inv);

  // TASK 25: Check if a payment record already covers the full amount.
  // If not, create one so markInvPaid always leaves an audit trail — consistent
  // with the full payment modal. This means every Paid invoice has at least one
  // payment entry with a date, method, and amount.
  const allPmts=await dAll('payments');
  const invPmts=allPmts.filter(p=>p.invId===id);
  const alreadyPaid=invPmts.reduce((s,p)=>s+p.amount,0);
  if(alreadyPaid<t.grand-0.01){
    const remaining=Math.max(0,t.grand-alreadyPaid);
    const payment={
      id:uid(),invId:id,
      date:TODAY(),
      amount:remaining,
      method:'Bank Transfer',
      ref:inv.number,
      recorded_by:_appUser?.name||'Office',
      created:Date.now()
    };
    await dPut('payments',payment);
  }

  inv.status='Paid';
  await dPut('invoices',inv);
  await logActivity(`Invoice ${inv.number} marked Paid (£${t.grand.toFixed(2)})`,'invoice');
  toast('Invoice marked as Paid','success');
  renderInvList();viewInv(id);updateBadges();
}
async function markInvSent(id){
  const inv=await dGet('invoices',id);
  inv.status='Awaiting Payment';await dPut('invoices',inv);
  renderInvList();viewInv(id);updateBadges();
  toast('Marked as Awaiting Payment','info');
}
async function deleteInv(id){
  confirm2('Delete Invoice','Permanently delete this invoice?',async()=>{
    await dDel('invoices',id);
    curInvId=null;
    renderInvList();
    document.getElementById('inv-detail-box').innerHTML='<div class="empty"><div class="ei">◎</div><p>Select an invoice</p></div>';
    updateBadges();toast('Invoice deleted','warn');
  });
}

function openNewInvModal(){
  editInvId=null;
  window._pendingJobLink=null;
  document.getElementById('mo-inv-title').textContent='◎ New Invoice';
  document.getElementById('if-date').value=TODAY();
  document.getElementById('if-desc').value='';
  document.getElementById('if-notes').value=S.invNotes||'';
  document.getElementById('if-terms').value=S.payTerms||'';
  document.getElementById('if-status').value='Draft';
  document.getElementById('if-jobref').value='';
  document.getElementById('if-agent').value='';
  document.getElementById('if-agent-cc').value='';
  const dd=new Date();dd.setDate(dd.getDate()+14);
  document.getElementById('if-due').value=dd.toISOString().slice(0,10);
  invItems=[{desc:'Labour',qty:1,unit:0,vat:true}];
  fillInvClientDrop();renderInvItems();
  document.getElementById('if-vat-pct').textContent=getVatRate();
  openModal('mo-inv');
}

async function editInvModal(id){
  editInvId=id;
  window._pendingJobLink=null;
  const inv=await dGet('invoices',id);
  document.getElementById('mo-inv-title').textContent='✎ Edit Invoice — '+inv.number;
  document.getElementById('if-date').value=inv.date;
  document.getElementById('if-desc').value=inv.description;
  document.getElementById('if-notes').value=inv.notes||S.invNotes||'';
  document.getElementById('if-terms').value=inv.terms||S.payTerms||'';
  document.getElementById('if-status').value=inv.status||'Draft';
  document.getElementById('if-due').value=inv.dueDate||'';
  document.getElementById('if-jobref').value=inv.jobRef||'';
  document.getElementById('if-agent').value=inv.agentName||'';
  document.getElementById('if-agent-cc').value=inv.agentCC||'';
  invItems=JSON.parse(JSON.stringify(inv.items||[]));
  fillInvClientDrop(inv.clientId);renderInvItems();
  document.getElementById('if-vat-pct').textContent=getVatRate();
  openModal('mo-inv');
}

async function invClientSelected(clientId){
  if(!clientId) return;
  const ps=await dAll('persons');
  const agencies=await dAll('agencies');
  // Check persons first, then agencies
  const p=ps.find(x=>x.id===clientId)||agencies.find(x=>x.id===clientId);
  if(!p) return;
  // Auto-fill client fields from directory record
  const nameEl=document.getElementById('if-client-name');
  const emailEl=document.getElementById('if-client-email')||document.querySelector('[data-inv-field="clientEmail"]');
  const addrEl=document.getElementById('if-client-addr');
  const waEl=document.getElementById('if-client-wa');
  if(nameEl)  nameEl.value=p.name||'';
  if(emailEl) emailEl.value=p.email||'';
  if(addrEl&&!addrEl.value)  addrEl.value=p.address||'';
  if(waEl&&!waEl.value)   waEl.value=p.wa||p.phone||'';
  // Also update the client name hidden field used by saveInv
  const hiddenName=document.getElementById('if-clientname-hidden');
  if(hiddenName) hiddenName.value=p.name||'';
  toast(`Client auto-filled: ${p.name}${p.email?' · '+p.email:''}`,'success',2000);
}

async function fillInvClientDrop(selId){
  const ps=await dAll('persons');
  const blank=selId?'':'<option value="" selected>— Select client —</option>';
  document.getElementById('if-client').innerHTML=blank+ps.map(p=>`<option value="${p.id}" ${p.id===selId?'selected':''}>${p.name}</option>`).join('');
  // If a client is pre-selected, auto-fill their email/address
  if(selId) invClientSelected(selId);
}

function addInvItem(){invItems.push({desc:'',qty:1,unit:0,vat:true});renderInvItems()}
function renderInvItems(){
  const c=document.getElementById('if-items');
  const vatOn=S.vatEnabled!==false;
  c.innerHTML=invItems.map((it,i)=>`
    <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
      <input class="fi" style="flex:2" value="${it.desc}" placeholder="Description" oninput="invItems[${i}].desc=this.value">
      <input class="fi" type="number" style="width:55px" value="${it.qty}" min="1" oninput="invItems[${i}].qty=+this.value;updInvTotals()">
      <input class="fi" type="number" style="width:80px" value="${it.unit}" min="0" step="0.01" placeholder="£" oninput="invItems[${i}].unit=+this.value;updInvTotals()">
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;font-family:var(--fh);white-space:nowrap;${vatOn?'':'display:none!important'}"><input type="checkbox" ${it.vat?'checked':''} onchange="invItems[${i}].vat=this.checked;updInvTotals()" style="accent-color:var(--acc)"> VAT</label>
      <button class="btn btn-red btn-xs" onclick="invItems.splice(${i},1);renderInvItems()">✕</button>
    </div>`).join('');
  updInvTotals();
}
async function saveInv(){
  return saveInvWithJobSync();
}

async function mergeJobsInvoice(){
  const ids=[...selJobs];
  const jobs=await Promise.all(ids.map(id=>dGet('jobs',id)));
  const refs=[...new Set(jobs.map(j=>j.referrer).filter(Boolean))];
  if(refs.length>1){toast('Select jobs with the same referrer to merge','error');return}
  const ps=await dAll('persons');
  const cl=ps.find(p=>p.name===refs[0])||{};
  invItems=jobs.map(j=>({desc:(j.description||j.address),qty:1,unit:j.price||0,vat:true}));
  editInvId=null;
  document.getElementById('mo-inv-title').textContent='◎ Merged Invoice';
  document.getElementById('if-date').value=TODAY();
  document.getElementById('if-desc').value='Multiple works — '+jobs.map(j=>j.address).join(', ');
  document.getElementById('if-notes').value=S.invNotes||'';
  document.getElementById('if-terms').value=S.payTerms||'';
  await fillInvClientDrop(cl.id);renderInvItems();
  clearSel();openModal('mo-inv');
}

// ════════════════════════════════════════════════════════════════
//  REPORTS
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  ENGINEER REQUESTS
// ════════════════════════════════════════════════════════════════
// ── Job Requests — type state ─────────────────────────────────────────────────


function setReqType(type){
  _reqType = type;
  document.querySelectorAll('.inv-type-tab[id^="reqtype-"]').forEach(b=>{
    b.classList.toggle('active', b.id==='reqtype-'+type);
  });
  renderRequests();
}

async function renderRequests(){
  const list = document.getElementById('req-list');
  const statusFilter = document.getElementById('req-status-filter')?.value||'';
  if(list) list.innerHTML='<div style="text-align:center;padding:40px;color:var(--txt3);font-size:12px">Loading…</div>';

  try{
    let url='engineer_requests?order=created.desc&limit=200';
    if(statusFilter) url+='&status=eq.'+statusFilter;
    let reqs = await _sb(url)||[];

    // Apply type filter
    if(_reqType==='portal') reqs=reqs.filter(r=>r.type==='portal_request');
    else if(_reqType==='eng') reqs=reqs.filter(r=>r.type!=='portal_request');

    // Update sidebar badge
    const allPending=(await _sb('engineer_requests?status=eq.pending&select=id')||[]).length;
    const badge=document.getElementById('nb-req');
    if(badge){ badge.textContent=allPending; badge.style.display=allPending?'inline':'none'; }

    // KPI strip
    _renderReqKPIs(reqs);

    if(!reqs.length){
      if(list) list.innerHTML=`<div style="text-align:center;padding:60px;color:var(--txt3)"><div style="font-size:32px;margin-bottom:10px">📬</div><div style="font-size:13px">${statusFilter==='pending'?'🎉 No pending requests — all clear!':'No requests found for this filter'}</div></div>`;
      return;
    }

    if(list) list.innerHTML = reqs.map(r=>_renderReqCard(r)).join('');

    // Re-select if one was previously selected
    if(_selectedReqId){
      const still=reqs.find(r=>r.id===_selectedReqId);
      if(still) _showReqDetail(still);
    }
  }catch(e){
    if(list) list.innerHTML=`<div style="text-align:center;padding:40px;color:var(--red);font-size:12px">❌ Failed to load: ${e.message}</div>`;
  }
}

function _renderReqKPIs(reqs){
  const el=document.getElementById('req-kpi-strip');
  if(!el) return;
  const pending=reqs.filter(r=>r.status==='pending').length;
  const approved=reqs.filter(r=>r.status==='approved').length;
  const rejected=reqs.filter(r=>r.status==='rejected').length;
  const jobCreated=reqs.filter(r=>r.status==='job_created').length;
  const portal=reqs.filter(r=>r.type==='portal_request').length;
  const kpi=(v,l,c,filter)=>`<div class="inv-topbar-kpi" onclick="document.getElementById('req-status-filter').value='${filter}';renderRequests()">
    <span class="k-val" style="color:${c}">${v}</span><span class="k-lbl">${l}</span><span class="k-arrow">›</span>
  </div>`;
  el.innerHTML=
    kpi(pending,'Pending','#f59e0b','pending')+
    kpi(approved,'Approved','#15803d','approved')+
    (rejected?kpi(rejected,'Rejected','#b91c1c','rejected'):'')+
    (jobCreated?kpi(jobCreated,'Job Created','#a855f7','job_created'):'')+
    kpi(portal,'Portal','#7c3aed','');
}

function _renderReqCard(r){
  const isPortal = r.type==='portal_request';
  const isPending = r.status==='pending';
  const isRejected = r.status==='rejected';
  const isJobCreated = r.status==='job_created';
  const statusCol={pending:'#f59e0b',approved:'#15803d',rejected:'#b91c1c',job_created:'#a855f7',acknowledged:'#0ea5e9'}[r.status]||'#94a3b8';
  const statusLabel={pending:'⏳ Pending',approved:'✅ Approved',rejected:'❌ Rejected',job_created:'🔧 Job Created',acknowledged:'👀 Seen'}[r.status]||r.status;
  const typeLabel = isPortal ? '🏠 Client Portal' : r.type==='overtime'?'🕐 Overtime':r.type==='leave'?'🏖 Leave':'📝 Engineer';
  const dt = r.created?new Date(r.created*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}):''
  const isSelected = _selectedReqId===r.id;

  // Extract CR number from notes
  const crMatch = (r.notes||'').match(/\[(CR-\d+)\]/);
  const crNum = crMatch ? crMatch[1] : null;

  // Parse portal notes
  let parsed={};
  if(isPortal && r.notes){
    const lines=r.notes.split('\n');
    const get=k=>{const l=lines.find(x=>x.toLowerCase().startsWith(k.toLowerCase()+':'));return l?l.slice(k.length+1).trim():''};
    parsed={service:get('Service'),address:get('Address'),date:get('Preferred date'),access:get('Access'),notes:get('Notes')};
  }

  return`<div onclick="_showReqDetail(${JSON.stringify(r).replace(/"/g,'&quot;')})" style="border:1px solid ${isSelected?'var(--acc)':isPending?'rgba(245,158,11,.3)':'var(--border)'};border-left:3px solid ${statusCol};border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer;background:${isSelected?'var(--acc-soft)':'var(--s1)'};transition:.12s">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      ${crNum?`<span style="font-size:10px;font-weight:800;color:var(--acc);background:var(--acc-soft);padding:1px 8px;border-radius:6px;font-family:monospace">${crNum}</span>`:''}
      <span style="font-size:11px;font-weight:700;color:var(--txt)">${r.engineer_name||'Unknown'}</span>
      <span style="font-size:9px;font-weight:700;color:${statusCol};background:${statusCol}18;padding:1px 6px;border-radius:6px">${statusLabel}</span>
      ${isPending?`<span style="font-size:9px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,.1);padding:1px 6px;border-radius:6px;animation:pulse 2s infinite">● ACTION NEEDED</span>`:''}
      <span style="font-size:10px;color:var(--txt3);margin-left:auto">${dt}</span>
    </div>
    <div style="font-size:11px;color:var(--acc);font-weight:600;margin-bottom:2px">${typeLabel}</div>
    <div style="font-size:11px;color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      ${isPortal?(parsed.service||'')+(parsed.address?' · '+parsed.address:''):r.notes||'—'}
    </div>
    ${r.office_reply?`<div style="font-size:10px;color:var(--txt3);margin-top:4px">💼 ${r.office_reply}</div>`:''}
  </div>`;
}
function _showReqDetail(r){
  if(typeof r==='string') try{r=JSON.parse(r)}catch(e){return}
  _selectedReqId=r.id;
  const el=document.getElementById('req-detail-body');
  if(!el) return;

  const isPortal=r.type==='portal_request';
  const isPending=r.status==='pending';
  const isRejected=r.status==='rejected';
  const isJobCreated=r.status==='job_created';
  const statusCol={pending:'#f59e0b',approved:'#15803d',rejected:'#b91c1c',job_created:'#a855f7'}[r.status]||'#94a3b8';
  const statusLabel={pending:'⏳ Pending',approved:'✅ Approved',rejected:'❌ Rejected',job_created:'📋 Job Created'}[r.status]||r.status;
  const dt=r.created?new Date(r.created*1000).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';

  let parsed={};
  if(isPortal && r.notes){
    const lines=r.notes.split('\n');
    const get=k=>{const l=lines.find(x=>x.toLowerCase().startsWith(k.toLowerCase()+':'));return l?l.slice(k.length+1).trim():''};
    parsed={service:get('Service'),address:get('Address'),date:get('Preferred date'),access:get('Access'),notes:get('Notes'),ref:(lines[0]||'').match(/\[([^\]]+)\]/)?.[1]||''};
  }

  const field=(ico,label,val)=>val?`<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
    <span style="font-size:13px;flex-shrink:0">${ico}</span>
    <div><div style="font-size:9px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:1px">${label}</div><div style="color:var(--txt);font-weight:500">${val}</div></div>
  </div>`:'';

  el.innerHTML=`
    <!-- Header -->
    <div style="margin-bottom:14px">
      <div style="font-size:14px;font-weight:800;color:var(--txt);margin-bottom:4px">${r.engineer_name||'Unknown'}</div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:700;color:${statusCol};background:${statusCol}18;padding:2px 8px;border-radius:6px">${statusLabel}</span>
        ${isPortal?'<span style="font-size:10px;font-weight:600;color:#7c3aed;background:rgba(124,58,237,.08);padding:2px 8px;border-radius:6px">🏠 Portal Request</span>':'<span style="font-size:10px;font-weight:600;color:var(--blue);background:rgba(29,111,173,.08);padding:2px 8px;border-radius:6px">👷 Engineer</span>'}
        ${parsed.ref?`<span style="font-size:10px;color:var(--txt3)">${parsed.ref}</span>`:''}
      </div>
      <div style="font-size:10px;color:var(--txt3);margin-top:4px">${dt}</div>
    </div>

    <!-- Details -->
    <div style="margin-bottom:14px">
      ${field('🔧','Service / Request',isPortal?parsed.service:r.type==='overtime'?`${r.hours||0} hrs @ £${r.rate||0}/hr = £${((r.hours||0)*(r.rate||0)).toFixed(2)}`:r.type)}
      ${field('📍','Address',isPortal?parsed.address:'')}
      ${field('📅','Preferred Date',isPortal?parsed.date:r.date||'')}
      ${field('🔑','Access',isPortal?parsed.access:'')}
      ${field('💬','Notes / Details',isPortal?parsed.notes:r.notes||'')}
      ${field('✉️','Client Email',r.email||'')}
      ${field('📞','Client Phone',r.phone||'')}
    </div>

    ${r.office_reply?`<div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px"><div style="font-size:9px;font-weight:700;color:var(--txt3);text-transform:uppercase;margin-bottom:4px">Office Reply (visible to client)</div><div style="color:var(--txt)">${r.office_reply}</div></div>`:''}

    <!-- CLIENT PORTAL STATUS — what the client sees -->
    <div style="background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:10px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">What client sees on their portal</div>
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="font-size:14px">${{pending:'⏳',approved:'✅',rejected:'❌',job_created:'📋'}[r.status]||'•'}</span>
        <div>
          <div style="font-weight:600;color:var(--txt)">${{pending:'Your request is being reviewed',approved:'Request acknowledged — we will be in touch',rejected:'Request declined',job_created:'Job booked — your engineer is confirmed'}[r.status]||statusLabel}</div>
          ${r.office_reply?`<div style="color:var(--txt2);margin-top:2px">"${r.office_reply}"</div>`:''}
        </div>
      </div>
    </div>

    <!-- ACTIONS -->
    <div style="display:flex;flex-direction:column;gap:6px">
      ${isPending && isPortal?`
        <button class="btn btn-acc btn-sm" style="width:100%;justify-content:center" onclick="_reqCreateJob('${r.id}','${encodeURIComponent(JSON.stringify(parsed))}','${(r.engineer_name||'').replace(/'/g,"\\'")}')">📋 Create Job from this Request</button>
        <button class="btn btn-green btn-sm" style="width:100%;justify-content:center" onclick="_reqAcknowledge('${r.id}')">✅ Acknowledge (reply to client)</button>
        <button class="btn btn-red btn-sm" style="width:100%;justify-content:center" onclick="_reqReject('${r.id}')">✕ Decline Request</button>
      `:isPending?`
        <button class="btn btn-green btn-sm" style="width:100%;justify-content:center" onclick="_reqApproveEng('${r.id}')">✅ Approve</button>
        <button class="btn btn-red btn-sm" style="width:100%;justify-content:center" onclick="_reqReject('${r.id}')">❌ Reject</button>
      `:''}
      ${isRejected?`
        <button class="btn btn-acc btn-sm" style="width:100%;justify-content:center" onclick="_reqReopen('${r.id}')">↺ Re-open (undo rejection)</button>
      `:''}
      ${isJobCreated||r.status==='approved'?`
        <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center" onclick="_reqReopen('${r.id}')">↺ Revert to Pending</button>
      `:''}
      <button class="btn btn-ghost btn-sm" style="width:100%;justify-content:center;margin-top:4px" onclick="_reqSendReply('${r.id}')">💬 Update Reply to Client</button>
    </div>`;

  // Highlight selected card
  document.querySelectorAll('#req-list > div').forEach(d=>{
    d.style.background=d.onclick?.toString().includes(r.id)?'var(--acc-soft)':'var(--s1)';
    d.style.borderColor=d.onclick?.toString().includes(r.id)?'var(--acc)':'var(--border)';
  });
}

// ── Request actions ───────────────────────────────────────────────────────────
async function _reqCreateJob(id, parsedEnc, clientName){
  let p; try{p=JSON.parse(decodeURIComponent(parsedEnc));}catch(e){p={};}

  // Generate a proper sequential CR number from the jobs table (ignores whatever the portal sent)
  const crNum=await nextJobNum('CR');

  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'job_created',office_reply:'Job booked — your engineer is confirmed. We will contact you with details shortly.'},prefer:'return=minimal'});
  nav('jobs');
  await new Promise(r=>setTimeout(r,350));
  openJobModal(null);
  await new Promise(r=>setTimeout(r,200));
  const f=id=>document.getElementById(id);
  if(p.address&&f('jf-addr'))  f('jf-addr').value=p.address;
  if(p.service&&f('jf-desc'))  f('jf-desc').value=p.service;
  // Store CR number — will be used as job number when saved
  if(crNum) window._pendingCRNum=crNum;
  const noteLines=[p.access?`Access: ${p.access}`:'',p.notes||''].filter(Boolean);
  if(noteLines.length&&f('jf-notes')) f('jf-notes').value=noteLines.join('\n');
  if(clientName){
    const persons=await dAll('persons').catch(()=>[]);
    const match=persons.find(x=>x.name.toLowerCase()===clientName.toLowerCase());
    if(f('jf-landlord')) f('jf-landlord').value=match?match.name:clientName;
  }
  toast(`📋 Job pre-filled as ${crNum||'portal request'} — review and save`,'info',5000);
}

async function _reqAcknowledge(id){
  const reply=prompt('Reply to client (they will see this):','Thank you for your request. We will be in touch shortly to confirm your booking.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'approved',office_reply:reply},prefer:'return=minimal'});
  toast('✅ Request acknowledged — client notified','success');
  renderRequests();
}

async function _reqApproveEng(id){
  const reply=prompt('Reply to engineer (optional):','Approved — will be processed on the next payslip.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'approved',office_reply:reply||'Approved'},prefer:'return=minimal'});
  toast('✅ Request approved','success');
  renderRequests();
}

async function _reqReject(id){
  const reply=prompt('Reason for declining (client/engineer will see this):','We are unable to accommodate this request at this time.');
  if(reply===null) return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'rejected',office_reply:reply||'Declined'},prefer:'return=minimal'});
  toast('Request declined','warn');
  renderRequests();
}

async function _reqReopen(id){
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{status:'pending',office_reply:''},prefer:'return=minimal'});
  toast('↺ Request re-opened — set back to Pending','success');
  renderRequests();
}

async function _reqSendReply(id){
  const reply=prompt('Update reply (client/engineer will see this):','');
  if(reply===null||reply==='') return;
  await _sb('engineer_requests?id=eq.'+id,{method:'PATCH',body:{office_reply:reply},prefer:'return=minimal'});
  toast('💬 Reply updated','success');
  renderRequests();
}

// Legacy aliases so old code still works
async function approvePortalReq(id){ await _reqAcknowledge(id); }
async function approveRequest(id){ await _reqApproveEng(id); }
async function rejectRequest(id){ await _reqReject(id); }
async function createJobFromPortalReq(id, parsedJson){
  const p=typeof parsedJson==='string'?JSON.parse(parsedJson):parsedJson;
  await _reqCreateJob(id, encodeURIComponent(JSON.stringify(p)), p.clientName||'');
}


async function renderReports(){
  const days=parseInt(document.getElementById('rep-period')?.value||30);
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days);
  const cutoffStr=cutoff.toISOString().slice(0,10);
  // ISSUE 3 FIX: fetch only jobs within the report period — not all jobs ever
  const all=await _sb(`jobs?date=gte.${cutoffStr}&select=*`).then(r=>(r||[]).map(j=>_fromDb('jobs',j))).catch(()=>[]);
  const invs=await dAll('invoices');
  const period=all; // already filtered server-side
  const paidInvs=invs.filter(i=>i.status==='Paid'&&new Date(i.created)>=cutoff);
  const awaitInvs=invs.filter(i=>i.status==='Awaiting Payment');

  const totalJobs=period.length;
  const completedJobs=period.filter(j=>j.status===STATUS.COMPLETED).length;
  const revenue=paidInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const outstanding=awaitInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const totalHrs=period.reduce((s,j)=>s+(j.hours||0),0);

  // By trade
  const byTrade={};period.forEach(j=>{if(j.trade){if(!byTrade[j.trade])byTrade[j.trade]=0;byTrade[j.trade]++}});
  // By engineer
  const byEng={};period.forEach(j=>{if(j.engineer){if(!byEng[j.engineer])byEng[j.engineer]={jobs:0,hrs:0};byEng[j.engineer].jobs++;byEng[j.engineer].hrs+=j.hours||0}});
  // By status
  const bySt={};period.forEach(j=>{if(!bySt[j.status])bySt[j.status]=0;bySt[j.status]++});

  const grid=document.getElementById('rep-grid');
  grid.innerHTML=`
    <div class="rep-card">
      <div class="rep-title">📊 Job Overview — Last ${days} Days</div>
      <div class="rep-stat"><span>Total Jobs</span><span class="rep-stat-val" style="color:var(--acc)">${totalJobs}</span></div>
      <div class="rep-stat"><span>Completed</span><span class="rep-stat-val" style="color:var(--green)">${completedJobs}</span></div>
      <div class="rep-stat"><span>Completion Rate</span><span class="rep-stat-val">${totalJobs?Math.round(completedJobs/totalJobs*100):0}%</span></div>
      <div class="rep-stat"><span>Total Hours Logged</span><span class="rep-stat-val">${totalHrs}h</span></div>
      <div class="rep-stat"><span>Avg Hours/Job</span><span class="rep-stat-val">${totalJobs?(totalHrs/totalJobs).toFixed(1):'0'}h</span></div>
    </div>
    <div class="rep-card">
      <div class="rep-title">💰 Financial Summary</div>
      <div class="rep-stat"><span>Revenue (Paid)</span><span class="rep-stat-val" style="color:var(--green)">£${revenue.toFixed(2)}</span></div>
      <div class="rep-stat"><span>Outstanding</span><span class="rep-stat-val" style="color:var(--yellow)">£${outstanding.toFixed(2)}</span></div>
      <div class="rep-stat"><span>Paid Invoices</span><span class="rep-stat-val">${paidInvs.length}</span></div>
      <div class="rep-stat"><span>Avg Invoice Value</span><span class="rep-stat-val">£${paidInvs.length?(revenue/paidInvs.length).toFixed(2):'0'}</span></div>
    </div>
    <div class="rep-card">
      <div class="rep-title">🔧 Jobs by Trade</div>
      ${Object.entries(byTrade).sort((a,b)=>b[1]-a[1]).map(([t,n])=>`<div class="rep-stat"><span>${t}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">👷 Engineer Performance</div>
      ${Object.entries(byEng).sort((a,b)=>b[1].jobs-a[1].jobs).map(([e,v])=>`<div class="rep-stat"><span>${e}</span><span class="rep-stat-val">${v.jobs} jobs · ${v.hrs}h</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">📋 Jobs by Status</div>
      ${Object.entries(bySt).map(([s,n])=>`<div class="rep-stat"><span>${sBadge(s)}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>
    <div class="rep-card">
      <div class="rep-title">📅 Top Addresses</div>
      ${getTopAddresses(period,5).map(([a,n])=>`<div class="rep-stat"><span style="font-size:11px">${a}</span><span class="rep-stat-val">${n}</span></div>`).join('')||'<div style="color:var(--txt3);font-size:12px">No data</div>'}
    </div>`;

  renderAgeingReport();
}

function getTopAddresses(jobs,n){
  const map={};jobs.forEach(j=>{if(j.address){if(!map[j.address])map[j.address]=0;map[j.address]++}});
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

async function exportReportPDF(){
  toast('Generating report PDF…','info');
  const days=parseInt(document.getElementById('rep-period')?.value||30);
  if(!window.jspdf){toast('PDF library not loaded — please check your internet connection and try again','error');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF();
  doc.setFont('helvetica','bold');doc.setFontSize(18);
  doc.text(`${S.coName||'DeepFlow'} — Report`,20,20);
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')} · Period: Last ${days} days`,20,30);
  doc.text('See app for full interactive analytics.',20,40);
  doc.save('DeepFlow-Report.pdf');
  toast('Report PDF exported','success');
}

// ════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════
async function renderDash(){
  const h=new Date().getHours();
  const greet=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  document.getElementById('dg-greet').innerHTML=`${greet}, <span id="dg-name">${_appUser?.name||S.owner||'Boss'}</span>`;
  document.getElementById('dg-date').textContent=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  // ISSUE 2 FIX: Show skeleton placeholders immediately so the page feels responsive
  // while the sequential fetches complete in the background.
  const _skelPulse = 'background:linear-gradient(90deg,var(--bg2) 25%,var(--border) 50%,var(--bg2) 75%);background-size:200% 100%;animation:_skel 1.2s ease infinite;border-radius:6px;';
  const _skel = (w='80px',h='18px') => `<span style="display:inline-block;width:${w};height:${h};${_skelPulse}"></span>`;
  if(!document.getElementById('_skel_style')){
    const s=document.createElement('style');
    s.id='_skel_style';
    s.textContent='@keyframes _skel{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(s);
  }
  ['kv-jobs','kv-earn','kv-await','kv-certs','kv-drafts'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML=_skel('48px','22px');
  });
  ['dp-pending','dp-activity','dp-certs','dp-invs'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML=[1,2,3].map(()=>`<div style="padding:8px 0;border-bottom:1px solid var(--border)">${_skel('60%','14px')}<br style="margin:4px 0">${_skel('40%','11px')}</div>`).join('');
  });

  const allJobs=await dAll('jobs');
  const allInvs=await dAll('invoices');
  const allCerts=await dAll('certs');
  const now=new Date(),d30=new Date();d30.setDate(d30.getDate()+30);
  const thisMonth=new Date();thisMonth.setDate(1);thisMonth.setHours(0,0,0,0);

  const todayJobs=allJobs.filter(j=>j.date===TODAY());
  const pendingToday=todayJobs.filter(j=>j.status===STATUS.PENDING);
  const draftInvs=allInvs.filter(i=>i.status==='Draft');
  const awaitInvs=allInvs.filter(i=>i.status==='Awaiting Payment');
  const monthPaid=allInvs.filter(i=>i.status==='Paid'&&new Date(i.created)>=thisMonth);
  const expCerts=allCerts.filter(c=>{const d=new Date(c.expiryDate);return d>=now&&d<=d30});
  const revenue=monthPaid.reduce((s,i)=>s+calcInvTotal(i).grand,0);
  const awaiting=awaitInvs.reduce((s,i)=>s+calcInvTotal(i).grand,0);

  document.getElementById('kv-jobs').textContent=todayJobs.length;
  document.getElementById('ks-jobs').textContent=pendingToday.length+' pending';
  document.getElementById('kb-jobs').style.width=Math.min(100,todayJobs.length*10)+'%';
  document.getElementById('kv-earn').textContent='£'+revenue.toFixed(0);
  document.getElementById('ks-earn').textContent=monthPaid.length+' paid invoices';
  document.getElementById('kb-earn').style.width=Math.min(100,revenue/50)+'%';
  document.getElementById('kv-await').textContent='£'+awaiting.toFixed(0);
  document.getElementById('ks-await').textContent=awaitInvs.length+' invoices';
  document.getElementById('kb-await').style.width=Math.min(100,awaitInvs.length*10)+'%';
  document.getElementById('kv-certs').textContent=expCerts.length;
  document.getElementById('kb-certs').style.width=Math.min(100,expCerts.length*20)+'%';
  document.getElementById('kv-drafts').textContent=draftInvs.length;
  document.getElementById('kb-drafts').style.width=Math.min(100,draftInvs.length*10)+'%';

  // Revenue bars — last 7 days
  const bars=document.getElementById('rev-bars');
  const days7=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-6+i);return d.toISOString().slice(0,10)});
  const maxRev=Math.max(...days7.map(d=>allJobs.filter(j=>j.date===d&&j.price>0).reduce((s,j)=>s+j.price,0)),1);
  bars.innerHTML=days7.map(d=>{
    const dayRevenue=allJobs.filter(j=>j.date===d&&j.price>0).reduce((s,j)=>s+j.price,0);
    const pct=Math.max(4,dayRevenue/maxRev*100);
    const isToday=d===TODAY();
    return`<div class="rev-bar-wrap">
      <div class="rev-bar" style="height:${pct}%;background:${isToday?'var(--acc)':'rgba(245,166,35,.35)'}" title="£${dayRevenue.toFixed(0)}"></div>
      <div class="rev-bar-lbl">${new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short'})}</div>
    </div>`;
  }).join('');

  // Pending today
  const pend=document.getElementById('dp-pending');
  pend.innerHTML=pendingToday.length?pendingToday.slice(0,6).map(j=>`<div class="di">
    <span class="dot" style="background:${tradeColor(j.trade)};flex-shrink:0"></span>
    <div class="di-main"><div class="di-addr">${escHtml(j.address)}</div><div class="di-meta">${escHtml(j.engineer)||'Unassigned'} ${j.timeSlot?'· '+escHtml(j.timeSlot):''}</div></div>
    <button class="btn btn-ghost btn-xs" onclick="jDate='${j.date}';nav('jobs');setTimeout(()=>openJobModal('${j.id}'),200)">View</button>
  </div>`).join(''):'<div class="empty" style="padding:16px 0"><div class="ei" style="font-size:28px">✓</div><p style="font-size:12px">All clear today!</p></div>';

  // Activity
  const acts=await dAll('activity');
  const actEl=document.getElementById('dp-activity');
  const recent=acts.sort((a,b)=>b.ts-a.ts).slice(0,8);
  const typeIco={job:'⊞',invoice:'◎',cert:'◈',person:'◉',info:'ℹ'};
  actEl.innerHTML=recent.length?recent.map(a=>`<div class="act-item">
    <span class="act-dot" style="background:var(--acc)"></span>
    <span class="act-text">${a.msg}</span>
    <span class="act-time">${new Date(a.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
  </div>`).join(''):'<div style="color:var(--txt3);font-size:12px;padding:10px 0">No recent activity</div>';

  // Expiring certs
  const certEl=document.getElementById('dp-certs');
  certEl.innerHTML=expCerts.length?expCerts.slice(0,5).map(c=>{const d=daysDiff(c.expiryDate);return`<div class="di">
    <div class="di-main"><div class="di-addr">${c.address}</div><div class="di-meta">${c.type}</div></div>
    <div class="di-right"><span style="color:${d<=7?'var(--red)':'var(--yellow)'};font-family:var(--fh);font-weight:700">${d}d</span></div>
  </div>`}).join(''):'<div class="empty" style="padding:16px 0"><div class="ei" style="font-size:28px">◈</div><p style="font-size:12px">No expiring certs</p></div>';

  // Outstanding invoices
  const invEl=document.getElementById('dp-invs');
  invEl.innerHTML=awaitInvs.length?awaitInvs.slice(0,5).map(i=>{const t=calcInvTotal(i);return`<div class="di">
    <div class="di-main"><div class="di-addr">${i.clientName||'—'}</div><div class="di-meta">${i.number}</div></div>
    <div class="di-right"><span style="font-family:var(--fh);font-weight:700">£${t.grand.toFixed(0)}</span></div>
  </div>`}).join(''):'<div class="empty" style="padding:16px 0"><div class="ei" style="font-size:28px">✓</div><p style="font-size:12px">No outstanding invoices</p></div>';

  renderSLAJobs();
  loadDashNotes();
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS RENDER
// ════════════════════════════════════════════════════════════════
function renderSettings(){
  // Company tab
  const el=id=>document.getElementById(id);
  if(el('s-app-word1')) el('s-app-word1').value=S.appWord1||'Deep';
  if(el('s-app-word2')) el('s-app-word2').value=S.appWord2||'Flow';
  if(el('s-co-name')) el('s-co-name').value=S.coName||'';
  if(el('s-co-email')) el('s-co-email').value=S.coEmail||'';
  if(el('s-co-phone')) el('s-co-phone').value=S.coPhone||'';
  if(el('s-co-vat-num')) el('s-co-vat-num').value=S.coVatNum||'';
  if(el('s-co-addr')) el('s-co-addr').value=S.coAddr||'';
  if(el('s-co-web')) el('s-co-web').value=S.coWeb||'';
  if(el('s-co-reg')) el('s-co-reg').value=S.coReg||'';
  if(el('s-owner')) el('s-owner').value=S.owner||'';
  if(el('s-vat')) el('s-vat').value=S.vatRate||20;
  if(el('s-vat-main')) el('s-vat-main').value=S.vatRate||20;
  if(el('s-pay-terms')) el('s-pay-terms').value=S.payTerms||'Payment due within 14 days';
  if(el('s-inv-prefix')) el('s-inv-prefix').value=S.invPrefix||'INV-';
  if(el('s-agency-inv-prefix')) el('s-agency-inv-prefix').value=S.agencyInvPrefix||'AGN-';
  if(el('s-agency-inv-start')) el('s-agency-inv-start').value=S.agencyInvStart||2001;
  if(el('s-inv-start')) el('s-inv-start').value=S.invNextNum||S.invStart||1001;
  if(el('s-inv-notes')) el('s-inv-notes').value=S.invNotes||'Thank you for your business!';
  if(el('s-due-days')) el('s-due-days').value=S.dueDays||14;
  if(el('s-bank-name')) el('s-bank-name').value=S.bankName||'';
  if(el('s-bank-acc')) el('s-bank-acc').value=S.bankAcc||'';
  if(el('s-bank-sort')) el('s-bank-sort').value=S.bankSort||'';
  if(el('s-bank-iban')) el('s-bank-iban').value=S.bankIBAN||'';
  if(el('s-wa-job')) el('s-wa-job').value=S.waJobTpl||'';
  if(el('s-wa-inv')) el('s-wa-inv').value=S.waInvTpl||'';
  if(el('s-wa-tenant')) el('s-wa-tenant').value=S.waTenantTpl||'';
  if(el('s-wa-landlord')) el('s-wa-landlord').value=S.waLandlordTpl||'';
  if(el('s-wa-overdue')) el('s-wa-overdue').value=S.waOverdueTpl||'';
  if(el('s-cert-warn')) el('s-cert-warn').value=S.certWarnDays||30;
  if(el('s-missing-inv-days')) el('s-missing-inv-days').value=S.missingInvDays||3;
  if(el('s-cert-warn2')) el('s-cert-warn2').value=S.certWarnDays2||14;
  if(el('s-inv-reminder')) el('s-inv-reminder').value=S.invReminderDays||7;
  if(el('s-inv-reminder2')) el('s-inv-reminder2').value=S.invReminderDays2||14;
  if(el('s-job-remind-hrs')) el('s-job-remind-hrs').value=S.jobRemindHrs||24;
  if(el('s-notif-webhook-url')) el('s-notif-webhook-url').value=S.notifWebhookUrl||'';
  if(el('s-admin-pin')) el('s-admin-pin').value=S.adminPin||'';
  if(el('s-fontsize')) el('s-fontsize').value=S.fontSize||'normal';
  if(el('s-sidebar-w')) el('s-sidebar-w').value=S.sidebarWidth||'230';
  if(el('s-row-density')) el('s-row-density').value=S.rowDensity||'normal';

  // Checkboxes
  const cb=(id,val)=>{if(el(id))el(id).checked=val};
  cb('s-pin-lock',S.pinLock||false);
  cb('s-show-online',S.showOnlineStatus!==false);
  cb('s-show-fab',S.showFab!==false);
  cb('s-anim',S.animations!==false);
  cb('s-compact-badges',S.compactBadges||false);
  cb('s-notify-dash',S.notifyDash!==false);
  cb('s-notify-badge',S.notifyBadge!==false);
  cb('s-notif-webhook-enabled',S.notifWebhookEnabled===true);
  cb('s-notif-on-status',S.notifOnStatusChange!==false);
  cb('s-notif-on-cert',S.notifOnCertReady!==false);
  cb('s-notif-push-enabled',S.notifPushEnabled===true);
  cb('s-notif-next-tenant',S.notifNextTenantEta===true);
  cb('s-sla-dash',S.slaDash!==false);
  cb('s-req-checklist',S.reqChecklist||false);
  cb('s-gas-prompt',S.gasPrompt!==false);
  cb('s-auto-inv-s',S.autoInvOnComplete!==false);
  cb('s-show-price-eng',S.showPriceEng||false);
  cb('s-drag-sort',S.dragSort!==false);
  cb('s-confirm-delete',S.confirmDelete!==false);
  // Was S.autoDraftInv — a completely separate, dead setting key nothing
  // ever reads. This checkbox and 's-auto-inv-s' (Invoicing tab) are the
  // same feature under near-identical labels in two different settings
  // tabs; autoInvoice() only ever checks S.autoInvOnComplete, so toggling
  // this one previously had zero effect on real behavior. Pointed at the
  // same real key its sibling already uses correctly.
  cb('s-auto-inv',S.autoInvOnComplete!==false);
  // v10 Invoice sync & automation toggles
  cb('s-inv-auto-draft-complete',S.invAutoDraftOnComplete!==false);
  cb('s-inv-sync-amount',S.invSyncAmount!==false);
  cb('s-inv-sync-desc',S.invSyncDesc!==false);
  cb('s-inv-draft-on-job-change',S.invDraftOnJobChange!==false);
  cb('s-inv-notify-admin-edit',S.invNotifyAdminOnEdit!==false);
  cb('s-inv-show-audit',S.invShowAuditTrail!==false);

  // Appearance — mark active theme buttons
  ['dark','light'].forEach(t=>{
    const btn=el(`btn-theme-${t}`);
    if(btn){
      const isActive=(S.theme||'light')===t;
      btn.classList.toggle('btn-acc',isActive);
      btn.classList.toggle('btn-ghost',!isActive);
    }
  });
  // Accent swatches
  document.querySelectorAll('.accent-swatch').forEach(s=>s.classList.toggle('selected',s.dataset.c===(S.accent||'#f5a623')));
  if(el('custom-accent')) el('custom-accent').value=S.accent||'#f5a623';

  if(S.logoData) el('logo-preview-set')&&(el('logo-preview-set').innerHTML=`<img src="${S.logoData}" style="max-height:60px;max-width:200px;object-fit:contain">`);

  // v3 Invoice toggles
  const invCbs={
    's-inv-show-vat':'invShowVat','s-inv-show-bank':'invShowBank','s-inv-show-logo':'invShowLogo',
    's-inv-show-terms':'invShowTerms','s-inv-show-notes':'invShowNotes','s-inv-show-jobref':'invShowJobref',
    's-inv-show-agent':'invShowAgent','s-inv-show-payref':'invShowPayref','s-inv-show-subtotal':'invShowSubtotal',
    's-inv-show-sig':'invShowSig','s-inv-email-auto':'invEmailAuto','s-inv-cc-agent':'invCCAgent',
    's-inv-watermark-paid':'invWatermarkPaid',
    's-vat-enabled':'vatEnabled','s-vat-enabled-main':'vatEnabled',
  };
  Object.entries(invCbs).forEach(([elId,sKey])=>{if(el(elId))el(elId).checked=S[sKey]!==false});
  if(el('s-inv-pdf-color')) el('s-inv-pdf-color').value=S.invPdfColor||'#f5a623';
  if(el('s-inv-footer')) el('s-inv-footer').value=S.invFooter||'';
  if(el('s-inv-subtitle')) el('s-inv-subtitle').value=S.invSubtitle||'Tax Invoice';
  if(el('s-inv-sig-label')) el('s-inv-sig-label').value=S.invSigLabel||'Authorised Signature:';
  // Theme scheduler
  if(el('s-theme-mode')){el('s-theme-mode').value=S.themeMode||'manual';const sg=document.getElementById('s-theme-sched-grp');if(sg)sg.style.display=S.themeMode==='scheduled'?'':'none';}
  if(el('s-theme-light-start')) el('s-theme-light-start').value=S.themeLightStart||'07:00';
  if(el('s-theme-light-end')) el('s-theme-light-end').value=S.themeLightEnd||'20:00';
  const lbl=el('current-theme-lbl');if(lbl)lbl.textContent=document.body.classList.contains('theme-dark')?'🌙 Dark':'☀️ Light';
  // Render custom text blocks
  renderInvCustomTexts();
  const tb=document.querySelector('#st-trades tbody');
  if(tb) tb.innerHTML=(S.trades||[]).map((t,i)=>`<tr>
    <td><input class="fi" value="${t.name}" style="padding:5px" onchange="S.trades[${i}].name=this.value"></td>
    <td><div style="display:flex;align-items:center;gap:8px"><input type="color" value="${t.color}" onchange="S.trades[${i}].color=this.value"><span class="dot" style="background:${t.color}"></span></div></td>
    <td><input class="fi" type="number" value="${t.defPrice||0}" style="padding:5px;width:80px" onchange="S.trades[${i}].defPrice=+this.value"></td>
    <td><input class="fi" type="number" value="${t.defHours||0}" style="padding:5px;width:80px" onchange="S.trades[${i}].defHours=+this.value"></td>
    <td><button class="btn btn-red btn-xs" onclick="S.trades.splice(${i},1);renderSettings()">✕</button></td>
  </tr>`).join('');

  // Engineers table
  const eb=document.querySelector('#st-engs tbody');
  if(eb) eb.innerHTML=(S.engineers||[]).map((e,i)=>`<tr>
    <td><input class="fi" value="${e.name||''}" style="padding:5px;min-width:110px" onchange="S.engineers[${i}].name=this.value"></td>
    <td><input class="fi" value="${e.phone||''}" style="padding:5px;min-width:90px" onchange="S.engineers[${i}].phone=this.value"></td>
    <td><input class="fi" type="number" value="${e.rate||0}" style="padding:5px;width:65px" onchange="S.engineers[${i}].rate=+this.value" title="Hourly rate"></td>
    <td><input class="fi" type="number" value="${e.dayRate||0}" style="padding:5px;width:65px" onchange="S.engineers[${i}].dayRate=+this.value" title="Day rate"></td>
    <td><input class="fi" type="number" value="${e.costRate||0}" style="padding:5px;width:65px" onchange="S.engineers[${i}].costRate=+this.value" title="Cost to company per day"></td>
    <td><input class="fi" type="number" value="${e.otRate||0}" style="padding:5px;width:60px" onchange="S.engineers[${i}].otRate=+this.value" title="Overtime rate"></td>
    <td><input class="fi" value="${e.wa||''}" style="padding:5px;width:90px" placeholder="447..." onchange="S.engineers[${i}].wa=this.value"></td>
    <td><select class="fs" style="padding:5px;min-width:90px" onchange="S.engineers[${i}].trade=this.value">${(S.trades||[]).map(t=>`<option ${t.name===e.trade?'selected':''}>${t.name}</option>`).join('')}</select></td>
    <td><input class="fi" type="number" value="${e.capacity||8}" style="padding:5px;width:55px" onchange="S.engineers[${i}].capacity=+this.value"></td>
    <td><input class="fi" value="${e.pin||''}" style="padding:5px;width:65px" maxlength="6" placeholder="PIN" onchange="S.engineers[${i}].pin=this.value" title="Engineers use this PIN to log into mobile portal"></td>
    <td><button class="btn btn-red btn-xs" onclick="S.engineers.splice(${i},1);renderSettings()">✕</button></td>
  </tr>`).join('');

  // Access table
  const ab=document.querySelector('#st-access tbody');
  if(ab) ab.innerHTML=(S.access||[]).map((a,i)=>`<tr>
    <td><input class="fi" value="${a}" style="padding:5px" onchange="S.access[${i}]=this.value"></td>
    <td><button class="btn btn-red btn-xs" onclick="S.access.splice(${i},1);renderSettings()">✕</button></td>
  </tr>`).join('');

  // Users table — roles have clear hierarchy: Admin > Manager > Staff > Viewer
  const ub=document.querySelector('#st-users tbody');
  const ckBox=(val,prop,i)=>`<td style="text-align:center"><input type="checkbox" ${val?'checked':''} onchange="S.users[${i}].${prop}=this.checked"></td>`;
  const isCurrentAdmin=_appUser?.role==='Admin';

  if(ub) ub.innerHTML=(S.users||[]).map((u,i)=>{
    const isAdmin=u.role==='Admin';
    const isManager=u.role==='Manager';
    const roleColors={Admin:'rgba(245,166,35,.06)',Manager:'rgba(79,143,255,.06)',Staff:'',Viewer:'rgba(168,85,247,.06)'};
    const roleIcons={Admin:'👑',Manager:'🏢',Staff:'📋',Viewer:'👁'};
    const isProtectedAdmin = PROTECTED_ADMINS.includes((u.email||'').toLowerCase());
    const canDelete=isCurrentAdmin&&!isProtectedAdmin&&!(u.name===(_appUser?.name));
    return `<tr style="background:${roleColors[u.role]||''}">
    <td>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:14px">${roleIcons[u.role]||'👤'}</span>
        <input class="fi" value="${u.name||''}" style="padding:4px 6px;flex:1" onchange="S.users[${i}].name=this.value">
      </div>
    </td>
    <td><input class="fi" type="password" value="${u.pin||''}" style="padding:4px 6px;width:80px" placeholder="••••" maxlength="6" onchange="S.users[${i}].pin=this.value"></td>
    <td>
      <select class="fs" style="padding:4px 6px;font-size:12px" onchange="changeUserRole(${i},this.value)" ${!isCurrentAdmin||isProtectedAdmin?'disabled title="'+(isProtectedAdmin?'Protected admin — cannot be changed':'Only Admins can change roles')+'"':u.name===_appUser?.name&&u.role==='Admin'?'disabled title="Cannot change your own admin role"':''}>
        <option ${u.role==='Admin'?'selected':''} value="Admin">👑 Admin</option>
        <option ${u.role==='Manager'?'selected':''} value="Manager">🏢 Manager</option>
        <option ${u.role==='Finance'?'selected':''} value="Finance">💰 Finance</option>
        <option ${u.role==='Staff'?'selected':''} value="Staff">📋 Staff</option>
        <option ${u.role==='Viewer'?'selected':''} value="Viewer">👁 Viewer</option>
        <option ${u.role==='Engineer'?'selected':''} value="Engineer">🔧 Engineer</option>
      </select>
      ${isProtectedAdmin?'<span style="font-size:9px;color:var(--acc);font-weight:700;margin-left:4px">🔐</span>':''}
    </td>
    ${isAdmin
      ? `<td colspan="10" style="text-align:center;font-size:11px;padding:4px 12px"><span style="color:var(--acc);font-weight:700">👑 Admin — Full access including Settings, Users, all data. Cannot be changed by Managers.</span></td>`
      : isManager
      ? `<td colspan="10" style="text-align:center;font-size:11px;padding:4px 12px"><span style="color:#4f8fff;font-weight:700">🏢 Manager — Jobs, invoices, finance, reports. Cannot access Settings or manage users.</span></td>`
      : ckBox(u.canEdit,'canEdit',i)+ckBox(u.canDelete,'canDelete',i)+ckBox(u.canInvoice,'canInvoice',i)+ckBox(u.canFinance,'canFinance',i)+ckBox(u.seeLandlord!==false,'seeLandlord',i)+ckBox(u.seeLandlordPhone!==false,'seeLandlordPhone',i)+ckBox(u.seeAgent!==false,'seeAgent',i)+ckBox(u.seeContact!==false,'seeContact',i)+ckBox(u.seePrice!==false,'seePrice',i)+`<td></td>`
    }
    <td style="white-space:nowrap">
      ${canDelete
        ? `<button class="btn btn-red btn-xs" onclick="deleteUser(${i})" title="Remove from Supabase">🗑 Remove</button>`
        : u.name===(_appUser?.name)
          ? `<span style="font-size:10px;color:var(--txt3)">You</span>`
          : `<span style="font-size:10px;color:var(--txt3)">—</span>`
      }
    </td>
  </tr>`;
  }).join('');


  // Cert types table
  const ctb=document.querySelector('#st-cert-types tbody');
  if(ctb) ctb.innerHTML=(S.certTypes||[]).map((ct,i)=>`<tr>
    <td><div style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:50%;background:${ct.color||'#f5a623'};flex-shrink:0"></span><input class="fi" value="${ct.name||''}" style="padding:5px" onchange="S.certTypes[${i}].name=this.value"></div></td>
    <td><input class="fi" type="number" value="${ct.validity||12}" style="padding:5px;width:70px" onchange="S.certTypes[${i}].validity=+this.value"></td>
    <td><input class="fi" type="number" value="${ct.reminder||30}" style="padding:5px;width:70px" onchange="S.certTypes[${i}].reminder=+this.value"></td>
    <td><input type="color" value="${ct.color||'#f5a623'}" style="width:36px;height:30px;border:none;border-radius:6px;cursor:pointer;padding:1px" onchange="S.certTypes[${i}].color=this.value;renderSettings()"></td>
    <td><input class="fi" value="${(ct.keywords||[]).join(', ')}" style="padding:5px;min-width:200px" placeholder="e.g. gas, boiler, heating" onchange="S.certTypes[${i}].keywords=this.value.split(',').map(k=>k.trim()).filter(Boolean)"></td>
    <td><button class="btn btn-red btn-xs" onclick="S.certTypes.splice(${i},1);renderSettings()">✕</button></td>
  </tr>`).join('');

  // Checklists
  const clDiv=document.getElementById('st-checklists');
  if(clDiv){
    const cl=S.checklists||{};
    clDiv.innerHTML=Object.entries(cl).map(([trade,items])=>`
      <div style="background:var(--s2);border-radius:var(--r);padding:12px;border:1px solid var(--border)">
        <div style="font-family:var(--fh);font-weight:700;font-size:13px;margin-bottom:8px">${trade}
          <button class="btn btn-red btn-xs" style="margin-left:8px" onclick="delete S.checklists['${trade}'];renderSettings()">Remove</button>
        </div>
        ${items.map((it,i)=>`<div style="display:flex;gap:6px;margin-bottom:4px">
          <input class="fi" value="${it}" style="padding:4px 8px;flex:1" onchange="S.checklists['${trade}'][${i}]=this.value">
          <button class="btn btn-ghost btn-xs" onclick="S.checklists['${trade}'].splice(${i},1);renderSettings()">✕</button>
        </div>`).join('')}
        <button class="btn btn-ghost btn-xs" style="margin-top:4px" onclick="S.checklists['${trade}'].push('New item');renderSettings()">+ Add item</button>
      </div>
    `).join('');
  }
}

function addTradeRow(){S.trades.push({name:'New Trade',color:'#888',defPrice:0,defHours:1});renderSettings();_markSettingsUnsaved();}
function addEngRow(){
  // FIX 7: Engineers live in Supabase — adding a row is NOT saved until the user clicks
  // "Save Settings". Previously there was zero indication of this, so rows vanished silently
  // on navigation. Now we show a persistent banner and scroll to the save button.
  S.engineers.push({name:'',phone:'',rate:0,dayRate:0,hourlyRate:0,costRate:0,otRate:0,wa:'',trade:'',capacity:8,pin:''});
  renderSettings();
  _markSettingsUnsaved();
  // Scroll the new row into view
  setTimeout(()=>{
    const rows=document.querySelectorAll('#st-engs tbody tr');
    if(rows.length) rows[rows.length-1].scrollIntoView({behavior:'smooth',block:'center'});
  },100);
}

let _settingsUnsaved=false;
function _markSettingsUnsaved(){
  if(_settingsUnsaved) return;
  _settingsUnsaved=true;
  // Insert a sticky warning banner at top of settings pane if not already present
  let banner=document.getElementById('settings-unsaved-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='settings-unsaved-banner';
    banner.style.cssText='position:sticky;top:0;z-index:50;background:#f5a623;color:#1a1a1a;padding:10px 18px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:10px;';
    banner.innerHTML=`<span>⚠️ Unsaved changes — scroll down and click Save Settings or your new rows will be lost.</span>
      <button onclick="saveSettings();document.getElementById('settings-unsaved-banner')?.remove();window._settingsUnsaved=false;" style="background:#1a1a1a;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;">Save Now</button>`;
    const pane=document.getElementById('pg-settings')||document.querySelector('.page-settings');
    if(pane) pane.prepend(banner); else document.body.prepend(banner);
  }
}

// Sync all engineers to Supabase users table so they can log into the engineer portal
// Force-refresh users from Supabase and update the UI
// ═══════════════════════════════════════════════════════════════
// SUPABASE AUTH USER MANAGEMENT (Admin Settings)
// ═══════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  UNIFIED TEAM MANAGEMENT
//  One function: loadTeam() fetches ALL Supabase Auth users,
//  cross-references with our users table, and renders a single
//  unified list with role pickers for each person.
// ════════════════════════════════════════════════════════════════

async function loadTeam(){
  // SECURITY: Only Admins can manage the team
  if(_appUser?.role !== 'Admin'){
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
    const me = _appUser?.email;

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
              ${profile.name||'—'}
              ${isMe?'<span style="font-size:10px;background:rgba(79,143,255,.15);color:#4f8fff;padding:1px 7px;border-radius:10px">YOU</span>':''}
              <span style="font-size:10px;background:${ri.bg};color:${ri.col};padding:1px 7px;border-radius:10px;font-weight:700">✓ Active</span>
            </div>
            <div style="font-size:11px;color:var(--txt3);margin-top:2px">${au.email} · Last seen: ${lastSeen}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            <select style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:12px" ${isMe?'disabled':''} onchange="teamChangeRole('${profile.id}','${au.email}',this.value,this)">
              ${Object.entries(roleInfo).map(([v,r])=>`<option value="${v}" ${profile.role===v?'selected':''}>${r.icon} ${r.label}</option>`).join('')}
            </select>
            ${!isMe?`<button class="btn btn-red btn-xs" onclick="teamRevoke('${profile.id}','${profile.name||au.email}')">🗑 Remove</button>`:'<span style="font-size:11px;color:var(--txt3)">(you)</span>'}
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
            <div style="font-size:11px;color:var(--txt3)">${au.email}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap">
            <select id="trole-${au.id}" style="padding:6px 10px;border-radius:7px;border:1px solid var(--border);background:var(--s2);color:var(--txt);font-size:12px">
              ${roleOpts}
            </select>
            <button class="btn btn-acc btn-sm" onclick="teamAdd('${au.id}','${au.email}')">✅ Add</button>
          </div>
        </div>`;
      }
    });

    el.innerHTML = rows || '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:12px">No Supabase Auth users found. Add users in Supabase first.</div>';
    if(stat) stat.textContent = `${authUsers.length} Supabase user${authUsers.length!==1?'s':''} · ${ourUsers.length} in DeepFlow — last synced ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;

    // Sync S.engineers + S.users for job dropdowns — save to localStorage so refresh works
    // Preserve existing rate fields (dayRate, hourlyRate, costRate) if already set
    S.engineers = ourUsers.filter(u=>u.role==='engineer').map(u=>{
      const existing=(S.engineers||[]).find(e=>e.name===u.name)||{};
      return{
        _sbId:u.id, name:u.name, phone:u.phone||'', rate:u.rate||existing.rate||0,
        dayRate:existing.dayRate||0, hourlyRate:existing.hourlyRate||0, costRate:existing.costRate||0,
        otRate:existing.otRate||0, wa:existing.wa||'', trade:existing.trade||'', capacity:existing.capacity||8, pin:u.pin||'', email:u.email||''
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

  const isEng = role === 'engineer';
  const payload = {
    id: crypto.randomUUID(),
    name, email: email.toLowerCase(), role, active: true,
    auth_id: authId, pin: '',
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
async function teamRevoke(userId, name){
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
async function addEngineer(){ toast('Use Sync from Supabase to add engineers','info'); }
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


function addAccessRow(){S.access.push('New Access Type');renderSettings()}
function addPropRow(){S.properties=S.properties||[];S.properties.push({id:uid(),address:'',landlord:'',postcode:'',notes:''});renderSettings()}

// Write all S.users to Supabase users table so every device sees them on next load
// Immediately delete a user from Supabase and S.users
// Protected admin emails — these can NEVER be removed or demoted
const PROTECTED_ADMINS = ['mandeep@gbelectricals.co.uk', 'mandeepdynamics@gmail.com'];
const EMERGENCY_ADMINS = ['mandeepdynamics@gmail.com', 'mandeep@gbelectricals.co.uk'];

async function changeUserRole(i, newRole){
  if(_appUser?.role !== 'Admin' && _appUser?.role !== 'Manager'){
    toast('❌ Only Admins or Managers can change roles','error');
    renderSettings(); return;
  }
  const u = S.users[i];
  if(!u) return;

  // Block demotion of protected admins
  if(PROTECTED_ADMINS.includes((u.email||'').toLowerCase()) && newRole !== 'Admin'){
    toast('❌ This admin account is permanently protected and cannot be demoted','error');
    renderSettings(); return;
  }

  // Prevent self-demotion
  if(u.name === _appUser?.name && newRole !== 'Admin'){
    toast('❌ You cannot demote yourself — ask another Admin','error');
    renderSettings(); return;
  }

  // Prevent removing the last Admin
  const adminCount = (S.users||[]).filter(x=>x.role==='Admin').length;
  if(u.role==='Admin' && newRole!=='Admin' && adminCount <= 1){
    toast('❌ Cannot remove the last Admin — add another Admin first','error');
    renderSettings(); return;
  }

  S.users[i].role = newRole;
  if(u._sbId){
    const sbRole = newRole==='Admin'?'admin':newRole==='Manager'?'manager':newRole==='Viewer'?'viewer':newRole==='Engineer'?'engineer':'staff';
    await _sb(`users?id=eq.${u._sbId}`,{method:'PATCH',body:{role:sbRole},prefer:'return=minimal'}).catch(e=>{
      toast('⚠ Role updated locally — sync failed: '+e.message,'warn');
    });
    toast(`✅ ${u.name} is now ${newRole}`,'success');
  }
  renderSettings();
}

async function deleteUser(i){
  if(_appUser?.role !== 'Admin'){
    toast('❌ Only Admins can remove users','error');
    return;
  }
  const u=S.users[i];
  if(!u) return;
  if(PROTECTED_ADMINS.includes((u.email||'').toLowerCase())){
    toast('❌ This account is permanently protected and cannot be removed','error');
    return;
  }
  if(u.name===_appUser?.name){ toast('❌ You cannot delete your own account','error'); return; }
  if(!confirm(`Remove user "${u.name}" (${u.role})?\n\nThis will immediately delete them from Supabase. They will not be able to log in.`)) return;
  const statusEl=document.getElementById('user-sync-status');
  if(statusEl) statusEl.textContent='🗑 Removing '+u.name+'…';
  try{
    if(u._sbId){
      // Hard delete from Supabase (or set active=false to keep history)
      await _sb('users?id=eq.'+u._sbId,{method:'PATCH',body:{active:false},prefer:'return=minimal'});
    }
    S.users.splice(i,1);
    localStorage.setItem('df_setting_users',JSON.stringify(S.users));
    renderSettings();
    if(statusEl) statusEl.textContent='✅ '+u.name+' removed';
    toast(`✅ ${u.name} removed — they can no longer log in`,'success');
  }catch(e){
    toast('❌ Failed to remove from Supabase: '+e.message,'error');
    if(statusEl) statusEl.textContent='❌ Remove failed: '+e.message;
  }
}

async function syncOfficeUsers(){
  const users=S.users||[];
  let synced=0, failed=0;
  for(const u of users){
    if(!u.name) continue;
    // Map app role → Supabase role string
    const sbRole=u.role==='Admin'?'admin':u.role==='Manager'?'manager':u.role==='Viewer'?'viewer':'staff';
    const payload={name:u.name, pin:u.pin||'', role:sbRole, active:true};
    try{
      if(u._sbId){
        // Update existing row
        await _sb('users?id=eq.'+u._sbId,{method:'PATCH',body:payload,prefer:'return=minimal'});
      } else {
        // Check if already exists by name
        const existing=await _sb('users?name=ilike.'+encodeURIComponent(u.name)+'&role=neq.engineer&limit=1');
        if(existing&&existing[0]){
          u._sbId=existing[0].id;
          await _sb('users?id=eq.'+u._sbId,{method:'PATCH',body:payload,prefer:'return=minimal'});
        } else {
          // Insert new row
          const newId='usr-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
          await _sb('users',{method:'POST',body:{id:newId,...payload},prefer:'resolution=merge-duplicates,return=representation'});
          u._sbId=newId;
        }
      }
      synced++;
    }catch(err){
      console.warn('syncOfficeUsers failed for',u.name,err);
      failed++;
    }
  }
  // Also deactivate any Supabase non-engineer users that no longer exist in S.users
  try{
    const sbAll=await _sb('users?role=neq.engineer&active=eq.true&select=id,name');
    if(sbAll){
      for(const sb of sbAll){
        const stillExists=users.find(u=>u._sbId===sb.id||u.name===sb.name);
        if(!stillExists){
          await _sb('users?id=eq.'+sb.id,{method:'PATCH',body:{active:false},prefer:'return=minimal'});
        }
      }
    }
  }catch(e){ console.warn('[DeepFlow]', e); }
  // Persist updated _sbId values
  localStorage.setItem('df_setting_users',JSON.stringify(S.users));
  return {synced,failed};
}

// ════════════════════════════════════════════════════════════════
//  SUPABASE STORAGE STATS
// ════════════════════════════════════════════════════════════════
async function loadStorageStats(){
  const el=document.getElementById('sb-stats-body');
  if(!el)return;
  el.innerHTML='<div style="color:var(--txt3)">⏳ Loading…</div>';
  try{
    // Get all files in deepflow bucket
    // Use raw fetch for storage API (different base path)
    const storageRes=await fetch(`${SB_URL}/storage/v1/object/list/deepflow`,{
      method:'POST',
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+(await _getJWT()),'Content-Type':'application/json'},
      body:JSON.stringify({prefix:'',limit:10000,offset:0,sortBy:{column:'created_at',order:'desc'}})
    });
    const files=storageRes.ok?await storageRes.json():[];
    const items=Array.isArray(files)?files:[];
    let totalBytes=0;
    let photoCount=0, docCount=0;
    items.forEach(f=>{
      const sz=f.metadata?.size||0;
      totalBytes+=sz;
      if(f.metadata?.mimetype?.startsWith('image/')) photoCount++;
      else if(sz>0) docCount++;
    });
    const usedMB=(totalBytes/1024/1024).toFixed(2);
    const usedPct=Math.min(100,(totalBytes/(1024*1024*1024))*100).toFixed(1); // free tier = 1GB
    const freeMB=(1024-parseFloat(usedMB)).toFixed(0);
    el.innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px">
        <div style="background:var(--s2);border-radius:8px;padding:12px;border:1px solid var(--border)">
          <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Used</div>
          <div style="font-size:20px;font-weight:700;color:var(--txt1)">${usedMB} <span style="font-size:12px">MB</span></div>
          <div style="font-size:11px;color:var(--txt3)">of 1,024 MB free</div>
        </div>
        <div style="background:var(--s2);border-radius:8px;padding:12px;border:1px solid var(--border)">
          <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Free</div>
          <div style="font-size:20px;font-weight:700;color:#25d366">${freeMB} <span style="font-size:12px">MB</span></div>
          <div style="font-size:11px;color:var(--txt3)">remaining</div>
        </div>
        <div style="background:var(--s2);border-radius:8px;padding:12px;border:1px solid var(--border)">
          <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Files</div>
          <div style="font-size:20px;font-weight:700;color:var(--txt1)">${items.length}</div>
          <div style="font-size:11px;color:var(--txt3)">📷 ${photoCount} photos · 📄 ${docCount} docs</div>
        </div>
        <div style="background:var(--s2);border-radius:8px;padding:12px;border:1px solid var(--border)">
          <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">DB Tables</div>
          <div style="font-size:20px;font-weight:700;color:var(--txt1)" id="sb-table-count">—</div>
          <div style="font-size:11px;color:var(--txt3)">loading rows…</div>
        </div>
      </div>
      <div style="background:var(--s2);border-radius:8px;padding:10px 12px;border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px">
          <span style="color:var(--txt3)">Storage used</span>
          <span style="font-weight:600;color:var(--txt1)">${usedPct}%</span>
        </div>
        <div style="height:8px;background:var(--s3);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${usedPct}%;background:${parseFloat(usedPct)>80?'#ef4444':parseFloat(usedPct)>50?'#f59e0b':'#25d366'};border-radius:4px;transition:width .6s"></div>
        </div>
      </div>`;
    // Load row counts
    Promise.all(['jobs','persons','agencies','agents','certs','invoices'].map(async t=>{
      const r=await _sb(t+'?select=id&limit=1',{headers:{'Prefer':'count=exact'}}).catch(()=>null);
      return t;
    })).then(()=>{
      // Count all jobs
      _sb('jobs?select=id&limit=1',{prefer:'count=exact'}).then(r=>{
        const el2=document.getElementById('sb-table-count');
        if(el2) el2.textContent='active';
      }).catch(()=>{});
    });
  }catch(err){
    console.error('Storage stats error:',err);
    el.innerHTML=`<div style="color:#ef4444;font-size:12px">⚠️ Could not load stats: ${err.message?.slice(0,80)||'Check console'}</div>`;
  }
}
async function saveSettings(){
  // SECURITY: Only Admins can save settings
  if(_appUser?.role !== 'Admin'){
    toast('❌ Only Admins can change settings','error');
    return;
  }
  const get=id=>{const e=document.getElementById(id);return e?e.value:null};
  const getF=id=>{const e=document.getElementById(id);return e?parseFloat(e.value)||0:null};
  const getI=id=>{const e=document.getElementById(id);return e?parseInt(e.value)||0:null};
  const getCB=id=>{const e=document.getElementById(id);return e?e.checked:null};

  if(get('s-app-word1')!==null){S.appWord1=get('s-app-word1')||'Deep';updateLogo()}
  if(get('s-app-word2')!==null){S.appWord2=get('s-app-word2')||'Flow';updateLogo()}
  if(get('s-co-name')!==null) S.coName=get('s-co-name');
  if(get('s-co-email')!==null) S.coEmail=get('s-co-email');
  if(get('s-co-phone')!==null) S.coPhone=get('s-co-phone');
  if(get('s-co-vat-num')!==null) S.coVatNum=get('s-co-vat-num');
  if(get('s-co-addr')!==null) S.coAddr=get('s-co-addr');
  if(get('s-co-web')!==null) S.coWeb=get('s-co-web');
  if(get('s-co-reg')!==null) S.coReg=get('s-co-reg');
  if(get('s-owner')!==null) S.owner=get('s-owner');
  if(getF('s-vat')!==null) S.vatRate=getF('s-vat')||20;
  if(get('s-pay-terms')!==null) S.payTerms=get('s-pay-terms');
  if(get('s-inv-prefix')!==null) S.invPrefix=get('s-inv-prefix');
  if(getI('s-inv-start')!==null){
    const newStart=getI('s-inv-start')||1001;
    if(newStart!==S.invNextNum){
      S.invNextNum=newStart;
      _sb('rpc/admin_set_seq',{method:'POST',body:{seq_name:'inv_num_seq',new_start:newStart}}).catch(e=>console.warn('[admin_set_seq inv_num_seq]',e));
    }
  }
  if(get('s-agency-inv-prefix')!==null) S.agencyInvPrefix=get('s-agency-inv-prefix')||'AGN-';
  if(getI('s-agency-inv-start')!==null){
    const newStart=getI('s-agency-inv-start')||2001;
    if(newStart!==S.agencyInvStart){
      S.agencyInvStart=newStart;
      _sb('rpc/admin_set_seq',{method:'POST',body:{seq_name:'agn_num_seq',new_start:newStart}}).catch(e=>console.warn('[admin_set_seq agn_num_seq]',e));
    }
  }
  if(get('s-inv-notes')!==null) S.invNotes=get('s-inv-notes');
  if(getI('s-due-days')!==null) S.dueDays=getI('s-due-days')||14;
  if(get('s-bank-name')!==null) S.bankName=get('s-bank-name');
  if(get('s-bank-acc')!==null) S.bankAcc=get('s-bank-acc');
  if(get('s-bank-sort')!==null) S.bankSort=get('s-bank-sort');
  if(get('s-bank-iban')!==null) S.bankIBAN=get('s-bank-iban');
  if(get('s-wa-job')!==null) S.waJobTpl=get('s-wa-job');
  if(get('s-wa-inv')!==null) S.waInvTpl=get('s-wa-inv');
  if(get('s-wa-tenant')!==null) S.waTenantTpl=get('s-wa-tenant');
  if(get('s-wa-landlord')!==null) S.waLandlordTpl=get('s-wa-landlord');
  if(get('s-wa-overdue')!==null) S.waOverdueTpl=get('s-wa-overdue');
  if(getI('s-cert-warn')!==null) S.certWarnDays=getI('s-cert-warn')||30;
  if(getI('s-cert-warn2')!==null) S.certWarnDays2=getI('s-cert-warn2')||14;
  if(getI('s-inv-reminder')!==null) S.invReminderDays=getI('s-inv-reminder')||7;
  if(getI('s-inv-reminder2')!==null) S.invReminderDays2=getI('s-inv-reminder2')||14;
  if(getI('s-job-remind-hrs')!==null) S.jobRemindHrs=getI('s-job-remind-hrs')||24;
  if(getCB('s-notif-webhook-enabled')!==null) S.notifWebhookEnabled=getCB('s-notif-webhook-enabled');
  if(get('s-notif-webhook-url')!==null) S.notifWebhookUrl=get('s-notif-webhook-url').trim();
  if(getCB('s-notif-on-status')!==null) S.notifOnStatusChange=getCB('s-notif-on-status');
  if(getCB('s-notif-on-cert')!==null) S.notifOnCertReady=getCB('s-notif-on-cert');
  if(getCB('s-notif-push-enabled')!==null) S.notifPushEnabled=getCB('s-notif-push-enabled');
  if(getCB('s-notif-next-tenant')!==null) S.notifNextTenantEta=getCB('s-notif-next-tenant');
  if(get('s-admin-pin')!==null && get('s-admin-pin')) S.adminPin=get('s-admin-pin');

  // Checkboxes
  const cbs=['s-pin-lock','s-show-online','s-show-fab','s-anim','s-compact-badges',
    's-notify-dash','s-notify-badge','s-sla-dash','s-req-checklist','s-gas-prompt',
    's-auto-inv-s','s-show-price-eng','s-drag-sort','s-confirm-delete','s-auto-inv',
    's-inv-show-vat','s-inv-show-bank','s-inv-show-logo','s-inv-show-terms','s-inv-show-notes',
    's-inv-show-jobref','s-inv-show-agent','s-inv-show-payref','s-inv-show-subtotal',
    's-inv-show-sig','s-inv-email-auto','s-inv-cc-agent','s-inv-watermark-paid',
    's-inv-auto-draft-complete','s-inv-sync-amount','s-inv-sync-desc',
    's-inv-draft-on-job-change','s-inv-notify-admin-edit','s-inv-show-audit',
    's-vat-enabled','s-vat-enabled-main'];
  const cbKeys=['pinLock','showOnlineStatus','showFab','animations','compactBadges',
    'notifyDash','notifyBadge','slaDash','reqChecklist','gasPrompt',
    'autoInvOnComplete','showPriceEng','dragSort','confirmDelete','autoInvOnComplete',
    'invShowVat','invShowBank','invShowLogo','invShowTerms','invShowNotes',
    'invShowJobref','invShowAgent','invShowPayref','invShowSubtotal',
    'invShowSig','invEmailAuto','invCCAgent','invWatermarkPaid',
    'invAutoDraftOnComplete','invSyncAmount','invSyncDesc',
    'invDraftOnJobChange','invNotifyAdminOnEdit','invShowAuditTrail',
    'vatEnabled','vatEnabled'];
  cbs.forEach((id,i)=>{if(getCB(id)!==null)S[cbKeys[i]]=getCB(id)});
  // v3 text fields
  if(get('s-inv-pdf-color')) S.invPdfColor=get('s-inv-pdf-color');
  if(get('s-inv-footer')!==null) S.invFooter=get('s-inv-footer');
  if(get('s-inv-subtitle')!==null) S.invSubtitle=get('s-inv-subtitle');
  if(get('s-inv-sig-label')!==null) S.invSigLabel=get('s-inv-sig-label');
  if(get('s-theme-mode')) S.themeMode=get('s-theme-mode');
  if(get('s-theme-light-start')) S.themeLightStart=get('s-theme-light-start');
  if(get('s-theme-light-end')) S.themeLightEnd=get('s-theme-light-end');

  await saveAllSettings();
  // Sync both engineers AND office users to Supabase — so every device sees them on reload
  try{
    const [engResult, userResult] = await Promise.all([syncEngineers(), syncOfficeUsers()]);
    const n=typeof engResult==='number'?engResult:(engResult||0);
    const u=userResult?.synced||0;
    await saveAllSettings(); // persist _sbId values written during sync
    toast(`✅ Saved · ${n} engineer${n!==1?'s':''} + ${u} office user${u!==1?'s':''} synced to Supabase`,'success',4000);
  }catch(e){
    console.warn('Sync error:',e);
    toast('Settings saved locally (Supabase sync failed — check connection)','warn');
  }
  allProps=S.properties||[];
  applyTheme(S.theme || 'light');
  if(S.accent) setAccent(S.accent);
  if(S.fontSize) setFontSize(S.fontSize);
  if(S.sidebarWidth) setSidebarWidth(S.sidebarWidth);
  if(localStorage.getItem('df_sb_collapsed')==='1') toggleSidebar();
  // Update mini logo with company initials now that settings are loaded
  const miniMark=document.getElementById('sidebar-mini-mark');
  if(miniMark){
    const name=S?.coName||S?.appWord1||'DF';
    const initials=name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()||'DF';
    miniMark.textContent=initials;
  }
  if(S.rowDensity) setRowDensity(S.rowDensity);
  // Apply online status visibility
  const onlineWidget = document.querySelector('.sidebar-foot > div:first-child');
  if(onlineWidget) onlineWidget.style.display = S.showOnlineStatus===false ? 'none' : '';
  updateOnlinePanel();
  startThemeScheduler();
  toast('Settings saved ✓','success');
}

function handleLogoUpload(inp){
  const file=inp.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    S.logoData=e.target.result;
    await saveSetting('logoData',S.logoData);
    document.getElementById('logo-preview-set').innerHTML=`<img src="${S.logoData}" style="max-height:60px;max-width:200px;object-fit:contain">`;
    toast('Logo uploaded','success');
  };
  reader.readAsDataURL(file);
}

// ════════════════════════════════════════════════════════════════
//  BADGES & COMMAND PALETTE
// ════════════════════════════════════════════════════════════════
export async function updateBadges(){
  const invs=await dAll('invoices');
  const dc=invs.filter(i=>i.status==='Draft').length;
  const ib=document.getElementById('nb-inv');ib.textContent=dc;ib.style.display=dc?'':'none';
  const certs=await dAll('certs');
  const ec=certs.filter(c=>daysDiff(c.expiryDate)<=(S.certWarnDays||30)&&daysDiff(c.expiryDate)>=0).length;
  const cb=document.getElementById('nb-certs');cb.textContent=ec;cb.style.display=ec?'':'none';
  const jobs=await dAll('jobs');
  const pc=jobs.filter(j=>j.date===TODAY()&&j.status===STATUS.PENDING).length;
  const jb=document.getElementById('nb-jobs');jb.textContent=pc;jb.style.display=pc?'':'none';
}

function openCmd(){openModal('cmd-overlay');document.getElementById('cmd-input').value='';document.getElementById('cmd-input').focus();renderCmd('')}

document.getElementById('cmd-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('cmd-overlay'))closeModal('cmd-overlay')});

async function renderCmd(q){
  const ql=q.toLowerCase();
  const res=document.getElementById('cmd-results');
  let items=[];

  // Commands
  const cmds=[
    {ico:'⊞',title:'New Job',sub:'Create a new job',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:jobs',()=>{openJobModal()});nav('jobs')}},
    {ico:'◎',title:'New Invoice',sub:'Create a new invoice',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:inv',()=>{openNewInvModal()});nav('inv')}},
    {ico:'↩',title:'Credit Note',sub:'Issue a credit note',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:inv',()=>{openCreditNoteModal()});nav('inv')}},
    {ico:'🧾',title:'Log Expense',sub:'Track material / fuel cost',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:exp',()=>{openExpenseModal()});nav('exp')}},
    {ico:'◉',title:'Add Person',sub:'Add to directories',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:dir',()=>{openPersonModal()});nav('dir')}},
    {ico:'◈',title:'Add Certificate',sub:'Log a certificate',type:'Action',fn:()=>{closeModal('cmd-overlay');df.once('navDone:certs',()=>{openCertModal});nav('certs')}},
    {ico:'◈',title:'Dashboard',sub:'Go to dashboard',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('dash')}},
    {ico:'⊞',title:'Jobs',sub:'Open job management',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('jobs')}},
    {ico:'◎',title:'Invoices',sub:'Open invoices',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('inv')}},
    {ico:'🧾',title:'Expenses',sub:'Materials & expense tracking',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('exp')}},
    {ico:'◧',title:'Settings',sub:'Open settings',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('set')}},
    {ico:'▦',title:'Reports',sub:'View analytics',type:'Navigate',fn:()=>{closeModal('cmd-overlay');nav('rep')}},
  ];

  const matchCmds=q?cmds.filter(c=>(c.title+c.sub).toLowerCase().includes(ql)):cmds;
  items=matchCmds.slice(0,4);

  if(q.length>1){
    // Deep search: jobs (address, desc, notes, referrer, engineer)
    const jobs=(await dAll('jobs')).filter(j=>(j.address+j.description+j.referrer+j.notes+j.engineer).toLowerCase().includes(ql)).slice(0,3);
    jobs.forEach(j=>items.push({ico:'⊞',title:j.address,sub:j.description+' · '+j.date,type:'Job',fn:()=>{closeModal('cmd-overlay');jDate=j.date;df.once('navDone:jobs',()=>{openJobModal(j.id)});nav('jobs')}}));
    const ps=(await dAll('persons')).filter(p=>(p.name+p.phone+p.notes||'').toLowerCase().includes(ql)).slice(0,3);
    ps.forEach(p=>items.push({ico:'◉',title:p.name,sub:p.phone||p.email,type:'Person',fn:()=>{closeModal('cmd-overlay');df.once('navDone:dir',()=>{openPersonModal(p.id)});nav('dir')}}));
    // Deep invoice search — including line items
    const allInvs = await dAll('invoices');
    const invs = allInvs.filter(i=>{
      const base = (i.number+i.clientName+i.description+i.notes).toLowerCase();
      const lines = (i.items||[]).map(it=>it.desc).join(' ').toLowerCase();
      return base.includes(ql) || lines.includes(ql);
    }).slice(0,2);
    invs.forEach(i=>{const t=calcInvTotal(i);items.push({ico:'◎',title:i.number,sub:i.clientName+' · £'+t.grand.toFixed(2)+(i.items?.some(it=>it.desc?.toLowerCase().includes(ql))?' · matched in line items':''),type:'Invoice',fn:()=>{closeModal('cmd-overlay');df.once('navDone:inv',()=>{viewInv(i.id)});nav('inv')}})});
    // Expenses deep search
    const exps=(await dAll('expenses')).filter(e=>(e.desc+e.category+e.engineer+e.receipt||'').toLowerCase().includes(ql)).slice(0,2);
    exps.forEach(e=>items.push({ico:'🧾',title:e.desc,sub:'£'+e.cost.toFixed(2)+' · '+e.date+' · '+e.category,type:'Expense',fn:()=>{closeModal('cmd-overlay');nav('exp')}}));
    // Certs deep search
    const certs=(await dAll('certs')).filter(c=>(c.address+c.landlord+c.type+c.certNum).toLowerCase().includes(ql)).slice(0,2);
    certs.forEach(c=>items.push({ico:'◈',title:c.address,sub:c.type+' · Expiry: '+c.expiryDate,type:'Certificate',fn:()=>{closeModal('cmd-overlay');nav('certs')}}));
  }

  res.innerHTML=items.map((it,idx)=>`<div class="cmd-item ${idx===0?'ak':''}" onclick="cmdItems[${idx}].fn()">
    <div class="cmd-item-ico">${it.ico}</div>
    <div class="cmd-item-main"><div class="cmd-item-title">${it.title}</div><div class="cmd-item-sub">${it.sub||''}</div></div>
    <div class="cmd-item-type">${it.type}</div>
  </div>`).join('');
  window.cmdItems=items;
}

document.getElementById('cmd-input').addEventListener('keydown',e=>{
  const items=document.querySelectorAll('.cmd-item');
  let ak=[...items].findIndex(i=>i.classList.contains('ak'));
  if(e.key==='ArrowDown'){items[ak]?.classList.remove('ak');ak=Math.min(ak+1,items.length-1);items[ak]?.classList.add('ak');e.preventDefault()}
  else if(e.key==='ArrowUp'){items[ak]?.classList.remove('ak');ak=Math.max(ak-1,0);items[ak]?.classList.add('ak');e.preventDefault()}
  else if(e.key==='Enter'){if(window.cmdItems&&window.cmdItems[ak])window.cmdItems[ak].fn();closeModal('cmd-overlay')}
});

// ════════════════════════════════════════════════════════════════
//  BACKUP / RESTORE
// ════════════════════════════════════════════════════════════════
export async function exportBackup(){
  const data={
    jobs:await dAll('jobs'),
    persons:await dAll('persons'),
    invoices:await dAll('invoices'),
    certs:await dAll('certs'),
    overtime:await dAll('overtime'),
    payments:await dAll('payments'),
    expenses:await dAll('expenses'),
    agencies:await dAll('agencies'),
    agents:await dAll('agents'),
    settings:S,
    exportDate:new Date().toISOString()
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`DeepFlow-Backup-${TODAY()}.json`;a.click();
  toast('Backup exported','success');
}

async function importBackup(inp){
  const file=inp.files[0];if(!file)return;
  const text=await file.text();
  try{
    const data=JSON.parse(text);
    confirm2('Import Backup','This will overwrite all current data. Are you sure?',async()=>{
      if(data.jobs)for(const j of data.jobs) await dPut('jobs',j);
      if(data.persons)for(const p of data.persons) await dPut('persons',p);
      if(data.invoices)for(const i of data.invoices) await dPut('invoices',i);
      if(data.certs)for(const c of data.certs) await dPut('certs',c);
      if(data.overtime)for(const o of data.overtime) await dPut('overtime',o);
      if(data.payments)for(const p of data.payments) await dPut('payments',p);
      if(data.expenses)for(const e of data.expenses) await dPut('expenses',e);
      if(data.agencies)for(const a of data.agencies) await dPut('agencies',a);
      if(data.agents)for(const a of data.agents) await dPut('agents',a);
      if(data.settings){Object.assign(S,data.settings);await saveAllSettings()}
      toast('Backup imported successfully!','success');
      location.reload();
    });
  }catch(e){toast('Invalid backup file','error')}
}

async function clearAllData(){
  confirm2('⚠️ Clear ALL Data','This will permanently delete ALL jobs, invoices, people, and certificates. This cannot be undone!',async()=>{
    for(const tbl of ['jobs','persons','invoices','certs','agencies','agents','job_comments','activity','attachments','payments','expenses','overtime','engineer_requests','audit_log']){
      try{await _sb(tbl+'?id=neq.00000000-0000-0000-0000-000000000000',{method:'DELETE',prefer:'return=minimal'});}catch(e){ console.warn('[DeepFlow]', e); }
    }
    // FIX BUG1: payments/expenses/overtime now in Supabase — localStorage cleanup no longer needed
    toast('All data cleared','warn');location.reload();
  });
}

// ════════════════════════════════════════════════════════════════
//  INIT & SEED
// ════════════════════════════════════════════════════════════════
async function init(){
  await initDB();
  await loadSettings();
  allProps=S.properties||[];

  // Set default WA templates if empty
  if(!S.waJobTpl||S.waJobTpl.length<10){
    S.waJobTpl=`*{company_name}* — Job Dispatch 📋\n\nHi *{engineer_name}*, here are your jobs:\n\n{jobs_list}\n\nPlease confirm receipt ✅`;
    await saveSetting('waJobTpl',S.waJobTpl);
  }
  if(!S.waInvTpl||S.waInvTpl.length<10){
    S.waInvTpl=`Hello *{client_name}*,\n\nPlease find your invoice from *{company_name}*:\n\n📄 Invoice: *{invoice_num}*\n📝 For: {description}\n💰 Amount: *£{amount}*\n📅 Due: {due_date}\n\nPayment:\n{bank_details}\n\nThank you! 🙏`;
    await saveSetting('waInvTpl',S.waInvTpl);
  }
  if(!S.waTenantTpl||S.waTenantTpl.length<10){
    S.waTenantTpl=`Hello *{tenant_name}*,\n\n*{company_name}* will be visiting:\n\n🏠 {address}\n📅 {date}\n🕐 {time_slot}\n👷 Engineer: {engineer}\n\nPlease ensure access is available.\n📞 {company_phone}\n\nThank you!`;
    await saveSetting('waTenantTpl',S.waTenantTpl);
  }
  if(!S.waLandlordTpl||S.waLandlordTpl.length<10){
    S.waLandlordTpl=`Hello *{landlord_name}*,\n\nWork has been completed at *{address}*.\n\n✅ Job: {description}\n👷 Engineer: {engineer}\n\nAll works were completed satisfactorily.\n\nKind regards,\n*{company_name}*\n📞 {company_phone}`;
    await saveSetting('waLandlordTpl',S.waLandlordTpl);
  }
  if(!S.waOverdueTpl||S.waOverdueTpl.length<10){
    S.waOverdueTpl=`Hello *{client_name}*,\n\nFriendly reminder — Invoice *{invoice_num}* for *£{amount}* was due on {due_date} ({days_overdue} days ago).\n\nPlease arrange payment at your earliest convenience.\n\n*{company_name}*`;
    await saveSetting('waOverdueTpl',S.waOverdueTpl);
  }

  const jobs=await dAll('jobs');
  // Live Supabase — no seed needed

  // ── AUTO-MIGRATION: localStorage → Supabase ──────────────────────────────
  // This runs silently on every app load. If any data is found in localStorage
  // from the old local-only era, it is pushed to Supabase and the local copy
  // is removed. Safe to run forever — if localStorage is already empty it exits
  // instantly with zero network calls. No human action or memory required.
  (async function _autoMigrateLocalData(){
    const stores = ['payments','expenses','overtime'];
    let migrated = 0;
    for(const store of stores){
      try{
        const raw = localStorage.getItem('df_all_' + store);
        if(!raw) continue;
        const rows = JSON.parse(raw);
        if(!Array.isArray(rows) || !rows.length){
          localStorage.removeItem('df_all_' + store);
          continue;
        }
        // Push each row to Supabase (dPut is idempotent — safe to re-run)
        for(const row of rows){
          // Guard: payments require an invId — skip orphaned rows without one
          // (can happen from engineer-created ENG-* jobs that had no linked invoice)
          if(store === 'payments' && !row.invId) continue;
          await dPut(store, row);
        }
        // Only remove from localStorage after confirmed write
        localStorage.removeItem('df_all_' + store);
        migrated += rows.length;
        console.info(`[DeepFlow] Auto-migrated ${rows.length} ${store} records to Supabase`);
      }catch(e){
        // Never let migration failure break the app — silently log and continue
        console.warn(`[DeepFlow] Migration failed for ${store}:`, e);
      }
    }
    if(migrated > 0) toast(`✅ ${migrated} local records synced to cloud`,'success',4000);
  })();
  // ─────────────────────────────────────────────────────────────────────────
  
  renderDash();updateBadges();
  loadDashNotes();
  updateOnlinePanel();
  // _loadColPrefs() removed with legacy COL_DEFS system (ISSUE 5) — JOB_COLS handles its own state
  // applyColVisibility() removed — legacy table system no longer active (ISSUE 5)
  // Apply online status visibility
  const onlineWidget = document.querySelector('.sidebar-foot > div:first-child');
  if(onlineWidget && S.showOnlineStatus===false) onlineWidget.style.display = 'none';
  // Theme priority: localStorage (user's explicit choice) > DB setting > default light
  // Never use browser prefers-color-scheme — user sets their own preference in-app
  const _lsTheme = localStorage.getItem('df_theme');
  const savedTheme = _lsTheme || S.theme || 'light';
  // If DB has a theme that differs from localStorage, localStorage wins
  // (localStorage is the most recent explicit choice by the user on this device)
  if(savedTheme !== S.theme) S.theme = savedTheme;
  applyTheme(savedTheme);
  S.themeMode = S.themeMode || 'manual';
  startThemeScheduler();
  applyBranding();
  setTimeout(initDragDrop,500);
  setTimeout(_patchCmdSearch, 800);
  // Start live polling for notifications
  setTimeout(()=>{ _checkNotifPermissionUI(); startLivePoll(); }, 2000);
  // Check PIN lock after settings loaded
  if(S.pinLock && !_appUser) setTimeout(checkPinLock, 200);
  else {
    // No pin lock — this is a convenience "no login required" mode, not an
    // admin-access shortcut. It must NEVER silently sign in as a real staff
    // member (that was a genuine security bug — an unauthenticated visitor
    // could previously end up with a named Admin's full access). Instead it
    // gets a clearly-synthetic, minimal-trust guest identity: every
    // can*/see* flag defaults to false, matching what a brand-new,
    // unconfigured Staff account would have.
    if(!_appUser){
      _appUser={
        name:'Guest (no login required)', role:'Staff', _sbId:null,
        canEdit:false, canDelete:false, canInvoice:false, canFinance:false,
        seeLandlord:false, seeLandlordPhone:false, seeAgent:false, seeContact:false, seePrice:false
      };
    }
    applyUserPermissions();
  }
}

async function seedDemo(){
  const persons=[
    {id:uid(),name:'John Doe',phone:'07700100001',email:'john@example.com',wa:'447700100001',address:'1 Landlord Ave, London E1 1AB',notes:'Long term client',roles:['landlord','client']},
    {id:uid(),name:'Sarah Smith',phone:'07700100002',email:'sarah@example.com',wa:'',address:'5 Client Rd, London W1 2CD',notes:'',roles:['client']},
  ];
  for(const p of persons) await dPut('persons',p);

  const props=[
    {id:uid(),address:'12 Main St, London E1 1AA',landlord:'John Doe',postcode:'E1 1AA',notes:''},
    {id:uid(),address:'47 Oak Road, Manchester M1 1BB',landlord:'John Doe',postcode:'M1 1BB',notes:''},
    {id:uid(),address:'8 Park Lane, Birmingham B1 1CC',landlord:'Sarah Smith',postcode:'B1 1CC',notes:''},
    {id:uid(),address:'33 High Street, London N1 1DD',landlord:'John Doe',postcode:'N1 1DD',notes:''},
  ];
  S.properties=props;await saveSetting('properties',props);allProps=props;

  const now=Date.now();
  const jobs=[
    {id:uid(),date:TODAY(),address:'12 Main St, London E1 1AA',referrer:'John Doe',trade:'Gas',engineer:'Mike',description:'Annual Gas Safety Check',timeSlot:'9:00 – 11:00 AM',access:'Key Safe',contact:'Code: 1234 | Side gate',hours:2,price:150,notes:'',priority:'Normal',status:STATUS.PENDING,created:now-3000,modified:now},
    {id:uid(),date:TODAY(),address:'47 Oak Road, Manchester M1 1BB',referrer:'John Doe',trade:'Plumbing',engineer:'Mike',description:'Leaking Tap — Kitchen',timeSlot:'11:30 AM – 1:00 PM',access:'Tenant Home',contact:'07700 200001',hours:1.5,price:90,notes:'Bring 22mm fittings',priority:'Normal',status:STATUS.PENDING,created:now-2000,modified:now},
    {id:uid(),date:TODAY(),address:'8 Park Lane, Birmingham B1 1CC',referrer:'Sarah Smith',trade:'Electrical',engineer:'Dave',description:'Consumer Unit Inspection',timeSlot:'2:00 – 4:00 PM',access:'Landlord Present',contact:'07700 300001',hours:2,price:200,notes:'',priority:'Urgent',status:STATUS.IN_PROGRESS,created:now-1000,modified:now},
    {id:uid(),date:TODAY(),address:'33 High Street, London N1 1DD',referrer:'John Doe',trade:'General',engineer:'Mike',description:'Door Lock Replacement',timeSlot:'4:30 – 5:30 PM',access:'Key Safe',contact:'Code: 5678 | Front door',hours:1,price:75,notes:'',priority:'Normal',status:STATUS.PENDING,created:now,modified:now},
    {id:uid(),date:TODAY(),address:'22 Victoria Rd, London SW1 2EE',referrer:'John Doe',trade:'Gas',engineer:'Dave',description:'Gas Leak — Emergency',timeSlot:'ASAP',access:'Tenant Home',contact:'07700 400001',hours:0,price:0,notes:'Tenant reported smell of gas',priority:'Emergency',status:STATUS.PENDING,created:now+1,modified:now},
  ];
  for(const j of jobs) await dPut('jobs',j);

  // Draft invoice
  const inv={id:uid(),number:'INV-1001',clientId:persons[0].id,clientName:'John Doe',clientEmail:'john@example.com',clientAddr:'1 Landlord Ave, London',clientWA:'447700100001',
    date:TODAY(),dueDate:'',description:'Gas Safety Check at 12 Main St',jobId:jobs[0].id,
    items:[{desc:'Gas Safety Check',qty:1,unit:150,vat:true},{desc:'Gas Certificate',qty:1,unit:35,vat:false}],
    status:'Draft',created:now};
  await dPut('invoices',inv);

  // Gas cert expiring
  const d30=new Date();d30.setDate(d30.getDate()+25);
  await dPut('certs',{id:uid(),address:'12 Main St, London E1 1AA',type:'Gas Safety',landlord:'John Doe',issueDate:'2024-02-21',expiryDate:d30.toISOString().slice(0,10),certNum:'GS-2024-001',notes:''});
  await dPut('certs',{id:uid(),address:'47 Oak Road, Manchester M1 1BB',type:'Electrical',landlord:'John Doe',issueDate:'2024-08-01',expiryDate:'2029-08-01',certNum:'EL-2024-047',notes:''});

  await logActivity('DeepFlow v3 initialized — demo data loaded','info');
  toast('Welcome to DeepFlow! Demo data loaded.','success',5000);
}

// ════════════════════════════════════════════════════════════════
//  THEME SYSTEM (legacy stubs — real functions are in v3 block below)
// ════════════════════════════════════════════════════════════════
// toggleTheme, setTheme, applyTheme defined in v3 theme block
function setAccent(c){
  document.documentElement.style.setProperty('--acc',c);
  document.querySelectorAll('.accent-swatch').forEach(s=>s.classList.toggle('selected',s.dataset.c===c));
  // Logo word1 uses var(--acc) via inline style — already reactive via CSS var
  S.accent=c;saveSetting('accent',c);
}
function setFontSize(sz){
  document.body.classList.remove('fs-small','fs-large','fs-xlarge');
  if(sz!=='normal') document.body.classList.add('fs-'+sz);
  S.fontSize=sz;saveSetting('fontSize',sz);
}
function setSidebarWidth(w){
  document.getElementById('sidebar').style.width=w+'px';
  document.getElementById('sidebar').style.minWidth=w+'px';
  S.sidebarWidth=w;saveSetting('sidebarWidth',w);
}
function setRowDensity(d){
  document.body.classList.remove('density-compact','density-relaxed');
  if(d!=='normal') document.body.classList.add('density-'+d);
  S.rowDensity=d;saveSetting('rowDensity',d);
}
function applyStoredTheme(){
  if(S.theme) setTheme(S.theme);
  if(S.accent) setAccent(S.accent);
  if(S.fontSize) setFontSize(S.fontSize);
  if(S.sidebarWidth) setSidebarWidth(S.sidebarWidth);
  if(S.rowDensity) setRowDensity(S.rowDensity);
  if(document.getElementById('s-fontsize')) document.getElementById('s-fontsize').value=S.fontSize||'normal';
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS TABS
// ════════════════════════════════════════════════════════════════
// ── Portal Contacts (Client Portal "Call Us" numbers) ──────────────────────
async function loadPortalContacts(){
  const list=document.getElementById('portal-contacts-list');
  if(!list)return;
  try{
    const rows=await dAll('portal_contacts');
    rows.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    window._portalContacts=rows;
    renderPortalContactsList();
  }catch(e){
    list.innerHTML=`<div style="font-size:12px;color:var(--red);text-align:center;padding:16px">Could not load contacts. Have you run the SQL to create the portal_contacts table?</div>`;
  }
}
function renderPortalContactsList(){
  const list=document.getElementById('portal-contacts-list');
  if(!list)return;
  const rows=window._portalContacts||[];
  if(!rows.length){ list.innerHTML=`<div style="font-size:12px;color:var(--txt3);text-align:center;padding:16px">No contact numbers yet — add one below.</div>`; return; }
  list.innerHTML=rows.map(c=>`
    <div class="frow" style="align-items:flex-end;margin-bottom:8px" data-id="${c.id}">
      <div class="fg"><label class="fl">Label</label><input type="text" class="fi" value="${escHtml(c.label||'')}" placeholder="e.g. Repairs" onchange="updatePortalContact('${c.id}','label',this.value)"></div>
      <div class="fg"><label class="fl">Contact Name</label><input type="text" class="fi" value="${escHtml(c.contactName||'')}" placeholder="e.g. John Smith" onchange="updatePortalContact('${c.id}','contactName',this.value)"></div>
      <div class="fg"><label class="fl">Phone</label><input type="text" class="fi" value="${escHtml(c.phone||'')}" placeholder="e.g. 07123 456789" onchange="updatePortalContact('${c.id}','phone',this.value)"></div>
      <button class="btn btn-ghost btn-xs" style="color:var(--red)" onclick="deletePortalContact('${c.id}')">🗑</button>
    </div>`).join('');
}
function addPortalContactRow(){
  window._portalContacts=window._portalContacts||[];
  window._portalContacts.push({id:uid(),label:'',contactName:'',phone:'',sortOrder:window._portalContacts.length});
  renderPortalContactsList();
}
async function updatePortalContact(id,field,value){
  const c=(window._portalContacts||[]).find(x=>x.id===id);
  if(!c)return;
  c[field]=value;
  if(!c.label&&!c.contactName&&!c.phone)return;
  try{ await dPut('portal_contacts',c); toast('Contact saved','success'); }
  catch(e){ toast('Could not save — check the portal_contacts table exists','error'); }
}
async function deletePortalContact(id){
  const prev=window._portalContacts||[];
  window._portalContacts=prev.filter(c=>c.id!==id);
  renderPortalContactsList();
  try{ await dDel('portal_contacts',id); }
  catch(e){
    // Was a silent optimistic delete with no rollback — on failure the
    // contact vanished from the UI but stayed in the DB, so it would
    // reappear on next reload with no explanation. Restore + tell the user,
    // matching updatePortalContact()'s error handling just above.
    window._portalContacts=prev;
    renderPortalContactsList();
    toast('Could not delete — check the portal_contacts table exists','error');
  }
}

function switchSetTab(tab){
  if(tab==='guide') setTimeout(renderSqlSnippets, 50);
  if(tab==='portal-contacts') setTimeout(loadPortalContacts, 50);
  document.querySelectorAll('.set-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.set-tab-panel').forEach(p=>p.classList.toggle('active',p.id==='stab-'+tab));
}

// ════════════════════════════════════════════════════════════════
//  USER MENU
// ════════════════════════════════════════════════════════════════
function toggleUserMenu(){
  const m=document.getElementById('user-menu');
  m.style.display=m.style.display==='none'?'block':'none';
}
document.addEventListener('click',e=>{
  if(!e.target.closest('#user-pill')&&!e.target.closest('#user-menu')){
    const m=document.getElementById('user-menu');
    if(m) m.style.display='none';
  }
  // Close jobs more menu when clicking outside
  if(!e.target.closest('#jobs-more-menu')){
    const dd=document.getElementById('jobs-more-dd');
    if(dd)dd.style.display='none';
  }
});

// ════════════════════════════════════════════════════════════════
//  LOCK SCREEN
// ════════════════════════════════════════════════════════════════
// Unified logout — replaces old lockScreen
function lockScreen(){ doLogout(); }
function checkPin(v){ /* replaced by doLogin */ }
function updatePinDots(v){ /* no-op — old lock screen removed */ }


// ════════════════════════════════════════════════════════════════
//  JOBS VIEW — TABLE vs ENGINEER COLUMNS
// ════════════════════════════════════════════════════════════════
let jobsView='table';
function setJobsView(v){
  jobsView=v;
  const engView=document.getElementById('eng-view');
  const listPane=document.getElementById('jobs-list-pane');
  const calPane=document.getElementById('jobs-cal-pane');
  const btnEng=document.getElementById('btn-view-eng');
  const btnList=document.getElementById('btn-view-list');
  if(v==='engineer'){
    if(engView) engView.style.display='flex';
    if(listPane) listPane.style.display='none';
    if(calPane) calPane.style.display='none';
    if(btnEng){ btnEng.classList.add('btn-acc'); btnEng.classList.remove('btn-ghost'); btnEng.style.display='none'; }
    if(btnList) btnList.style.display='';
    renderEngView();
  } else {
    if(engView) engView.style.display='none';
    if(listPane) listPane.style.display='flex';
    if(calPane && _calPaneVisible) calPane.classList.remove('cal-hidden');
    if(btnEng){ btnEng.classList.remove('btn-acc'); btnEng.classList.add('btn-ghost'); btnEng.style.display=''; }
    if(btnList) btnList.style.display='none';
    renderJobs();
  }
}

async function renderEngView(){
  const jobs=await dAll('jobs');
  const dayJobs=jobs.filter(j=>j.date===jDate);
  dayJobs.sort((a,b)=>{
    const po={Emergency:0,Urgent:1,Normal:2,Low:3};
    return (po[a.priority]||2)-(po[b.priority]||2)||a.created-b.created;
  });

  const engineers=(S.engineers||[]).map(e=>e.name);
  const byEng={};
  engineers.forEach(e=>{byEng[e]=[]});
  byEng['Unassigned']=[];

  dayJobs.forEach(j=>{
    const k=j.engineer&&byEng[j.engineer]!==undefined?j.engineer:'Unassigned';
    byEng[k].push(j);
  });

  const wrap=document.getElementById('eng-view-wrap');
  wrap.innerHTML='';

  Object.entries(byEng).forEach(([eng,jobs])=>{
    if(eng!=='Unassigned'&&jobs.length===0) return; // skip empty engineers unless unassigned
    const col=document.createElement('div');
    col.className='eng-col'+(eng==='Unassigned'?' unassigned-col':'');
    const engObj=(S.engineers||[]).find(e=>e.name===eng)||{};
    const totalHrs=jobs.reduce((s,j)=>s+(j.hours||0),0);
    const cap=engObj.capacity||8;
    const pct=Math.min(100,totalHrs/cap*100);
    const capColor=pct>90?'var(--red)':pct>70?'var(--yellow)':'var(--green)';

    col.innerHTML=`
      <div class="eng-col-hd">
        <div>
          <div class="eng-col-name">${eng==='Unassigned'?'⚠️ Unassigned':eng}</div>
          <div class="eng-col-count">${jobs.length} job${jobs.length!==1?'s':''} · ${totalHrs}h</div>
          ${eng!=='Unassigned'?`<div style="margin-top:6px;height:3px;background:var(--border);border-radius:2px;width:120px"><div style="height:100%;width:${pct}%;background:${capColor};border-radius:2px;transition:width .3s"></div></div>
          <div style="font-size:10px;color:var(--txt3);margin-top:2px">${totalHrs}/${cap}h capacity</div>`:''}
        </div>
        ${eng!=='Unassigned'?`<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
          <button class="btn btn-wa btn-xs" onclick="waEngineerAllJobs('${eng}')">📱 All Jobs</button>
        </div>`:''}
      </div>
      <div id="ecol-${eng.replace(/\s/g,'_')}">
        ${jobs.length?jobs.map((j,idx)=>{
          const tc=tradeColor(j.trade);
          const prtyMap={Emergency:'🚨',Urgent:'🔥',Normal:'',Low:'↓'};
          const prty=prtyMap[j.priority]||'';
          return`<div class="eng-job-card" ondblclick="openJobModal('${j.id}')">
            <div class="eng-job-num">Job ${idx+1} of ${jobs.length}</div>
            <div class="eng-job-addr">
              <span class="dot" style="background:${tc};flex-shrink:0"></span>
              ${prty?`<span>${prty}</span>`:''}
              ${escHtml(j.address)}
            </div>
            <div class="eng-job-meta">
              ${j.timeSlot?`🕐 ${escHtml(j.timeSlot)}<br>`:''}
              🔧 ${escHtml(j.description)||'—'}<br>
              ${j.access?`🔑 ${escHtml(j.access)}${j.contact?' · '+escHtml(j.contact):''}<br>`:''}
              ${j.notes?`📝 ${escHtml(j.notes)}<br>`:''}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
              ${sBadge(j.status)}
              ${j.price?`<span style="font-family:var(--fh);font-weight:700;font-size:13px">£${Number(j.price).toFixed(0)}</span>`:''}
            </div>
            <div class="eng-job-actions">
              <button class="btn btn-wa btn-xs" onclick="waSingleEngJob('${j.id}','${eng}');event.stopPropagation()">📱 Send</button>
              <button class="btn btn-ghost btn-xs" onclick="openJobModal('${j.id}');event.stopPropagation()">✎ Edit</button>
              <select class="csel" style="font-size:11px;padding:3px 6px;width:auto;flex:1" onchange="quickStatus('${j.id}',this.value);setTimeout(renderEngView,300)" onclick="event.stopPropagation()">
                ${['Pending','In Progress','Completed','Invoiced','Cancelled'].map(s=>`<option ${j.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>`;
        }).join(''):`<div style="color:var(--txt3);font-size:12px;padding:20px;text-align:center">No jobs today</div>`}
      </div>
    `;
    wrap.appendChild(col);
  });
}

async function waSingleEngJob(jobId,engName){
  const j=await dGet('jobs',jobId);
  if(!j) return;
  const msg=buildJobWAMsg([j],engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=engObj?.wa||'';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

async function waEngineerAllJobs(engName){
  const jobs=await dAll('jobs');
  const ejobs=jobs.filter(j=>j.engineer===engName&&j.date===jDate);
  if(!ejobs.length){toast('No jobs today for '+engName,'warn');return}
  const msg=buildJobWAMsg(ejobs,engName);
  const engObj=(S.engineers||[]).find(e=>e.name===engName);
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=engObj?.wa||'';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

// ════════════════════════════════════════════════════════════════
//  DRAG & DROP JOB REORDERING
// ════════════════════════════════════════════════════════════════
let _dragSrc=null;

function initDragDrop(){
  const tbody=document.getElementById('jtbody');
  if(!tbody) return;
  tbody.addEventListener('dragstart',e=>{
    const row=e.target.closest('tr[data-id]');
    if(!row) return;
    _dragSrc=row;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed='move';
  });
  tbody.addEventListener('dragover',e=>{
    e.preventDefault();
    const row=e.target.closest('tr[data-id]');
    if(!row||row===_dragSrc) return;
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  tbody.addEventListener('dragleave',e=>{
    const row=e.target.closest('tr[data-id]');
    if(row) row.classList.remove('drag-over');
  });
  tbody.addEventListener('drop',async e=>{
    e.preventDefault();
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('dragging','drag-over'));
    const target=e.target.closest('tr[data-id]');
    if(!target||target===_dragSrc||!_dragSrc) return;
    const srcId=_dragSrc.dataset.id;
    const tgtId=target.dataset.id;
    const src=await dGet('jobs',srcId);
    const tgt=await dGet('jobs',tgtId);
    if(!src||!tgt) return;
    const tmpTs=src.created;
    src.created=tgt.created;
    tgt.created=tmpTs;
    await dPut('jobs',src);
    await dPut('jobs',tgt);
    _dragSrc=null;
    renderJobs();
  });
  tbody.addEventListener('dragend',()=>{
    document.querySelectorAll('#jtbody tr').forEach(r=>r.classList.remove('dragging','drag-over'));
    _dragSrc=null;
  });
}

// ════════════════════════════════════════════════════════════════
//  SCROLL LIST DRAG-TO-REORDER (within same date group)
// ════════════════════════════════════════════════════════════════

// ════ Column config — which columns show, and their widths ════
// ════════════════════════════════════════════════════════════
//  COLUMN SYSTEM — single source of truth
//  JOB_COLS drives: header, rows, resize, show/hide, persistence
// ════════════════════════════════════════════════════════════
const JOB_COLS = [
  // PERCENTAGE-BASED layout — auto-fits any screen size with zero manual adjustment.
  // The 20px drag handle + 4px stripe are fixed; remaining width split by pct below.
  // Address has flex:true so it absorbs rounding remainders and hidden-col space.
  {key:'jobnum',   label:'Job #',       pct:5,  minPct:3,  protect:true},
  {key:'address',  label:'Address',     pct:22, minPct:12, flex:true, protect:true},
  {key:'desc',     label:'Description', pct:18, minPct:8},
  {key:'access',   label:'Access',      pct:10, minPct:5},
  {key:'time',     label:'Time',        pct:7,  minPct:4},
  {key:'eng',      label:'Engineer',    pct:8,  minPct:5},
  {key:'price',    label:'Amount',      pct:6,  minPct:4},
  {key:'referrer', label:'Referrer',    pct:9,  minPct:5},
  {key:'sel',      label:'Status',      pct:9,  minPct:7,  fixed:true},
  {key:'actions',  label:'',            pct:6,  minPct:5,  fixed:true},
];

// Persist hidden cols + column percentages

(function _loadColState(){
  try{
    const raw = JSON.parse(localStorage.getItem('df_hidden_cols')||'[]');
    // Strip any protected columns that may have been hidden in a previous buggy session
    _hiddenCols = raw.filter(k => {
      const col = JOB_COLS.find(c => c.key === k);
      return col && !col.protect; // never hide protected columns
    });
  }catch(e){ _hiddenCols = []; }
  try{
    // Version-guard: if the saved pct count doesn't match JOB_COLS count,
    // discard them — they're from a different column layout and will misalign.
    // Also discard old px-based saves (values > 100 are clearly px not %)
    // Force-clear on version bump to apply new action column width
    const COL_VERSION = 'v4'; // bump this when JOB_COLS changes
    const savedVer = localStorage.getItem('df_col_ver');
    if(savedVer !== COL_VERSION){
      localStorage.removeItem('df_col_pcts');
      localStorage.removeItem('df_col_widths');
      localStorage.setItem('df_col_ver', COL_VERSION);
    } else {
      const saved = JSON.parse(localStorage.getItem('df_col_pcts')||'null');
      if(saved && Array.isArray(saved) && saved.length === JOB_COLS.length
         && saved.every(v => v === null || (v > 0 && v <= 100))){
        saved.forEach((p,i)=>{ if(p && JOB_COLS[i]) JOB_COLS[i].pct = p; });
      } else if(saved){
        localStorage.removeItem('df_col_pcts');
        localStorage.removeItem('df_col_widths');
      }
    }
  }catch(e){ console.warn('[DeepFlow]', e); }
})();

function _saveColState(){
  localStorage.setItem('df_hidden_cols', JSON.stringify(_hiddenCols));
  localStorage.setItem('df_col_pcts',    JSON.stringify(JOB_COLS.map(c=>c.pct||null)));
}

// Build the CSS grid template string from current JOB_COLS pct values.
// prefix = header prefix ('20px 4px' for header, '18px 16px 3px' for rows)
// Hidden columns collapse to 0px — their percentage is redistributed proportionally
// to visible columns so the total always fills 100%.
function getColTemplate(prefix){
  prefix = prefix || '20px 4px';
  const visible = JOB_COLS.filter(c => !_hiddenCols.includes(c.key));
  const hasFlex = visible.some(c => c.flex);

  // Calculate total pct of visible non-flex columns
  const visibleNonFlexPct = visible.filter(c => !c.flex).reduce((s, c) => s + (c.pct || 0), 0);
  const hiddenNonFlexPct = JOB_COLS.filter(c => _hiddenCols.includes(c.key) && !c.flex).reduce((s, c) => s + (c.pct || 0), 0);

  // Scale factor: if columns are hidden, scale up remaining non-flex columns proportionally
  // so they still fill the intended percentage of the remaining space
  const scale = (visibleNonFlexPct > 0 && hiddenNonFlexPct > 0) ? (visibleNonFlexPct + hiddenNonFlexPct) / visibleNonFlexPct : 1;

  let html = prefix + ' ';
  JOB_COLS.forEach(c => {
    if(_hiddenCols.includes(c.key)){ html += '0px '; return; }
    if(c.flex && hasFlex){
      // Flex column: minmax with minPct% lower bound, 1fr upper bound — absorbs hidden space
      html += 'minmax(40px, 1fr) ';
    }else{
      // Scale the pct proportionally if columns were hidden, then cap with minmax
      const scaledPct = Math.round(((c.pct || 0) * scale) * 10) / 10;
      const finalPct = Math.max(c.minPct || 3, scaledPct);
      html += 'minmax(40px, ' + finalPct + '%) ';
    }
  });
  return html.trim();
}

// Rebuild the sticky header from scratch so it always matches JOB_COLS exactly
function renderJobsHeader(){
  const hd = document.getElementById('jobs-col-hd');
  if(!hd) return;
  // Header prefix: 34px (drag+sel combined) + 3px (stripe) = 37px, same as row prefix
  const t = getColTemplate('34px 3px');
  hd.style.gridTemplateColumns = t;

  // Drag+sel combined placeholder + stripe placeholder
  let html = '<div></div><div></div>';

  JOB_COLS.forEach((c, i) => {
    const hidden = _hiddenCols.includes(c.key);
    const isFixed = c.fixed;
    const resizeHandle = !isFixed
      ? `<div class="col-resize-handle" data-resize-col="${i}" title="Drag to resize"></div>`
      : '';
    const extraStyle = c.key==='actions'
      ? 'display:flex;align-items:center;gap:4px;'
      : c.key==='price' ? 'justify-content:flex-end;' : '';

    const colMenu = c.key==='actions'
      ? `<button onclick="showColMenu(event)" title="Show/hide columns"
           style="margin-left:auto;background:var(--s2);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;color:var(--txt2);white-space:nowrap">⊞ Cols</button>`
      : '';

    html += `<div data-hd-col="${c.key}" style="position:relative;font-size:9px;font-weight:800;color:var(--txt3);
      text-transform:uppercase;letter-spacing:.8px;padding:6px 7px;display:${hidden?'none':'flex'};
      align-items:center;overflow:hidden;${extraStyle}">
      ${c.label}${colMenu}${resizeHandle}
    </div>`;
  });

  hd.innerHTML = html;
  // Re-attach resize mousedown after rebuilding
  _bindResizeHandles();
}

// Apply template + visibility to all rows without rebuilding header
// Header uses '20px 4px' prefix (drag placeholder + stripe placeholder)
// Rows use '18px 16px 3px' prefix (drag handle + sel-check + stripe)
function applyColTemplate(){
  const hdT = getColTemplate('34px 3px');   // header: drag+sel combined (34px) + stripe (3px) = 37px
  const rowT = getColTemplate('18px 16px 3px'); // rows: drag (18px) + sel-check (16px) + stripe (3px) = 37px

  // Header
  const hd = document.getElementById('jobs-col-hd');
  if(hd){
    hd.style.gridTemplateColumns = hdT;
    hd.querySelectorAll('[data-hd-col]').forEach(cell=>{
      cell.style.display = _hiddenCols.includes(cell.dataset.hdCol) ? 'none' : 'flex';
    });
  }
  // Rows — use data-col attributes for robust cell lookup
  document.querySelectorAll('.jsr3').forEach(row=>{
    row.style.gridTemplateColumns = rowT;
    row.querySelectorAll('[data-col]').forEach(cell=>{
      cell.style.display = _hiddenCols.includes(cell.dataset.col) ? 'none' : '';
    });
  });
}

// Show/hide column toggle
function toggleCol(key, show){
  // Never hide protected columns (address, status)
  const col = JOB_COLS.find(c=>c.key===key);
  if(col?.protect) return;
  if(show) _hiddenCols = _hiddenCols.filter(k=>k!==key);
  else if(!_hiddenCols.includes(key)) _hiddenCols.push(key);
  _saveColState();
  applyColTemplate();
  const hd = document.getElementById('jobs-col-hd');
  if(hd) hd.querySelectorAll('[data-hd-col]').forEach(cell=>{
    cell.style.display = _hiddenCols.includes(cell.dataset.hdCol) ? 'none' : 'flex';
  });
}

function showColMenu(e){
  e.stopPropagation();
  const existing = document.getElementById('col-menu');
  if(existing){ existing.remove(); return; }
  const menu = document.createElement('div');
  menu.id = 'col-menu';
  menu.style.cssText = 'position:fixed;z-index:6000;background:var(--s1);border:1px solid var(--border2);border-radius:10px;box-shadow:var(--sh2);padding:8px 0;min-width:190px;animation:mIn .1s ease';
  menu.innerHTML = '<div style="padding:6px 14px 4px;font-size:9px;font-weight:800;color:var(--txt3);text-transform:uppercase;letter-spacing:1px">Show / Hide Columns</div>'
    // Only show non-fixed, non-protected columns in the picker
    + JOB_COLS.filter(c=>!c.fixed && !c.protect).map(c=>`
    <label style="display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer;font-size:12px;color:var(--txt2)" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" ${_hiddenCols.includes(c.key)?'':'checked'} onchange="toggleCol('${c.key}',this.checked)" style="cursor:pointer;accent-color:var(--acc)">
      ${c.label}
    </label>`).join('')
    + `<div style="border-top:1px solid var(--border);margin:4px 0;padding:4px 14px">
      <button onclick="resetColWidths()" style="font-size:11px;color:var(--txt3);background:none;border:none;cursor:pointer;padding:0">↺ Reset widths</button>
    </div>`;
  const r = e.target.getBoundingClientRect();
  menu.style.left = Math.max(4, r.right - 200)+'px';
  menu.style.top  = (r.bottom + 4)+'px';
  document.body.appendChild(menu);
  // Close on click outside, NOT on clicks inside the menu (so checkboxes work)
  setTimeout(()=>{
    const closeMenu = (ev)=>{
      if(!menu.contains(ev.target)){
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    document.addEventListener('click', closeMenu);
  },50);
}

// Wrapper called from the "⊞ Choose Columns" ☰ dropdown item
function toggleColPicker(){
  // Find the ☰ menu button as the anchor (since we're calling from the dropdown)
  const menuBtn = document.querySelector('#jobs-more-menu > button');
  if(menuBtn){
    showColMenu({target: menuBtn, stopPropagation: ()=>{}, clientX: 0, clientY: 0});
  }
}

function resetColWidths(){
  // Reset each column's pct back to its original default
  const DEFAULTS = {jobnum:5,address:22,desc:18,access:10,time:7,eng:8,price:6,referrer:10,sel:10,actions:4};
  JOB_COLS.forEach(c=>{ c.pct = DEFAULTS[c.key] || c.pct; c.flex = (c.key==='address'); });
  _hiddenCols = [];
  localStorage.removeItem('df_col_pcts');
  _saveColState();
  renderJobsHeader();
  applyColTemplate();
  document.getElementById('col-menu')?.remove();
}

// ════ Column resize — Excel-style overlay ════
// FIX: Old system called applyColTemplate() on every mousemove, causing:
//   1. Full DOM reflow on every pixel — janky, cursor gets ahead of the column edge
//   2. The flex (address) column absorbed space changes mid-drag, so the handle
//      visual position jumped — dragging right made the column go left (reverse bug)
//   3. Reading JOB_COLS[colIdx].w on mousedown gave the stored w, not the rendered
//      pixel width — flex columns report w=null so startW was wrong from the start
//
// New approach: show a fixed vertical drag-line during drag (zero DOM reflow),
// read the REAL rendered pixel width from getBoundingClientRect on mousedown,
// apply the final width in ONE shot on mouseup. Exactly how Excel/Sheets does it.

let _colResizing = null, _colResizeStartX = 0, _colResizeStartW = 0;
let _resizeLine = null;

function _getResizeLine(){
  if(!_resizeLine){
    _resizeLine = document.createElement('div');
    _resizeLine.style.cssText = [
      'position:fixed','top:0','bottom:0','width:2px',
      'background:var(--acc)','opacity:.8','z-index:9999',
      'pointer-events:none','display:none',
      'box-shadow:0 0 6px rgba(245,166,35,.5)'
    ].join(';');
    document.body.appendChild(_resizeLine);
  }
  return _resizeLine;
}

function _bindResizeHandles(){
  const hd = document.getElementById('jobs-col-hd');
  if(!hd) return;
  hd.querySelectorAll('[data-resize-col]').forEach(handle=>{
    handle.onmousedown = e => {
      e.preventDefault(); e.stopPropagation();
      const colIdx = parseInt(handle.dataset.resizeCol);
      if(isNaN(colIdx) || !JOB_COLS[colIdx]) return;

      // Read ACTUAL rendered width in px from the header cell
      const headerCell = handle.closest('[data-hd-col]');
      const currentW = headerCell
        ? headerCell.getBoundingClientRect().width
        : 100;

      // Also read total grid width so we can convert px delta → pct delta on mouseup
      const gridW = hd.getBoundingClientRect().width - 24; // subtract drag+stripe

      _colResizing    = colIdx;
      _colResizeStartX = e.clientX;
      _colResizeStartW = currentW;
      _colResizeGridW  = gridW; // store for mouseup conversion

      const line = _getResizeLine();
      line.style.left    = e.clientX + 'px';
      line.style.display = 'block';

      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.classList.add('active');
    };
  });
}

let _colResizeGridW = 0; // total grid width captured on mousedown

document.addEventListener('mousemove', e=>{
  if(_colResizing === null) return;
  // Move ONLY the overlay line — no DOM reflow at all during drag
  const col     = JOB_COLS[_colResizing];
  const minPx   = _colResizeGridW > 0
    ? _colResizeGridW * ((col.minPct||3) / 100)
    : 40;
  const clampedX = Math.max(_colResizeStartX - _colResizeStartW + minPx, e.clientX);
  _getResizeLine().style.left = clampedX + 'px';
});

document.addEventListener('mouseup', e=>{
  if(_colResizing === null) return;

  const col   = JOB_COLS[_colResizing];
  const dxPx  = e.clientX - _colResizeStartX;
  const newPx = Math.max(
    (_colResizeGridW * (col.minPct||3) / 100),
    _colResizeStartW + dxPx
  );
  // Convert new pixel width back to percentage of total grid width
  const newPct = _colResizeGridW > 0
    ? Math.round((newPx / _colResizeGridW) * 100 * 10) / 10  // 1 decimal place
    : col.pct;

  col.pct  = Math.max(col.minPct || 3, newPct);
  col.flex = false; // lock flex column to fixed % if user resizes it

  _getResizeLine().style.display = 'none';
  _colResizing = null;
  document.body.style.cursor     = '';
  document.body.style.userSelect = '';

  document.querySelectorAll('[data-resize-col]').forEach(h=>{
    h.classList.remove('active');
    h.style.background = '';
    h.style.width      = '';
  });

  applyColTemplate();
  _saveColState();
});



// ════ Row drag — cross-date reorder ════
let _slDragSrc=null;
let _dragIndicator=null;
let _dragOverDate=null;

function _getDateGroup(el){
  const rows=el.closest('.jsg-rows');
  return rows?rows.dataset.date:null;
}

function initScrollListDrag(){
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  if(scroll._dragInited) return;
  scroll._dragInited=true;

  if(!_dragIndicator){
    _dragIndicator=document.createElement('div');
    _dragIndicator.style.cssText='position:fixed;left:0;right:0;height:2px;background:var(--acc);border-radius:1px;pointer-events:none;display:none;z-index:9999;box-shadow:0 0 8px rgba(245,166,35,.6)';
    document.body.appendChild(_dragIndicator);
  }

  // Auto-scroll zones
  let _scrollZoneUp=null,_scrollZoneDown=null,_scrollInterval=null,_scrollSpeed=0;
  function _ensureScrollZones(){
    if(_scrollZoneUp)return;
    _scrollZoneUp=document.createElement('div');_scrollZoneUp.className='jsr-scroll-zone up';
    _scrollZoneDown=document.createElement('div');_scrollZoneDown.className='jsr-scroll-zone down';
    document.body.appendChild(_scrollZoneUp);document.body.appendChild(_scrollZoneDown);
  }
  function _startAutoScroll(direction,speed){
    _stopAutoScroll();
    _scrollInterval=setInterval(()=>{
      const pane=document.getElementById('jobs-list-pane');
      if(pane)pane.scrollTop+=direction*speed;
    },16);
  }
  function _stopAutoScroll(){if(_scrollInterval){clearInterval(_scrollInterval);_scrollInterval=null;}}
  function _updateScrollZones(cy){
    _ensureScrollZones();
    const pane=document.getElementById('jobs-list-pane');
    if(!pane)return;
    const rect=pane.getBoundingClientRect();
    const zone=60;
    if(cy<rect.top+zone&&cy>rect.top){
      _scrollZoneUp.classList.add('active');_scrollZoneDown.classList.remove('active');
      const speed=Math.max(3,Math.round((rect.top+zone-cy)/4));
      if(_scrollSpeed!==-speed){_scrollSpeed=-speed;_startAutoScroll(-1,speed);}
    }else if(cy>rect.bottom-zone&&cy<rect.bottom){
      _scrollZoneUp.classList.remove('active');_scrollZoneDown.classList.add('active');
      const speed=Math.max(3,Math.round((cy-(rect.bottom-zone))/4));
      if(_scrollSpeed!==speed){_scrollSpeed=speed;_startAutoScroll(1,speed);}
    }else{
      _scrollZoneUp.classList.remove('active');_scrollZoneDown.classList.remove('active');
      _stopAutoScroll();_scrollSpeed=0;
    }
  }

  // Stored drop targets — set during dragover, read at drop time.
  let _dropTargetRow=null,_dropTargetDate=null,_insertAfter=false,_rafPending=false,_lastHovered=null;

  function _clearDragState(){
    document.querySelectorAll('.jsr3.dragging,.jsr3.drag-over').forEach(r=>r.classList.remove('dragging','drag-over'));
    document.querySelectorAll('.jsg-hd[data-drag-target]').forEach(h=>{h.style.background='';h.style.border='';delete h.dataset.dragTarget;});
    if(_dragIndicator)_dragIndicator.style.display='none';
    _dropTargetRow=null;_dropTargetDate=null;_insertAfter=false;_lastHovered=null;_rafPending=false;
    _stopAutoScroll();_scrollSpeed=0;
    if(_scrollZoneUp)_scrollZoneUp.classList.remove('active');
    if(_scrollZoneDown)_scrollZoneDown.classList.remove('active');
  }

  scroll.addEventListener('dragstart',e=>{
    if(!e.target.closest('.jsr-drag-handle')){e.preventDefault();return;}
    const row=e.target.closest('.jsr3[data-id]');
    if(!row)return;
    _slDragSrc=row;
    _clearDragState();
    setTimeout(()=>row.classList.add('dragging'),0);
    e.dataTransfer.effectAllowed='move';
    e.dataTransfer.setData('text/plain',row.dataset.id);

    // Multi-drag: if this row is selected along with others, drag them all
    const selCount=selJobs.size;
    const isMulti=selCount>1&&selJobs.has(row.dataset.id);
    try{
      const jobNum=row.querySelector('.jsr3-jobnum')?.textContent||'Job';
      const ghost=document.createElement('div');
      ghost.className='jsr3-ghost';
      ghost.textContent=isMulti?'↕ Moving '+selCount+' jobs':'↕ '+jobNum;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost,0,0);
      setTimeout(()=>ghost.remove(),0);
    }catch(_){}
  });

  scroll.addEventListener('dragover',e=>{
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    if(_rafPending)return;
    _rafPending=true;
    const cy=e.clientY,target=e.target;
    requestAnimationFrame(()=>{
      _rafPending=false;
      if(_lastHovered===target)return;
      _lastHovered=target;

      // Auto-scroll check
      _updateScrollZones(cy);

      const grpHd=target.closest('.jsg-hd[data-date-group]');
      const row=target.closest('.jsr3[data-id]');

      document.querySelectorAll('.jsr3.drag-over').forEach(r=>r.classList.remove('drag-over'));
      document.querySelectorAll('.jsg-hd[data-drag-target]').forEach(h=>{h.style.background='';h.style.border='';delete h.dataset.dragTarget;});
      if(_dragIndicator)_dragIndicator.style.display='none';

      if(grpHd){
        _dropTargetDate=grpHd.dataset.dateGroup;_dropTargetRow=null;
        grpHd.style.background='rgba(245,166,35,.2)';grpHd.style.border='1px dashed var(--acc)';grpHd.dataset.dragTarget='1';
      }else if(row&&row!==_slDragSrc){
        _dropTargetDate=null;_dropTargetRow=row;
        row.classList.add('drag-over');
        const rect=row.getBoundingClientRect();
        _insertAfter=cy>rect.top+rect.height/2;
        if(_dragIndicator){
          _dragIndicator.style.top=(_insertAfter?rect.bottom:rect.top)+'px';
          const pane=document.getElementById('jobs-list-scroll');
          const paneRect=pane?pane.getBoundingClientRect():{left:16,right:window.innerWidth-16};
          _dragIndicator.style.left=(paneRect.left+8)+'px';
          _dragIndicator.style.right=(window.innerWidth-paneRect.right+8)+'px';
          _dragIndicator.style.width='auto';_dragIndicator.style.display='block';
        }
      }
    });
  });

  scroll.addEventListener('dragleave',e=>{
    if(scroll.contains(e.relatedTarget))return;
    _clearDragState();
  });

  scroll.addEventListener('drop',async e=>{
    e.preventDefault();
    _stopAutoScroll();
    const srcId=_slDragSrc?.dataset.id;
    const isMultiDrag=selJobs.size>1&&selJobs.has(srcId);
    _slDragSrc=null;
    const dropDate=_dropTargetDate,dropRow=_dropTargetRow,insertAfter=_insertAfter;
    _clearDragState();
    if(!srcId)return;

    // Multi-drop: move all selected jobs
    if(isMultiDrag){
      const ids=[...selJobs];
      if(dropDate){
        ids.forEach(id=>{const j=_jobRowData[id];if(j){j.date=dropDate;j.modified=Date.now();}});
        toast('📅 Moved '+ids.length+' jobs to '+dropDate,'success',2000);
        renderJobs();
        Promise.all(ids.map(id=>_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{date:dropDate,modified:Date.now()},prefer:'return=minimal'}))).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
        clearSel();return;
      }
      if(!dropRow)return;
      const tgtId=dropRow.dataset.id;
      if(!tgtId||tgtId===srcId){renderJobs();return;}
      const tgt=_jobRowData[tgtId];
      if(!tgt){renderJobs();return;}
      // Cross-day multi-drop
      const src=_jobRowData[srcId];
      if(src&&src.date!==tgt.date){
        ids.forEach(id=>{const j=_jobRowData[id];if(j){j.date=tgt.date;j.modified=Date.now();}});
        toast('📅 Moved '+ids.length+' jobs to '+tgt.date,'success',2000);
        renderJobs();
        Promise.all(ids.map(id=>_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{date:tgt.date,modified:Date.now()},prefer:'return=minimal'}))).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
        clearSel();return;
      }
      // Same-day multi-reorder
      const fullGroup=Object.values(_jobRowData).filter(j=>j.date===tgt.date).sort((a,b)=>{
        const ao=a._sortOrder||0,bo=b._sortOrder||0;
        return(ao||bo)?ao-bo:(a.created||0)-(b.created||0);
      });
      const blockIds=ids.filter(id=>_jobRowData[id]&&_jobRowData[id].date===tgt.date);
      const otherIds=fullGroup.map(j=>j.id).filter(id=>!blockIds.includes(id));
      const tgtPos=otherIds.indexOf(tgtId);
      if(tgtPos===-1){renderJobs();return;}
      otherIds.splice(insertAfter?tgtPos+1:tgtPos,0,...blockIds);
      const saves=[];
      otherIds.forEach((id,i)=>{const j=_jobRowData[id];if(!j)return;const newOrd=(i+1)*1000;if(j._sortOrder===newOrd)return;j._sortOrder=newOrd;j.modified=Date.now();saves.push(_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{sortorder:newOrd,modified:Date.now()},prefer:'return=minimal'}));});
      toast('↕ Reordered '+ids.length+' jobs','success',1500);
      renderJobs();Promise.all(saves).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      clearSel();return;
    }

    // Single drop (original logic)
    const src=_jobRowData[srcId];
    if(!src){console.warn('[DeepFlow] drop: job not found',srcId);return;}
    const now=Date.now();
    if(dropDate&&dropDate!==src.date){
      src.date=dropDate;src.modified=now;_jobRowData[srcId]=src;
      toast('📅 Moved to '+dropDate,'success',2000);renderJobs();
      _sb('jobs?id=eq.'+encodeURIComponent(srcId),{method:'PATCH',body:{date:dropDate,modified:now},prefer:'return=minimal'})
        .catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      return;
    }
    if(!dropRow){renderJobs();return;}
    const tgtId=dropRow.dataset.id;
    if(!tgtId||tgtId===srcId){renderJobs();return;}
    const tgt=_jobRowData[tgtId];
    if(!tgt){console.warn('[DeepFlow] drop: tgt not found',tgtId);return;}
    if(src.date!==tgt.date){
      src.date=tgt.date;src.modified=now;_jobRowData[srcId]=src;
      toast('📅 Moved to '+tgt.date,'success',2000);renderJobs();
      _sb('jobs?id=eq.'+encodeURIComponent(srcId),{method:'PATCH',body:{date:tgt.date,modified:now},prefer:'return=minimal'})
        .catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
      return;
    }
    const fullGroup=Object.values(_jobRowData).filter(j=>j.date===src.date).sort((a,b)=>{
      const ao=a._sortOrder||0,bo=b._sortOrder||0;
      return(ao||bo)?ao-bo:(a.created||0)-(b.created||0);
    });
    const fullIds=fullGroup.map(j=>j.id);
    const withoutSrc=fullIds.filter(id=>id!==srcId);
    const tgtPos=withoutSrc.indexOf(tgtId);
    if(tgtPos===-1){renderJobs();return;}
    withoutSrc.splice(insertAfter?tgtPos+1:tgtPos,0,srcId);
    const saves=[];
    withoutSrc.forEach((id,i)=>{const j=_jobRowData[id];if(!j)return;const newOrd=(i+1)*1000;if(j._sortOrder===newOrd)return;j._sortOrder=newOrd;j.modified=now;saves.push(_sb('jobs?id=eq.'+encodeURIComponent(id),{method:'PATCH',body:{sortorder:newOrd,modified:now},prefer:'return=minimal'}));});
    toast('↕ Order saved','success',800);renderJobs();
    Promise.all(saves).catch(err=>{console.warn(err);_invalidateJobCache();renderJobs();});
  });

  scroll.addEventListener('dragend',()=>{_stopAutoScroll();_clearDragState();_slDragSrc=null;});
  requestAnimationFrame(()=>{renderJobsHeader();applyColTemplate();});
}


// ════════════════════════════════════════════════════════════════
//  NOTIFICATION SYSTEM — live updates from Supabase polling
// ════════════════════════════════════════════════════════════════
let _notifStore=[];
let _notifPollInterval=null;
let _notifLastSeen=0;
let _notifPanel=false;

function toggleNotifPanel(){
  _notifPanel=!_notifPanel;
  const p=document.getElementById('notif-panel');
  if(p){ p.style.display=_notifPanel?'flex':'none'; }
  if(_notifPanel){ renderNotifPanel(); _clearNotifBadge(); }
}

// Close panel when clicking outside
document.addEventListener('click',e=>{
  if(_notifPanel&&!e.target.closest('#notif-bell-wrap')){
    _notifPanel=false;
    const p=document.getElementById('notif-panel');
    if(p) p.style.display='none';
  }
});

function _clearNotifBadge(){
  const b=document.getElementById('notif-badge');
  if(b) b.style.display='none';
}

function _showNotifBadge(n){
  const b=document.getElementById('notif-badge');
  if(!b) return;
  b.textContent=n>9?'9+':String(n);
  b.style.display='';
}

function renderNotifPanel(){
  const list=document.getElementById('notif-list');
  if(!list) return;
  if(!_notifStore.length){
    list.innerHTML=`<div style="padding:32px;text-align:center;color:var(--txt3);font-size:12px">🔔 No notifications yet<br><span style="font-size:10px;opacity:.6">Live updates will appear here</span></div>`;
    return;
  }
  list.innerHTML=_notifStore.slice().reverse().map(n=>`
    <div style="display:flex;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;${n.unread?'background:rgba(245,166,35,.04)':''}" onclick="handleNotifClick('${n.id}')">
      <div style="font-size:18px;flex-shrink:0;margin-top:1px">${n.icon||'🔔'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:var(--txt);font-family:var(--fh)">${n.title}</div>
        <div style="font-size:11px;color:var(--txt2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.body}</div>
        <div style="font-size:10px;color:var(--txt3);margin-top:3px">${_notifTimeAgo(n.ts)}</div>
      </div>
      ${n.unread?'<div style="width:7px;height:7px;border-radius:50%;background:var(--acc);flex-shrink:0;margin-top:5px"></div>':''}
    </div>
  `).join('');
}

export function _notifTimeAgo(ts){
  const s=Math.round((Date.now()-ts)/1000);
  if(s<60) return 'Just now';
  if(s<3600) return Math.round(s/60)+'m ago';
  if(s<86400) return Math.round(s/3600)+'h ago';
  return new Date(ts).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
}

function handleNotifClick(id){
  const n=_notifStore.find(x=>x.id===id);
  if(n){ n.unread=false; if(n.action) n.action(); }
  renderNotifPanel();
}

function clearNotifs(){
  _notifStore=[];
  renderNotifPanel();
  _clearNotifBadge();
}

function _pushNotif(title,body,icon,action){
  const n={id:uid(),title,body,icon:icon||'🔔',ts:Date.now(),unread:true,action};
  _notifStore.push(n);
  // Cap at 50
  if(_notifStore.length>50) _notifStore.shift();
  const unread=_notifStore.filter(x=>x.unread).length;
  _showNotifBadge(unread);
  if(_notifPanel) renderNotifPanel();
  // Browser notification (if permitted)
  if(Notification.permission==='granted'){
    try{
      const bn=new Notification(`DeepFlow: ${title}`,{body,icon:'/favicon.ico',tag:n.id,silent:false});
      bn.onclick=()=>{ window.focus(); if(action) action(); bn.close(); };
    }catch(e){ console.warn('[DeepFlow]', e); }
  }
}

async function requestNotifPermission(){
  const btn=document.getElementById('notif-perm-btn');
  const bar=document.getElementById('notif-permission-bar');
  if(!('Notification' in window)){
    toast('Browser notifications not supported','error');return;
  }
  const perm=await Notification.requestPermission();
  if(perm==='granted'){
    toast('✅ Browser notifications enabled!','success');
    if(btn) btn.style.display='none';
    if(bar) bar.style.display='none';
    // Send a test notification
    setTimeout(()=>_pushNotif('Notifications enabled','You will now receive live updates when engineers update jobs or send requests.','✅'),500);
  } else {
    toast('Notifications blocked — check browser settings','error',5000);
  }
}

function _checkNotifPermissionUI(){
  const bar=document.getElementById('notif-permission-bar');
  const btn=document.getElementById('notif-perm-btn');
  if(!('Notification' in window)) return;
  if(Notification.permission==='default'){
    if(bar) bar.style.display='';
    if(btn) btn.style.display='';
  } else if(Notification.permission==='denied'){
    if(bar){ bar.style.display=''; bar.innerHTML='<span style="color:#e05252;font-weight:700">🚫 Notifications blocked.</span> To enable: click the lock icon in your browser address bar → Notifications → Allow.'; }
  }
}

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

// ── Live sync badge ───────────────────────────────────────────────────────────
let _liveSyncState = 'live'; // 'live' | 'syncing' | 'offline'
let _unsavedChanges = 0; // count of in-flight saves

function _setLiveBadge(state, label){
  _liveSyncState = state;
  const badge = document.getElementById('live-sync-badge');
  const dot   = document.getElementById('live-dot');
  const text  = document.getElementById('live-badge-text');
  if(!badge) return;
  badge.className = 'live-badge ' + state;
  const colors = {live:'#15803d', syncing:'#f59e0b', offline:'#b91c1c'};
  if(dot) dot.style.background = colors[state]||'#15803d';
  if(text) text.textContent = label || (state==='live'?'Live':state==='syncing'?'Syncing…':'Offline');
  // Pulse animation when syncing
  badge.style.opacity = state==='syncing' ? '.8' : '1';
}

function _setSyncing(){ _setLiveBadge('syncing','Syncing…'); }
function _setSynced() { _setLiveBadge('live','Live'); }
function _setOffline(){ _setLiveBadge('offline','Offline — check connection'); }

// Show "Synced" flash after each save
function _flashSynced(label='✓ Synced'){
  _setLiveBadge('live', label);
  setTimeout(()=>{ if(_liveSyncState==='live') _setLiveBadge('live','Live'); }, 2000);
}

// Wire into window online/offline events
window.addEventListener('online',  ()=>{ _setSynced(); toast('Connection restored','success',2000); });
window.addEventListener('offline', ()=>{ _setOffline(); toast('No internet — changes may not save','error',6000); });

// Warn on tab close if any pending saves

window.addEventListener('beforeunload', e=>{
  if(_pendingSaves > 0){
    e.preventDefault();
    e.returnValue = 'Changes are still syncing — wait a moment before closing.';
    return e.returnValue;
  }
});

async function startLivePoll(){
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
function startRealtimeSync(){
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
    // Add to cache \u2014 but only if it isn't already there. When THIS session
    // creates a job, saveJob() already adds it locally and re-renders
    // before Realtime's echo of our own INSERT typically arrives back \u2014
    // pushing unconditionally here duplicated every newly-created job in
    // the visible list until the next full refresh silently deduped it.
    if(_jobCache && !_jobCache.some(j=>j.id===job.id)) _jobCache.push(job);
    _pushNotif('New job added', `${job.jobNum||''} ${job.address||''}`.trim(), '\u2795', ()=>{ openJobModal(job.id); nav('jobs'); });
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
    if(_jobCache) _jobCache = _jobCache.filter(j => j.id !== id);
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
      toast('\u26a0\ufe0f This job was updated by another user. Save carefully to avoid overwriting their changes.', 'warn', 8000);
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
      const icon = {[STATUS.COMPLETED]:'\u2705',[STATUS.IN_PROGRESS]:'\ud83d\udd28',[STATUS.INVOICED]:'\u25ce',[STATUS.PENDING]:'\u23f3'}[job.status]||'\ud83d\udd14';
      let title;
      if(job.status===STATUS.IN_PROGRESS) title=`Engineer arrived — ${job.engineer||'Engineer'}`;
      else if(job.status===STATUS.COMPLETED) title=`Engineer completed & left — ${job.engineer||'Engineer'}`;
      else title=`Job updated — ${job.status}`;
      _pushNotif(title, `${job.jobNum||''} ${job.address||''}`.trim(), icon, ()=>{ openJobModal(job.id); nav('jobs'); });
    }

    // Notification for priority changes
    if(prev && prev.priority !== job.priority) {
      _pushNotif(`Priority changed — ${job.priority||'Normal'}`, `${job.jobNum||''} ${job.address||''}`.trim(), '\ud83d\udd14', ()=>{ openJobModal(job.id); nav('jobs'); });
    }
  }
}

// Compare two job objects and return list of changed field names
function getChangedFields(prev, curr){
  if(!prev || !curr) return ['all'];
  // _sortOrder (drag-to-reorder within the same day) was missing from this
  // list entirely, so a same-day reorder produced zero detected changes on
  // every OTHER open session — handleRealtimeChange saw updatedFields.length
  // === 0 and returned without doing anything. The row only updated once
  // that session navigated away and back, forcing a fresh fetch. Cross-day
  // drags worked because they change `date`, which was already tracked.
  const fields = ['status','priority','date','engineer','timeSlot','address','price','description','jobNum','_sortOrder'];
  return fields.filter(f => prev[f] !== curr[f]);
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
      engCell.innerHTML = job.engineer ? `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0"></span>${job.engineer}</span>` : '\u2014';
    }
  }

  // Time slot change
  if(changedFields.includes('timeSlot')) {
    const timeCell = row.querySelector('.jsr3-cell-time span');
    if(timeCell) timeCell.textContent = job.timeSlot || '\u2014';
  }

  // Price change
  if(changedFields.includes('price')) {
    const priceCell = row.querySelector('.jsr3-cell-price span');
    if(priceCell) priceCell.textContent = job.price ? `\u00a3${Number(job.price).toFixed(0)}` : '\u2014';
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
      descCell.textContent = descFull ? (descFull.length>80?descFull.slice(0,80)+'\u2026':descFull) : '\u2014';
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


let editPropId=null;

async function renderProps(){
  const search=(document.getElementById('prop-search')?.value||'').toLowerCase();
  const llFilter=document.getElementById('prop-ll-filter')?.value||'';
  const props=S.properties||[];
  
  // Populate landlord filter
  const lls=[...new Set(props.map(p=>p.landlord).filter(Boolean))];
  const llSel=document.getElementById('prop-ll-filter');
  if(llSel){
    const cur=llSel.value;
    llSel.innerHTML='<option value="">All Landlords</option>'+lls.map(l=>`<option ${l===cur?'selected':''}>${l}</option>`).join('');
  }
  
  let filtered=props;
  if(search) filtered=filtered.filter(p=>(p.address+p.landlord+p.postcode).toLowerCase().includes(search));
  if(llFilter) filtered=filtered.filter(p=>p.landlord===llFilter);
  
  const allJobs=await dAll('jobs');
  const allCerts=await dAll('certs');
  
  const grid=document.getElementById('props-grid');
  if(!grid) return;
  
  if(!filtered.length){
    grid.innerHTML='<div class="empty"><div class="ei">🏠</div><p>No properties yet. Add one to get started.</p></div>';
    return;
  }

  // Build table with hover popup
  const rows=filtered.map(p=>{
    const key=(p.address||'').toLowerCase().slice(0,20);
    const propJobs=allJobs.filter(j=>j.address&&j.address.toLowerCase().includes(key));
    const propCerts=allCerts.filter(c=>c.address&&c.address.toLowerCase().includes(key));
    const now=new Date();
    const expCerts=propCerts.filter(c=>{const d=daysDiff(c.expiryDate);return d>=0&&d<=60});
    const overdueCerts=propCerts.filter(c=>daysDiff(c.expiryDate)<0);
    const openJobs=propJobs.filter(j=>j.status===STATUS.PENDING||j.status===STATUS.IN_PROGRESS);
    const completedJobs=propJobs.filter(j=>j.status===STATUS.COMPLETED);

    const alertColor=overdueCerts.length?'var(--red)':expCerts.length?'var(--yellow)':'var(--acc)';
    const rowBg=overdueCerts.length?'rgba(224,82,82,.05)':expCerts.length?'rgba(240,192,48,.04)':'';

    // Build popup HTML
    const certLines=propCerts.slice(0,8).map(c=>{
      const d=daysDiff(c.expiryDate);
      const col=d<0?'var(--red)':d<=30?'var(--yellow)':d<=60?'#f0c030':'var(--green)';
      const label=d<0?`Expired ${Math.abs(d)}d ago`:d<=60?`Expires in ${d}d`:`Valid (${d}d)`;
      return`<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);gap:8px">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--txt1)">${c.type||'Cert'}</div>
          <div style="font-size:11px;color:var(--txt3)">${c.certNum||'—'}</div>
        </div>
        <span style="font-size:11px;color:${col};font-weight:600;white-space:nowrap">${label}</span>
      </div>`;
    }).join('');

    const jobLines=openJobs.slice(0,5).map(j=>`
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--txt1)">${j.description||j.trade||'Job'}</span>
        <span class="badge ${j.status===STATUS.PENDING?'b-pending':'b-progress'}" style="font-size:10px">${j.status}</span>
      </div>`).join('');

    const popup=`<div class="prop-popup" id="popup-${p.id}" style="display:none;position:fixed;z-index:9999;width:340px;background:var(--s1);border:1px solid var(--border2);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.25);padding:16px;font-family:var(--fb)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--txt1);margin-bottom:3px">${p.address||'—'}</div>
          <div style="font-size:12px;color:var(--txt3)">👤 ${p.landlord||'No landlord'} ${p.postcode?'· '+p.postcode:''}</div>
          ${p.type?`<div style="font-size:11px;color:var(--txt3)">${p.type}${p.beds?' · '+p.beds+' bed':''}</div>`:''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${overdueCerts.length?`<span style="background:rgba(224,82,82,.15);color:var(--red);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">❌ ${overdueCerts.length} Expired</span>`:''}
          ${expCerts.length?`<span style="background:rgba(240,192,48,.15);color:var(--yellow);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">⚠️ ${expCerts.length} Expiring</span>`:''}
          ${openJobs.length?`<span style="background:rgba(91,142,240,.15);color:var(--blue);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">⊞ ${openJobs.length} Open</span>`:''}
        </div>
      </div>

      ${propCerts.length?`<div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">📋 Certificates (${propCerts.length})</div>
        ${certLines}
        ${propCerts.length>8?`<div style="font-size:11px;color:var(--txt3);margin-top:4px">…and ${propCerts.length-8} more</div>`:''}
      </div>`:`<div style="text-align:center;padding:8px;font-size:12px;color:var(--txt3);margin-bottom:12px">No certificates on file</div>`}

      ${openJobs.length?`<div style="margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">⊞ Open Jobs (${openJobs.length})</div>
        ${jobLines}
      </div>`:''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px">
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="openPropModal('${p.id}');hidePropPopup()">✎ Edit Property</button>
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="nav('jobs');hidePropPopup()">⊞ View All Jobs</button>
        <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="nav('certs');hidePropPopup()">📋 View Certs</button>
        <button class="btn btn-acc btn-sm" style="font-size:11px" onclick="openJobModal();hidePropPopup()">+ Add Job</button>
      </div>
    </div>`;

    const statusDot=overdueCerts.length
      ?`<span style="width:10px;height:10px;border-radius:50%;background:var(--red);display:inline-block;flex-shrink:0"></span>`
      :expCerts.length
      ?`<span style="width:10px;height:10px;border-radius:50%;background:var(--yellow);display:inline-block;flex-shrink:0"></span>`
      :`<span style="width:10px;height:10px;border-radius:50%;background:var(--green);display:inline-block;flex-shrink:0"></span>`;

    return`<tr class="prop-row" style="background:${rowBg}" data-id="${p.id}">
      <td style="padding:12px 14px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          ${statusDot}
          <div>
            <div style="font-weight:600;font-size:14px;color:var(--txt1)">${p.address||'—'}</div>
            ${p.postcode?`<div style="font-size:11px;color:var(--txt3)">${p.postcode}</div>`:''}
          </div>
        </div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:13px;color:var(--txt2)">${p.landlord||'—'}</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--border);font-size:12px;color:var(--txt3)">${p.type||'—'}${p.beds?' · '+p.beds+' bed':''}</td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--border);text-align:center">
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
          ${overdueCerts.length?`<span style="background:rgba(224,82,82,.15);color:var(--red);padding:2px 7px;border-radius:10px;font-size:11px">❌${overdueCerts.length}</span>`:''}
          ${expCerts.length?`<span style="background:rgba(240,192,48,.15);color:var(--yellow);padding:2px 7px;border-radius:10px;font-size:11px">⚠️${expCerts.length}</span>`:''}
          ${propCerts.length&&!overdueCerts.length&&!expCerts.length?`<span style="color:var(--green);font-size:11px">✅ ${propCerts.length}</span>`:''}
          ${!propCerts.length?`<span style="color:var(--txt3);font-size:11px">—</span>`:''}
        </div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--border);text-align:center">
        <div style="display:flex;gap:6px;justify-content:center">
          ${openJobs.length?`<span style="background:rgba(91,142,240,.12);color:var(--blue);padding:2px 8px;border-radius:10px;font-size:11px">⊞${openJobs.length} open</span>`:''}
          <span style="color:var(--txt3);font-size:11px">${propJobs.length} total</span>
        </div>
      </td>
      <td style="padding:12px 14px;border-bottom:1px solid var(--border);text-align:right;position:relative">
        ${popup}
        <button class="btn btn-ghost btn-xs prop-arrow-btn" title="Show details"
          onmouseenter="showPropPopup('${p.id}',this)"
          onclick="openPropModal('${p.id}')"
          style="font-size:16px;padding:4px 10px">›</button>
      </td>
    </tr>`;
  }).join('');

  grid.innerHTML=`
    <table style="width:100%;border-collapse:collapse;background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:var(--s2)">
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Address</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Landlord</th>
          <th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Type</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Certificates</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Jobs</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;color:var(--txt3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // Hover-to-close: hide popup when mouse leaves
  grid.querySelectorAll('.prop-arrow-btn').forEach(btn=>{
    btn.addEventListener('mouseleave',e=>{
      const popup=btn.parentElement.querySelector('.prop-popup');
      if(popup) setTimeout(()=>{
        if(!popup.matches(':hover')) popup.style.display='none';
      },200);
    });
  });
}

function showPropPopup(id,btn){
  // Hide any open popups first
  document.querySelectorAll('.prop-popup').forEach(p=>p.style.display='none');
  const popup=document.getElementById('popup-'+id);
  if(!popup)return;
  // Position popup relative to viewport
  const r=btn.getBoundingClientRect();
  popup.style.display='block';
  popup.style.position='fixed';
  // Try to show above if near bottom
  const spaceBelow=window.innerHeight-r.bottom;
  if(spaceBelow<popup.offsetHeight+20){
    popup.style.top=(r.top-popup.offsetHeight-8)+'px';
  } else {
    popup.style.top=(r.bottom+8)+'px';
  }
  // Align right edge with button
  const rightEdge=r.right;
  if(rightEdge-340<10){
    popup.style.left='10px';
    popup.style.right='auto';
  } else {
    popup.style.left=(rightEdge-340)+'px';
    popup.style.right='auto';
  }
  // Allow hovering popup itself
  popup.onmouseleave=()=>{ setTimeout(()=>{ popup.style.display='none'; },200); };
  // Close on scroll or click outside
  const close=(e)=>{
    if(!popup.contains(e.target)&&e.target!==btn){ popup.style.display='none'; document.removeEventListener('click',close); }
  };
  setTimeout(()=>document.addEventListener('click',close),100);
}

function hidePropPopup(){
  document.querySelectorAll('.prop-popup').forEach(p=>p.style.display='none');
}

async function openPropModal(id){
  editPropId=id||null;
  if(id){
    const p=(S.properties||[]).find(x=>x.id===id);
    if(!p) return;
    document.getElementById('mo-prop-title').textContent='✎ Edit Property';
    document.getElementById('propf-addr').value=p.address||'';
    document.getElementById('propf-ll').value=p.landlord||'';
    document.getElementById('propf-pc').value=p.postcode||'';
    document.getElementById('propf-type').value=p.type||'Flat';
    document.getElementById('propf-beds').value=p.beds||'';
    document.getElementById('propf-notes').value=p.notes||'';
    document.getElementById('btn-del-prop').style.display='';
    document.getElementById('btn-prop-jobs').style.display='';
  } else {
    document.getElementById('mo-prop-title').textContent='🏠 Add Property';
    ['propf-addr','propf-ll','propf-pc','propf-notes'].forEach(x=>document.getElementById(x).value='');
    document.getElementById('propf-type').value='Flat';
    document.getElementById('propf-beds').value='';
    document.getElementById('btn-del-prop').style.display='none';
    document.getElementById('btn-prop-jobs').style.display='none';
  }
  openModal('mo-prop');
}

async function saveProp(){
  const addr=document.getElementById('propf-addr').value.trim();
  if(!addr){toast('Address required','error');return}
  const props=S.properties||[];
  const obj={
    id:editPropId||uid(),
    address:addr,
    landlord:document.getElementById('propf-ll').value.trim(),
    postcode:document.getElementById('propf-pc').value.trim(),
    type:document.getElementById('propf-type').value,
    beds:document.getElementById('propf-beds').value,
    notes:document.getElementById('propf-notes').value.trim()
  };
  const idx=props.findIndex(p=>p.id===obj.id);
  if(idx>=0) props[idx]=obj; else props.push(obj);
  S.properties=props;
  await saveSetting('properties',props);
  allProps=props;
  closeModal('mo-prop');
  renderProps();
  toast('Property saved','success');
}

async function deleteCurrentProp(){
  confirm2('Delete Property','Remove this property from the database?',async()=>{
    S.properties=(S.properties||[]).filter(p=>p.id!==editPropId);
    await saveSetting('properties',S.properties);
    allProps=S.properties;
    closeModal('mo-prop');renderProps();toast('Property deleted','warn');
  });
}

function viewPropJobs(){
  const p=(S.properties||[]).find(x=>x.id===editPropId);
  if(!p) return;
  closeModal('mo-prop');
  document.getElementById('j-search').value=p.address.slice(0,20);
  nav('jobs');
  renderJobs();
}

async function exportPropsCSV(){
  const props=S.properties||[];
  const rows=[['Address','Landlord','Postcode','Type','Beds','Notes']];
  props.forEach(p=>rows.push([p.address,p.landlord,p.postcode,p.type||'',p.beds||'',p.notes||'']));
  const csv=rows.map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='DeepFlow-Properties.csv';a.click();
  toast('Properties CSV exported','success');
}

// ════════════════════════════════════════════════════════════════
//  MARK INVOICE AS UNPAID (reverse payment)
// ════════════════════════════════════════════════════════════════
async function markInvUnpaid(id){
  confirm2('Mark as Unpaid','This will remove the paid status and restore all payments as unpaid. Are you sure?',async()=>{
    const inv=await dGet('invoices',id);
    inv.status='Awaiting Payment';
    await dPut('invoices',inv);
    // Delete all payments for this invoice
    const payments=await dAll('payments');
    const invPayments=payments.filter(p=>p.invId===id);
    for(const p of invPayments) await dDel('payments',p.id);
    await logActivity(`Invoice ${inv.number} marked as Unpaid (payments cleared)`,'invoice');
    toast('Invoice reset to Awaiting Payment','warn');
    renderInvList();viewInv(id);updateBadges();
  });
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS — additional helpers
// ════════════════════════════════════════════════════════════════
function addUserRow(){
  const users=S.users||[];
  users.push({id:uid(),name:'New User',pin:'',role:'Engineer',engineer:'',canEdit:false,canDelete:false,canInvoice:false,canFinance:false});
  S.users=users;renderSettings();
}
function addCertTypeRow(){
  const types=S.certTypes||[];
  const colors=['#5b8ef0','#f0c030','#e05252','#f07030','#25d58e','#b06ef0','#25d5a8','#f5a623'];
  const col=colors[types.length%colors.length];
  types.push({id:uid(),name:'New Cert Type',validity:12,reminder:30,keywords:[],color:col,prefix:'CERT-'});
  S.certTypes=types;saveSetting('certTypes',S.certTypes);renderSettings();
}
function addChecklistTrade(){
  const cl=S.checklists||{};
  const tname=prompt('Trade name for checklist:');
  if(!tname) return;
  cl[tname]=cl[tname]||['Item 1'];
  S.checklists=cl;renderSettings();
}
async function exportAllCSV(){
  const jobs=await dAll('jobs');
  const rows=[['Date','Address','Referrer','Trade','Engineer','Description','Time','Hours','Price','Status','Priority']];
  jobs.forEach(j=>rows.push([j.date,j.address,j.referrer,j.trade,j.engineer,j.description,j.timeSlot,j.hours||0,j.price||0,j.status,j.priority||'Normal']));
  const csv=rows.map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`DeepFlow-Jobs-All.csv`;a.click();
  toast('All jobs exported','success');
}
async function clearStore(store){
  confirm2(`Clear ${store}`,'This will permanently delete all records in this store.',async()=>{
    const all=await dAll(store);
    for(const item of all) await dDel(store,item.id);
    toast(`${store} cleared`,'warn');
    location.reload();
  });
}

// ════════════════════════════════════════════════════════════════
//  APP BRANDING
// ════════════════════════════════════════════════════════════════
function updateLogo(){
  const w1=document.getElementById('s-app-word1')?.value||S.appWord1||'Deep';
  const w2=document.getElementById('s-app-word2')?.value||S.appWord2||'Flow';
  const l1=document.getElementById('logo-word1');
  const l2=document.getElementById('logo-word2');
  if(l1) l1.textContent=w1;
  if(l2) l2.textContent=' '+w2.replace(/^\s+/,'');
  document.title=(w1+' '+w2.trim())+' — Pro';
}
function applyBranding(){
  updateLogo();
}

// ════════════════════════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  // Don't trigger if typing in input/textarea/select
  const tag=document.activeElement.tagName;
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
  if(document.querySelectorAll('.overlay.open').length>0) return;
  
  switch(e.key.toLowerCase()){
    case 'n': e.preventDefault(); nav('jobs'); setTimeout(openJobModal,100); break;
    case 'i': e.preventDefault(); nav('inv'); setTimeout(openNewInvModal,100); break;
    case 'd': e.preventDefault(); nav('dash'); break;
    case 'j': e.preventDefault(); nav('jobs'); break;
    case 'r': e.preventDefault(); nav('dir'); break;
    case '?': e.preventDefault(); toast('Shortcuts: N=New Job  I=New Invoice  D=Dashboard  J=Jobs  R=Directories  Ctrl+K=Search','info',5000); break;
  }
});

// ════════════════════════════════════════════════════════════════
//  CONTEXT MENU (right-click on job rows)
// ════════════════════════════════════════════════════════════════
let ctxJobId=null;
document.addEventListener('contextmenu',async e=>{
  const row=e.target.closest('.jsr3[data-id]')||e.target.closest('#jtbody tr[data-id]');
  if(!row) return;
  e.preventDefault();
  ctxJobId=row.dataset.id;
  const job=await dGet('jobs',ctxJobId);
  if(!job) return;
  
  const menu=document.getElementById('ctx-menu');
  const statusOpts=['Pending','In Progress','Completed','Invoiced','Cancelled'];
  menu.innerHTML=`
    <div style="padding:8px 14px 6px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--fh);font-weight:800;font-size:12px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px">${job.address||'Job'}</div>
      <div style="font-size:10px;color:var(--txt3);margin-top:2px">${job.jobNum||''} ${job.date||''}</div>
    </div>
    <div style="padding:4px 0">
      <div class="ctx-item" onclick="quickStatus('${job.id}','Completed');closeCtx()">✅ Mark Completed</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','In Progress');closeCtx()">🔨 Mark In Progress</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Cannot Access');closeCtx()">🚫 Mark Cannot Access</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Invoiced');closeCtx()">◎ Mark Invoiced</div>
      <div class="ctx-item" onclick="quickStatus('${job.id}','Cancelled');closeCtx()">✕ Mark Cancelled</div>
    </div>
    <div class="ctx-sep"></div>
    ${job.confirmed===false
      ? `<div class="ctx-item" onclick="closeCtx();quickConfirm('${job.id}',true)">✅ Mark as Confirmed</div>`
      : `<div class="ctx-item" onclick="closeCtx();quickConfirm('${job.id}',false)">⏳ Mark as Unconfirmed</div>`
    }
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();openJobModal('${job.id}')">✎ Open & Edit Job</div>
    <div class="ctx-item" onclick="closeCtx();openJobForInvoice('${job.id}')">◎ Create Invoice</div>
    <div class="ctx-item" onclick="closeCtx();duplicateJob('${job.id}')">⊞ Duplicate to Today</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();waSingleJobById('${job.id}')">📱 WhatsApp Engineer</div>
    <div class="ctx-item" onclick="closeCtx();sendTenantWA('${job.id}')">📅 Tenant Booking Confirm</div>
    <div class="ctx-item" onclick="closeCtx();sendLandlordComplete('${job.id}')">🏠 Landlord Work Done</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="closeCtx();ctxCopyAddr('${job.id}')">📋 Copy Address</div>
    <div class="ctx-item" onclick="closeCtx();showPropertyCerts('${job.address}')">◈ View Property Certs</div>
    <div class="ctx-item" onclick="closeCtx();showJobAudit('${job.id}')">🕐 Audit Trail</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" onclick="closeCtx();deleteJobById('${job.id}')">🗑 Delete Job</div>
  `;
  
  // Position menu
  let x=e.clientX, y=e.clientY;
  menu.style.display='block';
  const mw=menu.offsetWidth, mh=menu.offsetHeight;
  if(x+mw>window.innerWidth) x=window.innerWidth-mw-8;
  if(y+mh>window.innerHeight) y=window.innerHeight-mh-8;
  menu.style.left=x+'px'; menu.style.top=y+'px';
});

// ════ BROADCAST ALERTS ════
async function openBroadcast(){
  // Populate engineer targets
  const sel=document.getElementById('bc-target');
  if(sel){
    sel.innerHTML='<option value="all">Engineer</option>'+
      (S.engineers||[]).map(e=>`<option value="${e.name}">${e.name}</option>`).join('');
  }
  document.getElementById('bc-title').value='';
  document.getElementById('bc-msg').value='';
  document.querySelector('input[name="bc-type"][value="info"]').checked=true;
  document.getElementById('mo-broadcast').style.display='flex';
}

const _ALERTS_SQL=`CREATE TABLE IF NOT EXISTS engineer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text DEFAULT 'all',
  type text DEFAULT 'info',
  title text,
  message text,
  sent_by text,
  created bigint,
  expires bigint,
  status text DEFAULT 'active'
);
ALTER TABLE engineer_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engineer_alerts' AND policyname='allow_all') THEN
    CREATE POLICY "allow_all" ON engineer_alerts FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;`;

async function _ensureAlertsTable(){
  // Test if table exists by doing a quick count
  try{
    await _sb('engineer_alerts?limit=1&select=id');
    return true; // table exists
  }catch(e){
    // Try to create it via Supabase Management SQL API
    try{
      const res=await fetch(`${SB_URL}/rest/v1/rpc/exec_sql`,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY},
        body:JSON.stringify({query:_ALERTS_SQL})
      });
      if(!res.ok) throw new Error('RPC failed');
      return true;
    }catch(e2){
      return false;
    }
  }
}

async function sendBroadcast(){
  const target=document.getElementById('bc-target').value;
  const type=document.querySelector('input[name="bc-type"]:checked')?.value||'info';
  const title=document.getElementById('bc-title').value.trim();
  const msg=document.getElementById('bc-msg').value.trim();
  if(!title||!msg){ toast('Enter a title and message','warn'); return; }
  const btn=document.querySelector('#mo-broadcast .btn-acc');
  btn.disabled=true; btn.textContent='Sending…';
  try{
    const alertRow={
      id: uid(),
      target: target,
      type: type,
      title: title,
      message: msg,
      sent_by: _appUser?.name||'Office',
      created: Math.floor(Date.now()/1000),
      expires: Math.floor(Date.now()/1000)+3600,
      status: 'active'
    };
    try{
      await _sb('engineer_alerts',{method:'POST',body:alertRow,prefer:'return=minimal'});
    }catch(e){
      // Table might not exist — try creating it then retry
      btn.textContent='Creating table…';
      const created=await _ensureAlertsTable();
      if(!created){
        // Fallback: show the SQL so they can run it manually
        document.getElementById('mo-broadcast').style.display='none';
        showAlertSetupModal();
        btn.disabled=false; btn.textContent='📢 Send Now';
        return;
      }
      await _sb('engineer_alerts',{method:'POST',body:alertRow,prefer:'return=minimal'});
    }
    document.getElementById('mo-broadcast').style.display='none';
    toast(`📢 Alert sent to ${target==='all'?'all engineers':target}`,'success');
  }catch(e){
    document.getElementById('mo-broadcast').style.display='none';
    showAlertSetupModal();
    console.error('Broadcast error:',e);
  }
  btn.disabled=false; btn.textContent='📢 Send Now';
}

// ═══════════════════════════════════════════════
// SUPABASE STORAGE DASHBOARD (Admin only)
// ═══════════════════════════════════════════════
async function loadStorageDashboard(){
  const body=document.getElementById('storage-dashboard-body');
  const btn=document.getElementById('storage-refresh-btn');
  if(!body)return;
  body.innerHTML='<div style="text-align:center;padding:24px;color:var(--txt3);font-size:12px"><div class="spin" style="width:20px;height:20px;border-width:2px;margin:0 auto 8px"></div>Loading…</div>';
  if(btn){btn.disabled=true;btn.textContent='Loading…';}

  try{
    // Count each table
    const [jobs,users,certs,invoices,attachments,expenses,requests,alerts]=await Promise.all([
      _sb('jobs?select=id').catch(()=>[]),
      _sb('users?select=id,role').catch(()=>[]),
      _sb('certs?select=id').catch(()=>[]),
      _sb('invoices?select=id').catch(()=>[]),
      _sb('attachments?select=id,mime').catch(()=>[]),
      _sb('expenses?select=id').catch(()=>[]),
      _sb('engineer_requests?select=id').catch(()=>[]),
      _sb('engineer_alerts?select=id').catch(()=>[]),
    ]);

    const jCount=jobs.length||0;
    const uCount=users.length||0;
    const engCount=(users||[]).filter(u=>u.role==='engineer').length;
    const offCount=uCount-engCount;
    const cCount=certs.length||0;
    const invCount=invoices.length||0;
    const attCount=attachments.length||0;
    const expCount=expenses.length||0;
    const reqCount=requests.length||0;
    const alertCount=alerts.length||0;

    // Estimate storage
    const photos=(attachments||[]).filter(a=>a.mime&&a.mime.startsWith('image/')).length;
    const docs=attCount-photos;
    const estStorageMB=((photos*1.5)+(docs*0.2));
    const storagePct=Math.min(100,Math.round(estStorageMB/1024*100));

    // Estimate DB rows → MB (rough: ~2KB/job, ~1KB/cert, ~2KB/inv)
    const estDbKB=(jCount*2+cCount*1+invCount*2+uCount*0.5+expCount*1+reqCount*0.5);
    const estDbMB=estDbKB/1024;
    const dbPct=Math.min(100,Math.round(estDbMB/500*100));

    function bar(pct,limit,used,label){
      const col=pct>85?'#e05252':pct>60?'#f5a623':'#22c55e';
      const shadow=pct>85?'rgba(224,82,82,.3)':pct>60?'rgba(245,166,35,.3)':'rgba(34,197,94,.2)';
      return`<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:700;color:var(--txt2)">${label}</span>
          <span style="font-size:11px;color:${col};font-weight:800">${used} / ${limit}</span>
        </div>
        <div style="background:rgba(255,255,255,.06);border-radius:6px;height:8px;overflow:hidden">
          <div style="width:${Math.max(pct,1)}%;height:100%;background:${col};border-radius:6px;box-shadow:0 0 8px ${shadow};transition:width .8s ease"></div>
        </div>
        <div style="font-size:10px;color:var(--txt3);margin-top:4px">${pct}% used — ${pct<60?'✅ Plenty of space':'⚠️ Getting full'}</div>
      </div>`;
    }

    function statRow(icon,label,val,sub=''){
      return`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:16px;width:22px;text-align:center">${icon}</span>
        <span style="font-size:13px;color:var(--txt2);flex:1">${label}${sub?`<span style="font-size:10px;color:var(--txt3);margin-left:6px">${sub}</span>`:''}</span>
        <span style="font-size:14px;font-weight:800;color:var(--txt)">${val.toLocaleString()}</span>
      </div>`;
    }

    const planWarning=`<div style="background:rgba(245,166,35,.08);border:1px solid rgba(245,166,35,.2);border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.6;color:var(--yellow)">
      ⚠️ <strong>Free plan pauses after 7 days of zero activity.</strong> Since your team uses DeepFlow daily you're safe — but upgrade to Pro ($25/mo) when storage hits 60%+ or if the app ever goes offline unexpectedly.
    </div>`;

    const upgradeNote=storagePct>60||dbPct>40
      ?`<div style="background:rgba(224,82,82,.08);border:1px solid rgba(224,82,82,.2);border-radius:10px;padding:12px 14px;margin-top:12px;font-size:12px;color:#e05252;line-height:1.6">🔴 <strong>Consider upgrading to Pro.</strong> Storage is getting significant. Pro gives 100 GB files + 8 GB database + daily backups.</div>`
      :`<div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:10px;padding:12px 14px;margin-top:12px;font-size:12px;color:#22c55e;line-height:1.6">✅ <strong>You're well within free limits.</strong> No action needed — continue on the free plan.</div>`;

    body.innerHTML=`
      ${planWarning}

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin-bottom:10px">Storage Usage</div>
      ${bar(storagePct,'1 GB free',estStorageMB.toFixed(1)+' MB','📸 Photos & Files')}
      ${bar(dbPct,'500 MB free',estDbMB.toFixed(2)+' MB','🗄️ Database')}

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--txt3);margin:16px 0 6px">What's in your database</div>
      <div style="border-top:1px solid var(--border)">
        ${statRow('⚡','Jobs',jCount)}
        ${statRow('👤','Users',uCount,`${offCount} office · ${engCount} engineers`)}
        ${statRow('📄','Certificates',cCount)}
        ${statRow('🧾','Invoices',invCount)}
        ${statRow('📎','Uploaded files',attCount,`${photos} photos · ${docs} docs`)}
        ${statRow('💸','Expenses',expCount)}
        ${statRow('📬','Engineer requests',reqCount)}
        ${statRow('📢','Broadcast alerts',alertCount)}
      </div>
      ${upgradeNote}
      <div style="margin-top:12px;font-size:11px;color:var(--txt3);text-align:center">
        Estimated values · <a href="https://supabase.com/dashboard/project/dzqyqpuhxdrrpipbehpk" target="_blank" style="color:var(--acc)">View exact usage on Supabase →</a>
      </div>`;

  }catch(e){
    body.innerHTML=`<div style="color:var(--red);font-size:12px;text-align:center;padding:16px">❌ Failed to load: ${e.message}</div>`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='↺ Refresh';}
  }
}

async function createAllTables(){
  const btn=document.querySelector('[onclick="createAllTables()"]');
  const statusEl=document.getElementById('table-setup-status');
  if(btn){btn.disabled=true;btn.textContent='Creating tables…';}
  if(statusEl) statusEl.textContent='⏳ Working…';

  const tables=[
    {
      name:'engineer_requests',
      check:'engineer_requests?limit=1&select=id',
      sql:`CREATE TABLE IF NOT EXISTS engineer_requests (
  id text primary key,
  engineer_name text not null,
  type text not null,
  date text,
  hours numeric,
  rate text,
  job text,
  leave_type text,
  leave_from text,
  leave_to text,
  notes text,
  status text default 'pending',
  office_reply text,
  created bigint
);
ALTER TABLE engineer_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engineer_requests' AND policyname='allow_all') THEN CREATE POLICY "allow_all" ON engineer_requests FOR ALL USING (true) WITH CHECK (true); END IF; END $$;`
    },
    {
      name:'engineer_alerts',
      check:'engineer_alerts?limit=1&select=id',
      sql:`CREATE TABLE IF NOT EXISTS engineer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target text DEFAULT 'all',
  type text DEFAULT 'info',
  title text,
  message text,
  sent_by text,
  created bigint,
  expires bigint,
  status text DEFAULT 'active'
);
ALTER TABLE engineer_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engineer_alerts' AND policyname='allow_all') THEN CREATE POLICY "allow_all" ON engineer_alerts FOR ALL USING (true) WITH CHECK (true); END IF; END $$;`
    }
  ];

  const results=[];
  for(const t of tables){
    try{
      await _sb(t.check);
      results.push(`✅ ${t.name} already exists`);
    }catch(e){
      // Try creating via direct SQL execution
      try{
        // Supabase doesn't expose a direct SQL endpoint via REST API for anon keys
        // So we'll insert a test row — if table doesn't exist we show SQL to copy
        results.push(`⚠️ ${t.name} missing — copy SQL below`);
      }catch(e2){
        results.push(`❌ ${t.name} — error`);
      }
    }
  }

  if(statusEl) statusEl.innerHTML=results.join('<br>');
  if(btn){btn.disabled=false;btn.textContent='⚡ Create All Required Tables Now';}

  // Check if any are missing — if so, open Supabase + copy combined SQL
  const missing=[];
  for(const t of tables){
    try{ await _sb(t.check); }
    catch(e){ missing.push(t); }
  }
  if(missing.length>0){
    const combinedSql=missing.map(t=>t.sql).join('\n\n');
    try{
      await navigator.clipboard.writeText(combinedSql);
      if(statusEl) statusEl.innerHTML=`📋 SQL copied to clipboard!<br>Opening Supabase SQL Editor…<br><br>Paste and click Run, then come back and try again.`;
    }catch(e){ console.warn('[DeepFlow]', e); }
    setTimeout(()=>window.open('https://supabase.com/dashboard/project/dzqyqpuhxdrrpipbehpk/sql/new','_blank'),400);
  } else {
    if(statusEl) statusEl.innerHTML='✅ All tables exist — ready to go!';
    toast('✅ All tables confirmed ready','success');
  }
}

function showAlertSetupModal(){
  // Show a modal with the SQL to copy-paste into Supabase
  const sql=_ALERTS_SQL;
  if(confirm('The engineer_alerts table needs to be created in Supabase first.\n\nClick OK to open the Supabase SQL Editor — paste and run the SQL shown after.')){
    window.open('https://supabase.com/dashboard/project/dzqyqpuhxdrrpipbehpk/sql/new','_blank');
    // Copy SQL to clipboard
    navigator.clipboard?.writeText(sql).then(()=>{
      toast('SQL copied to clipboard — paste it into Supabase SQL Editor and click Run','success',8000);
    }).catch(()=>{
      toast('Open Supabase SQL Editor and run the engineer_alerts table SQL from Settings → SQL Tools','warn',8000);
    });
  }
}

function closeCtx(){
  document.getElementById('ctx-menu').style.display='none';
  ctxJobId=null;
}

function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const btn=document.getElementById('sidebar-toggle');
  sb.classList.toggle('collapsed');
  const col=sb.classList.contains('collapsed');
  if(btn){ btn.textContent=col?'›':'‹'; btn.title=col?'Expand sidebar':'Collapse sidebar'; }
  // Update mini logo initials from company name
  const miniMark=document.getElementById('sidebar-mini-mark');
  if(miniMark){
    const name=S?.coName||S?.appWord1||'DF';
    const initials=name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase()||'DF';
    miniMark.textContent=initials;
  }
  localStorage.setItem('df_sb_collapsed',col?'1':'');
}

async function ctxCopyAddr(id){
  const j=await dGet('jobs',id);
  if(!j) return;
  try{ await navigator.clipboard.writeText(j.address||''); toast('📋 Address copied','success',1500); }
  catch(e){ toast('Copy failed','error'); }
}

// ── Tooltip system — FIXED position anchored to the cell ─────
// showTip() now positions relative to the hovered cell, not the cursor.
// This means the tooltip never moves after appearing and never follows the mouse.
// moveTip() is removed — no mouse tracking needed.

async function _copyJobDesc(jobId){
  const j=await dGet('jobs',jobId);
  if(!j||!j.description) return;
  try{
    await navigator.clipboard.writeText(j.description);
    const ok=document.getElementById('desc-copy-ok-'+jobId);
    if(ok){ ok.style.display='block'; setTimeout(()=>{ if(ok) ok.style.display='none'; },2000); }
    toast('📋 Description copied','success',1800);
  }catch(e){ toast('Copy failed — try selecting text manually','error'); }
}

function showTip(cellEl, html, opts={}){
  hideTip();
  _tipTimeout=setTimeout(()=>{
    if(!_tipEl){
      _tipEl=document.createElement('div');
      _tipEl.className='df-tip';
      document.body.appendChild(_tipEl);
    }
    _tipEl.innerHTML=html;
    _tipEl.style.display='block';
    _tipEl.style.opacity='0';
    const rect=cellEl.getBoundingClientRect();
    const tipW=320;
    let left=rect.left;
    let top=rect.bottom+6;
    if(left+tipW>window.innerWidth-12) left=window.innerWidth-tipW-12;
    if(top+200>window.innerHeight) top=rect.top-200-6;
    _tipEl.style.left=Math.max(8,left)+'px';
    _tipEl.style.top=Math.max(8,top)+'px';
    _tipEl.style.opacity='1';
    // Keep tooltip alive when mouse moves onto it (so Copy button is clickable)
    _tipEl.addEventListener('mouseenter',()=>{ clearTimeout(_tipTimeout); cancelHideTip(); });
    _tipEl.addEventListener('mouseleave',()=>{ hideTip(); });
  }, opts.delay||400);
}

let _tipHideTimer=null;
function hideTip(){
  clearTimeout(_tipTimeout);
  _tipTimeout=null;
  if(_tipEl) _tipEl.style.display='none';
}
function hideTipDelayed(ms=120){
  clearTimeout(_tipHideTimer);
  _tipHideTimer=setTimeout(hideTip, ms);
}
function cancelHideTip(){
  clearTimeout(_tipHideTimer);
}

// Hide tooltip on scroll, or clicks outside the tooltip
document.addEventListener('scroll', hideTip, true);
document.addEventListener('click', e=>{ if(!e.target.closest('.df-tip')) hideTip(); }, true);

// Attach rich tooltips to job rows after render
// Track which cell the mouse is currently over — prevents async dGet from
// showing a tooltip after the mouse has already left the cell.
const _tipHover = new Set();

function attachJobTooltips(){
  // Scoped to the job list container, not the whole document — this runs
  // after every render (including every debounced search keystroke), and a
  // full-document query does unnecessary work as the page grows.
  const scroll=document.getElementById('jobs-list-scroll');
  if(!scroll) return;
  scroll.querySelectorAll('.jsr3[data-id]').forEach(row=>{
    const jid=row.dataset.id;

    // Address cell — only attach once
    const addrCell=row.querySelector('.jsr3-cell-addr');
    if(addrCell&&!addrCell._tipBound){
      addrCell._tipBound=true;
      const hk=jid+'_addr';
      addrCell.addEventListener('mouseenter',async ()=>{
        _tipHover.add(hk);
        const j=await dGet('jobs',jid);
        if(!_tipHover.has(hk)) return; // left cell before data arrived
        if(!j) return;
        const certs=(j.certTypes||[]).map(id=>{ const ct=(S.certTypes||[]).find(c=>(c.id||c.name)===id)||{name:id}; return ct.name; });
        const ll=[j.landlordName,j.landlordPhone].filter(Boolean).map(escHtml).join(' · ');
        const ag=[j.agentName,j.agencyName].filter(Boolean).map(escHtml).join(' · ');
        showTip(addrCell,`<div class="df-tip-title">📍 ${escHtml(j.address||'—')}</div>
          ${certs.length?`<div class="df-tip-row"><span class="df-tip-lbl">Certs</span>${escHtml(certs.join(', '))}</div>`:''}
          ${ll?`<div class="df-tip-row"><span class="df-tip-lbl">Landlord</span>${ll}</div>`:''}
          ${ag?`<div class="df-tip-row"><span class="df-tip-lbl">Agent</span>${ag}</div>`:''}
          ${j.access?`<div class="df-tip-row"><span class="df-tip-lbl">Access</span>${escHtml(j.access)}${j.contact?' — '+escHtml(j.contact):''}</div>`:''}
          ${j.notes?`<div class="df-tip-row"><span class="df-tip-lbl">Notes</span>${escHtml(j.notes)}</div>`:''}
        `);
      });
      addrCell.addEventListener('mouseleave',()=>{ _tipHover.delete(jid+'_addr'); hideTip(); });
    }

    // Description cell — only attach once per row
    const descCell=row.querySelector('.jsr3-cell-desc');
    if(descCell&&!descCell._tipBound){
      descCell._tipBound=true;
      const hk=jid+'_desc';
      descCell.style.cursor='default';
      descCell.addEventListener('mouseenter',async ()=>{
        _tipHover.add(hk);
        const j=await dGet('jobs',jid);
        if(!_tipHover.has(hk)) return;
        if(!j||!j.description) return;
        const desc=(j.description||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        showTip(descCell,`
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
            <div style="font-size:12px;color:var(--txt);line-height:1.65;white-space:pre-wrap;max-height:160px;overflow-y:auto;flex:1">${desc}</div>
            <button onclick="event.stopPropagation();_copyJobDesc('${jid}')" style="flex-shrink:0;background:var(--s3);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:14px;cursor:pointer;line-height:1;margin-top:1px" title="Copy description">📋</button>
          </div>
          <div id="desc-copy-ok-${jid}" style="font-size:10px;color:var(--green);font-weight:600;margin-top:5px;display:none">✓ Copied!</div>
        `,{delay:150});
      });
      descCell.addEventListener('mouseleave',()=>{ _tipHover.delete(hk); hideTipDelayed(150); });
    }

    // Engineer cell — only attach once
    const engCell=row.querySelector('.jsr3-cell-eng');
    if(engCell&&!engCell._tipBound){
      engCell._tipBound=true;
      const hk=jid+'_eng';
      engCell.addEventListener('mouseenter',async ()=>{
        _tipHover.add(hk);
        const j=await dGet('jobs',jid);
        if(!_tipHover.has(hk)) return;
        if(!j||!j.engineer) return;
        const eng=(S.engineers||[]).find(en=>en.name===j.engineer);
        showTip(engCell,`<div class="df-tip-title">👷 ${escHtml(j.engineer)}</div>
          ${eng?.phone?`<div class="df-tip-row"><span class="df-tip-lbl">Phone</span>${escHtml(eng.phone)}</div>`:''}
          ${eng?.trade?`<div class="df-tip-row"><span class="df-tip-lbl">Trade</span>${escHtml(eng.trade)}</div>`:''}
          ${eng?.rate?`<div class="df-tip-row"><span class="df-tip-lbl">Rate</span>£${eng.rate}/hr</div>`:''}
        `,{delay:300});
      });
      engCell.addEventListener('mouseleave',()=>{ _tipHover.delete(jid+'_eng'); hideTip(); });
    }
  });
}
document.addEventListener('click',()=>closeCtx());
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeCtx()});

async function duplicateJob(id){
  const j=await dGet('jobs',id);
  if(!j) return;
  const copy={...j,id:uid(),date:TODAY(),status:STATUS.PENDING,created:Date.now(),modified:Date.now(),description:'[Copy] '+j.description};
  await dPut('jobs',copy);
  await logActivity(`Job duplicated: ${j.address}`,'job');
  toast('Job duplicated to today','success');
  jDate=TODAY();renderJobs();updateBadges();
}

async function deleteJobById(id){
  if(!getUserPerm('canDelete')){ toast('❌ You do not have permission to delete jobs','error'); return; }
  confirm2('Delete Job','Permanently delete this job?',async()=>{
    const j=await dGet('jobs',id).catch(()=>null);
    await dDel('jobs',id);
    await logActivity('Job deleted','job');
    // Audit trail — the single delete path (context menu, modal, and any
    // future bulk-delete UI all route through here) so this is never skipped.
    if(j) await logAudit('job_delete',{
      jobId:id, jobNum:j.jobNum||j.jobnum||'',
      address:j.address||'', note:`Status was: ${j.status||'unknown'}`
    });
    _invalidateJobCache();
    closeModal('mo-job'); // no-op if it wasn't open for this job
    _renderJobsKeepScroll();updateBadges();toast('Job deleted','warn');
  });
}

async function openJobForInvoice(id){
  const j=await dGet('jobs',id);
  if(!j) return;
  // Prefill invoice from job
  editInvId=null;
  document.getElementById('mo-inv-title').textContent='◎ Invoice from Job';
  document.getElementById('if-date').value=TODAY();
  document.getElementById('if-desc').value=j.description||j.address;
  document.getElementById('if-notes').value=S.invNotes||'';
  document.getElementById('if-terms').value=S.payTerms||'';
  invItems=[{desc:j.description||'Labour',qty:1,unit:j.price||0,vat:true}];
  const ps=await dAll('persons');
  const cl=ps.find(p=>p.name===j.referrer);
  await fillInvClientDrop(cl?.id);
  renderInvItems();
  nav('inv');
  setTimeout(()=>openModal('mo-inv'),200);
}

// ════════════════════════════════════════════════════════════════
//  JOB AUDIT TRAIL
// ════════════════════════════════════════════════════════════════
async function showJobAudit(jobId){
  const job=await dGet('jobs',jobId);
  if(!job) return;
  const allActs=await dAll('activity');
  const jobActs=allActs
    .filter(a=>a.jobId===job.id||a.jobNum===job.jobNum||
      (a.msg&&(a.msg.includes(job.jobNum||'~~')||a.msg.includes(job.address||'~~'))))
    .sort((a,b)=>b.ts-a.ts).slice(0,50);

  const typeIcon={sync:'🔗',warn:'⚠️',invoice:'◎',job:'🔧',payment:'💳',info:'ℹ️'};
  document.getElementById('audit-job-info').innerHTML=`
    <strong>${job.jobNum||''}</strong> · ${job.address||''} · <span style="color:var(--txt2)">${job.description||'—'}</span>
    <span class="badge b-${job.status===STATUS.COMPLETED?'completed':job.status===STATUS.PENDING?'pending':'invoiced'}" style="margin-left:8px">${job.status}</span>
  `;

  document.getElementById('audit-list').innerHTML=jobActs.length?jobActs.map(a=>`
    <div class="audit-item">
      <div class="audit-dot" style="background:${a.type==='warn'?'var(--red)':a.type==='sync'?'var(--acc)':a.type==='payment'?'var(--green)':'var(--acc)'}"></div>
      <div class="audit-msg">
        <div>${typeIcon[a.type]||'•'} ${a.msg}</div>
        ${(a.oldVal||a.newVal)?`<div style="font-size:10px;color:var(--txt3);margin-top:2px">
          ${a.oldVal?`<span style="color:var(--red)">"${String(a.oldVal).slice(0,50)}"</span>`:''}
          ${a.newVal?`<span style="color:var(--green)"> → "${String(a.newVal).slice(0,50)}"</span>`:''}
        </div>`:''}
        ${a.invNum?`<div style="font-size:10px;color:var(--acc);margin-top:1px">Invoice: ${a.invNum}</div>`:''}
      </div>
      <div class="audit-ts">${new Date(a.ts).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
    </div>
  `).join(''):`<div style="color:var(--txt3);font-size:12px;padding:20px 0;text-align:center">No audit history for this job yet</div>`;

  openModal('mo-audit');
}

// ════════════════════════════════════════════════════════════════
//  PROPERTY CERTS POPUP
// ════════════════════════════════════════════════════════════════
async function showPropertyCerts(address){
  if(!address) return;
  const allCerts=await dAll('certs');
  const propCerts=allCerts.filter(c=>c.address&&c.address.toLowerCase().includes(address.toLowerCase().slice(0,15)));
  
  document.getElementById('propcerts-addr').innerHTML=`📍 ${address}`;
  
  if(!propCerts.length){
    document.getElementById('propcerts-list').innerHTML=`<div style="color:var(--txt3);font-size:12px;padding:20px 0;text-align:center">No certificates found for this property</div>`;
  } else {
    document.getElementById('propcerts-list').innerHTML=propCerts.map(c=>{
      const d=daysDiff(c.expiryDate);
      const col=d<0?'var(--red)':d<=30?'var(--yellow)':'var(--green)';
      const txt=d<0?`⚠ Expired ${Math.abs(d)}d ago`:d===0?'Expires Today!':d+'d left';
      return`<div class="propcert-item">
        <div style="font-size:20px">${{Gas:'⛽',Electrical:'⚡',EPC:'🏠'}[c.type?.split(' ')[0]]||'📄'}</div>
        <div style="flex:1">
          <div class="propcert-type">${c.type}</div>
          <div style="font-size:10px;color:var(--txt2)">Expires: ${c.expiryDate} ${c.certNum?'· #'+c.certNum:''}</div>
        </div>
        <div class="propcert-days" style="color:${col}">${txt}</div>
        ${d<=60?`<button class="btn btn-acc btn-xs" onclick="createRenewalJob('${c.id}');closeModal('mo-propcerts')">Renew</button>`:''}
      </div>`;
    }).join('');
  }
  openModal('mo-propcerts');
}

// ════════════════════════════════════════════════════════════════
//  WA TEMPLATES — Tenant Booking & Landlord Complete
// ════════════════════════════════════════════════════════════════
async function sendTenantWA(jobId){
  const j=await dGet('jobs',jobId);
  if(!j) return;
  const msg=(S.waTenantTpl||'')
    .replace('{tenant_name}','Tenant')
    .replace('{address}',j.address||'')
    .replace('{date}',j.date||'')
    .replace('{time_slot}',j.timeSlot||'TBC')
    .replace('{engineer}',j.engineer||'')
    .replace('{company_name}',S.coName||'')
    .replace('{company_phone}',S.coPhone||'');
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value='';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

async function sendLandlordComplete(jobId){
  const j=await dGet('jobs',jobId);
  if(!j) return;
  const ps=await dAll('persons');
  const ll=ps.find(p=>p.name===j.referrer);
  const msg=(S.waLandlordTpl||'')
    .replace('{landlord_name}',j.referrer||'')
    .replace('{address}',j.address||'')
    .replace('{description}',j.description||'')
    .replace('{engineer}',j.engineer||'')
    .replace('{company_name}',S.coName||'')
    .replace('{company_phone}',S.coPhone||'');
  const waNum=ll?.wa||'';
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=waNum;
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

// ════════════════════════════════════════════════════════════════
//  OVERDUE INVOICE WA
// ════════════════════════════════════════════════════════════════
async function sendOverdueWA(invId){
  const inv=await dGet('invoices',invId);
  if(!inv) return;
  const t=calcInvTotal(inv);
  const due=inv.dueDate?new Date(inv.dueDate):null;
  const daysOver=due?Math.ceil((new Date()-due)/(1000*60*60*24)):0;
  const msg=(S.waOverdueTpl||'')
    .replace('{client_name}',inv.clientName||'')
    .replace('{invoice_num}',inv.number||'')
    .replace('{amount}',t.grand.toFixed(2))
    .replace('{due_date}',inv.dueDate||'N/A')
    .replace('{days_overdue}',daysOver>0?daysOver+' days':'—')
    .replace('{company_name}',S.coName||'');
  const waNum=inv.clientWA||'';
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value=waNum;
  window._waPendingMsg=msg;
  openModal('mo-wa');
}

// ════════════════════════════════════════════════════════════════
//  SAVED VIEWS
// ════════════════════════════════════════════════════════════════
function applySavedView(viewId){
  // Built-in views
  if(viewId==='today-pending'){
    document.getElementById('j-search').value='';
    document.getElementById('j-eng-filter').value='';
    document.getElementById('j-status-filter').value='Pending';
    _priFilter='';
    jDate=TODAY();renderJobs();nav('jobs');
  } else if(viewId==='today-gas'){
    document.getElementById('j-search').value='gas';
    document.getElementById('j-eng-filter').value='';
    document.getElementById('j-status-filter').value='';
    _priFilter='';
    jDate=TODAY();renderJobs();nav('jobs');
  } else if(viewId==='urgent'){
    document.getElementById('j-search').value='';
    document.getElementById('j-eng-filter').value='';
    document.getElementById('j-status-filter').value='';
    _priFilter='Urgent';
    renderJobs();nav('jobs');
  } else {
    // Custom saved view
    const sv=(S.savedViews||[]).find(v=>v.id===viewId);
    if(sv){
      if(sv.date) jDate=sv.date==='today'?TODAY():sv.date;
      document.getElementById('j-search').value=sv.search||'';
      document.getElementById('j-eng-filter').value=sv.engineer||'';
      document.getElementById('j-status-filter').value=sv.status||'';
      _priFilter=sv.priority||'';
      renderJobs();nav('jobs');
    }
  }
  // Highlight active view
  document.querySelectorAll('.sv-btn').forEach(b=>{
    b.classList.toggle('active',b.getAttribute('onclick')?.includes(viewId));
  });
  // Keep the priority dot toolbar's visual "on" state in sync — the filter
  // used to be a <select id="j-priority-filter"> (now replaced by the dot
  // toolbar + _priFilter, see renderJobs()), so applying a saved view must
  // update the dots too, not just the underlying filter variable.
  document.querySelectorAll('.pri-dot').forEach(d=>d.classList.toggle('on',d.dataset.pri===_priFilter));
}

async function saveCurrentView(){
  const name=prompt('View name (e.g. "This Week – Mike – Gas"):');
  if(!name) return;
  const view={
    id:uid(),
    name,
    date:document.getElementById('j-datepick').value||'today',
    search:document.getElementById('j-search').value||'',
    engineer:document.getElementById('j-eng-filter').value||'',
    status:document.getElementById('j-status-filter').value||'',
    priority:_priFilter||'',
  };
  const views=S.savedViews||[];
  views.push(view);
  await saveSetting('savedViews',views);
  S.savedViews=views;
  renderSavedViews();
  toast(`View "${name}" saved!`,'success');
}

function renderSavedViews(){
  const container=document.getElementById('custom-views-btns');
  if(!container)return;
  const views=S.savedViews||[];
  container.innerHTML=views.map(v=>`
    <button class="sv-btn" onclick="applySavedView('${v.id}')">${v.name}</button>
    <button class="sv-btn del" title="Delete view" onclick="deleteSavedView('${v.id}');event.stopPropagation()">✕</button>
  `).join('');
}

async function deleteSavedView(id){
  const views=(S.savedViews||[]).filter(v=>v.id!==id);
  await saveSetting('savedViews',views);
  S.savedViews=views;
  renderSavedViews();
}

// ════════════════════════════════════════════════════════════════
//  TODAY'S NOTES
// ════════════════════════════════════════════════════════════════
let _notesTimer=null;
function saveDashNotes(){
  clearTimeout(_notesTimer);
  _notesTimer=setTimeout(async()=>{
    const txt=document.getElementById('dash-notes')?.value||'';
    S.dashNotes=txt;
    await saveSetting('dashNotes',txt);
  },800);
}
function loadDashNotes(){
  const el=document.getElementById('dash-notes');
  if(el) el.value=S.dashNotes||'';
}

// ════════════════════════════════════════════════════════════════
//  SLA / URGENT JOBS ON DASHBOARD
// ════════════════════════════════════════════════════════════════
async function renderSLAJobs(){
  const allJobs=await dAll('jobs');
  const urgent=allJobs.filter(j=>(j.priority==='Urgent'||j.priority==='Emergency')&&j.status!==STATUS.COMPLETED&&j.status!==STATUS.CANCELLED&&j.status!==STATUS.INVOICED);
  urgent.sort((a,b)=>{
    const p={Emergency:0,Urgent:1};
    return (p[a.priority]||2)-(p[b.priority]||2)||a.date.localeCompare(b.date);
  });
  const el=document.getElementById('dp-sla');
  const cnt=document.getElementById('dp-sla-count');
  if(!el) return;
  cnt.textContent=urgent.length?`${urgent.length} open`:'';
  if(!urgent.length){el.innerHTML='<div class="empty" style="padding:16px 0"><div class="ei" style="font-size:24px">✓</div><p style="font-size:12px">No urgent jobs</p></div>';return}
  el.innerHTML=urgent.map(j=>`<div class="di">
    <span class="sla-chip ${j.priority==='Emergency'?'sla-emergency':'sla-urgent'}">${j.priority==='Emergency'?'🚨':'🔥'} ${j.priority}</span>
    <div class="di-main" style="margin-left:6px"><div class="di-addr">${escHtml(j.address)}</div><div class="di-meta">${escHtml(j.engineer)||'Unassigned'} · ${j.date} ${j.timeSlot?'· '+escHtml(j.timeSlot):''}</div></div>
    <button class="btn btn-ghost btn-xs" onclick="jDate='${j.date}';nav('jobs');setTimeout(()=>openJobModal('${j.id}'),200)">Open</button>
  </div>`).join('');
}

// ════════════════════════════════════════════════════════════════
//  OVERTIME / ABSENCE LOG
// ════════════════════════════════════════════════════════════════
function toggleOTHours(){
  const t=document.getElementById('ot-type').value;
  document.getElementById('ot-custom-grp').style.display=t==='overtime-custom'?'':'none';
}

async function openOvertimeModal(engName){
  // Fill engineer dropdown
  const sel=document.getElementById('ot-eng');
  sel.innerHTML=(S.engineers||[]).map(e=>`<option ${e.name===engName?'selected':''}>${e.name}</option>`).join('');
  document.getElementById('ot-date').value=TODAY();
  document.getElementById('ot-type').value='overtime-1';
  document.getElementById('ot-notes').value='';
  document.getElementById('ot-custom-grp').style.display='none';
  openModal('mo-overtime');
}

async function saveOvertimeLog(){
  const eng=document.getElementById('ot-eng').value;
  const date=document.getElementById('ot-date').value;
  const type=document.getElementById('ot-type').value;
  const notes=document.getElementById('ot-notes').value;
  
  let hours=0,label='';
  if(type==='overtime-1'){hours=1;label='Overtime — 1h'}
  else if(type==='overtime-2'){hours=2;label='Overtime — 2h'}
  else if(type==='overtime-custom'){hours=parseFloat(document.getElementById('ot-custom-hrs').value)||1;label=`Overtime — ${hours}h`}
  else if(type==='halfday'){hours=-0.5;label='Half Day Absence'}
  else if(type==='absent'){hours=-1;label='Full Day Absence'}
  
  const log={id:uid(),engineer:eng,date,type,hours,label,notes,created:Date.now()};
  await dPut('overtime',log);
  await logActivity(`${label} logged for ${eng} on ${date}`,'timesheet');
  toast(`${label} recorded for ${eng}`,'success');
  closeModal('mo-overtime');
  if(curPg==='ts') renderTSDetail();
}

// ════════════════════════════════════════════════════════════════
//  PARTIAL PAYMENTS
// ════════════════════════════════════════════════════════════════
let _payInvId=null;

async function openPaymentModal(invId){
  _payInvId=invId;
  const inv=await dGet('invoices',invId);
  if(!inv) return;
  const t=calcInvTotal(inv);
  const payments=await dAll('payments');
  const invPayments=payments.filter(p=>p.invId===invId);
  const paid=invPayments.reduce((s,p)=>s+p.amount,0);
  const outstanding=t.grand-paid;
  
  document.getElementById('payment-inv-info').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div><strong>${inv.number}</strong> · ${inv.clientName}</div>
      <div style="font-family:var(--fh);font-weight:700;font-size:18px">£${t.grand.toFixed(2)}</div>
    </div>
    <div style="margin-top:6px;font-size:11px;color:var(--txt2)">Paid: £${paid.toFixed(2)} · Outstanding: <strong style="color:${outstanding>0?'var(--yellow)':'var(--green)'}">${outstanding<=0?'FULLY PAID':'£'+outstanding.toFixed(2)}</strong></div>
  `;
  
  document.getElementById('pay-amount').value=outstanding>0?outstanding.toFixed(2):'';
  document.getElementById('pay-date').value=TODAY();
  document.getElementById('pay-method').value='Bank Transfer';
  document.getElementById('pay-ref').value='';
  
  // Progress bar
  const pct=t.grand>0?Math.min(100,paid/t.grand*100):0;
  document.getElementById('pay-bar').style.width=pct+'%';
  document.getElementById('pay-progress-txt').textContent=`${pct.toFixed(0)}% paid (£${paid.toFixed(2)} of £${t.grand.toFixed(2)})`;
  
  // Existing payments
  if(invPayments.length){
    document.getElementById('existing-payments').innerHTML=`
      <div style="font-size:10px;color:var(--txt3);letter-spacing:1px;text-transform:uppercase;font-family:var(--fh);font-weight:600;margin-bottom:6px">Payment History</div>
      <table class="plog-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
        <tbody>${invPayments.map(p=>`<tr><td>${p.date}</td><td style="color:var(--green);font-weight:700">£${p.amount.toFixed(2)}</td><td>${p.method}</td><td style="color:var(--txt3)">${p.ref||'—'}</td></tr>`).join('')}</tbody>
      </table>
    `;
  } else {
    document.getElementById('existing-payments').innerHTML='';
  }
  openModal('mo-payment');
}

async function savePayment(){
  const invId=_payInvId;
  const amount=parseFloat(document.getElementById('pay-amount').value)||0;
  if(amount<=0){toast('Enter a valid amount','error');return}
  const payment={
    id:uid(),invId,
    date:document.getElementById('pay-date').value,
    amount,
    method:document.getElementById('pay-method').value,
    ref:document.getElementById('pay-ref').value,
    created:Date.now()
  };
  await dPut('payments',payment);
  
  // Check if fully paid
  const inv=await dGet('invoices',invId);
  const t=calcInvTotal(inv);
  const allPmts=await dAll('payments');
  const invPmts=allPmts.filter(p=>p.invId===invId);
  const totalPaid=invPmts.reduce((s,p)=>s+p.amount,0);
  
  if(totalPaid>=t.grand-0.01){
    inv.status='Paid';
    await dPut('invoices',inv);
    toast('Invoice fully paid! Status updated.','success');
  } else {
    toast(`Payment of £${amount.toFixed(2)} recorded. Outstanding: £${(t.grand-totalPaid).toFixed(2)}`,'success');
  }
  await logActivity(`Payment £${amount.toFixed(2)} recorded for ${inv.number}`,'invoice');
  closeModal('mo-payment');
  renderInvList();
  if(curInvId===invId) viewInv(invId);
  updateBadges();
}

// ════════════════════════════════════════════════════════════════
//  AGEING REPORT
// ════════════════════════════════════════════════════════════════
let _ageSelected=null;

async function renderAgeingReport(){
  const invs=await dAll('invoices');
  const outstanding=invs.filter(i=>i.status==='Awaiting Payment');
  const now=new Date();
  
  const buckets={
    '0–30':{label:'0–30 days',invs:[],color:'var(--green)'},
    '31–60':{label:'31–60 days',invs:[],color:'var(--yellow)'},
    '61–90':{label:'61–90 days',invs:[],color:'var(--orange)'},
    '90+':{label:'Over 90 days',invs:[],color:'var(--red)'},
  };
  
  outstanding.forEach(inv=>{
    const due=inv.dueDate?new Date(inv.dueDate):new Date(inv.date);
    const days=Math.ceil((now-due)/(1000*60*60*24));
    if(days<=30) buckets['0–30'].invs.push({...inv,daysOver:days});
    else if(days<=60) buckets['31–60'].invs.push({...inv,daysOver:days});
    else if(days<=90) buckets['61–90'].invs.push({...inv,daysOver:days});
    else buckets['90+'].invs.push({...inv,daysOver:days});
  });
  
  const grid=document.getElementById('age-grid');
  if(!grid) return;
  
  grid.innerHTML=Object.entries(buckets).map(([key,b])=>{
    const total=b.invs.reduce((s,i)=>s+calcInvTotal(i).grand,0);
    return`<div class="age-bucket" onclick="showAgeBucket('${key}')">
      <div class="age-bucket-label">${b.label}</div>
      <div class="age-bucket-val" style="color:${b.color}">£${total.toFixed(0)}</div>
      <div class="age-bucket-count">${b.invs.length} invoice${b.invs.length!==1?'s':''}</div>
    </div>`;
  }).join('');
  
  // Store for bucket detail
  window._ageBuckets=buckets;
}

function showAgeBucket(key){
  const b=window._ageBuckets?.[key];
  const detail=document.getElementById('age-detail');
  if(!b||!detail) return;
  if(_ageSelected===key){
    _ageSelected=null;
    detail.innerHTML='';
    return;
  }
  _ageSelected=key;
  if(!b.invs.length){detail.innerHTML='';return}
  detail.innerHTML=`
    <div class="age-detail">
      <div style="font-family:var(--fh);font-weight:700;margin-bottom:12px">${b.label} — ${b.invs.length} invoices</div>
      <table class="plog-table">
        <thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Due Date</th><th>Days Over</th><th>Action</th></tr></thead>
        <tbody>${b.invs.sort((a,c)=>c.daysOver-a.daysOver).map(inv=>{
          const t=calcInvTotal(inv);
          return`<tr>
            <td style="font-family:var(--fh);font-weight:700;color:var(--acc)">${inv.number}</td>
            <td>${inv.clientName||'—'}</td>
            <td style="font-family:var(--fh);font-weight:700">£${t.grand.toFixed(2)}</td>
            <td>${inv.dueDate||'—'}</td>
            <td style="color:var(--red);font-weight:700">${inv.daysOver}d</td>
            <td><button class="btn btn-wa btn-xs" onclick="sendOverdueWA('${inv.id}')">📱 Remind</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  TIMESHEET CSV EXPORT
// ════════════════════════════════════════════════════════════════
async function exportTSCSV(){
  const dates=getWeekDates(getTsOff());
  const allJobs=await dAll('jobs');
  const allOT=await dAll('overtime');
  const wkLabel=`${dates[0]}_${dates[6]}`;
  
  let rows=[['Engineer','Date','Address','Description','Trade','Hours','Status','Pay (£)']];
  
  (S.engineers||[]).forEach(eng=>{
    const ejobs=allJobs.filter(j=>j.engineer===eng.name&&dates.includes(j.date));
    ejobs.forEach(j=>{
      rows.push([eng.name,j.date,j.address,j.description,j.trade,j.hours||0,j.status,((j.hours||0)*(eng.rate||0)).toFixed(2)]);
    });
    // OT entries
    const eot=allOT.filter(o=>o.engineer===eng.name&&dates.includes(o.date));
    eot.forEach(o=>{
      rows.push([eng.name,o.date,'—',o.label,'—',o.hours>0?o.hours:0,o.type,(o.hours>0?(o.hours*(eng.otRate||eng.rate||0)):0).toFixed(2)]);
    });
  });
  
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`DeepFlow-Timesheet-${wkLabel}.csv`;a.click();
  toast('Timesheet CSV exported','success');
}

// ════════════════════════════════════════════════════════════════
//  FUTURE JOBS TABLE
// ════════════════════════════════════════════════════════════════
let futureJobsVisible = true;

function toggleFutureJobs(){ }
async function renderFutureJobs(){ }
// ════════════════════════════════════════════════════════════════
//  INVOICE KANBAN BOARD
// ════════════════════════════════════════════════════════════════
let invViewMode = 'list';
let _kanbanDragId = null;

function setInvView(mode){
  invViewMode = mode;
  const listView = document.getElementById('inv-list-view');
  const kanbanView = document.getElementById('inv-kanban-view');
  const btnList = document.getElementById('btn-inv-list');
  const btnKanban = document.getElementById('btn-inv-kanban');
  if(mode === 'kanban'){
    listView.style.display = 'none';
    kanbanView.style.display = 'flex';
    btnKanban.style.background = 'var(--acc)';btnKanban.style.color='#000';
    btnList.style.background = '';btnList.style.color='';
    renderKanban();
  } else {
    listView.style.display = '';
    kanbanView.style.display = 'none';
    btnList.style.background = 'var(--acc)';btnList.style.color='#000';
    btnKanban.style.background = '';btnKanban.style.color='';
    renderInvList();
  }
}

async function renderKanban(){
  const board = document.getElementById('kanban-board');
  if(!board) return;

  const cols = [
    {key:'Draft', label:'📝 Draft', color:'var(--purple)'},
    {key:'Awaiting Payment', label:'📤 Sent / Awaiting', color:'var(--yellow)'},
    {key:'Paid', label:'✅ Paid', color:'var(--green)'},
    {key:'Cancelled', label:'⊘ Cancelled', color:'var(--txt3)'},
    {key:'Credit Note', label:'↩ Credit Notes', color:'var(--purple)'},
  ];

  const invs = await dAll('invoices');
  const byStatus = {};
  cols.forEach(c => byStatus[c.key] = []);
  invs.forEach(inv => {
    const key = inv.status || 'Draft';
    if(byStatus[key]) byStatus[key].push(inv);
    else byStatus['Draft'].push(inv);
  });

  board.innerHTML = cols.map(col => {
    const cards = byStatus[col.key] || [];
    const total = cards.reduce((s,i) => s + calcInvTotal(i).grand, 0);
    return `<div class="kanban-col" data-status="${col.key}" ondragover="kanbanDragOver(event,this)" ondrop="kanbanDrop(event,'${col.key}')" ondragleave="this.classList.remove('drag-over')">
      <div class="kanban-col-hd">
        <div class="kanban-col-title" style="color:${col.color}">${col.label}</div>
        <div class="kanban-col-count">${cards.length}</div>
        ${total>0?`<div style="font-size:11px;font-family:var(--fh);font-weight:700;color:${col.color}">£${total.toFixed(0)}</div>`:''}
      </div>
      <div class="kanban-col-body">
        ${cards.sort((a,b)=>b.created-a.created).map(inv => {
          const t = calcInvTotal(inv);
          return `<div class="kanban-card" draggable="true" data-id="${inv.id}"
            ondragstart="kanbanDragStart(event,'${inv.id}')"
            ondragend="this.classList.remove('dragging')"
            onclick="viewInv('${inv.id}');setInvView('list')">
            <div class="kanban-card-num">${inv.number}${(inv.isCreditNote||inv.status==='Credit Note')?` <span style="font-size:9px;color:var(--purple)">[CN]</span>`:''}</div>
            <div class="kanban-card-client">${inv.clientName||'—'}</div>
            <div class="kanban-card-meta">${inv.date}${inv.dueDate?' · Due: '+inv.dueDate:''}</div>
            <div class="kanban-card-amt" style="color:${col.color}">£${t.grand.toFixed(2)}</div>
          </div>`;
        }).join('')}
        ${cards.length===0?`<div style="padding:20px;text-align:center;color:var(--txt3);font-size:12px">Drop here</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function kanbanDragStart(e, id){
  _kanbanDragId = id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function kanbanDragOver(e, col){
  e.preventDefault();
  col.classList.add('drag-over');
}
async function kanbanDrop(e, newStatus){
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drag-over'));
  if(!_kanbanDragId) return;
  const inv = await dGet('invoices', _kanbanDragId);
  if(!inv) return;
  inv.status = newStatus;
  // Try full save first; if a column doesn't exist, strip it and retry
  try{
    await dPut('invoices', inv);
  }catch(colErr){
    if(colErr.message?.includes('PGRST204')||colErr.message?.includes('not find')){
      // Extract which column is missing and strip it
      const missingCol = (colErr.message.match(/not find the '(\w+)' column/)||[])[1];
      if(missingCol){
        const stripped = {...inv};
        // Try to find the camelCase key for this DB column
        const dbMap = Object.entries(_TO_DB.invoices||{});
        const camelKey = dbMap.find(([k,v])=>v===missingCol)?.[0] || missingCol;
        delete stripped[camelKey];
        delete stripped[missingCol];
        toast(`ℹ️ Column '${missingCol}' not in DB yet — saving without it. Run the SQL in Guide & SQL to add it.`,'warn',5000);
        await dPut('invoices', stripped);
      } else {
        throw colErr;
      }
    } else {
      throw colErr;
    }
  }
  await logActivity(`Invoice ${inv.number} moved to ${newStatus}`, 'invoice');
  toast(`${inv.number} → ${newStatus}`, 'success');
  renderKanban();
  updateBadges();
  _kanbanDragId = null;
}

// ════════════════════════════════════════════════════════════════
//  QUICK ADD ENGINEER (from job modal)
// ════════════════════════════════════════════════════════════════
function openQuickEngModal(){
  document.getElementById('qef-name').value='';
  document.getElementById('qef-phone').value='';
  document.getElementById('qef-wa').value='';
  document.getElementById('qef-rate').value='';
  const td = document.getElementById('qef-trade');
  td.innerHTML='<option value="">—</option>'+(S.trades||[]).map(t=>`<option>${t.name}</option>`).join('');
  openModal('mo-quick-eng');
}

async function saveQuickEngineer(){
  const name = document.getElementById('qef-name').value.trim();
  if(!name){toast('Name required','error');return}
  const engObj = {
    name, phone: document.getElementById('qef-phone').value.trim(),
    rate: parseFloat(document.getElementById('qef-rate').value)||0,
    wa: document.getElementById('qef-wa').value.replace(/[^0-9]/g,''),
    trade: document.getElementById('qef-trade').value
  };
  // Add to settings engineers
  const engs = S.engineers||[];
  if(!engs.find(e=>e.name===name)){engs.push(engObj);await saveSetting('engineers',engs)}
  // Also save as person in directory
  const p = {id:uid(), name, phone:engObj.phone, email:'', wa:engObj.wa, address:'', notes:'', rate:engObj.rate, trade:engObj.trade, roles:['engineer']};
  await dPut('persons', p);
  await logActivity(`Engineer added: ${name}`, 'person');
  toast(`Engineer ${name} added!`, 'success');
  closeModal('mo-quick-eng');
  // Refresh dropdown in job modal
  fillJobDropdowns();
  document.getElementById('jf-eng').value = name;
}

// ════════════════════════════════════════════════════════════════
//  INVOICE ↔ JOB UNIFIED NUMBERING
//  Invoice number IS the job number. Creating an invoice also
//  auto-creates a job entry (past, present, or future).
// ════════════════════════════════════════════════════════════════
// Override saveInv to also sync a job record
const _origSaveInv = saveInv;
// We'll patch saveInv below after it's defined

let _invSaving = false; // global lock — prevents double-save on repeated clicks

async function saveInvWithJobSync(){
  // ── LOCK: if already saving, ignore extra clicks completely ──
  if(_invSaving){ toast('Already saving, please wait…','info',1500); return; }
  _invSaving = true;

  const _saveBtn = document.querySelector('[onclick="saveInv()"]');
  const _sendBtn = document.querySelector('[onclick="saveAndSendInv()"]');
  const _disableBtn = btn => { if(btn){btn.disabled=true;btn.style.opacity='0.6';} };
  const _enableBtn  = btn => { if(btn){btn.disabled=false;btn.style.opacity='';} };
  if(_saveBtn){_saveBtn.disabled=true;_saveBtn.textContent='Saving…';_saveBtn.style.opacity='0.7';}
  _disableBtn(_sendBtn);

  try{
  // Validate required fields
  const dateVal = document.getElementById('if-date')?.value;
  if(!dateVal){ toast('Please set an invoice date','error'); return; }
  const descVal = document.getElementById('if-desc')?.value?.trim();
  if(!descVal){ toast('Please add a description for this invoice','error'); return; }
  if(invItems.length===0){ toast('Add at least one line item','error'); return; }
  const hasAmount = invItems.some(i=>(i.qty||1)*(i.unit||0)>0);
  if(!hasAmount){ toast('At least one line item must have an amount greater than £0','error'); return; }

  const ps = await dAll('persons');
  const cid = document.getElementById('if-client').value;
  const cl = ps.find(p=>p.id===cid)||{};
  const invId = editInvId || uid();
  const existingInv = editInvId ? await dGet('invoices',editInvId) : null;
  // ══════════════════════════════════════════════════════════════
  // PROPER INVOICE OBJECT - Complete data structure saved to DB
  // ══════════════════════════════════════════════════════════════
  const invoiceData = window._newInvoiceData || {};
  // This was always calling nextInvNum() with no argument, so every new
  // invoice created from this modal — even ones explicitly set to the
  // Agency type — silently got a landlord-series (INV-) number instead of
  // the agency series (AGN-).
  const invNum = editInvId ? existingInv.number : await nextInvNum(invoiceData.invoiceType==='agency');
  
  const inv = {
    id: invId,
    number: invNum,
    clientId: cid,
    clientName: cl.name,
    clientEmail: cl.email,
    clientWA: cl.wa||'',
    date: document.getElementById('if-date').value,
    dueDate: document.getElementById('if-due').value,
    description: document.getElementById('if-desc').value,
    notes: document.getElementById('if-notes').value,
    terms: document.getElementById('if-terms').value,
    items: JSON.parse(JSON.stringify(invItems)),
    status: document.getElementById('if-status')?.value || (editInvId ? existingInv.status : 'Draft'),
    linkedJobId: window._pendingJobLink || (editInvId ? existingInv.linkedJobId : null),
    created: editInvId ? existingInv.created : Date.now(),
    
    // ═══ COMPLETE INVOICE TYPE DATA ═══
    invoiceType: invoiceData.invoiceType || 'landlord',
    billToName: invoiceData.billToName || cl.name || '',
    billToAddress: document.getElementById('if-client-addr')?.value || invoiceData.billToAddress || '',
    jobAddress: document.getElementById('if-job-addr')?.value || invoiceData.jobAddress || '',
    agentName: document.getElementById('if-agent')?.value || invoiceData.agentName || '',
    agentEmail: document.getElementById('if-agent-cc')?.value || invoiceData.agentEmail || '',
    agencyName: invoiceData.agencyName || '',
    agencyAddress: invoiceData.agencyAddress || '',
    landlordName: invoiceData.landlordName || '',
    propertyAddress: invoiceData.propertyAddress || '',
    jobNum: document.getElementById('if-jobref')?.value || invoiceData.jobNum || ''
  };
  
  await dPut('invoices', inv);

  // Cross-sync: if amount changed on a job-linked invoice, offer to update the job
  if(inv.linkedJobId||window._pendingJobLink){
    const linkedId=inv.linkedJobId||window._pendingJobLink;
    const invSubtotal=inv.items.reduce((s,i)=>s+(i.qty||1)*(i.unit||0),0);
    await _syncInvoicePriceToJob(linkedId,invSubtotal,inv.description);
  }
  window._invSyncJobId=null; window._invSyncOrigPrice=undefined;
  document.getElementById('_inv-sync-banner')?.remove();

  // Auto-create or update linked job
  const jobDate = inv.date || TODAY();
  const firstItem = inv.items?.[0];
  const jobDesc = inv.description || (firstItem?.desc) || '';
  const jobPrice = inv.items?.reduce((s,i)=>(s+(i.qty||1)*(i.unit||0)),0)||0;

  // Check if a job with this invoice number already exists
  const allJobs = await dAll('jobs');
  let linkedJob = allJobs.find(j => j.invNumber === invNum || j.id === inv.linkedJobId);
  // Auto-create a job for ANY new invoice that doesn't have a linked job
  // This applies to: standalone invoices, proforma invoices, disposable invoices
  if(!linkedJob && !editInvId){
    // Get next job number
    const jobNum = await nextJobNum();
    const newJob = {
      id: uid(),
      jobNum: jobNum,
      date: jobDate,
      address: cl.address || 'TBC',
      referrer: cl.name || '',
      trade: '',
      engineer: '',
      description: jobDesc,
      timeSlot: '',
      access: '',
      contact: '',
      hours: 0,
      price: jobPrice,
      notes: `Auto-created from invoice ${invNum}`,
      priority: 'Normal',
      status: 'Invoiced',
      invNumber: invNum,
      linkedInvId: invId,
      created: Date.now(),
      modified: Date.now()
    };
    await dPut('jobs', newJob);
    // Link the invoice to the new job
    await _sb('invoices?id=eq.'+invId,{method:'PATCH',body:{linkedJobId:newJob.id,jobNum:jobNum,modified:Date.now()}});
    await logActivity(`Job ${jobNum} auto-created from invoice ${invNum}`, 'job');
    toast(`Job ${jobNum} auto-linked to ${invNum}`, 'info');
  } else if(linkedJob){
    // FIX 15: Update the existing linked job — set status to Invoiced and refresh price/desc.
    // Previously only ran on editInvId, so a newly-created invoice for an existing job
    // (via createInvFromJob) never updated the job's status from Completed → Invoiced.
    const updatedJob = {...linkedJob, modified: Date.now()};
    if(jobPrice) updatedJob.price = jobPrice;
    if(jobDesc && !linkedJob.description) updatedJob.description = jobDesc;
    // Only advance to Invoiced — never regress a status (e.g. don't overwrite Cancelled)
    if(linkedJob.status===STATUS.COMPLETED||linkedJob.status===STATUS.PENDING||linkedJob.status===STATUS.IN_PROGRESS){
      updatedJob.status = STATUS.INVOICED;
      updatedJob.invNumber = invNum;
      updatedJob.linkedInvId = invId;
    }
    await dPut('jobs', updatedJob);
    if(updatedJob.status === 'Invoiced' && linkedJob.status !== 'Invoiced'){
      await logActivity(`Job ${linkedJob.jobnum||linkedJob.id} → Invoiced (invoice ${invNum})`, 'job');
    }
  }

  await logActivity(`${editInvId?'Updated':'Created'} invoice ${invNum}`, 'invoice');
  closeModal('mo-inv');
  // Refresh the correct invoice view based on current nav mode
  if(_invNavMode==='missing') renderMissingInvoices();
  else if(_invNavMode==='dashboard') renderInvDashboard();
  else if(_invNavMode==='overdue') renderInvList();
  else renderInvList();
  updateBadges();
  renderJobs();
  renderFutureJobs();
  toast('Invoice saved ✅','success');
  if(!editInvId) viewInv(invId);
  }catch(err){
    let msg = err.message||'Save failed';
    if(msg.includes('42501')||msg.includes('row-level security')){
      msg = 'Permission denied — check Supabase RLS. Run: CREATE POLICY "invoices_auth" ON invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);';
    } else if(msg.includes('Failed to fetch')||msg.includes('NetworkError')){
      msg = 'No internet connection. Check your network and try again.';
    } else if(msg.includes('duplicate')||msg.includes('unique')){
      msg = 'Invoice number already exists. Refresh and try again.';
    } else if(msg.includes('PGRST204')||msg.includes('not find')){
      const col=(msg.match(/not find the '(\w+)' column of '(\w+)'/)||[]);
      msg = col[1] ? `Column '${col[1]}' missing in table '${col[2]||''}'. Run: ALTER TABLE ${col[2]||'invoices'} ADD COLUMN IF NOT EXISTS ${col[1]} text;` : msg.slice(0,140);
    }
    toast('❌ Save failed: '+msg.slice(0,160),'error',8000);
    console.error('saveInvWithJobSync error:',err);
  }finally{
    _invSaving = false;
    if(_saveBtn){_saveBtn.disabled=false;_saveBtn.textContent='Save Invoice';_saveBtn.style.opacity='';}
    const _sb2=document.querySelector('[onclick="saveAndSendInv()"]');
    if(_sb2){_sb2.disabled=false;_sb2.style.opacity='';}
  }
}

// ════════════════════════════════════════════════════════════════
//  THEME SYSTEM — v3 (Light default, localStorage, scheduler)
// ════════════════════════════════════════════════════════════════
let _themeSchedInterval = null;

function applyTheme(t) {
  // t = 'light' | 'dark'
  document.body.classList.toggle('theme-dark', t === 'dark');
  document.body.classList.toggle('theme-light', t === 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
  const lbl = document.getElementById('current-theme-lbl');
  if (lbl) lbl.textContent = t === 'light' ? '☀️ Light' : '🌙 Dark';
  // Update settings theme buttons
  ['dark','light'].forEach(th => {
    const el = document.getElementById('btn-theme-'+th);
    if(el){ el.classList.toggle('btn-acc',th===t); el.classList.toggle('btn-ghost',th!==t); }
  });
  localStorage.setItem('df_theme', t);
}

function toggleTheme() {
  const cur = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  const next = cur === 'light' ? 'dark' : 'light';
  S.theme = next;
  saveSetting('theme', next);
  applyTheme(next);
  document.getElementById('theme-icon').textContent = document.body.classList.contains('theme-dark') ? '☀️' : '🌙';
}

function setTheme(t) {
  S.theme = t;
  saveSetting('theme', t);
  applyTheme(t);
}

function applyThemeMode() {
  const mode = document.getElementById('s-theme-mode')?.value || 'manual';
  S.themeMode = mode;
  const schedGrp = document.getElementById('s-theme-sched-grp');
  if (schedGrp) schedGrp.style.display = mode === 'scheduled' ? '' : 'none';
  saveSettings();
  startThemeScheduler();
}

function startThemeScheduler() {
  clearInterval(_themeSchedInterval);
  if (S.themeMode === 'auto') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(mq.matches ? 'dark' : 'light');
    mq.onchange = e => applyTheme(e.matches ? 'dark' : 'light');
  } else if (S.themeMode === 'scheduled') {
    const check = () => {
      const now = new Date();
      const hm = now.getHours() * 60 + now.getMinutes();
      const start = (S.themeLightStart || '07:00').split(':').reduce((a,b,i)=>a + +b*(i?1:60),0);
      const end = (S.themeLightEnd || '20:00').split(':').reduce((a,b,i)=>a + +b*(i?1:60),0);
      const isLight = hm >= start && hm < end;
      applyTheme(isLight ? 'light' : 'dark');
    };
    check();
    _themeSchedInterval = setInterval(check, 60000);
  }
}

// Init theme from localStorage first (instant, no flash of wrong theme)
// Default is always light — user must explicitly switch to dark
(function() {
  const saved = localStorage.getItem('df_theme') || 'light';
  document.body.classList.toggle('theme-dark', saved === 'dark');
  document.body.classList.toggle('theme-light', saved !== 'dark');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = saved === 'light' ? '🌙' : '☀️';
})();
// ════════════════════════════════════════════════════════════════
// This patches the existing openCmd function's search to include
// deep search through invoice line items and job notes.
const _origSearch = window.runSearch;

async function deepSearch(q){
  if(!q || q.length < 2) return [];
  const ql = q.toLowerCase();
  const results = [];

  // Jobs — address, desc, notes, referrer
  const jobs = await dAll('jobs');
  jobs.forEach(j=>{
    const haystack = [j.address,j.description,j.referrer,j.notes,j.engineer,j.contact].join(' ').toLowerCase();
    if(haystack.includes(ql)) results.push({type:'job',label:`⊞ Job: ${escHtml(j.address)}`,sub:`${j.date} · ${escHtml(j.engineer)||'—'} · ${j.status}`,action:`openJobModal('${j.id}')`});
  });

  // Invoices — number, client, description + LINE ITEMS (deep)
  const invs = await dAll('invoices');
  invs.forEach(inv=>{
    const base = [inv.number,inv.clientName,inv.description,inv.notes].join(' ').toLowerCase();
    const lineItems = (inv.items||[]).map(i=>i.desc).join(' ').toLowerCase();
    if(base.includes(ql)||lineItems.includes(ql)){
      const t = calcInvTotal(inv);
      results.push({type:'inv',label:`◎ Invoice: ${inv.number} — ${inv.clientName||'—'}`,sub:`£${t.grand.toFixed(2)} · ${inv.status}${lineItems.includes(ql)?' · (matched in line items)':''}`,action:`nav('inv');setTimeout(()=>viewInv('${inv.id}'),200)`});
    }
  });

  // Persons
  const persons = await dAll('persons');
  persons.forEach(p=>{
    if([p.name,p.phone,p.email,p.address,p.notes].join(' ').toLowerCase().includes(ql))
      results.push({type:'person',label:`◉ Person: ${p.name}`,sub:`${(p.roles||[]).join(', ')} · ${p.phone||'—'}`,action:`nav('dir');setTimeout(()=>openPersonModal('${p.id}'),200)`});
  });

  // Certificates
  const certs = await dAll('certs');
  certs.forEach(c=>{
    if([c.address,c.landlord,c.type,c.certNum,c.notes].join(' ').toLowerCase().includes(ql))
      results.push({type:'cert',label:`◈ Cert: ${c.type} — ${c.address}`,sub:`Expiry: ${c.expiryDate}`,action:`nav('certs')`});
  });

  // Expenses — deep search
  const exps = await dAll('expenses');
  exps.forEach(e=>{
    if([e.desc,e.category,e.engineer,e.receipt].join(' ').toLowerCase().includes(ql))
      results.push({type:'expense',label:`🧾 Expense: ${e.desc}`,sub:`£${e.cost.toFixed(2)} · ${e.date} · ${e.engineer||'—'}`,action:`nav('exp')`});
  });

  return results.slice(0,20);
}

// Patch the command palette search to use deepSearch
const _patchCmdSearch = ()=>{
  const cmdInp = document.getElementById('cmd-input');
  if(!cmdInp) return;
  const origInput = cmdInp.oninput;
  cmdInp.oninput = async function(){
    const q = this.value.trim();
    if(!q){document.getElementById('cmd-results').innerHTML='';return}
    const res = await deepSearch(q);
    const el = document.getElementById('cmd-results');
    if(!res.length){el.innerHTML='<div style="padding:14px;text-align:center;color:var(--txt3);font-size:12px">No results</div>';return}
    // closeCmd() didn't exist anywhere — every command-palette result click
    // via this deep-search patch ran the action fine but then threw a
    // ReferenceError instead of closing the palette, leaving it lingering
    // over whatever it had just navigated to. The rest of the file already
    // closes this exact overlay via closeModal('cmd-overlay').
    el.innerHTML = res.map((r,i)=>`<div class="cmd-item" tabindex="0" onclick="${r.action};closeModal('cmd-overlay')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background='rgba(245,166,35,.08)'" onmouseout="this.style.background=''">
      <div style="font-family:var(--fh);font-weight:600;font-size:13px">${r.label}</div>
      <div style="font-size:11px;color:var(--txt3);margin-top:2px">${r.sub}</div>
    </div>`).join('');
  };
};

// ── Entry point: check Supabase Auth session, then run init() ──
(async function bootstrap(){
  const overlay=document.getElementById('pin-overlay');

  if(!_supaAuth){
    if(overlay)overlay.style.display='flex';
    setTimeout(()=>{ if(window._loginCanvasStart) window._loginCanvasStart(); const f=document.getElementById('login-email');if(f)f.focus(); },200);
    return;
  }

  try{
    const {data:{session}} = await _supaAuth.auth.getSession();
    if(session?.user){
      const email=(session.user.email||'').toLowerCase();
      const isEmergencyAdmin=EMERGENCY_ADMINS.includes(email);

      // Load profile — no active filter (was blocking valid users)
      let profile=null;
      const r1=await _sb(`users?auth_id=eq.${session.user.id}&select=*`).catch(()=>[]);
      profile=r1?.[0]||null;
      if(!profile){
        const r2=await _sb(`users?email=eq.${encodeURIComponent(email)}&select=*`).catch(()=>[]);
        profile=r2?.[0]||null;
        if(profile){
          _sb(`users?id=eq.${profile.id}`,{method:'PATCH',body:{auth_id:session.user.id},prefer:'return=minimal'}).catch(()=>{});
        }
      }

      // Emergency admin fallback — always get in even if profile missing
      if(!profile && isEmergencyAdmin){
        profile={id:session.user.id,auth_id:session.user.id,name:'Mandeep',email,role:'admin',active:true,can_edit:true,can_delete:true,can_invoice:true,can_finance:true,see_landlord:true,see_landlord_phone:true,see_agent:true,see_contact:true,see_price:true};
        _sb('users',{method:'POST',body:{auth_id:session.user.id,name:'Mandeep',email,role:'admin',active:true,can_edit:true,can_delete:true,can_invoice:true,can_finance:true,see_landlord:true,see_landlord_phone:true,see_agent:true,see_contact:true,see_price:true},prefer:'return=minimal'}).catch(()=>{});
      }
      // Force correct role for protected admins
      if(profile && isEmergencyAdmin && profile.role!=='admin'){
        profile.role='admin';
        _sb(`users?email=eq.${encodeURIComponent(email)}`,{method:'PATCH',body:{role:'admin',active:true},prefer:'return=minimal'}).catch(()=>{});
      }

      if(profile){
        if(profile.role==='engineer'){
          await _supaAuth.auth.signOut();
          if(overlay)overlay.style.display='flex';
          setTimeout(()=>{
            const errEl=document.getElementById('login-err');
            if(errEl){errEl.style.display='block';errEl.style.background='rgba(245,166,35,.1)';errEl.style.border='1px solid rgba(245,166,35,.3)';errEl.style.color='#f5a623';errEl.textContent='⚠️ Engineer accounts use the Engineer Portal. Ask your office manager for the link.';}
          },100);
          init().catch(()=>{});
          return;
        }
        const roleMap={admin:'Admin',manager:'Manager',finance:'Finance',staff:'Staff',viewer:'Viewer',engineer:'Engineer'};
        const role=roleMap[profile.role]||'Staff';
        const isAdmin=role==='Admin',isMgr=role==='Manager';
        _appUser={
          name:profile.name||session.user.email,email,role,
          _sbId:profile.id,_authId:session.user.id,
          canEdit:profile.can_edit!==false,canDelete:isAdmin||(profile.can_delete===true),
          canInvoice:profile.can_invoice!==false,canFinance:isAdmin||isMgr||(profile.can_finance===true),
          seeLandlord:profile.see_landlord!==false,seeLandlordPhone:profile.see_landlord_phone!==false,
          seeAgent:profile.see_agent!==false,seeContact:profile.see_contact!==false,seePrice:profile.see_price!==false,
        };
        if(overlay)overlay.style.display='none';
        await init();
        applyUserPermissions();
        startRealtimeSync();
        setTimeout(async()=>{
          try{await loadSettings();renderDash();updateBadges();}catch(e){console.warn('[DeepFlow]',e);}
        },800);
        return;
      } else {
        await _supaAuth.auth.signOut();
      }
    }
  }catch(e){console.warn('Session restore failed:',e);}

  // No session — show login screen with animation
  if(overlay)overlay.style.display='flex';
  setTimeout(()=>{
    if(window._loginCanvasStart) window._loginCanvasStart();
    const f=document.getElementById('login-email');if(f)f.focus();
  },200);
  init().catch(()=>{});
})();


//  Single-page view: all jobs + invoices + certs + payment status
//  for one landlord / person / agency.
// ════════════════════════════════════════════════════════════════
let _cvClientId   = null; // current person/agency id
let _cvClientType = null; // 'person' | 'agency'
let _cvClientName = null;
let _cvActiveTab  = 'jobs';

async function cvSearch(q){
  const ql = q.trim().toLowerCase();
  const picker = document.getElementById('cv-pick-list');
  if(!ql){ picker.innerHTML = ''; return; }

  const [persons, agencies] = await Promise.all([dAll('persons'), dAll('agencies')]);
  const pMatches = persons.filter(p => (p.name||'').toLowerCase().includes(ql)).slice(0,6);
  const aMatches = agencies.filter(a => (a.name||'').toLowerCase().includes(ql)).slice(0,4);

  const rows = [
    ...pMatches.map(p => `
      <div onclick="cvLoadClient('person','${p.id}','${(p.name||'').replace(/'/g,"\'")}',this)"
        style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;background:var(--s1);transition:background .12s"
        onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s1)'">
        <span style="font-size:20px">👤</span>
        <div>
          <div style="font-weight:700;font-size:13px">${p.name}</div>
          <div style="font-size:11px;color:var(--txt3)">${p.phone||''} ${p.email?'· '+p.email:''}</div>
        </div>
      </div>`),
    ...aMatches.map(a => `
      <div onclick="cvLoadClient('agency','${a.id}','${(a.name||'').replace(/'/g,"\'")}',this)"
        style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:6px;cursor:pointer;background:var(--s1);transition:background .12s"
        onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s1)'">
        <span style="font-size:20px">🏢</span>
        <div>
          <div style="font-weight:700;font-size:13px">${a.name}</div>
          <div style="font-size:11px;color:var(--txt3)">Agency${a.phone?' · '+a.phone:''}</div>
        </div>
      </div>`)
  ];

  picker.innerHTML = rows.length ? rows.join('') : '<div style="font-size:12px;color:var(--txt3)">No matches found</div>';
}

function renderClientPicker(){
  document.getElementById('cv-picker').style.display = 'block';
  document.getElementById('cv-record').style.display = 'none';
  document.getElementById('cv-search').value = '';
  document.getElementById('cv-pick-list').innerHTML = '';
}

async function cvLoadClient(type, id, name){
  _cvClientId   = id;
  _cvClientType = type;
  _cvClientName = name;
  _cvActiveTab  = 'jobs';

  document.getElementById('cv-picker').style.display = 'none';
  document.getElementById('cv-record').style.display = 'flex';
  document.getElementById('cv-record').style.flexDirection = 'column';
  document.getElementById('cv-hero').innerHTML = '<div style="color:var(--txt3);font-size:12px">Loading…</div>';
  document.getElementById('cv-kpis').innerHTML = '';
  document.getElementById('cv-tabs').innerHTML = '';
  document.getElementById('cv-panel-jobs').innerHTML = '';
  document.getElementById('cv-panel-invoices').innerHTML = '';
  document.getElementById('cv-panel-certs').innerHTML = '';

  // Fetch everything in parallel
  const [allJobs, allInvs, allCerts, allPmts, allAgents] = await Promise.all([
    dAll('jobs'), dAll('invoices'), dAll('certs'), dAll('payments'), dAll('agents')
  ]);

  // Match by name (both referrer and landlordName on jobs, clientName on invoices)
  const jobs = allJobs.filter(j =>
    j.referrer === name || j.landlordName === name || j.agencyName === name
  ).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const invs = allInvs.filter(i =>
    i.clientName === name || i.clientId === id
  ).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const certs = allCerts.filter(c =>
    c.landlord === name || c.agent === name
  ).sort((a,b) => (a.expiryDate||'').localeCompare(b.expiryDate||''));

  // For agencies: find linked agents and their stats
  let agencyAgents = [];
  if(type==='agency'){
    agencyAgents = allAgents.filter(a=>a.agencyId===id||a.agencyName===name).map(a=>{
      const aJobs=allJobs.filter(j=>j.agentName===a.name);
      const aCompleted=aJobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED);
      const aRevenue=aCompleted.reduce((s,j)=>s+Number(j.price||0),0);
      return{...a,jobCount:aJobs.length,completedCount:aCompleted.length,revenue:aRevenue};
    });
  }

  // Payment totals
  const invIds = new Set(invs.map(i => i.id));
  const pmts = allPmts.filter(p => invIds.has(p.invId));
  const totalInvoiced = invs.reduce((s,i) => s + (calcInvTotal(i).grand||0), 0);
  const totalPaid     = pmts.reduce((s,p) => s + (p.amount||0), 0);
  const outstanding   = Math.max(0, totalInvoiced - totalPaid);
  const expiredCerts  = certs.filter(c => c.expiryDate && daysDiff(c.expiryDate) < 0).length;
  const expiringSoon  = certs.filter(c => c.expiryDate && daysDiff(c.expiryDate) >= 0 && daysDiff(c.expiryDate) <= 60).length;

  // ── Hero ──
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('cv-hero').innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#1a1a1a;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--fh);font-size:20px;font-weight:800;color:var(--txt)">${name}</div>
        <div style="font-size:11px;color:var(--txt3);margin-top:3px">${type==='agency'?'🏢 Agency':'👤 Person / Landlord'}</div>
        <div id="cv-rating-strip" style="margin-top:8px"></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderClientPicker()">← Back</button>
    </div>`;
  // Load rating asynchronously so hero renders immediately
  _renderRatingStrip('cv-rating-strip', name);

  // ── KPIs ──
  const kpi = (val, lbl, col) => `
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:14px;text-align:center;border-top:3px solid ${col}">
      <div style="font-size:22px;font-weight:800;font-family:var(--fm);color:var(--txt)">${val}</div>
      <div style="font-size:10px;color:var(--txt3);text-transform:uppercase;letter-spacing:.8px;margin-top:4px;font-weight:700">${lbl}</div>
    </div>`;
  document.getElementById('cv-kpis').innerHTML =
    kpi(jobs.length, 'Total Jobs', 'var(--acc)') +
    kpi(jobs.filter(j=>j.status===STATUS.COMPLETED||j.status===STATUS.INVOICED).length, 'Completed', 'var(--green)') +
    kpi(invs.length, 'Invoices', 'var(--purple)') +
    kpi('£'+totalPaid.toFixed(0), 'Paid', 'var(--green)') +
    kpi(outstanding>0?'£'+outstanding.toFixed(0):'£0', 'Outstanding', outstanding>0?'var(--yellow)':'var(--green)') +
    kpi(certs.length, 'Certificates', 'var(--teal)') +
    (expiredCerts ? kpi(expiredCerts, 'Expired Certs', 'var(--red)') : '') +
    (expiringSoon ? kpi(expiringSoon, 'Expiring <60d', 'var(--yellow)') : '');

  // ── Tabs ──
  const tabBtn = (id, lbl, count) => `
    <button id="cv-tab-${id}" onclick="cvSwitchTab('${id}')"
      style="padding:8px 14px;border:none;background:${_cvActiveTab===id?'var(--acc)':'transparent'};color:${_cvActiveTab===id?'#fff':'var(--txt2)'};border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--fh);transition:all .15s">
      ${lbl} <span style="opacity:.7">(${count})</span>
    </button>`;
  let tabsHtml = tabBtn('jobs','⊞ Jobs',jobs.length) +
    tabBtn('invoices','◎ Invoices',invs.length) +
    tabBtn('certs','◈ Certs',certs.length);
  if(type==='agency' && agencyAgents.length){
    tabsHtml += tabBtn('agents','👤 Agents',agencyAgents.length);
  }
  document.getElementById('cv-tabs').innerHTML = tabsHtml;

  // ── Jobs panel ──
  document.getElementById('cv-panel-jobs').innerHTML = jobs.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Date</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Address</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Trade</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Engineer</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Status</th>
        <th style="text-align:right;padding:8px 10px;color:var(--txt3);font-weight:700">Price</th>
      </tr></thead>
      <tbody>
        ${jobs.map(j=>`<tr style="border-bottom:1px solid var(--border);cursor:pointer" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''" onclick="openJobModal('${j.id}')">
          <td style="padding:9px 10px;white-space:nowrap">${j.date||'—'}</td>
          <td style="padding:9px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.address)||'—'}</td>
          <td style="padding:9px 10px">${escHtml(j.trade)||'—'}</td>
          <td style="padding:9px 10px">${escHtml(j.engineer)||'—'}</td>
          <td style="padding:9px 10px"><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${j.status===STATUS.COMPLETED?'rgba(37,213,142,.12)':j.status===STATUS.INVOICED?'rgba(168,85,247,.12)':j.status===STATUS.CANCELLED?'rgba(100,116,139,.12)':'rgba(245,166,35,.12)'};color:${j.status===STATUS.COMPLETED?'var(--green)':j.status===STATUS.INVOICED?'var(--purple)':j.status===STATUS.CANCELLED?'var(--txt3)':'var(--yellow)'};font-weight:700">${j.status||'Pending'}</span></td>
          <td style="padding:9px 10px;text-align:right;font-family:var(--fm)">${j.price?'£'+Number(j.price).toFixed(2):'—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<div style="color:var(--txt3);font-size:13px;padding:20px 0">No jobs found for this client</div>';

  // ── Invoices panel ──
  document.getElementById('cv-panel-invoices').innerHTML = invs.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Invoice #</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Date</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Description</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Status</th>
        <th style="text-align:right;padding:8px 10px;color:var(--txt3);font-weight:700">Total</th>
        <th style="text-align:right;padding:8px 10px;color:var(--txt3);font-weight:700">Paid</th>
        <th style="text-align:right;padding:8px 10px;color:var(--txt3);font-weight:700">Outstanding</th>
      </tr></thead>
      <tbody>
        ${invs.map(i=>{
          const t=calcInvTotal(i);
          const invPaid=pmts.filter(p=>p.invId===i.id).reduce((s,p)=>s+p.amount,0);
          const owed=Math.max(0,t.grand-invPaid);
          const sCol={'Draft':'var(--txt3)','Awaiting Payment':'var(--yellow)','Paid':'var(--green)','Cancelled':'var(--red)'}[i.status]||'var(--txt3)';
          return `<tr style="border-bottom:1px solid var(--border);cursor:pointer" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background=''" onclick="nav('inv');setTimeout(()=>viewInv('${i.id}'),200)">
            <td style="padding:9px 10px;font-family:var(--fm);color:var(--acc)">${i.number}</td>
            <td style="padding:9px 10px;white-space:nowrap">${i.date||'—'}</td>
            <td style="padding:9px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.description||'—'}</td>
            <td style="padding:9px 10px"><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${sCol}22;color:${sCol};font-weight:700">${i.status}</span></td>
            <td style="padding:9px 10px;text-align:right;font-family:var(--fm)">£${t.grand.toFixed(2)}</td>
            <td style="padding:9px 10px;text-align:right;font-family:var(--fm);color:var(--green)">£${invPaid.toFixed(2)}</td>
            <td style="padding:9px 10px;text-align:right;font-family:var(--fm);color:${owed>0?'var(--yellow)':'var(--green)'};font-weight:${owed>0?700:400}">${owed>0?'£'+owed.toFixed(2):'✓'}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr style="border-top:2px solid var(--border)">
        <td colspan="4" style="padding:10px;font-weight:700;font-size:12px">Totals</td>
        <td style="padding:10px;text-align:right;font-weight:800;font-family:var(--fm)">£${totalInvoiced.toFixed(2)}</td>
        <td style="padding:10px;text-align:right;font-weight:800;font-family:var(--fm);color:var(--green)">£${totalPaid.toFixed(2)}</td>
        <td style="padding:10px;text-align:right;font-weight:800;font-family:var(--fm);color:${outstanding>0?'var(--yellow)':'var(--green)'}">${outstanding>0?'£'+outstanding.toFixed(2):'All paid ✓'}</td>
      </tr></tfoot>
    </table>` : '<div style="color:var(--txt3);font-size:13px;padding:20px 0">No invoices found for this client</div>';

  // ── Certs panel ──
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('cv-panel-certs').innerHTML = certs.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Address</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Type</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Cert #</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Issued</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Expires</th>
        <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Status</th>
      </tr></thead>
      <tbody>
        ${certs.map(c=>{
          const diff = c.expiryDate ? daysDiff(c.expiryDate) : null;
          const expired = diff !== null && diff < 0;
          const soon    = diff !== null && diff >= 0 && diff <= 60;
          const sLabel  = diff===null?'No date':expired?Math.abs(diff)+'d overdue':diff===0?'Expires today':diff+'d left';
          const sCol    = diff===null?'var(--txt3)':expired?'var(--red)':soon?'var(--yellow)':'var(--green)';
          return `<tr style="border-bottom:1px solid var(--border)">
            <td style="padding:9px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.address||'—'}</td>
            <td style="padding:9px 10px">${c.type||'—'}</td>
            <td style="padding:9px 10px;font-family:var(--fm);font-size:11px;color:var(--acc)">${c.certNum||'—'}</td>
            <td style="padding:9px 10px;white-space:nowrap">${c.issueDate||'—'}</td>
            <td style="padding:9px 10px;white-space:nowrap">${c.expiryDate||'—'}</td>
            <td style="padding:9px 10px"><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${sCol}22;color:${sCol};font-weight:700">${sLabel}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : '<div style="color:var(--txt3);font-size:13px;padding:20px 0">No certificates found for this client</div>';

  // ── Agents panel (agency only) ──
  if(type==='agency'){
    document.getElementById('cv-panel-agents').innerHTML = agencyAgents.length ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-bottom:16px">
        ${agencyAgents.map(a=>{
          const compRate=a.jobCount?Math.round(a.completedCount/a.jobCount*100):0;
          return`<div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:14px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0">${(a.name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.name}</div>
                <div style="font-size:10px;color:var(--txt3)">${a.phone||'No phone'}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;text-align:center">
              <div><div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--acc)">${a.jobCount}</div><div style="font-size:9px;color:var(--txt3);font-weight:700;text-transform:uppercase">Jobs</div></div>
              <div><div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--green)">${a.completedCount}</div><div style="font-size:9px;color:var(--txt3);font-weight:700;text-transform:uppercase">Done</div></div>
              <div><div style="font-family:var(--fh);font-size:16px;font-weight:800;color:var(--purple)">£${a.revenue.toFixed(0)}</div><div style="font-size:9px;color:var(--txt3);font-weight:700;text-transform:uppercase">Revenue</div></div>
            </div>
            <div style="margin-top:8px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${compRate}%;background:${compRate>=80?'var(--green)':compRate>=50?'var(--yellow)':'var(--red)'};border-radius:2px;transition:width .4s ease"></div>
            </div>
            <div style="font-size:9px;color:var(--txt3);text-align:right;margin-top:2px">${compRate}% completion</div>
          </div>`;
        }).join('')}
      </div>
      <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:16px">
        <div style="font-family:var(--fh);font-size:14px;font-weight:800;margin-bottom:12px">All Agent Jobs</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Date</th>
            <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Address</th>
            <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Agent</th>
            <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Trade</th>
            <th style="text-align:left;padding:8px 10px;color:var(--txt3);font-weight:700">Status</th>
            <th style="text-align:right;padding:8px 10px;color:var(--txt3);font-weight:700">Price</th>
          </tr></thead>
          <tbody>
            ${jobs.map(j=>`<tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 10px;white-space:nowrap">${j.date||'—'}</td>
              <td style="padding:8px 10px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(j.address)||'—'}</td>
              <td style="padding:8px 10px;font-weight:600;color:var(--purple)">${escHtml(j.agentName)||'—'}</td>
              <td style="padding:8px 10px">${escHtml(j.trade)||'—'}</td>
              <td style="padding:8px 10px"><span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${j.status===STATUS.COMPLETED?'rgba(37,213,142,.12)':j.status===STATUS.INVOICED?'rgba(168,85,247,.12)':'rgba(245,166,35,.12)'};color:${j.status===STATUS.COMPLETED?'var(--green)':j.status===STATUS.INVOICED?'var(--purple)':'var(--yellow)'};font-weight:700">${j.status||'Pending'}</span></td>
              <td style="padding:8px 10px;text-align:right;font-family:var(--fh)">${j.price?'£'+Number(j.price).toFixed(2):'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
      : '<div style="color:var(--txt3);font-size:13px;padding:20px 0">No agents linked to this agency</div>';
  }

  cvSwitchTab('jobs');
}

function cvSwitchTab(tab){
  _cvActiveTab = tab;
  ['jobs','invoices','certs','agents'].forEach(t=>{
    const panel = document.getElementById('cv-panel-'+t);
    const btn   = document.getElementById('cv-tab-'+t);
    if(panel) panel.style.display = t===tab ? 'block' : 'none';
    if(btn){
      btn.style.background = t===tab ? 'var(--acc)' : 'transparent';
      btn.style.color      = t===tab ? '#fff' : 'var(--txt2)';
    }
  });
}

// Allow opening client view directly from a person/agency name anywhere in the app
function openClientView(name, type){
  nav('client');
  setTimeout(()=>{
    document.getElementById('cv-search').value = name;
    cvSearch(name);
  }, 100);
}

// ════════════════════════════════════════════════════════════════
//  DIRECTORY V2 — BULK SELECT, MERGE, PORTAL INVITE
// ════════════════════════════════════════════════════════════════

// ── State ──
window._dirBulkMode=window._dirBulkMode||{};     // { section: boolean }
window._dirBulkSelected=window._dirBulkSelected||new Set();
window._mergeSelections=window._mergeSelections||{}; // { fieldName: personIndex }

// ── Sort helper ──
export function _sortPersons(ps, mode, invs, jobs){
  if(mode==='owed'){
    ps.sort((a,b)=>{
      const oa=invs.filter(i=>i.clientId===a.id&&i.status==='Awaiting Payment').reduce((s,i)=>s+calcInvTotal(i).grand,0);
      const ob=invs.filter(i=>i.clientId===b.id&&i.status==='Awaiting Payment').reduce((s,i)=>s+calcInvTotal(i).grand,0);
      return ob-oa;
    });
  }else if(mode==='recent'){
    ps.sort((a,b)=>{
      const ja=jobs.filter(j=>j.referrer===a.name||j.clientId===a.id);
      const jb=jobs.filter(j=>j.referrer===b.name||j.clientId===b.id);
      const da=ja.length?ja.sort((x,y)=>(y.date||'').localeCompare(x.date||''))[0].date||'':'';
      const db=jb.length?jb.sort((x,y)=>(y.date||'').localeCompare(x.date||''))[0].date||'':'';
      return db.localeCompare(da);
    });
  }else if(mode==='jobs'){
    ps.sort((a,b)=>{
      const ja=jobs.filter(j=>j.referrer===a.name||j.clientId===a.id).length;
      const jb=jobs.filter(j=>j.referrer===b.name||j.clientId===b.id).length;
      return jb-ja;
    });
  }else{
    ps.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  }
}

// ── Bulk Select Mode ──
function toggleBulkSelectMode(section){
  const sec=section||getCurDirSection();
  const wasOn=!!window._dirBulkMode[sec];
  window._dirBulkMode[sec]=!wasOn;
  if(!wasOn){
    window._dirBulkSelected=new Set();
  }
  // Show/hide UI
  const bar=document.getElementById('dir-bulk-bar-'+sec);
  const btn=document.getElementById('dir-bulk-btn-'+sec);
  if(bar) bar.style.display=wasOn?'none':'flex';
  if(btn) btn.textContent=wasOn?'☐ Bulk Select':'☑ Done';
  _updateBulkUI(sec);
  // Re-render to show/hide checkboxes
  renderDirSection(sec);
}

function _updateBulkUI(section){
  const sec=section||getCurDirSection();
  const mergeBtn=document.getElementById('dir-merge-btn-'+sec);
  const countEl=document.getElementById('dir-bulk-count-'+sec);
  const sel=window._dirBulkSelected;
  if(countEl) countEl.textContent=sel.size+' selected';
  if(mergeBtn) mergeBtn.style.display=(sel.size>=2&&sel.size<=3)?'':'none';
}

function togglePersonSelect(personId){
  const sel=window._dirBulkSelected;
  if(sel.has(personId)) sel.delete(personId); else sel.add(personId);
  _updateBulkUI(getCurDirSection());
  // Re-render to update checkbox visuals
  renderDirSection(getCurDirSection());
}

// ── Merge Modal ──
function openMergeModal(){
  const sel=Array.from(window._dirBulkSelected);
  if(sel.length<2||sel.length>3){toast('Select 2–3 people to merge','warn');return;}
  // Fetch person data
  dAll('persons').then(all=>{
    const toMerge=sel.map(id=>all.find(p=>p.id===id)).filter(Boolean);
    if(toMerge.length<2){toast('Could not load selected people','error');return;}
    _renderMergeModal(toMerge);
  }).catch(e=>{console.error(e);toast('Error loading people','error');});
}

function _renderMergeModal(people){
  const existing=document.getElementById('merge-overlay');
  if(existing) existing.remove();
  window._mergeSelections={};
  window._mergePeople=people;

  const fields=[
    {key:'name',label:'Name',get:p=>p.name||''},
    {key:'phone',label:'Phone',get:p=>p.phone||''},
    {key:'email',label:'Email',get:p=>p.email||''},
    {key:'address',label:'Address',get:p=>p.address||''},
    {key:'wa',label:'WhatsApp',get:p=>p.wa||''},
    {key:'notes',label:'Notes',get:p=>p.notes||''},
    {key:'roles',label:'Roles',get:p=>(p.roles||[]).join(', ')}
  ];

  // For each field, auto-select the non-empty value (prefer most complete)
  fields.forEach(f=>{
    const bestIdx=people.map((p,i)=>({i,val:f.get(p),len:(f.get(p)||'').length})).sort((a,b)=>b.len-a.len)[0];
    if(bestIdx&&bestIdx.len>0) window._mergeSelections[f.key]=bestIdx.i;
  });

  const div=document.createElement('div');
  div.id='merge-overlay';
  div.className='merge-overlay';
  div.innerHTML=`
    <div class="merge-modal">
      <div class="merge-modal-hd">
        <h3>🔀 Merge ${people.length} People</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('merge-overlay').remove()">✕ Cancel</button>
      </div>
      <div class="merge-modal-body">
        <p style="font-size:12px;color:var(--txt2);margin:0 0 14px">Pick the best value for each field. All jobs, invoices and certificates will move to the merged record.</p>
        <div style="display:grid;grid-template-columns:${people.length===3?'1fr 1fr 1fr':'1fr 1fr'};gap:12px;margin-bottom:16px">
          ${people.map((p,i)=>`
            <div class="merge-person-col ${i===0?'master':''}">
              <div style="font-family:var(--fh);font-weight:800;font-size:14px;margin-bottom:2px;color:var(--txt)">${p.name||'Unnamed'}</div>
              <div style="font-size:10px;color:var(--txt3)">${(p.roles||[]).join(', ')||'No roles'}</div>
              ${i===0?'<div style="font-size:9px;color:var(--acc);font-weight:700;margin-top:4px">★ MASTER (keep this ID)</div>':''}
            </div>
          `).join('')}
        </div>
        <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden">
          ${fields.map(f=>`
            <div class="merge-field-row">
              <div class="merge-field-label">${f.label}</div>
              ${people.map((p,i)=>`
                <div class="merge-field-val ${window._mergeSelections[f.key]===i?'selected':''} ${!f.get(p)?'empty':''}"
                     onclick="resolveMergeField('${f.key}',${i})"
                     data-field="${f.key}" data-idx="${i}">
                  ${f.get(p)||'(empty)'}
                  <span class="pick-tag">PICKED</span>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
        <div class="merge-preview">
          <div style="font-family:var(--fh);font-weight:800;font-size:13px;margin-bottom:8px;color:var(--green)">✓ Preview of merged record</div>
          <div id="merge-preview-body" style="font-size:12px;color:var(--txt);line-height:1.8"></div>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end;flex-shrink:0">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('merge-overlay').remove()">Cancel</button>
        <button class="btn btn-warn btn-sm" onclick="executeMerge()">🔀 Execute Merge</button>
      </div>
    </div>`;
  div.addEventListener('click',e=>{if(e.target===div)div.remove();});
  document.body.appendChild(div);
  _updateMergePreview();
}

function resolveMergeField(fieldName, personIndex){
  window._mergeSelections[fieldName]=personIndex;
  document.querySelectorAll(`.merge-field-val[data-field="${fieldName}"]`).forEach(el=>{
    el.classList.toggle('selected',parseInt(el.dataset.idx)===personIndex);
  });
  _updateMergePreview();
}

function _updateMergePreview(){
  const people=window._mergePeople||[];
  const sel=window._mergeSelections;
  const body=document.getElementById('merge-preview-body');
  if(!body||!people.length)return;
  const lines=[];
  const fields=[
    {key:'name',label:'Name'},{key:'phone',label:'Phone'},{key:'email',label:'Email'},
    {key:'address',label:'Address'},{key:'wa',label:'WhatsApp'},{key:'notes',label:'Notes'},{key:'roles',label:'Roles'}
  ];
  fields.forEach(f=>{
    const idx=sel[f.key];
    if(idx!==undefined&&people[idx]){
      const v=people[idx][f.key];
      const display=Array.isArray(v)?v.join(', '):v;
      if(display) lines.push(`<strong>${f.label}:</strong> ${display}`);
    }
  });
  body.innerHTML=lines.join('<br>');
}

async function executeMerge(){
  const people=window._mergePeople;
  const sel=window._mergeSelections;
  if(!people||people.length<2)return;
  const master=people[0];
  const mergeIds=people.slice(1).map(p=>p.id);

  // Build merged data FIRST — this is the chosen "final" person
  const fields=['name','phone','email','address','wa','notes','roles'];
  const mergedData={...master};
  fields.forEach(f=>{
    const idx=sel[f];
    if(idx!==undefined&&people[idx]&&people[idx][f]){
      mergedData[f]=people[idx][f];
    }
  });
  // Ensure roles is an array
  if(mergedData.roles&&typeof mergedData.roles==='string') mergedData.roles=mergedData.roles.split(',').map(r=>r.trim()).filter(Boolean);

  // CRITICAL: Use mergedData.name (the CHOSEN name), NOT master.name (old person[0] name)
  const chosenName=mergedData.name||master.name;
  const chosenPhone=mergedData.phone||master.phone;
  const chosenEmail=mergedData.email||master.email;
  const chosenWA=mergedData.wa||master.wa;

  if(!confirm(`Merge ${people.length} people into "${chosenName}"?\n\nThis will:\n• Move all jobs, invoices & certificates to "${chosenName}"\n• Delete the other ${mergeIds.length} record(s)\n\nThis cannot be undone.`)) return;

  try{
    toast('Merging records…','info',8000);

    // Update master person record with chosen data
    await dPut('persons', mergedData);

    // Collect ALL names from ALL people being merged (including person[0]!)
    const allMergedNames=people.map(p=>p.name).filter((n,i,arr)=>n&&arr.indexOf(n)===i);

    // Get all related data
    const [allJobs,allInvs,allCerts]=await Promise.all([dAll('jobs'),dAll('invoices'),dAll('certs')]);

    let jobsUpdated=0, invsUpdated=0, certsUpdated=0;

    // ═══ Update jobs — ALL name-based fields ═══
    for(const j of allJobs){
      let changed=false;
      // referrer: update if it matches ANY merged person's name (incl. person[0])
      if(allMergedNames.includes(j.referrer)){ j.referrer=chosenName; changed=true; }
      // clientId: update if it was one of the deleted persons
      if(mergeIds.includes(j.clientId)){ j.clientId=master.id; changed=true; }
      // landlordName: update if it matches any merged name
      if(allMergedNames.includes(j.landlordName)){ j.landlordName=chosenName; changed=true; }
      // landlordPhone: update if it matched any merged person's phone
      if(j.landlordPhone&&people.some(p=>p.phone&&j.landlordPhone===p.phone)){ j.landlordPhone=chosenPhone; changed=true; }
      // landlordEmail: update if it matched any merged person's email
      if(j.landlordEmail&&people.some(p=>p.email&&j.landlordEmail===p.email)){ j.landlordEmail=chosenEmail; changed=true; }
      // landlordWA: update if it matched any merged person's WA
      if(j.landlordWA&&people.some(p=>p.wa&&j.landlordWA===p.wa)){ j.landlordWA=chosenWA; changed=true; }
      // contact: often stores the phone number — update if it matched
      if(j.contact&&people.some(p=>p.phone&&j.contact===p.phone)){ j.contact=chosenPhone; changed=true; }
      if(changed){ await dPut('jobs', j); jobsUpdated++; }
    }

    // ═══ Update invoices — client references ═══
    for(const inv of allInvs){
      let changed=false;
      // clientId: update if it was one of the deleted persons
      if(mergeIds.includes(inv.clientId)){ inv.clientId=master.id; inv.clientName=chosenName; changed=true; }
      // clientName: update if it matches any merged name (even without clientId)
      if(allMergedNames.includes(inv.clientName)){ inv.clientName=chosenName; changed=true; }
      // billToName: update if it matches any merged name
      if(allMergedNames.includes(inv.billToName)){ inv.billToName=chosenName; changed=true; }
      if(changed){ await dPut('invoices', inv); invsUpdated++; }
    }

    // ═══ Update certs — landlord references ═══
    for(const c of allCerts){
      let changed=false;
      // landlord name
      if(allMergedNames.includes(c.landlord)){ c.landlord=chosenName; changed=true; }
      // landlordPhone
      if(c.landlordPhone&&people.some(p=>p.phone&&c.landlordPhone===p.phone)){ c.landlordPhone=chosenPhone; changed=true; }
      // landlordEmail
      if(c.landlordEmail&&people.some(p=>p.email&&c.landlordEmail===p.email)){ c.landlordEmail=chosenEmail; changed=true; }
      if(changed){ await dPut('certs', c); certsUpdated++; }
    }

    // ═══ Delete merged records ═══
    for(const id of mergeIds){ await dDel('persons', id); }

    // ═══ Clear bulk state ═══
    window._dirBulkSelected=new Set();
    window._dirBulkMode[getCurDirSection()]=false;
    document.querySelectorAll('.bulk-mode-bar').forEach(b=>b.style.display='none');
    document.querySelectorAll('[id^="dir-bulk-btn-"]').forEach(b=>b.textContent='☐ Bulk Select');
    document.querySelectorAll('[id^="dir-merge-btn-"]').forEach(b=>b.style.display='none');

    // Close modal
    const overlay=document.getElementById('merge-overlay');
    if(overlay) overlay.remove();

    // Re-render
    renderDirSection(getCurDirSection());
    updateDirTabBadges();
    await logActivity(`Merged ${people.length} people into "${chosenName}"`,'person',{masterId:master.id,jobs:jobsUpdated,invs:invsUpdated,certs:certsUpdated});
    toast(`✅ Merged into "${chosenName}"\nJobs: ${jobsUpdated} · Invoices: ${invsUpdated} · Certs: ${certsUpdated} updated`,'success',6000);
  }catch(e){
    console.error('[DeepFlow] Merge failed:',e);
    toast('Merge failed: '+e.message,'error',5000);
  }
}

// ── Portal Invite Modal (v4 — compact "visiting card" matching the app's
//    own navy lock-screen background, left = DeepFlow advertisement,
//    right = the client's personal invitation) ──
let _piCanvasRaf=null;

function closePortalInviteModal(){
  if(_piCanvasRaf){ cancelAnimationFrame(_piCanvasRaf); _piCanvasRaf=null; }
  document.getElementById('portal-invite-overlay')?.remove();
}

function _startPortalInviteCanvas(){
  const canvas=document.getElementById('pi-canvas');
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const p=canvas.parentElement;
  let W=canvas.width=p.offsetWidth, H=canvas.height=p.offsetHeight;
  const bg=ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,'#0d1f3c');bg.addColorStop(.5,'#1e3a5f');bg.addColorStop(1,'#0a1628');
  const nodes=Array.from({length:26},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.04,vy:(Math.random()-.5)*.04,r:Math.random()<.15?2.6:1.3,pulse:Math.random()*Math.PI*2}));

  function draw(){
    if(!document.body.contains(canvas)){ _piCanvasRaf=null; return; }
    ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const n=nodes[i],m=nodes[j],d=Math.hypot(n.x-m.x,n.y-m.y);
      if(d<W*.18){ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(m.x,m.y);ctx.strokeStyle='rgba(125,211,252,.18)';ctx.lineWidth=.7;ctx.stroke();}
    }
    nodes.forEach(n=>{
      n.pulse+=.011;n.x+=n.vx;n.y+=n.vy;
      if(n.x<0||n.x>W)n.vx*=-1;if(n.y<0||n.y>H)n.vy*=-1;
      const a=.5+Math.sin(n.pulse)*.25;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a})`;ctx.fill();
    });
    _piCanvasRaf=requestAnimationFrame(draw);
  }
  draw();
}

function showPortalInviteModal(id, name, type, agentName){
  const url=_buildPortalUrl(id, type, agentName);
  closePortalInviteModal();

  const safeName=name.replace(/'/g,"\\'");
  const safeUrl=url.replace(/'/g,"\\'");

  const div=document.createElement('div');
  div.id='portal-invite-overlay';
  div.className='portal-invite-overlay';
  div.innerHTML=`
    <button onclick="closePortalInviteModal()" class="portal-vcard-close">✕</button>

    <!-- Visiting card: one shared navy/particle background, split into an
         advertisement half and a personal-invitation half -->
    <div style="width:100%;max-width:640px;aspect-ratio:16/9;min-height:340px;border-radius:20px;overflow:hidden;
      position:relative;box-shadow:0 24px 80px rgba(0,0,0,.5);background:linear-gradient(155deg,#0d1f3c,#1e3a5f,#0a1628)">
      <canvas id="pi-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0"></canvas>
      <div style="position:relative;z-index:2;display:flex;height:100%;font-family:'Inter',-apple-system,sans-serif">

        <!-- LEFT: DeepFlow advertisement -->
        <div style="flex:1;padding:24px 22px;border-right:1px solid rgba(125,211,252,.15);display:flex;flex-direction:column;justify-content:center">
          <div style="font-size:22px;font-weight:900;letter-spacing:2px;font-family:Arial Black,Impact,sans-serif;margin-bottom:2px">
            <span style="background:linear-gradient(135deg,#7dd3fc 0%,#38bdf8 35%,#fde68a 65%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">DEEPFLOW</span>
          </div>
          <div style="font-size:9px;color:rgba(125,211,252,.4);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:12px">Smart Property Compliance Suite</div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(125,211,252,.08);border:1px solid rgba(125,211,252,.18);border-radius:100px;padding:4px 10px;margin-bottom:16px;align-self:flex-start">
            <span style="font-size:10px;color:rgba(255,255,255,.4)">on behalf of</span>
            <span style="font-size:11px;font-weight:700;color:#fde68a">${escHtml(S.coName||'Your Service Provider')}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="font-size:11px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:8px"><span>🔧</span> Job tracking, start to finish</div>
            <div style="font-size:11px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:8px"><span>📜</span> Certificates with expiry alerts</div>
            <div style="font-size:11px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:8px"><span>💰</span> Invoices, tracked and paid online</div>
            <div style="font-size:11px;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:8px"><span>⚡</span> Faster than a phone call</div>
          </div>
        </div>

        <!-- RIGHT: personal invitation -->
        <div style="flex:1;padding:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <div style="font-size:9px;color:rgba(125,211,252,.5);letter-spacing:2.5px;text-transform:uppercase;margin-bottom:6px">You're invited</div>
          <div style="font-size:18px;font-weight:800;color:#fde68a;margin-bottom:10px;line-height:1.25">${escHtml(name)}</div>
          <div id="pi-qr-wrap" style="width:96px;height:96px;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;box-shadow:0 0 20px rgba(125,211,252,.2)">
            <div style="font-size:9px;color:#999;text-align:center">Loading…</div>
          </div>
          <div style="font-size:8.5px;color:rgba(125,211,252,.6);font-family:var(--fm,monospace);word-break:break-all;padding:0 6px;line-height:1.5">${url}</div>
          <div style="font-size:9px;color:rgba(255,255,255,.35);margin-top:8px">📱 Scan or tap the link below</div>
        </div>
      </div>
    </div>

    <!-- Action buttons (outside the card) -->
    <div class="portal-vcard-actions">
      <button class="vca-copy" onclick="_copyPortalLink('${safeUrl}','${safeName}',this)">📋 Copy Link</button>
      <button class="vca-wa" onclick="_waPortalShare('${safeUrl}','${safeName}',this)">💬 WhatsApp</button>
      <button class="vca-email" onclick="_emailPortalShare('${safeUrl}','${safeName}',this)">✉ Email</button>
      <button class="vca-save" onclick="downloadPortalInviteCard('${safeName}','${safeUrl}')">⬇ Save Card</button>
      <button class="vca-copy" style="background:#7c2d12;color:#fed7aa" onclick="resetPortalPin('${id}','${type}','${safeName}')">🔑 Reset PIN</button>
    </div>`;
  div.addEventListener('click',e=>{if(e.target===div)closePortalInviteModal();});
  document.body.appendChild(div);

  _startPortalInviteCanvas();

  setTimeout(()=>{
    const wrap=document.getElementById('pi-qr-wrap');
    if(!wrap)return;
    const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=1e3a5f&qzone=1`;
    const img=document.createElement('img');
    img.src=qrUrl; img.style.cssText='width:88px;height:88px;border-radius:8px;display:block';
    img.onload=()=>{wrap.innerHTML='';wrap.appendChild(img);};
    img.onerror=()=>{wrap.innerHTML='<div style="font-size:9px;color:#999;text-align:center;padding:6px">QR unavailable</div>';};
  },100);
}

// ── Download Portal Invite as PNG Card ──
async function downloadPortalInviteCard(name, url){
  try{
    toast('Generating card...','info',3000);

    // Fetch QR as image
    const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=1e3a5f&qzone=1`;
    const qrImg=await new Promise((res,rej)=>{
      const i=new Image();i.crossOrigin='anonymous';
      i.onload=()=>res(i);i.onerror=()=>res(null);i.src=qrUrl;
    });

    const W=800, H=1200; // 2x retina
    const canvas=document.createElement('canvas');
    canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');

    // Helper: rounded rect
    function roundRect(x,y,w,h,r){
      ctx.beginPath();
      ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
      ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
      ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
      ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
      ctx.closePath();
    }

    // White card background
    ctx.fillStyle='#ffffff';
    roundRect(0,0,W,H,40);ctx.fill();

    // Gradient header bar
    const grad=ctx.createLinearGradient(0,0,W,120);
    grad.addColorStop(0,'#2563eb');grad.addColorStop(1,'#3b82f6');
    ctx.fillStyle=grad;
    roundRect(0,0,W,200,40);ctx.fill();
    // Clip to hide top rounded corners bleed
    ctx.save();
    ctx.beginPath();ctx.rect(0,200,W,20);ctx.fillStyle=grad;ctx.fill();ctx.restore();

    // Company name
    ctx.fillStyle='#ffffff';
    ctx.font='bold 52px system-ui,-apple-system,sans-serif';
    ctx.textAlign='center';
    ctx.letterSpacing='6px';
    ctx.fillText((S.coName||'DEEPFLOW').toUpperCase(),W/2,110);

    // CLIENT PORTAL subtitle
    ctx.font='20px system-ui,-apple-system,sans-serif';
    ctx.fillStyle='rgba(255,255,255,0.65)';
    ctx.letterSpacing='8px';
    ctx.fillText('CLIENT PORTAL',W/2,150);

    // "You are invited to access"
    ctx.font='22px system-ui,-apple-system,sans-serif';
    ctx.fillStyle='#94a3b8';
    ctx.textAlign='center';
    ctx.fillText('You are invited to access',W/2,280);

    // Client name (gold)
    ctx.font='bold 44px system-ui,-apple-system,sans-serif';
    ctx.fillStyle='#f59e0b';
    ctx.fillText(name,W/2,340);

    // Divider line
    const grad2=ctx.createLinearGradient(W/2-120,0,W/2+120,0);
    grad2.addColorStop(0,'#2563eb');grad2.addColorStop(1,'#3b82f6');
    ctx.strokeStyle=grad2;ctx.lineWidth=6;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(W/2-120,380);ctx.lineTo(W/2+120,380);ctx.stroke();

    // QR frame background
    ctx.fillStyle='#ffffff';
    ctx.strokeStyle='#e2e8f0';ctx.lineWidth=4;
    roundRect(W/2-160,420,320,320,32);ctx.fill();ctx.stroke();

    // QR glow shadow
    ctx.save();
    ctx.shadowColor='rgba(37,99,235,0.15)';
    ctx.shadowBlur=40;
    ctx.fillStyle='#ffffff';
    roundRect(W/2-160,420,320,320,32);ctx.fill();
    ctx.restore();

    // Draw QR code
    if(qrImg){
      ctx.drawImage(qrImg,W/2-120,460,240,240);
    }else{
      ctx.fillStyle='#999';
      ctx.font='18px monospace';
      ctx.fillText('QR unavailable',W/2,590);
    }

    // URL box (dashed border)
    ctx.fillStyle='#f8fafc';
    ctx.strokeStyle='#cbd5e1';ctx.lineWidth=3;
    ctx.setLineDash([12,8]);
    roundRect(60,790,W-120,90,20);ctx.fill();ctx.stroke();
    ctx.setLineDash([]);

    // URL text
    ctx.fillStyle='#2563eb';
    ctx.font='18px monospace';
    // Wrap URL if too long
    const maxUrlW=W-160;
    let displayUrl=url;
    if(ctx.measureText(url).width>maxUrlW){
      let len=url.length;
      while(ctx.measureText(url.substring(0,len)+'...').width>maxUrlW&&len>10)len--;
      displayUrl=url.substring(0,len)+'...';
    }
    ctx.fillText(displayUrl,W/2,845);

    // Hint text
    ctx.fillStyle='#94a3b8';
    ctx.font='22px system-ui,-apple-system,sans-serif';
    ctx.fillText('Scan with your phone camera',W/2,940);

    // Company footer
    ctx.fillStyle='#cbd5e1';
    ctx.font='18px system-ui,-apple-system,sans-serif';
    ctx.letterSpacing='2px';
    ctx.fillText(`${S.coName||'DeepFlow'} — Secure Client Portal`,W/2,1020);

    // Download
    const link=document.createElement('a');
    link.download=`${name.replace(/[^a-z0-9]/gi,'_')}_Portal_Card.png`;
    link.href=canvas.toDataURL('image/png');
    link.click();
    toast('Card PNG downloaded','success');
  }catch(e){
    console.error('[DeepFlow] Card download failed:',e);
    toast('Card generation failed: '+e.message,'error');
  }
}

/* ════════════════════════════════════════
   P&L DASHBOARD — Company Finance
   ════════════════════════════════════════ */

function _getPLPeriodDates(period){
  const now = new Date();
  const today = now.toISOString().slice(0,10);
  let start, end;
  switch(period){
    case 'this_month': start=today.slice(0,7)+'-01'; end=today; break;
    case 'last_month': {const d=new Date(now.getFullYear(),now.getMonth()-1,1); start=d.toISOString().slice(0,7)+'-01'; const e=new Date(now.getFullYear(),now.getMonth(),0); end=e.toISOString().slice(0,10);} break;
    case 'this_quarter': {const q=Math.floor(now.getMonth()/3); start=new Date(now.getFullYear(),q*3,1).toISOString().slice(0,10); end=today;} break;
    case 'last_quarter': {const q=Math.floor(now.getMonth()/3)-1; const y=q<0?now.getFullYear()-1:now.getFullYear(); const aq=q<0?q+4:q; start=new Date(y,aq*3,1).toISOString().slice(0,10); end=new Date(y,aq*3+3,0).toISOString().slice(0,10);} break;
    case 'this_year': start=now.getFullYear()+'-01-01'; end=today; break;
    case 'last_year': {const ly=now.getFullYear()-1; start=ly+'-01-01'; end=ly+'-12-31';} break;
    default: start='2020-01-01'; end=today;
  }
  return {start, end};
}

function openPLDashboard(){
  let ov=document.getElementById('pl-overlay');
  if(ov) ov.remove();
  ov=document.createElement('div');
  ov.id='pl-overlay';
  ov.className='pl-overlay';
  ov.innerHTML=`<div class="pl-hd">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="btn btn-ghost" onclick="closePLDashboard()">&larr; Back</button>
      <h2>&#128202; Company Finance &amp; P&amp;L</h2>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <select id="pl-period" class="sel" onchange="renderPLDashboard()">
        <option value="this_month">This Month</option>
        <option value="last_month">Last Month</option>
        <option value="this_quarter">This Quarter</option>
        <option value="last_quarter">Last Quarter</option>
        <option value="this_year">This Year</option>
        <option value="last_year">Last Year</option>
        <option value="all">All Time</option>
      </select>
      <button class="btn btn-wa" onclick="exportPLCSV()">&#11015; CSV</button>
    </div>
  </div>
  <div class="pl-tabs">
    <div class="pl-tab active" onclick="_switchPLTab(this,'pl-overview')">Overview</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-cashflow')">Cash Flow</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-clients')">Top Clients</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-jobtypes')">Job Types</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-vat')">VAT</div>
    <div class="pl-tab" onclick="_switchPLTab(this,'pl-reminders')">Reminders</div>
  </div>
  <div class="pl-body" id="pl-body">
    <div id="pl-overview" class="pl-tab-section active"></div>
    <div id="pl-cashflow" class="pl-tab-section"></div>
    <div id="pl-clients" class="pl-tab-section"></div>
    <div id="pl-jobtypes" class="pl-tab-section"></div>
    <div id="pl-vat" class="pl-tab-section"></div>
    <div id="pl-reminders" class="pl-tab-section"></div>
  </div>`;
  document.body.appendChild(ov);
  renderPLDashboard();
}
function closePLDashboard(){ const el=document.getElementById('pl-overlay'); if(el) el.remove(); }
function _switchPLTab(tabEl, sectionId){
  document.querySelectorAll('.pl-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.pl-tab-section').forEach(s=>s.classList.remove('active'));
  tabEl.classList.add('active');
  const sec=document.getElementById(sectionId);
  if(sec) sec.classList.add('active');
}

async function renderPLDashboard(){
  const period = document.getElementById('pl-period')?.value || 'this_month';
  const {start, end} = _getPLPeriodDates(period);

  const [jobs, invs, exps, payments] = await Promise.all([
    dAll('jobs'), dAll('invoices'), dAll('expenses'), dAll('payments')
  ]);

  const pJobs = jobs.filter(j => j.date >= start && j.date <= end);
  const pInvs = invs.filter(i => i.date >= start && i.date <= end);
  const pExps = exps.filter(e => e.date >= start && e.date <= end);

  _renderPLOverview(pJobs, pInvs, pExps, payments, start, end);
  _renderPLCashFlow(jobs, invs, exps, payments, start, end);
  _renderPLTopClients(jobs, invs, start, end);
  _renderPLJobTypes(pJobs);
  _renderPLVAT(invs, exps, start, end);
  _renderPLReminders(invs);
}

/* ── Overview: P&L Summary ── */
function _renderPLOverview(pJobs, pInvs, pExps, payments, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Revenue from paid invoices
  const paidInvs = pInvs.filter(i => i.status === 'Paid');
  const paidRev = paidInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);
  const pendInvs = pInvs.filter(i => i.status !== 'Paid');
  const pendRev = pendInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);
  const totalRev = paidRev + pendRev;

  // Expense breakdown by category
  const catMap = {};
  pExps.forEach(e => { const c=e.category||'Other'; catMap[c]=(catMap[c]||0)+(+(e.cost||0)); });
  const totalExp = pExps.reduce((s,e) => s+(+(e.cost||0)), 0);

  // Engineer wages from jobs — use each job's actually-logged hours for
  // hourly-rate engineers; only fall back to an estimate if none was
  // logged. (Previously this added the raw hourly rate once per job with
  // no hours multiplier at all, effectively treating it as a flat rate.)
  const WAGE_FALLBACK_HOURS=4;
  let totalWages = 0;
  pJobs.forEach(j => {
    if(j.engineer && S.engineers){
      const eng = S.engineers.find(e => e.name === j.engineer);
      if(eng && eng.dayRate) totalWages += +eng.dayRate;
      else if(eng && eng.rate) totalWages += +eng.rate * (Number(j.hours)||WAGE_FALLBACK_HOURS);
    }
  });

  const totalCosts = totalWages + totalExp;
  const netProfit = totalRev - totalCosts;

  document.getElementById('pl-overview').innerHTML = `
    <div class="pl-kpi-grid">
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--acc)">${fmt(paidRev)}</div>
        <div class="pl-kpi-lbl">Revenue (Paid)</div>
        <div class="pl-kpi-sub">${paidInvs.length} paid invoices</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--red)">${fmt(totalWages)}</div>
        <div class="pl-kpi-lbl">Engineer Wages</div>
        <div class="pl-kpi-sub">${pJobs.filter(j=>j.engineer).length} assigned jobs</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--orange)">${fmt(totalExp)}</div>
        <div class="pl-kpi-lbl">Expenses</div>
        <div class="pl-kpi-sub">${pExps.length} expense entries</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val ${netProfit>=0?'pl-positive':'pl-negative'}">${fmt(netProfit)}</div>
        <div class="pl-kpi-lbl">Net Profit</div>
        <div class="pl-kpi-sub">${((totalRev>0?(netProfit/totalRev)*100:0)).toFixed(1)}% margin</div>
      </div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128176; Revenue Breakdown</div>
      <div class="pl-row"><span class="pl-row-label">Invoice Revenue (Paid)</span><span class="pl-row-val pl-positive">${fmt(paidRev)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Invoice Revenue (Pending)</span><span class="pl-row-val" style="color:var(--yellow)">${fmt(pendRev)}</span></div>
      <div class="pl-total-row"><span>Total Revenue</span><span>${fmt(totalRev)}</span></div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128178; Cost Breakdown</div>
      <div class="pl-row"><span class="pl-row-label">Engineer Wages</span><span class="pl-row-val pl-negative">${fmt(totalWages)}</span></div>
      ${Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([cat,amt])=>
        `<div class="pl-row"><span class="pl-row-label">${cat}</span><span class="pl-row-val pl-negative">${fmt(amt)}</span></div>`
      ).join('')}
      <div class="pl-total-row"><span>Total Costs</span><span class="pl-negative">${fmt(totalCosts)}</span></div>
    </div>
    <div class="pl-section" style="text-align:center;padding:28px">
      <div style="font-size:13px;color:var(--txt3);margin-bottom:8px">NET PROFIT</div>
      <div style="font-family:var(--fh);font-size:42px;font-weight:900;${netProfit>=0?'color:#22c55e':'color:var(--red)'}">${fmt(netProfit)}</div>
      <div style="font-size:12px;color:var(--txt2);margin-top:6px">${start} &rarr; ${end}</div>
    </div>`;
}

/* ── Cash Flow Forecast ── */
function _renderPLCashFlow(jobs, invs, exps, payments, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
  const today = TODAY();

  // Incoming: pending invoices + uninvoiced completed jobs
  const pendingInvs = invs.filter(i => i.status !== 'Paid');
  const pendingIncoming = pendingInvs.reduce((s,i) => { const t=calcInvTotal(i); return s+t.grand; }, 0);

  const completedJobs = jobs.filter(j => j.status === STATUS.COMPLETED && !j.invoiceId);
  const jobIncoming = completedJobs.reduce((s,j) => s+(+(j.price||0)), 0);

  const totalIncoming = pendingIncoming + jobIncoming;

  // Outgoing: known recurring costs (last 30 days avg, projected forward 30)
  const last30 = new Date(); last30.setDate(last30.getDate()-30);
  const recentExps = exps.filter(e => e.date >= last30.toISOString().slice(0,10));
  const monthlyExpAvg = recentExps.reduce((s,e) => s+(+(e.cost||0)), 0);

  // Wages for jobs in the next 30 days
  const next30 = new Date(); next30.setDate(next30.getDate()+30);
  const next30str = next30.toISOString().slice(0,10);
  const upcomingJobs = jobs.filter(j => j.date >= today && j.date <= next30str);
  let upcomingWages = 0;
  upcomingJobs.forEach(j => {
    if(j.engineer && S.engineers){
      const eng = S.engineers.find(e => e.name === j.engineer);
      if(eng && eng.dayRate) upcomingWages += +eng.dayRate;
      else if(eng && eng.rate) upcomingWages += +eng.rate;
    }
  });

  const totalOutgoing = monthlyExpAvg + upcomingWages;
  const netPosition = totalIncoming - totalOutgoing;

  let riskColor = '#22c55e', riskLabel = 'Healthy';
  if(netPosition < 0) { riskColor = 'var(--red)'; riskLabel = 'At Risk'; }
  else if(netPosition < totalOutgoing * 0.2) { riskColor = 'var(--yellow)'; riskLabel = 'Tight'; }

  document.getElementById('pl-cashflow').innerHTML = `
    <div class="pl-kpi-grid">
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--green)">${fmt(totalIncoming)}</div>
        <div class="pl-kpi-lbl">Expected Incoming</div>
        <div class="pl-kpi-sub">${pendingInvs.length} pending inv + ${completedJobs.length} jobs</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:var(--red)">${fmt(totalOutgoing)}</div>
        <div class="pl-kpi-lbl">Expected Outgoing</div>
        <div class="pl-kpi-sub">Next 30 days projection</div>
      </div>
      <div class="pl-kpi">
        <div class="pl-kpi-val" style="color:${riskColor}">${fmt(netPosition)}</div>
        <div class="pl-kpi-lbl">Net Position (30d)</div>
        <div class="pl-kpi-sub">${riskLabel}</div>
      </div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128181; Incoming Cash</div>
      <div class="pl-row"><span class="pl-row-label">Pending Invoices (${pendingInvs.length})</span><span class="pl-row-val pl-positive">${fmt(pendingIncoming)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Completed Jobs Not Invoiced (${completedJobs.length})</span><span class="pl-row-val pl-positive">${fmt(jobIncoming)}</span></div>
      <div class="pl-total-row"><span>Total Incoming</span><span class="pl-positive">${fmt(totalIncoming)}</span></div>
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128179; Outgoing Cash</div>
      <div class="pl-row"><span class="pl-row-label">Monthly Expenses (30d avg)</span><span class="pl-row-val pl-negative">${fmt(monthlyExpAvg)}</span></div>
      <div class="pl-row"><span class="pl-row-label">Projected Wages (${upcomingJobs.length} jobs)</span><span class="pl-row-val pl-negative">${fmt(upcomingWages)}</span></div>
      <div class="pl-total-row"><span>Total Outgoing</span><span class="pl-negative">${fmt(totalOutgoing)}</span></div>
    </div>`;
}

/* ── Top Clients ── */
function _renderPLTopClients(jobs, invs, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Build client map from invoices in period
  const clientMap = {};
  invs.filter(i => i.date >= start && i.date <= end).forEach(i => {
    const name = i.clientName || i.client || 'Unknown';
    if(!clientMap[name]) clientMap[name] = {name, revenue:0, outstanding:0, jobs:0, invs:0};
    const t = calcInvTotal(i);
    clientMap[name].revenue += t.grand;
    clientMap[name].invs++;
    if(i.status !== 'Paid') clientMap[name].outstanding += t.grand;
  });

  // Also count jobs linked to clients
  jobs.filter(j => j.date >= start && j.date <= end).forEach(j => {
    const name = j.clientName || j.client || j.landlordName || 'Unknown';
    if(!clientMap[name]) clientMap[name] = {name, revenue:0, outstanding:0, jobs:0, invs:0};
    clientMap[name].jobs++;
  });

  const sorted = Object.values(clientMap).sort((a,b) => b.revenue - a.revenue).slice(0, 20);
  const medals = ['&#129351;','&#129352;','&#129353;'];
  const rankColors = ['rgba(240,192,48,.2)', 'rgba(148,163,184,.2)', 'rgba(245,122,35,.15)'];

  document.getElementById('pl-clients').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#127941; Top Clients by Revenue</div>
      ${sorted.length === 0 ? '<div style="text-align:center;color:var(--txt3);padding:30px">No client data for this period</div>' :
        sorted.map((c,idx) => `
        <div class="pl-client-row">
          <div class="pl-client-rank" style="background:${idx<3?rankColors[idx]:'var(--s2)'};color:${idx<3?'var(--txt)':'var(--txt3)'}">${idx<3?medals[idx]:idx+1}</div>
          <div class="pl-client-info">
            <div class="pl-client-name">${escHtml(c.name)}</div>
            <div class="pl-client-meta">${c.jobs} jobs &bull; ${c.invs} invoices</div>
          </div>
          <div class="pl-client-amt" style="color:var(--acc)">${fmt(c.revenue)}</div>
          ${c.outstanding>0?`<div class="pl-client-amt pl-negative">${fmt(c.outstanding)} due</div>`:''}
        </div>
      `).join('')}
    </div>`;
}

/* ── Job Types Breakdown ── */
function _renderPLJobTypes(pJobs){
  const typeMap = {};
  pJobs.forEach(j => {
    const t = j.type || 'Other';
    if(!typeMap[t]) typeMap[t] = {count:0, revenue:0};
    typeMap[t].count++;
    typeMap[t].revenue += +(j.price||0);
  });

  const types = Object.entries(typeMap).sort((a,b) => b[1].count - a[1].count);
  const maxCount = types.length ? types[0][1].count : 1;
  const colors = ['var(--acc)','var(--green)','var(--blue)','var(--purple)','var(--orange)','var(--red)','var(--txt3)'];
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  document.getElementById('pl-jobtypes').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#128295; Job Type Breakdown</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px">
        ${types.map(([t,d],i) => `
          <div class="pl-kpi" style="text-align:center">
            <div class="pl-kpi-val" style="color:${colors[i%colors.length]}">${d.count}</div>
            <div class="pl-kpi-lbl">${escHtml(t)}</div>
            <div class="pl-kpi-sub">${fmt(d.revenue)} revenue</div>
          </div>
        `).join('')}
        ${types.length===0?'<div style="text-align:center;color:var(--txt3);padding:20px;grid-column:1/-1">No job data for this period</div>':''}
      </div>
      <div style="margin-top:8px">
        ${types.map(([t,d],i) => {
          const pct = (d.count/maxCount*100).toFixed(0);
          return `<div class="pl-chart-row">
            <span class="pl-chart-label">${escHtml(t)}</span>
            <div style="flex:1;background:var(--border);border-radius:6px;overflow:hidden;height:18px">
              <div class="pl-chart-bar" style="width:${pct}%;background:${colors[i%colors.length]}"></div>
            </div>
            <span class="pl-chart-val">${d.count}</span>
            <span class="pl-chart-val" style="color:${colors[i%colors.length]}">${fmt(d.revenue)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── VAT Quarterly Summary ── */
function _renderPLVAT(invs, exps, start, end){
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
  const vr = getVatRate();

  // Group invoices by quarter
  const qMap = {};
  invs.forEach(i => {
    if(!i.date) return;
    const d = new Date(i.date);
    const q = Math.floor(d.getMonth()/3)+1;
    const key = `Q${q} ${d.getFullYear()}`;
    if(!qMap[key]) qMap[key] = {label:key,collected:0,paid:0,count:0};
    const t = calcInvTotal(i);
    qMap[key].collected += t.vat;
    qMap[key].count++;
  });

  // Input VAT (estimate): there's no per-expense VAT field recorded, so
  // this assumes expense costs are VAT-inclusive at the standard rate and
  // back-calculates the VAT portion — necessarily an estimate (the UI
  // already labels this line "Input est."), not a figure from real
  // supplier invoices. Previously this was always exactly £0 because
  // nothing populated it at all, despite "Net VAT Due" implying it had
  // been accounted for.
  (exps||[]).forEach(e => {
    if(!e.date || vr<=0) return;
    const d = new Date(e.date);
    const q = Math.floor(d.getMonth()/3)+1;
    const key = `Q${q} ${d.getFullYear()}`;
    if(!qMap[key]) qMap[key] = {label:key,collected:0,paid:0,count:0};
    qMap[key].paid += Number(e.cost||0)*vr/(100+vr);
  });

  // Sort quarters reverse chronologically
  const quarters = Object.values(qMap).sort((a,b) => {
    const parse = s => { const m=s.match(/Q(\d) (\d{4})/); return m?[parseInt(m[2]),parseInt(m[1])]:[0,0]; };
    const [y1,q1] = parse(a.label); const [y2,q2] = parse(b.label);
    return y2-y1 || q2-q1;
  });

  document.getElementById('pl-vat').innerHTML = `
    <div class="pl-section">
      <div class="pl-section-hd">&#128179; VAT Summary</div>
      ${quarters.length===0?'<div style="text-align:center;color:var(--txt3);padding:30px">No invoice data available</div>':''}
      ${quarters.map(q => `
        <div class="pl-vat-q">
          <div class="pl-vat-q-hd">${q.label} <span style="font-size:11px;color:var(--txt3);font-weight:500">(${q.count} invoices)</span></div>
          <div class="pl-row"><span class="pl-row-label">VAT Collected (Output)</span><span class="pl-row-val" style="color:var(--green)">${fmt(q.collected)}</span></div>
          <div class="pl-row"><span class="pl-row-label">VAT Paid (Input est.)</span><span class="pl-row-val pl-negative">${fmt(q.paid)}</span></div>
          <div class="pl-total-row"><span>Net VAT Due</span><span style="color:${q.collected-q.paid>=0?'var(--acc)':'var(--red)'}">${fmt(q.collected-q.paid)}</span></div>
        </div>
      `).join('')}
    </div>
    <div class="pl-section">
      <div class="pl-section-hd">&#128227; VAT Filing Reminders</div>
      <div style="font-size:12px;color:var(--txt2);line-height:1.8">
        <p>VAT returns are due <strong>1 month and 7 days</strong> after the quarter end.</p>
        <p style="margin-top:6px"><strong>Current quarter:</strong> ${(()=>{const n=new Date();const q=Math.floor(n.getMonth()/3)+1;return `Q${q} ${n.getFullYear()}`;})()}</p>
        <p><strong>Next filing deadline:</strong> ${(()=>{const n=new Date();const q=Math.floor(n.getMonth()/3);const end=new Date(n.getFullYear(),(q+1)*3,0);const dl=new Date(end);dl.setDate(dl.getDate()+37);return dl.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});})()}</p>
      </div>
    </div>`;
}

/* ── Overdue Reminders ── */
function _renderPLReminders(invs){
  const today = new Date(TODAY());
  const fmt = n => (n||0).toLocaleString('en-GB',{style:'currency',currency:'GBP'});

  // Find overdue invoices (status not Paid, past a reasonable due date)
  const overdue = invs.filter(i => {
    if(i.status === 'Paid' || i.status === 'Draft') return false;
    const invDate = new Date(i.date||i.created_at||TODAY());
    const daysOld = Math.floor((today - invDate)/(864e5));
    return daysOld > 7; // Overdue if older than 7 days
  }).map(i => {
    const invDate = new Date(i.date||i.created_at||TODAY());
    const daysOld = Math.floor((today - invDate)/(864e5));
    const t = calcInvTotal(i);
    let statusColor = '#f59e0b'; // amber day 7
    if(daysOld >= 30) statusColor = '#dc2626'; // red day 30
    else if(daysOld >= 14) statusColor = '#f97316'; // orange day 14
    return {...i, daysOld, total: t.grand, statusColor};
  }).sort((a,b) => b.daysOld - a.daysOld);

  const autoReminders = JSON.parse(localStorage.getItem('pl_auto_reminders')||'false');

  document.getElementById('pl-reminders').innerHTML = `
    <div class="pl-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="pl-section-hd" style="margin:0">&#9200; Overdue Invoice Reminders</div>
        <label class="fcheck" style="margin:0;font-size:12px">
          <input type="checkbox" ${autoReminders?'checked':''} onchange="localStorage.setItem('pl_auto_reminders',this.checked);toast('Auto-reminders '+(this.checked?'enabled':'disabled'),'info')">
          Auto-remind at Day 7, 14, 30
        </label>
      </div>
      ${overdue.length===0?'<div style="text-align:center;color:var(--txt3);padding:30px">No overdue invoices &mdash; great job!</div>'
        :`<div style="font-size:11px;color:var(--txt3);margin-bottom:10px">${overdue.length} overdue invoice(s) found</div>`
      }
      ${overdue.map(inv => `
        <div class="pl-reminder-row">
          <div class="pl-reminder-status" style="background:${inv.statusColor}"></div>
          <div class="pl-reminder-info">
            <div style="font-weight:700;font-size:13px">${escHtml(inv.invoiceNumber||inv.number||'INV-?')}</div>
            <div style="font-size:11px;color:var(--txt2)">${escHtml(inv.clientName||inv.client||'Unknown')} &bull; ${fmt(inv.total)}</div>
            <div style="font-size:10px;color:var(--txt3)">${inv.date||'No date'} &bull; <span style="color:${inv.statusColor};font-weight:700">${inv.daysOld} days overdue</span></div>
          </div>
          <div class="pl-reminder-action">
            <button class="btn btn-wa btn-sm" onclick="_sendPLReminder('${(inv.invoiceNumber||inv.number||'').replace(/'/g,"\\'")}','${(inv.clientName||inv.client||'').replace(/'/g,"\\'")}',${inv.total},${inv.daysOld})">&#128172; Send</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function _sendPLReminder(invNum, clientName, amount, daysOld){
  const msg = `Hi ${clientName},\\n\\nThis is a friendly reminder that invoice *${invNum}* for *${amount.toLocaleString('en-GB',{style:'currency',currency:'GBP'})}* is now *${daysOld} days overdue*.\\n\\nPlease could you arrange payment at your earliest convenience?\\n\\nIf you've already paid, please disregard this message.\\n\\nThanks!`;
  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

/* ── CSV Exports ── */
function exportPLCSV(){
  const headers = ['Date','Invoice Number','Client','Description','Subtotal','VAT','Total','Status','Due Date'];
  dAll('invoices').then(invs => {
    const rows = invs.map(i => {
      const t = calcInvTotal(i);
      const desc = (i.items||[]).map(it => it.description).filter(Boolean).join('; ');
      return [i.date||'', i.invoiceNumber||i.number||'', escCsv(i.clientName||i.client||''), escCsv(desc), t.subtotal.toFixed(2), t.vat.toFixed(2), t.grand.toFixed(2), i.status||'', i.dueDate||''];
    });
    _downloadCsv('pl_export.csv', [headers, ...rows]);
    toast('P&L CSV exported','success');
  });
}

function exportXeroCSV(){
  // Xero format: ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType
  dAll('invoices').then(invs => {
    const rows = [];
    invs.forEach(i => {
      const items = i.items||[];
      items.forEach((it, idx) => {
        rows.push([
          escCsv(i.clientName||i.client||'Unknown'),
          i.invoiceNumber||i.number||'',
          i.reference||'',
          i.date||'',
          i.dueDate||'',
          escCsv(it.description||''),
          it.quantity||1,
          (it.price||it.amount||0).toFixed(2),
          it.accountCode||'200',
          it.taxType||'20% VAT'
        ]);
      });
    });
    _downloadCsv('xero_import.csv', [
      ['ContactName','InvoiceNumber','Reference','InvoiceDate','DueDate','Description','Quantity','UnitAmount','AccountCode','TaxType'],
      ...rows
    ]);
    toast('Xero CSV exported','success');
  });
}

function exportQuickBooksCSV(){
  // QuickBooks format: Invoice No,Customer,Invoice Date,Due Date,Item,Description,Qty,Rate,Amount,Service Date
  dAll('invoices').then(invs => {
    const rows = [];
    invs.forEach(i => {
      const items = i.items||[];
      items.forEach(it => {
        rows.push([
          i.invoiceNumber||i.number||'',
          escCsv(i.clientName||i.client||'Unknown'),
          i.date||'',
          i.dueDate||'',
          escCsv(it.description||''),
          escCsv(it.description||''),
          it.quantity||1,
          (it.price||it.amount||0).toFixed(2),
          ((it.quantity||1)*(it.price||it.amount||0)).toFixed(2),
          i.date||''
        ]);
      });
    });
    _downloadCsv('quickbooks_import.csv', [
      ['Invoice No','Customer','Invoice Date','Due Date','Item','Description','Qty','Rate','Amount','Service Date'],
      ...rows
    ]);
    toast('QuickBooks CSV exported','success');
  });
}

function _downloadCsv(filename, rows){
  const csv = rows.map(r => r.map(c => {
    const s = String(c==null?'':c);
    if(s.includes(',')||s.includes('"')||s.includes('\n')) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  }).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function escCsv(str){ return String(str||'').replace(/"/g,'""'); }



// ── Window exposure ──────────────────────────────────────────────────────────
// As a real ES module (Vite), top-level functions are module-scoped, not
// global — but the HTML markup calls hundreds of them via inline onclick="..."
// (and onchange/oninput/etc.) attributes, resolved by the browser against the
// global scope. This is the exhaustive list, extracted by grepping every
// on*="fn(" pattern in the original file and cross-checked against this
// file's actual top-level declarations (304 of 306 raw matches resolved this
// way; the other 2 were the literal word "if" inside a handler's own
// conditional logic — a grep false positive — and _openInvoiceFromJobSync,
// which the original code already assigns directly via
// `window._openInvoiceFromJobSync = function(...)` and so needs no entry
// here). Preserves exactly the global availability each already had.
Object.assign(window, {
  _addLiveItem, _copyJobDesc, _copyPortalLink, _editEngFromDeep, _emailPortalShare, _removeLiveItem, _renderEngDeepJobsList,
  _reqAcknowledge, _reqApproveEng, _reqCreateJob, _reqReject, _reqReopen, _reqSendReply, 
  _saveLiveItem, _sendPLReminder, _showReqDetail, _switchEngDeepTab, _switchPLTab, _updateLiveTotal, 
  _waPortalShare, addAccessRow, addCertTypeInline, addCreditItem, addEngRow, addExpiryToExistingCert, 
  addInvCustomText, addInvItem, addPortalContactRow, addTradeRow, applySavedView, applyThemeMode, 
  approvePortalReq, autoDetectCertTypes, autoGrow, bulkAssignEngineer, bulkCopyToDate, bulkDeleteCerts, bulkDeleteJobs,
  bulkDownloadPDFs, bulkMarkPaid, bulkNRToggle, bulkReschedule, bulkSetStatus, cancelCertForm, 
  certContactSugg, certFillContact, certPageNav, certSendIndivEmail, certSendIndivWA, changeUserRole, 
  checkCronSetup, checkDuplicatePhone, checkSecurityStatus, clearAllData, clearCertFilters, clearJobForm, 
  clearNotifs, clearSel, clearStore, closeCtx, closeModal, closePLDashboard, 
  closePortalInviteModal, confirmKS, convertProformaToInvoice, copyCremMsg, copyJobToNextDay, copySql, 
  copyText, copyWAText, copyWaTemplate, createAllTables, createDraftsForCompleted, createInvFromJob, 
  createJobFromPortalReq, createProforma, createRecurringInv, createRenewalJob, ctxCopyAddr, ctypeToggle, cvLoadClient,
  cvSearch, cvSwitchTab, debounceRenderCmd, debounceRenderJobs, deleteAttachment, deleteComment, deleteCurrentAgency,
  deleteCurrentAgent, deleteCurrentExpense, deleteCurrentJob, deleteCurrentPerson, deleteCurrentProp, deleteDuplicateInvoices,
  deleteInv, deleteJobById, deletePortalContact, deleteSavedView, deleteUser, dismissInvBanner, doLogin,
  doLogout, doResetPassword, downloadCertTemplate, downloadEngPayslip, downloadInvPDF, downloadInvPDFById, downloadPortalInviteCard,
  dupUpdateName, dupUseExisting, duplicateInv, duplicateJob, editCertRecord, executeMerge, exportAllCSV,
  exportAuditLog, exportBackup, exportCertCSV, exportCertPDF, exportEngReport, exportEngReportPDF, 
  exportExpensesCSV, exportInvsCSV, exportMasterXLSX, exportPLCSV, exportPropsCSV, exportReportPDF, 
  exportTSCSV, fillCreditNote, fillFromMatch, filterCerts, fuzzyAddr, generateBulkReminder, 
  handleAccess, handleLogoUpload, handleNotifClick, handlePriDotClick, hidePropPopup, importBackup, importCertCSV,
  invClientSelected, invNavSelect, jCalPickDate, jPickDate, jcalShiftMonth, kanbanDragOver, 
  kanbanDragStart, kanbanDrop, loadEarlierJobs, loadEngPerms, loadEngineerLocations, loadStorageDashboard, 
  loadStorageStats, loadTeam, markInvPaid, markInvSent, markInvUnpaid, matchDir, 
  mergeJobsInvoice, nav, onMapViewChange, oneClickBackup, openAgencyModal, openAgentModal, 
  openBroadcast, openCertForm, openCmd, openCreditNoteModal, openDisposableModal, openEngDeepReport, 
  openEngDir, openExpenseModal, openImportModal, openInvSendModal, openJobForInvoice, openJobModal, openJobModalByNum, openMergeModal,
  openOvertimeModal, openPLDashboard, openPaymentModal, openPersonModal, openPersonModalFor, openPersonWA,
  openPropModal, openQuickEngModal, openStandaloneProformaModal, openWhatsApp, postComment, previewCertPdf,
  previewWaTemplate, printFilteredInvoices, printProforma, quickConfirm, quickEditPrice, quickEditTime, quickStatus,
  removeCertPdf, removeInvCustomText, renderAuditLog, renderCertStats, renderCertTable, renderClientPicker,
  renderDirSection, renderEngReport, renderExpenses, renderInvItems, renderInvList, renderJobs, renderMapPage,
  renderNotifPreview, renderPLDashboard, renderProps, renderReports, renderRequests, renderSettings, renderStmt,
  requestNotifPermission, resetColWidths, resetPortalPin, resolveMergeField, saveAgency, saveAgencyFromJob, 
  saveAgent, saveAgentFromJob, saveAndSendInv, saveCert, saveCertExpiry, saveCertForm, 
  saveCreditNote, saveDashNotes, saveDisposableInvoice, saveEngDefaults, saveExpense, saveInv, 
  saveJob, saveLandlordFromJob, saveNotifSettings, saveOvertimeLog, savePayment, savePerson, 
  saveProp, saveQuickEngineer, saveSettings, saveStandaloneProforma, searchJobForInvoice, selEngineer,
  selectAddr, selectAllVisibleJobs, sendAllOverdueWA, sendBroadcast, sendInvEmail, sendInvWA,
  showPortalInviteModal,
  sendLandlordComplete, sendLandlordWA, sendOverdueWA, sendTenantWA, sendToWA, setAccent, setCremMode, setFontSize,
  setInvFilter, setInvType, setInvView, setJRange, setJobsView, setPriFilter,
  setReqType, setSidebarWidth, setTheme, shiftDay, showAgeBucket, showAllEngJobs,
  showColMenu, showJobAudit, showPropertyCerts, showPropPopup, showWaPanel, skipCertExpiry, smartAutofill, stmtClearFilters,
  stmtQuickRange, stmtToggleAll, stmtToggleSel, switchAuditTab, switchCertTab, switchDirSection,
  switchSetTab, teamAdd, teamChangeRole, teamRevoke, testNotifWebhook, toggleAllCerts,
  toggleBulkSelectMode, toggleCalPane, toggleCertChip, toggleCol, toggleColPicker, toggleInvSync,
  toggleNotifPanel, toggleOTHours, toggleOnlinePanel, togglePersonSelect, togglePwVis, toggleSelRow, toggleSidebar, toggleTheme,
  toggleUnassignedView, toggleUserMenu, updateCertAddrSugg, updateEngPerm, updateLogo, updatePortalContact, updInvTotals,
  uploadCertPdf, viewInv, viewPropJobs, waEngineerAllJobs, waJobsSelected, waShowEng, 
  waSingleEngJob, waSingleJob, waSingleJobById, waTimesheetSummary, 
});
(function(){
  if('serviceWorker' in navigator){
    const swCode="const C='oe-v1773931106';\n// ── Install: cache the app shell ──\nself.addEventListener('install',e=>{\n  self.skipWaiting();\n  e.waitUntil(caches.open(C).then(c=>c.addAll([location.pathname])));\n});\n// ── Activate: wipe ALL old caches ──\nself.addEventListener('activate',e=>{\n  e.waitUntil(\n    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k))))\n    .then(()=>self.clients.claim())\n  );\n  // Tell all open tabs a new version is active\n  self.clients.matchAll({type:'window'}).then(wins=>wins.forEach(w=>w.postMessage({type:'SW_UPDATED'})));\n});\n// ── Fetch: NETWORK-FIRST for HTML, cache-first for everything else ──\nself.addEventListener('fetch',e=>{\n  if(e.request.method!=='GET')return;\n  const isHtml=e.request.destination==='document'||e.request.headers.get('accept')?.includes('text/html');\n  if(isHtml){\n    // Always try network first for the HTML file — gets latest version\n    e.respondWith(\n      fetch(e.request,{cache:'no-cache'}).then(r=>{\n        if(r.ok){const cc=r.clone();caches.open(C).then(c=>c.put(e.request,cc));}\n        return r;\n      }).catch(()=>caches.match(e.request))\n    );\n  }else{\n    // Assets: cache-first\n    e.respondWith(\n      caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{\n        if(r.ok){const cc=r.clone();caches.open(C).then(c=>c.put(e.request,cc));}\n        return r;\n      }))\n    );\n  }\n});";
    const blob=new Blob([swCode],{type:'text/javascript'});
    const swUrl=URL.createObjectURL(blob);
    navigator.serviceWorker.register(swUrl).then(reg=>{
      window._swReg=reg;
      setInterval(()=>reg.update(),30*60*1000);
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;if(!nw)return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed'&&navigator.serviceWorker.controller)_showUpdateBanner();
        });
      });
    }).catch(()=>{});
    navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='SW_UPDATED')_showUpdateBanner();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')navigator.serviceWorker.getRegistration().then(r=>r?.update());});
  }
  let _ip=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();_ip=e;const b=document.getElementById('btn-install-app');if(b)b.style.display='';});
  window.addEventListener('appinstalled',()=>{_ip=null;const b=document.getElementById('btn-install-app');if(b)b.style.display='none';});
  window._triggerInstall=async()=>{if(!_ip)return;_ip.prompt();const{outcome}=await _ip.userChoice;if(outcome==='accepted')_ip=null;};
})();

function _showUpdateBanner(){
  if(document.getElementById('_update-banner')) return;
  const b=document.createElement('div');
  b.id='_update-banner';
  b.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#111827;border-top:3px solid #4f8fff;padding:12px 16px;display:flex;align-items:center;gap:12px;font-family:system-ui,sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,.4)';
  b.innerHTML='<span style="font-size:22px">🔄</span><div style="flex:1"><div style="font-weight:700;font-size:13px;color:#fff">New version available</div><div style="font-size:11px;color:#9ca3af;margin-top:1px">Tap Update to get the latest version</div></div><button onclick="window.location.reload(true)" style="background:#4f8fff;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">⬆ Update Now</button><button onclick="this.closest(\'#_update-banner\').remove()" style="background:none;border:none;color:#6b7280;font-size:20px;cursor:pointer;padding:0 4px">✕</button>';
  document.body.appendChild(b);
  if(navigator.vibrate) navigator.vibrate([100,50,100]);
}

// ═══════════════════════════════════════════════════════════════════
// CLIENT CREDIT CHECK - 5 STAR RATING SYSTEM
// ═══════════════════════════════════════════════════════════════════
async function showClientCreditCheck(clientName){
  if(!clientName||!clientName.trim()){
    const p=document.getElementById('credit-check-panel');
    if(p)p.style.display='none';
    return;
  }
  try{
    const allInvs=await dAll('invoices');
    const clientInvs=allInvs.filter(inv=>(inv.clientName||inv.clientname||'').toLowerCase()===clientName.toLowerCase());
    if(clientInvs.length===0){
      document.getElementById('credit-check-panel').style.display='none';
      return;
    }
    
    // FIX BUG5: removed shadow calcInvTotal that applied VAT to ALL items regardless of item.vat flag.
    // The outer calcInvTotal (defined at line 7652) is correct — it respects per-item VAT flags.
    // Using it directly here so credit check totals match invoice totals shown everywhere else.
    
    const now=new Date();
    const unpaid=clientInvs.filter(inv=>(inv.status||'Draft')!=='Paid'&&(inv.status||'Draft')!==STATUS.CANCELLED);
    const unpaidAmount=unpaid.reduce((sum,inv)=>sum+calcInvTotal(inv).grand,0);
    const overdue=unpaid.filter(inv=>inv.dueDate&&new Date(inv.dueDate)<now);
    const paid=clientInvs.filter(inv=>(inv.status||'')==='Paid').sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
    
    // ═══ STAR CALCULATION - Based on Payment Behavior ═══
    let stars=5;
    
    // Deduct for significantly overdue invoices (time-based, not amount)
    const veryOverdue = overdue.filter(inv => {
      if(!inv.dueDate) return false;
      const daysPast = Math.floor((now - new Date(inv.dueDate)) / (1000*60*60*24));
      return daysPast > 60; // More than 60 days overdue
    });
    
    // Deduct for overdue COUNT and severity
    if(veryOverdue.length > 3) stars -= 3; // Chronic late payer
    else if(veryOverdue.length > 0) stars -= 2; // Some very late invoices
    else if(overdue.length > 3) stars -= 2; // Many overdue (but less than 60 days)
    else if(overdue.length > 0) stars -= 1; // Some overdue
    
    // Deduct for high unpaid amount RELATIVE to invoice count
    const avgInvoiceValue = clientInvs.length > 0 ? clientInvs.reduce((sum, inv) => sum + calcInvTotal(inv).grand, 0) / clientInvs.length : 0;
    if(unpaidAmount > avgInvoiceValue * 5) stars -= 2; // 5x average = problematic
    else if(unpaidAmount > avgInvoiceValue * 3) stars -= 1; // 3x average = concerning
    
    // Bonus: Give back star if paid invoices > unpaid (good history)
    if(paid.length > unpaid.length && paid.length > 3) stars += 1;
    
    stars=Math.max(1,Math.min(5,stars));
    
    // ═══ COLORS ═══
    const starColors={1:'#e05252',2:'#f59e0b',3:'#f0c030',4:'#a3e635',5:'#25d58e'};
    const starColor=starColors[stars];
    const riskLevel=stars<=2?'HIGH RISK':stars==3?'MEDIUM RISK':'LOW RISK';
    const riskColor=starColors[stars<=2?1:stars==3?3:5];
    
    // ═══ RENDER STARS ═══
    let starsHTML='';
    for(let i=1;i<=5;i++)starsHTML+=i<=stars?`<span style="color:${starColor}">★</span>`:'<span style="color:#d1d5db">☆</span>';
    
    // ═══ POPULATE PANEL ═══
    const panel=document.getElementById('credit-check-panel');
    panel.style.display='block';
    panel.style.borderColor=starColor;
    panel.style.background=`linear-gradient(to bottom, ${starColor}08, white)`;
    
    document.getElementById('credit-rating-stars').innerHTML=starsHTML;
    document.getElementById('credit-rating-text').innerHTML=`<span style="color:${riskColor}">${stars}/5 STARS — ${riskLevel}</span>`;
    
    // ═══ STATS ═══
    const lastPmt=paid[0];
    const lastPmtDate=lastPmt?new Date(lastPmt.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Never';
    const lastPmtAmt=lastPmt?calcInvTotal(lastPmt).grand.toFixed(2):'0.00';
    const daysSinceLast=lastPmt?Math.floor((now-new Date(lastPmt.date))/(1000*60*60*24)):9999;
    
        document.getElementById('credit-stats').innerHTML=`<div><span style=\"color:var(--txt3);font-size:10px;text-transform:uppercase;font-weight:700\">Unpaid Amount</span><span style=\"font-weight:800;font-size:14px;color:\${riskColor}\">&pound;\${unpaidAmount.toLocaleString('en-GB',{style:'currency',currency:'GBP'})}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);\"><span>Overdue Invoices</span><span style=\"font-weight:700;color:var(--red)\">\${overdue.length}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);\"><span>Last Payment</span><span style=\"font-weight:700\">\${lastPmtDate}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);\"><span>Last Amount</span><span style=\"font-weight:700;color:var(--green)\">&pound;\${lastPmtAmt}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;\"><span>Days Since Last Payment</span><span style=\"font-weight:700;color:\${daysSinceLast>30?'var(--red)':'var(--green)'}\">\${daysSinceLast}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid var(--border);margin-top:4px;\"><span>Total Invoices</span><span style=\"font-weight:700\">\${clientInvs.length}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;\"><span>Paid</span><span style=\"font-weight:700;color:var(--green)\">\${paid.length}</span></div>
      <div style=\"display:flex;justify-content:space-between;padding:4px 0;\"><span>Unpaid</span><span style=\"font-weight:700;color:\${unpaid.length>0?'var(--red)':'var(--green)'}\">\${unpaid.length}</span></div>`;

    // Show payment history list
    const historyContainer = document.getElementById('credit-payment-history');
    if(historyContainer){
      const recentPayments = paid.slice(0, 5);
      historyContainer.innerHTML = recentPayments.length === 0 
        ? '<div style=\"color:var(--txt3);font-size:11px;text-align:center;padding:8px;\">No payment history</div>'
        : recentPayments.map(inv => {
            const t = calcInvTotal(inv);
            return '<div style=\"display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid var(--border);\"><span>' + (inv.date || 'No date') + '</span><span style=\"font-weight:700;color:var(--green)\">&pound;' + t.grand.toFixed(2) + '</span></div>';
          }).join('');
    }

  }catch(err){
    console.error('[CreditCheck] Error:', err);
  }
}

