// Request Wizard — the "New Job" form clients use to request work, its
// past-request history list, and the file-attachment picker both feed
// off. Extracted from main.js verbatim (Phase 5 of the architecture
// migration, Client Portal module 2) — no behaviour changes.
//
// _d is assigned exactly once, in main.js's INIT (after the portal data
// loads), and never reassigned after — exported as a live `let` binding
// rather than a getter, since a live binding already reflects that one
// reassignment correctly for every later read.
//
// _renewalData is the mirror case: it's declared and read here, but
// reassigned from main.js's preFillRenewal() (CERTS section, which stays
// there since it's a cert-specific "renew this" action) — so instead of
// a plain export, preFillRenewal() now calls the exported
// setRenewalData() below.

import { escText as e } from '@ui';
import { sb, _d, toast, refreshIcons, attachDelegates } from './main.js';

let _renewalData=null;
export function setRenewalData(v){ _renewalData=v; }

export function vRequest(d){
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

export function toggleReqDetail(el){
  const d=el.querySelector('.req-detail');
  if(d) d.style.display=d.style.display==='none'?'block':'none';
}

function renderWizard(d){ vRequest(d); }

let _reqFiles=[];
export function handleFiles(input){
  _reqFiles=Array.from(input.files||[]);
  const list=document.getElementById('rfile-list');
  if(list){
    list.innerHTML=_reqFiles.map(f=>`<span style="font-size:11px;background:var(--accent-light);color:var(--accent);padding:3px 10px;border-radius:100px;font-weight:600">${e(f.name)}</span>`).join('');
  }
}

export async function submitReq(){
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
