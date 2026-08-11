import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type {
	CreateMembershipProductRecordInput,
	ProductRecord,
} from "../src/repo/organization-repository.js";
import { AesSecretEncryptor } from "../src/shopify/encryption.js";
import { ShopifyUserError } from "../src/shopify/errors.js";
import { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";
import type {
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 8).toString("base64");

function membershipInput() {
	return {
		name: "Teacher Membership",
		description: "Annual membership for teachers.",
		price: "75.00",
		membershipType: "teacher",
		entitlementPeriod: "1_year",
	};
}

function shopifyProduct(
	overrides: Partial<ShopifyProductDetails> = {},
): ShopifyProductDetails {
	const id = overrides.id ?? "gid://shopify/Product/not-a-number";

	return {
		id,
		title: "Teacher Membership",
		description: "Annual membership for teachers.",
		status: "ACTIVE",
		variants: [
			{
				id: "gid://shopify/ProductVariant/not-a-number-either",
				title: "Standard",
				price: {
					amount: "75.00",
					currencyCode: "USD",
				},
				productId: id,
				selectedOptions: [{ name: "Plan", value: "Standard" }],
			},
		],
		...overrides,
	};
}

class FakeShopifyProductClient implements ShopifyMembershipProductClient {
	readonly deletedProductGids: string[] = [];
	readonly readProductGids: string[][] = [];
	createResponse = shopifyProduct();
	updateResponse = shopifyProduct();
	readResponse = [shopifyProduct()];
	createError: Error | null = null;
	deleteError: Error | null = null;

	async createProduct(
		_credentials: ShopifyCredentials,
	): Promise<ShopifyProductDetails> {
		if (this.createError) {
			throw this.createError;
		}

		return this.createResponse;
	}

	async updateVariantPrice(
		_credentials: ShopifyCredentials,
	): Promise<ShopifyProductDetails> {
		return this.updateResponse;
	}

	async readProductsByGid(
		_credentials: ShopifyCredentials,
		productGids: string[],
	): Promise<ShopifyProductDetails[]> {
		this.readProductGids.push(productGids);
		return this.readResponse;
	}

	async deleteProduct(
		_credentials: ShopifyCredentials,
		productGid: string,
	): Promise<void> {
		this.deletedProductGids.push(productGid);
		if (this.deleteError) {
			throw this.deleteError;
		}
	}
}

class FakeCleanupFailureLogger {
	readonly errors: Array<{
		message: string;
		context: {
			operation: "shopify.membershipProduct.cleanup";
			shopifyProductGid: string;
			errorName?: string;
			errorMessage?: string;
		};
	}> = [];

	error(
		message: string,
		context: {
			operation: "shopify.membershipProduct.cleanup";
			shopifyProductGid: string;
			errorName?: string;
			errorMessage?: string;
		},
	): void {
		this.errors.push({ message, context });
	}
}

class FailingProductRepository extends InMemoryOrganizationRepository {
	async createMembershipProductRecord(
		_input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		throw new Error("database unavailable");
	}
}

async function createOrganization(repository: InMemoryOrganizationRepository) {
	return repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
}

async function saveIntegration(
	repository: InMemoryOrganizationRepository,
	organization: OrganizationRecord,
	status: "ok" | "failed" = "ok",
) {
	const encryptor = new AesSecretEncryptor(TEST_KEY);
	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "example.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: encryptor.encrypt("client-secret"),
	});
	await repository.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: status,
		verifiedAtIso: status === "ok" ? new Date().toISOString() : undefined,
		lastTestedAtIso: new Date().toISOString(),
		lastError: status === "failed" ? "Invalid credentials." : undefined,
	});

	return encryptor;
}

