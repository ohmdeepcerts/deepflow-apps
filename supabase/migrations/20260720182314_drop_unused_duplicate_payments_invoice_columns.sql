-- payments had three columns that all looked like the same "which invoice
-- this payment is for" foreign key: inv_id, invid, invoice_id. The app
-- (index.html's _TO_DB mapping) only ever reads/writes inv_id. Verified
-- before dropping: payments currently has 0 rows (nothing to lose), no
-- constraints, triggers, or functions reference invid or invoice_id
-- anywhere in the database. Leftover cruft from an earlier schema
-- iteration, not a live dependency.
ALTER TABLE payments DROP COLUMN IF EXISTS invid;
ALTER TABLE payments DROP COLUMN IF EXISTS invoice_id;
