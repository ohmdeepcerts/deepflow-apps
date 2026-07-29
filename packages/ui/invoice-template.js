// The invoice masthead — the one band of the PDF that stays a rendered
// image, because it's the one place that needs a real CSS gradient and
// the particle scatter matching the app's own login/lock screen (see
// network-canvas.js — same gradient, same cyan node colour, same gold
// twinkle colour). Everything else in the invoice is drawn as real PDF
// text and vector shapes by packages/ui/pdf-vector.js — no html2canvas,
// no embedded photograph of a page full of text. That split is what
// keeps the exported PDF a few tens of KB instead of several hundred:
// a full-page screenshot of the whole invoice was the reason it used to
// run 500KB+ per file versus under 50KB from competitors like Zoho.
//
// The masthead's node/star scatter is seeded from the invoice's own id —
// deterministic, not random — so the same invoice always regenerates the
// same background (download it twice, get pixel-identical results) while
// a different invoice gets a genuinely different pattern. That's
// intentional, not a bug.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Small deterministic PRNG (mulberry32) seeded from the invoice id/number
// so the network scatter is stable across regenerations of the same
// invoice instead of jittering every time it's saved.
export function seededRandom(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Same palette as the real login/lock-screen canvas (network-canvas.js):
// gradient handled by the caller's CSS; here just the node/line/star
// colours.
export function networkField(seed, w, h, nodeCount, starCount) {
  const rnd = seededRandom(seed);
  const nodes = Array.from({ length: nodeCount }, () => ({ x: rnd() * w, y: rnd() * h, r: rnd() < 0.12 ? 3 : 1.4 }));
  let lines = '';
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[i], m = nodes[j];
    const d = Math.hypot(n.x - m.x, n.y - m.y);
    if (d < w * 0.2) lines += `<line x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${m.x.toFixed(1)}" y2="${m.y.toFixed(1)}" stroke="rgba(125,211,252,.28)" stroke-width="1"/>`;
  }
  const dots = nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="rgba(125,211,252,.75)"/>`).join('');
  const stars = Array.from({ length: starCount }, () => {
    const x = rnd() * w, y = rnd() * h, r = 1.3 + rnd() * 2.3;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3).toFixed(1)}" fill="rgba(255,215,60,.2)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="rgba(255,241,168,.9)"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${lines}${dots}${stars}</svg>`;
}

const ICONS = {
  phone: '<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 3.9c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3z"/>',
};
const icon = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

/**
 * Builds the self-contained HTML for just the masthead band, ready to be
 * rendered off-screen and captured with html2canvas. Height is whatever
 * the content naturally needs — the caller reads canvas.height back
 * after rendering, it isn't fixed here.
 * @param {object} p
 * @param {object} p.inv - invoice row (camelCase, as returned by dGet/portal RPC)
 * @param {object} p.S - company settings object (coName, coAddr, logoData, ...)
 * @param {{label:string, bg:string, fg:string}} p.status
 */
export function buildMastheadHTML({ inv, S, status }) {
  const hasLogo = !!S.logoData;
  const seed = inv.id || inv.number || 'x';

  return `
  <div class="masthead">
    <style>
      .masthead{width:210mm;position:relative;background:linear-gradient(150deg,#0d1f3c 0%,#1e3a5f 55%,#0a1628 100%);padding:30px 46px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;box-sizing:border-box}
      .masthead *{box-sizing:border-box}
      .masthead .ic{width:14px;height:14px;flex-shrink:0}
      .mast-row{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start}
      .brand{display:flex;gap:14px;align-items:flex-start}
      .brand img{width:40px;height:40px;object-fit:contain;border-radius:8px;background:#fff;padding:3px}
      .brand .mark{width:40px;height:40px;flex-shrink:0}
      .wordmark{font-size:20px;font-weight:800;letter-spacing:-.01em;color:#fff}
      .co-line{margin-top:10px;display:flex;flex-direction:column;gap:5px}
      .co-line div{display:flex;align-items:center;gap:7px;font-size:11px;color:rgba(255,255,255,.7)}
      .co-line .ic{color:rgba(125,211,252,.9)}
      .mast-meta{text-align:right}
      .tag-pill{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:5px 13px;border-radius:99px;margin-bottom:11px;box-shadow:0 0 0 1px rgba(255,255,255,.08) inset}
      .tag-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
      .inv-no{font-size:22px;font-weight:800;letter-spacing:-.01em;color:#fff}
      .inv-sub{font-size:10px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.14em;margin-top:3px}
      .mast-dates{display:flex;gap:24px;margin-top:15px;justify-content:flex-end}
      .mast-dates .l{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.4)}
      .mast-dates .v{font-size:13px;font-weight:600;margin-top:2px;color:rgba(255,255,255,.92)}
    </style>
    ${networkField(seed, 700, 210, 26, 6)}
    <div class="mast-row">
      <div class="brand">
        ${hasLogo ? `<img src="${S.logoData}">` : `<svg class="mark" viewBox="0 0 40 40"><polygon points="20,2 35,11 35,29 20,38 5,29 5,11" fill="url(#g1)"/><path d="M22 9 12 22h7l-2 9 11-14h-7z" fill="#fff"/><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs></svg>`}
        <div>
          <div class="wordmark">${esc(S.coName || 'Your Company')}</div>
          <div class="co-line">
            ${S.coPhone ? `<div>${icon('phone')}${esc(S.coPhone)}</div>` : ''}
            ${S.coEmail ? `<div>${icon('mail')}${esc(S.coEmail)}</div>` : ''}
            ${S.coWeb ? `<div>${icon('globe')}${esc(S.coWeb)}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="mast-meta">
        <div class="tag-pill" style="background:${status.bg};color:${status.fg}">${status.label}</div>
        <div class="inv-no">${esc(inv.number)}</div>
        <div class="inv-sub">Tax Invoice</div>
        <div class="mast-dates">
          <div><div class="l">Issued</div><div class="v">${esc(inv.date || '—')}</div></div>
          <div><div class="l">Due</div><div class="v">${esc(inv.dueDate || '—')}</div></div>
        </div>
      </div>
    </div>
  </div>`;
}
