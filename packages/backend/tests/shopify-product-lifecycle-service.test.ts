import { describe, expect, it } from "bun:test";
import { AppError } from "../src/errors/app-error.js";
import type {
	ShopifyMutationAuditAttemptInput,
	ShopifyMutationAuditInput,
	ShopifyMutationAuditWriter,
} from "../src/shopify/admin-mutation-audit.js";
import { ShopifyIntegrationError } from "../src/shopify/errors.js";
import {
	type DigitalProductCreationInput,
	ShopifyProductLifecycleService,
} from "../src/shopify/shopify-product-lifecycle-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

function createContext(): ShopifyAdminOperationContext {
	return {
		organizationId: "org-1",
		firebaseActorUid: "user-1",
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "test.myshopify.com",
		integrationVersion: 1,
		grantedScopes: ["write_products", "write_publications", "write_inventory"],
		capability: "write_products",
		credentials: {
			organizationId: "org-1",
			storeDomain: "test.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
			integrationVersion: 1,
		},
	};
}

function sampleProduct(
	overrides: Partial<ShopifyProductDetails> = {},
): ShopifyProductDetails {
	const id = overrides.id ?? "gid://shopify/Product/123";
	return {
		id,
		title: "Digital Class",
		description: "Digital class product description",
		status: "ACTIVE",
		variants: [
			{
				id: "gid://shopify/ProductVariant/456",
				title: "Default Title",
				price: { amount: "25.00", currencyCode: "CAD" },
				productId: id,
				selectedOptions: [{ name: "Title", value: "Default Title" }],
				requiresShipping: false,
				inventoryItemId: "gid://shopify/InventoryItem/789",
			},
		],
		...overrides,
	};
}

class FakeAuditWriter implements ShopifyMutationAuditWriter {
	readonly prepared: ShopifyMutationAuditAttemptInput[] = [];
	readonly appended: ShopifyMutationAuditInput[] = [];
	readyError: Error | null = null;
	appendError: Error | null = null;

	async ensureReady(input: ShopifyMutationAuditAttemptInput): Promise<void> {
		if (this.readyError) {
			throw this.readyError;
		}
		this.prepared.push(input);
	}

	async append(input: ShopifyMutationAuditInput): Promise<void> {
		if (this.appendError) {
			throw this.appendError;
		}
		this.appended.push(input);
	}
}

class FakeShopifyProductClient implements ShopifyProductClient {
	readonly createCalls: Array<{ name: string; description?: string }> = [];
	readonly variantPriceUpdates: Array<{
		productId: string;
		variantId: string;
		price: string;
	}> = [];
	readonly inventoryItemUpdates: Array<{
		inventoryItemId: string;
		requiresShipping: boolean;
	}> = [];
	readonly publishedProductIds: string[] = [];
	readonly productDetailsUpdates: Array<{
		productId: string;
		name?: string;
		description?: string;
		status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
	}> = [];
	readonly deletedProductIds: string[] = [];

	createResponse = sampleProduct();
	updatePriceResponse = sampleProduct();
	updateDetailsResponse = sampleProduct();

	createError: Error | null = null;
	updatePriceError: Error | null = null;
	updateInventoryError: Error | null = null;
	publishError: Error | null = null;
	updateDetailsError: Error | null = null;
	deleteError: Error | null = null;

