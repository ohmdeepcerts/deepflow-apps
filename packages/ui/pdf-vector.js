// Draws the ENTIRE invoice — background included — as real PDF drawing,
// not a rendered screenshot: no html2canvas, no embedded photograph of a
// page full of text. Text and shapes use jsPDF's native vector API
// (jsPDF-AutoTable for the item table's own pagination); the warm wash
// behind the header is built from many concentric flat-colour circles
// (see _drawWarmWash) rather than a real PDF shading — jsPDF 2.5.1's
// context2d.createRadialGradient/createLinearGradient are both stubs that
// only remember the first colour stop, so a context2d gradient fill
// silently renders as one flat colour with no error. A full-page wash
// plus text/table content this way still measures a few KB, not the
// 80-150KB+ a rasterised masthead used to cost.
//
// "Sample 3" — picked 2026-08-12 after several rounds of full-page mockups
// (see git log: the earlier plain "Editorial" layout, then a colour study
// across amber/rose/sage washes, then five refinements of the winning
// amber wash). The brief that survived: a soft amber radial wash behind
// the whole page, a serif company name and invoice number, and serif
// italic for the section/table labels — everything else (item text,
// amounts, footer) stays the plain sans body face so the page doesn't
// tip into pastiche.
//
// jsPDF's built-in fonts are Helvetica/Times/Courier — no Georgia. Times
// is the serif stand-in; visually closer to a classic newspaper serif
// than Georgia's more humanist warmth, but it's what ships without
// embedding a custom font file, which nothing here has asked for yet.

import { esc } from './invoice-template.js';

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = [30, 27, 22];
const MUTED = [139, 122, 94];
const FAINT = [160, 144, 111];
const HAIRLINE = [238, 224, 204];

const money = (n) => '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Draws "before" in one weight then "bold" in bold, both baseline-aligned,
// returning the x position right after — jsPDF text() is single-weight
// per call, so mixed-weight inline text has to be built up like this.
function drawMixed(doc, x, y, parts) {
  let cx = x;
  for (const [text, weight, color] of parts) {
    doc.setFont('helvetica', weight || 'normal');
    if (color) doc.setTextColor(...color);
    doc.text(text, cx, y);
    cx += doc.getTextWidth(text);
  }
  return cx;
}

// Status pill colours — pale tint background, a matching darker ink for
// the border/text. Tuned to sit on the warm wash rather than plain white.
const STATUS_WARM = {
  Paid: { label: 'Paid', bg: [255, 255, 255, 0.55], fg: [138, 90, 36] },
  'Awaiting Payment': { label: 'Awaiting Payment', bg: [255, 255, 255, 0.6], fg: [163, 85, 15] },
  Cancelled: { label: 'Cancelled', bg: [255, 255, 255, 0.6], fg: [153, 40, 40] },
  Draft: { label: 'Draft', bg: [255, 255, 255, 0.6], fg: [107, 112, 118] },
};
function statusStyle(status) { return STATUS_WARM[status] || STATUS_WARM.Draft; }

// Radial colour stops for the warm wash, centred just above the top-left
// corner. Same palette/positions as the original context2d attempt.
const WASH_STOPS = [
  { t: 0, rgb: [251, 233, 208] },   // #fbe9d0
  { t: 0.45, rgb: [253, 246, 234] }, // #fdf6ea
  { t: 0.82, rgb: [255, 255, 255] }, // #ffffff
  { t: 1, rgb: [255, 255, 255] },
];
function _washColorAt(t) {
  for (let i = 1; i < WASH_STOPS.length; i++) {
    const a = WASH_STOPS[i - 1], b = WASH_STOPS[i];
    if (t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return [0, 1, 2].map((k) => Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * f));
    }
  }
  return WASH_STOPS[WASH_STOPS.length - 1].rgb;
}

