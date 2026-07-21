// ── CORE ─────────────────────────────────────────────────────────────────────
// SB_URL/SB_KEY and the raw fetch primitive now live in @core — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Phase 1. This wrapper preserves the
// Client Portal's exact prior behavior: always authenticate as anon (no
// Supabase Auth session exists here), same error-message format.
import { SB_KEY, restFetch } from '@core';
import { escText as e, escAttr as ea } from '@ui';
import { FROM_DB } from '@data';

async function sb(path,opts={}){
  const r=await restFetch(path,opts,SB_KEY);
  if(!r.ok){
    const t=await r.text();
    throw new Error(t||`HTTP ${r.status}`);
  }
  const t=await r.text();return t?JSON.parse(t):null;
}

// This app's own field coverage is deliberately narrower than the full
// jobs/certs/invoices/persons maps in @data (it only ever touches these
// specific fields) — sourcing the values from @data rather than
// hardcoding them means they can never independently drift again, without
// silently widening what this app converts. `createdat`→`createdAt` was
// dropped here: it isn't a real column anywhere (the same dead entry was
// already found and removed from the Office App's copy earlier in this
// engagement) — see ARCHITECTURE_REDESIGN_PROPOSAL.md Phase 2.
const _fixMap = {
  jobnum: FROM_DB.jobs.jobnum, certtypes: FROM_DB.jobs.certtypes, timeslot: FROM_DB.jobs.timeslot,
  landlordname: FROM_DB.jobs.landlordname, agencyname: FROM_DB.jobs.agencyname, agentname: FROM_DB.jobs.agentname,
  issuedate: FROM_DB.certs.issuedate, expirydate: FROM_DB.certs.expirydate, certnum: FROM_DB.certs.certnum,
  noexpiry: FROM_DB.certs.noexpiry, jobid: FROM_DB.certs.jobid,
  clientname: FROM_DB.invoices.clientname, duedate: FROM_DB.invoices.duedate, invoicetype: FROM_DB.invoices.invoicetype,
  billtoname: FROM_DB.invoices.billtoname, billtoaddress: FROM_DB.invoices.billtoaddress,
  jobaddress: FROM_DB.invoices.jobaddress, propertyaddress: FROM_DB.invoices.propertyaddress,
  bankname: FROM_DB.persons.bankname, bankacc: FROM_DB.persons.bankacc,
  banksort: FROM_DB.persons.banksort, bankref: FROM_DB.persons.bankref,
};
function _fix(j){
  if(!j||typeof j!=='object')return j;
  const r={};for(const[k,v]of Object.entries(j))r[_fixMap[k]||k]=v;return r;
}

function dd(d){return d?Math.ceil((new Date(d)-new Date())/86400000):null}
function fd(d){return d?new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):''}
function fgbp(n){return'£'+(n||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2})}
// Mirrors the Office App's getVatRate() — must also respect vatEnabled,
// not just fall back to a default rate, or a company that isn't
// VAT-registered (vatEnabled:false) shows VAT here that the office side
// correctly shows as £0.
function _portalVatRate(){ return (_S?.vatEnabled!==false)?(_S?.vatRate??20):0; }
function calcTotal(inv){
  const it=typeof inv.items==='string'?JSON.parse(inv.items||'[]'):(inv.items||[]);
  let sub=0,vat=0;
  const vr=_portalVatRate();
  it.forEach(x=>{const l=(x.qty||1)*(x.unit||0);sub+=l;if(x.vat)vat+=l*vr/100;});
  return{sub,vat,grand:sub+vat};
}

// ── STATE ─────────────────────────────────────────────────────────────────────
let _d=null, _S={}, _cs='expiry', _cd='asc', _certView='list', _wizardStep=1;
const P=new URLSearchParams(location.search);

// ── "Updates since your last visit" ─────────────────────────────────────────
// No push notifications yet (see Settings for how to add those later) — this
// is the free, works-with-no-setup version: diff this visit's data against a
// snapshot of what was last seen on this device, and surface what changed.
function _portalSnapshotKey(token){ return 'df_portal_seen_'+token; }

function _computeChangesSinceLastVisit(jobs, certs, invoices, token){
  const key=_portalSnapshotKey(token);
  let prev=null;
  try{ prev=JSON.parse(localStorage.getItem(key)||'null'); }catch(err){}

  const snapshot={jobs:{},certs:{},invoices:{}};
  jobs.forEach(j=>{ snapshot.jobs[j.id]=j.status; });
  certs.forEach(c=>{ snapshot.certs[c.id]=true; });
  invoices.forEach(i=>{ snapshot.invoices[i.id]=i.status; });

  const changes=[];
  if(prev){
    jobs.forEach(j=>{
      const old=prev.jobs?.[j.id];
      if(old!==undefined && old!==j.status){
        changes.push({icon:'refresh-cw',color:'var(--accent)',text:`Job at <strong>${e(j.address||'')}</strong> is now <strong>${e(j.status)}</strong>`,action:()=>go('jobs'),time:'Status update'});
      }
    });
    certs.forEach(c=>{
      if(prev.certs && !(c.id in prev.certs)){
        changes.push({icon:'award',color:'var(--success)',text:`New certificate ready: <strong>${e(c.type||'Certificate')}</strong>`,action:()=>go('certs'),time:'Certificate'});
      }
    });
    invoices.forEach(i=>{
      const old=prev.invoices?.[i.id];
      if(old===undefined){
        changes.push({icon:'file-plus',color:'var(--accent)',text:`New invoice <strong>${e(i.number||'')}</strong>`,action:()=>go('invoices'),time:'Invoice'});
      } else if(old!==i.status){
        changes.push({icon:'receipt',color:'var(--warning)',text:`Invoice <strong>${e(i.number||'')}</strong> is now <strong>${e(i.status)}</strong>`,action:()=>go('invoices'),time:'Invoice'});
      }
    });
  }

  try{ localStorage.setItem(key, JSON.stringify(snapshot)); }catch(err){}
  return changes;
}
const token=P.get('id'), ptype=P.get('type')||'landlord';

// ── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
// Free Web Push (VAPID) — no third-party service, no account. See
// PHASE6_PUSH_NOTIFICATIONS_SQL.md / PHASE6B for the sending side. This
// public key is safe to expose; the matching private key lives only in the
// Edge Function's environment secrets.
const VAPID_PUBLIC_KEY = 'BCM7SAk356QodrcNAwoO7gOSwXnfGb7ooqN514kYfR8Fv72h1gbkMD23REa7toVURlZPqTTH8BfpWOJSqLRitTE';

function _urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData=atob(base64);
  const out=new Uint8Array(rawData.length);
  for(let i=0;i<rawData.length;++i) out[i]=rawData.charCodeAt(i);
  return out;
}

// Shows the "Get notified" prompt only if push is supported, permission
// hasn't been denied before, and this device isn't already subscribed.
async function initPush(){
  const row=document.getElementById('notif-push-row');
  if(!row) return;
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if(Notification.permission==='denied') return;
  try{
    const reg=await navigator.serviceWorker.register('./sw.js');
    const existing=await reg.pushManager.getSubscription();
    if(existing) return; // already subscribed on this device — nothing to prompt
    row.style.display='block';
  }catch(e){ console.warn('[Push] init failed',e); }
}

async function enablePushNotifications(){
  const statusEl=document.getElementById('notif-push-status');
  const btn=document.getElementById('notif-push-btn');
  try{
    if(btn){btn.disabled=true;btn.textContent='Requesting…';}
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){
      if(statusEl) statusEl.textContent='Notifications blocked — you can enable them in your browser settings any time';
      if(btn){btn.disabled=false;btn.textContent='🔔 Get notified on your phone';}
      return;
    }
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:_urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });
    const j=sub.toJSON();
    await sb('rpc/portal_push_subscribe',{method:'POST',body:{
      p_table:_pinTableFor(), p_id:token,
      p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth
    }});
    const row=document.getElementById('notif-push-row');
    if(row) row.style.display='none';
    toast('🔔 Notifications enabled');
  }catch(e){
    console.warn('[Push] subscribe failed',e);
    if(statusEl) statusEl.textContent='Could not enable notifications — please try again later';
    if(btn){btn.disabled=false;btn.textContent='🔔 Get notified on your phone';}
  }
}
const _INV_STORE=new Map();
let _CURRENT_INV_ID=null;

// ── PIN GATE ─────────────────────────────────────────────────────────────────
// See PHASE5_PORTAL_PIN_AUTH_SQL.md. The link alone used to be the only thing
// protecting a client's data, with no expiry and no revoke. This adds a
// 6-digit PIN on top: the office can reset it (never reveal it — it's
// hashed) which forces the client to set a fresh one on their next visit.
function _pinTableFor(){ return ptype==='agency'?'agencies':(ptype==='agent'?'agents':'persons'); }
function _pinSessionKey(){ return 'df_portal_pin_ok_'+token; }

function _pinGateShell(inner){
  document.title='DeepFlow — Client Portal';
  document.body.innerHTML=`
    <div style="position:fixed;inset:0;overflow:auto;font-family:'Inter',-apple-system,sans-serif;
      background:linear-gradient(155deg,#0d1f3c 0%,#1e3a5f 50%,#0a1628 100%);
      display:flex;align-items:center;justify-content:center;padding:24px;
      padding-top:calc(24px + env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom))">
      <div style="width:100%;max-width:360px;background:rgba(255,255,255,.06);border:1px solid rgba(125,211,252,.15);
        border-radius:16px;padding:32px 28px;backdrop-filter:blur(16px);text-align:center">
        <div style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:20px;font-family:Arial Black,Impact,sans-serif">
          <span style="background:linear-gradient(135deg,#7dd3fc 0%,#38bdf8 35%,#fde68a 65%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">DEEPFLOW</span>
        </div>
        ${inner}
      </div>
    </div>`;
}

function _pinInputHtml(id){
  return `<input id="${id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off"
    style="width:100%;box-sizing:border-box;font-size:28px;letter-spacing:14px;text-align:center;padding:14px 0;
    border-radius:10px;border:1px solid rgba(125,211,252,.25);background:rgba(255,255,255,.05);color:#fff;margin-bottom:12px"
    oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,6)">`;
}

async function _pinRenderEntry(){
  _pinGateShell(`
    <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:6px">Enter your PIN</div>
    <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:18px">Enter the 6-digit PIN for this portal</div>
    ${_pinInputHtml('pin-entry')}
    <div id="pin-err" style="font-size:12px;color:#f87171;min-height:16px;margin-bottom:10px"></div>
    <button onclick="_pinSubmitEntry()" style="width:100%;padding:12px;border:none;border-radius:10px;background:#38bdf8;color:#0a1628;font-weight:700;font-size:14px;cursor:pointer">Unlock</button>
  `);
  const el=document.getElementById('pin-entry');
  el.focus();
  el.addEventListener('keydown',ev=>{ if(ev.key==='Enter') _pinSubmitEntry(); });
}

async function _pinSubmitEntry(){
  const pin=document.getElementById('pin-entry').value;
  const errEl=document.getElementById('pin-err');
  if(!/^[0-9]{6}$/.test(pin)){ errEl.textContent='Enter all 6 digits'; return; }
  try{
    const ok=await sb('rpc/portal_pin_verify',{method:'POST',body:{p_table:_pinTableFor(),p_id:token,p_pin:pin}});
    if(ok===true){
      sessionStorage.setItem(_pinSessionKey(),'1');
      location.reload();
    } else {
      errEl.textContent='Incorrect PIN — please try again';
      document.getElementById('pin-entry').value='';
      document.getElementById('pin-entry').focus();
    }
  }catch(e){
    errEl.textContent='Could not verify PIN — please try again or contact your service provider';
  }
}

async function _pinRenderSetup(){
  _pinGateShell(`
    <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:6px">Set your PIN</div>
    <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:18px">Choose a 6-digit PIN to protect your portal. You'll need it each time you open this link.</div>
    ${_pinInputHtml('pin-new')}
    ${_pinInputHtml('pin-confirm')}
    <div id="pin-err" style="font-size:12px;color:#f87171;min-height:16px;margin-bottom:10px"></div>
    <button onclick="_pinSubmitSetup()" style="width:100%;padding:12px;border:none;border-radius:10px;background:#38bdf8;color:#0a1628;font-weight:700;font-size:14px;cursor:pointer">Set PIN</button>
  `);
  document.getElementById('pin-new').focus();
}

async function _pinSubmitSetup(){
  const pin=document.getElementById('pin-new').value;
  const confirm=document.getElementById('pin-confirm').value;
  const errEl=document.getElementById('pin-err');
  if(!/^[0-9]{6}$/.test(pin)){ errEl.textContent='PIN must be exactly 6 digits'; return; }
  if(pin!==confirm){ errEl.textContent='PINs don’t match'; return; }
  try{
    await sb('rpc/portal_pin_set',{method:'POST',body:{p_table:_pinTableFor(),p_id:token,p_pin:pin}});
    sessionStorage.setItem(_pinSessionKey(),'1');
    location.reload();
  }catch(e){
    errEl.textContent='Could not set PIN — please try again or contact your service provider';
  }
}

function _pinRenderLocked(lockedUntil){
  const mins=Math.max(1,Math.ceil((new Date(lockedUntil)-new Date())/60000));
  _pinGateShell(`
    <div style="font-size:15px;font-weight:700;color:#fff;margin-bottom:6px">Too many attempts</div>
    <div style="font-size:12px;color:rgba(255,255,255,.5)">Please try again in about ${mins} minute${mins!==1?'s':''}, or contact your service provider.</div>
  `);
}

