import { describe, expect, it } from "bun:test";
import { EMPTY_SHOPIFY_CAPABILITIES } from "@festival/common";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { ClassCheckoutService } from "../src/checkout/class-checkout-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { AdminClassCatalogService } from "../src/services/admin-class-catalog.service.js";
import type {
	CreateFestivalClassInput,
	UpdateFestivalClassInput,
} from "../src/services/admin-class-catalog-types.js";
import { AdminClassShopifySync } from "../src/services/admin-class-shopify-sync.js";
import type {
	ShopifyMutationAuditInput,
	ShopifyMutationAuditWriter,
} from "../src/shopify/admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

type AdminCtx = ShopifyAdminOperationContext;

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");
const PROD_GID = "gid://shopify/Product/live-prod-1";
const VAR_GID = "gid://shopify/ProductVariant/live-var-1";
const INV_GID = "gid://shopify/InventoryItem/live-inv-1";

function createKeyring(): ShopifySecretKeyring {
	const ring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!ring) throw new Error("Expected configured keyring.");
	return ring;
}

function fakeProduct(
	name: string,
	price = "0.00",
	vId = VAR_GID,
): ShopifyProductDetails {
	const id = vId.startsWith("gid://")
		? vId
		: `gid://shopify/ProductVariant/${vId}`;
	return {
		id: PROD_GID,
		title: name,
		status: "ACTIVE",
		variants: [
			{
				id,
				title: "Default",
				price: { amount: price, currencyCode: "USD" },
				productId: PROD_GID,
				selectedOptions: [],
				inventoryItemId: INV_GID,
			},
		],
	};
}

class FakeShopifyProductClient implements ShopifyMembershipProductClient {
	createCalls = 0;
	readonly publishedProductGids: string[] = [];
	readonly deletedProductGids: string[] = [];
	readonly variantUpdates: Array<{
		productId: string;
		variantId: string;
		price: string;
	}> = [];
	readonly inventoryItemUpdates: Array<{
		inventoryItemId: string;
		requiresShipping: boolean;
	}> = [];
	readonly productUpdates: Array<{
		productId: string;
		status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		name?: string;
	}> = [];
	inventoryUpdateError: Error | null = null;

	async createProduct(_ctx: AdminCtx, input: { name: string }) {
		this.createCalls += 1;
		return { value: fakeProduct(input.name) };
	}

	async updateVariantPrice(
		_ctx: AdminCtx,
		input: { productId: string; variantId: string; price: string },
	) {
		this.variantUpdates.push(input);
		return { value: fakeProduct("P", input.price, input.variantId) };
	}

	async updateInventoryItem(
		_ctx: AdminCtx,
		input: { inventoryItemId: string; requiresShipping: boolean },
	) {
		this.inventoryItemUpdates.push(input);
		if (this.inventoryUpdateError) throw this.inventoryUpdateError;
		return { value: { requiresShipping: input.requiresShipping } };
	}

	async publishProductToHeadlessStorefront(_ctx: AdminCtx, productId: string) {
		this.publishedProductGids.push(productId);
		return { value: undefined };
	}

	async updateProductDetails(
		_ctx: AdminCtx,
		input: {
			productId: string;
			name?: string;
			status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		},
	) {
		this.productUpdates.push({
			productId: input.productId,
			status: input.status,
			name: input.name,
		});
		return {
			value: {
				id: input.productId,
				title: "P",
				status: input.status ?? "ACTIVE",
				variants: [],
			},
		};
	}

	async deleteProduct(_ctx: AdminCtx, productGid: string) {
		this.deletedProductGids.push(productGid);
		return { value: undefined };
	}

	async readProductsByGid() {
		return { value: [] };
	}
}

class FakeAuditWriter implements ShopifyMutationAuditWriter {
	readonly records: ShopifyMutationAuditInput[] = [];
	async ensureReady(): Promise<void> {}
	async append(input: ShopifyMutationAuditInput): Promise<void> {
		this.records.push(input);
	}
}

