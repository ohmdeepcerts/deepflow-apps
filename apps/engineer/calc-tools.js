// Calculator Tools — three self-contained electrician's calculators shown
// as tabs on the Tools page: voltage drop, BS 7671:2018 max-Zs lookup, and
// a conduit-fill visualiser. Extracted from main.js verbatim (Phase 5 of
// the architecture migration, Employee App module 2) — no behaviour
// changes. Pure DOM + arithmetic, zero Supabase/job-state coupling.
//
// showTool() calls updateOmwPreview()/_prefillOmw() (still in main.js)
// through typeof-guards, not direct calls — `typeof x` never throws on an
// undeclared identifier, so this is safe without importing them.

// ═══════════════════════════════════════════════
// TOOL TAB SWITCHER
// ═══════════════════════════════════════════════
export function showTool(id, btn){
  ['voltage-drop','max-zs','conduit','on-my-way'].forEach(t=>{
    const el=document.getElementById('tool-'+t);
    if(el)el.style.display=t===id?'block':'none';
  });
  document.querySelectorAll('.tool-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  if(id==='max-zs'&&typeof calcZs==='function')calcZs();
  if(id==='on-my-way'){if(typeof updateOmwPreview==='function')updateOmwPreview();if(typeof _prefillOmw==='function')_prefillOmw();}
  if(navigator.vibrate)navigator.vibrate(30);
}

// ═══════════════════════════════════════════════
// VOLTAGE DROP CALCULATOR
// ═══════════════════════════════════════════════
export function calcVD(){
  const display=document.getElementById('vd-display');
  const res=document.getElementById('vd-result');
  const st=document.getElementById('vd-status');
  if(!display||!res||!st)return; // GUARD: DOM not ready
  const amps=parseFloat(document.getElementById('vd-amps')?.value)||0;
  const len=parseFloat(document.getElementById('vd-len')?.value)||0;
  const mv=parseFloat(document.getElementById('vd-type')?.value)||0;
  const limit=parseFloat(document.getElementById('vd-circuit')?.value)||11.5;
  if(!amps||!len||!mv){
    if(res)res.textContent='0.00 V';
    if(st){st.textContent='Enter values above';st.style.color='var(--txt3)';}
    return;
  }
  const drop=(mv*amps*len)/1000;
  const pct=((drop/230)*100).toFixed(1);
  if(res)res.textContent=drop.toFixed(2)+' V';
  if(display)display.className='calc-display '+(drop>limit?'fail':'pass');
  if(drop>limit){
    if(res)res.style.color='#e05252';
    if(st){st.textContent=`⚠️ FAILED — ${pct}% drop (limit ${((limit/230)*100).toFixed(0)}%)`;st.style.color='#e05252';}
  } else {
    if(res)res.style.color='#22c55e';
    if(st){st.textContent=`✅ PASSED — ${pct}% drop (limit ${((limit/230)*100).toFixed(0)}%)`;st.style.color='#22c55e';}
  }
  if(navigator.vibrate&&drop>limit)navigator.vibrate([50,30,50]);
}

// ═══════════════════════════════════════════════
// MAX ZS LOOKUP — BS 7671:2018 Table 41.2
// ═══════════════════════════════════════════════
const ZS_DATA={
  tn:{
    B6:{maxZs:7.67,Ia:36},B10:{maxZs:4.6,Ia:60},B16:{maxZs:2.87,Ia:96},B20:{maxZs:2.3,Ia:120},
    B25:{maxZs:1.84,Ia:150},B32:{maxZs:1.44,Ia:192},B40:{maxZs:1.15,Ia:240},B50:{maxZs:0.92,Ia:300},
    C6:{maxZs:3.84,Ia:72},C10:{maxZs:2.3,Ia:120},C16:{maxZs:1.44,Ia:192},C20:{maxZs:1.15,Ia:240},
    C25:{maxZs:0.92,Ia:300},C32:{maxZs:0.72,Ia:384},C40:{maxZs:0.57,Ia:480},C50:{maxZs:0.46,Ia:600},
    D6:{maxZs:1.92,Ia:144},D10:{maxZs:1.15,Ia:240},D16:{maxZs:0.72,Ia:384},D20:{maxZs:0.57,Ia:480},D32:{maxZs:0.36,Ia:768}
  },
  tt:{
    B6:{maxZs:38.33,Ia:36},B10:{maxZs:23,Ia:60},B16:{maxZs:14.38,Ia:96},B20:{maxZs:11.5,Ia:120},
    B25:{maxZs:9.2,Ia:150},B32:{maxZs:7.19,Ia:192},B40:{maxZs:5.75,Ia:240},B50:{maxZs:4.6,Ia:300},
    C6:{maxZs:19.17,Ia:72},C10:{maxZs:11.5,Ia:120},C16:{maxZs:7.19,Ia:192},C20:{maxZs:5.75,Ia:240},
    C25:{maxZs:4.6,Ia:300},C32:{maxZs:3.59,Ia:384},C40:{maxZs:2.88,Ia:480},C50:{maxZs:2.3,Ia:600},
    D6:{maxZs:9.58,Ia:144},D10:{maxZs:5.75,Ia:240},D16:{maxZs:3.59,Ia:384},D20:{maxZs:2.88,Ia:480},D32:{maxZs:1.79,Ia:768}
  }
};

export function calcZs(){
  const maxEl=document.getElementById('zs-max-val');
  const iaEl=document.getElementById('zs-ia-val');
  const ufEl=document.getElementById('zs-uf-val');
  const measuredEl=document.getElementById('zs-measured');
  const res=document.getElementById('zs-result');
  if(!maxEl||!iaEl||!ufEl||!res)return; // GUARD: DOM not ready
  const system=document.getElementById('zs-system')?.value||'tn';
  const breaker=document.getElementById('zs-breaker')?.value||'B32';
  const d=ZS_DATA[system]?.[breaker];
  if(!d)return;
  const uf=(230/d.Ia).toFixed(3);
  maxEl.textContent=d.maxZs+' Ω';
  iaEl.textContent=d.Ia+' A';
  ufEl.textContent=uf+' Ω';
  const measured=parseFloat(measuredEl?.value);
  if(isNaN(measured)||!measuredEl?.value){
    if(res){res.className='zs-result zs-none';res.textContent='Enter measured Zs to check';}
    return;
  }
  const passes=measured<=d.maxZs;
  res.className='zs-result '+(passes?'zs-pass':'zs-fail');
  res.textContent=passes
    ?`✅ PASSED — ${measured}Ω ≤ ${d.maxZs}Ω max`
    :`❌ FAILED — ${measured}Ω exceeds max ${d.maxZs}Ω by ${(measured-d.maxZs).toFixed(3)}Ω`;
  if(navigator.vibrate)navigator.vibrate(passes?[30]:[80,40,80]);
}

// ═══════════════════════════════════════════════
// CONDUIT FILL VISUALISER
// ═══════════════════════════════════════════════
const WIRE_DIAMETERS={1.5:2.9,2.5:3.6,4:4.5,6:5.6,10:7.0};
let _conduitWires=[];

export function updateConduit(){_conduitWires=[];renderConduit();}
export function clearConduit(){_conduitWires=[];renderConduit();if(navigator.vibrate)navigator.vibrate(30);}

export function addWire(){
  const conduitMm=parseFloat(document.getElementById('cf-size')?.value)||20;
  const wireMm=parseFloat(document.getElementById('cf-wire')?.value)||2.5;
  const wireDia=WIRE_DIAMETERS[wireMm]||3.6;
  const conduitArea=Math.PI*Math.pow(conduitMm/2,2);
  const wireArea=Math.PI*Math.pow(wireDia/2,2);
  const currentFill=_conduitWires.length*wireArea/conduitArea;
  if(currentFill+wireArea/conduitArea>0.55){
    if(navigator.vibrate)navigator.vibrate([80,30,80,30,80]);
    return;
  }
  _conduitWires.push({d:wireDia,mm:wireMm});
  renderConduit();
  if(navigator.vibrate)navigator.vibrate(20);
}

function renderConduit(){
  const svg=document.getElementById('conduit-wires');
  const pctTxt=document.getElementById('conduit-pct-txt');
  const cntTxt=document.getElementById('conduit-wire-count');
  const ruleTxt=document.getElementById('conduit-rule');
  if(!svg)return;
  const conduitMm=parseFloat(document.getElementById('cf-size')?.value)||20;
  const wireMm=parseFloat(document.getElementById('cf-wire')?.value)||2.5;
  const wireDia=WIRE_DIAMETERS[wireMm]||3.6;
  const conduitArea=Math.PI*Math.pow(conduitMm/2,2);
  const wireArea=Math.PI*Math.pow(wireDia/2,2);
  const fillPct=Math.round(_conduitWires.length*wireArea/conduitArea*100);
  const over=fillPct>45;
  // Scale wire dots to SVG (conduit radius = 56px in SVG)
  const svgR=56, scale=svgR/(conduitMm/2);
  const dotR=Math.max(3,(wireDia/2)*scale);
  // Pack dots in spiral pattern
  const dots=_conduitWires.map((_,i)=>{
    const cols=Math.floor(svgR*2/(dotR*2+2));
    const col=i%cols, row=Math.floor(i/cols);
    const x=-svgR+dotR+(dotR*2+2)*col+dotR;
    const y=-svgR+dotR+(dotR*2+2)*row+dotR;
    return{x:80+x,y:80+y};
  });
  svg.innerHTML=dots.map(d=>`<circle cx="${d.x}" cy="${d.y}" r="${dotR}" fill="${over?'#e05252':'#4f8fff'}" opacity=".85"/>`).join('');
  // Update circle stroke
  const outerCircle=document.querySelector('#conduit-svg circle');
  if(outerCircle)outerCircle.setAttribute('stroke',over?'#e05252':'#3a4255');
  if(pctTxt){pctTxt.textContent=fillPct+'%';pctTxt.setAttribute('fill',over?'#e05252':'#22c55e');}
  if(cntTxt)cntTxt.textContent=`${_conduitWires.length} wire${_conduitWires.length!==1?'s':''} (${wireMm}mm²)`;
  if(ruleTxt){ruleTxt.textContent=over?'⚠️ Over 45% — use bigger conduit!':fillPct>35?'Getting full (45% limit)':'Max 45% fill rule';ruleTxt.style.color=over?'#e05252':fillPct>35?'#f5a623':'var(--txt3)';}
}
