import type {
	CreateClassEntitlementInput,
	FestivalClassConfiguration,
} from "@festival/common";
import type { CheckoutIntentRecord } from "../class-checkout/index.js";
import type { ClassEntitlementRepository } from "./class-entitlement-repository.js";
import {
	type CorrelatedClassOrderLine,
	correlateClassOrderLines,
	hasAttachedCart,
	hasMatchingPaidMoney,
	isLegacySingleLineClassOrder,
	moneyInMinorUnits,
	timestampMilliseconds,
	validateMultiLinePayment,
} from "./order-line-classifier.js";
import type { MembershipReasonCode } from "./order-projection-types.js";
import type {
	CommerceCustomerPort,
	CommerceOrganizationPort,
} from "./ports.js";
import type { ShopifyPaidOrder } from "./shopify-types.js";

export interface ClassValidationResult {
	reason?: MembershipReasonCode;
	classConfig?: FestivalClassConfiguration;
	festivalId?: string;
	correlatedLines?: CorrelatedClassOrderLine[];
	legacySingleLine?: boolean;
	placedCountBeforeAllocation?: number;
}

export type ClassValidatorOrgPort = Pick<
	CommerceOrganizationPort,
	"listFestivals" | "listFestivalClassConfigurations"
>;

export type ClassValidatorCommercePort = Pick<
	ClassEntitlementRepository,
	"countConfirmedClassEntitlements"
>;

export class ClassOrderProjectionValidator {
	constructor(
		private readonly organizations: ClassValidatorOrgPort,
		private readonly commerce: ClassValidatorCommercePort,
		private readonly customers?: Pick<CommerceCustomerPort, "getCustomer">,
	) {}

