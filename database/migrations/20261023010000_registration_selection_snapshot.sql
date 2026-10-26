BEGIN;

-- Historical rows intentionally remain NULL: their original selection cannot
-- be reconstructed reliably from today's catalog or customer contact records.
ALTER TABLE orgs.registration_metadata
    ADD COLUMN IF NOT EXISTS registration_snapshot JSONB;

COMMIT;
