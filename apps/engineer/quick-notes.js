// Quick Notes Picker — a checklist overlay of common defect phrases,
// grouped by trade (electrical, gas, fire alarm, plumbing, general), that
// engineers tap to append to a job's notes instead of typing them out.
// Extracted from main.js verbatim (Phase 5 of the architecture migration,
// Employee App module 3) — no behaviour changes.
//
// _qnSelected/_qnActiveTab/_qnCurrent had no readers or writers anywhere
// else in main.js, so they moved wholly into this module rather than
// needing the getter/setter pattern used elsewhere for shared state.

import { toast } from './main.js';

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
let _qnSelected=new Set();
let _qnActiveTab=0;

export function openQN(){
  _qnSelected=new Set();
  _qnActiveTab=0;
  _renderQNTabs();
  _renderQNList(0);
  document.getElementById('qn-overlay').classList.add('open');
}

export function closeQN(){document.getElementById('qn-overlay').classList.remove('open');}

function _renderQNTabs(){
  const el=document.getElementById('qn-tabs');
  el.innerHTML=QN_CATEGORIES.map((c,i)=>
    `<button class="qn-tab ${i===0?'active':''}" onclick="_switchQNTab(${i},this)">${c.label}</button>`
  ).join('');
}

export function _switchQNTab(i,btn){
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

export function _toggleQN(catLabel,idx,el){
  const key=catLabel+':'+idx;
  if(_qnSelected.has(key)){_qnSelected.delete(key);}
  else{_qnSelected.add(key);}
  el.classList.toggle('selected',_qnSelected.has(key));
  el.querySelector('.qn-check').textContent=_qnSelected.has(key)?'✓':'';
}

export function applyQN(){
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
