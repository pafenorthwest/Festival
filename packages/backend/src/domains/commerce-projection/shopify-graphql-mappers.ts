import {
	ShopifyAdminApiError,
	ShopifyIntegrationError,
	ShopifyScopeError,
	ShopifyTransportError,
	ShopifyUserError,
	type ShopifyWebhookFailureStage,
	ShopifyWebhookOperationError,
} from "./shopify-errors.js";
import type {
	ShopifyOrderCustomerProfile,
	ShopifyPaidOrder,
	ShopifyPaidOrderLine,
	ShopifyProductDetails,
	ShopifyProductVariant,
} from "./shopify-types.js";

export interface ShopifyProductNode {
	id?: string;
	title?: string;
	descriptionHtml?: string;
	status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
	variants?: {
		nodes?: ShopifyVariantNode[];
		edges?: Array<{ node?: ShopifyVariantNode }>;
	};
}

export interface ShopifyVariantNode {
	id?: string;
	title?: string;
	price?: string | { amount?: string; currencyCode?: string };
	product?: { id?: string };
	selectedOptions?: Array<{ name?: string; value?: string }>;
	inventoryItem?: {
		id?: string;
		requiresShipping?: boolean | null;
	} | null;
}

export interface ShopifyOrderAttributeNode {
	key?: string;
	value?: string;
}

export interface ShopifyOrderMoneyNode {
	presentmentMoney?: {
		amount?: string;
		currencyCode?: string;
	};
}

export interface ShopifyOrderLineNode {
	id?: string;
	product?: { id?: string } | null;
	variant?: { id?: string } | null;
	quantity?: number;
	discountedTotalSet?: ShopifyOrderMoneyNode;
	customAttributes?: ShopifyOrderAttributeNode[];
}

export interface ShopifyOrderTransactionNode {
	kind?: string;
	status?: string;
	processedAt?: string | null;
}

export interface ShopifyOrderNode {
	id?: string;
	fullyPaid?: boolean;
	currencyCode?: string;
	customer?: { id?: string; email?: string | null } | null;
	customAttributes?: ShopifyOrderAttributeNode[];
	lineItems?: {
		nodes?: ShopifyOrderLineNode[];
		pageInfo?: { hasNextPage?: boolean };
	};
	transactions?: ShopifyOrderTransactionNode[];
}

export interface ShopifyOrderCustomerContactNode {
	firstName?: string | null;
	lastName?: string | null;
	email?: string | null;
	phone?: string | null;
	defaultAddress?: ShopifyOrderAddressNode | null;
}

export interface ShopifyOrderAddressNode {
	address1?: string | null;
	address2?: string | null;
	city?: string | null;
	province?: string | null;
	zip?: string | null;
	countryCodeV2?: string | null;
}

export interface ShopifyUserErrorPayload {
	field?: string[];
	message: string;
}

function mapVariantNode(
	variant: ShopifyVariantNode | undefined,
	productId: string,
	shopCurrencyCode: string,
): ShopifyProductVariant {
	if (!variant?.id) {
		throw new ShopifyAdminApiError("Shopify variant response was incomplete.");
	}
	if (!shopCurrencyCode) {
		throw new ShopifyAdminApiError(
			"Shopify shop response did not include a currency code.",
		);
	}
	const amount =
		typeof variant.price === "string"
			? variant.price
			: (variant.price?.amount ?? "");
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
		requiresShipping: variant.inventoryItem?.requiresShipping ?? undefined,
		inventoryItemId: variant.inventoryItem?.id,
	};
}

export function mapProductNode(
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
		variants: variantNodes.map((variant) =>
			mapVariantNode(variant, productId, shopCurrencyCode),
		),
	};
}

export function requiredOrderString(value: unknown, message: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new ShopifyAdminApiError(message);
	}
	return value;
}

