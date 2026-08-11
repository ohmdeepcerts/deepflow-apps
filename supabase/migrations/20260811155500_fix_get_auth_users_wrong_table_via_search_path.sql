-- get_auth_users()'s admin check (added 2026-08-08) queries an unqualified
-- `users` table inside a function with `SET search_path TO 'auth', 'public'`.
-- Since auth.users genuinely exists, Postgres resolves the unqualified name
-- to auth.users FIRST (search_path order), not the app's own public.users —
-- and auth.users has no auth_id/active columns, so the check has thrown
-- `column "auth_id" does not exist` (42703) on every single call since that
-- migration, for every caller including genuine admins. Confirmed live via
-- `select public.get_auth_users();` before this fix. Qualifying the
-- subquery's table as public.users is the fix — the RETURN QUERY's
-- `FROM auth.users u` below is already correctly qualified and untouched.
CREATE OR REPLACE FUNCTION public.get_auth_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE auth_id = auth.uid() AND lower(role) = 'admin' AND active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text, u.created_at FROM auth.users u ORDER BY u.created_at DESC;
END;
$function$;
