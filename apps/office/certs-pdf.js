// Certificate PDF generation, upload, and client-email delivery — builds a
// PAT-style PDF from a cert's appliance log (watermarked/redacted until the
// linked invoice is paid), handles manual PDF upload/removal, and emails the
// finished document (or a "payment required" notice) to the client. Extracted
// from certs.js verbatim (Phase 2 of the follow-up modularization pass — see
// the plan file for scope), with one fix applied: the two call sites that
// read the module-private `_certTab` variable directly now go through the
// already-exported `getCertTab()` accessor instead, since that variable lives
// in certs-list.js and was never actually reachable from here.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { SB_URL, SB_KEY } from '@core';
import { renderPatCertificatePDF } from '@ui';
import { daysDiff, localDateStr } from '@business';
import {
  S, dAll, dGet, dPut, TODAY, toast, confirm2, logActivity, closeModal, openModal,
  _getJWT, _sb, saveCertExpiry, skipCertExpiry, setPendCertJob, _sendEmail,
  _certReadyEmailHtml, _blobToBase64, resolveCompanyProfile, signedUrl, _certLockedEmailHtml,
} from './main.js';
import { _certFilename, sbStorage } from './certs-core.js';
import { filterCerts, getCertTab, renderCertTable } from './certs-list.js';
import { renderCertDash } from './certs-stats-dashboard.js';
import { _selCertTypes } from './certs-form.js';
import { _jobPortalLink } from './client-portal-admin.js';

// Long-lived: signed links emailed to a client might be opened years from
// now for a compliance record — a short in-app preview expiry would break it.
const _LONG_SIGNED_URL_SECONDS = 10*365*24*60*60;

export function filterMissingExpiry(){filterCerts('no-expiry');}

export async function addExpiryToExistingCert(id){
  const c=await dGet('certs',id);
  if(!c)return;
  const ctDef=(S.certTypes||[]).find(ct=>ct.name===c.type)||{validity:12};
  const defExp=new Date();defExp.setMonth(defExp.getMonth()+(ctDef.validity||12));
  // Use the cert expiry modal in single-cert mode
  window._editCertId=id;
  window._currentCertType={name:c.type,color:ctDef.color||'var(--acc)',prefix:ctDef.prefix||''};
  setPendCertJob({address:c.address,referrer:c.landlord||''});
  document.getElementById('ce-type-name').textContent=c.type;
  document.getElementById('ce-address').textContent=c.address;
  document.getElementById('ce-remaining').textContent='Adding expiry date to existing certificate';
  document.getElementById('ce-expiry').value=localDateStr(defExp);
  document.getElementById('ce-certnum').value=c.certNum||'';
  document.getElementById('ce-issue').value=c.issueDate||TODAY();
  document.getElementById('ce-color-dot').style.background=ctDef.color||'var(--acc)';
  const _moCE=document.getElementById('mo-cert-expiry');
  const _saveBtn=_moCE.querySelector('.btn.btn-acc');
  const _skipBtn=_moCE.querySelector('.btn.btn-ghost');
  const _restoreDefaults=()=>{
    // Undo both overrides below so this single-cert-edit mode can never leak
    // into the separate (currently unused) multi-cert queue flow, which
    // relies on these same two buttons pointing at saveCertExpiry/skipCertExpiry.
    _saveBtn.onclick=saveCertExpiry;
    _skipBtn.onclick=skipCertExpiry;
    window._editCertId=null;
    setPendCertJob(null);
  };
  _saveBtn.onclick=async function(){
    const expiry=document.getElementById('ce-expiry').value;
    const certNum=document.getElementById('ce-certnum').value;
    const issue=document.getElementById('ce-issue').value;
    c.expiryDate=expiry;c.certNum=certNum||c.certNum;c.issueDate=issue;c.noExpiry=!expiry;
    await dPut('certs',c);
    closeModal('mo-cert-expiry');
    if(getCertTab()==='list')renderCertTable();else if(getCertTab()==='dash')renderCertDash();
    toast('Expiry date saved','success');
    _restoreDefaults();
  };
  // BUG FIX: this button previously still ran the default skipCertExpiry(),
  // which calls createCertEntry() using the placeholder {address,referrer}
  // object above (no real job id). createCertEntry()'s duplicate guard
  // compares against that missing id, never matches the certificate we're
  // actually editing, and silently creates a brand-new duplicate certificate
  // with no expiry date every time "Skip" was clicked here. In this
  // edit-an-existing-certificate mode there is nothing to skip-and-create —
  // the certificate already exists — so this just closes the modal.
  _skipBtn.onclick=function(){
    closeModal('mo-cert-expiry');
    _restoreDefaults();
  };
  openModal('mo-cert-expiry');
}

