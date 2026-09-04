// Communications dry-run log — read-only review of what Phase D's event
// engine has decided (docs/communications/08-IMPLEMENTATION-PLAN.md Phase D
// / Phase E: "Once Phase D's dry-run log looks right (owner review), flip
// to LIVE"). This is that review surface. Nothing here can trigger a real
// send — comm_events/comm_suppressions are populated entirely server-side
// by process_comm_events() (pg_cron, every 15 minutes); this module only
// reads them.
//
// comm_events/comm_suppressions use real snake_case columns (event_type,
// entity_table, created_at, etc.), not the app's usual camelCase — fetched
// via _sb() directly rather than dAll(), since dAll() hardcodes
// order=created.desc (a column these tables don't have; they use
// created_at) and there's no reason to fight that generic path for two
// read-only queries.

import { escHtml } from '@ui';
import { _sb, dAll, toast } from './main.js';

const REASON_STYLE = {
  DRY_RUN:          {label:'Would send', color:'var(--green)'},
  QUIET_HOURS:      {label:'Quiet hours', color:'var(--yellow)'},
  RATE_LIMIT:       {label:'Rate limit',  color:'var(--yellow)'},
  CHANNEL_DISABLED: {label:'Channel off', color:'var(--txt3)'},
};
function reasonStyle(reason){ return REASON_STYLE[reason]||{label:reason,color:'var(--txt3)'}; }

// ── Settings (quiet hours / frequency caps) ─────────────────────────────
// Makes what process_comm_events() previously had hardcoded owner-editable
// — see docs/communications/02-COMMUNICATIONS-ARCHITECTURE.md §8. Single
// global row (comm_settings, id='global'), read fresh by the SQL processor
// on every run, so a save here takes effect on the next 15-minute tick —
// no redeploy, no migration, no asking me to change a number in SQL.
export function toggleCommsSettings(){
  const box=document.getElementById('commslog-settings');
  if(!box) return;
  const show=box.style.display==='none';
  box.style.display=show?'block':'none';
  if(show) renderCommsSettings();
}

export async function renderCommsSettings(){
  const box=document.getElementById('commslog-settings');
  if(!box) return;
  box.innerHTML='<div style="font-size:12px;color:var(--txt3)">Loading…</div>';
  try{
    const rows=await _sb('comm_settings?id=eq.global&limit=1&select=*');
    const s=rows?.[0]||{quiet_hours_start:'09:00',quiet_hours_end:'17:30',quiet_hours_weekends:true,min_gap_hours:4,max_per_day:3,max_per_week:8};
    const t=v=>(v||'').toString().slice(0,5); // 'HH:MM:SS' -> 'HH:MM' for <input type=time>
    box.innerHTML=`
      <div style="font-size:11px;font-weight:700;color:var(--txt3);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Quiet Hours & Frequency Caps <span style="font-weight:400;text-transform:none;opacity:.7">— applies to every automated event, effective on the next processor run (~15 min)</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        <div><label class="fl" style="font-size:10px">Quiet hours start</label><input type="time" id="cs-start" class="fi" value="${t(s.quiet_hours_start)}"></div>
        <div><label class="fl" style="font-size:10px">Quiet hours end</label><input type="time" id="cs-end" class="fi" value="${t(s.quiet_hours_end)}"></div>
        <div><label class="fl" style="font-size:10px">Min. gap between messages (hours)</label><input type="number" id="cs-gap" class="fi" min="0" value="${s.min_gap_hours}"></div>
        <div><label class="fl" style="font-size:10px">Max per client per day</label><input type="number" id="cs-day" class="fi" min="1" value="${s.max_per_day}"></div>
        <div><label class="fl" style="font-size:10px">Max per client per week</label><input type="number" id="cs-week" class="fi" min="1" value="${s.max_per_week}"></div>
        <div style="display:flex;align-items:flex-end"><label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer"><input type="checkbox" id="cs-weekends" ${s.quiet_hours_weekends?'checked':''}> Suppress all weekend sends</label></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-acc btn-sm" onclick="saveCommsSettings()">Save Settings</button></div>`;
  }catch(e){
    console.warn('[DeepFlow] renderCommsSettings failed',e);
    box.innerHTML='<div style="font-size:12px;color:var(--red)">Failed to load settings</div>';
  }
}

