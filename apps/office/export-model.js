// Master Excel Export — normalized business-definition layer. Pure functions
// only (no DOM, no fetch, no main.js import) so this is unit-testable in
// isolation, same convention as packages/business/*.js. These are the
// deterministic rules documented in docs/planning/25-excel-export-data-audit.md
// after auditing the real data before writing any of this — every threshold/
// rule here traces to either an existing Office definition (reused, not
// reinvented) or an explicit new rule written up in that doc because nothing
// reusable existed.
import { calcLineItemsTotal, officeVatRate, normAddr, fuzzyScore } from '@business';

// ── Invoice totals — §1 of the audit doc ────────────────────────────────
// invoices.total/subtotal/paid_amount are NOT reliable (62% fill rate, and
// paid_amount is 0% across all 590 real invoices) — the authoritative figure
// is what Office itself shows for that invoice right now: computed from
// items against the CURRENT global VAT rate, exactly like calcInvTotal()
// does. Never reads the stored total/subtotal/paid_amount columns.
export function computeInvoiceFinancials(inv, S) {
  const vatRate = officeVatRate(S);
  const { sub, vat, grand } = calcLineItemsTotal(inv.items || [], vatRate);
  const isPaid = inv.status === 'Paid';
  const paid = isPaid ? grand : 0;
  const outstanding = isPaid ? 0 : grand;
  let daysOverdue = 0;
  if (!isPaid && inv.dueDate) {
    const days = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
    if (days > 0) daysOverdue = days;
  }
  return { subtotal: sub, vat, total: grand, paid, outstanding, daysOverdue, vatRate };
}

// ── Certificate status — reused verbatim from certs-stats-dashboard.js's
// own thresholds (Expired <0, Expiring 0-60, Current >60, Missing = no
// expiryDate and not noExpiry) so the export never disagrees with the
// Certificates Dashboard page a user can see live in Office.
export function certStatus(cert, dueSoonDays = 60) {
  if (cert.noExpiry) return 'no_expiry';
  if (!cert.expiryDate) return 'missing';
  const days = Math.floor((new Date(cert.expiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= dueSoonDays) return 'expiring';
  return 'current';
}

// ── Job work classification — §2 of the audit doc. No existing classifier
// exists anywhere in the app; this is new, built from the app's own
// S.certTypes keyword lists (the same lists already used elsewhere to
// detect a cert type from free text) rather than an invented vocabulary.
// Deliberately conservative: anything that doesn't cleanly resolve returns
// 'needs_review' rather than guessing, per the spec's explicit instruction.
const WORK_KEYWORDS = [
  'replace', 'repair', 'install', 'fit', 'fault', 'upgrade', 'snagging',
  'tripping', 'tripped', 'broken', 'leak', 'leaking', 'fix', 'additional',
  'new socket', 'sockets', 'rewire', 'supply and fit', 'change', 'renew',
  'not working', 'investigat', 'replaced', 'damaged', 'redone',
];

export function classifyJobWork(job, S) {
  const certTypes = S.certTypes || [];
  // job.certTypes is the app-level (post fromDb() mapping) field name for
  // the DB's certtypes column — see packages/data/mapping.js TO_DB.jobs.
  const jobCertCodes = new Set(job.certTypes || []);
  const text = [job.description, job.notes, job.trade].filter(Boolean).join(' ').toLowerCase().trim();

  if (!text) {
    // No free text at all — a job with recorded cert types and nothing else
    // written down reads as certificate-only, but this is the one case the
    // audit doc flags as genuinely ambiguous (could just be an unfilled
    // description). Still resolves it (not 'needs_review') since the app
    // has no better signal available, but callers can distinguish via the
    // second return value if they want to flag it separately.
    return jobCertCodes.size > 0 ? 'cert_only' : 'needs_review';
  }

  const certKeywords = new Set();
  certTypes
    .filter((ct) => jobCertCodes.has(ct.id))
    .forEach((ct) => (ct.keywords || []).forEach((k) => certKeywords.add(k)));
  // No matched cert type at all (certtypes empty/unknown) — fall back to
  // every known cert keyword across all types, so a job that's plausibly
  // "just a cert visit" worded generically isn't misclassified for lacking
  // a certtypes entry.
  if (certKeywords.size === 0) {
    certTypes.forEach((ct) => (ct.keywords || []).forEach((k) => certKeywords.add(k)));
  }

  const hasWorkSignal = WORK_KEYWORDS.some((k) => text.includes(k));
  if (hasWorkSignal) return 'additional_work';

  // Strip every recognized cert keyword out of the text; if nothing
  // meaningful survives, it's cert-only. If unrecognized text remains, it's
  // ambiguous rather than guessed either way.
  let remainder = text;
  [...certKeywords].forEach((k) => { remainder = remainder.split(k).join(' '); });
  remainder = remainder.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!remainder) return 'cert_only';
  // Short leftover fragments (numbers, single short words like "flat",
  // "cert", punctuation debris) aren't a reliable work signal either way.
  if (remainder.length <= 4) return 'cert_only';
  return 'needs_review';
}

// ── "Project" = 2+ real job_visits rows sharing one jobId — reused
// verbatim from planner-projects.js's own definition (not a stored flag).
export function groupVisitsByJob(visits) {
  const byJob = new Map();
  (visits || []).forEach((v) => {
    if (!v.jobId) return;
    if (!byJob.has(v.jobId)) byJob.set(v.jobId, []);
    byJob.get(v.jobId).push(v);
  });
  const projectJobIds = new Set();
  byJob.forEach((list, jobId) => { if (list.length >= 2) projectJobIds.add(jobId); });
  return { byJob, projectJobIds };
}

// ── Excel worksheet name safety — max 31 chars, no : \ / ? * [ ] , and
// must be unique within the workbook. Deterministic: truncates then
// appends a short numeric suffix only on an actual collision, so the same
// input always produces the same output across export runs.
const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;
export function safeSheetName(rawName, usedNames) {
  let base = (rawName || 'Unnamed').replace(INVALID_SHEET_CHARS, '').trim();
  if (!base) base = 'Unnamed';
  base = base.slice(0, 31);
  if (!usedNames.has(base)) { usedNames.add(base); return base; }
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!usedNames.has(candidate)) { usedNames.add(candidate); return candidate; }
  }
  // Practically unreachable (would need 999 identically-truncated names),
  // but never return a colliding name silently.
  throw new Error(`safeSheetName: could not find a unique name for "${rawName}"`);
}

