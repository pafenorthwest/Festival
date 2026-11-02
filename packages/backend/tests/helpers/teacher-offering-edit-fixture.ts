import type { OrganizationRecord } from "@festival/common";
import type { TenantContext } from "../../src/auth/tenant-context.js";
import { InMemoryOrganizationRepository } from "../../src/repo/in-memory-organization-repository.js";
import type {
	ProductRecord,
	UpdateMembershipProductRecordInput,
} from "../../src/repo/organization-repository.js";
import type {
	ShopifyMutationAuditInput,
	ShopifyMutationAuditWriter,
} from "../../src/shopify/admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../../src/shopify/encryption.js";
import { ShopifyMembershipProductService } from "../../src/shopify/shopify-membership-product-service.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyProductClient,
	ShopifyProductDetails,
} from "../../src/shopify/types.js";

const TEST_KEY = Buffer.alloc(32, 8).toString("base64");
export const PRODUCT_GID = "gid://shopify/Product/teacher-1";
export const VARIANT_GID = "gid://shopify/ProductVariant/teacher-variant-1";
export const INVENTORY_GID = "gid://shopify/InventoryItem/teacher-inv-1";

export function createKeyring() {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_KEY }),
		"test",
	);
	if (!keyring) throw new Error("Expected configured keyring.");
	return keyring;
}

export function shopifyProduct(
	overrides: Partial<ShopifyProductDetails> = {},
): ShopifyProductDetails {
	const id = overrides.id ?? PRODUCT_GID;
	return {
		id,
		title: "Teacher Membership",
		description: "Annual membership for teachers.",
		status: "ACTIVE",
		variants: [
			{
				id: VARIANT_GID,
				title: "Standard",
				price: { amount: "75.00", currencyCode: "USD" },
				productId: id,
				selectedOptions: [{ name: "Plan", value: "Standard" }],
				requiresShipping: false,
				inventoryItemId: INVENTORY_GID,
			},
		],
		...overrides,
	};
}

export class FakeShopifyProductClient implements ShopifyProductClient {
	readonly productDetailsUpdates: Array<{
		productId: string;
		name?: string;
		description?: string;
		status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
	}> = [];
	readonly variantUpdates: Array<{
		productId: string;
		variantId: string;
		price: string;
	}> = [];
	readonly deletedProductGids: string[] = [];
	readonly readProductGids: string[][] = [];
	currentProduct = shopifyProduct();
	customReadResponse: ShopifyProductDetails[] | null = null;
	updateDetailsError: Error | null = null;

	async createProduct(): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return { value: this.currentProduct, requestId: "request-create" };
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
		this.currentProduct = {
			...this.currentProduct,
			...(input.name !== undefined ? { title: input.name } : {}),
			...(input.description !== undefined
				? { description: input.description }
				: {}),
			...(input.status !== undefined ? { status: input.status } : {}),
		};
		return { value: this.currentProduct, requestId: "request-product-update" };
	}

	async updateVariantPrice(
		_context: ShopifyAdminOperationContext,
		input: { productId: string; variantId: string; price: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.variantUpdates.push(input);
		this.currentProduct = {
			...this.currentProduct,
			variants: this.currentProduct.variants.map((variant) =>
				variant.id === input.variantId
					? {
							...variant,
							price: {
								...variant.price,
								amount: Number(input.price).toFixed(2),
							},
						}
					: variant,
			),
		};
		return { value: this.currentProduct, requestId: "request-variant-update" };
	}

	async updateInventoryItem(): Promise<
		ShopifyAdminResult<{ requiresShipping: boolean }>
	> {
		return { value: { requiresShipping: false }, requestId: "request-inv" };
	}

	async publishProductToHeadlessStorefront(): Promise<
		ShopifyAdminResult<void>
	> {
		return { value: undefined, requestId: "request-publish" };
	}

	async readProductsByGid(
		_context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.readProductGids.push(productGids);
		return {
			value: this.customReadResponse ?? [this.currentProduct],
			requestId: "request-read",
		};
	}

	async deleteProduct(
		_context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.deletedProductGids.push(productGid);
		return { value: undefined, requestId: "request-delete" };
	}
}

export class FakeAuditWriter implements ShopifyMutationAuditWriter {
	readonly records: ShopifyMutationAuditInput[] = [];
	readyCalls = 0;

	async ensureReady(): Promise<void> {
		this.readyCalls += 1;
	}

	async append(input: ShopifyMutationAuditInput): Promise<void> {
		this.records.push(input);
	}
}

export class FailingUpdateProductRepository extends InMemoryOrganizationRepository {
	override async updateMembershipProductRecord(
		_input: UpdateMembershipProductRecordInput,
	): Promise<ProductRecord | null> {
		throw new Error(
			"database write failure client-secret-canary bearer-canary",
		);
	}
}

export function tenantFor(organization: OrganizationRecord): TenantContext {
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

export async function setupFixture(
	repository: InMemoryOrganizationRepository = new InMemoryOrganizationRepository(),
) {
	const organization = await repository.createOrganization({
		name: "Pacific Northwest Festival",
		slug: "pafe",
	});
	const keyring = createKeyring();
	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "pafe.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: keyring.encrypt("client-secret-canary", {
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
		grantedScopes: [
			"read_products",
			"write_products",
			"write_inventory",
			"write_publications",
			"read_orders",
		],
		capabilities: {
			read_products: "granted",
			write_products: "granted",
			write_inventory: "granted",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
	const offering = await repository.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: PRODUCT_GID,
		shopifyVariantGid: VARIANT_GID,
		productNameSnapshot: "Teacher Membership",
	});
	const client = new FakeShopifyProductClient();
	const audit = new FakeAuditWriter();
	const service = new ShopifyMembershipProductService(
		repository,
		keyring,
		client,
		audit,
	);
	return { repository, organization, offering, client, audit, service };
}
