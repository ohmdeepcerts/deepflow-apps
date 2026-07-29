// Statements — the landlord/agency statement page: date-range and
// property filters, the selectable invoice list, bulk PDF download, and
// print-filtered-invoices. Extracted from main.js verbatim (Phase 5 of
// the architecture migration, module 6 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { localDateStr } from '@business';
import { buildMastheadHTML, escHtml } from '@ui';
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
  // from/to are all local-midnight constructions (new Date(y,m,d)) --
  // toISOString() is UTC, so during BST this dropped the last day of the
  // period (or included an extra day from the previous one) on every
  // statement pulled for a real client, every time. localDateStr() reads
  // the Date's own local fields back instead.
  document.getElementById('stmt-from').value = localDateStr(from);
  document.getElementById('stmt-to').value = localDateStr(to);
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
    // A credit note reduces revenue/what's owed — it was being summed here
    // exactly like a real invoice, which both overstated Total (credit
    // notes counted as additional invoicing) and, since a credit note can
    // never be marked Paid, permanently inflated Outstanding by the full
    // value of every credit note ever issued.
    const sign = inv.status === 'Credit Note' ? -1 : 1;
    totalGrand += sign * t.grand;
    totalVat += sign * t.vat;
    totalSub += sign * t.sub;
    if (inv.status !== 'Credit Note') {
      const paidAmt = allPayments.filter(p => p.invId === inv.id).reduce((s, p) => s + p.amount, 0);
      totalPaid += inv.status === 'Paid' ? t.grand : paidAmt;
    }
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
    const isCredit = inv.status === 'Credit Note';
    // A credit note is a reduction, not an unpaid charge — it can never be
    // marked Paid, so showing its own value in "Outstanding" made every
    // credit note look like a permanent debt.
    const paidAmt = isCredit ? 0 : (inv.status === 'Paid' ? t.grand : allPayments.filter(p => p.invId === inv.id).reduce((s, p) => s + p.amount, 0));
    const outs = isCredit ? 0 : Math.max(0, t.grand - paidAmt);
    const sign = isCredit ? '-' : '';
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
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh)">${sign}£${t.sub.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);color:var(--blue)">${sign}£${t.vat.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right;font-family:var(--fh);font-weight:700">${sign}£${t.grand.toFixed(2)}</td>
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

// Fetches an already-generated PDF from Storage and triggers a real file
// download via a blob URL — no popup-blocker issues in a loop, unlike
// window.open(), and no regenerating a document that's already sitting
// there unchanged.
async function _downloadStoredPDF(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(objUrl);
}

export async function bulkDownloadPDFs() {
  const ids = _stmtSelected.size > 0 ? [..._stmtSelected] : _stmtInvoices.map(i => i.id);
  if (!ids.length) { toast('No invoices to download', 'warn'); return; }
  toast(`Downloading ${ids.length} PDFs…`, 'info', 4000);
  let stored = 0, generated = 0;
  for (const id of ids) {
    const inv = await dGet('invoices', id);
    if (inv?.pdfUrl) {
      // Already generated and stored — just fetch the fixed file rather
      // than rebuilding it client-side again.
      try { await _downloadStoredPDF(inv.pdfUrl, (inv.number || 'invoice') + '.pdf'); stored++; }
      catch (e) { console.warn('[DeepFlow] Stored PDF fetch failed, falling back to regenerate for', inv.number, e); await downloadInvPDFById(id); generated++; }
    } else {
      // No stored copy yet (an invoice created before this feature existed)
      // — build and download it now; downloadInvPDFById also stores a copy
      // in the background so next time this hits the fast path above.
      await downloadInvPDFById(id);
      generated++;
    }
    await new Promise(r => setTimeout(r, 300)); // small delay between downloads
  }
  toast(`${ids.length} PDFs downloaded ✓ (${stored} stored, ${generated} generated)`, 'success');
}

// This is the one invoice surface that isn't jsPDF at all — it's real
// HTML handed to the browser's own print engine (Ctrl+P / "Save as
// PDF"), so it was never part of the file-size problem the rest of the
// invoice PDF pipeline had (a browser's print-to-PDF renders real text,
// not a screenshot). It still shares the masthead builder
// (packages/ui/invoice-template.js) so the branded header matches every
// other invoice surface exactly, with a plain-CSS body alongside it —
// real gradients are fine here since nothing rasterises this.
const _STATUS_PILL = {
  Paid: { label: 'Paid', bg: 'rgba(74,222,128,.16)', fg: '#86EFAC' },
  'Awaiting Payment': { label: 'Awaiting Payment', bg: 'rgba(253,224,71,.16)', fg: '#FDE68A' },
  Cancelled: { label: 'Cancelled', bg: 'rgba(252,165,165,.16)', fg: '#FCA5A5' },
  Draft: { label: 'Draft', bg: 'rgba(203,213,225,.16)', fg: '#CBD5E1' },
};
function _printInvoicePage(inv, vr) {
  const t = calcInvTotal(inv);
  const isAgency = inv.invoiceType === 'agency';
  const billToName = inv.billToName || inv.clientName || '—';
  const billToAddr = inv.billToAddress || inv.clientAddr || '';
  const propAddr = inv.propertyAddress || inv.jobAddress || inv.jobAddr || '';
  const showAgent = S.invShowAgent !== false && isAgency && inv.agentName && inv.agentName.trim();
  const regBits = [S.invFooter, (S.coVatNum && S.vatEnabled !== false) ? 'VAT ' + S.coVatNum : null].filter(Boolean).join(' · ');
  const isPaid = inv.status === 'Paid';
  const items = (inv.items || []).map(it => {
    const line = (it.qty || 1) * (it.unit || 0);
    const v = it.vat ? line * vr / 100 : 0;
    return `<tr><td>${escHtml(it.desc || '')}</td><td class="r">£${(line + v).toFixed(2)}</td></tr>`;
  }).join('');
  return `<div class="pp-page">
    ${buildMastheadHTML({ inv, S, status: _STATUS_PILL[inv.status] || _STATUS_PILL.Draft })}
    <div class="pp-body">
      <div class="pp-cols">
        <div><div class="pp-lbl">Ordered By</div><div class="pp-name">${escHtml(billToName)}</div><div class="pp-line">${escHtml(billToAddr)}</div></div>
        <div><div class="pp-lbl">Site of Works</div><div class="pp-name">${escHtml(propAddr || '—')}</div><div class="pp-line">Ref: ${escHtml(inv.jobNum || inv.jobRef || inv.number)}</div></div>
      </div>
      <table class="pp-tbl"><thead><tr><th>Description</th><th class="r">Total</th></tr></thead><tbody>${items}</tbody></table>
      <div class="pp-total"><span class="l">${isPaid ? 'Total Paid' : 'Total Due'}</span><span class="v">£${t.grand.toFixed(2)}</span></div>
      ${isPaid ? `<div class="pp-paid">✓ Paid via Bank Transfer · Ref ${escHtml(inv.number)}</div>` : `<div class="pp-payref">Please use <b>${escHtml(inv.number)}</b> as your payment reference.</div>`}
      <div class="pp-foot">
        ${showAgent ? `<div class="pp-agent">Agent — <b>${escHtml(inv.agentName)}</b></div>` : ''}
        <div class="pp-foot-row"><span>${escHtml(regBits)}</span><span class="pp-credit">Powered by DeepFlow</span></div>
      </div>
    </div>
  </div>`;
}
export async function printFilteredInvoices() {
  const ids = _stmtSelected.size > 0 ? [..._stmtSelected] : _stmtInvoices.map(i => i.id);
  if (!ids.length) { toast('No invoices to print', 'warn'); return; }
  const invs = (await Promise.all(ids.map(id => dGet('invoices', id)))).filter(Boolean);
  const vr = S.vatRate || 20;

  const pages = invs.map(inv => _printInvoicePage(inv, vr)).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoices</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#191C22}
  .pp-page{width:210mm;min-height:297mm;page-break-after:always;display:flex;flex-direction:column}
  .pp-page:last-child{page-break-after:auto}
  .pp-body{flex:1;display:flex;flex-direction:column;padding:10mm 18mm 14mm;gap:8mm}
  .pp-cols{display:grid;grid-template-columns:1fr 1fr;border-left:1mm solid #0EA5E9}
  .pp-cols>div{padding:0 6mm}
  .pp-cols>div+div{border-left:.25mm solid #D8DCE3}
  .pp-lbl{font-size:8.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0EA5E9;margin-bottom:2mm}
  .pp-name{font-size:12px;font-weight:700}
  .pp-line{font-size:10px;color:#6B7280;margin-top:1mm}
  table.pp-tbl{width:100%;border-collapse:collapse}
  table.pp-tbl th{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#8A8F98;text-align:left;font-weight:700;padding:0 0 2mm;border-bottom:.4mm solid #191C22}
  table.pp-tbl th.r,table.pp-tbl td.r{text-align:right}
  table.pp-tbl td{font-size:11px;padding:2mm 0;border-bottom:.2mm solid #EEF1F6}
  .pp-total{margin-top:2mm;padding:4mm 6mm;border-radius:1.5mm;display:flex;justify-content:space-between;align-items:baseline;background:linear-gradient(90deg,#0d1f3c,#1e3a5f,#0a1628)}
  .pp-total .l{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.7)}
  .pp-total .v{font-size:17px;font-weight:800;color:#F2C14E}
  .pp-payref{margin-top:2mm;padding:3mm 6mm;border:.25mm solid #E8B84B;border-radius:1.5mm;background:#FEF8EB;font-size:10px;color:#6B4E0C}
  .pp-paid{margin-top:2mm;font-size:10px;font-weight:700;color:#3F7A4C}
  .pp-foot{margin-top:auto;padding-top:3mm;border-top:.25mm solid #D8DCE3}
  .pp-agent{font-size:10px;color:#374151;font-weight:600;padding-bottom:2mm;margin-bottom:2mm;border-bottom:.2mm solid #EEF1F6}
  .pp-foot-row{display:flex;justify-content:space-between;font-size:8.5px;color:#9CA3AF}
  .pp-credit{font-weight:700;color:#0EA5E9}
  @media print{@page{size:A4;margin:0}}
</style></head><body>${pages}</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}

// ════════════════════════════════════════════════════════════════