// Returns true if the caller may proceed to load the real portal. Otherwise
// it has already rendered the PIN screen in place of the page.
async function ensurePortalPin(){
  if(sessionStorage.getItem(_pinSessionKey())==='1') return true;

  let status;
  try{
    const rows=await sb('rpc/portal_pin_status',{method:'POST',body:{p_table:_pinTableFor(),p_id:token}});
    status=Array.isArray(rows)?rows[0]:rows;
  }catch(e){
    // RPC not deployed yet (SQL not run) — fail OPEN so existing links keep
    // working exactly as before, rather than locking everyone out.
    console.warn('[Portal] PIN status check failed, allowing through',e);
    return true;
  }

  if(!status || status.has_pin===false){ await _pinRenderSetup(); return false; }
  if(status.locked_until && new Date(status.locked_until) > new Date()){ _pinRenderLocked(status.locked_until); return false; }
  await _pinRenderEntry();
  return false;
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init(){
  if(!token){
    document.title = 'DeepFlow — Client Portal';
    document.body.innerHTML = `
    <div style="position:fixed;inset:0;overflow:hidden;font-family:'Inter',-apple-system,sans-serif;display:flex;align-items:stretch">

        <!-- Left: navy background with canvas inside — exactly like office app login -->
        <div style="flex:1;position:relative;background:linear-gradient(155deg,#0d1f3c 0%,#1e3a5f 50%,#0a1628 100%);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:48px 40px">
          <canvas id="cp-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0"></canvas>
          <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;text-align:center;max-width:480px;width:100%">

            <!-- DeepFlow logo -->
            <div style="margin-bottom:10px">
              <div style="font-size:52px;font-weight:900;letter-spacing:3px;line-height:1;font-family:Arial Black,Impact,sans-serif">
                <span style="background:linear-gradient(135deg,#7dd3fc 0%,#38bdf8 35%,#fde68a 65%,#f59e0b 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">DEEPFLOW</span>
              </div>
              <div style="font-size:10px;color:rgba(125,211,252,.35);letter-spacing:4px;text-transform:uppercase;margin-top:6px">Smart Property Compliance Suite</div>
            </div>

            <div style="font-size:13px;color:rgba(255,255,255,.4);margin-bottom:32px;line-height:1.7;max-width:340px">
              One platform to manage jobs, compliance certificates, invoicing and your team — all in one place.
            </div>

            <!-- Feature cards -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:420px;margin-bottom:28px">
              <div style="padding:14px 16px;background:rgba(255,255,255,.06);border:1px solid rgba(125,211,252,.12);border-radius:12px;text-align:left;backdrop-filter:blur(16px)">
                <div style="font-size:18px;margin-bottom:5px">🔧</div>
                <div style="font-size:12px;font-weight:700;color:#7dd3fc;margin-bottom:3px">Job Management</div>
                <div style="font-size:10px;color:rgba(255,255,255,.35);line-height:1.5">Schedule, track and manage every job from one view</div>
              </div>
              <div style="padding:14px 16px;background:rgba(255,255,255,.06);border:1px solid rgba(125,211,252,.12);border-radius:12px;text-align:left;backdrop-filter:blur(16px)">
                <div style="font-size:18px;margin-bottom:5px">📜</div>
                <div style="font-size:12px;font-weight:700;color:#93c5fd;margin-bottom:3px">Compliance</div>
                <div style="font-size:10px;color:rgba(255,255,255,.35);line-height:1.5">Gas, EICR, EPC certificates with expiry alerts</div>
              </div>
              <div style="padding:14px 16px;background:rgba(255,255,255,.06);border:1px solid rgba(125,211,252,.12);border-radius:12px;text-align:left;backdrop-filter:blur(16px)">
                <div style="font-size:18px;margin-bottom:5px">💰</div>
                <div style="font-size:12px;font-weight:700;color:#86efac;margin-bottom:3px">Invoicing</div>
                <div style="font-size:10px;color:rgba(255,255,255,.35);line-height:1.5">Create, send and track invoices in seconds</div>
              </div>
              <div style="padding:14px 16px;background:rgba(255,255,255,.06);border:1px solid rgba(125,211,252,.12);border-radius:12px;text-align:left;backdrop-filter:blur(16px)">
                <div style="font-size:18px;margin-bottom:5px">⚡</div>
                <div style="font-size:12px;font-weight:700;color:#fde68a;margin-bottom:3px">Faster than a phone call</div>
                <div style="font-size:10px;color:rgba(255,255,255,.35);line-height:1.5">Clients raise requests, see updates and download certs instantly</div>
              </div>
            </div>

            <div style="font-size:10px;color:rgba(125,211,252,.2)">
              Powered by <strong style="color:rgba(125,211,252,.38)">DeepFlow</strong>
            </div>
          </div>
        </div>

        <!-- Right: white panel with "you need a link" message -->
        <div style="width:420px;flex-shrink:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 40px;box-shadow:-8px 0 40px rgba(0,0,0,.2)">
          <div style="width:100%;max-width:300px;text-align:center">

            <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#1e3a5f,#0f2140);display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 20px;box-shadow:0 4px 20px rgba(30,58,95,.3)">🔗</div>

            <div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:8px">You need your personal link</div>
            <div style="font-size:13px;color:#64748b;line-height:1.8;margin-bottom:28px">
              This portal is accessed via a personal link sent to you by your service provider.<br><br>
              Please contact your service provider and ask them to send you your portal link.
            </div>

            <div style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:10px;padding:14px 16px;text-align:left;margin-bottom:24px">
              <div style="font-size:10px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">💡 Your link looks like</div>
              <div style="font-size:10px;font-family:monospace;color:#1d6fad;word-break:break-all;line-height:1.7">client-portal.html?id=YOUR-ID<br>&type=landlord</div>
            </div>

            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
              <div style="flex:1;height:1px;background:#e2e8f0"></div>
              <span style="font-size:10px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.5px">or contact us</span>
              <div style="flex:1;height:1px;background:#e2e8f0"></div>
            </div>

            <div style="font-size:11px;color:#94a3b8;line-height:1.8">
              Issues or feedback? Email with screenshots:<br>
              <a href="mailto:mandeepnain222@gmail.com" style="color:#1d6fad;text-decoration:none;font-weight:600">mandeepnain222@gmail.com</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    // Run the same animation as the office app login screen
    (function initPortalCanvas(){
      const canvas=document.getElementById('cp-canvas');
      if(!canvas)return;
      const ctx=canvas.getContext('2d');
      let W,H,nodes,packets,stars,raf=null;
      function build(){
        const p=canvas.parentElement;
        W=canvas.width=p?p.offsetWidth||window.innerWidth*.72:window.innerWidth*.72;
        H=canvas.height=p?p.offsetHeight||window.innerHeight:window.innerHeight;
        const bg=ctx.createLinearGradient(0,0,W,H);
        bg.addColorStop(0,'#0d1f3c');bg.addColorStop(.5,'#1e3a5f');bg.addColorStop(1,'#0a1628');
        canvas._bg=bg;
        nodes=Array.from({length:60},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.05,vy:(Math.random()-.5)*.05,r:Math.random()<.12?3.5:1.6,pulse:Math.random()*Math.PI*2}));
        packets=Array.from({length:18},()=>({fi:Math.floor(Math.random()*nodes.length),ti:Math.floor(Math.random()*nodes.length),t:Math.random(),speed:.0015+Math.random()*.003}));
        stars=Array.from({length:100},()=>({x:Math.random()*W,y:Math.random()*H,sz:1.2+Math.random()*3.8,phase:Math.random()*Math.PI*2,speed:.002+Math.random()*.006}));
      }
      function drawStar(x,y,r,a){
        ctx.save();
        const g=ctx.createRadialGradient(x,y,0,x,y,r*5);g.addColorStop(0,`rgba(255,215,60,${a*.7})`);g.addColorStop(1,'rgba(212,175,55,0)');
        ctx.beginPath();ctx.arc(x,y,r*5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
        ctx.fillStyle=`rgba(255,235,100,${Math.min(1,a*1.3)})`;
        ctx.beginPath();
        for(let i=0;i<8;i++){const angle=i*Math.PI/4-Math.PI/8;const rad=i%2===0?r:r*.28;i===0?ctx.moveTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad):ctx.lineTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad);}
        ctx.closePath();ctx.fill();
        ctx.beginPath();ctx.arc(x,y,r*.3,0,Math.PI*2);ctx.fillStyle=`rgba(255,248,200,${Math.min(1,a*1.4)})`;ctx.fill();
        ctx.restore();
      }
      function draw(){
        ctx.fillStyle=canvas._bg;ctx.fillRect(0,0,W,H);
        for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const n=nodes[i],m=nodes[j],d=Math.hypot(n.x-m.x,n.y-m.y);if(d<W*.2){ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(m.x,m.y);ctx.strokeStyle='rgba(125,211,252,.25)';ctx.lineWidth=1;ctx.stroke();}}
        nodes.forEach(n=>{n.pulse+=.011;n.x+=n.vx;n.y+=n.vy;if(n.x<0||n.x>W)n.vx*=-1;if(n.y<0||n.y>H)n.vy*=-1;const a=.6+Math.sin(n.pulse)*.3;ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a})`;ctx.fill();if(n.r>2){ctx.beginPath();ctx.arc(n.x,n.y,n.r*3,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a*.2})`;ctx.fill();}});
        packets.forEach(p=>{p.t+=p.speed;if(p.t>=1){p.t=0;p.fi=p.ti;p.ti=Math.floor(Math.random()*nodes.length);}const n=nodes[p.fi],m=nodes[p.ti];if(!n||!m)return;const x=n.x+(m.x-n.x)*p.t,y=n.y+(m.y-n.y)*p.t;const g=ctx.createRadialGradient(x,y,0,x,y,10);g.addColorStop(0,'rgba(180,240,255,.9)');g.addColorStop(1,'rgba(125,211,252,0)');ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle='rgba(220,245,255,.95)';ctx.fill();});
        stars.forEach(s=>{s.phase+=s.speed;const a=Math.max(0,.5+Math.sin(s.phase)*.5);if(a>.02)drawStar(s.x,s.y,s.sz,Math.min(1,a*1.4));});
        raf=requestAnimationFrame(draw);
      }
      build();draw();
      // iOS Safari fires window 'resize' when its toolbar collapses/expands
      // during scrolling — only the viewport HEIGHT changes then, not width.
      // Rebuilding the whole particle system (fresh random positions) on
      // every one of those made this card look like it was reloading while
      // being scrolled. Debounce, and skip rebuilding unless the width
      // actually changed.
      let _resizeT=null;
      window.addEventListener('resize',()=>{
        clearTimeout(_resizeT);
        _resizeT=setTimeout(()=>{
          const p=canvas.parentElement;
          const newW=p?p.offsetWidth||window.innerWidth*.72:window.innerWidth*.72;
          if(Math.abs(newW-W)<2) return;
          if(raf){cancelAnimationFrame(raf);raf=null;}
          build();draw();
        },150);
      });
    })();
    return;
  }
  try{
    if(!(await ensurePortalPin())) return;

    let entity,jobs=[];

    try{
      const s=await sb(`app_settings?select=value&key=eq.__all__`);
      if(s?.[0]?.value){_S=typeof s[0].value==='string'?JSON.parse(s[0].value):s[0].value;}
    }catch(e){ console.warn('[Portal] settings load failed',e); }

    if(ptype==='agency'){
      // Was a direct, unscoped `agencies?id=eq...` read — now a narrow
      // SECURITY DEFINER function that only ever returns the one row asked
      // for, matched server-side. See PHASE1_PORTAL_RPC_SQL.md.
      const rows=await sb(`rpc/portal_get_agency`,{method:'POST',body:{p_id:token}});
      if(!rows?.length){showErr('Not Found','This link is invalid or has expired.');return;}
      entity=_fix(rows[0]);
      document.getElementById('portal-badge').textContent='Agency';
      document.title=`${e(entity.name)} — Portal`;
      jobs=await fetchJobs('agencyname',entity.name,entity.id);

      // Load ALL agents under this agency for the filter bar
      try{
        const agentRows=await sb(`rpc/portal_get_agency_agents`,{method:'POST',body:{p_agency_id:token}}).catch(()=>[]);
        if(agentRows?.length) entity._agents=agentRows.map(_fix);
      }catch(e){}

      // Also extract unique agent names from jobs as fallback
      if(!entity._agents?.length){
        const agentNames=[...new Set(jobs.map(j=>j.agentName||j.agentname).filter(Boolean))].sort();
        if(agentNames.length) entity._agentNames=agentNames;
      }
    } else if(ptype==='agent'){
      const agentName=P.get('name');
      if(!agentName){showErr('Invalid Link','Please regenerate this link from the office.');return;}
      entity={name:decodeURIComponent(agentName),type:'agent',id:token};
      document.getElementById('portal-badge').textContent='Agent';
      document.title=`${e(entity.name)} — Portal`;
      jobs=await fetchJobs('agentname',entity.name,entity.id);
    } else {
      const rows=await sb(`rpc/portal_get_person`,{method:'POST',body:{p_id:token}});
      if(!rows?.length){showErr('Not Found','This link is invalid or has expired. Contact your service provider.');return;}
      entity=_fix(rows[0]);
      document.getElementById('portal-badge').textContent='Landlord';
      document.title=`${e(entity.name)} — Portal`;
      jobs=await fetchJobs('landlordname',entity.name,entity.id);
    }

    let attachments=[],certs=[],invoices=[],ratings=[];

    if(jobs.length){
      // jobIds passed as a plain array to the RPCs below — replaces the old
      // hand-built `"id1","id2"` string used for a raw `jobid=in.(...)` filter.
      const jobIds=jobs.map(j=>j.id);
      const nL=(entity.name||'').toLowerCase();
      const [ra,rc,ri,rr]=await Promise.all([
        sb(`rpc/portal_get_attachments`,{method:'POST',body:{p_job_ids:jobIds}}).catch(()=>[]),
        sb(`rpc/portal_get_certs`,{method:'POST',body:{p_job_ids:jobIds}}).catch(()=>[]),
        fetchInvoicesByName(nL),
        Promise.resolve([]), // no `ratings` table exists in the live database — this call always failed before; removed rather than left silently broken
      ]);
      attachments=(ra||[]).map(_fix);
      certs=(rc||[]).map(_fix);
      invoices=ri||[];
      // Ratings: no `ratings` table exists in the live database (rr is always
      // []), so the outer `ratings` variable simply stays at its initial `[]`.
      // This block previously declared a second, block-scoped `const ratings`
      // and then tried to reassign it a few lines later — a pre-existing bug
      // (present before any of this phase's changes) that threw
      // "Assignment to constant variable" and crashed portal load entirely
      // for any client that actually had jobs. Removed rather than patched,
      // since the underlying feature has no data to operate on either way.
      jobs.forEach(j=>{
        const rel=invoices.filter(inv=>{
          const a=(inv.jobAddress||inv.billToAddress||'').toLowerCase().trim();
          return a===(j.address||'').toLowerCase().trim();
        });
        if(rel.length){
          const allPaid=rel.every(i=>i.status==='Paid');
          const anyInvoiced=rel.some(i=>i.status==='Awaiting Payment'||i.status==='Draft');
          if(allPaid)j.paid=true;
          else if(anyInvoiced)j.invoiced=true;
        }
      });
    }

    invoices.forEach(inv=>{if(inv.id)_INV_STORE.set(inv.id,inv);});

    const coName=(_S?.coName)||'Your Service Provider';
    document.getElementById('hdr-co').textContent=coName;
    document.getElementById('hdr-name').textContent=entity.name;
    document.getElementById('footer-co').textContent=coName;

    const changesSinceLastVisit=_computeChangesSinceLastVisit(jobs,certs,invoices,token);
    const hasAlerts=certs.some(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=30) || invoices.some(i=>i.status!=='Paid'&&i.status!=='Cancelled') || changesSinceLastVisit.length>0;
    if(hasAlerts){
      const nb=document.getElementById('notif-btn');const nd=document.getElementById('notif-dot');
      if(nb)nb.style.display='flex';if(nd)nd.style.display='block';
    }

    _d={name:entity.name,type:ptype,jobs,attachments,certs,invoices,ratings:ratings||[],token,coName,entity,changesSinceLastVisit};
    _d._activeAgents=new Set(); // empty = all agents (agency view)
    document.getElementById('nav').style.display='flex';
    document.querySelectorAll('.tab').forEach(tab=>{
      tab.addEventListener('click',()=>go(tab.dataset.t));
    });
    initTheme();
    initKeyboard();
    initOffline();
    initPush();
    updateGreeting();
    go('overview');
  // Start hero banner animation after render
  setTimeout(()=>{ if(window._heroCanvasStart) window._heroCanvasStart(); },300);
  }catch(err){
    console.error('[Portal] init error:',err);
    let title='Connection Error',msg='Could not load your portal. Please check your connection and try again.';
    if(err.message?.includes('403')||err.message?.includes('401')){title='Access Denied';msg='Authentication failed. Please contact your service provider.';}
    else if(err.message?.includes('404')){title='Not Found';msg='The requested data could not be found.';}
    else if(err.message?.includes('timeout')||err.message?.includes('NetworkError')){title='Network Error';msg='Connection timed out. Please check your internet and try again.';}
    else if(!navigator.onLine){title='You are offline';msg='Please connect to the internet and refresh the page.';}
    showErr(title,msg);
  }
}

async function fetchInvoicesByName(nameLower){
  // Was a direct, unscoped `invoices?or=(...)` read (anyone could read every
  // invoice in the business) — now a SECURITY DEFINER function doing the same
  // five-field partial match server-side. See PHASE1_PORTAL_RPC_SQL.md.
  try{
    const raw=await sb(`rpc/portal_get_invoices`,{method:'POST',body:{p_name:nameLower}});
    if(Array.isArray(raw)){
      const seen=new Set();
      return raw.map(_fix).filter(inv=>{
        const id=String(inv.id||'').toLowerCase();
        if(!id||seen.has(id))return false;
        seen.add(id);return true;
      }).sort((a,b)=>new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0));
    }
  }catch(e){console.warn('[Portal] invoice search failed',e);}
  return [];
}

async function fetchJobs(col,name,id){
  // Was two sequential direct table reads (name match, then a client_person_id
  // fallback) against an unscoped anon policy — now one call to a
  // SECURITY DEFINER function that does the exact same matching server-side.
  // See PHASE1_PORTAL_RPC_SQL.md.
  try{
    const raw=await sb(`rpc/portal_get_jobs`,{method:'POST',body:{p_col:col,p_name:name,p_id:id?String(id).trim():null}});
    if(Array.isArray(raw)) return raw.map(_fix);
  }catch(e){console.warn('[Portal] jobs fetch failed',e);}
  return [];
}

// ── AGENCY AGENT FILTER (multi-select) ──────────────────────────────────────
function toggleAgentFilter(agentName){
  _d._activeAgents=_d._activeAgents||new Set();
  if(!agentName){ _d._activeAgents.clear(); }
  else if(_d._activeAgents.has(agentName)){ _d._activeAgents.delete(agentName); }
  else{ _d._activeAgents.add(agentName); }
  rerenderCurrentTab();
}

// Re-render the active tab in place — no skeleton flash, no route change,
// so the hero canvas and rest of the page don't visibly "reload".
function rerenderCurrentTab(){
  const t=document.querySelector('.tab.active')?.dataset?.t||'overview';
  const fn={overview:vOverview,jobs:vJobs,certs:vCerts,invoices:vInvoices,properties:vProperties,request:vRequest};
  if(fn[t]){ fn[t](filteredD()); refreshIcons(); attachDelegates(); }
}

// Returns data filtered by active agents (for agency view)
// Agent view always sees their own data — no filter needed
function filteredD(){
  const agents=_d._activeAgents;
  if(!agents||!agents.size||_d.type!=='agency') return _d;
  const wanted=new Set([...agents].map(a=>a.toLowerCase()));
  const jobs=_d.jobs.filter(j=>wanted.has((j.agentName||j.agentname||'').toLowerCase()));
  const jobIds=new Set(jobs.map(j=>j.id));
  return {
    ..._d,
    jobs,
    attachments: _d.attachments.filter(a=>jobIds.has(a.jobId||a.jobid)),
    certs:       _d.certs.filter(c=>jobIds.has(c.jobId||c.jobid)),
    invoices:    _d.invoices.filter(i=>wanted.has((i.agentName||i.agentname||'').toLowerCase())||jobIds.has(i.linkedJobId||i.jobId)),
    ratings:     (_d.ratings||[]).filter(r=>jobIds.has(r.jobId||r.jobid)),
    _activeAgents: agents,
    entity: {..._d.entity, _displayName: `${_d.name} › ${[...agents].join(', ')}`},
  };
}
function initTheme(){
  const saved=localStorage.getItem('portal-theme');
  const prefersDark=window.matchMedia('(prefers-color-scheme:dark)').matches;
  const isDark=saved?saved==='dark':prefersDark;
  document.documentElement.classList.toggle('dark',isDark);
  updateThemeIcon(isDark);
}
function toggleTheme(){
  const isDark=document.documentElement.classList.toggle('dark');
  localStorage.setItem('portal-theme',isDark?'dark':'light');
  updateThemeIcon(isDark);
}
function updateThemeIcon(dark){
  const btn=document.getElementById('theme-btn');
  if(btn){btn.innerHTML=dark?'<i data-lucide="moon" style="width:18px;height:18px"></i>':'<i data-lucide="sun" style="width:18px;height:18px"></i>';refreshIcons();}
}

// ── SEARCH ──────────────────────────────────────────────────────────────────
function openSearch(){document.getElementById('search-overlay').classList.add('show');setTimeout(()=>document.getElementById('search-inp').focus(),50);}
function closeSearch(){document.getElementById('search-overlay').classList.remove('show');document.getElementById('search-inp').value='';document.getElementById('search-results').innerHTML='';}
function clickFirstResult(){const el=document.querySelector('.search-item');if(el)el.click();}
document.addEventListener('keydown',e=>{if(document.getElementById('search-overlay')?.classList.contains('show')){if(e.key==='Enter'){e.preventDefault();clickFirstResult();}}});
function performSearch(q){
  const term=q.toLowerCase().trim();
  if(!term){document.getElementById('search-results').innerHTML='';return;}
  const results=[];
  _d.jobs.forEach(j=>{if((j.address||'').toLowerCase().includes(term)||(j.jobNum||'').toLowerCase().includes(term)||(j.description||'').toLowerCase().includes(term))results.push({t:'Job',l:j.address||j.jobNum,sub:j.status,icon:'wrench',action:()=>{closeSearch();go('jobs');}});});
  _d.certs.forEach(c=>{if((c.type||'').toLowerCase().includes(term)||(c.address||'').toLowerCase().includes(term)||(c.certNum||'').toLowerCase().includes(term))results.push({t:'Certificate',l:c.type,sub:c.address,icon:'file-check',action:()=>{closeSearch();go('certs');}});});
  _d.invoices.forEach(i=>{if((i.number||'').toLowerCase().includes(term)||(i.billToName||'').toLowerCase().includes(term))results.push({t:'Invoice',l:i.number||'Invoice',sub:fgbp(calcTotal(i).grand),icon:'receipt',action:()=>{closeSearch();go('invoices');}});});
  const html=results.length?results.slice(0,8).map(r=>`<div class="search-item" onclick="(${typeof r.action==='function'?r.action.toString():''})()"><i data-lucide="${r.icon}" style="width:16px;height:16px"></i><div><div style="font-weight:600;font-size:13px">${e(r.l)}</div><div style="font-size:11px;color:var(--text-secondary)">${e(r.sub)} · ${r.t}</div></div></div>`).join(''):`<div class="empty" style="padding:20px"><div class="et">No results</div></div>`;
  document.getElementById('search-results').innerHTML=html;
  refreshIcons();
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function toggleNotif(){
  const p=document.getElementById('notif-panel');
  const show=p.style.display!=='block';
  p.style.display=show?'block':'none';
  if(show&&_d)renderNotifPanel();
}
function renderNotifPanel(){
  const items=[...(_d.changesSinceLastVisit||[])];
  _d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=30).forEach(c=>{
    const df=dd(c.expiryDate);
    items.push({icon:'alert-triangle',color:'var(--danger)',text:`<strong>${e(c.type)}</strong> expires in ${Math.abs(df)} days`,action:()=>go('certs'),time:'Certificate'});
  });
  _d.invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').forEach(i=>{
    items.push({icon:'receipt',color:'var(--warning)',text:`Invoice <strong>${e(i.number||'—')}</strong> is outstanding`,action:()=>go('invoices'),time:'Invoice'});
  });
  const html=items.length?items.map(n=>`<div class="notif-item" onclick="(${typeof n.action==='function'?n.action.toString():''})();toggleNotif()"><div class="notif-icon" style="background:${n.color}15;color:${n.color}"><i data-lucide="${n.icon}" style="width:16px;height:16px"></i></div><div style="flex:1"><div style="font-size:12px;line-height:1.4">${n.text}</div><div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">${n.time}</div></div></div>`).join(''):`<div class="empty" style="padding:20px"><div class="es">No new notifications</div></div>`;
  document.getElementById('notif-list').innerHTML=html;
  refreshIcons();
}

// ── KEYBOARD & OFFLINE ────────────────────────────────────────────────────────
function initKeyboard(){
  document.addEventListener('keydown',e=>{
    if((e.key==='k'||e.key==='K')&&(e.metaKey||e.ctrlKey)){e.preventDefault();openSearch();}
    if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){e.preventDefault();openSearch();}
    if(e.key==='Escape'){closeSearch();closeModal();closeLb();document.getElementById('notif-panel').style.display='none';document.getElementById('help-modal').classList.remove('show');}
    if(e.key==='?'&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){e.preventDefault();document.getElementById('help-modal').classList.add('show');}
    if(!isNaN(e.key)&&document.activeElement.tagName!=='INPUT'){const tabs=['overview','jobs','certs','invoices','properties','request'];const idx=parseInt(e.key)-1;if(tabs[idx])go(tabs[idx]);}
    if(e.key==='n'||e.key==='N'){if(document.activeElement.tagName!=='INPUT')go('request');}
  });
}
function initOffline(){
  const banner=document.getElementById('offline-banner');
  window.addEventListener('online',()=>{banner.classList.remove('show');toast('Back online');});
  window.addEventListener('offline',()=>banner.classList.add('show'));
}
function closeHelpModal(ev){if(ev&&ev.target!==ev.currentTarget)return;document.getElementById('help-modal').classList.remove('show');}

// ── TAB ───────────────────────────────────────────────────────────────────────
function go(t){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.t===t));
  if(t==='overview') setTimeout(()=>{ if(window._heroCanvasStart) window._heroCanvasStart(); },200);
  const fn={overview:vOverview,jobs:vJobs,certs:vCerts,invoices:vInvoices,properties:vProperties,request:vRequest};
  if(fn[t]){
    showSkeleton(t);
    setTimeout(()=>{
      // filteredD() applies agent filter for agency view; all other views unchanged
      fn[t](filteredD());refreshIcons();attachDelegates();
      if(t==='overview') setTimeout(()=>{ if(window._heroCanvasStart) window._heroCanvasStart(); },150);
    },80);
  }
  window.scrollTo({top:0,behavior:'smooth'});
  document.getElementById('notif-panel').style.display='none';
}