// ── Duplicate-property batch scan — §4 of the audit doc: the app has an
// interactive duplicate check at save time (_checkDuplicateProperty in
// main.js) but nothing scans the stored table afterward. Reuses the exact
// same normAddr + fuzzyScore signals (postcode-matched candidates need
// >0.4, postcode-less need >0.6) rather than inventing a new threshold.
export function findDuplicateProperties(properties) {
  const groups = [];
  const seen = new Set();
  for (let i = 0; i < properties.length; i++) {
    if (seen.has(properties[i].id)) continue;
    const a = properties[i];
    const keyA = normAddr(a.address);
    const matches = [a];
    for (let j = i + 1; j < properties.length; j++) {
      if (seen.has(properties[j].id)) continue;
      const b = properties[j];
      if (a.postcode && b.postcode && a.postcode !== b.postcode) continue;
      const score = fuzzyScore(keyA, normAddr(b.address));
      const threshold = a.postcode && b.postcode ? 0.4 : 0.6;
      if (score > threshold) matches.push(b);
    }
    if (matches.length > 1) {
      matches.forEach((m) => seen.add(m.id));
      groups.push(matches);
    }
  }
  return groups;
}

// ── Job/property/agency name-matching helpers — the free-text fields
// (landlordName/agencyName/agentName) are the complete/reliable source
// (§4 of the audit doc); FK ids are supplementary only.
export function jobsForAgency(jobs, agency) {
  return jobs.filter((j) => j.agencyName === agency.name || j.clientAgencyId === agency.id);
}
export function jobsForPerson(jobs, person) {
  return jobs.filter((j) => j.referrer === person.name || j.landlordName === person.name || j.clientPersonId === person.id);
}
