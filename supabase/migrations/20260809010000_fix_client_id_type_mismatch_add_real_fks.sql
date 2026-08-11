-- Blocks the type change below: references client_person_id/
-- client_agency_id via current_setting('app.portal_token', true), a
-- Postgres session variable no application code anywhere in this repo
-- ever sets (Portal's real auth model resolves identity through
-- SECURITY DEFINER RPC parameters instead, bypassing RLS entirely — see
-- docs/architecture/08-authentication-and-roles.md). Since nothing ever
-- sets app.portal_token, current_setting() always returns NULL here, and
-- `x = NULL` is never true in SQL — this policy has never granted access
-- to a single row under any real request. Confirmed dead, not just
-- unreachable, so dropped rather than preserved across the type change.
DROP POLICY IF EXISTS clients_view_own_attachments ON public.attachments;

-- jobs.client_person_id/client_agency_id and invoices.client_person_id/
-- client_agency_id were declared `uuid`, but persons.id/agencies.id (what
-- they're meant to reference) are `text` — every id in this app is
-- actually a UUID-*shaped* string generated client-side by uid()
-- (apps/office/main.js), not a real Postgres uuid, so writes always
-- succeeded (PostgREST coerces a UUID-formatted string into the uuid
-- type fine) but a real FK constraint across the two different declared
-- types was never possible. All 4 tables are empty right now (post the
-- 2026-08-06 data reset), so this is a lossless type change with zero
-- rows to migrate — the ideal moment to fix this properly rather than
-- leave it as a permanently-loose reference.
ALTER TABLE public.jobs ALTER COLUMN client_person_id TYPE text;
ALTER TABLE public.jobs ALTER COLUMN client_agency_id TYPE text;
ALTER TABLE public.invoices ALTER COLUMN client_person_id TYPE text;
ALTER TABLE public.invoices ALTER COLUMN client_agency_id TYPE text;

-- ON DELETE SET NULL rather than RESTRICT/CASCADE: removing a person/
-- agency from the Directory should never be blocked by, or cascade-delete,
-- old job/invoice history — it should just fall back to the existing
-- name-matching resolution, exactly as it already does today for any row
-- where this id was never populated in the first place.
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_client_person_id_fkey FOREIGN KEY (client_person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_client_agency_id_fkey FOREIGN KEY (client_agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_client_person_id_fkey FOREIGN KEY (client_person_id) REFERENCES public.persons(id) ON DELETE SET NULL;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_client_agency_id_fkey FOREIGN KEY (client_agency_id) REFERENCES public.agencies(id) ON DELETE SET NULL;
