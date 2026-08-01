// Hero banner animation — cyan network + gold star twinkle, shared with the
// Office App's login screen and this app's own "no link"/PIN screens (see
// packages/ui/network-canvas.js). This call site is the one with extra
// lifecycle needs: the #hero-canvas element it targets lives inside a
// section that gets replaced by unrelated re-renders (e.g. a filter
// change), so it re-resolves the element and rebuilds a fresh animation
// instance each time it (re)starts, and self-heals via checkAlive/
// onDetached if the element disappears mid-frame.

import { initNetworkCanvas } from '@ui';

function initHeroCanvas(){
  let canvas=null,current=null,W=0;

  function start(){
    if(current) return;
    canvas=document.getElementById('hero-canvas');
    if(!canvas) return;
    current=initNetworkCanvas(canvas,{
      // Cut down from 50/14/70 — a shorter banner (see index.html's .hero,
      // no more button row inside it) doesn't need this much going on in
      // the background; it was reading as visual noise, not sparkle.
      nodeCount:22, packetCount:6, starCount:18,
      sizeCanvas(){
        const p=canvas.parentElement;
        canvas.width=p?p.offsetWidth:600;
        canvas.height=p?p.offsetHeight:200;
        W=canvas.width;
      },
      checkAlive:()=>document.body.contains(canvas),
      onDetached(){
        // The DOM was replaced (e.g. a filter re-render) — try to pick up a
        // fresh canvas immediately instead of sitting frozen until some
        // other mutation happens to wake the MutationObserver up again.
        current=null;
        start();
      },
    });
    current.start();
  }
  function stop(){ if(current){ current.stop(); current=null; } }

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
      stop();start();
    },150);
  });

  // Expose for manual start
  window._heroCanvasStart=start;
}
document.addEventListener('DOMContentLoaded',()=>setTimeout(initHeroCanvas,200));

// ── Start hero animation after overview loads ───────────────────────────────
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ if(window._heroCanvasStart) window._heroCanvasStart(); },500));
