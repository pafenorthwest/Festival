import { normalizeEffectiveShopifyScopes } from "@festival/common";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
	ShopifyIdentityError,
	ShopifyIntegrationError,
	ShopifyScopeError,
	ShopifyTransportError,
	ShopifyUserError,
} from "./errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyConnectivityTester,
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
	ShopifyProductDetails,
	ShopifyVerificationResult,
	ShopifyWebhookSubscriptionClient,
} from "./types.js";

const SHOPIFY_ADMIN_API_VERSION = "2026-07";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_PAID_ORDER_LIST_LIMIT = 50;
const MAX_PAID_ORDER_LIST_LIMIT = 100;

type ShopifyFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

interface ShopifyAdminApiClientOptions {
	fetch?: ShopifyFetch;
	requestTimeoutMs?: number;
	maxResponseBytes?: number;
	now?: () => number;
}

interface AccessTokenResponse {
	access_token?: string;
	scope?: string;
	expires_in?: number;
}

interface CachedAccessToken {
	accessToken: string;
	grantedScopes: string[];
	expiresAtMs: number;
}

interface AcquiredAccessToken {
	accessToken: string;
	grantedScopes: string[];
}

const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60_000;

interface GraphqlResponse<TData> {
	data?: TData;
	errors?: Array<{ message: string }>;
}

interface ShopifyProductNode {
	id?: string;
	title?: string;
	descriptionHtml?: string;
	status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
	variants?: {
		nodes?: ShopifyVariantNode[];
		edges?: Array<{ node?: ShopifyVariantNode }>;
	};
}

interface ShopifyVariantNode {
	id?: string;
	title?: string;
	price?: string | { amount?: string; currencyCode?: string };
	product?: { id?: string };
	selectedOptions?: Array<{ name?: string; value?: string }>;
}

interface ShopifyOrderAttributeNode {
	key?: string;
	value?: string;
}

interface ShopifyOrderMoneyNode {
	presentmentMoney?: {
		amount?: string;
		currencyCode?: string;
	};
}

interface ShopifyOrderLineNode {
	id?: string;
	product?: { id?: string } | null;
	variant?: { id?: string } | null;
	quantity?: number;
	discountedTotalSet?: ShopifyOrderMoneyNode;
}

interface ShopifyOrderTransactionNode {
	kind?: string;
	status?: string;
	processedAt?: string | null;
}

interface ShopifyOrderNode {
	id?: string;
	fullyPaid?: boolean;
	currencyCode?: string;
	customer?: { id?: string } | null;
	customAttributes?: ShopifyOrderAttributeNode[];
	lineItems?: {
		nodes?: ShopifyOrderLineNode[];
		pageInfo?: { hasNextPage?: boolean };
	};
	transactions?: ShopifyOrderTransactionNode[];
}

interface ShopifyOrderCustomerContactNode {
	firstName?: string | null;
	lastName?: string | null;
	email?: string | null;
	phone?: string | null;
	defaultAddress?: {
		address1?: string | null;
		address2?: string | null;
		city?: string | null;
		province?: string | null;
		zip?: string | null;
		countryCodeV2?: string | null;
	} | null;
}

interface ShopifyUserErrorPayload {
	field?: string[];
	message: string;
}

function mapProductNode(
	node: ShopifyProductNode,
	shopCurrencyCode: string,
): ShopifyProductDetails {
	if (!node.id || !node.title || !node.status) {
		throw new ShopifyAdminApiError("Shopify product response was incomplete.");
	}

	const productId = node.id;
	const variantNodes =
		node.variants?.nodes ??
		node.variants?.edges?.map((edge) => edge.node).filter(Boolean) ??
		[];

	return {
		id: node.id,
		title: node.title,
		description: node.descriptionHtml,
		status: node.status,
		variants: variantNodes.map((variant) => {
			if (!variant?.id) {
				throw new ShopifyAdminApiError(
					"Shopify variant response was incomplete.",
				);
			}

			const amount =
				typeof variant.price === "string"
					? variant.price
					: (variant.price?.amount ?? "");

			if (!shopCurrencyCode) {
				throw new ShopifyAdminApiError(
					"Shopify shop response did not include a currency code.",
				);
			}

			return {
				id: variant.id,
				title: variant.title ?? "",
				price: {
					amount,
					currencyCode: shopCurrencyCode,
				},
				productId: variant.product?.id ?? productId,
				selectedOptions:
					variant.selectedOptions?.map((option) => ({
						name: option.name ?? "",
						value: option.value ?? "",
					})) ?? [],
			};
		}),
	};
}

