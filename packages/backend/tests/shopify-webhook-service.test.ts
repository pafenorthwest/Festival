import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
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

async function fixture() {
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
		undefined,
		() => new Date("2026-08-28T18:00:00.000Z"),
		(deliveryId) => scheduled.push(deliveryId),
	);
	const app = new Hono();
	app.post("/api/shopify/webhooks/orders-paid", (c) => service.handle(c));
	return { app, commerce, scheduled };
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
			headers: requestHeaders(body, {
				"X-Shopify-Shop-Domain": "other.myshopify.com",
			}),
			body,
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
});
