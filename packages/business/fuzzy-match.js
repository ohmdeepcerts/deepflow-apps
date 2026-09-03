// Fuzzy address matching — used by the Jobs address autocomplete. Extracted
// from apps/office/main.js's fuzzyScore/hlMatch verbatim (relocate, don't
// change).
export function fuzzyScore(q,h){
  q=q.toLowerCase();h=h.toLowerCase();
  if(h.includes(q))return 1;
  let s=0,j=0;
  for(let i=0;i<q.length&&j<h.length;i++){
    while(j<h.length&&h[j]!==q[i])j++;
    if(j<h.length){s++;j++}
  }
  return s/Math.max(q.length,1);
}
export function highlightMatch(t,q){
  const tl=t.toLowerCase(),ql=q.toLowerCase(),i=tl.indexOf(ql);
  if(i===-1)return t;
  return t.slice(0,i)+`<span class="fmatch">${t.slice(i,i+q.length)}</span>`+t.slice(i+q.length);
}
