import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type { OrganizationRepository } from "../src/repo/organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";

async function verifyBulkLookup(
	repo: OrganizationRepository,
	trackOrganization: (id: string) => void = () => {},
) {
	const prefix = randomUUID();
	const createScope = async (suffix: string) => {
		suffix = `${prefix}-${suffix}`;
		const org = await repo.createOrganization({
			name: `Org ${suffix}`,
			slug: `org-${suffix}`,
		});
		trackOrganization(org.id);
		const festival = await repo.createFestival({
			id: `festival-${suffix}`,
			organizationId: org.id,
			code: suffix,
			shortName: suffix,
			name: `Festival ${suffix}`,
			startDate: "2027-01-01",
			endDate: "2027-01-02",
		});
		const division = await repo.createDivision({
			organizationId: org.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const subtype = await repo.createRegistrationCatalogValue({
			organizationId: org.id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		return {
			organizationId: org.id,
			festivalId: festival.id,
			divisionId: division.id,
			classSubtypeId: subtype.id,
		};
	};
	const scope = await createScope("one");
	const other = await createScope("two");
	const createClass = (classScope: typeof scope, isActive = true) =>
		repo.createFestivalClassConfiguration({
			...classScope,
			displayName: "Class",
			minimumAge: 5,
			maximumAge: 15,
			price: "25.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 5,
			capacity: 20,
			shopifyProductGid: `gid://shopify/Product/${randomUUID()}`,
			shopifyVariantGid: `gid://shopify/ProductVariant/${randomUUID()}`,
			isActive,
		});
	const active = await createClass(scope);
	const inactive = await createClass(scope, false);
	const outsideOrganization = await createClass(other);
	const otherFestival = await repo.createFestival({
		id: `${prefix}-other-festival`,
		organizationId: scope.organizationId,
		code: "OTHER",
		shortName: "other",
		name: "Other festival",
		startDate: "2027-02-01",
		endDate: "2027-02-02",
	});
	const outsideFestival = await createClass({
		...scope,
		festivalId: otherFestival.id,
	});
	const unrelated = await createClass(scope);
	const found = await repo.findFestivalClassConfigurationsByIds(
		scope.organizationId,
		scope.festivalId,
		[
			active.id,
			inactive.id,
			active.id,
			outsideOrganization.id,
			outsideFestival.id,
			"missing",
		],
	);
	expect(found.map((row) => row.id).sort()).toEqual(
		[active.id, inactive.id].sort(),
	);
	expect(found.find((row) => row.id === inactive.id)?.isActive).toBe(false);
	expect(found.some((row) => row.id === unrelated.id)).toBe(false);
	expect(
		await repo.findFestivalClassConfigurationsByIds(
			scope.organizationId,
			scope.festivalId,
			[active.id],
		),
	).toEqual([active]);
	expect(
		await repo.findFestivalClassConfigurationsByIds(
			scope.organizationId,
			scope.festivalId,
			["missing"],
		),
	).toEqual([]);
	expect(
		await repo.findFestivalClassConfigurationsByIds(
			scope.organizationId,
			scope.festivalId,
			[],
		),
	).toEqual([]);
	found[0].displayName = "Mutated copy";
	expect(
		(
			await repo.findFestivalClassConfigurationById(
				scope.organizationId,
				scope.festivalId,
				found[0].id,
			)
		)?.displayName,
	).toBe("Class");
}

test("in-memory bulk class lookup scopes IDs, deduplicates, and includes historical inactive classes", async () => {
	await verifyBulkLookup(new InMemoryOrganizationRepository());
});

test("empty PostgreSQL class lookup avoids initialization and database access", async () => {
	const repo = new PostgresOrganizationRepository("unused_bulk");
	const ready = spyOn(repo, "ensureReady");
	const query = spyOn(sql, "unsafe");
	try {
		expect(
			await repo.findFestivalClassConfigurationsByIds("org", "festival", []),
		).toEqual([]);
		expect(ready).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	} finally {
		ready.mockRestore();
		query.mockRestore();
	}
});

const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
postgresTest(
	"real PostgreSQL bulk class lookup preserves the same scope and inactive-class contract",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const schema = fixture.schema;
			await verifyBulkLookup(
				fixture.repository(new PostgresOrganizationRepository(schema)),
				fixture.trackOrganization,
			);
		});
	},
);