	async validateClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	): Promise<ClassValidationResult> {
		const correlatedLines = correlateClassOrderLines(intent, order);
		const legacySingleLine = isLegacySingleLineClassOrder(intent, order);
		if (!correlatedLines && !legacySingleLine) {
			return { reason: "correlation_invalid" };
		}
		if (!order.fullyPaid) return { reason: "order_not_paid" };
		if (!order.fullyPaidAtIso) return { reason: "payment_incomplete" };
		if (
			timestampMilliseconds(intent.expiresAtIso, "Checkout intent expiry") <=
			timestampMilliseconds(order.fullyPaidAtIso, "Shopify payment")
		) {
			return { reason: "intent_expired" };
		}
		if (!this.customers) return { reason: "upstream_invalid" };
		const customer = await this.customers.getCustomer(
			organizationId,
			intent.customerId,
		);
		if (!customer || customer.shopifyCustomerGid !== order.customerGid) {
			return { reason: "customer_mismatch" };
		}
		if (intent.lines && intent.lines.length > 1) {
			if (!correlatedLines) return { reason: "correlation_invalid" };
			return this.validateMultiLineClassPurchase(
				organizationId,
				intent,
				order,
				correlatedLines,
			);
		}
		return this.validateSingleLineClassPurchase(
			organizationId,
			intent,
			order,
			correlatedLines,
			legacySingleLine,
		);
	}

	async findActiveClassConfig(
		organizationId: string,
		classId: string,
	): Promise<{
		classConfig?: FestivalClassConfiguration;
		festivalId?: string;
	}> {
		const festivals =
			(await this.organizations.listFestivals?.(organizationId)) ?? [];
		for (const festival of festivals) {
			const configs =
				(await this.organizations.listFestivalClassConfigurations?.(
					organizationId,
					festival.id,
					false,
				)) ?? [];
			const found = configs.find((c) => c.id === classId);
			if (found?.isActive) {
				return { classConfig: found, festivalId: festival.id };
			}
		}
		return {};
	}

	private validateSingleLineOrderItem(
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		correlatedLines: readonly CorrelatedClassOrderLine[] | undefined,
		legacySingleLine: boolean,
	): MembershipReasonCode | undefined {
		const correlatedLine = correlatedLines?.[0];
		const orderLine =
			correlatedLine?.orderLine ??
			(legacySingleLine ? order.lineItems[0] : undefined);
		if (
			(!legacySingleLine &&
				(correlatedLines?.length !== 1 || !correlatedLine)) ||
			!orderLine ||
			orderLine.productGid !== intent.shopifyProductGid ||
			orderLine.variantGid !== intent.shopifyVariantGid ||
			orderLine.quantity !== 1
		) {
			return "offering_mismatch";
		}
		if (
			order.currencyCode !== intent.currencyCode ||
			!hasMatchingPaidMoney(
				intent.amount,
				intent.currencyCode,
				orderLine.paidAmount,
				orderLine.paidCurrencyCode,
			)
		) {
			return "payment_mismatch";
		}
		return undefined;
	}

	private async validateSingleLineClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		correlatedLines: readonly CorrelatedClassOrderLine[] | undefined,
		legacySingleLine: boolean,
	): Promise<ClassValidationResult> {
		if (!intent.festivalClassId || !intent.childId) {
			return { reason: "upstream_invalid" };
		}
		const { classConfig, festivalId } = await this.findActiveClassConfig(
			organizationId,
			intent.festivalClassId,
		);
		if (
			!classConfig ||
			!festivalId ||
			classConfig.shopifyProductGid !== intent.shopifyProductGid ||
			classConfig.shopifyVariantGid !== intent.shopifyVariantGid
		) {
			return { reason: "offering_mismatch" };
		}
		const itemReason = this.validateSingleLineOrderItem(
			intent,
			order,
			correlatedLines,
			legacySingleLine,
		);
		if (itemReason) return { reason: itemReason };
		const placedCountBeforeAllocation =
			await this.commerce.countConfirmedClassEntitlements(
				organizationId,
				classConfig.id,
			);
		if (
			placedCountBeforeAllocation >= classConfig.capacity &&
			!hasAttachedCart(intent)
		) {
			return { reason: "correlation_invalid" };
		}
		return {
			classConfig,
			festivalId,
			placedCountBeforeAllocation,
			...(correlatedLines ? { correlatedLines: [...correlatedLines] } : {}),
			...(legacySingleLine ? { legacySingleLine: true } : {}),
		};
	}

	private async validateMultiLineClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		correlatedLines: readonly CorrelatedClassOrderLine[],
	): Promise<ClassValidationResult> {
		if (!validateMultiLinePayment(intent, order)) {
			return { reason: "payment_mismatch" };
		}
		const attachedCart = hasAttachedCart(intent);
		const placedCountCache = new Map<string, number>();
		const enrichedLines: CorrelatedClassOrderLine[] = [];
		for (const pair of correlatedLines) {
			const validated = await this.validateMultiLineItem(
				organizationId,
				intent,
				pair,
				placedCountCache,
				attachedCart,
			);
			if ("reason" in validated) {
				return { reason: validated.reason };
			}
			enrichedLines.push(validated.line);
		}
		const firstLine = enrichedLines[0];
		if (!firstLine?.classConfig || !firstLine.festivalId) {
			return { reason: "upstream_invalid" };
		}
		return {
			classConfig: firstLine.classConfig,
			festivalId: firstLine.festivalId,
			correlatedLines: enrichedLines,
		};
	}

	private async validateMultiLineItem(
		organizationId: string,
		intent: CheckoutIntentRecord,
		pair: CorrelatedClassOrderLine,
		placedCountCache: Map<string, number>,
		attachedCart: boolean,
	): Promise<
		{ reason: MembershipReasonCode } | { line: CorrelatedClassOrderLine }
	> {
		const { intentLine, orderLine } = pair;
		if (
			orderLine.quantity !== 1 ||
			orderLine.productGid !== intentLine.shopifyProductGid ||
			orderLine.variantGid !== intentLine.shopifyVariantGid
		) {
			return { reason: "offering_mismatch" };
		}
		const targetClassId = intentLine.festivalClassId ?? intent.festivalClassId;
		if (!targetClassId) return { reason: "upstream_invalid" };
		const { classConfig, festivalId } = await this.findActiveClassConfig(
			organizationId,
			targetClassId,
		);
		if (
			!classConfig ||
			!festivalId ||
			classConfig.shopifyProductGid !== intentLine.shopifyProductGid ||
			classConfig.shopifyVariantGid !== intentLine.shopifyVariantGid
		) {
			return { reason: "offering_mismatch" };
		}
		let placedCount = placedCountCache.get(classConfig.id);
		if (placedCount === undefined) {
			placedCount = await this.commerce.countConfirmedClassEntitlements(
				organizationId,
				classConfig.id,
			);
		}
		if (placedCount >= classConfig.capacity && !attachedCart) {
			return { reason: "correlation_invalid" };
		}
		placedCountCache.set(classConfig.id, placedCount + 1);
		return {
			line: {
				intentLine,
				orderLine,
				classConfig,
				festivalId,
				placedCountBeforeAllocation: placedCount,
			},
		};
	}
}

