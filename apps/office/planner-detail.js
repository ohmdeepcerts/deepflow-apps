// Engineer Planner — the job detail modal (Overview / Activity-Visits /
// Invoices / Client tabs), opened by clicking any job on the Day/Week/Month
// board. Extracted from planner.js verbatim (Phase 4 of the follow-up
// modularization pass) — no behaviour changes.
//
// This module and main.js (and the other planner-*.js files) import from
// each other, same as every other extracted module: safe because every
// cross-module reference is used only inside function bodies, never at
// module-evaluation time. The click/keydown listeners below are registered
// on `document` at module load, exactly like the other planner-*.js files —
// they work regardless of which sibling module rendered the DOM they
// delegate from, since all modules share the same document.

import { escHtml } from '@ui';
import { formatDateUK } from '@business';
import { dAll, _sb, toast, calcInvTotal, signedUrl } from './main.js';
import { el, money, resolveContact } from './planner-core.js';
import { renderActivity } from './planner-activity.js';
// openJobModal isn't an ES export of main.js (only exposed on window for
// inline HTML handlers), so it's called via window here rather than imported.

// ════════════════════════════════════════════════════════════════
//  JOB DETAIL MODAL — Overview / Activity-Visits / Invoices / Client
// ════════════════════════════════════════════════════════════════

let detailJobId = null;

function invoiceStatusLabel(inv){
  if(inv.status==='Paid') return 'Paid';
  if(inv.status==='Awaiting Payment') return 'Unpaid';
  return inv.status||'Draft';
}
function invoiceStatusClass(inv){
  if(inv.status==='Paid') return 'paid';
  if(inv.status==='Awaiting Payment') return 'unpaid';
  return 'partial';
}

