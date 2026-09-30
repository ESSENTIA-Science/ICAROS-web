-- LOCAL ONLY. Apply only to an existing local icaros schema after review.
-- Keep the original upload limit after size becomes the measured object size.
BEGIN;
ALTER TABLE icaros.media ADD COLUMN declared_size bigint;
UPDATE icaros.media SET declared_size = size WHERE size > 0;
ALTER TABLE icaros.media ADD CONSTRAINT media_declared_size_ck
  CHECK (declared_size IS NULL OR declared_size > 0);
COMMIT;
