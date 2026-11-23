import type {
	PendingCheckoutMoney,
	PendingCheckoutOrder,
	PendingCheckoutOrderReader,
} from "../domains/class-checkout/pending-checkout-types.js";
import { ShopifyCredentialsError } from "../domains/commerce-projection/shopify-errors.js";
import { ShopifyGraphqlTransport } from "../domains/commerce-projection/shopify-graphql-transport.js";
import {
	assertShopifyOrderReadWindow,
	type ShopifyAdminOperationContext,
	type ShopifyAdminResult,
} from "../domains/commerce-projection/shopify-types.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";

const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const CUSTOMER_GID = /^gid:\/\/shopify\/Customer\/([1-9]\d*)$/;
const OVERLAP_MS = 5 * 60_000;
// Two orders with up to 250 lines each stay below Shopify's 1,000-point query limit.
const PAGE_SIZE = 2;
const FINANCIAL_STATUSES = new Set([
	"AUTHORIZED",
	"EXPIRED",
	"PAID",
	"PARTIALLY_PAID",
	"PARTIALLY_REFUNDED",
	"PENDING",
	"REFUNDED",
	"VOIDED",
]);

const CUSTOMER_ORDERS_QUERY = `
	query FestivalPendingCheckoutOrders($first: Int!, $after: String, $query: String!) {
		shop { id myshopifyDomain }
		orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
			nodes {
				id createdAt displayFinancialStatus fullyPaid cancelledAt
				customer { id }
				customAttributes { key value }
				totalReceivedSet { presentmentMoney { amount currencyCode } }
				totalOutstandingSet { presentmentMoney { amount currencyCode } }
				totalRefundedSet { presentmentMoney { amount currencyCode } }
				lineItems(first: 250) {
					nodes { quantity variant { id } customAttributes { key value } }
					pageInfo { hasNextPage }
				}
			}
			pageInfo { hasNextPage endCursor }
		}
	}
`;

export interface ShopifyPendingCheckoutOrdersOptions {
	now?: () => number;
	maxPages?: number;
	maxOrders?: number;
	maxElapsedMs?: number;
}

type ReadResult = { orders: PendingCheckoutOrder[]; complete: boolean };

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function attribute(
	values: unknown,
	key: string,
): { value: string | null; complete: boolean } {
	if (
		!Array.isArray(values) ||
		values.some(
			(value) =>
				!record(value) ||
				typeof value.key !== "string" ||
				typeof value.value !== "string",
		)
	) {
		return { value: null, complete: false };
	}
	const matches = values.filter((value) => value.key === key);
	if (matches.length > 1) return { value: null, complete: false };
	const value = matches[0]?.value;
	return {
		value: typeof value === "string" && value.trim() ? value : null,
		complete:
			value === undefined || (typeof value === "string" && !!value.trim()),
	};
}

function money(value: unknown, signed = false): PendingCheckoutMoney | null {
	if (!record(value) || !record(value.presentmentMoney)) return null;
	const { amount, currencyCode } = value.presentmentMoney;
	if (
		typeof amount !== "string" ||
		amount.length > 128 ||
		!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) ||
		(!signed && amount.startsWith("-")) ||
		typeof currencyCode !== "string" ||
		!/^[A-Z]{3}$/.test(currencyCode)
	) {
		return null;
	}
	return { amount, currencyCode };
}

