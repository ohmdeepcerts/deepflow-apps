// Audit trail + client-notification dispatch — logs staff actions to
// Supabase's audit_log table, renders/exports the Admin-only Audit Log
// viewer, and fires the optional webhook/push/next-tenant-ETA
// notifications configured in Settings → Notifications. Extracted from
// main.js verbatim (Phase 5 of the architecture migration, module 3 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// The original "AUDIT LOG" section in main.js also contained the entire
// job-modal CRUD flow (openJobModal/saveJob/deleteCurrentJob/clearJobForm
// etc.) directly below it with no boundary — that's core Jobs-domain code
// that must stay cohesive per the earlier dependency-mapping finding, and
// is NOT part of this extraction. Only the genuine audit/notification
// functions (down to and including initAuditLog) moved.
//
// This module and main.js import from each other, same as certs.js and
// directory.js: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { SB_URL, SB_KEY } from '@core';
import { escHtml } from '@ui';
import { S, toast, TODAY, _sb, _getJWT, _fix, _portalBaseUrl, getAppUser } from './main.js';

let _auditTab='all';

// ══════════════════════════════════════════════════════
//  AUDIT LOG
// ══════════════════════════════════════════════════════
export async function logAudit(type, details){
  // type: 'job_delete' | 'inv_amount'
  // details: {jobId, jobNum, address, invId, invNum, oldVal, newVal, note}
  if(!getAppUser()) return;
  try{
    await _sb('audit_log',{method:'POST',body:{
      type,
      staff_name: getAppUser().name,
      staff_email: getAppUser().email||'',
      staff_role: getAppUser().role,
      details: JSON.stringify(details),
      created_at: new Date().toISOString()
    },prefer:'return=minimal'});
  }catch(e){ console.warn('[Audit]', e); }
}

// ── Automated client notifications (Settings → Notifications) ──────────────
// DeepFlow doesn't send WhatsApp/SMS/email itself — no account or API key
// lives here. This just fires a small JSON event at a webhook URL you
// configure, which is where a free automation tool (n8n/Zapier/Make) picks
// it up and does the actual sending. Off by default; each event type has
// its own toggle. mode:'no-cors' is used deliberately — many webhook
// receivers don't set CORS headers for browser fetches, and this is a
// fire-and-forget notification, not a request whose response we need to
// read, so we accept not being able to see the HTTP status back.
export async function sendNotificationWebhook(eventType, payload){
  if(!S.notifWebhookEnabled || !S.notifWebhookUrl) return;
  if(eventType==='job_status_change' && S.notifOnStatusChange===false) return;
  if(eventType==='cert_ready' && S.notifOnCertReady===false) return;
  try{
    await fetch(S.notifWebhookUrl, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({event:eventType, source:'deepflow-office', company:S.coName||'', timestamp:new Date().toISOString(), ...payload})
    });
  }catch(e){ console.warn('[NotifWebhook]', e); }
}

// ── Real push notifications — see PHASE6_PUSH_NOTIFICATIONS_SQL.md and
//    PHASE6B_PUSH_EDGE_FUNCTION.md. Off by default; needs the Edge Function
//    deployed before this does anything (fails silently/logged if not —
//    same "off until set up" fallback used everywhere else in this app).
export function _pushFunctionUrl(){ return SB_URL+'/functions/v1/send-push'; }

export async function sendPushNotification(eventType, payload){
  if(!S.notifPushEnabled) return;
  if(eventType==='job_status_change' && S.notifOnStatusChange===false) return;
  if(eventType==='cert_ready' && S.notifOnCertReady===false) return;

  let title, message;
  if(eventType==='job_status_change'){
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
  } else if(eventType==='cert_ready'){
    title='Certificate ready';
    message=`${payload.certType||'Certificate'} ready for ${payload.address||'your property'}`;
  } else {
    title='DeepFlow'; message='You have an update';
  }

  try{
    const jwt=await _getJWT();
    await fetch(_pushFunctionUrl(),{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+jwt},
      body: JSON.stringify({title,message,url:_portalBaseUrl(),
        landlordName:payload.landlordName||'',agencyName:payload.agencyName||'',agentName:payload.agentName||''})
    });
  }catch(e){ console.warn('[Push]',e); }
}

