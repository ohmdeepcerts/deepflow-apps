-- my_user_id(): resolves the calling user's own users.id, covering both
-- auth methods in this app — real Supabase Auth session (Office, and
-- Engineer password-mode) via auth.uid(), or the Engineer phone+PIN
-- token session via the x-engineer-token header (same header
-- my_token_engineer_name()/is_valid_engineer_token() already read).
-- Needed because portal_push_subscribe's design (the client supplies
-- p_table/p_id directly) is safe for Portal, which has no session to
-- misuse, but would be a real hole for authenticated staff — a
-- malicious/curious caller could subscribe on someone else's behalf.
-- Staff subscriptions resolve their own identity server-side instead.
CREATE OR REPLACE FUNCTION public.my_user_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id text; v_token text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_id FROM users WHERE auth_id = auth.uid() AND active = true LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  BEGIN
    v_token := current_setting('request.headers', true)::json->>'x-engineer-token';
  EXCEPTION WHEN OTHERS THEN v_token := NULL; END;
  IF v_token IS NOT NULL AND v_token <> '' THEN
    SELECT id INTO v_id FROM users
    WHERE session_token = v_token AND role = 'engineer' AND active = true
      AND session_expires > extract(epoch from now())::bigint
    LIMIT 1;
  END IF;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text;
BEGIN
  v_uid := my_user_id();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO push_subscriptions(entity_table, entity_id, endpoint, p256dh, auth)
  VALUES ('users', v_uid, p_endpoint, p_p256dh, p_auth)
  ON CONFLICT (endpoint) DO UPDATE SET entity_table=EXCLUDED.entity_table, entity_id=EXCLUDED.entity_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth;
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_push_unsubscribe(p_endpoint text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text;
BEGIN
  v_uid := my_user_id();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM push_subscriptions WHERE endpoint = p_endpoint AND entity_table = 'users' AND entity_id = v_uid;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.my_user_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_push_subscribe(text,text,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_push_unsubscribe(text) TO anon, authenticated;
