import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	addCalendarDays,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import {
	PostgresCustomerIntegrationRepository,
	PostgresCustomerSessionRepository,
} from "../src/domains/customer-identity/index.js";
import {
	PostgresMembershipEntitlementRepository,
	PostgresMembershipProductRepository,
} from "../src/domains/teacher-directory/index.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("prod_repo");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function setupRepos(schema: string) {
	const orgRepo = new PostgresOrganizationRepository(schema);
	const integrations = new PostgresCustomerIntegrationRepository(schema);
	const sessions = new PostgresCustomerSessionRepository(schema);
	const products = new PostgresMembershipProductRepository(schema);
	const entitlements = new PostgresMembershipEntitlementRepository(schema);
	const organization = await orgRepo.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
	await integrations.upsertIntegration({
		organizationId: organization.id,
		storefrontDomain: "pafe.myshopify.com",
		clientId: "cid",
		encryptedClientSecret: "enc",
	});
	const seedCustomer = async (tag: string) => {
		const now = new Date().toISOString();
		const { customer } = await sessions.createCustomerSession({
			sessionId: randomUUID(),
			organizationId: organization.id,
			shopifyCustomerGid: `gid://shopify/Customer/${tag}`,
			encryptedTokens: "tok",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: now,
			lastSeenAtIso: now,
			expiresAtIso: "2099-01-01T00:00:00.000Z",
		});
		return customer;
	};
	const c1 = await seedCustomer("1001");
	const c2 = await seedCustomer("1002");
	return { orgRepo, products, entitlements, organization, c1, c2 };
}