async function setupVerifiedIntegration(
	repo: InMemoryOrganizationRepository,
	orgId: string,
	keyring: ShopifySecretKeyring,
) {
	const encryptedClientSecret = keyring.encrypt("test-secret", {
		organizationId: orgId,
		purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
	});
	await repo.upsertShopifyIntegration({
		organizationId: orgId,
		storeDomain: "test-shop.myshopify.com",
		clientId: "test-client-id",
		encryptedClientSecret,
	});
	await repo.updateShopifyVerification({
		organizationId: orgId,
		verificationStatus: "ok",
		verifiedAtIso: new Date().toISOString(),
		lastTestedAtIso: new Date().toISOString(),
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "test-shop.myshopify.com",
		grantedScopes: ["write_products", "write_inventory"],
		capabilities: {
			...EMPTY_SHOPIFY_CAPABILITIES,
			write_products: "granted",
			write_inventory: "granted",
		},
	});
}

async function setupFixture(live = false) {
	const repo = new InMemoryOrganizationRepository();
	const org = await repo.createOrganization({
		name: "PNW Org",
		slug: "pnw-festival",
	});
	const festival = await repo.createFestival({
		id: "fest-2026",
		organizationId: org.id,
		code: "PNW2026",
		shortName: "pnw2026",
		name: "PNW Festival 2026",
		startDate: "2026-11-01",
		endDate: "2026-11-10",
	});
	await repo.setPrimaryFestival(org.id, festival.id);

	const div = await repo.createDivision({
		organizationId: org.id,
		displayName: "Junior Piano",
		normalizedName: "junior piano",
	});
	const sub = await repo.createRegistrationCatalogValue({
		organizationId: org.id,
		kind: "class_subtype",
		displayName: "Solo",
		normalizedName: "solo",
	});

	const keyring = createKeyring();
	const shopifyClient = new FakeShopifyProductClient();
	const auditWriter = new FakeAuditWriter();
	if (live) await setupVerifiedIntegration(repo, org.id, keyring);

	const sync = new AdminClassShopifySync(
		repo,
		keyring,
		shopifyClient,
		auditWriter,
	);
	const service = new AdminClassCatalogService(repo, sync);

	const input = (
		overrides: Partial<CreateFestivalClassInput> = {},
	): CreateFestivalClassInput => ({
		displayName: "Solo Piano 1",
		divisionId: div.id,
		classSubtypeId: sub.id,
		minimumAge: 6,
		maximumAge: 12,
		price: "30.00",
		performanceMinutes: 10,
		maximumPerformancePieces: 1,
		capacity: 25,
		isActive: true,
		...overrides,
	});

	return {
		repo,
		org,
		festival,
		keyring,
		shopifyClient,
		auditWriter,
		service,
		input,
		createValid: (o?: Partial<CreateFestivalClassInput>) =>
			service.createClass(org.slug, festival.shortName, input(o)),
		update: (id: string, raw: UpdateFestivalClassInput) =>
			service.updateClass(org.slug, festival.shortName, id, raw),
		deactivate: (id: string) =>
			service.deactivateClass(org.slug, festival.shortName, id),
		reactivate: (id: string) =>
			service.reactivateClass(org.slug, festival.shortName, id),
		getSaved: async (id: string) =>
			(
				await repo.listFestivalClassConfigurations(org.id, festival.id, false)
			).find((c) => c.id === id),
	};
}

async function setupCheckout(
	repo: InMemoryOrganizationRepository,
	orgId: string,
	classId: string,
) {
	const customers = new InMemoryCustomerAccountRepository();
	const now = new Date("2026-09-21T12:00:00.000Z");
	const iso = now.toISOString();
	const { customer, session } = await customers.createCustomerSession({
		sessionId: "session-1",
		organizationId: orgId,
		shopifyCustomerGid: "gid://shopify/Customer/999",
		encryptedTokens: "token-test",
		csrfToken: "csrf-test",
		integrationVersion: 1,
		createdAtIso: iso,
		lastSeenAtIso: iso,
		expiresAtIso: new Date(now.getTime() + 8 * 3600_000).toISOString(),
	});
	const child = await customers.createChild({
		organizationId: orgId,
		parentCustomerId: customer.id,
		displayName: "Alice Smith",
	});
	await customers.createChildAgeSnapshot({
		organizationId: orgId,
		childId: child.id,
		age: 10,
		validUntilIso: new Date(now.getTime() + 90 * 24 * 3600_000).toISOString(),
		createdAtIso: iso,
	});

	const checkoutService = new ClassCheckoutService(
		repo,
		customers,
		new InMemoryCheckoutRepository(),
		{
			createCart: async () => ({ shopifyCartId: "gid://shopify/Cart/1" }),
			checkout: async () => ({
				checkoutUrl: "https://test.myshopify.com/checkouts/1",
			}),
		},
		undefined,
		() => now,
	);

	return checkoutService.start({
		organizationId: orgId,
		customerId: customer.id,
		sessionId: session.sessionId,
		idempotencyKey: "11111111-2222-3333-4444-555555555555",
		festivalClassId: classId,
		childId: child.id,
		buyerAccessToken: "buyer-token",
		teacherId: "teacher-customer-1",
		pieces: [{ title: "Piece 1", composer: "Bach", durationSeconds: 120 }],
	});
}

