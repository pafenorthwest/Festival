import { createHash } from "node:crypto";
import {
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	deriveEntitlementDates,
	type FestivalClassConfiguration,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "../checkout/checkout-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import type {
	OrganizationRepository,
	ShopifyIntegrationRecord,
} from "../repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import {
	ShopifyIntegrationError,
	ShopifyTransportError,
} from "../shopify/errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyPaidOrder,
	ShopifyPaidOrderReader,
} from "../shopify/types.js";
import type {
	MembershipCommerceRepository,
	MembershipReasonCode,
	ShopifyOrderProjectionInput,
	ShopifyWebhookDelivery,
} from "./membership-commerce-repository.js";

const CHECKOUT_INTENT_ATTRIBUTE = "festival_checkout_intent_id";
const RECONCILIATION_OVERLAP_MS = 48 * 60 * 60 * 1_000;
const RECONCILIATION_LIMIT = 50;
const DELIVERY_PROCESSING_LEASE_MS = 15 * 60 * 1_000;

type ProcessingResult = "processed" | "skipped" | "failed";

function nowIso(clock: () => Date): string {
	return clock().toISOString();
}

function timestampMilliseconds(value: string, field: string) {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp))
		throw new Error(`${field} timestamp is invalid.`);
	return timestamp;
}

function isCorrelationId(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}

function correlationFromOrder(order: ShopifyPaidOrder): {
	correlationId?: string;
	reasonCode?: "correlation_missing" | "correlation_invalid";
} {
	const values = order.customAttributes
		.filter((attribute) => attribute.key === CHECKOUT_INTENT_ATTRIBUTE)
		.map((attribute) => attribute.value);
	if (values.length === 0) return { reasonCode: "correlation_missing" };
	if (values.length !== 1 || !isCorrelationId(values[0])) {
		return { reasonCode: "correlation_invalid" };
	}
	return { correlationId: values[0] };
}

function failureCategory(
	error: unknown,
): "upstream" | "persistence" | "invalid" {
	if (
		error instanceof Error &&
		/invalid|mismatch|missing|unsupported/i.test(error.message)
	) {
		return "invalid";
	}
	return "upstream";
}

function failureDiagnostic(
	error: unknown,
	stage: "order_read" | "projection",
	failedAtIso: string,
) {
	if (error instanceof ShopifyTransportError) {
		return {
			category: "upstream" as const,
			stage,
			code: "shopify_transport" as const,
			failedAtIso,
		};
	}
	if (error instanceof ShopifyIntegrationError) {
		return {
			category: "upstream" as const,
			stage,
			code: "shopify_upstream" as const,
			...(error.requestId &&
			/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(error.requestId)
				? { requestId: error.requestId }
				: {}),
			failedAtIso,
		};
	}
	const category = failureCategory(error);
	return {
		category,
		stage,
		code:
			category === "invalid"
				? ("invalid_data" as const)
				: category === "persistence"
					? ("persistence" as const)
					: ("unexpected" as const),
		failedAtIso,
	};
}

function reconciliationWebhookId(orderGid: string): string {
	return `reconcile:${createHash("sha256").update(orderGid).digest("hex")}`;
}

function safeOrderHash(orderGid: string): string {
	return createHash("sha256").update(orderGid).digest("hex");
}

function moneyInMinorUnits(value: string): bigint | undefined {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value);
	if (!match) return undefined;
	return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function verifiedIdentityEmail(value: string | undefined): string | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	return (normalized.match(/[a-z0-9]/gi)?.length ?? 0) >= 8
		? normalized
		: undefined;
}

function hasMatchingPaidMoney(
	expectedAmount: string,
	expectedCurrencyCode: string,
	actualAmount: string,
	actualCurrencyCode: string,
): boolean {
	const expected = moneyInMinorUnits(expectedAmount);
	const actual = moneyInMinorUnits(actualAmount);
	return (
		expected !== undefined &&
		actual !== undefined &&
		expectedCurrencyCode === actualCurrencyCode &&
		expected === actual
	);
}

