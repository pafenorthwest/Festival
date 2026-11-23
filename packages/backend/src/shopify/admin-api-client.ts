import {
	type ShopifyAdminApiClientOptions,
	type ShopifyAdminOperationContext,
	type ShopifyAdminResult,
	ShopifyCatalogAdminClient,
	type ShopifyConnectivityTester,
	type ShopifyCredentials,
	type ShopifyFetch,
	ShopifyGraphqlTransport,
	type ShopifyOrderCustomerProfile,
	ShopifyOrdersAdminClient,
	type ShopifyPaidOrder,
	type ShopifyPaidOrderReader,
	type ShopifyProductClient,
	type ShopifyProductDetails,
	type ShopifyVerificationResult,
	type ShopifyWebhookSubscriptionClient,
	ShopifyWebhooksAdminClient,
} from "../domains/commerce-projection/index.js";

export type { ShopifyAdminApiClientOptions, ShopifyFetch };

export class ShopifyAdminApiClient
	implements
		ShopifyConnectivityTester,
		ShopifyProductClient,
		ShopifyPaidOrderReader,
		ShopifyWebhookSubscriptionClient
{
	private readonly transport: ShopifyGraphqlTransport;
	private readonly catalog: ShopifyCatalogAdminClient;
	private readonly orders: ShopifyOrdersAdminClient;
	private readonly webhooks: ShopifyWebhooksAdminClient;

	constructor(options: ShopifyAdminApiClientOptions = {}) {
		this.transport = new ShopifyGraphqlTransport(options);
		this.catalog = new ShopifyCatalogAdminClient(this.transport);
		this.orders = new ShopifyOrdersAdminClient(this.transport);
		this.webhooks = new ShopifyWebhooksAdminClient(this.transport);
	}

	testCredentials(
		credentials: ShopifyCredentials,
	): Promise<ShopifyVerificationResult> {
		return this.transport.testCredentials(credentials);
	}

	invalidateIntegration(
		organizationId: string,
		integrationVersion: number,
	): void {
		this.transport.invalidateIntegration(organizationId, integrationVersion);
	}

	createProduct(
		context: ShopifyAdminOperationContext,
		input: { name: string; description?: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return this.catalog.createProduct(context, input);
	}

	updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: { productId: string; variantId: string; price: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return this.catalog.updateVariantPrice(context, input);
	}

	updateInventoryItem(
		context: ShopifyAdminOperationContext,
		input: { inventoryItemId: string; requiresShipping: boolean },
	): Promise<ShopifyAdminResult<{ requiresShipping: boolean }>> {
		return this.catalog.updateInventoryItem(context, input);
	}

	updateProductDetails(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			name?: string;
			description?: string;
			status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return this.catalog.updateProductDetails(context, input);
	}

	readProductsByGid(
		context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		return this.catalog.readProductsByGid(context, productGids);
	}

	publishProductToHeadlessStorefront(
		context: ShopifyAdminOperationContext,
		productId: string,
	): Promise<ShopifyAdminResult<void>> {
		return this.catalog.publishProductToHeadlessStorefront(context, productId);
	}

	deleteProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		return this.catalog.deleteProduct(context, productGid);
	}

	reconcileOrdersPaidWebhook(
		context: ShopifyAdminOperationContext,
		callbackUrl: string,
	): Promise<ShopifyAdminResult<void>> {
		return this.webhooks.reconcileOrdersPaidWebhook(context, callbackUrl);
	}

	readPaidOrderByGid(
		context: ShopifyAdminOperationContext,
		orderGid: string,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder | null>> {
		return this.orders.readPaidOrderByGid(context, orderGid);
	}

	readOrderCustomerProfileByGid(
		context: ShopifyAdminOperationContext,
		orderGid: string,
	): Promise<ShopifyAdminResult<ShopifyOrderCustomerProfile | null>> {
		return this.orders.readOrderCustomerProfileByGid(context, orderGid);
	}

	listPaidOrdersSince(
		context: ShopifyAdminOperationContext,
		sinceIso: string,
		first?: number,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder[]>> {
		return this.orders.listPaidOrdersSince(context, sinceIso, first);
	}
}