describe("Dev Environment Resilience (Mock Mode)", () => {
	it("createClass succeeds and generates mock GIDs without Shopify integration", async () => {
		const { createValid, shopifyClient, auditWriter } = await setupFixture();
		const created = await createValid();
		expect(created.shopifyProductGid).toMatch(
			/^gid:\/\/shopify\/Product\/mock-/,
		);
		expect(created.shopifyVariantGid).toMatch(
			/^gid:\/\/shopify\/ProductVariant\/mock-/,
		);
		expect(shopifyClient.createCalls).toBe(0);
		expect(auditWriter.records.length).toBe(0);
	});

	it("updateClass with price update updates repository without calling Shopify API", async () => {
		const { createValid, update, getSaved, shopifyClient } =
			await setupFixture();
		const created = await createValid({ price: "30.00" });
		const updated = await update(created.id, { price: "45.00" });
		expect(updated.price).toBe("45.00");
		expect(shopifyClient.variantUpdates.length).toBe(0);
		expect((await getSaved(created.id))?.price).toBe("45.00");
	});

	it("deactivateClass and reactivateClass update isActive without calling Shopify API", async () => {
		const { createValid, deactivate, reactivate, getSaved, shopifyClient } =
			await setupFixture();
		const created = await createValid();
		const deactivated = await deactivate(created.id);
		expect(deactivated.isActive).toBe(false);
		expect(shopifyClient.productUpdates.length).toBe(0);
		expect((await getSaved(created.id))?.isActive).toBe(false);

		const reactivated = await reactivate(created.id);
		expect(reactivated.isActive).toBe(true);
		expect(shopifyClient.productUpdates.length).toBe(0);
		expect((await getSaved(created.id))?.isActive).toBe(true);
	});
});

