// Real HTML/CSS invoice template — rendered off-screen and rasterised via
// html2canvas into the generated PDF (see generateAndStoreInvoicePDF in
// apps/office/main.js and its Portal counterpart). This replaces the
// earlier jsPDF hand-drawn version: jsPDF's rect()/text()/circle() API
// can only ever *describe* a design in primitives, it can never render
// actual CSS — no real gradients beyond hand-rolled strip approximations,
// no backdrop-filter, no inline SVG icons at their real fidelity. This
// template is genuine HTML+CSS; whatever the browser can render, the PDF
// gets, because the PDF page IS a screenshot of this.
//
// Deliberately excluded: backdrop-filter (blur) — html2canvas's support
// for it is inconsistent across versions, and a card that quietly loses
// its blur and just shows a flat fill is a worse failure mode than never
// promising blur in the first place. The "glass" look here comes from a
// translucent fill + border + soft shadow, which html2canvas renders
// reliably. Also excluded: the animated network canvas — nothing can
// animate on a static PDF page — replaced with a fixed (not moving)
// scatter of the same nodes/lines/stars, deterministic per invoice id so
// it looks intentional rather than random noise on every regeneration.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Small deterministic PRNG (mulberry32) seeded from the invoice id/number
// so the "network" scatter is stable across regenerations of the same
// invoice instead of jittering every time it's saved.
function seededRandom(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function networkSvg(seed, tint, w, h) {
  const rnd = seededRandom(seed);
  const nodeCount = 16, starCount = 4;
  const nodes = Array.from({ length: nodeCount }, () => ({ x: rnd() * w, y: rnd() * h, r: rnd() < 0.15 ? 2.6 : 1.3 }));
  let lines = '';
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[i], m = nodes[j];
    const d = Math.hypot(n.x - m.x, n.y - m.y);
    if (d < w * 0.22) lines += `<line x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${m.x.toFixed(1)}" y2="${m.y.toFixed(1)}" stroke="rgba(${tint},.35)" stroke-width="1"/>`;
  }
  const dots = nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="rgba(${tint},.75)"/>`).join('');
  const stars = Array.from({ length: starCount }, () => {
    const x = rnd() * w, y = rnd() * h, r = 1.4 + rnd() * 2.2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3).toFixed(1)}" fill="rgba(255,215,60,.18)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="rgba(255,241,168,.9)"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:100%;height:100%">${lines}${dots}${stars}</svg>`;
}

