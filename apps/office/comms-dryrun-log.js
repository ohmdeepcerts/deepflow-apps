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
import { _sb, dAll } from './main.js';

const REASON_STYLE = {
  DRY_RUN:          {label:'Would send', color:'var(--green)'},
  QUIET_HOURS:      {label:'Quiet hours', color:'var(--yellow)'},
  RATE_LIMIT:       {label:'Rate limit',  color:'var(--yellow)'},
  CHANNEL_DISABLED: {label:'Channel off', color:'var(--txt3)'},
};
function reasonStyle(reason){ return REASON_STYLE[reason]||{label:reason,color:'var(--txt3)'}; }

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
