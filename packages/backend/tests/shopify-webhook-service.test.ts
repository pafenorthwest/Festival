import { describe, expect, it } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { Hono } from "hono";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "../src/commerce/shopify-order-projection-service.js";
import { ShopifyWebhookService } from "../src/commerce/shopify-webhook-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	type ShopifyClientSecretContext,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";

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
	useDefaultQueue?: boolean;
	projection?: ShopifyOrderProjectionService;
	queueConcurrency?: number;
	queueMaxBacklog?: number;
	queueMaxPendingRecovery?: number;
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
		options?.useDefaultQueue
			? undefined
			: (options?.schedule ?? ((deliveryId) => scheduled.push(deliveryId))),
		{
			queueConcurrency: options?.queueConcurrency,
			queueMaxBacklog: options?.queueMaxBacklog,
			queueMaxPendingRecovery: options?.queueMaxPendingRecovery,
		},
	);
	const app = new Hono();
	app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));
	return {
		app,
		commerce,
		organization,
		organizations,
		scheduled,
		secrets,
		service,
	};
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
			context: ShopifyClientSecretContext,
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
		expect(service.getStats()).toMatchObject({
			queued: 1,
			active: 1,
			saturated: true,
			rejectedCount: 1,
			pendingRecoveryCount: 1,
			recoveredCount: 0,
			recoveryOverflowCount: 0,
		});

		// Release blocked workers and drain — saturated delivery 3 is automatically recovered without waiting for periodic reconciliation
		shouldWait = false;
		await service.drain();

		expect(processed).toHaveLength(3);
		expect(service.getStats()).toMatchObject({
			queued: 0,
			active: 0,
			completed: 3,
			failed: 0,
			saturated: false,
			rejectedCount: 1,
			pendingRecoveryCount: 0,
			recoveredCount: 1,
			recoveryOverflowCount: 0,
		});
	});

	it("bounds pendingRecoveryIds under burst exceeding maxBacklog + maxPendingRecovery and reconciles overflow deliveries from durable storage", async () => {
		const processed: string[] = [];
		let shouldWait = true;
		let f!: Awaited<ReturnType<typeof fixture>>;
		f = await fixture({
			useDefaultQueue: true,
			queueConcurrency: 1,
			queueMaxBacklog: 1,
			queueMaxPendingRecovery: 2,
			projection: {
				processDelivery: async (deliveryId: string) => {
					while (shouldWait) {
						await new Promise((r) => setTimeout(r, 10));
					}
					const claimed = await f.commerce.claimDelivery(deliveryId);
					if (!claimed) return "skipped" as const;
					await f.commerce.markDeliveryProcessed(deliveryId);
					processed.push(claimed.shopifyOrderGid);
					return "processed" as const;
				},
			} as unknown as ShopifyOrderProjectionService,
		});

		for (let i = 1; i <= 6; i++) {
			const body = JSON.stringify({
				admin_graphql_api_id: `gid://shopify/Order/${i}`,
			});
			const digit = String(i);
			const res = await f.app.request("/api/shopify/webhooks/orders-paid", {
				method: "POST",
				headers: requestHeaders(body, {
					"X-Shopify-Webhook-Id": `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-9${digit.repeat(3)}-${digit.repeat(12)}`,
				}),
				body,
			});
			expect(res.status).toBe(202);
		}

		expect(f.service.getStats()).toEqual({
			queued: 1,
			active: 1,
			completed: 0,
			failed: 0,
			saturated: true,
			rejectedCount: 4,
			pendingRecoveryCount: 2,
			recoveredCount: 0,
			recoveryOverflowCount: 2,
		});

		shouldWait = false;
		await f.service.drain();

		expect(processed).toEqual([
			"gid://shopify/Order/1",
			"gid://shopify/Order/2",
			"gid://shopify/Order/3",
			"gid://shopify/Order/4",
		]);
		expect(f.service.getStats()).toEqual({
			queued: 0,
			active: 0,
			completed: 4,
			failed: 0,
			saturated: false,
			rejectedCount: 4,
			pendingRecoveryCount: 0,
			recoveredCount: 2,
			recoveryOverflowCount: 2,
		});

		const remainingBeforeReclaim = await f.commerce.listReclaimableDeliveries(
			f.organization.id,
			10,
			"2026-08-28T18:05:00.000Z",
		);
		expect(remainingBeforeReclaim).toHaveLength(2);
		expect(remainingBeforeReclaim.map((d) => d.status)).toEqual([
			"received",
			"received",
		]);
		expect(remainingBeforeReclaim.map((d) => d.shopifyOrderGid)).toEqual([
			"gid://shopify/Order/5",
			"gid://shopify/Order/6",
		]);

		const reclaimed = await f.service.reclaimOrganizationPending(
			f.organization.id,
			10,
		);
		expect(reclaimed).toBe(2);
		await f.service.drain();

		expect(processed).toEqual([
			"gid://shopify/Order/1",
			"gid://shopify/Order/2",
			"gid://shopify/Order/3",
			"gid://shopify/Order/4",
			"gid://shopify/Order/5",
			"gid://shopify/Order/6",
		]);
		expect(f.service.getStats().completed).toBe(6);
		const remainingAfterReclaim = await f.commerce.listReclaimableDeliveries(
			f.organization.id,
			10,
			"2026-08-28T18:05:00.000Z",
		);
		expect(remainingAfterReclaim).toHaveLength(0);
	});

	it("schedules recovery when a duplicate webhook arrives for an unscheduled or failed delivery while keeping processed, active, and queued duplicates idempotent", async () => {
		const processed: string[] = [];
		let shouldBlockWorker = false;
		let f!: Awaited<ReturnType<typeof fixture>>;
		f = await fixture({
			useDefaultQueue: true,
			queueConcurrency: 1,
			queueMaxBacklog: 4,
			projection: {
				processDelivery: async (deliveryId: string) => {
					while (shouldBlockWorker) {
						await new Promise((r) => setTimeout(r, 10));
					}
					const claimed = await f.commerce.claimDelivery(deliveryId);
					if (!claimed) return "skipped" as const;
					await f.commerce.markDeliveryProcessed(deliveryId);
					processed.push(claimed.shopifyOrderGid);
					return "processed" as const;
				},
			} as unknown as ShopifyOrderProjectionService,
		});

		const body = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/99",
		});
		const headers = requestHeaders(body, {
			"X-Shopify-Webhook-Id": "99999999-9999-4999-9999-999999999999",
		});

		// Pre-record delivery in DB as "received" (simulating prior unscheduled persistence)
		const preRecorded = await f.commerce.recordDelivery({
			organizationId: f.organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "99999999-9999-4999-9999-999999999999",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/99",
			payloadSha256: createHash("sha256").update(body).digest("hex"),
			receivedAtIso: "2026-08-28T18:00:00.000Z",
		});
		expect(preRecorded.kind).toBe("accepted");

		// Duplicate webhook arrives while delivery is still status === "received" and unscheduled
		const dupUnscheduled = await f.app.request(
			"/api/shopify/webhooks/orders-paid",
			{
				method: "POST",
				headers,
				body,
			},
		);
		expect(dupUnscheduled.status).toBe(200);
		await f.service.drain();
		expect(processed).toEqual(["gid://shopify/Order/99"]);

		// Subsequent duplicate webhook after processing remains strictly idempotent (not re-processed)
		const dupProcessed = await f.app.request(
			"/api/shopify/webhooks/orders-paid",
			{
				method: "POST",
				headers,
				body,
			},
		);
		expect(dupProcessed.status).toBe(200);
		await f.service.drain();
		expect(processed).toEqual(["gid://shopify/Order/99"]);

		// (a) Persisting a delivery in the "failed" state and sending a duplicate webhook reschedules and processes it once
		const failedBody = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/100",
		});
		const failedHeaders = requestHeaders(failedBody, {
			"X-Shopify-Webhook-Id": "aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa",
		});
		const failedRecord = await f.commerce.recordDelivery({
			organizationId: f.organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/100",
			payloadSha256: createHash("sha256").update(failedBody).digest("hex"),
			receivedAtIso: "2026-08-28T18:00:00.000Z",
		});
		expect(failedRecord.kind).toBe("accepted");
		if (failedRecord.kind !== "accepted") throw new Error("Expected accepted");
		await f.commerce.markDeliveryFailed(failedRecord.delivery.id, {
			category: "upstream",
			stage: "order_read",
			code: "shopify_upstream",
			failedAtIso: "2026-08-28T18:00:05.000Z",
		});

		const dupFailed = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: failedHeaders,
			body: failedBody,
		});
		expect(dupFailed.status).toBe(200);
		await f.service.drain();
		expect(processed).toEqual([
			"gid://shopify/Order/99",
			"gid://shopify/Order/100",
		]);
		const reclaimableAfterFailedRecovery =
			await f.commerce.listReclaimableDeliveries(
				f.organization.id,
				10,
				"2026-08-28T18:05:00.000Z",
			);
		expect(reclaimableAfterFailedRecovery).toHaveLength(0);

		// (b) Sending duplicate webhooks while a delivery is currently active or queued is deduplicated by isQueuedOrActive
		shouldBlockWorker = true;
		const activeBody = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/101",
		});
		const activeHeaders = requestHeaders(activeBody, {
			"X-Shopify-Webhook-Id": "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb",
		});
		const queuedBody = JSON.stringify({
			admin_graphql_api_id: "gid://shopify/Order/102",
		});
		const queuedHeaders = requestHeaders(queuedBody, {
			"X-Shopify-Webhook-Id": "cccccccc-cccc-4ccc-9ccc-cccccccccccc",
		});

		const firstActive = await f.app.request(
			"/api/shopify/webhooks/orders-paid",
			{
				method: "POST",
				headers: activeHeaders,
				body: activeBody,
			},
		);
		expect(firstActive.status).toBe(202);

		const firstQueued = await f.app.request(
			"/api/shopify/webhooks/orders-paid",
			{
				method: "POST",
				headers: queuedHeaders,
				body: queuedBody,
			},
		);
		expect(firstQueued.status).toBe(202);

		expect(f.service.getStats()).toMatchObject({
			active: 1,
			queued: 1,
			rejectedCount: 0,
		});

		// Duplicate of active delivery and duplicate of queued delivery while worker is blocked
		const dupActive = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: activeHeaders,
			body: activeBody,
		});
		expect(dupActive.status).toBe(200);

		const dupQueued = await f.app.request("/api/shopify/webhooks/orders-paid", {
			method: "POST",
			headers: queuedHeaders,
			body: queuedBody,
		});
		expect(dupQueued.status).toBe(200);

		expect(f.service.getStats()).toMatchObject({
			active: 1,
			queued: 1,
			rejectedCount: 0,
		});

		shouldBlockWorker = false;
		await f.service.drain();

		expect(processed).toEqual([
			"gid://shopify/Order/99",
			"gid://shopify/Order/100",
			"gid://shopify/Order/101",
			"gid://shopify/Order/102",
		]);
	});
});