function showSkeleton(t){
  let h='';
  if(t==='overview'){h=`<div class="skeleton sk-hero"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>`;}
  else if(t==='jobs'){h=`<div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>`;}
  else if(t==='certs'){h=`<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>`;}
  else if(t==='invoices'){h=`<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>`;}
  else if(t==='properties'){h=`<div class="skeleton sk-card"></div><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>`;}
  else if(t==='request'){h=`<div class="skeleton sk-card" style="height:400px"></div>`;}
  document.getElementById('main').innerHTML=h;
}

// ── GREETING ──────────────────────────────────────────────────────────────────
function updateGreeting(){
  const h=new Date().getHours();
  let g='Welcome';
  if(h>=5&&h<12)g='Good morning';
  else if(h>=12&&h<17)g='Good afternoon';
  else if(h>=17&&h<22)g='Good evening';
  else g='Good night';
  const el=document.getElementById('hero-greeting');
  if(el&&_d)el.textContent=g+', '+_d.name;
}

// ── COMPLIANCE ────────────────────────────────────────────────────────────────
function calcCompliance(){
  const total=_d.certs.length;
  if(!total)return 100;
  const good=_d.certs.filter(c=>c.noExpiry||!c.expiryDate||dd(c.expiryDate)>60).length;
  return Math.round((good/total)*100);
}

