// Draws the invoice body as real PDF text and vector shapes (jsPDF's
// native API — the same kind of drawing Zoho/QuickBooks/Xero use), with
// jsPDF-AutoTable handling the item table's own pagination. Only the
// masthead (see invoice-template.js) is a rendered image; everything
// below it is selectable, searchable, and a few KB instead of a few
// hundred. See the comment at the top of invoice-template.js for why.
//
// Deliberately not attempted here: soft box-shadows (no native
// equivalent — flat fills + thin borders instead), the small
// person/pin icons on the Ordered By / Site of Works labels (label text
// alone reads just as clean), and the gradient-clipped "DeepFlow"
// wordmark (gradient text isn't a thing in vector PDF text — solid
// brand cyan instead). The navy→gold total band keeps its gradient by
// the same trick the pre-html2canvas version of this app used: ~60 thin
// adjacent vector rectangles interpolating between the stops, which
// looks smooth in print and costs a couple of KB, not a few hundred.

import { buildMastheadHTML } from './invoice-template.js';

const MARGIN = 18;
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - MARGIN * 2;

const NAVY_STOPS = [
  [13, 31, 60],   // #0d1f3c
  [30, 58, 95],   // #1e3a5f
  [10, 22, 40],   // #0a1628
];
function navyGradientColorAt(t) {
  const seg = t <= 0.5 ? 0 : 1;
  const localT = seg === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = NAVY_STOPS[seg], b = NAVY_STOPS[seg + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * localT),
    Math.round(a[1] + (b[1] - a[1]) * localT),
    Math.round(a[2] + (b[2] - a[2]) * localT),
  ];
}

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

const STATUS_COLORS = {
  Paid: { label: 'Paid', bg: [74, 222, 128, .16], fg: '#86EFAC' },
  'Awaiting Payment': { label: 'Awaiting Payment', bg: [253, 224, 71, .16], fg: '#FDE68A' },
  Cancelled: { label: 'Cancelled', bg: [252, 165, 165, .16], fg: '#FCA5A5' },
  Draft: { label: 'Draft', bg: [203, 213, 225, .16], fg: '#CBD5E1' },
};
// Masthead is rendered as real HTML/CSS (rgba works there); the vector
// status pill below needs flat RGB since jsPDF fills don't do alpha
// compositing the same way — pre-blended against the navy/white
// backgrounds each pill actually sits on.
function pillHtmlColors(status) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.Draft;
  return { label: s.label, bg: `rgba(${s.bg[0]},${s.bg[1]},${s.bg[2]},${s.bg[3]})`, fg: s.fg };
}

/**
 * Renders one invoice into `doc` starting at the current page. Adds pages
 * as needed if the item list overflows. Returns nothing — mutates doc.
 * @param {import('jspdf').jsPDF} doc
 * @param {(el: HTMLElement, opts: object) => Promise<HTMLCanvasElement>} html2canvas
 * @param {{inv:object, S:object, totals:{grand:number}, vatRate:number}} p
 */
export async function renderInvoicePDF(doc, html2canvas, { inv, S, totals, vatRate }) {
  const isAgency = inv.invoiceType === 'agency';
  const billToName = inv.billToName || inv.clientName || '—';
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  const realName = inv.landlordName || inv.agencyName || inv.clientName || '';
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  const showAgent = S.invShowAgent !== false && isAgency && inv.agentName && inv.agentName.trim();
  const isPaid = inv.status === 'Paid';
  const regBits = [S.invFooter, (S.coVatNum && S.vatEnabled !== false) ? 'VAT ' + S.coVatNum : null].filter(Boolean).join(' · ');

  // ---- 1. Masthead (the one raster image) ----
  const mastHTML = buildMastheadHTML({ inv, S, status: pillHtmlColors(inv.status) });
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
  holder.innerHTML = mastHTML;
  document.body.appendChild(holder);
  let mastHeightMM;
  try {
    // scale 2.5 + quality 0.88 measured out at ~110KB for this image alone
    // (nearly the whole file) — it's a gradient band with a sparse particle
    // scatter, not fine text, so it doesn't need retina-plus density. 2.0 +
    // 0.75 measured at ~54KB with no visible quality loss and keeps the
    // total PDF in the same ballpark as Zoho/QuickBooks instead of 4x over.
    const canvas = await html2canvas(holder.firstElementChild, { scale: 2.0, useCORS: true, backgroundColor: null });
    const imgData = canvas.toDataURL('image/jpeg', 0.75);
    const pxPerMM = canvas.width / PAGE_W;
    mastHeightMM = canvas.height / pxPerMM;
    doc.addImage(imgData, 'JPEG', 0, 0, PAGE_W, mastHeightMM);
  } finally {
    holder.remove();
  }

  // ---- 2. Ordered By / Site of Works (vector) ----
  let y = mastHeightMM + 10;
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
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(13, 31, 60);
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

  // Clip the gradient strips to a rounded-rect path so the band gets soft
  // corners like the payref box below it, instead of the strips' own sharp
  // edges showing through — costs nothing (still pure vector), unlike a
  // raster shadow/rounding trick would.
  doc.saveGraphicsState();
  doc.roundedRect(MARGIN, y, CONTENT_W, totalBandH, 2, 2, null);
  doc.clip();
  doc.discardPath();
  const strips = 60, stripW = CONTENT_W / strips;
  for (let i = 0; i < strips; i++) {
    const [r, g, b] = navyGradientColorAt(i / (strips - 1));
    doc.setFillColor(r, g, b);
    doc.rect(MARGIN + i * stripW, y, stripW + 0.3, totalBandH, 'F');
  }
  doc.restoreGraphicsState();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
  doc.text((isPaid ? 'TOTAL PAID' : 'TOTAL DUE'), MARGIN + 6, y + totalBandH / 2 + 1.2, { renderingMode: 'fill' });
  doc.setFontSize(15); doc.setTextColor(242, 193, 78);
  doc.text(money(totals.grand), MARGIN + CONTENT_W - 6, y + totalBandH / 2 + 1.6, { align: 'right' });
  y += totalBandH + 5;

  if (isPaid) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(63, 122, 71);
    doc.text(`✓ Paid via Bank Transfer · Ref ${inv.number}`, MARGIN, y + 4);
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
  let fy = PAGE_H - MARGIN - (showAgent ? 15 : 9);
  doc.setDrawColor(216, 220, 227); doc.setLineWidth(0.2); doc.line(MARGIN, fy, PAGE_W - MARGIN, fy);
  fy += 4;
  if (showAgent) {
    drawMixed(doc, MARGIN, fy, [['Agent — ', 'normal', [55, 65, 81]], [inv.agentName, 'bold', [25, 28, 34]]]);
    doc.setFontSize(8.5);
    fy += 6;
    doc.setDrawColor(238, 241, 245); doc.setLineWidth(0.2); doc.line(MARGIN, fy - 2, PAGE_W - MARGIN, fy - 2);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(156, 163, 175);
  doc.text(regBits, MARGIN, fy + 2);
  doc.setFontSize(6.5); doc.setTextColor(156, 163, 175);
  doc.text('Invoicing & Job Management', PAGE_W - MARGIN, fy - 1.5, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(14, 165, 233);
  doc.text('Powered by DeepFlow', PAGE_W - MARGIN, fy + 2.5, { align: 'right' });
}
