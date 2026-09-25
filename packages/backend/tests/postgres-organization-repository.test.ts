import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { AppError } from "@festival/common";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

async function source() {
	return (
		await Bun.file(
			new URL(
				"../src/repo/postgres-organization-repository.ts",
				import.meta.url,
			),
		).text()
	).replace(/\r\n/g, "\n");
}

const mockRow = {
	id: "class-1",
	organization_id: "org-1",
	festival_id: "fest-1",
	display_name: "Piano Solo Junior",
	class_subtype_id: "subtype-1",
	division_id: "division-1",
	minimum_age: 7,
	maximum_age: 12,
	price: "45.00",
	maximum_performance_pieces: 2 as const,
	performance_minutes: 8,
	capacity: 20,
	is_active: true,
	shopify_product_gid: "gid://shopify/Product/1",
	shopify_variant_gid: "gid://shopify/ProductVariant/1",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-02T00:00:00.000Z",
};

const expectedClassConfig = {
	id: "class-1",
	organizationId: "org-1",
	festivalId: "fest-1",
	displayName: "Piano Solo Junior",
	classSubtypeId: "subtype-1",
	divisionId: "division-1",
	minimumAge: 7,
	maximumAge: 12,
	price: "45.00",
	maximumPerformancePieces: 2,
	performanceMinutes: 8,
	capacity: 20,
	isActive: true,
	shopifyProductGid: "gid://shopify/Product/1",
	shopifyVariantGid: "gid://shopify/ProductVariant/1",
	createdAtIso: "2026-01-01T00:00:00.000Z",
	updatedAtIso: "2026-01-02T00:00:00.000Z",
};

