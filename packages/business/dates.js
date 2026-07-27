// Pure date-math helpers used across certificate-expiry displays, property
// views, and the dashboard — extracted from the Office App's certs section
// (Phase 5) since both that module and main.js's own dashboard/property
// widgets call them.

// A bare "YYYY-MM-DD" string parses as UTC midnight per the JS date spec,
// which during BST (UTC+1) is 1am local -- diffed against a real "now"
// instant, that skew could show a cert as "1 day left" for an hour after
// it's actually expired locally, or the reverse. Compare local calendar
// dates instead: build both sides as local midnight so the result is
// always a clean whole-day count, immune to that skew and to the DST
// transition days themselves (a "day" is 23 or 25 hours those two days a
// year, which a raw ms-division + ceil() would round to the wrong count).
export function daysDiff(s){
  if(!s) return NaN;
  const [y,m,d] = s.split('-').map(Number);
  if(!y||!m||!d) return NaN;
  const target = new Date(y, m-1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target-today)/(1000*60*60*24));
}

export function formatDateUK(iso){
  if(!iso)return'';
  const p=iso.split('-');
  if(p.length!==3)return iso;
  return`${p[2]}/${p[1]}/${p[0]}`;
}
