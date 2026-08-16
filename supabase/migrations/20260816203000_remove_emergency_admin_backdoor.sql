-- Removes the "owner lockout recovery" mechanism found during the security
-- audit (docs/security/17-security.md §1, docs/security/18-known-issues.md):
-- a trigger that silently recreated an admin `users` profile for a
-- hardcoded email whenever that email signed up in Supabase Auth, bypassing
-- the normal role system. Flagged as a deliberate-but-standing backdoor;
-- account owner decided to remove it rather than keep/restrict it, now that
-- the protected account (mandeepdynamics@gmail.com) has a normal, real
-- admin `users` row and doesn't need an automatic self-heal path.
--
-- The matching client-side half (PROTECTED_ADMINS/EMERGENCY_ADMINS in
-- apps/office/main.js, and the Settings > Team "permanently protected"
-- notice in apps/office/index.html) was removed in the same change.
DROP TRIGGER IF EXISTS trg_auto_admin ON auth.users;
DROP FUNCTION IF EXISTS auto_create_admin_profile();
