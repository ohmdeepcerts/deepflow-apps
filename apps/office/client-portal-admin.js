// Client portal admin — sharing/copying a client's portal link, resetting
// their portal PIN, the "visiting card" invite modal (with its animated
// canvas background, QR code, and downloadable PNG card), and the Settings
// → Portal Contacts ("Call Us" numbers) CRUD. Three clusters that were
// scattered through main.js but are really one domain. Extracted verbatim
// (Phase 1 of the follow-up modularization pass — see the plan file for
// scope) — no behaviour changes, except one real bug fixed in the same move
// (see _emailPortalShare below).
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.
//
// certs.js and audit.js both import _jobPortalLink / _portalBaseUrl from
// main.js today — those two files' import lines were repointed to this file
// as part of this move (main.js no longer defines them).
//
// shareClientPortal/copyClientPortal/showPortalLinkModal/_generateQR/
// _downloadQR are unreachable from any current UI (verified — nothing calls
// them, not even index.html) — superseded by the visiting-card invite modal
// below but left in place verbatim, not cleaned up, since that's outside
// this move's scope.

import { escHtml } from '@ui';
import { S, dAll, dPut, dDel, uid, toast, _sb, confirm2 } from './main.js';

// ════════════════════════════════════════════════════════════════
//  CLIENT PORTAL SHARING
// ════════════════════════════════════════════════════════════════
export function _portalBaseUrl() {
  // The three apps are deployed as siblings — .../office/, .../engineer/,
  // .../portal/ (see vite.config.js rollupOptions.input) — so the portal
  // lives one directory up from this app, not next to it as a flat file.
  const dir = window.location.pathname.replace(/[^/]*$/, ''); // .../office/
  return window.location.origin + dir.replace(/office\/$/, 'portal/');
}

export function _buildPortalUrl(id, type, name) {
  const base = `${_portalBaseUrl()}?id=${encodeURIComponent(id)}&type=${type}`;
  // Agent portals need name in URL — agents table has no anon RLS policy
  // so the portal can't look up the agent by ID. Name is the lookup key.
  return name ? base + `&name=${encodeURIComponent(name)}` : base;
}

// For the "certificate locked, pay to unlock" email — a job links to
// exactly the same landlord/agency identity an invoice for it would, so
// this reuses that pairing rather than needing its own lookup. Agent-only
// jobs (no clientPersonId/clientAgencyId) are skipped: agent portal links
// need a name-based lookup (see _buildPortalUrl's comment) that a bare
// job record doesn't cleanly carry, so _certLockedEmailHtml just falls
// back to its no-link wording for those rather than risk a wrong URL.
export function _jobPortalLink(job){
  if(!job) return null;
  if(job.clientAgencyId) return _buildPortalUrl(job.clientAgencyId,'agency');
  if(job.clientPersonId) return _buildPortalUrl(job.clientPersonId,'landlord');
  return null;
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

// Resets a client's portal PIN — see docs/history/sql-migration-notes/PHASE5_PORTAL_PIN_AUTH_SQL.md. This
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
  // Was `_S?.coName` — _S doesn't exist anywhere in the app, so this threw
  // and the "Email" button on the portal invite card did nothing. Fixed
  // while moving this code rather than filed separately, since the bug is
  // right here and the correct value (S) is already used two lines below.
  const subject = `Your ${S?.coName || 'DeepFlow'} Client Portal`;
  const body = `Dear ${name},\n\nPlease use the link below to access your secure client portal where you can view your jobs, certificates and invoices:\n\n${url}\n\nThis link is permanent — please bookmark it for easy access.\n\nKind regards,\n${S?.coName || 'Your Service Provider'}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ════════════════════════════════════════════════════════════════
//  SETTINGS TABS — Portal Contacts (Client Portal "Call Us" numbers)
// ════════════════════════════════════════════════════════════════
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

export {
  shareClientPortal, copyClientPortal, showPortalLinkModal, resetPortalPin,
  _copyPortalLink, _waPortalShare, _emailPortalShare,
  loadPortalContacts, renderPortalContactsList, addPortalContactRow, updatePortalContact, deletePortalContact,
  closePortalInviteModal, _startPortalInviteCanvas, showPortalInviteModal, downloadPortalInviteCard,
};
