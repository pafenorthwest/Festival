BEGIN;

-- Stop before DDL if historical rows would make the new one-to-one
-- constraints ambiguous. This migration never relinks, removes, or infers
-- paid-line identities.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM orgs.checkout_intent_lines
        GROUP BY checkout_intent_id, line_index
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce checkout_intent_lines (checkout_intent_id, line_index) uniqueness: duplicate rows exist.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM orgs.class_entitlements
        WHERE checkout_intent_line_id IS NOT NULL
        GROUP BY checkout_intent_line_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot enforce class_entitlements checkout_intent_line_id uniqueness: duplicate rows exist.';
    END IF;
END
$$;

ALTER TABLE orgs.refund_events
    ADD COLUMN IF NOT EXISTS shopify_order_line_id text;

-- Existing intents deliberately remain NULL/unmarked. New class checkouts
-- write the current protocol marker before emitting cart-line identities.
ALTER TABLE orgs.checkout_intents
    ADD COLUMN IF NOT EXISTS line_identity_protocol text;

CREATE UNIQUE INDEX IF NOT EXISTS checkout_intent_lines_checkout_intent_id_line_index_key
    ON orgs.checkout_intent_lines (checkout_intent_id, line_index);

CREATE UNIQUE INDEX IF NOT EXISTS class_entitlements_checkout_intent_line_id_key
    ON orgs.class_entitlements (checkout_intent_line_id)
    WHERE checkout_intent_line_id IS NOT NULL;

COMMIT;
