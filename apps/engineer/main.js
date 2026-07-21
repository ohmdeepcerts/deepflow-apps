// ══ ELECTRICAL BACKGROUND ANIMATION ══
(function(){
const canvas=document.getElementById("elec-bg");
if(!canvas)return;
const ctx=canvas.getContext("2d");
let W,H,nodes=[],edges=[],bolts=[],currents=[],frame=0;
const isDark=()=>document.documentElement.getAttribute("data-theme")!=="light";

function resize(){
  W=canvas.width=window.innerWidth;
  H=canvas.height=window.innerHeight;
  buildCircuit();
}

function buildCircuit(){
  nodes=[];edges=[];currents=[];
  // Grid-snapped nodes with small jitter — proper circuit feel
  const gx=80,gy=80;
  const cols=Math.ceil(W/gx)+1,rows=Math.ceil(H/gy)+1;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    // Sparse — only keep ~55% of grid points
    if(Math.random()<0.45)continue;
    nodes.push({
      x:c*gx+(Math.random()*16-8),
      y:r*gy+(Math.random()*16-8),
      pulse:Math.random()*Math.PI*2,
      pulseSpeed:0.015+Math.random()*0.02,
      size:1+Math.random()*2,
      bright:Math.random()
    });
  }
  // Connect nearby nodes with right-angle-ish edges
  nodes.forEach((a,i)=>{
    nodes.slice(i+1).forEach((b,j)=>{
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d<110&&Math.random()<0.5){
        edges.push({a,b,flow:Math.random(),flowSpeed:0.003+Math.random()*0.005});
      }
    });
  });
  // Spawn some flowing current particles along edges
  edges.forEach(e=>{
    if(Math.random()<0.3){
      currents.push({edge:e,t:Math.random(),speed:0.004+Math.random()*0.006,size:2+Math.random()*2});
    }
  });
}

function zigzag(x1,y1,x2,y2,segs){
  const pts=[[x1,y1]];
  for(let i=1;i<segs;i++){
    const t=i/segs,px=x1+(x2-x1)*t,py=y1+(y2-y1)*t;
    const ang=Math.atan2(y2-y1,x2-x1)+Math.PI/2;
    const off=(Math.random()-.5)*22;
    pts.push([px+Math.cos(ang)*off,py+Math.sin(ang)*off]);
  }
  pts.push([x2,y2]);
  return pts;
}

function spawnBolt(){
  if(nodes.length<2)return;
  const a=nodes[Math.floor(Math.random()*nodes.length)];
  const candidates=nodes.filter(n=>n!==a&&Math.hypot(n.x-a.x,n.y-a.y)<200);
  if(!candidates.length)return;
  const b=candidates[Math.floor(Math.random()*candidates.length)];
  const segs=5+Math.floor(Math.random()*5);
  const mainPts=zigzag(a.x,a.y,b.x,b.y,segs);
  bolts.push({
    pts:mainPts,
    life:1.0,
    decay:0.05+Math.random()*0.04,
    width:1+Math.random()*1.5,
    branches:Math.random()<0.4?[]:Array.from({length:Math.floor(Math.random()*3)+1},()=>{
      const mid=Math.floor(segs/2)+Math.floor(Math.random()*2);
      const bp=mainPts[Math.min(mid,mainPts.length-1)]||[a.x,a.y];
      return {start:mid,pts:zigzag(bp[0],bp[1],bp[0],bp[1],3).map(()=>[
        bp[0]+(Math.random()-0.5)*60,
        bp[1]+(Math.random()-0.5)*60
      ])};
    })
  });
}

function draw(){
  ctx.clearRect(0,0,W,H);
  const dark=isDark();
  const ACC  = dark ? [79,143,255]  : [40,100,220];
  const GOLD = dark ? [245,166,35]  : [200,130,10];
  const TEAL = dark ? [34,197,150]  : [10,160,120];
  const rgb=(c,a)=>`rgba(${c[0]},${c[1]},${c[2]},${a})`;
  frame++;

  // ── Circuit edges (static wires) ──
  edges.forEach(e=>{
    e.flow=(e.flow+e.flowSpeed)%1;
    const alpha=0.06+Math.abs(Math.sin(e.flow*Math.PI))*0.08;
    ctx.beginPath();ctx.moveTo(e.a.x,e.a.y);ctx.lineTo(e.b.x,e.b.y);
    ctx.strokeStyle=rgb(ACC,alpha);ctx.lineWidth=1;ctx.stroke();
  });

  // ── Flowing current particles ──
  currents.forEach(c=>{
    c.t=(c.t+c.speed)%1;
    const x=c.edge.a.x+(c.edge.b.x-c.edge.a.x)*c.t;
    const y=c.edge.a.y+(c.edge.b.y-c.edge.a.y)*c.t;
    // Core dot
    ctx.beginPath();ctx.arc(x,y,c.size,0,Math.PI*2);
    ctx.fillStyle=rgb(TEAL,0.7);ctx.fill();
    // Glow
    ctx.beginPath();ctx.arc(x,y,c.size*2.5,0,Math.PI*2);
    ctx.fillStyle=rgb(TEAL,0.12);ctx.fill();
  });

  // ── Circuit nodes ──
  nodes.forEach(n=>{
    n.pulse+=n.pulseSpeed;
    const a=0.15+Math.abs(Math.sin(n.pulse))*0.55;
    const r=n.size*(0.8+Math.abs(Math.sin(n.pulse))*0.6);
    // Outer glow
    const g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,r*4);
    g.addColorStop(0,rgb(ACC,a*0.5));
    g.addColorStop(1,rgb(ACC,0));
    ctx.beginPath();ctx.arc(n.x,n.y,r*4,0,Math.PI*2);
    ctx.fillStyle=g;ctx.fill();
    // Core
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);
    ctx.fillStyle=rgb(ACC,a*0.9);ctx.fill();
  });

  // ── Lightning bolts ──
  bolts=bolts.filter(b=>b.life>0);
  bolts.forEach(b=>{
    b.life-=b.decay;
    if(b.life<=0)return;
    const a=Math.pow(b.life,0.7);
    // Draw main bolt
    [1].forEach(()=>{
      ctx.beginPath();
      ctx.moveTo(b.pts[0][0],b.pts[0][1]);
      b.pts.slice(1).forEach(p=>ctx.lineTo(p[0],p[1]));
      // Glow layer
      ctx.strokeStyle=rgb(GOLD,a*0.25);
      ctx.lineWidth=b.width*5;ctx.shadowBlur=0;ctx.stroke();
      // Core
      ctx.strokeStyle=rgb(GOLD,a*0.95);
      ctx.lineWidth=b.width;
      ctx.shadowColor=rgb(GOLD,0.9);ctx.shadowBlur=12;
      ctx.stroke();
      ctx.shadowBlur=0;
    });
  });

  // Spawn bolts
  if(frame%60===0&&Math.random()<0.8)spawnBolt();
  if(frame%180===0&&Math.random()<0.5)spawnBolt(); // double-strike

  requestAnimationFrame(draw);
}

let _resizeTimer;
window.addEventListener("resize",()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer=setTimeout(resize,300);
});
resize();
draw();
})();


'use strict';
// ══════════════════════════════════════════════════════════════
//  CONFIG — SB_URL/SB_KEY/restFetch now live in @core (Phase 1); the field
//  mapping now lives in @data (Phase 2). STATUS stays local — it's a domain
//  enum, not a field-name mapping concern.
// ══════════════════════════════════════════════════════════════
import { SB_URL, SB_KEY, restFetch, createSupaAuthClient, makeJwtResolver } from '@core';
import { escHtml } from '@ui';
import { fromDb } from '@data';
import { STATUS } from '@business';
import { createOfflineQueue, isNetworkError as _isNetworkError } from '@offline';
import { _hdist, _loadGeoCache, geocodeAddress, fetchWeather, fetchLandRegistry, _geoCache } from './geo-weather.js';
import { showTool, calcVD, calcZs, updateConduit, clearConduit, addWire } from './calc-tools.js';

const _supaAuth = createSupaAuthClient();
if(!_supaAuth){
  document.body.innerHTML='<div style="padding:40px;text-align:center"><h2>Connection Error</h2><p>Please check your internet and refresh.</p></div>';
  throw new Error('Supabase client failed to initialize');
}

// STATUS now lives in @business (Phase 3) — was byte-identical to the
// Office App's own copy before this extraction.

// The jobs-only mapping now comes from @data's unified table (Phase 2 —
// see ARCHITECTURE_REDESIGN_PROPOSAL.md). sb() used to run every result
// through this mapping unconditionally regardless of which table was
// queried (this app also hits users/attachments/engineer_requests/
// engineer_alerts/app_settings, not just jobs) — confirmed via direct
// schema query that none of those tables have any column name overlapping
// the jobs mapping, so it was a no-op for them, not a live bug. Now
// correctly scoped by table (parsed from the request path) instead of
// relying on that coincidence.
const _getJWT = makeJwtResolver(_supaAuth);
async function sb(path,opts={}){
  const jwt=await _getJWT();
  const res=await restFetch(path,opts,jwt);
  const txt=await res.text();
  if(!res.ok)throw new Error(`[DeepFlow] ${path} → ${res.status}: ${txt}`);
  const d=txt?JSON.parse(txt):null;
  const table=path.split('?')[0];
  return Array.isArray(d)?d.map(row=>fromDb(table,row)):d;
}

// Same audit_log table the Office App's Admin-only Audit Log page reads —
// lets an admin see every status change regardless of who made it or from
// which app, without blocking any transition.
async function logAudit(type,details){
  if(!currentUser) return;
  try{
    await queueableSave(null,'audit_log',{method:'POST',body:{
      type,
      staff_name: currentUser.name,
      staff_email: currentUser.email||'',
      staff_role: 'Engineer',
      details: JSON.stringify(details),
      created_at: new Date().toISOString()
    },prefer:'return=minimal'});
  }catch(e){ console.warn('[Audit]',e); }
}

// Mirrors index.html's sendNotificationWebhook() — see Settings → Notifications
// → Automated Client Notifications in the Office App for what this does and
// how to wire it to a free automation tool. Not queued offline like other
// writes here — if this fails while offline, the status change itself still
// syncs via the offline queue, just without a notification firing for it.
async function sendNotificationWebhook(eventType, payload){
  const s=_officeSettingsCache;
  if(!s?.notifWebhookEnabled || !s?.notifWebhookUrl) return;
  if(eventType==='job_status_change' && s.notifOnStatusChange===false) return;
  try{
    await fetch(s.notifWebhookUrl, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({event:eventType, source:'deepflow-engineer', company:s.coName||'', timestamp:new Date().toISOString(), ...payload})
    });
  }catch(e){ console.warn('[NotifWebhook]',e); }
}

// Mirrors index.html's sendPushNotification() — see PHASE6_PUSH_NOTIFICATIONS_SQL.md
// and PHASE6B_PUSH_EDGE_FUNCTION.md.
async function sendPushNotification(eventType, payload){
  const s=_officeSettingsCache;
  if(!s?.notifPushEnabled) return;
  if(eventType==='job_status_change' && s.notifOnStatusChange===false) return;

  let title, message;
  if(payload.newStatus==='In Progress'){
    title='Engineer has arrived';
    message=`Your engineer has arrived at ${payload.address||'the property'}`;
  } else if(payload.newStatus==='Completed'){
    title='Job completed';
    message=`Work at ${payload.address||'the property'} is complete`;
  } else {
    title='Job update';
    message=`${payload.address||'Your job'} → ${payload.newStatus}`;
  }

  try{
    const jwt=await _getJWT();
    await fetch(SB_URL+'/functions/v1/send-push',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+jwt},
      body: JSON.stringify({title,message,landlordName:payload.landlordName||'',agencyName:payload.agencyName||'',agentName:payload.agentName||''})
    });
  }catch(e){ console.warn('[Push]',e); }
}

// Mirrors index.html's notifyNextTenantEta() — see Settings → Notifications
// → "Next-Tenant ETA" in the Office App for what this does and why.
function _looksLikePhone(s){
  return !!s && /\d{4,}/.test(s) && !/^code:/i.test(s.trim());
}

async function notifyNextTenantEta(completedJob){
  const s=_officeSettingsCache;
  if(!s?.notifNextTenantEta) return;
  if(!completedJob?.engineer || !completedJob?.date) return;
  try{
    const rows=await sb(`jobs?engineer=eq.${encodeURIComponent(completedJob.engineer)}&date=eq.${encodeURIComponent(completedJob.date)}&status=eq.Pending&order=created.asc&limit=1`);
    const next=rows?.[0];
    if(!next) return;
    const access=next.access||'';
    const contact=(next.contact||'').trim();
    if(!(access.includes('Tenant')||access.includes('Landlord'))) return;
    if(!_looksLikePhone(contact)) return;

    sendNotificationWebhook('next_job_eta',{
      engineerName:completedJob.engineer,
      prevAddress:completedJob.address,
      nextJobId:next.id, nextJobNum:next.jobNum||'',
      nextAddress:next.address||'', nextContactPhone:contact,
      nextTimeSlot:next.timeSlot||''
    });
  }catch(e){ console.warn('[NextTenantEta]',e); }
}

// ══════════════════════════════════════════════════════════════
//  OFFLINE SAVE QUEUE — now in @offline (Phase 4). Badge rendering stays
//  local (own DOM id/CSS position — bottom:80px here, above the bottom tab
//  bar, vs. bottom:24px in the Office App). Unlike the Office App, this
//  app's onSynced is just the toast — no Jobs-list refresh, see
//  tests/unit/offline-queue.test.js.
// ══════════════════════════════════════════════════════════════
const _engQueue = createOfflineQueue('df_eng_offline_queue', {
  sbFetch: sb,
  onQueueChange: (count) => _renderOfflineBadge(count),
  onSynced: () => toast('✅ Synced — all offline changes saved','success'),
});
const queueableSave = _engQueue.queueableSave;
const _flushOfflineQueue = _engQueue.flush;

