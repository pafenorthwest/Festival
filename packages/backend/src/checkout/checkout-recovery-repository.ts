import { randomUUID } from "node:crypto";
import type {
	CheckoutIntentRecord,
	CheckoutIntentStatus,
	CheckoutIntentType,
} from "./checkout-repository.js";

export type CheckoutRecoveryStatus =
	| "pending"
	| "consumed"
	| "expired"
	| "cancelled"
	| "invalidated";

export interface CheckoutRecoveryRequestRecord {
	id: string;
	organizationId: string;
	customerId: string;
	sourceCheckoutIntentId: string;
	tokenHash: string;
	status: CheckoutRecoveryStatus;
	requestedByActorUid: string;
	createdAtIso: string;
	expiresAtIso: string;
	consumedAtIso: string | null;
}

export interface RecoverableCheckoutIntentRecord {
	id: string;
	correlationId: string;
	organizationId: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	intentType: CheckoutIntentType;
	offeringId: string | null;
	entitlementClass: "teacher_membership" | null;
	durationDays: number | null;
	festivalClassId: string | null;
	childId: string | null;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	policyVersion: "v1" | null;
	divisionId: string | null;
	divisionNameSnapshot: string | null;
	staffAccessConsent: boolean;
	amount: string;
	currencyCode: string;
	cartReference: string | null;
	status: CheckoutIntentStatus;
	expiresAtIso: string;
	createdAtIso: string;
}

export interface CreateRecoveryRequestParams {
	id?: string;
	organizationId: string;
	customerId: string;
	sourceCheckoutIntentId: string;
	tokenHash: string;
	requestedByActorUid: string;
	expiresAtIso: string;
}

export interface ConsumeRecoveryRequestParams {
	tokenHash: string;
	organizationId?: string;
	consumedAtIso?: string;
}

export interface CheckoutRecoveryRepository {
	listRecoverableIntents(params: {
		organizationId: string;
		customerId: string;
	}): Promise<RecoverableCheckoutIntentRecord[]>;
	listRecoverableIntents(
		organizationId: string,
		customerId: string,
	): Promise<RecoverableCheckoutIntentRecord[]>;

	invalidateIntent(params: {
		organizationId: string;
		intentId: string;
		reason?: string;
	}): Promise<void>;
	invalidateIntent(
		organizationId: string,
		intentId: string,
		reason?: string,
	): Promise<void>;

	createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord>;

	findRecoveryRequestByTokenHash(
		tokenHash: string,
		organizationId?: string,
	): Promise<CheckoutRecoveryRequestRecord | null>;
	findRecoveryRequestByTokenHash(params: {
		tokenHash: string;
		organizationId?: string;
	}): Promise<CheckoutRecoveryRequestRecord | null>;

	getRecoveryRequestById(
		organizationId: string,
		id: string,
	): Promise<CheckoutRecoveryRequestRecord | null>;

	findIntentById?(
		organizationId: string,
		intentId: string,
	): Promise<RecoverableCheckoutIntentRecord | null>;

	consumeRecoveryRequest(
		params: ConsumeRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord>;
	consumeRecoveryRequest(
		tokenHash: string,
		organizationId?: string,
	): Promise<CheckoutRecoveryRequestRecord>;

	hasCompletedOrderOrEntitlement?(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<boolean>;
}

interface OrderProjectionRef {
	organizationId: string;
	correlationId: string;
}

interface EntitlementRef {
	organizationId: string;
	checkoutIntentId: string;
}

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
		return this.checkCompletedOrderOrEntitlement(organizationId, intent);
	}

