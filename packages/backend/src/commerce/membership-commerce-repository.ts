import { randomUUID } from "node:crypto";
import type {
	ClassEntitlement,
	ClassEntitlementStatus,
	CreateClassEntitlementInput,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
} from "@festival/common";
import {
	assertValidClassEntitlementInput,
	assertValidEntitlementGrantSnapshotInput,
	isClassEntitlementStatus,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ClassEntitlementFilter } from "./class-entitlement-repository.js";

export const MEMBERSHIP_DECISION_STATUSES = [
	"pending_validation",
	"approved",
	"rejected",
	"needs_review",
] as const;
export type MembershipDecisionStatus =
	(typeof MEMBERSHIP_DECISION_STATUSES)[number];

export const MEMBERSHIP_REASON_CODES = [
	"correlation_missing",
	"correlation_invalid",
	"intent_expired",
	"order_not_paid",
	"payment_incomplete",
	"payment_mismatch",
	"customer_mismatch",
	"offering_mismatch",
	"division_invalid",
	"duplicate_purchase",
	"policy_mismatch",
	"upstream_invalid",
] as const;
export type MembershipReasonCode = (typeof MEMBERSHIP_REASON_CODES)[number];

export interface ShopifyWebhookDelivery {
	id: string;
	organizationId: string;
	shopDomain: string;
	webhookId: string;
	topic: "orders/paid";
	apiVersion: "2026-07";
	shopifyOrderGid: string;
	payloadSha256: string;
	status: "received" | "processing" | "processed" | "failed";
	attemptCount: number;
	failureCategory?: "upstream" | "persistence" | "invalid";
	failureStage?: "order_read" | "projection";
	/** Bounded operational category; never contains upstream response text. */
	failureCode?:
		| "shopify_upstream"
		| "shopify_transport"
		| "invalid_data"
		| "persistence"
		| "unexpected";
	shopifyRequestId?: string;
	failedAtIso?: string;
	receivedAtIso: string;
	processingStartedAtIso?: string;
	processedAtIso?: string;
}

export interface ShopifyOrderProjection {
	organizationId: string;
	shopifyOrderGid: string;
	shopifyCustomerGid?: string;
	correlationId?: string;
	fullyPaidAtIso?: string;
	currencyCode?: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export type ShopifyOrderProjectionInput = Omit<
	ShopifyOrderProjection,
	"createdAtIso" | "updatedAtIso"
> & {
	updatedAtIso: string;
};

export interface MembershipValidationDecision {
	id: string;
	organizationId: string;
	customerId?: string;
	checkoutIntentId?: string;
	shopifyOrderGid: string;
	shopifyOrderLineGid?: string;
	status: MembershipDecisionStatus;
	reasonCode?: MembershipReasonCode;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface MembershipReconciliationRun {
	id: string;
	organizationId: string;
	status: "completed" | "failed";
	discoveredCount: number;
	processedCount: number;
	startedAtIso: string;
	finishedAtIso: string;
	failureCategory?: "upstream" | "persistence" | "invalid";
}

export interface MembershipCommerceRepository {
	ensureReady(): Promise<void>;
	recordDelivery(input: {
		organizationId: string;
		shopDomain: string;
		webhookId: string;
		topic: "orders/paid";
		apiVersion: "2026-07";
		shopifyOrderGid: string;
		payloadSha256: string;
		receivedAtIso: string;
	}): Promise<
		| { kind: "accepted"; delivery: ShopifyWebhookDelivery }
		| { kind: "duplicate"; delivery: ShopifyWebhookDelivery }
		| { kind: "conflict" }
	>;
	claimDelivery(deliveryId: string): Promise<ShopifyWebhookDelivery | null>;
	markDeliveryFailed(
		deliveryId: string,
		failure: {
			category: "upstream" | "persistence" | "invalid";
			stage: "order_read" | "projection";
			code:
				| "shopify_upstream"
				| "shopify_transport"
				| "invalid_data"
				| "persistence"
				| "unexpected";
			requestId?: string;
			failedAtIso: string;
		},
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
	recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}): Promise<MembershipValidationDecision>;
	finalizeDecision(input: {
		deliveryId: string;
		decision: Omit<
			MembershipValidationDecision,
			"id" | "createdAtIso" | "updatedAtIso"
		> & {
			updatedAtIso: string;
		};
		projection?: ShopifyOrderProjectionInput;
		grant?: CreateEntitlementGrantSnapshotInput;
		classEntitlement?: CreateClassEntitlementInput;
	}): Promise<{
		decision: MembershipValidationDecision;
		grant?: EntitlementGrantSnapshot;
		classEntitlement?: ClassEntitlement;
		existing: boolean;
	}>;
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
	updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
	): Promise<ClassEntitlement | null>;
}