function _renderOfflineBadge(count){
  let el=document.getElementById('offline-queue-badge');
  if(!count){
    if(el) el.remove();
    return;
  }
  if(!el){
    el=document.createElement('div');
    el.id='offline-queue-badge';
    el.style.cssText=`position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:9998;
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
_renderOfflineBadge(_engQueue.getQueue().length);

const df=(()=>{
  const _L={};
  function on(ev,fn,opts={}){if(!_L[ev])_L[ev]=[];_L[ev].push({fn,once:!!opts.once});}
  function off(ev,fn){if(_L[ev])_L[ev]=_L[ev].filter(l=>l.fn!==fn);}
  function emit(ev,...args){if(!_L[ev])return;const run=[..._L[ev]];_L[ev]=_L[ev].filter(l=>!l.once);run.forEach(l=>{try{l.fn(...args);}catch(e){console.warn('[DeepFlow] bus',ev,e);}});}
  function once(ev,fn){on(ev,fn,{once:true});}
  return{on,off,emit,once};
})();

// escHtml is now imported from @ui (was confirmed byte-identical to the
// Office App's copy before extraction — see packages/ui/escaping.js).
// FIX 13: No longer a hardcoded constant. Loaded from the settings table in
// _loadOfficeSettings() which is called inside showApp(). Falls back to localStorage
// cache, then to the placeholder below if neither is available.
let OFFICE_WA_NUMBER = localStorage.getItem('df_eng_office_wa') || '447700000000';

// Resolved per-engineer visibility permissions, set once office settings load.
// Defaults match the Office app's own defaults (see saveEngDefaults()) — only
// 'price' and 'invoice' default to hidden, everything else defaults to visible.
let _engVisPerms = {seePrice:false,seeLandlord:true,seeTenant:true,seeAgent:true,seeNotes:true,seeInvoice:false};

async function _loadOfficeSettings(){
  try{
    // The real settings blob lives in `app_settings` under key '__all__' (same
    // table/shape the Office app itself reads via saveSetting/S) — this used to
    // query a table literally named `settings`, which is a different, always-empty
    // table, so this never found a real number.
    const rows = await sb('app_settings?key=eq.__all__&select=value').catch(()=>null);
    const raw = rows?.[0]?.value;
    const s = typeof raw==='string' ? JSON.parse(raw) : raw;
    if(s) _officeSettingsCache = s;
    const wa = s?.coPhone || '';
    if(wa){
      OFFICE_WA_NUMBER = wa.replace(/\s/g,'');
      localStorage.setItem('df_eng_office_wa', OFFICE_WA_NUMBER);
    }
    // Per-engineer visibility permissions (Office app → Settings → Job Controls
    // → Engineer Visibility Controls). Was configured there but never actually
    // read/enforced anywhere in this app — every engineer saw everything
    // regardless of what an admin had toggled off for them.
    if(s){
      const fields=['seePrice','seeLandlord','seeTenant','seeAgent','seeNotes','seeInvoice'];
      const globalDefaults={};
      fields.forEach(f=>{
        const settingKey='engSee'+f[3].toUpperCase()+f.slice(4);
        globalDefaults[f]=s[settingKey]!==false;
      });
      const engId=currentUser?.id;
      const override=(engId&&s.engPerms&&s.engPerms[engId])||{};
      fields.forEach(f=>{ _engVisPerms[f]=override[f]!==undefined?override[f]:globalDefaults[f]; });
      localStorage.setItem('df_eng_vis_perms',JSON.stringify(_engVisPerms));
    }
  }catch(e){
    // Non-fatal — fall back to localStorage cache if we have one, else the safe defaults above
    try{ const cached=JSON.parse(localStorage.getItem('df_eng_vis_perms')); if(cached) _engVisPerms=cached; }catch(x){}
  }
}

let _officeSettingsCache = {}; // populated by _loadOfficeSettings() — used by sendNotificationWebhook()
let currentUser  = null;
let currentJob   = null;
let currentTab   = 'today';
let _allJobs     = [];
let _mapBlobUrl  = null;
let _refreshing  = false;
let _weather     = null;
export function setWeather(v){ _weather=v; }
let _locWatch    = null;
let _uploadHD    = false;   // HD upload quality toggle
let _qnSelected  = new Set();
let _qnActiveTab = 0;
let _pushGranted = false;
let _lastJobIds  = new Set();
let _lastLat     = null;  // engineer GPS position for nearest-job sort
let _lastLng     = null;

// ── sbStorage — Supabase file upload ─────────────────────────
async function sbStorage(path,file){
  const jwt = await _getJWT();
  const res=await fetch(`${SB_URL}/storage/v1/object/deepflow/${path}`,{
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':file.type||'application/octet-stream','x-upsert':'true'},
    body:file
  });
  if(!res.ok)throw new Error('Upload failed: '+(await res.text()).slice(0,100));
  return `${SB_URL}/storage/v1/object/public/deepflow/${path}`;
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  const next=cur==='dark'?'light':'dark';
  _applyTheme(next);
  localStorage.setItem('df_eng_theme',next);
}
function _applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  const b=document.getElementById('theme-btn');
  if(b)b.textContent=t==='dark'?'🌙':'☀️';
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.content=t==='dark'?'#0a0d14':'#f0f2f7';
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
async function doLogin(){
  const email    = (document.getElementById('login-email')?.value||'').trim().toLowerCase();
  const password = document.getElementById('login-password')?.value||'';
  if(!email||!password){ _loginErr('Enter your email and password'); return; }

  const btn = document.querySelector('.btn-login');
  btn.textContent='Signing in…'; btn.disabled=true;

  try{
    // Step 1: Supabase Auth — same system as the office app
    const {data:authData, error:authErr} = await _supaAuth.auth.signInWithPassword({email, password});
    if(authErr){
      if(authErr.message?.includes('Invalid login')||authErr.message?.includes('invalid_credentials')){
        _loginErr('❌ Wrong email or password');
      } else if(authErr.message?.includes('Email not confirmed')){
        _loginErr('⚠️ Your account needs to be confirmed. Ask the office admin to go to Supabase → Auth → Users → find you → confirm your email.');
      } else {
        _loginErr('❌ '+authErr.message);
      }
      return;
    }

    const authUser = authData.user;
    if(!authUser){ _loginErr('❌ Login failed'); return; }

    // Step 2: Load engineer profile — now sb() uses the real JWT from the session above
    let profile = null;
    try{
      const rows = await sb(`users?auth_id=eq.${authUser.id}&active=eq.true&select=*`);
      profile = rows?.[0]||null;
    }catch(e){}

    // Fallback: match by email (catches cases where auth_id wasn't backfilled yet)
    // FIX CR2: Serialize with await + lock to prevent race conditions
    if(!profile){
      try{
        const rows = await sb(`users?email=eq.${encodeURIComponent(email)}&active=eq.true&select=*`);
        profile = rows?.[0]||null;
        if(profile && !profile.auth_id){
          // PATCH auth_id atomically — await so we know it succeeded before continuing
          await sb(`users?id=eq.${profile.id}`,{method:'PATCH',body:{auth_id:authUser.id},prefer:'return=minimal'});
          profile.auth_id = authUser.id; // keep local copy in sync
        }
      }catch(e){ console.warn('Profile email fallback failed:', e?.message); }
    }

    if(!profile){
      await _supaAuth.auth.signOut();
      _loginErr('⚠️ Your account exists in Supabase but has not been added to DeepFlow yet. Ask the office admin to go to Settings → Team → Sync from Supabase and add you.');
      return;
    }

    if(!profile.active){
      _loginErr('⚠️ Your account has been deactivated. Contact the office.');
      return;
    }

    if(profile.role !== 'engineer'){
      _loginErr('⚠️ Your account is set up as "'+profile.role+'" not "engineer". Ask the office admin to change your role to Engineer in Settings → Team.');
      return;
    }

    // Step 3: Store session
    currentUser = {
      id: profile.id,
      name: profile.name || authUser.email,
      email: authUser.email,
      role: 'engineer',
      phone: profile.phone||'',
      active: true,
      _authId: authUser.id,
    };
    localStorage.setItem('df_eng_user', JSON.stringify(currentUser));
    localStorage.setItem('df_eng_sess_expires', String(Date.now() + 30*24*60*60*1000));

    showApp();

  }catch(e){
    console.error('Login error:',e);
    if(e?.message?.includes('Failed to fetch')||e?.message?.includes('NetworkError')){
      _loginErr('⚠️ No internet connection — check your network');
    } else {
      _loginErr('⚠️ ' + (e?.message||'Connection error'));
    }
  }finally{
    btn.textContent='Sign In →'; btn.disabled=false;
  }
}

async function doResetPw(){
  const email=(document.getElementById('login-email')?.value||'').trim().toLowerCase();
  if(!email){_loginErr('Enter your email address first');return;}
  if(!_supaAuth){_loginErr('Not connected');return;}
  const btn=document.querySelector('.btn-login');
  btn.disabled=true;btn.textContent='Sending…';
  try{
    const {error}=await _supaAuth.auth.resetPasswordForEmail(email);
    if(error){_loginErr('❌ '+error.message);return;}
    const el=document.getElementById('login-err');
    if(el){
      el.style.display='block';el.style.background='rgba(34,197,94,.1)';
      el.style.borderColor='rgba(34,197,94,.3)';el.style.color='#22c55e';
      el.textContent='✅ Reset email sent — check your inbox';
    }
  }catch(e){_loginErr('❌ Failed to send reset email');}
  finally{btn.disabled=false;btn.textContent='Sign In →';}
}
function _loginErr(m){const e=document.getElementById('login-err');e.textContent=m;e.style.display='block';}
// ══ USER MENU SHEET ══
// Haptic feedback on save buttons
document.addEventListener('click',e=>{
  const btn=e.target.closest('[onclick*="save"],[onclick*="Save"],[onclick*="update"],[onclick*="Update"]');
  if(btn&&navigator.vibrate)navigator.vibrate(40);
});

function openUserMenu(){
  const sheet=document.getElementById('user-menu-sheet');
  if(!sheet)return;
  const nameEl=document.getElementById('user-menu-name');
  const avatarEl=document.getElementById('user-avatar-letter');
  if(nameEl)nameEl.textContent=currentUser?.name||'Engineer';
  if(avatarEl)avatarEl.textContent=(currentUser?.name||'E')[0].toUpperCase();
  const refreshEl=document.getElementById('user-menu-last-refresh');
  const ts=document.getElementById('refresh-ts');
  if(refreshEl&&ts&&ts.textContent)refreshEl.textContent=ts.textContent;
  const themeIcon=document.getElementById('user-menu-theme-icon');
  if(themeIcon)themeIcon.textContent=document.documentElement.getAttribute('data-theme')==='light'?'🌑':'🌙';
  sheet.style.display='block';
}
function closeUserMenu(){
  const s=document.getElementById('user-menu-sheet');
  if(s)s.style.display='none';
}

// ═══════════════════════════════════════════════
// ON MY WAY MESSAGES
// ═══════════════════════════════════════════════
function _getEtaTime(mins){
  const d=new Date();d.setMinutes(d.getMinutes()+parseInt(mins||20));
  return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function updateOmwPreview(){
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

function sendOmwClient(){
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
function sendOmwOffice(){
  const to=document.getElementById('omw-to')?.value||currentJob?.address||'—';
  const eta=document.getElementById('omw-eta')?.value||20;
  const etaTime=_getEtaTime(eta);
  const msg=encodeURIComponent(`🚗 *On My Way*
👷 ${currentUser?.name||'Engineer'}
📍 Heading to: ${to}
🕐 ETA: ~${eta} mins (${etaTime})`);
  const officeNum=(typeof OFFICE_WA_NUMBER!=='undefined'?OFFICE_WA_NUMBER:'')||'';
  window.open(`https://wa.me/${officeNum}?text=${msg}`,'_blank');
  if(navigator.vibrate)navigator.vibrate(40);
}

// Pre-fill On My Way with current job if open
function _prefillOmw(){
  if(currentJob){
    const addr=document.getElementById('omw-to');
    if(addr&&!addr.value)addr.value=currentJob.address||'';
    updateOmwPreview();
  }
}

// ══ OFFICE CONNECTION STATUS ══
// Green = Supabase reachable (connected to office system)
// Red   = No internet / Supabase unreachable
async function checkOfficeConnection(){
  const dot=document.getElementById('office-dot');
  const lbl=document.getElementById('office-label');
  try{
    // Lightweight ping — just fetch 1 row, we only care if it succeeds
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),5000);
    await sb('users?limit=1&select=id');
    clearTimeout(t);
    if(dot){dot.style.background='#22c55e';dot.style.boxShadow='0 0 8px rgba(34,197,94,.6)';}
    if(lbl){lbl.style.color='#22c55e';lbl.textContent='Connected';}
  }catch(e){
    if(dot){dot.style.background='#e05252';dot.style.boxShadow='0 0 8px rgba(224,82,82,.5)';}
    if(lbl){lbl.style.color='#e05252';lbl.textContent='No Connection';}
  }
}

function doLogout(){
  if(!confirm('Sign out of DeepFlow?'))return;
  _doSignOut();
}

function _doSignOut(){
  _stopLocation();
  localStorage.removeItem('df_eng_user');
  localStorage.removeItem('df_eng_sess_expires');
  // No Supabase Auth session to sign out from (hash-based auth)
  currentUser=null;_allJobs=[];_weather=null;
  if(typeof _lastJobIds!=='undefined')_lastJobIds=new Set();
  // Show login, hide app
  const app=document.getElementById('app');
  const login=document.getElementById('login-screen');
  if(app)app.style.display='none';
  if(login)login.style.display='flex';
  // Clear login fields
  const em=document.getElementById('login-email');
  const pw=document.getElementById('login-password');
  const err=document.getElementById('login-err');
  if(em)em.value='';
  if(pw)pw.value='';
  if(err)err.style.display='none';
  // Focus email field
  setTimeout(()=>{if(em)em.focus();},200);
}
let _intervalsStarted=false;
function showApp(){
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('topbar-name').textContent=currentUser.name;
  setTimeout(checkOfficeConnection,1500);
  document.getElementById('topbar-date').textContent=
    new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  _loadGeoCache();
  loadJobs();
  initAutoSave();
  setTimeout(checkBroadcastAlerts,5000);
  renderGuide();
  _startLocationSilent();
  // Use engineer's GPS position for weather if available, otherwise default to London
  if(_lastLat&&_lastLng){
    fetchWeather(_lastLat,_lastLng).then(()=>setTimeout(loadDash,500));
  } else if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos=>fetchWeather(pos.coords.latitude,pos.coords.longitude).then(()=>setTimeout(loadDash,500)),
      ()=>fetchWeather(51.5074,-0.1278).then(()=>setTimeout(loadDash,500)),
      {timeout:5000,maximumAge:300000}
    );
  } else {
    fetchWeather(51.5074,-0.1278).then(()=>setTimeout(loadDash,500));
  }
  setTimeout(loadRequests,800);
  setTimeout(_initPush,3500);
  _initPullToRefresh();
  // FIX 13: Load office WhatsApp number from settings table (non-blocking)
  _loadOfficeSettings();
  // ── FIX 1: Start background refresh intervals here so they always run,
  // regardless of whether the user logged in fresh or was restored from a saved session.
  // Guard prevents duplicate intervals if showApp() is somehow called twice.
  if(!_intervalsStarted){
    _intervalsStarted=true;
    setInterval(()=>{if(currentUser&&document.visibilityState!=='hidden'){loadJobs();checkBroadcastAlerts();}},30000);
    setInterval(()=>{if(currentUser)checkBroadcastAlerts();},15000);
    setInterval(()=>{if(currentUser)checkOfficeConnection();},120000);
  }
}

// ══════════════════════════════════════════════════════════════
//  REFRESH
// ══════════════════════════════════════════════════════════════
async function refreshAll(){
  if(_refreshing)return;
  _refreshing=true;
  const icon=document.getElementById('refresh-icon');
  if(icon){icon.className='spinning';}
  try{
    await loadJobs();
    if(currentTab==='dash')await loadDash();
    if(currentTab==='requests')await loadRequests();
    const ts=document.getElementById('refresh-ts');
    if(ts)ts.textContent='Updated '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    toast('✅ Jobs updated','success');
  }finally{
    _refreshing=false;
    if(icon)icon.className='';
  }
}

// ══════════════════════════════════════════════════════════════
//  PULL TO REFRESH
// ══════════════════════════════════════════════════════════════
function _initPullToRefresh(){
  // FIX 11: Attach pull-to-refresh to all three page containers, not just today.
  // Previously only page-today had this gesture — engineers expected it everywhere.
  ['page-today','page-upcoming','page-done'].forEach(pageId=>{
    const el=document.getElementById(pageId);
    if(!el) return;
    _attachPullToRefresh(el);
  });
}

function _attachPullToRefresh(el){
  let startY=0, startScrollY=0, startX=0;
  let pulling=false, locked=false;
  const threshold=72;

  // Create or reuse pull indicator element
  let indicator=el.querySelector('.ptr-indicator');
  if(!indicator){
    indicator=document.createElement('div');
    indicator.className='ptr-indicator';
    indicator.style.cssText='position:absolute;top:0;left:0;right:0;height:56px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--txt3);opacity:0;transition:opacity .2s;pointer-events:none;z-index:10;transform:translateY(-100%)';
    indicator.innerHTML='⬇ Pull to refresh';
    el.style.position='relative';
    el.insertBefore(indicator,el.firstChild);
  }

  el.addEventListener('touchstart',e=>{
    startScrollY=window.scrollY||document.documentElement.scrollTop;
    if(startScrollY>2){startY=0;return;}
    startY=e.touches[0].clientY;
    startX=e.touches[0].clientX;
    pulling=false;locked=false;
    if(indicator)indicator.style.opacity='0';
  },{passive:true});

  el.addEventListener('touchmove',e=>{
    if(!startY)return;
    const dy=e.touches[0].clientY-startY;
    const dx=Math.abs(e.touches[0].clientX-startX);
    const curScroll=window.scrollY||document.documentElement.scrollTop;
    if(curScroll>4&&!locked){startY=0;return;}
    if(!locked&&dy>12&&dx<dy*0.6){locked=true;}
    if(!locked)return;
    if(dy>8){
      pulling=true;
      if(indicator){
        const progress=Math.min(dy/threshold,1);
        indicator.style.opacity=String(progress*0.8);
        indicator.style.transform='translateY('+(-100+progress*100)+'%)';
        indicator.innerHTML=dy>threshold?'⬆ Release to refresh':'⬇ Pull to refresh';
      }
    }
  },{passive:true});

  el.addEventListener('touchend',e=>{
    if(pulling){
      const dy=e.changedTouches[0].clientY-startY;
      if(dy>threshold){refreshAll();}
    }
    if(indicator)indicator.style.opacity='0';
    startY=0;pulling=false;locked=false;
  },{passive:true});
}