function validateMultiLinePayment(
	intent: CheckoutIntentRecord,
	order: ShopifyPaidOrder,
): boolean {
	if (order.currencyCode !== intent.currencyCode) return false;
	let totalPaidMinor = 0n;
	for (const line of order.lineItems) {
		if (line.paidCurrencyCode !== intent.currencyCode) return false;
		const minor = moneyInMinorUnits(line.paidAmount);
		if (minor === undefined) return false;
		totalPaidMinor += minor;
	}
	const expectedTotalMinor = moneyInMinorUnits(intent.amount);
	return (
		expectedTotalMinor !== undefined && totalPaidMinor === expectedTotalMinor
	);
}

export class ShopifyOrderProjectionService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly checkout: CheckoutRepository,
		private readonly commerce: MembershipCommerceRepository,
		private readonly orders: ShopifyPaidOrderReader,
		private readonly secretKeyring: ShopifySecretKeyring | undefined,
		private readonly customers?: CustomerAccountRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async processDelivery(deliveryId: string): Promise<ProcessingResult> {
		const delivery = await this.commerce.claimDelivery(deliveryId);
		if (!delivery) return "skipped";
		let failureStage: "order_read" | "projection" = "projection";
		try {
			const pending = await this.commerce.recordPendingDecision({
				organizationId: delivery.organizationId,
				shopifyOrderGid: delivery.shopifyOrderGid,
				updatedAtIso: nowIso(this.now),
			});
			if (
				pending.status !== "pending_validation" &&
				pending.status !== "approved"
			) {
				await this.commerce.markDeliveryProcessed(delivery.id);
				return "skipped";
			}

			failureStage = "order_read";
			const order = await this.readOrder(
				delivery.organizationId,
				delivery.shopifyOrderGid,
			);
			failureStage = "projection";
			if (!order) {
				await this.finalize(delivery, {
					status: "needs_review",
					reasonCode: "upstream_invalid",
				});
				return "processed";
			}
			if (order.id !== delivery.shopifyOrderGid) {
				await this.finalize(delivery, {
					status: "needs_review",
					reasonCode: "upstream_invalid",
				});
				return "processed";
			}

			const correlation = correlationFromOrder(order);
			const projection: ShopifyOrderProjectionInput = {
				organizationId: delivery.organizationId,
				shopifyOrderGid: order.id,
				shopifyCustomerGid: order.customerGid,
				correlationId: correlation.correlationId,
				fullyPaidAtIso: order.fullyPaidAtIso,
				currencyCode: order.currencyCode,
				updatedAtIso: nowIso(this.now),
			};
			if (!correlation.correlationId) {
				await this.finalize(
					delivery,
					{
						status: "needs_review",
						reasonCode: correlation.reasonCode ?? "correlation_invalid",
					},
					projection,
				);
				return "processed";
			}

			const intent = await this.checkout.findIntentByCorrelation(
				delivery.organizationId,
				correlation.correlationId,
			);
			if (!intent) {
				await this.finalize(
					delivery,
					{
						status: "needs_review",
						reasonCode: "correlation_invalid",
					},
					projection,
				);
				return "processed";
			}
			if (pending.status === "approved") {
				if (delivery.attemptCount > 1) {
					await this.projectConsentedCustomerProfile(
						delivery.organizationId,
						intent,
						order,
					);
				}
				await this.commerce.markDeliveryProcessed(delivery.id);
				return delivery.attemptCount > 1 ? "processed" : "skipped";
			}

			const isClassPurchase =
				intent.intentType === "class_entry" || Boolean(intent.festivalClassId);

			if (isClassPurchase) {
				return this.processClassDelivery(delivery, intent, order, projection);
			}

			const reason = await this.validate(
				delivery.organizationId,
				intent,
				order,
			);
			if (reason) {
				await this.finalize(
					delivery,
					{
						customerId: intent.customerId,
						checkoutIntentId: intent.id,
						status:
							reason === "intent_expired" ||
							reason === "correlation_invalid" ||
							reason === "upstream_invalid" ||
							reason === "payment_incomplete"
								? "needs_review"
								: "rejected",
						reasonCode: reason,
					},
					projection,
				);
				return "processed";
			}
			const line = order.lineItems[0];
			const identityEmail = verifiedIdentityEmail(order.customerEmail);
			if (
				!line ||
				!order.fullyPaidAtIso ||
				!intent.divisionId ||
				!intent.divisionNameSnapshot ||
				!intent.offeringId ||
				intent.durationDays === null ||
				intent.durationDays === undefined ||
				!identityEmail
			) {
				await this.finalize(
					delivery,
					{
						customerId: intent.customerId,
						checkoutIntentId: intent.id,
						status: "needs_review",
						reasonCode: "upstream_invalid",
					},
					projection,
				);
				return "processed";
			}
			const timezone = await this.organizations.getOrganizationTimezone(
				delivery.organizationId,
			);
			const dates = deriveEntitlementDates({
				fullyPaidAtIso: order.fullyPaidAtIso,
				organizationTimezone: timezone,
				durationDays: intent.durationDays,
			});
			await this.finalize(
				delivery,
				{
					customerId: intent.customerId,
					checkoutIntentId: intent.id,
					shopifyOrderLineGid: line.id,
					status: "approved",
					grant: {
						organizationId: delivery.organizationId,
						customerId: intent.customerId,
						entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
						offeringId: intent.offeringId,
						durationDays: intent.durationDays,
						divisionId: intent.divisionId,
						divisionNameSnapshot: intent.divisionNameSnapshot,
						paidAmount: line.paidAmount,
						paidCurrencyCode: line.paidCurrencyCode,
						checkoutIntentId: intent.id,
						shopifyOrderGid: order.id,
						shopifyOrderLineGid: line.id,
						startsOn: dates.startsOn,
						endsOn: dates.endsOn,
						status: "active",
						verifiedIdentityEmail: identityEmail,
					},
				},
				projection,
			);
			await this.projectConsentedCustomerProfile(
				delivery.organizationId,
				intent,
				order,
			);
			return "processed";
		} catch (error) {
			await this.commerce.markDeliveryFailed(
				delivery.id,
				failureDiagnostic(error, failureStage, nowIso(this.now)),
			);
			return "failed";
		}
	}

	async reconcile(organizationId: string): Promise<{
		discoveredCount: number;
		processedCount: number;
	}> {
		const startedAtIso = nowIso(this.now);
		let discoveredCount = 0;
		let processedCount = 0;
		try {
			const staleBeforeIso = new Date(
				this.now().getTime() - DELIVERY_PROCESSING_LEASE_MS,
			).toISOString();
			for (const delivery of await this.commerce.listReclaimableDeliveries(
				organizationId,
				RECONCILIATION_LIMIT,
				staleBeforeIso,
			)) {
				const result = await this.processDelivery(delivery.id);
				if (result === "processed") processedCount += 1;
				if (result === "failed")
					throw new Error("A queued delivery could not be processed.");
			}

			const sinceIso = new Date(
				this.now().getTime() - RECONCILIATION_OVERLAP_MS,
			).toISOString();
			const context = await this.readContext(organizationId);
			const { value: orders } = await this.orders.listPaidOrdersSince(
				context,
				sinceIso,
				RECONCILIATION_LIMIT,
			);
			for (const order of orders) {
				const recorded = await this.commerce.recordDelivery({
					organizationId,
					shopDomain: context.verifiedShopDomain,
					webhookId: reconciliationWebhookId(order.id),
					topic: "orders/paid",
					apiVersion: "2026-07",
					shopifyOrderGid: order.id,
					payloadSha256: safeOrderHash(order.id),
					receivedAtIso: nowIso(this.now),
				});
				if (recorded.kind === "conflict") {
					throw new Error("Reconciliation delivery evidence conflicted.");
				}
				discoveredCount += recorded.kind === "accepted" ? 1 : 0;
				const result = await this.processDelivery(recorded.delivery.id);
				if (result === "processed") processedCount += 1;
				if (result === "failed")
					throw new Error("A reconciled order could not be processed.");
			}
			await this.commerce.recordReconciliationRun({
				organizationId,
				status: "completed",
				discoveredCount,
				processedCount,
				startedAtIso,
				finishedAtIso: nowIso(this.now),
			});
			return { discoveredCount, processedCount };
		} catch (error) {
			await this.commerce.recordReconciliationRun({
				organizationId,
				status: "failed",
				discoveredCount,
				processedCount,
				startedAtIso,
				finishedAtIso: nowIso(this.now),
				failureCategory: failureCategory(error),
			});
			throw new Error("Shopify order reconciliation failed.");
		}
	}

	private async readOrder(organizationId: string, orderGid: string) {
		const context = await this.readContext(organizationId);
		return (await this.orders.readPaidOrderByGid(context, orderGid)).value;
	}

	private async readContext(
		organizationId: string,
	): Promise<ShopifyAdminOperationContext> {
		if (!this.secretKeyring) {
			throw new Error("Shopify order processing is not configured.");
		}
		const integration =
			await this.organizations.getShopifyIntegration(organizationId);
		this.assertReadableIntegration(integration);
		return {
			organizationId,
			firebaseActorUid: "system:shopify-order-projection",
			verifiedShopGid: integration.verifiedShopGid,
			verifiedShopDomain: integration.verifiedShopDomain,
			integrationVersion: integration.integrationVersion,
			grantedScopes: [...integration.grantedScopes],
			capability: "read_orders",
			credentials: {
				organizationId,
				storeDomain: integration.storeDomain,
				clientId: integration.clientId,
				clientSecret: this.secretKeyring.decrypt(
					integration.encryptedClientSecret,
					{
						organizationId,
						purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
					},
				),
				integrationVersion: integration.integrationVersion,
			},
		};
	}

	private assertReadableIntegration(
		integration: ShopifyIntegrationRecord | null,
	): asserts integration is ShopifyIntegrationRecord & {
		verifiedShopGid: string;
		verifiedShopDomain: string;
	} {
		if (
			!integration ||
			integration.verificationStatus !== "ok" ||
			!integration.verifiedShopGid ||
			!integration.verifiedShopDomain ||
			integration.capabilities.read_orders !== "granted"
		) {
			throw new Error(
				"Shopify order processing is not available for this organization.",
			);
		}
	}

	private async validate(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	): Promise<MembershipReasonCode | undefined> {
		if (!order.fullyPaid) return "order_not_paid";
		if (!order.fullyPaidAtIso) return "payment_incomplete";
		if (
			timestampMilliseconds(intent.expiresAtIso, "Checkout intent expiry") <=
			timestampMilliseconds(order.fullyPaidAtIso, "Shopify payment")
		)
			return "intent_expired";
		if (!this.customers) return "upstream_invalid";
		const customer = await this.customers.getCustomer(
			organizationId,
			intent.customerId,
		);
		if (!customer || customer.shopifyCustomerGid !== order.customerGid) {
			return "customer_mismatch";
		}
		const offering =
			await this.organizations.findMembershipProductRecordByClass(
				organizationId,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			);
		if (
			!offering?.isActive ||
			offering.id !== intent.offeringId ||
			offering.shopifyProductGid !== intent.shopifyProductGid ||
			offering.shopifyVariantGid !== intent.shopifyVariantGid
		) {
			return "offering_mismatch";
		}
		if (
			intent.policyVersion !== "v1" ||
			intent.durationDays !== offering.durationDays
		) {
			return "policy_mismatch";
		}
		const division = (
			await this.organizations.listDivisions(organizationId, true)
		).find((value) => value.id === intent.divisionId);
		if (!division) {
			return "division_invalid";
		}
		if (
			order.lineItems.length !== 1 ||
			order.lineItems[0]?.productGid !== intent.shopifyProductGid ||
			order.lineItems[0]?.variantGid !== intent.shopifyVariantGid ||
			order.lineItems[0]?.quantity !== 1
		) {
			return "offering_mismatch";
		}
		const line = order.lineItems[0];
		if (
			!line ||
			order.currencyCode !== intent.currencyCode ||
			!hasMatchingPaidMoney(
				intent.amount,
				intent.currencyCode,
				line.paidAmount,
				line.paidCurrencyCode,
			)
		) {
			return "payment_mismatch";
		}
		const timezone =
			await this.organizations.getOrganizationTimezone(organizationId);
		const today = deriveEntitlementDates({
			fullyPaidAtIso: nowIso(this.now),
			organizationTimezone: timezone,
			durationDays: 1,
		}).startsOn;
		if (
			await this.commerce.hasScheduledEntitlement(
				organizationId,
				intent.customerId,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				today,
			)
		) {
			return "duplicate_purchase";
		}
		return undefined;
	}

	private async processClassDelivery(
		delivery: ShopifyWebhookDelivery,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		projection: ShopifyOrderProjectionInput,
	): Promise<ProcessingResult> {
		const { reason, classConfig, festivalId } =
			await this.validateClassPurchase(delivery.organizationId, intent, order);
		if (reason || !classConfig || !festivalId) {
			const isReview =
				reason === "intent_expired" ||
				reason === "correlation_invalid" ||
				reason === "upstream_invalid" ||
				reason === "payment_incomplete";
			await this.finalize(
				delivery,
				{
					customerId: intent.customerId,
					checkoutIntentId: intent.id,
					status: isReview ? "needs_review" : "rejected",
					reasonCode: reason ?? "upstream_invalid",
				},
				projection,
			);
			return "processed";
		}
		if (intent.lines && intent.lines.length > 1) {
			await this.finalizeMultiLineClassPurchase(
				delivery,
				intent,
				order,
				projection,
				festivalId,
				classConfig,
			);
		} else {
			const singleResult = await this.finalizeSingleLineClassPurchase(
				delivery,
				intent,
				order,
				projection,
				festivalId,
				classConfig,
			);
			if (singleResult) return singleResult;
		}
		await this.projectConsentedCustomerProfile(
			delivery.organizationId,
			intent,
			order,
		);
		return "processed";
	}

	private async finalizeMultiLineClassPurchase(
		delivery: ShopifyWebhookDelivery,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		projection: ShopifyOrderProjectionInput,
		festivalId: string,
		classConfig: FestivalClassConfiguration,
	): Promise<void> {
		const sortedLines = [...(intent.lines ?? [])].sort(
			(a, b) => a.lineIndex - b.lineIndex,
		);
		await this.finalize(
			delivery,
			{
				customerId: intent.customerId,
				checkoutIntentId: intent.id,
				status: "approved",
				classEntitlements: sortedLines.map((intentLine, index) => {
					const line = order.lineItems[index];
					const paidMinor = moneyInMinorUnits(line.paidAmount);
					return {
						organizationId: delivery.organizationId,
						festivalId,
						festivalClassId: intentLine.festivalClassId ?? classConfig.id,
						parentCustomerId: intent.customerId,
						childId: intentLine.childId ?? intent.childId ?? "",
						checkoutIntentId: intent.id,
						checkoutIntentLineId: intentLine.id,
						shopifyOrderGid: order.id,
						shopifyOrderLineGid: line.id,
						paidAmountCents: Number(paidMinor ?? 0n),
						paidCurrencyCode: line.paidCurrencyCode,
						status: "confirmed" as const,
					};
				}),
			},
			projection,
		);
	}

	private async finalizeSingleLineClassPurchase(
		delivery: ShopifyWebhookDelivery,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
		projection: ShopifyOrderProjectionInput,
		festivalId: string,
		classConfig: FestivalClassConfiguration,
	): Promise<ProcessingResult | undefined> {
		const line = order.lineItems[0];
		if (!line || !order.fullyPaidAtIso || !intent.childId) {
			await this.finalize(
				delivery,
				{
					customerId: intent.customerId,
					checkoutIntentId: intent.id,
					status: "needs_review",
					reasonCode: "upstream_invalid",
				},
				projection,
			);
			return "processed";
		}
		const paidMinor = moneyInMinorUnits(line.paidAmount);
		const paidAmountCents = Number(paidMinor ?? 0n);
		await this.finalize(
			delivery,
			{
				customerId: intent.customerId,
				checkoutIntentId: intent.id,
				shopifyOrderLineGid: line.id,
				status: "approved",
				classEntitlement: {
					organizationId: delivery.organizationId,
					festivalId,
					festivalClassId: classConfig.id,
					parentCustomerId: intent.customerId,
					childId: intent.childId,
					checkoutIntentId: intent.id,
					checkoutIntentLineId: intent.lines?.[0]?.id ?? null,
					shopifyOrderGid: order.id,
					shopifyOrderLineGid: line.id,
					paidAmountCents,
					paidCurrencyCode: line.paidCurrencyCode,
					status: "confirmed",
				},
			},
			projection,
		);
		return undefined;
	}

	private async validateClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	): Promise<{
		reason?: MembershipReasonCode;
		classConfig?: FestivalClassConfiguration;
		festivalId?: string;
	}> {
		if (!order.fullyPaid) return { reason: "order_not_paid" };
		if (!order.fullyPaidAtIso) return { reason: "payment_incomplete" };
		if (
			timestampMilliseconds(intent.expiresAtIso, "Checkout intent expiry") <=
			timestampMilliseconds(order.fullyPaidAtIso, "Shopify payment")
		)
			return { reason: "intent_expired" };
		if (!this.customers) return { reason: "upstream_invalid" };
		const customer = await this.customers.getCustomer(
			organizationId,
			intent.customerId,
		);
		if (!customer || customer.shopifyCustomerGid !== order.customerGid) {
			return { reason: "customer_mismatch" };
		}
		if (intent.lines && intent.lines.length > 1) {
			return this.validateMultiLineClassPurchase(organizationId, intent, order);
		}
		return this.validateSingleLineClassPurchase(organizationId, intent, order);
	}

	private async findActiveClassConfig(
		organizationId: string,
		classId: string,
	): Promise<{
		classConfig?: FestivalClassConfiguration;
		festivalId?: string;
	}> {
		const festivals = await this.organizations.listFestivals(organizationId);
		for (const festival of festivals) {
			const configs = await this.organizations.listFestivalClassConfigurations(
				organizationId,
				festival.id,
				false,
			);
			const found = configs.find((c) => c.id === classId);
			if (found?.isActive) {
				return { classConfig: found, festivalId: festival.id };
			}
		}
		return {};
	}

	private async validateSingleLineClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	): Promise<{
		reason?: MembershipReasonCode;
		classConfig?: FestivalClassConfiguration;
		festivalId?: string;
	}> {
		if (!intent.festivalClassId || !intent.childId) {
			return { reason: "upstream_invalid" };
		}
		const { classConfig, festivalId } = await this.findActiveClassConfig(
			organizationId,
			intent.festivalClassId,
		);
		if (!classConfig || !festivalId) {
			return { reason: "offering_mismatch" };
		}
		if (
			classConfig.shopifyProductGid !== intent.shopifyProductGid ||
			classConfig.shopifyVariantGid !== intent.shopifyVariantGid
		) {
			return { reason: "offering_mismatch" };
		}
		if (
			order.lineItems.length !== 1 ||
			order.lineItems[0]?.productGid !== intent.shopifyProductGid ||
			order.lineItems[0]?.variantGid !== intent.shopifyVariantGid ||
			order.lineItems[0]?.quantity !== 1
		) {
			return { reason: "offering_mismatch" };
		}
		const line = order.lineItems[0];
		if (
			!line ||
			order.currencyCode !== intent.currencyCode ||
			!hasMatchingPaidMoney(
				intent.amount,
				intent.currencyCode,
				line.paidAmount,
				line.paidCurrencyCode,
			)
		) {
			return { reason: "payment_mismatch" };
		}
		return { classConfig, festivalId };
	}

	private async validateMultiLineClassPurchase(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	): Promise<{
		reason?: MembershipReasonCode;
		classConfig?: FestivalClassConfiguration;
		festivalId?: string;
	}> {
		const sortedLines = [...(intent.lines ?? [])].sort(
			(a, b) => a.lineIndex - b.lineIndex,
		);
		if (order.lineItems.length !== sortedLines.length) {
			return { reason: "offering_mismatch" };
		}
		for (let i = 0; i < sortedLines.length; i++) {
			const intentLine = sortedLines[i];
			const orderLine = order.lineItems[i];
			if (
				!orderLine ||
				orderLine.quantity !== 1 ||
				orderLine.productGid !== intentLine.shopifyProductGid ||
				orderLine.variantGid !== intentLine.shopifyVariantGid
			) {
				return { reason: "offering_mismatch" };
			}
		}
		if (!validateMultiLinePayment(intent, order)) {
			return { reason: "payment_mismatch" };
		}
		const targetClassId =
			intent.festivalClassId ?? sortedLines[0]?.festivalClassId;
		if (!targetClassId) return { reason: "upstream_invalid" };
		const { classConfig, festivalId } = await this.findActiveClassConfig(
			organizationId,
			targetClassId,
		);
		if (!classConfig || !festivalId) {
			return { reason: "offering_mismatch" };
		}
		return { classConfig, festivalId };
	}

	private async projectConsentedCustomerProfile(
		organizationId: string,
		intent: CheckoutIntentRecord,
		order: ShopifyPaidOrder,
	) {
		if (!intent.staffAccessConsent || !this.customers) return;
		const reader = this.orders.readOrderCustomerProfileByGid;
		if (!reader) return;
		const context = await this.readContext(organizationId);
		const { value: profile } = await reader.call(
			this.orders,
			context,
			order.id,
		);
		await this.customers.recordStaffAccessConsent({
			organizationId,
			customerId: intent.customerId,
			privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			consentedAtIso: nowIso(this.now),
		});
		if (!profile) return;
		await this.customers.applyCustomerProfile({
			organizationId,
			customerId: intent.customerId,
			source: "shopify",
			updatedAtIso: nowIso(this.now),
			profile,
		});
	}

	private async finalize(
		delivery: ShopifyWebhookDelivery,
		input: {
			customerId?: string;
			checkoutIntentId?: string;
			shopifyOrderLineGid?: string;
			status: "approved" | "rejected" | "needs_review";
			reasonCode?: MembershipReasonCode;
			grant?: Parameters<
				MembershipCommerceRepository["finalizeDecision"]
			>[0]["grant"];
			classEntitlement?: Parameters<
				MembershipCommerceRepository["finalizeDecision"]
			>[0]["classEntitlement"];
			classEntitlements?: Parameters<
				MembershipCommerceRepository["finalizeDecision"]
			>[0]["classEntitlements"];
		},
		projection?: ShopifyOrderProjectionInput,
	) {
		const result = await this.commerce.finalizeDecision({
			deliveryId: delivery.id,
			decision: {
				organizationId: delivery.organizationId,
				customerId: input.customerId,
				checkoutIntentId: input.checkoutIntentId,
				shopifyOrderGid: delivery.shopifyOrderGid,
				shopifyOrderLineGid: input.shopifyOrderLineGid,
				status: input.status,
				reasonCode: input.reasonCode,
				updatedAtIso: nowIso(this.now),
			},
			...(projection ? { projection } : {}),
			grant: input.grant,
			classEntitlement: input.classEntitlement,
			classEntitlements: input.classEntitlements,
		});
		return result;
	}
}
