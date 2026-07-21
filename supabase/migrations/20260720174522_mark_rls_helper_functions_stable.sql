-- These functions are pure lookups keyed by auth.uid()/the request's
-- engineer-token header — deterministic within a single statement (the
-- calling user's identity can't change mid-query). Marked VOLATILE (the
-- Postgres default) they were being re-evaluated by the planner on every
-- single row an RLS-protected query touched, instead of once per query.
-- STABLE lets Postgres cache the result and reuse it across rows, which
-- matters increasingly as jobs/users/attachments grow — was flagged but not
-- yet fixed in the earlier Data Layer audit (Finding 8). No behavior change,
-- only how often the underlying users-table lookup actually runs.
ALTER FUNCTION public.is_office() STABLE;
ALTER FUNCTION public.is_engineer() STABLE;
ALTER FUNCTION public.is_valid_engineer_token() STABLE;
ALTER FUNCTION public.my_engineer_name() STABLE;
ALTER FUNCTION public.my_token_engineer_name() STABLE;