export async function saveCommsSettings(){
  const val=id=>document.getElementById(id)?.value;
  const start=val('cs-start'), end=val('cs-end');
  const gap=parseInt(val('cs-gap'),10), day=parseInt(val('cs-day'),10), week=parseInt(val('cs-week'),10);
  if(!start||!end){ toast('Set both quiet-hours times','error'); return; }
  if([gap,day,week].some(n=>Number.isNaN(n)||n<0)){ toast('Frequency values must be 0 or more','error'); return; }
  try{
    await _sb('comm_settings?id=eq.global',{
      method:'PATCH',
      body:{
        quiet_hours_start:start, quiet_hours_end:end,
        quiet_hours_weekends:!!document.getElementById('cs-weekends')?.checked,
        min_gap_hours:gap, max_per_day:day, max_per_week:week,
        updated_at:new Date().toISOString(),
      },
      prefer:'return=minimal',
    });
    toast('Communications settings saved','success');
  }catch(e){
    console.warn('[DeepFlow] saveCommsSettings failed',e);
    toast('Failed to save settings','error');
  }
}

export async function renderCommsLog(){
  const summaryEl=document.getElementById('commslog-summary');
  const bodyEl=document.getElementById('commslog-body');
  if(!bodyEl) return;
  bodyEl.innerHTML='<div style="text-align:center;padding:60px;color:var(--txt3)">Loading…</div>';
  try{
    const [events, suppressions, persons, agencies] = await Promise.all([
      _sb('comm_events?order=created_at.desc&limit=200&select=*'),
      _sb('comm_suppressions?order=created_at.desc&limit=2000&select=*'),
      dAll('persons'), dAll('agencies'),
    ]);

    const suppByEvent=new Map();
    for(const s of suppressions||[]){
      if(!suppByEvent.has(s.comm_event_id)) suppByEvent.set(s.comm_event_id,[]);
      suppByEvent.get(s.comm_event_id).push(s);
    }
    const nameFor=(table,id)=>{
      if(!table||!id) return null;
      const list=table==='agencies'?agencies:table==='persons'?persons:null;
      return list?.find(x=>x.id===id)?.name||null;
    };

    // Summary strip — counted over every logged suppression row in this
    // batch (not just the 200 events shown below), so it reflects the
    // fuller recent history even though the event list itself is capped.
    const counts={};
    for(const s of suppressions||[]) counts[s.reason]=(counts[s.reason]||0)+1;
    const totalDecisions=(suppressions||[]).length;
    if(summaryEl){
      summaryEl.innerHTML=Object.entries(counts).map(([reason,n])=>{
        const st=reasonStyle(reason);
        return `<div style="background:${st.color}15;color:${st.color};padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700">${st.label}: ${n}</div>`;
      }).join('') + `<div style="color:var(--txt3);font-size:12px;padding:6px 0">${totalDecisions} channel decisions logged (most recent ${(events||[]).length} events shown below)</div>`;
    }

    if(!events?.length){
      bodyEl.innerHTML='<div style="text-align:center;padding:60px;color:var(--txt3)">No events yet — this fills in as real jobs/invoices/certificates happen. Nothing to review yet is expected, not a bug.</div>';
      return;
    }

    bodyEl.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="text-align:left;color:var(--txt3);border-bottom:1px solid var(--border)">
        <th style="padding:8px">Event</th><th style="padding:8px">Client</th><th style="padding:8px">Channels</th><th style="padding:8px">When</th>
      </tr></thead>
      <tbody>${events.map(ev=>{
        const client=nameFor(ev.entity_table,ev.entity_id)||(ev.entity_table?`${ev.entity_table} (unresolved)`:'—');
        const chans=(suppByEvent.get(ev.id)||[]).map(s=>{
          const st=reasonStyle(s.reason);
          return `<span style="background:${st.color}15;color:${st.color};padding:2px 8px;border-radius:6px;font-weight:700;margin-right:4px;display:inline-block;margin-bottom:2px">${escHtml(s.channel)}: ${st.label}</span>`;
        }).join('')||'<span style="color:var(--txt3)">pending</span>';
        const when=ev.created_at?new Date(ev.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:8px;font-weight:700">${escHtml(ev.event_type)}</td>
          <td style="padding:8px">${escHtml(client)}</td>
          <td style="padding:8px">${chans}</td>
          <td style="padding:8px;color:var(--txt3);white-space:nowrap">${when}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }catch(e){
    console.warn('[DeepFlow] renderCommsLog failed',e);
    bodyEl.innerHTML='<div style="text-align:center;padding:60px;color:var(--red)">Failed to load — try Refresh</div>';
  }
}
