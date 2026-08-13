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

import { escText as e } from '@ui';
import { SB_URL, SB_KEY } from '@core';
import { _INV_STORE, toast, calcTotal, ptype, token } from './main.js';

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
  // created, edited, or paid (see generateAndStoreInvoicePDF in
  // office/main.js) — the Portal only ever shows that stored file, the
  // same way it only ever shows a stored certificate PDF (apps/portal/
  // certs.js has no client-side cert renderer either, just a "No PDF"
  // state — see certMini()). No client-side rebuild here anymore: a copy
  // built from whatever data happens to be loaded in this browser could
  // drift from the real design, and more importantly could show a stale
  // Paid/Unpaid/Partial stamp if it were ever built before the latest
  // recorded payment.
  if(inv.pdf_url){
    bd.innerHTML=`
      ${_payable(inv)?`<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button id="pay-now-btn" class="dl" onclick="payInvoice('${id}')" style="background:var(--success,#16a34a)">Pay Now — £${calcTotal(inv).grand.toFixed(2)}</button></div>`:''}
      <iframe src="${e(inv.pdf_url)}" style="width:100%;height:70vh;border:0;border-radius:var(--radius)" title="Invoice ${e(inv.number||'')}"></iframe>`;
  } else {
    bd.innerHTML=`<div style="text-align:center;padding:48px 20px;color:var(--text-secondary)">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px;color:var(--text)">This invoice's PDF isn't ready yet</div>
      <div style="font-size:13px">Check back shortly, or contact your service provider if this doesn't update.</div>
    </div>`;
  }
  document.getElementById('pdf-modal').classList.add('show');
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
  // Only ever the stored, office-generated PDF — see the comment in
  // previewInv for why there's no client-side fallback anymore.
  if(!inv.pdf_url){toast("This invoice's PDF isn't ready yet — please check back shortly");return;}
  const a=document.createElement('a');
  a.href=inv.pdf_url; a.target='_blank'; a.rel='noopener'; a.download=(inv.number||'invoice')+'.pdf';
  document.body.appendChild(a); a.click(); a.remove();
}
