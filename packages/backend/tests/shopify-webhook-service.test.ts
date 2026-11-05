import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { ShopifyWebhookService } from "../src/commerce/shopify-webhook-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

const AES_KEY = Buffer.alloc(32, 9).toString("base64");
const SECRET = "shopify-webhook-secret";

function keyring() {
	const value = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: AES_KEY }),
		"test",
	);
	if (!value) throw new Error("Expected keyring.");
	return value;
}

async function fixture(options?: {
	now?: () => Date;
	schedule?: (deliveryId: string) => void;
	projection?: ShopifyOrderProjectionService;
	queueConcurrency?: number;
	queueMaxBacklog?: number;
}) {
	const organizations = new InMemoryOrganizationRepository();
	const organization = await organizations.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const secrets = keyring();
	await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "festival.myshopify.com",
		clientId: "app-client",
		encryptedClientSecret: secrets.encrypt(SECRET, {
			organizationId: organization.id,
			purpose: "shopify-client-secret",
		}),
	});
	await organizations.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: "2026-08-28T18:00:00.000Z",
		lastTestedAtIso: "2026-08-28T18:00:00.000Z",
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "festival.myshopify.com",
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
	const commerce = new InMemoryMembershipCommerceRepository(organizations);
	const scheduled: string[] = [];
	const service = new ShopifyWebhookService(
		organizations,
		commerce,
		secrets,
		options?.projection,
		options?.now ?? (() => new Date("2026-08-28T18:00:00.000Z")),
		options?.schedule ?? ((deliveryId) => scheduled.push(deliveryId)),
		{
			queueConcurrency: options?.queueConcurrency,
			queueMaxBacklog: options?.queueMaxBacklog,
		},
	);
	const app = new Hono();
	app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));
	return { app, commerce, organizations, scheduled, secrets, service };
}

function requestHeaders(body: string, overrides: Record<string, string> = {}) {
	return {
		"Content-Type": "application/json",
		"X-Shopify-Shop-Domain": "festival.myshopify.com",
		"X-Shopify-Topic": "orders/paid",
		"X-Shopify-API-Version": "2026-07",
		"X-Shopify-Webhook-Id": "12345678-1234-4234-9234-123456789012",
		"X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET)
			.update(body)
			.digest("base64"),
		...overrides,
	};
}