export function buildMultiLineClassEntitlements(input: {
	organizationId: string;
	intent: CheckoutIntentRecord;
	order: ShopifyPaidOrder;
	festivalId: string;
	classConfig: FestivalClassConfiguration;
	correlatedLines: readonly CorrelatedClassOrderLine[];
}): CreateClassEntitlementInput[] {
	const admittedCartReference = input.intent.cartReference?.trim() || null;
	return input.correlatedLines.map(
		({
			intentLine,
			orderLine,
			classConfig,
			festivalId,
			placedCountBeforeAllocation,
		}) => {
			const resolved = classConfig ?? input.classConfig;
			const paidMinor = moneyInMinorUnits(orderLine.paidAmount);
			return {
				organizationId: input.organizationId,
				festivalId: festivalId ?? input.festivalId,
				festivalClassId: intentLine.festivalClassId ?? resolved.id,
				parentCustomerId: input.intent.customerId,
				childId: intentLine.childId ?? input.intent.childId ?? "",
				checkoutIntentId: input.intent.id,
				checkoutIntentLineId: intentLine.id,
				shopifyOrderGid: input.order.id,
				shopifyOrderLineGid: orderLine.id,
				paidAmountCents: Number(paidMinor ?? 0n),
				paidCurrencyCode: orderLine.paidCurrencyCode,
				status: "confirmed" as const,
				admittedCartReference,
				capacityAtAllocation: resolved.capacity,
				placedCountBeforeAllocation: placedCountBeforeAllocation ?? null,
			};
		},
	);
}

export function buildSingleLineClassEntitlement(input: {
	organizationId: string;
	intent: CheckoutIntentRecord;
	order: ShopifyPaidOrder;
	festivalId: string;
	classConfig: FestivalClassConfiguration;
	correlatedLine?: CorrelatedClassOrderLine;
	legacySingleLine?: boolean;
	placedCountBeforeAllocation?: number;
}): CreateClassEntitlementInput | undefined {
	const orderLine =
		input.correlatedLine?.orderLine ??
		(input.legacySingleLine ? input.order.lineItems[0] : undefined);
	if (!orderLine || !input.order.fullyPaidAtIso || !input.intent.childId) {
		return undefined;
	}
	const paidMinor = moneyInMinorUnits(orderLine.paidAmount);
	return {
		organizationId: input.organizationId,
		festivalId: input.festivalId,
		festivalClassId: input.classConfig.id,
		parentCustomerId: input.intent.customerId,
		childId: input.intent.childId,
		checkoutIntentId: input.intent.id,
		checkoutIntentLineId: input.correlatedLine?.intentLine.id ?? null,
		shopifyOrderGid: input.order.id,
		shopifyOrderLineGid: orderLine.id,
		paidAmountCents: Number(paidMinor ?? 0n),
		paidCurrencyCode: orderLine.paidCurrencyCode,
		status: "confirmed",
		admittedCartReference: input.intent.cartReference?.trim() || null,
		capacityAtAllocation: input.classConfig.capacity,
		placedCountBeforeAllocation: input.placedCountBeforeAllocation ?? null,
	};
}