describe("product repository", () => {
	it("defines the bounded offering and canonical entitlement schema", () => {
		const source = buildCanonicalPostgresSchemaSql("schema");
		expect(source).toContain("duration_days > 0 AND duration_days <= 36500");
		expect(source).toContain("idx_products_org_active_entitlement_class");
		expect(source).toContain(
			"CREATE TABLE IF NOT EXISTS schema.membership_entitlements",
		);
		expect(source).toContain("membership_entitlement_divisions");
		expect(source).toContain("teacher_membership_entitlement_details");
		expect(source).toContain("EXCLUDE USING gist");
		expect(source).not.toContain("schema.entitlement_grants");
		expect(source).toContain("shopify_order_line_gid TEXT NOT NULL UNIQUE");
		expect(source).toContain("CHECK (ends_on > starts_on)");
		expect(source).not.toMatch(/ALTER TABLE|entitlement_period/);
	});

	integrationTest(
		"creates and lists membership product associations in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const { products, organization } = await setupRepos(schema);
				const created = await products.createMembershipProductRecord({
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/1",
					shopifyVariantGid: "gid://shopify/ProductVariant/1",
					productNameSnapshot: "Teacher Membership",
				});

				await expect(
					products.listMembershipProductRecords(organization.id),
				).resolves.toEqual([created]);
				await expect(
					products.findMembershipProductRecordByClass(
						organization.id,
						TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					),
				).resolves.toEqual(created);
				await expect(
					products.findProductRecordByShopifyProductGid(
						"gid://shopify/Product/1",
					),
				).resolves.toEqual(created);
				await expect(
					products.findProductRecordByShopifyVariantGid(
						"gid://shopify/ProductVariant/1",
					),
				).resolves.toEqual(created);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"persists immutable tenant/customer-scoped entitlement snapshots in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const { orgRepo, products, entitlements, organization, c1 } =
					await setupRepos(schema);
				const division = await orgRepo.createDivision({
					organizationId: organization.id,
					displayName: "High Strings",
					normalizedName: "high strings",
				});
				const offering = await products.createMembershipProductRecord({
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/grant",
					shopifyVariantGid: "gid://shopify/ProductVariant/grant",
					productNameSnapshot: "Teacher Membership",
				});
				const grant = await entitlements.createEntitlementGrantSnapshot({
					organizationId: organization.id,
					customerId: c1.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: offering.id,
					durationDays: 365,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "checkout-intent-1",
					shopifyOrderGid: "gid://shopify/Order/1",
					shopifyOrderLineGid: "gid://shopify/LineItem/1",
					startsOn: "2026-01-01",
					endsOn: "2027-01-01",
					status: "active",
					verifiedIdentityEmail: "shopper@example.com",
				});

				await orgRepo.updateDivision({
					organizationId: organization.id,
					divisionId: division.id,
					displayName: "Renamed Strings",
					normalizedName: "renamed strings",
				});
				await products.updateMembershipProductRecord({
					organizationId: organization.id,
					productId: offering.id,
					productNameSnapshot: "Renamed Teacher Membership",
					durationDays: 30,
				});
				(grant as { divisionNameSnapshot: string }).divisionNameSnapshot =
					"tampered";

				await expect(
					entitlements.listEntitlementGrantSnapshots(organization.id, c1.id),
				).resolves.toMatchObject([
					{
						divisionNameSnapshot: "High Strings",
						durationDays: 365,
						paidAmount: "75.00",
						paidCurrencyCode: "USD",
						startsOn: "2026-01-01",
						endsOn: "2027-01-01",
					},
				]);
				await expect(
					entitlements.listEntitlementGrantSnapshots(
						organization.id,
						"other-customer",
					),
				).resolves.toEqual([]);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"rejects cross-tenant, wrong-class, and duplicate grant correlations in Postgres",
		async () => {
			const schema = await currentSchema();
			try {
				const { orgRepo, products, entitlements, organization, c1 } =
					await setupRepos(schema);
				const otherOrg = await orgRepo.createOrganization({
					name: "Other Festival",
					slug: "other",
				});
				const division = await orgRepo.createDivision({
					organizationId: organization.id,
					displayName: "Brass",
					normalizedName: "brass",
				});
				const teacherOffering = await products.createMembershipProductRecord({
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/corr",
					shopifyVariantGid: "gid://shopify/ProductVariant/corr",
					productNameSnapshot: "Teacher Membership",
				});
				const accompanistOffering =
					await products.createMembershipProductRecord({
						organizationId: organization.id,
						entitlementClass: ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 365,
						isActive: true,
						shopifyProductGid: "gid://shopify/Product/acc",
						shopifyVariantGid: "gid://shopify/ProductVariant/acc",
						productNameSnapshot: "Accompanist Membership",
					});
				const base = {
					organizationId: organization.id,
					customerId: c1.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: teacherOffering.id,
					durationDays: 365,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "checkout-intent-unique",
					shopifyOrderGid: "gid://shopify/Order/unique",
					shopifyOrderLineGid: "gid://shopify/LineItem/unique",
					startsOn: "2026-08-14",
					endsOn: "2027-08-14",
					status: "active" as const,
					verifiedIdentityEmail: "shopper@example.com",
				};

				await expect(
					entitlements.createEntitlementGrantSnapshot({
						...base,
						organizationId: otherOrg.id,
					}),
				).rejects.toThrow("offering was not found");
				await expect(
					entitlements.createEntitlementGrantSnapshot({
						...base,
						offeringId: accompanistOffering.id,
						checkoutIntentId: "checkout-intent-wrong-class",
						shopifyOrderLineGid: "gid://shopify/LineItem/wrong-class",
					}),
				).rejects.toThrow("offering was not found");

				await entitlements.createEntitlementGrantSnapshot(base);
				await expect(
					entitlements.createEntitlementGrantSnapshot({
						...base,
						shopifyOrderGid: "gid://shopify/Order/other",
					}),
				).rejects.toThrow("correlation is already recorded");
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"binds verified identity email to one customer and does not bind on validation failure",
		async () => {
			const schema = await currentSchema();
			try {
				const { orgRepo, products, entitlements, organization, c1, c2 } =
					await setupRepos(schema);
				const division = await orgRepo.createDivision({
					organizationId: organization.id,
					displayName: "Percussion",
					normalizedName: "percussion",
				});
				const offering = await products.createMembershipProductRecord({
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/id",
					shopifyVariantGid: "gid://shopify/ProductVariant/id",
					productNameSnapshot: "Teacher Membership",
				});
				const input = {
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					durationDays: 365,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					startsOn: "2026-08-14",
					endsOn: "2027-08-14",
					status: "active" as const,
					verifiedIdentityEmail: "Shopper@Example.com",
				};
				await expect(
					entitlements.createEntitlementGrantSnapshot({
						...input,
						customerId: c1.id,
						offeringId: "missing-offering",
						checkoutIntentId: "ci-fail",
						shopifyOrderGid: "gid://shopify/Order/fail",
						shopifyOrderLineGid: "gid://shopify/LineItem/fail",
					}),
				).rejects.toThrow("offering was not found");
				await entitlements.createEntitlementGrantSnapshot({
					...input,
					customerId: c1.id,
					offeringId: offering.id,
					checkoutIntentId: "ci-1",
					shopifyOrderGid: "gid://shopify/Order/id1",
					shopifyOrderLineGid: "gid://shopify/LineItem/id1",
				});
				await expect(
					entitlements.createEntitlementGrantSnapshot({
						...input,
						customerId: c2.id,
						offeringId: offering.id,
						verifiedIdentityEmail: "shopper@example.com",
						checkoutIntentId: "ci-2",
						shopifyOrderGid: "gid://shopify/Order/id2",
						shopifyOrderLineGid: "gid://shopify/LineItem/id2",
					}),
				).rejects.toThrow("identity email belongs to another customer");
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"allows dual Teacher and Accompanist entitlements, derives lifecycle states, and enforces unique product rules",
		async () => {
			const schema = await currentSchema();
			try {
				const { orgRepo, products, entitlements, organization, c1 } =
					await setupRepos(schema);
				const division = await orgRepo.createDivision({
					organizationId: organization.id,
					displayName: "Voice",
					normalizedName: "voice",
				});
				const offering = await products.createMembershipProductRecord({
					organizationId: organization.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/dual",
					shopifyVariantGid: "gid://shopify/ProductVariant/dual",
					productNameSnapshot: "Teacher Membership",
				});

				await entitlements.createAccompanistMembershipGrant({
					organizationId: organization.id,
					customerId: c1.id,
					normalizedEmail: "shopper@example.com",
					offeringNameSnapshot: "Accompanist Membership",
					source: "accompanist_form",
					contact: {
						name: "Ava Accompanist",
						email: "ava@example.com",
						city: "Seattle",
						phone: "+1 206 555 0100",
					},
					divisions: [
						{ divisionId: division.id, divisionName: division.displayName },
					],
					startsOn: "2026-08-14",
					endsOn: "2027-08-14",
				});

				await entitlements.createEntitlementGrantSnapshot({
					organizationId: organization.id,
					customerId: c1.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: offering.id,
					durationDays: 365,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "ci-exp",
					shopifyOrderGid: "gid://shopify/Order/exp",
					shopifyOrderLineGid: "gid://shopify/LineItem/exp",
					startsOn: "2020-01-01",
					endsOn: addCalendarDays("2020-01-01", 365),
					status: "active",
					verifiedIdentityEmail: "shopper@example.com",
				});
				const activeStart = new Date(Date.now() - 10 * 86_400_000)
					.toISOString()
					.slice(0, 10);
				const activeEnd = addCalendarDays(activeStart, 365);
				await entitlements.createEntitlementGrantSnapshot({
					organizationId: organization.id,
					customerId: c1.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: offering.id,
					durationDays: 365,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "ci-act",
					shopifyOrderGid: "gid://shopify/Order/act",
					shopifyOrderLineGid: "gid://shopify/LineItem/act",
					startsOn: activeStart,
					endsOn: activeEnd,
					status: "active",
					verifiedIdentityEmail: "shopper@example.com",
				});
				const schedStart = addCalendarDays(activeEnd, 1);
				await entitlements.createEntitlementGrantSnapshot({
					organizationId: organization.id,
					customerId: c1.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: offering.id,
					durationDays: 365,
					divisionId: division.id,
					divisionNameSnapshot: division.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "ci-sch",
					shopifyOrderGid: "gid://shopify/Order/sch",
					shopifyOrderLineGid: "gid://shopify/LineItem/sch",
					startsOn: schedStart,
					endsOn: addCalendarDays(schedStart, 365),
					status: "active",
					verifiedIdentityEmail: "shopper@example.com",
				});
				const grants = await entitlements.listEntitlementGrantSnapshots(
					organization.id,
					c1.id,
				);
				expect(grants.map((g) => g.status).sort()).toEqual([
					"active",
					"expired",
					"scheduled",
				]);

				await expect(
					products.createMembershipProductRecord({
						organizationId: organization.id,
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 30,
						isActive: false,
						shopifyProductGid: "gid://shopify/Product/dual",
						shopifyVariantGid: "gid://shopify/ProductVariant/other",
						productNameSnapshot: "Dup Product",
					}),
				).rejects.toThrow("Shopify product is already associated.");
				await expect(
					products.createMembershipProductRecord({
						organizationId: organization.id,
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 30,
						isActive: false,
						shopifyProductGid: "gid://shopify/Product/other",
						shopifyVariantGid: "gid://shopify/ProductVariant/dual",
						productNameSnapshot: "Dup Variant",
					}),
				).rejects.toThrow("Shopify variant is already associated.");
				await expect(
					products.createMembershipProductRecord({
						organizationId: organization.id,
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 30,
						isActive: true,
						shopifyProductGid: "gid://shopify/Product/second",
						shopifyVariantGid: "gid://shopify/ProductVariant/second",
						productNameSnapshot: "Second Active",
					}),
				).rejects.toThrow(
					"Membership product already exists for this organization.",
				);

				await products.updateMembershipProductRecord({
					organizationId: organization.id,
					productId: offering.id,
					isActive: false,
				});
				await expect(
					products.createMembershipProductRecord({
						organizationId: organization.id,
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						durationDays: 30,
						isActive: true,
						shopifyProductGid: "gid://shopify/Product/second",
						shopifyVariantGid: "gid://shopify/ProductVariant/second",
						productNameSnapshot: "Replacement Teacher Membership",
					}),
				).resolves.toMatchObject({ isActive: true, durationDays: 30 });
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