describe("Live Shopify Lifecycle Sync", () => {
	it("createClass creates digital product, propagates price, publishes, audits, and saves GIDs", async () => {
		const { createValid, getSaved, shopifyClient, auditWriter } =
			await setupFixture(true);
		const created = await createValid({ price: "35.00" });

		expect(shopifyClient.createCalls).toBe(1);
		expect(shopifyClient.inventoryItemUpdates).toEqual([
			{ inventoryItemId: INV_GID, requiresShipping: false },
		]);
		expect(shopifyClient.variantUpdates).toEqual([
			{ productId: PROD_GID, variantId: VAR_GID, price: "35.00" },
		]);
		expect(shopifyClient.publishedProductGids).toEqual([PROD_GID]);
		expect(auditWriter.records.map((r) => r.operation)).toEqual([
			"productCreate",
			"productVariantUpdate",
			"inventoryItemUpdate",
			"productPublish",
		]);
		expect(auditWriter.records.every((r) => r.result === "success")).toBe(true);
		expect(created.shopifyProductGid).toBe(PROD_GID);
		expect(created.shopifyVariantGid).toBe(VAR_GID);
		const saved = await getSaved(created.id);
		expect(saved?.shopifyProductGid).toBe(PROD_GID);
		expect(saved?.shopifyVariantGid).toBe(VAR_GID);
	});

	it("updateClass propagates price update to Shopify and audits productVariantUpdate", async () => {
		const { createValid, update, getSaved, shopifyClient, auditWriter } =
			await setupFixture(true);
		const created = await createValid({ price: "30.00" });
		const updated = await update(created.id, { price: "45.00" });

		expect(updated.price).toBe("45.00");
		expect(shopifyClient.variantUpdates.at(-1)).toEqual({
			productId: PROD_GID,
			variantId: VAR_GID,
			price: "45.00",
		});
		expect(auditWriter.records.at(-1)?.operation).toBe("productVariantUpdate");
		expect(auditWriter.records.at(-1)?.result).toBe("success");
		expect((await getSaved(created.id))?.price).toBe("45.00");
	});

	it("deactivates and reactivates class syncing ARCHIVED and ACTIVE status to Shopify", async () => {
		const {
			createValid,
			deactivate,
			reactivate,
			getSaved,
			shopifyClient,
			auditWriter,
		} = await setupFixture(true);
		const created = await createValid();

		const deactivated = await deactivate(created.id);
		expect(deactivated.isActive).toBe(false);
		expect(shopifyClient.productUpdates.at(-1)).toEqual({
			productId: PROD_GID,
			status: "ARCHIVED",
			name: undefined,
		});
		expect(auditWriter.records.at(-1)?.operation).toBe("productUpdate");
		expect(auditWriter.records.at(-1)?.result).toBe("success");
		expect((await getSaved(created.id))?.isActive).toBe(false);

		const reactivated = await reactivate(created.id);
		expect(reactivated.isActive).toBe(true);
		expect(shopifyClient.productUpdates.at(-1)).toEqual({
			productId: PROD_GID,
			status: "ACTIVE",
			name: undefined,
		});
		expect(auditWriter.records.at(-1)?.operation).toBe("productUpdate");
		expect(auditWriter.records.at(-1)?.result).toBe("success");
		expect((await getSaved(created.id))?.isActive).toBe(true);
	});

	it("rolls back Shopify product creation on downstream inventory update failure", async () => {
		const { createValid, repo, org, festival, shopifyClient, auditWriter } =
			await setupFixture(true);
		shopifyClient.inventoryUpdateError = new Error("Inventory service failure");

		await expect(createValid()).rejects.toMatchObject({
			status: 502,
			message: "Inventory service failure",
		});
		expect(shopifyClient.deletedProductGids).toContain(PROD_GID);
		const deleteAudit = auditWriter.records.find(
			(r) => r.operation === "productDelete",
		);
		expect(deleteAudit).toBeDefined();
		expect(deleteAudit?.result).toBe("success");
		const list = await repo.listFestivalClassConfigurations(
			org.id,
			festival.id,
			false,
		);
		expect(list.length).toBe(0);
	});
});

describe("Validation & Invariants", () => {
	it("rejects negative minimum age and maximumAge < minimumAge with 400", async () => {
		const { createValid } = await setupFixture();
		await expect(createValid({ minimumAge: -1 })).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			createValid({ minimumAge: 12, maximumAge: 8 }),
		).rejects.toMatchObject({
			status: 400,
			message: "Maximum age must be greater than or equal to minimum age.",
		});
	});

	it("rejects invalid price format with 400", async () => {
		const { createValid } = await setupFixture();
		await expect(createValid({ price: "free" })).rejects.toMatchObject({
			status: 400,
			message: "Price is invalid.",
		});
		await expect(createValid({ price: "-10" })).rejects.toMatchObject({
			status: 400,
			message: "Price is invalid.",
		});
	});

	it("rejects non-existent division or subtype with 404", async () => {
		const { createValid } = await setupFixture();
		await expect(
			createValid({ divisionId: "non-existent-div" }),
		).rejects.toMatchObject({
			status: 404,
			message: "Division not found.",
		});
		await expect(
			createValid({ classSubtypeId: "non-existent-sub" }),
		).rejects.toMatchObject({
			status: 404,
			message: "Class subtype not found.",
		});
	});
});

describe("Checkout Blocking", () => {
	it("throws AppError 400 when attempting to checkout an inactive class", async () => {
		const { createValid, deactivate, repo, org } = await setupFixture();
		const created = await createValid();
		await deactivate(created.id);
		await expect(setupCheckout(repo, org.id, created.id)).rejects.toThrow(
			new AppError("Festival class configuration is inactive.", 400),
		);
	});
});