export class InMemoryMembershipCommerceRepository
	implements MembershipCommerceRepository
{
	private readonly deliveries = new Map<string, ShopifyWebhookDelivery>();
	private readonly deliveriesByWebhook = new Map<string, string>();
	private readonly projections = new Map<string, ShopifyOrderProjection>();
	private readonly decisions = new Map<string, MembershipValidationDecision>();
	private readonly decisionsByLine = new Map<string, string>();
	private readonly decisionsByCheckoutIntent = new Map<string, string>();
	private readonly classEntitlements = new Map<string, ClassEntitlement>();
	private readonly classEntitlementsByLine = new Map<string, string>();
	private readonly classEntitlementsByIntent = new Map<string, string>();
	private readonly finalizations = new Map<
		string,
		Promise<{
			decision: MembershipValidationDecision;
			grant?: EntitlementGrantSnapshot;
			classEntitlement?: ClassEntitlement;
			existing: boolean;
		}>
	>();
	readonly reconciliationRuns: MembershipReconciliationRun[] = [];

	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly checkout?: CheckoutRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async ensureReady(): Promise<void> {}

	async recordDelivery(input: {
		organizationId: string;
		shopDomain: string;
		webhookId: string;
		topic: "orders/paid";
		apiVersion: "2026-07";
		shopifyOrderGid: string;
		payloadSha256: string;
		receivedAtIso: string;
	}) {
		const key = `${input.organizationId}\u0000${input.webhookId}`;
		const existingId = this.deliveriesByWebhook.get(key);
		if (existingId) {
			const existing = this.deliveries.get(existingId);
			if (!existing) throw new Error("Webhook delivery index is invalid.");
			if (existing.payloadSha256 !== input.payloadSha256)
				return { kind: "conflict" as const };
			return { kind: "duplicate" as const, delivery: { ...existing } };
		}
		const delivery: ShopifyWebhookDelivery = {
			id: randomUUID(),
			...input,
			status: "received",
			attemptCount: 0,
		};
		this.deliveries.set(delivery.id, delivery);
		this.deliveriesByWebhook.set(key, delivery.id);
		return { kind: "accepted" as const, delivery: { ...delivery } };
	}

	async claimDelivery(deliveryId: string) {
		const delivery = this.deliveries.get(deliveryId);
		if (
			!delivery ||
			(delivery.status !== "received" && delivery.status !== "failed")
		)
			return null;
		delivery.status = "processing";
		delivery.attemptCount += 1;
		delivery.failureCategory = undefined;
		delivery.failureStage = undefined;
		delivery.failureCode = undefined;
		delivery.shopifyRequestId = undefined;
		delivery.failedAtIso = undefined;
		delivery.processingStartedAtIso = this.now().toISOString();
		return { ...delivery };
	}

	async markDeliveryFailed(
		deliveryId: string,
		failure: {
			category: "upstream" | "persistence" | "invalid";
			stage: "order_read" | "projection";
			code:
				| "shopify_upstream"
				| "shopify_transport"
				| "invalid_data"
				| "persistence"
				| "unexpected";
			requestId?: string;
			failedAtIso: string;
		},
	) {
		const delivery = this.deliveries.get(deliveryId);
		if (!delivery) return;
		delivery.status = "failed";
		delivery.failureCategory = failure.category;
		delivery.failureStage = failure.stage;
		delivery.failureCode = failure.code;
		delivery.shopifyRequestId = failure.requestId;
		delivery.failedAtIso = failure.failedAtIso;
		delivery.processingStartedAtIso = undefined;
	}

	async markDeliveryProcessed(deliveryId: string) {
		const delivery = this.deliveries.get(deliveryId);
		if (!delivery) return;
		delivery.status = "processed";
		delivery.processedAtIso = this.now().toISOString();
		delivery.failureCategory = undefined;
		delivery.failureStage = undefined;
		delivery.failureCode = undefined;
		delivery.shopifyRequestId = undefined;
		delivery.failedAtIso = undefined;
		delivery.processingStartedAtIso = undefined;
	}

	async listReclaimableDeliveries(
		organizationId: string,
		limit: number,
		staleBeforeIso: string,
	) {
		for (const delivery of this.deliveries.values()) {
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
				delivery.failedAtIso = this.now().toISOString();
				delivery.processingStartedAtIso = undefined;
			}
		}
		return [...this.deliveries.values()]
			.filter(
				(delivery) =>
					delivery.organizationId === organizationId &&
					(delivery.status === "received" || delivery.status === "failed"),
			)
			.sort((left, right) =>
				left.receivedAtIso.localeCompare(right.receivedAtIso),
			)
			.slice(0, limit)
			.map((delivery) => ({ ...delivery }));
	}

	async upsertOrderProjection(input: ShopifyOrderProjectionInput) {
		const key = `${input.organizationId}\u0000${input.shopifyOrderGid}`;
		const existing = this.projections.get(key);
		const projection: ShopifyOrderProjection = {
			...existing,
			...input,
			createdAtIso: existing?.createdAtIso ?? input.updatedAtIso,
			updatedAtIso: input.updatedAtIso,
		};
		this.projections.set(key, projection);
		return { ...projection };
	}

	async recordPendingDecision(input: {
		organizationId: string;
		shopifyOrderGid: string;
		updatedAtIso: string;
	}) {
		const key = `${input.organizationId}\u0000${input.shopifyOrderGid}`;
		const existing = this.decisions.get(key);
		if (existing) return { ...existing };
		const pending: MembershipValidationDecision = {
			id: randomUUID(),
			organizationId: input.organizationId,
			shopifyOrderGid: input.shopifyOrderGid,
			status: "pending_validation",
			createdAtIso: input.updatedAtIso,
			updatedAtIso: input.updatedAtIso,
		};
		this.decisions.set(key, pending);
		return { ...pending };
	}

	async finalizeDecision(input: {
		deliveryId: string;
		decision: Omit<
			MembershipValidationDecision,
			"id" | "createdAtIso" | "updatedAtIso"
		> & {
			updatedAtIso: string;
		};
		projection?: ShopifyOrderProjectionInput;
		grant?: CreateEntitlementGrantSnapshotInput;
		classEntitlement?: CreateClassEntitlementInput;
	}) {
		const finalizationKey = `${input.decision.organizationId}\u0000${input.decision.checkoutIntentId ? `intent:${input.decision.checkoutIntentId}` : `order:${input.decision.shopifyOrderGid}`}`;
		const pending = this.finalizations.get(finalizationKey);
		if (pending) {
			const result = await pending;
			await this.markDeliveryProcessed(input.deliveryId);
			return { ...result, existing: true };
		}
		const work = this.finalizeDecisionInternal(input);
		this.finalizations.set(finalizationKey, work);
		try {
			return await work;
		} finally {
			if (this.finalizations.get(finalizationKey) === work)
				this.finalizations.delete(finalizationKey);
		}
	}

	private async finalizeDecisionInternal(input: {
		deliveryId: string;
		decision: Omit<
			MembershipValidationDecision,
			"id" | "createdAtIso" | "updatedAtIso"
		> & {
			updatedAtIso: string;
		};
		projection?: ShopifyOrderProjectionInput;
		grant?: CreateEntitlementGrantSnapshotInput;
		classEntitlement?: CreateClassEntitlementInput;
	}) {
		const orderKey = `${input.decision.organizationId}\u0000${input.decision.shopifyOrderGid}`;
		const existing = this.decisions.get(orderKey);
		if (existing && existing.status !== "pending_validation") {
			await this.resolveTerminalIntent(existing);
			await this.markDeliveryProcessed(input.deliveryId);
			const existingClass = input.decision.shopifyOrderLineGid
				? await this.findClassEntitlementByOrderLine(
						input.decision.organizationId,
						input.decision.shopifyOrderLineGid,
					)
				: null;
			return {
				decision: { ...existing },
				classEntitlement: existingClass ?? undefined,
				existing: true,
			};
		}
		if (input.decision.checkoutIntentId) {
			const checkoutKey = `${input.decision.organizationId}\u0000${input.decision.checkoutIntentId}`;
			const existingCheckoutKey =
				this.decisionsByCheckoutIntent.get(checkoutKey);
			if (existingCheckoutKey && existingCheckoutKey !== orderKey) {
				const existingCheckout = this.decisions.get(existingCheckoutKey);
				if (!existingCheckout)
					throw new Error("Checkout decision index is invalid.");
				await this.resolveTerminalIntent(existingCheckout);
				await this.markDeliveryProcessed(input.deliveryId);
				const existingClass = input.decision.shopifyOrderLineGid
					? await this.findClassEntitlementByOrderLine(
							input.decision.organizationId,
							input.decision.shopifyOrderLineGid,
						)
					: null;
				return {
					decision: { ...existingCheckout },
					classEntitlement: existingClass ?? undefined,
					existing: true,
				};
			}
		}
		if (
			input.decision.shopifyOrderLineGid &&
			this.decisionsByLine.get(
				`${input.decision.organizationId}\u0000${input.decision.shopifyOrderLineGid}`,
			) !== undefined
		) {
			const existingLineKey = this.decisionsByLine.get(
				`${input.decision.organizationId}\u0000${input.decision.shopifyOrderLineGid}`,
			);
			if (existingLineKey && existingLineKey !== orderKey) {
				const existingLine = this.decisions.get(existingLineKey);
				if (!existingLine)
					throw new Error("Order-line decision index is invalid.");
				await this.resolveTerminalIntent(existingLine);
				await this.markDeliveryProcessed(input.deliveryId);
				const existingClass = input.decision.shopifyOrderLineGid
					? await this.findClassEntitlementByOrderLine(
							input.decision.organizationId,
							input.decision.shopifyOrderLineGid,
						)
					: null;
				return {
					decision: { ...existingLine },
					classEntitlement: existingClass ?? undefined,
					existing: true,
				};
			}
		}
		if (
			input.projection &&
			(input.projection.organizationId !== input.decision.organizationId ||
				input.projection.shopifyOrderGid !== input.decision.shopifyOrderGid)
		) {
			throw new Error(
				"Order projection does not match its validation decision.",
			);
		}
		if (input.projection) await this.upsertOrderProjection(input.projection);
		let grant: EntitlementGrantSnapshot | undefined;
		let classEntitlement: ClassEntitlement | undefined;
		if (input.decision.status === "approved") {
			if (input.grant && input.classEntitlement) {
				throw new Error(
					"Approved decision cannot specify both a membership grant and class entitlement.",
				);
			}
			if (!input.grant && !input.classEntitlement) {
				throw new Error(
					"Approved decision requires a grant or class entitlement.",
				);
			}
			if (input.grant) {
				assertValidEntitlementGrantSnapshotInput(input.grant);
				grant = await this.organizations.createEntitlementGrantSnapshot(
					input.grant,
				);
			}
			if (input.classEntitlement) {
				assertValidClassEntitlementInput(input.classEntitlement);
				classEntitlement = await this.createClassEntitlement(
					input.classEntitlement,
				);
				if (this.checkout && input.classEntitlement.checkoutIntentId) {
					await this.checkout.linkRegistrationMetadataToEntitlement({
						checkoutIntentId: input.classEntitlement.checkoutIntentId,
						classEntitlementId: classEntitlement.id,
					});
				}
			}
		} else if (input.grant || input.classEntitlement) {
			throw new Error(
				"Non-approved decision cannot create a grant or class entitlement.",
			);
		}
		const decision: MembershipValidationDecision = {
			...input.decision,
			id: existing?.id ?? randomUUID(),
			createdAtIso: existing?.createdAtIso ?? input.decision.updatedAtIso,
		};
		this.decisions.set(orderKey, decision);
		if (decision.checkoutIntentId) {
			this.decisionsByCheckoutIntent.set(
				`${decision.organizationId}\u0000${decision.checkoutIntentId}`,
				orderKey,
			);
		}
		if (decision.shopifyOrderLineGid) {
			this.decisionsByLine.set(
				`${decision.organizationId}\u0000${decision.shopifyOrderLineGid}`,
				orderKey,
			);
		}
		await this.resolveTerminalIntent(decision);
		await this.markDeliveryProcessed(input.deliveryId);
		return {
			decision: { ...decision },
			grant,
			classEntitlement,
			existing: false,
		};
	}

	private async resolveTerminalIntent(decision: MembershipValidationDecision) {
		if (
			!this.checkout ||
			!decision.checkoutIntentId ||
			decision.status === "pending_validation"
		)
			return;
		await this.checkout.resolveIntent(
			decision.checkoutIntentId,
			decision.status,
		);
	}

	async hasScheduledEntitlement(
		organizationId: string,
		customerId: string,
		entitlementClass: EntitlementClass,
		today: string,
	) {
		if (entitlementClass === "accompanist_membership") {
			const grants = await this.organizations.listAccompanistMembershipGrants({
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
		const grants = await this.organizations.listEntitlementGrantSnapshots(
			organizationId,
			customerId,
		);
		return grants.some(
			(grant) =>
				grant.entitlementClass === entitlementClass &&
				grant.status !== "revoked" &&
				grant.startsOn > today &&
				grant.endsOn > grant.startsOn,
		);
	}

	async listCustomerDecisions(organizationId: string, customerId: string) {
		return [...this.decisions.values()]
			.filter(
				(decision) =>
					decision.organizationId === organizationId &&
					decision.customerId === customerId,
			)
			.sort((left, right) =>
				right.createdAtIso.localeCompare(left.createdAtIso),
			)
			.map((decision) => ({ ...decision }));
	}

	async recordReconciliationRun(
		input: Omit<MembershipReconciliationRun, "id">,
	) {
		const run = { id: randomUUID(), ...input };
		this.reconciliationRuns.push(run);
		return { ...run };
	}

	async createClassEntitlement(
		input: CreateClassEntitlementInput,
	): Promise<ClassEntitlement> {
		assertValidClassEntitlementInput(input);
		const lineKey = `${input.organizationId}\u0000${input.shopifyOrderLineGid}`;
		const existingLineId = this.classEntitlementsByLine.get(lineKey);
		if (existingLineId) {
			const existing = this.classEntitlements.get(existingLineId);
			if (existing) return { ...existing };
		}
		const id = input.id ?? randomUUID();
		const nowIso = this.now().toISOString();
		const record: ClassEntitlement = {
			id,
			organizationId: input.organizationId,
			festivalId: input.festivalId,
			festivalClassId: input.festivalClassId,
			parentCustomerId: input.parentCustomerId,
			childId: input.childId,
			checkoutIntentId: input.checkoutIntentId,
			shopifyOrderGid: input.shopifyOrderGid,
			shopifyOrderLineGid: input.shopifyOrderLineGid,
			paidAmountCents: input.paidAmountCents,
			paidCurrencyCode: input.paidCurrencyCode,
			status: input.status ?? "confirmed",
			createdAt: input.createdAt ?? nowIso,
			updatedAt: input.updatedAt ?? nowIso,
		};
		this.classEntitlements.set(id, record);
		this.classEntitlementsByLine.set(lineKey, id);
		this.classEntitlementsByIntent.set(
			`${input.organizationId}\u0000${input.checkoutIntentId}`,
			id,
		);
		return { ...record };
	}

	async getClassEntitlement(
		organizationId: string,
		id: string,
	): Promise<ClassEntitlement | null> {
		const record = this.classEntitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		return { ...record };
	}

	async listClassEntitlements(
		filter: ClassEntitlementFilter,
	): Promise<ClassEntitlement[]> {
		return [...this.classEntitlements.values()]
			.filter((record) => {
				if (record.organizationId !== filter.organizationId) return false;
				if (filter.festivalId && record.festivalId !== filter.festivalId)
					return false;
				if (
					filter.festivalClassId &&
					record.festivalClassId !== filter.festivalClassId
				)
					return false;
				if (
					filter.parentCustomerId &&
					record.parentCustomerId !== filter.parentCustomerId
				)
					return false;
				if (filter.childId && record.childId !== filter.childId) return false;
				if (filter.status && record.status !== filter.status) return false;
				return true;
			})
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.map((record) => ({ ...record }));
	}

	async findClassEntitlementByOrderLine(
		organizationId: string,
		shopifyOrderLineGid: string,
	): Promise<ClassEntitlement | null> {
		const id = this.classEntitlementsByLine.get(
			`${organizationId}\u0000${shopifyOrderLineGid}`,
		);
		if (!id) return null;
		return this.getClassEntitlement(organizationId, id);
	}

	async findClassEntitlementByIntentId(
		organizationId: string,
		checkoutIntentId: string,
	): Promise<ClassEntitlement | null> {
		const id = this.classEntitlementsByIntent.get(
			`${organizationId}\u0000${checkoutIntentId}`,
		);
		if (!id) return null;
		return this.getClassEntitlement(organizationId, id);
	}

	async updateClassEntitlementStatus(
		organizationId: string,
		id: string,
		status: ClassEntitlementStatus,
	): Promise<ClassEntitlement | null> {
		if (!isClassEntitlementStatus(status)) {
			throw new Error("Class entitlement status is invalid.");
		}
		const record = this.classEntitlements.get(id);
		if (!record || record.organizationId !== organizationId) return null;
		record.status = status;
		record.updatedAt = this.now().toISOString();
		return { ...record };
	}
}