// A true radial gradient, drawn as real vector shapes rather than a PDF
// shading dictionary: jsPDF 2.5.1's context2d.createRadialGradient is a
// stub (see file header) that always degrades to one flat colour, so this
// approximates the fade with ~50 concentric filled circles, largest/
// palest first, smallest/warmest last, painted centre at (31, 0). At this
// step count the bands are imperceptible while staying genuine vector
// drawing (small file size, no embedded raster).
function _drawWarmWash(doc) {
  const cx = 31, cy = 0, rMax = 300, STEPS = 50;
  doc.setDrawColor(255, 255, 255);
  for (let i = STEPS; i >= 0; i--) {
    const t = i / STEPS;
    const [r, g, b] = _washColorAt(t);
    doc.setFillColor(r, g, b);
    doc.circle(cx, cy, t * rMax, 'F');
  }
}

/**
 * Renders one invoice into `doc` starting at the current page. Adds pages
 * as needed if the item list overflows. Returns nothing — mutates doc.
 * @param {import('jspdf').jsPDF} doc
 * @param {unknown} _html2canvas - unused; kept so existing call sites
 *   (Office, Client Portal) don't need to change their call signature.
 * @param {{inv:object, S:object, totals:{sub:number,vat:number,grand:number}, vatRate:number}} p
 */
