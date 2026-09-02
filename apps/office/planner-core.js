// Engineer Planner — shared pure utilities: date math for the Day/Week/
// Month grids, the DOM/money shorthand helpers, and the billing-contact/
// job-type resolvers every other planner-*.js file renders from. Extracted
// from planner.js verbatim (Phase 4 of the follow-up modularization pass —
// same split rationale as Phases 1-3) — no behaviour changes.
//
// Pure functions only, no module-level mutable state and no main.js
// dependency — this is the one planner-*.js file every other one imports
// from, never the reverse.

export function TODAY(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
export function isoDate(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
export function parseLocalDate(s){ return new Date(`${s}T12:00:00`); }
export function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
export function prettyDate(s, opts={weekday:'short',day:'numeric',month:'short'}){
  return parseLocalDate(s).toLocaleDateString('en-GB',opts);
}
export function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return x; }
export function endOfWeek(d){ return addDays(startOfWeek(d),6); }
export const el = id => document.getElementById(id);
export const money = n => '£'+Number(n||0).toFixed(2);

// Same priority chain as billing-name resolution and the invoice sync logic
// elsewhere in main.js: Agency > Agent > Landlord > Referrer.
export function resolveContact(j){
  const name = j.agencyName||j.agentName||j.landlordName||j.referrer||'';
  const phone = j.agencyPhone||j.agentPhone||j.landlordPhone||'';
  const email = j.agencyEmail||j.agentEmail||j.landlordEmail||'';
  return {name, phone, email};
}

// Job priority already carries Certificate/Repair/Urgent/Emergency as real
// values (see the job form's Priority select) — reused directly rather than
// inventing a parallel "type" field the demo has but DeepFlow doesn't.
export function jobDataType(j){
  const p=(j.priority||'').toLowerCase();
  return ['certificate','repair','urgent','emergency'].includes(p) ? p : 'normal';
}

export function invoiceFor(j, invoices){
  return invoices.find(i=>i.jobId===j.id||i.linkedJobId===j.id);
}
