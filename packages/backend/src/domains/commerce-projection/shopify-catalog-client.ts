import { ShopifyAdminApiError } from "./shopify-errors.js";
import {
	mapProductNode,
	type ShopifyProductNode,
	type ShopifyUserErrorPayload,
	throwIfUserErrors,
} from "./shopify-graphql-mappers.js";
import type { ShopifyGraphqlTransport } from "./shopify-graphql-transport.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyProductClient,
	ShopifyProductDetails,
} from "./shopify-types.js";

const PRODUCT_FIELDS = `
	id
	title
	descriptionHtml
	status
	variants(first: 2) {
		nodes {
			id
			title
			price
			product { id }
			selectedOptions { name value }
			inventoryItem { id requiresShipping }
		}
	}
`;

const CREATE_PRODUCT_MUTATION = `
	mutation CreateMembershipProduct($product: ProductCreateInput!) {
		productCreate(product: $product) {
			product { ${PRODUCT_FIELDS} }
			userErrors { field message }
		}
	}
`;

const UPDATE_VARIANTS_MUTATION = `
	mutation UpdateMembershipProductVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
		productVariantsBulkUpdate(productId: $productId, variants: $variants) {
			product { ${PRODUCT_FIELDS} }
			userErrors { field message }
		}
	}
`;

const UPDATE_INVENTORY_ITEM_MUTATION = `
	mutation UpdateMembershipInventoryItem($id: ID!, $input: InventoryItemInput!) {
		inventoryItemUpdate(id: $id, input: $input) {
			inventoryItem { requiresShipping }
			userErrors { field message }
		}
	}
`;

const UPDATE_PRODUCT_MUTATION = `
	mutation UpdateMembershipProduct($product: ProductUpdateInput!) {
		productUpdate(product: $product) {
			product { ${PRODUCT_FIELDS} }
			userErrors { field message }
		}
	}
`;

const READ_PRODUCTS_QUERY = `
	query ReadMembershipProducts($ids: [ID!]!) {
		nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } }
	}
`;

const HEADLESS_PUBLICATION_QUERY = `query HeadlessPublication { publications(first: 50) { nodes { id channels(first: 10) { nodes { app { title } } } } } }`;
const PUBLISH_PRODUCT_MUTATION = `mutation PublishMembershipProduct($id: ID!, $input: [PublicationInput!]!, $publicationId: ID!) { publishablePublish(id: $id, input: $input) { publishable { publishedOnPublication(publicationId: $publicationId) } userErrors { field message } } }`;
const DELETE_PRODUCT_MUTATION = `mutation DeleteMembershipProduct($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }`;

async function prepareCatalogContext(
	transport: ShopifyGraphqlTransport,
	context: ShopifyAdminOperationContext,
	contextCapability: "read_products" | "write_products",
	tokenCapability:
		| "read_products"
		| "write_products"
		| "write_inventory" = contextCapability,
): Promise<{ accessToken: string; shopCurrencyCode: string }> {
	transport.assertOperationContext(context, contextCapability);
	const { accessToken } = await transport.fetchOperationAccessToken(
		context,
		tokenCapability,
	);
	const shopCurrencyCode = await transport.fetchShopCurrencyCode(
		context.credentials.storeDomain,
		accessToken,
	);
	return { accessToken, shopCurrencyCode };
}

async function publishProductToHeadless(
	transport: ShopifyGraphqlTransport,
	context: ShopifyAdminOperationContext,
	productId: string,
): Promise<ShopifyAdminResult<void>> {
	transport.assertOperationContext(context, "write_products");
	const { accessToken } = await transport.fetchOperationAccessToken(
		context,
		"write_products",
	);
	const publications = await transport.graphqlRequest<{
		publications?: {
			nodes?: Array<{
				id?: string;
				channels?: { nodes?: Array<{ app?: { title?: string } | null }> };
			}>;
		};
	}>(context.credentials.storeDomain, accessToken, HEADLESS_PUBLICATION_QUERY);
	const matches = (publications.value.publications?.nodes ?? []).filter(
		(publication) =>
			typeof publication.id === "string" &&
			publication.channels?.nodes?.some(
				(channel) => channel.app?.title === "Headless",
			),
	);
	if (matches.length !== 1 || !matches[0]?.id) {
		throw new ShopifyAdminApiError(
			"Shopify Headless storefront publication could not be uniquely identified.",
			{ requestId: publications.requestId },
		);
	}
	const response = await transport.graphqlRequest<{
		publishablePublish?: {
			publishable?: { publishedOnPublication?: boolean };
			userErrors?: ShopifyUserErrorPayload[];
		};
	}>(context.credentials.storeDomain, accessToken, PUBLISH_PRODUCT_MUTATION, {
		id: productId,
		input: [{ publicationId: matches[0].id }],
		publicationId: matches[0].id,
	});
	throwIfUserErrors(
		response.value.publishablePublish?.userErrors,
		response.requestId,
	);
	if (!response.value.publishablePublish?.publishable?.publishedOnPublication) {
		throw new ShopifyAdminApiError(
			"Shopify did not publish the membership product to Headless.",
			{ requestId: response.requestId },
		);
	}
	return { value: undefined, requestId: response.requestId };
}

export class ShopifyCatalogAdminClient implements ShopifyProductClient {
	constructor(private readonly transport: ShopifyGraphqlTransport) {}

