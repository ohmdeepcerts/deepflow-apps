// Invoice PDF — the on-screen invoice preview modal and the jsPDF-based
// download. Extracted from main.js verbatim (Phase 5 of the architecture
// migration, Client Portal module 3) — no behaviour changes.
//
// _CURRENT_INV_ID had no readers or writers anywhere else in main.js, so
// it moved wholly into this module. _INV_STORE stays in main.js and is
// exported as a live `const Map` binding instead, since it's also
// populated from INIT (initial load) and the INVOICES section
// (vInvoices) — both stay put, and a Map's mutations (.set()) are
// visible through the shared reference regardless of which module reads
// it. _d/_S are likewise live bindings: each is assigned exactly once,
// during INIT, and never reassigned again.

import { escText as e, buildInvoiceHTML } from '@ui';
import { _INV_STORE, _d, _S, toast, calcTotal, _portalVatRate, fd, refreshIcons } from './main.js';

let _CURRENT_INV_ID=null;

export function previewInv(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  _CURRENT_INV_ID=id;
  const bd=document.getElementById('pdf-modal-bd');

  // Office App generates and stores the real PDF the moment an invoice is
  // created or edited (see generateAndStoreInvoicePDF in office/main.js) —
  // show that fixed file instead of re-rendering the invoice from data in
  // this browser. Only invoices from before that existed fall through to
  // the client-side rebuild below.
  if(inv.pdfUrl){
    bd.innerHTML=`<iframe src="${e(inv.pdfUrl)}" style="width:100%;height:70vh;border:0;border-radius:var(--radius)" title="Invoice ${e(inv.number||'')}"></iframe>`;
    document.getElementById('pdf-modal').classList.add('show');
    return;
  }

  const t=calcTotal(inv);const vr=_portalVatRate();
  const items=(inv.items||[]).map(x=>{
    const l=(x.qty||1)*(x.unit||0);const v=x.vat?l*vr/100:0;
    return`<tr><td style="padding:8px;border-bottom:1px solid var(--border)">${e(x.desc||'')}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--border)">${x.qty||1}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">£${Number(x.unit||0).toFixed(2)}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">${x.vat?vr+'%':'—'}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border);font-weight:700">£${(l+v).toFixed(2)}</td></tr>`;
  }).join('');
  bd.innerHTML=`
    <div style="max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
        <div>
          <div style="font-size:20px;font-weight:800;color:var(--accent)">${e(_S?.coName||'Your Company')}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${e(_S?.coAddr||'').replace(/,/g,'<br>')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:24px;font-weight:800;color:var(--text)">INVOICE</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${e(inv.number||'—')}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${fd(inv.date)}</div>
        </div>
      </div>
      <div style="background:var(--border-subtle);border-radius:var(--radius);padding:16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Bill To</div>
        <div style="font-size:14px;font-weight:700">${e(inv.billToName||inv.clientName||_d.name||'—')}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${e(inv.billToAddress||'')}</div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:20px">
        <thead><tr style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-tertiary);border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:8px">Description</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Unit</th><th style="padding:8px;text-align:right">VAT</th><th style="padding:8px;text-align:right">Total</th>
        </tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
        <div style="width:240px">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>Subtotal</span><span>£${t.sub.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>VAT (${vr}%)</span><span>£${t.vat.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--border);font-size:16px;font-weight:800"><span>Total</span><span>£${t.grand.toFixed(2)}</span></div>
        </div>
      </div>
      ${inv.status==='Paid'?`<div style="text-align:center;padding:20px;border:3px solid var(--success);color:var(--success);font-size:28px;font-weight:800;transform:rotate(-5deg);opacity:0.8;border-radius:var(--radius)">PAID</div>`:''}
      ${inv.status==='Awaiting Payment'?`<div style="text-align:center;padding:14px;border:3px solid #dc2626;color:#dc2626;font-size:22px;font-weight:800;transform:rotate(-5deg);opacity:0.8;border-radius:var(--radius)">UNPAID</div>`:''}
      <div style="font-size:11px;color:var(--text-tertiary);text-align:center;margin-top:20px">Please quote reference ${e(inv.number||'—')} with your payment</div>
    </div>`;
  document.getElementById('pdf-modal').classList.add('show');
  refreshIcons();
}

export function downloadCurrentInv(){if(_CURRENT_INV_ID)downloadInvPDF(_CURRENT_INV_ID);}

export function closeModal(ev){
  if(ev&&ev.target!==ev.currentTarget)return;
  document.getElementById('pdf-modal').classList.remove('show');
  _CURRENT_INV_ID=null;
}

export async function downloadInvPDF(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  // Prefer the stored, office-generated PDF — same reasoning as previewInv.
  if(inv.pdfUrl){
    const a=document.createElement('a');
    a.href=inv.pdfUrl; a.target='_blank'; a.rel='noopener'; a.download=(inv.number||'invoice')+'.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  if(!window.jspdf||!window.html2canvas){toast('PDF library loading — please wait and try again');return;}

  // Same shared HTML template as the Office App (packages/ui/invoice-
  // template.js), rasterised the same way — this file used to be a
  // completely separate, independently hand-drawn jsPDF design that only
  // an invoice without a stored pdfUrl yet would ever hit, which is
  // exactly why a redesign could land in Office and this would still show
  // the old look here. One template now, not two that can drift again.
  const {jsPDF}=window.jspdf;
  const t=calcTotal(inv);
  const vr=_portalVatRate();
  const html=buildInvoiceHTML({inv,S:_S,totals:t,vatRate:vr});
  const holder=document.createElement('div');
  holder.style.cssText='position:fixed;left:-99999px;top:0;';
  holder.innerHTML=html;
  document.body.appendChild(holder);
  let doc;
  try{
    const canvas=await window.html2canvas(holder.firstElementChild,{scale:3,useCORS:true,backgroundColor:'#ffffff'});
    doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    // Always a real portrait A4 page, one page per screen's worth of
    // content — see the matching comment in office/main.js's
    // _buildInvoicePDFDoc for the full reasoning.
    const pxPerMM=canvas.width/210;
    const pageHPx=Math.floor(297*pxPerMM);
    let y=0, pageNum=0;
    while(y<canvas.height){
      const sliceHPx=Math.min(pageHPx,canvas.height-y);
      const slice=document.createElement('canvas');
      slice.width=canvas.width; slice.height=sliceHPx;
      slice.getContext('2d').drawImage(canvas,0,y,canvas.width,sliceHPx,0,0,canvas.width,sliceHPx);
      const imgData=slice.toDataURL('image/jpeg',0.95);
      if(pageNum>0) doc.addPage();
      doc.addImage(imgData,'JPEG',0,0,210,sliceHPx/pxPerMM);
      y+=sliceHPx; pageNum++;
    }
  } finally {
    holder.remove();
  }
  doc.save((inv.number||'invoice')+'.pdf');
  toast('Invoice downloaded');
}
