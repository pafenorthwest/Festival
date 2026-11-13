import type {
	AppError,
	ClassRegistrationMetadata,
	ClassRegistrationSnapshot,
	RepertoirePiece,
} from "@festival/common";
import { AppError as CommonAppError } from "@festival/common";
import type {
	ClassCheckoutClaim,
	ClassCheckoutExecution,
	ClassCheckoutExecutionRepository,
} from "./checkout-execution-types.js";

export type CheckoutCartStatus =
	| "ready"
	| "checkout_started"
	| "expired"
	| "superseded";

export type CheckoutIntentStatus =
	| "creating"
	| "ready"
	| "checkout_started"
	| "failed"
	| "expired"
	| "superseded"
	| "approved"
	| "rejected"
	| "needs_review";

export interface CheckoutCartRecord {
	reference: string;
	shopifyCartId: string;
	organizationId: string;
	customerId: string;
	sessionId: string;
	integrationVersion: number;
	status: CheckoutCartStatus;
	expiresAtIso: string;
	createdAtIso: string;
}

export type CheckoutIntentType = "membership" | "class_entry";

export const CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL = "class_line_identity_v1";

export interface CheckoutIntentLineItemRecord {
	id: string;
	checkoutIntentId: string;
	lineIndex: number;
	lineType: string;
	festivalClassId: string | null;
	childId: string | null;
	offeringId: string | null;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	amount: string;
	currencyCode: string;
	divisionId: string | null;
	divisionNameSnapshot: string | null;
	createdAtIso: string;
}

export interface CheckoutIntentRecord {
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
	lineIdentityProtocol?: string | null;
	lines?: CheckoutIntentLineItemRecord[];
}

export function assertCheckoutIntentType(
	intent: CheckoutIntentRecord,
	expectedType: CheckoutIntentType,
): void {
	if (intent.intentType !== expectedType) {
		throw new CommonAppError(
			"This checkout key is already associated with another purchase type.",
			409,
			"checkout_payload_conflict",
		);
	}
}

export type CheckoutIntentOutcome =
	| { kind: "created"; intent: CheckoutIntentRecord }
	| { kind: "in_progress" }
	| { kind: "ready"; intent: CheckoutIntentRecord; cart: CheckoutCartRecord }
	| { kind: "active" }
	| { kind: "expired" }
	| { kind: "failed" };

export type ClassCheckoutReplayState = Pick<
	ClassCheckoutExecution,
	"state" | "generation" | "resultCode"
> & { intentStatus: CheckoutIntentStatus };

export interface CreateCheckoutIntentLineInput {
	id?: string;
	lineIndex?: number;
	lineType?: string;
	festivalClassId?: string | null;
	childId?: string | null;
	offeringId?: string | null;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	amount: string;
	currencyCode: string;
	divisionId?: string | null;
	divisionNameSnapshot?: string | null;
}

export type CreateCheckoutIntentInput = Omit<
	CheckoutIntentRecord,
	| "id"
	| "correlationId"
	| "cartReference"
	| "createdAtIso"
	| "status"
	| "intentType"
	| "offeringId"
	| "entitlementClass"
	| "durationDays"
	| "festivalClassId"
	| "childId"
	| "policyVersion"
	| "divisionId"
	| "divisionNameSnapshot"
	| "staffAccessConsent"
	| "lines"
> & {
	intentType?: CheckoutIntentType;
	offeringId?: string | null;
	entitlementClass?: "teacher_membership" | null;
	durationDays?: number | null;
	festivalClassId?: string | null;
	childId?: string | null;
	policyVersion?: "v1" | null;
	divisionId?: string | null;
	divisionNameSnapshot?: string | null;
	staffAccessConsent?: boolean;
	lines?: CreateCheckoutIntentLineInput[];
	classExecution?: { fingerprint: string; requestSnapshot: unknown };
};

export interface CheckoutRepository {
	classExecutions?: ClassCheckoutExecutionRepository;
	setClassCheckoutPaymentEvidenceLookup?(
		lookup: (intent: CheckoutIntentRecord) => boolean,
	): void;
	findIntentByKey?(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}): Promise<CheckoutIntentRecord | null>;
	getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}): Promise<Exclude<CheckoutIntentOutcome, { kind: "created" }> | null>;
	createIntent(
		record: CreateCheckoutIntentInput,
	): Promise<CheckoutIntentOutcome>;
	attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	): Promise<CheckoutCartRecord>;
	markIntentReady?(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
			capacityCheck?: () => Promise<AppError | null>;
			executionClaim?: ClassCheckoutClaim;
		},
	): Promise<CheckoutCartRecord>;
	markCheckoutStarted(intentId: string): Promise<void>;
	markFailed(intentId: string): Promise<void>;
	markIntentFailed?(input: {
		organizationId?: string;
		intentId: string;
		failureCode?: string;
		failureMessage?: string;
	}): Promise<void>;
	getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	): Promise<CheckoutCartRecord | null>;
	findIntentByCorrelation(
		organizationId: string,
		correlationId: string,
	): Promise<CheckoutIntentRecord | null>;
	findIntentByCorrelationId?(
		organizationId: string,
		correlationId: string,
	): Promise<CheckoutIntentRecord | null>;
	findIntentById?(
		organizationId: string,
		intentId: string,
	): Promise<CheckoutIntentRecord | null>;
	getClassCheckoutReplayState(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutReplayState | null>;
	hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
		intentType?: CheckoutIntentType,
	): Promise<boolean>;
	resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	): Promise<void>;
	insertRegistrationMetadata(params: {
		id: string;
		organizationId: string;
		festivalId: string;
		checkoutIntentId: string;
		checkoutIntentLineId?: string | null;
		teacherMembershipId: string;
		accompanistMembershipId: string | null;
		repertoireJson: RepertoirePiece[];
		repertoireSnapshotPieces?: RepertoirePiece[];
		registrationSnapshot?: ClassRegistrationSnapshot | null;
	}): Promise<ClassRegistrationMetadata>;
	listCheckoutRegistrationSnapshots?(
		organizationId: string,
		intentId: string,
	): Promise<
		Array<{
			checkoutIntentLineId: string;
			registrationSnapshot: ClassRegistrationSnapshot;
		}>
	>;
	linkRegistrationMetadataToEntitlement(params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
		tx?: { unsafe(sql: string, params?: unknown[]): Promise<unknown> };
	}): Promise<void>;
	getRegistrationMetadataByEntitlementId(
		organizationId: string,
		classEntitlementId: string,
	): Promise<ClassRegistrationMetadata | null>;
	listRegistrationMetadataByEntitlementIds?(
		organizationId: string,
		classEntitlementIds: readonly string[],
	): Promise<Map<string, ClassRegistrationMetadata>>;
	updateRegistrationMetadata(
		registrationMetadataId: string,
		organizationId: string,
		input: {
			accompanistMembershipId?: string | null;
			pieces: RepertoirePiece[];
		},
	): Promise<ClassRegistrationMetadata>;
}