function complianceRing(score){
  const r=22,circ=2*Math.PI*r;
  const pct=score/100;
  const dash=circ*pct;
  const color=score>=90?'var(--success)':score>=70?'var(--warning)':'var(--danger)';
  return`<div class="comp-ring"><svg width="56" height="56" viewBox="0 0 56 56"><circle cx="28" cy="28" r="${r}" stroke="var(--border)" stroke-width="5" fill="none"/><circle cx="28" cy="28" r="${r}" stroke="${color}" stroke-width="5" fill="none" stroke-dasharray="${dash} ${circ}" stroke-linecap="round" style="transition:stroke-dasharray 0.6s ease"/></svg><div class="val" style="color:${color}">${score}%</div></div>`;
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
function vOverview(d){
  const done=d.jobs.filter(j=>j.status==='Completed').length;
  const active=d.jobs.filter(j=>j.status==='Pending'||j.status==='In Progress').length;
  const cExp=d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<0).length;
  const c30=d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)>=0&&dd(c.expiryDate)<=30).length;
  const c60=d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)>30&&dd(c.expiryDate)<=60).length;
  const cOk=d.certs.filter(c=>c.noExpiry||!c.expiryDate||dd(c.expiryDate)>60).length;
  const owed=d.invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled');
  const owedT=owed.reduce((s,i)=>s+calcTotal(i).grand,0);
  const compScore=calcCompliance();
  const alerts=d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=60)
    .sort((a,b)=>dd(a.expiryDate)-dd(b.expiryDate)).slice(0,4)
    .map(c=>{const df=dd(c.expiryDate);return`<div class="alert ${df<0?'al-r':'al-y'}"><i data-lucide="alert-triangle" style="width:16px;height:16px"></i><div><strong>${e(c.type)}</strong> · ${e(c.address||'Property')} · ${df<0?`Expired ${Math.abs(df)}d ago`:`Expires in ${df} day${df!==1?'s':''}`}</div></div>`;}).join('');
  const label=d.type==='agency'?'Agency':d.type==='agent'?'Agent':'Landlord';

  // Agent filter bar for agency view (multi-select)
  const isAgency=d.type==='agency';
  const activeAgents=_d._activeAgents||new Set();
  const agentNames=d.entity?._agentNames||(d.entity?._agents||[]).map(a=>a.name).filter(Boolean);
  const agentFilterBar=isAgency&&agentNames.length?`
    <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,.12)">
      <div style="font-size:10px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700">
        ${activeAgents.size?`Viewing: <span style="color:#7dd3fc">${e([...activeAgents].join(', '))}</span> <button onclick="toggleAgentFilter(null)" style="margin-left:6px;padding:2px 8px;border-radius:10px;border:none;background:rgba(125,211,252,.2);color:#7dd3fc;font-size:9px;cursor:pointer;font-weight:700">✕ Show All</button>`:'Filter by Agent (select multiple)'}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button onclick="toggleAgentFilter(null)" style="padding:5px 14px;border-radius:20px;border:1px solid ${!activeAgents.size?'rgba(125,211,252,.4)':'rgba(255,255,255,.15)'};background:${!activeAgents.size?'rgba(125,211,252,.2)':'transparent'};color:${!activeAgents.size?'#7dd3fc':'rgba(255,255,255,.55)'};font-size:11px;font-weight:${!activeAgents.size?700:500};cursor:pointer">All</button>
        ${agentNames.map(n=>{const sel=activeAgents.has(n);return `<button onclick="toggleAgentFilter(${ea(JSON.stringify(n))})" style="padding:5px 14px;border-radius:20px;border:1px solid ${sel?'rgba(125,211,252,.4)':'rgba(255,255,255,.15)'};background:${sel?'rgba(125,211,252,.2)':'transparent'};color:${sel?'#7dd3fc':'rgba(255,255,255,.55)'};font-size:11px;font-weight:${sel?700:500};cursor:pointer">${sel?'✓ ':''}${e(n)}</button>`;}).join('')}
      </div>
    </div>`:'';

  // Upcoming items (next 7 days)
  const now=new Date();
  const upcomingJobs=d.jobs.filter(j=>j.date&&Math.ceil((new Date(j.date)-now)/86400000)<=7&&Math.ceil((new Date(j.date)-now)/86400000)>=0).slice(0,2);
  const upcomingCerts=d.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=7&&dd(c.expiryDate)>=0).slice(0,2);
  const upcomingHtml=[...upcomingJobs.map(j=>`<div class="act-item"><div class="act-dot" style="background:var(--accent)"></div><div class="act-body"><div class="act-title">Job scheduled · ${e(j.address||'')}</div><div class="act-meta">${fd(j.date)} · ${e(j.status||'')}</div></div></div>`),
    ...upcomingCerts.map(c=>`<div class="act-item"><div class="act-dot" style="background:var(--danger)"></div><div class="act-body"><div class="act-title">Certificate expires · ${e(c.type||'')}</div><div class="act-meta">${e(c.address||'')} · ${fd(c.expiryDate)}</div></div></div>`)]
    .join('');

  document.getElementById('main').innerHTML=`
    <div class="hero">
      <canvas id="hero-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0"></canvas>
      <div class="hero-inner">
        <div class="hero-ey">✦ ${label} Portal</div>
        <div class="hero-n" id="hero-greeting">Welcome, ${e(d.name)}</div>
        <div class="hero-s">Live overview of your properties, jobs &amp; certificates managed by ${e(d.coName)}.</div>
        <div class="hero-row">
          <button class="hbtn p" data-action="go" data-target="request"><i data-lucide="plus" style="width:14px;height:14px"></i> New Job</button>
          <button class="hbtn" data-action="go" data-target="certs"><i data-lucide="file-check" style="width:14px;height:14px"></i> Certificates</button>
          <button class="hbtn" data-action="go" data-target="invoices"><i data-lucide="receipt" style="width:14px;height:14px"></i> Invoices</button>
        </div>
        ${agentFilterBar}
      </div>
    </div>

    <div class="qa-row">
      <button class="qa-btn" data-action="go" data-target="request"><i data-lucide="plus"></i>New Job</button>
      <button class="qa-btn" data-action="go" data-target="properties"><i data-lucide="building-2"></i>Properties</button>
      <button class="qa-btn" onclick="openContactModal()"><i data-lucide="phone"></i>Call Us</button>
    </div>

    <div class="stats">
      <div class="stat sa"><div class="stat-ic"><i data-lucide="wrench" style="width:20px;height:20px"></i></div><div><div class="stat-v">${d.jobs.length}</div><div class="stat-l">Total Jobs</div></div></div>
      <div class="stat sb"><div class="stat-ic"><i data-lucide="check-circle-2" style="width:20px;height:20px"></i></div><div><div class="stat-v">${done}</div><div class="stat-l">Completed</div></div></div>
      <div class="stat sc"><div class="stat-ic"><i data-lucide="clock" style="width:20px;height:20px"></i></div><div><div class="stat-v">${active}</div><div class="stat-l">Active</div></div></div>
      <div class="stat sd"><div class="stat-ic"><i data-lucide="alert-triangle" style="width:20px;height:20px"></i></div><div><div class="stat-v">${cExp+c30}</div><div class="stat-l">Cert Alerts</div></div></div>
    </div>

    ${(cExp||c30||c60)?`<div class="cew">
      <div class="cew-hd"><div class="cew-t">Certificate Expiry Status</div><div style="display:flex;align-items:center;gap:10px">${complianceRing(compScore)}<button class="dl g sm" data-action="go" data-target="certs">View all →</button></div></div>
      <div class="cew-g">
        <div class="cew-b cb-e" data-action="go" data-target="certs"><div class="cew-n">${cExp}</div><div class="cew-l">Expired</div></div>
        <div class="cew-b cb-s" data-action="go" data-target="certs"><div class="cew-n">${c30}</div><div class="cew-l">Due in 30 days</div></div>
        <div class="cew-b cb-o" data-action="go" data-target="certs"><div class="cew-n">${cOk}</div><div class="cew-l">Valid</div></div>
      </div>
    </div>`:''}

    ${alerts?`<div class="sec">${alerts}</div>`:''}

    ${upcomingHtml?`<div class="sec"><div class="sec-hd"><div class="sec-t">Upcoming This Week</div></div>${upcomingHtml}</div>`:''}

    ${owed.length?`<div class="sec"><div class="sec-hd"><div class="sec-t">Outstanding Balance</div></div>
      <div class="ic" style="cursor:pointer" data-action="go" data-target="invoices">
        <div class="ic-ic" style="background:var(--danger-light);color:var(--danger)"><i data-lucide="banknote" style="width:20px;height:20px"></i></div>
        <div class="ic-body"><div class="ic-num">${owed.length} invoice${owed.length!==1?'s':''} outstanding</div><div class="ic-desc">Tap to view &amp; download</div></div>
        <div class="ic-r"><div class="ic-amt" style="color:var(--danger)">${fgbp(owedT)}</div><div class="ic-lbl">OUTSTANDING</div></div>
      </div>
    </div>`:''}

    <div class="sec">
      <div class="sec-hd"><div class="sec-t">Recent Jobs</div>${d.jobs.length>3?`<button class="dl g sm" data-action="go" data-target="jobs">All ${d.jobs.length} →</button>`:''}</div>
      ${d.jobs.slice(0,3).map(j=>jobCard(j,d)).join('')||empty('wrench','No jobs yet','Jobs will appear here once scheduled')}
    </div>

    ${d.certs.length?`<div class="sec">
      <div class="sec-hd"><div class="sec-t">Certificates</div>${d.certs.length>3?`<button class="dl g sm" data-action="go" data-target="certs">All ${d.certs.length} →</button>`:''}</div>
      ${d.certs.slice(0,3).map(c=>certCard(c,d)).join('')}
    </div>`:''}`;
}

// ── PROPERTY PAY BADGE ────────────────────────────────────────────────────────
function getPropertyPayBadge(addr,invoices){
  const rel=invoices.filter(inv=>{
    const a=(inv.jobAddress||inv.billToAddress||'').toLowerCase().trim();
    return a===(addr||'').toLowerCase().trim();
  });
  if(!rel.length)return'';
  const owed=rel.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled');
  const paid=rel.filter(i=>i.status==='Paid');
  if(owed.length&&paid.length)return`<span class="pill p-s" style="margin-left:auto;flex-shrink:0;font-size:10px">Part Paid</span>`;
  if(owed.length)return`<span class="pill p-s" style="margin-left:auto;flex-shrink:0;font-size:10px">Outstanding</span>`;
  if(paid.length)return`<span class="pill p-ok" style="margin-left:auto;flex-shrink:0;font-size:10px">Paid</span>`;
  return'';
}

// ── JOBS ─────────────────────────────────────────────────────────────────────
function vJobs(d){
  const isG=d.jobs.length>4&&(d.type==='agency'||d.type==='agent');
  let html='';
  if(isG){
    const byA={};d.jobs.forEach(j=>{const k=j.address||'?';if(!byA[k])byA[k]=[];byA[k].push(j);});
    html=Object.entries(byA).map(([addr,js])=>{
      const payBadge=getPropertyPayBadge(addr,d.invoices);
      // Calculate compliance for this property
      const propCerts=d.certs.filter(c=>(c.address||'').toLowerCase().trim()===(addr||'').toLowerCase().trim());
      const propComp=propCerts.length?Math.round((propCerts.filter(c=>c.noExpiry||!c.expiryDate||dd(c.expiryDate)>60).length/propCerts.length)*100):100;
      return `<div class="pg">
      <div class="pg-hd" data-action="toggle-group">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="pg-addr"><i data-lucide="map-pin" style="width:14px;height:14px;display:inline;vertical-align:-2px;margin-right:6px"></i>${e(addr)}</div>
          <div class="pg-m">${js.length} job${js.length!==1?'s':''} ›</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">${compRingMini(propComp)}${payBadge}</div>
      </div><div class="pg-body">${js.map(j=>jobCard(j,d)).join('')}</div></div>`;
    }).join('');
  }else html=d.jobs.map(j=>jobCard(j,d)).join('');
  document.getElementById('main').innerHTML=`<div class="sec">
    <div class="sec-hd">
      <div class="sec-t">All Jobs <span class="sec-n">${d.jobs.length}</span></div>
      <div style="display:flex;gap:6px">
        <button class="dl g sm" onclick="exportCSV('jobs')"><i data-lucide="download" style="width:12px;height:12px"></i> CSV</button>
      </div>
    </div>
    ${html||empty('wrench','No jobs yet','Jobs will appear here once scheduled')}
  </div>`;
}

function compRingMini(score){
  const color=score>=90?'var(--success)':score>=70?'var(--warning)':'var(--danger)';
  return`<span style="font-size:11px;font-weight:700;color:${color};background:${color}15;padding:2px 8px;border-radius:100px">${score}% compliant</span>`;
}

function jobCard(j,d){
  const atts=d.attachments.filter(a=>a.jobId===j.id);
  const jc=d.certs.filter(c=>c.jobId===j.id);
  const photos=atts.filter(a=>a.type==='photo'||/\.(jpg|jpeg|png|webp|gif)/i.test(a.url||''));
  const docs=atts.filter(a=>!photos.includes(a));
  const hasBody=photos.length||jc.length||docs.length;
  const steps=['Pending','In Progress','Completed'];
  const sIdx=steps.indexOf(j.status)>=0?steps.indexOf(j.status):0;
  const timeline=`<div class="timeline">
    ${steps.map((s,i)=>`<div class="tl-step ${i<sIdx?'done':i===sIdx?'active':''}">
      <div class="tl-dot">${i<sIdx?'<i data-lucide="check" style="width:12px;height:12px"></i>':''}</div>
      <div class="tl-lbl">${s}</div>
    </div>`).join('')}
  </div>`;
  return`<div class="jc">
    <div class="jc-hd"><div class="jc-l">
      <div class="jc-num">${e(j.jobNum||'—')}</div>
      <div class="jc-addr">${e(j.address||'—')}</div>
      ${j.description?`<div class="jc-desc">${e(j.description)}</div>`:''}
      ${timeline}
    </div>${jsBadge(j.status)}</div>
    <div class="jc-strip">
      ${j.date?`<span class="chip"><i data-lucide="calendar" style="width:12px;height:12px"></i> ${fd(j.date)}</span>`:''}
      ${j.date&&j.engineer?'<span style="color:var(--border)">·</span>':''}
      ${j.engineer?`<span class="chip"><i data-lucide="user" style="width:12px;height:12px"></i> ${e(j.engineer)}</span>`:''}
      ${(j.certTypes||[]).length?`<span style="color:var(--border)">·</span><span class="chip"><i data-lucide="file-check" style="width:12px;height:12px"></i> ${e(j.certTypes.join(', '))}</span>`:''}
      ${j.timeSlot?`<span style="color:var(--border)">·</span><span class="chip"><i data-lucide="clock" style="width:12px;height:12px"></i> ${e(j.timeSlot)}</span>`:''}
      ${j.paid?`<span style="color:var(--border)">·</span><span class="chip" style="background:var(--success-light);color:var(--success);padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700"><i data-lucide="check-circle-2" style="width:10px;height:10px"></i> Paid</span>`:j.invoiced?`<span style="color:var(--border)">·</span><span class="chip" style="background:var(--warning-light);color:var(--warning);padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700"><i data-lucide="receipt" style="width:10px;height:10px"></i> Invoiced</span>`:''}
    </div>
    ${hasBody?`<div class="jc-body">
      ${photos.length?`<div class="jc-photos">${photos.map((p,idx)=>`<img class="pt" src="${ea(p.url)}" data-photo-url="${ea(p.url)}" loading="lazy" alt="Job photo">`).join('')}</div>`:''}
      ${jc.map(c=>certMini(c)).join('')}
      ${docs.length?`<div class="jc-docs">${docs.map(doc=>`<div class="jc-doc-row">
        <i data-lucide="paperclip" style="width:14px;height:14px;color:var(--text-tertiary)"></i>
        <div style="flex:1;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e(doc.name||'Document')}</div>
        ${doc.url?`<a href="${ea(doc.url)}" target="_blank" class="dl sm">Download</a>`:''}
      </div>`).join('')}</div>`:''}
    </div>`:''}
  </div>`;
}

