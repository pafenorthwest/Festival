import type {
	CheckoutIntentRecord,
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	ConsumeRecoveryRequestParams,
	CreateRecoveryRequestParams,
	RecoverableCheckoutIntentRecord,
} from "../domains/class-checkout/index.js";
import {
	cancelPendingRecoveryRequestsInMemory,
	consumeRecoveryRequestInMemory,
	createRecoveryRequestInMemory,
	type EntitlementRef,
	hasCompletedRecoveryTarget,
	type InMemoryRecoveryStore,
	listRecoverableInMemory,
	type OrderProjectionRef,
} from "./in-memory-recovery-helpers.js";

export * from "../domains/class-checkout/checkout-recovery-types.js";

export class InMemoryCheckoutRecoveryRepository
	implements CheckoutRecoveryRepository
{
	private readonly intents = new Map<string, CheckoutIntentRecord>();
	private readonly recoveryRequests = new Map<
		string,
		CheckoutRecoveryRequestRecord
	>();
	private readonly orderProjections: OrderProjectionRef[] = [];
	private readonly classEntitlements: EntitlementRef[] = [];
	private readonly membershipEntitlements: EntitlementRef[] = [];

	private store(): InMemoryRecoveryStore {
		return {
			intents: this.intents,
			recoveryRequests: this.recoveryRequests,
			orderProjections: this.orderProjections,
			classEntitlements: this.classEntitlements,
			membershipEntitlements: this.membershipEntitlements,
		};
	}

	addIntent(intent: CheckoutIntentRecord): void {
		this.intents.set(intent.id, { ...intent });
	}

	addOrderProjection(projection: OrderProjectionRef): void {
		this.orderProjections.push({ ...projection });
	}

	addClassEntitlement(entitlement: EntitlementRef): void {
		this.classEntitlements.push({ ...entitlement });
	}

	addMembershipEntitlement(entitlement: EntitlementRef): void {
		this.membershipEntitlements.push({ ...entitlement });
	}

	addRecoveryRequest(request: CheckoutRecoveryRequestRecord): void {
		this.recoveryRequests.set(request.id, { ...request });
	}

	async hasCompletedOrderOrEntitlement(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<boolean> {
		const intent =
			this.intents.get(intentId) ??
			({ id: intentId, correlationId } as CheckoutIntentRecord);
		return hasCompletedRecoveryTarget(this.store(), organizationId, intent);
	}

	async listRecoverableIntents(
		paramsOrOrg: { organizationId: string; customerId: string } | string,
		maybeCustomerId?: string,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const custId =
			typeof paramsOrOrg === "string"
				? (maybeCustomerId ?? "")
				: paramsOrOrg.customerId;
		return listRecoverableInMemory(this.store(), orgId, custId);
	}

	async invalidateIntent(
		paramsOrOrg:
			| { organizationId: string; intentId: string; reason?: string }
			| string,
		maybeIntentId?: string,
	): Promise<void> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const intentId =
			typeof paramsOrOrg === "string"
				? (maybeIntentId ?? "")
				: paramsOrOrg.intentId;
		const intent = this.intents.get(intentId);
		if (!intent || intent.organizationId !== orgId) {
			throw new Error("Checkout intent not found.");
		}
		if (hasCompletedRecoveryTarget(this.store(), orgId, intent)) {
			throw new Error(
				"Cannot invalidate checkout intent: completed order projection or entitlement exists.",
			);
		}
		intent.status = "superseded";
		cancelPendingRecoveryRequestsInMemory(this.store(), orgId, intentId);
	}

	async createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord> {
		return createRecoveryRequestInMemory(this.store(), params);
	}

	async findRecoveryRequestByTokenHash(
		tokenHashOrParams: string | { tokenHash: string; organizationId?: string },
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const tokenHash =
			typeof tokenHashOrParams === "string"
				? tokenHashOrParams
				: tokenHashOrParams.tokenHash;
		const orgId =
			typeof tokenHashOrParams === "string"
				? maybeOrgId
				: tokenHashOrParams.organizationId;
		for (const req of this.recoveryRequests.values()) {
			if (req.tokenHash === tokenHash) {
				if (orgId && req.organizationId !== orgId) return null;
				if (
					req.status === "pending" &&
					Date.parse(req.expiresAtIso) <= Date.now()
				) {
					return { ...req, status: "expired" };
				}
				return { ...req };
			}
		}
		return null;
	}

	async getRecoveryRequestById(
		organizationId: string,
		id: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const req = this.recoveryRequests.get(id);
		if (!req || req.organizationId !== organizationId) return null;
		if (
			req.status === "pending" &&
			Date.parse(req.expiresAtIso) <= Date.now()
		) {
			return { ...req, status: "expired" };
		}
		return { ...req };
	}

	async findIntentById(
		organizationId: string,
		intentId: string,
	): Promise<RecoverableCheckoutIntentRecord | null> {
		const intent = this.intents.get(intentId);
		if (!intent || intent.organizationId !== organizationId) return null;
		return { ...intent };
	}

	async consumeRecoveryRequest(
		paramsOrToken: ConsumeRecoveryRequestParams | string,
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord> {
		return consumeRecoveryRequestInMemory(
			this.store(),
			paramsOrToken,
			maybeOrgId,
		);
	}
}
