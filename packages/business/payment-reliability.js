// Payment reliability — derived from this app's own invoice/payment
// history, NOT a credit bureau product (that's a separate paid integration
// touching real people's financial data — not what this is). Matches
// invoices to a landlord/agency by name, the same matching every other
// client-facing view here already uses since the FK columns aren't
// populated on existing invoices, and compares last-payment date against
// due date for settled invoices. Extracted from apps/office/main.js's
// _paymentReliability verbatim (relocate, don't change) — `today` and
// `vatRate` are now explicit parameters instead of closing over main.js's
// TODAY()/getVatRate(), same pattern as officeVatRate(S).
import { calcLineItemsTotal } from './invoice-total.js';

export function paymentReliability(clientName, allInvoices, allPayments, today = new Date().toISOString().slice(0,10), vatRate = 20){
  if(!clientName) return null;
  const invs=allInvoices.filter(i=>i.clientName===clientName||i.landlordName===clientName||i.agencyName===clientName||i.billToName===clientName);
  if(!invs.length) return null;
  let onTime=0,late=0,totalDaysLate=0,outstanding=0,overdueCount=0;
  for(const inv of invs){
    const t=calcLineItemsTotal(inv.items||[], vatRate);
    const pmts=allPayments.filter(p=>p.invId===inv.id);
    const paid=pmts.reduce((s,p)=>s+(p.amount||0),0);
    const bal=t.grand-paid;
    if(bal>0.01){
      outstanding+=bal;
      if(inv.dueDate&&inv.dueDate<today) overdueCount++;
    }
    if(pmts.length&&inv.dueDate){
      const lastPmtDate=pmts.reduce((max,p)=>(p.date&&p.date>max)?p.date:max,pmts[0].date||'');
      const daysLate=Math.round((new Date(lastPmtDate)-new Date(inv.dueDate))/86400000);
      if(daysLate<=0) onTime++; else { late++; totalDaysLate+=daysLate; }
    }
  }
  const scored=onTime+late;
  const avgDaysLate=late?Math.round(totalDaysLate/late):0;
  let label='New',color='var(--txt3)';
  if(overdueCount>0){ label='⚠️ Overdue now'; color='var(--red)'; }
  else if(scored>0){
    const pct=onTime/scored;
    if(pct>=0.9){ label='✅ Excellent'; color='var(--green)'; }
    else if(pct>=0.6){ label='🟡 Fair'; color='var(--yellow)'; }
    else { label='🔴 Poor'; color='var(--red)'; }
  } else if(outstanding>0.01){ label='⏳ Awaiting first payment'; color='var(--yellow)'; }
  return{label,color,onTime,late,avgDaysLate,outstanding,invoiceCount:invs.length,overdueCount};
}
