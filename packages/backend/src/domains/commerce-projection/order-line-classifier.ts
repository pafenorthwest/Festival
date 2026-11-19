import type { FestivalClassConfiguration } from "@festival/common";
import {
	CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
	type CheckoutIntentLineItemRecord,
	type CheckoutIntentRecord,
	isCanonicalUuid,
} from "../class-checkout/index.js";
import type {
	ShopifyPaidOrder,
	ShopifyPaidOrderLine,
} from "./shopify-types.js";

export const CHECKOUT_INTENT_ATTRIBUTE = "festival_checkout_intent_id";

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CorrelatedClassOrderLine {
	intentLine: CheckoutIntentLineItemRecord;
	orderLine: ShopifyPaidOrderLine;
	classConfig?: FestivalClassConfiguration;
	festivalId?: string;
	placedCountBeforeAllocation?: number;
}

export function isCorrelationId(value: string): boolean {
	return UUID_REGEX.test(value);
}

export function readCorrelationId(order: ShopifyPaidOrder): {
	correlationId?: string;
	reasonCode?: "correlation_missing" | "correlation_invalid";
} {
	const values = order.customAttributes
		.filter((attribute) => attribute.key === CHECKOUT_INTENT_ATTRIBUTE)
		.map((attribute) => attribute.value);
	if (values.length === 0) {
		return { reasonCode: "correlation_missing" };
	}
	if (values.length !== 1 || !values[0] || !isCorrelationId(values[0])) {
		return { reasonCode: "correlation_invalid" };
	}
	return { correlationId: values[0] };
}

export function moneyInMinorUnits(amount: string): bigint | null {
	const trimmed = amount.trim();
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
	if (!match) {
		return null;
	}
	const whole = BigInt(match[1] ?? "0");
	const fractional = (match[2] ?? "").padEnd(2, "0");
	return whole * 100n + BigInt(fractional);
}

export function hasMatchingPaidMoney(
	expectedAmount: string,
	expectedCurrency: string,
	paidAmount: string,
	paidCurrency: string,
): boolean {
	if (expectedCurrency !== paidCurrency) {
		return false;
	}
	const expectedMinor = moneyInMinorUnits(expectedAmount);
	const paidMinor = moneyInMinorUnits(paidAmount);
	return (
		expectedMinor !== null && paidMinor !== null && expectedMinor === paidMinor
	);
}

export function timestampMilliseconds(iso: string, label: string): number {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) {
		throw new Error(`${label} timestamp is invalid.`);
	}
	return ms;
}

export function hasAttachedCart(intent: CheckoutIntentRecord): boolean {
	return (
		typeof intent.cartReference === "string" &&
		intent.cartReference.trim().length > 0
	);
}

export function validateMultiLinePayment(
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): boolean {
	if (order.currencyCode !== intent.currencyCode) {
		return false;
	}
	const expectedTotal = moneyInMinorUnits(intent.amount);
	if (expectedTotal === null) {
		return false;
	}
	let totalPaid = 0n;
	for (const line of order.lineItems) {
		if (line.paidCurrencyCode !== intent.currencyCode) {
			return false;
		}
		const linePaid = moneyInMinorUnits(line.paidAmount);
		if (linePaid === null) {
			return false;
		}
		totalPaid += linePaid;
	}
	return totalPaid === expectedTotal;
}

export function correlateClassOrderLines(
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): CorrelatedClassOrderLine[] | undefined {
	if (!intent.lines || intent.lines.length === 0) {
		return undefined;
	}
	if (order.lineItems.length !== intent.lines.length) {
		return undefined;
	}
	const intentLinesById = new Map<string, CheckoutIntentLineItemRecord>();
	for (const line of intent.lines) {
		intentLinesById.set(line.id, line);
	}
	const seenIds = new Set<string>();
	const correlated: CorrelatedClassOrderLine[] = [];
	for (const orderLine of order.lineItems) {
		const attrs = orderLine.customAttributes.filter(
			(attr) => attr.key === CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
		);
		if (attrs.length !== 1 || !attrs[0] || !isCanonicalUuid(attrs[0].value)) {
			return undefined;
		}
		const lineId = attrs[0].value;
		const intentLine = intentLinesById.get(lineId);
		if (!intentLine || seenIds.has(lineId)) {
			return undefined;
		}
		seenIds.add(lineId);
		correlated.push({ intentLine, orderLine });
	}
	return correlated;
}

export function isLegacySingleLineClassOrder(
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): boolean {
	return (
		intent.lineIdentityProtocol === null &&
		Array.isArray(intent.lines) &&
		intent.lines.length === 0 &&
		order.lineItems.length === 1 &&
		!order.lineItems[0]?.customAttributes.some(
			(attr) => attr.key === CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
		)
	);
}
