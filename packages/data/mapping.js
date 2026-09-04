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
    clientPersonId: 'client_person_id', clientAgencyId: 'client_agency_id', propertyId: 'property_id',
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
    linkedInvId: 'linkedinvid', certTypes: 'certtypes', jobDate: 'jobdate', vatAmount: 'vat_amount',
    billToOverride: 'bill_to_override', pdfUrl: 'pdf_url', pdfPath: 'pdf_path',
    clientPersonId: 'client_person_id', clientAgencyId: 'client_agency_id',
  },
  agents: { agencyId: 'agencyid', lockCertsUntilPaid: 'lockcertsuntilpaid' },
  persons: { agencyId: 'agencyid', bankName: 'bankname', bankAcc: 'bankacc', bankSort: 'banksort', bankRef: 'bankref', lockCertsUntilPaid: 'lockcertsuntilpaid' },
  agencies: { bankName: 'bankname', bankAcc: 'bankacc', bankSort: 'banksort', bankRef: 'bankref', lockCertsUntilPaid: 'lockcertsuntilpaid' },
  payments: { invId: 'inv_id', recordedBy: 'recorded_by' },
  expenses: { jobRef: 'jobref', desc: 'description' },
  overtime: {},
  portal_contacts: { contactName: 'contact_name', sortOrder: 'sort_order' },
  job_visits: { jobId: 'jobid', visitDate: 'visit_date' },
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

// Postgres `numeric` columns come back from PostgREST as JSON *strings*
// (to preserve precision beyond what a JS float can hold safely) — fromDb()
// otherwise only renames keys, so these arrive here still as strings.
// Left uncoerced, summing them with `+` doesn't add — `+` only performs
// numeric addition when BOTH sides are already numbers; with either side
// a string it concatenates instead, so `0 + "30.00" + "30.00"` produces
// the string "030.0030.00", and Number() of that is NaN. A single payment
// happens to "work" by accident (`0 + "30.00"` parses fine as a lone
// string), which is exactly why this went unnoticed until an invoice had
// a second payment recorded against it — every totalPaid/amountPaid
// calculation in the app (savePayment, markInvPaid, the invoice PDF's
// Paid/Partial stamp, dashboard revenue, XLSX export) reduces over this
// same field, so one fix here covers all of them instead of patching
// each call site — and any future call site inherits the fix for free.
// Every `numeric` column any app actually reads back through this
// repository — not just the two that had already been caught live.
// Checked directly against the schema (`information_schema.columns`,
// `data_type in ('numeric','decimal')`) rather than waiting for the next
// one to surface as a bug report: jobs.price and expenses.cost had the
// exact same unguarded `.reduce((s,x)=>s+x.price,0)` /
// `s+e.cost` pattern as payments.amount did (apps/office/main.js's
// dashboard revenue chart, apps/office/expenses.js's total-cost sum) —
// both silently wrong on any day/list with more than one item, for the
// identical reason. invoices.subtotal/total/paid_amount and
// persons.hourly_rate/rate are real numeric columns too but are never
// read through fromDb() anywhere in the app (subtotal/vat/total are
// deliberately never sent or read back — see the comment at
// apps/office/main.js's invoice-save call — always recomputed
// client-side instead); overtime.hours/engineer_requests.hours are read,
// but every existing call site already wraps them in Number(), so they
// were never actually exposed to this bug. Left out rather than coerced
// blind, since a column nothing reads can't have this bug regardless.
const NUMERIC_FIELDS = {
  payments: ['amount'],
  invoices: ['vatAmount'],
  jobs: ['price'],
  expenses: ['cost'],
};

export function fromDb(store, obj) {
  if (!obj) return obj;
  const map = FROM_DB[store] || {};
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[map[k] || k] = v;
  for (const f of NUMERIC_FIELDS[store] || []) {
    if (typeof o[f] === 'string' && o[f] !== '') o[f] = Number(o[f]);
  }
  return o;
}
