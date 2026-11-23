import { describe, expect, it } from "bun:test";
import {
	ShopifyPendingCheckoutOrders,
	type ShopifyPendingCheckoutOrdersOptions,
} from "../src/checkout/shopify-pending-checkout-orders.js";
import { ShopifyGraphqlTransport } from "../src/domains/commerce-projection/shopify-graphql-transport.js";
import type { ShopifyIntegrationRecord } from "../src/repo/organization-repository-types.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

const NOW = Date.parse("2026-11-16T01:00:00.000Z");
const DOMAIN = "festival.myshopify.com";
const CUSTOMER = "gid://shopify/Customer/12";
const INPUT = {
	organizationId: "org",
	shopifyCustomerGid: CUSTOMER,
	sinceIso: "2026-11-15T00:00:00.000Z",
	expectedShopDomain: DOMAIN,
};

function bag(amount: string, currencyCode = "USD") {
	return { presentmentMoney: { amount, currencyCode } };
}

function order(id = 100, status = "PARTIALLY_PAID") {
	return {
		id: `gid://shopify/Order/${id}`,
		createdAt: "2026-11-15T00:10:00.000Z",
		displayFinancialStatus: status,
		fullyPaid: status === "PAID",
		cancelledAt: null,
		customer: { id: CUSTOMER },
		customAttributes: [
			{ key: "festival_checkout_intent_id", value: "checkout-reference" },
		],
		totalReceivedSet: bag("40.00"),
		totalOutstandingSet: bag("60.00"),
		totalRefundedSet: bag("0.00"),
		lineItems: {
			nodes: [
				{
					quantity: 1,
					variant: { id: "gid://shopify/ProductVariant/34" },
					customAttributes: [
						{ key: "festival_checkout_intent_line_id", value: "line-a" },
					],
				},
			],
			pageInfo: { hasNextPage: false },
		},
	};
}

function page(
	nodes: unknown[],
	hasNextPage = false,
	endCursor: unknown = "end",
) {
	return {
		shop: { id: "gid://shopify/Shop/10", myshopifyDomain: DOMAIN },
		orders: {
			nodes,
			pageInfo: { hasNextPage, endCursor: nodes.length ? endCursor : null },
		},
	};
}

function fixture(
	pages: unknown[],
	options: ShopifyPendingCheckoutOrdersOptions = {},
	settings: {
		integration?: Partial<ShopifyIntegrationRecord>;
		tokenScopes?: string;
		graphql?: () => Promise<Response>;
	} = {},
) {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 5).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("Expected keyring.");
	const integration: ShopifyIntegrationRecord = {
		organizationId: "org",
		storeDomain: DOMAIN,
		clientId: "test-app",
		encryptedClientSecret: keyring.encrypt("test-secret", {
			organizationId: "org",
			purpose: "shopify-client-secret",
		}),
		verificationStatus: "ok",
		verifiedShopGid: "gid://shopify/Shop/10",
		verifiedShopDomain: DOMAIN,
		grantedScopes: ["read_orders"],
		capabilities: {
			read_products: "missing",
			write_products: "missing",
			write_inventory: "missing",
			read_orders: "granted",
			write_orders: "disabled",
		},
		integrationVersion: 1,
		webhookReadinessStatus: "ready",
		createdAtIso: "2026-11-01T00:00:00.000Z",
		updatedAtIso: "2026-11-01T00:00:00.000Z",
		...settings.integration,
	};
	const calls: Array<{
		url: string;
		query: string;
		variables: Record<string, unknown>;
	}> = [];
	let tokenCalls = 0;
	let pageIndex = 0;
	const transport = new ShopifyGraphqlTransport({
		now: () => NOW,
		fetch: async (input, init) => {
			const url = String(input);
			if (url.endsWith("/admin/oauth/access_token")) {
				tokenCalls += 1;
				return Response.json({
					access_token: "test-token",
					scope: settings.tokenScopes ?? "read_orders",
					expires_in: 3_600,
				});
			}
			const body = JSON.parse(String(init?.body)) as {
				query: string;
				variables: Record<string, unknown>;
			};
			calls.push({ url, ...body });
			if (settings.graphql) return settings.graphql();
			if (pageIndex >= pages.length) throw new Error("Unexpected extra page.");
			return Response.json({ data: pages[pageIndex++] });
		},
	});
	const reader = new ShopifyPendingCheckoutOrders(
		{ getShopifyIntegration: async () => integration },
		keyring,
		transport,
		{ now: () => NOW, ...options },
	);
	return { reader, calls, tokenCalls: () => tokenCalls };
}