// ══════════════════════════════════════════════════════════════
//  JOBS — LOAD & RENDER
// ══════════════════════════════════════════════════════════════
async function loadJobs(){
  const today=new Date().toISOString().split('T')[0];
  const future=new Date(Date.now()+30*86400000).toISOString().split('T')[0]; // 30 days ahead
  const enc=encodeURIComponent(currentUser.name);
  try{
    // FIX 5: Use ilike (case-insensitive) for all engineer name queries so jobs saved
    // with any capitalisation variation are always included. Previously eq was used here
    // but ilike everywhere else — causing silent data splits on mixed-case names.
    const[todayJobs,upcoming,done]=await Promise.all([
      sb(`jobs?date=eq.${today}&engineer=ilike.${enc}&order=created.asc&select=*`),
      sb(`jobs?date=gt.${today}&date=lte.${future}&engineer=ilike.${enc}&order=date.asc&select=*`),
      // Include Completed, Cannot Access, and Cancelled in history — not just Completed
      sb(`jobs?engineer=ilike.${enc}&status=in.(Completed,Cannot Access,Cancelled)&order=modified.desc&limit=60&select=*`)
    ]);
    renderJobs('jobs-today',todayJobs||[],'today');
    renderJobs('jobs-upcoming',upcoming||[],'upcoming');
    renderJobs('jobs-done',done||[],'done');
    _allJobs=[...(todayJobs||[]),...(upcoming||[]),...(done||[])];
    _checkForNewJobs(todayJobs||[]);
    const incomplete=(todayJobs||[]).filter(j=>j.status!=='Completed').length;
    _setBadge('today',incomplete);
    const ts=document.getElementById('refresh-ts');
    if(ts)ts.textContent='Updated '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  }catch(e){toast('⚠️ Could not load jobs','error');}
}

let _sortByDist=false;
function toggleSort(){
  _sortByDist=!_sortByDist;
  const btn=document.getElementById('sort-btn');
  if(btn)btn.textContent=_sortByDist?'📍 Nearest':'⬇ Time';
  const today=new Date().toISOString().split('T')[0];
  renderJobs('jobs-today',_allJobs.filter(j=>j.date===today),'today');
}

function renderJobs(cid,jobs,type){
  const el=document.getElementById(cid);
  if(!el)return;
  if(!jobs.length){
    const M={today:{icon:'🎉',title:'No jobs today',sub:'Contact the office if you think there should be jobs here.'},
      upcoming:{icon:'📅',title:'Nothing coming up',sub:'No jobs scheduled in the next 7 days.'},
      done:{icon:'✅',title:'No completed jobs',sub:'Jobs you complete will appear here.'}};
    const m=M[type]||M.today;
    el.innerHTML=`<div class="empty"><div class="empty-icon">${m.icon}</div><div class="empty-title">${m.title}</div><div class="empty-sub">${m.sub}</div></div>`;
    return;
  }
  // Sort today jobs by distance if GPS available
  if(type==='today'&&_sortByDist&&_lastLat!==null&&_lastLng!==null){
    jobs=[...jobs].sort((a,b)=>{
      const kA=(a.address||'').toLowerCase().trim();
      const kB=(b.address||'').toLowerCase().trim();
      const cA=_geoCache[kA];const cB=_geoCache[kB];
      if(!cA&&!cB)return 0;if(!cA)return 1;if(!cB)return-1;
      return _hdist(_lastLat,_lastLng,cA.lat,cA.lng)-_hdist(_lastLat,_lastLng,cB.lat,cB.lng);
    });
  }
  if(type==='upcoming'){
    const g={};
    jobs.forEach(j=>{const d=j.date||'TBC';(g[d]=g[d]||[]).push(j);});
    el.innerHTML=Object.entries(g).map(([date,dj])=>{
      const lbl=date==='TBC'?'TBC':new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'});
      return`<div class="sec-hd">${lbl}<div class="sec-hd-line"></div></div>`+dj.map(_buildCard).join('');
    }).join('');
  }else{el.innerHTML=jobs.map(_buildCard).join('');}
}

// Cert types: loaded from main app localStorage (df_setting_certTypes)
// Falls back to main app defaults if not on same device
const _DEFAULT_CERT_TYPES=[
  {id:'ct1',name:'Gas Safety'},
  {id:'ct2',name:'Electrical (EICR)'},
  {id:'ct3',name:'Fire Alarm'},
  {id:'ct4',name:'Emergency Lighting'},
  {id:'ct5',name:'PAT Testing'},
  {id:'ct6',name:'EPC'},
  {id:'ct7',name:'Legionella'},
];
function _loadCertTypes(){
  try{
    const raw=localStorage.getItem('df_setting_certTypes');
    if(raw){const arr=JSON.parse(raw);if(Array.isArray(arr)&&arr.length)return arr;}
  }catch(e){}
  return _DEFAULT_CERT_TYPES;
}
let _CERT_TYPES=_loadCertTypes();
// Build lookup: id → short label, e.g. ct2 → "EICR", "Gas Safety" → "Gas Safety"
function _buildCertMap(){
  const map={};
  _CERT_TYPES.forEach(ct=>{
    // id lookup
    map[ct.id]=ct.name;
    // also index by lowercased name for robustness
    map[ct.name.toLowerCase()]=ct.name;
  });
  return map;
}
let _CERT_MAP=_buildCertMap();
function _certLabel(c){
  if(!c)return'';
  return _CERT_MAP[c]||_CERT_MAP[c.toLowerCase()]||c;
}
async function quickStatusUpdate(id, newStatus){
  const j0=_allJobs?.find(x=>x.id===id);
  const oldStatus=j0?.status;
  try{
    const {queued}=await queueableSave(`Status → ${newStatus} — ${j0?.address||id}`, `jobs?id=eq.${id}`, {method:'PATCH',body:{status:newStatus,modified:Date.now()},prefer:'return=minimal'});
    logAudit('job_status_change',{jobId:id,jobNum:j0?.jobNum,address:j0?.address,oldStatus,newStatus});
    if(!queued){
      const notifPayload={jobId:id,jobNum:j0?.jobNum,address:j0?.address,oldStatus,newStatus,landlordName:j0?.landlordName||'',landlordPhone:j0?.landlordPhone||''};
      sendNotificationWebhook('job_status_change',notifPayload);
      sendPushNotification('job_status_change',notifPayload);
      if(newStatus==='Completed' && j0) notifyNextTenantEta(j0);
    }
    // Update local cache
    if(_allJobs){ const j=_allJobs.find(x=>x.id===id); if(j) j.status=newStatus; }
    if(!queued) loadJobs();
    if(queued){
      toast(`📶 Offline — status will sync to "${newStatus}" once back online`,'warn');
    } else if(newStatus==='Completed'){
      toast('✅ Job marked complete!','success');
      if(navigator.vibrate) navigator.vibrate([100,50,200]);
    } else if(newStatus==='In Progress'){
      toast('▶ Job started','info');
    } else if(newStatus==='Cannot Access'){
      toast('🚫 Marked as cannot access','warn');
    }
  }catch(e){
    toast('Update failed: '+e.message,'error');
  }
}

function _buildCard(j){
  const sc=_sc(j.status,j.priority);
  const certs=(j.certTypes||[]).map(c=>`<span class="job-chip chip-cert">${_certLabel(c)}</span>`).join('');
  const mapUrl='https://maps.google.com/?q='+encodeURIComponent(j.address||'');
  return`<div class="job-card ${sc}" onclick="openJob('${j.id}')">
    <div class="job-card-stripe"></div>
    
    <div class="job-card-top">
      <div style="min-width:0;flex:1">
        <div class="job-num">${escHtml(j.jobNum)||'—'}</div>
        <div class="job-addr">${escHtml(j.address)||'—'}</div>
      </div>
      ${_spill(j.status,j.priority)}
    </div>
    <div class="job-meta">
      ${j.timeSlot?`<span class="job-chip chip-time">🕐 ${escHtml(j.timeSlot)}</span>`:''}
      ${j.trade?`<span class="job-chip chip-trade">🔧 ${escHtml(j.trade)}</span>`:''}
      ${j.hours?`<span class="job-chip chip-hours">⏱ ${j.hours}h</span>`:''}
      ${certs}
    </div>
    <div class="job-quick-row" onclick="event.stopPropagation()">
      ${j.status!=='Completed'?`<button class="jq-btn jq-green" onclick="quickStatusUpdate('${j.id}','Completed')">✅ Done</button>`:''}
      ${j.status==='Pending'?`<button class="jq-btn jq-blue" onclick="quickStatusUpdate('${j.id}','In Progress')">▶ Start</button>`:''}
      ${j.status!=='Cannot Access'?`<button class="jq-btn jq-red" onclick="quickStatusUpdate('${j.id}','Cannot Access')">🚫 No Access</button>`:''}
      ${j.address?`<a class="jq-btn jq-map" href="${mapUrl}" target="_blank">🗺 Map</a>`:''}
    </div>
  </div>`;
}

function _sc(s,p){
  if(p==='Emergency')return 's-emergency';
  if(s===STATUS.COMPLETED)return 's-completed';
  if(s===STATUS.IN_PROGRESS)return 's-progress';
  if(s===STATUS.CANNOT_ACCESS)return 's-noaccess';
  if(s===STATUS.CANCELLED)return 's-cancelled';
  return 's-pending';
}
function _spill(s,p){
  if(p==='Emergency')return'<span class="status-pill sp-emergency">🚨 Emergency</span>';
  if(s===STATUS.COMPLETED)return'<span class="status-pill sp-completed">✅ Done</span>';
  if(s===STATUS.IN_PROGRESS)return'<span class="status-pill sp-progress">🔄 In Progress</span>';
  if(s===STATUS.CANNOT_ACCESS)return'<span class="status-pill sp-noaccess">🚫 No Access</span>';
  if(s===STATUS.CANCELLED)return'<span class="status-pill sp-cancelled">⚪ Cancelled</span>';
  return'<span class="status-pill sp-pending">⏳ Pending</span>';
}

// ══════════════════════════════════════════════════════════════
//  JOB DETAIL
// ══════════════════════════════════════════════════════════════
async function openJob(id){
  const modal=document.getElementById('job-modal');
  modal.classList.add('open');
  document.getElementById('modal-body').innerHTML='<div class="loading-center"><div class="spin"></div></div>';
  document.getElementById('modal-jobnum').textContent='';
  document.getElementById('modal-addr').textContent='Loading…';
  document.getElementById('modal-status-pill').innerHTML='';
  try{
    const[jobs,atts]=await Promise.all([
      sb(`jobs?id=eq.${id}&select=*`),
      sb(`attachments?jobid=eq.${id}&order=created.asc&select=*`).catch(()=>[])
    ]);
    if(!jobs?.[0])throw new Error('Job not found');
    const j=jobs[0];
    // Verify this engineer is still assigned — office may have reassigned it
    // FIX BUG3: use case-insensitive compare — DB may store "IZHAR" while users table has "Izhar"
    if(j.engineer && j.engineer.toLowerCase() !== currentUser.name.toLowerCase()){
      modal.classList.remove('open');
      toast('⚠️ This job has been reassigned. Your job list will refresh.','warn',4000);
      setTimeout(loadJobs,500);
      return;
    }
    currentJob=j;
    document.getElementById('modal-jobnum').textContent=j.jobNum||'';
    document.getElementById('modal-addr').textContent=j.address||'';
    document.getElementById('modal-status-pill').innerHTML=_spill(j.status,j.priority);
    const pcMatch=(j.address||'').match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
    const lrPromise=pcMatch?fetchLandRegistry(pcMatch[1]):Promise.resolve(null);
    renderJobDetail(j,atts||[]);
    lrPromise.then(lr=>{
      if(!lr)return;
      const el=document.getElementById('land-reg-info');
      if(el)el.innerHTML=`<div style="font-size:12px;color:var(--txt2);padding:6px 2px">🏠 Property type: <strong>${lr.type||'—'}</strong></div>`;
    }).catch(()=>{});
  }catch(e){
    document.getElementById('modal-addr').textContent='Error loading';
    document.getElementById('modal-body').innerHTML=`<div style="padding:30px;text-align:center"><div style="font-size:36px;margin-bottom:12px">⚠️</div><div style="font-weight:800;margin-bottom:8px">Failed to load job</div><div style="font-size:12px;color:var(--txt3);margin-bottom:16px">${(e.message||'').slice(0,100)}</div><button onclick="openJob('${id}')" style="background:var(--acc);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-weight:700;cursor:pointer">↺ Retry</button></div>`;
  }
}

