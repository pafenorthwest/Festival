BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_repertoire_contributors_name_trgm
  ON orgs.repertoire_contributors USING gin (normalized_name public.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_repertoire_works_active_title_trgm
  ON orgs.repertoire_works USING gin (normalized_title public.gin_trgm_ops)
  WHERE is_active;

COMMIT;