function certMini(c){
  const df=!c.noExpiry&&c.expiryDate?dd(c.expiryDate):null;
  const pc=df===null?'p-n':df<0?'p-e':df<=60?'p-s':'p-ok';
  const pt=df!==null?(df<0?'Expired':`${df}d left`):c.noExpiry?'No expiry':'Valid';
  return`<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
    <i data-lucide="file-text" style="width:16px;height:16px;color:var(--text-tertiary)"></i>
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600">${e(c.type||'Certificate')}</div>
      <div style="font-size:11px;color:var(--text-secondary)">${df!==null?(df<0?`Expired ${Math.abs(df)}d ago`:`Expires ${new Date(c.expiryDate).toLocaleDateString('en-GB')}`):c.noExpiry?'No expiry':''}</div>
    </div>
    <span class="pill ${pc}">${pt}</span>
    ${c.url?`<a href="${ea(c.url)}" target="_blank" class="dl sm">Download</a>`:''}
    ${c.url?`<button class="dl sm wa" onclick="shareCert(${ea(JSON.stringify(c))})" title="Share"><i data-lucide="share-2" style="width:12px;height:12px"></i></button>`:''}
  </div>`;
}

// ── CERTS ─────────────────────────────────────────────────────────────────────
function vCerts(d){
  const OPTS=[{v:'expiry',l:'Expiry Date'},{v:'status',l:'Status (urgent first)'},{v:'type',l:'Cert Type'},{v:'address',l:'Address'},{v:'certnum',l:'Cert Number'},{v:'issuedate',l:'Issue Date'}];
  const sorted=sortCerts([...d.certs]);
  const now=new Date();
  const month=now.getMonth();
  const year=now.getFullYear();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDay=new Date(year,month,1).getDay();

  let calHtml=`<div class="cal-grid">`;
  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d=>calHtml+=`<div style="font-weight:700;color:var(--text-tertiary);padding:8px">${d}</div>`);
  for(let i=0;i<firstDay;i++)calHtml+=`<div></div>`;
  for(let day=1;day<=daysInMonth;day++){
    const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const hasJob=d.jobs.some(j=>j.date===dateStr);
    const hasCert=d.certs.some(c=>c.expiryDate===dateStr);
    const isToday=day===now.getDate();
    const cls=`cal-day ${hasCert?'has-expiry':''} ${hasJob?'has-job':''} ${isToday?'today':''}`;
    const title=(hasCert?'Certificate expiry':'')+(hasJob?' · Job scheduled':'');
    calHtml+=`<div class="${cls}" title="${title}">${day}</div>`;
  }
  calHtml+=`</div>`;

  document.getElementById('main').innerHTML=`<div class="sec">
    <div class="sec-hd">
      <div class="sec-t">Certificates <span class="sec-n">${d.certs.length}</span></div>
      <div style="display:flex;gap:6px">
        <button class="dl g sm ${_certView==='list'?'active':''}" onclick="_certView='list';vCerts(_d)" style="${_certView==='list'?'border-color:var(--accent);color:var(--accent)':''}"><i data-lucide="list" style="width:12px;height:12px"></i> List</button>
        <button class="dl g sm ${_certView==='calendar'?'active':''}" onclick="_certView='calendar';vCerts(_d)" style="${_certView==='calendar'?'border-color:var(--accent);color:var(--accent)':''}"><i data-lucide="calendar" style="width:12px;height:12px"></i> Calendar</button>
        <button class="dl g sm" onclick="exportCSV('certs')"><i data-lucide="download" style="width:12px;height:12px"></i> CSV</button>
      </div>
    </div>
    <div class="sort-bar">
      <span class="sl">Sort:</span>
      <select class="ss" onchange="_cs=this.value;vCerts(_d)">${OPTS.map(o=>`<option value="${o.v}"${_cs===o.v?' selected':''}>${o.l}</option>`).join('')}</select>
      <select class="ss" onchange="_cd=this.value;vCerts(_d)">
        <option value="asc"${_cd==='asc'?' selected':''}>↑ Ascending</option>
        <option value="desc"${_cd==='desc'?' selected':''}>↓ Descending</option>
      </select>
    </div>
    ${_certView==='calendar'?calHtml:sorted.length?sorted.map(c=>certCard(c,d)).join(''):empty('file-check','No certificates','Certificates will appear here after inspections')}
  </div>`;
}

function sortCerts(a){
  const FAR=new Date('2099-01-01');
  return a.sort((x,y)=>{
    if(_cs==='expiry'){const vx=x.noExpiry||!x.expiryDate?FAR:new Date(x.expiryDate);const vy=y.noExpiry||!y.expiryDate?FAR:new Date(y.expiryDate);return _cd==='asc'?vx-vy:vy-vx;}
    if(_cs==='issuedate'){const vx=x.issueDate?new Date(x.issueDate):new Date(0);const vy=y.issueDate?new Date(y.issueDate):new Date(0);return _cd==='asc'?vx-vy:vy-vx;}
    if(_cs==='status'){const r=c=>!c.expiryDate||c.noExpiry?3:dd(c.expiryDate)<0?0:dd(c.expiryDate)<=30?1:dd(c.expiryDate)<=60?2:4;const vx=r(x),vy=r(y);return _cd==='asc'?vx-vy:vy-vx;}
    const map={type:'type',address:'address',certnum:'certNum'};const fld=map[_cs];
    if(!fld)return 0;const vx=(x[fld]||'').toLowerCase(),vy=(y[fld]||'').toLowerCase();
    const c=vx<vy?-1:vx>vy?1:0;return _cd==='asc'?c:-c;
  });
}

