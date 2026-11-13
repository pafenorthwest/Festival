import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	CreateClassEntitlementInput,
	EntitlementClass,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import {
	type ClassEntitlementFilter,
	type FinalizeDecisionInput,
	type FinalizeDecisionResult,
	MEMBERSHIP_DECISION_STATUSES,
	MEMBERSHIP_REASON_CODES,
	type MembershipDecisionAuditRecord,
	type MembershipDecisionStatus,
	type MembershipReasonCode,
	type MembershipReconciliationRun,
	type MembershipValidationDecision,
	PaidLineConflictError,
	type RecordWebhookDeliveryInput,
	type ResolveDecisionManuallyInput,
	type ResolveDecisionManuallyResult,
	type ShopifyOrderProjection,
	type ShopifyOrderProjectionInput,
	type ShopifyWebhookDelivery,
	type WebhookDeliveryFailureInput,
} from "../domains/commerce-projection/index.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	countConfirmedClassEntitlementsByIdsInStore,
	countConfirmedClassEntitlementsInStore,
	createClassEntitlementInStore,
	listClassEntitlementsInStore,
	updateClassEntitlementStatusInStore,
} from "./in-memory-commerce-class-entitlements.js";
import {
	claimDeliveryInStore,
	createInMemoryCommerceState,
	hasScheduledEntitlementInStore,
	type InMemoryCommerceState,
	listReclaimableDeliveriesInStore,
	markDeliveryFailedInStore,
	markDeliveryProcessedInStore,
	recordDeliveryInStore,
	upsertOrderProjectionInStore,
} from "./in-memory-commerce-deliveries.js";
import {
	finalizeDecisionInStore,
	resolveDecisionManuallyInStore,
} from "./in-memory-commerce-finalization.js";

export {
	type ClassEntitlementFilter,
	type FinalizeDecisionInput,
	type FinalizeDecisionResult,
	MEMBERSHIP_DECISION_STATUSES,
	MEMBERSHIP_REASON_CODES,
	type MembershipDecisionAuditRecord,
	type MembershipDecisionStatus,
	type MembershipReasonCode,
	type MembershipReconciliationRun,
	type MembershipValidationDecision,
	PaidLineConflictError,
	type RecordWebhookDeliveryInput,
	type ResolveDecisionManuallyInput,
	type ResolveDecisionManuallyResult,
	type ShopifyOrderProjection,
	type ShopifyOrderProjectionInput,
	type ShopifyWebhookDelivery,
	type WebhookDeliveryFailureInput,
};

export interface MembershipCommerceRepository {
	ensureReady(): Promise<void>;
	recordDelivery(
		input: RecordWebhookDeliveryInput,
	): Promise<
		| { kind: "accepted"; delivery: ShopifyWebhookDelivery }
		| { kind: "duplicate"; delivery: ShopifyWebhookDelivery }
		| { kind: "conflict" }
	>;
	claimDelivery(deliveryId: string): Promise<ShopifyWebhookDelivery | null>;
	markDeliveryFailed(
		deliveryId: string,
		failure: WebhookDeliveryFailureInput,
	): Promise<void>;
	markDeliveryProcessed(deliveryId: string): Promise<void>;
	listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	): Promise<ShopifyWebhookDelivery[]>;
	upsertOrderProjection(
		input: ShopifyOrderProjectionInput,
	): Promise<ShopifyOrderProjection>;
	listOrderProjectionsByGids(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	): Promise<ShopifyOrderProjection[]>;
	recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}): Promise<MembershipValidationDecision>;
	finalizeDecision(
		input: FinalizeDecisionInput,
	): Promise<FinalizeDecisionResult>;
	hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	): Promise<boolean>;
	listCustomerDecisions(
		organizationId: string,
		customerId: string,
	): Promise<MembershipValidationDecision[]>;
	recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	): Promise<MembershipReconciliationRun>;
	listReconciliationRuns(
		organizationId: string,
		limit?: number,
	): Promise<MembershipReconciliationRun[]>;
	listUnresolvedDecisions(
		organizationId: string,
	): Promise<MembershipValidationDecision[]>;
	getDecisionById(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipValidationDecision | null>;
	getDecisionAudit(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipDecisionAuditRecord | null>;
	resolveDecisionManually(
		input: ResolveDecisionManuallyInput,
	): Promise<ResolveDecisionManuallyResult>;
	createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement>;
	getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null>;
	listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]>;
	findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null>;
	findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null>;
	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	): Promise<number>;
	countConfirmedClassEntitlementsByClassIds?(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>>;
	updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
	): Promise<ClassEntitlement | null>;
}

