import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import { buildCatalogRoutes } from "../src/routes/catalog/catalog.routes.js";

function fakeCatalogService(
	overrides: Partial<Record<keyof PublicMembershipProductService, unknown>> = {},
) {
	return {
		list: async (slug: string) => ({
			organization: { slug, name: "Test Festival" },
			membershipProducts: [],
		}),
		resolvePurchasable: async () => {
			throw new Error("not used in catalog route tests");
		},
		...overrides,
	} as unknown as PublicMembershipProductService;
}

async function createTestApp(
	publicMembershipProductService?: PublicMembershipProductService,
) {
	const repository = new InMemoryOrganizationRepository();
	await repository.createOrganization({ name: "Test Festival", slug: "test" });
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		publicMembershipProductService,
	});
	return app;
}

/** Build a minimal app wrapping catalog routes, without any createApp fallback. */
function createBareApp(
	publicMembershipProductService: PublicMembershipProductService | undefined,
) {
	const app = new Hono();
	app.route(
		"/api/organizations/:slug",
		buildCatalogRoutes({ publicMembershipProductService }),
	);
	return app;
}

describe("catalog routes", () => {
	describe("GET /api/organizations/:slug/membership-products", () => {
		it("returns membership products for a valid org", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toMatchObject({
				organization: { slug: "test" },
				membershipProducts: [],
			});
		});

		it("sets Cache-Control: no-store on a successful response", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
			);
			expect(response.headers.get("cache-control")).toBe("no-store");
		});

		it("returns 400 when an Authorization header is present", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
				{ headers: { Authorization: "Bearer token" } },
			);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body).toMatchObject({ error: expect.stringContaining("Authorization") });
		});

		it("returns 400 when a request body is present", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
				{
					method: "GET",
					headers: { "Content-Length": "5", "Content-Type": "application/json" },
					body: "hello",
				},
			);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body).toMatchObject({ error: expect.stringContaining("body") });
		});

		it("returns 503 when publicMembershipProductService is not configured", async () => {
			const app = createBareApp(undefined);
			const response = await app.request(
				"/api/organizations/test/membership-products",
			);
			expect(response.status).toBe(503);
		});
	});

	describe("HEAD /api/organizations/:slug/membership-products", () => {
		it("returns null body with same status and headers as GET", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
				{ method: "HEAD" },
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			const body = await response.text();
			expect(body).toBe("");
		});

		it("returns 400 (no body) when Authorization header is present", async () => {
			const app = await createTestApp(fakeCatalogService());
			const response = await app.request(
				"/api/organizations/test/membership-products",
				{ method: "HEAD", headers: { Authorization: "Bearer token" } },
			);
			expect(response.status).toBe(400);
			const body = await response.text();
			expect(body).toBe("");
		});

		it("returns 503 (no body) when service is not configured", async () => {
			const app = createBareApp(undefined);
			const response = await app.request(
				"/api/organizations/test/membership-products",
				{ method: "HEAD" },
			);
			expect(response.status).toBe(503);
			const body = await response.text();
			expect(body).toBe("");
		});
	});
});