const ICONS = {
  phone: '<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 3.9c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1L6.6 10.8z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.8 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.8-3.8-9S9.5 5.6 12 3z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.5-4 4-6 7.5-6s6 2 7.5 6"/>',
  pin: '<path d="M12 21s7-6.1 7-11.5a7 7 0 1 0-14 0C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

/**
 * Builds the full self-contained HTML for one invoice page, ready to be
 * rendered off-screen and captured with html2canvas.
 * @param {object} p
 * @param {object} p.inv - invoice row (camelCase, as returned by dGet/portal RPC)
 * @param {object} p.S - company settings object (coName, coAddr, logoData, bankName, invShowAgent, ...)
 * @param {{sub:number, vat:number, grand:number}} p.totals
 * @param {number} p.vatRate
 */
export function buildInvoiceHTML({ inv, S, totals, vatRate }) {
  const isAgency = inv.invoiceType === 'agency';
  const tag = isAgency ? '#0EA5E9' : '#7C3AED';
  const bandCss = isAgency
    ? 'linear-gradient(135deg,#0d1f3c 0%,#1e3a5f 55%,#0a1628 100%)'
    : 'linear-gradient(135deg,#4C1D95 0%,#7C3AED 55%,#3b1670 100%)';
  const tint = isAgency ? '125,211,252' : '196,165,250';
  const badgeBg = isAgency ? 'rgba(14,165,233,.13)' : 'rgba(124,58,237,.13)';
  const hasLogo = !!S.logoData;

  const billToName = inv.billToName || inv.clientName || '—';
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  const realName = inv.landlordName || inv.agencyName || inv.clientName || '';
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  const showAgent = S.invShowAgent !== false && isAgency && inv.agentName && inv.agentName.trim();

  const statusMap = {
    Paid: { label: 'Paid', bg: 'rgba(74,222,128,.16)', fg: '#86EFAC' },
    'Awaiting Payment': { label: 'Awaiting Payment', bg: 'rgba(253,224,71,.16)', fg: '#FDE68A' },
    Cancelled: { label: 'Cancelled', bg: 'rgba(252,165,165,.16)', fg: '#FCA5A5' },
    Draft: { label: 'Draft', bg: 'rgba(203,213,225,.16)', fg: '#CBD5E1' },
  };
  const status = statusMap[inv.status] || statusMap.Draft;
  const wm = inv.status === 'Paid' ? { text: 'PAID', color: '#16A34A' } : inv.status === 'Awaiting Payment' ? { text: 'UNPAID', color: '#DC2626' } : null;

  const items = (inv.items || []).map(it => {
    const line = (it.qty || 1) * (it.unit || 0);
    const v = it.vat ? line * vatRate / 100 : 0;
    return `<tr><td>${esc(it.desc || '')}</td><td class="r num">${money(line + v)}</td></tr>`;
  }).join('');

  const regBits = [S.invFooter, (S.coVatNum && S.vatEnabled !== false) ? 'VAT ' + S.coVatNum : null].filter(Boolean).join(' · ');

  return `
  <div class="inv-page" style="--tag:${tag}">
    <style>
      .inv-page{width:210mm;background:#fff;color:#12151B;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;position:relative;overflow:hidden}
      .inv-page *{box-sizing:border-box}
      .inv-page .num{font-variant-numeric:tabular-nums}
      .inv-page .ic{width:14px;height:14px;flex-shrink:0}
      .accent-bar{height:5px;background:linear-gradient(90deg,var(--tag) 0%,var(--tag) 78%,#F2C14E 100%)}
      .head-band{position:relative;background:${bandCss};padding:30px 46px 26px;overflow:hidden}
      .head-content{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start}
      .brand{display:flex;gap:14px;align-items:flex-start}
      .brand img{width:40px;height:40px;object-fit:contain;border-radius:8px;background:#fff;padding:3px}
      .brand .mark{width:40px;height:40px;flex-shrink:0}
      .wordmark{font-size:20px;font-weight:800;letter-spacing:-.01em;color:#fff}
      .co-line{margin-top:10px;display:flex;flex-direction:column;gap:5px}
      .co-line div{display:flex;align-items:center;gap:7px;font-size:11px;color:rgba(255,255,255,.7)}
      .co-line .ic{color:rgba(125,211,252,.9)}
      .mast-meta{text-align:right}
      .tag-pill{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:5px 13px;border-radius:99px;margin-bottom:11px;background:${status.bg};color:${status.fg};box-shadow:0 0 0 1px rgba(255,255,255,.08) inset}
      .tag-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
      .inv-no{font-size:22px;font-weight:800;letter-spacing:-.01em;color:#fff}
      .inv-sub{font-size:10px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.14em;margin-top:3px}
      .mast-dates{display:flex;gap:24px;margin-top:15px;justify-content:flex-end}
      .mast-dates .l{font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:rgba(255,255,255,.4)}
      .mast-dates .v{font-size:13px;font-weight:600;margin-top:2px;color:rgba(255,255,255,.92)}
      .pad{padding:34px 46px 42px;position:relative}
      .watermark{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%) rotate(-27deg);font-size:118px;font-weight:800;letter-spacing:.06em;white-space:nowrap;opacity:.12;z-index:5;pointer-events:none}
      .duo{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:0 0 28px}
      .duo::before{content:"";position:absolute;top:-14px;left:4%;width:180px;height:180px;background:var(--tag);opacity:.13;filter:blur(42px);border-radius:50%;z-index:0}
      .duo::after{content:"";position:absolute;bottom:-24px;right:4%;width:150px;height:150px;background:#0EA5E9;opacity:.09;filter:blur(42px);border-radius:50%;z-index:0}
      .duo>div{position:relative;z-index:1;background:rgba(247,249,252,.9);border:1px solid #E6E9EF;border-left:3px solid var(--tag);border-radius:12px;padding:19px 21px;box-shadow:0 16px 32px -20px rgba(20,20,30,.32)}
      .duo-title{display:flex;align-items:center;gap:9px;font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5B6472;margin:0 0 13px}
      .duo-badge{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:${badgeBg};flex-shrink:0}
      .duo-badge .ic{color:var(--tag);width:12.5px;height:12.5px}
      .duo-name{font-size:14.5px;font-weight:700;letter-spacing:-.005em}
      .duo-line{font-size:12.5px;color:#5B6472;line-height:1.7;margin-top:2px}
      .ref-line{font-size:11px;color:#9AA3B0;margin-top:8px;font-variant-numeric:tabular-nums}
      table.svc{width:100%;border-collapse:collapse;margin-top:4px}
      table.svc th{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7A8290;text-align:left;padding:0 0 11px;border-bottom:1.5px solid #12151B}
      table.svc th.r,table.svc td.r{text-align:right}
      table.svc td{font-size:13px;padding:12px 0;border-bottom:1px solid #EEF1F5}
      table.svc tbody tr:nth-child(even) td{background:#FBFCFD}
      .total-row{margin-top:20px;padding:17px 21px;border-radius:10px;display:flex;justify-content:space-between;align-items:baseline;background:${bandCss};color:#fff;box-shadow:0 14px 28px -16px rgba(20,20,30,.42),inset 0 1px 0 rgba(255,255,255,.14)}
      .total-row .l{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.72)}
      .total-row .v{font-size:26px;font-weight:800;letter-spacing:-.01em}
      .pay-line{font-size:11.5px;color:#5B6472;margin-top:13px;display:flex;align-items:center;gap:6px}
      .payref-box{margin-top:16px;padding:11px 15px;background:#FEF8EB;border:1px solid #E8B84B;border-radius:8px;font-size:11.5px;color:#6B4E0C}
      .foot{margin-top:24px;padding-top:15px;position:relative;display:flex;flex-direction:column;gap:9px}
      .foot::before{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--tag),transparent 55%)}
      .foot-agent{display:flex;align-items:center;gap:6px;font-size:11px;color:#5B6472;padding-bottom:9px;border-bottom:1px solid #EEF1F5}
      .foot-agent .ic{color:var(--tag)}
      .foot-agent b{color:#12151B}
      .foot-row{display:flex;justify-content:space-between;align-items:flex-end}
      .foot .reg{font-size:9.5px;letter-spacing:.06em;color:#9AA3B0}
      .foot .credit{text-align:right;line-height:1.5}
      .foot .credit .tagline{font-size:9px;letter-spacing:.05em;color:#9AA3B0}
      .foot .credit .brand-line{font-size:10.5px;font-weight:700;display:flex;align-items:center;gap:5px;justify-content:flex-end}
      .foot .credit .brand{background:linear-gradient(135deg,#0284C7,#0EA5E9 40%,#D97706 70%,#B45309);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .foot .credit .plain{color:#7A8290;font-weight:600}
    </style>

    <div class="accent-bar"></div>
    <div class="head-band">
      ${networkSvg(inv.id || inv.number || 'x', tint, 700, 160)}
      <div class="head-content">
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
          <div class="tag-pill">${status.label}</div>
          <div class="inv-no num">${esc(inv.number)}</div>
          <div class="inv-sub">Tax Invoice</div>
          <div class="mast-dates">
            <div><div class="l">Issued</div><div class="v">${esc(inv.date || '—')}</div></div>
            <div><div class="l">Due</div><div class="v">${esc(inv.dueDate || '—')}</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="pad">
      ${wm ? `<div class="watermark" style="color:${wm.color}">${wm.text}</div>` : ''}
      <div class="duo">
        <div>
          <div class="duo-title"><span class="duo-badge">${icon('person')}</span>Ordered By</div>
          <div class="duo-name">${esc(billToName)}</div>
          <div class="duo-line">${esc(billToAddr)}${inv.clientEmail ? '<br>' + esc(inv.clientEmail) : ''}</div>
          ${inv.billToOverride ? `<div class="ref-line">Only this invoice — real record: ${esc(realName)}</div>` : ''}
        </div>
        <div>
          <div class="duo-title"><span class="duo-badge">${icon('pin')}</span>Site of Works</div>
          <div class="duo-name">${esc(propAddr || '—')}</div>
          <div class="ref-line">Ref: ${esc(inv.jobNum || inv.jobRef || inv.number)}</div>
        </div>
      </div>

      <table class="svc">
        <thead><tr><th>Description</th><th class="r">Total</th></tr></thead>
        <tbody>${items}</tbody>
      </table>

      <div class="total-row"><span class="l">${inv.status === 'Paid' ? 'Total Paid' : 'Total Due'}</span><span class="v num">${money(totals.grand)}</span></div>

      ${inv.status === 'Paid'
        ? `<div class="pay-line">✓ Paid via Bank Transfer · Ref ${esc(inv.number)}</div>`
        : `<div class="payref-box">Please use <b>${esc(inv.number)}</b> as your payment reference.</div>`}

      <div class="foot">
        ${showAgent ? `<div class="foot-agent">${icon('person')}<span><b>${esc(inv.agentName)}</b>${inv.agentEmail ? ' · ' + esc(inv.agentEmail) : ''} — instructed via agent</span></div>` : ''}
        <div class="foot-row">
          <div class="reg">${esc(regBits)}</div>
          <div class="credit">
            <div class="tagline">Invoicing &amp; Job Management</div>
            <div class="brand-line"><svg width="11" height="11" viewBox="0 0 40 40"><polygon points="20,2 35,11 35,29 20,38 5,29 5,11" fill="url(#gf)"/><path d="M22 9 12 22h7l-2 9 11-14h-7z" fill="#fff"/><defs><linearGradient id="gf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs></svg><span class="plain">Powered by </span><span class="brand">DeepFlow</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
