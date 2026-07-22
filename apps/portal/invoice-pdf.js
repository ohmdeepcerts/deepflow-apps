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
import { _INV_STORE, _d, _S, toast, calcTotal, _portalVatRate, fd, refreshIcons } from './main.js';

let _CURRENT_INV_ID=null;

export function previewInv(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  _CURRENT_INV_ID=id;
  const t=calcTotal(inv);const vr=_portalVatRate();
  const bd=document.getElementById('pdf-modal-bd');
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

export function downloadInvPDF(id){
  const inv=_INV_STORE.get(id);
  if(!inv){toast('Invoice not found');return;}
  if(!window.jspdf){toast('PDF library loading — please wait and try again');return;}
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210,H=297,M=18,RW=W-M*2;
  const accent=[79,70,229],dark=[15,23,42],mid=[100,116,139],light=[241,245,249];
  const t=calcTotal(inv);
  const vr=_portalVatRate();

  const safeText=(txt,x,y,maxW)=>{if(!txt)return;const lines=doc.splitTextToSize(String(txt),maxW||80);doc.text(lines,x,y);return lines.length;};

  doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');
  let cy=M+6;
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...dark);
  doc.text(_S.coName||'Your Company',M,cy);cy+=6;
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...mid);
  if(_S.coAddr){safeText(_S.coAddr,M,cy,70);cy+=4.5*(_S.coAddr.split(',').length);}
  if(_S.coPhone){doc.text(_S.coPhone,M,cy);cy+=4.5;}
  if(_S.coEmail){doc.text(_S.coEmail,M,cy);cy+=4.5;}
  if(_S.coVatNum){doc.text('VAT No: '+_S.coVatNum,M,cy);}

  doc.setFont('helvetica','bold');doc.setFontSize(32);doc.setTextColor(...accent);
  doc.text('INVOICE',W-M,M+12,{align:'right'});
  doc.setFontSize(11);doc.setTextColor(...dark);
  doc.text(inv.number||'—',W-M,M+22,{align:'right'});
  doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...mid);
  doc.text('Issue date: '+(inv.date||'—'),W-M,M+30,{align:'right'});
  if(inv.dueDate)doc.text('Due date:  '+inv.dueDate,W-M,M+36,{align:'right'});
  doc.setFont('helvetica','bold');
  const sc={'Paid':[16,185,129],'Awaiting Payment':[245,158,11],'Cancelled':[239,68,68],'Draft':[148,163,184]}[inv.status]||mid;
  doc.setTextColor(...sc);doc.text(inv.status||'Draft',W-M,M+44,{align:'right'});

  let y=Math.max(cy+8,58);
  doc.setDrawColor(226,232,240);doc.setLineWidth(0.3);doc.line(M,y,W-M,y);y+=8;
  const colW=(RW-10)/2;
  doc.setFillColor(...light);doc.rect(M,y,colW,6,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...mid);
  doc.text('BILL TO',M+3,y+4.5);y+=10;
  doc.setFont('helvetica','normal');doc.setFontSize(11);doc.setTextColor(...dark);
  doc.text(inv.billToName||inv.clientName||_d.name||'—',M,y);
  let cY=y+6;
  const bAddr=inv.billToAddress||inv.clientAddr||'';
  if(bAddr){doc.setFontSize(9);doc.setTextColor(...mid);const al=doc.splitTextToSize(bAddr,colW);doc.text(al,M,cY);cY+=al.length*4.5;}
  y=cY+6;
  doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=3;
  doc.setFillColor(...dark);doc.rect(M,y,RW,7,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(200,200,220);
  const cols=[M+2,M+90,M+114,M+134,W-M-2];
  ['DESCRIPTION','QTY','UNIT PRICE','VAT','TOTAL'].forEach((h,i)=>doc.text(h,cols[i],y+4.8,i===4?{align:'right'}:null));
  y+=9;
  (inv.items||[]).forEach((item,ii)=>{
    const l=(item.qty||1)*(item.unit||0);const v=item.vat?l*vr/100:0;
    if(y>H-50){doc.addPage();doc.setFillColor(...accent);doc.rect(0,0,W,4,'F');y=14;}
    if(ii%2===0){doc.setFillColor(248,250,252);doc.rect(M,y-3.5,RW,7.5,'F');}
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...dark);
    const dl=doc.splitTextToSize(String(item.desc||''),82);
    doc.text(dl[0]+(dl.length>1?'…':''),M+2,y+1);
    doc.text(String(item.qty||1),cols[1],y+1);
    doc.text('£'+Number(item.unit||0).toFixed(2),cols[2],y+1);
    doc.setTextColor(item.vat?100:160,item.vat?120:160,160);
    doc.text(item.vat?vr+'%':'—',cols[3],y+1);
    doc.setTextColor(...dark);doc.text('£'+(l+v).toFixed(2),cols[4],y+1,{align:'right'});y+=7.5;
  });
  y+=3;doc.setDrawColor(226,232,240);doc.line(M,y,W-M,y);y+=7;
  const tC=W-M-52;
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.setTextColor(...mid);
  doc.text('Subtotal:',tC,y);doc.text('£'+t.sub.toFixed(2),W-M,y,{align:'right'});y+=6;
  doc.text(`VAT (${vr}%):`,tC,y);doc.text('£'+t.vat.toFixed(2),W-M,y,{align:'right'});y+=3;
  doc.setDrawColor(226,232,240);doc.line(tC,y,W-M,y);y+=6;
  doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(...accent);
  doc.text('TOTAL:',tC,y);doc.text('£'+t.grand.toFixed(2),W-M,y,{align:'right'});y+=10;
  if(inv.status==='Paid'){
    doc.saveGraphicsState();doc.setGState(doc.GState({opacity:0.06}));
    doc.setFont('helvetica','bold');doc.setFontSize(85);doc.setTextColor(16,185,129);
    doc.text('PAID',W/2,H/2,{align:'center',angle:35});doc.restoreGraphicsState();
  }
  if(_S.bankName||_S.bankAcc){
    y+=2;doc.setFillColor(...light);doc.rect(M,y,RW,6,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...mid);
    doc.text('PAYMENT DETAILS',M+3,y+4);y+=8;
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...dark);
    if(_S.bankName)doc.text('Bank: '+_S.bankName,M,y);
    if(_S.bankAcc)doc.text('Acc: '+_S.bankAcc+(_S.bankSort?' · Sort: '+_S.bankSort:''),M+60,y);y+=5.5;
    if(_S.bankIBAN)doc.text('IBAN: '+_S.bankIBAN,M,y);
  }
  y+=10;
  doc.setFillColor(255,251,235);doc.setDrawColor(...accent);doc.setLineWidth(0.5);
  doc.roundedRect(M,y-3.5,RW,10,2,2,'FD');
  doc.setFont('helvetica','bold');doc.setFontSize(9);doc.setTextColor(100,70,10);
  doc.text('Please quote reference: '+(inv.number||'—')+' with your payment',M+3,y+3);y+=14;
  if(_S.payTerms||_S.invNotes){
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...mid);
    if(_S.payTerms){safeText(_S.payTerms,M,y,RW);y+=5;}
    if(_S.invNotes){safeText(_S.invNotes,M,y,RW);}
  }
  doc.setDrawColor(226,232,240);doc.line(M,H-14,W-M,H-14);
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(170,175,195);
  doc.text(_S?.coName||'',M,H-9);
  doc.text('Generated by DeepFlow',W-M,H-9,{align:'right'});
  doc.setFillColor(...accent);doc.rect(0,H-4,W,4,'F');
  doc.save((inv.number||'invoice')+'.pdf');
  toast('Invoice downloaded');
}
