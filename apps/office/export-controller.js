// Master Excel Export — browser-only glue. This is the ONLY file in the
// export system that touches the DOM/download APIs; everything it calls
// (export-data-service.js, export-workbook-builder.js) is pure and already
// covered by tests/integration/export-workbook.test.js's golden dataset.
// No fake timed progress bar — every stage below fires only when its real
// step actually completes.
import { S, dAll, toast, getAppUser, logActivity } from './main.js';
import { gatherExportData, resolveDateRange } from './export-data-service.js';
import { buildWorkbook, workbookToBlob, DEFAULT_INCLUDE } from './export-workbook-builder.js';

const STAGE_LABELS = {
  jobs: 'Loading Jobs', invoices: 'Loading Invoices', persons: 'Loading Landlords',
  agencies: 'Loading Agencies', agents: 'Loading Agents', certs: 'Loading Certificates',
  properties: 'Loading Properties', payments: 'Loading Payments', job_visits: 'Loading Visits',
  build: 'Building Workbook', recon: 'Reconciliation',
};
const STAGE_ORDER = ['jobs', 'invoices', 'persons', 'agencies', 'agents', 'certs', 'properties', 'payments', 'job_visits'];

function progressListEl() { return document.getElementById('export-progress-list'); }
function progressPctEl() { return document.getElementById('export-progress-pct'); }

function renderProgressStage(stage, status) {
  const el = document.getElementById('export-stage-' + stage);
  if (!el) return;
  el.textContent = (status === 'done' ? '✓ ' : status === 'active' ? '⟳ ' : '○ ') + STAGE_LABELS[stage];
  el.style.color = status === 'done' ? 'var(--green)' : status === 'active' ? 'var(--acc)' : 'var(--txt3)';
}

function setProgressPct(pct) {
  const el = progressPctEl();
  if (el) el.textContent = Math.round(pct) + '%';
  const bar = document.getElementById('export-progress-bar');
  if (bar) bar.style.width = Math.round(pct) + '%';
}

export function openExportWorkbookModal() {
  const list = progressListEl();
  if (list) {
    list.innerHTML = STAGE_ORDER.map((s) => `<div id="export-stage-${s}" style="padding:2px 0;font-size:12px;color:var(--txt3)">○ ${STAGE_LABELS[s]}</div>`).join('')
      + `<div style="padding:2px 0;font-size:12px;color:var(--txt3)" id="export-stage-build">○ Building Workbook</div>`
      + `<div style="padding:2px 0;font-size:12px;color:var(--txt3)" id="export-stage-recon">○ Reconciliation</div>`;
  }
  setProgressPct(0);
  const result = document.getElementById('export-result');
  if (result) result.innerHTML = '';
  const dl = document.getElementById('export-download-btn');
  if (dl) dl.style.display = 'none';
  const custom = document.getElementById('export-custom-dates');
  if (custom) custom.style.display = document.getElementById('export-range-custom')?.checked ? 'flex' : 'none';
  document.getElementById('mo-export')?.classList.add('open');
}

export function onExportRangeChanged() {
  const mode = document.querySelector('input[name="export-range"]:checked')?.value || 'all';
  const custom = document.getElementById('export-custom-dates');
  if (custom) custom.style.display = mode === 'custom' ? 'flex' : 'none';
}

let _lastBlobUrl = null;

export async function runExportWorkbook() {
  const btn = document.getElementById('export-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const mode = document.querySelector('input[name="export-range"]:checked')?.value || 'all';
    const customFrom = document.getElementById('export-from')?.value || '';
    const customTo = document.getElementById('export-to')?.value || '';
    const dateRange = resolveDateRange(mode, customFrom, customTo);

    const totalStages = STAGE_ORDER.length + 2;
    let doneStages = 0;
    const data = await gatherExportData(dAll, (stage, status, count) => {
      renderProgressStage(stage, status === 'loading' ? 'active' : 'done');
      if (status === 'done') { doneStages += 1; setProgressPct((doneStages / totalStages) * 100); }
    });

    renderProgressStage('build', 'active');
    const include = {};
    Object.keys(DEFAULT_INCLUDE).forEach((key) => {
      const el = document.getElementById('export-inc-' + key);
      include[key] = el ? el.checked : DEFAULT_INCLUDE[key];
    });
    const scope = { dateRange, include };
    const requestedBy = getAppUser()?.name || 'Unknown';
    const result = await buildWorkbook({ data, S, scope, requestedBy });
    doneStages += 1; setProgressPct((doneStages / totalStages) * 100);
    renderProgressStage('build', 'done');

    renderProgressStage('recon', 'active');
    doneStages += 1; setProgressPct(100);
    renderProgressStage('recon', 'done');

    // Security requirement (spec: "Potentially sensitive exports should
    // create Audit Log events") — fire-and-forget, never blocks the
    // download on the audit write succeeding.
    logActivity(`${requestedBy} exported Business Workbook — ${dateRange.label}${result.allMatch ? '' : ' (with validation warnings)'}`, result.allMatch ? 'info' : 'warn').catch(() => {});

    const resultEl = document.getElementById('export-result');
    if (resultEl) {
      resultEl.innerHTML = result.allMatch
        ? `<div style="color:var(--green);font-weight:700">✓ Workbook verified successfully — every count reconciles.</div>`
        : `<div style="color:var(--red);font-weight:700">❌ Export completed with validation warnings — ${result.reconciliation.filter(r=>r.queried!==r.exported).length} discrepancy(ies). Review the Export Audit sheet before relying on this workbook.</div>`;
      if (result.dataQualityIssueCount) {
        resultEl.innerHTML += `<div style="color:var(--txt3);font-size:12px;margin-top:4px">${result.dataQualityIssueCount} item(s) noted on the Data Quality sheet — not errors, just worth a look.</div>`;
      }
    }

    const blob = await workbookToBlob(result.workbook);
    if (_lastBlobUrl) URL.revokeObjectURL(_lastBlobUrl);
    _lastBlobUrl = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const fname = mode === 'all' ? `DeepFlow_Master_Export_${dateStr}.xlsx` : `DeepFlow_Export_${customFrom || dateStr}_to_${customTo || dateStr}.xlsx`;
    const dl = document.getElementById('export-download-btn');
    if (dl) {
      dl.href = _lastBlobUrl;
      dl.download = fname;
      dl.style.display = '';
    }
    toast(result.allMatch ? '✅ Workbook ready' : '⚠️ Workbook ready with warnings', result.allMatch ? 'success' : 'warn');
  } catch (e) {
    console.error('[DeepFlow] Export failed', e);
    toast('❌ Export failed: ' + (e.message || 'Unknown error'), 'error', 6000);
    const resultEl = document.getElementById('export-result');
    if (resultEl) resultEl.innerHTML = `<div style="color:var(--red)">❌ Export failed — ${(e.message||'').slice(0,200)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Generate Excel Workbook'; }
  }
}
