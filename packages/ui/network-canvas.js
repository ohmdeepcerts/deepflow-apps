// Shared "cyan network + gold star twinkle" canvas background — the animated
// theme behind every login/lock/PIN screen across the Office App and Client
// Portal (Engineer keeps its own distinct "electrical circuit" theme by
// design). Previously duplicated near-verbatim in three places (Office App
// login, Client Portal's hero banner, Client Portal's "no link" landing
// screen); consolidated here rather than adding a fourth copy for the PIN
// gate screens.
//
// Returns {start, stop} — deliberately does not manage its own visibility
// lifecycle (when to start/stop), since that differs per call site (an
// overlay toggling display, a full-page innerHTML replace, a dashboard
// section scrolling into view). Callers own that decision.
export function initNetworkCanvas(canvas, opts = {}) {
  const nodeCount = opts.nodeCount ?? 60;
  const packetCount = opts.packetCount ?? 18;
  const starCount = opts.starCount ?? 100;
  // Each call site sizes its canvas differently (viewport-relative with a
  // floor, a container's own box, a fixed panel) — rather than guess at one
  // formula, callers supply their own via sizeCanvas(); this just reads
  // canvas.width/height back afterward.
  const sizeCanvas = opts.sizeCanvas ?? (() => {
    canvas.width = canvas.parentElement?.offsetWidth || canvas.width || 600;
    canvas.height = canvas.parentElement?.offsetHeight || canvas.height || 400;
  });

  // Optional: called once per frame before drawing. Return false to signal
  // the canvas is gone (e.g. an unrelated re-render replaced the DOM around
  // it) — draw() stops itself and calls onDetached() instead of drawing
  // into a dead element. Only the Client Portal's hero banner needs this
  // (it lives inside a section that re-renders on filter changes); the
  // other call sites can ignore both options.
  const checkAlive = opts.checkAlive ?? (() => true);
  const onDetached = opts.onDetached ?? (() => {});

  const ctx = canvas.getContext('2d');
  let W, H, nodes, packets, stars, raf = null;

  function build() {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1f3c'); bg.addColorStop(.5, '#1e3a5f'); bg.addColorStop(1, '#0a1628');
    canvas._bg = bg;

    nodes = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .05, vy: (Math.random() - .5) * .05,
      r: Math.random() < .12 ? 3.5 : 1.6, pulse: Math.random() * Math.PI * 2,
    }));

    packets = Array.from({ length: packetCount }, () => ({
      fi: Math.floor(Math.random() * nodes.length), ti: Math.floor(Math.random() * nodes.length),
      t: Math.random(), speed: .0015 + Math.random() * .003,
    }));

    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      sz: 1.2 + Math.random() * 3.8, phase: Math.random() * Math.PI * 2, speed: .002 + Math.random() * .006,
    }));
  }

  function drawStar(x, y, r, a) {
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    g.addColorStop(0, `rgba(255,215,60,${a * .7})`);
    g.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = `rgba(255,235,100,${Math.min(1, a * 1.3)})`;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 - Math.PI / 8;
      const rad = i % 2 === 0 ? r : r * .28;
      i === 0 ? ctx.moveTo(x + Math.cos(angle) * rad, y + Math.sin(angle) * rad)
              : ctx.lineTo(x + Math.cos(angle) * rad, y + Math.sin(angle) * rad);
    }
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * .3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,248,200,${Math.min(1, a * 1.4)})`; ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!checkAlive()) { raf = null; onDetached(); return; }
    ctx.fillStyle = canvas._bg; ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const n = nodes[i], m = nodes[j], d = Math.hypot(n.x - m.x, n.y - m.y);
      if (d < W * .2) {
        ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y);
        ctx.strokeStyle = 'rgba(125,211,252,.25)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    nodes.forEach(n => {
      n.pulse += .011; n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
      const a = .6 + Math.sin(n.pulse) * .3;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(125,211,252,${a})`; ctx.fill();
      if (n.r > 2) {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125,211,252,${a * .2})`; ctx.fill();
      }
    });

    packets.forEach(p => {
      p.t += p.speed;
      if (p.t >= 1) { p.t = 0; p.fi = p.ti; p.ti = Math.floor(Math.random() * nodes.length); }
      const n = nodes[p.fi], m = nodes[p.ti];
      if (!n || !m) return;
      const x = n.x + (m.x - n.x) * p.t, y = n.y + (m.y - n.y) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
      g.addColorStop(0, 'rgba(180,240,255,.9)'); g.addColorStop(1, 'rgba(125,211,252,0)');
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(220,245,255,.95)'; ctx.fill();
    });

    stars.forEach(s => {
      s.phase += s.speed;
      const a = Math.max(0, .5 + Math.sin(s.phase) * .5);
      if (a > .02) drawStar(s.x, s.y, s.sz, Math.min(1, a * 1.4));
    });

    raf = requestAnimationFrame(draw);
  }

  function start() {
    if (raf) return;
    sizeCanvas();
    W = canvas.width; H = canvas.height;
    build(); draw();
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  return { start, stop };
}
