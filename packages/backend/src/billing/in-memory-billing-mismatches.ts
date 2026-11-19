import { randomUUID } from "node:crypto";
import type { BillingMismatchRecord } from "@festival/common";

export interface MismatchSeedState {
	orderProjections: ReadonlyArray<{
		organizationId: string;
		shopifyOrderGid: string;
		shopifyCustomerGid?: string | null;
		correlationId?: string | null;
		fullyPaidAt?: string | null;
		currencyCode?: string | null;
	}>;
	classEntitlements: ReadonlyArray<{
		id: string;
		organizationId: string;
		parentCustomerId: string;
		checkoutIntentId: string;
		checkoutIntentLineId?: string | null;
		shopifyOrderGid: string;
		paidAmountCents: number;
		paidCurrencyCode: string;
		status: string;
	}>;
	checkoutIntents: ReadonlyArray<{
		id: string;
		correlationId: string;
		organizationId: string;
		customerId: string;
		amount: string;
		currencyCode: string;
		cartReference?: string | null;
	}>;
	checkoutIntentLines: ReadonlyArray<{
		id: string;
		checkoutIntentId: string;
		organizationId?: string;
		amount: string;
		currencyCode?: string;
	}>;
	checkoutCarts: ReadonlyArray<{
		reference: string;
		organizationId: string;
		customerId: string;
	}>;
}

export function detectPaidUnregisteredMismatches(
	organizationId: string,
	state: MismatchSeedState,
): BillingMismatchRecord[] {
	const results: BillingMismatchRecord[] = [];
	for (const order of state.orderProjections) {
		if (order.organizationId !== organizationId || !order.fullyPaidAt) continue;
		const confirmed = state.classEntitlements.find(
			(e) =>
				e.organizationId === organizationId &&
				e.shopifyOrderGid === order.shopifyOrderGid &&
				e.status === "confirmed",
		);
		if (confirmed) continue;
		const intent = state.checkoutIntents.find(
			(ci) =>
				ci.organizationId === organizationId &&
				ci.correlationId === order.correlationId,
		);
		const cart = intent?.cartReference
			? state.checkoutCarts.find(
					(cc) =>
						cc.organizationId === organizationId &&
						cc.reference === intent.cartReference,
				)
			: undefined;
		results.push({
			id: randomUUID(),
			organizationId,
			customerId:
				intent?.customerId ??
				cart?.customerId ??
				order.shopifyCustomerGid ??
				"unknown",
			mismatchType: "paid_unregistered",
			description:
				"Shopify order is fully paid but no class entitlement was created.",
			shopifyOrderId: order.shopifyOrderGid,
			amountCents: intent?.amount
				? Math.round(Number.parseFloat(intent.amount) * 100)
				: null,
			currencyCode: order.currencyCode ?? "USD",
			createdAtIso: new Date().toISOString(),
		});
	}
	return results;
}

export function detectRegisteredUnpaidMismatches(
	organizationId: string,
	state: MismatchSeedState,
): BillingMismatchRecord[] {
	const results: BillingMismatchRecord[] = [];
	for (const entitlement of state.classEntitlements) {
		if (
			entitlement.organizationId !== organizationId ||
			entitlement.status !== "confirmed"
		) {
			continue;
		}
		const order = state.orderProjections.find(
			(o) =>
				o.organizationId === organizationId &&
				o.shopifyOrderGid === entitlement.shopifyOrderGid,
		);
		if (!order?.fullyPaidAt && entitlement.paidAmountCents === 0) {
			results.push({
				id: randomUUID(),
				organizationId,
				customerId: entitlement.parentCustomerId,
				mismatchType: "registered_unpaid",
				description:
					"Class entitlement is registered but payment has not been received.",
				entitlementId: entitlement.id,
				shopifyOrderId: entitlement.shopifyOrderGid,
				amountCents: 0,
				currencyCode: entitlement.paidCurrencyCode,
				createdAtIso: new Date().toISOString(),
			});
		}
	}
	return results;
}

function buildPartialMismatch(
	organizationId: string,
	entitlement: MismatchSeedState["classEntitlements"][number],
	description: string,
): BillingMismatchRecord {
	return {
		id: randomUUID(),
		organizationId,
		customerId: entitlement.parentCustomerId,
		mismatchType: "partial_payment",
		description,
		entitlementId: entitlement.id,
		shopifyOrderId: entitlement.shopifyOrderGid,
		amountCents: entitlement.paidAmountCents,
		currencyCode: entitlement.paidCurrencyCode,
		createdAtIso: new Date().toISOString(),
	};
}

function evaluatePartialPaymentForEntitlement(
	organizationId: string,
	entitlement: MismatchSeedState["classEntitlements"][number],
	state: MismatchSeedState,
): BillingMismatchRecord | null {
	const intent = state.checkoutIntents.find(
		(ci) =>
			ci.organizationId === organizationId &&
			ci.id === entitlement.checkoutIntentId,
	);
	if (entitlement.checkoutIntentLineId) {
		const line = intent
			? state.checkoutIntentLines.find(
					(cil) =>
						cil.id === entitlement.checkoutIntentLineId &&
						cil.checkoutIntentId === entitlement.checkoutIntentId &&
						(cil.organizationId === undefined ||
							cil.organizationId === organizationId),
				)
			: undefined;
		if (!line) {
			return buildPartialMismatch(
				organizationId,
				entitlement,
				"Missing or invalid checkout intent line for confirmed class entitlement.",
			);
		}
		const expectedCurrency = line.currencyCode ?? intent?.currencyCode ?? "USD";
		const expectedCents = Math.round(Number.parseFloat(line.amount) * 100);
		return entitlement.paidAmountCents < expectedCents ||
			entitlement.paidCurrencyCode !== expectedCurrency
			? buildPartialMismatch(
					organizationId,
					entitlement,
					"Partial payment received for class entitlement.",
				)
			: null;
	}
	if (!intent?.amount) return null;
	const expectedCurrency = intent.currencyCode ?? "USD";
	const expectedCents = Math.round(Number.parseFloat(intent.amount) * 100);
	return entitlement.paidAmountCents < expectedCents ||
		entitlement.paidCurrencyCode !== expectedCurrency
		? buildPartialMismatch(
				organizationId,
				entitlement,
				"Partial payment received for class entitlement.",
			)
		: null;
}

export function detectPartialPaymentMismatches(
	organizationId: string,
	state: MismatchSeedState,
): BillingMismatchRecord[] {
	const results: BillingMismatchRecord[] = [];
	for (const entitlement of state.classEntitlements) {
		if (
			entitlement.organizationId !== organizationId ||
			entitlement.status !== "confirmed" ||
			entitlement.paidAmountCents <= 0
		) {
			continue;
		}
		const mismatch = evaluatePartialPaymentForEntitlement(
			organizationId,
			entitlement,
			state,
		);
		if (mismatch) results.push(mismatch);
	}
	return results;
}