describe("Shopify paid-order webhook ingress", () => {
	it("persists only verified raw-body delivery evidence and asynchronously schedules it", async () => {
		const f = await fixture();
		const body = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/1",
			customer: { email: "must-not-be-stored@example.com" },
		});
		const response = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body),
			body,
		});
		expect(response.status).toBe(202);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(f.scheduled).toHaveLength(1);
		const claimed = await f.commerce.claimDelivery(f.scheduled[0] ?? "");
		expect(claimed).toMatchObject({
			shopifyOrderGid: "gid://shopify/Order/1",
			status: "processing",
		});
		expect(JSON.stringify(claimed)).not.toContain("must-not-be-stored");

		const duplicate = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body),
			body,
		});
		expect(duplicate.status).toBe(200);
		expect(f.scheduled).toHaveLength(1);
	});

	it("fails closed for browser headers, altered bodies, wrong shops, and preflight", async () => {
		const f = await fixture();
		const body = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/1",
		});
		const browser = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body, { Origin: "https://festival.example" }),
			body,
		});
		expect(browser.status).toBe(400);
		const altered = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body),
			body: `${body}\n`,
		});
		expect(altered.status).toBe(401);
		const wrongShop = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body),
			body: `${body}\n`,
		});
		expect(wrongShop.status).toBe(401);
		expect(
			(
				await f.app.request("/api/shopify/webhooks/orders-paid", {
					method: "OPTIONS",
				})
			).status,
		).toBe(404);
	});

	it("caches organization lookup and secret decryption with 60-second TTL", async () => {
		let currentTime = new Date("2026-08-28T18:00:00.000Z").getTime();
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const secrets = keyring();
		await organizations.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "festival.myshopify.com",
			clientId: "app-client",
			encryptedClientSecret: secrets.encrypt(SECRET, {
				organizationId: organization.id,
				purpose: "shopify-client-secret",
			}),
		});
		await organizations.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: "2026-08-28T18:00:00.000Z",
			lastTestedAtIso: "2026-08-28T18:00:00.000Z",
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "festival.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});

		let orgLookups = 0;
		const originalFindOrg =
			organizations.findOrganizationByShopDomain.bind(organizations);
		organizations.findOrganizationByShopDomain = async (domain: string) => {
			orgLookups++;
			return originalFindOrg(domain);
		};

		let secretDecrypts = 0;
		const originalDecrypt = secrets.decrypt.bind(secrets);
		secrets.decrypt = (
			cipherText: string,
			context: { organizationId: string; purpose: string },
		) => {
			secretDecrypts++;
			return originalDecrypt(cipherText, context);
		};

		const commerce = new InMemoryMembershipCommerceRepository(organizations);
		const service = new ShopifyWebhookService(
			organizations,
			commerce,
			secrets,
			undefined,
			() => new Date(currentTime),
		);
		const app = new Hono();
		app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));

		const body1 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/1",
		});
		const res1 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body1, {
				"X-Shopify-Webhook-Id": "11111111-1111-4111-9111-111111111111",
			}),
			body: body1,
		});
		expect(res1.status).toBe(202);
		expect(orgLookups).toBe(1);
		expect(secretDecrypts).toBe(1);

		// Second request within 60-second window: cache hits!
		currentTime += 30_000;
		const body2 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/2",
		});
		const res2 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body2, {
				"X-Shopify-Webhook-Id": "22222222-2222-4222-9222-222222222222",
			}),
			body: body2,
		});
		expect(res2.status).toBe(202);
		expect(orgLookups).toBe(1); // Cached
		expect(secretDecrypts).toBe(1); // Cached

		// Advance past 60s TTL window: cache expires and reloads
		currentTime += 31_000; // Total 61 seconds
		const body3 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/3",
		});
		const res3 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body3, {
				"X-Shopify-Webhook-Id": "33333333-3333-4333-9333-333333333333",
			}),
			body: body3,
		});
		expect(res3.status).toBe(202);
		expect(orgLookups).toBe(2); // Cache reloaded
		expect(secretDecrypts).toBe(2); // Cache reloaded
	});

	it("uses WebhookWorkerQueue as default scheduler and drains properly", async () => {
		const processed: string[] = [];
		const mockProjection = {
			processDelivery: async (deliveryId: string) => {
				processed.push(deliveryId);
				return "processed" as const;
			},
		} as unknown as ShopifyOrderProjectionService;

		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const secrets = keyring();
		await organizations.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "festival.myshopify.com",
			clientId: "app-client",
			encryptedClientSecret: secrets.encrypt(SECRET, {
				organizationId: organization.id,
				purpose: "shopify-client-secret",
			}),
		});
		await organizations.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: "2026-08-28T18:00:00.000Z",
			lastTestedAtIso: "2026-08-28T18:00:00.000Z",
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "festival.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);
		// Note: no schedule argument passed; should use WebhookWorkerQueue
		const service = new ShopifyWebhookService(
			organizations,
			commerce,
			secrets,
			mockProjection,
		);

		const app = new Hono();
		app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));

		const body = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/1",
		});
		const response = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(body),
			body,
		});
		expect(response.status).toBe(202);

		// Drain the queue to completion
		await service.drain();

		expect(processed).toHaveLength(1);
		expect(service.getQueue().stats()).toMatchObject({
			queued: 0,
			active: 0,
			completed: 1,
			failed: 0,
		});
	});

	it("returns 202 and safely persists to DB even when queue backlog is saturated", async () => {
		const processed: string[] = [];
		let shouldWait = true;
		const mockProjection = {
			processDelivery: async (deliveryId: string) => {
				while (shouldWait) {
					await new Promise((r) => setTimeout(r, 10));
				}
				await commerce.claimDelivery(deliveryId);
				await commerce.markDeliveryProcessed(deliveryId);
				processed.push(deliveryId);
				return "processed" as const;
			},
		} as unknown as ShopifyOrderProjectionService;

		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const secrets = keyring();
		await organizations.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "festival.myshopify.com",
			clientId: "app-client",
			encryptedClientSecret: secrets.encrypt(SECRET, {
				organizationId: organization.id,
				purpose: "shopify-client-secret",
			}),
		});
		await organizations.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: "2026-08-28T18:00:00.000Z",
			lastTestedAtIso: "2026-08-28T18:00:00.000Z",
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "festival.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);
		// Concurrency 1, maxBacklog 1
		const service = new ShopifyWebhookService(
			organizations,
			commerce,
			secrets,
			mockProjection,
			() => new Date("2026-08-28T18:00:00.000Z"),
			undefined,
			{ queueConcurrency: 1, queueMaxBacklog: 1 },
		);

		const app = new Hono();
		app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));

		// Webhook 1: becomes active (1 active, 0 queued)
		const b1 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/1",
		});
		const r1 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(b1, {
				"X-Shopify-Webhook-Id": "11111111-1111-4111-9111-111111111111",
			}),
			body: b1,
		});
		expect(r1.status).toBe(202);

		// Webhook 2: fills backlog (1 active, 1 queued)
		const b2 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/2",
		});
		const r2 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(b2, {
				"X-Shopify-Webhook-Id": "22222222-2222-4222-9222-222222222222",
			}),
			body: b2,
		});
		expect(r2.status).toBe(202);

		// Webhook 3: backlog is full! Must STILL return 202 Accepted because safely stored in DB
		const b3 = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/3",
		});
		const r3 = await app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: requestHeaders(b3, {
				"X-Shopify-Webhook-Id": "33333333-3333-4333-9333-333333333333",
			}),
			body: b3,
		});
		expect(r3.status).toBe(202);
		expect(service.getQueue().stats().queued).toBe(1);

		// Release blocked workers and drain
		shouldWait = false;
		await service.drain();

		// Now reclaim pending from DB
		const reclaimed = await service.reclaimPending(async () => {
			const pending = await commerce.listReclaimableDeliveries(
				organization.id,
				10,
				new Date("2026-08-28T19:00:00.000Z").toISOString(),
			);
			return pending.map((d) => d.id);
		});
		expect(reclaimed).toBe(1);

		await service.drain();

		expect(service.getQueue().stats().completed).toBe(3);
	});
});
