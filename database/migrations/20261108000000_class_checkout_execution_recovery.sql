BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs',0));
CREATE TABLE IF NOT EXISTS orgs.class_checkout_executions (
    intent_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, customer_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, request_snapshot JSONB NOT NULL,
    state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','running','retryable','recovery_required','completed','rejected')),
    checkpoint TEXT NOT NULL DEFAULT 'prepared' CHECK (checkpoint IN ('prepared','create_dispatched','remote_cart_known','attached')),
    generation BIGINT NOT NULL DEFAULT 0 CHECK (generation >= 0),
    lease_owner TEXT NULL, lease_expires_at TIMESTAMPTZ NULL,
    shopify_cart_id TEXT NULL, result_code TEXT NULL,
    recovery_reference TEXT NOT NULL UNIQUE, recovery_recorded_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
    CHECK ((state = 'running') = (lease_owner IS NOT NULL)),
    FOREIGN KEY (intent_id, organization_id) REFERENCES orgs.checkout_intents(id, organization_id) ON DELETE RESTRICT,
    UNIQUE (intent_id, organization_id)
);
CREATE TABLE IF NOT EXISTS orgs.class_checkout_execution_events (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, intent_id TEXT NOT NULL,
    generation BIGINT NOT NULL, event_type TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (intent_id, organization_id) REFERENCES orgs.class_checkout_executions(intent_id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS class_checkout_executions_recovery_idx ON orgs.class_checkout_executions (organization_id,customer_id,state);
CREATE INDEX IF NOT EXISTS class_checkout_execution_events_intent_idx ON orgs.class_checkout_execution_events (organization_id,intent_id,created_at);

COMMIT;