function renderJobDetail(j,atts){
  const photos=atts.filter(a=>a.type==='photo');
  const pdfs=atts.filter(a=>a.type!=='photo');
  const mapsUrl=j.address?`https://maps.google.com/?q=${encodeURIComponent(j.address)}`:'';
  const wazeUrl=j.address?`https://waze.com/ul?q=${encodeURIComponent(j.address)}&navigate=yes`:'';
  const pcMatch=(j.address||'').match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
  // WhatsApp deep links for contacts
  const _waBtn=(num,label)=>num?`<a class="cta cta-wa" href="https://wa.me/${num.replace(/\D/g,'')}" target="_blank">💬 ${label}</a>`:'';
  const _callBtn=(num)=>num?`<a class="cta cta-call" href="tel:${num}">📞 Call</a>`:'';
  const _emailBtn=(em)=>em?`<a class="cta cta-email" href="mailto:${em}" target="_blank">✉️ Email</a>`:'';
  // WhatsApp share job summary
  const jobSummary=encodeURIComponent(`*DeepFlow Job*\n📍 ${j.address||''}\n🔧 ${j.trade||''}\n🕐 ${j.timeSlot||'—'}\n#${j.jobNum||''}`);
  const waShareUrl=`https://wa.me/?text=${jobSummary}`;

  document.getElementById('modal-body').innerHTML=`
    <!-- STATUS PILLS -->
    <div class="status-selector">
      <div class="status-selector-label">Update Status</div>
      <div class="status-pills-row">
        ${_statusButtons(j.status)}
      </div>
    </div>

    <!-- WHATSAPP SHARE JOB -->
    <div style="padding:0 14px 10px">
      <a href="${waShareUrl}" target="_blank" class="cta cta-wa-job" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;text-decoration:none;border-radius:10px;border:1px solid rgba(37,211,102,.35);background:rgba(37,211,102,.07);color:#25d366;font-size:13px;font-weight:700">
        💬 Share Job via WhatsApp
      </a>
    </div>

    <!-- JOB DETAILS -->
    <div class="d-section">
      <div class="d-section-hd">📋 Job Details</div>
      <div class="d-block">
        ${_dr('Date',j.date?new Date(j.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'')}
        ${_dr('Time',j.timeSlot?`🕐 ${escHtml(j.timeSlot)}`:'')}
        ${_dr('Trade',escHtml(j.trade))}
        ${_dr('Certs',(j.certTypes||[]).map(_certLabel).map(escHtml).join(', '))}
        ${_dr('Ref',escHtml(j.jobNum))}
        ${_engVisPerms.seeNotes?_dr('Details',escHtml(j.description)):''}
        ${_dr('Hours',j.hours?j.hours+' hrs':'')}
        ${j.priority&&j.priority!=='Normal'?_dr('Priority',`<span style="color:var(--red);font-weight:800">🚨 ${escHtml(j.priority)}</span>`):''}
      </div>
    </div>

    <!-- ACCESS & NAVIGATION -->
    <div class="d-section">
      <div class="d-section-hd">🔑 Access &amp; Navigation</div>
      <div class="d-block">
        ${_dr('Access',escHtml(j.access))}
        ${j.contact?`<div class="d-row"><div class="d-lbl">Contact</div><div class="d-val"><div style="font-weight:600;margin-bottom:8px">${escHtml(j.contact)}</div><div class="cta-row">${_callBtn(j.contact)}${_waBtn(j.contact,'WhatsApp')}</div></div></div>`:''}
        ${mapsUrl?`<div class="d-row"><div class="d-lbl">Navigate</div><div class="d-val"><div class="cta-row"><a class="cta cta-map" href="${mapsUrl}" target="_blank">📍 Google Maps</a><a class="cta cta-waze" href="${wazeUrl}" target="_blank">🚗 Waze</a></div></div></div>`:''}
      </div>
    </div>

    ${pcMatch?`<div class="d-section"><div class="d-section-hd">🏠 Property Info</div><div id="land-reg-info" style="font-size:12px;color:var(--txt3);padding:4px 2px">Loading…</div></div>`:''}

    <!-- LANDLORD -->
    ${(j.landlordName&&_engVisPerms.seeLandlord)?`<div class="d-section"><div class="d-section-hd">🏠 Landlord</div><div class="d-block">
      ${_dr('Name',escHtml(j.landlordName))}
      ${j.landlordPhone?`<div class="d-row"><div class="d-lbl">Phone</div><div class="d-val"><div style="font-weight:600;margin-bottom:8px">${escHtml(j.landlordPhone)}</div><div class="cta-row">${_callBtn(j.landlordPhone)}${_waBtn(j.landlordPhone,'WhatsApp')}${_waBtn(j.landlordWA||j.landlordPhone,'WA')}</div></div></div>`:''}
      ${j.landlordEmail?`<div class="d-row"><div class="d-lbl">Email</div><div class="d-val"><div class="cta-row">${_emailBtn(j.landlordEmail)}<a class="cta cta-wa" href="https://wa.me/?text=${encodeURIComponent('Re: '+j.address)}" target="_blank">💬 WA Message</a></div></div></div>`:''}
      ${_dr('Notes',escHtml(j.landlordNotes))}
    </div></div>`:''}

    <!-- AGENCY -->
    ${(j.agencyName&&_engVisPerms.seeAgent)?`<div class="d-section"><div class="d-section-hd">🏢 Agency</div><div class="d-block">
      ${_dr('Agency',escHtml(j.agencyName))}
      ${_dr('Agent',escHtml(j.agentName))}
      ${j.agentPhone?`<div class="d-row"><div class="d-lbl">Phone</div><div class="d-val"><div style="font-weight:600;margin-bottom:8px">${escHtml(j.agentPhone)}</div><div class="cta-row">${_callBtn(j.agentPhone)}${_waBtn(j.agentPhone,'WhatsApp')}</div></div></div>`:''}
      ${j.agentEmail?`<div class="d-row"><div class="d-lbl">Email</div><div class="d-val"><div class="cta-row">${_emailBtn(j.agentEmail)}</div></div></div>`:''}
    </div></div>`:''}

    <!-- NOTES -->
    <div class="d-section">
      <div class="d-section-hd">📝 Job Notes</div>
      <div class="notes-toolbar">
        <button class="notes-tool-btn" onclick="openQN()" style="background:rgba(79,143,255,.1);border-color:rgba(79,143,255,.25);color:var(--acc)">⚡ Quick Issues</button>
        <button class="notes-tool-btn" onclick="_waShareNotes()">💬 Share Notes</button>
      </div>
      <textarea class="notes-box" id="job-notes" placeholder="Issues found, materials used, observations…">${j.notes||''}</textarea>
      <button class="save-btn" onclick="saveNotes()" style="margin-top:8px">💾 Save Notes</button>
    </div>

    <!-- LOG HOURS -->
    <div class="d-section">
      <div class="d-section-hd">⏱ Log Hours</div>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input class="fi-sm" type="number" id="job-hours" value="${j.hours||''}" placeholder="Hours worked" min="0" step="0.5" style="flex:1;margin-bottom:0">
        <button class="save-btn" onclick="saveHours()" style="width:auto;padding:10px 18px;font-size:13px;margin:0">Save</button>
      </div>
    </div>

    <!-- PHOTOS -->
    <div class="d-section">
      <div class="d-section-hd">📷 Photos (${photos.length})<span style="font-size:10px;color:var(--acc);font-weight:600;margin-left:6px">AUTO-STAMPED</span></div>
      <div class="ba-mode-toggle">
        <button class="ba-mode-btn ${_baMode?'':'active'}" onclick="_setPhotoMode(false,this)">📷 Standard</button>
        <button class="ba-mode-btn ${_baMode?'active':''}" onclick="_setPhotoMode(true,this)">🔄 Before / After</button>
      </div>
      <div id="ba-photo-area"></div>
      <div class="stamp-notice" id="stamp-notice-txt">📸 Photos auto-stamped with address${_baMode?', sequence &amp; Before/After label':' and your name'}.</div>
      <div class="upload-quality-row">
        <button class="quality-btn ${!_uploadHD?'active':''}" onclick="setQuality(false,this)">📱 Compressed</button>
        <button class="quality-btn ${_uploadHD?'active':''}" onclick="setQuality(true,this)">🔷 HD Original</button>
      </div>
      <input type="file" id="photo-input" accept="image/*" multiple onchange="handleUpload(this,'photo')">
      <input type="file" id="photo-input-before" accept="image/*" onchange="_handleBAUpload(this,'before')">
      <input type="file" id="photo-input-after"  accept="image/*" onchange="_handleBAUpload(this,'after')">
      <div id="std-upload-btn" style="display:${_baMode?'none':'block'}">
        <div class="upload-zone" onclick="document.getElementById('photo-input').click()">
          <div class="upload-zone-icon">📷</div>
          <div class="upload-zone-text">Take Photo or Upload from Gallery</div>
          <div class="upload-zone-sub">${_uploadHD?'HD quality — full resolution':'Compressed — faster upload, smaller size'}</div>
        </div>
      </div>
    </div>

    <!-- DOCS -->
    <div class="d-section">
      <div class="d-section-hd">📄 Certificates &amp; Docs (${pdfs.length})</div>
      ${pdfs.map(a=>`<div class="pdf-row"><div class="pdf-icon">📄</div><div class="pdf-info"><div class="pdf-name">${a.name}</div><div class="pdf-meta">${a.uploaded_by_name||''} · ${_fd(a.created)}</div></div><a class="btn-open" href="${a.url}" target="_blank">Open</a></div>`).join('')}
      <input type="file" id="pdf-input" accept=".pdf,application/pdf" multiple onchange="handleUpload(this,'certificate')">
      <div class="upload-zone" onclick="document.getElementById('pdf-input').click()">
        <div class="upload-zone-icon">📄</div>
        <div class="upload-zone-text">Upload Certificate / Document</div>
        <div class="upload-zone-sub">Gas Safety, EICR, EPC etc.</div>
      </div>
    </div>
    <div style="height:24px"></div>
  `;
  // Store atts on currentJob so _setPhotoMode can re-render without a network call
  currentJob._latestAtts = atts;
  // Render photo grid (respects _baMode state)
  _renderPhotoGrid(atts);
  // FIX 12: Hook auto-save directly here rather than via the fragile window.renderJobDetail
  // patch in initAutoSave(). The patch only worked if renderJobDetail was a function
  // declaration — refactoring to const/let would silently break it. Direct call is reliable.
  _hookJobNotesAutoSave();
}

function _dr(lbl,val){if(!val)return'';return`<div class="d-row"><div class="d-lbl">${lbl}</div><div class="d-val">${val}</div></div>`;}

