BEGIN;

-- Admission is a soft cutoff, not a reservation. Serialize only the
-- final count/read and attachment with count/capacity mutations.
-- BEFORE STATEMENT takes the lock before row locks, including direct SQL
-- and multi-line fulfillment, avoiding inconsistent lock ordering.
CREATE OR REPLACE FUNCTION orgs.lock_class_capacity_cutoff()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('orgs:class-capacity-cutoff', 0));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DO $capacity_triggers$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lock_class_capacity_cutoff' AND tgrelid = 'orgs.festival_class_configurations'::regclass) THEN
        CREATE TRIGGER lock_class_capacity_cutoff BEFORE INSERT OR UPDATE OR DELETE ON orgs.festival_class_configurations FOR EACH STATEMENT EXECUTE FUNCTION orgs.lock_class_capacity_cutoff();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lock_class_capacity_cutoff' AND tgrelid = 'orgs.class_entitlements'::regclass) THEN
        CREATE TRIGGER lock_class_capacity_cutoff BEFORE INSERT OR UPDATE OR DELETE ON orgs.class_entitlements FOR EACH STATEMENT EXECUTE FUNCTION orgs.lock_class_capacity_cutoff();
    END IF;
END $capacity_triggers$;

COMMIT;
