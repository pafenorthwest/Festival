BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

ALTER TABLE orgs.class_checkout_executions
    ADD COLUMN IF NOT EXISTS storefront_binding JSONB;

COMMIT;
