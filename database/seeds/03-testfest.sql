-- 03-testfest.sql: Pure Postgres seed records for testfest benchmark and testing dataset.
-- Idempotent: safe to run multiple times without duplication or errors.

-- 1. Organization
INSERT INTO orgs.organizations (id, name, slug, timezone, default_currency_code)
VALUES ('testfest-org', 'Testfest Organization', 'testfest-org', 'America/Los_Angeles', 'USD')
ON CONFLICT (id) DO NOTHING;

-- 2. Registration age configuration
INSERT INTO orgs.registration_age_configurations (organization_id, registration_age_date, updated_at)
VALUES ('testfest-org', '2026-09-01', now())
ON CONFLICT (organization_id) DO UPDATE SET registration_age_date = EXCLUDED.registration_age_date, updated_at = now();

-- 3. Accompanist division policy
INSERT INTO orgs.membership_division_policies (organization_id, entitlement_class, policy, updated_at)
VALUES ('testfest-org', 'accompanist_membership', 'one_to_all', now())
ON CONFLICT (organization_id, entitlement_class) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now();

-- 4. Benchmark Festival
INSERT INTO orgs.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date)
VALUES ('seed-fest-testfest-2026', 'testfest-org', 'TEST26', 'testfest-2026', true, 'Testfest 2026 Benchmark Festival', '2026-06-01', '2026-06-05')
ON CONFLICT (id) DO NOTHING;

-- 5. Organization Divisions
INSERT INTO orgs.organization_divisions (id, organization_id, display_name, normalized_name, is_active, display_order)
VALUES
  ('seed-div-testfest-piano', 'testfest-org', 'Piano', 'piano', true, 1),
  ('seed-div-testfest-strings', 'testfest-org', 'Strings', 'strings', true, 2),
  ('seed-div-testfest-vocal', 'testfest-org', 'Vocal', 'vocal', true, 3)
ON CONFLICT (id) DO NOTHING;

-- 6. Class Subtypes (Catalog Values)
INSERT INTO orgs.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, is_active, display_order, required_subtype_id)
VALUES
  ('seed-subtype-testfest-solo', 'testfest-org', 'class_subtype', 'Solo', 'solo', true, 1, NULL),
  ('seed-subtype-testfest-duet', 'testfest-org', 'class_subtype', 'Duet', 'duet', true, 2, NULL),
  ('seed-subtype-testfest-ensemble', 'testfest-org', 'class_subtype', 'Ensemble', 'ensemble', true, 3, NULL)
ON CONFLICT (id) DO NOTHING;

-- 7. Festival Class Subtypes Association
INSERT INTO orgs.festival_class_subtypes (organization_id, festival_id, class_subtype_id)
VALUES
  ('testfest-org', 'seed-fest-testfest-2026', 'seed-subtype-testfest-solo'),
  ('testfest-org', 'seed-fest-testfest-2026', 'seed-subtype-testfest-duet'),
  ('testfest-org', 'seed-fest-testfest-2026', 'seed-subtype-testfest-ensemble')
ON CONFLICT (festival_id, class_subtype_id) DO NOTHING;

