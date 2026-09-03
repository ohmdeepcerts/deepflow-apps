// Property derivation — turns the raw jobs list into a de-duplicated
// property list, keyed by normalized address, merged with any manually-
// entered property records. Extracted from apps/office/main.js's
// _normAddr/_deriveProperties verbatim — relocate, don't change.

export function normAddr(a){ return (a||'').trim().toLowerCase().replace(/[,.]/g,' ').replace(/\s+/g,' ').trim(); }

export function deriveProperties(jobs,manualProps){
  const byAddr=new Map();
  for(const j of jobs){
    if(!j.address) continue;
    const key=normAddr(j.address);
    if(!byAddr.has(key)) byAddr.set(key,{address:j.address,jobs:[]});
    byAddr.get(key).jobs.push(j);
  }
  const manualByAddr=new Map();
  for(const p of (manualProps||[])){
    if(p.address) manualByAddr.set(normAddr(p.address),p);
  }
  const allKeys=new Set([...byAddr.keys(),...manualByAddr.keys()]);
  return [...allKeys].map(key=>{
    const auto=byAddr.get(key);
    const manual=manualByAddr.get(key);
    const jobsAtAddr=auto?.jobs||[];
    const llMap=new Map();
    // Agency-referred and landlord-referred jobs are tracked in separate
    // maps — this used to fold both into one "landlord" name/date map, so
    // selectAddr() below had no way to tell whether the most recent
    // referrer on a property was actually an agency (needs the linked
    // Agency Name field, which resolves to the real agencies-table record
    // and AGN- invoice series) or a real landlord (needs the free-text
    // Referrer field). It always treated it as the latter, so re-selecting
    // an agency-referred property from the address autocomplete silently
    // dropped the agency link — same failure mode as the bogus-duplicate-
    // person bug already fixed in _autoInvoiceInner(), reached via this
    // separate path instead.
    const agMap=new Map();
    for(const j of jobsAtAddr){
      if(j.landlordName&&(!llMap.has(j.landlordName)||(j.date||'')>llMap.get(j.landlordName))) llMap.set(j.landlordName,j.date||'');
      if(j.agencyName&&(!agMap.has(j.agencyName)||(j.date||'')>agMap.get(j.agencyName))) agMap.set(j.agencyName,j.date||'');
    }
    const landlordHistory=[...llMap.entries()].sort((a,b)=>(b[1]||'').localeCompare(a[1]||'')).map(([n])=>n);
    const agencyHistory=[...agMap.entries()].sort((a,b)=>(b[1]||'').localeCompare(a[1]||'')).map(([n])=>n);
    return{
      id:manual?.id||('auto_'+key.replace(/[^a-z0-9]/g,'').slice(0,32)),
      address:manual?.address||auto?.address||'',
      landlord:manual?.landlord||landlordHistory[0]||agencyHistory[0]||'',
      landlordHistory,
      agency:agencyHistory[0]||'',
      agencyHistory,
      postcode:manual?.postcode||jobsAtAddr.find(j=>j.postcode)?.postcode||'',
      type:manual?.type||'',beds:manual?.beds||'',notes:manual?.notes||'',
      _jobs:jobsAtAddr,
      _isAuto:!manual,
    };
  }).sort((a,b)=>(a.address||'').localeCompare(b.address||''));
}
