import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { FirebaseClaimsReconciliationService } from "../src/auth/firebase-claims-reconciliation.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildApiRouter } from "../src/routes/api-router.js";
import {
	assertRouteSecurityInventory,
	CURRENT_ROUTE_SECURITY,
	isPrivateRouteAuthenticationClass,
} from "../src/routes/route-security.js";
import { OrganizationService } from "../src/services/organization-service.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

class Auth implements AuthVerifier {
	async verify(): Promise<AuthenticatedUser> {
		return { uid: "admin", email: "admin@example.com", displayName: "Admin" };
	}
}

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000002";

describe("public API router isolation and private route inventory boundary", () => {
	it("mounts zero private routes on buildApiRouter and rejects all private/runtime paths", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organizationService = new OrganizationService(repository);
		const apiRouter = buildApiRouter({
			organizationService,
			authVerifier: new Auth(),
		});
		const privatePaths = CURRENT_ROUTE_SECURITY.filter((route) =>
			isPrivateRouteAuthenticationClass(route.authenticationClass),
		);
		expect(privatePaths.length).toBeGreaterThanOrEqual(7);
		for (const route of apiRouter.routes) {
			expect(route.path.startsWith("/internal")).toBe(false);
			expect(route.path).not.toBe("/health");
		}
		for (const probePath of [
			"/internal/ready",
			"/internal/diagnostics",
			"/internal/metrics",
			"/internal/operator/status",
			"/internal/events/shopify-orders-paid",
			"/internal/reconcile/shopify-orders",
			"/internal/reconcile/firebase-claims",
			"/metrics",
			"/ready",
			"/readiness",
			"/diagnostics",
			"/debug",
			"/jobs",
			"/workers",
			"/queues",
			"/operator",
		]) {
			const getRes = await apiRouter.request(probePath, { method: "GET" });
			expect(getRes.status).toBe(404);
			const postRes = await apiRouter.request(probePath, { method: "POST" });
			expect(postRes.status).toBe(404);
		}
		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/public-but-private" }],
				[
					{
						method: "GET",
						path: "/api/public-but-private",
						authenticationClass: "private-service",
					},
				],
			),
		).toThrow(/private route boundary/i);
		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/api/internal/exposed" }],
				[
					{
						method: "GET",
						path: "/api/internal/exposed",
						authenticationClass: "admin",
					},
				],
			),
		).toThrow(/private route boundary/i);
	});
});

describe("private Shopify reconciliation route and tenant-scoped worker credentials", () => {
	it("requires its separate service token, enforces tenant-scoped credentials, and never emits CORS headers even on OPTIONS", async () => {
		const reconciledOrgs: string[] = [];
		const { app } = await createApp({
			env: {
				port: 3000,
				reconciliationToken: "global-reconcile-token-0000000000",
				tenantReconciliationTokens: {
					[ORG_A]: "tenant-a-reconcile-token-00000000",
				},
			},
			repository: new InMemoryOrganizationRepository(),
			authVerifier: new Auth(),
			shopifyOrderProjectionService: {
				reconcile: async (organizationId: string) => {
					reconciledOrgs.push(organizationId);
					return { discoveredCount: 1, processedCount: 1 };
				},
			} as unknown as ShopifyOrderProjectionService,
		});
		const path = "/api/internal/reconcile/shopify-orders";
		const bodyA = JSON.stringify({ organizationId: ORG_A });
		const bodyB = JSON.stringify({ organizationId: ORG_B });

		const preflight = await app.request(path, {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5173",
				"Access-Control-Request-Method": "POST",
			},
		});
		expect(preflight.status).toBe(404);
		expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
		expect(
			preflight.headers.get("access-control-allow-credentials"),
		).toBeNull();

		expect(
			(
				await app.request(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: bodyA,
				})
			).status,
		).toBe(404);

		const acceptedGlobal = await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Reconciliation-Token": "global-reconcile-token-0000000000",
			},
			body: bodyB,
		});
		expect(acceptedGlobal.status).toBe(200);
		expect(
			acceptedGlobal.headers.get("access-control-allow-origin"),
		).toBeNull();
		expect(acceptedGlobal.headers.get("cache-control")).toBe("no-store");

		const acceptedTenant = await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Reconciliation-Token": "tenant-a-reconcile-token-00000000",
			},
			body: bodyA,
		});
		expect(acceptedTenant.status).toBe(200);

		const crossTenantAttempt = await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Reconciliation-Token": "tenant-a-reconcile-token-00000000",
			},
			body: bodyB,
		});
		expect(crossTenantAttempt.status).toBe(404);
		expect(reconciledOrgs).toEqual([ORG_B, ORG_A]);

		for (const forbiddenHeader of [
			{ Origin: "http://localhost:5173" },
			{ Cookie: "festival_session=1" },
			{ Authorization: "Bearer admin" },
			{ "X-CSRF-Token": "csrf-123" },
		]) {
			const res = await app.request(path, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Festival-Reconciliation-Token":
						"global-reconcile-token-0000000000",
					...forbiddenHeader,
				},
				body: bodyA,
			});
			expect(res.status).toBe(404);
			expect(res.headers.get("access-control-allow-origin")).toBeNull();
		}
	});
});