function mapOrder(
	value: unknown,
	customerGid: string,
	sinceMs: number,
): { order: PendingCheckoutOrder | null; complete: boolean } {
	if (
		!record(value) ||
		typeof value.id !== "string" ||
		!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(value.id) ||
		!record(value.customer) ||
		value.customer.id !== customerGid ||
		typeof value.createdAt !== "string" ||
		!Number.isFinite(Date.parse(value.createdAt)) ||
		Date.parse(value.createdAt) < sinceMs ||
		typeof value.displayFinancialStatus !== "string" ||
		typeof value.fullyPaid !== "boolean" ||
		(value.cancelledAt !== null &&
			(typeof value.cancelledAt !== "string" ||
				!Number.isFinite(Date.parse(value.cancelledAt))))
	) {
		return { order: null, complete: false };
	}
	const correlation = attribute(
		value.customAttributes,
		"festival_checkout_intent_id",
	);
	let complete =
		correlation.complete &&
		FINANCIAL_STATUSES.has(value.displayFinancialStatus);
	let received = money(value.totalReceivedSet);
	let outstanding = money(value.totalOutstandingSet, true);
	let refunded = money(value.totalRefundedSet);
	if (
		!received ||
		!outstanding ||
		!refunded ||
		received.currencyCode !== outstanding.currencyCode ||
		received.currencyCode !== refunded.currencyCode
	) {
		received = outstanding = refunded = null;
		complete = false;
	}
	const lines: PendingCheckoutOrder["lines"] = [];
	if (
		!record(value.lineItems) ||
		!Array.isArray(value.lineItems.nodes) ||
		value.lineItems.nodes.length === 0 ||
		value.lineItems.nodes.length > 250 ||
		!record(value.lineItems.pageInfo) ||
		value.lineItems.pageInfo.hasNextPage !== false
	) {
		complete = false;
	} else {
		for (const line of value.lineItems.nodes) {
			if (
				!record(line) ||
				!record(line.variant) ||
				typeof line.variant.id !== "string" ||
				!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(line.variant.id) ||
				!Number.isSafeInteger(line.quantity) ||
				(line.quantity as number) < 1
			) {
				complete = false;
				continue;
			}
			const identity = attribute(
				line.customAttributes,
				"festival_checkout_intent_line_id",
			);
			complete &&= identity.complete;
			lines.push({
				intentLineId: identity.value,
				variantGid: line.variant.id,
				quantity: line.quantity as number,
			});
		}
	}
	return {
		order: {
			id: value.id,
			customerGid,
			correlationId: correlation.value,
			financialStatus: value.displayFinancialStatus,
			fullyPaid: value.fullyPaid,
			cancelledAtIso: value.cancelledAt as string | null,
			received,
			outstanding,
			refunded,
			lines,
		},
		complete,
	};
}

