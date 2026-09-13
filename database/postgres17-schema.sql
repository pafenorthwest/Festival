--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: orgs; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA orgs;


--
-- Name: enforce_shopify_shop_ownership(); Type: FUNCTION; Schema: orgs; Owner: -
--

CREATE FUNCTION orgs.enforce_shopify_shop_ownership() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
		BEGIN
			PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_domain, 0));
			IF NEW.verified_shop_domain IS NOT NULL THEN
				PERFORM pg_advisory_xact_lock(hashtextextended(NEW.verified_shop_domain, 0));
			END IF;
			IF EXISTS (SELECT 1 FROM orgs.shopify_integrations existing WHERE existing.organization_id <> NEW.organization_id AND (existing.store_domain = NEW.store_domain OR existing.verified_shop_domain = NEW.store_domain OR (NEW.verified_shop_domain IS NOT NULL AND (existing.store_domain = NEW.verified_shop_domain OR existing.verified_shop_domain = NEW.verified_shop_domain)))) THEN
				RAISE EXCEPTION 'Shopify shop ownership conflict' USING ERRCODE = '23505';
			END IF;
			RETURN NEW;
		END;
		$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accompanist_division_policies; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.accompanist_division_policies (
    organization_id text NOT NULL,
    policy text DEFAULT 'one_to_all'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accompanist_division_policies_policy_check CHECK ((policy = ANY (ARRAY['exactly_one'::text, 'one_to_two'::text, 'one_to_all'::text])))
);


--
-- Name: accompanist_division_policy_history; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.accompanist_division_policy_history (
    id text NOT NULL,
    organization_id text NOT NULL,
    policy text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accompanist_division_policy_history_policy_check CHECK ((policy = ANY (ARRAY['exactly_one'::text, 'one_to_two'::text, 'one_to_all'::text])))
);


--
-- Name: accompanist_membership_grants; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.accompanist_membership_grants (
    id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text NOT NULL,
    normalized_email text NOT NULL,
    offering_id text NOT NULL,
    offering_name_snapshot text NOT NULL,
    source text NOT NULL,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    contact_city text NOT NULL,
    contact_phone text NOT NULL,
    divisions jsonb NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accompanist_membership_grants_check CHECK ((ends_on > starts_on)),
    CONSTRAINT accompanist_membership_grants_source_check CHECK ((source = 'accompanist_form'::text)),
    CONSTRAINT accompanist_membership_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'superseded'::text, 'expired'::text])))
);


--
-- Name: app_user; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.app_user (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    firebase_uid character varying(128) NOT NULL,
    email character varying(320) NOT NULL,
    full_name character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: checkout_carts; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.checkout_carts (
    reference text NOT NULL,
    shopify_cart_id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text NOT NULL,
    session_id text NOT NULL,
    integration_version bigint NOT NULL,
    status text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkout_carts_status_check CHECK ((status = ANY (ARRAY['ready'::text, 'checkout_started'::text, 'expired'::text, 'superseded'::text])))
);


--
-- Name: checkout_intents; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.checkout_intents (
    id text NOT NULL,
    correlation_id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text NOT NULL,
    session_id text NOT NULL,
    idempotency_key text NOT NULL,
    offering_id text NOT NULL,
    entitlement_class text NOT NULL,
    duration_days integer NOT NULL,
    shopify_product_gid text NOT NULL,
    shopify_variant_gid text NOT NULL,
    policy_version text NOT NULL,
    division_id text,
    division_name_snapshot text,
    staff_access_consent boolean DEFAULT false NOT NULL,
    amount text NOT NULL,
    currency_code text NOT NULL,
    cart_reference text,
    status text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkout_intents_status_check CHECK ((status = ANY (ARRAY['creating'::text, 'ready'::text, 'checkout_started'::text, 'failed'::text, 'expired'::text, 'superseded'::text, 'approved'::text, 'rejected'::text, 'needs_review'::text])))
);


--
-- Name: entitlement_grants; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.entitlement_grants (
    id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text NOT NULL,
    entitlement_class text NOT NULL,
    offering_id text NOT NULL,
    duration_days integer NOT NULL,
    division_id text NOT NULL,
    division_name_snapshot text NOT NULL,
    paid_amount text NOT NULL,
    paid_currency_code text NOT NULL,
    checkout_intent_id text NOT NULL,
    shopify_order_gid text NOT NULL,
    shopify_order_line_gid text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entitlement_grants_check CHECK ((ends_on > starts_on)),
    CONSTRAINT entitlement_grants_duration_days_check CHECK (((duration_days > 0) AND (duration_days <= 36500))),
    CONSTRAINT entitlement_grants_entitlement_class_check CHECK ((entitlement_class = ANY (ARRAY['teacher_membership'::text, 'accompanist_membership'::text]))),
    CONSTRAINT entitlement_grants_paid_currency_code_check CHECK ((paid_currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT entitlement_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'revoked'::text])))
);