export function requiredOrderCurrencyCode(
	value: unknown,
	message: string,
): string {
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

function mapMailingAddress(
	address: ShopifyOrderAddressNode | null | undefined,
) {
	const line1 = optionalCustomerText(address?.address1, 512);
	const city = optionalCustomerText(address?.city);
	const region = optionalCustomerText(address?.province);
	const postalCode = optionalCustomerText(address?.zip);
	const countryCode = optionalCustomerText(
		address?.countryCodeV2,
	)?.toUpperCase();
	const line2 = optionalCustomerText(address?.address2, 512);
	if (
		!line1 ||
		!city ||
		!region ||
		!postalCode ||
		!countryCode ||
		!/^[A-Z]{2}$/.test(countryCode)
	) {
		return undefined;
	}
	return {
		line1,
		...(line2 ? { line2 } : {}),
		city,
		region,
		postalCode,
		countryCode,
	};
}

export function mapOrderCustomerProfile(
	customer: ShopifyOrderCustomerContactNode | null | undefined,
	shippingAddress: ShopifyOrderAddressNode | null | undefined,
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
	const mailingAddress =
		mapMailingAddress(shippingAddress) ??
		mapMailingAddress(customer.defaultAddress);
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

function mapOrderLineItem(
	lineItem: ShopifyOrderLineNode,
): ShopifyPaidOrderLine {
	if (
		typeof lineItem.quantity !== "number" ||
		!Number.isSafeInteger(lineItem.quantity) ||
		lineItem.quantity <= 0
	) {
		throw new ShopifyAdminApiError(
			"Shopify order line response did not include a valid quantity.",
		);
	}
	if (!Array.isArray(lineItem.customAttributes)) {
		throw new ShopifyAdminApiError(
			"Shopify order line response was incomplete.",
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
		customAttributes: lineItem.customAttributes.map((attribute) => ({
			key: requiredOrderString(
				attribute?.key,
				"Shopify order line response included an invalid custom attribute.",
			),
			value: requiredOrderString(
				attribute?.value,
				"Shopify order line response included an invalid custom attribute.",
			),
		})),
	};
}

export function mapPaidOrderNode(node: ShopifyOrderNode): ShopifyPaidOrder {
	const id = requiredOrderString(
		node.id,
		"Shopify order response was incomplete.",
	);
	const customerGid = requiredOrderString(
		node.customer?.id,
		"Shopify order response did not include a customer.",
	);
	const customerEmail = node.customer?.email?.trim().toLowerCase();
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
	const lineItems = node.lineItems.nodes.map(mapOrderLineItem);
	const fullyPaidAtIso = node.fullyPaid
		? latestSuccessfulPaymentTimestamp(node.transactions)
		: undefined;
	return {
		id,
		customerGid,
		...(customerEmail ? { customerEmail } : {}),
		fullyPaid: node.fullyPaid,
		...(fullyPaidAtIso ? { fullyPaidAtIso } : {}),
		currencyCode,
		customAttributes,
		lineItems,
	};
}

export function throwIfUserErrors(
	userErrors: ShopifyUserErrorPayload[] = [],
	requestId?: string,
): void {
	if (userErrors.length === 0) return;
	throw new ShopifyUserError(
		"Shopify rejected the product operation.",
		requestId,
	);
}

export function webhookFailureCategory(
	messages: readonly string[],
	allowCallbackFailure = true,
) {
	const normalized = messages.join(" ").toLowerCase();
	if (
		normalized.includes("protected customer") ||
		normalized.includes("not approved")
	) {
		return "protected_data" as const;
	}
	if (
		allowCallbackFailure &&
		(normalized.includes("callback") ||
			normalized.includes("uri") ||
			normalized.includes("url") ||
			normalized.includes("https"))
	) {
		return "callback" as const;
	}
	if (
		normalized.includes("permission") ||
		normalized.includes("access") ||
		normalized.includes("scope") ||
		normalized.includes("authorized")
	) {
		return "permission" as const;
	}
	return "upstream" as const;
}

export function webhookOperationError(
	error: unknown,
	stage: ShopifyWebhookFailureStage,
): ShopifyWebhookOperationError {
	if (error instanceof ShopifyWebhookOperationError) return error;
	if (error instanceof ShopifyScopeError) {
		return new ShopifyWebhookOperationError(stage, "missing_scope");
	}
	if (error instanceof ShopifyTransportError) {
		return new ShopifyWebhookOperationError(stage, "transport");
	}
	if (error instanceof ShopifyIntegrationError) {
		return new ShopifyWebhookOperationError(
			stage,
			error.failureCategory === "credentials" ? "permission" : "upstream",
			error.requestId,
		);
	}
	return new ShopifyWebhookOperationError(stage, "upstream");
}

export function throwIfWebhookUserErrors(
	userErrors: ShopifyUserErrorPayload[] = [],
	stage: ShopifyWebhookFailureStage,
	requestId?: string,
): void {
	if (userErrors.length === 0) return;
	throw new ShopifyWebhookOperationError(
		stage,
		webhookFailureCategory(userErrors.map((error) => error.message)),
		requestId,
	);
}