function requiredOrderString(value: unknown, message: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new ShopifyAdminApiError(message);
	}
	return value;
}

function requiredOrderCurrencyCode(value: unknown, message: string): string {
	const currencyCode = requiredOrderString(value, message);
	if (!/^[A-Z]{3}$/.test(currencyCode)) {
		throw new ShopifyAdminApiError(message);
	}
	return currencyCode;
}

function requiredOrderAmount(value: unknown): string {
	const amount = requiredOrderString(
		value,
		"Shopify order line response did not include a valid paid amount.",
	);
	if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
		throw new ShopifyAdminApiError(
			"Shopify order line response did not include a valid paid amount.",
		);
	}
	return amount;
}

function optionalCustomerText(value: unknown, limit = 255): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && normalized.length <= limit ? normalized : undefined;
}

function mapOrderCustomerProfile(
	customer: ShopifyOrderCustomerContactNode | null | undefined,
): ShopifyOrderCustomerProfile | null {
	if (!customer) return null;
	const firstName = optionalCustomerText(customer.firstName);
	const lastName = optionalCustomerText(customer.lastName);
	const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
	const emailCandidate = optionalCustomerText(customer.email)?.toLowerCase();
	const email =
		emailCandidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCandidate)
			? emailCandidate
			: undefined;
	const phoneCandidate = optionalCustomerText(customer.phone, 31);
	const phone =
		phoneCandidate && /^\+?[0-9][0-9 ().-]{5,30}$/.test(phoneCandidate)
			? phoneCandidate
			: undefined;
	const address = customer.defaultAddress;
	const line1 = optionalCustomerText(address?.address1, 512);
	const city = optionalCustomerText(address?.city);
	const region = optionalCustomerText(address?.province);
	const postalCode = optionalCustomerText(address?.zip);
	const countryCode = optionalCustomerText(
		address?.countryCodeV2,
	)?.toUpperCase();
	const line2 = optionalCustomerText(address?.address2, 512);
	const mailingAddress =
		line1 &&
		city &&
		region &&
		postalCode &&
		countryCode &&
		/^[A-Z]{2}$/.test(countryCode)
			? {
					line1,
					...(line2 ? { line2 } : {}),
					city,
					region,
					postalCode,
					countryCode,
				}
			: undefined;
	if (!name && !email && !phone && !mailingAddress) return null;
	return {
		...(name ? { name } : {}),
		...(email ? { email } : {}),
		...(phone ? { phone } : {}),
		...(mailingAddress ? { mailingAddress } : {}),
	};
}

function latestSuccessfulPaymentTimestamp(
	transactions: ShopifyOrderTransactionNode[] | undefined,
): string {
	if (!transactions) {
		throw new ShopifyAdminApiError(
			"Shopify fully paid order response did not include payment transactions.",
		);
	}

	let latest: { value: string; time: number } | undefined;
	for (const transaction of transactions) {
		if (
			transaction.status !== "SUCCESS" ||
			(transaction.kind !== "SALE" && transaction.kind !== "CAPTURE")
		) {
			continue;
		}
		const value = transaction.processedAt;
		if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
			throw new ShopifyAdminApiError(
				"Shopify fully paid order response did not include a valid payment timestamp.",
			);
		}
		const time = Date.parse(value);
		if (!Number.isFinite(time)) {
			throw new ShopifyAdminApiError(
				"Shopify fully paid order response did not include a valid payment timestamp.",
			);
		}
		if (!latest || time > latest.time) {
			latest = { value, time };
		}
	}

	if (!latest) {
		throw new ShopifyAdminApiError(
			"Shopify fully paid order response did not include a successful payment timestamp.",
		);
	}
	return latest.value;
}

