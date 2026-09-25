import { describe, expect, it } from "bun:test";
import {
	EMPTY_SHOPIFY_CAPABILITIES,
	type ShopifyVerificationStatus,
} from "@festival/common";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { AdminClassShopifySync } from "../src/services/admin-class-shopify-sync.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import type { ShopifyProductLifecycleService } from "../src/shopify/shopify-product-lifecycle-service.js";
import type { ShopifyAdminOperationContext } from "../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

function createKeyring(): ShopifySecretKeyring {
	const ring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!ring) throw new Error("Expected configured keyring.");
	return ring;
}

class FakeLifecycleService {
	readonly createCalls: { ctx: unknown; input: unknown }[] = [];
	readonly updatePriceCalls: { ctx: unknown; input: unknown }[] = [];
	readonly updateStatusCalls: { ctx: unknown; input: unknown }[] = [];
	readonly cleanupCalls: { ctx: unknown; productId: string }[] = [];

	createResult = {
		productGid: "gid://shopify/Product/real-100",
		variantGid: "gid://shopify/ProductVariant/real-200",
	};

	async createAndPublishDigitalProduct(
		ctx: unknown,
		input: unknown,
	): Promise<{ productGid: string; variantGid: string }> {
		this.createCalls.push({ ctx, input });
		return this.createResult;
	}

	async updateVariantPrice(ctx: unknown, input: unknown): Promise<void> {
		this.updatePriceCalls.push({ ctx, input });
	}

	async updateProductStatus(ctx: unknown, input: unknown): Promise<void> {
		this.updateStatusCalls.push({ ctx, input });
	}

	async tryCleanupProduct(ctx: unknown, productId: string): Promise<void> {
		this.cleanupCalls.push({ ctx, productId });
	}
}