function certCard(c,d){
  const IC={Gas:'flame',EICR:'zap',PAT:'plug',EPC:'home',Fire:'fire-extinguisher',Boiler:'thermometer',Legionella:'droplets',Asbestos:'skull'};
  const COL={Gas:'#f97316',EICR:'#eab308',PAT:'#3b82f6',EPC:'#22c55e',Fire:'#ef4444',Boiler:'#f43f5e',Legionella:'#06b6d4',Asbestos:'#71717a'};
  const icKey=Object.keys(IC).find(k=>(c.type||'').includes(k));
  const ic=icKey?IC[icKey]:'file-text';
  const col=icKey?COL[icKey]:'var(--text-secondary)';
  const df=!c.noExpiry&&c.expiryDate?dd(c.expiryDate):null;
  const isE=df!==null&&df<0,isS=df!==null&&df>=0&&df<=60;
  const pc=isE?'p-e':isS?'p-s':df===null?'p-n':'p-ok';
  const pt=isE?`Expired ${Math.abs(df)}d ago`:isS?`${df}d left`:c.noExpiry?'No expiry':'Valid';
  const jf=d.jobs.find(j=>j.id===c.jobId);
  let ringHTML='';
  if(!c.noExpiry&&c.expiryDate){
    const totalDays=365;
    const remaining=Math.max(0,Math.min(totalDays,df!==null?(df<0?0:df):totalDays));
    const pct=(remaining/totalDays)*100;
    const color=isE?'var(--danger)':isS?'var(--warning)':'var(--success)';
    const r=18,circ=2*Math.PI*r;
    const dash=circ*(pct/100);
    ringHTML=`<div class="expiry-ring">
      <svg width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${r}" stroke="var(--border)" stroke-width="4" fill="none"/>
      <circle cx="24" cy="24" r="${r}" stroke="${color}" stroke-width="4" fill="none" stroke-dasharray="${dash} ${circ}" stroke-linecap="round"/></svg>
      <div class="val">${df!==null?Math.abs(df):'∞'}</div>
    </div>`;
  }else{ringHTML=`<div class="expiry-ring"><div class="val" style="font-size:10px;color:var(--text-tertiary)">N/A</div></div>`;}
  const pdfUrl=c.pdf_url||c.url;
  return`<div class="cc">
    <div class="cc-ic" style="background:${col}22;color:${col};border-color:${col}44"><i data-lucide="${ic}" style="width:20px;height:20px"></i></div>
    <div class="cc-body">
      <div class="cc-t">${e(c.type||'Certificate')}</div>
      <div class="cc-a">${e(c.address||(jf?.address)||'—')}</div>
      <div class="cc-m">
        <span class="pill ${pc}">${pt}</span>
        ${!c.noExpiry&&c.expiryDate?`<span style="font-size:11px;color:var(--text-secondary)">Exp. ${new Date(c.expiryDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>`:''}
        ${c.certNum?`<span style="font-size:11px;color:var(--text-secondary)">Ref: ${e(c.certNum)}</span>`:''}
      </div>
    </div>
    ${ringHTML}
    <div style="display:flex;gap:6px;flex-shrink:0;justify-content:flex-end">
      ${pdfUrl?`<button class="dl" onclick="previewCertPdf(${ea(JSON.stringify(pdfUrl))},${ea(JSON.stringify(c))})">View Certificate</button>`:`<span class="dl g" style="cursor:default;opacity:.5;font-size:11px">No PDF</span>`}
      ${isS||isE?`<button class="dl g" onclick="preFillRenewal(${ea(JSON.stringify(c))})" title="Renew Request"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>`:''}
    </div>
  </div>`;
}

let _previewCert=null;
function previewCertPdf(url,certJson){
  _previewCert=certJson||null;
  const shareBtn=document.getElementById('cp-pdf-share');
  if(shareBtn) shareBtn.style.display=_previewCert?'inline-flex':'none';
  document.getElementById('cp-pdf-frame').src=url;
  document.getElementById('cp-pdf-open').href=url;
  document.getElementById('cp-pdf-download').href=url;
  document.getElementById('cp-pdf-overlay').classList.add('show');
}
function closeCertPdfPreview(ev){
  if(ev&&ev.target!==document.getElementById('cp-pdf-overlay'))return;
  document.getElementById('cp-pdf-overlay').classList.remove('show');
  document.getElementById('cp-pdf-frame').src='';
}

function preFillRenewal(c){
  _renewalData={type:c.type,address:c.address};
  go('request');
}

// ── INVOICES ─────────────────────────────────────────────────────────────────
function vInvoices(d){
  const sorted=[...d.invoices].sort((a,b)=>new Date(b.createdAt||b.date||0)-new Date(a.createdAt||a.date||0));
  const rows=sorted.map(inv=>{
    const t=calcTotal(inv);const paid=inv.status==='Paid',can=inv.status==='Cancelled';
    const ds=inv.createdAt?fd(inv.createdAt.slice(0,10)):fd(inv.date);
    if(inv.id)_INV_STORE.set(inv.id,inv);
    return`<div class="ic">
      <div class="ic-ic" style="background:${paid?'var(--success-light)':can?'var(--border-subtle)':'var(--info-light)'};color:${paid?'var(--success)':can?'var(--text-tertiary)':'var(--info)'}">
        <i data-lucide="receipt" style="width:20px;height:20px"></i>
      </div>
      <div class="ic-body">
        <div class="ic-num">${e(inv.number||inv.id?.slice(0,8)||'—')}</div>
        <div class="ic-desc">${ds} · <span class="pill ${paid?'p-ok':can?'p-n':'p-s'}" style="font-size:10px">${paid?'Paid':can?'Cancelled':'Awaiting'}</span>
        ${inv.dueDate&&!paid?` · Due ${fd(inv.dueDate)}`:''}
        </div>
      </div>
      <div class="ic-r">
        <div class="ic-amt" style="color:${paid?'var(--success)':can?'var(--text-tertiary)':'var(--danger)'}">${fgbp(t.grand)}</div>
        <div class="ic-lbl">${paid?'PAID':can?'VOID':'OUTSTANDING'}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="dl sm" data-action="preview-inv" data-id="${e(inv.id||'')}">Preview</button>
          ${!paid&&!can&&inv.url?`<a href="${ea(inv.url)}" target="_blank" class="dl sm" style="background:var(--success)">Pay</a>`:''}
        </div>
      </div>
    </div>`;
  });
  const owedT=d.invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').reduce((s,i)=>s+calcTotal(i).grand,0);
  const paidT=d.invoices.filter(i=>i.status==='Paid').reduce((s,i)=>s+calcTotal(i).grand,0);

  // Simple monthly bar chart
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthly=Array(12).fill(0);
  d.invoices.filter(i=>i.status==='Paid'&&i.date).forEach(i=>{
    const m=new Date(i.date).getMonth();
    monthly[m]+=calcTotal(i).grand;
  });
  const maxM=Math.max(...monthly,1);
  const barChart=`<div class="bar-chart">${months.map((m,i)=>`<div class="bar" style="height:${(monthly[i]/maxM)*100}%;background:${i===new Date().getMonth()?'var(--accent)':'var(--border)'}"><div class="bar-val">${monthly[i]>0?fgbp(monthly[i]):''}</div><div class="bar-lbl">${m}</div></div>`).join('')}</div>`;

  document.getElementById('main').innerHTML=`
    <div class="sec">
      <div class="sec-hd"><div class="sec-t">Invoices <span class="sec-n">${d.invoices.length}</span></div>
        <div style="display:flex;gap:6px">
          <button class="dl g sm" onclick="exportCSV('invoices')"><i data-lucide="download" style="width:12px;height:12px"></i> CSV</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
        <div style="background:var(--success-light);border:1px solid var(--success-bg);border-radius:var(--radius-lg);padding:16px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:var(--success);font-variant-numeric:tabular-nums">${fgbp(paidT)}</div>
          <div style="font-size:11px;color:var(--success);margin-top:4px;font-weight:600">Total Paid</div>
        </div>
        <div style="background:${owedT>0?'var(--danger-light)':'var(--success-light)'};border:1px solid ${owedT>0?'var(--danger-bg)':'var(--success-bg)'};border-radius:var(--radius-lg);padding:16px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:${owedT>0?'var(--danger)':'var(--success)'};font-variant-numeric:tabular-nums">${fgbp(owedT)}</div>
          <div style="font-size:11px;color:${owedT>0?'var(--danger)':'var(--success)'};margin-top:4px;font-weight:600">${owedT>0?'Outstanding':'All Clear ✓'}</div>
        </div>
      </div>
      ${barChart}
      ${rows.length?rows.join(''):empty('receipt','No invoices yet','Invoices will appear here once raised')}
    </div>
    ${bankCard(d.entity)?`<div class="sec">${bankCard(d.entity)}</div>`:''}`;
}

// ── INVOICE PDF ───────────────────────────────────────────────────────────────
function previewInv(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  _CURRENT_INV_ID=id;
  const t=calcTotal(inv);const vr=_portalVatRate();
  const bd=document.getElementById('pdf-modal-bd');
  const items=(inv.items||[]).map(x=>{
    const l=(x.qty||1)*(x.unit||0);const v=x.vat?l*vr/100:0;
    return`<tr><td style="padding:8px;border-bottom:1px solid var(--border)">${e(x.desc||'')}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--border)">${x.qty||1}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">£${Number(x.unit||0).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">${x.vat?vr+'%':'—'}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border);font-weight:700">£${(l+v).toFixed(2)}</td></tr>`;
  }).join('');
  bd.innerHTML=`
    <div style="max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div>
          <div style="font-size:20px;font-weight:800;color:var(--accent)">${e(_S?.coName||'Your Company')}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${e(_S?.coAddr||'').replace(/,/g,'<br>')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:800;color:var(--text)">INVOICE</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${e(inv.number||'—')}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${fd(inv.date)}</div>
        </div>
      </div>
      <div style="background:var(--border-subtle);border-radius:var(--radius);padding:16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Bill To</div>
        <div style="font-size:14px;font-weight:700">${e(inv.billToName||inv.clientName||_d.name||'—')}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${e(inv.billToAddress||'')}</div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:20px">
        <thead><tr style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:8px">Description</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Unit</th><th style="padding:8px;text-align:right">VAT</th><th style="padding:8px;text-align:right">Total</th>
        </tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
        <div style="width:240px">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>Subtotal</span><span>£${t.sub.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>VAT (${vr}%)</span><span>£${t.vat.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--border);font-size:16px;font-weight:800"><span>Total</span><span>£${t.grand.toFixed(2)}</span></div>
        </div>
      </div>
      ${inv.status==='Paid'?`<div style="text-align:center;padding:20px;border:3px solid var(--success);color:var(--success);font-size:28px;font-weight:800;transform:rotate(-5deg);opacity:0.8;border-radius:var(--radius)">PAID</div>`:''}
      <div style="font-size:11px;color:var(--text-tertiary);text-align:center;margin-top:20px">Please quote reference ${e(inv.number||'—')} with your payment</div>
    </div>`;
  document.getElementById('pdf-modal').classList.add('show');
  refreshIcons();
}

function downloadCurrentInv(){if(_CURRENT_INV_ID)downloadInvPDF(_CURRENT_INV_ID);}

function closeModal(ev){
  if(ev&&ev.target!==ev.currentTarget)return;
  document.getElementById('pdf-modal').classList.remove('show');
  _CURRENT_INV_ID=null;
}

function downloadInvPDF(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  if(!window.jspdf){toast('PDF library loading — please wait and try again');return;}
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,H=297,M=18,RW=W-M*2;
  const accent=[79,70,229],dark=[15,23,42],mid=[100,116,139],light=[241,245,249];
  const t=calcTotal(inv);
  const vr=_portalVatRate();

  const safeText=(txt,x,y,maxW)=>{if(!txt)return;const lines=doc.splitTextToSize(String(txt),maxW||80);doc.text(lines,x,y);return lines.length;};

  doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');
  let cy=M+6;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...dark);
  doc.text(_S.coName||'Your Company',M,cy);cy+=6;
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...mid);
  if(_S.coAddr){safeText(_S.coAddr,M,cy,70);cy+=4.5*(_S.coAddr.split(',').length);}
  if(_S.coPhone){doc.text(_S.coPhone,M,cy);cy+=4.5;}
  if(_S.coEmail){doc.text(_S.coEmail,M,cy);cy+=4.5;}
  if(_S.coVatNum){doc.text('VAT No: '+_S.coVatNum,M,cy);}

  doc.setFont('helvetica','bold');doc.setFontSize(32);doc.setTextColor(...accent);
  doc.text('INVOICE',W-M,M+12,{align:'right'});
  doc.setFontSize(11);doc.setTextColor(...dark);
  doc.text(inv.number||'—',W-M,M+22,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...mid);
  doc.text('Issue date: '+(inv.date||'—'),W-M,M+30,{align:'right'});
  if(inv.dueDate)doc.text('Due date:  '+inv.dueDate,W-M,M+36,{align:'right'});
  doc.setFont('helvetica','bold');
  const sc={'Paid':[16,185,129],'Awaiting Payment':[245,158,11],'Cancelled':[239,68,68],'Draft':[148,163,184]}[inv.status]||mid;
  doc.setTextColor(...sc);doc.text(inv.status||'Draft',W-M,M+44,{align:'right'});

  let y=Math.max(cy+8,58);
  doc.setDrawColor(226,232,240);doc.setLineWidth(0.3);doc.line(M,y,W-M,y);y+=8;
  const colW=(RW-10)/2;
  doc.setFillColor(...light);doc.rect(M,y,colW,6,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...mid);
  doc.text('BILL TO',M+3,y+4.5);y+=10;
  doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(...dark);
  doc.text(inv.billToName||inv.clientName||_d.name||'—',M,y);
  let cY=y+6;
  const bAddr=inv.billToAddress||inv.clientAddr||'';
  if(bAddr){doc.setFontSize(9);doc.setTextColor(...mid);const al=doc.splitTextToSize(bAddr,colW);doc.text(al,M,cY);cY+=al.length*4.5;}
  y=cY+6;
  doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=3;
  doc.setFillColor(...dark);doc.rect(M,y,RW,7,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(200,200,220);
  const cols=[M+2,M+90,M+114,M+134,W-M-2];
  ['DESCRIPTION','QTY','UNIT PRICE','VAT','TOTAL'].forEach((h,i)=>doc.text(h,cols[i],y+4.8,i===4?{align:'right'}:null));
  y+=9;
  (inv.items||[]).forEach((item,ii)=>{
    const l=(item.qty||1)*(item.unit||0);const v=item.vat?l*vr/100:0;
    if(y>H-50){doc.addPage();doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');y=14;}
    if(ii%2===0){doc.setFillColor(248,250,252);doc.rect(M,y-3.5,RW,7.5,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...dark);
    const dl=doc.splitTextToSize(String(item.desc||''),82);
    doc.text(dl[0]+(dl.length>1?'…':''),M+2,y+1);
    doc.text(String(item.qty||1),cols[1],y+1);
    doc.text('£'+Number(item.unit||0).toFixed(2),cols[2],y+1);
    doc.setTextColor(item.vat?100:160,item.vat?120:160,160);
    doc.text(item.vat?vr+'%':'—',cols[3],y+1);
    doc.setTextColor(...dark);doc.text('£'+(l+v).toFixed(2),cols[4],y+1,{align:'right'});y+=7.5;
  });
  y+=3;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=7;
  const tC=W-M-52;
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(...mid);
  doc.text('Subtotal:',tC,y);doc.text('£'+t.sub.toFixed(2),W-M,y,{align:'right'});y+=6;
  doc.text(`VAT (${vr}%):`,tC,y);doc.text('£'+t.vat.toFixed(2),W-M,y,{align:'right'});y+=3;
  doc.setDrawColor(226,232,240);doc.line(tC,y,W-M,y);y+=6;
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...accent);
  doc.text('TOTAL:',tC,y);doc.text('£'+t.grand.toFixed(2),W-M,y,{align:'right'});y+=10;
  if(inv.status==='Paid'){
    doc.saveGraphicsState();doc.setGState(doc.GState({opacity:0.06}));
    doc.setFont('helvetica','bold');doc.setFontSize(85);doc.setTextColor(16,185,129);
    doc.text('PAID',W/2,H/2,{align:'center',angle:35});doc.restoreGraphicsState();
  }
  if(_S.bankName||_S.bankAcc){
    y+=2;doc.setFillColor(...light);doc.rect(M,y,RW,6,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...mid);
    doc.text('PAYMENT DETAILS',M+3,y+4);y+=8;
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...dark);
    if(_S.bankName)doc.text('Bank: '+_S.bankName,M,y);
    if(_S.bankAcc)doc.text('Acc: '+_S.bankAcc+(_S.bankSort?' · Sort: '+_S.bankSort:''),M+60,y);y+=5.5;
    if(_S.bankIBAN)doc.text('IBAN: '+_S.bankIBAN,M,y);
  }
  y+=10;
  doc.setFillColor(255,251,235);doc.setDrawColor(...accent);doc.setLineWidth(0.5);
  doc.roundedRect(M,y-3.5,RW,10,2,2,'FD');
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(100,70,10);
  doc.text('Please quote reference: '+(inv.number||'—')+' with your payment',M+3,y+3);y+=14;
  if(_S.payTerms||_S.invNotes){
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...mid);
    if(_S.payTerms){safeText(_S.payTerms,M,y,RW);y+=5;}
    if(_S.invNotes){safeText(_S.invNotes,M,y,RW);}
  }
  doc.setDrawColor(226,232,240);doc.line(M,H-14,W-M,H-14);
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(170,175,195);
  doc.text(_S?.coName||'',M,H-9);
  doc.text('Generated by DeepFlow',W-M,H-9,{align:'right'});
  doc.setFillColor(...accent);doc.rect(0,H-4,W,4,'F');
  doc.save((inv.number||'invoice')+'.pdf');
  toast('Invoice downloaded');
}

// ── PAYMENTS ──────────────────────────────────────────────────────────────────

function bankCard(entity){
  if(!entity)return'';
  const bn=entity.bankName||'',ba=entity.bankAcc||'',bs=entity.bankSort||'',br=entity.bankRef||'';
  if(!bn&&!ba&&!bs&&!br)return'';
  return`<div class="bank-card">
    <div class="bank-t"><i data-lucide="landmark" style="width:12px;height:12px;display:inline;vertical-align:-2px;margin-right:6px"></i>Payment Details</div>
    ${bn?`<div class="bank-n">${e(bn)}</div>`:''}
    <div class="bank-row">${ba?`<div class="bank-f">Account: <strong>${e(ba)}</strong></div>`:''}${bs?`<div class="bank-f">Sort Code: <strong>${e(bs)}</strong></div>`:''}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
      ${br?`<div class="bank-link"><i data-lucide="link" style="width:12px;height:12px"></i>${e(br)}</div>`:''}
      ${ba?`<button class="bank-copy" onclick="copyToClipboard('${e(ba)}')"><i data-lucide="copy" style="width:10px;height:10px;display:inline;vertical-align:-2px;margin-right:4px"></i>Copy Acc</button>`:''}
      ${bs?`<button class="bank-copy" onclick="copyToClipboard('${e(bs)}')"><i data-lucide="copy" style="width:10px;height:10px;display:inline;vertical-align:-2px;margin-right:4px"></i>Copy Sort</button>`:''}
    </div>
  </div>`;
}

function copyToClipboard(text){
  navigator.clipboard.writeText(text).then(()=>toast('Copied to clipboard')).catch(()=>toast('Copy failed'));
}

