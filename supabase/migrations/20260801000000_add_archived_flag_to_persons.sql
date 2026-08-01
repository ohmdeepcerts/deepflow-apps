-- Archive (not delete) support for Directory people — landlords especially.
-- A person who's gone quiet ("Joseph" — old client, expired certs, may
-- come back) shouldn't be deleted (that would orphan their job/invoice/
-- cert history) but also shouldn't clutter the active landlord list.
-- Office App hides archived=true people from the Landlords/All People/
-- Subcontractors grids by default, with a "Show archived" toggle, and a
-- dedicated Archive/Restore button on the person modal (not a delete).
ALTER TABLE persons ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