--
-- Name: festival_child_age_snapshots; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_child_age_snapshots (
    id text NOT NULL,
    child_id text NOT NULL,
    organization_id text NOT NULL,
    age integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    valid_until timestamp with time zone NOT NULL,
    superseded_at timestamp with time zone
);


--
-- Name: festival_children; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_children (
    id text NOT NULL,
    organization_id text NOT NULL,
    parent_customer_id text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: festival_class_configurations; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_class_configurations (
    id text NOT NULL,
    organization_id text NOT NULL,
    festival_id text NOT NULL,
    display_name text NOT NULL,
    class_subtype_id text NOT NULL,
    division_id text NOT NULL,
    minimum_age integer NOT NULL,
    maximum_age integer NOT NULL,
    price text NOT NULL,
    maximum_performance_pieces integer NOT NULL,
    performance_minutes integer NOT NULL,
    capacity integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shopify_product_gid text NOT NULL,
    shopify_variant_gid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT festival_class_configurations_check CHECK (((minimum_age >= 0) AND (maximum_age >= minimum_age) AND (maximum_performance_pieces = ANY (ARRAY[1, 2, 3])) AND (performance_minutes > 0) AND (capacity > 0)))
);


--
-- Name: festival_customer_profile_access_audit; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_customer_profile_access_audit (
    id bigint NOT NULL,
    organization_id text NOT NULL,
    actor_uid text NOT NULL,
    action text NOT NULL,
    target_customer_id text,
    result_count integer,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT festival_customer_profile_access_audit_action_check CHECK ((action = ANY (ARRAY['view'::text, 'search'::text]))),
    CONSTRAINT festival_customer_profile_access_audit_result_count_check CHECK ((result_count >= 0))
);


--
-- Name: festival_customer_profile_access_audit_id_seq; Type: SEQUENCE; Schema: orgs; Owner: -
--

ALTER TABLE orgs.festival_customer_profile_access_audit ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME orgs.festival_customer_profile_access_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: festival_customer_staff_consents; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_customer_staff_consents (
    customer_id text NOT NULL,
    organization_id text NOT NULL,
    privacy_notice_version text NOT NULL,
    consented_at timestamp with time zone NOT NULL
);


--
-- Name: festival_customers; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festival_customers (
    id text NOT NULL,
    organization_id text NOT NULL,
    shopify_customer_gid text NOT NULL,
    name text,
    name_source text,
    name_updated_at timestamp with time zone,
    email text,
    email_source text,
    email_updated_at timestamp with time zone,
    mailing_address jsonb,
    mailing_address_source text,
    mailing_address_updated_at timestamp with time zone,
    phone text,
    phone_source text,
    phone_updated_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT festival_customers_email_source_check CHECK ((email_source = ANY (ARRAY['shopify'::text, 'festival'::text]))),
    CONSTRAINT festival_customers_mailing_address_source_check CHECK ((mailing_address_source = ANY (ARRAY['shopify'::text, 'festival'::text]))),
    CONSTRAINT festival_customers_name_source_check CHECK ((name_source = ANY (ARRAY['shopify'::text, 'festival'::text]))),
    CONSTRAINT festival_customers_phone_source_check CHECK ((phone_source = ANY (ARRAY['shopify'::text, 'festival'::text])))
);


--
-- Name: festivals; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.festivals (
    id text NOT NULL,
    organization_id text NOT NULL,
    code text NOT NULL,
    short_name text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invites; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.invites (
    id text NOT NULL,
    token text NOT NULL,
    organization_id text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    invited_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone
);


--
-- Name: membership_reconciliation_runs; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.membership_reconciliation_runs (
    id text NOT NULL,
    organization_id text NOT NULL,
    status text NOT NULL,
    discovered_count integer NOT NULL,
    processed_count integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    failure_category text,
    CONSTRAINT membership_reconciliation_runs_discovered_count_check CHECK ((discovered_count >= 0)),
    CONSTRAINT membership_reconciliation_runs_failure_category_check CHECK ((failure_category = ANY (ARRAY['upstream'::text, 'persistence'::text, 'invalid'::text]))),
    CONSTRAINT membership_reconciliation_runs_processed_count_check CHECK ((processed_count >= 0)),
    CONSTRAINT membership_reconciliation_runs_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'failed'::text])))
);