	async createProduct(
		_context: ShopifyAdminOperationContext,
		input: { name: string; description?: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.createCalls.push(input);
		if (this.createError) throw this.createError;
		return { value: this.createResponse, requestId: "req-create" };
	}

	async updateVariantPrice(
		_context: ShopifyAdminOperationContext,
		input: { productId: string; variantId: string; price: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.variantPriceUpdates.push(input);
		if (this.updatePriceError) throw this.updatePriceError;
		return { value: this.updatePriceResponse, requestId: "req-price" };
	}

	async updateInventoryItem(
		_context: ShopifyAdminOperationContext,
		input: { inventoryItemId: string; requiresShipping: boolean },
	): Promise<ShopifyAdminResult<{ requiresShipping: boolean }>> {
		this.inventoryItemUpdates.push(input);
		if (this.updateInventoryError) throw this.updateInventoryError;
		return { value: { requiresShipping: input.requiresShipping } };
	}

	async publishProductToHeadlessStorefront(
		_context: ShopifyAdminOperationContext,
		productId: string,
	): Promise<ShopifyAdminResult<void>> {
		this.publishedProductIds.push(productId);
		if (this.publishError) throw this.publishError;
		return { value: undefined, requestId: "req-publish" };
	}

	async updateProductDetails(
		_context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			name?: string;
			description?: string;
			status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.productDetailsUpdates.push(input);
		if (this.updateDetailsError) throw this.updateDetailsError;
		return { value: this.updateDetailsResponse, requestId: "req-details" };
	}

	async readProductsByGid(): Promise<
		ShopifyAdminResult<ShopifyProductDetails[]>
	> {
		return { value: [] };
	}

	async deleteProduct(
		_context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.deletedProductIds.push(productGid);
		if (this.deleteError) throw this.deleteError;
		return { value: undefined, requestId: "req-delete" };
	}
}

describe("ShopifyProductLifecycleService", () => {
	it("creates and publishes a digital product through 5 steps with audit logging", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		const input: DigitalProductCreationInput = {
			name: "Digital Masterclass",
			description: "Full masterclass access",
			price: "50.00",
		};

		const result = await service.createAndPublishDigitalProduct(context, input);

		expect(result).toEqual({
			productGid: "gid://shopify/Product/123",
			variantGid: "gid://shopify/ProductVariant/456",
		});

		expect(client.createCalls).toHaveLength(1);
		expect(client.createCalls[0]).toEqual({
			name: "Digital Masterclass",
			description: "Full masterclass access",
		});

		expect(client.variantPriceUpdates).toHaveLength(1);
		expect(client.variantPriceUpdates[0]).toEqual({
			productId: "gid://shopify/Product/123",
			variantId: "gid://shopify/ProductVariant/456",
			price: "50.00",
		});

		expect(client.inventoryItemUpdates).toHaveLength(1);
		expect(client.inventoryItemUpdates[0]).toEqual({
			inventoryItemId: "gid://shopify/InventoryItem/789",
			requiresShipping: false,
		});

		expect(client.publishedProductIds).toEqual(["gid://shopify/Product/123"]);

		expect(audit.appended.map((record) => record.operation)).toEqual([
			"productCreate",
			"productVariantUpdate",
			"inventoryItemUpdate",
			"productPublish",
		]);
		expect(audit.appended.every((record) => record.result === "success")).toBe(
			true,
		);
	});

	it("cleans up product and rethrows if variant is missing from created product", async () => {
		const client = new FakeShopifyProductClient();
		client.createResponse = sampleProduct({ variants: [] });
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "No Variant Product",
				price: "10.00",
			}),
		).rejects.toThrow(AppError);

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/123"]);
		expect(
			audit.appended.some((record) => record.operation === "productDelete"),
		).toBe(true);
	});

	it("cleans up product and rethrows if variant update fails", async () => {
		const client = new FakeShopifyProductClient();
		client.updatePriceError = new ShopifyIntegrationError(
			"Price update failed",
			"upstream",
			{ requestId: "req-err-price" },
		);
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "Broken Price Product",
				price: "20.00",
			}),
		).rejects.toThrow(ShopifyIntegrationError);

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/123"]);
		expect(
			audit.appended.find(
				(r) => r.operation === "productVariantUpdate" && r.result === "failure",
			)?.failureCategory,
		).toBe("upstream");
	});

	it("cleans up product and rethrows if variant has no inventoryItemId", async () => {
		const client = new FakeShopifyProductClient();
		client.createResponse = sampleProduct({
			variants: [
				{
					id: "gid://shopify/ProductVariant/456",
					title: "Default Title",
					price: { amount: "25.00", currencyCode: "CAD" },
					productId: "gid://shopify/Product/123",
					selectedOptions: [],
					inventoryItemId: undefined,
				},
			],
		});
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "No Inventory ID",
				price: "20.00",
			}),
		).rejects.toThrow(AppError);

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/123"]);
	});

	it("cleans up product and rethrows if inventory update fails", async () => {
		const client = new FakeShopifyProductClient();
		client.updateInventoryError = new ShopifyIntegrationError(
			"Inventory error",
			"upstream",
		);
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "Inventory Broken",
				price: "20.00",
			}),
		).rejects.toThrow(ShopifyIntegrationError);

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/123"]);
	});

	it("cleans up product and rethrows if publishing fails", async () => {
		const client = new FakeShopifyProductClient();
		client.publishError = new ShopifyIntegrationError(
			"Publish error",
			"upstream",
		);
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "Publish Broken",
				price: "20.00",
			}),
		).rejects.toThrow(ShopifyIntegrationError);

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/123"]);
	});

	it("does not call cleanup if initial product creation fails", async () => {
		const client = new FakeShopifyProductClient();
		client.createError = new ShopifyIntegrationError(
			"Create failed",
			"upstream",
		);
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.createAndPublishDigitalProduct(context, {
				name: "Create Broken",
				price: "20.00",
			}),
		).rejects.toThrow(ShopifyIntegrationError);

		expect(client.deletedProductIds).toHaveLength(0);
	});

	it("updates variant price and audits as productVariantUpdate", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await service.updateVariantPrice(context, {
			productId: "gid://shopify/Product/1",
			variantId: "gid://shopify/ProductVariant/2",
			price: "99.00",
		});

		expect(client.variantPriceUpdates).toEqual([
			{
				productId: "gid://shopify/Product/1",
				variantId: "gid://shopify/ProductVariant/2",
				price: "99.00",
			},
		]);
		expect(audit.appended).toHaveLength(1);
		expect(audit.appended[0].operation).toBe("productVariantUpdate");
		expect(audit.appended[0].result).toBe("success");
	});

	it("updates product status and audits as productUpdate", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await service.updateProductStatus(context, {
			productId: "gid://shopify/Product/1",
			status: "ARCHIVED",
		});

		expect(client.productDetailsUpdates).toEqual([
			{
				productId: "gid://shopify/Product/1",
				status: "ARCHIVED",
			},
		]);
		expect(audit.appended[0].operation).toBe("productUpdate");
	});

	it("updates product details and audits as productUpdate", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await service.updateProductDetails(context, {
			productId: "gid://shopify/Product/1",
			name: "New Name",
			description: "New Desc",
			status: "ACTIVE",
		});

		expect(client.productDetailsUpdates).toEqual([
			{
				productId: "gid://shopify/Product/1",
				name: "New Name",
				description: "New Desc",
				status: "ACTIVE",
			},
		]);
		expect(audit.appended[0].operation).toBe("productUpdate");
	});

	it("publishes product and audits as productPublish", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await service.publishProduct(context, "gid://shopify/Product/999");

		expect(client.publishedProductIds).toEqual(["gid://shopify/Product/999"]);
		expect(audit.appended[0].operation).toBe("productPublish");
	});

	it("deletes product and audits as productDelete", async () => {
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await service.deleteProduct(context, "gid://shopify/Product/999");

		expect(client.deletedProductIds).toEqual(["gid://shopify/Product/999"]);
		expect(audit.appended[0].operation).toBe("productDelete");
	});

	it("tryCleanupProduct swallows errors quietly as best-effort", async () => {
		const client = new FakeShopifyProductClient();
		client.deleteError = new Error("Shopify unreachable");
		const audit = new FakeAuditWriter();
		const service = new ShopifyProductLifecycleService(client, audit);
		const context = createContext();

		await expect(
			service.tryCleanupProduct(context, "gid://shopify/Product/999"),
		).resolves.toBeUndefined();
	});
});
