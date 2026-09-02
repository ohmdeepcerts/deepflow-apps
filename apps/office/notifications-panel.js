// Notification panel — the bell-icon dropdown, its unread badge, live-poll
// push helper (_pushNotif), and browser-notification permission UI. Extracted
// from main.js verbatim (Phase 1 of the follow-up modularization pass — see
// the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.
//
// _notifPollInterval deliberately stays in main.js — it's shared with the
// live-poll system (startLivePoll/_pollTick), not something this panel
// itself reads or writes. _notifTimeAgo also stays in main.js: it's a
// general-purpose time formatter already imported by directory.js and
// engineer-reports.js, not specific to notifications.

import { toast, uid, _notifTimeAgo } from './main.js';

let _notifStore=[];
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

export {
  toggleNotifPanel, _clearNotifBadge, _showNotifBadge, renderNotifPanel,
  handleNotifClick, clearNotifs, _pushNotif, requestNotifPermission, _checkNotifPermissionUI,
};
