// PAT (Portable Appliance Test) certificate template — ported near-verbatim
// from the standalone PAT-TEST app (ohmdeepcerts/PAT-TEST) so the printed
// certificate is unchanged: real HTML/CSS pages captured with html2canvas
// and assembled into a PDF with jsPDF, one page-image per .a4 page — NOT
// drawn as vector text like packages/ui/pdf-vector.js. That's a deliberate
// exception to this app's usual vector-PDF approach: matching PAT-TEST's
// exact pixels was the actual requirement, and a screenshot of literally
// the same CSS is the only way to guarantee that instead of re-matching it
// by eye in a different rendering system.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtUK = (iso) => { if (!iso) return ''; const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso; };

// Word-wraps a description into fixed-width lines the same way the source
// app does — its own row-height/pagination math below counts these lines,
// so the wrap width has to match or pages would paginate differently.
function wrapTxt(txt, max = 17) {
  if (!txt) return '';
  return txt.split('\n').flatMap(line => {
    const words = line.split(' '); const out = []; let cur = '';
    words.forEach(w => {
      if (w.length > max) { if (cur) { out.push(cur); cur = ''; } for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max)); return; }
      if ((cur + ' ' + w).trim().length > max) { if (cur) out.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) out.push(cur); return out.length ? out : [''];
  }).join('\n');
}

// Deterministic hash of a cert's key facts, embedded in the PDF's hidden
// "keywords" metadata (readable via any PDF reader's Properties panel) so
// a later dispute can check whether the visible appliance count/pass-fail
// split still matches what was issued. Ported verbatim from PAT-TEST's
// shortHash/certVerifyCode — same algorithm, so a cert migrated in from
// the old app keeps a code any old exported PDF would already carry.
function shortHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; }
  return h.toString(36).toUpperCase().slice(0, 6).padStart(6, '0');
}
export function certVerifyCode(cert) {
  const apps = cert.appliances || [];
  const key = [cert.certNum, (cert.address || '').trim(), cert.issueDate, apps.length,
    apps.filter(a => a.result === 'Fail').length].join('|');
  return shortHash(key);
}

const CSS = `
.pat-cert-root .a4{background:#fff;width:210mm;height:297mm;padding:12mm 16mm 14mm;box-sizing:border-box;display:flex;flex-direction:column;font-size:0.7rem;color:#0f172a;position:relative;overflow:hidden;font-family:'DM Sans',Arial,sans-serif}
.pat-cert-root .a4-topbar{background:#f1f5f9;padding:5px 12px;border-radius:4px;display:flex;justify-content:space-between;font-size:.8rem;font-weight:700;color:#1e293b;margin-bottom:10px}
.pat-cert-root .a4-hdr{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1e3a5f;padding-bottom:11px;margin-bottom:12px}
.pat-cert-root .a4-logo{width:180px;height:60px;display:flex;align-items:center;flex-shrink:0}
.pat-cert-root .a4-logo img{max-width:100%;max-height:100%;object-fit:contain}
.pat-cert-root .a4-coname{font-size:20px;font-weight:900;line-height:1.1}
.pat-cert-root .a4-cotype{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-top:3px}
.pat-cert-root .a4-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.pat-cert-root .a4-box{border:1px solid #e2e8f0;border-radius:4px;padding:9px 12px;background:#f8fafc;font-size:.85rem}
.pat-cert-root .a4-key{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#64748b;margin-bottom:2px}
.pat-cert-root .a4-val{color:#1e293b;font-size:.83rem;line-height:1.4}
.pat-cert-root .a4t{width:100%;border-collapse:collapse}
.pat-cert-root .a4t th{padding:7px 6px;text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.6px;font-weight:800}
.pat-cert-root .a4t td{padding:3px 6px;font-size:.8rem;border-bottom:1px solid #e2e8f0;color:#334155}
.pat-cert-root .cbadge{padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:700}
.pat-cert-root .cbadge.pass{background:#d1fae5;color:#065f46}
.pat-cert-root .cbadge.fail{background:#fee2e2;color:#991b1b}
.pat-cert-root .a4-foot{margin-top:auto;border-top:1px solid #e2e8f0;padding-top:8px;display:flex;justify-content:space-between;align-items:center;font-size:.7rem;color:#64748b}
.pat-cert-root .a4-fcontact{display:flex;gap:12px;flex-wrap:wrap}
`;

// Fixed styling constants the source app ships with (header colour, row
// caps per page, certificate title, legal boilerplate). These are template
// styling, not per-company data, so — unlike name/address/logo — they
// aren't part of Company Profiles; they're the same for every certificate
// this template renders, same as they were fixed in the source app.
const DEFAULTS = {
  colHeader: '#1e3a5f', colHText: '#ffffff', colRow: '#f8fafc',
  certTitle: 'PORTABLE APPLIANCE TEST REPORT', sigLabel: 'Authorised Signature',
  regText: 'Electricity at Work Regulations 1989', cop: 'IET Code of Practice (5th Edition)',
  rowsP1: 14, rowsPN: 24,
};

