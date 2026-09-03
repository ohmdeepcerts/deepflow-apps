// Client credit-star rating — derived from this app's own invoice history,
// NOT a credit bureau product. Extracted from apps/office/main.js's
// _clientStarsFromInvoices verbatim (relocate, don't change). Also used to
// replace an independent, previously-drifted-risk reimplementation of this
// exact math in main.js's showClientCreditCheck — verified byte-for-byte
// identical thresholds before consolidating onto this one shared function
// (only the two callers' own invoice-matching differs, and that stays
// local to each caller, unchanged).
import { STATUS } from './status.js';
import { calcLineItemsTotal } from './invoice-total.js';

function grand(inv, vatRate){
  return calcLineItemsTotal(inv.items||[], vatRate).grand;
}

export function clientCreditRating(invs, vatRate=20){
  if(!invs||!invs.length) return null;
  const now=new Date();
  const unpaid=invs.filter(i=>i.status!=='Paid'&&i.status!==STATUS.CANCELLED);
  const overdue=unpaid.filter(i=>i.dueDate&&new Date(i.dueDate)<now);
  const paid=invs.filter(i=>i.status==='Paid');
  const veryOverdue=overdue.filter(i=>Math.floor((now-new Date(i.dueDate))/86400000)>60);
  let stars=5;
  if(veryOverdue.length>3) stars-=3; else if(veryOverdue.length>0) stars-=2;
  else if(overdue.length>3) stars-=2; else if(overdue.length>0) stars-=1;
  const avg=invs.length>0?invs.reduce((s,i)=>s+grand(i,vatRate),0)/invs.length:0;
  const unpaidAmt=unpaid.reduce((s,i)=>s+grand(i,vatRate),0);
  if(unpaidAmt>avg*5) stars-=2; else if(unpaidAmt>avg*3) stars-=1;
  if(paid.length>unpaid.length&&paid.length>3) stars+=1;
  stars=Math.max(1,Math.min(5,stars));
  const C={1:'#e05252',2:'#f59e0b',3:'#f0c030',4:'#a3e635',5:'#25d58e'};
  return{stars,color:C[stars],risk:stars<=2?'HIGH RISK':stars===3?'MEDIUM RISK':'LOW RISK',invCount:invs.length,paid:paid.length,overdue:overdue.length,unpaidAmt};
}
