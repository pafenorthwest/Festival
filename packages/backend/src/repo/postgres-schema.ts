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
		CREATE EXTENSION IF NOT EXISTS btree_gist;

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
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (id, organization_id)
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
			can_write_inventory BOOLEAN NOT NULL DEFAULT FALSE,
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
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_division_policies (
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			policy TEXT NOT NULL CHECK (policy IN ('exactly_one', 'one_to_two', 'one_to_all')),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (organization_id, entitlement_class)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_division_policy_history (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			policy TEXT NOT NULL CHECK (policy IN ('exactly_one', 'one_to_two', 'one_to_all')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
			intent_type TEXT NOT NULL DEFAULT 'membership' CHECK (intent_type IN ('membership', 'class_entry')),
			offering_id TEXT NULL REFERENCES ${safeSchema}.products (id), entitlement_class TEXT NULL, duration_days INTEGER NULL,
			festival_class_id TEXT NULL REFERENCES ${safeSchema}.festival_class_configurations (id),
			child_id TEXT NULL REFERENCES ${safeSchema}.festival_children (id),
			shopify_product_gid TEXT NOT NULL, shopify_variant_gid TEXT NOT NULL, policy_version TEXT NULL,
			division_id TEXT NULL, division_name_snapshot TEXT NULL, staff_access_consent BOOLEAN NOT NULL DEFAULT FALSE,
			amount TEXT NOT NULL, currency_code TEXT NOT NULL, cart_reference TEXT NULL REFERENCES ${safeSchema}.checkout_carts (reference),
			status TEXT NOT NULL CHECK (status IN ('creating', 'ready', 'checkout_started', 'failed', 'expired', 'superseded', 'approved', 'rejected', 'needs_review')),
			expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.class_entitlements (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			festival_id TEXT NOT NULL REFERENCES ${safeSchema}.festivals (id) ON DELETE RESTRICT,
			festival_class_id TEXT NOT NULL REFERENCES ${safeSchema}.festival_class_configurations (id) ON DELETE RESTRICT,
			parent_customer_id TEXT NOT NULL,
			child_id TEXT NOT NULL REFERENCES ${safeSchema}.festival_children (id) ON DELETE RESTRICT,
			checkout_intent_id TEXT NOT NULL REFERENCES ${safeSchema}.checkout_intents (id) ON DELETE RESTRICT,
			shopify_order_gid TEXT NOT NULL,
			shopify_order_line_gid TEXT NOT NULL,
			paid_amount_cents INTEGER NOT NULL CHECK (paid_amount_cents >= 0),
			paid_currency_code TEXT NOT NULL CHECK (paid_currency_code ~ '^[A-Z]{3}$'),
			status TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'cancelled', 'revoked')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			FOREIGN KEY (parent_customer_id, organization_id) REFERENCES ${safeSchema}.festival_customers(id, organization_id) ON DELETE RESTRICT
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_entitlements (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			customer_id TEXT NOT NULL, entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			source TEXT NOT NULL CHECK (source IN ('teacher_checkout', 'accompanist_form')),
			offering_id TEXT NULL REFERENCES ${safeSchema}.products (id), starts_on DATE NOT NULL, ends_on DATE NOT NULL,
			revoked_at TIMESTAMPTZ NULL, revoked_reason TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (ends_on > starts_on),
			CHECK ((entitlement_class = 'teacher_membership' AND source = 'teacher_checkout') OR (entitlement_class = 'accompanist_membership' AND source = 'accompanist_form')),
			FOREIGN KEY (customer_id, organization_id) REFERENCES ${safeSchema}.festival_customers(id, organization_id) ON DELETE CASCADE,
			EXCLUDE USING gist (organization_id WITH =, customer_id WITH =, entitlement_class WITH =, daterange(starts_on, ends_on, '[)') WITH &&) WHERE (revoked_at IS NULL)
		);
		-- Write-hot during the initial registration surge; avoid blocking DDL on this table.
		CREATE TABLE IF NOT EXISTS ${safeSchema}.registration_metadata (
			id TEXT NOT NULL,
			organization_id TEXT NOT NULL,
			festival_id TEXT NOT NULL,
			checkout_intent_id TEXT NOT NULL,
			class_entitlement_id TEXT,
			teacher_membership_id TEXT NOT NULL,
			accompanist_membership_id TEXT,
			repertoire_json JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CONSTRAINT registration_metadata_pkey PRIMARY KEY (id),
			CONSTRAINT registration_metadata_id_organization_id_key UNIQUE (id, organization_id),
			CONSTRAINT registration_metadata_organization_id_fkey
				FOREIGN KEY (organization_id) REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			CONSTRAINT registration_metadata_festival_id_fkey
				FOREIGN KEY (festival_id) REFERENCES ${safeSchema}.festivals(id) ON DELETE RESTRICT,
			CONSTRAINT registration_metadata_checkout_intent_id_fkey
				FOREIGN KEY (checkout_intent_id) REFERENCES ${safeSchema}.checkout_intents(id) ON DELETE RESTRICT,
			CONSTRAINT registration_metadata_class_entitlement_id_fkey
				FOREIGN KEY (class_entitlement_id) REFERENCES ${safeSchema}.class_entitlements(id) ON DELETE SET NULL,
			CONSTRAINT registration_metadata_teacher_membership_id_fkey
				FOREIGN KEY (teacher_membership_id) REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE RESTRICT,
			CONSTRAINT registration_metadata_accompanist_membership_id_fkey
				FOREIGN KEY (accompanist_membership_id) REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE RESTRICT
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.repertoire_contributors (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
			normalized_name TEXT NOT NULL CHECK (btrim(normalized_name) <> ''),
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (id, organization_id),
			UNIQUE (organization_id, normalized_name)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.repertoire_works (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			display_title TEXT NOT NULL CHECK (btrim(display_title) <> ''),
			normalized_title TEXT NOT NULL CHECK (btrim(normalized_title) <> ''),
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (id, organization_id)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.repertoire_classifications (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			display_name TEXT NOT NULL CHECK (btrim(display_name) <> ''),
			normalized_name TEXT NOT NULL CHECK (btrim(normalized_name) <> ''),
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (id, organization_id),
			UNIQUE (organization_id, normalized_name)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.repertoire_work_contributors (
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			repertoire_work_id TEXT NOT NULL,
			repertoire_contributor_id TEXT NOT NULL,
			contributor_role TEXT NOT NULL CHECK (contributor_role IN ('Composer', 'Copyist', 'Editor', 'Arranger', 'Transcriber', 'Realizer', 'Orchestrator')),
			position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
			PRIMARY KEY (repertoire_work_id, position),
			UNIQUE (repertoire_work_id, repertoire_contributor_id, contributor_role),
			FOREIGN KEY (repertoire_work_id, organization_id) REFERENCES ${safeSchema}.repertoire_works(id, organization_id) ON DELETE CASCADE,
			FOREIGN KEY (repertoire_contributor_id, organization_id) REFERENCES ${safeSchema}.repertoire_contributors(id, organization_id) ON DELETE RESTRICT
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.repertoire_work_classifications (
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			repertoire_work_id TEXT NOT NULL,
			repertoire_classification_id TEXT NOT NULL,
			PRIMARY KEY (repertoire_work_id, repertoire_classification_id),
			FOREIGN KEY (repertoire_work_id, organization_id) REFERENCES ${safeSchema}.repertoire_works(id, organization_id) ON DELETE CASCADE,
			FOREIGN KEY (repertoire_classification_id, organization_id) REFERENCES ${safeSchema}.repertoire_classifications(id, organization_id) ON DELETE RESTRICT
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.registration_repertoire_items (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			registration_metadata_id TEXT NOT NULL,
			repertoire_work_id TEXT NULL,
			title_snapshot TEXT NOT NULL CHECK (btrim(title_snapshot) <> ''),
			performed_movement_text TEXT NULL,
			duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
			display_order SMALLINT NOT NULL CHECK (display_order >= 0),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE (id, organization_id),
			UNIQUE (registration_metadata_id, organization_id, display_order),
			FOREIGN KEY (registration_metadata_id, organization_id) REFERENCES ${safeSchema}.registration_metadata(id, organization_id) ON DELETE CASCADE,
			FOREIGN KEY (repertoire_work_id, organization_id) REFERENCES ${safeSchema}.repertoire_works(id, organization_id) ON DELETE SET NULL (repertoire_work_id)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.registration_repertoire_item_contributors (
			id TEXT PRIMARY KEY,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			registration_repertoire_item_id TEXT NOT NULL,
			repertoire_contributor_id TEXT NULL,
			display_name_snapshot TEXT NOT NULL CHECK (btrim(display_name_snapshot) <> ''),
			contributor_role TEXT NOT NULL CHECK (contributor_role IN ('Composer', 'Copyist', 'Editor', 'Arranger', 'Transcriber', 'Realizer', 'Orchestrator')),
			position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 3),
			UNIQUE (registration_repertoire_item_id, position),
			FOREIGN KEY (registration_repertoire_item_id, organization_id) REFERENCES ${safeSchema}.registration_repertoire_items(id, organization_id) ON DELETE CASCADE,
			FOREIGN KEY (repertoire_contributor_id, organization_id) REFERENCES ${safeSchema}.repertoire_contributors(id, organization_id) ON DELETE SET NULL (repertoire_contributor_id)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_entitlement_cohorts (
			organization_id TEXT NOT NULL, customer_id TEXT NOT NULL,
			entitlement_class TEXT NOT NULL CHECK (entitlement_class IN ('teacher_membership', 'accompanist_membership')),
			version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
			PRIMARY KEY (organization_id, customer_id, entitlement_class),
			FOREIGN KEY (customer_id, organization_id) REFERENCES ${safeSchema}.festival_customers(id, organization_id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_identity_emails (
			organization_id TEXT NOT NULL, normalized_email TEXT NOT NULL, customer_id TEXT NOT NULL,
			PRIMARY KEY (organization_id, normalized_email), UNIQUE (organization_id, customer_id),
			FOREIGN KEY (customer_id, organization_id) REFERENCES ${safeSchema}.festival_customers(id, organization_id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_entitlement_divisions (
			entitlement_id TEXT NOT NULL REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE CASCADE,
			organization_id TEXT NOT NULL, division_id TEXT NOT NULL, division_name_snapshot TEXT NOT NULL,
			PRIMARY KEY (entitlement_id, division_id),
			FOREIGN KEY (division_id, organization_id) REFERENCES ${safeSchema}.organization_divisions(id, organization_id)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.membership_entitlement_revocations (
			id TEXT PRIMARY KEY, entitlement_id TEXT NOT NULL UNIQUE REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE RESTRICT,
			organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations(id) ON DELETE CASCADE,
			actor_user_id TEXT NOT NULL REFERENCES ${safeSchema}.users(id) ON DELETE RESTRICT,
			reason TEXT NOT NULL CHECK (LENGTH(reason) BETWEEN 1 AND 500), revoked_at TIMESTAMPTZ NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.teacher_membership_entitlement_details (
			entitlement_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE CASCADE,
			checkout_intent_id TEXT NOT NULL UNIQUE, shopify_order_gid TEXT NOT NULL, shopify_order_line_gid TEXT NOT NULL UNIQUE,
			paid_amount TEXT NOT NULL, paid_currency_code TEXT NOT NULL CHECK (paid_currency_code ~ '^[A-Z]{3}$'), duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 36500)
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.accompanist_membership_entitlement_details (
			entitlement_id TEXT PRIMARY KEY REFERENCES ${safeSchema}.membership_entitlements(id) ON DELETE CASCADE,
			contact_name TEXT NOT NULL, contact_email TEXT NOT NULL, contact_city TEXT NOT NULL, contact_phone TEXT NOT NULL
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
		CREATE TABLE IF NOT EXISTS ${safeSchema}.volunteers (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			firebase_uid TEXT NOT NULL, account_email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.volunteer_roles (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			slug TEXT NOT NULL, description TEXT NOT NULL, details_url TEXT NULL,
			is_room_proctor BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.volunteer_shifts (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			role_id TEXT NOT NULL REFERENCES ${safeSchema}.volunteer_roles (id) ON DELETE CASCADE,
			date DATE NOT NULL, period TEXT NOT NULL CHECK (period IN ('AM', 'PM')),
			time_text TEXT NULL, division TEXT NULL, adjudicator TEXT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE TABLE IF NOT EXISTS ${safeSchema}.volunteer_assignments (
			id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES ${safeSchema}.organizations (id) ON DELETE CASCADE,
			shift_id TEXT NOT NULL REFERENCES ${safeSchema}.volunteer_shifts (id) ON DELETE CASCADE,
			volunteer_id TEXT NOT NULL REFERENCES ${safeSchema}.volunteers (id) ON DELETE CASCADE,
			status TEXT NOT NULL CHECK (status IN ('active', 'cancelled')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), cancelled_at TIMESTAMPTZ NULL
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
		CREATE INDEX IF NOT EXISTS membership_entitlements_cohort_idx ON ${safeSchema}.membership_entitlements (organization_id, customer_id, entitlement_class, starts_on);
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
		CREATE UNIQUE INDEX IF NOT EXISTS volunteers_org_uid_key ON ${safeSchema}.volunteers (organization_id, firebase_uid);
		CREATE UNIQUE INDEX IF NOT EXISTS volunteer_assignments_active_shift_key ON ${safeSchema}.volunteer_assignments (shift_id) WHERE status = 'active';
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_org_class ON ${safeSchema}.class_entitlements (organization_id, festival_class_id);
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_org_parent ON ${safeSchema}.class_entitlements (organization_id, parent_customer_id);
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_org_child ON ${safeSchema}.class_entitlements (organization_id, child_id);
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_org_festival ON ${safeSchema}.class_entitlements (organization_id, festival_id);
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_checkout_intent ON ${safeSchema}.class_entitlements (organization_id, checkout_intent_id);
		CREATE INDEX IF NOT EXISTS idx_class_entitlements_shopify_order ON ${safeSchema}.class_entitlements (organization_id, shopify_order_gid);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_class_entitlements_order_line ON ${safeSchema}.class_entitlements (organization_id, shopify_order_line_gid);
		CREATE INDEX IF NOT EXISTS idx_checkout_intents_org_class ON ${safeSchema}.checkout_intents (organization_id, festival_class_id) WHERE festival_class_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_checkout_intents_org_child ON ${safeSchema}.checkout_intents (organization_id, child_id) WHERE child_id IS NOT NULL;
		CREATE UNIQUE INDEX IF NOT EXISTS registration_metadata_checkout_intent_id_unique
			ON ${safeSchema}.registration_metadata(checkout_intent_id);
		CREATE INDEX IF NOT EXISTS registration_metadata_organization_class_entitlement_idx
			ON ${safeSchema}.registration_metadata(organization_id, class_entitlement_id)
			WHERE class_entitlement_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS repertoire_works_organization_title_idx
			ON ${safeSchema}.repertoire_works(organization_id, normalized_title);
		CREATE INDEX IF NOT EXISTS repertoire_work_contributors_contributor_idx
			ON ${safeSchema}.repertoire_work_contributors(organization_id, repertoire_contributor_id);
		CREATE INDEX IF NOT EXISTS repertoire_work_classifications_classification_idx
			ON ${safeSchema}.repertoire_work_classifications(organization_id, repertoire_classification_id, repertoire_work_id);
		CREATE INDEX IF NOT EXISTS registration_repertoire_items_work_idx
			ON ${safeSchema}.registration_repertoire_items(organization_id, repertoire_work_id)
			WHERE repertoire_work_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS registration_repertoire_item_contributors_contributor_idx
			ON ${safeSchema}.registration_repertoire_item_contributors(organization_id, repertoire_contributor_id)
			WHERE repertoire_contributor_id IS NOT NULL;
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