function mapPaidOrderNode(node: ShopifyOrderNode): ShopifyPaidOrder {
	const id = requiredOrderString(
		node.id,
		"Shopify order response was incomplete.",
	);
	const customerGid = requiredOrderString(
		node.customer?.id,
		"Shopify order response did not include a customer.",
	);
	if (typeof node.fullyPaid !== "boolean") {
		throw new ShopifyAdminApiError(
			"Shopify order response did not include a paid status.",
		);
	}
	const currencyCode = requiredOrderCurrencyCode(
		node.currencyCode,
		"Shopify order response did not include a valid currency code.",
	);
	if (
		!node.customAttributes ||
		!node.lineItems?.nodes ||
		typeof node.lineItems.pageInfo?.hasNextPage !== "boolean"
	) {
		throw new ShopifyAdminApiError("Shopify order response was incomplete.");
	}
	if (node.lineItems.pageInfo?.hasNextPage) {
		throw new ShopifyAdminApiError(
			"Shopify order response exceeded the supported line-item limit.",
		);
	}

	const customAttributes = node.customAttributes.map((attribute) => ({
		key: requiredOrderString(
			attribute.key,
			"Shopify order response included an invalid custom attribute.",
		),
		value: requiredOrderString(
			attribute.value,
			"Shopify order response included an invalid custom attribute.",
		),
	}));
	const lineItems = node.lineItems.nodes.map((lineItem) => {
		if (
			typeof lineItem.quantity !== "number" ||
			!Number.isSafeInteger(lineItem.quantity) ||
			lineItem.quantity <= 0
		) {
			throw new ShopifyAdminApiError(
				"Shopify order line response did not include a valid quantity.",
			);
		}
		return {
			id: requiredOrderString(
				lineItem.id,
				"Shopify order line response was incomplete.",
			),
			productGid: requiredOrderString(
				lineItem.product?.id,
				"Shopify order line response did not include a product.",
			),
			variantGid: requiredOrderString(
				lineItem.variant?.id,
				"Shopify order line response did not include a variant.",
			),
			quantity: lineItem.quantity,
			paidAmount: requiredOrderAmount(
				lineItem.discountedTotalSet?.presentmentMoney?.amount,
			),
			paidCurrencyCode: requiredOrderCurrencyCode(
				lineItem.discountedTotalSet?.presentmentMoney?.currencyCode,
				"Shopify order line response did not include a valid paid currency.",
			),
		};
	});
	const fullyPaidAtIso = node.fullyPaid
		? latestSuccessfulPaymentTimestamp(node.transactions)
		: undefined;

	return {
		id,
		customerGid,
		fullyPaid: node.fullyPaid,
		...(fullyPaidAtIso ? { fullyPaidAtIso } : {}),
		currencyCode,
		customAttributes,
		lineItems,
	};
}

function throwIfUserErrors(
	userErrors: ShopifyUserErrorPayload[] = [],
	requestId?: string,
): void {
	if (userErrors.length === 0) {
		return;
	}

	throw new ShopifyUserError(
		"Shopify rejected the product operation.",
		requestId,
	);
}

