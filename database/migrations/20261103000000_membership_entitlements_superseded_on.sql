BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

ALTER TABLE orgs.membership_entitlements
    ADD COLUMN IF NOT EXISTS superseded_on date,
    ADD COLUMN IF NOT EXISTS superseded_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS superseded_by_grant_id text REFERENCES orgs.membership_entitlements(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE orgs.membership_entitlements
    DROP CONSTRAINT IF EXISTS membership_entitlements_superseded_on_check,
    ADD CONSTRAINT membership_entitlements_superseded_on_check
    CHECK (((superseded_on IS NULL) OR ((superseded_on >= starts_on) AND (superseded_on <= ends_on))));

ALTER TABLE orgs.membership_entitlements
    DROP CONSTRAINT IF EXISTS membership_entitlements_organization_id_customer_id_entitl_excl,
    ADD CONSTRAINT membership_entitlements_organization_id_customer_id_entitl_excl
    EXCLUDE USING gist (organization_id WITH =, customer_id WITH =, entitlement_class WITH =, daterange(starts_on, COALESCE(superseded_on, ends_on), '[)'::text) WITH &&) WHERE ((revoked_at IS NULL));

COMMIT;
