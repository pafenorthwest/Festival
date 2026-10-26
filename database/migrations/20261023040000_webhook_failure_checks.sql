BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'orgs.shopify_webhook_deliveries'::regclass
          AND conname = 'shopify_webhook_deliveries_failure_stage_check'
    ) THEN
        ALTER TABLE orgs.shopify_webhook_deliveries
            ADD CONSTRAINT shopify_webhook_deliveries_failure_stage_check
            CHECK (failure_stage IN ('order_read', 'projection'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'orgs.shopify_webhook_deliveries'::regclass
          AND conname = 'shopify_webhook_deliveries_failure_code_check'
    ) THEN
        ALTER TABLE orgs.shopify_webhook_deliveries
            ADD CONSTRAINT shopify_webhook_deliveries_failure_code_check
            CHECK (failure_code IS NULL OR failure_code IN ('shopify_upstream', 'shopify_transport', 'invalid_data', 'paid_line_conflict', 'persistence', 'unexpected'));
    END IF;
END;
$$;

ALTER TABLE orgs.shopify_webhook_deliveries VALIDATE CONSTRAINT shopify_webhook_deliveries_failure_stage_check;
ALTER TABLE orgs.shopify_webhook_deliveries VALIDATE CONSTRAINT shopify_webhook_deliveries_failure_code_check;

COMMIT;