export class ShopifyAdminApiClient
	implements
		ShopifyConnectivityTester,
		ShopifyMembershipProductClient,
		ShopifyWebhookSubscriptionClient,
		ShopifyPaidOrderReader
{
	private readonly accessTokens = new Map<string, CachedAccessToken>();
	private readonly fetchImpl: ShopifyFetch;
	private readonly requestTimeoutMs: number;
	private readonly maxResponseBytes: number;
	private readonly now: () => number;

	constructor(options: ShopifyAdminApiClientOptions = {}) {
		this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.maxResponseBytes =
			options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
		this.now = options.now ?? Date.now;
	}

	async testCredentials(
		credentials: ShopifyCredentials,
	): Promise<ShopifyVerificationResult> {
		const token = await this.fetchAccessToken(credentials, true);
		const { value: payload } = await this.graphqlRequest<{
			shop?: { id?: string; myshopifyDomain?: string };
		}>(
			credentials.storeDomain,
			token.accessToken,
			`
			query TestShopifyConnection {
				shop {
					id
					myshopifyDomain
				}
			}
		`,
		);

		if (!payload.shop?.id || !payload.shop.myshopifyDomain) {
			throw new ShopifyCredentialsError(
				"Shopify Admin API test returned no shop data.",
			);
		}
		if (
			payload.shop.myshopifyDomain.toLowerCase() !== credentials.storeDomain
		) {
			throw new ShopifyIdentityError();
		}

		return {
			shopGid: payload.shop.id,
			shopDomain: payload.shop.myshopifyDomain.toLowerCase(),
			grantedScopes: token.grantedScopes,
		};
	}

	invalidateIntegration(
		organizationId: string,
		integrationVersion: number,
	): void {
		for (const key of this.accessTokens.keys()) {
			if (
				key.startsWith(`${organizationId}\u0000`) &&
				key.endsWith(`\u0000${integrationVersion}`)
			) {
				this.accessTokens.delete(key);
			}
		}
	}

	async reconcileOrdersPaidWebhook(
		context: ShopifyAdminOperationContext,
		callbackUrl: string,
	): Promise<ShopifyAdminResult<void>> {
		this.assertOperationContext(context, "read_orders");
		if (
			!/^https:\/\/[^/?#]+\/api\/shopify\/webhooks\/orders-paid$/.test(
				callbackUrl,
			)
		) {
			throw new ShopifyCredentialsError(
				"Shopify webhook callback URL is invalid.",
			);
		}
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const subscriptions = await this.graphqlRequest<{
			webhookSubscriptions?: {
				nodes?: Array<{
					id?: string;
					topic?: string;
					uri?: string;
				}>;
			};
		}>(
			context.credentials.storeDomain,
			accessToken,
			`query ListOrdersPaidWebhookSubscriptions {
				webhookSubscriptions(first: 250) {
					nodes { id topic uri }
				}
			}`,
		);
		const matching = (
			subscriptions.value.webhookSubscriptions?.nodes ?? []
		).filter(
			(subscription) => subscription.topic === "ORDERS_PAID" && subscription.id,
		);
		const exact = matching.filter(
			(subscription) => subscription.uri === callbackUrl,
		);
		let keep = exact.shift();
		let requestId = subscriptions.requestId;
		if (!keep) {
			const created = await this.graphqlRequest<{
				webhookSubscriptionCreate?: {
					webhookSubscription?: { id?: string; topic?: string; uri?: string };
					userErrors?: ShopifyUserErrorPayload[];
				};
			}>(
				context.credentials.storeDomain,
				accessToken,
				`mutation CreateOrdersPaidWebhook($uri: URL!) {
					webhookSubscriptionCreate(topic: ORDERS_PAID, webhookSubscription: { uri: $uri }) {
						webhookSubscription { id topic uri }
						userErrors { field message }
					}
				}`,
				{ uri: callbackUrl },
			);
			const payload = created.value.webhookSubscriptionCreate;
			throwIfUserErrors(payload?.userErrors, created.requestId);
			const createdSubscription = payload?.webhookSubscription;
			if (
				!createdSubscription?.id ||
				createdSubscription.topic !== "ORDERS_PAID" ||
				createdSubscription.uri !== callbackUrl
			) {
				throw new ShopifyAdminApiError(
					"Shopify webhook creation returned an incomplete subscription.",
					{ requestId: created.requestId },
				);
			}
			keep = createdSubscription;
			requestId = created.requestId ?? requestId;
		}
		for (const subscription of matching) {
			if (subscription.id === keep.id) continue;
			const deleted = await this.graphqlRequest<{
				webhookSubscriptionDelete?: {
					deletedWebhookSubscriptionId?: string;
					userErrors?: ShopifyUserErrorPayload[];
				};
			}>(
				context.credentials.storeDomain,
				accessToken,
				`mutation DeleteOrdersPaidWebhook($id: ID!) {
					webhookSubscriptionDelete(id: $id) {
						deletedWebhookSubscriptionId
						userErrors { field message }
					}
				}`,
				{ id: subscription.id },
			);
			throwIfUserErrors(
				deleted.value.webhookSubscriptionDelete?.userErrors,
				deleted.requestId,
			);
			if (
				deleted.value.webhookSubscriptionDelete
					?.deletedWebhookSubscriptionId !== subscription.id
			) {
				throw new ShopifyAdminApiError(
					"Shopify webhook deletion was not confirmed.",
					{ requestId: deleted.requestId },
				);
			}
			requestId = deleted.requestId ?? requestId;
		}
		return { value: undefined, requestId };
	}

	async createProduct(
		context: ShopifyAdminOperationContext,
		input: {
			name: string;
			description?: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			productCreate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation CreateMembershipProduct($product: ProductCreateInput!) {
				productCreate(product: $product) {
					product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
					userErrors {
						field
						message
					}
				}
			}
		`,
			{
				product: {
					title: input.name,
					descriptionHtml: input.description ?? "",
					productOptions: [
						{
							name: "Plan",
							values: [{ name: "Standard" }],
						},
					],
				},
			},
		);

		const payload = response.value;
		throwIfUserErrors(payload.productCreate?.userErrors, response.requestId);
		if (!payload.productCreate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify product creation returned no product.",
			);
		}

		return {
			value: mapProductNode(payload.productCreate.product, shopCurrencyCode),
			requestId: response.requestId,
		};
	}

	async updateVariantPrice(
		context: ShopifyAdminOperationContext,
		input: {
			productId: string;
			variantId: string;
			price: string;
		},
	): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			productVariantsBulkUpdate?: {
				product?: ShopifyProductNode;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation UpdateMembershipProductVariantPrice(
				$productId: ID!
				$variants: [ProductVariantsBulkInput!]!
			) {
				productVariantsBulkUpdate(productId: $productId, variants: $variants) {
					product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
					userErrors {
						field
						message
					}
				}
			}
		`,
			{
				productId: input.productId,
				variants: [
					{
						id: input.variantId,
						price: input.price,
					},
				],
			},
		);

		const payload = response.value;
		throwIfUserErrors(
			payload.productVariantsBulkUpdate?.userErrors,
			response.requestId,
		);
		if (!payload.productVariantsBulkUpdate?.product) {
			throw new ShopifyAdminApiError(
				"Shopify variant update returned no product.",
			);
		}

		return {
			value: mapProductNode(
				payload.productVariantsBulkUpdate.product,
				shopCurrencyCode,
			),
			requestId: response.requestId,
		};
	}

	async readProductsByGid(
		context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.assertOperationContext(context, "read_products");
		if (productGids.length === 0) {
			return { value: [] };
		}

		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_products",
		);
		const shopCurrencyCode = await this.fetchShopCurrencyCode(
			credentials.storeDomain,
			accessToken,
		);
		const response = await this.graphqlRequest<{
			nodes?: Array<ShopifyProductNode | null>;
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query ReadMembershipProducts($ids: [ID!]!) {
				nodes(ids: $ids) {
					... on Product {
						id
						title
						descriptionHtml
						status
						variants(first: 2) {
							nodes {
								id
								title
								price
								product {
									id
								}
								selectedOptions {
									name
									value
								}
							}
						}
					}
				}
			}
		`,
			{ ids: productGids },
		);

		return {
			value: (response.value.nodes ?? [])
				.filter((node): node is ShopifyProductNode => Boolean(node))
				.map((node) => mapProductNode(node, shopCurrencyCode)),
			requestId: response.requestId,
		};
	}

	async readPaidOrderByGid(
		context: ShopifyAdminOperationContext,
		orderGid: string,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder | null>> {
		this.assertOperationContext(context, "read_orders");
		if (!/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(orderGid)) {
			throw new ShopifyCredentialsError("Shopify order ID is invalid.");
		}

		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.graphqlRequest<{
			order?: ShopifyOrderNode | null;
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query ReadPaidOrder($orderId: ID!) {
				order(id: $orderId) {
					id
					fullyPaid
					currencyCode
					customer {
						id
					}
					customAttributes {
						key
						value
					}
					lineItems(first: 250) {
						nodes {
							id
							product {
								id
							}
							variant {
								id
							}
							quantity
							discountedTotalSet {
								presentmentMoney {
									amount
									currencyCode
								}
							}
						}
						pageInfo {
							hasNextPage
						}
					}
					transactions(first: 250) {
						kind
						status
						processedAt
					}
				}
			}
		`,
			{ orderId: orderGid },
		);

		return {
			value: response.value.order
				? mapPaidOrderNode(response.value.order)
				: null,
			requestId: response.requestId,
		};
	}

	async readOrderCustomerProfileByGid(
		context: ShopifyAdminOperationContext,
		orderGid: string,
	): Promise<ShopifyAdminResult<ShopifyOrderCustomerProfile | null>> {
		this.assertOperationContext(context, "read_orders");
		if (!/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(orderGid)) {
			throw new ShopifyCredentialsError("Shopify order ID is invalid.");
		}
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.graphqlRequest<{
			order?: { customer?: ShopifyOrderCustomerContactNode | null } | null;
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query ReadPaidOrderCustomerProfile($orderId: ID!) {
				order(id: $orderId) {
					customer {
						firstName
						lastName
						email
						phone
						defaultAddress {
							address1
							address2
							city
							province
							zip
							countryCodeV2
						}
					}
				}
			}
		`,
			{ orderId: orderGid },
		);
		return {
			value: mapOrderCustomerProfile(response.value.order?.customer),
			requestId: response.requestId,
		};
	}

	async listPaidOrdersSince(
		context: ShopifyAdminOperationContext,
		sinceIso: string,
		first = DEFAULT_PAID_ORDER_LIST_LIMIT,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder[]>> {
		this.assertOperationContext(context, "read_orders");
		const normalizedSinceIso = this.normalizePaidOrderReadSince(sinceIso);
		if (
			!Number.isSafeInteger(first) ||
			first <= 0 ||
			first > MAX_PAID_ORDER_LIST_LIMIT
		) {
			throw new Error("Shopify paid order read limit is invalid.");
		}

		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.graphqlRequest<{
			orders?: {
				nodes?: Array<ShopifyOrderNode | null>;
				pageInfo?: { hasNextPage?: boolean };
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			query ListPaidOrdersSince($first: Int!, $query: String!) {
				orders(
					first: $first
					query: $query
					sortKey: PROCESSED_AT
					reverse: true
				) {
					nodes {
						id
						fullyPaid
						currencyCode
						customer {
							id
						}
						customAttributes {
							key
							value
						}
						lineItems(first: 250) {
							nodes {
								id
								product {
									id
								}
								variant {
									id
								}
								quantity
								discountedTotalSet {
									presentmentMoney {
										amount
										currencyCode
									}
								}
							}
							pageInfo {
								hasNextPage
							}
						}
						transactions(first: 250) {
							kind
							status
							processedAt
						}
					}
					pageInfo {
						hasNextPage
					}
				}
			}
		`,
			{
				first,
				query: `financial_status:paid processed_at:>='${normalizedSinceIso}'`,
			},
		);

		const orders = response.value.orders;
		if (!orders?.nodes || typeof orders.pageInfo?.hasNextPage !== "boolean") {
			throw new ShopifyAdminApiError(
				"Shopify paid-order list was incomplete.",
				{
					requestId: response.requestId,
				},
			);
		}
		if (orders.pageInfo.hasNextPage) {
			throw new ShopifyAdminApiError(
				"Shopify paid-order list exceeded the supported limit.",
				{ requestId: response.requestId },
			);
		}

		return {
			value: orders.nodes.map((node) => {
				if (!node) {
					throw new ShopifyAdminApiError(
						"Shopify paid-order list was incomplete.",
						{ requestId: response.requestId },
					);
				}
				const order = mapPaidOrderNode(node);
				if (!order.fullyPaid) {
					throw new ShopifyAdminApiError(
						"Shopify paid-order list included an order that is not fully paid.",
						{ requestId: response.requestId },
					);
				}
				return order;
			}),
			requestId: response.requestId,
		};
	}

	async deleteProduct(
		context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.assertOperationContext(context, "write_products");
		const { credentials } = context;
		const { accessToken } = await this.fetchOperationAccessToken(
			context,
			"write_products",
		);
		const response = await this.graphqlRequest<{
			productDelete?: {
				deletedProductId?: string;
				userErrors?: ShopifyUserErrorPayload[];
			};
		}>(
			credentials.storeDomain,
			accessToken,
			`
			mutation DeleteMembershipProduct($input: ProductDeleteInput!) {
				productDelete(input: $input) {
					deletedProductId
					userErrors {
						field
						message
					}
				}
			}
		`,
			{ input: { id: productGid } },
		);

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

	private assertOperationContext(
		context: ShopifyAdminOperationContext,
		requiredCapability: "read_products" | "write_products" | "read_orders",
	): void {
		if (
			context.capability !== requiredCapability ||
			!context.grantedScopes.includes(requiredCapability) ||
			context.organizationId !== context.credentials.organizationId ||
			context.integrationVersion !== context.credentials.integrationVersion ||
			context.verifiedShopDomain !== context.credentials.storeDomain
		) {
			throw new ShopifyCredentialsError(
				"Shopify operation context is not authorized.",
			);
		}
	}

	private normalizePaidOrderReadSince(sinceIso: string): string {
		if (
			typeof sinceIso !== "string" ||
			!/(?:Z|[+-]\d{2}:\d{2})$/.test(sinceIso)
		) {
			throw new Error("Shopify order read window is invalid.");
		}
		const since = new Date(sinceIso);
		const now = new Date(this.now());
		if (!Number.isFinite(since.getTime()) || !Number.isFinite(now.getTime())) {
			throw new Error("Shopify order read window is invalid.");
		}
		const oldestAllowed = new Date(now);
		oldestAllowed.setUTCDate(oldestAllowed.getUTCDate() - 60);
		if (since < oldestAllowed) {
			throw new Error(
				"Shopify order reads are limited to the most recent 60 days.",
			);
		}
		if (since > now) {
			throw new Error("Shopify order read window is invalid.");
		}
		return since.toISOString();
	}

	private async fetchOperationAccessToken(
		context: ShopifyAdminOperationContext,
		requiredCapability: "read_products" | "write_products" | "read_orders",
	): Promise<AcquiredAccessToken> {
		const token = await this.fetchAccessToken(context.credentials);
		if (!token.grantedScopes.includes(requiredCapability)) {
			throw new ShopifyScopeError();
		}
		return token;
	}

	private async fetchAccessToken(
		credentials: ShopifyCredentials,
		forceRefresh = false,
	): Promise<AcquiredAccessToken> {
		const cacheKey = this.accessTokenCacheKey(credentials);
		const cached = this.accessTokens.get(cacheKey);
		if (
			!forceRefresh &&
			cached &&
			cached.expiresAtMs - ACCESS_TOKEN_EXPIRY_SAFETY_MS > this.now()
		) {
			return {
				accessToken: cached.accessToken,
				grantedScopes: [...cached.grantedScopes],
			};
		}

		const { value: payload } = await this.postJson<AccessTokenResponse>(
			this.shopifyUrl(credentials.storeDomain, "/admin/oauth/access_token"),
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "client_credentials",
					client_id: credentials.clientId,
					client_secret: credentials.clientSecret,
				}),
			},
			"credentials",
		);

		if (!payload.access_token) {
			throw new ShopifyCredentialsError(
				"Shopify token response did not include an access token.",
			);
		}
		if (
			typeof payload.expires_in !== "number" ||
			!Number.isFinite(payload.expires_in) ||
			payload.expires_in <= 0
		) {
			throw new ShopifyCredentialsError(
				"Shopify token response included an invalid expiry.",
			);
		}
		const grantedScopes = this.normalizeGrantedScopes(payload.scope);
		this.accessTokens.set(cacheKey, {
			accessToken: payload.access_token,
			grantedScopes,
			expiresAtMs: this.now() + payload.expires_in * 1_000,
		});

		return { accessToken: payload.access_token, grantedScopes };
	}

	private accessTokenCacheKey(credentials: ShopifyCredentials): string {
		if (
			!credentials.organizationId ||
			!Number.isSafeInteger(credentials.integrationVersion) ||
			credentials.integrationVersion <= 0
		) {
			throw new ShopifyCredentialsError(
				"Shopify integration identity is invalid.",
			);
		}
		return [
			credentials.organizationId,
			credentials.storeDomain,
			credentials.clientId,
			String(credentials.integrationVersion),
		].join("\u0000");
	}

	private normalizeGrantedScopes(scope: unknown): string[] {
		if (typeof scope !== "string") {
			throw new ShopifyCredentialsError(
				"Shopify token response did not include granted scopes.",
			);
		}
		const scopes = [...new Set(scope.split(",").map((value) => value.trim()))]
			.filter(Boolean)
			.sort();
		if (
			scopes.length === 0 ||
			scopes.some((value) => !/^[a-z][a-z0-9_]*$/.test(value))
		) {
			throw new ShopifyCredentialsError(
				"Shopify token response included invalid granted scopes.",
			);
		}
		return normalizeEffectiveShopifyScopes(scopes);
	}

	private async fetchShopCurrencyCode(
		storeDomain: string,
		accessToken: string,
	): Promise<string> {
		const { value: payload } = await this.graphqlRequest<{
			shop?: { currencyCode?: string };
		}>(
			storeDomain,
			accessToken,
			`
			query ReadShopCurrency {
				shop {
					currencyCode
				}
			}
		`,
		);

		if (!payload.shop?.currencyCode) {
			throw new ShopifyAdminApiError(
				"Shopify shop response did not include a currency code.",
			);
		}

		return payload.shop.currencyCode;
	}

	private async graphqlRequest<TData>(
		storeDomain: string,
		accessToken: string,
		query: string,
		variables: Record<string, unknown> = {},
	): Promise<ShopifyAdminResult<TData>> {
		const response = await this.postJson<GraphqlResponse<TData>>(
			this.shopifyUrl(
				storeDomain,
				`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
			),
			{
				headers: {
					"Content-Type": "application/json",
					"X-Shopify-Access-Token": accessToken,
				},
				body: JSON.stringify({ query, variables }),
			},
			"admin",
		);

		const payload = response.value;
		if (payload.errors && payload.errors.length > 0) {
			throw new ShopifyAdminApiError("Shopify Admin API returned an error.", {
				requestId: response.requestId,
			});
		}

		if (!payload.data) {
			throw new ShopifyAdminApiError("Shopify Admin API returned no data.", {
				requestId: response.requestId,
			});
		}

		return { value: payload.data, requestId: response.requestId };
	}

	private shopifyUrl(storeDomain: string, path: string): URL {
		if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeDomain)) {
			throw new ShopifyCredentialsError(
				"Shopify store domain is not a canonical myshopify.com host.",
			);
		}

		const url = new URL(`https://${storeDomain}${path}`);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.port ||
			url.hostname !== storeDomain
		) {
			throw new ShopifyCredentialsError("Shopify destination is not allowed.");
		}

		return url;
	}

	private async postJson<T>(
		url: URL,
		init: Omit<RequestInit, "method" | "redirect" | "signal">,
		errorKind: "credentials" | "admin",
	): Promise<ShopifyAdminResult<T>> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

		try {
			const response = await this.fetchImpl(url, {
				...init,
				method: "POST",
				redirect: "manual",
				signal: controller.signal,
			});
			if (response.status >= 300 && response.status < 400) {
				throw this.requestError(errorKind, "Shopify redirect was rejected.");
			}
			if (!response.ok) {
				const requestId =
					response.headers.get("x-request-id") ??
					response.headers.get("x-shopify-request-id") ??
					undefined;
				const retryAfter = Number.parseInt(
					response.headers.get("retry-after") ?? "",
					10,
				);
				throw this.requestError(
					errorKind,
					response.status === 401 || response.status === 403
						? "Shopify authorization failed."
						: response.status === 429
							? "Shopify request was throttled."
							: "Shopify upstream request failed.",
					{
						requestId,
						retryAfterSeconds: Number.isFinite(retryAfter)
							? retryAfter
							: undefined,
					},
				);
			}

			const contentLength = Number.parseInt(
				response.headers.get("content-length") ?? "0",
				10,
			);
			if (contentLength > this.maxResponseBytes) {
				throw this.requestError(errorKind, "Shopify response was too large.");
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw this.requestError(
					errorKind,
					"Shopify returned an empty response.",
				);
			}
			const chunks: Uint8Array[] = [];
			let size = 0;
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > this.maxResponseBytes) {
					await reader.cancel();
					throw this.requestError(errorKind, "Shopify response was too large.");
				}
				chunks.push(value);
			}

			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			try {
				return {
					value: JSON.parse(new TextDecoder().decode(bytes)) as T,
					requestId:
						response.headers.get("x-request-id") ??
						response.headers.get("x-shopify-request-id") ??
						undefined,
				};
			} catch {
				throw this.requestError(errorKind, "Shopify returned invalid JSON.");
			}
		} catch (error) {
			if (controller.signal.aborted) {
				throw new ShopifyTransportError("Shopify request timed out.");
			}
			if (error instanceof ShopifyIntegrationError) {
				throw error;
			}
			throw new ShopifyTransportError();
		} finally {
			clearTimeout(timeout);
		}
	}

	private requestError(
		errorKind: "credentials" | "admin",
		message: string,
		metadata: { requestId?: string; retryAfterSeconds?: number } = {},
	): ShopifyCredentialsError | ShopifyAdminApiError {
		return errorKind === "credentials"
			? new ShopifyCredentialsError(message)
			: new ShopifyAdminApiError(
					message,
					metadata,
					message === "Shopify authorization failed."
						? "credentials"
						: "upstream",
				);
	}
}
