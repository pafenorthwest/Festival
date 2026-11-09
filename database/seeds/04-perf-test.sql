-- 04-perf-test.sql: Pure Postgres seed records for performance test environment.
-- Idempotent: safe to run multiple times without duplication or errors.

-- Reset previous test children and snapshots for isolated perf runs
DELETE FROM orgs.festival_child_age_snapshots WHERE organization_id = 'perf-test';
DELETE FROM orgs.festival_children WHERE organization_id = 'perf-test';

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

-- 5. 500 Festival Customers
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
  'perf-cust-' || lpad(i::text, 3, '0'),
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
FROM generate_series(1, 500) AS s(i)
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

-- 6. 500 Customer Sessions
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
  'perf-sess-' || lpad(i::text, 3, '0'),
  'perf-test',
  'perf-cust-' || lpad(i::text, 3, '0'),
  'gid://shopify/Customer/' || (99000000 + i)::text,
  'seed-token',
  'perf-csrf-' || lpad(i::text, 3, '0'),
  1,
  now(),
  now(),
  now() + interval '30 days',
  NULL
FROM generate_series(1, 500) AS s(i)
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
