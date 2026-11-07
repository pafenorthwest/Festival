import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";
import { currentPostgresFixture } from "./postgres-test-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const snapshotSchema = currentPostgresFixture("age_snapshot_integrity");

integrationTest(
	"Postgres rejects child and age-snapshot references that do not exist",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const organizations = fixture.repository(
				new PostgresOrganizationRepository(fixture.schema),
			);
			const customers = fixture.repository(
				new PostgresCustomerAccountRepository(fixture.schema),
			);
			const organization = await organizations.createOrganization({
				name: fixture.id("organization"),
				slug: fixture.id("organization"),
			});
			fixture.trackOrganization(organization.id);

			await expect(
				fixture.savepoint(() =>
					customers.createChild({
						organizationId: organization.id,
						parentCustomerId: fixture.id("missing-parent"),
						displayName: "Orphaned child",
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });

			await expect(
				fixture.savepoint(() =>
					customers.createChildAgeSnapshot({
						organizationId: organization.id,
						childId: fixture.id("missing-child"),
						age: 9,
						validUntilIso: "2027-01-01T00:00:00.000Z",
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });
		});
	},
);

integrationTest(
	"Postgres rejects a class configuration linked to another organization's festival",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const organizations = fixture.repository(
				new PostgresOrganizationRepository(fixture.schema),
			);
			const organizationA = await organizations.createOrganization({
				name: fixture.id("organization-a"),
				slug: fixture.id("organization-a"),
			});
			const organizationB = await organizations.createOrganization({
				name: fixture.id("organization-b"),
				slug: fixture.id("organization-b"),
			});
			fixture.trackOrganization(organizationA.id);
			fixture.trackOrganization(organizationB.id);
			const festivalB = await organizations.createFestival({
				id: fixture.id("festival-b"),
				organizationId: organizationB.id,
				code: "FEST-B",
				shortName: "fest-b",
				name: "Festival B",
				startDate: "2027-01-01",
				endDate: "2027-01-02",
			});
			const festivalA = await organizations.createFestival({
				id: fixture.id("festival-a"),
				organizationId: organizationA.id,
				code: "FEST-A",
				shortName: "fest-a",
				name: "Festival A",
				startDate: "2027-01-01",
				endDate: "2027-01-02",
			});
			const divisionA = await organizations.createDivision({
				organizationId: organizationA.id,
				displayName: "Piano",
				normalizedName: "piano",
			});
			const subtypeA = await organizations.createRegistrationCatalogValue({
				organizationId: organizationA.id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
			});
			const divisionB = await organizations.createDivision({
				organizationId: organizationB.id,
				displayName: "Strings",
				normalizedName: "strings",
			});
			const subtypeB = await organizations.createRegistrationCatalogValue({
				organizationId: organizationB.id,
				kind: "class_subtype",
				displayName: "Ensemble",
				normalizedName: "ensemble",
			});
			const instrumentA = await organizations.createRegistrationCatalogValue({
				organizationId: organizationA.id,
				kind: "instrument",
				displayName: "Violin",
				normalizedName: "violin",
			});
			const classInput = {
				organizationId: organizationA.id,
				displayName: "Cross-tenant class",
				minimumAge: 5,
				maximumAge: 18,
				price: "30.00",
				maximumPerformancePieces: 1 as const,
				performanceMinutes: 5,
				capacity: 10,
				shopifyProductGid: `gid://shopify/Product/${fixture.id("product")}`,
				shopifyVariantGid: `gid://shopify/ProductVariant/${fixture.id("variant")}`,
			};

			await expect(
				fixture.savepoint(() =>
					organizations.createFestivalClassConfiguration({
						...classInput,
						festivalId: festivalB.id,
						divisionId: divisionA.id,
						classSubtypeId: subtypeA.id,
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });

			await expect(
				fixture.savepoint(() =>
					organizations.createFestivalClassConfiguration({
						...classInput,
						festivalId: festivalA.id,
						divisionId: divisionA.id,
						classSubtypeId: instrumentA.id,
						shopifyProductGid: `gid://shopify/Product/${fixture.id("product-kind")}`,
						shopifyVariantGid: `gid://shopify/ProductVariant/${fixture.id("variant-kind")}`,
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });

			await expect(
				fixture.savepoint(() =>
					organizations.createFestivalClassConfiguration({
						...classInput,
						festivalId: festivalA.id,
						divisionId: divisionA.id,
						classSubtypeId: subtypeB.id,
						shopifyProductGid: `gid://shopify/Product/${fixture.id("product-subtype")}`,
						shopifyVariantGid: `gid://shopify/ProductVariant/${fixture.id("variant-subtype")}`,
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });

			await expect(
				fixture.savepoint(() =>
					organizations.createFestivalClassConfiguration({
						...classInput,
						festivalId: festivalA.id,
						divisionId: divisionB.id,
						classSubtypeId: subtypeA.id,
						shopifyProductGid: `gid://shopify/Product/${fixture.id("product-division")}`,
						shopifyVariantGid: `gid://shopify/ProductVariant/${fixture.id("variant-division")}`,
					}),
				),
			).rejects.toMatchObject({ errno: "23503" });
		});
	},
);

integrationTest(
	"Postgres keeps at most one active child age snapshot during concurrent updates",
	async () => {
		const schema = await snapshotSchema();
		const organizations = new PostgresOrganizationRepository(schema);
		const customers = new PostgresCustomerAccountRepository(schema);
		const organization = await organizations.createOrganization({
			name: `snapshot-${randomUUID()}`,
			slug: `snapshot-${randomUUID()}`,
		});
		const now = "2026-10-30T12:00:00.000Z";
		const { customer } = await customers.createCustomerSession({
			sessionId: randomUUID(),
			organizationId: organization.id,
			shopifyCustomerGid: `gid://shopify/Customer/${randomUUID()}`,
			encryptedTokens: "encrypted-test-tokens",
			csrfToken: "csrf-test-token",
			integrationVersion: 1,
			createdAtIso: now,
			lastSeenAtIso: now,
			expiresAtIso: "2026-10-31T12:00:00.000Z",
		});
		const child = await customers.createChild({
			organizationId: organization.id,
			parentCustomerId: customer.id,
			displayName: "Snapshot child",
		});

		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				customers.createChildAgeSnapshot({
					organizationId: organization.id,
					childId: child.id,
					age: 8 + index,
					validUntilIso: "2027-01-01T00:00:00.000Z",
				}),
			),
		);
		const activeSnapshots = (
			await customers.listChildAgeSnapshots(organization.id, child.id)
		).filter((snapshot) => !snapshot.supersededAtIso);
		expect(activeSnapshots).toHaveLength(1);
	},
);