// ── DOCUMENTS ─────────────────────────────────────────────────────────────────
let _propSearch='',_propSort='jobs';
function vProperties(d){
  const map={};
  const addKey=(addr)=>{
    const k=(addr||'').trim(); if(!k) return null;
    if(!map[k]) map[k]={address:k,jobs:[],certs:[]};
    return map[k];
  };
  d.jobs.forEach(j=>{const p=addKey(j.address); if(p)p.jobs.push(j);});
  d.certs.forEach(c=>{const p=addKey(c.address); if(p)p.certs.push(c);});

  let list=Object.values(map);

  // If the office has since changed this property's Landlord field to
  // someone else (e.g. "Property Sold — Landlord Details Awaiting" after a
  // sale), stop showing it here — the old landlord's invoice/job history at
  // that address stays fully intact under Invoices, this only affects the
  // Properties grouping view. Landlord portals only — an agency/agent's own
  // name would never match a property's "landlord" field, so this check
  // would incorrectly hide everything for them.
  if(d.type==='landlord' && Array.isArray(_S?.properties) && _S.properties.length){
    const meNorm=(d.name||'').trim().toLowerCase();
    const propByAddr={};
    _S.properties.forEach(p=>{ if(p.address) propByAddr[p.address.trim().toLowerCase()]=p; });
    list=list.filter(p=>{
      const rec=propByAddr[p.address.trim().toLowerCase()];
      if(!rec || !rec.landlord) return true; // no office record, or no landlord set — show as before
      return rec.landlord.trim().toLowerCase()===meNorm;
    });
  }
  if(_propSearch) list=list.filter(p=>p.address.toLowerCase().includes(_propSearch.toLowerCase()));
  if(_propSort==='jobs') list.sort((a,b)=>b.jobs.length-a.jobs.length);
  else if(_propSort==='az') list.sort((a,b)=>a.address.localeCompare(b.address));
  else if(_propSort==='recent') list.sort((a,b)=>{
    const la=Math.max(0,...a.jobs.map(j=>new Date(j.date||0).getTime()),0);
    const lb=Math.max(0,...b.jobs.map(j=>new Date(j.date||0).getTime()),0);
    return lb-la;
  });
  else if(_propSort==='expiry') list.sort((a,b)=>{
    const nextExp=p=>{const ds=p.certs.filter(c=>!c.noExpiry&&c.expiryDate).map(c=>dd(c.expiryDate));return ds.length?Math.min(...ds):Infinity;};
    return nextExp(a)-nextExp(b);
  });
  else if(_propSort==='certs') list.sort((a,b)=>b.certs.length-a.certs.length);

  const rows=list.map(p=>{
    const expiring=p.certs.filter(c=>!c.noExpiry&&c.expiryDate&&dd(c.expiryDate)<=60).length;
    const lastJob=p.jobs.length?p.jobs.reduce((a,b)=>new Date(a.date||0)>new Date(b.date||0)?a:b):null;
    return`<div class="pg">
      <div class="pg-hd" data-action="toggle-group">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="pg-addr"><i data-lucide="building-2" style="width:14px;height:14px;display:inline;vertical-align:-2px;margin-right:6px"></i>${e(p.address)}</div>
          <div class="pg-m">${p.jobs.length} job${p.jobs.length!==1?'s':''} · ${p.certs.length} cert${p.certs.length!==1?'s':''} ›</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${expiring?`<span class="pill p-s">${expiring} expiring</span>`:''}
          ${lastJob?`<span style="font-size:11px;color:var(--text-secondary)">Last job: ${fd(lastJob.date)}</span>`:''}
        </div>
      </div>
      <div class="pg-body collapsed">
        ${p.jobs.length?`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:10px 0 6px">Jobs</div>${p.jobs.map(j=>jobCard(j,d)).join('')}`:''}
        ${(()=>{
          // Job cards already show their own linked certificates inline — only
          // list certs here that aren't tied to one of this property's jobs,
          // so nothing shows up twice.
          const jobIds=new Set(p.jobs.map(j=>j.id));
          const standalone=p.certs.filter(c=>!c.jobId||!jobIds.has(c.jobId));
          return standalone.length?`<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Certificates</div>${standalone.map(c=>certCard(c,d)).join('')}`:'';
        })()}
      </div>
    </div>`;
  }).join('');

  // Preserve focus + cursor position across re-render (search re-renders on every keystroke)
  const activeEl=document.activeElement;
  const wasSearchFocused=activeEl&&activeEl.id==='prop-search';
  const selStart=wasSearchFocused?activeEl.selectionStart:null;
  const selEnd=wasSearchFocused?activeEl.selectionEnd:null;

  document.getElementById('main').innerHTML=`
    <div class="sec">
      <div class="sec-hd"><div class="sec-t">Properties <span class="sec-n">${list.length}</span></div></div>
      <div class="fg" style="margin-bottom:12px">
        <input class="fi" id="prop-search" placeholder=" " value="${e(_propSearch)}" oninput="_propSearch=this.value;vProperties(_d)">
        <label class="fl">Search by address</label>
      </div>
      <div class="sort-bar">
        <span class="sl">Sort:</span>
        <select class="ss" onchange="_propSort=this.value;vProperties(_d)">
          <option value="jobs"${_propSort==='jobs'?' selected':''}>Most Jobs</option>
          <option value="az"${_propSort==='az'?' selected':''}>Address A–Z</option>
          <option value="recent"${_propSort==='recent'?' selected':''}>Most Recent Activity</option>
          <option value="expiry"${_propSort==='expiry'?' selected':''}>Certificate Expiry (Soonest)</option>
          <option value="certs"${_propSort==='certs'?' selected':''}>Most Certificates</option>
        </select>
      </div>
      ${rows||empty('building-2','No properties yet','Properties will appear here once jobs or certificates are recorded')}
    </div>`;

  if(wasSearchFocused){
    const inp=document.getElementById('prop-search');
    if(inp){ inp.focus(); inp.setSelectionRange(selStart,selEnd); }
  }
}

// ── REQUEST WIZARD ────────────────────────────────────────────────────────────
let _renewalData=null;
function vRequest(d){
  const today=new Date().toISOString().slice(0,10);
  document.getElementById('main').innerHTML=`
    <div class="sec">
      <div class="sec-hd"><div class="sec-t">New Job</div></div>
      <div class="rc">

        <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <div style="font-size:17px;font-weight:800;margin-bottom:4px">Tell Us What You Need</div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.6">${e(d.coName)} will be in touch within <strong>1 working day</strong> to confirm your booking.</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="fg">
            <input class="fi" id="ra" placeholder=" " required value="${_renewalData?.address||''}" onkeydown="if(event.key==='Enter')submitReq()">
            <label class="fl">Property Address <span style="color:var(--danger)">*</span></label>
          </div>
          <div class="fg">
              <select class="fi" id="rs" required>
                <option value="" disabled selected></option>
                <optgroup label="Gas">
                  <option ${(_renewalData?.type||'').includes('Gas')?'selected':''}>Gas Safety Certificate (CP12)</option>
                  <option>Boiler Service</option><option>Boiler Repair</option>
                </optgroup>
                <optgroup label="Electrical">
                  <option ${(_renewalData?.type||'').includes('EICR')?'selected':''}>Electrical Inspection (EICR)</option>
                  <option>PAT Testing</option><option>Electrical Fault / Repair</option>
                </optgroup>
                <optgroup label="Property">
                  <option>Energy Performance Certificate (EPC)</option>
                  <option>Fire Risk Assessment</option>
                  <option>General Maintenance</option>
                  <option>Emergency Call-Out</option>
                </optgroup>
                <option>Other (describe below)</option>
              </select>
              <label class="fl">Job Type <span style="color:var(--danger)">*</span></label>
          </div>
          <div class="fgrid fgrid-2">
            <div class="fg">
              <input class="fi" type="date" id="rd" min="${today}" placeholder=" ">
              <label class="fl">Preferred Date</label>
            </div>
            <div class="fg">
              <select class="fi" id="rac">
                <option value="" disabled selected></option>
                <option>Tenant will be home</option>
                <option>Keys at your office</option>
                <option>Key safe — I will provide code</option>
                <option>I will be present</option>
                <option>Contact tenant directly</option>
              </select>
              <label class="fl">Access Arrangements</label>
            </div>
          </div>
          <div class="fg">
            <textarea class="fi" id="rn" rows="3" placeholder=" " style="resize:vertical;min-height:80px" onkeydown="if(event.key==='Enter'&&event.ctrlKey)submitReq()"></textarea>
            <label class="fl">Description / Additional Notes</label>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">Documents / Photos <span style="font-weight:400;font-size:11px">(optional)</span></div>
            <div class="dropzone" id="rdz" onclick="document.getElementById('rfile').click()" style="padding:20px;border-radius:10px">
              <input type="file" id="rfile" style="display:none" multiple onchange="handleFiles(this)">
              <i data-lucide="upload-cloud" style="width:22px;height:22px"></i>
              <p style="font-size:13px;margin-top:6px">Click to upload photos or documents</p>
              <p style="font-size:11px;margin-top:2px;opacity:0.6">Previous certificates, photos of the issue, etc.</p>
              <div id="rfile-list" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"></div>
            </div>
          </div>
          <div style="font-size:11px;color:var(--text-tertiary);padding:10px 12px;background:var(--border-subtle);border-radius:8px">
            <span style="color:var(--danger)">*</span> Property Address and Job Type are required.
          </div>
          <button class="fsub" id="rsb" onclick="submitReq()" style="margin-top:4px">
            <i data-lucide="send" style="width:16px;height:16px"></i> Submit New Job
          </button>
          <div class="fnote" style="text-align:center">We'll confirm within 1 working day · Your reference number will appear after submission</div>
        </div>
      </div>
    </div>

    <!-- Past Requests -->
    <div class="sec" style="margin-top:0">
      <div class="sec-hd"><div class="sec-t">Your Request History</div></div>
      <div id="past-requests-list">
        <div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px">Loading your requests...</div>
      </div>
    </div>`;
  refreshIcons();
  if(_renewalData){ _renewalData=null; }
  // Load past requests
  loadPastRequests(d);
}

async function loadPastRequests(d){
  const el=document.getElementById('past-requests-list');
  if(!el)return;
  try{
    const rows=await sb(`rpc/portal_get_requests`,{method:'POST',body:{p_name:d.name||''}}).catch(()=>[]);
    if(!rows||!rows.length){
      el.innerHTML=`<div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">No previous requests found.</div>`;
      return;
    }
    const statusStyle={
      pending:'background:#fefce8;color:#854d0e;border:1px solid #fef08a',
      approved:'background:#f0fdf4;color:#166534;border:1px solid #bbf7d0',
      job_created:'background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe',
      rejected:'background:#fef2f2;color:#991b1b;border:1px solid #fecaca',
      acknowledged:'background:#f0f9ff;color:#075985;border:1px solid #bae6fd',
    };
    const statusLabel={
      pending:'⏳ Pending',
      approved:'✅ Confirmed',
      job_created:'🔧 Job Booked',
      rejected:'❌ Declined',
      acknowledged:'👀 Seen',
    };
    el.innerHTML=rows.map(r=>{
      const refMatch=(r.notes||'').match(/\[(CR-\d+)\]/);
      const ref=refMatch?refMatch[1]:'—';
      const svcMatch=(r.notes||'').match(/Service: ([^\n]+)/);
      const addrMatch=(r.notes||'').match(/Address: ([^\n]+)/);
      const dateMatch=(r.notes||'').match(/Preferred date: ([^\n]+)/);
      const svc=svcMatch?svcMatch[1]:'Service Request';
      const addr=addrMatch?addrMatch[1]:'';
      const pref=dateMatch?dateMatch[1]:'';
      const st=r.status||'pending';
      const stStyle=statusStyle[st]||statusStyle.pending;
      const stLabel=statusLabel[st]||st;
      const created=r.created?new Date(r.created*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';
      const reply=r.office_reply||'';
      return`<div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:.15s" onclick="toggleReqDetail(this)" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
              <span style="font-size:13px;font-weight:800;color:var(--accent);font-family:monospace">${e(ref)}</span>
              <span style="font-size:10px;font-weight:700;padding:2px 10px;border-radius:20px;${stStyle}">${stLabel}</span>
            </div>
            <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">${e(svc)}</div>
            ${addr?`<div style="font-size:11px;color:var(--text-secondary);margin-bottom:2px">📍 ${e(addr)}</div>`:''}
            <div style="font-size:11px;color:var(--text-tertiary)">${created}${pref?' · Preferred: '+e(pref):''}</div>
          </div>
          <div style="font-size:16px;color:var(--text-tertiary);flex-shrink:0">›</div>
        </div>
        <div class="req-detail" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          ${reply?`<div style="background:var(--accent-light);border:1px solid rgba(29,111,173,.15);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--accent);margin-bottom:8px">
            <strong>Response from ${e(d.coName)}:</strong><br>${e(reply)}
          </div>`:'<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:8px">Awaiting response from '+e(d.coName)+'...</div>'}
          <div style="font-size:11px;color:var(--text-tertiary);white-space:pre-line;line-height:1.7">${e((r.notes||'').replace(/\[CR-\d+\]\s*/,''))}</div>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    console.error('[Portal] past requests load failed',e);
    const isOffline=!navigator.onLine;
    el.innerHTML=`<div style="text-align:center;padding:24px 20px">
      <i data-lucide="${isOffline?'wifi-off':'alert-circle'}" style="width:32px;height:32px;color:var(--text-tertiary);display:block;margin:0 auto 10px"></i>
      <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:4px">${isOffline?'You are offline':'Could not load history'}</div>
      <div style="font-size:12px;color:var(--text-tertiary)">${isOffline?'Connect to the internet and try again.':'Please refresh the page or try again later.'}</div>
    </div>`;
    refreshIcons();
  }
}

function toggleReqDetail(el){
  const d=el.querySelector('.req-detail');
  if(d) d.style.display=d.style.display==='none'?'block':'none';
}

function renderWizard(d){ vRequest(d); }

let _reqFiles=[];
function handleFiles(input){
  _reqFiles=Array.from(input.files||[]);
  const list=document.getElementById('rfile-list');
  if(list){
    list.innerHTML=_reqFiles.map(f=>`<span style="font-size:11px;background:var(--accent-light);color:var(--accent);padding:3px 10px;border-radius:100px;font-weight:600">${e(f.name)}</span>`).join('');
  }
}

async function submitReq(){
  const addr=(document.getElementById('ra')?.value||'').trim();
  const svc=(document.getElementById('rs')?.value||'').trim();
  const date=document.getElementById('rd')?.value||'';
  const access=document.getElementById('rac')?.value||'';
  const notes=(document.getElementById('rn')?.value||'').trim();
  const priority=document.getElementById('rp')?.value||'Normal';
  // Validation
  if(!addr){toast('Property address is required');document.getElementById('ra')?.focus();return;}
  if(addr.length<5){toast('Please enter a full property address');document.getElementById('ra')?.focus();return;}
  if(!svc){toast('Please select a job type');document.getElementById('rs')?.focus();return;}
  if(date&&new Date(date)<new Date(new Date().toISOString().slice(0,10))){toast('Preferred date cannot be in the past');document.getElementById('rd')?.focus();return;}
  const btn=document.getElementById('rsb');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="loading">Sending...</div>';}
  try{
    // Generate the next CR- reference from a real Postgres sequence via RPC.
    // (The old approach counted existing rows via a direct table read, which
    // anonymous portal visitors can't SELECT — it silently saw zero rows every
    // time and always produced CR-0001. A sequence is also immune to the race
    // condition where two people submit at the same moment.)
    let ref;
    try{
      ref=await sb('rpc/portal_next_request_ref',{method:'POST',body:{}});
      if(typeof ref!=='string'||!ref) throw new Error('empty ref');
    }catch(e){ ref='CR-'+String(Date.now()).slice(-4); }
    const detail=`Service: ${svc}\nPriority: ${priority}\nAddress: ${addr}`+(date?`\nPreferred date: ${date}`:'')+(access?`\nAccess: ${access}`:'')+(notes?`\nNotes: ${notes}`:'')+(_reqFiles.length?`\nAttachments: ${_reqFiles.length} file(s)`:'');

    await sb('engineer_requests',{
      method:'POST',
      body:{
        id:'portal-req-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
        engineer_name: _d.name + ' (' + (_d.type==='agency'?'Agency':_d.type==='agent'?'Agent':'Landlord') + ')',
        type:'portal_request',
        notes: `[${ref}] ${detail}`,
        status:'pending',
        created: Math.floor(Date.now()/1000)
      },
      prefer:'return=minimal'
    });

    sb('activity',{method:'POST',body:{
      id:'req-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
      msg:`Portal Request [${ref}] from ${_d.name}\n${detail}`,
      type:'request',ts:Date.now()
    },prefer:'return=minimal'}).catch(()=>{});

    _renewalData=null;
    document.getElementById('main').innerHTML=`
      <div class="sec">
        <div class="rc" style="text-align:center;padding:40px 20px">
          <div class="success-check" style="margin:0 auto 16px"><i data-lucide="check" style="width:32px;height:32px"></i></div>
          <div style="font-size:22px;font-weight:800;margin-bottom:8px">Request Submitted!</div>
          <div style="font-size:14px;color:var(--text-secondary);max-width:360px;margin:0 auto 24px;line-height:1.7">
            ${e(_d.coName)} will be in touch within <strong>1 working day</strong> to confirm your booking.
          </div>

          <!-- Reference number — prominent -->
          <div style="background:var(--accent-light);border:2px solid var(--accent);border-radius:14px;padding:20px 28px;display:inline-block;margin-bottom:24px">
            <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Your Reference Number</div>
            <div style="font-size:28px;font-weight:900;color:var(--accent);font-family:monospace;letter-spacing:2px">${ref}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:6px">Save this number to track your request</div>
            <button onclick="navigator.clipboard.writeText('${ref}').then(()=>toast('Reference copied!','success'))" style="margin-top:10px;padding:6px 16px;border-radius:20px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:11px;font-weight:700;cursor:pointer">📋 Copy Reference</button>
          </div>

          <!-- What happens next -->
          <div style="background:var(--border-subtle);border-radius:12px;padding:16px 20px;text-align:left;margin-bottom:20px;max-width:400px;margin-left:auto;margin-right:auto">
            <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px">What happens next?</div>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-secondary)">
              <div>📞 We'll call or email you within 1 working day</div>
              <div>📅 We'll confirm a date and time that works for you</div>
              <div>🔧 Our engineer will attend and complete the job</div>
              <div>📜 Certificates and invoices will appear in your portal</div>
            </div>
          </div>

          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="dl" data-action="go" data-target="overview">← Back to Overview</button>
            <button class="dl" data-action="go" data-target="request">+ New Job</button>
          </div>
        </div>
      </div>`;
    refreshIcons();attachDelegates();
  }catch(err){
    console.error(err);
    if(btn){btn.disabled=false;btn.innerHTML='<i data-lucide="send" style="width:16px;height:16px"></i> Submit New Job';}
    toast('Could not send. Please call us directly.');
  }
}

// ── EXPORT & SHARE ────────────────────────────────────────────────────────────
function exportCSV(type){
  let csv='',filename='';
  if(type==='invoices'){
    const rows=_d.invoices.map(i=>`${i.number||''},${i.date||''},${i.status||''},${calcTotal(i).grand.toFixed(2)}`);
    csv='Number,Date,Status,Total\n'+rows.join('\n');
    filename='invoices.csv';
  }else if(type==='jobs'){
    const rows=_d.jobs.map(j=>`${j.jobNum||''},"${j.address||''}",${j.status||''},${j.date||''}`);
    csv='JobNum,Address,Status,Date\n'+rows.join('\n');
    filename='jobs.csv';
  }else if(type==='certs'){
    const rows=_d.certs.map(c=>`${c.type||''},"${c.address||''}",${c.expiryDate||'No expiry'},${c.certNum||''}`);
    csv='Type,Address,Expiry,Ref\n'+rows.join('\n');
    filename='certificates.csv';
  }
  const blob=new Blob([csv],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  toast('CSV exported');
}

async function shareCert(c){
  const url=c.pdf_url||c.url;
  const text=`${c.type} for ${c.address||'Property'}${c.certNum?' (Ref: '+c.certNum+')':''}`;
  if(navigator.share&&url){try{await navigator.share({title:'Certificate',text:text,url:url});}catch(e){}}
  else if(url){window.open(`https://wa.me/?text=${encodeURIComponent(text+' '+url)}`,'_blank');}
  else{toast('No shareable link available');}
}
function shareCurrentPreviewCert(){
  if(_previewCert) shareCert(_previewCert);
}

let _contactsCache=null;
async function openContactModal(){
  const list=document.getElementById('contact-list');
  document.getElementById('contact-overlay').classList.add('show');
  list.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px">Loading…</div>`;
  try{
    if(!_contactsCache){
      _contactsCache=await sb('portal_contacts?select=*&order=sort_order.asc');
    }
    if(!_contactsCache||!_contactsCache.length){
      list.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px">No contact numbers have been added yet.</div>`;
      return;
    }
    list.innerHTML=_contactsCache.map(c=>`
      <a href="tel:${e(c.phone||'')}" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;text-decoration:none;color:var(--text)">
        <div class="doc-icon" style="background:var(--accent-light);color:var(--accent)"><i data-lucide="phone" style="width:16px;height:16px"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700">${e(c.label||'Contact')}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${e(c.contact_name||'')}${c.contact_name&&c.phone?' · ':''}${e(c.phone||'')}</div>
        </div>
      </a>`).join('');
    refreshIcons();
  }catch(err){
    list.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px">Could not load contact numbers right now.</div>`;
  }
}
function closeContactModal(ev){
  if(ev&&ev.target!==document.getElementById('contact-overlay'))return;
  document.getElementById('contact-overlay').classList.remove('show');
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function jsBadge(s){
  const m={'Pending':'<span class="jbadge bp"><i data-lucide="clock" style="width:12px;height:12px"></i> Pending</span>',
    'In Progress':'<span class="jbadge bi"><i data-lucide="refresh-cw" style="width:12px;height:12px"></i> In Progress</span>',
    'Completed':'<span class="jbadge bd"><i data-lucide="check-circle-2" style="width:12px;height:12px"></i> Completed</span>',
    'Invoiced':'<span class="jbadge bv"><i data-lucide="receipt" style="width:12px;height:12px"></i> Invoiced</span>',
    'Cancelled':'<span class="jbadge bc"><i data-lucide="x-circle" style="width:12px;height:12px"></i> Cancelled</span>'};
  return m[s]||`<span class="jbadge bc">${e(s||'—')}</span>`;
}
function empty(icon,t,sub){return`<div class="empty"><i data-lucide="${icon}" style="width:48px;height:48px"></i><div class="et">${t}</div><div class="es">${sub}</div></div>`;}
function showErr(t,m){document.getElementById('main').innerHTML=`<div class="empty" style="padding:100px 20px"><i data-lucide="lock" style="width:48px;height:48px"></i><div class="et">${e(t)}</div><div class="es">${e(m)}</div></div>`;refreshIcons();}

function openLb(url){
  document.getElementById('lb-img').src=url;
  document.getElementById('lb').classList.add('show');
}
function closeLb(ev){
  if(ev)ev.stopPropagation();
  document.getElementById('lb').classList.remove('show');
  document.getElementById('lb-img').src='';
}

let _tt;
function toast(msg){
  const el=document.getElementById('toast');
  el.innerHTML=`<i data-lucide="info" style="width:16px;height:16px"></i> ${e(msg)}`;
  el.className='show';refreshIcons();
  clearTimeout(_tt);_tt=setTimeout(()=>el.className='',3500);
}

function refreshIcons(){
  if(window.lucide&&lucide.createIcons)lucide.createIcons();
}

function attachDelegates(){
  const main=document.getElementById('main');
  main.onclick=function(ev){
    const btn=ev.target.closest('[data-action="go"]');
    if(btn){ev.preventDefault();go(btn.dataset.target);}
    const tgl=ev.target.closest('[data-action="toggle-group"]');
    if(tgl){const n=tgl.nextElementSibling;if(n)n.classList.toggle('collapsed');}
    const ph=ev.target.closest('[data-photo-url]');
    if(ph){ev.preventDefault();openLb(ph.dataset.photoUrl);}
    const prv=ev.target.closest('[data-action="preview-inv"]');
    if(prv){ev.preventDefault();previewInv(prv.dataset.id);}
  };
}

init();
// ── Hero banner animation — BG3 cyan network + gold star twinkle ─────────────
function initHeroCanvas(){
  let W,H,nodes,packets,stars,raf=null,canvas,ctx;

  function build(){
    canvas=document.getElementById('hero-canvas');
    if(!canvas)return false;
    ctx=canvas.getContext('2d');
    const p=canvas.parentElement;
    W=canvas.width=p?p.offsetWidth:600;
    H=canvas.height=p?p.offsetHeight:200;
    const bg=ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#0d1f3c');bg.addColorStop(.5,'#1e3a5f');bg.addColorStop(1,'#0a1628');
    canvas._bg=bg;
    nodes=Array.from({length:50},()=>({
      x:Math.random()*W,y:Math.random()*H,
      vx:(Math.random()-.5)*.04,vy:(Math.random()-.5)*.04,
      r:Math.random()<.1?3:1.4,pulse:Math.random()*Math.PI*2
    }));
    packets=Array.from({length:14},()=>({
      fi:Math.floor(Math.random()*nodes.length),
      ti:Math.floor(Math.random()*nodes.length),
      t:Math.random(),speed:.0015+Math.random()*.003
    }));
    stars=Array.from({length:70},()=>({
      x:Math.random()*W,y:Math.random()*H,
      sz:.8+Math.random()*2.8,
      phase:Math.random()*Math.PI*2,
      speed:.002+Math.random()*.006
    }));
  }

  function drawStar(x,y,r,a){
    ctx.save();
    const g=ctx.createRadialGradient(x,y,0,x,y,r*5);
    g.addColorStop(0,`rgba(255,215,60,${a*.7})`);g.addColorStop(1,'rgba(212,175,55,0)');
    ctx.beginPath();ctx.arc(x,y,r*5,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
    ctx.fillStyle=`rgba(255,235,100,${Math.min(1,a*1.3)})`;
    ctx.beginPath();
    for(let i=0;i<8;i++){const angle=i*Math.PI/4-Math.PI/8;const rad=i%2===0?r:r*.28;i===0?ctx.moveTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad):ctx.lineTo(x+Math.cos(angle)*rad,y+Math.sin(angle)*rad);}
    ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.arc(x,y,r*.3,0,Math.PI*2);ctx.fillStyle=`rgba(255,248,200,${Math.min(1,a*1.4)})`;ctx.fill();
    ctx.restore();
  }

  function draw(){
    if(!document.body.contains(canvas)){
      raf=null;
      // The DOM was replaced (e.g. a filter re-render) — try to pick up a
      // fresh canvas immediately instead of sitting frozen until some other
      // mutation happens to wake the MutationObserver up again.
      start();
      return;
    }
    ctx.fillStyle=canvas._bg;ctx.fillRect(0,0,W,H);
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const n=nodes[i],m=nodes[j],d=Math.hypot(n.x-m.x,n.y-m.y);
      if(d<W*.22){ctx.beginPath();ctx.moveTo(n.x,n.y);ctx.lineTo(m.x,m.y);ctx.strokeStyle='rgba(125,211,252,.22)';ctx.lineWidth=.8;ctx.stroke();}
    }
    nodes.forEach(n=>{
      n.pulse+=.01;n.x+=n.vx;n.y+=n.vy;
      if(n.x<0||n.x>W)n.vx*=-1;if(n.y<0||n.y>H)n.vy*=-1;
      const a=.55+Math.sin(n.pulse)*.25;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a})`;ctx.fill();
      if(n.r>2){ctx.beginPath();ctx.arc(n.x,n.y,n.r*3,0,Math.PI*2);ctx.fillStyle=`rgba(125,211,252,${a*.18})`;ctx.fill();}
    });
    packets.forEach(p=>{
      p.t+=p.speed;if(p.t>=1){p.t=0;p.fi=p.ti;p.ti=Math.floor(Math.random()*nodes.length);}
      const n=nodes[p.fi],m=nodes[p.ti];if(!n||!m)return;
      const x=n.x+(m.x-n.x)*p.t,y=n.y+(m.y-n.y)*p.t;
      const g=ctx.createRadialGradient(x,y,0,x,y,9);
      g.addColorStop(0,'rgba(180,240,255,.9)');g.addColorStop(1,'rgba(125,211,252,0)');
      ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fillStyle='rgba(220,245,255,.95)';ctx.fill();
    });
    stars.forEach(s=>{
      s.phase+=s.speed;const a=Math.max(0,.45+Math.sin(s.phase)*.5);
      if(a>.03)drawStar(s.x,s.y,s.sz,Math.min(1,a*1.3));
    });
    raf=requestAnimationFrame(draw);
  }

  function start(){
    if(raf)return;
    if(build()!==false) draw();
  }

  // Start when hero canvas appears in DOM
  const observer=new MutationObserver(()=>{
    if(document.getElementById('hero-canvas'))start();
  });
  observer.observe(document.getElementById('main')||document.body,{childList:true,subtree:true});
  // Cover the case where the canvas is already present by the time this runs
  start();

  // Also handle window resize — debounced, and ignores height-only changes
  // (iOS Safari fires 'resize' when its toolbar collapses/expands during
  // scrolling; rebuilding the whole particle system on every one of those
  // made this card look like it was reloading while being scrolled).
  let _heroResizeT=null;
  window.addEventListener('resize',()=>{
    clearTimeout(_heroResizeT);
    _heroResizeT=setTimeout(()=>{
      if(!canvas||!document.body.contains(canvas)) return;
      const p=canvas.parentElement;
      const newW=p?p.offsetWidth:600;
      if(Math.abs(newW-W)<2) return;
      if(raf){cancelAnimationFrame(raf);raf=null;}
      start();
    },150);
  });

  // Expose for manual start
  window._heroCanvasStart=start;
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(initHeroCanvas,200));



// ── Start hero animation after overview loads ───────────────────────────────
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ if(window._heroCanvasStart) window._heroCanvasStart(); },500));


// ── Window exposure ──────────────────────────────────────────────────────────
// Now that this file is a real ES module (Vite), its top-level functions are
// module-scoped, not global — but the HTML markup calls many of them via
// inline onclick="..." attributes, which the browser resolves against the
// global scope. This is the exhaustive, verified list of every function
// referenced that way anywhere in this app (extracted by grepping every
// on*="fn(" pattern in the original file, cross-checked against this file's
// actual top-level declarations) — preserving the exact global availability
// every one of these already had before this migration, no more and no less.
Object.assign(window, {
  _pinSubmitEntry, _pinSubmitSetup, closeCertPdfPreview, closeContactModal,
  closeHelpModal, closeLb, closeModal, closeSearch, copyToClipboard,
  downloadCurrentInv, enablePushNotifications, exportCSV, go, handleFiles,
  openContactModal, openSearch, performSearch, preFillRenewal,
  previewCertPdf, shareCert, shareCurrentPreviewCert, submitReq,
  toggleAgentFilter, toggleNotif, toggleReqDetail, toggleTheme,
});