describe("AdminClassShopifySync", () => {
	const orgId = "org-1";
	const festival = { name: "Music Fest 2026", shortName: "mf2026" };

	async function setupRepoWithIntegration(
		repo: InMemoryOrganizationRepository,
		keyring: ShopifySecretKeyring,
		overrides: {
			verificationStatus?: ShopifyVerificationStatus;
			verifiedShopGid?: string;
			verifiedShopDomain?: string;
			grantedScopes?: string[];
			corruptSecret?: boolean;
		} = {},
	) {
		const encryptedClientSecret = overrides.corruptSecret
			? "corrupt-secret"
			: keyring.encrypt("real-secret", {
					organizationId: orgId,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				});

		await repo.upsertShopifyIntegration({
			organizationId: orgId,
			storeDomain: "test.myshopify.com",
			clientId: "client-1",
			encryptedClientSecret,
		});

		await repo.updateShopifyVerification({
			organizationId: orgId,
			verificationStatus: overrides.verificationStatus ?? "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid:
				overrides.verifiedShopGid !== undefined
					? overrides.verifiedShopGid
					: "gid://shopify/Shop/1",
			verifiedShopDomain:
				overrides.verifiedShopDomain !== undefined
					? overrides.verifiedShopDomain
					: "test.myshopify.com",
			grantedScopes: overrides.grantedScopes ?? [
				"write_products",
				"write_inventory",
				"write_publications",
			],
			capabilities: {
				...EMPTY_SHOPIFY_CAPABILITIES,
				write_products: "granted",
				write_inventory: "granted",
			},
		});
	}

	describe("syncNewClassProduct", () => {
		it("returns mock GIDs when integration is missing and allowMockMode !== false", async () => {
			const repo = new InMemoryOrganizationRepository();
			const sync = new AdminClassShopifySync(repo);

			const result = await sync.syncNewClassProduct(orgId, festival, {
				name: "Piano Solo",
				price: "35.00",
			});

			expect(result.shopifyProductGid).toContain("mock-");
			expect(result.shopifyVariantGid).toContain("mock-");
		});

		it("throws 409 when integration is missing and allowMockMode === false", async () => {
			const repo = new InMemoryOrganizationRepository();
			const sync = new AdminClassShopifySync(repo, undefined, undefined, {
				allowMockMode: false,
			});

			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 409,
				message: "Shopify integration is not configured.",
			});
		});

		it("throws 409 when integration verificationStatus !== 'ok'", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring, {
				verificationStatus: "failed",
			});

			const sync = new AdminClassShopifySync(repo, undefined, keyring);
			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 409,
				message: "Shopify integration has not been verified.",
			});
		});

		it("throws 409 when integration is missing verified domain or GID", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring, {
				verifiedShopGid: "",
			});

			const sync = new AdminClassShopifySync(repo, undefined, keyring);
			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 409,
				message: "Shopify integration has not been verified.",
			});
		});

		it("throws 409 when integration lacks required scopes", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring, {
				grantedScopes: ["write_products"],
			});

			const sync = new AdminClassShopifySync(repo, undefined, keyring);
			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 409,
				message: "Shopify integration lacks required permissions.",
			});
		});

		it("throws 500 when Shopify credentials could not be decrypted", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring, {
				corruptSecret: true,
			});

			const sync = new AdminClassShopifySync(repo, undefined, keyring);
			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 500,
				message: "Shopify credentials could not be decrypted.",
			});
		});

		it("returns mock GIDs when lifecycleService is missing and allowMockMode !== false", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const sync = new AdminClassShopifySync(repo, undefined, keyring);
			const result = await sync.syncNewClassProduct(orgId, festival, {
				name: "Piano Solo",
				price: "35.00",
			});

			expect(result.shopifyProductGid).toContain("mock-");
			expect(result.shopifyVariantGid).toContain("mock-");
		});

		it("throws 500 when lifecycleService is missing and allowMockMode === false", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const sync = new AdminClassShopifySync(repo, undefined, keyring, {
				allowMockMode: false,
			});
			await expect(
				sync.syncNewClassProduct(orgId, festival, {
					name: "Piano Solo",
					price: "35.00",
				}),
			).rejects.toMatchObject({
				status: 500,
				message: "Shopify product lifecycle service is unavailable.",
			});
		});

		it("creates and publishes digital product on happy path", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
				keyring,
			);

			const result = await sync.syncNewClassProduct(
				orgId,
				festival,
				{
					name: "Violin Solo",
					price: "42.00",
					festivalShortName: "mf2026",
				},
				"actor-1",
			);

			expect(result).toEqual({
				shopifyProductGid: "gid://shopify/Product/real-100",
				shopifyVariantGid: "gid://shopify/ProductVariant/real-200",
			});

			expect(fakeLifecycle.createCalls.length).toBe(1);
			expect(fakeLifecycle.createCalls[0].input).toEqual({
				name: "Music Fest 2026 - Violin Solo",
				description: "Music Fest 2026 class: Violin Solo (mf2026)",
				price: "42.00",
			});
		});

		it("uses explicit description when provided", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
				keyring,
			);

			await sync.syncNewClassProduct(orgId, festival, {
				name: "Violin Solo",
				description: "Custom class description",
				price: "42.00",
			});

			expect(fakeLifecycle.createCalls[0].input).toEqual({
				name: "Music Fest 2026 - Violin Solo",
				description: "Custom class description",
				price: "42.00",
			});
		});
	});

	describe("syncClassPriceUpdate", () => {
		const cfg = {
			id: "class-1",
			organizationId: orgId,
			festivalId: "fest-1",
			displayName: "Violin Solo",
			classSubtypeId: "sub-1",
			divisionId: "div-1",
			minimumAge: 5,
			maximumAge: 10,
			price: "30.00",
			maximumPerformancePieces: 1 as const,
			performanceMinutes: 10,
			capacity: 20,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/real-100",
			shopifyVariantGid: "gid://shopify/ProductVariant/real-200",
			createdAtIso: new Date().toISOString(),
			updatedAtIso: new Date().toISOString(),
		};

		it("ignores mock GIDs quietly", async () => {
			const repo = new InMemoryOrganizationRepository();
			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
			);

			await sync.syncClassPriceUpdate(
				orgId,
				{ ...cfg, shopifyProductGid: "gid://shopify/Product/mock-1" },
				"50.00",
			);

			expect(fakeLifecycle.updatePriceCalls.length).toBe(0);
		});

		it("ignores when lifecycleService is absent", async () => {
			const repo = new InMemoryOrganizationRepository();
			const sync = new AdminClassShopifySync(repo);

			await sync.syncClassPriceUpdate(orgId, cfg, "50.00");
		});

		it("updates variant price when configured", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
				keyring,
			);

			await sync.syncClassPriceUpdate(orgId, cfg, "55.00");

			expect(fakeLifecycle.updatePriceCalls.length).toBe(1);
			expect(fakeLifecycle.updatePriceCalls[0].input).toEqual({
				productId: "gid://shopify/Product/real-100",
				variantId: "gid://shopify/ProductVariant/real-200",
				price: "55.00",
			});
		});
	});

	describe("syncClassStatus", () => {
		const cfg = {
			id: "class-1",
			organizationId: orgId,
			festivalId: "fest-1",
			displayName: "Violin Solo",
			classSubtypeId: "sub-1",
			divisionId: "div-1",
			minimumAge: 5,
			maximumAge: 10,
			price: "30.00",
			maximumPerformancePieces: 1 as const,
			performanceMinutes: 10,
			capacity: 20,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/real-100",
			shopifyVariantGid: "gid://shopify/ProductVariant/real-200",
			createdAtIso: new Date().toISOString(),
			updatedAtIso: new Date().toISOString(),
		};

		it("ignores mock GIDs quietly", async () => {
			const repo = new InMemoryOrganizationRepository();
			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
			);

			await sync.syncClassStatus(
				orgId,
				{ ...cfg, shopifyProductGid: "gid://shopify/Product/mock-1" },
				false,
			);

			expect(fakeLifecycle.updateStatusCalls.length).toBe(0);
		});

		it("updates product status to ACTIVE / ARCHIVED", async () => {
			const repo = new InMemoryOrganizationRepository();
			const keyring = createKeyring();
			await setupRepoWithIntegration(repo, keyring);

			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
				keyring,
			);

			await sync.syncClassStatus(orgId, cfg, false);
			expect(fakeLifecycle.updateStatusCalls.length).toBe(1);
			expect(fakeLifecycle.updateStatusCalls[0].input).toEqual({
				productId: "gid://shopify/Product/real-100",
				status: "ARCHIVED",
			});

			await sync.syncClassStatus(orgId, cfg, true);
			expect(fakeLifecycle.updateStatusCalls.length).toBe(2);
			expect(fakeLifecycle.updateStatusCalls[1].input).toEqual({
				productId: "gid://shopify/Product/real-100",
				status: "ACTIVE",
			});
		});
	});

	describe("tryCleanupProduct", () => {
		it("delegates to lifecycleService.tryCleanupProduct", async () => {
			const repo = new InMemoryOrganizationRepository();
			const fakeLifecycle = new FakeLifecycleService();
			const sync = new AdminClassShopifySync(
				repo,
				fakeLifecycle as unknown as ShopifyProductLifecycleService,
			);

			await sync.tryCleanupProduct(
				{} as unknown as ShopifyAdminOperationContext,
				"gid://shopify/Product/clean-1",
			);

			expect(fakeLifecycle.cleanupCalls.length).toBe(1);
			expect(fakeLifecycle.cleanupCalls[0].productId).toBe(
				"gid://shopify/Product/clean-1",
			);
		});
	});
});