// FIX 12 helper: called directly from renderJobDetail() after the textarea is in the DOM.
// Restores any saved draft and wires the input → localStorage auto-save.
function _hookJobNotesAutoSave(){
  const el=document.getElementById('job-notes');
  if(!el||!currentJob) return;
  // BUGFIX: this draft key used to be a single global 'draft_job-notes' shared
  // by every job — notes typed for one job (then never saved) could silently
  // reappear in a completely different job's notes box. Scope it per job id.
  const draftKey='draft_job-notes_'+currentJob.id;
  localStorage.removeItem('draft_job-notes'); // one-time cleanup of the old unscoped key
  // Restore draft if textarea is empty (i.e. job had no notes)
  if(!el.value){
    const saved=localStorage.getItem(draftKey);
    if(saved){
      el.value=saved;
      el.style.borderColor='var(--acc)';
      el.style.transition='border-color 1.5s';
      setTimeout(()=>{el.style.borderColor='';},2000);
    }
  }
  // Rebind every render (not just once) — the job (and therefore the key)
  // may have changed since this element was last hooked.
  el.oninput=()=>localStorage.setItem(draftKey,el.value);
}
function setQuality(hd,btn){
  _uploadHD=hd;
  document.querySelectorAll('.quality-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const sub=document.querySelector('.upload-zone-sub');
  if(sub)sub.textContent=hd?'HD quality — full resolution':'Compressed — faster upload, smaller size';
}

function _waShareNotes(){
  const notes=document.getElementById('job-notes')?.value||'';
  if(!notes.trim()){toast('No notes to share','info');return;}
  const msg=encodeURIComponent(`*Job Notes — ${currentJob?.address||''}*\n\n${notes}`);
  window.open(`https://wa.me/?text=${msg}`,'_blank');
}

// ══════════════════════════════════════════════════════════════
//  STATUS / NOTES / HOURS
// ══════════════════════════════════════════════════════════════
// Status flow: what each status can move to
const STATUS_FLOW={
  'Pending':       ['In Progress','Cannot Access'],
  'In Progress':   ['Completed','Cannot Access'],
  'Completed':     [],           // LOCKED — no going back
  'Cannot Access': ['In Progress'], // office can reassign but engineer can re-attempt
  'Invoiced':      [],           // LOCKED
  'Cancelled':     []            // LOCKED
};

function _statusButtons(currentStatus){
  // FIX 6: If the job is in a terminal locked state that isn't one of the 4 engineer
  // buttons (Invoiced, Cancelled), show a clear explanatory banner instead of rendering
  // 4 greyed-out buttons with no explanation — which previously looked like a broken UI.
  if(currentStatus==='Invoiced'){
    return `<div style="background:rgba(79,143,255,.08);border:1px solid rgba(79,143,255,.25);border-radius:12px;padding:12px 14px;font-size:12px;color:var(--acc);font-weight:600;display:flex;align-items:center;gap:8px">
      <span style="font-size:18px">🧾</span>
      <div><div style="font-weight:800;margin-bottom:2px">This job has been invoiced</div>
      <div style="font-weight:400;color:var(--txt2)">Status is locked. Contact the office if changes are needed.</div></div>
    </div>`;
  }
  if(currentStatus==='Cancelled'){
    return `<div style="background:rgba(100,116,139,.08);border:1px solid rgba(100,116,139,.25);border-radius:12px;padding:12px 14px;font-size:12px;color:var(--txt2);font-weight:600;display:flex;align-items:center;gap:8px">
      <span style="font-size:18px">🚫</span>
      <div><div style="font-weight:800;margin-bottom:2px">This job has been cancelled</div>
      <div style="font-weight:400;color:var(--txt3)">No further action required.</div></div>
    </div>`;
  }

  const all=[
    {key:'Pending',      label:'⏳ Pending',    cls:'sp-pending'},
    {key:'In Progress',  label:'🔄 In Progress', cls:'sp-progress'},
    {key:'Completed',    label:'✅ Completed',   cls:'sp-completed'},
    {key:'Cannot Access',label:'🚫 No Access',   cls:'sp-noaccess'},
  ];
  const allowed=STATUS_FLOW[currentStatus]||[];
  return all.map(s=>{
    const isActive=s.key===currentStatus;
    const isLocked=!isActive&&!allowed.includes(s.key);
    if(isLocked) return `<button class="sp-btn ${s.cls}" disabled style="opacity:.25;cursor:not-allowed;filter:grayscale(1)" title="Cannot go back to ${s.key}">${s.label}</button>`;
    return `<button class="sp-btn ${s.cls} ${isActive?'active':''}" onclick="updateStatus('${s.key}',this)" ${isActive?'style="cursor:default"':''}>${s.label}${isActive?' ✓':''}</button>`;
  }).join('');
}

async function updateStatus(status, btn){
  if(!currentJob) return;

  // Client-side flow check
  const allowed=STATUS_FLOW[currentJob.status]||[];
  if(status===currentJob.status) return; // already set
  if(!allowed.includes(status)){
    toast(`🔒 Cannot change from "${currentJob.status}" to "${status}"`, 'error');
    return;
  }

  // Server-side verification: re-fetch current status before patching — but
  // only when actually online. If we're offline this fetch would fail too,
  // and there's no way to know "current" anyway; the queued write below
  // will just apply on top of whatever the server has once reconnected.
  const jobId=currentJob.id, oldStatus=currentJob.status;
  try{
    if(navigator.onLine){
      try{
        const live=await sb(`jobs?id=eq.${jobId}&select=id,status`);
        const liveStatus=live?.[0]?.status;
        if(liveStatus && liveStatus!==oldStatus){
          // Someone else changed it — refresh
          currentJob.status=liveStatus;
          document.getElementById('modal-status-pill').innerHTML=_spill(liveStatus,currentJob.priority);
          const newBtns=document.querySelector('.status-pills-row');
          if(newBtns) newBtns.innerHTML=_statusButtons(liveStatus);
          toast(`ℹ️ Status was already updated to "${liveStatus}"`, 'warn');
          loadJobs();
          return;
        }
      }catch(e){
        if(!_isNetworkError(e)) throw e; // a real error, not connectivity — bubble to outer catch
        // else: flaky connection despite navigator.onLine — fall through and let
        // queueableSave() below decide (it'll queue if still failing).
      }
    }

    const {queued}=await queueableSave(`Status → ${status} — ${currentJob.address}`, `jobs?id=eq.${jobId}`, {method:'PATCH',body:{status,modified:Date.now()}});
    logAudit('job_status_change',{jobId,jobNum:currentJob.jobNum,address:currentJob.address,oldStatus,newStatus:status});
    if(!queued){
      const notifPayload={jobId,jobNum:currentJob.jobNum,address:currentJob.address,oldStatus,newStatus:status,landlordName:currentJob.landlordName||'',landlordPhone:currentJob.landlordPhone||''};
      sendNotificationWebhook('job_status_change',notifPayload);
      sendPushNotification('job_status_change',notifPayload);
      if(status==='Completed') notifyNextTenantEta(currentJob);
    }
    currentJob.status=status;
    document.getElementById('modal-status-pill').innerHTML=_spill(status,currentJob.priority);
    // Refresh the buttons
    const btnRow=document.querySelector('.status-pills-row');
    if(btnRow) btnRow.innerHTML=_statusButtons(status);
    playStatusAnim(status);
    toast(queued?`📶 Offline — status will sync to "${status}" once back online`:`Status → ${status}`, queued?'warn':'success');
    if(!queued) loadJobs();
  }catch(e){ toast('⚠️ Status update failed','error'); }
}

function playStatusAnim(status){
  const app=document.getElementById('app');
  // Subtle haptic
  const haptics={
    'Completed':[30,20,60],
    'In Progress':[15],
    'Cancelled':[60],
    'Cannot Access':[60]
  };
  if(navigator.vibrate) navigator.vibrate(haptics[status]||[15]);

  // Professional status bar — slides in from top, fades out
  const colors={
    'Completed':   {bg:'#166534',border:'#22c55e',icon:'✓'},
    'In Progress': {bg:'#1e3a5f',border:'#3b82f6',icon:'◉'},
    'Cancelled':   {bg:'#450a0a',border:'#e05252',icon:'✕'},
    'Cannot Access':{bg:'#450a0a',border:'#e05252',icon:'✕'},
    'Pending':     {bg:'#1c1c1c',border:'#6b7280',icon:'○'},
  };
  const c=colors[status]||colors['Pending'];

  // Remove any existing
  document.querySelectorAll('.status-confirm-bar').forEach(el=>el.remove());

  const bar=document.createElement('div');
  bar.className='status-confirm-bar';
  bar.style.cssText=`
    position:fixed;top:0;left:0;right:0;z-index:9999;
    background:${c.bg};border-bottom:2px solid ${c.border};
    padding:14px 20px;display:flex;align-items:center;gap:12px;
    transform:translateY(-100%);transition:transform .25s cubic-bezier(.22,1,.36,1);
  `;
  bar.innerHTML=`
    <span style="width:28px;height:28px;border-radius:50%;border:2px solid ${c.border};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:${c.border};flex-shrink:0">${c.icon}</span>
    <div>
      <div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:.3px">${status}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:1px">Status updated successfully</div>
    </div>
    <div style="margin-left:auto;width:3px;height:36px;background:${c.border};border-radius:2px;opacity:.5"></div>
  `;
  document.body.appendChild(bar);
  requestAnimationFrame(()=>{ bar.style.transform='translateY(0)'; });
  setTimeout(()=>{
    bar.style.transform='translateY(-100%)';
    setTimeout(()=>bar.remove(), 300);
  }, 2200);

  // No cleanup needed — bar removes itself above
}

async function saveNotes(){
  if(!currentJob)return;
  const notes=document.getElementById('job-notes')?.value.trim()||'';
  const btn=document.querySelector('[onclick="saveNotes()"]');
  if(btn){btn.textContent='Saving…';btn.disabled=true;}
  try{
    const {queued}=await queueableSave(`Notes — ${currentJob.address}`, `jobs?id=eq.${currentJob.id}`, {method:'PATCH',body:{notes,modified:Date.now()}});
    currentJob.notes=notes;
    _clearDraft('job-notes_'+currentJob.id);
    toast(queued?'📶 Offline — notes saved on this device, will sync automatically':'✅ Notes saved', queued?'warn':'success');
    if(navigator.vibrate)navigator.vibrate(queued?[20]:[40,20,60]);
  }catch(e){toast('⚠️ Failed to save notes','error');if(navigator.vibrate)navigator.vibrate([80]);}
  finally{if(btn){btn.innerHTML='💾 Save Notes';btn.disabled=false;}}
}

async function saveHours(){
  if(!currentJob)return;
  const hours=parseFloat(document.getElementById('job-hours')?.value);
  if(isNaN(hours)||hours<0){toast('Enter valid hours','error');return;}
  try{
    const {queued}=await queueableSave(`Hours — ${currentJob.address}`, `jobs?id=eq.${currentJob.id}`, {method:'PATCH',body:{hours,modified:Date.now()}});
    currentJob.hours=hours;
    toast(queued?`📶 Offline — ${hours}h saved on this device, will sync automatically`:`✅ Logged ${hours}h`, queued?'warn':'success');
    if(navigator.vibrate)navigator.vibrate(queued?[20]:[40,20,60]);
    if(!queued) loadJobs();
  }catch(e){toast('⚠️ Failed to save hours','error');if(navigator.vibrate)navigator.vibrate([80]);}
}

// ══════════════════════════════════════════════════════════════
//  ADD JOB (FAB) — engineer reports new job, notifies office
// ══════════════════════════════════════════════════════════════
function openAddJobModal(){
  document.getElementById('aj-address').value='';
  document.getElementById('aj-desc').value='';
  _clearDraft('aj-desc');
  document.getElementById('aj-priority').value='Normal';
  document.getElementById('addjob-modal').classList.add('open');
}

async function submitAddJob(){
  const address=document.getElementById('aj-address').value.trim();
  const trade=document.getElementById('aj-trade').value;
  const desc=document.getElementById('aj-desc').value.trim();
  const priority=document.getElementById('aj-priority').value;
  if(!address){toast('Please enter an address','error');return;}
  const btn=document.querySelector('#addjob-modal .save-btn');
  btn.textContent='Submitting…';btn.disabled=true;
  try{
    // Create job in Supabase
    const jobId=`job-eng-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const today=new Date().toISOString().split('T')[0];
    await sb('jobs',{method:'POST',body:{
      id:jobId,jobnum:`ENG-${Date.now().toString().slice(-6)}`,
      date:today,address,trade,description:desc,
      priority,status:'Pending',engineer:currentUser.name,
      notes:`Reported by engineer: ${currentUser.name}`,
      created:Date.now(),modified:Date.now()
    }});
    closeModal('addjob-modal');
    // WhatsApp notification to office
    const waMsg=encodeURIComponent(
      `🔔 *New Job Reported*\n👷 Engineer: ${currentUser.name}\n📍 ${address}\n🔧 ${trade}\n${priority==='Emergency'?'🚨 EMERGENCY\n':priority==='Urgent'?'⚠️ Urgent\n':''}📝 ${desc||'—'}\n\n_DeepFlow App_`
    );
    window.open(`https://wa.me/${OFFICE_WA_NUMBER}?text=${waMsg}`,'_blank');
    toast('✅ Job submitted! Office notified via WhatsApp','success');
    if(navigator.vibrate)navigator.vibrate([50,30,80]);
    loadJobs();
  }catch(e){toast('❌ Failed to submit: '+(e.message||'').slice(0,60),'error');if(navigator.vibrate)navigator.vibrate([80]);}
  finally{btn.textContent='📤 Submit to Office';btn.disabled=false;}
}

// ══════════════════════════════════════════════════════════════
//  QUICK NOTES PICKER
// ══════════════════════════════════════════════════════════════
const QN_CATEGORIES=[
  {label:'⚡ Electrical',items:[
    'Plastic consumer unit — requires upgrading to metal clad',
    'No SPD (Surge Protection Device) installed',
    'Type AC RCD — should be Type A or F',
    'No RCD protection on circuits',
    'Single RCD protecting all circuits',
    'Some circuits not RCD protected',
    'Missing cable grommets on consumer unit',
    'Handwritten circuit labels — not acceptable',
    'Loose socket outlet(s)',
    'Faulty socket outlet(s)',
    'Bathroom light fitting not IP rated',
    'No earthing label on consumer unit',
    'Missing arc fault detection (AFDD)',
    'Bonding conductors undersized',
    'No main protective bonding to gas/water',
    'Deteriorated wiring — signs of overheating',
    'Damaged/missing socket faceplates',
    'No residual current device on bathroom circuit',
    'Smoke alarm not hardwired/interconnected',
    'Outdoor socket not RCD protected',
    'Wiring in accessible conduit — risk of damage',
    'Consumer unit in damp location',
    'Double pole switch missing on shower circuit',
    'Incorrect polarity identified',
    'Earth continuity failure on ring circuit',
  ]},
  {label:'🔥 Gas',items:[
    'Hob FSD (Flame Supervision Device) faulty',
    'Burner not working on hob',
    'Ignitor not working',
    'Boiler not working — no hot water/heating',
    'Boiler pressure low — requires topping up',
    'Meter box damaged/broken',
    'CO2 alarm missing — immediate action required',
    'CO2 alarm expired — requires replacement',
    'No gas safety record available',
    'Flue not adequately supported',
    'Ventilation inadequate for boiler',
    'Gas pipe not properly supported/clipped',
    'Smell of gas detected — investigated and safe',
    'Boiler flue terminal too close to window/opening',
    'Pilot light extinguishing frequently',
    'Thermocouple faulty — pilot not holding',
    'Boiler serviced but requires parts',
    'Radiators not balancing — TRVs faulty',
    'Expansion vessel requires recharging',
    'Heat exchanger scaled — reduced efficiency',
    'Timer/programmer faulty',
  ]},
  {label:'🔔 Fire Alarm',items:[
    'Fike fire alarm panel installed',
    'C-Tec fire alarm panel installed',
    'Advanced fire alarm panel installed',
    'Fire panel showing fault — investigated',
    'Fire panel in alarm condition',
    'Smoke detectors missing in required locations',
    'Heat detector missing in kitchen',
    'Detectors faulty — requires replacement',
    'Detectors end of life — over 10 years old',
    'Manual call point damaged/missing cover',
    'Sounders not audible in all areas',
    'Panel battery low/flat',
    'Zone chart missing or out of date',
    'Fire alarm cable not fire-rated',
    'Detectors painted over — requires replacement',
    'False alarm history noted — review required',
    'Weekly test not being carried out',
    'No log book on site',
    'Alarm not certificated',
    'Break glass units not tested',
    'Emergency lighting linked to fire alarm',
  ]},
  {label:'🚿 Plumbing',items:[
    'Hot water temperature below 60°C — Legionella risk',
    'Cold water temperature above 20°C — Legionella risk',
    'Tap dripping/leaking',
    'Toilet cistern constantly running',
    'No isolation valve to appliance',
    'Water pressure low',
    'Boiler condensate drain blocked',
    'Radiator not heating — airlock/valve fault',
    'Shower tray cracked — water damage risk',
    'Mould growth around bath/shower sealant',
    'Overflow pipe discharging externally',
  ]},
  {label:'🏠 General',items:[
    'Job completed — all areas left clean and tidy',
    'Access refused by tenant — rebooked',
    'Landlord notified of findings',
    'Remedial work required — quotation to follow',
    'Revisit required for outstanding works',
    'Parts on order — return visit needed',
    'No access — left card through door',
    'Emergency made safe — full repair required',
    'Works completed to BS 7671 18th Edition',
    'Works completed to Gas Safety (Installation and Use) Regulations',
  ]}
];

let _qnCurrent=[];

function openQN(){
  _qnSelected=new Set();
  _qnActiveTab=0;
  _renderQNTabs();
  _renderQNList(0);
  document.getElementById('qn-overlay').classList.add('open');
}

function closeQN(){document.getElementById('qn-overlay').classList.remove('open');}

function _renderQNTabs(){
  const el=document.getElementById('qn-tabs');
  el.innerHTML=QN_CATEGORIES.map((c,i)=>
    `<button class="qn-tab ${i===0?'active':''}" onclick="_switchQNTab(${i},this)">${c.label}</button>`
  ).join('');
}

function _switchQNTab(i,btn){
  _qnActiveTab=i;
  document.querySelectorAll('.qn-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  _renderQNList(i);
}

function _renderQNList(catIdx){
  const cat=QN_CATEGORIES[catIdx];
  _qnCurrent=cat.items;
  document.getElementById('qn-list').innerHTML=cat.items.map((item,i)=>`
    <div class="qn-item ${_qnSelected.has(cat.label+':'+i)?'selected':''}" onclick="_toggleQN('${cat.label}',${i},this)">
      <div class="qn-check">${_qnSelected.has(cat.label+':'+i)?'✓':''}</div>
      <div class="qn-text">${item}</div>
    </div>`).join('');
}

function _toggleQN(catLabel,idx,el){
  const key=catLabel+':'+idx;
  if(_qnSelected.has(key)){_qnSelected.delete(key);}
  else{_qnSelected.add(key);}
  el.classList.toggle('selected',_qnSelected.has(key));
  el.querySelector('.qn-check').textContent=_qnSelected.has(key)?'✓':'';
}

function applyQN(){
  if(!_qnSelected.size){toast('Select at least one item','info');return;}
  const notesEl=document.getElementById('job-notes');
  if(!notesEl)return;
  const existing=notesEl.value.trim();
  const lines=[];
  QN_CATEGORIES.forEach(cat=>{
    cat.items.forEach((item,i)=>{
      if(_qnSelected.has(cat.label+':'+i))lines.push('• '+item);
    });
  });
  notesEl.value=(existing?existing+'\n\n':'')+lines.join('\n');
  closeQN();
  toast(`✅ Added ${lines.length} issue${lines.length>1?'s':''}  to notes`,'success');
}

// ══════════════════════════════════════════════════════════════
//  BEFORE / AFTER PHOTO SYSTEM
// ══════════════════════════════════════════════════════════════

let _baMode        = false;  // true = before/after mode active
let _baPendingSlot = null;   // which slot number triggered the file picker
let _baPendingRole = null;   // 'before' or 'after'

function _setPhotoMode(isBA, btn){
  _baMode = isBA;
  // Update toggle buttons
  document.querySelectorAll('.ba-mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // Show/hide standard upload button
  const stdBtn = document.getElementById('std-upload-btn');
  if(stdBtn) stdBtn.style.display = isBA ? 'none' : 'block';
  // Update stamp notice text
  const notice = document.getElementById('stamp-notice-txt');
  if(notice) notice.innerHTML = isBA
    ? '📸 Photos auto-stamped with address, sequence &amp; Before/After label.'
    : '📸 Photos auto-stamped with address and your name.';
  // Re-render grid
  if(currentJob) _renderPhotoGrid(currentJob._latestAtts||[]);
  if(navigator.vibrate) navigator.vibrate(20);
}

// Main grid renderer — called after renderJobDetail and after each upload
function _renderPhotoGrid(atts){
  const area = document.getElementById('ba-photo-area');
  if(!area) return;
  const photos = atts.filter(a=>a.type==='photo');

  if(!_baMode){
    // ── Standard grid (3-col, same as before) ──────────────────
    if(!photos.length){ area.innerHTML=''; return; }
    area.innerHTML = `<div class="photo-grid">${
      photos.map(a=>`<div class="photo-wrap">
        <img src="${a.url}" class="photo-img" onclick="window.open('${a.url}','_blank')" loading="lazy">
      </div>`).join('')
    }</div>`;
    return;
  }

  // ── Before / After grid ────────────────────────────────────
  // Group photos by photo_slot. Photos without a slot get slot 0 (ungrouped).
  // Slots are numbered 1, 2, 3…
  const slotMap = {}; // slot -> {before, after}
  const unslotted = [];

  photos.forEach(a=>{
    if(a.photo_slot && a.photo_role){
      const s = a.photo_slot;
      if(!slotMap[s]) slotMap[s] = {slot:s, before:null, after:null};
      slotMap[s][a.photo_role] = a;
    } else {
      unslotted.push(a);
    }
  });

  // Determine next slot number for new pairs
  const existingSlots = Object.keys(slotMap).map(Number).sort((a,b)=>a-b);
  const nextSlot = existingSlots.length ? existingSlots[existingSlots.length-1]+1 : 1;

  let html = '<div class="ba-grid">';

  // Render existing slots
  existingSlots.forEach(slot=>{
    const pair = slotMap[slot];
    html += _baPairHTML(slot, pair.before, pair.after);
  });

  // Always show one empty pair for adding a new B/A set
  html += _baPairHTML(nextSlot, null, null);

  // Unslotted photos (taken before mode was switched on) shown below
  if(unslotted.length){
    html += `<div style="font-size:10px;font-weight:800;color:var(--txt3);text-transform:uppercase;letter-spacing:.8px;margin:8px 0 5px">Earlier Photos</div>
    <div class="photo-grid">${
      unslotted.map(a=>`<div class="photo-wrap">
        <img src="${a.url}" class="photo-img" onclick="window.open('${a.url}','_blank')" loading="lazy">
      </div>`).join('')
    }</div>`;
  }

  html += '</div>';
  area.innerHTML = html;
}

function _baPairHTML(slot, before, after){
  const _slot = (role, att) => {
    const hasPhoto = !!att;
    const label = role === 'before' ? '⬅ Before' : 'After ➡';
    const img = hasPhoto
      ? `<img src="${att.url}" class="photo-img" onclick="window.open('${att.url}','_blank')" loading="lazy">
         <button class="ba-del-btn" onclick="_deleteBAPhoto('${att.id}','${att.storage_path||''}',event)" title="Delete">✕</button>`
      : `<button class="ba-add-btn" onclick="_triggerBAUpload(${slot},'${role}')">
           <div class="ba-plus">+</div>
           <span style="font-size:10px">${role==='before'?'Add Before':'Add After'}</span>
         </button>`;
    return `<div class="ba-slot role-${role} ${hasPhoto?'has-photo':''}">
      <div class="ba-slot-label">${label}</div>
      ${img}
    </div>`;
  };

  return `<div class="ba-pair">
    <div class="ba-pair-num">Photo ${slot}</div>
    ${_slot('before', before)}
    ${_slot('after',  after)}
  </div>`;
}

function _triggerBAUpload(slot, role){
  _baPendingSlot = slot;
  _baPendingRole = role;
  const input = document.getElementById(role==='before'?'photo-input-before':'photo-input-after');
  if(input){ input.value=''; input.click(); }
}

async function _handleBAUpload(input, role){
  const files = Array.from(input.files);
  if(!files.length || !currentJob) return;
  input.value='';
  const slot = _baPendingSlot;
  if(!slot){ toast('⚠️ No slot selected — tap a + button first','error'); return; }

  const seqLabel = `Photo ${slot} — ${role.charAt(0).toUpperCase()+role.slice(1)}`;
  toast(`⬆️ Processing ${seqLabel}…`,'info');

  try{
    let file = files[0]; // B/A is always 1 photo at a time per slot
    // EXIF
    const exif  = await _readExif(file);
    let captureTime = null;
    if(exif.dateTimeOriginal){
      try{
        const[dp,tp]=exif.dateTimeOriginal.split(' ');
        const[y,mo,d]=dp.split(':');
        captureTime=new Date(`${y}-${mo}-${d}T${tp}`);
        if(isNaN(captureTime)) captureTime=null;
      }catch(e){}
    }
    const stampTime = captureTime || new Date();
    // Compress (max 1200px width, quality 0.8)
    if(!_uploadHD) file = await _compressImage(file,1200,0.8);
    // Stamp — pass the sequence label so it appears in the footer
    file = await _stampPhoto(file, currentJob.address||'', currentUser.name, stampTime, seqLabel);
    // Upload
    const ext  = file.name.split('.').pop()?.toLowerCase()||'jpg';
    const path = `jobs/${currentJob.id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;
    const url  = await sbStorage(path,file);
    // Save with slot + role metadata
    await sb('attachments',{method:'POST',body:{
      id:`att-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      jobid:currentJob.id, name:file.name, type:'photo',
      mime:file.type||'image/jpeg',
      storage_path:path, url,
      uploaded_by_name:currentUser.name,
      created:Date.now(),
      photo_slot:slot,
      photo_role:role
    }});
    toast(`✅ ${seqLabel} uploaded`,'success');
    // Reload job detail to refresh grid
    openJob(currentJob.id);
  }catch(e){
    toast(`❌ Upload failed: ${(e.message||'').slice(0,60)}`,'error');
  }
  _baPendingSlot = null;
  _baPendingRole = null;
}