export async function renderInvoicePDF(doc, _html2canvas, { inv, S, totals, vatRate }) {
  const isAgency = inv.invoiceType === 'agency';
  const billToName = inv.billToName || inv.clientName || '—';
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  const isPaid = inv.status === 'Paid';
  const hasVat = (totals.vat || 0) > 0;
  const regBits = [S.invFooter, (S.coVatNum && S.vatEnabled !== false) ? 'VAT ' + S.coVatNum : null].filter(Boolean).join(' · ');

  _drawWarmWash(doc);

  // ---- 1. Header — status pill, serif company name, serif invoice number ----
  const status = statusStyle(inv.status);
  let y = MARGIN;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  const pillLabel = status.label.toUpperCase();
  const pillW = doc.getTextWidth(pillLabel) + 7.5, pillH = 5.2;
  // Pill background is a near-white tint over the wash, not true alpha —
  // jsPDF vector fills don't composite against a gradient the way CSS
  // rgba does, so this is a flat colour close to what rgba(255,255,255,.55)
  // would look like sitting on the wash at this position.
  doc.setFillColor(253, 250, 244);
  doc.setDrawColor(...status.fg); doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN, y, pillW, pillH, 1.3, 1.3, 'FD');
  doc.setTextColor(...status.fg);
  doc.text(pillLabel, MARGIN + pillW / 2, y + pillH / 2 + 1.15, { align: 'center' });

  const nameY = y + pillH + 8;
  doc.setFont('times', 'bold'); doc.setFontSize(19); doc.setTextColor(...INK);
  doc.text(esc(S.coName || 'Your Company'), MARGIN, nameY);

  const contactBits = [S.coPhone, S.coEmail].filter(Boolean).join('   ·   ');
  if (contactBits) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
    doc.text(contactBits, MARGIN, nameY + 5.2);
  }

  const rightX = PAGE_W - MARGIN;
  doc.setFont('times', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(`Invoice ${esc(inv.number)}`, rightX, y + pillH + 2.2, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
  doc.text(`Tax invoice · ${esc(inv.date || '—')}`, rightX, y + pillH + 7.7, { align: 'right' });

  const headerBottom = nameY + 9;
  doc.setDrawColor(...HAIRLINE); doc.setLineWidth(0.25);
  doc.line(MARGIN, headerBottom, PAGE_W - MARGIN, headerBottom);

  // ---- 2. Ordered By / Site of Works — serif italic labels ----
  y = headerBottom + 10;
  const colW = (CONTENT_W - 10) / 2;
  const colXs = [MARGIN, MARGIN + colW + 10];

  const drawCol = (x, label, name, lines) => {
    let cy = y;
    doc.setFont('times', 'italic'); doc.setFontSize(8.3); doc.setTextColor(...FAINT);
    doc.text(label, x, cy);
    cy += 5.6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(name, x, cy);
    cy += 4.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(107, 100, 85);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, colW - 4);
      for (const wl of wrapped) { doc.text(wl, x, cy); cy += 3.9; }
    }
    return cy;
  };

  const leftLines = isAgency
    ? ['Letting agency' + (inv.agentName ? ' · ' + inv.agentName : ''), inv.clientEmail].filter(Boolean)
    : [billToAddr, inv.clientEmail].filter(Boolean);

  const leftBottom = drawCol(colXs[0], 'Ordered by', billToName, leftLines);
  const rightBottom = drawCol(colXs[1], 'Site of works', propAddr || '—', []);
  y = Math.max(leftBottom, rightBottom) + 6;

  doc.setDrawColor(...HAIRLINE); doc.setLineWidth(0.25);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 10;

  // ---- 3. Item table (vector, via autoTable — real pagination) ----
  const rows = (inv.items || []).map(it => {
    const line = (it.qty || 1) * (it.unit || 0);
    return [it.desc || '', money(line)];
  });

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 40 },
    head: [['Description', 'Total']],
    body: rows,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, cellPadding: { top: 2.8, bottom: 2.8, left: 0, right: 0 } },
    headStyles: { font: 'times', fontStyle: 'italic', fontSize: 8.3, textColor: FAINT },
    columnStyles: { 1: { halign: 'right' } },
    didDrawCell(data) {
      const bottom = data.cell.y + data.cell.height;
      doc.setDrawColor(...(data.section === 'head' ? INK : HAIRLINE));
      doc.setLineWidth(data.section === 'head' ? 0.3 : 0.2);
      doc.line(data.cell.x, bottom, data.cell.x + data.cell.width, bottom);
    },
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        doc.setFont('times', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
        doc.text(String(inv.number), MARGIN, 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
        doc.text(' — continued', MARGIN + doc.getTextWidth(String(inv.number)), 12);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 10;

  // ---- 4. Total — plain sans, no colour band ----
  const totalReserve = hasVat ? 30 : 22, footerReserve = 24;
  if (y + totalReserve + footerReserve > PAGE_H) {
    doc.addPage();
    _drawWarmWash(doc);
    y = MARGIN;
  }

  doc.setDrawColor(...HAIRLINE); doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 7;

  if (hasVat) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    doc.text('Subtotal', MARGIN, y);
    doc.setTextColor(...INK);
    doc.text(money(totals.sub), rightX, y, { align: 'right' });
    y += 5.5;
    doc.setTextColor(...MUTED);
    doc.text(`VAT (${vatRate}%)`, MARGIN, y);
    doc.setTextColor(...INK);
    doc.text(money(totals.vat), rightX, y, { align: 'right' });
    y += 7.5;
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text((isPaid ? 'TOTAL PAID' : 'TOTAL DUE'), MARGIN, y + 3.5);
  doc.setFontSize(17); doc.setTextColor(...INK);
  doc.text(money(totals.grand), rightX, y + 4, { align: 'right' });
  y += 11;

  if (isPaid) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
    doc.text(`Paid via bank transfer · Ref ${inv.number}`, MARGIN, y);
    y += 8;
  } else {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
    drawMixed(doc, MARGIN, y, [
      ['Please use ', 'normal', MUTED], [String(inv.number), 'bold', INK], [' as your payment reference.', 'normal', MUTED],
    ]);
    y += 8;
  }

  // ---- 5. Footer — pinned to the bottom of the last page ----
  doc.setPage(doc.internal.getNumberOfPages());
  const fy = PAGE_H - MARGIN - 6;
  doc.setDrawColor(...HAIRLINE); doc.setLineWidth(0.2); doc.line(MARGIN, fy, PAGE_W - MARGIN, fy);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.3); doc.setTextColor(...FAINT);
  doc.text(regBits, MARGIN, fy + 5);
  doc.text(`Ref ${esc(inv.number)}`, rightX, fy + 5, { align: 'right' });
}
