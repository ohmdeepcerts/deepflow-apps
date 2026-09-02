// P&L exports — the overdue-reminder WhatsApp sender, and the P&L/Xero/
// QuickBooks CSV exports (plus the small generic CSV-download helpers they
// share). Extracted from main.js verbatim (Phase 1 of the follow-up
// modularization pass — see the plan file for scope) — no behaviour changes.
//
// _downloadCsv/escCsv were verified to have exactly one consumer (this
// cluster) before extraction — exportInvsCSV/exportPropsCSV/exportAllCSV
// elsewhere in main.js each build their own CSV inline and don't use these,
// so they're kept here rather than pulled into a separate shared file.
//
// This module and main.js import from each other, same as the other
// extracted modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { dAll, toast, calcInvTotal } from './main.js';

function _sendPLReminder(invNum, clientName, amount, daysOld){
  const msg = `Hi ${clientName},\\n\\nThis is a friendly reminder that invoice *${invNum}* for *${amount.toLocaleString('en-GB',{style:'currency',currency:'GBP'})}* is now *${daysOld} days overdue*.\\n\\nPlease could you arrange payment at your earliest convenience?\\n\\nIf you've already paid, please disregard this message.\\n\\nThanks!`;
  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

/* ── CSV Exports ── */
function exportPLCSV(){
  const headers = ['Date','Invoice Number','Client','Description','Subtotal','VAT','Total','Status','Due Date'];
  dAll('invoices').then(invs => {
    const rows = invs.map(i => {
      const t = calcInvTotal(i);
      const desc = (i.items||[]).map(it => it.description).filter(Boolean).join('; ');
      return [i.date||'', i.invoiceNumber||i.number||'', escCsv(i.clientName||i.client||''), escCsv(desc), t.subtotal.toFixed(2), t.vat.toFixed(2), t.grand.toFixed(2), i.status||'', i.dueDate||''];
    });
    _downloadCsv('pl_export.csv', [headers, ...rows]);
    toast('P&L CSV exported','success');
  });
}

function exportXeroCSV(){
  // Xero format: ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType
  dAll('invoices').then(invs => {
    const rows = [];
    invs.forEach(i => {
      const items = i.items||[];
      items.forEach((it, idx) => {
        rows.push([
          escCsv(i.clientName||i.client||'Unknown'),
          i.invoiceNumber||i.number||'',
          i.reference||'',
          i.date||'',
          i.dueDate||'',
          escCsv(it.description||''),
          it.quantity||1,
          (it.price||it.amount||0).toFixed(2),
          it.accountCode||'200',
          it.taxType||'20% VAT'
        ]);
      });
    });
    _downloadCsv('xero_import.csv', [
      ['ContactName','InvoiceNumber','Reference','InvoiceDate','DueDate','Description','Quantity','UnitAmount','AccountCode','TaxType'],
      ...rows
    ]);
    toast('Xero CSV exported','success');
  });
}

function exportQuickBooksCSV(){
  // QuickBooks format: Invoice No,Customer,Invoice Date,Due Date,Item,Description,Qty,Rate,Amount,Service Date
  dAll('invoices').then(invs => {
    const rows = [];
    invs.forEach(i => {
      const items = i.items||[];
      items.forEach(it => {
        rows.push([
          i.invoiceNumber||i.number||'',
          escCsv(i.clientName||i.client||'Unknown'),
          i.date||'',
          i.dueDate||'',
          escCsv(it.description||''),
          escCsv(it.description||''),
          it.quantity||1,
          (it.price||it.amount||0).toFixed(2),
          ((it.quantity||1)*(it.price||it.amount||0)).toFixed(2),
          i.date||''
        ]);
      });
    });
    _downloadCsv('quickbooks_import.csv', [
      ['Invoice No','Customer','Invoice Date','Due Date','Item','Description','Qty','Rate','Amount','Service Date'],
      ...rows
    ]);
    toast('QuickBooks CSV exported','success');
  });
}

function _downloadCsv(filename, rows){
  const csv = rows.map(r => r.map(c => {
    const s = String(c==null?'':c);
    if(s.includes(',')||s.includes('"')||s.includes('\n')) return '"'+s.replace(/"/g,'""')+'"';
    return s;
  }).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function escCsv(str){ return String(str||'').replace(/"/g,'""'); }

export { _sendPLReminder, exportPLCSV, exportXeroCSV, exportQuickBooksCSV, _downloadCsv, escCsv };
