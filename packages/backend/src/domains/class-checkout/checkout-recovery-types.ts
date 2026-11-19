import type {
	CheckoutIntentStatus,
	CheckoutIntentType,
} from "./checkout-types.js";

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
