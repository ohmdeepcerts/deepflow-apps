// The camelCase (JS) ↔ snake_case/lowercase (Supabase column) field mapping
// — previously three independently-maintained copies (Office App: full
// multi-table map; Employee App: a jobs-only subset; Client Portal: its own
// flat subset covering persons/agencies/agents fields). Before unifying,
// every field-name pair across all three was compared directly and found
// consistent (no conflicts) except one already-dead entry in Client
// Portal's copy (`createdat`→`createdAt`, a column that doesn't exist
// anywhere — the same dead entry already found and removed from the Office
// App's own copy of `invoices` earlier in this engagement). This table is
// the Office App's copy (already the most complete), and every single
// mapped column has been directly verified against the live schema with
// zero mismatches (see tests/integration/data-mapping.test.js).
export const TO_DB = {
  jobs: {
    jobNum: 'jobnum', certTypes: 'certtypes', timeSlot: 'timeslot', confirmed: 'confirmed',
    landlordName: 'landlordname', landlordPhone: 'landlordphone', landlordEmail: 'landlordemail',
    landlordAddr: 'landlordaddr', landlordWA: 'landlordwa', landlordNotes: 'landlordnotes',
    agencyName: 'agencyname', agencyPhone: 'agencyphone', agencyEmail: 'agencyemail',
    agencyNotes: 'agencynotes', agentName: 'agentname', agentPhone: 'agentphone',
    agentEmail: 'agentemail', _sortOrder: 'sortorder', invNumber: 'invnumber', linkedInvId: 'linkedinvid',
  },
  certs: {
    issueDate: 'issuedate', expiryDate: 'expirydate', certNum: 'certnum', jobId: 'jobid',
    jobNum: 'jobnum', noExpiry: 'noexpiry', pdfUrl: 'pdf_url', pdfPath: 'pdf_path',
    notResponding: 'notresponding',
  },
  invoices: {
    clientId: 'clientid', clientName: 'clientname', clientEmail: 'clientemail', clientAddr: 'clientaddr',
    clientWA: 'clientwa', dueDate: 'duedate', jobId: 'jobid', linkedJobId: 'linkedjobid', jobRef: 'jobref',
    agentCC: 'agentcc', agentName: 'agentname', agentEmail: 'agentemail',
    invoiceType: 'invoicetype', billToName: 'billtoname', billToAddress: 'billtoaddress',
    jobAddress: 'jobaddress', agencyName: 'agencyname', agencyAddress: 'agencyaddress',
    landlordName: 'landlordname', propertyAddress: 'propertyaddress', jobNum: 'jobnum',
    linkedInvId: 'linkedinvid',
  },
  agents: { agencyId: 'agencyid' },
  persons: { agencyId: 'agencyid', bankName: 'bankname', bankAcc: 'bankacc', bankSort: 'banksort', bankRef: 'bankref' },
  agencies: { bankName: 'bankname', bankAcc: 'bankacc', bankSort: 'banksort', bankRef: 'bankref' },
  payments: { invId: 'inv_id', recordedBy: 'recorded_by' },
  expenses: { jobRef: 'jobref', desc: 'description' },
  overtime: {},
  portal_contacts: { contactName: 'contact_name', sortOrder: 'sort_order' },
};

export const FROM_DB = {};
for (const [tbl, map] of Object.entries(TO_DB)) {
  FROM_DB[tbl] = {};
  for (const [k, v] of Object.entries(map)) FROM_DB[tbl][v] = k;
}

export function toDb(store, obj) {
  const map = TO_DB[store];
  if (!map) return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[map[k] || k] = v;
  return o;
}

export function fromDb(store, obj) {
  if (!obj) return obj;
  const map = FROM_DB[store];
  if (!map) return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[map[k] || k] = v;
  return o;
}