// ── Certificate PDF upload/remove/status — lets office staff attach the
// actual signed compliance document so the client can download it from their
// portal. Upload requires a real, already-saved certificate id (Storage
// writes need something stable to attach to), so this is only available when
// editing an existing certificate — a brand-new one shows a short message
// instead until it's been saved once.
// Whether the certificate currently open in the form is a type with an
// appliance log (PAT-style) — the only kind generateCertPdf() can build a
// PDF for. Reads the same module state toggleApplianceSection() uses, so
// it stays in sync automatically as the user changes the type chip.
function _currentCertHasAppliances(){
  const only = _selCertTypes.size===1 ? [..._selCertTypes][0] : null;
  const ct = only ? (S.certTypes||[]).find(c=>c.name===only) : null;
  return !!ct?.hasAppliances;
}

// `path` is a storage path (certs.pdf_path), not a URL — the bucket is
// private, so the actual viewing URL is resolved fresh by previewCertPdf()
// at click time instead of being baked into this markup.
export function renderCertPdfSection(certId,path){
  const wraps=['cf2-pdf-wrap'].map(id=>document.getElementById(id)).filter(Boolean);
  if(!wraps.length) return;
  if(!certId){
    wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px">Save the certificate first, then reopen it to attach a PDF.</span>`);
    return;
  }
  // Generating is an alternative to uploading, never a replacement for it —
  // the manual Upload/Replace button stays visible either way, so a cert
  // that can't be auto-generated for some reason always still has a path.
  const genBtn=_currentCertHasAppliances()?`<button type="button" class="btn btn-acc btn-xs" style="margin-left:6px" onclick="generateCertPdf()">⚡ ${path?'Regenerate':'Generate'} PDF</button>`:'';
  if(path){
    wraps.forEach(wrap=>wrap.innerHTML=`<button type="button" class="btn btn-ghost btn-sm" onclick="previewCertPdf('${path}')">📄 View Current PDF</button>
      <button class="btn btn-red btn-xs" onclick="removeCertPdf()" style="margin-left:6px">Remove</button>
      <label class="btn btn-ghost btn-xs" style="margin-left:6px;cursor:pointer">Replace<input type="file" accept="application/pdf" style="display:none" onchange="uploadCertPdf(this)"></label>${genBtn}
      <button type="button" class="btn btn-ghost btn-xs" style="margin-left:6px" onclick="sendCertToClient()">✉ Send to Client</button>`);
  }else{
    wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px;margin-right:8px">No document uploaded yet</span>
      <label class="btn btn-acc btn-sm" style="cursor:pointer">⬆ Upload PDF<input type="file" accept="application/pdf" style="display:none" onchange="uploadCertPdf(this)"></label>${genBtn}`);
  }
}

// True once every invoice linked to this job is Paid — the same "before
// the invoice is paid" test the watermark itself gates on (see
// packages/ui/pat-template.js). No job link at all (a manually-added
// cert, never tied to a job/invoice) counts as paid: there's no invoice
// to gate on, so watermarking one would just permanently withhold it.
// A job link with no invoice raised yet, or an invoice not yet Paid,
// counts as unpaid.
async function _isJobPaid(jobId){
  if(!jobId) return true;
  const invs=await dAll('invoices');
  const linked=invs.filter(i=>i.jobId===jobId||i.linkedJobId===jobId);
  if(!linked.length) return false;
  return linked.every(i=>i.status==='Paid');
}

// The build+store half of PDF generation, shared by the manual "Generate
// PDF" button below and regenerateCertsForPaidJob() (called automatically
// once the linked invoice is paid) — one place that builds via
// renderPatCertificatePDF and stores through the same path/PATCH a
// manual "Upload PDF" does, so the cert list, Client Portal, and expiry
// reminders can't tell generated and uploaded apart afterwards.
async function _buildAndStoreCertPdf(cert,paid){
  const profile=resolveCompanyProfile(cert.type);
  // Job-linked certs (auto-created on job completion) pull the engineer
  // from the job; a manually-added cert has no job to pull from, so
  // falls back to whatever was typed into the form's own Engineer field
  // (cert.engineer) — previously there was no fallback at all, leaving
  // the PDF's Engineer box blank for every manually-added PAT cert.
  let engineerName=cert.engineer||'';
  if(cert.jobId){ const job=await dGet('jobs',cert.jobId); engineerName=job?.engineer||engineerName; }
  const doc=await renderPatCertificatePDF(window.jspdf.jsPDF,window.html2canvas,{cert,profile,engineerName,paid});
  const blob=doc.output('blob');
  const path=`certs/${cert.id}/${_certFilename(cert)}`;
  await sbStorage(path,blob);
  // pdf_url is no longer written — the bucket is private, so a stored
  // public-style URL wouldn't work as a direct link anyway. pdf_path is
  // the one source of truth now; every viewer resolves a fresh signed
  // URL from it on demand (previewCertPdf, _maybeEmailCertReady, Portal's
  // portal-sign-url Edge Function).
  await _sb(`certs?id=eq.${encodeURIComponent(cert.id)}`,{method:'PATCH',body:{pdf_path:path},prefer:'return=minimal'});
  return path;
}

// Generates a PAT-style certificate PDF from the cert's own appliance log
// (see packages/ui/pat-template.js — ported from the standalone PAT-TEST
// app). Watermarked and redacted automatically if the linked invoice
// isn't paid yet — see _isJobPaid/_buildAndStoreCertPdf above.
export async function generateCertPdf(){
  const certId=window._editCertModalId;
  if(!certId){ toast('Save the certificate first, then generate the PDF','warn'); return; }
  if(!window.jspdf||!window.html2canvas){ toast('PDF library not loaded — check your internet and try again','error'); return; }
  const cert=await dGet('certs',certId);
  if(!cert){ toast('Certificate not found','error'); return; }
  if(!(cert.appliances||[]).length){ toast('Add at least one appliance first','warn'); return; }
  const wraps=['cf2-pdf-wrap'].map(id=>document.getElementById(id)).filter(Boolean);
  wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px">Generating PDF…</span>`);
  try{
    const paid=await _isJobPaid(cert.jobId);
    const path=await _buildAndStoreCertPdf(cert,paid);
    renderCertPdfSection(certId,path);
    toast(paid?'✅ Certificate PDF generated':'✅ Certificate PDF generated — watermarked, invoice not yet paid','success');
    logActivity(`Certificate PDF generated for ${cert.address||'certificate'}${paid?'':' (watermarked, payment pending)'}`,'cert');
    _maybeEmailCertReady(certId).catch(e=>console.warn('[DeepFlow] Cert-ready email failed',e));
  }catch(e){
    console.error('[DeepFlow] PDF generation failed',e);
    toast('❌ PDF generation failed: '+(e.message||'').slice(0,80),'error');
    renderCertPdfSection(certId,cert.pdfPath||null);
  }
}