--
-- Name: membership_validation_decisions; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.membership_validation_decisions (
    id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text,
    checkout_intent_id text,
    shopify_order_gid text NOT NULL,
    shopify_order_line_gid text,
    status text NOT NULL,
    reason_code text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT membership_validation_decisions_reason_code_check CHECK (((reason_code IS NULL) OR (reason_code = ANY (ARRAY['correlation_missing'::text, 'correlation_invalid'::text, 'intent_expired'::text, 'order_not_paid'::text, 'payment_incomplete'::text, 'payment_mismatch'::text, 'customer_mismatch'::text, 'offering_mismatch'::text, 'division_invalid'::text, 'duplicate_purchase'::text, 'policy_mismatch'::text, 'upstream_invalid'::text])))),
    CONSTRAINT membership_validation_decisions_status_check CHECK ((status = ANY (ARRAY['pending_validation'::text, 'approved'::text, 'rejected'::text, 'needs_review'::text])))
);


--
-- Name: memberships; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.memberships (
    id text NOT NULL,
    organization_id text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL,
    origin text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    welcome_dismissed_at timestamp with time zone
);


--
-- Name: organization_divisions; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.organization_divisions (
    id text NOT NULL,
    organization_id text NOT NULL,
    display_name text NOT NULL,
    normalized_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_divisions_display_order_check CHECK ((display_order >= 0))
);


