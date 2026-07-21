-- invoice_payments was a separate, entirely empty (0 rows) payments table
-- that only one place in the app ever queried (the per-invoice audit
-- trail), and nothing ever wrote to it — every real payment goes into the
-- `payments` table instead. That one read was just fixed to query the
-- correct table. Verified before dropping: 0 rows, only its own primary
-- key constraint, no other table/function/trigger references it. Keeping
-- an empty, fully-unreferenced duplicate table around is exactly the kind
-- of ambiguity ("which one is real?") that caused this bug in the first
-- place.
DROP TABLE IF EXISTS invoice_payments;
