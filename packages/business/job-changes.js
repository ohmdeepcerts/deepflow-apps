// Compare two job objects and return the list of changed field names —
// drives the Jobs list's realtime in-place row patching (a job the
// realtime channel reports as changed only actually re-renders the fields
// this says changed). Extracted from apps/office/main.js's
// getChangedFields verbatim (relocate, don't change).
export function getChangedFields(prev, curr){
  if(!prev || !curr) return ['all'];
  // _sortOrder (drag-to-reorder within the same day) was missing from this
  // list entirely, so a same-day reorder produced zero detected changes on
  // every OTHER open session — handleRealtimeChange saw updatedFields.length
  // === 0 and returned without doing anything. The row only updated once
  // that session navigated away and back, forcing a fresh fetch. Cross-day
  // drags worked because they change `date`, which was already tracked.
  const fields = ['status','priority','date','engineer','timeSlot','address','price','description','jobNum','_sortOrder'];
  return fields.filter(f => prev[f] !== curr[f]);
}