	private checkCompletedOrderOrEntitlement(
		organizationId: string,
		intent: { id: string; correlationId: string },
	): boolean {
		const hasOrder = this.orderProjections.some(
			(p) =>
				p.organizationId === organizationId &&
				p.correlationId === intent.correlationId,
		);
		if (hasOrder) return true;
		const hasClass = this.classEntitlements.some(
			(e) =>
				e.organizationId === organizationId && e.checkoutIntentId === intent.id,
		);
		if (hasClass) return true;
		return this.membershipEntitlements.some(
			(e) =>
				e.organizationId === organizationId && e.checkoutIntentId === intent.id,
		);
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

		const recoverable: RecoverableCheckoutIntentRecord[] = [];
		for (const intent of this.intents.values()) {
			if (intent.organizationId !== orgId || intent.customerId !== custId) {
				continue;
			}
			if (intent.status === "approved" || intent.status === "superseded") {
				continue;
			}
			if (this.checkCompletedOrderOrEntitlement(orgId, intent)) {
				continue;
			}
			recoverable.push({ ...intent });
		}
		return recoverable.sort((a, b) =>
			b.createdAtIso.localeCompare(a.createdAtIso),
		);
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
		if (this.checkCompletedOrderOrEntitlement(orgId, intent)) {
			throw new Error(
				"Cannot invalidate checkout intent: completed order projection or entitlement exists.",
			);
		}
		intent.status = "superseded";
		this.cancelPendingRecoveryRequests(orgId, intentId);
	}

	private cancelPendingRecoveryRequests(
		organizationId: string,
		sourceIntentId: string,
	): void {
		for (const req of this.recoveryRequests.values()) {
			if (
				req.organizationId === organizationId &&
				req.sourceCheckoutIntentId === sourceIntentId &&
				req.status === "pending"
			) {
				req.status = "cancelled";
			}
		}
	}

	async createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord> {
		const intent = this.intents.get(params.sourceCheckoutIntentId);
		if (!intent || intent.organizationId !== params.organizationId) {
			throw new Error("Checkout intent not found.");
		}
		if (intent.customerId !== params.customerId) {
			throw new Error("Customer mismatch for checkout intent.");
		}
		if (this.checkCompletedOrderOrEntitlement(params.organizationId, intent)) {
			throw new Error(
				"Cannot recover checkout intent: completed order projection or entitlement exists.",
			);
		}
		this.cancelPendingRecoveryRequests(
			params.organizationId,
			params.sourceCheckoutIntentId,
		);

		const id = params.id ?? randomUUID();
		const record: CheckoutRecoveryRequestRecord = {
			id,
			organizationId: params.organizationId,
			customerId: params.customerId,
			sourceCheckoutIntentId: params.sourceCheckoutIntentId,
			tokenHash: params.tokenHash,
			status: "pending",
			requestedByActorUid: params.requestedByActorUid,
			createdAtIso: new Date().toISOString(),
			expiresAtIso: params.expiresAtIso,
			consumedAtIso: null,
		};
		this.recoveryRequests.set(id, record);
		return { ...record };
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
		const tokenHash =
			typeof paramsOrToken === "string"
				? paramsOrToken
				: paramsOrToken.tokenHash;
		const orgId =
			typeof paramsOrToken === "string"
				? maybeOrgId
				: paramsOrToken.organizationId;
		const consumedAt =
			typeof paramsOrToken === "object" && paramsOrToken.consumedAtIso
				? paramsOrToken.consumedAtIso
				: new Date().toISOString();

		let matchedReq: CheckoutRecoveryRequestRecord | null = null;
		for (const req of this.recoveryRequests.values()) {
			if (req.tokenHash === tokenHash) {
				if (orgId && req.organizationId !== orgId) break;
				matchedReq = req;
				break;
			}
		}
		if (!matchedReq) {
			throw new Error("Recovery request not found.");
		}
		if (matchedReq.status !== "pending") {
			throw new Error(
				`Recovery request is not pending (status: ${matchedReq.status}).`,
			);
		}
		if (Date.parse(matchedReq.expiresAtIso) <= Date.parse(consumedAt)) {
			matchedReq.status = "expired";
			throw new Error("Recovery request has expired.");
		}
		matchedReq.status = "consumed";
		matchedReq.consumedAtIso = consumedAt;
		return { ...matchedReq };
	}
}