describe("PostgresOrganizationRepository", () => {
	it("binds every festival column and makes the first festival primary", async () => {
		const value = await source();
		const createFestival = value.slice(
			value.indexOf("async createFestival("),
			value.indexOf("async findFestivalByName("),
		);

		expect(createFestival).toContain("is_primary,");
		expect(createFestival).toContain("NOT EXISTS (");
		expect(createFestival).toContain("WHERE organization_id = $2");
		expect(createFestival).toContain("$5,\n\t\t\t\t\t$6,\n\t\t\t\t\t$7");
	});

	it("does not add festival values to the invite insert", async () => {
		const value = await source();
		const createInvite = value.slice(
			value.indexOf("async createInvite("),
			value.indexOf("async findInviteByToken("),
		);

		expect(createInvite).toContain("VALUES ($1, $2, $3, $4, $5, $6)");
		expect(createInvite).not.toContain("is_primary");
	});

	it("retries accompanist cohort contention and returns a typed conflict", async () => {
		const value = await source();
		const createGrant = value.slice(
			value.indexOf("async createAccompanistMembershipGrant("),
			value.indexOf("async listAccompanistMembershipGrants("),
		);

		expect(createGrant).toContain("attempt < 2");
		expect(createGrant).toContain("AccompanistMembershipCohortContentionError");
		expect(createGrant).toContain("attempt === 0");
		expect(createGrant).toContain("new AccompanistMembershipConflictError()");
		expect(createGrant).toContain("RETURNING customer_id");
		expect(value).toContain("unique|duplicate|exclusion");
	});

	it("persists the write_inventory verification capability", async () => {
		const value = await source();

		expect(value).toContain("can_write_inventory");
		expect(value).toContain(
			'input.capabilities?.write_inventory === "granted"',
		);
	});

	describe("findFestivalClassConfigurationById", () => {
		let repo: PostgresOrganizationRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresOrganizationRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue();
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("returns null when not found", async () => {
			unsafeSpy.mockResolvedValueOnce([]);

			const result = await repo.findFestivalClassConfigurationById(
				"org-1",
				"fest-1",
				"non-existent",
			);

			expect(result).toBeNull();
			expect(unsafeSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"SELECT * FROM test_schema.festival_class_configurations WHERE organization_id = $1 AND festival_id = $2 AND id = $3 LIMIT 1",
				),
				["org-1", "fest-1", "non-existent"],
			);
		});

		it("returns correct record when found", async () => {
			unsafeSpy.mockResolvedValueOnce([mockRow]);

			const result = await repo.findFestivalClassConfigurationById(
				"org-1",
				"fest-1",
				"class-1",
			);

			expect(result).toEqual(expectedClassConfig);
			expect(unsafeSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"SELECT * FROM test_schema.festival_class_configurations WHERE organization_id = $1 AND festival_id = $2 AND id = $3 LIMIT 1",
				),
				["org-1", "fest-1", "class-1"],
			);
		});

		it("propagates unexpected database errors", async () => {
			const dbError = new Error("Connection failed");
			unsafeSpy.mockRejectedValueOnce(dbError);

			await expect(
				repo.findFestivalClassConfigurationById("org-1", "fest-1", "class-1"),
			).rejects.toThrow("Connection failed");
		});
	});

	describe("updateFestivalClassConfiguration", () => {
		let repo: PostgresOrganizationRepository;
		let unsafeSpy: ReturnType<typeof spyOn>;

		beforeEach(() => {
			repo = new PostgresOrganizationRepository("test_schema");
			spyOn(repo, "ensureReady").mockResolvedValue();
			unsafeSpy = spyOn(sql, "unsafe");
		});

		afterEach(() => {
			unsafeSpy.mockRestore();
		});

		it("updates mutable fields without updating division_id or class_subtype_id", async () => {
			const updatedRow = {
				...mockRow,
				display_name: "Piano Solo Intermediate",
				minimum_age: 8,
				maximum_age: 14,
				price: "50.00",
				maximum_performance_pieces: 3 as const,
				performance_minutes: 10,
				capacity: 15,
				is_active: false,
				shopify_product_gid: "gid://shopify/Product/2",
				shopify_variant_gid: "gid://shopify/ProductVariant/2",
				updated_at: "2026-01-03T00:00:00.000Z",
			};

			unsafeSpy.mockResolvedValueOnce([updatedRow]);

			const result = await repo.updateFestivalClassConfiguration({
				id: "class-1",
				organizationId: "org-1",
				festivalId: "fest-1",
				displayName: "Piano Solo Intermediate",
				minimumAge: 8,
				maximumAge: 14,
				price: "50.00",
				maximumPerformancePieces: 3,
				performanceMinutes: 10,
				capacity: 15,
				isActive: false,
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
			});

			expect(result).toEqual({
				...expectedClassConfig,
				displayName: "Piano Solo Intermediate",
				minimumAge: 8,
				maximumAge: 14,
				price: "50.00",
				maximumPerformancePieces: 3,
				performanceMinutes: 10,
				capacity: 15,
				isActive: false,
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				updatedAtIso: "2026-01-03T00:00:00.000Z",
			});

			const [query, params] = unsafeSpy.mock.calls[0] as [string, unknown[]];
			const setClause = query.slice(
				query.indexOf("SET"),
				query.indexOf("WHERE"),
			);

			expect(setClause).toContain("display_name = COALESCE($4, display_name)");
			expect(setClause).toContain("minimum_age = COALESCE($5, minimum_age)");
			expect(setClause).toContain("maximum_age = COALESCE($6, maximum_age)");
			expect(setClause).toContain("price = COALESCE($7, price)");
			expect(setClause).toContain(
				"maximum_performance_pieces = COALESCE($8, maximum_performance_pieces)",
			);
			expect(setClause).toContain(
				"performance_minutes = COALESCE($9, performance_minutes)",
			);
			expect(setClause).toContain("capacity = COALESCE($10, capacity)");
			expect(setClause).toContain("is_active = COALESCE($11, is_active)");
			expect(setClause).toContain(
				"shopify_product_gid = COALESCE($12, shopify_product_gid)",
			);
			expect(setClause).toContain(
				"shopify_variant_gid = COALESCE($13, shopify_variant_gid)",
			);
			expect(setClause).toContain("updated_at = NOW()");
			expect(setClause).not.toContain("division_id");
			expect(setClause).not.toContain("class_subtype_id");

			expect(params).toEqual([
				"org-1",
				"fest-1",
				"class-1",
				"Piano Solo Intermediate",
				8,
				14,
				"50.00",
				3,
				10,
				15,
				false,
				"gid://shopify/Product/2",
				"gid://shopify/ProductVariant/2",
			]);
		});

		it("passes nulls for omitted optional mutable fields to preserve existing values", async () => {
			unsafeSpy.mockResolvedValueOnce([mockRow]);

			await repo.updateFestivalClassConfiguration({
				id: "class-1",
				organizationId: "org-1",
				festivalId: "fest-1",
			});

			const [, params] = unsafeSpy.mock.calls[0] as [string, unknown[]];
			expect(params).toEqual([
				"org-1",
				"fest-1",
				"class-1",
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
				null,
			]);
		});

		it("confirms source SQL does not update division_id or class_subtype_id in SET clause", async () => {
			const value = await source();
			const updateFn = value.slice(
				value.indexOf("async updateFestivalClassConfiguration("),
				value.indexOf("async findFestivalClassConfigurationById("),
			);
			const setClause = updateFn.slice(
				updateFn.indexOf("SET"),
				updateFn.indexOf("WHERE"),
			);

			expect(setClause).not.toContain("division_id");
			expect(setClause).not.toContain("class_subtype_id");
		});

		it("throws error when festival class configuration is not found", async () => {
			unsafeSpy.mockResolvedValueOnce([]);

			await expect(
				repo.updateFestivalClassConfiguration({
					id: "missing",
					organizationId: "org-1",
					festivalId: "fest-1",
				}),
			).rejects.toThrow("Festival class configuration not found.");
		});

		it("maps foreign key violation (23503) code to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ code: "23503" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Foreign key constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("maps foreign key violation (23503) errno to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ errno: "23503" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Foreign key constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("maps unique constraint violation (23505) code to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ code: "23505" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Unique constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("maps unique constraint violation (23505) errno to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ errno: "23505" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Unique constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("maps check constraint violation (23514) code to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ code: "23514" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Check constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("maps check constraint violation (23514) errno to AppError 400", async () => {
			unsafeSpy.mockRejectedValueOnce({ errno: "23514" });

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBeInstanceOf(AppError);
			expect(error.message).toBe(
				"Check constraint violation in festival class configuration.",
			);
			expect(error.status).toBe(400);
		});

		it("rethrows AppError without modification", async () => {
			const customAppError = new AppError("Custom error", 422);
			unsafeSpy.mockRejectedValueOnce(customAppError);

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBe(customAppError);
		});

		it("rethrows unexpected generic errors", async () => {
			const unexpectedError = new Error("Database network failure");
			unsafeSpy.mockRejectedValueOnce(unexpectedError);

			const error = await repo
				.updateFestivalClassConfiguration({
					id: "class-1",
					organizationId: "org-1",
					festivalId: "fest-1",
				})
				.catch((e) => e);

			expect(error).toBe(unexpectedError);
		});
	});
});