// Called from main.js once an invoice flips to Paid (savePayment,
// markInvPaid) — releases every cert linked to that invoice's job that
// has a stored PDF. Two different jobs depending on cert type:
//  - PAT-style (has appliances): regenerated without the watermark/
//    redaction and re-stored at the same pdf_path, so the Client Portal
//    (which never generates its own copy — same rule already enforced
//    on invoices) picks up the clean file automatically.
//  - Uploaded-only (Gas Safety/EICR/EPC etc): the stored file was never
//    touched in the first place — there's no renderer to regenerate it
//    with — so there's nothing to re-store. What changes is that
//    _isJobPaid now resolves true, so re-running the ready-email below
//    sends the real file/link instead of the "pay to unlock" notice.
// Either way, _maybeEmailCertReady still respects S.certAutoEmail like
// every other cert-ready email, rather than bypassing that preference
// for this one flow.
export async function regenerateCertsForPaidJob(jobId){
  if(!jobId) return;
  const allCerts=await dAll('certs');
  const linked=allCerts.filter(c=>c.jobId===jobId&&c.pdfPath);
  for(const cert of linked){
    try{
      if((cert.appliances||[]).length && window.jspdf && window.html2canvas){
        await _buildAndStoreCertPdf(cert,true);
        logActivity(`Certificate PDF re-released without watermark for ${cert.address||'certificate'} (invoice paid)`,'cert');
      }
      _maybeEmailCertReady(cert.id).catch(e=>console.warn('[DeepFlow] Certificate release email failed for',cert.id,e));
    }catch(e){ console.warn('[DeepFlow] Cert regeneration after payment failed for',cert.id,e); }
  }
}