export async function openJobDetails(jobId, tab='overview'){
  const jobs = await dAll('jobs');
  const job = jobs.find(x=>x.id===jobId);
  if(!job){ toast('Job not found — try refreshing','error'); return; }
  detailJobId = jobId;

  const [visits, allInvoices, allAttachments] = await Promise.all([
    _sb(`job_visits?jobid=eq.${encodeURIComponent(jobId)}&order=visit_date.asc,created.asc`),
    dAll('invoices'),
    _sb(`attachments?visit_id=not.is.null`),
  ]);
  const invoices = allInvoices.filter(i=>i.jobId===jobId||i.linkedJobId===jobId);
  const contact = resolveContact(job);

  // The `deepflow` bucket is private — every photo needs its own
  // short-lived signed URL to actually render as an image rather than the
  // "▧" placeholder this used to always show regardless of whether a real
  // photo existed. Resolved up front so the template below stays sync.
  const signedByPath = {};
  await Promise.all((allAttachments||[]).map(async p=>{
    if(p.storage_path) signedByPath[p.storage_path] = await signedUrl(p.storage_path, 3600);
  }));

  el('dfpDetailTitle').textContent = job.jobNum||'Job';
  el('dfpDetailSubtitle').textContent = job.address||'';
  el('dfpDetailSummary').innerHTML = `
    <span class="summary-chip"><b>${visits.length}</b> visit${visits.length===1?'':'s'}</span>
    <span class="summary-chip"><b>${invoices.length}</b> invoice${invoices.length===1?'':'s'}</span>
    <span class="summary-chip"><b>${money(job.price)}</b> job value</span>
  `;
  el('dfpDetailAddVisit').onclick = ()=>{ closeJobDetails(); window.openJobModal(jobId); };

  // Overview
  el('dfpDetailOverview').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card">
        <div class="detail-card-label">Job number</div>
        <div class="detail-card-value">${escHtml(job.jobNum||'')}</div>
        <div class="detail-card-sub">${escHtml(job.status||'Pending')}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Visits logged</div>
        <div class="detail-card-value">${visits.length}</div>
        <div class="detail-card-sub">${visits.map((v,i)=>`Visit ${i+1} · ${formatDateUK(v.visit_date)||v.visit_date}`).join('<br>')||'None yet'}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Job date</div>
        <div class="detail-card-value">${formatDateUK(job.date)||job.date||'—'}</div>
        <div class="detail-card-sub">${escHtml(job.timeSlot||'—')}</div>
      </div>
      <div class="detail-card">
        <div class="detail-card-label">Engineer</div>
        <div class="detail-card-value">${escHtml(job.engineer||'Unassigned')}</div>
        <div class="detail-card-sub">${invoices.length} invoice${invoices.length===1?'':'s'} issued</div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Property</div>
        <div class="detail-card-value">${escHtml(job.address||'')}</div>
        <div class="detail-card-sub">Access: ${escHtml(job.access||'—')}</div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Client</div>
        <div class="detail-card-value">${escHtml(contact.name||'—')}</div>
        <div class="detail-card-sub">${escHtml(contact.phone||'—')} · ${escHtml(contact.email||'—')}</div>
      </div>
      <div class="detail-card span4">
        <div class="detail-card-label">Description</div>
        <div class="detail-card-value">${escHtml(job.description||'—')}</div>
      </div>
    </div>`;

  // Activity / Visits — real comments (job_visits.comments) and real
  // photos (attachments.visit_id) rather than the fabricated feed a demo
  // would show; both render an honest empty state until populated.
  renderActivity(jobId, visits, allAttachments, signedByPath);

  // Invoices — real invoices, real totals (no flattened job fields)
  el('dfpDetailInvoices').innerHTML = invoices.length ? `<table class="project-invoice-table">
    <thead><tr><th>Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th>Outstanding</th></tr></thead>
    <tbody>
      ${invoices.map(inv=>{
        const t=calcInvTotal(inv);
        const outstanding = inv.status==='Paid' ? 0 : t.grand;
        return `<tr>
          <td><b>${escHtml(inv.number||'')}</b></td>
          <td>${formatDateUK(inv.date)||inv.date||'—'}</td>
          <td><b>${money(t.grand)}</b></td>
          <td><span class="invoice-status ${invoiceStatusClass(inv)}">${escHtml(invoiceStatusLabel(inv))}</span></td>
          <td>${money(outstanding)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>` : `<div class="detail-empty">No invoices have been issued for ${escHtml(job.jobNum||'this job')} yet.</div>`;

  // Client
  const phoneDigits=(contact.phone||'').replace(/[^\d+]/g,'');
  const callLink = phoneDigits ? `tel:${phoneDigits}` : '#';
  const waLink = phoneDigits ? `https://wa.me/${phoneDigits.replace('+','')}?text=${encodeURIComponent(`Hello, regarding job ${job.jobNum||''} at ${job.address||''}.`)}` : '#';
  el('dfpDetailClient').innerHTML = `
    <div class="detail-grid">
      <div class="detail-card span2">
        <div class="detail-card-label">Client / Account</div>
        <div class="client-big-line">${escHtml(contact.name||'—')}</div>
        <div class="client-contact-line">☎ ${escHtml(contact.phone||'—')}</div>
        <div class="client-contact-line">✉ ${escHtml(contact.email||'—')}</div>
        <div class="client-detail-actions">
          ${contact.phone?`<button class="btn" data-open="${callLink}">Call</button><button class="btn" data-open="${waLink}">WhatsApp</button>`:''}
          ${contact.email?`<button class="btn dfp-email-job" data-id="${job.id}">Email</button>`:''}
        </div>
      </div>
      <div class="detail-card span2">
        <div class="detail-card-label">Property</div>
        <div class="detail-card-value">${escHtml(job.address||'')}</div>
        <div class="detail-card-sub">Access instructions: ${escHtml(job.access||'—')}</div>
      </div>
    </div>`;

  switchDetailTab(tab);
  el('dfpDetailBackdrop').classList.add('show');
}

export function closeJobDetails(){
  el('dfpDetailBackdrop').classList.remove('show');
  detailJobId = null;
}

export function switchDetailTab(tab){
  document.querySelectorAll('#dfpDetailTabs .detail-tab').forEach(b=>b.classList.toggle('active', b.dataset.dfpTab===tab));
  document.querySelectorAll('.job-detail-body .detail-panel').forEach(p=>p.classList.toggle('active', p.dataset.dfpPanel===tab));
}

document.addEventListener('click', e=>{
  const opener = e.target.closest('.job-detail-body [data-open]');
  if(opener){ const u=opener.dataset.open; if(u&&u!=='#') window.open(u,'_blank'); return; }
  if(e.target.closest('button,select,input,a')) return;
  const clickable = e.target.closest('#dfpGrid .clickable-job[data-job-id]');
  if(clickable) openJobDetails(clickable.dataset.jobId);
});
