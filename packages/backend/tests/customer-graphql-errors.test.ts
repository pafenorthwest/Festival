import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { AppError } from "@festival/common";
import { throwCustomerGraphqlErrors } from "../src/domains/customer-identity/customer-graphql-errors.js";

let warning: ReturnType<typeof spyOn<typeof console, "warn">>;
beforeEach(() => {
	warning = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warning.mockRestore());

function fail(
	payload: Record<string, unknown>,
	operation: "customer_identity" | "customer_orders" = "customer_orders",
) {
	try {
		throwCustomerGraphqlErrors(payload, operation);
	} catch (error) {
		if (error instanceof AppError) return error;
		throw error;
	}
	throw new Error("Expected provider error");
}
function diagnostic() {
	return JSON.parse(String(warning.mock.calls[0]?.[0]));
}

describe("Customer Account GraphQL failure diagnostics", () => {
	for (const [providerCode, status, code, category] of [
		["ACCESS_DENIED", 403, "customer_account_access_denied", "access_denied"],
		["THROTTLED", 503, "customer_account_throttled", "throttled"],
		[
			"INTERNAL_SERVER_ERROR",
			503,
			"customer_account_upstream_error",
			"provider_internal",
		],
		[
			"GRAPHQL_VALIDATION_FAILED",
			503,
			"customer_account_query_error",
			"schema",
		],
		["GRAPHQL_PARSE_FAILED", 503, "customer_account_query_error", "schema"],
		["undefinedField", 503, "customer_account_query_error", "schema"],
	] as const) {
		it(`classifies ${providerCode} without exposing provider messages`, () => {
			const error = fail({
				errors: [
					{
						message: "secret provider payload",
						extensions: { code: providerCode },
					},
				],
			});
			expect(error.status).toBe(status);
			expect(error.code).toBe(code);
			expect(error.message).toBe("Customer order access is unavailable.");
			expect(error.details).toBeUndefined();
			expect(warning).toHaveBeenCalledTimes(1);
			expect(diagnostic()).toMatchObject({
				operation: "customer_orders",
				category,
				codes: [providerCode],
			});
			expect(JSON.stringify(warning.mock.calls)).not.toContain(
				"secret provider payload",
			);
		});
	}

	it("preserves the generic denial contract for unrecognized or absent provider codes", () => {
		for (const entry of [
			{ message: "protected data denied" },
			{ extensions: { code: "UNKNOWN_UPSTREAM_CODE" } },
			"invalid error",
		]) {
			const error = fail({ errors: [entry] });
			expect(error.status).toBe(403);
			expect(error.code).toBeUndefined();
		}
		expect(diagnostic().category).toBe("unknown");
		expect(diagnostic().codes).toEqual([]);
	});

	it("reports only fixed path fields and numeric cost data for the identity operation", () => {
		fail(
			{
				errors: [
					{
						extensions: { code: "THROTTLED" },
						path: [
							"customer",
							"orders",
							42,
							"lineItems",
							"gid://shopify/Order/123",
							"totalPrice",
						],
					},
				],
				extensions: {
					cost: {
						requestedQueryCost: 7_500,
						actualQueryCost: 20,
						throttleStatus: {
							maximumAvailable: 7_500,
							currentlyAvailable: 10.5,
							restoreRate: 100,
						},
					},
				},
			},
			"customer_identity",
		);
		expect(diagnostic()).toMatchObject({
			operation: "customer_identity",
			paths: ["customer.orders.lineItems.totalPrice"],
			cost: { requestedQueryCost: 7_500, actualQueryCost: 20 },
			throttle: {
				maximumAvailable: 7_500,
				currentlyAvailable: 10.5,
				restoreRate: 100,
			},
		});
		expect(JSON.stringify(warning.mock.calls)).not.toContain("gid://");
	});

	it("never logs arbitrary error data, tokens, request variables or successful customer payloads", () => {
		const secrets = [
			"private-access-token",
			"private-refresh-token",
			"private-customer-email",
			"gid://shopify/Customer/12345",
		];
		const error = fail({
			errors: [
				{
					message: secrets[0],
					path: [secrets[1]],
					extensions: { code: secrets[2], extra: secrets[3] },
				},
			],
			data: { customer: { email: secrets[2], id: secrets[3] } },
			headers: { Authorization: secrets[0] },
			variables: { secret: secrets[1] },
			extensions: {
				cost: {
					requestedQueryCost: secrets[0],
					throttleStatus: { restoreRate: secrets[1] },
				},
			},
		});
		for (const secret of secrets) {
			expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
			expect(JSON.stringify(error)).not.toContain(secret);
		}
		expect(diagnostic()).toMatchObject({
			codes: [],
			paths: [],
			cost: {},
			throttle: {},
		});
	});

	it("omits nonfinite, negative, nonnumeric and excessive costs and caps error metadata", () => {
		fail({
			errors: Array.from({ length: 1_200 }, () => ({
				extensions: { code: "THROTTLED" },
				path: Array(100).fill("customer"),
			})),
			extensions: {
				cost: {
					requestedQueryCost: Infinity,
					actualQueryCost: 1_000_000_001,
					throttleStatus: {
						maximumAvailable: NaN,
						currentlyAvailable: -1,
						restoreRate: "100",
					},
				},
			},
		});
		const event = diagnostic();
		expect(event.errorCount).toBe(1_000);
		expect(event.codes).toEqual(["THROTTLED"]);
		expect(event.paths).toEqual([Array(12).fill("customer").join(".")]);
		expect(event.cost).toEqual({});
		expect(event.throttle).toEqual({});
		expect(JSON.stringify(event).length).toBeLessThan(1_000);
	});

	it("does not log successful responses or empty errors", () => {
		throwCustomerGraphqlErrors(
			{ data: { customer: { id: "private-id" } } },
			"customer_identity",
		);
		throwCustomerGraphqlErrors(
			{ errors: [], data: { customer: {} } },
			"customer_orders",
		);
		expect(warning).not.toHaveBeenCalled();
	});
});
