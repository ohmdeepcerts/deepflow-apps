-- trg_auto_admin (AFTER INSERT ON auth.users) recreates the primary admin's
-- public.users profile if it's ever missing, as a disaster-recovery path.
-- Its INSERT column list still included "pin", a plaintext column that no
-- longer exists on public.users (superseded by pin_hash/pin_fail_count/
-- pin_locked_until/pin_reset_allowed when engineer PIN login moved to
-- bcrypt). As written, the trigger would fail with "column pin does not
-- exist" the moment it actually fired, breaking the very recovery signup
-- it exists to handle. Office login doesn't use pin/pin_hash at all (real
-- Supabase Auth password login, keyed on auth_id) — the column was just
-- stale, so it's dropped from the INSERT rather than replaced.
CREATE OR REPLACE FUNCTION public.auto_create_admin_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(NEW.email) = 'mandeepdynamics@gmail.com' THEN
    INSERT INTO users (
      id, name, email, auth_id, role, active,
      can_edit, can_delete, can_invoice, can_finance,
      see_landlord, see_landlord_phone, see_agent, see_contact, see_price,
      created
    ) VALUES (
      gen_random_uuid(),
      'Admin',
      'mandeepdynamics@gmail.com',
      NEW.id,
      'admin',
      true,
      true, true, true, true,
      true, true, true, true, true,
      extract(epoch from now())::bigint
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
