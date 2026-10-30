BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('orgs', 0));

-- Supporting keys for tenant-scoped foreign keys. These are safe to create
-- repeatedly and cannot introduce duplicates because each leading id is a PK.
CREATE UNIQUE INDEX IF NOT EXISTS registration_catalog_values_id_organization_key
    ON orgs.registration_catalog_values (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_children_id_organization_key
    ON orgs.festival_children (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_children_id_organization_parent_key
    ON orgs.festival_children (id, organization_id, parent_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_class_configurations_id_organization_key
    ON orgs.festival_class_configurations (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_class_configurations_id_organization_festival_key
    ON orgs.festival_class_configurations (id, organization_id, festival_id);
CREATE UNIQUE INDEX IF NOT EXISTS festival_class_waitlist_entries_reference_key
    ON orgs.festival_class_waitlist_entries
       (id, organization_id, festival_class_id, parent_customer_id, child_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_id_organization_key
    ON orgs.checkout_intents (id, organization_id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM orgs.festival_child_age_snapshots
        WHERE superseded_at IS NULL
        GROUP BY organization_id, child_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce one active child age snapshot: duplicate active rows exist';
    END IF;
END;
$$;

-- Replace the earlier id-only self-reference so deleting a required subtype
-- cannot clear a reference in another organization.
ALTER TABLE orgs.registration_catalog_values
    DROP CONSTRAINT IF EXISTS registration_catalog_values_required_subtype_id_fkey;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM orgs.registration_catalog_values ref
        JOIN orgs.registration_catalog_values target
          ON target.id = ref.required_subtype_id
         AND target.organization_id = ref.organization_id
        WHERE ref.required_subtype_id IS NOT NULL
          AND target.kind <> 'class_subtype'
    ) OR EXISTS (
        SELECT 1
        FROM orgs.festival_class_configurations ref
        JOIN orgs.registration_catalog_values target
          ON target.id = ref.class_subtype_id
         AND target.organization_id = ref.organization_id
        WHERE target.kind <> 'class_subtype'
    ) OR EXISTS (
        SELECT 1
        FROM orgs.festival_class_subtypes ref
        JOIN orgs.registration_catalog_values target
          ON target.id = ref.class_subtype_id
         AND target.organization_id = ref.organization_id
        WHERE target.kind <> 'class_subtype'
    ) THEN
        RAISE EXCEPTION 'Cannot enforce registration subtype kind: existing references target non-subtype catalog values';
    END IF;
END;
$$;

-- The application supersedes the previous row before inserting a new age
-- snapshot. This index also protects that invariant when concurrent requests
-- race or SQL is issued outside the repository.
CREATE UNIQUE INDEX IF NOT EXISTS idx_festival_child_age_snapshots_one_active
    ON orgs.festival_child_age_snapshots (organization_id, child_id)
    WHERE superseded_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.registration_catalog_values'::regclass AND conname = 'registration_catalog_values_required_subtype_tenant_fkey') THEN
        ALTER TABLE orgs.registration_catalog_values
            ADD CONSTRAINT registration_catalog_values_required_subtype_tenant_fkey
            FOREIGN KEY (required_subtype_id, organization_id)
            REFERENCES orgs.registration_catalog_values (id, organization_id)
            ON DELETE SET NULL (required_subtype_id) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_configurations'::regclass AND conname = 'festival_class_configurations_festival_tenant_fkey') THEN
        ALTER TABLE orgs.festival_class_configurations
            ADD CONSTRAINT festival_class_configurations_festival_tenant_fkey
            FOREIGN KEY (festival_id, organization_id)
            REFERENCES orgs.festivals (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_configurations'::regclass AND conname = 'festival_class_configurations_subtype_tenant_fkey') THEN
        ALTER TABLE orgs.festival_class_configurations
            ADD CONSTRAINT festival_class_configurations_subtype_tenant_fkey
            FOREIGN KEY (class_subtype_id, organization_id)
            REFERENCES orgs.registration_catalog_values (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_configurations'::regclass AND conname = 'festival_class_configurations_division_tenant_fkey') THEN
        ALTER TABLE orgs.festival_class_configurations
            ADD CONSTRAINT festival_class_configurations_division_tenant_fkey
            FOREIGN KEY (division_id, organization_id)
            REFERENCES orgs.organization_divisions (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_subtypes'::regclass AND conname = 'festival_class_subtypes_subtype_tenant_fkey') THEN
        ALTER TABLE orgs.festival_class_subtypes
            ADD CONSTRAINT festival_class_subtypes_subtype_tenant_fkey
            FOREIGN KEY (class_subtype_id, organization_id)
            REFERENCES orgs.registration_catalog_values (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_capacity_audit_logs'::regclass AND conname = 'festival_class_capacity_audit_logs_class_scope_fkey') THEN
        ALTER TABLE orgs.festival_class_capacity_audit_logs
            ADD CONSTRAINT festival_class_capacity_audit_logs_class_scope_fkey
            FOREIGN KEY (festival_class_id, organization_id, festival_id)
            REFERENCES orgs.festival_class_configurations (id, organization_id, festival_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_children'::regclass AND conname = 'festival_children_organization_fkey') THEN
        ALTER TABLE orgs.festival_children
            ADD CONSTRAINT festival_children_organization_fkey
            FOREIGN KEY (organization_id)
            REFERENCES orgs.organizations (id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_children'::regclass AND conname = 'festival_children_parent_customer_tenant_fkey') THEN
        ALTER TABLE orgs.festival_children
            ADD CONSTRAINT festival_children_parent_customer_tenant_fkey
            FOREIGN KEY (parent_customer_id, organization_id)
            REFERENCES orgs.festival_customers (id, organization_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_child_age_snapshots'::regclass AND conname = 'festival_child_age_snapshots_child_tenant_fkey') THEN
        ALTER TABLE orgs.festival_child_age_snapshots
            ADD CONSTRAINT festival_child_age_snapshots_child_tenant_fkey
            FOREIGN KEY (child_id, organization_id)
            REFERENCES orgs.festival_children (id, organization_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_waitlist_entries'::regclass AND conname = 'festival_class_waitlist_entries_class_scope_fkey') THEN
        ALTER TABLE orgs.festival_class_waitlist_entries
            ADD CONSTRAINT festival_class_waitlist_entries_class_scope_fkey
            FOREIGN KEY (festival_class_id, organization_id, festival_id)
            REFERENCES orgs.festival_class_configurations (id, organization_id, festival_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_waitlist_entries'::regclass AND conname = 'festival_class_waitlist_entries_parent_tenant_fkey') THEN
        ALTER TABLE orgs.festival_class_waitlist_entries
            ADD CONSTRAINT festival_class_waitlist_entries_parent_tenant_fkey
            FOREIGN KEY (parent_customer_id, organization_id)
            REFERENCES orgs.festival_customers (id, organization_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_waitlist_entries'::regclass AND conname = 'festival_class_waitlist_entries_child_parent_fkey') THEN
        ALTER TABLE orgs.festival_class_waitlist_entries
            ADD CONSTRAINT festival_class_waitlist_entries_child_parent_fkey
            FOREIGN KEY (child_id, organization_id, parent_customer_id)
            REFERENCES orgs.festival_children (id, organization_id, parent_customer_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.festival_class_waitlist_events'::regclass AND conname = 'festival_class_waitlist_events_entry_scope_fkey') THEN
        ALTER TABLE orgs.festival_class_waitlist_events
            ADD CONSTRAINT festival_class_waitlist_events_entry_scope_fkey
            FOREIGN KEY (waitlist_entry_id, organization_id, festival_class_id, parent_customer_id, child_id)
            REFERENCES orgs.festival_class_waitlist_entries (id, organization_id, festival_class_id, parent_customer_id, child_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.checkout_intents'::regclass AND conname = 'checkout_intents_class_tenant_fkey') THEN
        ALTER TABLE orgs.checkout_intents
            ADD CONSTRAINT checkout_intents_class_tenant_fkey
            FOREIGN KEY (festival_class_id, organization_id)
            REFERENCES orgs.festival_class_configurations (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.checkout_intents'::regclass AND conname = 'checkout_intents_child_tenant_fkey') THEN
        ALTER TABLE orgs.checkout_intents
            ADD CONSTRAINT checkout_intents_child_tenant_fkey
            FOREIGN KEY (child_id, organization_id)
            REFERENCES orgs.festival_children (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.checkout_recovery_requests'::regclass AND conname = 'checkout_recovery_requests_intent_tenant_fkey') THEN
        ALTER TABLE orgs.checkout_recovery_requests
            ADD CONSTRAINT checkout_recovery_requests_intent_tenant_fkey
            FOREIGN KEY (source_checkout_intent_id, organization_id)
            REFERENCES orgs.checkout_intents (id, organization_id)
            ON DELETE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.class_entitlements'::regclass AND conname = 'class_entitlements_class_scope_fkey') THEN
        ALTER TABLE orgs.class_entitlements
            ADD CONSTRAINT class_entitlements_class_scope_fkey
            FOREIGN KEY (festival_class_id, organization_id, festival_id)
            REFERENCES orgs.festival_class_configurations (id, organization_id, festival_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.class_entitlements'::regclass AND conname = 'class_entitlements_child_parent_fkey') THEN
        ALTER TABLE orgs.class_entitlements
            ADD CONSTRAINT class_entitlements_child_parent_fkey
            FOREIGN KEY (child_id, organization_id, parent_customer_id)
            REFERENCES orgs.festival_children (id, organization_id, parent_customer_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orgs.class_entitlements'::regclass AND conname = 'class_entitlements_checkout_intent_tenant_fkey') THEN
        ALTER TABLE orgs.class_entitlements
            ADD CONSTRAINT class_entitlements_checkout_intent_tenant_fkey
            FOREIGN KEY (checkout_intent_id, organization_id)
            REFERENCES orgs.checkout_intents (id, organization_id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION orgs.validate_catalog_subtype_reference()
RETURNS TRIGGER AS $$
DECLARE
    target_id TEXT;
    target_kind TEXT;
BEGIN
    IF TG_TABLE_NAME = 'registration_catalog_values' THEN
        target_id := NEW.required_subtype_id;
    ELSE
        target_id := NEW.class_subtype_id;
    END IF;
    IF target_id IS NULL THEN RETURN NEW; END IF;
    SELECT kind INTO target_kind
    FROM orgs.registration_catalog_values
    WHERE id = target_id AND organization_id = NEW.organization_id
    FOR SHARE;
    IF target_kind IS DISTINCT FROM 'class_subtype' THEN
        RAISE EXCEPTION 'Registration subtype reference must point to a class_subtype value'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION orgs.prevent_referenced_catalog_kind_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.kind IS DISTINCT FROM OLD.kind AND (
        EXISTS (SELECT 1 FROM orgs.registration_catalog_values v WHERE v.organization_id = OLD.organization_id AND v.required_subtype_id = OLD.id)
        OR EXISTS (SELECT 1 FROM orgs.festival_class_configurations c WHERE c.organization_id = OLD.organization_id AND c.class_subtype_id = OLD.id)
        OR EXISTS (SELECT 1 FROM orgs.festival_class_subtypes s WHERE s.organization_id = OLD.organization_id AND s.class_subtype_id = OLD.id)
    ) THEN
        RAISE EXCEPTION 'Cannot change the kind of a referenced registration catalog value'
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'registration_catalog_values_validate_required_subtype' AND tgrelid = 'orgs.registration_catalog_values'::regclass) THEN
        CREATE TRIGGER registration_catalog_values_validate_required_subtype BEFORE INSERT OR UPDATE OF required_subtype_id, organization_id ON orgs.registration_catalog_values FOR EACH ROW EXECUTE FUNCTION orgs.validate_catalog_subtype_reference();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'festival_class_configurations_validate_subtype_kind' AND tgrelid = 'orgs.festival_class_configurations'::regclass) THEN
        CREATE TRIGGER festival_class_configurations_validate_subtype_kind BEFORE INSERT OR UPDATE OF class_subtype_id, organization_id ON orgs.festival_class_configurations FOR EACH ROW EXECUTE FUNCTION orgs.validate_catalog_subtype_reference();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'festival_class_subtypes_validate_subtype_kind' AND tgrelid = 'orgs.festival_class_subtypes'::regclass) THEN
        CREATE TRIGGER festival_class_subtypes_validate_subtype_kind BEFORE INSERT OR UPDATE OF class_subtype_id, organization_id ON orgs.festival_class_subtypes FOR EACH ROW EXECUTE FUNCTION orgs.validate_catalog_subtype_reference();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'registration_catalog_values_prevent_referenced_kind_change' AND tgrelid = 'orgs.registration_catalog_values'::regclass) THEN
        CREATE TRIGGER registration_catalog_values_prevent_referenced_kind_change BEFORE UPDATE OF kind ON orgs.registration_catalog_values FOR EACH ROW EXECUTE FUNCTION orgs.prevent_referenced_catalog_kind_change();
    END IF;
END;
$$;

ALTER TABLE orgs.registration_catalog_values VALIDATE CONSTRAINT registration_catalog_values_required_subtype_tenant_fkey;
ALTER TABLE orgs.festival_class_configurations VALIDATE CONSTRAINT festival_class_configurations_festival_tenant_fkey;
ALTER TABLE orgs.festival_class_configurations VALIDATE CONSTRAINT festival_class_configurations_subtype_tenant_fkey;
ALTER TABLE orgs.festival_class_configurations VALIDATE CONSTRAINT festival_class_configurations_division_tenant_fkey;
ALTER TABLE orgs.festival_class_subtypes VALIDATE CONSTRAINT festival_class_subtypes_subtype_tenant_fkey;
ALTER TABLE orgs.festival_class_capacity_audit_logs VALIDATE CONSTRAINT festival_class_capacity_audit_logs_class_scope_fkey;
ALTER TABLE orgs.festival_children VALIDATE CONSTRAINT festival_children_organization_fkey;
ALTER TABLE orgs.festival_children VALIDATE CONSTRAINT festival_children_parent_customer_tenant_fkey;
ALTER TABLE orgs.festival_child_age_snapshots VALIDATE CONSTRAINT festival_child_age_snapshots_child_tenant_fkey;
ALTER TABLE orgs.festival_class_waitlist_entries VALIDATE CONSTRAINT festival_class_waitlist_entries_class_scope_fkey;
ALTER TABLE orgs.festival_class_waitlist_entries VALIDATE CONSTRAINT festival_class_waitlist_entries_parent_tenant_fkey;
ALTER TABLE orgs.festival_class_waitlist_entries VALIDATE CONSTRAINT festival_class_waitlist_entries_child_parent_fkey;
ALTER TABLE orgs.festival_class_waitlist_events VALIDATE CONSTRAINT festival_class_waitlist_events_entry_scope_fkey;
ALTER TABLE orgs.checkout_intents VALIDATE CONSTRAINT checkout_intents_class_tenant_fkey;
ALTER TABLE orgs.checkout_intents VALIDATE CONSTRAINT checkout_intents_child_tenant_fkey;
ALTER TABLE orgs.checkout_recovery_requests VALIDATE CONSTRAINT checkout_recovery_requests_intent_tenant_fkey;
ALTER TABLE orgs.class_entitlements VALIDATE CONSTRAINT class_entitlements_class_scope_fkey;
ALTER TABLE orgs.class_entitlements VALIDATE CONSTRAINT class_entitlements_child_parent_fkey;
ALTER TABLE orgs.class_entitlements VALIDATE CONSTRAINT class_entitlements_checkout_intent_tenant_fkey;

COMMIT;
