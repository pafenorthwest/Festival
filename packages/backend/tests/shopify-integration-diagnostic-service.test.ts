import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import type { TenantContext } from "../src/auth/tenant-context.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { ShopifyIntegrationDiagnosticService } from "../src/shopify/shopify-integration-diagnostic-service.js";
import type {
	ShopifyPublicStorefrontAccessResult,
	ShopifyPublicStorefrontDiagnosticClient,
} from "../src/shopify/shopify-public-catalog-client.js";

class DiagnosticClient implements ShopifyPublicStorefrontDiagnosticClient {
	readonly domains: string[] = [];
	result: ShopifyPublicStorefrontAccessResult = "passed";
	error: Error | null = null;

	async diagnosePublicStorefrontAccess(
		domain: string,
	): Promise<ShopifyPublicStorefrontAccessResult> {
		this.domains.push(domain);
		if (this.error) throw this.error;
		return this.result;
	}
}

function tenantFor(organization: OrganizationRecord): TenantContext {
	return {
		identity: {
			uid: "firebase-admin-uid",
			email: "admin@example.com",
			displayName: "Admin",
		},
		user: {
			id: "user-1",
			firebaseUid: "firebase-admin-uid",
			email: "admin@example.com",
			displayName: "Admin",
			disassociated: false,
			createdAtIso: new Date().toISOString(),
		},
		organization,
		membership: {
			id: "membership-1",
			organizationId: organization.id,
			userId: "user-1",
			role: "Admin",
			joinedAtIso: new Date().toISOString(),
			origin: "creator",
		},
		role: "Admin",
	};
}

async function verifiedRepository() {
	const repository = new InMemoryOrganizationRepository();
	const organization = await repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "festival.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: "opaque-envelope",
	});
	await repository.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: new Date().toISOString(),
		lastTestedAtIso: new Date().toISOString(),
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "festival.myshopify.com",
		grantedScopes: ["read_products"],
		capabilities: {
			read_products: "granted",
			write_products: "missing",
			read_orders: "missing",
			write_orders: "disabled",
		},
	});
	return { repository, organization };
}

describe("ShopifyIntegrationDiagnosticService", () => {
	it("returns allowlisted pass and locked-store results for the verified domain", async () => {
		const { repository, organization } = await verifiedRepository();
		const client = new DiagnosticClient();
		const service = new ShopifyIntegrationDiagnosticService(repository, client);

		await expect(
			service.runForTenant(tenantFor(organization)),
		).resolves.toEqual({
			checks: [
				{
					id: "public_storefront_access",
					status: "passed",
					message: "Public Storefront access is available.",
				},
			],
		});
		client.result = "locked";
		await expect(
			service.runForTenant(tenantFor(organization)),
		).resolves.toEqual({
			checks: [
				{
					id: "public_storefront_access",
					status: "failed",
					message:
						"Shopify's Online Store channel is locked. Public membership browsing is unavailable until the storefront is publicly accessible.",
				},
			],
		});
		expect(client.domains).toEqual([
			"festival.myshopify.com",
			"festival.myshopify.com",
		]);
	});

	it("requires a verified integration and sanitizes execution failures", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await repository.createOrganization({
			name: "Festival Admins",
			slug: "pafe",
		});
		const client = new DiagnosticClient();
		const service = new ShopifyIntegrationDiagnosticService(repository, client);
		await expect(service.runForTenant(tenantFor(organization))).rejects.toEqual(
			expect.objectContaining({
				status: 409,
				message: "Shopify integration has not been verified.",
			}),
		);
		expect(client.domains).toHaveLength(0);

		const verified = await verifiedRepository();
		client.error = new Error("sensitive-upstream-canary");
		try {
			await new ShopifyIntegrationDiagnosticService(
				verified.repository,
				client,
			).runForTenant(tenantFor(verified.organization));
			throw new Error("Expected diagnostic to reject.");
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).status).toBe(503);
			expect((error as Error).message).toBe(
				"Shopify diagnostics are temporarily unavailable.",
			);
			expect((error as Error).message).not.toContain(
				"sensitive-upstream-canary",
			);
		}
	});

	it("repairs the paid-order webhook when diagnostics run", async () => {
		const { repository, organization } = await verifiedRepository();
		const calls: string[] = [];
		const service = new ShopifyIntegrationDiagnosticService(
			repository,
			new DiagnosticClient(),
			undefined,
			{
				async reconcileForTenant(tenant) {
					calls.push(tenant.organization.id);
				},
			},
		);

		const result = await service.runForTenant(tenantFor(organization));
		expect(calls).toEqual([organization.id]);
		expect(result.checks[0]).toEqual({
			id: "orders_paid_webhook",
			status: "passed",
			message: "Paid-order webhook subscription is registered.",
		});
	});
});
