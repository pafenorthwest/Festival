import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { CustomerRegistrationQueryService } from "../../../src/domains/class-checkout/index.js";
import { DomainCacheInvalidator } from "../../../src/infra/s11-infra.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("cust_reg_query");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function seedOrgAndCatalog(schema: string) {
	await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug)
		VALUES ('org-1', 'Fest Org', 'fest-org'), ('org-2', 'Other Org', 'other-org');
		INSERT INTO ${schema}.organization_divisions (
			id, organization_id, display_name, normalized_name, display_order
		) VALUES ('div-1', 'org-1', 'Piano', 'piano', 0), ('div-2', 'org-2', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (
			id, organization_id, kind, display_name, normalized_name, display_order
		) VALUES ('sub-1', 'org-1', 'class_subtype', 'Solo', 'solo', 0), ('sub-2', 'org-2', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (
			id, organization_id, code, short_name, is_primary, name, start_date, end_date
		) VALUES
			('fest-1', 'org-1', 'SPR', 'spring', TRUE, 'Spring Fest', '2027-06-01', '2027-06-03'),
			('fest-2', 'org-2', 'OTH', 'other', TRUE, 'Other Fest', '2027-06-01', '2027-06-03');
		INSERT INTO ${schema}.festival_customers (
			id, organization_id, shopify_customer_gid, created_at, updated_at
		) VALUES
			('cust-1', 'org-1', 'gid://shopify/Customer/1', NOW(), NOW()),
			('cust-other', 'org-1', 'gid://shopify/Customer/2', NOW(), NOW()),
			('cust-2', 'org-2', 'gid://shopify/Customer/3', NOW(), NOW());
		INSERT INTO ${schema}.festival_children (
			id, organization_id, parent_customer_id, display_name, created_at
		) VALUES
			('child-1', 'org-1', 'cust-1', 'Alice', NOW()),
			('child-other', 'org-1', 'cust-other', 'Bob', NOW()),
			('child-2', 'org-2', 'cust-2', 'Eve', NOW());
		INSERT INTO ${schema}.festival_class_configurations (
			id, organization_id, festival_id, display_name, class_subtype_id,
			division_id, minimum_age, maximum_age, price, maximum_performance_pieces,
			performance_minutes, capacity, shopify_product_gid, shopify_variant_gid
		) VALUES
			('cls-a', 'org-1', 'fest-1', 'Piano A', 'sub-1', 'div-1', 5, 18, '50.00', 2, 10, 2, 'p1', 'v1'),
			('cls-b', 'org-1', 'fest-1', 'Piano B', 'sub-1', 'div-1', 5, 18, '60.00', 2, 10, 5, 'p2', 'v2'),
			('cls-2', 'org-2', 'fest-2', 'Piano 2', 'sub-2', 'div-2', 5, 18, '50.00', 2, 10, 5, 'p3', 'v3');
	`);
}

async function seedRegistrationsAndMetadata(schema: string) {
	await sql.unsafe(`
		INSERT INTO ${schema}.membership_entitlements (
			id, organization_id, customer_id, entitlement_class, source, starts_on, ends_on
		) VALUES ('tm-1', 'org-1', 'cust-other', 'teacher_membership', 'teacher_checkout', '2026-01-01', '2028-01-01');
		INSERT INTO ${schema}.checkout_intents (
			id, correlation_id, organization_id, customer_id, session_id,
			idempotency_key, intent_type, festival_class_id, child_id,
			shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at
		) VALUES
			('int-1', 'c-1', 'org-1', 'cust-1', 's1', 'k1', 'class_entry', 'cls-a', 'child-1', 'p1', 'v1', '50.00', 'USD', 'approved', NOW()),
			('int-2', 'c-2', 'org-1', 'cust-other', 's2', 'k2', 'class_entry', 'cls-a', 'child-other', 'p1', 'v1', '50.00', 'USD', 'approved', NOW()),
			('int-3', 'c-3', 'org-2', 'cust-2', 's3', 'k3', 'class_entry', 'cls-2', 'child-2', 'p3', 'v3', '50.00', 'USD', 'approved', NOW());
		INSERT INTO ${schema}.shopify_order_projections (
			organization_id, shopify_order_gid, correlation_id, fully_paid_at, created_at, updated_at
		) VALUES ('org-1', 'gid://shopify/Order/1', 'c-1', '2027-01-15T12:00:00.000Z', NOW(), NOW());
		INSERT INTO ${schema}.class_entitlements (
			id, organization_id, festival_id, festival_class_id, parent_customer_id,
			child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid,
			paid_amount_cents, paid_currency_code, status
		) VALUES
			('ent-1', 'org-1', 'fest-1', 'cls-a', 'cust-1', 'child-1', 'int-1', 'gid://shopify/Order/1', 'l1', 5000, 'USD', 'confirmed'),
			('ent-2', 'org-1', 'fest-1', 'cls-a', 'cust-other', 'child-other', 'int-2', 'gid://shopify/Order/2', 'l2', 5000, 'USD', 'confirmed'),
			('ent-3', 'org-1', 'fest-1', 'cls-b', 'cust-1', 'child-1', 'int-1', 'gid://shopify/Order/1', 'l3', 6000, 'USD', 'confirmed'),
			('ent-4', 'org-2', 'fest-2', 'cls-2', 'cust-2', 'child-2', 'int-3', 'gid://shopify/Order/3', 'l4', 5000, 'USD', 'confirmed');
		INSERT INTO ${schema}.registration_metadata (
			id, organization_id, festival_id, checkout_intent_id, class_entitlement_id,
			teacher_membership_id, repertoire_json, registration_snapshot
		) VALUES (
			'meta-1', 'org-1', 'fest-1', 'int-1', 'ent-1', 'tm-1',
			'[{"title":"Second","composer":"Bach","durationSeconds":120}]'::jsonb,
			'{"schemaVersion":1,"child":{"id":"child-1","displayName":"Alice"},"division":{"id":"div-1","name":"Piano"},"teacher":{"id":"tm-1","name":"Ms. Clara"},"accompanist":null}'::jsonb
		);
		INSERT INTO ${schema}.registration_repertoire_items (
			id, organization_id, registration_metadata_id, title_snapshot, duration_seconds, display_order
		) VALUES ('ri-2', 'org-1', 'meta-1', 'Second Piece', 120, 2), ('ri-1', 'org-1', 'meta-1', 'First Piece', 180, 1);
		INSERT INTO ${schema}.registration_repertoire_item_contributors (
			id, organization_id, registration_repertoire_item_id, display_name_snapshot, contributor_role, position
		) VALUES ('ric-2', 'org-1', 'ri-1', 'Arranger Bob', 'Arranger', 2), ('ric-1', 'org-1', 'ri-1', 'Composer Anna', 'Composer', 1);
	`);
}

async function seedQueryFixture() {
	const schema = await currentSchema();
	await seedOrgAndCatalog(schema);
	await seedRegistrationsAndMetadata(schema);
	return schema;
}

function makeFixtureClass(
	id: string,
	displayName: string,
	price: string,
	capacity: number,
) {
	return {
		id,
		organizationId: "org-1",
		festivalId: "fest-1",
		displayName,
		classSubtypeId: "sub-1",
		divisionId: "div-1",
		minimumAge: 5,
		maximumAge: 18,
		price,
		maximumPerformancePieces: 2 as const,
		performanceMinutes: 10,
		capacity,
		shopifyProductGid: "p1",
		shopifyVariantGid: "v1",
		isActive: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function buildQueryPorts() {
	const org = {
		id: "org-1",
		name: "Fest Org",
		slug: "fest-org",
		timezone: "UTC",
	};
	const festival = {
		id: "fest-1",
		organizationId: "org-1",
		code: "SPR",
		shortName: "spring",
		isPrimary: true,
		name: "Spring Fest",
		startDate: "2027-06-01",
		endDate: "2027-06-03",
		registrationOpenAt: "2026-01-01T00:00:00.000Z",
		registrationCloseAt: "2027-05-01T00:00:00.000Z",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
	const classes = [
		makeFixtureClass("cls-a", "Piano A", "50.00", 2),
		makeFixtureClass("cls-b", "Piano B", "60.00", 5),
	];
	const organizations = {
		findOrganizationBySlug: async (slug: string) =>
			slug === "fest-org" ? org : null,
		findOrganizationById: async () => org,
		getOrganizationTimezone: async () => "UTC",
		getOrganizationStorefrontConfig: async () => null,
	};
	const commerce = {
		countConfirmedClassEntitlements: async () => 999,
		countConfirmedClassEntitlementsByClassIds: async () => new Map(),
		listClassEntitlements: async () => [],
	};
	const checkout = {
		listRegistrationMetadataByEntitlementIds: async () => new Map(),
	};
	const customers = {
		getSession: async () => ({
			organizationId: "org-1",
			customerId: "cust-1",
			integrationVersion: 1,
		}),
		getCustomer: async () => null,
		listChildren: async () => [],
		findChild: async () => ({ id: "child-1", displayName: "Alice" }),
		findActiveChildAgeSnapshot: async () => ({
			age: 10,
			createdAtIso: "2026-01-01T00:00:00.000Z",
			validUntilIso: "2028-01-01T00:00:00.000Z",
		}),
	};
	return { festival, classes, organizations, commerce, checkout, customers };
}

function buildService(schema: string, invalidator: DomainCacheInvalidator) {
	const ports = buildQueryPorts();
	const service = new CustomerRegistrationQueryService({
		organizations: ports.organizations as never,
		catalog: {
			findFestivalByShortName: async () => ports.festival,
			listFestivals: async () => [ports.festival],
			listFestivalClassConfigurations: async () => ports.classes,
			listRegistrationCatalogValues: async () => [
				{
					id: "sub-1",
					organizationId: "org-1",
					kind: "class_subtype" as const,
					displayName: "Solo",
					normalizedName: "solo",
					displayOrder: 0,
					isActive: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			],
		} as never,
		customers: ports.customers as never,
		teachers: {
			findActiveTeacherEntitlementGrant: async () => ({ id: "tm-1" }),
			listActiveTeachersForDivision: async () => [],
		} as never,
		commerce: ports.commerce as never,
		checkout: ports.checkout as never,
		schema,
		useSqlReadModels: true,
		cacheInvalidator: invalidator,
		now: () => new Date("2027-02-01T00:00:00.000Z"),
	});
	return { service, ...ports };
}

describe("CustomerRegistrationQueryService integration", () => {
	afterEach(async () => {
		if (!process.env.POSTGRES_INTEGRATION_URL) return;
		const schema = await currentSchema();
		await resetPostgresFixture(schema);
	});

	postgresTest(
		"uses GROUP BY SQL counts for eligible classes and invalidates org cache on OrgUpdated",
		async () => {
			const schema = await seedQueryFixture();
			const invalidator = new DomainCacheInvalidator();
			const { service, organizations, commerce } = buildService(
				schema,
				invalidator,
			);
			const orgSpy = spyOn(organizations, "findOrganizationBySlug");
			const portCountSpy = spyOn(commerce, "countConfirmedClassEntitlements");
			const bulkCountSpy = spyOn(
				commerce,
				"countConfirmedClassEntitlementsByClassIds",
			);

			const first = await service.listRegistrationEligibleClasses(
				"fest-org",
				"spring",
				"sess-1",
				"child-1",
				"div-1",
				"tm-1",
			);
			const second = await service.listRegistrationEligibleClasses(
				"fest-org",
				"spring",
				"sess-1",
				"child-1",
				"div-1",
				"tm-1",
			);
			expect(orgSpy).toHaveBeenCalledTimes(1);
			expect(portCountSpy).toHaveBeenCalledTimes(0);
			expect(bulkCountSpy).toHaveBeenCalledTimes(0);
			expect(
				first.classes.map((c) => [c.id, c.placedCount, c.availability]),
			).toEqual([
				["cls-a", 2, "waitlist"],
				["cls-b", 1, "open"],
			]);
			expect(second.classes).toEqual(first.classes);

			invalidator.emit({
				type: "OrgUpdated",
				organizationId: "org-1",
				slug: "fest-org",
			});
			await service.listRegistrationEligibleClasses(
				"fest-org",
				"spring",
				"sess-1",
				"child-1",
				"div-1",
				"tm-1",
			);
			expect(orgSpy).toHaveBeenCalledTimes(2);
		},
	);

	postgresTest(
		"loads joined registrations via SQL with ordered repertoire items, contributors, and tenant isolation",
		async () => {
			const schema = await seedQueryFixture();
			const invalidator = new DomainCacheInvalidator();
			const { service, commerce, checkout, customers } = buildService(
				schema,
				invalidator,
			);
			const entSpy = spyOn(commerce, "listClassEntitlements");
			const metaSpy = spyOn(
				checkout,
				"listRegistrationMetadataByEntitlementIds",
			);
			const childSpy = spyOn(customers, "listChildren");

			const response = await service.listClassRegistrations(
				"fest-org",
				"sess-1",
				"spring",
			);
			expect(entSpy).toHaveBeenCalledTimes(0);
			expect(metaSpy).toHaveBeenCalledTimes(0);
			expect(childSpy).toHaveBeenCalledTimes(0);
			expect(response.registrations.map((r) => r.entitlement.id)).toEqual([
				"ent-1",
				"ent-3",
			]);
			const first = response.registrations[0];
			expect(first?.paidAtIso).toBe("2027-01-15T12:00:00.000Z");
			expect(first?.canEditMetadata).toBeTrue();
			expect(first?.metadata?.teacherName).toBe("Ms. Clara");
			expect(
				first?.metadata?.repertoireItems.map((item) => item.titleSnapshot),
			).toEqual(["First Piece", "Second Piece"]);
			expect(
				first?.metadata?.repertoireItems[0]?.contributors.map(
					(c) => c.displayNameSnapshot,
				),
			).toEqual(["Composer Anna", "Arranger Bob"]);
		},
	);
});