// Takes a storage PATH (not a URL) — the bucket is private, so every
// preview needs a fresh signed URL, resolved just-in-time rather than
// baked in at render time.
export async function previewCertPdf(path){
  if(!path){ toast('No PDF on file for this certificate','warn'); return; }
  const url=await signedUrl(path);
  if(!url){ toast('Could not load PDF preview','error'); return; }
  document.getElementById('pdf-preview-frame').src=url;
  document.getElementById('pdf-preview-open').href=url;
  document.getElementById('pdf-preview-download').href=url;
  openModal('mo-pdf-preview');
}

export async function uploadCertPdf(inputEl){
  const certId=window._editCertModalId;
  if(!certId){ toast('Save the certificate first, then attach the PDF','warn'); inputEl.value=''; return; }
  const file=inputEl.files[0];
  inputEl.value='';
  if(!file) return;
  const looksLikePdf=(file.type==='application/pdf')||file.name.toLowerCase().endsWith('.pdf');
  if(!looksLikePdf){ toast('Please choose a PDF file','error'); return; }
  if(file.size>25*1024*1024){ toast(`File too large (${(file.size/1024/1024).toFixed(1)}MB) — 25MB max`,'error'); return; }
  const wraps=['cf2-pdf-wrap'].map(id=>document.getElementById(id)).filter(Boolean);
  wraps.forEach(wrap=>wrap.innerHTML=`<span style="color:var(--txt3);font-size:12px">Uploading…</span>`);
  try{
    const c=await dGet('certs',certId);
    const path=`certs/${certId}/${_certFilename(c)}`;
    await sbStorage(path,file);
    await _sb(`certs?id=eq.${encodeURIComponent(certId)}`,{method:'PATCH',body:{pdf_path:path},prefer:'return=minimal'});
    renderCertPdfSection(certId,path);
    toast('✅ Certificate PDF uploaded','success');
    logActivity(`Certificate PDF uploaded for ${document.getElementById('cf2-addr')?.value||'certificate'}`,'cert');
    _maybeEmailCertReady(certId).catch(e=>console.warn('[DeepFlow] Cert-ready email failed',e));
  }catch(e){
    toast('❌ Upload failed: '+(e.message||'').slice(0,80),'error');
    renderCertPdfSection(certId,null);
  }
}

