/**
 * The complete PostgreSQL target shape for a new Festival database.
 *
 * This intentionally creates an empty, final schema only. It contains no
 * compatibility migration, data conversion, or reset operation.
 */
import { sql } from "bun";

export function postgresSchemaName(schema: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema)) {
		throw new Error("Database schema is invalid.");
	}
	return schema;
}

export function buildCanonicalPostgresSchemaSql(schema: string): string {
	const safeSchema = postgresSchemaName(schema);

	return `
		CREATE SCHEMA IF NOT EXISTS ${safeSchema};
		CREATE EXTENSION IF NOT EXISTS pgcrypto;

		CREATE TABLE IF NOT EXISTS ${safeSchema}.organizations (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			slug TEXT NOT NULL UNIQUE,
			timezone TEXT NOT NULL DEFAULT 'UTC',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.organization_divisions (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE RESTRICT,
			display_name TEXT NOT NULL,
			normalized_name TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			display_order INTEGER NOT NULL CHECK (display_order >= 0),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.users (
			id TEXT PRIMARY KEY,
			firebase_uid TEXT NOT NULL UNIQUE,
			email TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			disassociated BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.memberships (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES ${safeSchema}.users (id) ON DELETE CASCADE,
			role TEXT NOT NULL,
			origin TEXT NOT NULL,
			joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			welcome_dismissed_at TIMESTAMPTZ NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.invites (
			id TEXT PRIMARY KEY,
			token TEXT NOT NULL UNIQUE,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			email TEXT NOT NULL,
			role TEXT NOT NULL,
			invited_by_user_id TEXT NOT NULL REFERENCES ${safeSchema}.users (id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			accepted_at TIMESTAMPTZ NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festivals (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			code TEXT NOT NULL,
			short_name TEXT NOT NULL,
			is_primary BOOLEAN NOT NULL DEFAULT FALSE,
			name TEXT NOT NULL,
			start_date DATE NOT NULL,
			end_date DATE NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_integrations (
			organization_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			store_domain TEXT NOT NULL,
			client_id TEXT NOT NULL,
			encrypted_client_secret TEXT NOT NULL,
			encrypted_storefront_private_token TEXT NULL,
			verification_status TEXT NOT NULL DEFAULT 'unknown' CHECK (verification_status IN ('unknown', 'ok', 'failed')),
			verified_shop_gid TEXT NULL,
			verified_shop_domain TEXT NULL,
			granted_scopes TEXT[] NOT NULL DEFAULT '{}',
			can_read_products BOOLEAN NOT NULL DEFAULT FALSE,
			can_write_products BOOLEAN NOT NULL DEFAULT FALSE,
			can_read_orders BOOLEAN NOT NULL DEFAULT FALSE,
			integration_version BIGINT NOT NULL DEFAULT 1 CHECK (integration_version > 0),
			verified_at TIMESTAMPTZ NULL,
			last_tested_at TIMESTAMPTZ NULL,
			last_error TEXT NULL,
			last_failure_category TEXT NULL CHECK (last_failure_category IS NULL OR last_failure_category IN ('credentials', 'identity_mismatch', 'shop_ownership_conflict', 'missing_scope', 'transport', 'upstream')),
			webhook_readiness_status TEXT NOT NULL DEFAULT 'unknown' CHECK (webhook_readiness_status IN ('unknown', 'checking', 'ready', 'failed')),
			webhook_checked_at TIMESTAMPTZ NULL,
			webhook_error TEXT NULL,
			webhook_failure_category TEXT NULL CHECK (webhook_failure_category IS NULL OR webhook_failure_category IN ('configuration', 'missing_scope', 'permission', 'protected_data', 'callback', 'transport', 'upstream')),
			webhook_request_id TEXT NULL CHECK (webhook_request_id IS NULL OR webhook_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CONSTRAINT shopify_integrations_webhook_result_check CHECK (
				(webhook_readiness_status = 'unknown' AND webhook_checked_at IS NULL AND webhook_error IS NULL AND webhook_failure_category IS NULL AND webhook_request_id IS NULL)
				OR (webhook_readiness_status IN ('checking', 'ready') AND webhook_checked_at IS NOT NULL AND webhook_error IS NULL AND webhook_failure_category IS NULL AND webhook_request_id IS NULL)
				OR (webhook_readiness_status = 'failed' AND webhook_checked_at IS NOT NULL AND webhook_error IS NOT NULL AND webhook_failure_category IS NOT NULL)
			)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.products (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			product_category TEXT NOT NULL CHECK (product_category IN ('membership')),
			entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 36500),
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			shopify_product_gid TEXT NOT NULL,
			shopify_variant_gid TEXT NOT NULL,
			product_name_snapshot TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.accompanist_division_policies (
			organization_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			policy TEXT NOT NULL DEFAULT 'one_to_all' CHECK (policy IN ('exactly_one', 'one_to_two', 'one_to_all')),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.accompanist_division_policy_history (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			policy TEXT NOT NULL CHECK (policy IN ('exactly_one', 'one_to_two', 'one_to_all')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.accompanist_membership_grants (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL,
			normalized_email TEXT NOT NULL,
			offering_id TEXT NOT NULL REFERENCES ${safeSchema}.products (id),
			offering_name_snapshot TEXT NOT NULL,
			source TEXT NOT NULL CHECK (source = 'accompanist_form'),
			contact_name TEXT NOT NULL, contact_email TEXT NOT NULL, contact_city TEXT NOT NULL, contact_phone TEXT NOT NULL,
			divisions JSONB NOT NULL,
			starts_on DATE NOT NULL, ends_on DATE NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'expired')),
			is_current BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (ends_on > starts_on)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.registration_age_configurations (
			organization_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			registration_age_date DATE NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.registration_catalog_values (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK (kind IN ('class_subtype', 'instrument')),
			display_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			display_order INTEGER NOT NULL CHECK (display_order >= 0),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (organization_id, kind, normalized_name), UNIQUE (organization_id, kind, display_order)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_class_configurations (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			festival_id TEXT NOT NULL REFERENCES ${safeSchema}.festivals (id) ON DELETE RESTRICT,
			display_name TEXT NOT NULL,
			class_subtype_id TEXT NOT NULL REFERENCES ${safeSchema}.registration_catalog_values (id),
			division_id TEXT NOT NULL REFERENCES ${safeSchema}.organization_divisions (id),
			minimum_age INTEGER NOT NULL, maximum_age INTEGER NOT NULL,
			price TEXT NOT NULL, maximum_performance_pieces INTEGER NOT NULL,
			performance_minutes INTEGER NOT NULL, capacity INTEGER NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			shopify_product_gid TEXT NOT NULL UNIQUE, shopify_variant_gid TEXT NOT NULL UNIQUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (minimum_age >= 0 AND maximum_age >= minimum_age AND maximum_performance_pieces IN (1, 2, 3) AND performance_minutes > 0 AND capacity > 0)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_customers (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			shopify_customer_gid TEXT NOT NULL,
			name TEXT NULL, name_source TEXT NULL CHECK (name_source IN ('shopify','festival')), name_updated_at TIMESTAMPTZ NULL,
			email TEXT NULL, email_source TEXT NULL CHECK (email_source IN ('shopify','festival')), email_updated_at TIMESTAMPTZ NULL,
			mailing_address JSONB NULL, mailing_address_source TEXT NULL CHECK (mailing_address_source IN ('shopify','festival')), mailing_address_updated_at TIMESTAMPTZ NULL,
			phone TEXT NULL, phone_source TEXT NULL CHECK (phone_source IN ('shopify','festival')), phone_updated_at TIMESTAMPTZ NULL,
			created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
			UNIQUE (organization_id, shopify_customer_gid), UNIQUE (id, organization_id), UNIQUE (id, organization_id, shopify_customer_gid)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_customer_account_integrations (
			organization_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			storefront_domain TEXT NOT NULL, client_id TEXT NOT NULL, encrypted_client_secret TEXT NOT NULL,
			readiness TEXT NOT NULL DEFAULT 'unknown' CHECK (readiness IN ('unknown','ready','failed')),
			can_read_orders BOOLEAN NOT NULL DEFAULT FALSE, integration_version BIGINT NOT NULL DEFAULT 1 CHECK (integration_version > 0),
			verified_at TIMESTAMPTZ NULL, last_error TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_customer_oauth_states (
			state_hash TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			nonce TEXT NOT NULL, return_to TEXT NOT NULL, offering_id TEXT NULL, expires_at TIMESTAMPTZ NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_customer_sessions (
			session_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL, shopify_customer_gid TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, csrf_token TEXT NOT NULL,
			integration_version BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ NULL,
			FOREIGN KEY (customer_id,organization_id,shopify_customer_gid) REFERENCES ${safeSchema}.festival_customers(id,organization_id,shopify_customer_gid) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_customer_staff_consents (
			customer_id TEXT NOT NULL, organization_id TEXT NOT NULL, privacy_notice_version TEXT NOT NULL,
			consented_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (customer_id,privacy_notice_version),
			FOREIGN KEY (customer_id,organization_id) REFERENCES ${safeSchema}.festival_customers(id,organization_id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_customer_profile_access_audit (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			actor_uid TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('view','search')),
			target_customer_id TEXT NULL, result_count INTEGER NULL CHECK (result_count >= 0), occurred_at TIMESTAMPTZ NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_children (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, parent_customer_id TEXT NOT NULL,
			display_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.festival_child_age_snapshots (
			id TEXT PRIMARY KEY, child_id TEXT NOT NULL, organization_id TEXT NOT NULL,
			age INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL, superseded_at TIMESTAMPTZ NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.checkout_carts (
			reference TEXT PRIMARY KEY, shopify_cart_id TEXT NOT NULL,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL, session_id TEXT NOT NULL, integration_version BIGINT NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('ready', 'checkout_started', 'expired', 'superseded')),
			expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.checkout_intents (
			id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL UNIQUE,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL, session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
			offering_id TEXT NOT NULL REFERENCES ${safeSchema}.products (id), entitlement_class TEXT NOT NULL, duration_days INTEGER NOT NULL,
			shopify_product_gid TEXT NOT NULL, shopify_variant_gid TEXT NOT NULL, policy_version TEXT NOT NULL,
			division_id TEXT NULL, division_name_snapshot TEXT NULL, staff_access_consent BOOLEAN NOT NULL DEFAULT FALSE,
			amount TEXT NOT NULL, currency_code TEXT NOT NULL, cart_reference TEXT NULL REFERENCES ${safeSchema}.checkout_carts (reference),
			status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'checkout_started', 'failed', 'expired', 'superseded', 'approved', 'rejected', 'needs_review')),
			expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.entitlement_grants (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL, entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			offering_id TEXT NOT NULL REFERENCES ${safeSchema}.products (id), duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 36500),
			division_id TEXT NOT NULL REFERENCES ${safeSchema}.organization_divisions (id), division_name_snapshot TEXT NOT NULL,
			paid_amount TEXT NOT NULL, paid_currency_code TEXT NOT NULL CHECK (paid_currency_code ~ '^[A-Z]{3}$'),
			checkout_intent_id TEXT NOT NULL UNIQUE, shopify_order_gid TEXT NOT NULL, shopify_order_line_gid TEXT NOT NULL UNIQUE,
			starts_on DATE NOT NULL, ends_on DATE NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK (ends_on > starts_on)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_webhook_deliveries (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			shop_domain TEXT NOT NULL, webhook_id TEXT NOT NULL, topic TEXT NOT NULL CHECK (topic = 'orders/paid'),
			api_version TEXT NOT NULL CHECK (api_version = '2026-07'), shopify_order_gid TEXT NOT NULL,
			payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
			status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'failed')),
			attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
			failure_category TEXT NULL CHECK (failure_category IN ('upstream', 'persistence', 'invalid')),
			received_at TIMESTAMPTZ NOT NULL, processing_started_at TIMESTAMPTZ NULL, processed_at TIMESTAMPTZ NULL,
			UNIQUE (organization_id, webhook_id)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.shopify_order_projections (
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			shopify_order_gid TEXT NOT NULL, shopify_customer_gid TEXT NULL, correlation_id TEXT NULL,
			fully_paid_at TIMESTAMPTZ NULL, currency_code TEXT NULL,
			created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
			PRIMARY KEY (organization_id, shopify_order_gid)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_validation_decisions (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NULL, checkout_intent_id TEXT NULL, shopify_order_gid TEXT NOT NULL, shopify_order_line_gid TEXT NULL,
			status TEXT NOT NULL CHECK (status IN ('pending_validation', 'approved', 'rejected', 'needs_review')),
			reason_code TEXT NULL CHECK (reason_code IS NULL OR reason_code IN ('correlation_missing', 'correlation_invalid', 'intent_expired', 'order_not_paid', 'payment_incomplete', 'payment_mismatch', 'customer_mismatch', 'offering_mismatch', 'division_invalid', 'duplicate_purchase', 'policy_mismatch', 'upstream_invalid')),
			created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
			UNIQUE (organization_id, shopify_order_gid), UNIQUE (organization_id, shopify_order_line_gid)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_reconciliation_runs (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
			discovered_count INTEGER NOT NULL CHECK (discovered_count >= 0), processed_count INTEGER NOT NULL CHECK (processed_count >= 0),
			started_at TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ NOT NULL,
			failure_category TEXT NULL CHECK (failure_category IN ('upstream', 'persistence', 'invalid'))
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.app_user (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(), firebase_uid VARCHAR(128) NOT NULL UNIQUE,
			email VARCHAR(320) NOT NULL, full_name VARCHAR(255), is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.user_login_event (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES ${safeSchema}.app_user(id) ON DELETE CASCADE,
			firebase_uid VARCHAR(128) NOT NULL, provider VARCHAR(64) NOT NULL, ip_address INET, user_agent TEXT,
			login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE OR REPLACE FUNCTION ${safeSchema}.enforce_shopify_shop_ownership()
		RETURNS TRIGGER AS $$
		BEGIN
			PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_domain, 0));
			IF NEW.verified_shop_domain IS NOT NULL THEN
				PERFORM pg_advisory_xact_lock(hashtextextended(NEW.verified_shop_domain, 0));
			END IF;
			IF EXISTS (SELECT 1 FROM ${safeSchema}.shopify_integrations existing WHERE existing.organization_id <> NEW.organization_id AND (existing.store_domain = NEW.store_domain OR existing.verified_shop_domain = NEW.store_domain OR (NEW.verified_shop_domain IS NOT NULL AND (existing.store_domain = NEW.verified_shop_domain OR existing.verified_shop_domain = NEW.verified_shop_domain)))) THEN
				RAISE EXCEPTION 'Shopify shop ownership conflict' USING ERRCODE = '23505';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		DO $create_trigger$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_shopify_shop_ownership' AND tgrelid = '${safeSchema}.shopify_integrations'::regclass) THEN
				CREATE TRIGGER enforce_shopify_shop_ownership BEFORE INSERT OR UPDATE OF store_domain, verified_shop_domain ON ${safeSchema}.shopify_integrations FOR EACH ROW EXECUTE FUNCTION ${safeSchema}.enforce_shopify_shop_ownership();
			END IF;
		END $create_trigger$;

		CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_divisions_name ON ${safeSchema}.organization_divisions (organization_id, normalized_name);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_divisions_order ON ${safeSchema}.organization_divisions (organization_id, display_order);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_org ON ${safeSchema}.memberships (user_id, organization_id);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_org_code ON ${safeSchema}.festivals (organization_id, code);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_org_short_name ON ${safeSchema}.festivals (organization_id, short_name);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_one_primary ON ${safeSchema}.festivals (organization_id) WHERE is_primary;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_org_name_lower ON ${safeSchema}.festivals (organization_id, LOWER(name));
		CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_store_domain ON ${safeSchema}.shopify_integrations (store_domain);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_verified_domain ON ${safeSchema}.shopify_integrations (verified_shop_domain) WHERE verified_shop_domain IS NOT NULL;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_verified_gid ON ${safeSchema}.shopify_integrations (verified_shop_gid) WHERE verified_shop_gid IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_products_organization_id ON ${safeSchema}.products (organization_id);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_product_gid ON ${safeSchema}.products (shopify_product_gid);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_variant_gid ON ${safeSchema}.products (shopify_variant_gid);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_product_variant_gid ON ${safeSchema}.products (shopify_product_gid, shopify_variant_gid);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_products_org_active_entitlement_class ON ${safeSchema}.products (organization_id, entitlement_class) WHERE product_category = 'membership' AND is_active;
		CREATE INDEX IF NOT EXISTS idx_entitlement_grants_tenant_customer ON ${safeSchema}.entitlement_grants (organization_id, customer_id, created_at);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_accompanist_current_customer ON ${safeSchema}.accompanist_membership_grants (organization_id, customer_id) WHERE is_current;
		CREATE UNIQUE INDEX IF NOT EXISTS idx_accompanist_current_email ON ${safeSchema}.accompanist_membership_grants (organization_id, normalized_email) WHERE is_current;
		CREATE INDEX IF NOT EXISTS idx_shopify_customer_sessions_org ON ${safeSchema}.shopify_customer_sessions(organization_id);
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_name ON ${safeSchema}.festival_customers(organization_id,LOWER(name));
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_email ON ${safeSchema}.festival_customers(organization_id,LOWER(email));
		CREATE INDEX IF NOT EXISTS idx_festival_customers_org_phone ON ${safeSchema}.festival_customers(organization_id,phone);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_festival_children_parent_name ON ${safeSchema}.festival_children(organization_id, parent_customer_id, LOWER(display_name));
		CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_scope_key ON ${safeSchema}.checkout_intents(organization_id, customer_id, session_id, idempotency_key);
		CREATE INDEX IF NOT EXISTS membership_validation_customer_idx ON ${safeSchema}.membership_validation_decisions (organization_id, customer_id, created_at DESC);
		CREATE UNIQUE INDEX IF NOT EXISTS membership_validation_checkout_intent_idx ON ${safeSchema}.membership_validation_decisions (organization_id, checkout_intent_id) WHERE checkout_intent_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS shopify_webhook_reclaim_idx ON ${safeSchema}.shopify_webhook_deliveries (organization_id, status, received_at);
		CREATE INDEX IF NOT EXISTS membership_reconciliation_runs_tenant_idx ON ${safeSchema}.membership_reconciliation_runs (organization_id, finished_at DESC);
		CREATE INDEX IF NOT EXISTS idx_user_login_user_id ON ${safeSchema}.user_login_event(user_id);
		CREATE INDEX IF NOT EXISTS idx_user_login_firebase_uid ON ${safeSchema}.user_login_event(firebase_uid);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower ON ${safeSchema}.app_user(lower(email));
	`;
}

const initializations = new Map<string, Promise<void>>();

/** Initializes an empty schema without modifying rows in an existing one. */
export async function initializePostgresSchema(schema: string): Promise<void> {
	const safeSchema = postgresSchemaName(schema);
	const existing = initializations.get(safeSchema);
	if (existing) return existing;

	const initialization = sql.begin(async (transaction) => {
		await transaction.unsafe(
			"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
			[safeSchema],
		);
		await transaction.unsafe(buildCanonicalPostgresSchemaSql(safeSchema));
	});
	initializations.set(safeSchema, initialization);
	try {
		await initialization;
	} catch (error) {
		initializations.delete(safeSchema);
		throw error;
	}
}
