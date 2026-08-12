// Draws the ENTIRE invoice — header included — as real PDF text and
// vector shapes (jsPDF's native API, the same kind of drawing
// Zoho/QuickBooks/Xero use), with jsPDF-AutoTable handling the item
// table's own pagination. Nothing here is a rendered screenshot: no
// html2canvas, no embedded photograph of a page full of text — a few KB
// per invoice instead of the 50-100KB+ a rasterised masthead used to cost
// on its own.
//
// "Editorial" layout — approved 2026-08-12 after several rounds with the
// business owner (see git log for the earlier navy/gold and generative-
// watermark attempts, both rejected as "not what a certified electrician's
// paperwork should look like"). The brief that survived: hairline rules
// instead of solid colour bands, generous whitespace, small tracked
// uppercase labels, tabular figures, bold used only where it earns its
// place (company name, names, the total) — everything else normal weight.
// The only colour on the page is the status pill; the rest is ink, grey,
// and white. Deliberately has no logo mark and no generative graphic —
// both were tried and explicitly turned down in favour of letting the
// typography alone carry it.

import { esc } from './invoice-template.js';

const MARGIN = 20;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = [24, 27, 31];
const MUTED = [139, 143, 151];
const FAINT = [154, 160, 166];
const HAIRLINE = [229, 230, 232];

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
// the border/text. The one place colour appears on the page at all.
const STATUS_LIGHT = {
  Paid: { label: 'Paid', bg: [227, 247, 234], fg: [31, 122, 76] },
  'Awaiting Payment': { label: 'Awaiting Payment', bg: [252, 240, 224], fg: [184, 114, 12] },
  Cancelled: { label: 'Cancelled', bg: [250, 231, 231], fg: [178, 48, 48] },
  Draft: { label: 'Draft', bg: [237, 238, 240], fg: [107, 112, 118] },
};
function statusStyle(status) { return STATUS_LIGHT[status] || STATUS_LIGHT.Draft; }

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

  // ---- 1. Header — status pill, company name, invoice meta ----
  const status = statusStyle(inv.status);
  let y = MARGIN;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  const pillLabel = status.label.toUpperCase();
  const pillW = doc.getTextWidth(pillLabel) + 7.5, pillH = 5.2;
  doc.setFillColor(...status.bg);
  doc.setDrawColor(...status.fg); doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN, y, pillW, pillH, 1.3, 1.3, 'FD');
  doc.setTextColor(...status.fg);
  doc.text(pillLabel, MARGIN + pillW / 2, y + pillH / 2 + 1.15, { align: 'center' });

  const nameY = y + pillH + 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...INK);
  doc.text(esc(S.coName || 'Your Company'), MARGIN, nameY);

  const contactBits = [S.coPhone, S.coEmail].filter(Boolean).join('   ·   ');
  if (contactBits) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
    doc.text(contactBits, MARGIN, nameY + 5.2);
  }

  const rightX = PAGE_W - MARGIN;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
  doc.text(`INVOICE ${esc(inv.number)}`, rightX, y + pillH + 2.2, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...MUTED);
  doc.text(`Tax invoice · ${esc(inv.date || '—')}`, rightX, y + pillH + 7.7, { align: 'right' });

  const headerBottom = nameY + 9;
  doc.setDrawColor(...HAIRLINE); doc.setLineWidth(0.25);
  doc.line(MARGIN, headerBottom, PAGE_W - MARGIN, headerBottom);

  // ---- 2. Ordered By / Site of Works (vector, no accent rail — hairlines only) ----
  y = headerBottom + 10;
  const colW = (CONTENT_W - 10) / 2;
  const colXs = [MARGIN, MARGIN + colW + 10];

  const drawCol = (x, label, name, lines) => {
    let cy = y;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.3); doc.setTextColor(...FAINT);
    doc.text(label.toUpperCase(), x, cy);
    cy += 5.6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(name, x, cy);
    cy += 4.8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(107, 112, 118);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, colW - 4);
      for (const wl of wrapped) { doc.text(wl, x, cy); cy += 3.9; }
    }
    return cy;
  };

  const leftLines = isAgency
    ? ['Letting agency' + (inv.agentName ? ' · ' + inv.agentName : ''), inv.clientEmail].filter(Boolean)
    : [billToAddr, inv.clientEmail].filter(Boolean);
  const rightLines = [];

  const leftBottom = drawCol(colXs[0], 'Ordered By', billToName, leftLines);
  const rightBottom = drawCol(colXs[1], 'Site of Works', propAddr || '—', rightLines);
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
    headStyles: { fontStyle: 'bold', fontSize: 7.3, textColor: FAINT },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell(data) {
      if (data.section === 'head') data.cell.text = data.cell.text.map(t => String(t).toUpperCase());
    },
    didDrawCell(data) {
      const bottom = data.cell.y + data.cell.height;
      doc.setDrawColor(...(data.section === 'head' ? INK : HAIRLINE));
      doc.setLineWidth(data.section === 'head' ? 0.3 : 0.2);
      doc.line(data.cell.x, bottom, data.cell.x + data.cell.width, bottom);
    },
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
        doc.text(String(inv.number), MARGIN, 12);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
        doc.text(' — continued', MARGIN + doc.getTextWidth(String(inv.number)), 12);
      }
    },
  });
  y = doc.lastAutoTable.finalY + 10;

  // ---- 4. Total — plain right-aligned figures, no colour band ----
  const totalReserve = hasVat ? 30 : 22, footerReserve = 24;
  if (y + totalReserve + footerReserve > PAGE_H) {
    doc.addPage();
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