// Emails the client their certificate PDF. Auto-fires the moment the PDF is
// ready unless S.certAutoEmail is turned off in Settings (Certificates tab),
// in which case only an explicit "Send to Client" click (manual:true, see
// sendCertToClient) will trigger it. Prefers the cert's own .email field;
// most certs are created straight from a job though, where that field is
// never filled in, so falls back to the linked job's landlord/agency email.
// Every outcome — sent, no email on file, or a real send failure — is
// logged to the Audit Trail so office staff can see what actually went out.
async function _maybeEmailCertReady(certId, {manual=false}={}){
  if(!manual && S.certAutoEmail===false) return {sent:false,reason:'auto-disabled'};
  const c=await dGet('certs',certId);
  if(!c) return {sent:false,reason:'not-found'};
  if(!c.pdfPath) return {sent:false,reason:'no-pdf'};
  let email=c.email;
  let job=null;
  if(c.jobId) job=await dGet('jobs',c.jobId);
  if(!email) email=job?.landlordEmail||job?.agencyEmail||null;
  if(!email) return {sent:false,reason:'no-email'};

  // Locked applies to every cert type, not just the appliance-based ones
  // _buildAndStoreCertPdf/regenerateCertsForPaidJob can watermark — an
  // uploaded Gas Safety/EICR/EPC scan gets exactly the same "no file at
  // all until paid" treatment here, just without a watermarked preview to
  // fall back to (nothing in this codebase can watermark an arbitrary
  // uploaded PDF — see _isJobPaid above for the shared paid/unpaid test).
  const paid=await _isJobPaid(c.jobId);
  if(!paid){
    const portalUrl=_jobPortalLink(job);
    const result=await _sendEmail({
      to: email,
      subject: `${c.type||'Compliance'} Certificate — payment required — ${c.address||''}`,
      html: _certLockedEmailHtml(c, portalUrl),
    });
    if(result.ok){
      logActivity(`Locked-certificate notice emailed to ${email} for ${c.address||'certificate'} (invoice unpaid)`,'cert');
      return {sent:true};
    }
    logActivity(`Locked-certificate email FAILED for ${c.address||'certificate'} (${email}): ${(result.error||'unknown error').slice(0,120)}`,'cert');
    return {sent:false,reason:'send-failed',error:result.error};
  }

  // Long-lived: this link is going in an email, which might be opened
  // years from now for a compliance record — a short in-app preview
  // expiry would break it.
  const pdfUrl=await signedUrl(c.pdfPath,_LONG_SIGNED_URL_SECONDS);
  if(!pdfUrl) return {sent:false,reason:'sign-failed'};
  // Attach the actual PDF, not just the download link — the link stays in
  // the email body too as a fallback for the rare oversized cert. 15MB is
  // well past any realistic scanned EICR/Gas Safety report; only a genuine
  // outlier would ever hit it.
  let attachments;
  try{
    const blob=await fetch(pdfUrl).then(r=>r.blob());
    if(blob.size>15*1024*1024){
      console.warn('[DeepFlow] Cert PDF too large to attach ('+(blob.size/1024/1024).toFixed(1)+'MB) — sending link only');
    } else {
      attachments=[{filename:_certFilename(c), content:await _blobToBase64(blob)}];
    }
  }catch(e){ console.warn('[DeepFlow] Could not fetch cert PDF to attach, sending link only',e); }
  const result=await _sendEmail({
    to: email,
    subject: `Your ${c.type||'Compliance'} Certificate — ${c.address||''}`,
    html: _certReadyEmailHtml(c, pdfUrl),
    attachments,
  });
  if(result.ok){
    logActivity(`Certificate emailed to ${email} for ${c.address||'certificate'}`,'cert');
    return {sent:true};
  }
  logActivity(`Certificate email FAILED for ${c.address||'certificate'} (${email}): ${(result.error||'unknown error').slice(0,120)}`,'cert');
  return {sent:false,reason:'send-failed',error:result.error};
}

// Manual "Send to Client" button — works regardless of the S.certAutoEmail
// setting, so a manual-mode office can still send on demand, and an
// auto-mode office can resend.
export async function sendCertToClient(){
  const certId=window._editCertModalId;
  if(!certId){ toast('Save the certificate first','warn'); return; }
  const c=await dGet('certs',certId);
  if(!c?.pdfPath){ toast('Generate or upload the certificate PDF first','warn'); return; }
  const result=await _maybeEmailCertReady(certId,{manual:true});
  if(result.sent) toast('✅ Certificate emailed to client','success');
  else if(result.reason==='no-email') toast('No client email on file for this certificate','warn');
  else toast('❌ Send failed: '+(result.error||'unknown error').slice(0,80),'error');
}

export async function removeCertPdf(){
  const certId=window._editCertModalId;
  if(!certId) return;
  confirm2('Remove Certificate PDF','Delete the uploaded PDF for this certificate? The client will no longer be able to download it.',async()=>{
    try{
      const c=await dGet('certs',certId);
      if(c?.pdfPath){
        const jwt=await _getJWT();
        fetch(`${SB_URL}/storage/v1/object/deepflow/${c.pdfPath}`,{method:'DELETE',headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt}}).catch(()=>{});
      }
      await _sb(`certs?id=eq.${encodeURIComponent(certId)}`,{method:'PATCH',body:{pdf_url:null,pdf_path:null},prefer:'return=minimal'});
      renderCertPdfSection(certId,null);
      toast('PDF removed','warn');
    }catch(e){ toast('Could not remove PDF','error'); }
  });
}

export async function waCertReminder(id){
  const c=await dGet('certs',id);
  if(!c)return;
  const d=daysDiff(c.expiryDate);
  const msg=`Hello,\n\nThis is a reminder from *${S.coName||'Us'}* that your *${c.type} Certificate* for the property at *${c.address}* is ${d<0?'expired!':'expiring in '+d+' days.'}\n\nExpiry Date: *${c.expiryDate}*\n\nPlease contact us to arrange a renewal.\n📞 ${S.coPhone||''}\n\nThank you.`;
  document.getElementById('wa-preview-text').textContent=msg;
  document.getElementById('wa-send-to').value='';
  window._waPendingMsg=msg;
  openModal('mo-wa');
}
