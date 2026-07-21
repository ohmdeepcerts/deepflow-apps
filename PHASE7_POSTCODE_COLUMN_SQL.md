# Postcode as its own column (jobs)

## What this adds

A `postcode` column on `jobs`, auto-extracted from the existing `address`
text field — the visible address field itself doesn't change at all, this
is purely a background column other features (routing, area-based
grouping, more accurate property matching) can key off later.

Tested the extraction pattern directly against your real live data before
writing this: correctly pulled `IG1 1JP`, `SE15 1QS`, and `E15 2BF` out of
real addresses, and correctly returned nothing for junk/test rows with no
real postcode in them.

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postcode text;

UPDATE jobs
SET postcode = upper(substring(address from '([A-Za-z]{1,2}[0-9][0-9A-Za-z]?\s*[0-9][A-Za-z]{2})\s*$'))
WHERE postcode IS NULL AND address IS NOT NULL AND address != '';

CREATE INDEX IF NOT EXISTS jobs_postcode_idx ON jobs(postcode);
```

Going forward, `saveJob()` in the Office App extracts and saves the
postcode automatically every time a job is created or edited, using the
exact same pattern, so this stays correct without needing to re-run the
backfill.
