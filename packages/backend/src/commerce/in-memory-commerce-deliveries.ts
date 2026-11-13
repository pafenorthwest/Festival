import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	EntitlementClass,
	EntitlementGrantSnapshot,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	MembershipDecisionAuditRecord,
	MembershipReconciliationRun,
	MembershipValidationDecision,
	ShopifyOrderProjection,
	ShopifyOrderProjectionInput,
	ShopifyWebhookDelivery,
} from "./membership-commerce-repository.js";

export interface InMemoryCommerceState {
	readonly deliveries: Map<string, ShopifyWebhookDelivery>;
	readonly deliveriesByWebhook: Map<string, string>;
	readonly projections: Map<string, ShopifyOrderProjection>;
	readonly decisions: Map<string, MembershipValidationDecision>;
	readonly decisionAudits: Map<string, MembershipDecisionAuditRecord>;
	readonly decisionsByLine: Map<string, string>;
	readonly decisionsByCheckoutIntent: Map<string, string>;
	readonly classEntitlements: Map<string, ClassEntitlement>;
	readonly classEntitlementsByLine: Map<string, string>;
	readonly classEntitlementsByIntent: Map<string, string>;
	readonly finalizations: Map<
		string,
		Promise<{
			decision: MembershipValidationDecision;
			grant?: EntitlementGrantSnapshot;
			classEntitlement?: ClassEntitlement;
			classEntitlements?: ClassEntitlement[];
			existing: boolean;
		}>
	>;
	readonly reconciliationRuns: MembershipReconciliationRun[];
	readonly organizations: OrganizationRepository;
	readonly checkout?: CheckoutRepository;
	readonly now: () => Date;
}

export function createInMemoryCommerceState(
	organizations: OrganizationRepository,
	checkout?: CheckoutRepository,
	now: () => Date = () => new Date(),
): InMemoryCommerceState {
	const state: InMemoryCommerceState = {
		deliveries: new Map(),
		deliveriesByWebhook: new Map(),
		projections: new Map(),
		decisions: new Map(),
		decisionAudits: new Map(),
		decisionsByLine: new Map(),
		decisionsByCheckoutIntent: new Map(),
		classEntitlements: new Map(),
		classEntitlementsByLine: new Map(),
		classEntitlementsByIntent: new Map(),
		finalizations: new Map(),
		reconciliationRuns: [],
		organizations,
		checkout,
		now,
	};
	checkout?.setClassCheckoutPaymentEvidenceLookup?.(
		(intent) =>
			state.decisionsByCheckoutIntent.has(
				`${intent.organizationId}\u0000${intent.id}`,
			) ||
			state.classEntitlementsByIntent.has(
				`${intent.organizationId}\u0000${intent.id}`,
			) ||
			[...state.projections.values()].some(
				(projection) =>
					projection.organizationId === intent.organizationId &&
					projection.correlationId === intent.correlationId,
			),
	);
	return state;
}

export function recordDeliveryInStore(
	state: InMemoryCommerceState,
	input: {
		organizationId: string;
		shopDomain: string;
		webhookId: string;
		topic: "orders/paid";
		apiVersion: "2026-07";
		shopifyOrderGid: string;
		payloadSha256: string;
		receivedAtIso: string;
	},
) {
	const key = `${input.organizationId}\u0000${input.webhookId}`;
	const existingId = state.deliveriesByWebhook.get(key);
	if (existingId) {
		const existing = state.deliveries.get(existingId);
		if (!existing) throw new Error("Webhook delivery index is invalid.");
		if (existing.payloadSha256 !== input.payloadSha256) {
			return { kind: "conflict" as const };
		}
		return { kind: "duplicate" as const, delivery: { ...existing } };
	}
	const delivery: ShopifyWebhookDelivery = {
		id: randomUUID(),
		...input,
		status: "received",
		attemptCount: 0,
	};
	state.deliveries.set(delivery.id, delivery);
	state.deliveriesByWebhook.set(key, delivery.id);
	return { kind: "accepted" as const, delivery: { ...delivery } };
}

