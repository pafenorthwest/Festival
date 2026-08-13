import type { ShopifyAdminCapability } from "@festival/common";

export interface ShopifyCredentials {
	organizationId: string;
	storeDomain: string;
	clientId: string;
	clientSecret: string;
	integrationVersion: number;
}

export interface ShopifyAdminOperationContext {
	organizationId: string;
	firebaseActorUid: string;
	verifiedShopGid: string;
	verifiedShopDomain: string;
	integrationVersion: number;
	grantedScopes: readonly string[];
	capability: ShopifyAdminCapability;
	credentials: ShopifyCredentials;
}

export interface ShopifyAdminResult<T> {
	value: T;
	requestId?: string;
}

export interface ShopifyConnectivityTester {
	testCredentials(
		credentials: ShopifyCredentials,
	): Promise<ShopifyVerificationResult>;
	invalidateIntegration?(
		organizationId: string,
		integrationVersion: number,
	): void;
}

export interface ShopifyVerificationResult {
	shopGid: string;
	shopDomain: string;
	grantedScopes: string[];
}

export interface ShopifyMoney {
	amount: string;
	currencyCode: string;
}

export interface ShopifyProductVariant {
	id: string;
	title: string;
	price: ShopifyMoney;
	productId: string;
	selectedOptions: Array<{
		name: string;
		value: string;
	}>;
}

export interface ShopifyProductDetails {
	id: string;
	title: string;
	description?: string;
	status: "ACTIVE" | "DRAFT" | "ARCHIVED";
	variants: ShopifyProductVariant[];
}

export interface ShopifyMembershipProductClient {
	createProduct(
		context: ShopifyAdminOperationContext,
		input: {
			name: string;
			description?: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>>;
	updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			variantId: string;
			price: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>>;
	readProductsByGid(
		context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>>;
	deleteProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>>;
}

export function assertShopifyOrderReadWindow(
	oldestCreatedAt: Date,
	now = new Date(),
): void {
	if (
		!Number.isFinite(oldestCreatedAt.getTime()) ||
		!Number.isFinite(now.getTime())
	) {
		throw new Error("Shopify order read window is invalid.");
	}
	const minimum = new Date(now);
	minimum.setUTCDate(minimum.getUTCDate() - 60);
	if (oldestCreatedAt < minimum) {
		throw new Error(
			"Shopify order reads are limited to the most recent 60 days.",
		);
	}
}

export function assertShopifyOrderReadAllowed(
	context: ShopifyAdminOperationContext,
	oldestCreatedAt: Date,
	now = new Date(),
): void {
	if (
		context.capability !== "read_orders" ||
		!context.grantedScopes.includes("read_orders")
	) {
		throw new Error("Shopify order read capability is not granted.");
	}
	assertShopifyOrderReadWindow(oldestCreatedAt, now);
}