/**
 * Builds the printable page HTML for one PAT certificate — an array of
 * `.a4` page-div strings, paginated exactly like the source app (the first
 * page holds fewer appliance rows to leave room for the header block,
 * later pages hold more).
 * @param {object} cert - a certs table row: {address, certNum, issueDate, landlord, agent, appliances:[{assetId,description,testInstrument,date,retestPeriod,nextTest,result}]}
 * @param {{name?:string,address?:string,email?:string,phone?:string,vatNum?:string,regNum?:string,website?:string,logoUrl?:string}} profile - resolved issuing company identity (see resolveCompanyProfile in apps/office/main.js)
 * @param {string} [engineerName]
 * @returns {string[]}
 */
export function buildPatCertificatePages(cert, profile, engineerName) {
  const ref = cert.certNum || '';
  const testDate = fmtUK(cert.issueDate);
  const landlord = (cert.landlord || '').trim();
  const client = (cert.agent || '').trim();
  const addr = (cert.address || '').trim();
  const eng = engineerName || '—';
  const hc = DEFAULTS.colHeader, htc = DEFAULTS.colHText, rowBg = DEFAULTS.colRow;
  const logoHTML = profile.logoUrl
    ? `<img src="${profile.logoUrl}" alt="">`
    : `<div style="font-size:18px;font-weight:900;color:${hc};font-family:'DM Sans',sans-serif">${esc(profile.name || '')}</div>`;

  const apps = cert.appliances || [];
  const pages = []; let pageItems = [], pNum = 1, rowsUsed = 0;
  apps.forEach(app => {
    const desc = wrapTxt(app.description, 17); const lines = desc.split('\n').length; const cost = Math.max(1, lines);
    const cap = pNum === 1 ? DEFAULTS.rowsP1 : DEFAULTS.rowsPN;
    if (rowsUsed + cost > cap && pageItems.length) { pages.push({ items: pageItems, cap }); pageItems = []; pNum++; rowsUsed = 0; }
    pageItems.push({ ...app, _d: desc, _c: cost }); rowsUsed += cost;
  });
  pages.push({ items: pageItems, cap: pNum === 1 ? DEFAULTS.rowsP1 : DEFAULTS.rowsPN });

  return pages.map((pg, pi) => {
    let hdr = '';
    if (pi === 0) {
      let cb = '';
      if (landlord) cb += `<div><div class="a4-key">Landlord</div><div class="a4-val">${esc(landlord)}</div></div>`;
      if (client) cb += `<div style="margin-top:5px"><div class="a4-key">Client</div><div class="a4-val">${esc(client)}</div></div>`;
      if (addr) cb += `<div style="margin-top:5px"><div class="a4-key">Property Address</div><div class="a4-val" style="white-space:pre-line;font-weight:600">${esc(addr)}</div></div>`;
      if (!cb) cb = '<span style="color:#94a3b8">—</span>';
      hdr = `<div class="a4-topbar"><div><strong>Date:</strong> ${testDate}</div><div><strong>Ref:</strong> ${esc(ref)}</div></div>`
        + `<div class="a4-hdr"><div class="a4-logo">${logoHTML}</div>`
        + `<div><div class="a4-coname" style="color:${hc}">${esc(profile.name || 'Company')}</div>`
        + `<div class="a4-cotype" style="color:${hc}">${esc(DEFAULTS.certTitle)}</div></div></div>`
        + `<div class="a4-meta"><div class="a4-box">${cb}</div>`
        + `<div class="a4-box"><div class="a4-key">Testing Company</div>`
        + `<div class="a4-val" style="font-weight:700;margin-bottom:2px">${esc(profile.name || '')}</div>`
        + `<div style="font-size:.7rem;color:#64748b;white-space:pre-line;margin-bottom:5px">${esc(profile.address || '')}</div>`
        + `<div style="display:flex;gap:6px;margin-top:2px">`
        + `<div style="flex:1;border:1px solid #cbd5e1;border-radius:4px;background:rgba(255,255,255,.55);padding:4px 8px">`
        + `<div style="font-size:.56rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:2px">Engineer</div>`
        + `<div style="font-size:.74rem;font-weight:600;color:#1e293b">${esc(eng)}</div>`
        + `</div>`
        + `<div style="flex:1;border:1px solid #cbd5e1;border-radius:4px;background:rgba(255,255,255,.55);padding:4px 8px;min-height:36px;display:flex;flex-direction:column;justify-content:center">`
        + `<div style="font-size:.56rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin-bottom:2px">${esc(DEFAULTS.sigLabel)}</div>`
        + `<div>________________</div>`
        + `</div>`
        + `</div>`
        + `</div></div>`
        + `<div style="margin-top:4px;font-size:.62rem;color:#64748b;line-height:1.4">${esc(DEFAULTS.regText)} · ${esc(DEFAULTS.cop)}</div>`;
    }
    // Page 1 pads all the way to its cap so a lightly-populated cert still
    // reads as a proper full-size form. A continuation page exists purely
    // to hold whatever overflowed page 1, though — padding IT to a full
    // 24-row cap as well produces a page that's almost entirely empty
    // filler once there are only a few leftover rows (e.g. 6 real rows on
    // a 24-row page). Capping the filler at a handful of rows there keeps
    // a little visual headroom without wasting most of a sheet.
    const realRows = pg.items.reduce((s, a) => s + a._c, 0);
    const empty = pi === 0 ? (pg.cap - realRows) : Math.min(pg.cap - realRows, 3);
    let rows = pg.items.map((app, i) => `<tr style="background:${i % 2 === 0 ? rowBg : ''}"><td style="height:${app._c * 28}px;vertical-align:middle">${esc(app.assetId)}</td><td style="height:${app._c * 28}px;vertical-align:middle;white-space:pre-wrap;word-break:break-word">${esc(app._d)}</td><td>${esc(app.testInstrument)}</td><td>${fmtUK(app.date)}</td><td>${app.retestPeriod}</td><td>${fmtUK(app.nextTest)}</td><td><span class="cbadge ${app.result === 'Pass' ? 'pass' : 'fail'}">${app.result}</span></td></tr>`).join('');
    for (let i = 0; i < empty; i++) rows += `<tr style="background:${(pg.items.length + i) % 2 === 0 ? rowBg : ''}"><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
    return `<div class="a4">${hdr}`
      + `<div style="flex-grow:1"><table class="a4t"><thead><tr>`
      + `<th style="background:${hc};color:${htc}">Asset ID</th><th style="background:${hc};color:${htc}">Description</th>`
      + `<th style="background:${hc};color:${htc}">Instrument</th><th style="background:${hc};color:${htc}">Test Date</th>`
      + `<th style="background:${hc};color:${htc}">Period</th><th style="background:${hc};color:${htc}">Next Due</th>`
      + `<th style="background:${hc};color:${htc}">Result</th>`
      + `</tr></thead><tbody>${rows}</tbody></table></div>`
      + `<div class="a4-foot"><div></div>`
      + `<div class="a4-fcontact"><span>📞 ${esc(profile.phone || '')}</span><span>✉ ${esc(profile.email || '')}</span>`
      + (profile.website ? `<span>🌐 ${esc(profile.website)}</span>` : '')
      + (profile.vatNum ? `<span>VAT: ${esc(profile.vatNum)}</span>` : '')
      + (profile.regNum ? `<span>Reg: ${esc(profile.regNum)}</span>` : '')
      + `</div><div style="text-align:right">Page ${pi + 1} of ${pages.length}</div></div></div>`;
  });
}

/**
 * Renders a PAT certificate to a jsPDF document: builds the page HTML
 * off-screen, captures each page with html2canvas (scale 4, matching the
 * source app), and adds each as a full-page image — same off-screen
 * capture technique packages/ui/pdf-vector.js uses for the invoice
 * masthead, just for every page here instead of one band.
 * @param {typeof import('jspdf').jsPDF} jsPDF
 * @param {(el:HTMLElement, opts:object) => Promise<HTMLCanvasElement>} html2canvas
 * @param {{cert:object, profile:object, engineerName?:string}} p
 * @returns {Promise<import('jspdf').jsPDF>}
 */
export async function renderPatCertificatePDF(jsPDF, html2canvas, { cert, profile, engineerName }) {
  const pageHtmls = buildPatCertificatePages(cert, profile, engineerName);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setProperties({
    title: 'PAT Certificate ' + (cert.certNum || ''),
    subject: 'Ref: ' + (cert.certNum || ''),
    author: profile.name || '',
    keywords: 'verify:' + certVerifyCode(cert),
  });
  const holder = document.createElement('div');
  holder.className = 'pat-cert-root';
  holder.style.cssText = 'position:fixed;left:-99999px;top:0';
  holder.innerHTML = `<style>${CSS}</style>` + pageHtmls.join('');
  document.body.appendChild(holder);
  try {
    const pageEls = [...holder.querySelectorAll('.a4')];
    for (let i = 0; i < pageEls.length; i++) {
      // scale:4 (PAT-TEST's own setting) makes each page a huge raster
      // image — fine for a single certificate, but a real multi-appliance
      // multi-page one balloons past a megabyte for no visible gain over
      // 2.5x, which is still sharp at print resolution. Matches the same
      // tradeoff packages/ui/pdf-vector.js already made for the invoice
      // masthead (scale:2 there, for a much smaller decorative band).
      const canvas = await html2canvas(pageEls[i], { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false, allowTaint: false });
      const imgData = canvas.toDataURL('image/png');
      if (i > 0) doc.addPage('a4', 'portrait');
      doc.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
  } finally {
    holder.remove();
  }
  return doc;
}
