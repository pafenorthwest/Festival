import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import type { TenantContext } from "../src/auth/tenant-context.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { ShopifyWebhookOperationError } from "../src/shopify/errors.js";
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
	error: Error | undefined;
	async reconcileOrdersPaidWebhook(
		context: ShopifyAdminOperationContext,
		callbackUrl: string,
	): Promise<ShopifyAdminResult<void>> {
		this.calls.push({ context, callbackUrl });
		this.activeCalls += 1;
		this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);
		await this.delay;
		this.activeCalls -= 1;
		if (this.error) throw this.error;
		return { value: undefined };
	}
}

describe("ShopifyWebhookSubscriptionService", () => {
	it("rejects a missing public callback origin before Shopify access", () => {
		const client = new FakeWebhookClient();
		expect(
			() =>
				new ShopifyWebhookSubscriptionService(
					new InMemoryOrganizationRepository(),
					keyring(),
					client,
					undefined,
				),
		).toThrow(
			"FESTIVAL_PUBLIC_ORIGIN is required when Shopify services are enabled.",
		);
		expect(client.calls).toHaveLength(0);
	});

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
		const result = await new ShopifyWebhookSubscriptionService(
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
		expect(result.status).toBe("ready");
		expect(
			(await repository.getShopifyIntegration(organization.id))
				?.webhookReadinessStatus,
		).toBe("ready");
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
		const second = service.reconcileForTenant(tenant(organization));
		for (
			let attempt = 0;
			attempt < 10 && client.calls.length === 0;
			attempt += 1
		) {
			await Bun.sleep(0);
		}
		expect(client.calls).toHaveLength(1);
		release();
		await Promise.all([first, second]);
		expect(client.maxActiveCalls).toBe(1);
	});

	it("persists a typed failure without exposing an unsafe request ID", async () => {
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
		client.error = new ShopifyWebhookOperationError(
			"subscription_create",
			"protected_data",
			"unsafe request id with spaces",
		);
		const result = await new ShopifyWebhookSubscriptionService(
			repository,
			secrets,
			client,
			"https://festival.example.com",
		).reconcileForTenant(tenant(organization));

		expect(result).toMatchObject({
			status: "failed",
			failureCategory: "protected_data",
		});
		expect(result.requestId).toBeUndefined();
		const stored = await repository.getShopifyIntegration(organization.id);
		expect(stored?.verificationStatus).toBe("ok");
		expect(stored?.webhookReadinessStatus).toBe("failed");
		expect(stored?.webhookFailureCategory).toBe("protected_data");
		expect(stored?.webhookRequestId).toBeUndefined();
	});

	it("reports configuration and missing-scope readiness without calling Shopify", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await repository.createOrganization({
			name: "PAFE",
			slug: "pafe",
		});
		const secrets = keyring();
		const client = new FakeWebhookClient();
		await repository.upsertShopifyIntegration({
			organizationId: organization.id,
			storeDomain: "pafe.myshopify.com",
			clientId: "client-id",
			encryptedClientSecret: secrets.encrypt("client-secret", {
				organizationId: organization.id,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
		const missingOrigin = await new ShopifyWebhookSubscriptionService(
			repository,
			secrets,
			client,
			undefined,
		).reconcileForTenant(tenant(organization));
		expect(missingOrigin).toMatchObject({
			status: "failed",
			failureCategory: "configuration",
		});
		await repository.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "pafe.myshopify.com",
			grantedScopes: ["read_products"],
			capabilities: {
				read_products: "granted",
				write_products: "missing",
				read_orders: "missing",
				write_orders: "disabled",
			},
		});
		const missingScope = await new ShopifyWebhookSubscriptionService(
			repository,
			secrets,
			client,
			"https://festival.example.com",
		).reconcileForTenant(tenant(organization));
		expect(missingScope).toMatchObject({
			status: "failed",
			failureCategory: "missing_scope",
		});
		expect(client.calls).toHaveLength(0);
		expect(
			(await repository.getShopifyIntegration(organization.id))
				?.verificationStatus,
		).toBe("ok");
	});
});
