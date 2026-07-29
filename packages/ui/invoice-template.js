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
// Design: a masthead band directly behind the company name uses the exact
// same background as the app's own login/lock screen (see
// packages/ui/network-canvas.js — same gradient, same cyan node colour,
// same gold twinkle colour), because that's the one place an invoice is
// required to look like it came from this app. Everything below it is a
// near-white, ink-light body — stacked "glass" cards (translucent fill +
// fine border + soft shadow, no blur) rather than a second dark fill,
// because a fully dark invoice would just drink a real printer's ink.
// True blur was tested directly against html2canvas 1.4.1 and confirmed a
// silent no-op (a blurred test card rasterised pixel-identical to an
// unblurred one), which is why "glass" here never reaches for
// backdrop-filter. Also excluded for the same html2canvas-safety reason:
// text-stroke, clip-path, color-mix.
//
// The masthead's node/star scatter is seeded from the invoice's own id —
// deterministic, not random — so the same invoice always regenerates the
// same background (download it twice, get pixel-identical results) while
// a different invoice gets a genuinely different pattern. That's
// intentional, not a bug.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Small deterministic PRNG (mulberry32) seeded from the invoice id/number
// so the network scatter is stable across regenerations of the same
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

// Same palette as the real login/lock-screen canvas (network-canvas.js):
// gradient handled by the caller's CSS; here just the node/line/star
// colours. `strength` scales every alpha down for the faint whole-body
// watermark version without duplicating the generator.
function networkField(seed, w, h, nodeCount, starCount, strength) {
  const rnd = seededRandom(seed);
  const s = strength ?? 1;
  const nodes = Array.from({ length: nodeCount }, () => ({ x: rnd() * w, y: rnd() * h, r: rnd() < 0.12 ? 3 : 1.4 }));
  let lines = '';
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const n = nodes[i], m = nodes[j];
    const d = Math.hypot(n.x - m.x, n.y - m.y);
    if (d < w * 0.2) lines += `<line x1="${n.x.toFixed(1)}" y1="${n.y.toFixed(1)}" x2="${m.x.toFixed(1)}" y2="${m.y.toFixed(1)}" stroke="rgba(125,211,252,${(0.28 * s).toFixed(3)})" stroke-width="1"/>`;
  }
  const dots = nodes.map(n => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r}" fill="rgba(125,211,252,${(0.75 * s).toFixed(3)})"/>`).join('');
  const stars = Array.from({ length: starCount }, () => {
    const x = rnd() * w, y = rnd() * h, r = 1.3 + rnd() * 2.3;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3).toFixed(1)}" fill="rgba(255,215,60,${(0.2 * s).toFixed(3)})"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.4).toFixed(1)}" fill="rgba(255,241,168,${Math.min(1, 0.9 * s).toFixed(3)})"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${lines}${dots}${stars}</svg>`;
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
  const seed = inv.id || inv.number || 'x';

  return `
  <div class="inv-page">
    <style>
      .inv-page{width:210mm;min-height:297mm;background:#F7F9FC;color:#191C22;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;position:relative;overflow:hidden;display:flex;flex-direction:column}
      .inv-page *{box-sizing:border-box}
      .inv-page .num{font-variant-numeric:tabular-nums}
      .inv-page .ic{width:14px;height:14px;flex-shrink:0}

      .masthead{position:relative;background:linear-gradient(150deg,#0d1f3c 0%,#1e3a5f 55%,#0a1628 100%);padding:30px 46px}
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

      .body{position:relative;flex:1;display:flex;flex-direction:column}
      .body-field{position:absolute;inset:0}
      .watermark{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%) rotate(-27deg);font-size:110px;font-weight:800;letter-spacing:.06em;white-space:nowrap;opacity:.15;z-index:3;pointer-events:none}
      .stack{position:relative;z-index:1;flex:1;display:flex;flex-direction:column;gap:16px;padding:28px 46px 42px}
      .sheet{background:rgba(255,255,255,.88);border:1px solid rgba(13,31,60,.10);border-radius:16px;box-shadow:0 16px 32px -20px rgba(13,31,60,.22),inset 0 1px 0 rgba(255,255,255,.75);padding:20px 24px}
      .stack>.sheet:last-child{margin-top:auto}

      .duo{display:grid;grid-template-columns:1fr 1fr;gap:0;border-left:3px solid #0EA5E9}
      .duo>div{padding:0 20px}
      .duo>div:first-child{padding-left:0}
      .duo>div+div{border-left:1px solid rgba(13,31,60,.09)}
      .duo-title{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#0EA5E9;margin:0 0 8px}
      .duo-title .ic{width:13px;height:13px}
      .duo-name{font-size:14.5px;font-weight:700;letter-spacing:-.005em}
      .duo-line{font-size:12.5px;color:#5B6472;line-height:1.7;margin-top:2px}
      .ref-line{font-size:11px;color:#9AA3B0;margin-top:8px;font-variant-numeric:tabular-nums}

      table.svc{width:100%;border-collapse:collapse}
      table.svc th{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#7A8290;text-align:left;padding:0 0 11px;border-bottom:1.5px solid #12151B}
      table.svc th.r,table.svc td.r{text-align:right}
      table.svc td{font-size:13px;padding:12px 0;border-bottom:1px solid #EEF1F5}
      table.svc tbody tr:nth-child(even) td{background:rgba(14,165,233,.028)}

      .total-sheet{border-left:3px solid #B8863B;background:linear-gradient(120deg,rgba(184,134,59,.08),rgba(255,255,255,.88))}
      .total-row{display:flex;justify-content:space-between;align-items:baseline}
      .total-row .l{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#6B7280;font-weight:600}
      .total-row .v{font-size:26px;font-weight:800;color:#B8863B;letter-spacing:-.01em}
      .pay-line{padding:14px 20px;font-size:12px;color:#3F7A4C;font-weight:600;display:flex;align-items:center;gap:6px}
      .payref-box{padding:14px 20px;background:#FEF8EB;border-color:#E8B84B;font-size:12px;color:#6B4E0C}

      .foot-agent{font-size:11px;color:#374151;font-weight:600;padding-bottom:11px;margin-bottom:11px;border-bottom:1px solid rgba(13,31,60,.08)}
      .foot-agent b{color:#191C22}
      .foot-row{display:flex;justify-content:space-between;align-items:flex-end}
      .foot .reg{font-size:9.5px;letter-spacing:.06em;color:#9AA3B0}
      .foot .credit{text-align:right;line-height:1.5}
      .foot .credit .tagline{font-size:9px;letter-spacing:.05em;color:#9AA3B0}
      .foot .credit .brand-line{font-size:10.5px;font-weight:700}
      .foot .credit .brand{background:linear-gradient(135deg,#0284C7,#0EA5E9 40%,#D97706 70%,#B45309);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
      .foot .credit .plain{color:#7A8290;font-weight:600}
    </style>

    <div class="masthead">
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
          <div class="inv-no num">${esc(inv.number)}</div>
          <div class="inv-sub">Tax Invoice</div>
          <div class="mast-dates">
            <div><div class="l">Issued</div><div class="v">${esc(inv.date || '—')}</div></div>
            <div><div class="l">Due</div><div class="v">${esc(inv.dueDate || '—')}</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="body">
      <div class="body-field">${networkField(seed + '-body', 700, 900, 30, 8, 0.16)}</div>
      ${wm ? `<div class="watermark" style="color:${wm.color}">${wm.text}</div>` : ''}
      <div class="stack">
        <div class="sheet duo">
          <div>
            <div class="duo-title">${icon('person')}Ordered By</div>
            <div class="duo-name">${esc(billToName)}</div>
            <div class="duo-line">${esc(billToAddr)}${inv.clientEmail ? '<br>' + esc(inv.clientEmail) : ''}</div>
            ${inv.billToOverride ? `<div class="ref-line">Only this invoice — real record: ${esc(realName)}</div>` : ''}
          </div>
          <div>
            <div class="duo-title">${icon('pin')}Site of Works</div>
            <div class="duo-name">${esc(propAddr || '—')}</div>
            <div class="ref-line">Ref: ${esc(inv.jobNum || inv.jobRef || inv.number)}</div>
          </div>
        </div>

        <div class="sheet">
          <table class="svc">
            <thead><tr><th>Description</th><th class="r">Total</th></tr></thead>
            <tbody>${items}</tbody>
          </table>
        </div>

        <div class="sheet total-sheet">
          <div class="total-row"><span class="l">${inv.status === 'Paid' ? 'Total Paid' : 'Total Due'}</span><span class="v num">${money(totals.grand)}</span></div>
        </div>

        ${inv.status === 'Paid'
          ? `<div class="sheet pay-line">✓ Paid via Bank Transfer · Ref ${esc(inv.number)}</div>`
          : `<div class="sheet payref-box">Please use <b>${esc(inv.number)}</b> as your payment reference.</div>`}

        <div class="sheet foot">
          ${showAgent ? `<div class="foot-agent">Agent — <b>${esc(inv.agentName)}</b></div>` : ''}
          <div class="foot-row">
            <div class="reg">${esc(regBits)}</div>
            <div class="credit">
              <div class="tagline">Invoicing &amp; Job Management</div>
              <div class="brand-line"><span class="plain">Powered by </span><span class="brand">DeepFlow</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