--
-- Name: organizations; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.organizations (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.products (
    id text NOT NULL,
    organization_id text NOT NULL,
    product_category text NOT NULL,
    entitlement_class text NOT NULL,
    duration_days integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shopify_product_gid text NOT NULL,
    shopify_variant_gid text NOT NULL,
    product_name_snapshot text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT products_duration_days_check CHECK (((duration_days > 0) AND (duration_days <= 36500))),
    CONSTRAINT products_entitlement_class_check CHECK ((entitlement_class = ANY (ARRAY['teacher_membership'::text, 'accompanist_membership'::text]))),
    CONSTRAINT products_product_category_check CHECK ((product_category = 'membership'::text))
);


--
-- Name: registration_age_configurations; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.registration_age_configurations (
    organization_id text NOT NULL,
    registration_age_date date NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: registration_catalog_values; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.registration_catalog_values (
    id text NOT NULL,
    organization_id text NOT NULL,
    kind text NOT NULL,
    display_name text NOT NULL,
    normalized_name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    display_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registration_catalog_values_display_order_check CHECK ((display_order >= 0)),
    CONSTRAINT registration_catalog_values_kind_check CHECK ((kind = ANY (ARRAY['class_subtype'::text, 'instrument'::text])))
);


--
-- Name: shopify_customer_account_integrations; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_customer_account_integrations (
    organization_id text NOT NULL,
    storefront_domain text NOT NULL,
    client_id text NOT NULL,
    encrypted_client_secret text NOT NULL,
    readiness text DEFAULT 'unknown'::text NOT NULL,
    can_read_orders boolean DEFAULT false NOT NULL,
    integration_version bigint DEFAULT 1 NOT NULL,
    verified_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shopify_customer_account_integrations_integration_version_check CHECK ((integration_version > 0)),
    CONSTRAINT shopify_customer_account_integrations_readiness_check CHECK ((readiness = ANY (ARRAY['unknown'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: shopify_customer_oauth_states; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_customer_oauth_states (
    state_hash text NOT NULL,
    organization_id text NOT NULL,
    nonce text NOT NULL,
    return_to text NOT NULL,
    offering_id text,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: shopify_customer_sessions; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_customer_sessions (
    session_id text NOT NULL,
    organization_id text NOT NULL,
    customer_id text NOT NULL,
    shopify_customer_gid text NOT NULL,
    encrypted_tokens text NOT NULL,
    csrf_token text NOT NULL,
    integration_version bigint NOT NULL,
    created_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: shopify_integrations; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_integrations (
    organization_id text NOT NULL,
    store_domain text NOT NULL,
    client_id text NOT NULL,
    encrypted_client_secret text NOT NULL,
    encrypted_storefront_private_token text,
    verification_status text DEFAULT 'unknown'::text NOT NULL,
    verified_shop_gid text,
    verified_shop_domain text,
    granted_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    can_read_products boolean DEFAULT false NOT NULL,
    can_write_products boolean DEFAULT false NOT NULL,
    can_read_orders boolean DEFAULT false NOT NULL,
    integration_version bigint DEFAULT 1 NOT NULL,
    verified_at timestamp with time zone,
    last_tested_at timestamp with time zone,
    last_error text,
    last_failure_category text,
    webhook_readiness_status text DEFAULT 'unknown'::text NOT NULL,
    webhook_checked_at timestamp with time zone,
    webhook_error text,
    webhook_failure_category text,
    webhook_request_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shopify_integrations_integration_version_check CHECK ((integration_version > 0)),
    CONSTRAINT shopify_integrations_last_failure_category_check CHECK (((last_failure_category IS NULL) OR (last_failure_category = ANY (ARRAY['credentials'::text, 'identity_mismatch'::text, 'shop_ownership_conflict'::text, 'missing_scope'::text, 'transport'::text, 'upstream'::text])))),
    CONSTRAINT shopify_integrations_verification_status_check CHECK ((verification_status = ANY (ARRAY['unknown'::text, 'ok'::text, 'failed'::text]))),
    CONSTRAINT shopify_integrations_webhook_failure_category_check CHECK (((webhook_failure_category IS NULL) OR (webhook_failure_category = ANY (ARRAY['configuration'::text, 'missing_scope'::text, 'permission'::text, 'protected_data'::text, 'callback'::text, 'transport'::text, 'upstream'::text])))),
    CONSTRAINT shopify_integrations_webhook_readiness_status_check CHECK ((webhook_readiness_status = ANY (ARRAY['unknown'::text, 'checking'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT shopify_integrations_webhook_request_id_check CHECK (((webhook_request_id IS NULL) OR (webhook_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'::text))),
    CONSTRAINT shopify_integrations_webhook_result_check CHECK ((((webhook_readiness_status = 'unknown'::text) AND (webhook_checked_at IS NULL) AND (webhook_error IS NULL) AND (webhook_failure_category IS NULL) AND (webhook_request_id IS NULL)) OR ((webhook_readiness_status = ANY (ARRAY['checking'::text, 'ready'::text])) AND (webhook_checked_at IS NOT NULL) AND (webhook_error IS NULL) AND (webhook_failure_category IS NULL) AND (webhook_request_id IS NULL)) OR ((webhook_readiness_status = 'failed'::text) AND (webhook_checked_at IS NOT NULL) AND (webhook_error IS NOT NULL) AND (webhook_failure_category IS NOT NULL))))
);


--
-- Name: shopify_order_projections; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_order_projections (
    organization_id text NOT NULL,
    shopify_order_gid text NOT NULL,
    shopify_customer_gid text,
    correlation_id text,
    fully_paid_at timestamp with time zone,
    currency_code text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: shopify_webhook_deliveries; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.shopify_webhook_deliveries (
    id text NOT NULL,
    organization_id text NOT NULL,
    shop_domain text NOT NULL,
    webhook_id text NOT NULL,
    topic text NOT NULL,
    api_version text NOT NULL,
    shopify_order_gid text NOT NULL,
    payload_sha256 text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    failure_category text,
    received_at timestamp with time zone NOT NULL,
    processing_started_at timestamp with time zone,
    processed_at timestamp with time zone,
    CONSTRAINT shopify_webhook_deliveries_api_version_check CHECK ((api_version = '2026-07'::text)),
    CONSTRAINT shopify_webhook_deliveries_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT shopify_webhook_deliveries_failure_category_check CHECK ((failure_category = ANY (ARRAY['upstream'::text, 'persistence'::text, 'invalid'::text]))),
    CONSTRAINT shopify_webhook_deliveries_payload_sha256_check CHECK ((payload_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT shopify_webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['received'::text, 'processing'::text, 'processed'::text, 'failed'::text]))),
    CONSTRAINT shopify_webhook_deliveries_topic_check CHECK ((topic = 'orders/paid'::text))
);


--
-- Name: user_login_event; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.user_login_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    firebase_uid character varying(128) NOT NULL,
    provider character varying(64) NOT NULL,
    ip_address inet,
    user_agent text,
    login_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: orgs; Owner: -
--

CREATE TABLE orgs.users (
    id text NOT NULL,
    firebase_uid text NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    disassociated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: accompanist_division_policies accompanist_division_policies_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_division_policies
    ADD CONSTRAINT accompanist_division_policies_pkey PRIMARY KEY (organization_id);


--
-- Name: accompanist_division_policy_history accompanist_division_policy_history_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_division_policy_history
    ADD CONSTRAINT accompanist_division_policy_history_pkey PRIMARY KEY (id);


--
-- Name: accompanist_membership_grants accompanist_membership_grants_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_membership_grants
    ADD CONSTRAINT accompanist_membership_grants_pkey PRIMARY KEY (id);


--
-- Name: app_user app_user_firebase_uid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.app_user
    ADD CONSTRAINT app_user_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: app_user app_user_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY (id);


--
-- Name: checkout_carts checkout_carts_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_carts
    ADD CONSTRAINT checkout_carts_pkey PRIMARY KEY (reference);


--
-- Name: checkout_intents checkout_intents_correlation_id_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_intents
    ADD CONSTRAINT checkout_intents_correlation_id_key UNIQUE (correlation_id);


--
-- Name: checkout_intents checkout_intents_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_intents
    ADD CONSTRAINT checkout_intents_pkey PRIMARY KEY (id);


--
-- Name: entitlement_grants entitlement_grants_checkout_intent_id_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_checkout_intent_id_key UNIQUE (checkout_intent_id);


--
-- Name: entitlement_grants entitlement_grants_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_pkey PRIMARY KEY (id);


--
-- Name: entitlement_grants entitlement_grants_shopify_order_line_gid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_shopify_order_line_gid_key UNIQUE (shopify_order_line_gid);


--
-- Name: festival_child_age_snapshots festival_child_age_snapshots_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_child_age_snapshots
    ADD CONSTRAINT festival_child_age_snapshots_pkey PRIMARY KEY (id);


--
-- Name: festival_children festival_children_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_children
    ADD CONSTRAINT festival_children_pkey PRIMARY KEY (id);


--
-- Name: festival_class_configurations festival_class_configurations_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_pkey PRIMARY KEY (id);


--
-- Name: festival_class_configurations festival_class_configurations_shopify_product_gid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_shopify_product_gid_key UNIQUE (shopify_product_gid);


--
-- Name: festival_class_configurations festival_class_configurations_shopify_variant_gid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_shopify_variant_gid_key UNIQUE (shopify_variant_gid);


--
-- Name: festival_customer_profile_access_audit festival_customer_profile_access_audit_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customer_profile_access_audit
    ADD CONSTRAINT festival_customer_profile_access_audit_pkey PRIMARY KEY (id);


--
-- Name: festival_customer_staff_consents festival_customer_staff_consents_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customer_staff_consents
    ADD CONSTRAINT festival_customer_staff_consents_pkey PRIMARY KEY (customer_id, privacy_notice_version);


--
-- Name: festival_customers festival_customers_id_organization_id_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customers
    ADD CONSTRAINT festival_customers_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: festival_customers festival_customers_id_organization_id_shopify_customer_gid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customers
    ADD CONSTRAINT festival_customers_id_organization_id_shopify_customer_gid_key UNIQUE (id, organization_id, shopify_customer_gid);


--
-- Name: festival_customers festival_customers_organization_id_shopify_customer_gid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customers
    ADD CONSTRAINT festival_customers_organization_id_shopify_customer_gid_key UNIQUE (organization_id, shopify_customer_gid);


--
-- Name: festival_customers festival_customers_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customers
    ADD CONSTRAINT festival_customers_pkey PRIMARY KEY (id);


--
-- Name: festivals festivals_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festivals
    ADD CONSTRAINT festivals_pkey PRIMARY KEY (id);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);


--
-- Name: invites invites_token_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.invites
    ADD CONSTRAINT invites_token_key UNIQUE (token);


--
-- Name: membership_reconciliation_runs membership_reconciliation_runs_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_reconciliation_runs
    ADD CONSTRAINT membership_reconciliation_runs_pkey PRIMARY KEY (id);


--
-- Name: membership_validation_decisions membership_validation_decisio_organization_id_shopify_orde_key1; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_validation_decisions
    ADD CONSTRAINT membership_validation_decisio_organization_id_shopify_orde_key1 UNIQUE (organization_id, shopify_order_line_gid);


--
-- Name: membership_validation_decisions membership_validation_decisio_organization_id_shopify_order_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_validation_decisions
    ADD CONSTRAINT membership_validation_decisio_organization_id_shopify_order_key UNIQUE (organization_id, shopify_order_gid);


--
-- Name: membership_validation_decisions membership_validation_decisions_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_validation_decisions
    ADD CONSTRAINT membership_validation_decisions_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: organization_divisions organization_divisions_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.organization_divisions
    ADD CONSTRAINT organization_divisions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_name_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.organizations
    ADD CONSTRAINT organizations_name_key UNIQUE (name);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: registration_age_configurations registration_age_configurations_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_age_configurations
    ADD CONSTRAINT registration_age_configurations_pkey PRIMARY KEY (organization_id);


--
-- Name: registration_catalog_values registration_catalog_values_organization_id_kind_display_or_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_catalog_values
    ADD CONSTRAINT registration_catalog_values_organization_id_kind_display_or_key UNIQUE (organization_id, kind, display_order);


--
-- Name: registration_catalog_values registration_catalog_values_organization_id_kind_normalized_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_catalog_values
    ADD CONSTRAINT registration_catalog_values_organization_id_kind_normalized_key UNIQUE (organization_id, kind, normalized_name);


--
-- Name: registration_catalog_values registration_catalog_values_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_catalog_values
    ADD CONSTRAINT registration_catalog_values_pkey PRIMARY KEY (id);


--
-- Name: shopify_customer_account_integrations shopify_customer_account_integrations_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_account_integrations
    ADD CONSTRAINT shopify_customer_account_integrations_pkey PRIMARY KEY (organization_id);


--
-- Name: shopify_customer_oauth_states shopify_customer_oauth_states_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_oauth_states
    ADD CONSTRAINT shopify_customer_oauth_states_pkey PRIMARY KEY (state_hash);


--
-- Name: shopify_customer_sessions shopify_customer_sessions_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_sessions
    ADD CONSTRAINT shopify_customer_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: shopify_integrations shopify_integrations_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_integrations
    ADD CONSTRAINT shopify_integrations_pkey PRIMARY KEY (organization_id);


--
-- Name: shopify_order_projections shopify_order_projections_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_order_projections
    ADD CONSTRAINT shopify_order_projections_pkey PRIMARY KEY (organization_id, shopify_order_gid);


--
-- Name: shopify_webhook_deliveries shopify_webhook_deliveries_organization_id_webhook_id_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_webhook_deliveries
    ADD CONSTRAINT shopify_webhook_deliveries_organization_id_webhook_id_key UNIQUE (organization_id, webhook_id);


--
-- Name: shopify_webhook_deliveries shopify_webhook_deliveries_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_webhook_deliveries
    ADD CONSTRAINT shopify_webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: user_login_event user_login_event_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.user_login_event
    ADD CONSTRAINT user_login_event_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_firebase_uid_key; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.users
    ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: checkout_intents_scope_key; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX checkout_intents_scope_key ON orgs.checkout_intents USING btree (organization_id, customer_id, session_id, idempotency_key);


--
-- Name: idx_accompanist_current_customer; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_accompanist_current_customer ON orgs.accompanist_membership_grants USING btree (organization_id, customer_id) WHERE is_current;


--
-- Name: idx_accompanist_current_email; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_accompanist_current_email ON orgs.accompanist_membership_grants USING btree (organization_id, normalized_email) WHERE is_current;


--
-- Name: idx_app_user_email_lower; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_app_user_email_lower ON orgs.app_user USING btree (lower((email)::text));


--
-- Name: idx_entitlement_grants_tenant_customer; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_entitlement_grants_tenant_customer ON orgs.entitlement_grants USING btree (organization_id, customer_id, created_at);


--
-- Name: idx_festival_children_parent_name; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_festival_children_parent_name ON orgs.festival_children USING btree (organization_id, parent_customer_id, lower(display_name));


--
-- Name: idx_festival_customers_org_email; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_festival_customers_org_email ON orgs.festival_customers USING btree (organization_id, lower(email));


--
-- Name: idx_festival_customers_org_name; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_festival_customers_org_name ON orgs.festival_customers USING btree (organization_id, lower(name));


--
-- Name: idx_festival_customers_org_phone; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_festival_customers_org_phone ON orgs.festival_customers USING btree (organization_id, phone);


--
-- Name: idx_festivals_one_primary; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_festivals_one_primary ON orgs.festivals USING btree (organization_id) WHERE is_primary;


--
-- Name: idx_festivals_org_code; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_festivals_org_code ON orgs.festivals USING btree (organization_id, code);


--
-- Name: idx_festivals_org_name_lower; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_festivals_org_name_lower ON orgs.festivals USING btree (organization_id, lower(name));


--
-- Name: idx_festivals_org_short_name; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_festivals_org_short_name ON orgs.festivals USING btree (organization_id, short_name);


--
-- Name: idx_memberships_user_org; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_memberships_user_org ON orgs.memberships USING btree (user_id, organization_id);


--
-- Name: idx_organization_divisions_name; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_organization_divisions_name ON orgs.organization_divisions USING btree (organization_id, normalized_name);


--
-- Name: idx_organization_divisions_order; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_organization_divisions_order ON orgs.organization_divisions USING btree (organization_id, display_order);


--
-- Name: idx_products_org_active_entitlement_class; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_products_org_active_entitlement_class ON orgs.products USING btree (organization_id, entitlement_class) WHERE ((product_category = 'membership'::text) AND is_active);


--
-- Name: idx_products_organization_id; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_products_organization_id ON orgs.products USING btree (organization_id);


--
-- Name: idx_products_shopify_product_gid; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_products_shopify_product_gid ON orgs.products USING btree (shopify_product_gid);


--
-- Name: idx_products_shopify_product_variant_gid; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_products_shopify_product_variant_gid ON orgs.products USING btree (shopify_product_gid, shopify_variant_gid);


--
-- Name: idx_products_shopify_variant_gid; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_products_shopify_variant_gid ON orgs.products USING btree (shopify_variant_gid);


--
-- Name: idx_shopify_customer_sessions_org; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_shopify_customer_sessions_org ON orgs.shopify_customer_sessions USING btree (organization_id);


--
-- Name: idx_shopify_integrations_store_domain; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_shopify_integrations_store_domain ON orgs.shopify_integrations USING btree (store_domain);


--
-- Name: idx_shopify_integrations_verified_domain; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_shopify_integrations_verified_domain ON orgs.shopify_integrations USING btree (verified_shop_domain) WHERE (verified_shop_domain IS NOT NULL);


--
-- Name: idx_shopify_integrations_verified_gid; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX idx_shopify_integrations_verified_gid ON orgs.shopify_integrations USING btree (verified_shop_gid) WHERE (verified_shop_gid IS NOT NULL);


--
-- Name: idx_user_login_firebase_uid; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_user_login_firebase_uid ON orgs.user_login_event USING btree (firebase_uid);


--
-- Name: idx_user_login_user_id; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX idx_user_login_user_id ON orgs.user_login_event USING btree (user_id);


--
-- Name: membership_reconciliation_runs_tenant_idx; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX membership_reconciliation_runs_tenant_idx ON orgs.membership_reconciliation_runs USING btree (organization_id, finished_at DESC);


--
-- Name: membership_validation_checkout_intent_idx; Type: INDEX; Schema: orgs; Owner: -
--

CREATE UNIQUE INDEX membership_validation_checkout_intent_idx ON orgs.membership_validation_decisions USING btree (organization_id, checkout_intent_id) WHERE (checkout_intent_id IS NOT NULL);


--
-- Name: membership_validation_customer_idx; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX membership_validation_customer_idx ON orgs.membership_validation_decisions USING btree (organization_id, customer_id, created_at DESC);


--
-- Name: shopify_webhook_reclaim_idx; Type: INDEX; Schema: orgs; Owner: -
--

CREATE INDEX shopify_webhook_reclaim_idx ON orgs.shopify_webhook_deliveries USING btree (organization_id, status, received_at);


--
-- Name: shopify_integrations enforce_shopify_shop_ownership; Type: TRIGGER; Schema: orgs; Owner: -
--

CREATE TRIGGER enforce_shopify_shop_ownership BEFORE INSERT OR UPDATE OF store_domain, verified_shop_domain ON orgs.shopify_integrations FOR EACH ROW EXECUTE FUNCTION orgs.enforce_shopify_shop_ownership();


--
-- Name: accompanist_division_policies accompanist_division_policies_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_division_policies
    ADD CONSTRAINT accompanist_division_policies_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: accompanist_division_policy_history accompanist_division_policy_history_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_division_policy_history
    ADD CONSTRAINT accompanist_division_policy_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: accompanist_membership_grants accompanist_membership_grants_offering_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_membership_grants
    ADD CONSTRAINT accompanist_membership_grants_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES orgs.products(id);


--
-- Name: accompanist_membership_grants accompanist_membership_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.accompanist_membership_grants
    ADD CONSTRAINT accompanist_membership_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: checkout_carts checkout_carts_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_carts
    ADD CONSTRAINT checkout_carts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: checkout_intents checkout_intents_cart_reference_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_intents
    ADD CONSTRAINT checkout_intents_cart_reference_fkey FOREIGN KEY (cart_reference) REFERENCES orgs.checkout_carts(reference);


--
-- Name: checkout_intents checkout_intents_offering_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_intents
    ADD CONSTRAINT checkout_intents_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES orgs.products(id);


--
-- Name: checkout_intents checkout_intents_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.checkout_intents
    ADD CONSTRAINT checkout_intents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: entitlement_grants entitlement_grants_division_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_division_id_fkey FOREIGN KEY (division_id) REFERENCES orgs.organization_divisions(id);


--
-- Name: entitlement_grants entitlement_grants_offering_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES orgs.products(id);


--
-- Name: entitlement_grants entitlement_grants_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.entitlement_grants
    ADD CONSTRAINT entitlement_grants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: festival_class_configurations festival_class_configurations_class_subtype_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_class_subtype_id_fkey FOREIGN KEY (class_subtype_id) REFERENCES orgs.registration_catalog_values(id);


--
-- Name: festival_class_configurations festival_class_configurations_division_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_division_id_fkey FOREIGN KEY (division_id) REFERENCES orgs.organization_divisions(id);


--
-- Name: festival_class_configurations festival_class_configurations_festival_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_festival_id_fkey FOREIGN KEY (festival_id) REFERENCES orgs.festivals(id) ON DELETE RESTRICT;


--
-- Name: festival_class_configurations festival_class_configurations_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_class_configurations
    ADD CONSTRAINT festival_class_configurations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: festival_customer_profile_access_audit festival_customer_profile_access_audit_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customer_profile_access_audit
    ADD CONSTRAINT festival_customer_profile_access_audit_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: festival_customer_staff_consents festival_customer_staff_consen_customer_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customer_staff_consents
    ADD CONSTRAINT festival_customer_staff_consen_customer_id_organization_id_fkey FOREIGN KEY (customer_id, organization_id) REFERENCES orgs.festival_customers(id, organization_id) ON DELETE CASCADE;


--
-- Name: festival_customers festival_customers_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festival_customers
    ADD CONSTRAINT festival_customers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: festivals festivals_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.festivals
    ADD CONSTRAINT festivals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: invites invites_invited_by_user_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.invites
    ADD CONSTRAINT invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES orgs.users(id) ON DELETE CASCADE;


--
-- Name: invites invites_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.invites
    ADD CONSTRAINT invites_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_reconciliation_runs membership_reconciliation_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_reconciliation_runs
    ADD CONSTRAINT membership_reconciliation_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_validation_decisions membership_validation_decisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.membership_validation_decisions
    ADD CONSTRAINT membership_validation_decisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.memberships
    ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES orgs.users(id) ON DELETE CASCADE;


--
-- Name: organization_divisions organization_divisions_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.organization_divisions
    ADD CONSTRAINT organization_divisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE RESTRICT;


--
-- Name: products products_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.products
    ADD CONSTRAINT products_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: registration_age_configurations registration_age_configurations_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_age_configurations
    ADD CONSTRAINT registration_age_configurations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: registration_catalog_values registration_catalog_values_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.registration_catalog_values
    ADD CONSTRAINT registration_catalog_values_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_customer_account_integrations shopify_customer_account_integrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_account_integrations
    ADD CONSTRAINT shopify_customer_account_integrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_customer_oauth_states shopify_customer_oauth_states_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_oauth_states
    ADD CONSTRAINT shopify_customer_oauth_states_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_customer_sessions shopify_customer_sessions_customer_id_organization_id_shop_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_sessions
    ADD CONSTRAINT shopify_customer_sessions_customer_id_organization_id_shop_fkey FOREIGN KEY (customer_id, organization_id, shopify_customer_gid) REFERENCES orgs.festival_customers(id, organization_id, shopify_customer_gid) ON DELETE CASCADE;


--
-- Name: shopify_customer_sessions shopify_customer_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_customer_sessions
    ADD CONSTRAINT shopify_customer_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_integrations shopify_integrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_integrations
    ADD CONSTRAINT shopify_integrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_order_projections shopify_order_projections_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_order_projections
    ADD CONSTRAINT shopify_order_projections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: shopify_webhook_deliveries shopify_webhook_deliveries_organization_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.shopify_webhook_deliveries
    ADD CONSTRAINT shopify_webhook_deliveries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES orgs.organizations(id) ON DELETE CASCADE;


--
-- Name: user_login_event user_login_event_user_id_fkey; Type: FK CONSTRAINT; Schema: orgs; Owner: -
--

ALTER TABLE ONLY orgs.user_login_event
    ADD CONSTRAINT user_login_event_user_id_fkey FOREIGN KEY (user_id) REFERENCES orgs.app_user(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


