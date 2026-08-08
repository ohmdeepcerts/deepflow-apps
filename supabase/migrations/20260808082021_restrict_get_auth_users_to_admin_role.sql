-- get_auth_users() was gated by is_office(), which returns true for any
-- active non-engineer role (manager/finance/staff/viewer), letting any of
-- them call the RPC directly and read every auth.users email + created_at.
-- The actual UI gate (apps/office/main.js loadTeam()) is Admin-only
-- ("SECURITY: Only Admins can manage the team") — this brings the server
-- check in line with that intent instead of the looser office-wide check.
CREATE OR REPLACE FUNCTION public.get_auth_users()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'auth', 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND lower(role) = 'admin' AND active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text, u.created_at FROM auth.users u ORDER BY u.created_at DESC;
END;
$function$;
