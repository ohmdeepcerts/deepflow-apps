// Draws the ENTIRE invoice — masthead included — as real PDF text and
// vector shapes (jsPDF's native API, the same kind of drawing
// Zoho/QuickBooks/Xero use), with jsPDF-AutoTable handling the item
// table's own pagination. Nothing here is a rendered screenshot: no
// html2canvas, no embedded photograph of a page full of text. That's
// what keeps the exported PDF a few KB instead of the 50-100KB+ a
// rasterised masthead band used to cost on its own.
//
// The masthead's dot/line scatter is seeded from the invoice's own id —
// deterministic, not random — so the same invoice always regenerates the
// same pattern (download it twice, get pixel-identical results) while a
// different invoice gets a genuinely different one. Drawn as a handful of
// tiny vector circles/lines in a very light grey, so it reads as a paper
// watermark rather than a loud background graphic — and costs bytes, not
// kilobytes.
//
// Deliberately not attempted here: soft box-shadows (no native
// equivalent — flat fills + thin borders instead) and true alpha-blended
// tints (jsPDF vector fills don't composite the same way CSS rgba does —
// colours here are pre-blended against the paper-white ground each shape
// actually sits on).

import { esc, seededRandom } from './invoice-template.js';

const MARGIN = 18;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;
const MAST_H = 34;

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

// Status pill colours tuned for the paper-white masthead (the old set was
// bright/light-on-dark, meant to pop against navy — wrong direction now
// the ground is white, so these are muted-on-pale instead).
const STATUS_LIGHT = {
  Paid: { label: 'Paid', bg: [238, 242, 238], fg: [58, 90, 79] },
  'Awaiting Payment': { label: 'Awaiting Payment', bg: [250, 241, 232], fg: [138, 60, 20] },
  Cancelled: { label: 'Cancelled', bg: [250, 235, 235], fg: [153, 40, 40] },
  Draft: { label: 'Draft', bg: [240, 240, 238], fg: [107, 114, 113] },
};
function statusStyle(status) { return STATUS_LIGHT[status] || STATUS_LIGHT.Draft; }

