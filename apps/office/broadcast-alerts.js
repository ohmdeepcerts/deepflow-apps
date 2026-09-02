// Broadcast alerts — the "send an alert to all/one engineer" composer and
// its supporting engineer_alerts table bootstrap. Extracted from main.js
// verbatim (Phase 1 of the follow-up modularization pass — see the plan
// file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.
//
// loadStorageDashboard/createAllTables deliberately stay in main.js — they
// sit physically next to this cluster but are a different concern (storage/
// backup admin). createAllTables does use _ALERTS_SQL though, so it's
// exported here and imported back into main.js rather than duplicated.

import { SB_URL, SB_KEY } from '@core';
import { S, uid, toast, _sb, getAppUser } from './main.js';

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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engineer_alerts' AND policyname='engineer_alerts_office_all') THEN
    CREATE POLICY "engineer_alerts_office_all" ON engineer_alerts FOR ALL TO authenticated USING (is_office()) WITH CHECK (is_office());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='engineer_alerts' AND policyname='engineer_alerts_token') THEN
    CREATE POLICY "engineer_alerts_token" ON engineer_alerts FOR ALL USING (is_valid_engineer_token()) WITH CHECK (is_valid_engineer_token());
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
      sent_by: getAppUser()?.name||'Office',
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

export { openBroadcast, _ALERTS_SQL, _ensureAlertsTable, sendBroadcast, showAlertSetupModal };