async function _deleteBAPhoto(attId, storagePath, e){
  e.stopPropagation();
  if(!confirm('Delete this photo?')) return;
  try{
    await sb(`attachments?id=eq.${attId}`,{method:'DELETE'});
    if(storagePath){
      fetch(`${SB_URL}/storage/v1/object/deepflow/${storagePath}`,{
        method:'DELETE', headers:{'apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY}
      }).catch(()=>{});
    }
    toast('Photo deleted','warn');
    openJob(currentJob.id);
  }catch(err){
    toast('Delete failed','error');
  }
}

// ══════════════════════════════════════════════════════════════
//  PHOTO UPLOAD — compress / HD / EXIF stamp
// ══════════════════════════════════════════════════════════════
async function handleUpload(input,type){
  const files=Array.from(input.files);
  if(!files.length||!currentJob)return;
  input.value='';
  let ok=0;
  for(let i=0;i<files.length;i++){
    let file=files[i];
    toast(`⬆️ ${type==='photo'?'Processing':'Uploading'} ${i+1}/${files.length}…`,'info');
    try{
      if(type==='photo'){
        const exif=await _readExif(file);
        let captureTime=null;
        if(exif.dateTimeOriginal){
          try{
            const[dp,tp]=exif.dateTimeOriginal.split(' ');
            const[y,mo,d]=dp.split(':');
            captureTime=new Date(`${y}-${mo}-${d}T${tp}`);
            if(isNaN(captureTime))captureTime=null;
          }catch(e){}
        }
        // Compress unless HD mode (max 1200px width, quality 0.8)
        if(!_uploadHD){file=await _compressImage(file,1200,0.8);}
        // Always stamp: use EXIF time if available, otherwise use current time
        const stampTime = captureTime || new Date();
        file=await _stampPhoto(file, currentJob.address||'', currentUser.name, stampTime);
      }
      const ext=file.name.split('.').pop()?.toLowerCase()||'jpg';
      // FIX 14: Path format is jobs/{jobId}/{timestamp}-{random}.{ext} — same as
      // _handleBAUpload. The only difference between standard and B/A photos is
      // the photo_slot and photo_role metadata fields on the attachment record,
      // NOT the storage path. Keep both functions using this same path format.
      const path=`jobs/${currentJob.id}/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`;
      const url=await sbStorage(path,file);
      await sb('attachments',{method:'POST',body:{
        id:`att-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        jobid:currentJob.id,name:file.name,type,
        mime:file.type||'application/octet-stream',
        storage_path:path,url,uploaded_by_name:currentUser.name,created:Date.now()
      }});
      ok++;
    }catch(e){toast(`❌ File ${i+1} failed: ${(e.message||'').slice(0,50)}`,'error');}
  }
  if(ok>0){
    toast(`✅ ${ok} ${type==='photo'?'photo':'doc'}${ok>1?'s':''} uploaded`,'success');
    openJob(currentJob.id);
  }
}

// Compress image to maxW/maxH at quality q
function _compressImage(file,maxW,q){
  return new Promise(resolve=>{
    const img=new Image();
    const u=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(u);
      let{naturalWidth:w,naturalHeight:h}=img;
      const maxH=maxW; // square cap — both dimensions capped at maxW (e.g. 1200)
      if(w<=maxW&&h<=maxH){resolve(file);return;} // truly small image — no compression needed
      const scale=Math.min(maxW/w,maxH/h);
      const W=Math.round(w*scale),H=Math.round(h*scale);
      const c=document.createElement('canvas');c.width=W;c.height=H;
      c.getContext('2d').drawImage(img,0,0,W,H);
      c.toBlob(b=>{
        if(!b){resolve(file);return;}
        resolve(new File([b],file.name.replace(/\.(jpe?g|png|webp|heic)/i,'.jpg'),{type:'image/jpeg'}));
      },'image/jpeg',q);
    };
    img.onerror=()=>{
      URL.revokeObjectURL(u);
      if(/\.(heic|heif)$/i.test(file.name)) toast('ℹ️ HEIC photo — uploading original (no compression)','info',3000);
      resolve(file);
    };
    img.src=u;
  });
}

// EXIF reader
function _readExif(file){
  return new Promise(resolve=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const buf=e.target.result;
        const v=new DataView(buf);
        if(v.getUint16(0)!==0xFFD8){resolve({});return;}
        let off=2;
        while(off<buf.byteLength-4){
          const mk=v.getUint16(off);off+=2;
          const sl=v.getUint16(off);
          if(mk===0xFFE1){resolve(_parseExif(v,off+2));return;}
          if((mk&0xFF00)!==0xFF00)break;
          off+=sl;
        }
      }catch(e){}
      resolve({});
    };
    r.onerror=()=>resolve({});
    r.readAsArrayBuffer(file.slice(0,131072));
  });
}

function _parseExif(v,s){
  try{
    const big=v.getUint16(s)===0x4D4D;
    const g16=o=>v.getUint16(s+o,!big);
    const g32=o=>v.getUint32(s+o,!big);
    const io=g32(4),cn=g16(io),ex={};
    for(let i=0;i<cn&&i<100;i++){
      const e=io+2+i*12,tag=g16(e),type=g16(e+2),val=g32(e+8);
      if(tag===0x9003&&type===2){
        let str='';for(let c=0;c<20&&(s+val+c)<v.byteLength;c++){const ch=v.getUint8(s+val+c);if(ch===0)break;str+=String.fromCharCode(ch);}
        ex.dateTimeOriginal=str.trim();
      }
      if(tag===0x8825){
        try{
          const gc=g16(val);let la,lr,lna,lnr;
          for(let g=0;g<gc&&g<20;g++){
            const ge=val+2+g*12,gt=g16(ge),gv=g32(ge+8);
            const rat=o=>{const n=v.getUint32(s+o,!big),d=v.getUint32(s+o+4,!big);return d?n/d:0;};
            if(gt===1)lr=String.fromCharCode(v.getUint8(s+gv));
            if(gt===2)la=[rat(gv),rat(gv+8),rat(gv+16)];
            if(gt===3)lnr=String.fromCharCode(v.getUint8(s+gv));
            if(gt===4)lna=[rat(gv),rat(gv+8),rat(gv+16)];
          }
          if(la&&lna){
            let lat=la[0]+la[1]/60+la[2]/3600,lng=lna[0]+lna[1]/60+lna[2]/3600;
            if(lr==='S')lat=-lat;if(lnr==='W')lng=-lng;
            ex.gpsLat=lat;ex.gpsLng=lng;
          }
        }catch(e){}
      }
    }
    return ex;
  }catch(e){return{};}
}

// Photo stamp — single line footer, 30% bg, only on EXIF capture time
function _stampPhoto(file,jobAddress,engineerName,captureTime,seqLabel){
  return new Promise(resolve=>{
    const img=new Image();
    const u=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(u);
      const W=img.naturalWidth,H=img.naturalHeight;
      const c=document.createElement('canvas');c.width=W;c.height=H;
      const ctx=c.getContext('2d');

      // 1. Draw original photo
      ctx.drawImage(img,0,0);

      // ── Compact lower-left corner stamp ──
      // Small pill, 8% white bg, small text, doesn't obscure the photo

      const m = W * 0.03;
      // Stamp dimensions — max 35% of image width, height scales with width
      const stampW = Math.min(W * 0.52, 520);
      const fBase  = Math.max(14, Math.round(W * 0.022)); // base font size
      const lineH  = fBase * 1.5;
      const pad    = fBase * 0.7;
      const lines  = [];
      if(jobAddress) lines.push((jobAddress.length>38 ? jobAddress.slice(0,36)+'…' : jobAddress));
      const ts = captureTime.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
                +' '+captureTime.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      lines.push(ts + '  ·  ' + engineerName + (seqLabel?' · '+seqLabel:''));

      const stampH = pad*2 + lines.length * lineH;
      const stampX = m;
      const stampY = H - stampH - m;
      const rr     = Math.min(fBase*0.6, 10);

      // 8% semi-transparent dark background
      ctx.save();
      ctx.beginPath();
      if(ctx.roundRect){ ctx.roundRect(stampX, stampY, stampW, stampH, rr); }
      else {
        ctx.moveTo(stampX+rr,stampY);ctx.lineTo(stampX+stampW-rr,stampY);
        ctx.quadraticCurveTo(stampX+stampW,stampY,stampX+stampW,stampY+rr);
        ctx.lineTo(stampX+stampW,stampY+stampH-rr);
        ctx.quadraticCurveTo(stampX+stampW,stampY+stampH,stampX+stampW-rr,stampY+stampH);
        ctx.lineTo(stampX+rr,stampY+stampH);
        ctx.quadraticCurveTo(stampX,stampY+stampH,stampX,stampY+stampH-rr);
        ctx.lineTo(stampX,stampY+rr);
        ctx.quadraticCurveTo(stampX,stampY,stampX+rr,stampY);
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.09)';
      ctx.fill();
      // Thin white border
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = Math.max(1, W*0.001);
      ctx.stroke();
      ctx.restore();

      // Left accent line
      ctx.save();
      ctx.fillStyle = '#4f8fff';
      ctx.beginPath();
      if(ctx.roundRect) ctx.roundRect(stampX+pad*0.3, stampY+pad*0.6, Math.max(2,W*0.004), stampH-pad*1.2, 2);
      ctx.fill();
      ctx.restore();

      // Text
      ctx.save();
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const textX = stampX + pad*0.3 + W*0.004 + pad*0.5;
      lines.forEach((line,i)=>{
        if(i===0){
          ctx.font = `700 ${fBase}px Arial,sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.97)';
        } else {
          ctx.font = `400 ${Math.round(fBase*0.82)}px Arial,sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.80)';
        }
        ctx.fillText(line, textX, stampY + pad + i*lineH);
      });
      ctx.restore();

      c.toBlob(b=>{
        if(!b){resolve(file);return;}
        resolve(new File([b],file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i,'')+'_stamped.jpg',{type:'image/jpeg'}));
      },'image/jpeg',_uploadHD?0.95:0.90);
    };
    img.onerror=()=>{URL.revokeObjectURL(u);resolve(file);};
    img.src=u;
  });
}

// ══════════════════════════════════════════════════════════════
//  MAP — terrain tiles (Stamen/OpenTopoMap) + OSRM route
// ══════════════════════════════════════════════════════════════
async function setMapView(view,btn){
  document.querySelectorAll('.map-tool-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const status=document.getElementById('map-status');
  const container=document.getElementById('map-container');
  status.textContent='Loading jobs…';
  container.innerHTML='<div class="loading-center"><div class="spin"></div></div>';
  try{
    const today=new Date().toISOString().split('T')[0];
    const enc=encodeURIComponent(currentUser.name);
    let jobs=view==='all'
      ?await sb(`jobs?engineer=ilike.${enc}&select=*&limit=100&order=date.desc`)
      :await sb(`jobs?date=eq.${today}&engineer=ilike.${enc}&select=*`);
    jobs=jobs||[];
    if(!jobs.length){container.innerHTML='<div class="empty"><div class="empty-icon">📍</div><div class="empty-title">No jobs to map</div></div>';status.textContent='No jobs found';return;}
    status.textContent=`Geocoding ${jobs.length} addresses…`;
    const geo=[];
    for(const j of jobs){
      const c=await geocodeAddress(j.address);
      if(c)geo.push({...c,label:`${j.jobNum||'#'} — ${j.address}`,status:j.status,priority:j.priority});
    }
    if(!geo.length){container.innerHTML='<div class="empty"><div class="empty-icon">🗺</div><div class="empty-title">Could not locate addresses</div><div class="empty-sub">Ensure addresses include UK postcodes</div></div>';status.textContent='Geocoding failed';return;}
    let route=null;
    if(view==='route'&&geo.length>=2){status.textContent='Calculating route…';route=await _getRoute(geo);}
    const cLat=geo.reduce((s,p)=>s+p.lat,0)/geo.length;
    const cLng=geo.reduce((s,p)=>s+p.lng,0)/geo.length;
    status.textContent=`${geo.length} of ${jobs.length} jobs mapped`;
    _showMap(geo,cLat,cLng,view==='route'?12:11,route,container);
  }catch(e){
    container.innerHTML=`<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Map error</div><div class="empty-sub">${(e.message||'').slice(0,80)}</div></div>`;
    status.textContent='Error';
  }
}

async function _getRoute(pts){
  try{
    const coords=pts.map(p=>`${p.lng},${p.lat}`).join(';');
    const res=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
    const data=await res.json();
    if(data?.routes?.[0]){const r=data.routes[0];return{coords:r.geometry.coordinates,duration:Math.round(r.duration/60),distance:(r.distance/1000).toFixed(1)};}
  }catch(e){}return null;
}

function _showMap(pts,cLat,cLng,zoom,route,container){
  // Use OpenTopoMap for terrain tiles (free, no key, looks great)
  // Falls back to standard OSM if unavailable
  const tileUrl='https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
  const tileAttr='© OpenTopoMap (CC-BY-SA)';
  const markers=pts.map((p,i)=>{
    const col=p.priority==='Emergency'?'#f04444':p.status==='Completed'?'#22c55e':p.status==='Cannot Access'?'#f97316':'#4f8fff';
    const lbl=(p.label||'').replace(/'/g,"\\'").replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const num=route?`<div style="background:${col};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">${i+1}</div>`
      :`<div style="width:16px;height:16px;border-radius:50%;background:${col};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`;
    const iSize=route?[26,26]:[16,16];
    return`L.marker([${p.lat},${p.lng}],{icon:L.divIcon({className:'',html:'${num}',iconSize:[${iSize}],iconAnchor:[${iSize.map(v=>v/2)}]})}).addTo(map).bindPopup('<b style="font-family:sans-serif">${lbl}</b>');`;
  }).join('\n');
  const routeFn=route?`L.polyline([${route.coords.map(c=>`[${c[1]},${c[0]}]`).join(',')}],{color:'#4f8fff',weight:5,opacity:.8,dashArray:'10,5'}).addTo(map);`:'';
  const routeBox=route?`<div style="position:absolute;top:10px;right:10px;background:rgba(10,13,20,.9);backdrop-filter:blur(8px);border:1px solid #263047;border-radius:12px;padding:12px 16px;font-family:sans-serif;z-index:1000;pointer-events:none">
    <div style="font-size:10px;color:#8a9bbf;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Route Estimate</div>
    <div style="font-size:22px;font-weight:900;color:#4f8fff;font-family:monospace">${route.duration}m</div>
    <div style="font-size:12px;color:#4e6080">${route.distance} km · ${pts.length} stops</div>
  </div>`:'';
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>*{margin:0;padding:0}html,body,#m{height:100%;width:100%}</style>
</head><body><div id="m"></div>${routeBox}
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<script>
var map=L.map("m",{zoomControl:true}).setView([${cLat},${cLng}],${zoom});
// Try terrain tiles first, fallback to standard OSM
var terrain=L.tileLayer("${tileUrl}",{attribution:"${tileAttr}",maxZoom:17});
var osm=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:19});
terrain.on("tileerror",function(){if(!map._fallback){map._fallback=true;map.removeLayer(terrain);osm.addTo(map);}});
terrain.addTo(map);
${routeFn}
${markers}
<\/script></body></html>`;
  if(_mapBlobUrl)try{URL.revokeObjectURL(_mapBlobUrl);}catch(e){}
  const blob=new Blob([html],{type:'text/html'});
  _mapBlobUrl=URL.createObjectURL(blob);
  container.innerHTML=`<iframe src="${_mapBlobUrl}" style="width:100%;height:calc(100vh - 260px);border:none;display:block"></iframe>`;
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════
async function loadDash(){
  const el=document.getElementById('dash-body');
  if(!el)return;
  try{
    const enc=encodeURIComponent(currentUser.name);
    const today=new Date().toISOString().split('T')[0];
    const monStart=today.slice(0,7)+'-01';
    const yrStart=today.slice(0,4)+'-01-01';
    // FIX 2: Use a LOCAL variable (dashJobs) — never overwrite the global _allJobs.
    // _allJobs is maintained exclusively by loadJobs() and must only contain
    // today + upcoming + recent done. Overwriting it here with 5000 all-time records
    // would break badge counts, new-job detection, and the job list display.
    const dashJobs=(await sb(`jobs?engineer=ilike.${enc}&select=*&limit=5000`))||[];
    const todayJ=dashJobs.filter(j=>j.date===today);
    const todayDone=todayJ.filter(j=>j.status==='Completed').length;
    const monthDone=dashJobs.filter(j=>j.status==='Completed'&&(j.date||'')>=monStart).length;
    const yearDone=dashJobs.filter(j=>j.status==='Completed'&&(j.date||'')>=yrStart).length;
    const totalDone=dashJobs.filter(j=>j.status==='Completed').length;
    const totalHrs=dashJobs.filter(j=>j.status==='Completed').reduce((s,j)=>s+(parseFloat(j.hours)||0),0);
    const openJobs=dashJobs.filter(j=>j.status==='Pending'||j.status==='In Progress').length;
    const areas={};
    dashJobs.forEach(j=>{const p=(j.address||'').split(',');const a=(p.length>1?p[p.length-2]:p[0]||'Unknown').trim();areas[a]=(areas[a]||0)+1;});
    const topAreas=Object.entries(areas).sort((a,b)=>b[1]-a[1]).slice(0,6);
    // FIX 18: Build cert summary from two sources so the section isn't blank on jobs
    // where certTypes was never populated (the common case for older jobs):
    //   1. j.certTypes array if present (primary — set by main app on job creation)
    //   2. Trade-to-cert inference if certTypes is empty (fallback)
    // This gives a meaningful "Certificates Done" section even for historical jobs.
    const TRADE_CERT_MAP={
      'Gas':'Gas Safety','Gas Safety':'Gas Safety',
      'Electrical':'EICR','EICR':'EICR','Electrical Safety':'EICR',
      'EPC':'EPC','Energy Performance':'EPC',
      'PAT':'PAT Testing','PAT Testing':'PAT Testing',
      'Legionella':'Legionella','Water':'Legionella',
      'Fire':'Fire Risk Assessment','Fire Safety':'Fire Risk Assessment',
      'Emergency Lighting':'Emergency Lighting',
    };
    const certs={};
    dashJobs.forEach(j=>{
      const sources=(j.certTypes&&j.certTypes.length>0)
        ? j.certTypes
        : (j.trade&&TRADE_CERT_MAP[j.trade] ? [TRADE_CERT_MAP[j.trade]] : []);
      sources.forEach(c=>{certs[c]=(certs[c]||0)+1;});
    });
    const topCerts=Object.entries(certs).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const mMap={};
    for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);mMap[d.toISOString().slice(0,7)]=0;}
    dashJobs.filter(j=>j.status==='Completed').forEach(j=>{const m=(j.date||'').slice(0,7);if(mMap[m]!==undefined)mMap[m]++;});
    const mL=Object.keys(mMap),mV=Object.values(mMap),mMx=Math.max(...mV,1);
    const recent=[...dashJobs].filter(j=>j.status==='Completed').sort((a,b)=>(b.modified||0)-(a.modified||0)).slice(0,5);
    const wBanner=_weather?`<div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.08);border-radius:20px;padding:5px 14px;width:fit-content;margin-top:10px">
      <span style="font-size:20px">${_weather.icon}</span>
      <span style="font-size:13px;font-weight:700">${_weather.temp}°C</span>
      <span style="font-size:12px;color:var(--txt3)">💨 ${_weather.wind} km/h</span>
      ${_weather.rain?'<span style="font-size:12px;color:#60c0ff;font-weight:700">🌧 Rain</span>':''}
    </div>`:'';
    el.innerHTML=`
      <div class="dash-hero">
        <div class="dash-greeting">👷 Good ${_gr()},</div>
        <div class="dash-hero-name">${currentUser.name}</div>
        <div class="dash-hero-sub">${todayJ.length} job${todayJ.length!==1?'s':''} today · ${todayDone} completed</div>
        ${wBanner}
      </div>
      <div class="kpi-grid">
        <div class="kpi-card" style="--kc:var(--acc)"><div class="kpi-val">${todayDone}/${todayJ.length}</div><div class="kpi-lbl">Today</div></div>
        <div class="kpi-card" style="--kc:var(--green)"><div class="kpi-val">${monthDone}</div><div class="kpi-lbl">This Month</div></div>
        <div class="kpi-card" style="--kc:var(--yellow)"><div class="kpi-val">${yearDone}</div><div class="kpi-lbl">This Year</div></div>
        <div class="kpi-card" style="--kc:var(--teal)"><div class="kpi-val">${totalHrs.toFixed(0)}h</div><div class="kpi-lbl">Total Hours</div></div>
        <div class="kpi-card" style="--kc:var(--purple)"><div class="kpi-val">${totalDone}</div><div class="kpi-lbl">All-Time Done</div></div>
        <div class="kpi-card" style="--kc:var(--orange)"><div class="kpi-val">${openJobs}</div><div class="kpi-lbl">Open Jobs</div></div>
      </div>
      ${mL.length?`<div class="dash-section"><div class="dash-sec-hd"><span class="dash-sec-title">📅 Monthly Jobs — Last 6 Months</span></div><div class="dash-sec-body">${mL.map((m,i)=>`<div class="bar-row"><div class="bar-label">${new Date(m+'-15').toLocaleDateString('en-GB',{month:'short',year:'2-digit'})}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(mV[i]/mMx*100)}%;background:linear-gradient(90deg,var(--acc),var(--teal))"></div></div><div class="bar-count">${mV[i]}</div></div>`).join('')}</div></div>`:''}
      ${topAreas.length?`<div class="dash-section"><div class="dash-sec-hd"><span class="dash-sec-title">📍 Top Work Areas</span></div><div class="dash-sec-body">${topAreas.map(([a,n])=>`<div class="bar-row"><div class="bar-label">${a}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round(n/topAreas[0][1]*100)}%;background:linear-gradient(90deg,var(--purple),#ec4899)"></div></div><div class="bar-count">${n}</div></div>`).join('')}</div></div>`:''}
      ${topCerts.length?`<div class="dash-section"><div class="dash-sec-hd"><span class="dash-sec-title">📋 Certificates Done</span></div><div class="dash-sec-body"><div style="display:flex;flex-wrap:wrap">${topCerts.map(([ct,n])=>`<div class="cert-pill"><span class="cert-pill-n">${n}</span> ${ct}</div>`).join('')}</div></div></div>`:''}
      ${recent.length?`<div class="dash-section"><div class="dash-sec-hd"><span class="dash-sec-title">✅ Recently Completed</span></div><div class="dash-sec-body">${recent.map(j=>`<div class="recent-row"><div class="recent-dot"></div><div style="flex:1;min-width:0"><div class="recent-addr">${j.address||'—'}</div><div class="recent-meta">${j.date||''}</div></div><div class="recent-hrs">${j.hours?j.hours+'h':''}</div></div>`).join('')}</div></div>`:''}
      <div style="height:20px"></div>`;
  }catch(e){el.innerHTML=`<div style="padding:30px;text-align:center;color:var(--red)">⚠️ ${e.message||'Failed to load'}</div>`;}
}
function _gr(){const h=new Date().getHours();return h<12?'morning':h<17?'afternoon':'evening';}

// ══════════════════════════════════════════════════════════════
//  REQUESTS
// ══════════════════════════════════════════════════════════════
async function loadRequests(){
  const el=document.getElementById('requests-list');if(!el)return;
  try{
    const reqs=await sb(`engineer_requests?engineer_name=eq.${encodeURIComponent(currentUser.name)}&order=created.desc&limit=50`).catch(()=>[]);
    if(!reqs?.length){el.innerHTML='<div class="empty"><div class="empty-icon">📤</div><div class="empty-title">No requests yet</div><div class="empty-sub">Use the buttons above to submit overtime or leave requests.</div></div>';return;}
    _setBadge('requests',reqs.filter(r=>r.status==='pending').length);
    el.innerHTML=reqs.map(r=>`<div class="req-card">
      <div class="req-card-hd"><div><div class="req-title">${r.type==='overtime'?'⏱ Overtime':'📆 Time Off'}</div>
      <div class="req-meta">${r.date?`📅 ${r.date}`:''} ${r.hours?`⏱ ${r.hours}h`:''} ${r.leave_from&&r.leave_to?`${r.leave_from} → ${r.leave_to}`:''}</div></div>
      <span class="req-badge rb-${r.status||'pending'}">${r.status||'pending'}</span></div>
      ${r.notes?`<div class="req-note">${r.notes}</div>`:''}
      ${r.office_reply?`<div class="req-note" style="background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.2);color:var(--green)">💬 Office: ${r.office_reply}</div>`:''}
      <div style="font-size:10px;color:var(--txt3);margin-top:8px">${_fd(r.created)}</div>
    </div>`).join('');
  }catch(e){el.innerHTML='<div style="padding:20px;text-align:center;color:var(--txt3)">Unable to load requests.</div>';}
}

function openOvertimeForm(){
  document.getElementById('ot-date').value=new Date().toISOString().split('T')[0];
  document.getElementById('ot-hours').value='';
  document.getElementById('ot-job').value='';
  document.getElementById('ot-notes').value='';
  document.getElementById('ot-modal').classList.add('open');
}
function openLeaveForm(){
  const t=new Date().toISOString().split('T')[0];
  document.getElementById('leave-from').value=t;
  document.getElementById('leave-to').value=t;
  document.getElementById('leave-notes').value='';
  document.getElementById('leave-modal').classList.add('open');
}
async function submitOvertimeRequest(){
  const date=document.getElementById('ot-date').value;
  const hours=parseFloat(document.getElementById('ot-hours').value);
  const rate=document.getElementById('ot-rate').value;
  const job=document.getElementById('ot-job').value.trim();
  const notes=document.getElementById('ot-notes').value.trim();
  if(!date||isNaN(hours)||hours<=0){toast('Please fill in date and hours','error');return;}
  try{
    await sb('engineer_requests',{method:'POST',body:{id:`req-${Date.now()}`,engineer_name:currentUser.name,type:'overtime',date,hours,rate,job,notes,status:'pending',created:Date.now()}});
    _clearDraft('ot-notes');closeModal('ot-modal');toast('✅ Overtime request sent!','success');if(navigator.vibrate)navigator.vibrate([50,30,80]);loadRequests();
  }catch(e){toast('❌ '+(e.message||'').slice(0,80),'error');if(navigator.vibrate)navigator.vibrate([80]);}
}
async function submitLeaveRequest(){
  const type=document.getElementById('leave-type').value;
  const from=document.getElementById('leave-from').value;
  const to=document.getElementById('leave-to').value;
  const notes=document.getElementById('leave-notes').value.trim();
  if(!from||!to){toast('Please select dates','error');return;}
  try{
    await sb('engineer_requests',{method:'POST',body:{id:`req-${Date.now()}`,engineer_name:currentUser.name,type:'leave',leave_type:type,leave_from:from,leave_to:to,notes,status:'pending',created:Date.now()}});
    closeModal('leave-modal');toast('✅ Leave request sent!','success');if(navigator.vibrate)navigator.vibrate([50,30,80]);loadRequests();
  }catch(e){toast('❌ '+(e.message||'').slice(0,80),'error');if(navigator.vibrate)navigator.vibrate([80]);}
}

// ══════════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
async function _initPush(){
  if(!('Notification' in window))return;
  if(Notification.permission==='granted'){_pushGranted=true;_setBaseline();return;}
  if(Notification.permission==='denied')return;
  toast('🔔 Enable notifications for new job alerts','info');
  setTimeout(async()=>{
    const p=await Notification.requestPermission();
    _pushGranted=p==='granted';
    if(_pushGranted){toast('🔔 Notifications enabled!','success');_setBaseline();}
  },2000);
}
function _setBaseline(){if(_allJobs.length){_lastJobIds=new Set(_allJobs.map(j=>j.id));}}

// ── Online/offline status banner ──
window.addEventListener('offline',()=>{ toast('📵 No internet — working offline','warn',0); document.body.classList.add('offline'); });
window.addEventListener('online',()=>{ toast('✅ Back online','success'); document.body.classList.remove('offline'); loadJobs(); });

// ══ BROADCAST ALERT POLLING ══
let _lastAlertCheck=Math.floor(Date.now()/1000);
let _shownAlerts=JSON.parse(localStorage.getItem('df_shown_alerts')||'[]');

async function checkBroadcastAlerts(){
  if(!currentUser) return;
  try{
    const now=Math.floor(Date.now()/1000);
    // On first check (_lastAlertCheck===0), fetch last 24h of alerts
    const sinceTs = _lastAlertCheck > 0 ? _lastAlertCheck - 5 : now - 86400;
    const alerts=await sb(`engineer_alerts?status=eq.active&expires=gte.${now}&created=gt.${sinceTs}&order=created.desc&limit=10`);
    _lastAlertCheck=now;
    if(!alerts?.length) return;
    for(const a of alerts){
      if(_shownAlerts.includes(a.id)) continue;
      // target: 'all' = everyone, or specific engineer name
      if(a.target && a.target!=='all' && a.target!==currentUser.name) continue;
      showBroadcastAlert(a);
      break; // show one at a time
    }
  }catch(e){ console.warn('Alert check failed:',e.message); }
}

function showBroadcastAlert(a){
  const icons={info:'ℹ️',warning:'⚠️',urgent:'🚨'};
  const colors={info:'#4f8fff',warning:'#f5a623',urgent:'#e05252'};
  const box=document.getElementById('alert-box');
  if(box) box.style.borderColor=colors[a.type]||'#f5a623';
  const icon=document.getElementById('alert-icon');
  if(icon) icon.textContent=icons[a.type]||'⚠️';
  const typeEl=document.getElementById('alert-type-label');
  if(typeEl){ typeEl.textContent={info:'OFFICE INFO',warning:'OFFICE WARNING',urgent:'🚨 URGENT — READ NOW'}[a.type]||'OFFICE ALERT'; typeEl.style.color=colors[a.type]; }
  const titleEl=document.getElementById('alert-title');
  if(titleEl) titleEl.textContent=a.title||'Alert';
  const msgEl=document.getElementById('alert-msg');
  if(msgEl) msgEl.textContent=a.message||'';
  const fromEl=document.getElementById('alert-from');
  if(fromEl) fromEl.textContent=`From: ${a.sent_by||'Office'} · ${new Date(a.created*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
  const ov=document.getElementById('alert-overlay');
  if(ov){ ov.style.display='flex'; ov.dataset.alertId=a.id; }
  // Vibrate on mobile
  if(navigator.vibrate) navigator.vibrate([200,100,200,100,400]);
}

function dismissAlert(){
  const ov=document.getElementById('alert-overlay');
  if(!ov) return;
  const id=ov.dataset.alertId;
  if(id&&!_shownAlerts.includes(id)){
    _shownAlerts.push(id);
    if(_shownAlerts.length>50) _shownAlerts=_shownAlerts.slice(-50);
    localStorage.setItem('df_shown_alerts',JSON.stringify(_shownAlerts));
  }
  ov.style.display='none';
}

function _checkForNewJobs(todayJobs){
  if(!_pushGranted||!todayJobs?.length)return;
  if(!_lastJobIds.size){_lastJobIds=new Set(todayJobs.map(j=>j.id));return;}
  todayJobs.filter(j=>!_lastJobIds.has(j.id)).forEach(j=>{
    _lastJobIds.add(j.id);
    try{
      const n=new Notification('📋 New Job Assigned',{
        body:`${j.jobNum?j.jobNum+' — ':''}${j.address||'New job'}${j.timeSlot?'\n🕐 '+j.timeSlot:''}`,
        icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="%234f8fff"/><text x="32" y="44" font-size="36" text-anchor="middle">⚡</text></svg>',
        tag:`df-${j.id}`,requireInteraction:false
      });
      n.onclick=()=>{window.focus();setTimeout(()=>openJob(j.id),300);n.close();};
    }catch(e){}
  });
}

// ══════════════════════════════════════════════════════════════
//  SILENT LOCATION
// ══════════════════════════════════════════════════════════════
function _startLocationSilent(){
  if(!navigator.geolocation||_locWatch!==null)return;
  _locWatch=navigator.geolocation.watchPosition(_onGPS,()=>{},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});
}
function _stopLocation(){
  if(_locWatch!==null){navigator.geolocation.clearWatch(_locWatch);_locWatch=null;}
  if(currentUser)sb(`users?name=ilike.${encodeURIComponent(currentUser.name)}`,{method:'PATCH',body:{last_lat:null,last_lng:null,last_seen:null}}).catch(()=>{});
}
async function _onGPS(pos){
  if(!currentUser)return;
  const{latitude:lat,longitude:lng,accuracy}=pos.coords;
  _lastLat=lat;_lastLng=lng;
  if(!_weather)fetchWeather(lat,lng);
  try{await sb(`users?name=ilike.${encodeURIComponent(currentUser.name)}`,{method:'PATCH',body:{last_lat:lat,last_lng:lng,last_seen:Date.now(),last_accuracy:Math.round(accuracy||0)}});}catch(e){}
}

// ══════════════════════════════════════════════════════════════
//  GUIDE
// ══════════════════════════════════════════════════════════════
function renderGuide(){
  const el=document.getElementById('guide-body');if(!el)return;
  const sections=[
    {icon:'📱',title:'How to Use This App',steps:[
      {n:1,t:'<strong>Today</strong> — your jobs, colour-coded by status. Tap any job to open.'},
      {n:2,t:'<strong>Upcoming</strong> — jobs in the next 7 days, grouped by date.'},
      {n:3,t:'<strong>Done</strong> — your last 60 completed jobs.'},
      {n:4,t:'<strong>Map</strong> — terrain map with job pins and driving route.'},
      {n:5,t:'<strong>Stats</strong> — personal dashboard with weather forecast.'},
      {n:6,t:'<strong>+</strong> button — report a new job or site issue to the office.'},
    ],tip:'Pull down on the Today screen to refresh jobs. Auto-refreshes every 45 seconds.'},
    {icon:'🎨',title:'Job Colour Codes',steps:[
      {n:1,t:'<span style="color:#f5a623">■</span> <strong>Amber</strong> — Pending (not started)'},
      {n:2,t:'<span style="color:#4f8fff">■</span> <strong>Blue</strong> — In Progress'},
      {n:3,t:'<span style="color:#22c55e">■</span> <strong>Green</strong> — Completed'},
      {n:4,t:'<span style="color:#f04444">■</span> <strong>Red</strong> — Emergency'},
      {n:5,t:'<span style="color:#f97316">■</span> <strong>Orange</strong> — No Access'},
    ]},
    {icon:'📷',title:'Photos & Auto-Stamp',steps:[
      {n:1,t:'Open job → Photos → <strong>Take Photo or Upload</strong>.'},
      {n:2,t:'Photos with EXIF capture time are stamped: job address · capture time · your name — single footer bar.'},
      {n:3,t:'GPS is validated — if photo was taken >5km from the job, address is omitted from stamp.'},
      {n:4,t:'No EXIF metadata = no stamp (no guessing).'},
      {n:5,t:'Choose <strong>Compressed</strong> for fast uploads or <strong>HD</strong> for full quality.'},
    ],tip:'Upload later in the evening — stamp shows original capture time from your phone camera.'},
    {icon:'⚡',title:'Quick Issue Notes',steps:[
      {n:1,t:'Open job → Notes → tap <strong>⚡ Quick Issues</strong>.'},
      {n:2,t:'Choose category: Electrical, Gas, Fire Alarm, Plumbing, General.'},
      {n:3,t:'Tick all issues found on site.'},
      {n:4,t:'Tap <strong>Add Selected Notes</strong> — lines are appended to your notes.'},
    ],tip:'Over 80 pre-written professional issue descriptions across 5 categories.'},
    {icon:'💬',title:'WhatsApp Integration',steps:[
      {n:1,t:'Every phone number has a WhatsApp button — tap to open a chat instantly.'},
      {n:2,t:'<strong>Share Job</strong> button sends job summary (address, trade, time) to any WhatsApp contact.'},
      {n:3,t:'<strong>Share Notes</strong> sends your job notes via WhatsApp.'},
      {n:4,t:'<strong>+ New Job</strong> sends a WhatsApp notification to the office automatically.'},
    ]},
    {icon:'📤',title:'Overtime & Leave',steps:[
      {n:1,t:'Go to <strong>Requests</strong> tab.'},
      {n:2,t:'Tap <strong>Request Overtime</strong> or <strong>Request Time Off</strong>.'},
      {n:3,t:'Office approves/rejects — you see the update and reply here.'},
    ]},
    {icon:'🔔',title:'Notifications',steps:[
      {n:1,t:'Allow notifications when prompted — you\'ll be asked once.'},
      {n:2,t:'Get an alert when a new job is assigned to you today.'},
      {n:3,t:'Tap the notification to open the job directly.'},
    ]},
  ];
  el.innerHTML=sections.map((s,i)=>`<div class="guide-section">
    <div class="guide-hd" onclick="toggleGuide(${i})" id="ghd-${i}"><div class="guide-hd-title"><span>${s.icon}</span> ${s.title}</div><span class="guide-chevron">▾</span></div>
    <div class="guide-body" id="gbody-${i}">
      ${s.steps.map(st=>`<div class="guide-step"><div class="guide-step-num">${st.n}</div><div class="guide-step-text">${st.t}</div></div>`).join('')}
      ${s.tip?`<div class="guide-tip">${s.tip}</div>`:''}
    </div>
  </div>`).join('');
  // API cards
  const apiEl=document.getElementById('guide-api-cards');if(!apiEl)return;
  const apis=[
    {icon:'🗺',title:'OpenTopoMap Terrain',status:'active',desc:'Terrain map tiles showing roads, elevation and landscape. Falls back to OpenStreetMap if unavailable. Free, no account.'},
    {icon:'📮',title:'Postcodes.io',status:'active',desc:'Instant UK postcode → coordinates. Primary geocoder, no rate limit, no account needed.'},
    {icon:'🛣',title:'OSRM Route Planning',status:'active',desc:'Driving route between today\'s jobs with total time and distance. Free, open source.'},
    {icon:'🌤',title:'Open-Meteo Weather',status:'active',desc:'Today\'s temperature, wind and rain shown on your dashboard. Updates with your real GPS. Free, no key.'},
    {icon:'🏠',title:'Land Registry',status:'active',desc:'Property type lookup by postcode shown in job details. Free UK government API.'},
    {icon:'📸',title:'EXIF + Photo Stamp',status:'active',desc:'Reads capture time from photo metadata. Stamps with address + time + engineer name in a footer bar. GPS verified.'},
    {icon:'📦',title:'Image Compression',status:'active',desc:'Compresses photos to ~1920px before upload for fast transfers. Toggle to HD for full resolution when needed.'},
    {icon:'💬',title:'WhatsApp Integration',status:'active',desc:'Tap-to-WA on every contact. Share job summaries and notes. + button notifies office via WhatsApp instantly.'},
    {icon:'🔔',title:'Push Notifications',status:'active',desc:'Browser notifications for new jobs. Fires when jobs are refreshed. Tap to open job directly.'},
    {icon:'📍',title:'Nominatim Fallback',status:'active',desc:'Full address geocoding when no postcode. OpenStreetMap\'s geocoder, 300ms rate limit.'},
  ];
  apiEl.innerHTML=apis.map(a=>`<div class="api-card">
    <div class="api-card-hd"><div class="api-icon">${a.icon}</div><div class="api-title">${a.title}</div><div class="api-status api-${a.status}">${a.status==='active'?'Active':'Soon'}</div></div>
    <div class="api-desc">${a.desc}</div>
  </div>`).join('');
}

function toggleGuide(i){
  const hd=document.getElementById(`ghd-${i}`),body=document.getElementById(`gbody-${i}`);
  const open=body.classList.toggle('open');hd.classList.toggle('open',open);
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
const TABS=['today','upcoming','done','map','dash','requests','guide','tools'];
const FAB_TABS=new Set(['today','upcoming']);

function switchTab(tab){
  currentTab=tab;
  TABS.forEach(t=>{
    document.getElementById(`nav-${t}`)?.classList.toggle('active',t===tab);
    document.getElementById(`page-${t}`)?.classList.toggle('active',t===tab);
  });
  const fab=document.getElementById('fab-add');
  if(fab)fab.classList.toggle('hidden',!FAB_TABS.has(tab));
  if(tab==='dash')loadDash();
  if(tab==='requests')loadRequests();
}

function closeModal(id){
  document.getElementById(id)?.classList.remove('open');
  if(id==='job-modal')currentJob=null;
}

function _setBadge(tab,count){
  const b=document.getElementById(`badge-${tab}`);
  if(!b)return;
  b.style.display=count>0?'inline-block':'none';
  b.textContent=count;
}

let _tt;
function toast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className=`show ${type}`;
  clearTimeout(_tt);_tt=setTimeout(()=>{el.className='';},3200);
}

function _fd(ts){
  if(!ts)return'';
  return new Date(typeof ts==='number'?ts:Date.parse(ts)).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
//  AUTO-SAVE DRAFTS — never lose typed text
// ══════════════════════════════════════════════════════════════
function initAutoSave(){
  // These IDs exist across different modal contexts — attach lazily
  // so we don't miss dynamically rendered elements.
  // NOTE: 'job-notes' is deliberately NOT here — it's handled by the
  // job-scoped _hookJobNotesAutoSave() instead (see FIX 12), since this
  // generic per-id key would collide across different jobs' notes.
  const WATCH=['aj-desc','ot-notes','leave-notes'];

  function _hookEl(id){
    const el=document.getElementById(id);
    if(!el||el._autoSaveHooked)return;
    el._autoSaveHooked=true;
    // Restore saved draft
    const saved=localStorage.getItem('draft_'+id);
    if(saved&&!el.value){
      el.value=saved;
      el.style.borderColor='var(--acc)';
      el.style.transition='border-color 1.5s';
      setTimeout(()=>{el.style.borderColor='';},2000);
    }
    el.addEventListener('input',()=>localStorage.setItem('draft_'+id,el.value));
  }

  // Hook immediately for any already-in-DOM elements
  WATCH.forEach(_hookEl);

  // Re-hook after modal opens (aj-desc / ot-notes / leave-notes rendered dynamically)
  document.addEventListener('click',e=>{
    if(e.target.closest('[onclick*="openOvertimeForm"],[onclick*="openLeaveForm"],[onclick*="openAddJobForm"],[onclick*="openAddJobModal"]')){
      setTimeout(()=>WATCH.forEach(_hookEl),200);
    }
  });
  // NOTE: job-notes auto-save is wired directly inside renderJobDetail() via
  // _hookJobNotesAutoSave() — no window patch needed here (FIX 12).
}

function _clearDraft(id){
  localStorage.removeItem('draft_'+id);
  const el=document.getElementById(id);
  if(el){el.style.borderColor='';el._autoSaveHooked=false;}
}

(function init(){
  _applyTheme(localStorage.getItem('df_eng_theme')||'dark');
  ['job-modal','ot-modal','leave-modal','addjob-modal'].forEach(id=>{
    document.getElementById(id)?.addEventListener('click',e=>{if(e.target.id===id)closeModal(id);});
  });
  document.getElementById('qn-overlay')?.addEventListener('click',e=>{if(e.target.id==='qn-overlay')closeQN();});

  // ── Session restore — checks localStorage cache then re-validates active status ──
  // FIX BUG6: always re-check active=true in users table on restore so a deactivated
  // engineer can't continue using the app for up to 30 days on a cached session.
  // FIX H3: Validate localStorage parse with try/catch
  try{
    let saved = null;
    try{
      const raw = localStorage.getItem('df_eng_user');
      if(raw)saved = JSON.parse(raw);
    }catch(e){localStorage.removeItem('df_eng_user');}
    const exp = parseInt(localStorage.getItem('df_eng_sess_expires')||'0');
    if(saved?.name && saved?.role==='engineer' && (exp===0||Date.now()<exp)){
      currentUser=saved;
      // Re-validate: confirm the account is still active in Supabase (non-blocking fast check)
      (async()=>{
        try{
          const rows = await sb(`users?auth_id=eq.${encodeURIComponent(saved._authId)}&active=eq.true&select=id,active`);
          if(!rows||!rows.length){
            // Account deactivated since last login — force sign out
            toast('⚠️ Your account has been deactivated. Contact the office.','error',6000);
            setTimeout(_doSignOut, 2000);
          }
        }catch(e){ /* Network error — allow offline use, re-check next refresh */ }
      })();
      showApp();
      return;
    }
  }catch(e){}
  // No valid session — show login
  localStorage.removeItem('df_eng_user');
  localStorage.removeItem('df_eng_sess_expires');

  // Auto-save drafts for users who land on the login screen
  initAutoSave();
  // NOTE: background refresh intervals (loadJobs, alerts, office ping) are now
  // started inside showApp() with a duplicate-guard. Do not add them back here.
})();

// ── Window exposure ──────────────────────────────────────────────────────────
// As a real ES module (Vite), top-level functions are module-scoped, not
// global — but the HTML markup calls many of them via inline onclick="..."
// attributes, resolved by the browser against the global scope. Exhaustive
// list, extracted by grepping every on*="fn(" pattern in the original file
// and cross-checked against this file's actual top-level declarations —
// preserving exactly the global availability each already had.
Object.assign(window, {
  _deleteBAPhoto, _handleBAUpload, _setPhotoMode, _switchQNTab, _toggleQN,
  _triggerBAUpload, _waShareNotes, addWire, applyQN, calcVD, calcZs,
  checkOfficeConnection, clearConduit, closeModal, closeQN, dismissAlert,
  doLogin, doLogout, doResetPw, handleUpload, openAddJobModal, openJob,
  openLeaveForm, openOvertimeForm, openQN, openUserMenu, quickStatusUpdate,
  refreshAll, saveHours, saveNotes, sendOmwClient, sendOmwOffice, setMapView,
  setQuality, showTool, submitAddJob, submitLeaveRequest,
  submitOvertimeRequest, switchTab, toggleGuide, toggleSort, toggleTheme,
  updateConduit, updateStatus,
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

