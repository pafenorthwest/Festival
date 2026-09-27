BEGIN;

CREATE TABLE IF NOT EXISTS orgs.registration_change_logs (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    festival_id text REFERENCES orgs.festivals(id) ON DELETE CASCADE,
    class_entitlement_id text NOT NULL REFERENCES orgs.class_entitlements(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('drop', 'transfer', 'waitlist_promote', 'revert')),
    actor_uid text NOT NULL,
    actor_role text NOT NULL CHECK (actor_role IN ('customer', 'admin', 'system')),
    previous_state jsonb NOT NULL,
    new_state jsonb NOT NULL,
    reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_registration_change_logs_org_class_entitlement
    ON orgs.registration_change_logs (organization_id, class_entitlement_id);

CREATE INDEX IF NOT EXISTS idx_registration_change_logs_org_festival
    ON orgs.registration_change_logs (organization_id, festival_id);

CREATE TABLE IF NOT EXISTS orgs.refund_events (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    registration_change_log_id text REFERENCES orgs.registration_change_logs(id) ON DELETE SET NULL,
    class_entitlement_id text REFERENCES orgs.class_entitlements(id) ON DELETE CASCADE,
    shopify_order_id text,
    shopify_refund_id text,
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_refund_events_org_class_entitlement
    ON orgs.refund_events (organization_id, class_entitlement_id);

COMMIT;
