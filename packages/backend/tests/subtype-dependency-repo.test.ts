import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	assertValidSubtypeDependency,
	type RegistrationCatalogKind,
} from "../src/repo/organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

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
		// B depends on A
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
		]);
		// Try to make A depend on B
		expect(() => assertValidSubtypeDependency("sub-a", "sub-b", map)).toThrow(
			"Class subtype dependency cycle detected.",
		);
	});

	it("rejects 3-cycle: A -> B -> C -> A", () => {
		// B depends on A, C depends on B
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
			["sub-c", "sub-b"],
		]);
		// Try to make A depend on C
		expect(() => assertValidSubtypeDependency("sub-a", "sub-c", map)).toThrow(
			"Class subtype dependency cycle detected.",
		);
	});

	it("allows valid linear dependency chains", () => {
		// C depends on B, B depends on A, A has no dependency
		const map = new Map<string, string | null>([
			["sub-a", null],
			["sub-b", "sub-a"],
			["sub-c", "sub-b"],
		]);
		// A new node D can depend on C
		expect(() =>
			assertValidSubtypeDependency("sub-d", "sub-c", map),
		).not.toThrow();
	});
});

describe("InMemoryOrganizationRepository subtype dependencies", () => {
	let repo: InMemoryOrganizationRepository;
	const org1Id = "org-1";
	const org2Id = "org-2";

	beforeEach(async () => {
		repo = new InMemoryOrganizationRepository();
		await repo.createOrganization({ name: "Org 1", slug: "org-1" });
		await repo.createOrganization({ name: "Org 2", slug: "org-2" });
	});

	it("creates a subtype with dependency", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		expect(subA.requiredSubtypeId).toBeNull();

		const subB = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Duet",
			normalizedName: "duet",
			requiredSubtypeId: subA.id,
		});
		expect(subB.requiredSubtypeId).toBe(subA.id);

		const list = await repo.listRegistrationCatalogValues(
			org1Id,
			"class_subtype",
		);
		expect(list.find((s) => s.id === subA.id)?.requiredSubtypeId).toBeNull();
		expect(list.find((s) => s.id === subB.id)?.requiredSubtypeId).toBe(subA.id);
	});

	it("updates a subtype to add or change dependency", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		const subB = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Duet",
			normalizedName: "duet",
		});

		const updated = await repo.updateRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			id: subB.id,
			requiredSubtypeId: subA.id,
		});
		expect(updated?.requiredSubtypeId).toBe(subA.id);
	});

	it("removes a subtype dependency when set to null", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		const subB = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Duet",
			normalizedName: "duet",
			requiredSubtypeId: subA.id,
		});
		expect(subB.requiredSubtypeId).toBe(subA.id);

		const updated = await repo.updateRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			id: subB.id,
			requiredSubtypeId: null,
		});
		expect(updated?.requiredSubtypeId).toBeNull();

		const list = await repo.listRegistrationCatalogValues(
			org1Id,
			"class_subtype",
		);
		expect(list.find((s) => s.id === subB.id)?.requiredSubtypeId).toBeNull();
	});

	it("rejects self-dependency on update", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: subA.id,
				requiredSubtypeId: subA.id,
			}),
		).rejects.toThrow("Class subtype cannot depend on itself.");
	});

	it("rejects 2-cycle (A -> B -> A) on update", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});
		const subB = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Duet",
			normalizedName: "duet",
			requiredSubtypeId: subA.id,
		});

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: subA.id,
				requiredSubtypeId: subB.id,
			}),
		).rejects.toThrow("Class subtype dependency cycle detected.");
	});

	it("rejects 3-cycle (A -> B -> C -> A) on update", async () => {
		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "A",
			normalizedName: "a",
		});
		const subB = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "B",
			normalizedName: "b",
			requiredSubtypeId: subA.id,
		});
		const subC = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "C",
			normalizedName: "c",
			requiredSubtypeId: subB.id,
		});

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: subA.id,
				requiredSubtypeId: subC.id,
			}),
		).rejects.toThrow("Class subtype dependency cycle detected.");
	});

	it("rejects non-existent subtype on create and update", async () => {
		await expect(
			repo.createRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
				requiredSubtypeId: "non-existent-subtype",
			}),
		).rejects.toThrow("Required class subtype was not found.");

		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: subA.id,
				requiredSubtypeId: "non-existent-subtype",
			}),
		).rejects.toThrow("Required class subtype was not found.");
	});

	it("rejects foreign-org subtype on create and update", async () => {
		const foreignSub = await repo.createRegistrationCatalogValue({
			organizationId: org2Id,
			kind: "class_subtype",
			displayName: "Foreign Solo",
			normalizedName: "foreign solo",
		});

		await expect(
			repo.createRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
				requiredSubtypeId: foreignSub.id,
			}),
		).rejects.toThrow("Required class subtype was not found.");

		const subA = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: subA.id,
				requiredSubtypeId: foreignSub.id,
			}),
		).rejects.toThrow("Required class subtype was not found.");
	});

	it("rejects instrument target as required class subtype", async () => {
		const instrument = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "instrument",
			displayName: "Piano",
			normalizedName: "piano",
		});

		await expect(
			repo.createRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
				requiredSubtypeId: instrument.id,
			}),
		).rejects.toThrow("Required class subtype was not found.");
	});
});

