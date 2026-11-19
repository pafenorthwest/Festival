BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

CREATE INDEX IF NOT EXISTS idx_class_checkout_executions_running_lease
  ON orgs.class_checkout_executions USING btree (organization_id, lease_expires_at)
  WHERE (state = 'running'::text);

COMMIT;
