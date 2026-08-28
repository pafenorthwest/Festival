import { createHash } from "node:crypto";
import {
	CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
	deriveEntitlementDates,
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
		try {
			const pending = await this.commerce.recordPendingDecision({
				organizationId: delivery.organizationId,
				shopifyOrderGid: delivery.shopifyOrderGid,
				updatedAtIso: nowIso(this.now),
			});
			if (pending.status !== "pending_validation") {
				await this.commerce.markDeliveryProcessed(delivery.id);
				return "skipped";
			}

			const order = await this.readOrder(
				delivery.organizationId,
				delivery.shopifyOrderGid,
			);
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
			await this.projectConsentedCustomerProfile(
				delivery.organizationId,
				intent,
				order,
			).catch(() => undefined);

			const line = order.lineItems[0];
			if (
				!line ||
				!order.fullyPaidAtIso ||
				!intent.divisionId ||
				!intent.divisionNameSnapshot
			) {
				throw new Error("Validated paid order was incomplete.");
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
					},
				},
				projection,
			);
			return "processed";
		} catch (error) {
			await this.commerce.markDeliveryFailed(
				delivery.id,
				failureCategory(error),
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
		if (intent.expiresAtIso <= nowIso(this.now)) return "intent_expired";
		if (!order.fullyPaid) return "order_not_paid";
		if (!order.fullyPaidAtIso) return "payment_incomplete";
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
			await this.commerce.hasActiveGrant(
				organizationId,
				intent.customerId,
				today,
			)
		) {
			return "duplicate_purchase";
		}
		return undefined;
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
		});
		return result;
	}
}
