-- 04-perf-test.sql: Pure Postgres seed records for performance test environment.
-- Idempotent: safe to run multiple times without duplication or errors.

-- Reset previous test children and snapshots for isolated perf runs
DELETE FROM orgs.festival_class_waitlist_events WHERE organization_id = 'perf-test';
DELETE FROM orgs.festival_class_waitlist_entries WHERE organization_id = 'perf-test';
DELETE FROM orgs.festival_child_age_snapshots WHERE organization_id = 'perf-test' AND child_id != 'perf-child-seed-01';
DELETE FROM orgs.festival_children WHERE organization_id = 'perf-test' AND id != 'perf-child-seed-01';

-- 1. Organization
INSERT INTO orgs.organizations (id, name, slug, timezone, default_currency_code)
VALUES ('perf-test', 'Performance Test Organization', 'perf-test', 'America/Los_Angeles', 'USD')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  timezone = EXCLUDED.timezone,
  default_currency_code = EXCLUDED.default_currency_code;

-- 2. Registration age configuration
INSERT INTO orgs.registration_age_configurations (organization_id, registration_age_date, updated_at)
VALUES ('perf-test', '2026-09-01', now())
ON CONFLICT (organization_id) DO UPDATE SET
  registration_age_date = EXCLUDED.registration_age_date,
  updated_at = now();

-- 3. Customer account integration
INSERT INTO orgs.shopify_customer_account_integrations (
  organization_id,
  storefront_domain,
  client_id,
  encrypted_client_secret,
  readiness,
  integration_version,
  updated_at
)
VALUES (
  'perf-test',
  'perf-test.myshopify.com',
  'perf-client-id',
  'seed',
  'ready',
  1,
  now()
)
ON CONFLICT (organization_id) DO UPDATE SET
  storefront_domain = EXCLUDED.storefront_domain,
  client_id = EXCLUDED.client_id,
  encrypted_client_secret = EXCLUDED.encrypted_client_secret,
  readiness = EXCLUDED.readiness,
  integration_version = EXCLUDED.integration_version,
  updated_at = now();

-- 4. Primary Festival
INSERT INTO orgs.festivals (
  id,
  organization_id,
  code,
  short_name,
  is_primary,
  name,
  start_date,
  end_date
)
VALUES (
  'seed-fest-perf-2026',
  'perf-test',
  'PERF26',
  'perf-2026',
  true,
  'Performance Test 2026 Festival',
  '2026-06-01',
  '2026-06-05'
)
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  code = EXCLUDED.code,
  short_name = EXCLUDED.short_name,
  is_primary = EXCLUDED.is_primary,
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date;

-- 4b. Divisions, Subtypes, and Classes for Performance Testing
INSERT INTO orgs.organization_divisions (id, organization_id, display_name, normalized_name, is_active, display_order)
VALUES ('perf-div-piano', 'perf-test', 'Piano', 'piano', true, 1)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active;

INSERT INTO orgs.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, is_active, display_order)
VALUES ('perf-subtype-solo', 'perf-test', 'class_subtype', 'Solo', 'solo', true, 1)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = EXCLUDED.is_active;

INSERT INTO orgs.festival_class_subtypes (organization_id, festival_id, class_subtype_id)
VALUES ('perf-test', 'seed-fest-perf-2026', 'perf-subtype-solo')
ON CONFLICT DO NOTHING;