// ── Next-tenant ETA — see Settings → Notifications → "Next-Tenant ETA".
// When a job completes, look for this engineer's next Pending job today
// and, if a real person is waiting there with a phone number on file
// (not a key-safe code), fire a webhook event so a connected automation
// can text/WhatsApp them a heads-up. Routed through the same webhook only
// — tenants don't have portal accounts, so push notifications don't apply.
export function _looksLikePhone(s){
  return !!s && /\d{4,}/.test(s) && !/^code:/i.test(s.trim());
}

export async function notifyNextTenantEta(completedJob){
  if(!S.notifNextTenantEta) return;
  if(!completedJob?.engineer || !completedJob?.date) return;
  try{
    const rows=await _sb(`jobs?engineer=eq.${encodeURIComponent(completedJob.engineer)}&date=eq.${encodeURIComponent(completedJob.date)}&status=eq.Pending&order=created.asc&limit=1`);
    const next=rows?.[0]?_fix(rows[0]):null;
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

export async function testNotifWebhook(){
  const el=document.getElementById('notif-webhook-test-result');
  const url=document.getElementById('s-notif-webhook-url')?.value.trim()||S.notifWebhookUrl;
  if(!url){ if(el) el.innerHTML='<span style="color:var(--yellow)">⚠️ Enter a webhook URL first</span>'; return; }
  if(el) el.textContent='Sending test event…';
  try{
    await fetch(url, {
      method:'POST',
      mode:'no-cors',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({event:'test', source:'deepflow-office', company:S.coName||'', timestamp:new Date().toISOString(), message:'Test event from DeepFlow — if your automation received this, it is wired up correctly.'})
    });
    if(el) el.innerHTML='<span style="color:var(--green)">✅ Sent — check your automation tool\'s history to confirm it arrived (the browser can\'t confirm delivery for cross-origin webhooks)</span>';
  }catch(e){
    if(el) el.innerHTML='<span style="color:var(--red)">❌ Failed to send: '+(e.message||'').slice(0,100)+'</span>';
  }
}

// Which Audit Log sub-view is active — 'all' | 'finance' | 'reversions'.
// Finance and Reversions are deliberately separate views (not just a filter
// dropdown option) so Admin has one dedicated place to check each without
// them being mixed into the general activity list and forgotten about.
export function switchAuditTab(tab){
  _auditTab=tab;
  ['all','finance','reversions'].forEach(t=>{
    document.getElementById('audit-tab-'+t)?.classList.toggle('active',t===tab);
  });
  const descEl=document.getElementById('audit-tab-desc');
  if(descEl){
    descEl.textContent = tab==='finance' ? 'Every action taken by Finance-role staff'
      : tab==='reversions' ? 'Jobs reverted from Completed / Invoiced / Cancelled back to another status'
      : 'Job deletions and invoice changes by staff';
  }
  renderAuditLog();
}

export async function renderAuditLog(){
  // Admin only
  if(getAppUser()?.role !== 'Admin'){ toast('❌ Admin only','error'); return; }
  const body=document.getElementById('audit-body');
  if(!body) return;
  body.innerHTML='<div style="text-align:center;padding:40px;color:var(--txt3);font-size:12px">Loading…</div>';

  try{
    let url='audit_log?order=created_at.desc&limit=500';
    const userFilter=document.getElementById('audit-filter-user')?.value;
    const typeFilter=document.getElementById('audit-filter-type')?.value;
    if(userFilter) url+=`&staff_name=eq.${encodeURIComponent(userFilter)}`;
    if(_auditTab==='reversions') url+=`&type=eq.job_status_revert`;
    else if(typeFilter) url+=`&type=eq.${typeFilter}`;
    if(_auditTab==='finance') url+=`&staff_role=eq.Finance`;
    const logs=await _sb(url)||[];

    // Populate user filter
    const sel=document.getElementById('audit-filter-user');
    if(sel&&sel.options.length<=1){
      const names=[...new Set(logs.map(l=>l.staff_name).filter(Boolean))];
      names.forEach(n=>{ const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o); });
    }

    if(!logs.length){
      const emptyMsg = _auditTab==='finance' ? 'No Finance staff activity found.'
        : _auditTab==='reversions' ? 'No status reversions found — nothing has been moved back from Completed/Invoiced/Cancelled.'
        : 'No audit entries found.';
      body.innerHTML=`<div style="text-align:center;padding:60px;color:var(--txt3)">${emptyMsg}</div>`;
      return;
    }

    const typeLabel={job_delete:'🗑 Job Deleted',inv_amount:'💰 Invoice Amount Changed',job_status_change:'🔄 Job Status Changed',job_status_revert:'↩ Status Reverted'};
    const typeColor={job_delete:'#b91c1c',inv_amount:'#d97706',job_status_change:'#1d6fad',job_status_revert:'#b45309'};

    body.innerHTML=`
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="display:grid;grid-template-columns:140px 120px 120px 1fr 200px;gap:0;border-bottom:1px solid var(--border);padding:8px 14px;font-size:10px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.5px">
        <span>Date/Time</span><span>Staff</span><span>Role</span><span>Action & Details</span><span>Change</span>
      </div>
      ${logs.map(l=>{
        let details={};
        try{details=JSON.parse(l.details||'{}');}catch(e){}
        const dt=l.created_at?new Date(l.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
        const col=typeColor[l.type]||'var(--txt3)';
        const lbl=typeLabel[l.type]||l.type;
        const change=l.type==='inv_amount'&&details.oldVal&&details.newVal
          ?`<span style="color:#b91c1c;text-decoration:line-through">£${details.oldVal}</span> → <span style="color:#15803d;font-weight:700">£${details.newVal}</span>`
          :(l.type==='job_status_change'||l.type==='job_status_revert')&&details.oldStatus&&details.newStatus
          ?`<span style="color:#b91c1c;text-decoration:line-through">${escHtml(details.oldStatus)}</span> → <span style="color:#15803d;font-weight:700">${escHtml(details.newStatus)}</span>`
          :'—';
        const desc=details.address||details.invNum||details.jobNum||details.note||'—';
        return`<div style="display:grid;grid-template-columns:140px 120px 120px 1fr 200px;gap:0;padding:9px 14px;border-bottom:1px solid var(--border);font-size:11px;align-items:center">
          <span style="color:var(--txt3)">${dt}</span>
          <span style="font-weight:600;color:var(--txt)">${l.staff_name||'—'}</span>
          <span style="font-size:10px;color:var(--txt3)">${l.staff_role||'—'}</span>
          <div><div style="font-size:10px;font-weight:700;color:${col};margin-bottom:2px">${lbl}</div><div style="color:var(--txt2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc}</div></div>
          <span>${change}</span>
        </div>`;
      }).join('')}
    </div>`;
  }catch(e){
    body.innerHTML=`<div style="text-align:center;padding:40px;color:var(--red);font-size:12px">❌ Failed to load audit log.<br>Make sure the audit_log table exists in Supabase (Settings → Guide & SQL).</div>`;
  }
}

export async function exportAuditLog(){
  const logs=await _sb('audit_log?order=created_at.desc&limit=5000')||[];
  const rows=[['Date','Staff','Role','Type','Details']];
  logs.forEach(l=>{
    let d={};try{d=JSON.parse(l.details||'{}');}catch(e){}
    rows.push([l.created_at,l.staff_name,l.staff_role,l.type,JSON.stringify(d)]);
  });
  const csv=rows.map(r=>r.map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=`audit-log-${TODAY()}.csv`;
  a.click();
  toast('📄 Audit log exported','success');
}

export async function initAuditLog(){ await renderAuditLog(); }