/** Live read-only discovery; results never enter the paid-order approval mapper. */
export class ShopifyPendingCheckoutOrders
	implements PendingCheckoutOrderReader
{
	private readonly now: () => number;
	private readonly maxPages: number;
	private readonly maxOrders: number;
	private readonly maxElapsedMs: number;

	constructor(
		private readonly organizations: Pick<
			OrganizationRepository,
			"getShopifyIntegration"
		>,
		private readonly keyring: ShopifySecretKeyring,
		private readonly transport = new ShopifyGraphqlTransport({
			requestTimeoutMs: 3_000,
		}),
		options: ShopifyPendingCheckoutOrdersOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.maxPages = options.maxPages ?? 25;
		this.maxOrders = options.maxOrders ?? 50;
		this.maxElapsedMs = options.maxElapsedMs ?? 8_000;
		for (const limit of [this.maxPages, this.maxOrders, this.maxElapsedMs]) {
			if (!Number.isSafeInteger(limit) || limit < 1) {
				throw new Error("Pending checkout discovery limit is invalid.");
			}
		}
	}

	async listCustomerOrders(
		input: Parameters<PendingCheckoutOrderReader["listCustomerOrders"]>[0],
	): Promise<ReadResult> {
		const customerId = input.shopifyCustomerGid.match(CUSTOMER_GID)?.[1];
		const since = new Date(Date.parse(input.sinceIso) - OVERLAP_MS);
		const now = new Date(this.now());
		if (
			!customerId ||
			!/(?:Z|[+-]\d{2}:\d{2})$/.test(input.sinceIso) ||
			!Number.isFinite(now.getTime()) ||
			Date.parse(input.sinceIso) > now.getTime()
		) {
			return { orders: [], complete: false };
		}
		try {
			assertShopifyOrderReadWindow(since, now);
		} catch {
			return { orders: [], complete: false };
		}
		let expired = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<ReadResult>((resolve) => {
			timer = setTimeout(() => {
				expired = true;
				resolve({ orders: [], complete: false });
			}, this.maxElapsedMs);
		});
		try {
			return await Promise.race([
				this.readPages(input, customerId, since, () => expired),
				timeout,
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	private async context(
		organizationId: string,
		expectedShopDomain: string,
	): Promise<ShopifyAdminOperationContext> {
		const integration =
			await this.organizations.getShopifyIntegration(organizationId);
		if (
			!integration ||
			integration.organizationId !== organizationId ||
			integration.verificationStatus !== "ok" ||
			!integration.verifiedShopGid?.match(
				/^gid:\/\/shopify\/Shop\/[1-9]\d*$/,
			) ||
			!integration.verifiedShopDomain ||
			!DOMAIN.test(expectedShopDomain) ||
			integration.verifiedShopDomain !== expectedShopDomain ||
			integration.storeDomain !== expectedShopDomain ||
			!integration.grantedScopes.includes("read_orders")
		) {
			throw new ShopifyCredentialsError(
				"Shopify order discovery is not authorized for this storefront.",
			);
		}
		const context: ShopifyAdminOperationContext = {
			organizationId,
			firebaseActorUid: "system:pending-class-checkout",
			verifiedShopGid: integration.verifiedShopGid,
			verifiedShopDomain: expectedShopDomain,
			integrationVersion: integration.integrationVersion,
			grantedScopes: integration.grantedScopes,
			capability: "read_orders",
			credentials: {
				organizationId,
				storeDomain: expectedShopDomain,
				clientId: integration.clientId,
				clientSecret: this.keyring.decrypt(integration.encryptedClientSecret, {
					organizationId,
					purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
				}),
				integrationVersion: integration.integrationVersion,
			},
		};
		this.transport.assertOperationContext(context, "read_orders");
		return context;
	}

	private async readPages(
		input: Parameters<PendingCheckoutOrderReader["listCustomerOrders"]>[0],
		customerId: string,
		since: Date,
		expired: () => boolean,
	): Promise<ReadResult> {
		const context = await this.context(
			input.organizationId,
			input.expectedShopDomain,
		);
		if (expired()) return { orders: [], complete: false };
		const { accessToken } = await this.transport.fetchOperationAccessToken(
			context,
			"read_orders",
		);
		const orders: PendingCheckoutOrder[] = [];
		const cursors = new Set<string>();
		const orderIds = new Set<string>();
		let after: string | null = null;
		let complete = true;
		for (let page = 0; page < this.maxPages; page += 1) {
			if (expired()) return { orders, complete: false };
			const response: ShopifyAdminResult<unknown> =
				await this.transport.graphqlRequest<unknown>(
					context.verifiedShopDomain,
					accessToken,
					CUSTOMER_ORDERS_QUERY,
					{
						first: Math.min(PAGE_SIZE, this.maxOrders - orders.length),
						after,
						query: `customer_id:${customerId} created_at:>='${since.toISOString()}'`,
					},
				);
			const payload: unknown = response.value;
			if (
				expired() ||
				!record(payload) ||
				!record(payload.shop) ||
				payload.shop.id !== context.verifiedShopGid ||
				payload.shop.myshopifyDomain !== context.verifiedShopDomain ||
				!record(payload.orders) ||
				!Array.isArray(payload.orders.nodes) ||
				!record(payload.orders.pageInfo) ||
				typeof payload.orders.pageInfo.hasNextPage !== "boolean"
			) {
				return { orders, complete: false };
			}
			const nodes: unknown[] = payload.orders.nodes;
			const pageInfo: Record<string, unknown> = payload.orders.pageInfo;
			if (nodes.length > Math.min(PAGE_SIZE, this.maxOrders - orders.length)) {
				return { orders, complete: false };
			}
			for (const value of nodes) {
				const mapped = mapOrder(
					value,
					input.shopifyCustomerGid,
					since.getTime(),
				);
				complete &&= mapped.complete;
				if (!mapped.order) continue;
				if (orderIds.has(mapped.order.id)) return { orders, complete: false };
				orderIds.add(mapped.order.id);
				orders.push(mapped.order);
			}
			if (nodes.length === 0) {
				return {
					orders,
					complete:
						complete &&
						pageInfo.endCursor === null &&
						!pageInfo.hasNextPage &&
						after === null,
				};
			}
			const endCursor = pageInfo.endCursor;
			if (
				typeof endCursor !== "string" ||
				!endCursor.trim() ||
				cursors.has(endCursor)
			) {
				return { orders, complete: false };
			}
			if (!pageInfo.hasNextPage) return { orders, complete };
			if (orders.length >= this.maxOrders) return { orders, complete: false };
			after = endCursor;
			cursors.add(endCursor);
		}
		return { orders, complete: false };
	}
}
