BEGIN;

CREATE TABLE IF NOT EXISTS orgs.message_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    template_key text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    version integer NOT NULL DEFAULT 1,
    subject text,
    body text NOT NULL,
    variables jsonb NOT NULL DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (organization_id, template_key, version)
);

CREATE TABLE IF NOT EXISTS orgs.message_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    recipient_destination text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS orgs.message_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    event_id uuid REFERENCES orgs.message_events(id) ON DELETE CASCADE,
    template_id uuid REFERENCES orgs.message_templates(id) ON DELETE SET NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'sms')),
    provider text NOT NULL,
    status text NOT NULL CHECK (status IN ('delivered', 'failed', 'retry')),
    provider_message_id text,
    attempts integer NOT NULL DEFAULT 1,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_message_logs_org_event
    ON orgs.message_logs (organization_id, event_id);

COMMIT;
