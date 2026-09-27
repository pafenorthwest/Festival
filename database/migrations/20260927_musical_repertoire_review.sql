BEGIN;

ALTER TABLE orgs.repertoire_works
    ADD COLUMN IF NOT EXISTS imslp_url text;

CREATE TABLE IF NOT EXISTS orgs.repertoire_review_items (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    organization_id text NOT NULL REFERENCES orgs.organizations(id) ON DELETE CASCADE,
    registration_repertoire_item_id text NOT NULL UNIQUE REFERENCES orgs.registration_repertoire_items(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'approved', 'flagged')),
    claimed_by_uid text,
    claimed_by_name text,
    claimed_at timestamptz,
    flag_reason text,
    flag_notes text,
    reviewer_notes text,
    resolved_work_id text REFERENCES orgs.repertoire_works(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_repertoire_review_items_org_status
    ON orgs.repertoire_review_items (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_repertoire_review_items_org_claimed
    ON orgs.repertoire_review_items (organization_id, claimed_by_uid);

COMMIT;
