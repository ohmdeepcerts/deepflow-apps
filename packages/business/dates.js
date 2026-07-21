// Pure date-math helpers used across certificate-expiry displays, property
// views, and the dashboard — extracted from the Office App's certs section
// (Phase 5) since both that module and main.js's own dashboard/property
// widgets call them.

export function daysDiff(s){return Math.ceil((new Date(s)-new Date())/(1000*60*60*24))}

export function formatDateUK(iso){
  if(!iso)return'';
  const p=iso.split('-');
  if(p.length!==3)return iso;
  return`${p[2]}/${p[1]}/${p[0]}`;
}
