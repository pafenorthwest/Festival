import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
} from "./shopify-errors.js";
import {
	mapOrderCustomerProfile,
	mapPaidOrderNode,
	type ShopifyOrderAddressNode,
	type ShopifyOrderCustomerContactNode,
	type ShopifyOrderNode,
} from "./shopify-graphql-mappers.js";
import type { ShopifyGraphqlTransport } from "./shopify-graphql-transport.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "./shopify-types.js";

const DEFAULT_PAID_ORDER_LIST_LIMIT = 50;
const MAX_PAID_ORDER_LIST_LIMIT = 100;

const PAID_ORDER_FIELDS = `
	id
	fullyPaid
	currencyCode
	customer {
		id
		email
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
			customAttributes {
				key
				value
			}
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
`;

const READ_PAID_ORDER_QUERY = `
			query ReadPaidOrder($orderId: ID!) {
				order(id: $orderId) {
					id
					fullyPaid
					currencyCode
					customer {
						id
						email
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
							customAttributes {
								key
								value
							}
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
		`;

const READ_ORDER_CUSTOMER_PROFILE_QUERY = `
	query ReadPaidOrderCustomerProfile($orderId: ID!) {
		order(id: $orderId) {
			shippingAddress {
				address1
				address2
				city
				province
				zip
				countryCodeV2
			}
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
`;

const LIST_PAID_ORDERS_SINCE_QUERY = `
	query ListPaidOrdersSince($first: Int!, $query: String!) {
		orders(
			first: $first
			query: $query
			sortKey: PROCESSED_AT
			reverse: true
		) {
			nodes { ${PAID_ORDER_FIELDS} }
			pageInfo {
				hasNextPage
			}
		}
	}
`;

export class ShopifyOrdersAdminClient implements ShopifyPaidOrderReader {
	constructor(private readonly transport: ShopifyGraphqlTransport) {}

	async readPaidOrderByGid(
		context: ShopifyAdminOperationContext,
		orderGid: string,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder | null>> {
		this.transport.assertOperationContext(context, "read_orders");
		if (!/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(orderGid)) {
			throw new ShopifyCredentialsError("Shopify order ID is invalid.");
		}
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.transport.graphqlRequest<{
			order?: ShopifyOrderNode | null;
		}>(context.credentials.storeDomain, accessToken, READ_PAID_ORDER_QUERY, {
			orderId: orderGid,
		});
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
		this.transport.assertOperationContext(context, "read_orders");
		if (!/^gid:\/\/shopify\/Order\/[^/?#\s]+$/.test(orderGid)) {
			throw new ShopifyCredentialsError("Shopify order ID is invalid.");
		}
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.transport.graphqlRequest<{
			order?: {
				customer?: ShopifyOrderCustomerContactNode | null;
				shippingAddress?: ShopifyOrderAddressNode | null;
			} | null;
		}>(
			context.credentials.storeDomain,
			accessToken,
			READ_ORDER_CUSTOMER_PROFILE_QUERY,
			{ orderId: orderGid },
		);
		return {
			value: mapOrderCustomerProfile(
				response.value.order?.customer,
				response.value.order?.shippingAddress,
			),
			requestId: response.requestId,
		};
	}

	async listPaidOrdersSince(
		context: ShopifyAdminOperationContext,
		sinceIso: string,
		first = DEFAULT_PAID_ORDER_LIST_LIMIT,
	): Promise<ShopifyAdminResult<ShopifyPaidOrder[]>> {
		this.transport.assertOperationContext(context, "read_orders");
		const normalizedSinceIso =
			this.transport.normalizePaidOrderReadSince(sinceIso);
		if (
			!Number.isSafeInteger(first) ||
			first <= 0 ||
			first > MAX_PAID_ORDER_LIST_LIMIT
		) {
			throw new Error("Shopify paid order read limit is invalid.");
		}
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const response = await this.transport.graphqlRequest<{
			orders?: {
				nodes?: Array<ShopifyOrderNode | null>;
				pageInfo?: { hasNextPage?: boolean };
			};
		}>(
			context.credentials.storeDomain,
			accessToken,
			LIST_PAID_ORDERS_SINCE_QUERY,
			{
				first,
				query: `financial_status:paid processed_at:>='${normalizedSinceIso}'`,
			},
		);
		return {
			value: this.mapPaidOrderList(response),
			requestId: response.requestId,
		};
	}

	private mapPaidOrderList(
		response: ShopifyAdminResult<{
			orders?: {
				nodes?: Array<ShopifyOrderNode | null>;
				pageInfo?: { hasNextPage?: boolean };
			};
		}>,
	): ShopifyPaidOrder[] {
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
		return orders.nodes.map((node) => {
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
		});
	}
}