describe("private Firebase claims reconciliation route", () => {
	it("requires global reconciliation token, rejects tenant tokens, and returns reconciliation failures to the scheduler", async () => {
		let calls = 0;
		const { app } = await createApp({
			env: {
				port: 3000,
				reconciliationToken: "x".repeat(32),
				tenantReconciliationTokens: {
					[ORG_A]: "tenant-a-reconcile-token-00000000",
				},
			},
			repository: new InMemoryOrganizationRepository(),
			authVerifier: new Auth(),
			firebaseClaimsReconciliationService: {
				reconcile: async () => {
					calls += 1;
					return { discoveredCount: 2, processedCount: 1, failedCount: 1 };
				},
			} as FirebaseClaimsReconciliationService,
		});
		const path = "/api/internal/reconcile/firebase-claims";
		expect(
			(await app.request(path, { method: "POST", body: "{}" })).status,
		).toBe(404);
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Festival-Reconciliation-Token":
							"tenant-a-reconcile-token-00000000",
					},
					body: "{}",
				})
			).status,
		).toBe(404);
		const response = await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Reconciliation-Token": "x".repeat(32),
			},
			body: "{}",
		});
		expect(response.status).toBe(503);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			discoveredCount: 2,
			processedCount: 1,
			failedCount: 1,
		});
		expect(calls).toBe(1);
	});
});

