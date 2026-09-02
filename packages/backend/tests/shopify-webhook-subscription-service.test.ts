import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import type { TenantContext } from "../src/auth/tenant-context.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { ShopifyWebhookSubscriptionService } from "../src/shopify/shopify-webhook-subscription-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyWebhookSubscriptionClient,
} from "../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 9).toString("base64");

function keyring(): ShopifySecretKeyring {
	const configured = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!configured) throw new Error("Expected configured keyring.");
	return configured;
}

function tenant(organization: OrganizationRecord): TenantContext {
	return {
		identity: {
			uid: "admin",
			email: "admin@example.com",
			displayName: "Admin",
		},
		user: {
			id: "user",
			firebaseUid: "admin",
			email: "admin@example.com",
			displayName: "Admin",
			disassociated: false,
			createdAtIso: new Date().toISOString(),
		},
		organization,
		membership: {
			id: "membership",
			organizationId: organization.id,
			userId: "user",
			role: "Admin",
			joinedAtIso: new Date().toISOString(),
			origin: "creator",
		},
		role: "Admin",
	};
}

class FakeWebhookClient implements ShopifyWebhookSubscriptionClient {
	calls: Array<{ context: ShopifyAdminOperationContext; callbackUrl: string }> =
		[];
	delay: Promise<void> | undefined;
	activeCalls = 0;
	maxActiveCalls = 0;
	async reconcileOrdersPaidWebhook(
		context: ShopifyAdminOperationContext,
		callbackUrl: string,
	): Promise<ShopifyAdminResult<void>> {
		this.calls.push({ context, callbackUrl });
		this.activeCalls += 1;
		this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);
		await this.delay;
		this.activeCalls -= 1;
		return { value: undefined };
	}
}

describe("ShopifyWebhookSubscriptionService", () => {
	it("uses the verified tenant and exact paid-order endpoint", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await repository.createOrganization({
			name: "PAFE",
			slug: "pafe",
		});
		const secrets = keyring();
		await repository.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "pafe.myshopify.com",
			clientId: "client-id",
			encryptedClientSecret: secrets.encrypt("client-secret", {
				organizationId: organization.id,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
		await repository.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "pafe.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
		const client = new FakeWebhookClient();
		await new ShopifyWebhookSubscriptionService(
			repository,
			secrets,
			client,
			"https://festival.example.com",
		).reconcileForTenant(tenant(organization));

		expect(client.calls).toHaveLength(1);
		expect(client.calls[0]?.callbackUrl).toBe(
			"https://festival.example.com/api/shopify/webhooks/orders-paid",
		);
		expect(client.calls[0]?.context.organizationId).toBe(organization.id);
		expect(client.calls[0]?.context.capability).toBe("read_orders");
	});

	it("serializes concurrent reconciliation for one organization", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await repository.createOrganization({
			name: "PAFE",
			slug: "pafe",
		});
		const secrets = keyring();
		await repository.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "pafe.myshopify.com",
			clientId: "client-id",
			encryptedClientSecret: secrets.encrypt("client-secret", {
				organizationId: organization.id,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
		await repository.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "pafe.myshopify.com",
			grantedScopes: ["read_orders"],
			capabilities: {
				read_products: "missing",
				write_products: "missing",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
		let release: () => void = () => {};
		const client = new FakeWebhookClient();
		client.delay = new Promise<void>((resolve) => {
			release = resolve;
		});
		const service = new ShopifyWebhookSubscriptionService(
			repository,
			secrets,
			client,
			"https://festival.example.com",
		);

		const first = service.reconcileForTenant(tenant(organization));
		await Promise.resolve();
		const second = service.reconcileForTenant(tenant(organization));
		await Promise.resolve();
		expect(client.calls).toHaveLength(1);
		release();
		await Promise.all([first, second]);
		expect(client.maxActiveCalls).toBe(1);
	});
});
