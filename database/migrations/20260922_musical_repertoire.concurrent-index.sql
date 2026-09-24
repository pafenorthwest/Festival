-- Phase one of 20260922_musical_repertoire.sql.
--
-- Run this file by itself, with a client that does not wrap migration files in
-- a transaction. CREATE INDEX CONCURRENTLY is prohibited in a transaction
-- block. Follow database/migrations/README.md for validation and recovery.
CREATE UNIQUE INDEX CONCURRENTLY registration_metadata_id_organization_id_key
    ON orgs.registration_metadata (id, organization_id);
