import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { InMemoryMembershipCommerceRepository } from "../../../src/commerce/membership-commerce-repository.js";
import {
	type CommerceProjectionDomainEvent,
	CommerceProjectionEventBus,
	ShopifyIntegrationService,
	ShopifyWebhookService,
	WebhookWorkerQueue,
} from "../../../src/domains/commerce-projection/index.js";
import { DomainCacheInvalidator } from "../../../src/lib/domain-cache-invalidator.js";
import { InMemoryOrganizationRepository } from "../../../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../../../src/shopify/encryption.js";

const TEST_AES_KEY = Buffer.alloc(32, 11).toString("base64");

function makeKeyring() {
	const kr = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ k1: TEST_AES_KEY }),
		"k1",
	);
	if (!kr) throw new Error("Expected keyring.");
	return kr;
}

describe("commerce-projection webhooks, worker queue, and domain event bus", () => {
	it("emits ShopifySecretRotated and clears domain cache invalidator on saveAndTestForTenant and clearCaches", async () => {
		const orgs = new InMemoryOrganizationRepository();
		const org = await orgs.createOrganization({
			name: "Event Org",
			slug: "event-org",
		});
		const kr = makeKeyring();
		const eventBus = new CommerceProjectionEventBus();
		const events: CommerceProjectionDomainEvent[] = [];
		eventBus.subscribe((e) => {
			events.push(e);
		});

		const cacheInvalidator = new DomainCacheInvalidator();
		const invalidationEvents: unknown[] = [];
		cacheInvalidator.subscribe((evt) => {
			invalidationEvents.push(evt);
		});

		const integrationService = new ShopifyIntegrationService(orgs, kr, {
			testCredentials: async (creds) => ({
				shopGid: "gid://shopify/Shop/1",
				shopDomain: creds.storeDomain,
				grantedScopes: [
					"read_products",
					"write_products",
					"write_inventory",
					"read_orders",
					"read_publications",
				],
			}),
		});
		integrationService.bindCacheInvalidator(cacheInvalidator);
		integrationService.bindEventBus(eventBus);

		await integrationService.saveAndTestForTenant(
			{ organization: org, role: "owner" } as never,
			{
				storeUrl: "event-studio.myshopify.com",
				clientId: "client-1",
				clientSecret: "super-secret-value",
			},
		);
		expect(events).toEqual([
			{
				type: "ShopifySecretRotated",
				organizationId: org.id,
				slug: "event-org",
				integrationVersion: 1,
			},
			{
				type: "ShopifySecretRotated",
				organizationId: org.id,
				slug: "event-org",
				integrationVersion: 1,
			},
		]);
		expect(invalidationEvents.length).toBeGreaterThanOrEqual(1);

		const commerce = new InMemoryMembershipCommerceRepository(orgs);
		const webhookService = new ShopifyWebhookService(orgs, commerce, kr, {
			processDelivery: async () => "processed",
		});
		webhookService.bindCacheInvalidator(cacheInvalidator);
		webhookService.bindEventBus(eventBus);

		webhookService.clearCaches();
		expect(events).toHaveLength(3);
		expect(events[2]).toEqual({ type: "ShopifySecretRotated" });
		expect(invalidationEvents.at(-1)).toEqual({ type: "CachesCleared" });
	});

	it("validates HMAC, deduplicates deliveries, and drains WebhookWorkerQueue cleanly", async () => {
		const orgs = new InMemoryOrganizationRepository();
		const org = await orgs.createOrganization({
			name: "Webhook Org",
			slug: "webhook-org",
		});
		const kr = makeKeyring();
		const secret = "webhook-hmac-secret";
		await orgs.upsertShopifyIntegration({
			organizationId: org.id,
			storeDomain: "webhook-studio.myshopify.com",
			clientId: "cid",
			encryptedClientSecret: kr.encrypt(secret, {
				organizationId: org.id,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
		await orgs.updateShopifyVerification({
			organizationId: org.id,
			verificationStatus: "ok",
			verifiedShopGid: "gid://shopify/Shop/9",
			verifiedShopDomain: "webhook-studio.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				write_inventory: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
		});

		const commerce = new InMemoryMembershipCommerceRepository(orgs);
		const executed: string[] = [];
		const webhookService = new ShopifyWebhookService(
			orgs,
			commerce,
			kr,
			{
				processDelivery: async (deliveryId) => {
					executed.push(deliveryId);
					return "processed";
				},
			},
			undefined,
			undefined,
			{ queueConcurrency: 1, queueMaxBacklog: 10 },
		);
		const app = new Hono();
		app.post("/orders-paid", (c) => webhookService.handle(c));

		const body = JSON.stringify({
			id: 4242,
			admin_graphql_api_id: "gid://shopify/Order/4242",
		});
		const hmac = createHmac("sha256", secret).update(body).digest("base64");
		const headers = {
			"x-shopify-topic": "orders/paid",
			"x-shopify-shop-domain": "webhook-studio.myshopify.com",
			"x-shopify-webhook-id": "wh-4242-00000001",
			"x-shopify-hmac-sha256": hmac,
			"x-shopify-api-version": "2026-07",
			"content-type": "application/json",
		};

		const first = await app.request("/orders-paid", {
			method: "POST",
			headers,
			body,
		});
		expect(first.status).toBe(202);
		await webhookService.drain();
		expect(executed).toHaveLength(1);

		const badHmac = await app.request("/orders-paid", {
			method: "POST",
			headers: { ...headers, "x-shopify-hmac-sha256": "invalid" },
			body,
		});
		expect(badHmac.status).toBe(401);
	});

	it("bounds WebhookWorkerQueue backlog and recovers pending items through reclaimPending", async () => {
		const executed: string[] = [];
		let releaseFirst!: () => void;
		const queue = new WebhookWorkerQueue(
			async (id) => {
				if (id === "d-1") {
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
				}
				executed.push(id);
			},
			{ concurrency: 1, maxBacklog: 1, maxPendingRecovery: 1 },
		);

		expect(queue.enqueue("d-1")).toBe(true); // active = 1
		expect(queue.enqueue("d-2")).toBe(true); // backlog = 1
		expect(queue.enqueue("d-3", { retainForRecovery: false })).toBe(false); // dropped when retainForRecovery is false
		expect(queue.getAvailableReclaimSlots()).toBe(0);

		releaseFirst();
		await queue.drain();
		expect(executed).toEqual(["d-1", "d-2"]);

		const recovered = await queue.reclaimPending(async () => ["d-4"]);
		expect(recovered).toBe(1);
		await queue.drain();
		expect(executed).toEqual(["d-1", "d-2", "d-4"]);
	});
});
