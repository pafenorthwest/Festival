BEGIN;

CREATE TABLE IF NOT EXISTS orgs.customer_festival_availability (
    organization_id TEXT NOT NULL REFERENCES orgs.organizations (id) ON DELETE CASCADE,
    festival_id TEXT NOT NULL REFERENCES orgs.festivals (id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('accompanist', 'child')),
    subject_id TEXT NOT NULL,
    festival_date DATE NOT NULL,
    available_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, festival_id, subject_type, subject_id, festival_date),
    FOREIGN KEY (festival_id, organization_id) REFERENCES orgs.festivals (id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id, organization_id) REFERENCES orgs.festival_customers (id, organization_id) ON DELETE CASCADE,
    CONSTRAINT chk_customer_festival_availability_hours CHECK (jsonb_typeof(available_hours) = 'array' AND available_hours <@ '[8,9,10,11,12,13,14,15,16,17]'::jsonb)
);

CREATE INDEX IF NOT EXISTS idx_customer_festival_availability_org_festival_customer ON orgs.customer_festival_availability (organization_id, festival_id, customer_id);

COMMIT;
