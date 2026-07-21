// Statements — the landlord/agency statement page: date-range and
// property filters, the selectable invoice list, bulk PDF download, and
// print-filtered-invoices. Extracted from main.js verbatim (Phase 5 of
// the architecture migration, module 6 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { S, dAll, dGet, toast, nav, calcInvTotal, downloadInvPDFById } from './main.js';

let _stmtSelected = new Set();
let _stmtInvoices = [];

// ════════════════════════════════════════════════════════════════
//  V3 — STATEMENTS PAGE
// ════════════════════════════════════════════════════════════════

export function stmtQuickRange(r) {
  const now = new Date();
  let from, to;
  if (r === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (r === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), q * 3, 1);
    to = new Date(now.getFullYear(), q * 3 + 3, 0);
  } else if (r === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), 11, 31);
  }
  document.getElementById('stmt-from').value = from.toISOString().slice(0, 10);
  document.getElementById('stmt-to').value = to.toISOString().slice(0, 10);
  renderStmt();
}

export function stmtClearFilters() {
  ['stmt-from','stmt-to','stmt-landlord','stmt-agent','stmt-agency','stmt-staff','stmt-status','stmt-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderStmt();
}

export async function populateStmtFilters(invs) {
  const landlords = [...new Set(invs.map(i => i.clientName).filter(Boolean))].sort();
  const agents = [...new Set(invs.map(i => i.agentName).filter(Boolean))].sort();
  const agencies = [...new Set(invs.map(i => i.agencyName).filter(Boolean))].sort();
  const staff = [...new Set(invs.map(i => i.engineer || i.assignedTo).filter(Boolean))].sort();

  const fillSel = (id, arr, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">All ${label}</option>` + arr.map(v => `<option ${v===cur?'selected':''}>${v}</option>`).join('');
  };
  fillSel('stmt-landlord', landlords, 'Landlords');
  fillSel('stmt-agent', agents, 'Agents');
  fillSel('stmt-agency', agencies, 'Agencies');
  fillSel('stmt-staff', staff, 'Staff');
}

export async function renderStmt() {
  let invs = await dAll('invoices');
  // Also get jobs to cross-reference agent/engineer
  const jobs = await dAll('jobs');
  const agents = await dAll('agents');
  const agencies = await dAll('agencies');

  // Enrich invoices with agent/agency info from linked job
  invs = invs.map(inv => {
    const job = jobs.find(j => j.id === inv.jobId || j.invNumber === inv.number);
    const agent = agents.find(a => a.id === inv.agentId || (job && a.id === job.agentId));
    const agency = agent ? agencies.find(a => a.id === agent.agencyId) : null;
    return {
      ...inv,
      agentName: inv.agentName || agent?.name || (job?.agentName) || '',
      agencyName: inv.agencyName || agency?.name || (job?.agencyName) || '',
      engineer: inv.engineer || job?.engineer || '',
    };
  });

  await populateStmtFilters(invs);

  // Apply filters
  const from = document.getElementById('stmt-from')?.value;
  const to = document.getElementById('stmt-to')?.value;
  const landlord = document.getElementById('stmt-landlord')?.value;
  const agent = document.getElementById('stmt-agent')?.value;
  const agency = document.getElementById('stmt-agency')?.value;
  const staff = document.getElementById('stmt-staff')?.value;
  const status = document.getElementById('stmt-status')?.value;
  const search = (document.getElementById('stmt-search')?.value || '').toLowerCase();

  if (from) invs = invs.filter(i => i.date >= from);
  if (to) invs = invs.filter(i => i.date <= to);
  if (landlord) invs = invs.filter(i => i.clientName === landlord);
  if (agent) invs = invs.filter(i => i.agentName === agent);
  if (agency) invs = invs.filter(i => i.agencyName === agency);
  if (staff) invs = invs.filter(i => i.engineer === staff);
  if (status) invs = invs.filter(i => i.status === status);
  if (search) invs = invs.filter(i => [i.number,i.clientName,i.description,i.agentName,i.agencyName,i.engineer].join(' ').toLowerCase().includes(search));

  invs.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  _stmtInvoices = invs;

  // KPIs
  const allPayments = await dAll('payments');
  let totalGrand = 0, totalPaid = 0, totalVat = 0, totalSub = 0;
  invs.forEach(inv => {
    const t = calcInvTotal(inv);
    totalGrand += t.grand;
    totalVat += t.vat;
    totalSub += t.sub;
    const paidAmt = allPayments.filter(p => p.invId === inv.id).reduce((s, p) => s + p.amount, 0);
    totalPaid += inv.status === 'Paid' ? t.grand : paidAmt;
  });
  const outstanding = totalGrand - totalPaid;

  const kpiEl = document.getElementById('stmt-kpis');
  if (kpiEl) {
    const kpi = (label, val, color) => `<div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:12px 18px;min-width:130px">
      <div style="font-size:11px;color:var(--txt3);font-family:var(--fh);font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${label}</div>
      <div style="font-family:var(--fh);font-size:20px;font-weight:700;color:${color||'var(--txt)'}">${val}</div>
    </div>`;
    kpiEl.innerHTML = [
      kpi('Invoices', invs.length, 'var(--acc)'),
      kpi('Subtotal', '£'+totalSub.toFixed(0), 'var(--txt)'),
      kpi('VAT', '£'+totalVat.toFixed(0), 'var(--blue)'),
      kpi('Total', '£'+totalGrand.toFixed(0), 'var(--acc)'),
      kpi('Collected', '£'+totalPaid.toFixed(0), 'var(--green)'),
      kpi('Outstanding', '£'+outstanding.toFixed(0), outstanding > 0 ? 'var(--red)' : 'var(--green)'),
    ].join('');
  }

  // Render table
  const tbody = document.getElementById('stmt-body');
  const tfoot = document.getElementById('stmt-foot');
  if (!tbody) return;

  if (!invs.length) {
    tbody.innerHTML = `<tr><td colspan="16" style="padding:40px;text-align:center;color:var(--txt3)">No invoices match your filters</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = invs.map(inv => {
    const t = calcInvTotal(inv);
    const paidAmt = inv.status === 'Paid' ? t.grand : allPayments.filter(p => p.invId === inv.id).reduce((s, p) => s + p.amount, 0);
    const outs = Math.max(0, t.grand - paidAmt);
    const sel = _stmtSelected.has(inv.id);
    const statusCls = {Paid:'b-paid','Awaiting Payment':'b-awaiting',Draft:'b-draft',Cancelled:'b-cancelled','Credit Note':'b-credit'}[inv.status]||'';
    return `<tr style="border-bottom:1px solid var(--border);${sel ? 'background:rgba(245,166,35,.06)' : ''}">
      <td style="padding:8px 12px"><input type="checkbox" ${sel?'checked':''} onchange="stmtToggleSel('${inv.id}',this)" style="accent-color:var(--acc)"></td>
      <td style="padding:8px 12px"><span style="font-family:var(--fh);font-weight:700;color:var(--acc);cursor:pointer" onclick="nav('inv');setTimeout(()=>viewInv('${inv.id}'),200)">${inv.number}</span></td>
      <td style="padding:8px 12px;font-size:12px">${inv.date||'—'}</td>
      <td style="padding:8px 12px;font-size:12px">${inv.dueDate||'—'}</td>
      <td style="padding:8px 12px;font-family:var(--fh);font-weight:600">${inv.clientName||'—'}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--txt2)">${inv.agentName||'—'}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--txt2)">${inv.agencyName||'—'}</td>
      <td style="padding:8px 12px;font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${inv.description||'—'}</td>
      <td style="padding:8px 12px;font-size:12px">${inv.engineer||'—'}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh)">£${t.sub.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);color:var(--blue)">£${t.vat.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);font-weight:700">£${t.grand.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);color:var(--green)">£${paidAmt.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);font-weight:700;color:${outs>0?'var(--red)':'var(--green)'}">£${outs.toFixed(2)}</td>
      <td style="padding:8px 12px"><span class="badge ${statusCls}" style="font-size:10px;padding:3px 8px">${inv.status}</span></td>
      <td style="padding:8px 12px">
        <button class="btn btn-ghost btn-xs" onclick="downloadInvPDFById('${inv.id}')">⬇ PDF</button>
      </td>
    </tr>`;
  }).join('');

  // Footer totals
  if (tfoot) tfoot.innerHTML = `<tr style="border-top:2px solid var(--border2)">
    <td colspan="9" style="padding:10px 12px;font-family:var(--fh);font-weight:700;font-size:13px">TOTALS (${invs.length} invoices)</td>
    <td style="padding:10px 12px;text-align:right;font-family:var(--fh);font-weight:700">£${totalSub.toFixed(2)}</td>
    <td style="padding:10px 12px;text-align:right;font-family:var(--fh);font-weight:700;color:var(--blue)">£${totalVat.toFixed(2)}</td>
    <td style="padding:10px 12px;text-align:right;font-family:var(--fh);font-weight:700;color:var(--acc)">£${totalGrand.toFixed(2)}</td>
    <td style="padding:10px 12px;text-align:right;font-family:var(--fh);font-weight:700;color:var(--green)">£${totalPaid.toFixed(2)}</td>
    <td style="padding:10px 12px;text-align:right;font-family:var(--fh);font-weight:700;color:${outstanding>0?'var(--red)':'var(--green)'}">£${outstanding.toFixed(2)}</td>
    <td colspan="2"></td>
  </tr>`;

  // Update button labels
  const dlBtn = document.getElementById('stmt-dl-btn');
  if (dlBtn) dlBtn.textContent = _stmtSelected.size > 0 ? `⬇ Download ${_stmtSelected.size} PDFs` : '⬇ Bulk PDF Download';
}

export function stmtToggleSel(id, cb) {
  if (cb.checked) _stmtSelected.add(id); else _stmtSelected.delete(id);
  const dlBtn = document.getElementById('stmt-dl-btn');
  if (dlBtn) dlBtn.textContent = _stmtSelected.size > 0 ? `⬇ Download ${_stmtSelected.size} PDFs` : '⬇ Bulk PDF Download';
}

export function stmtToggleAll(cb) {
  _stmtInvoices.forEach(inv => {
    if (cb.checked) _stmtSelected.add(inv.id); else _stmtSelected.delete(inv.id);
  });
  document.querySelectorAll('#stmt-body input[type=checkbox]').forEach(c => c.checked = cb.checked);
  const dlBtn = document.getElementById('stmt-dl-btn');
  if (dlBtn) dlBtn.textContent = _stmtSelected.size > 0 ? `⬇ Download ${_stmtSelected.size} PDFs` : '⬇ Bulk PDF Download';
}

export async function bulkDownloadPDFs() {
  const ids = _stmtSelected.size > 0 ? [..._stmtSelected] : _stmtInvoices.map(i => i.id);
  if (!ids.length) { toast('No invoices to download', 'warn'); return; }
  toast(`Generating ${ids.length} PDFs…`, 'info', 4000);
  for (const id of ids) {
    await downloadInvPDFById(id);
    await new Promise(r => setTimeout(r, 300)); // small delay between downloads
  }
  toast(`${ids.length} PDFs downloaded ✓`, 'success');
}

export async function printFilteredInvoices() {
  const ids = _stmtSelected.size > 0 ? [..._stmtSelected] : _stmtInvoices.map(i => i.id);
  if (!ids.length) { toast('No invoices to print', 'warn'); return; }
  // Build a printable HTML page with all invoices
  const invs = await Promise.all(ids.map(id => dGet('invoices', id)));
  const allPayments = await dAll('payments');
  const vr = S.vatRate || 20;
  const accent = S.invPdfColor || '#f5a623';

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoices</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#1a1a2e;margin:0;padding:0}
  .page{width:210mm;min-height:297mm;padding:18mm;box-sizing:border-box;page-break-after:always;position:relative}
  .page:last-child{page-break-after:auto}
  h1{color:${accent};font-size:28px;margin:0}
  .hdr{display:flex;justify-content:space-between;margin-bottom:20px}
  .billto-hdr{background:${accent};color:#fff;padding:5px 8px;font-weight:700;font-size:10px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th{background:#1e2233;color:#ccc;padding:6px 8px;text-align:left;font-size:10px}
  td{padding:5px 8px;border-bottom:1px solid #eee;font-size:11px}
  .total-row td{font-weight:700;font-size:13px;color:${accent}}
  .paid-watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:900;color:${accent};opacity:0.08;pointer-events:none;z-index:100}
  @media print{@page{size:A4;margin:0}}

.sql-block{
  background:var(--bg);border:1px solid var(--border);border-radius:var(--r2);
  padding:10px 14px;font-family:monospace;font-size:11px;color:#7dd3fc;
  white-space:pre;overflow-x:auto;line-height:1.6;cursor:pointer
}
.sql-block:hover{border-color:var(--acc)}
</style></head><body>`;

  invs.filter(Boolean).forEach(inv => {
    const t = calcInvTotal(inv);
    const isPaid = inv.status === 'Paid';
    html += `<div class="page">
      ${isPaid && S.invWatermarkPaid ? '<div class="paid-watermark">PAID</div>' : ''}
      <div class="hdr">
        <div>
          <div style="font-size:22px;font-weight:700;color:#1a1a2e">${S.coName || 'Your Company'}</div>
          ${S.coAddr ? `<div style="color:#666">${S.coAddr}</div>` : ''}
          ${S.coPhone ? `<div style="color:#666">${S.coPhone}</div>` : ''}
          ${S.coVatNum ? `<div style="color:#666">VAT: ${S.coVatNum}</div>` : ''}
        </div>
        <div style="text-align:right">
          <h1>INVOICE</h1>
          ${S.invSubtitle ? `<div style="color:#666;font-size:11px">${S.invSubtitle}</div>` : ''}
          <div style="font-weight:700;font-size:16px;margin-top:6px">${inv.number}</div>
          <div style="color:#666">Date: ${inv.date}</div>
          ${inv.dueDate ? `<div style="color:#666">Due: ${inv.dueDate}</div>` : ''}
        </div>
      </div>
      <table style="margin-bottom:16px">
        <tr>
          <td style="width:50%;vertical-align:top">
            <div style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin-bottom:4px">Bill To</div>
            <div style="font-weight:700">${inv.clientName || '—'}</div>
            ${inv.clientAddr ? `<div style="color:#666">${inv.clientAddr}</div>` : ''}
          </td>
          <td style="vertical-align:top">
            <div style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;margin-bottom:4px">Description</div>
            <div>${inv.description || '—'}</div>
            ${inv.agentName ? `<div style="font-size:10px;color:#666;margin-top:4px">Sent by agent: ${inv.agentName}${inv.agencyName?' ('+inv.agencyName+')':''}</div>` : ''}
          </td>
        </tr>
      </table>
      <table>
        <thead><tr><th>Description</th><th style="width:50px">Qty</th><th style="width:80px">Unit</th>${S.invShowVat!==false?'<th style="width:50px">VAT</th>':''}<th style="width:80px;text-align:right">Total</th></tr></thead>
        <tbody>
          ${(inv.items||[]).map(item => {
            const line = (item.qty||1)*(item.unit||0);
            const vatAmt = item.vat ? line * vr / 100 : 0;
            return `<tr><td>${item.desc||''}</td><td>${item.qty||1}</td><td>£${Number(item.unit||0).toFixed(2)}</td>${S.invShowVat!==false?`<td>${item.vat?vr+'%':'—'}</td>`:''}<td style="text-align:right">£${(line+vatAmt).toFixed(2)}</td></tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          ${S.invShowSubtotal!==false ? `<tr><td colspan="${S.invShowVat!==false?4:3}" style="text-align:right;color:#666">Subtotal</td><td style="text-align:right">£${t.sub.toFixed(2)}</td></tr>
          <tr><td colspan="${S.invShowVat!==false?4:3}" style="text-align:right;color:#666">VAT (${vr}%)</td><td style="text-align:right">£${t.vat.toFixed(2)}</td></tr>` : ''}
          <tr class="total-row"><td colspan="${S.invShowVat!==false?4:3}" style="text-align:right">TOTAL</td><td style="text-align:right">£${t.grand.toFixed(2)}</td></tr>
        </tfoot>
      </table>
      ${S.invShowBank!==false && (S.bankName||S.bankAcc) ? `<div style="margin-top:16px;padding:10px;background:#f8f9ff;border-radius:4px;font-size:11px"><strong>Payment Details:</strong> ${S.bankName||''} ${S.bankAcc?'| Acc: '+S.bankAcc:''} ${S.bankSort?'| Sort: '+S.bankSort:''} ${S.bankIBAN?'| IBAN: '+S.bankIBAN:''}</div>` : ''}
      ${S.invShowPayref!==false ? `<div style="margin-top:8px;padding:8px;border:1px solid ${accent};border-radius:4px;font-size:10px;color:#555">Please use invoice number <strong>${inv.number}</strong> as your payment reference</div>` : ''}
      ${S.invShowTerms!==false && S.payTerms ? `<div style="margin-top:8px;font-size:10px;color:#888">${S.payTerms}</div>` : ''}
      ${S.invShowNotes!==false && S.invNotes ? `<div style="font-size:10px;color:#888">${S.invNotes}</div>` : ''}
      ${(S.invCustomTexts||[]).filter(ct=>ct.enabled).map(ct=>`<div style="margin-top:8px;font-size:10px;color:#555"><strong>${ct.label}:</strong> ${ct.content}</div>`).join('')}
      ${S.invShowSig ? `<div style="margin-top:30px;border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#666;width:200px">${S.invSigLabel||'Authorised Signature:'}</div>` : ''}
      ${S.invFooter ? `<div style="position:absolute;bottom:14mm;left:18mm;right:18mm;text-align:center;font-size:9px;color:#aaa">${S.invFooter}</div>` : ''}
    </div>`;
  });

  html += '</body></html>';
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ════════════════════════════════════════════════════════════════
