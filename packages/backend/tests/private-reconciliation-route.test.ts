import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { FirebaseClaimsReconciliationService } from "../src/auth/firebase-claims-reconciliation.js";
import type { AuthVerifier } from "../src/auth/types.js";
import type { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class Auth implements AuthVerifier {
	async verify(): Promise<AuthenticatedUser> {
		return { uid: "admin", email: "admin@example.com", displayName: "Admin" };
	}
}

describe("private Shopify reconciliation route", () => {
	it("requires its separate service token and never receives CORS headers", async () => {
		let reconciledOrganizationId: string | undefined;
		const { app } = await createApp({
			env: { port: 3000, reconciliationToken: "x".repeat(32) },
			repository: new InMemoryOrganizationRepository(),
			authVerifier: new Auth(),
			shopifyOrderProjectionService: {
				reconcile: async (organizationId: string) => {
					reconciledOrganizationId = organizationId;
					return { discoveredCount: 1, processedCount: 1 };
				},
			} as unknown as ShopifyOrderProjectionService,
		});
		const path = "/api/internal/reconcile/shopify-orders";
		const body = JSON.stringify({
			organizationId: "00000000-0000-4000-8000-000000000001",
		});
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
				})
			).status,
		).toBe(404);
		const accepted = await app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Festival-Reconciliation-Token": "x".repeat(32),
			},
			body,
		});
		expect(accepted.status).toBe(200);
		expect(accepted.headers.get("access-control-allow-origin")).toBeNull();
		expect(reconciledOrganizationId).toBe(
			"00000000-0000-4000-8000-000000000001",
		);
		expect(
			(
				await app.request(path, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Festival-Reconciliation-Token": "x".repeat(32),
						Origin: "https://festival.example",
					},
					body,
				})
			).status,
		).toBe(404);
	});
});

describe("private Firebase claims reconciliation route", () => {
	it("requires the service token and returns reconciliation failures to the scheduler", async () => {
		let calls = 0;
		const { app } = await createApp({
			env: { port: 3000, reconciliationToken: "x".repeat(32) },
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
		expect(await response.json()).toEqual({
			discoveredCount: 2,
			processedCount: 1,
			failedCount: 1,
		});
		expect(calls).toBe(1);
	});
});