-- 8. Admin User & Membership
INSERT INTO orgs.users (id, firebase_uid, email, display_name, disassociated)
VALUES ('seed-user-testfest-admin', 'seed-admin-testfest-1', 'admin@testfest.example.org', 'Testfest Admin', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.memberships (id, organization_id, user_id, role, origin)
VALUES ('seed-membership-testfest-admin', 'testfest-org', 'seed-user-testfest-admin', 'Admin', 'creator')
ON CONFLICT (id) DO NOTHING;

-- 9. Teacher Offering Product
INSERT INTO orgs.products (id, organization_id, product_category, entitlement_class, duration_days, is_active, shopify_product_gid, shopify_variant_gid, product_name_snapshot)
VALUES ('seed-prod-testfest-teacher', 'testfest-org', 'membership', 'teacher_membership', 365, true, 'gid://shopify/Product/9009001', 'gid://shopify/ProductVariant/900900101', 'Testfest Teacher Annual Membership')
ON CONFLICT (id) DO NOTHING;

-- 10. Festival Customers
INSERT INTO orgs.festival_customers (id, organization_id, shopify_customer_gid, name, name_source, email, email_source, phone, phone_source, mailing_address, mailing_address_source, created_at, updated_at)
VALUES
  (
    'seed-cust-testfest-teacher-alpha',
    'testfest-org',
    'gid://shopify/Customer/9109001',
    'Testfest Teacher Alpha',
    'festival',
    'teacher.alpha@testfest.example.org',
    'festival',
    '+1 (555) 010-0001',
    'festival',
    '{"line1":"100 Benchmark Way","city":"Seattle","region":"WA","postalCode":"98101","countryCode":"US"}'::jsonb,
    'festival',
    '2026-10-15T00:00:00Z',
    '2026-10-15T00:00:00Z'
  ),
  (
    'seed-cust-testfest-teacher-beta',
    'testfest-org',
    'gid://shopify/Customer/9109002',
    'Testfest Teacher Beta',
    'festival',
    'teacher.beta@testfest.example.org',
    'festival',
    '+1 (555) 010-0002',
    'festival',
    '{"line1":"101 Benchmark Way","city":"Seattle","region":"WA","postalCode":"98101","countryCode":"US"}'::jsonb,
    'festival',
    '2026-10-15T00:00:00Z',
    '2026-10-15T00:00:00Z'
  ),
  (
    'seed-cust-testfest-accompanist',
    'testfest-org',
    'gid://shopify/Customer/9109003',
    'Testfest Accompanist Staff',
    'festival',
    'accompanist@testfest.example.org',
    'festival',
    '+1 (555) 010-0003',
    'festival',
    '{"line1":"102 Benchmark Way","city":"Seattle","region":"WA","postalCode":"98101","countryCode":"US"}'::jsonb,
    'festival',
    '2026-10-15T00:00:00Z',
    '2026-10-15T00:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;

-- 11. Staff Consents
INSERT INTO orgs.festival_customer_staff_consents (customer_id, organization_id, privacy_notice_version, consented_at)
VALUES
  ('seed-cust-testfest-teacher-alpha', 'testfest-org', 1, '2026-10-15T00:00:00Z'),
  ('seed-cust-testfest-teacher-beta', 'testfest-org', 1, '2026-10-15T00:00:00Z'),
  ('seed-cust-testfest-accompanist', 'testfest-org', 1, '2026-10-15T00:00:00Z')
ON CONFLICT (customer_id, privacy_notice_version) DO NOTHING;

-- 12. Membership Identity Emails
INSERT INTO orgs.membership_identity_emails (organization_id, normalized_email, customer_id, verified_at)
VALUES
  ('testfest-org', 'teacher.alpha@testfest.example.org', 'seed-cust-testfest-teacher-alpha', '2026-10-15T00:00:00Z'),
  ('testfest-org', 'teacher.beta@testfest.example.org', 'seed-cust-testfest-teacher-beta', '2026-10-15T00:00:00Z'),
  ('testfest-org', 'accompanist@testfest.example.org', 'seed-cust-testfest-accompanist', '2026-10-15T00:00:00Z')
ON CONFLICT (organization_id, normalized_email) DO NOTHING;

-- 13. Teacher Entitlements & Details & Divisions
INSERT INTO orgs.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on)
VALUES
  ('seed-ent-testfest-teacher-alpha', 'testfest-org', 'seed-cust-testfest-teacher-alpha', 'teacher_membership', 'teacher_checkout', 'seed-prod-testfest-teacher', '2026-06-01', '2027-06-01'),
  ('seed-ent-testfest-teacher-beta', 'testfest-org', 'seed-cust-testfest-teacher-beta', 'teacher_membership', 'teacher_checkout', 'seed-prod-testfest-teacher', '2026-06-01', '2027-06-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.teacher_membership_entitlement_details (entitlement_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, paid_amount, paid_currency_code, duration_days)
VALUES
  ('seed-ent-testfest-teacher-alpha', 'seed-intent-testfest-t1', 'gid://shopify/Order/9209001', 'gid://shopify/OrderLine/920900101', '50.00', 'USD', 365),
  ('seed-ent-testfest-teacher-beta', 'seed-intent-testfest-t2', 'gid://shopify/Order/9209002', 'gid://shopify/OrderLine/920900201', '50.00', 'USD', 365)
ON CONFLICT (entitlement_id) DO NOTHING;

INSERT INTO orgs.membership_entitlement_divisions (entitlement_id, organization_id, division_id, division_name_snapshot)
VALUES
  ('seed-ent-testfest-teacher-alpha', 'testfest-org', 'seed-div-testfest-piano', 'Piano'),
  ('seed-ent-testfest-teacher-beta', 'testfest-org', 'seed-div-testfest-strings', 'Strings')
ON CONFLICT (entitlement_id, division_id) DO NOTHING;

-- 14. Accompanist Entitlement & Details & Divisions & Cohort
INSERT INTO orgs.membership_entitlement_cohorts (organization_id, customer_id, entitlement_class, version)
VALUES ('testfest-org', 'seed-cust-testfest-accompanist', 'accompanist_membership', 1)
ON CONFLICT (organization_id, customer_id, entitlement_class) DO NOTHING;

INSERT INTO orgs.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on)
VALUES
  ('seed-ent-testfest-accompanist', 'testfest-org', 'seed-cust-testfest-accompanist', 'accompanist_membership', 'accompanist_form', NULL, '2026-06-01', '2027-06-01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.accompanist_membership_entitlement_details (entitlement_id, contact_name, contact_email, contact_city, contact_phone)
VALUES
  ('seed-ent-testfest-accompanist', 'Testfest Accompanist Staff', 'accompanist@testfest.example.org', 'Seattle', '+1 (555) 010-0003')
ON CONFLICT (entitlement_id) DO NOTHING;

INSERT INTO orgs.membership_entitlement_divisions (entitlement_id, organization_id, division_id, division_name_snapshot)
VALUES
  ('seed-ent-testfest-accompanist', 'testfest-org', 'seed-div-testfest-piano', 'Piano'),
  ('seed-ent-testfest-accompanist', 'testfest-org', 'seed-div-testfest-strings', 'Strings'),
  ('seed-ent-testfest-accompanist', 'testfest-org', 'seed-div-testfest-vocal', 'Vocal')
ON CONFLICT (entitlement_id, division_id) DO NOTHING;

-- 15. Festival Class Configurations & Audit Logs
INSERT INTO orgs.festival_class_configurations (
  id, organization_id, festival_id, display_name, class_subtype_id, division_id,
  minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes,
  capacity, is_active, shopify_product_gid, shopify_variant_gid
)
VALUES
  (
    'seed-class-testfest-piano-solo', 'testfest-org', 'seed-fest-testfest-2026', 'Testfest Piano Solo Beginner',
    'seed-subtype-testfest-solo', 'seed-div-testfest-piano', 6, 12, '35.00', 1, 5, 25, true,
    'gid://shopify/Product/9009101', 'gid://shopify/ProductVariant/900910101'
  ),
  (
    'seed-class-testfest-strings-solo', 'testfest-org', 'seed-fest-testfest-2026', 'Testfest Strings Solo Intermediate',
    'seed-subtype-testfest-solo', 'seed-div-testfest-strings', 10, 18, '45.00', 2, 10, 20, true,
    'gid://shopify/Product/9009102', 'gid://shopify/ProductVariant/900910201'
  ),
  (
    'seed-class-testfest-vocal-duet', 'testfest-org', 'seed-fest-testfest-2026', 'Testfest Vocal Duet Open',
    'seed-subtype-testfest-duet', 'seed-div-testfest-vocal', 8, 25, '50.00', 1, 8, 15, true,
    'gid://shopify/Product/9009103', 'gid://shopify/ProductVariant/900910301'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs.festival_class_capacity_audit_logs (
  id, organization_id, festival_id, festival_class_id, actor_uid,
  action, previous_capacity, new_capacity, placed_count_at_change, availability_after_change
)
VALUES
  ('seed-audit-testfest-c1', 'testfest-org', 'seed-fest-testfest-2026', 'seed-class-testfest-piano-solo', 'seed-admin-testfest-1', 'class_created', NULL, 25, 0, 'open'),
  ('seed-audit-testfest-c2', 'testfest-org', 'seed-fest-testfest-2026', 'seed-class-testfest-strings-solo', 'seed-admin-testfest-1', 'class_created', NULL, 20, 0, 'open'),
  ('seed-audit-testfest-c3', 'testfest-org', 'seed-fest-testfest-2026', 'seed-class-testfest-vocal-duet', 'seed-admin-testfest-1', 'class_created', NULL, 15, 0, 'open')
ON CONFLICT (id) DO NOTHING;
