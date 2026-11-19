import { AppError } from "@festival/common";

type Operation = "customer_identity" | "customer_orders";
const KNOWN_CODES = new Set([
	"ACCESS_DENIED",
	"THROTTLED",
	"INTERNAL_SERVER_ERROR",
	"GRAPHQL_VALIDATION_FAILED",
	"GRAPHQL_PARSE_FAILED",
	"undefinedField",
	"argumentNotAccepted",
	"selectionMismatch",
	"variableRequiresValidType",
	"variableNotUsed",
]);
const SCHEMA_CODES = new Set([
	"GRAPHQL_VALIDATION_FAILED",
	"GRAPHQL_PARSE_FAILED",
	"undefinedField",
	"argumentNotAccepted",
	"selectionMismatch",
	"variableRequiresValidType",
	"variableNotUsed",
]);
const QUERY_FIELDS = new Set([
	"customer",
	"id",
	"orders",
	"nodes",
	"number",
	"createdAt",
	"totalPrice",
	"amount",
	"currencyCode",
	"financialStatus",
	"fulfillmentStatus",
	"cancelledAt",
	"cancelReason",
	"totalRefunded",
	"lineItems",
	"title",
	"quantity",
	"pageInfo",
	"hasNextPage",
	"endCursor",
]);

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numericFields(value: unknown, fields: readonly string[]) {
	if (!record(value)) return {};
	return Object.fromEntries(
		fields.flatMap((key) => {
			const number = value[key];
			return typeof number === "number" &&
				Number.isFinite(number) &&
				number >= 0 &&
				number <= 1_000_000_000
				? [[key, number]]
				: [];
		}),
	);
}

/** Reports fixed metadata only; provider messages and response data are never diagnostics. */
export function throwCustomerGraphqlErrors(
	result: Record<string, unknown>,
	operation: Operation,
): void {
	if (!Array.isArray(result.errors) || !result.errors.length) return;
	const errors = result.errors.slice(0, 20);
	const codes = [
		...new Set(
			errors.flatMap((error) => {
				const code =
					record(error) && record(error.extensions)
						? error.extensions.code
						: null;
				return typeof code === "string" && KNOWN_CODES.has(code) ? [code] : [];
			}),
		),
	].slice(0, 8);
	const paths = [
		...new Set(
			errors.flatMap((error) => {
				if (!record(error) || !Array.isArray(error.path)) return [];
				const fields = error.path
					.slice(0, 12)
					.filter(
						(field): field is string =>
							typeof field === "string" && QUERY_FIELDS.has(field),
					);
				return fields.length ? [fields.join(".")] : [];
			}),
		),
	].slice(0, 8);
	const category = codes.includes("ACCESS_DENIED")
		? "access_denied"
		: codes.includes("THROTTLED")
			? "throttled"
			: codes.includes("INTERNAL_SERVER_ERROR")
				? "provider_internal"
				: codes.some((code) => SCHEMA_CODES.has(code))
					? "schema"
					: "unknown";
	const extensions = record(result.extensions) ? result.extensions : {};
	const cost = record(extensions.cost) ? extensions.cost : {};
	console.warn(
		JSON.stringify({
			event: "shopify_customer_account_graphql_failure",
			operation,
			category,
			codes,
			paths,
			errorCount: Math.min(result.errors.length, 1_000),
			cost: numericFields(cost, ["requestedQueryCost", "actualQueryCost"]),
			throttle: numericFields(cost.throttleStatus, [
				"maximumAvailable",
				"currentlyAvailable",
				"restoreRate",
			]),
		}),
	);
	const code =
		category === "access_denied"
			? "customer_account_access_denied"
			: category === "throttled"
				? "customer_account_throttled"
				: category === "provider_internal"
					? "customer_account_upstream_error"
					: category === "schema"
						? "customer_account_query_error"
						: undefined;
	throw new AppError(
		"Customer order access is unavailable.",
		category === "unknown" || category === "access_denied" ? 403 : 503,
		code,
	);
}
