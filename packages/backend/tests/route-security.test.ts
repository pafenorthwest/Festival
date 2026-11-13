import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryAppUserRepository } from "../src/repo/in-memory-app-user-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { API_ROUTE_SECURITY } from "../src/routes/api-router.js";
import { AUTH_ROUTE_SECURITY } from "../src/routes/auth-router.js";
import { PRIVATE_RUNTIME_ROUTE_SECURITY } from "../src/routes/private-runtime.routes.js";
import {
	CATALOG_GROUP_ROUTE_SECURITY,
	COMMERCE_GROUP_ROUTE_SECURITY,
	CUSTOMER_GROUP_ROUTE_SECURITY,
	DIRECTORY_GROUP_ROUTE_SECURITY,
	ORG_ADMIN_GROUP_ROUTE_SECURITY,
	REGISTRATION_GROUP_ROUTE_SECURITY,
	VOLUNTEERS_GROUP_ROUTE_SECURITY,
} from "../src/routes/route-groups.js";
import {
	assertRouteSecurityInventory,
	CURRENT_ROUTE_SECURITY,
	isPrivateRouteAuthenticationClass,
	type RouteSecurityDeclaration,
} from "../src/routes/route-security.js";

async function createInventoryTestApp() {
	return await createApp({
		env: { port: 3000, trustProxyHeaders: false },
		repository: new InMemoryOrganizationRepository(),
		appUserRepository: new InMemoryAppUserRepository(),
		authVerifier: {
			async verify() {
				throw new AppError("Unauthorized", 401);
			},
		},
	});
}

describe("co-located route security inventory", () => {
	it("places GET /health private-health at index 0 and keeps complete metadata for all 171 routes", async () => {
		expect(CURRENT_ROUTE_SECURITY[0]).toEqual({
			method: "GET",
			path: "/health",
			authenticationClass: "private-health",
			csrfRequired: false,
			browserAllowed: false,
		});
		expect(CURRENT_ROUTE_SECURITY).toHaveLength(171);

		const { app } = await createInventoryTestApp();
		assertRouteSecurityInventory(app.routes, CURRENT_ROUTE_SECURITY);

		for (const entry of CURRENT_ROUTE_SECURITY) {
			expect(typeof entry.csrfRequired).toBe("boolean");
			expect(typeof entry.browserAllowed).toBe("boolean");
			if (
				isPrivateRouteAuthenticationClass(entry.authenticationClass) ||
				entry.authenticationClass === "shopify-webhook"
			) {
				expect(entry.browserAllowed).toBe(false);
				expect(entry.csrfRequired).toBe(false);
			}
		}
	});

	it("aggregates all 7 backend route groups plus auth and private runtime modules without gaps", () => {
		expect(ORG_ADMIN_GROUP_ROUTE_SECURITY).toHaveLength(26);
		expect(CATALOG_GROUP_ROUTE_SECURITY).toHaveLength(32);
		expect(CUSTOMER_GROUP_ROUTE_SECURITY).toHaveLength(12);
		expect(DIRECTORY_GROUP_ROUTE_SECURITY).toHaveLength(9);
		expect(REGISTRATION_GROUP_ROUTE_SECURITY).toHaveLength(25);
		expect(COMMERCE_GROUP_ROUTE_SECURITY).toHaveLength(36);
		expect(VOLUNTEERS_GROUP_ROUTE_SECURITY).toHaveLength(19);
		expect(API_ROUTE_SECURITY).toHaveLength(159);
		expect(AUTH_ROUTE_SECURITY).toHaveLength(3);
		expect(PRIVATE_RUNTIME_ROUTE_SECURITY).toHaveLength(7);

		const mutatingCustomerRoutes = CURRENT_ROUTE_SECURITY.filter(
			(route) =>
				route.authenticationClass === "customer" &&
				route.method !== "GET" &&
				route.method !== "HEAD",
		);
		expect(mutatingCustomerRoutes.length).toBeGreaterThan(0);
		for (const route of mutatingCustomerRoutes) {
			expect(route.csrfRequired).toBe(true);
		}
	});

	it("fails closed on undeclared routes, unregistered declarations, duplicates, boundary leaks, and incomplete metadata", () => {
		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/undeclared" }],
				[],
			),
		).toThrow(/Undeclared routes: GET \/api\/undeclared/);

		expect(() =>
			assertRouteSecurityInventory(
				[],
				[
					{
						method: "GET",
						path: "/api/ghost",
						authenticationClass: "public",
						csrfRequired: false,
						browserAllowed: true,
					},
				],
			),
		).toThrow(/Unregistered declarations: GET \/api\/ghost/);

		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/health" }],
				[CURRENT_ROUTE_SECURITY[0], CURRENT_ROUTE_SECURITY[0]],
			),
		).toThrow(/Duplicate route security declaration: GET \/health/);

		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/public-leak" }],
				[
					{
						method: "GET",
						path: "/api/public-leak",
						authenticationClass: "private-runtime",
						csrfRequired: false,
						browserAllowed: false,
					},
				],
			),
		).toThrow(/Private route boundary violation/);

		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/internal/exposed" }],
				[
					{
						method: "GET",
						path: "/api/internal/exposed",
						authenticationClass: "public",
						csrfRequired: false,
						browserAllowed: true,
					},
				],
			),
		).toThrow(/Private route boundary violation/);

		const partialDeclaration: RouteSecurityDeclaration = {
			method: "GET",
			path: "/api/partial",
			authenticationClass: "public",
			csrfRequired: false,
		};
		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/partial" }],
				[partialDeclaration],
			),
		).toThrow(/Incomplete route security metadata/);

		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/internal/bad-browser" }],
				[
					{
						method: "GET",
						path: "/api/internal/bad-browser",
						authenticationClass: "private-runtime",
						csrfRequired: false,
						browserAllowed: true,
					},
				],
			),
		).toThrow(/Browser exposure violation/);
	});
});