describe("ShopifyPendingCheckoutOrders", () => {
	it("reads later pages across all payment states and preserves exact same-variant line identities", async () => {
		const partial = order();
		partial.lineItems.nodes.push({
			...partial.lineItems.nodes[0],
			customAttributes: [
				{ key: "festival_checkout_intent_line_id", value: "line-b" },
			],
		});
		const { reader, calls, tokenCalls } = fixture([
			page([order(101, "PENDING")], true, "cursor-one"),
			page([partial], false, "cursor-two"),
		]);
		const result = await reader.listCustomerOrders(INPUT);
		expect(result.complete).toBe(true);
		expect(result.orders).toHaveLength(2);
		expect(result.orders[1]).toMatchObject({
			correlationId: "checkout-reference",
			financialStatus: "PARTIALLY_PAID",
			received: { amount: "40.00", currencyCode: "USD" },
			outstanding: { amount: "60.00", currencyCode: "USD" },
			lines: [
				{ intentLineId: "line-a", quantity: 1 },
				{ intentLineId: "line-b", quantity: 1 },
			],
		});
		expect(tokenCalls()).toBe(1);
		expect(calls[0]?.url).toBe(
			`https://${DOMAIN}/admin/api/2026-07/graphql.json`,
		);
		expect(calls[0]?.variables).toEqual({
			first: 2,
			after: null,
			query: "customer_id:12 created_at:>='2026-11-14T23:55:00.000Z'",
		});
		expect(calls[1]?.variables.after).toBe("cursor-one");
		expect(calls[0]?.variables.query).not.toContain("financial_status");
		expect(calls[0]?.variables.query).not.toContain("status:");
		expect(calls[0]?.query).toContain("sortKey: CREATED_AT");
		expect(calls[0]?.query).not.toContain("mutation");
	});

	for (const status of [
		"AUTHORIZED",
		"PENDING",
		"PAID",
		"PARTIALLY_PAID",
		"PARTIALLY_REFUNDED",
		"REFUNDED",
		"VOIDED",
		"EXPIRED",
	]) {
		it(`retains ${status} order facts without paid-registration validation`, async () => {
			const raw = order(100, status);
			raw.totalRefundedSet = bag("20.00");
			raw.totalOutstandingSet = bag("-10.00");
			const { reader } = fixture([page([raw])]);
			const result = await reader.listCustomerOrders(INPUT);
			expect(result.complete).toBe(true);
			expect(result.orders[0]).toMatchObject({
				financialStatus: status,
				refunded: { amount: "20.00", currencyCode: "USD" },
				outstanding: { amount: "-10.00", currencyCode: "USD" },
			});
		});
	}

	it("distinguishes a verified empty result from missing data", async () => {
		const { reader } = fixture([page([])]);
		expect(await reader.listCustomerOrders(INPUT)).toEqual({
			orders: [],
			complete: true,
		});
		const missing = fixture([{}]);
		expect(await missing.reader.listCustomerOrders(INPUT)).toEqual({
			orders: [],
			complete: false,
		});
	});

	for (const sinceIso of [
		"2026-09-01T00:00:00.000Z",
		"not-a-date",
		"2026-11-15",
		"2026-11-16T01:01:00.000Z",
	]) {
		it(`withholds completeness for inaccessible/invalid window ${sinceIso}`, async () => {
			const { reader, calls, tokenCalls } = fixture([]);
			expect(await reader.listCustomerOrders({ ...INPUT, sinceIso })).toEqual({
				orders: [],
				complete: false,
			});
			expect(calls).toHaveLength(0);
			expect(tokenCalls()).toBe(0);
		});
	}

	it("rejects a customer ID that cannot form the supported numeric customer filter", async () => {
		const { reader, tokenCalls } = fixture([]);
		expect(
			await reader.listCustomerOrders({
				...INPUT,
				shopifyCustomerGid: "gid://shopify/Customer/12 OR customer_id:13",
			}),
		).toEqual({ orders: [], complete: false });
		expect(tokenCalls()).toBe(0);
	});

	for (const integration of [
		{ organizationId: "other-org" },
		{ verificationStatus: "failed" as const },
		{ verifiedShopDomain: "other.myshopify.com" },
		{ storeDomain: "other.myshopify.com" },
		{ verifiedShopGid: undefined },
		{ grantedScopes: [] },
		{ encryptedClientSecret: "corrupt" },
	]) {
		it(`refuses unauthorized integration ${JSON.stringify(integration)}`, async () => {
			const { reader, tokenCalls } = fixture([], {}, { integration });
			await expect(reader.listCustomerOrders(INPUT)).rejects.toThrow();
			expect(tokenCalls()).toBe(0);
		});
	}

	it("verifies effective token read_orders scope before querying orders", async () => {
		const { reader, calls, tokenCalls } = fixture(
			[],
			{},
			{ tokenScopes: "read_products" },
		);
		await expect(reader.listCustomerOrders(INPUT)).rejects.toThrow();
		expect(tokenCalls()).toBe(2);
		expect(calls).toHaveLength(0);
	});

	it("does not accept order facts from another returned shop or customer", async () => {
		const wrongShop = page([order()]);
		wrongShop.shop.id = "gid://shopify/Shop/11";
		const first = fixture([wrongShop]);
		expect(await first.reader.listCustomerOrders(INPUT)).toEqual({
			orders: [],
			complete: false,
		});
		const wrongCustomer = order();
		wrongCustomer.customer.id = "gid://shopify/Customer/13";
		const second = fixture([page([wrongCustomer])]);
		expect(await second.reader.listCustomerOrders(INPUT)).toEqual({
			orders: [],
			complete: false,
		});
	});

	for (const endCursor of [undefined, null, "", "   "]) {
		it(`cannot claim complete pagination with cursor ${String(endCursor)}`, async () => {
			const raw = page([order()], true, endCursor);
			raw.orders.pageInfo.endCursor = endCursor;
			const { reader } = fixture([raw]);
			expect((await reader.listCustomerOrders(INPUT)).complete).toBe(false);
		});
	}

	it("detects a cursor cycle and duplicate orders across pages", async () => {
		const cursorCycle = fixture([
			page([order()], true, "same-cursor"),
			page([order(101)], false, "same-cursor"),
		]);
		expect((await cursorCycle.reader.listCustomerOrders(INPUT)).complete).toBe(
			false,
		);
		const duplicate = fixture([
			page([order()], true, "one"),
			page([order()], false, "two"),
		]);
		expect((await duplicate.reader.listCustomerOrders(INPUT)).complete).toBe(
			false,
		);
	});

	for (const options of [{ maxPages: 1 }, { maxOrders: 1 }]) {
		it(`returns incomplete rather than absence at limit ${JSON.stringify(options)}`, async () => {
			const { reader, calls } = fixture(
				[page([order()], true, "more")],
				options,
			);
			const result = await reader.listCustomerOrders(INPUT);
			expect(result.complete).toBe(false);
			expect(result.orders).toHaveLength(1);
			expect(calls).toHaveLength(1);
		});
	}

	for (const change of [
		(raw: ReturnType<typeof order>) => {
			raw.lineItems.pageInfo.hasNextPage = true;
		},
		(raw: ReturnType<typeof order>) => {
			raw.lineItems.nodes[0].quantity = 0;
		},
		(raw: ReturnType<typeof order>) => {
			raw.lineItems.nodes[0].customAttributes.push({
				key: "festival_checkout_intent_line_id",
				value: "line-b",
			});
		},
		(raw: ReturnType<typeof order>) => {
			raw.customAttributes.push({
				key: "festival_checkout_intent_id",
				value: "other-checkout",
			});
		},
	]) {
		it("withholds completeness for truncated or ambiguous registration identities", async () => {
			const raw = order();
			change(raw);
			const { reader } = fixture([page([raw])]);
			const result = await reader.listCustomerOrders(INPUT);
			expect(result.complete).toBe(false);
			expect(result.orders[0]?.financialStatus).toBe("PARTIALLY_PAID");
		});
	}

	for (const invalid of ["NaN", "1e2", "-1.00", "40..00", " 40.00"]) {
		it(`never converts malformed received amount ${invalid} into zero`, async () => {
			const raw = order();
			raw.totalReceivedSet = bag(invalid);
			const { reader } = fixture([page([raw])]);
			const result = await reader.listCustomerOrders(INPUT);
			expect(result.complete).toBe(false);
			expect(result.orders[0]?.received).toBeNull();
			expect(result.orders[0]?.outstanding).toBeNull();
		});
	}

	it("withholds all displayed amounts for conflicting currencies", async () => {
		const raw = order();
		raw.totalOutstandingSet = bag("60.00", "CAD");
		const { reader } = fixture([page([raw])]);
		const result = await reader.listCustomerOrders(INPUT);
		expect(result.complete).toBe(false);
		expect(result.orders[0]).toMatchObject({
			received: null,
			outstanding: null,
			refunded: null,
		});
	});

	it("does not treat an unknown future financial status as complete evidence", async () => {
		const { reader } = fixture([page([order(100, "NEW_PROVIDER_STATUS")])]);
		expect((await reader.listCustomerOrders(INPUT)).complete).toBe(false);
	});

	it("bounds the overall read and does not follow pages after the deadline", async () => {
		let release: ((response: Response) => void) | undefined;
		const { reader, calls } = fixture(
			[],
			{ maxElapsedMs: 5 },
			{
				graphql: () =>
					new Promise<Response>((resolve) => {
						release = resolve;
					}),
			},
		);
		expect(await reader.listCustomerOrders(INPUT)).toEqual({
			orders: [],
			complete: false,
		});
		expect(calls).toHaveLength(1);
		release?.(Response.json({ data: page([order()], true, "later") }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toHaveLength(1);
	});
});
