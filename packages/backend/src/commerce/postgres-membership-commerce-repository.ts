import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	CreateClassEntitlementInput,
	EntitlementClass,
} from "@festival/common";
import {
	type ClassEntitlementFilter,
	type FinalizeDecisionInput,
	type FinalizeDecisionResult,
	type MembershipReconciliationRun,
	PostgresClassEntitlementRepository,
	PostgresOrderProjectionRepository,
	PostgresWebhookDeliveryRepository,
	type RecordWebhookDeliveryInput,
	type ResolveDecisionManuallyInput,
	type ShopifyOrderProjectionInput,
	type WebhookDeliveryFailureInput,
} from "../domains/commerce-projection/index.js";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../repo/postgres-schema.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";

export class PostgresMembershipCommerceRepository
	implements MembershipCommerceRepository
{
	private readonly schema: string;
	private readonly deliveries: PostgresWebhookDeliveryRepository;
	private readonly projections: PostgresOrderProjectionRepository;
	private readonly classEntitlements: PostgresClassEntitlementRepository;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
		const ensureReadyFn = () => this.ensureReady();
		this.deliveries = new PostgresWebhookDeliveryRepository(
			this.schema,
			ensureReadyFn,
		);
		this.classEntitlements = new PostgresClassEntitlementRepository(
			this.schema,
			ensureReadyFn,
		);
		this.projections = new PostgresOrderProjectionRepository(
			this.schema,
			ensureReadyFn,
			(orgId, lineGid) =>
				this.classEntitlements.findClassEntitlementByOrderLine(orgId, lineGid),
		);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	recordDelivery(input: RecordWebhookDeliveryInput) {
		return this.deliveries.recordDelivery(input);
	}

	claimDelivery(deliveryId: string) {
		return this.deliveries.claimDelivery(deliveryId);
	}

	markDeliveryFailed(deliveryId: string, failure: WebhookDeliveryFailureInput) {
		return this.deliveries.markDeliveryFailed(deliveryId, failure);
	}

	markDeliveryProcessed(deliveryId: string) {
		return this.deliveries.markDeliveryProcessed(deliveryId);
	}

	listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	) {
		return this.deliveries.listReclaimableDeliveries(
			organizationId,
			limit,
			staleBeforeIso,
		);
	}

	upsertOrderProjection(input: ShopifyOrderProjectionInput) {
		return this.projections.upsertOrderProjection(input);
	}

	listOrderProjectionsByGids(
		organizationId: string,
		shopifyOrderGids: readonly string[],
	) {
		return this.projections.listOrderProjectionsByGids(
			organizationId,
			shopifyOrderGids,
		);
	}

	recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}) {
		return this.projections.recordPendingDecision(input);
	}

	finalizeDecision(
		input: FinalizeDecisionInput,
	): Promise<FinalizeDecisionResult> {
		return this.projections.finalizeDecision(input);
	}

	hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	) {
		return this.projections.hasScheduledEntitlement(
			organizationId,
			customerId,
			entitlementClass,
			today,
		);
	}

	listCustomerDecisions(organizationId: string, customerId: string) {
		return this.projections.listCustomerDecisions(organizationId, customerId);
	}

	recordReconciliationRun(input: Omit<MembershipReconciliationRun, "id">) {
		return this.projections.recordReconciliationRun(input);
	}

	listReconciliationRuns(organizationId: string, limit?: number) {
		return this.projections.listReconciliationRuns(organizationId, limit);
	}

	listUnresolvedDecisions(organizationId: string) {
		return this.projections.listUnresolvedDecisions(organizationId);
	}

	getDecisionById(organizationId: string, decisionId: string) {
		return this.projections.getDecisionById(organizationId, decisionId);
	}

	getDecisionAudit(organizationId: string, decisionId: string) {
		return this.projections.getDecisionAudit(organizationId, decisionId);
	}

	resolveDecisionManually(input: ResolveDecisionManuallyInput) {
		return this.projections.resolveDecisionManually(input);
	}

	createClassEntitlement(input: CreateClassEntitlementInput) {
		return this.classEntitlements.createClassEntitlement(input);
	}

	getClassEntitlement(organizationId: string, id: string) {
		return this.classEntitlements.getClassEntitlement(organizationId, id);
	}

	listClassEntitlements(filter: ClassEntitlementFilter) {
		return this.classEntitlements.listClassEntitlements(filter);
	}

	findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	) {
		return this.classEntitlements.findClassEntitlementByOrderLine(
			organizationId,
			shopifyOrderLineGid,
		);
	}

	findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	) {
		return this.classEntitlements.findClassEntitlementByIntentId(
			organizationId,
			checkoutIntentId,
		);
	}

	findClassEntitlementByIntentLineId(
		organizationId: string,
		checkoutIntentLineId: string,
	) {
		return this.classEntitlements.findClassEntitlementByIntentLineId(
			organizationId,
			checkoutIntentLineId,
		);
	}

	countConfirmedClassEntitlements(
		organizationId: string,
		festivalClassId: string,
	) {
		return this.classEntitlements.countConfirmedClassEntitlements(
			organizationId,
			festivalClassId,
		);
	}

	countConfirmedClassEntitlementsByClassIds(
		organizationId: string,
		festivalClassIds: readonly string[],
	) {
		return this.classEntitlements.countConfirmedClassEntitlementsByClassIds(
			organizationId,
			festivalClassIds,
		);
	}

	updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null> {
		return this.classEntitlements.updateClassEntitlementStatus(
			organizationId,
			id,
			status,
			expectedStatus,
		);
	}

	updateClassEntitlement(
		organizationId: string,
		id: string,
		updates: {
			festivalClassId?: string;
			status?: ClassEntitlementStatus;
			expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[];
		},
		expectedStatus?: ClassEntitlementStatus | ClassEntitlementStatus[],
	): Promise<ClassEntitlement | null> {
		return this.classEntitlements.updateClassEntitlement(
			organizationId,
			id,
			updates,
			expectedStatus,
		);
	}
}