// Downscales an uploaded logo (which can easily be a multi-hundred-KB
// phone photo of a sign or a large PNG export) to the small size it's
// actually shown at before embedding — same reasoning as the masthead
// itself: a full-resolution source image would alone blow the whole
// invoice's byte budget for a mark that prints at ~9mm.
function _prepLogoForPdf(dataUri, maxPx = 120) {
  return new Promise((resolve) => {
    if (!dataUri) { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/png'), w, h });
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

// A whisper of texture, not a background graphic — a dozen-odd faint dots
// with thin connecting lines where two happen to land close together,
// seeded from the invoice id so it's stable per-invoice but different
// invoice to invoice. Pure vector: a few dozen tiny circle/line ops, not
// an image.
function _drawMastWatermark(doc, seed, x0, y0, w, h) {
  const rnd = seededRandom(seed);
  const nodes = Array.from({ length: 16 }, () => ({ x: x0 + rnd() * w, y: y0 + rnd() * h }));
  doc.setDrawColor(225, 227, 220);
  doc.setLineWidth(0.15);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n = nodes[i], m = nodes[j];
      if (Math.hypot(n.x - m.x, n.y - m.y) < w * 0.14) doc.line(n.x, n.y, m.x, m.y);
    }
  }
  doc.setFillColor(210, 213, 204);
  nodes.forEach(n => doc.circle(n.x, n.y, 0.35, 'F'));
}

/**
 * Renders one invoice into `doc` starting at the current page. Adds pages
 * as needed if the item list overflows. Returns nothing — mutates doc.
 * @param {import('jspdf').jsPDF} doc
 * @param {unknown} _html2canvas - unused; kept so existing call sites
 *   (Office, Client Portal) don't need to change their call signature.
 * @param {{inv:object, S:object, totals:{grand:number}, vatRate:number}} p
 */
export async function renderInvoicePDF(doc, _html2canvas, { inv, S, totals, vatRate }) {
  const isAgency = inv.invoiceType === 'agency';
  const billToName = inv.billToName || inv.clientName || '—';
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  const realName = inv.landlordName || inv.agencyName || inv.clientName || '';
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  const showAgent = S.invShowAgent !== false && isAgency && inv.agentName && inv.agentName.trim();
  const isPaid = inv.status === 'Paid';
  const regBits = [S.invFooter, (S.coVatNum && S.vatEnabled !== false) ? 'VAT ' + S.coVatNum : null].filter(Boolean).join(' · ');

  // ---- 1. Masthead (all vector — see file header) ----
  const status = statusStyle(inv.status);
  const seed = inv.id || inv.number || 'x';
  _drawMastWatermark(doc, seed, 0, 0, PAGE_W, MAST_H);

  const logo = S.logoData ? await _prepLogoForPdf(S.logoData) : null;
  const markX = MARGIN, markY = 10, markBoxH = 9;
  let markW = markBoxH; // column width the wordmark must clear — widened below for a wide logo
  if (logo) {
    // Fit within a 9mm-tall, 14mm-wide box, preserving aspect ratio —
    // height-constrained for a roughly square/wide mark, width-constrained
    // if it's unusually wide (a horizontal wordmark-style logo upload).
    let dispH = markBoxH, dispW = dispH * (logo.w / logo.h);
    if (dispW > 14) { dispW = 14; dispH = dispW * (logo.h / logo.w); }
    doc.addImage(logo.dataUrl, 'PNG', markX, markY, dispW, dispH);
    markW = dispW;
  } else {
    const initials = (S.coName || 'Co').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'CO';
    doc.setFillColor(20, 24, 28);
    doc.roundedRect(markX, markY, markBoxH, markBoxH, 2, 2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(251, 251, 249);
    doc.text(initials, markX + markBoxH / 2, markY + markBoxH / 2 + 1.5, { align: 'center' });
  }

  const wordX = markX + markW + 5;
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 24, 28);
  doc.text(esc(S.coName || 'Your Company'), wordX, markY + 5.5);
  const contactBits = [S.coPhone, S.coEmail, S.coWeb].filter(Boolean).join('   ·   ');
  if (contactBits) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(138, 139, 131);
    doc.text(contactBits, wordX, markY + 10.5);
  }

  const rightX = PAGE_W - MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  const pillLabel = status.label;
  const pillTextW = doc.getTextWidth(pillLabel);
  const pillW = pillTextW + 9, pillH = 5.5, pillY = 7;
  doc.setFillColor(...status.bg);
  doc.roundedRect(rightX - pillW, pillY, pillW, pillH, pillH / 2, pillH / 2, 'F');
  doc.setTextColor(...status.fg);
  doc.text(pillLabel, rightX - pillW / 2, pillY + pillH / 2 + 1.4, { align: 'center' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20, 24, 28);
  doc.text(esc(inv.number), rightX, pillY + pillH + 6.5, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(166, 167, 156);
  doc.text('TAX INVOICE', rightX, pillY + pillH + 11, { align: 'right' });

  doc.setFontSize(7.6); doc.setTextColor(107, 114, 128);
  doc.text(`Issued ${esc(inv.date || '—')}   ·   Due ${esc(inv.dueDate || '—')}`, rightX, pillY + pillH + 17, { align: 'right' });

  doc.setDrawColor(228, 226, 218); doc.setLineWidth(0.3);
  doc.line(MARGIN, MAST_H, PAGE_W - MARGIN, MAST_H);

  // ---- 2. Ordered By / Site of Works (vector) ----
  let y = MAST_H + 10;
  const colW = (CONTENT_W - 8) / 2;
  const colXs = [MARGIN, MARGIN + colW + 8];
  const colTop = y;

  doc.setDrawColor(14, 165, 233);
  doc.setLineWidth(1);
  doc.line(colXs[0], colTop - 1, colXs[0], colTop + 24); // left accent rail, height finalised below if needed

  const drawCol = (x, label, name, lines, refLine) => {
    let cy = colTop + 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(14, 165, 233);
    doc.text(label.toUpperCase(), x + 4, cy);
    cy += 5.5;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(25, 28, 34);
    doc.text(name, x + 4, cy);
    cy += 4.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(107, 114, 128);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, colW - 8);
      for (const wl of wrapped) { doc.text(wl, x + 4, cy); cy += 3.7; }
    }
    if (refLine) { cy += 1.5; doc.setFontSize(7.5); doc.setTextColor(156, 163, 175); doc.text(refLine, x + 4, cy); cy += 3.5; }
    return cy;
  };

  const leftLines = [billToAddr, inv.clientEmail].filter(Boolean);
  const leftBottom = drawCol(colXs[0], 'Ordered By', billToName, leftLines, inv.billToOverride ? `Only this invoice — real record: ${realName}` : null);
  const rightBottom = drawCol(colXs[1], 'Site of Works', propAddr || '—', [], `Ref: ${inv.jobNum || inv.jobRef || inv.number}`);
  const colBottom = Math.max(leftBottom, rightBottom);
  doc.setDrawColor(14, 165, 233); doc.setLineWidth(1); doc.line(colXs[0], colTop - 1, colXs[0], colBottom);
  doc.setDrawColor(216, 220, 227); doc.setLineWidth(0.3); doc.line(colXs[1] - 4, colTop, colXs[1] - 4, colBottom);
  y = colBottom + 6;

  // ---- 3. Item table (vector, via autoTable — real pagination) ----
  const rows = (inv.items || []).map(it => {
    const line = (it.qty || 1) * (it.unit || 0);
    const v = it.vat ? line * vatRate / 100 : 0;
    return [it.desc || '', money(line + v)];
  });

  doc.autoTable({
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 34 },
    head: [['Description', 'Total']],
    body: rows,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.5, textColor: [25, 28, 34], cellPadding: { top: 2.6, bottom: 2.6, left: 0, right: 0 } },
    headStyles: { fontStyle: 'bold', fontSize: 7.5, textColor: [122, 130, 144] },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell(data) {
      if (data.section === 'head') data.cell.text = data.cell.text.map(t => String(t).toUpperCase());
    },
    didDrawCell(data) {
      const bottom = data.cell.y + data.cell.height;
      doc.setDrawColor(data.section === 'head' ? 25 : 238, data.section === 'head' ? 28 : 241, data.section === 'head' ? 34 : 245);
      doc.setLineWidth(data.section === 'head' ? 0.4 : 0.2);
      doc.line(data.cell.x, bottom, data.cell.x + data.cell.width, bottom);
    },
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(20, 24, 28);
        doc.text(String(inv.number), MARGIN, 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(107, 114, 128);
        doc.text(' — continued', MARGIN + doc.getTextWidth(String(inv.number)), 12);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ---- 4. Total band + payment reference (vector) — with a footer ----
  //     reserve so this never lands so close to the bottom that the
  //     footer below has to overlap it.
  const totalBandH = 12, payrefH = 10, footerReserve = 30;
  if (y + totalBandH + payrefH + footerReserve > PAGE_H) {
    doc.addPage();
    y = MARGIN;
  }

  doc.setFillColor(20, 24, 28);
  doc.roundedRect(MARGIN, y, CONTENT_W, totalBandH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
  doc.text((isPaid ? 'TOTAL PAID' : 'TOTAL DUE'), MARGIN + 6, y + totalBandH / 2 + 1.2, { renderingMode: 'fill' });
  doc.setFontSize(15); doc.setTextColor(232, 201, 146);
  doc.text(money(totals.grand), MARGIN + CONTENT_W - 6, y + totalBandH / 2 + 1.6, { align: 'right' });
  y += totalBandH + 5;

  if (isPaid) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(63, 122, 71);
    // No checkmark glyph here — jsPDF's standard "helvetica" font has no
    // Unicode support beyond WinAnsi, and a character like ✓ outside that
    // range corrupts the position array for the *entire* string that
    // follows it in the same doc.text() call (every real character ends
    // up with a stray extra character between it — a real, previously
    // shipped bug, not a hypothetical one). The green colour + placement
    // right under "TOTAL PAID" already says "paid" without it.
    doc.text(`Paid via Bank Transfer · Ref ${inv.number}`, MARGIN, y + 4);
    y += 9;
  } else {
    doc.setFillColor(254, 248, 235); doc.setDrawColor(232, 184, 75); doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONTENT_W, payrefH, 1.5, 1.5, 'FD');
    doc.setFontSize(8.5); doc.setTextColor(107, 78, 12);
    drawMixed(doc, MARGIN + 5, y + payrefH / 2 + 1.4, [
      ['Please use ', 'normal'], [String(inv.number), 'bold'], [' as your payment reference.', 'normal'],
    ]);
    y += payrefH + 5;
  }

  // ---- 5. Footer — pinned to the bottom of the last page ----
  doc.setPage(doc.internal.getNumberOfPages());
  let fy = PAGE_H - MARGIN - (showAgent ? 12 : 6);
  doc.setDrawColor(216, 220, 227); doc.setLineWidth(0.2); doc.line(MARGIN, fy, PAGE_W - MARGIN, fy);
  fy += 4;
  if (showAgent) {
    drawMixed(doc, MARGIN, fy, [['Agent — ', 'normal', [55, 65, 81]], [inv.agentName, 'bold', [25, 28, 34]]]);
    fy += 6;
    doc.setDrawColor(238, 241, 245); doc.setLineWidth(0.2); doc.line(MARGIN, fy - 2, PAGE_W - MARGIN, fy - 2);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(156, 163, 175);
  doc.text(regBits, MARGIN, fy + 2);
}
