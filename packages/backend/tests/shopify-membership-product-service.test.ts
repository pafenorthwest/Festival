import { describe, expect, it } from "bun:test";
import type { OrganizationRecord } from "@festival/common";
import type { TenantContext } from "../src/auth/tenant-context.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type {
	CreateMembershipProductRecordInput,
	ProductRecord,
} from "../src/repo/organization-repository.js";
import type {
	ShopifyMutationAuditInput,
	ShopifyMutationAuditWriter,
} from "../src/shopify/admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { ShopifyUserError } from "../src/shopify/errors.js";
import { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 8).toString("base64");

function createKeyring() {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!keyring) throw new Error("Expected configured keyring.");
	return keyring;
}

function membershipInput() {
	return {
		name: "Teacher Membership",
		description: "Annual membership for teachers.",
		price: "75.00",
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
	createCalls = 0;
	readonly deletedProductGids: string[] = [];
	readonly readProductGids: string[][] = [];
	createResponse = shopifyProduct();
	updateResponse = shopifyProduct();
	readResponse = [shopifyProduct()];
	createError: Error | null = null;
	deleteError: Error | null = null;

	async createProduct(
		_context: ShopifyAdminOperationContext,
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.createCalls += 1;
		if (this.createError) {
			throw this.createError;
		}

		return { value: this.createResponse, requestId: "request-create" };
	}

	async updateVariantPrice(
		_context: ShopifyAdminOperationContext,
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return { value: this.updateResponse, requestId: "request-update" };
	}

	async readProductsByGid(
		_context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.readProductGids.push(productGids);
		return { value: this.readResponse, requestId: "request-read" };
	}

	async deleteProduct(
		_context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.deletedProductGids.push(productGid);
		if (this.deleteError) {
			throw this.deleteError;
		}
		return { value: undefined, requestId: "request-delete" };
	}
}

class FakeAuditWriter implements ShopifyMutationAuditWriter {
	readonly records: ShopifyMutationAuditInput[] = [];
	readyCalls = 0;

	async ensureReady(): Promise<void> {
		this.readyCalls += 1;
	}

	async append(input: ShopifyMutationAuditInput): Promise<void> {
		this.records.push(input);
	}
}

class UnavailableAuditWriter implements ShopifyMutationAuditWriter {
	async ensureReady(): Promise<void> {
		throw new Error("audit destination unavailable");
	}
	async append(): Promise<void> {
		throw new Error("audit destination unavailable");
	}
}

class FakeCleanupFailureLogger {
	readonly errors: Array<{
		message: string;
		context: {
			operation: "shopify.membershipProduct.cleanup";
			errorName?: string;
		};
	}> = [];

	error(
		message: string,
		context: {
			operation: "shopify.membershipProduct.cleanup";
			errorName?: string;
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

function tenantFor(organization: OrganizationRecord): TenantContext {
	return {
		identity: {
			uid: "firebase-admin-uid",
			email: "admin@example.com",
			displayName: "Admin User",
		},
		user: {
			id: "user-1",
			firebaseUid: "firebase-admin-uid",
			email: "admin@example.com",
			displayName: "Admin User",
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

async function saveIntegration(
	repository: InMemoryOrganizationRepository,
	organization: OrganizationRecord,
	status: "ok" | "failed" = "ok",
) {
	const encryptor = createKeyring();
	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "example.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: encryptor.encrypt("client-secret", {
			organizationId: organization.id,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		}),
	});
	if (status === "ok") {
		await repository.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/1",
			verifiedShopDomain: "example.myshopify.com",
			grantedScopes: ["read_products", "write_products", "read_orders"],
			capabilities: {
				read_products: "granted",
				write_products: "granted",
				read_orders: "granted",
				write_orders: "disabled",
			},
		});
	} else {
		await repository.updateShopifyVerification({
			organizationId: organization.id,
			verificationStatus: "failed",
			lastTestedAtIso: new Date().toISOString(),
			lastError: "Invalid credentials.",
		});
	}

	return encryptor;
}

describe("ShopifyMembershipProductService", () => {
	it("creates a Shopify product, updates the single variant price, and stores opaque GIDs", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			audit,
		);

		const created = await service.createMembershipProduct(
			tenantFor(organization),
			membershipInput(),
		);

		expect(created.shopifyProductGid).toBe(
			"gid://shopify/Product/not-a-number",
		);
		expect(created.shopifyVariantGid).toBe(
			"gid://shopify/ProductVariant/not-a-number-either",
		);
		expect(created.variantName).toBe("Standard");
		expect(created.entitlementClass).toBe("teacher_membership");
		expect(created.durationDays).toBe(365);
		expect(created.isActive).toBeTrue();
		expect(created.price).toEqual({ amount: "75.00", currencyCode: "USD" });
		await expect(
			repository.listMembershipProductRecords(organization.id),
		).resolves.toMatchObject([
			{
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
			},
		]);
		expect(audit.readyCalls).toBe(2);
		expect(
			audit.records.map(({ operation, requestId, result }) => ({
				operation,
				requestId,
				result,
			})),
		).toEqual([
			{
				operation: "productCreate",
				requestId: "request-create",
				result: "success",
			},
			{
				operation: "productVariantUpdate",
				requestId: "request-update",
				result: "success",
			},
		]);
	});

	it("lists current Shopify data for local membership product records", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
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
			new FakeAuditWriter(),
		);

		const products = await service.listMembershipProductsForOrganization(
			tenantFor(organization),
		);

		expect(client.readProductGids).toEqual([
			["gid://shopify/Product/not-a-number"],
		]);
		expect(products[0]?.name).toBe("Old Snapshot");
		expect(products[0]?.description).toBe("Current Shopify description.");
		expect(products[0]?.price).toEqual({
			amount: "75.00",
			currencyCode: "USD",
		});
		expect(products[0]?.status).toBe("ACTIVE");
	});

	it("rejects missing and unverified Shopify integrations", async () => {
		const missingRepository = new InMemoryOrganizationRepository();
		const missingOrganization = await createOrganization(missingRepository);
		const encryptor = createKeyring();
		const missingService = new ShopifyMembershipProductService(
			missingRepository,
			encryptor,
			new FakeShopifyProductClient(),
			new FakeAuditWriter(),
		);

		await expect(
			missingService.createMembershipProduct(
				tenantFor(missingOrganization),
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
			new FakeAuditWriter(),
		);

		await expect(
			failedService.createMembershipProduct(
				tenantFor(failedOrganization),
				membershipInput(),
			),
		).rejects.toThrow("Shopify integration has not been verified.");
	});

	it("translates Shopify user errors into application errors", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		client.createError = new ShopifyUserError(
			"Title has already been taken.",
			"request-failed",
		);
		const audit = new FakeAuditWriter();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			audit,
		);

		try {
			await service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			);
			throw new Error("Expected service to reject.");
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).status).toBe(502);
			expect((error as Error).message).toBe(
				"Shopify membership product operation failed.",
			);
		}
		expect(audit.records).toHaveLength(1);
		expect(audit.records[0]).toMatchObject({
			firebaseActorUid: "firebase-admin-uid",
			organizationId: organization.id,
			operation: "productCreate",
			requestId: "request-failed",
			result: "failure",
			failureCategory: "upstream",
		});
	});

	it("rejects unsupported product variant shapes", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			audit,
		);

		client.createResponse = shopifyProduct({ variants: [] });
		await expect(
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
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
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
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
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
		).rejects.toThrow("Plan = Standard");
	});

	it("cleans up the Shopify product when local persistence fails", async () => {
		const repository = new FailingProductRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const audit = new FakeAuditWriter();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			audit,
		);

		await expect(
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
		).rejects.toThrow("Shopify membership product operation failed.");
		expect(client.deletedProductGids).toEqual([
			"gid://shopify/Product/not-a-number",
		]);
		expect(audit.records.map((record) => record.operation)).toEqual([
			"productCreate",
			"productVariantUpdate",
			"productDelete",
		]);
	});

	it("logs only bounded cleanup failure metadata", async () => {
		const repository = new FailingProductRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		client.deleteError = new Error(
			"cleanup unavailable client-secret-canary bearer-canary cookie-canary",
		);
		const logger = new FakeCleanupFailureLogger();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			new FakeAuditWriter(),
			logger,
		);

		await expect(
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
		).rejects.toThrow("Shopify membership product operation failed.");
		expect(logger.errors).toEqual([
			{
				message:
					"Shopify membership product cleanup failed after local persistence failure.",
				context: {
					operation: "shopify.membershipProduct.cleanup",
					errorName: "Error",
				},
			},
		]);
		const capturedLog = JSON.stringify(logger.errors);
		expect(capturedLog).not.toContain("client-secret-canary");
		expect(capturedLog).not.toContain("bearer-canary");
		expect(capturedLog).not.toContain("cookie-canary");
	});

	it("rejects a client-secret envelope copied from another tenant before Shopify", async () => {
		const repository = new InMemoryOrganizationRepository();
		const sourceOrganization = await createOrganization(repository);
		const targetOrganization = await repository.createOrganization({
			name: "Other Festival",
			slug: "other",
		});
		const secretKeyring = createKeyring();
		const copiedEnvelope = secretKeyring.encrypt("client-secret", {
			organizationId: sourceOrganization.id,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		});
		await repository.upsertShopifyIntegration({
			organizationId: targetOrganization.id,
			storeDomain: "other.myshopify.com",
			clientId: "client-id",
			encryptedClientSecret: copiedEnvelope,
		});
		await repository.updateShopifyVerification({
			organizationId: targetOrganization.id,
			verificationStatus: "ok",
			verifiedAtIso: new Date().toISOString(),
			lastTestedAtIso: new Date().toISOString(),
			verifiedShopGid: "gid://shopify/Shop/2",
			verifiedShopDomain: "other.myshopify.com",
			grantedScopes: ["read_products", "write_products"],
			capabilities: {
				read_products: "granted",
				write_products: "granted",
				read_orders: "missing",
				write_orders: "disabled",
			},
		});
		const client = new FakeShopifyProductClient();
		const service = new ShopifyMembershipProductService(
			repository,
			secretKeyring,
			client,
			new FakeAuditWriter(),
		);

		await expect(
			service.createMembershipProduct(
				tenantFor(targetOrganization),
				membershipInput(),
			),
		).rejects.toThrow("Shopify encrypted secret context does not match.");
		expect(client.createCalls).toBe(0);
	});

	it("does not attempt a mutation when the audit destination is unavailable", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const encryptor = await saveIntegration(repository, organization);
		const client = new FakeShopifyProductClient();
		const service = new ShopifyMembershipProductService(
			repository,
			encryptor,
			client,
			new UnavailableAuditWriter(),
		);
		await expect(
			service.createMembershipProduct(
				tenantFor(organization),
				membershipInput(),
			),
		).rejects.toThrow("Shopify membership product operation failed.");
		expect(client.createCalls).toBe(0);
	});
});
