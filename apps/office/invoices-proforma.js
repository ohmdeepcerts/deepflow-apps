// Proforma / disposable-invoice flows — quotations raised from a job or
// standalone, quick minimal-detail "disposable" invoices, and converting a
// proforma into a real invoice. Extracted from main.js verbatim (Phase 5c
// of the follow-up modularization pass — see the plan file for scope) — no
// behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { toDb as _toDb } from '@data';
import {
  _jobRowData, getVatRate, TODAY, _sb, dGet, toast, closeModal, openModal,
  renderInvList, viewInv, nextInvNum, nextJobNum, nextProformaNum, getAppUser,
} from './main.js';

// Create proforma from job
export async function createProforma(jobId){
  const job=_jobRowData[jobId];
  if(!job){toast('Job not found','error');return;}
  const now=Date.now();
  const num=await nextProformaNum();
  const vr=getVatRate();
  const price=Number(job.price)||0;
  const vat=price*vr/100;
  // Built in camelCase and run through _toDb() like every other invoice
  // write path (dPut) does — this used to hand-type snake_case keys
  // directly, which had drifted out of sync with the real column names
  // (dueDate, billToName, jobId, jobDate, certTypes, vat, etc. were all
  // being sent as literal unrecognized columns), so every proforma
  // creation failed outright with a PGRST204.
  const body=_toDb('invoices',{
    type:'proforma',
    status:'Draft',
    number:num,
    date:TODAY(),
    dueDate:TODAY(),
    billToName:job.llName||job.clientName||'',
    billToAddress:job.llAddr||job.address||'',
    jobId:job.id,
    jobNum:job.jobNum||'',
    jobDate:job.date||'',
    jobAddress:job.address||'',
    propertyAddress:job.address||'',
    engineer:job.engineer||'',
    certTypes:job.certTypes||'',
    agentName:job.agentName||'',
    agencyName:job.agencyName||'',
    clientPersonId:job.clientPersonId||null,
    clientAgencyId:job.clientAgencyId||null,
    clientName:job.llName||job.clientName||'',
    clientEmail:job.llEmail||job.clientEmail||'',
    items:[{desc:job.description||job.certTypes||'Work',qty:1,unit:price,vat:true}],
    subtotal:price,
    vatAmount:vat,
    total:price+vat,
    created:now,modified:now
  });
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(r?.[0]){toast('Proforma '+num+' created','success');renderInvList();return r[0];}
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Create disposable invoice (quick, minimal details, may be deleted)
export async function createDisposableInv(clientName, amount, desc){
  const now=Date.now();
  const num=await nextInvNum(false);
  const vr=getVatRate();
  const price=Number(amount)||0;
  const vatAmt=price*vr/100;
  const body={
    type:'invoice',status:'Draft',number:num,
    date:TODAY(),dueDate:TODAY(),
    clientName:clientName||'TBC',billToName:clientName||'TBC',
    description:desc||'Disposable invoice',
    items:[{desc:desc||'Item',qty:1,unit:price,vat:vr>0}],
    // DO NOT send subtotal/vat/total — these are NOT database columns
    // They are computed from items[] on the fly
    disposable:true,created:now,modified:now
  };
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(r?.[0]){toast('Disposable invoice '+num+' created','success',3000);renderInvList();return r[0];}
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Open standalone Proforma modal
export function openStandaloneProformaModal(){
  document.getElementById('pf-client').value='';
  document.getElementById('pf-desc').value='';
  document.getElementById('pf-amount').value='';
  document.getElementById('pf-due').value=TODAY();
  document.getElementById('pfx-notes').value='';
  openModal('mo-proforma');
}
// Save standalone Proforma from modal
export async function saveStandaloneProforma(){
  const client=document.getElementById('pf-client').value.trim();
  const desc=document.getElementById('pf-desc').value.trim();
  const amount=parseFloat(document.getElementById('pf-amount').value)||0;
  const notes=document.getElementById('pfx-notes').value.trim();
  if(!client){toast('Enter client name','warn');return;}
  if(amount<=0){toast('Enter a valid amount','warn');return;}
  closeModal('mo-proforma');
  await createStandaloneProforma(client,desc,amount,notes);
}
// Open Disposable Invoice modal
export function openDisposableModal(){
  document.getElementById('dp-client').value='';
  document.getElementById('dp-desc').value='';
  document.getElementById('dp-amount').value='';
  document.getElementById('dp-due').value=TODAY();
  openModal('mo-disposable');
}
// Save Disposable Invoice from modal
export async function saveDisposableInvoice(){
  const client=document.getElementById('dp-client').value.trim();
  const desc=document.getElementById('dp-desc').value.trim();
  const amount=parseFloat(document.getElementById('dp-amount').value)||0;
  if(!client){toast('Enter client name','warn');return;}
  if(amount<=0){toast('Enter a valid amount','warn');return;}
  closeModal('mo-disposable');
  await createDisposableInv(client,amount,desc);
}

// Create standalone proforma (no job) — creates PR job after save
export async function createStandaloneProforma(clientName,desc,price,notes){
  const now=Date.now();
  const num=await nextProformaNum();
  const body={
    type:'proforma',status:'Draft',number:num,
    date:TODAY(),dueDate:TODAY(),
    billToName:clientName||'',clientName:clientName||'',
    notes:notes||'',
    items:[{desc:desc||'Work',qty:1,unit:Number(price)||0,vat:true}],
    created:now,modified:now
  };
  try{
    const r=await _sb('invoices',{method:'POST',body});
    if(!r?.[0]){toast('Failed to create proforma','error');return;}
    const inv=r[0];
    // Auto-create a job linked to this proforma. nextJobNum() only ever
    // special-cases the literal 'CR' — any other argument, including the
    // 'PR' this used to pass, falls straight through to the regular
    // JOB-#### branch, which ignores the prefix argument entirely. So this
    // has only ever produced an ordinary job number from the same shared
    // sequence as every other job, never a distinct PR- series; passing
    // 'PR' implied one exists when it doesn't, so it's dropped rather than
    // left as a misleading no-op argument.
    const jobNum=await nextJobNum();
    const jobBody={
      jobNum,status:'Pending',priority:'Normal',
      description:desc||'Work from proforma',
      address:'TBC',price:Number(price)||0,
      date:TODAY(),certTypes:'Proforma',modified:now,created:now
    };
    const jr=await _sb('jobs',{method:'POST',body:jobBody});
    if(jr?.[0]){
      // Link the proforma to the job
      await _sb('invoices?id=eq.'+inv.id,{method:'PATCH',body:{jobId:jr[0].id,jobNum,modified:now}});
      toast('Proforma '+num+' created + Job '+jobNum+' added','success');
    }
    renderInvList();return inv;
  }catch(e){toast('Failed: '+e.message,'error');}
}

// Convert proforma to real invoice
export async function convertProformaToInvoice(proformaId){
  const inv=await dGet('invoices',proformaId);
  if(!inv){toast('Proforma not found','error');return;}
  if(inv.type!=='proforma'){toast('Not a proforma invoice','error');return;}
  // Matches _autoInvoiceInner()'s series check (§1.4) — either field routes
  // to AGN-. Used to check agentName only, so a job referred purely through
  // an agency (agencyName, no separate agentName) landed on INV- if it went
  // through a proforma first, but AGN- if auto-invoiced directly — same job,
  // different series depending on path. createProforma() now also copies
  // agencyName onto the proforma so this check has something to see.
  const isAgency=!!(inv.agentName||inv.agencyName);
  const realNum=await nextInvNum(isAgency);
  const now=Date.now();
  try{
    await _sb('invoices?id=eq.'+proformaId,{method:'PATCH',body:{type:'invoice',number:realNum,status:'Draft',proformaConverted:true,convertedAt:now,modified:now}});
    toast('Converted to '+realNum,'success');
    // Log in audit
    await _sb('invoice_audit',{method:'POST',body:{invoiceId:proformaId,action:'converted',from:'proforma',to:realNum,user:getAppUser()?.name||'System',timestamp:now}});
    viewInv(proformaId);
    renderInvList();
  }catch(e){toast('Conversion failed: '+e.message,'error');}
}

// Print proforma
export function printProforma(id){
  window.print();
}
