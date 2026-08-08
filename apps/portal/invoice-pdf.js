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

import { escText as e, renderInvoicePDF } from '@ui';
import { SB_URL, SB_KEY } from '@core';
import { _INV_STORE, _d, _S, toast, calcTotal, _portalVatRate, fd, refreshIcons, ptype, token } from './main.js';

let _CURRENT_INV_ID=null;

// Only landlord/agency portals can pay — matches create-checkout-session's
// own authorization, which checks client_person_id/client_agency_id and
// has no path for the agent view (agents don't hold the invoice's money).
const _payable=(inv)=> (ptype==='landlord'||ptype==='agency') && inv.status!=='Paid' && inv.status!=='Cancelled' && inv.status!=='Disposable';

export async function payInvoice(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  const btn=document.getElementById('pay-now-btn');
  if(btn){btn.disabled=true;btn.textContent='Redirecting to secure checkout…';}
  try{
    const res=await fetch(`${SB_URL}/functions/v1/create-checkout-session`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY},
      body:JSON.stringify({invoiceId:id, portalType:ptype, portalId:token})
    });
    const data=await res.json();
    if(!res.ok||!data.url){toast(data.error||'Could not start checkout — please try again','error');if(btn){btn.disabled=false;btn.textContent='Pay Now';}return;}
    window.location.href=data.url;
  }catch(err){
    toast('Could not reach the payment service — please try again','error');
    if(btn){btn.disabled=false;btn.textContent='Pay Now';}
  }
}

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
  // NOTE: this used to check inv.pdfUrl (camelCase), a field that never
  // actually existed on this object — _fix() here only renames a small,
  // explicit list of no-underscore legacy columns (see the _fixMap comment
  // near the top of main.js), and pdf_url isn't one of them, so this
  // branch was silently dead: every invoice always fell through to the
  // client-side rebuild below. Fixed to the real field name, which
  // _resolveFileUrls() in main.js now also keeps pointed at a live signed
  // URL rather than the dead public one.
  if(inv.pdf_url){
    bd.innerHTML=`
      ${_payable(inv)?`<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button id="pay-now-btn" class="dl" onclick="payInvoice('${id}')" style="background:var(--success,#16a34a)">Pay Now — £${calcTotal(inv).grand.toFixed(2)}</button></div>`:''}
      <iframe src="${e(inv.pdf_url)}" style="width:100%;height:70vh;border:0;border-radius:var(--radius)" title="Invoice ${e(inv.number||'')}"></iframe>`;
    document.getElementById('pdf-modal').classList.add('show');
    return;
  }

  const t=calcTotal(inv);const vr=_portalVatRate();
  // No VAT column/row at all when VAT isn't applicable — a "VAT (0%) £0.00"
  // line was showing on every invoice regardless of whether VAT was ever
  // in the picture, which reads as a mistake rather than a deliberate zero.
  const vatApplies=vr>0;
  const items=(inv.items||[]).map(x=>{
    const l=(x.qty||1)*(x.unit||0);const v=x.vat?l*vr/100:0;
    return`<tr><td style="padding:8px;border-bottom:1px solid var(--border)">${e(x.desc||'')}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--border)">${x.qty||1}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">£${Number(x.unit||0).toFixed(2)}</td>${vatApplies?`<td style="padding:8px;text-align:right;border-bottom:1px solid var(--border)">${x.vat?vr+'%':'—'}</td>`:''}<td style="padding:8px;text-align:right;border-bottom:1px solid var(--border);font-weight:700">£${(l+v).toFixed(2)}</td></tr>`;
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
          <th style="text-align:left;padding:8px">Description</th><th style="padding:8px">Qty</th><th style="padding:8px;text-align:right">Unit</th>${vatApplies?'<th style="padding:8px;text-align:right">VAT</th>':''}<th style="padding:8px;text-align:right">Total</th>
        </tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
        <div style="width:240px">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>Subtotal</span><span>£${t.sub.toFixed(2)}</span></div>
          ${vatApplies?`<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>VAT (${vr}%)</span><span>£${t.vat.toFixed(2)}</span></div>`:''}
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--border);font-size:16px;font-weight:800"><span>Total</span><span>£${t.grand.toFixed(2)}</span></div>
        </div>
      </div>
      ${inv.status==='Paid'?`<div style="text-align:center;padding:20px;border:3px solid var(--success);color:var(--success);font-size:28px;font-weight:800;transform:rotate(-5deg);opacity:0.8;border-radius:var(--radius)">PAID</div>`:''}
      ${inv.status==='Awaiting Payment'?`<div style="text-align:center;padding:14px;border:3px solid #dc2626;color:#dc2626;font-size:22px;font-weight:800;transform:rotate(-5deg);opacity:0.8;border-radius:var(--radius)">UNPAID</div>`:''}
      ${_payable(inv)?`<div style="margin-top:16px"><button id="pay-now-btn" class="dl" onclick="payInvoice('${id}')" style="width:100%;justify-content:center;padding:14px;font-size:15px;background:var(--success,#16a34a)">Pay Now — £${t.grand.toFixed(2)}</button></div>`:''}
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
  // Prefer the stored, office-generated PDF — same reasoning as previewInv
  // (and same pdf_url vs pdfUrl field-name fix, see the comment there).
  if(inv.pdf_url){
    const a=document.createElement('a');
    a.href=inv.pdf_url; a.target='_blank'; a.rel='noopener'; a.download=(inv.number||'invoice')+'.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  if(!window.jspdf||!window.html2canvas){toast('PDF library loading — please wait and try again');return;}

  // Same shared renderer as the Office App (packages/ui/pdf-vector.js) —
  // real vector text/shapes for the body, a small rendered image only for
  // the masthead. This file used to be a completely separate,
  // independently hand-drawn jsPDF design that only an invoice without a
  // stored pdfUrl yet would ever hit, which is exactly why a redesign
  // could land in Office and this would still show the old look here.
  // One renderer now, not two that can drift again.
  const {jsPDF}=window.jspdf;
  const t=calcTotal(inv);
  const vr=_portalVatRate();
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',floatPrecision:2});
  await renderInvoicePDF(doc,window.html2canvas,{inv,S:_S,totals:t,vatRate:vr});
  doc.save((inv.number||'invoice')+'.pdf');
  toast('Invoice downloaded');
}
