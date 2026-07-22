// Hero banner animation — BG3 cyan network + gold star twinkle. Extracted
// from main.js verbatim (Phase 5 of the architecture migration, Client
// Portal module 1) — no behaviour changes. Pure canvas animation with no
// business-state coupling: not called from HTML onclick attributes, so
// unlike most of this app's top-level functions it never needed a slot
// in the window-exposure Object.assign() block.

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