INSERT INTO orgs.festival_class_configurations (
  id, organization_id, festival_id, display_name, class_subtype_id, division_id,
  minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes,
  capacity, is_active, shopify_product_gid, shopify_variant_gid
)
VALUES (
  'perf-class-01', 'perf-test', 'seed-fest-perf-2026', 'Performance Test Piano Solo',
  'perf-subtype-solo', 'perf-div-piano', 5, 18, '30.00', 1, 5,
  1, true, 'gid://shopify/Product/990099', 'gid://shopify/ProductVariant/99009901'
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  capacity = EXCLUDED.capacity,
  is_active = EXCLUDED.is_active;

INSERT INTO orgs.festival_customers (
  id, organization_id, shopify_customer_gid, name, name_source,
  email, email_source, phone, phone_source, mailing_address,
  mailing_address_source, created_at, updated_at
)
VALUES (
  'perf-cust-0001', 'perf-test', 'gid://shopify/Customer/99000001',
  'Perf Parent 1', 'festival', 'perf.parent.1@test.example.org',
  'festival', '+15550001', 'festival',
  '{"address1":"123 Perf Way","city":"Seattle","provinceCode":"WA","postalCode":"98101","countryCode":"US"}'::jsonb,
  'festival', now(), now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.shopify_customer_sessions (
  session_id, organization_id, customer_id, shopify_customer_gid,
  encrypted_tokens, csrf_token, integration_version, created_at,
  last_seen_at, expires_at, revoked_at
)
VALUES (
  'perf-sess-0001', 'perf-test', 'perf-cust-0001', 'gid://shopify/Customer/99000001',
  'seed-token', 'perf-csrf-0001', 1, now(), now(), now() + interval '30 days', NULL
)
ON CONFLICT (session_id) DO NOTHING;

INSERT INTO orgs.festival_children (
  id, organization_id, parent_customer_id, display_name, created_at
)
VALUES (
  'perf-child-seed-01', 'perf-test', 'perf-cust-0001', 'Perf Child Seed 01', now()
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name;

INSERT INTO orgs.festival_child_age_snapshots (
  id, child_id, organization_id, age, created_at, valid_until
)
VALUES (
  'perf-snap-seed-01', 'perf-child-seed-01', 'perf-test', 10, now(), now() + interval '365 days'
)
ON CONFLICT (id) DO UPDATE SET
  age = EXCLUDED.age,
  valid_until = EXCLUDED.valid_until;

INSERT INTO orgs.checkout_intents (
  id, correlation_id, organization_id, customer_id, session_id,
  idempotency_key, intent_type, festival_class_id, child_id,
  shopify_product_gid, shopify_variant_gid, division_id,
  division_name_snapshot, amount, currency_code, status,
  expires_at, created_at
)
VALUES (
  'seed-intent-01', 'perf-corr-seed-01', 'perf-test', 'perf-cust-0001', 'perf-sess-0001',
  'perf-idem-seed-01', 'class_entry', 'perf-class-01', 'perf-child-seed-01',
  'gid://shopify/Product/990099', 'gid://shopify/ProductVariant/99009901', 'perf-div-piano',
  'Piano', '30.00', 'USD', 'approved',
  now() + interval '365 days', now()
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  expires_at = EXCLUDED.expires_at;

INSERT INTO orgs.checkout_intent_lines (
  id, checkout_intent_id, line_index, line_type, festival_class_id,
  child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code,
  division_id, division_name_snapshot
)
VALUES (
  'seed-intent-line-01', 'seed-intent-01', 0, 'class_entry', 'perf-class-01',
  'perf-child-seed-01', 'gid://shopify/Product/990099', 'gid://shopify/ProductVariant/99009901', '30.00', 'USD',
  'perf-div-piano', 'Piano'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.class_entitlements (
  id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id,
  checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid,
  paid_amount_cents, paid_currency_code, status, capacity_at_allocation, placed_count_before_allocation,
  created_at, updated_at
)
VALUES (
  'perf-ent-01', 'perf-test', 'seed-fest-perf-2026', 'perf-class-01', 'perf-cust-0001', 'perf-child-seed-01',
  'seed-intent-01', 'seed-intent-line-01', 'gid://shopify/Order/99009901', 'gid://shopify/OrderLine/9900990101',
  3000, 'USD', 'confirmed', 1, 0,
  now(), now()
)
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();

-- 5. 5,000 Festival Customers
INSERT INTO orgs.festival_customers (
  id,
  organization_id,
  shopify_customer_gid,
  name,
  name_source,
  email,
  email_source,
  phone,
  phone_source,
  mailing_address,
  mailing_address_source,
  created_at,
  updated_at
)
SELECT
  'perf-cust-' || lpad(i::text, 4, '0'),
  'perf-test',
  'gid://shopify/Customer/' || (99000000 + i)::text,
  'Perf Parent ' || i::text,
  'festival',
  'perf.parent.' || i::text || '@test.example.org',
  'festival',
  '+1555000' || i::text,
  'festival',
  '{"address1":"123 Perf Way","city":"Seattle","provinceCode":"WA","postalCode":"98101","countryCode":"US"}'::jsonb,
  'festival',
  now(),
  now()
FROM generate_series(1, 5000) AS s(i)
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  shopify_customer_gid = EXCLUDED.shopify_customer_gid,
  name = EXCLUDED.name,
  name_source = EXCLUDED.name_source,
  email = EXCLUDED.email,
  email_source = EXCLUDED.email_source,
  phone = EXCLUDED.phone,
  phone_source = EXCLUDED.phone_source,
  mailing_address = EXCLUDED.mailing_address,
  mailing_address_source = EXCLUDED.mailing_address_source,
  updated_at = now();

-- 6. 5,000 Customer Sessions
INSERT INTO orgs.shopify_customer_sessions (
  session_id,
  organization_id,
  customer_id,
  shopify_customer_gid,
  encrypted_tokens,
  csrf_token,
  integration_version,
  created_at,
  last_seen_at,
  expires_at,
  revoked_at
)
SELECT
  'perf-sess-' || lpad(i::text, 4, '0'),
  'perf-test',
  'perf-cust-' || lpad(i::text, 4, '0'),
  'gid://shopify/Customer/' || (99000000 + i)::text,
  'seed-token',
  'perf-csrf-' || lpad(i::text, 4, '0'),
  1,
  now(),
  now(),
  now() + interval '30 days',
  NULL
FROM generate_series(1, 5000) AS s(i)
ON CONFLICT (session_id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  customer_id = EXCLUDED.customer_id,
  shopify_customer_gid = EXCLUDED.shopify_customer_gid,
  encrypted_tokens = EXCLUDED.encrypted_tokens,
  csrf_token = EXCLUDED.csrf_token,
  integration_version = EXCLUDED.integration_version,
  last_seen_at = EXCLUDED.last_seen_at,
  expires_at = EXCLUDED.expires_at,
  revoked_at = EXCLUDED.revoked_at;