describe("ShopifyMembershipProductService", () => {
	it("creates a Shopify product, updates the single variant price, and stores opaque GIDs", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
		);

		const created = await service.createMembershipProduct(
			organization,
			membershipInput(),
		);

		expect(created.shopifyProductGid).toBe(
			"gid://shopify/Product/not-a-number",
		);
		expect(created.shopifyVariantGid).toBe(
			"gid://shopify/ProductVariant/not-a-number-either",
		);
		expect(created.variantName).toBe("Standard");
		expect(created.price).toEqual({ amount: "75.00", currencyCode: "USD" });
		await expect(
			repository.listMembershipProductRecords(organization.id),
		).resolves.toHaveLength(1);
	});

	it("lists current Shopify data for local membership product records", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			membershipType: "teacher",
			entitlementPeriod: "1_year",
			shopifyProductGid: "gid://shopify/Product/not-a-number",
			shopifyVariantGid: "gid://shopify/ProductVariant/not-a-number-either",
			productNameSnapshot: "Old Snapshot",
		});
		const client = new FakeShopifyProductClient();
		client.readResponse = [
			shopifyProduct({
				title: "Current Shopify Title",
				description: "Current Shopify description.",
			}),
		];
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
		);

		const products =
			await service.listMembershipProductsForOrganization(organization);

		expect(client.readProductGids).toEqual([
			["gid://shopify/Product/not-a-number"],
		]);
		expect(products[0]?.name).toBe("Current Shopify Title");
		expect(products[0]?.description).toBe("Current Shopify description.");
	});

	it("rejects missing and unverified Shopify integrations", async () => {
		const missingRepository = new InMemoryOrganizationRepository();
		const missingOrganization = await createOrganization(missingRepository);
		const encryptor = new AesSecretEncryptor(TEST_KEY);
		const missingService = new ShopifyMembershipProductService(
			missingRepository,
			encryptor,
			new FakeShopifyProductClient(),
		);

		await expect(
			missingService.createMembershipProduct(
				missingOrganization,
				membershipInput(),
			),
		).rejects.toThrow("Shopify integration is not configured.");

		const failedRepository = new InMemoryOrganizationRepository();
		const failedOrganization = await createOrganization(failedRepository);
		const failedEncryptor = await saveIntegration(
			failedRepository,
			failedOrganization,
			"failed",
		);
		const failedService = new ShopifyMembershipProductService(
			failedRepository,
			failedEncryptor,
			new FakeShopifyProductClient(),
		);

		await expect(
			failedService.createMembershipProduct(
				failedOrganization,
				membershipInput(),
			),
		).rejects.toThrow("Shopify integration has not been verified.");
	});

	it("translates Shopify user errors into application errors", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		client.createError = new ShopifyUserError("Title has already been taken.");
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
		);

		try {
			await service.createMembershipProduct(organization, membershipInput());
			throw new Error("Expected service to reject.");
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).status).toBe(502);
			expect((error as Error).message).toBe("Title has already been taken.");
		}
	});

	it("rejects unsupported product variant shapes", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
		);

		client.createResponse = shopifyProduct({ variants: [] });
		await expect(
			service.createMembershipProduct(organization, membershipInput()),
		).rejects.toThrow("exactly one variant");

		client.createResponse = shopifyProduct({
			variants: [
				shopifyProduct().variants[0],
				{
					...shopifyProduct().variants[0],
					id: "gid://shopify/ProductVariant/second",
				},
			],
		});
		await expect(
			service.createMembershipProduct(organization, membershipInput()),
		).rejects.toThrow("exactly one variant");

		client.createResponse = shopifyProduct({
			variants: [
				{
					...shopifyProduct().variants[0],
					selectedOptions: [{ name: "Plan", value: "Premium" }],
				},
			],
		});
		await expect(
			service.createMembershipProduct(organization, membershipInput()),
		).rejects.toThrow("Plan = Standard");
	});

	it("cleans up the Shopify product when local persistence fails", async () => {
		const repository = new FailingProductRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
		);

		await expect(
			service.createMembershipProduct(organization, membershipInput()),
		).rejects.toThrow("database unavailable");
		expect(client.deletedProductGids).toEqual([
			"gid://shopify/Product/not-a-number",
		]);
	});

	it("logs the Shopify Product GID when cleanup fails", async () => {
		const repository = new FailingProductRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		client.deleteError = new Error("cleanup unavailable");
		const logger = new FakeCleanupFailureLogger();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			logger,
		);

		await expect(
			service.createMembershipProduct(organization, membershipInput()),
		).rejects.toThrow("database unavailable");
		expect(logger.errors).toEqual([
			{
				message:
					"Shopify membership product cleanup failed after local persistence failure.",
				context: {
					operation: "shopify.membershipProduct.cleanup",
					shopifyProductGid: "gid://shopify/Product/not-a-number",
					errorName: "Error",
					errorMessage: "cleanup unavailable",
				},
			},
		]);
	});
});
