-- saveCreditNote() in the Office App has always written linkedInvId (the
-- original invoice being credited) and reason (a structured dropdown value)
-- to the invoices table, but neither column existed, so PostgREST rejected
-- every credit-note save with a 400 (uncaught, since the JS has no try/catch
-- around this write) — the Credit Note feature has never worked.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linkedinvid text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reason text;
