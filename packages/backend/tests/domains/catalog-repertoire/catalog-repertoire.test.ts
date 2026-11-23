import { describe, expect, it, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import type { FestivalClassConfiguration } from "@festival/common";
import type { TenantContext } from "../../../src/auth/tenant-context.js";
import {
	type DivisionFestivalRepository,
	DivisionFestivalService,
	PostgresDivisionFestivalRepository,
	PostgresRegistrationCatalogRepository,
	type RegistrationCatalogRepository,
	RegistrationCatalogService,
} from "../../../src/domains/catalog-repertoire/index.js";
import {
	PostgresTenantRepository,
	type TenantRepository,
} from "../../../src/domains/tenant-org/index.js";
import { DomainCacheInvalidator } from "../../../src/lib/domain-cache-invalidator.js";
import { withApplicationRollback } from "../../postgres-application-fixture.js";

const integrationIt = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

function makeTenant(): TenantContext {
	return {
		organization: {
			id: "org-cat-1",
			name: "Catalog Fest Org",
			slug: "cat-org",
			timezone: "UTC",
			defaultCurrencyCode: "USD",
			createdAtIso: "2026-01-01T00:00:00.000Z",
		},
		user: {
			id: "user-cat-1",
			firebaseUid: "fb-cat-1",
			email: "cat@example.com",
			displayName: "Cat Admin",
			disassociated: false,
			createdAtIso: "2026-01-01T00:00:00.000Z",
		},
		membership: {
			id: "mem-cat-1",
			organizationId: "org-cat-1",
			userId: "user-cat-1",
			role: "Admin",
			origin: "creator",
			joinedAtIso: "2026-01-01T00:00:00.000Z",
		},
		role: "Admin",
		identity: {
			uid: "fb-cat-1",
			email: "cat@example.com",
			displayName: "Cat Admin",
		},
	};
}

describe("domains/catalog-repertoire catalog services (unit)", () => {
	it("emits FestivalCatalogUpdated across division and festival mutations", async () => {
		const invalidator = new DomainCacheInvalidator();
		const events: Array<{
			type: string;
			organizationId?: string;
			slug?: string;
			festivalId?: string;
		}> = [];
		invalidator.subscribe((e) => events.push(e));

		const divRepo = {
			listDivisions: mock(async () => []),
			createDivision: mock(async (input) => ({
				id: "div-1",
				organizationId: input.organizationId,
				displayName: input.displayName,
				isActive: true,
				displayOrder: 0,
				createdAtIso: "2026-01-01T00:00:00.000Z",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			})),
			findFestivalByName: mock(async () => null),
			findFestivalByShortName: mock(async () => ({
				id: "fest-1",
				organizationId: "org-cat-1",
				code: "SPR",
				shortName: "spring",
				isPrimary: false,
				name: "Spring Fest",
				startDate: "2027-05-01",
				endDate: "2027-05-03",
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
			setPrimaryFestival: mock(async () => ({
				id: "fest-1",
				organizationId: "org-cat-1",
				code: "SPR",
				shortName: "spring",
				isPrimary: true,
				name: "Spring Fest",
				startDate: "2027-05-01",
				endDate: "2027-05-03",
				createdAtIso: "2026-01-01T00:00:00.000Z",
			})),
		} as unknown as DivisionFestivalRepository;

		const tenants = {
			findOrganizationById: mock(async () => makeTenant().organization),
		} as unknown as TenantRepository;

		const service = new DivisionFestivalService(divRepo, tenants);
		service.bindCacheInvalidator(invalidator);
		const tenant = makeTenant();

		await service.createDivisionForTenant(tenant, { displayName: "Piano" });
		await service.setPrimaryFestivalForTenant(tenant, "spring");
		expect(events).toEqual([
			{
				type: "FestivalCatalogUpdated",
				organizationId: "org-cat-1",
				slug: "cat-org",
				festivalId: undefined,
			},
			{
				type: "FestivalCatalogUpdated",
				organizationId: "org-cat-1",
				slug: "cat-org",
				festivalId: "fest-1",
			},
		]);
	});

	it("validates isActive and emits FestivalCatalogUpdated in RegistrationCatalogService", async () => {
		const invalidator = new DomainCacheInvalidator();
		const events: Array<{ type: string; festivalId?: string }> = [];
		invalidator.subscribe((e) => events.push(e));

		const catalogRepo = {
			createRegistrationCatalogValue: mock(async (input) => ({
				id: "val-1",
				organizationId: input.organizationId,
				kind: input.kind,
				displayName: input.displayName,
				isActive: true,
				displayOrder: 0,
				requiredSubtypeId: input.requiredSubtypeId ?? null,
				createdAtIso: "2026-01-01T00:00:00.000Z",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			})),
			updateRegistrationCatalogValue: mock(async (input) => ({
				id: input.id,
				organizationId: input.organizationId,
				kind: input.kind,
				displayName: "Solo Updated",
				isActive: input.isActive ?? true,
				displayOrder: 0,
				requiredSubtypeId: null,
				createdAtIso: "2026-01-01T00:00:00.000Z",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			})),
		} as unknown as RegistrationCatalogRepository;

		const service = new RegistrationCatalogService(
			catalogRepo,
			{} as DivisionFestivalRepository,
			{} as TenantRepository,
		);
		service.bindCacheInvalidator(invalidator);
		const tenant = makeTenant();

		await expect(
			service.updateRegistrationCatalogValueForTenant(
				tenant,
				"class_subtype",
				"val-1",
				{ isActive: "invalid" },
			),
		).rejects.toThrow("isActive must be a boolean.");

		await service.createRegistrationCatalogValueForTenant(
			tenant,
			"class_subtype",
			"Solo",
		);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("FestivalCatalogUpdated");
	});
});

describe("domains/catalog-repertoire Postgres 17 integration", () => {
	integrationIt(
		"persists divisions, festivals, catalog values, classes, and capacity audits atomically",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const tenants = fixture.repository(
					new PostgresTenantRepository(fixture.schema),
				);
				const divFest = fixture.repository(
					new PostgresDivisionFestivalRepository(fixture.schema),
				);
				const catalog = fixture.repository(
					new PostgresRegistrationCatalogRepository(fixture.schema),
				);

				const org = await tenants.createOrganization({
					name: `Cat ${fixture.id("org")}`,
					slug: fixture.id("cat"),
				});
				const div1 = await divFest.createDivision({
					organizationId: org.id,
					displayName: "Strings",
					normalizedName: "strings",
				});
				const div2 = await divFest.createDivision({
					organizationId: org.id,
					displayName: "Piano",
					normalizedName: "piano",
				});
				const reordered = await divFest.reorderDivisions(org.id, [
					div2.id,
					div1.id,
				]);
				expect(reordered.map((d) => d.id)).toEqual([div2.id, div1.id]);
				await expect(
					divFest.reorderDivisions(org.id, [div2.id]),
				).rejects.toThrow(
					"Division order must contain every organization division exactly once.",
				);

				const divisionSvc = new DivisionFestivalService(divFest, tenants);
				const baseTenant = makeTenant();
				await expect(
					divisionSvc.reorderDivisionsForTenant(
						{
							...baseTenant,
							organization: {
								...baseTenant.organization,
								id: org.id,
								slug: org.slug,
							},
						},
						{
							divisionIds: [div2.id],
						},
					),
				).rejects.toMatchObject({ status: 400 });

				const f1 = await divFest.createFestival({
					id: randomUUID(),
					organizationId: org.id,
					code: "AUT",
					shortName: `aut-${randomUUID().slice(0, 6)}`,
					name: "Autumn Fest",
					startDate: "2027-10-01",
					endDate: "2027-10-05",
				});
				const f2 = await divFest.createFestival({
					id: randomUUID(),
					organizationId: org.id,
					code: "SPR",
					shortName: `spr-${randomUUID().slice(0, 6)}`,
					name: "Spring Fest",
					startDate: "2027-04-01",
					endDate: "2027-04-05",
				});
				expect(f1.isPrimary).toBe(true);
				const primary2 = await divFest.setPrimaryFestival(org.id, f2.id);
				expect(primary2.isPrimary).toBe(true);

				const subtype = await catalog.createRegistrationCatalogValue({
					organizationId: org.id,
					kind: "class_subtype",
					displayName: "Solo",
					normalizedName: "solo",
				});
				await catalog.associateFestivalClassSubtype({
					organizationId: org.id,
					festivalId: f2.id,
					classSubtypeId: subtype.id,
				});

				const createdClass: FestivalClassConfiguration =
					await catalog.createFestivalClassConfigurationWithCapacityAudit(
						{
							organizationId: org.id,
							festivalId: f2.id,
							displayName: "Junior Solo",
							classSubtypeId: subtype.id,
							divisionId: div2.id,
							minimumAge: 6,
							maximumAge: 10,
							price: "35.00",
							maximumPerformancePieces: 2,
							performanceMinutes: 10,
							capacity: 12,
							shopifyProductGid: "gid://shopify/Product/s09-1",
							shopifyVariantGid: "gid://shopify/Variant/s09-1",
						},
						"actor-1",
					);
				expect(createdClass.capacity).toBe(12);

				const updatedClass =
					await catalog.updateFestivalClassConfigurationWithCapacityAudit(
						{
							id: createdClass.id,
							organizationId: org.id,
							festivalId: f2.id,
							capacity: 18,
						},
						"actor-2",
					);
				expect(updatedClass.capacity).toBe(18);

				const audits = await catalog.listFestivalClassCapacityAudits(
					org.id,
					createdClass.id,
				);
				expect(audits).toHaveLength(2);
				expect(
					audits.map((a) => ({ action: a.action, newCapacity: a.newCapacity })),
				).toContainEqual({ action: "class_created", newCapacity: 12 });
				expect(
					audits.map((a) => ({ action: a.action, newCapacity: a.newCapacity })),
				).toContainEqual({ action: "capacity_updated", newCapacity: 18 });
			});
		},
	);
});