export class InMemoryMembershipCommerceRepository
	implements MembershipCommerceRepository
{
	private readonly state: InMemoryCommerceState;

	get reconciliationRuns(): MembershipReconciliationRun[] {
		return this.state.reconciliationRuns;
	}

	constructor(
		organizations: OrganizationRepository,
		checkout?: CheckoutRepository,
		now: () => Date = () => new Date(),
	) {
		this.state = createInMemoryCommerceState(organizations, checkout, now);
	}

	async ensureReady(): Promise<void> {}

	async recordDelivery(input: RecordWebhookDeliveryInput) {
		return recordDeliveryInStore(this.state, input);
	}

	async claimDelivery(deliveryId: string) {
		return claimDeliveryInStore(this.state, deliveryId);
	}

	async markDeliveryFailed(
		deliveryId: string,
		failure: WebhookDeliveryFailureInput,
	) {
		markDeliveryFailedInStore(this.state, deliveryId, failure);
	}

	async markDeliveryProcessed(deliveryId: string) {
		markDeliveryProcessedInStore(this.state, deliveryId);
	}

	async listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	) {
		return listReclaimableDeliveriesInStore(
			this.state,
			organizationId,
			limit,
			staleBeforeIso,
		);
	}

	async upsertOrderProjection(input: ShopifyOrderProjectionInput) {
		return upsertOrderProjectionInStore(this.state, input);
	}

	async listOrderProjectionsByGids(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	): Promise<ShopifyOrderProjection[]> {
		const gids = new Set(shopifyOrderGids);
		return [...this.state.projections.values()]
			.filter(
				(p) =>
					p.organizationId === organizationId && gids.has(p.shopifyOrderGid),
			)
			.map((p) => ({ ...p }));
	}

	async recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}) {
		const key = `${input.organizationId}\u0000${input.shopifyOrderGid}`;
		const existing = this.state.decisions.get(key);
		if (existing) return { ...existing };
		const pending: MembershipValidationDecision = {
			id: randomUUID(),
			organizationId: input.organizationId,
			shopifyOrderGid: input.shopifyOrderGid,
			status: "pending_validation",
			createdAtIso: input.updatedAtIso,
			updatedAtIso: input.updatedAtIso,
		};
		this.state.decisions.set(key, pending);
		return { ...pending };
	}

	finalizeDecision(input: FinalizeDecisionInput) {
		return finalizeDecisionInStore(this.state, input);
	}

	hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	) {
		return hasScheduledEntitlementInStore(
			this.state,
			organizationId,
			customerId,
			entitlementClass,
			today,
		);
	}

	async listCustomerDecisions(organizationId: string, customerId: string) {
		return [...this.state.decisions.values()]
			.filter(
				(d) =>
					d.organizationId === organizationId && d.customerId === customerId,
			)
			.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
			.map((d) => ({ ...d }));
	}

	async recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	) {
		const run = { id: randomUUID(), ...input };
		this.state.reconciliationRuns.push(run);
		return { ...run };
	}

	async listReconciliationRuns(organizationId: string, limit = 10) {
		return this.state.reconciliationRuns
			.filter((r) => r.organizationId === organizationId)
			.slice()
			.sort((a, b) => b.finishedAtIso.localeCompare(a.finishedAtIso))
			.slice(0, limit)
			.map((r) => ({ ...r }));
	}

	async listUnresolvedDecisions(organizationId: string) {
		return [...this.state.decisions.values()]
			.filter(
				(d) =>
					d.organizationId === organizationId &&
					(d.status === "pending_validation" || d.status === "needs_review"),
			)
			.sort((a, b) => b.updatedAtIso.localeCompare(a.updatedAtIso))
			.map((d) => ({ ...d }));
	}

	async getDecisionById(organizationId: string, decisionId: string) {
		const found = [...this.state.decisions.values()].find(
			(d) => d.id === decisionId && d.organizationId === organizationId,
		);
		return found ? { ...found } : null;
	}

	async getDecisionAudit(organizationId: string, decisionId: string) {
		const audit = this.state.decisionAudits.get(decisionId);
		if (!audit || audit.organizationId !== organizationId) return null;
		return { ...audit };
	}

	resolveDecisionManually(input: ResolveDecisionManuallyInput) {
		return resolveDecisionManuallyInStore(this.state, input);
	}

	createClassEntitlement(input: CreateClassEntitlementInput) {
		return withInMemoryCapacityLock(() =>
			createClassEntitlementInStore(this.state, input),
		);
	}

	async getClassEntitlement(organizationId: string, id: string) {
		const record = this.state.classEntitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		return { ...record };
	}

	async listClassEntitlements(filter: ClassEntitlementFilter) {
		return listClassEntitlementsInStore(this.state, filter);
	}

	async findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	) {
		const id = this.state.classEntitlementsByLine.get(
			`${organizationId}\u0000${shopifyOrderLineGid}`,
		);
		return id ? this.getClassEntitlement(organizationId, id) : null;
	}

	async findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	) {
		const id = this.state.classEntitlementsByIntent.get(
			`${organizationId}\u0000${checkoutIntentId}`,
		);
		return id ? this.getClassEntitlement(organizationId, id) : null;
	}

	async countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	) {
		return countConfirmedClassEntitlementsInStore(
			this.state,
			organizationId,
			festivalClassId,
		);
	}

	async countConfirmedClassEntitlementsByClassIds(
		organizationId: string,
		festivalClassIds: readonly string[],
	) {
		return countConfirmedClassEntitlementsByIdsInStore(
			this.state,
			organizationId,
			festivalClassIds,
		);
	}

	updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
	) {
		return updateClassEntitlementStatusInStore(
			this.state,
			organizationId,
			id,
			status,
		);
	}
}