describe("private runtime readiness, diagnostics, metrics, operator, and event-bus routes", () => {
	it("separates workload and operator credentials, sets Cache-Control: no-store, and enforces transport-agnostic event ingestion", async () => {
		const repository = new InMemoryOrganizationRepository();
		const org = await repository.createOrganization({
			name: "Festival Org",
			slug: "festival-org",
		});
		const aesKey = Buffer.alloc(32, 5).toString("base64");
		const secrets = ShopifySecretKeyring.fromEnvironment(
			JSON.stringify({ k1: aesKey }),
			"k1",
		);
		if (!secrets) throw new Error("Expected keyring");
		await repository.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "festival-org.myshopify.com",
			clientId: "client-1",
			encryptedClientSecret: secrets.encrypt("shpss_super_secret", {
				organizationId: org.id,
				purpose: "shopify-client-secret",
			}),
		});
		await repository.updateShopifyVerification({
			organizationId: org.id,
			verificationStatus: "ok",
			verifiedAtIso: "2026-09-01T00:00:00.000Z",
			lastTestedAtIso: "2026-09-01T00:00:00.000Z",
			verifiedShopGid: "gid://shopify/Shop/99",
			verifiedShopDomain: "festival-org.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
		const commerceRepository = new InMemoryMembershipCommerceRepository(
			repository,
		);
		const processedDeliveries: string[] = [];
		const { app } = await createApp({
			env: {
				port: 3000,
				publicOrigin: "https://festival.example",
				festivalSecretKeysJson: JSON.stringify({ k1: aesKey }),
				festivalActiveSecretKeyId: "k1",
				reconciliationToken: "reconcile-token-0000000000000000",
				runtimeToken: "runtime-token-000000000000000000",
				operatorToken: "operator-token-00000000000000000",
				eventBusToken: "event-bus-token-0000000000000000",
			},
			repository,
			commerceRepository,
			authVerifier: new Auth(),
			shopifyOrderProjectionService: {
				processDelivery: async (deliveryId: string) => {
					processedDeliveries.push(deliveryId);
					return "processed";
				},
			} as unknown as ShopifyOrderProjectionService,
		});

		const healthBrowser = await app.request("/health", {
			headers: { Origin: "http://localhost:5173" },
		});
		expect(healthBrowser.status).toBe(404);
		const healthOk = await app.request("/health");
		expect(healthOk.status).toBe(200);
		expect(healthOk.headers.get("cache-control")).toBe("no-store");

		expect((await app.request("/api/internal/ready")).status).toBe(404);
		const readyRes = await app.request("/api/internal/ready", {
			headers: {
				"X-Festival-Runtime-Token": "runtime-token-000000000000000000",
			},
		});
		expect(readyRes.status).toBe(200);
		expect(readyRes.headers.get("cache-control")).toBe("no-store");
		expect(await readyRes.json()).toEqual({
			status: "ready",
			checks: {
				repository: "ok",
				shopifyKeyring: "configured",
			},
		});

		const diagRes = await app.request("/api/internal/diagnostics", {
			headers: {
				"X-Festival-Runtime-Token": "runtime-token-000000000000000000",
			},
		});
		expect(diagRes.status).toBe(200);
		const diagText = await diagRes.text();
		expect(diagText).not.toContain("shpss_super_secret");
		expect(diagText).not.toContain(aesKey);
		expect(JSON.parse(diagText)).toMatchObject({
			status: "ok",
			diagnostics: {
				shopifyWebhookQueue: {
					queued: 0,
					active: 0,
					saturated: false,
					rejectedCount: 0,
					pendingRecoveryCount: 0,
					recoveredCount: 0,
				},
			},
		});

		const metricsRes = await app.request("/api/internal/metrics", {
			headers: {
				"X-Festival-Runtime-Token": "runtime-token-000000000000000000",
			},
		});
		expect(metricsRes.status).toBe(200);
		expect(await metricsRes.json()).toMatchObject({
			status: "ok",
			subsystems: {
				reconciliationConfigured: true,
				eventBusConfigured: true,
				firebaseClaimsReconciliationConfigured: false,
			},
			shopifyWebhookQueue: {
				queued: 0,
				active: 0,
				completed: 0,
				failed: 0,
				saturated: false,
				rejectedCount: 0,
				pendingRecoveryCount: 0,
				recoveredCount: 0,
			},
		});

		expect(
			(
				await app.request("/api/internal/operator/status", {
					headers: {
						"X-Festival-Runtime-Token": "runtime-token-000000000000000000",
					},
				})
			).status,
		).toBe(404);
		const operatorRes = await app.request("/api/internal/operator/status", {
			headers: {
				"X-Festival-Operator-Token": "operator-token-00000000000000000",
			},
		});
		expect(operatorRes.status).toBe(200);
		expect(await operatorRes.json()).toEqual({
			status: "ok",
			boundaries: {
				publicHealthz: "minimal",
				privateRuntimeAuthenticated: true,
				tenantScopedReconciliationCount: 0,
			},
			shopifyWebhookQueue: {
				queued: 0,
				active: 0,
				completed: 0,
				failed: 0,
				saturated: false,
				rejectedCount: 0,
				pendingRecoveryCount: 0,
				recoveredCount: 0,
			},
		});

		const eventPath = "/api/internal/events/shopify-orders-paid";
		const validEvent = {
			eventId: "evt-12345678-1234-4234-9234-123456789012",
			organizationId: org.id,
			shopDomain: "festival-org.myshopify.com",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/777",
			payloadSha256: "a".repeat(64),
		};
		expect(
			(
				await app.request(eventPath, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Festival-Runtime-Token": "runtime-token-000000000000000000",
					},
					body: JSON.stringify(validEvent),
				})
			).status,
		).toBe(404);

		const wrongTenantEvent = await app.request(eventPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Event-Bus-Token": "event-bus-token-0000000000000000",
			},
			body: JSON.stringify({
				...validEvent,
				organizationId: ORG_B,
			}),
		});
		expect(wrongTenantEvent.status).toBe(401);

		const wrongVersionEvent = await app.request(eventPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Event-Bus-Token": "event-bus-token-0000000000000000",
			},
			body: JSON.stringify({
				...validEvent,
				apiVersion: "2025-01",
			}),
		});
		expect(wrongVersionEvent.status).toBe(400);

		const acceptedEvent = await app.request(eventPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Event-Bus-Token": "event-bus-token-0000000000000000",
			},
			body: JSON.stringify(validEvent),
		});
		expect(acceptedEvent.status).toBe(202);
		expect(acceptedEvent.headers.get("cache-control")).toBe("no-store");
		expect(processedDeliveries).toHaveLength(1);

		const duplicateEvent = await app.request(eventPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Event-Bus-Token": "event-bus-token-0000000000000000",
			},
			body: JSON.stringify(validEvent),
		});
		expect(duplicateEvent.status).toBe(200);
		expect(processedDeliveries).toHaveLength(1);
	});
});
