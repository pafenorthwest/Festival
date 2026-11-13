export type ClassCheckoutExecutionState =
	| "ready"
	| "running"
	| "retryable"
	| "recovery_required"
	| "completed"
	| "rejected";

export type ClassCheckoutCheckpoint =
	| "prepared"
	| "create_dispatched"
	| "remote_cart_known"
	| "attached";

export interface ClassCheckoutClaim {
	organizationId: string;
	intentId: string;
	owner: string;
	generation: number;
}

export interface ClassCheckoutEvidence {
	code?: string;
	message?: string;
	stage?: string;
	shopifyRequestId?: string;
	shopifyOrderGid?: string;
	shopifyCartId?: string;
	actorId?: string;
	resolution?: string;
}

export interface ClassCheckoutStorefrontBinding {
	shopDomain: string;
	integrationVersion: number;
}

export interface ClassCheckoutExecution {
	organizationId: string;
	customerId: string;
	intentId: string;
	fingerprint: string;
	requestSnapshot: unknown;
	storefrontBinding: ClassCheckoutStorefrontBinding | null;
	state: ClassCheckoutExecutionState;
	checkpoint: ClassCheckoutCheckpoint;
	generation: number;
	leaseOwner: string | null;
	leaseExpiresAtIso: string | null;
	shopifyCartId: string | null;
	resultCode: string | null;
	recoveryReference: string;
	recoveryRecordedAtIso: string | null;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface ClassCheckoutExecutionEvent {
	id: string;
	organizationId: string;
	intentId: string;
	generation: number;
	eventType: string;
	evidence: ClassCheckoutEvidence;
	createdAtIso: string;
}

export interface PrepareClassCheckoutExecution {
	organizationId: string;
	customerId: string;
	intentId: string;
	fingerprint: string;
	requestSnapshot: unknown;
}

export interface TransitionClassCheckoutExecution {
	claim: ClassCheckoutClaim;
	checkpoint?: ClassCheckoutCheckpoint;
	state?: ClassCheckoutExecutionState;
	shopifyCartId?: string;
	storefrontBinding?: ClassCheckoutStorefrontBinding | null;
	resultCode?: string;
	releaseLease?: boolean;
	eventType?: string;
	evidence?: ClassCheckoutEvidence;
}

export interface ResolveClassCheckoutExecution {
	organizationId: string;
	intentId: string;
	expectedGeneration: number;
	actorId: string;
	reason: string;
	action: "resume_known_cart" | "retry_pre_dispatch" | "abandon";
	shopifyCartId?: string;
	storefrontBinding?: ClassCheckoutStorefrontBinding;
}

export interface RestartUnissuedInvalidCartInput {
	organizationId: string;
	customerId: string;
	intentId: string;
}

export interface FindUnissuedInvalidCartRestartInput {
	organizationId: string;
	customerId: string;
	festivalShortName: string;
}

export interface UnissuedCartReplacementInput {
	organizationId: string;
	customerId: string;
	replacementKey: string;
}

export interface InMemoryClassCheckoutRestartLookup {
	intent(input: RestartUnissuedInvalidCartInput): {
		status: string;
		cartReference?: string | null;
		paymentObserved: boolean;
	} | null;
	hasNewerCheckout(
		input: RestartUnissuedInvalidCartInput &
			FindUnissuedInvalidCartRestartInput,
		replacementKey: string,
	): Promise<boolean>;
	replacementClosed(
		input: RestartUnissuedInvalidCartInput,
		key: string,
	): boolean;
}

export interface ClassCheckoutExecutionRepository {
	get(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecution | null>;
	getByRecoveryReference(
		organizationId: string,
		recoveryReference: string,
	): Promise<ClassCheckoutExecution | null>;
	prepare(
		input: PrepareClassCheckoutExecution,
	): Promise<ClassCheckoutExecution>;
	claim(input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	}): Promise<ClassCheckoutExecution | null>;
	transition(input: TransitionClassCheckoutExecution): Promise<boolean>;
	recordRecoveryRequired(input: {
		claim: ClassCheckoutClaim;
		reason: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<boolean>;
	appendLateEvidence(input: {
		organizationId: string;
		intentId: string;
		generation: number;
		eventType: string;
		evidence?: ClassCheckoutEvidence;
	}): Promise<void>;
	events(
		organizationId: string,
		intentId: string,
	): Promise<ClassCheckoutExecutionEvent[]>;
	findBlocking(
		organizationId: string,
		customerId: string,
	): Promise<ClassCheckoutExecution | null>;
	listRecovery(
		organizationId: string,
		customerId?: string,
	): Promise<ClassCheckoutExecution[]>;
	reapExpired(organizationId: string, intentId?: string): Promise<number>;
	resolve(
		input: ResolveClassCheckoutExecution,
	): Promise<ClassCheckoutExecution | null>;
	restartUnissuedInvalidCart(
		input: RestartUnissuedInvalidCartInput,
	): Promise<{ replacementKey: string } | null>;
	findUnissuedInvalidCartRestart(
		input: FindUnissuedInvalidCartRestartInput,
	): Promise<ClassCheckoutExecution | null>;
	isUnissuedCartReplacementBlocked(
		input: UnissuedCartReplacementInput,
	): Promise<boolean>;
	observePayment(input: {
		organizationId: string;
		intentId: string;
		shopifyOrderGid: string;
		approved: boolean;
	}): Promise<void>;
	recordApplicationExpiry(input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	}): Promise<ClassCheckoutExecution | null>;
}
