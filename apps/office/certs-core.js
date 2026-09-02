// Certificates core — reference-number generation and the Supabase Storage
// upload helper shared by the rest of the certs-* files. Extracted from
// certs.js verbatim (Phase 2 of the follow-up modularization pass — see
// the plan file for scope) — no behaviour changes.
//
// This module and main.js import from each other, same as every other
// extracted module: safe because every cross-module reference is used only
// inside function bodies, never at module-evaluation time.

import { SB_URL, SB_KEY } from '@core';
import { S, dAll, _getJWT, saveAllSettings } from './main.js';

// Sanitized filename for a cert's PDF — the reference number (certNum) if
// there is one, so however someone ends up with this file (a direct link,
// a portal download, an emailed attachment) the filename they see matches
// the reference on the certificate itself, not a meaningless id/timestamp.
// Ported from PAT-TEST's own downloadPDF(), which does the exact same
// ref-as-filename sanitization for its downloaded PDFs.
export function _certFilename(c){
  return (c?.certNum||c?.type||'certificate').replace(/[^\w-]/g,'_')+'.pdf';
}

// ── AUTO REFERENCE NUMBER GENERATION ────────────────────────────
// Ported from PAT-TEST's own updateRef()/addressRefPart()/incStr(), and
// generalized to every cert type (not just PAT): when Reference Number is
// left blank on a new cert, one is generated as
//   base + "0" + middle + " / " + addressTag
// — base is an ever-incrementing serial (S.certRefSerial, shared across
// every cert type so no two certs, of any type, on any day, ever land on
// the same base — that's what actually guarantees uniqueness, not the
// date/count/address after it, which are just decoration), middle is the
// appliance count for cert types that track one (matching PAT-TEST
// exactly) or the issue date's day+month with no leading zeros for types
// that don't (e.g. 4 Aug -> "48"), and addressTag is the same short
// door-number-plus-street extract PAT-TEST derives from the property
// address. Auto-numbering only fires when S.certRefSerial has been set in
// Settings — empty by default, so certNum stays fully manual until an
// admin opts in.

// Same regex PAT-TEST's own incStr() uses: increments the trailing run of
// digits by 1, preserving its width (so "GBE1009" -> "GBE1010", not
// "GBE10010"). Falls back to appending "-1" for a base with no trailing
// digits at all (shouldn't happen in practice — the admin-set starting
// serial always has one).
export function _incStr(s){
  const m=(s||'').match(/^(.*?)(\d+)$/);
  return m?m[1]+String(parseInt(m[2],10)+1).padStart(m[2].length,'0'):(s||'')+'-1';
}

// Extracts a short "[business name] door-number street" fragment from a
// property address — ported verbatim (algorithm, not just intent) from
// PAT-TEST's own addressRefPart(). Prefers real line breaks; falls back to
// comma-splitting DeepFlow's usual single-line address. Verified against
// all 8 of the real historical PAT-TEST refs migrated into this database —
// every one decodes back to exactly this.
export function addressRefPart(addr){
  if(!addr) return '';
  let lines=addr.split('\n').map(l=>l.trim()).filter(Boolean);
  if(lines.length<2) lines=addr.split(',').map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return '';
  const startsWithDigit=l=>/^\d/.test(l);
  let businessName='',streetLine;
  if(startsWithDigit(lines[0])){
    streetLine=lines[0];
  }else{
    businessName=lines[0];
    streetLine=lines.slice(1).find(startsWithDigit)||lines[1]||'';
  }
  const m=(streetLine||'').match(/^(\d+\w*)\s+(\S+)\s*(\S+)?/);
  const streetPart=m?[m[1],m[2],m[3]].filter(Boolean).join(' '):(streetLine||'').split(/\s+/).slice(0,3).join(' ');
  return businessName?businessName+' '+streetPart:streetPart;
}

// Day+month with no leading zeros, concatenated with no separator (e.g.
// 2026-08-04 -> "48") — stands in for appliance count on cert types that
// don't track appliances, per the same "0" + digits convention.
export function _ddmmUnpadded(dateStr){
  if(!dateStr) return '';
  const [y,m,d]=String(dateStr).split('-').map(Number);
  if(!y||!m||!d) return '';
  return String(d)+String(m);
}

// Advances S.certRefSerial to the next unused base and persists it. Checks
// against every existing certNum (not just ones this session has seen) so
// a manually-typed certNum that happens to collide with the next serial
// still gets skipped — the persisted counter is the fast path, this check
// is the safety net for it.
export async function _nextCertBaseRef(){
  let next=_incStr(S.certRefSerial);
  const all=await dAll('certs');
  const existing=all.map(c=>(c.certNum||'').toLowerCase());
  while(existing.some(cn=>cn.startsWith((next+'0').toLowerCase()))) next=_incStr(next);
  S.certRefSerial=next;
  await saveAllSettings();
  return next;
}

export async function generateCertRef({address,appliances,hasAppliances,issueDate}){
  const base=await _nextCertBaseRef();
  const middle=hasAppliances?String((appliances||[]).length):_ddmmUnpadded(issueDate);
  const tag=addressRefPart(address);
  return tag?`${base}0${middle} / ${tag}`:`${base}0${middle}`;
}

// Storage upload — moved here with its one and only caller (uploadCertPdf).
export async function sbStorage(path,file){
  const jwt=await _getJWT();
  const res=await fetch(`${SB_URL}/storage/v1/object/deepflow/${path}`,{
    method:'POST',
    headers:{'apikey':SB_KEY,'Authorization':'Bearer '+jwt,'Content-Type':file.type||'application/octet-stream','x-upsert':'true'},
    body:file
  });
  if(!res.ok) throw new Error('Upload failed: '+(await res.text()).slice(0,200));
  return `${SB_URL}/storage/v1/object/public/deepflow/${path}`;
}
