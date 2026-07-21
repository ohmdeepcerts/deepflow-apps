// Invoice custom text blocks — Settings-page editor for the optional
// reusable text snippets (payment terms, thank-you notes, etc.) that can
// be toggled onto generated invoice PDFs. Extracted from main.js verbatim
// (Phase 5 of the architecture migration, module 10 — see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — no behaviour changes.
//
// This module and main.js import from each other, same as the other
// Phase 5 modules: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { S, uid, saveSetting } from './main.js';

// ════════════════════════════════════════════════════════════════
//  V3 — CUSTOM INVOICE TEXT BLOCKS
// ════════════════════════════════════════════════════════════════
export function renderInvCustomTexts() {
  const container = document.getElementById('inv-custom-texts');
  if (!container) return;
  const texts = S.invCustomTexts || [];
  if (!texts.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--txt3);padding:8px 0">No custom blocks yet. Click "+ Add Custom Block" below.</div>';
    return;
  }
  container.innerHTML = texts.map((ct, i) => `
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:var(--r);padding:14px;display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1">
        <div style="display:flex;gap:10px;margin-bottom:8px;align-items:center">
          <input class="fi" style="max-width:200px;padding:5px 8px;font-size:12px" value="${ct.label||''}" placeholder="Label (e.g. Terms)" oninput="S.invCustomTexts[${i}].label=this.value">
          <label class="fcheck" style="margin:0;font-size:12px">
            <input type="checkbox" ${ct.enabled?'checked':''} onchange="S.invCustomTexts[${i}].enabled=this.checked;saveSettings()" style="accent-color:var(--acc)"> Show on PDF
          </label>
        </div>
        <textarea class="fta" style="min-height:55px;font-size:12px" placeholder="Content…" oninput="S.invCustomTexts[${i}].content=this.value">${ct.content||''}</textarea>
      </div>
      <button class="btn btn-red btn-xs" onclick="removeInvCustomText(${i})" style="margin-top:4px">✕</button>
    </div>
  `).join('');
}

export function addInvCustomText() {
  if (!S.invCustomTexts) S.invCustomTexts = [];
  S.invCustomTexts.push({ id: uid(), label: 'Custom Block ' + (S.invCustomTexts.length + 1), content: '', enabled: true });
  renderInvCustomTexts();
}

export async function removeInvCustomText(i) {
  S.invCustomTexts.splice(i, 1);
  renderInvCustomTexts();
  await saveSetting('invCustomTexts', S.invCustomTexts);
}
