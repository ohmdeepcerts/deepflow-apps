// Engineer Planner — the job email composer modal, opened from a job row's
// envelope button or the job detail modal's Client tab. Extracted from
// planner.js verbatim (Phase 4 of the follow-up modularization pass) — no
// behaviour changes.
//
// This module and main.js (and the other planner-*.js files) import from
// each other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time. The click listener below is registered on
// `document` at module load, exactly like the other planner-*.js files —
// it works regardless of which sibling module rendered the DOM it delegates
// from (board.js's job rows, or planner-detail.js's Client tab), since all
// modules share the same document.

import { escHtml } from '@ui';
import { dAll, toast, _sendEmail, _brandedEmailShell } from './main.js';
import { el, resolveContact } from './planner-core.js';
import { closeJobDetails } from './planner-detail.js';

// ════════════════════════════════════════════════════════════════
//  EMAIL COMPOSER — real send-email pipeline (Resend/SendGrid),
//  not a new provider
// ════════════════════════════════════════════════════════════════

let emailJobId = null;
let emailAttachments = [];

// The composer's file-input change listener lives in planner-board.js
// (initPlanner wires every planner-*.js sibling's listeners in one place),
// but emailAttachments is this file's state — same state-ownership rule
// applied throughout this modularization pass. A direct cross-file
// reassignment (`emailAttachments = ...`) wouldn't touch this module's own
// binding at all, so board.js goes through this setter instead.
export function setEmailAttachments(files){
  emailAttachments = files;
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(',')[1]||'');
    r.onerror=reject;
    r.readAsDataURL(file);
  });
}

export async function openEmailComposer(jobId){
  const jobs = await dAll('jobs');
  const job = jobs.find(x=>x.id===jobId);
  if(!job){ toast('Job not found','error'); return; }
  const contact = resolveContact(job);
  emailJobId = jobId;
  emailAttachments = [];
  el('dfpAttachmentList').innerHTML='';
  el('dfpEmailAttachments').value='';
  el('dfpEmailTo').value = contact.email||'';
  el('dfpEmailClientName').textContent = contact.name||'Client';
  el('dfpEmailSubject').value = `${job.jobNum||'Job'} — ${job.address||''}`;
  el('dfpEmailMessage').value = `Hello ${contact.name||''},\n\nRegarding job ${job.jobNum||''} at:\n${job.address||''}\n\n${job.description||''}\n\nKind regards`;
  el('dfpEmailFooterNote').textContent = '';
  el('dfpEmailBackdrop').classList.add('show');
  setTimeout(()=>el('dfpEmailSubject').focus(),40);
}

export function closeEmailComposer(){
  el('dfpEmailBackdrop').classList.remove('show');
  emailJobId=null; emailAttachments=[];
}

export function renderEmailAttachments(){
  el('dfpAttachmentList').innerHTML = emailAttachments.map((f,i)=>`
    <span class="attachment-chip">📎 ${escHtml(f.name)}<button type="button" data-remove-attachment="${i}" title="Remove">×</button></span>
  `).join('');
}

export async function sendComposedEmail(){
  const to = el('dfpEmailTo').value.trim();
  const subject = el('dfpEmailSubject').value.trim();
  const message = el('dfpEmailMessage').value.trim();
  if(!to){ toast('Client email address is required','error'); return; }
  if(!subject){ toast('Enter an email subject','error'); return; }
  if(!message){ toast('Write an email message','error'); return; }

  el('dfpSendEmailBtn').disabled = true;
  el('dfpSendEmailBtn').textContent = 'Sending…';
  try{
    const attachments = await Promise.all(emailAttachments.map(async f=>({
      filename: f.name, content: await fileToBase64(f),
    })));
    const html = _brandedEmailShell(`<p style="white-space:pre-wrap;font-size:14px;color:#1f2937;line-height:1.6">${escHtml(message)}</p>`);
    const result = await _sendEmail({to, subject, html, attachments});
    if(result.ok){
      toast('Email sent','success');
      closeEmailComposer();
    } else {
      toast('Email failed: '+(result.error||'unknown error'),'error');
    }
  } finally {
    el('dfpSendEmailBtn').disabled = false;
    el('dfpSendEmailBtn').textContent = 'Send Email';
  }
}

document.addEventListener('click', e=>{
  const emailBtn = e.target.closest('#dfpGrid .dfp-email-job, .job-detail-body .dfp-email-job');
  if(emailBtn){
    if(e.target.closest('.job-detail-body')) closeJobDetails();
    openEmailComposer(emailBtn.dataset.id);
    return;
  }
  const removeAtt = e.target.closest('[data-remove-attachment]');
  if(removeAtt){ emailAttachments.splice(Number(removeAtt.dataset.removeAttachment),1); renderEmailAttachments(); return; }
});
