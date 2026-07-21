-- The 'df_access' policy ("any authenticated user OR any valid engineer
-- token gets ALL access") exists identically on 6 tables: jobs, users,
-- attachments, engineer_requests, engineer_alerts, app_settings. Every one
-- of these tables also has more carefully role-scoped policies (is_office(),
-- can_delete checks, own-record-only, etc.) added later — but because
-- Postgres RLS OR-combines permissive policies, df_access alone granted
-- blanket access regardless of what the more careful policies said,
-- silently making all of them moot. In practice this meant: any logged-in
-- user of ANY role (including Finance/Staff/Viewer, who the application's
-- own UI already restricts) could read, insert, update, or delete ANY row
-- in these tables by calling the Supabase REST API directly, bypassing the
-- app's client-side permission checks entirely. This migration removes
-- df_access everywhere and, where it was the only thing granting
-- engineer-token (PIN-based Engineer Portal) sessions access at all,
-- replaces it with an equivalently-scoped, properly role-checked policy —
-- so nothing legitimate breaks, only the blanket bypass is closed.

-- Mirrors my_engineer_name() (which resolves via auth.uid()) but for
-- PIN/token-based Engineer Portal sessions, which authenticate via a
-- custom x-engineer-token header rather than a real Supabase Auth session.
CREATE OR REPLACE FUNCTION public.my_token_engineer_name()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_token text; v_name text;
BEGIN
  BEGIN
    v_token := current_setting('request.headers', true)::json->>'x-engineer-token';
  EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
  IF v_token IS NULL OR v_token = '' THEN RETURN NULL; END IF;
  SELECT name INTO v_name FROM users
  WHERE session_token = v_token
    AND role = 'engineer'
    AND active = true
    AND session_expires > extract(epoch from now())::bigint;
  RETURN v_name;
END;
$function$;

-- ── app_settings ── df_access here never covered engineer tokens (its
-- qual was auth.uid() IS NOT NULL only) — settings_office_only and
-- portal_settings_read already correctly cover every legitimate case, so
-- this is a clean drop with no replacement needed.
DROP POLICY IF EXISTS df_access ON app_settings;

-- ── jobs ──
DROP POLICY IF EXISTS df_access ON jobs;
DROP POLICY IF EXISTS jobs_office_all ON jobs;
CREATE POLICY jobs_office_select ON jobs FOR SELECT TO authenticated USING (is_office());
CREATE POLICY jobs_office_insert ON jobs FOR INSERT TO authenticated WITH CHECK (is_office());
CREATE POLICY jobs_office_update ON jobs FOR UPDATE TO authenticated USING (is_office()) WITH CHECK (is_office());
-- Delete now actually requires can_delete=true (or admin/manager) at the
-- database level, matching what the app's UI has checked client-side since
-- this session's earlier fix — previously df_access meant that check was
-- purely cosmetic and trivially bypassable via a direct API call.
CREATE POLICY jobs_office_delete ON jobs FOR DELETE TO authenticated USING (
  is_office() AND EXISTS (
    SELECT 1 FROM users WHERE auth_id = auth.uid() AND (can_delete = true OR role IN ('admin','manager'))
  )
);
CREATE POLICY jobs_engineer_token_select ON jobs FOR SELECT TO public USING (
  is_valid_engineer_token() AND engineer = my_token_engineer_name()
);
CREATE POLICY jobs_engineer_token_update ON jobs FOR UPDATE TO public USING (
  is_valid_engineer_token() AND engineer = my_token_engineer_name()
) WITH CHECK (
  is_valid_engineer_token() AND engineer = my_token_engineer_name()
);

-- ── users ── (users_office_all / users_engineer_own_read already correctly
-- scoped for the auth.uid() path and left unchanged; only replacing what
-- df_access uniquely provided for token sessions — reading their own record)
DROP POLICY IF EXISTS df_access ON users;
CREATE POLICY users_engineer_token_own_read ON users FOR SELECT TO public USING (
  is_valid_engineer_token() AND session_token = (current_setting('request.headers', true)::json->>'x-engineer-token')
);

-- ── attachments ── (matches attachments_engineer_own's existing breadth —
-- not job-scoped there either — so token sessions get equivalent, not
-- reduced, capability)
DROP POLICY IF EXISTS df_access ON attachments;
CREATE POLICY attachments_engineer_token ON attachments FOR ALL TO public USING (
  is_valid_engineer_token()
) WITH CHECK (
  is_valid_engineer_token()
);

-- ── engineer_requests ── (scoped to the token's own engineer name, matching
-- eng_requests_engineer_own's auth.uid() equivalent)
DROP POLICY IF EXISTS df_access ON engineer_requests;
CREATE POLICY eng_requests_engineer_token ON engineer_requests FOR ALL TO public USING (
  is_valid_engineer_token() AND engineer_name = my_token_engineer_name()
) WITH CHECK (
  is_valid_engineer_token() AND engineer_name = my_token_engineer_name()
);

-- ── engineer_alerts ── (auth_users_only already grants any authenticated
-- user unconditional ALL access — roles={authenticated} only, so it never
-- covered anon/token sessions; this replaces df_access's equivalent
-- coverage for token sessions specifically, same breadth, not more)
DROP POLICY IF EXISTS df_access ON engineer_alerts;
CREATE POLICY engineer_alerts_token ON engineer_alerts FOR ALL TO public USING (
  is_valid_engineer_token()
) WITH CHECK (
  is_valid_engineer_token()
);
