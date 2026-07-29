-- The public.settings table was empty (0 rows), had no FK references from
-- any other table, and app code (packages/data/repository.js) explicitly
-- special-cases the 'settings' store to stay local-only (localStorage,
-- via saveSetting/saveAllSettings) rather than ever querying this table.
-- Confirmed dead in the Production Readiness Audit (L-2); dropped with
-- explicit user go-ahead.
DROP TABLE public.settings;
