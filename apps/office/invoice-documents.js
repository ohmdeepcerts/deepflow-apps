// Invoice documents: transactional email templates/sending (overdue
// reminders, invoice-ready, payment receipts, cert-ready/locked) and PDF
// generation/storage/signed-URL retrieval. Extracted from main.js verbatim
// (Phase 5f-1 of the follow-up modularization pass — see the plan file for
// scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { SB_URL, SB_KEY } from '@core';
import { escHtml, renderInvoicePDF } from '@ui';
import { formatDateUK } from '@business';
import {
  S, TODAY, dAll, dGet, _sb, toast, logActivity, calcInvTotal, getVatRate,
  _getJWT, _blobToBase64, _invalidateCache, _commProvider,
} from './main.js';

// group messages into one thread by matching subject line, so every email
// about the same invoice using this exact string is what keeps them
// together as one conversation instead of three separate threads.
export function _invEmailSubject(inv){
  return `Invoice ${inv.number} — ${S.coName||''}`;
}

// Low-level send — every automatic-email call site (overdue reminders,
// invoice-ready, payment receipts, cert-ready) goes through this so the
// fetch/auth/error-shape logic exists in exactly one place. Routed through
// @comms's communicationProvider (Phase B) — same fetch/auth/error-shape
// behaviour as before, now behind the transport swap point.
export async function _sendEmail({to, cc, subject, html, attachments, replyTo}){
  try{
    return await _commProvider.send({
      channel: 'EMAIL',
      content: {to, cc, subject, html, attachments, replyTo: replyTo===undefined?(S.coEmail||undefined):replyTo},
    });
  }catch(e){ return {ok:false, error:e.message}; }
}