describe("PostgresOrganizationRepository subtype dependencies", () => {
	let repo: PostgresOrganizationRepository;
	let unsafeSpy: ReturnType<typeof spyOn>;
	const org1Id = "org-1";

	beforeEach(() => {
		repo = new PostgresOrganizationRepository("test_schema");
		spyOn(repo, "ensureReady").mockResolvedValue();
		unsafeSpy = spyOn(sql, "unsafe");
	});

	afterEach(() => {
		unsafeSpy.mockRestore();
	});

	const makeRow = (
		id: string,
		requiredSubtypeId: string | null = null,
		name = "Subtype",
	) => ({
		id,
		organization_id: org1Id,
		kind: "class_subtype" as RegistrationCatalogKind,
		display_name: name,
		is_active: true,
		display_order: 0,
		required_subtype_id: requiredSubtypeId,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
	});

	it("creates a subtype with dependency after validating target exists", async () => {
		unsafeSpy
			// 1. SELECT existing subtypes for validation
			.mockResolvedValueOnce([{ id: "sub-a", required_subtype_id: null }])
			// 2. INSERT statement
			.mockResolvedValueOnce([makeRow("sub-b", "sub-a", "Duet")]);

		const result = await repo.createRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			displayName: "Duet",
			normalizedName: "duet",
			requiredSubtypeId: "sub-a",
		});

		expect(result.id).toBe("sub-b");
		expect(result.requiredSubtypeId).toBe("sub-a");

		const [insertQuery, insertParams] = unsafeSpy.mock.calls[1] as [
			string,
			unknown[],
		];
		expect(insertQuery).toContain("required_subtype_id");
		expect(insertParams).toContain("sub-a");
	});

	it("updates a subtype dependency to null", async () => {
		unsafeSpy.mockResolvedValueOnce([makeRow("sub-b", null, "Duet")]);

		const result = await repo.updateRegistrationCatalogValue({
			organizationId: org1Id,
			kind: "class_subtype",
			id: "sub-b",
			requiredSubtypeId: null,
		});

		expect(result?.requiredSubtypeId).toBeNull();
		const [updateQuery, updateParams] = unsafeSpy.mock.calls[0] as [
			string,
			unknown[],
		];
		expect(updateQuery).toContain(
			"required_subtype_id = CASE WHEN $7::boolean THEN $8 ELSE required_subtype_id END",
		);
		expect(updateParams[6]).toBe(true);
		expect(updateParams[7]).toBeNull();
	});

	it("rejects self-dependency in PostgresOrganizationRepository", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{ id: "sub-a", required_subtype_id: null },
		]);

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: "sub-a",
				requiredSubtypeId: "sub-a",
			}),
		).rejects.toThrow("Class subtype cannot depend on itself.");
	});

	it("rejects 2-cycle in PostgresOrganizationRepository", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{ id: "sub-a", required_subtype_id: null },
			{ id: "sub-b", required_subtype_id: "sub-a" },
		]);

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: "sub-a",
				requiredSubtypeId: "sub-b",
			}),
		).rejects.toThrow("Class subtype dependency cycle detected.");
	});

	it("rejects 3-cycle in PostgresOrganizationRepository", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{ id: "sub-a", required_subtype_id: null },
			{ id: "sub-b", required_subtype_id: "sub-a" },
			{ id: "sub-c", required_subtype_id: "sub-b" },
		]);

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: "sub-a",
				requiredSubtypeId: "sub-c",
			}),
		).rejects.toThrow("Class subtype dependency cycle detected.");
	});

	it("rejects non-existent target subtype in PostgresOrganizationRepository", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{ id: "sub-a", required_subtype_id: null },
		]);

		await expect(
			repo.updateRegistrationCatalogValue({
				organizationId: org1Id,
				kind: "class_subtype",
				id: "sub-a",
				requiredSubtypeId: "missing-sub",
			}),
		).rejects.toThrow("Required class subtype was not found.");
	});

	it("includes required_subtype_id in listRegistrationCatalogValues", async () => {
		unsafeSpy.mockResolvedValueOnce([makeRow("sub-a", "sub-b")]);

		const result = await repo.listRegistrationCatalogValues(
			org1Id,
			"class_subtype",
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.requiredSubtypeId).toBe("sub-b");

		const [query] = unsafeSpy.mock.calls[0] as [string, unknown[]];
		expect(query).toContain("required_subtype_id");
	});

	it("includes required_subtype_id in listFestivalClassSubtypes", async () => {
		unsafeSpy.mockResolvedValueOnce([makeRow("sub-a", "sub-b")]);

		const result = await repo.listFestivalClassSubtypes(org1Id, "fest-1");
		expect(result).toHaveLength(1);
		expect(result[0]?.requiredSubtypeId).toBe("sub-b");

		const [query] = unsafeSpy.mock.calls[0] as [string, unknown[]];
		expect(query).toContain("v.required_subtype_id");
	});
});
