ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postcode text;

UPDATE jobs
SET postcode = upper(substring(address from '([A-Za-z]{1,2}[0-9][0-9A-Za-z]?\s*[0-9][A-Za-z]{2})\s*$'))
WHERE postcode IS NULL AND address IS NOT NULL AND address != '';

CREATE INDEX IF NOT EXISTS jobs_postcode_idx ON jobs(postcode);