	async createProduct(
		context: ShopifyAdminOperationContext,
		input: { name: string; description?: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		const { accessToken, shopCurrencyCode } = await prepareCatalogContext(
			this.transport,
			context,
			"write_products",
		);
		const response = await this.transport.graphqlRequest<{
			productCreate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(context.credentials.storeDomain, accessToken, CREATE_PRODUCT_MUTATION, {
			product: {
				title: input.name,
				descriptionHtml: input.description ?? "",
				status: "ACTIVE",
				productOptions: [{ name: "Plan", values: [{ name: "Standard" }] }],
			},
		});
		throwIfUserErrors(
			response.value.productCreate?.userErrors,
			response.requestId,
		);
		if (!response.value.productCreate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify product creation returned no product.",
			);
		}
		return {
			value: mapProductNode(
				response.value.productCreate.product,
				shopCurrencyCode,
			),
			requestId: response.requestId,
		};
	}

	async updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: { productId: string; variantId: string; price: string },
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		const { accessToken, shopCurrencyCode } = await prepareCatalogContext(
			this.transport,
			context,
			"write_products",
		);
		const response = await this.transport.graphqlRequest<{
			productVariantsBulkUpdate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(context.credentials.storeDomain, accessToken, UPDATE_VARIANTS_MUTATION, {
			productId: input.productId,
			variants: [{ id: input.variantId, price: input.price }],
		});
		throwIfUserErrors(
			response.value.productVariantsBulkUpdate?.userErrors,
			response.requestId,
		);
		if (!response.value.productVariantsBulkUpdate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify variant update returned no product.",
			);
		}
		return {
			value: mapProductNode(
				response.value.productVariantsBulkUpdate.product,
				shopCurrencyCode,
			),
			requestId: response.requestId,
		};
	}

	async updateInventoryItem(
		context: ShopifyAdminOperationContext,
		input: { inventoryItemId: string; requiresShipping: boolean },
	): Promise<ShopifyAdminResult<{ requiresShipping: boolean }>> {
		this.transport.assertOperationContext(context, "write_products");
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"write_inventory",
		);
		const response = await this.transport.graphqlRequest<{
			inventoryItemUpdate?: {
				inventoryItem?: { requiresShipping?: boolean | null };
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			context.credentials.storeDomain,
			accessToken,
			UPDATE_INVENTORY_ITEM_MUTATION,
			{
				id: input.inventoryItemId,
				input: { requiresShipping: input.requiresShipping },
			},
		);
		throwIfUserErrors(
			response.value.inventoryItemUpdate?.userErrors,
			response.requestId,
		);
		const requiresShipping =
			response.value.inventoryItemUpdate?.inventoryItem?.requiresShipping;
		if (typeof requiresShipping !== "boolean") {
			throw new ShopifyAdminApiError(
				"Shopify inventory item update returned no shipping status.",
				{ requestId: response.requestId },
			);
		}
		return { value: { requiresShipping }, requestId: response.requestId };
	}

	async updateProductDetails(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			name?: string;
			description?: string;
			status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		const { accessToken, shopCurrencyCode } = await prepareCatalogContext(
			this.transport,
			context,
			"write_products",
		);
		const productPayload: Record<string, unknown> = { id: input.productId };
		if (input.name !== undefined) productPayload.title = input.name;
		if (input.description !== undefined) {
			productPayload.descriptionHtml = input.description;
		}
		if (input.status !== undefined) productPayload.status = input.status;
		const response = await this.transport.graphqlRequest<{
			productUpdate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(context.credentials.storeDomain, accessToken, UPDATE_PRODUCT_MUTATION, {
			product: productPayload,
		});
		throwIfUserErrors(
			response.value.productUpdate?.userErrors,
			response.requestId,
		);
		if (!response.value.productUpdate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify product update returned no product.",
			);
		}
		return {
			value: mapProductNode(
				response.value.productUpdate.product,
				shopCurrencyCode,
			),
			requestId: response.requestId,
		};
	}

	async readProductsByGid(
		context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.transport.assertOperationContext(context, "read_products");
		if (productGids.length === 0) return { value: [] };
		const { accessToken, shopCurrencyCode } = await prepareCatalogContext(
			this.transport,
			context,
			"read_products",
		);
		const response = await this.transport.graphqlRequest<{
			nodes?: Array<ShopifyProductNode | null>;
		}>(context.credentials.storeDomain, accessToken, READ_PRODUCTS_QUERY, {
			ids: productGids,
		});
		return {
			value: (response.value.nodes ?? [])
				.filter((node): node is ShopifyProductNode => Boolean(node))
				.map((node) => mapProductNode(node, shopCurrencyCode)),
			requestId: response.requestId,
		};
	}

	publishProductToHeadlessStorefront(
		context: ShopifyAdminOperationContext,
		productId: string,
	): Promise<ShopifyAdminResult<void>> {
		return publishProductToHeadless(this.transport, context, productId);
	}

	async deleteProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.transport.assertOperationContext(context, "write_products");
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const response = await this.transport.graphqlRequest<{
			productDelete?: {
				deletedProductId?: string;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(context.credentials.storeDomain, accessToken, DELETE_PRODUCT_MUTATION, {
			input: { id: productGid },
		});
		throwIfUserErrors(
			response.value.productDelete?.userErrors,
			response.requestId,
		);
		if (response.value.productDelete?.deletedProductId !== productGid) {
			throw new ShopifyAdminApiError(
				"Shopify product deletion returned no matching product.",
				{ requestId: response.requestId },
			);
		}
		return { value: undefined, requestId: response.requestId };
	}
}