export function claimDeliveryInStore(
	state: InMemoryCommerceState,
	deliveryId: string,
) {
	const delivery = state.deliveries.get(deliveryId);
	if (
		!delivery ||
		(delivery.status !== "received" && delivery.status !== "failed")
	) {
		return null;
	}
	delivery.status = "processing";
	delivery.attemptCount += 1;
	delivery.failureCategory = undefined;
	delivery.failureStage = undefined;
	delivery.failureCode = undefined;
	delivery.shopifyRequestId = undefined;
	delivery.failedAtIso = undefined;
	delivery.processingStartedAtIso = state.now().toISOString();
	return { ...delivery };
}

export function markDeliveryFailedInStore(
	state: InMemoryCommerceState,
	deliveryId: string,
	failure: {
		category: "upstream" | "persistence" | "invalid";
		stage: "order_read" | "projection";
		code:
			| "shopify_upstream"
			| "shopify_transport"
			| "invalid_data"
			| "paid_line_conflict"
			| "persistence"
			| "unexpected";
		requestId?: string;
		failedAtIso: string;
	},
) {
	const delivery = state.deliveries.get(deliveryId);
	if (!delivery) return;
	delivery.status = "failed";
	delivery.failureCategory = failure.category;
	delivery.failureStage = failure.stage;
	delivery.failureCode = failure.code;
	delivery.shopifyRequestId = failure.requestId;
	delivery.failedAtIso = failure.failedAtIso;
	delivery.processingStartedAtIso = undefined;
}

export function markDeliveryProcessedInStore(
	state: InMemoryCommerceState,
	deliveryId: string,
) {
	const delivery = state.deliveries.get(deliveryId);
	if (!delivery) return;
	delivery.status = "processed";
	delivery.processedAtIso = state.now().toISOString();
	delivery.failureCategory = undefined;
	delivery.failureStage = undefined;
	delivery.failureCode = undefined;
	delivery.shopifyRequestId = undefined;
	delivery.failedAtIso = undefined;
	delivery.processingStartedAtIso = undefined;
}

export function listReclaimableDeliveriesInStore(
	state: InMemoryCommerceState,
	organizationId: string,
	limit: number,
	staleBeforeIso: string,
) {
	for (const delivery of state.deliveries.values()) {
		if (
			delivery.organizationId === organizationId &&
			delivery.status === "processing" &&
			(!delivery.processingStartedAtIso ||
				delivery.processingStartedAtIso <= staleBeforeIso)
		) {
			delivery.status = "failed";
			delivery.failureCategory = "upstream";
			delivery.failureStage = "projection";
			delivery.failureCode = "unexpected";
			delivery.failedAtIso = state.now().toISOString();
			delivery.processingStartedAtIso = undefined;
		}
	}
	return [...state.deliveries.values()]
		.filter(
			(d) =>
				d.organizationId === organizationId &&
				(d.status === "received" || d.status === "failed"),
		)
		.sort((a, b) => a.receivedAtIso.localeCompare(b.receivedAtIso))
		.slice(0, limit)
		.map((d) => ({ ...d }));
}

export function upsertOrderProjectionInStore(
	state: InMemoryCommerceState,
	input: ShopifyOrderProjectionInput,
) {
	const key = `${input.organizationId}\u0000${input.shopifyOrderGid}`;
	const existing = state.projections.get(key);
	const projection: ShopifyOrderProjection = {
		...existing,
		...input,
		createdAtIso: existing?.createdAtIso ?? input.updatedAtIso,
		updatedAtIso: input.updatedAtIso,
	};
	state.projections.set(key, projection);
	return { ...projection };
}

export async function hasScheduledEntitlementInStore(
	state: InMemoryCommerceState,
	organizationId: string,
	customerId: string,
	entitlementClass: EntitlementClass,
	today: string,
): Promise<boolean> {
	if (entitlementClass === "accompanist_membership") {
		const grants = await state.organizations.listAccompanistMembershipGrants({
			organizationId,
			customerId,
		});
		return grants.some(
			(grant) =>
				grant.status !== "revoked" &&
				grant.startsOn > today &&
				grant.endsOn > grant.startsOn,
		);
	}
	const grants = await state.organizations.listEntitlementGrantSnapshots(
		organizationId,
		customerId,
	);
	return grants.some(
		(grant) =>
			grant.entitlementClass === entitlementClass &&
			grant.status !== "revoked" &&
			grant.status !== "superseded" &&
			!grant.supersededOn &&
			grant.startsOn > today &&
			grant.endsOn > grant.startsOn,
	);
}