// Shared shell for every transactional email — table-based layout (email
// clients, especially Outlook, don't reliably support flex/grid), same navy
// (#0d1f3c) used across the invoice PDF/masthead so every email reads as
// the same document family instead of a plain-text afterthought. Callers
// supply just the body content between the header and footer.
export function _brandedEmailShell(bodyHtml){
  const addrLine = [S.coAddr, S.coPhone, S.coEmail, S.coWeb].filter(Boolean).map(escHtml).join(' &nbsp;·&nbsp; ');
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f2f4f8;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
    <tr><td style="background:linear-gradient(135deg,#0d1f3c,#1e3a5f,#0a1628);padding:26px 32px">
      <div style="color:#fff;font-size:19px;font-weight:800;letter-spacing:.2px">${escHtml(S.coName||'')}</div>
      ${S.coAddr?`<div style="color:#9fb4d1;font-size:12px;margin-top:3px">${escHtml(S.coAddr)}</div>`:''}
    </td></tr>
    <tr><td style="padding:28px 32px 6px">${bodyHtml}</td></tr>
    <tr><td style="padding:16px 32px;border-top:1px solid #eef1f5;background:#fafbfc">
      <div style="font-size:11px;color:#94a3b8;line-height:1.6">${addrLine}</div>
    </td></tr>
  </table>
</div>`;
}
function _emailBadge(text, bg, fg){
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:700;letter-spacing:.4px;padding:5px 12px;border-radius:20px;text-transform:uppercase">${text}</span>`;
}
// A two-column label/value card (invoice no. / amount, etc) — the visual
// anchor of every email below the badge+message.
function _emailInfoCard(leftLabel, leftValue, rightLabel, rightValue, rightColor, footNote){
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e9f0;border-radius:8px;margin-top:16px">
  <tr>
    <td style="padding:16px 18px">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${escHtml(leftLabel)}</div>
      <div style="font-size:16px;font-weight:700;color:#0d1f3c;margin-top:3px">${escHtml(leftValue)}</div>
    </td>
    <td style="padding:16px 18px;text-align:right">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${escHtml(rightLabel)}</div>
      <div style="font-size:21px;font-weight:800;color:${rightColor};margin-top:2px">${escHtml(rightValue)}</div>
    </td>
  </tr>
  ${footNote?`<tr><td colspan="2" style="padding:0 18px 15px;font-size:12px;color:#64748b">${footNote}</td></tr>`:''}
</table>`;
}

function _overdueEmailHtml(inv, t, daysOver, bodyText){
  return _brandedEmailShell(`
    ${_emailBadge(`⚠ ${daysOver} day${daysOver!==1?'s':''} overdue`,'#fef2f2','#b91c1c')}
    <div style="font-size:15px;color:#1e293b;margin-top:16px;line-height:1.55">${escHtml(bodyText)}</div>
    ${_emailInfoCard('Invoice', inv.number||'', 'Amount Due', '£'+t.grand.toFixed(2), '#b91c1c',
      `Due ${escHtml(formatDateUK(inv.dueDate)||inv.dueDate||'')} &nbsp;·&nbsp; please quote <b>${escHtml(inv.number||'')}</b> as your payment reference`)}
    <div style="font-size:11px;color:#94a3b8;margin-top:12px">Full invoice attached as PDF.</div>
  `);
}

// Sent the moment an invoice is issued (Invoices → Send button) — replaces
// the old mailto: draft that made the office download the PDF and attach
// it by hand. The PDF is attached server-side here instead.
export function _invoiceReadyEmailHtml(inv, t){
  return _brandedEmailShell(`
    ${_emailBadge('🧾 New Invoice','#eff6ff','#1d4ed8')}
    <div style="font-size:15px;color:#1e293b;margin-top:16px;line-height:1.55">Dear ${escHtml(inv.clientName||'Client')},<br><br>Please find your invoice attached.</div>
    ${_emailInfoCard('Invoice', inv.number||'', 'Amount Due', '£'+t.grand.toFixed(2), '#0d1f3c',
      `Due ${escHtml(formatDateUK(inv.dueDate)||inv.dueDate||'')} &nbsp;·&nbsp; please quote <b>${escHtml(inv.number||'')}</b> as your payment reference`)}
    ${S.payTerms?`<div style="font-size:12px;color:#64748b;margin-top:14px">${escHtml(S.payTerms)}</div>`:''}
  `);
}

// Sent the moment an invoice is marked (or becomes) fully Paid.
export function _paymentReceiptEmailHtml(inv, amount){
  return _brandedEmailShell(`
    ${_emailBadge('✅ Payment Received','#f0fdf4','#15803d')}
    <div style="font-size:15px;color:#1e293b;margin-top:16px;line-height:1.55">Dear ${escHtml(inv.clientName||'Client')},<br><br>Thank you — we've received your payment.</div>
    ${_emailInfoCard('Invoice', inv.number||'', 'Amount Paid', '£'+amount.toFixed(2), '#15803d',
      `Paid ${escHtml(formatDateUK(TODAY()))}`)}
  `);
}

// Sent the moment a certificate PDF is uploaded (i.e. the cert is actually
// ready) — links to the stored PDF rather than attaching it, since these
// are scanned compliance documents (EICR/Gas Safety reports etc) that can
// run several MB, well past what's sensible to inline as a base64 email
// attachment.
export function _certReadyEmailHtml(cert, pdfUrl){
  return _brandedEmailShell(`
    ${_emailBadge('📜 Certificate Ready','#f0fdf4','#15803d')}
    <div style="font-size:15px;color:#1e293b;margin-top:16px;line-height:1.55">Dear ${escHtml(cert.landlord||'Client')},<br><br>Your ${escHtml(cert.type||'compliance')} certificate for <b>${escHtml(cert.address||'')}</b> is ready.</div>
    <div style="text-align:center;margin-top:20px">
      <a href="${pdfUrl}" style="display:inline-block;background:#0d1f3c;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">📥 Download Certificate</a>
    </div>
    ${cert.expiryDate?`<div style="font-size:12px;color:#64748b;margin-top:16px;text-align:center">Valid until ${escHtml(formatDateUK(cert.expiryDate))}</div>`:''}
  `);
}

// Sent instead of _certReadyEmailHtml when the linked invoice isn't paid
// yet — no PDF link/attachment at all (nothing to download until paid,
// same rule the Client Portal now enforces on its own cert cards), just
// a CTA into the Portal where the same locked state + Pay Now button
// live. portalUrl is null for jobs with no clean landlord/agency link to
// build one from (see _jobPortalLink) — falls back to a plain message.
export function _certLockedEmailHtml(cert, portalUrl){
  return _brandedEmailShell(`
    ${_emailBadge('🔒 Certificate Ready — Payment Required','#fff7ed','#c2410c')}
    <div style="font-size:15px;color:#1e293b;margin-top:16px;line-height:1.55">Dear ${escHtml(cert.landlord||'Client')},<br><br>Your ${escHtml(cert.type||'compliance')} certificate for <b>${escHtml(cert.address||'')}</b> is ready, but held until the linked invoice is paid.</div>
    ${portalUrl?`<div style="text-align:center;margin-top:20px">
      <a href="${portalUrl}" style="display:inline-block;background:#c2410c;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none">🔓 Pay Invoice to Unlock</a>
    </div>`:`<div style="font-size:13px;color:#64748b;margin-top:16px">Please contact us to settle the outstanding invoice and receive your certificate.</div>`}
  `);
}

// Same overdue-invoice list as sendAllOverdueWA, sent via email instead —
// reuses S.waOverdueTpl's placeholders in plain text, wrapped in the branded
// HTML above, with the real invoice PDF attached (same doc as the
// download/portal copy — see _buildInvoicePDFDoc). Requires the configured
// email provider's secrets to be set as Edge Function secrets; until then
// the function returns a clear "not configured" error per invoice rather
// than failing silently.
export async function sendAllOverdueEmail(){
  const invs = await dAll('invoices');
  const today = TODAY();
  const overdue = invs.filter(i=>i.status==='Awaiting Payment' && i.dueDate && i.dueDate < today && i.clientEmail);
  if(!overdue.length){ toast('No overdue invoices with a client email on file','info'); return; }
  const confirmed = confirm(`Email overdue reminders to ${overdue.length} client${overdue.length!==1?'s':''}?`);
  if(!confirmed) return;
  const canAttachPdf = !!(window.jspdf && window.html2canvas);
  let sent = 0, failed = 0, firstError = null;
  for(const inv of overdue){
    const t = calcInvTotal(inv);
    const daysOver = Math.ceil((new Date(today)-new Date(inv.dueDate))/86400000);
    const bodyText = (S.waOverdueTpl||'Invoice {invoice_num} for £{amount} is {days_overdue} days overdue. Please arrange payment.')
      .replace('{invoice_num}',inv.number)
      .replace('{amount}',t.grand.toFixed(2))
      .replace('{days_overdue}',daysOver)
      .replace('{client_name}',inv.clientName||'')
      .replace('{due_date}',inv.dueDate||'')
      .replace('{company_name}',S.coName||'');
    let attachments;
    if(canAttachPdf){
      try{
        const doc = await _buildInvoicePDFDoc(inv);
        const b64 = await _blobToBase64(doc.output('blob'));
        attachments = [{filename:(inv.number||'invoice')+'.pdf', content:b64}];
      }catch(e){ console.warn('[DeepFlow] Could not attach PDF to overdue email for',inv.number,e); }
    }
    const r = await _sendEmail({
      to: inv.clientEmail,
      subject: _invEmailSubject(inv),
      html: _overdueEmailHtml(inv, t, daysOver, bodyText),
      attachments,
    });
    if(r.ok) sent++; else { failed++; if(!firstError) firstError=r.error; }
  }
  if(sent) toast(`📧 Sent ${sent} email reminder${sent!==1?'s':''}${failed?`, ${failed} failed`:''}`, failed?'warn':'success');
  else toast(firstError||'Could not send emails — check Resend setup','error');
}

// Builds the jsPDF doc for one invoice — the single source of truth for
// what an invoice PDF looks like, shared by the manual download button,
// the automatic background-generate-and-store path, and bulk download.
// Previously this whole thing lived inline inside downloadInvPDFById(),
// which meant "regenerate and store a copy in Supabase" had nowhere to
// hook in without duplicating ~250 lines of drawing code.
async function _buildInvoicePDFDoc(inv){
  const t=calcInvTotal(inv);
  const vr=getVatRate();
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',floatPrecision:2});

  // Same totalPaid lookup savePayment() already does — lets the PDF show
  // the "Partial" stamp instead of "Unpaid" when some but not all of the
  // invoice has been paid. Everything else is real PDF text and vector
  // shapes via jsPDF/jsPDF-AutoTable, no rendered image anywhere on the
  // page. See packages/ui/pdf-vector.js.
  const allPmts=await dAll('payments');
  const amountPaid=allPmts.filter(p=>p.invId===inv.id).reduce((s,p)=>s+(p.amount||0),0);
  await renderInvoicePDF(doc,window.html2canvas,{inv,S,totals:t,vatRate:vr,amountPaid});

  return doc;
}

export async function downloadInvPDFById(id){
  const inv=await dGet('invoices',id);
  if(!inv){toast('Invoice not found','error');return;}
  if(!window.jspdf||!window.html2canvas){toast('PDF library not loaded — check your internet and try again','error');return;}
  const doc=await _buildInvoicePDFDoc(inv);
  doc.save((inv.number||'invoice')+'.pdf');
  await logActivity('PDF downloaded: '+inv.number,'invoice');
  toast('✅ PDF downloaded — '+inv.number,'success');
  // Freshen the stored copy in the background too — a manual download is
  // as good a moment as any to know the stored PDF matches what's on
  // screen, and it costs nothing extra since the doc is already built.
  _storeInvoicePDF(inv,doc).catch(e=>console.warn('[DeepFlow] Background PDF store failed for',inv.number,e));
}

// Local Storage helper — same pattern as certs-core.js's sbStorage(),
// duplicated rather than imported since importing across these sibling
// modules isn't worth the coupling for one function.
async function _invPdfSbStorage(path,file){
  const jwt=await _getJWT();
  const res=await fetch(`${SB_URL}/storage/v1/object/deepflow/${path}`,{
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':'application/pdf','x-upsert':'true'},
    body:file
  });
  if(!res.ok) throw new Error('Upload failed: '+(await res.text()).slice(0,200));
  return `${SB_URL}/storage/v1/object/public/deepflow/${path}`;
}

// The `deepflow` bucket is private (see migration
// 20260808_make_deepflow_bucket_private) — no stored URL works as a direct
// link anymore, only a fresh short-lived signed one. Office always has a
// real Supabase Auth session, so this just calls Storage's own sign
// endpoint with the current JWT; the existing `deepflow_staff_select` RLS
// policy (is_office() OR is_engineer() OR is_valid_engineer_token()) is
// what actually authorizes it. `expiresIn` defaults to 1 hour for in-app
// viewing; callers that embed the link somewhere long-lived (an emailed
// certificate) pass a much larger value — see _maybeEmailCertReady.
export async function signedUrl(path,expiresIn=3600){
  if(!path) return null;
  try{
    const jwt=await _getJWT();
    const res=await fetch(`${SB_URL}/storage/v1/object/sign/deepflow/${path}`,{
      method:'POST',
      headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':'application/json'},
      body:JSON.stringify({expiresIn})
    });
    if(!res.ok) return null;
    const {signedURL}=await res.json();
    return signedURL?`${SB_URL}/storage/v1${signedURL}`:null;
  }catch(e){ console.warn('[DeepFlow] signedUrl failed for',path,e); return null; }
}

// Uploads an already-built PDF doc to Storage and records the URL on the
// invoice — the "store" half of automatic generation. Callers that already
// have a built doc (download, bulk export) pass it in to skip rebuilding.
async function _storeInvoicePDF(inv,doc){
  const path=`invoices/${inv.id}/${(inv.number||'invoice').replace(/[^a-z0-9-]/gi,'_')}.pdf`;
  const blob=doc.output('blob');
  await _invPdfSbStorage(path,blob);
  // pdf_url is no longer written — the bucket is private, so a stored
  // public-style URL wouldn't work as a direct link anyway. pdf_path is
  // the one source of truth; every viewer (statements.js bulk download,
  // Portal's portal-sign-url) resolves a fresh signed URL from it.
  await _sb(`invoices?id=eq.${encodeURIComponent(inv.id)}`,{method:'PATCH',body:{pdf_path:path},prefer:'return=minimal'});
  _invalidateCache('invoices');
  return path;
}

// Automatic generation — call this after any change that affects what the
// invoice PDF looks like (items, bill-to, status, dates). Builds fresh and
// stores it; the Client Portal and bulk download then just fetch this one
// file instead of each re-rendering their own copy from raw data.
export async function generateAndStoreInvoicePDF(id){
  if(!window.jspdf||!window.html2canvas) return null; // libraries not loaded yet — will retry next edit/download
  try{
    const inv=await dGet('invoices',id);
    if(!inv) return null;
    const doc=await _buildInvoicePDFDoc(inv);
    return await _storeInvoicePDF(inv,doc);
  }catch(e){ console.warn('[DeepFlow] Auto PDF generation failed for invoice',id,e); return null; }
}
