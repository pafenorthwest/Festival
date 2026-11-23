import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	assertValidSubtypeDependency,
	PostgresRegistrationCatalogRepository,
} from "../src/domains/catalog-repertoire/index.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";

const integrationIt = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

describe("Subtype dependency cycle detection helper", () => {
	it("rejects direct self-dependency", () => {
		const map = new Map<string, string | null>([["sub-1", null]]);
		expect(() => assertValidSubtypeDependency("sub-1", "sub-1", map)).toThrow(
			"Class subtype cannot depend on itself.",
		);
	});

	it("rejects non-existent target subtype", () => {
		const map = new Map<string, string | null>([["sub-1", null]]);
		expect(() =>
			assertValidSubtypeDependency("sub-1", "missing-target", map),
		).toThrow("Required class subtype was not found.");
	});

	it("rejects 2-cycle: A -> B -> A", () => {
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
		]);
		expect(() => assertValidSubtypeDependency("sub-a", "sub-b", map)).toThrow(
			"Class subtype dependency cycle detected.",
		);
	});

	it("rejects 3-cycle: A -> B -> C -> A", () => {
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
			["sub-c", "sub-b"],
		]);
		expect(() => assertValidSubtypeDependency("sub-a", "sub-c", map)).toThrow(
			"Class subtype dependency cycle detected.",
		);
	});

	it("allows valid linear dependency chains", () => {
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
		]);
		expect(() =>
			assertValidSubtypeDependency("sub-c", "sub-b", map),
		).not.toThrow();
	});
});

describe("PostgresRegistrationCatalogRepository subtype dependencies", () => {
	integrationIt(
		"creates, updates, clears, and lists requiredSubtypeId across catalog values and festival subtypes",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const orgRepo = fixture.repository(
					new PostgresOrganizationRepository(fixture.schema),
				);
				const catalogRepo = fixture.repository(
					new PostgresRegistrationCatalogRepository(fixture.schema),
				);
				const org = await orgRepo.createOrganization({
					name: `SubDeps ${fixture.id("org")}`,
					slug: fixture.id("subdeps"),
				});
				const festival = await orgRepo.createFestival({
					id: randomUUID(),
					organizationId: org.id,
					code: "FEST",
					shortName: fixture.id("fest").slice(0, 12),
					name: "Subtype Festival",
					startDate: "2027-03-01",
					endDate: "2027-03-05",
				});

				const solo = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org.id,
					kind: "class_subtype",
					displayName: "Solo",
					normalizedName: "solo",
				});
				const duet = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org.id,
					kind: "class_subtype",
					displayName: "Duet",
					normalizedName: "duet",
					requiredSubtypeId: solo.id,
				});
				expect(duet.requiredSubtypeId).toBe(solo.id);

				await catalogRepo.associateFestivalClassSubtype({
					organizationId: org.id,
					festivalId: festival.id,
					classSubtypeId: solo.id,
				});
				await catalogRepo.associateFestivalClassSubtype({
					organizationId: org.id,
					festivalId: festival.id,
					classSubtypeId: duet.id,
				});

				const listed = await catalogRepo.listRegistrationCatalogValues(
					org.id,
					"class_subtype",
				);
				expect(listed.find((v) => v.id === duet.id)?.requiredSubtypeId).toBe(
					solo.id,
				);

				const festSubtypes = await catalogRepo.listFestivalClassSubtypes(
					org.id,
					festival.id,
				);
				expect(
					festSubtypes.find((v) => v.id === duet.id)?.requiredSubtypeId,
				).toBe(solo.id);

				const cleared = await catalogRepo.updateRegistrationCatalogValue({
					organizationId: org.id,
					kind: "class_subtype",
					id: duet.id,
					requiredSubtypeId: null,
				});
				expect(cleared?.requiredSubtypeId).toBeNull();
			});
		},
	);

	integrationIt(
		"rejects self-dependency, cycles, missing targets, foreign-org subtypes, and instrument targets in PostgreSQL 17",
		async () => {
			await withApplicationRollback(async (fixture) => {
				const orgRepo = fixture.repository(
					new PostgresOrganizationRepository(fixture.schema),
				);
				const catalogRepo = fixture.repository(
					new PostgresRegistrationCatalogRepository(fixture.schema),
				);
				const org1 = await orgRepo.createOrganization({
					name: `SubErr1 ${fixture.id("o1")}`,
					slug: fixture.id("suberr1"),
				});
				const org2 = await orgRepo.createOrganization({
					name: `SubErr2 ${fixture.id("o2")}`,
					slug: fixture.id("suberr2"),
				});

				const a = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org1.id,
					kind: "class_subtype",
					displayName: "A",
					normalizedName: "a",
				});
				const b = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org1.id,
					kind: "class_subtype",
					displayName: "B",
					normalizedName: "b",
					requiredSubtypeId: a.id,
				});
				const c = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org1.id,
					kind: "class_subtype",
					displayName: "C",
					normalizedName: "c",
					requiredSubtypeId: b.id,
				});
				const org2Sub = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org2.id,
					kind: "class_subtype",
					displayName: "Foreign",
					normalizedName: "foreign",
				});
				const instrument = await catalogRepo.createRegistrationCatalogValue({
					organizationId: org1.id,
					kind: "instrument",
					displayName: "Piano",
					normalizedName: "piano",
				});

				await expect(
					catalogRepo.updateRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						id: a.id,
						requiredSubtypeId: a.id,
					}),
				).rejects.toThrow("Class subtype cannot depend on itself.");

				await expect(
					catalogRepo.updateRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						id: a.id,
						requiredSubtypeId: b.id,
					}),
				).rejects.toThrow("Class subtype dependency cycle detected.");

				await expect(
					catalogRepo.updateRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						id: a.id,
						requiredSubtypeId: c.id,
					}),
				).rejects.toThrow("Class subtype dependency cycle detected.");

				await expect(
					catalogRepo.createRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						displayName: "Orphan",
						normalizedName: "orphan",
						requiredSubtypeId: randomUUID(),
					}),
				).rejects.toThrow("Required class subtype was not found.");

				await expect(
					catalogRepo.createRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						displayName: "CrossOrg",
						normalizedName: "crossorg",
						requiredSubtypeId: org2Sub.id,
					}),
				).rejects.toThrow("Required class subtype was not found.");

				await expect(
					catalogRepo.createRegistrationCatalogValue({
						organizationId: org1.id,
						kind: "class_subtype",
						displayName: "BadKind",
						normalizedName: "badkind",
						requiredSubtypeId: instrument.id,
					}),
				).rejects.toThrow("Required class subtype was not found.");
			});
		},
	);
});
