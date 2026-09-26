import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

describe("InMemoryOrganizationRepository currency and findOrganizationById", () => {
	it("defaults defaultCurrencyCode to USD when creating an organization", async () => {
		const repo = new InMemoryOrganizationRepository();
		const org = await repo.createOrganization({
			name: "Test Organization",
			slug: "test-org",
		});

		expect(org.defaultCurrencyCode).toBe("USD");
		expect(org.id).toBeDefined();

		const found = await repo.findOrganizationById(org.id);
		expect(found).toEqual(org);
	});

	it("uses provided defaultCurrencyCode when creating an organization", async () => {
		const repo = new InMemoryOrganizationRepository();
		const org = await repo.createOrganization({
			name: "Canadian Music Festival",
			slug: "cad-festival",
			defaultCurrencyCode: "CAD",
		});

		expect(org.defaultCurrencyCode).toBe("CAD");

		const found = await repo.findOrganizationById(org.id);
		expect(found).toEqual(org);
	});

	it("returns null when findOrganizationById is called with unknown id", async () => {
		const repo = new InMemoryOrganizationRepository();
		const found = await repo.findOrganizationById("non-existent-id");
		expect(found).toBeNull();
	});
});

describe("PostgresOrganizationRepository currency and findOrganizationById", () => {
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

	it("findOrganizationById queries by id and maps default_currency_code", async () => {
		const dbRow = {
			id: "org-123",
			name: "Vancouver Music Fest",
			slug: "van-fest",
			timezone: "America/Vancouver",
			default_currency_code: "CAD",
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([dbRow]);

		const org = await repo.findOrganizationById("org-123");
		expect(org).not.toBeNull();
		expect(org?.id).toBe("org-123");
		expect(org?.defaultCurrencyCode).toBe("CAD");
		expect(org?.timezone).toBe("America/Vancouver");
		expect(unsafeSpy).toHaveBeenCalledWith(
			expect.stringContaining("WHERE id = $1"),
			["org-123"],
		);
	});

	it("findOrganizationById returns null when not found", async () => {
		unsafeSpy.mockResolvedValueOnce([]);

		const org = await repo.findOrganizationById("missing-id");
		expect(org).toBeNull();
	});

	it("falls back to USD if default_currency_code is null or undefined", async () => {
		const dbRow = {
			id: "org-legacy",
			name: "Legacy Org",
			slug: "legacy-org",
			timezone: "UTC",
			default_currency_code: null,
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([dbRow]);

		const org = await repo.findOrganizationById("org-legacy");
		expect(org).not.toBeNull();
		expect(org?.defaultCurrencyCode).toBe("USD");
	});

	it("createOrganization passes defaultCurrencyCode and returns mapped record", async () => {
		const returnedRow = {
			id: "new-org-id",
			name: "UK Festival",
			slug: "uk-fest",
			timezone: "UTC",
			default_currency_code: "GBP",
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([returnedRow]);

		const org = await repo.createOrganization({
			name: "UK Festival",
			slug: "uk-fest",
			defaultCurrencyCode: "GBP",
		});

		expect(org.defaultCurrencyCode).toBe("GBP");
		expect(unsafeSpy).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO test_schema.organizations"),
			expect.arrayContaining(["UK Festival", "uk-fest", "GBP"]),
		);
	});
});
