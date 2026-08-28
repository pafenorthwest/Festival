import { randomUUID } from "node:crypto";

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

/** Server-only records. Their Shopify IDs and access context must never be DTO fields. */
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

export interface CheckoutIntentRecord {
	id: string;
	correlationId: string;
	organizationId: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	offeringId: string;
	entitlementClass: "teacher_membership";
	durationDays: number;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	policyVersion: "v1";
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

export type CheckoutIntentOutcome =
	| { kind: "created"; intent: CheckoutIntentRecord }
	| { kind: "in_progress" }
	| { kind: "ready"; intent: CheckoutIntentRecord; cart: CheckoutCartRecord }
	| { kind: "active" }
	| { kind: "expired" }
	| { kind: "failed" };

export interface CheckoutRepository {
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
		},
	): Promise<CheckoutCartRecord>;
	markCheckoutStarted(intentId: string): Promise<void>;
	markFailed(intentId: string): Promise<void>;
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
	hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
	): Promise<boolean>;
	resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	): Promise<void>;
}

export type CreateCheckoutIntentInput = Omit<
	CheckoutIntentRecord,
	| "id"
	| "correlationId"
	| "cartReference"
	| "createdAtIso"
	| "status"
	| "divisionId"
	| "divisionNameSnapshot"
	| "staffAccessConsent"
> & {
	divisionId?: string | null;
	divisionNameSnapshot?: string | null;
	staffAccessConsent?: boolean;
};

export class InMemoryCheckoutRepository implements CheckoutRepository {
	private readonly carts = new Map<string, CheckoutCartRecord>();
	private readonly intents = new Map<string, CheckoutIntentRecord>();

	async getOutcome(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	}) {
		const intent = [...this.intents.values()].find(
			(value) =>
				value.organizationId === input.organizationId &&
				value.customerId === input.customerId &&
				value.sessionId === input.sessionId &&
				value.idempotencyKey === input.idempotencyKey,
		);
		return intent ? this.outcomeFor(intent) : null;
	}

	async createIntent(record: CreateCheckoutIntentInput) {
		const existing = [...this.intents.values()].find(
			(intent) =>
				intent.organizationId === record.organizationId &&
				intent.customerId === record.customerId &&
				intent.sessionId === record.sessionId &&
				intent.idempotencyKey === record.idempotencyKey,
		);
		if (existing) return this.outcomeFor(existing);
		for (const intent of this.intents.values()) {
			if (
				intent.organizationId === record.organizationId &&
				intent.customerId === record.customerId &&
				(intent.status === "creating" ||
					intent.status === "ready" ||
					intent.status === "checkout_started") &&
				intent.expiresAtIso > new Date().toISOString()
			) {
				return { kind: "in_progress" as const };
			}
		}
		const value: CheckoutIntentRecord = {
			...record,
			divisionId: record.divisionId ?? null,
			divisionNameSnapshot: record.divisionNameSnapshot ?? null,
			staffAccessConsent: record.staffAccessConsent ?? false,
			id: randomUUID(),
			correlationId: randomUUID(),
			cartReference: null,
			status: "creating",
			createdAtIso: new Date().toISOString(),
		};
		this.intents.set(value.id, value);
		return { kind: "created" as const, intent: { ...value } };
	}

	async attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
		},
	) {
		const intent = this.intents.get(input.intentId);
		if (!intent || intent.status !== "creating")
			throw new Error("Checkout intent cannot accept a cart.");
		const value: CheckoutCartRecord = {
			...input,
			reference: randomUUID(),
			status: "ready",
			createdAtIso: new Date().toISOString(),
		};
		this.carts.set(value.reference, value);
		intent.cartReference = value.reference;
		intent.status = "ready";
		return { ...value };
	}

	async markCheckoutStarted(intentId: string) {
		const intent = this.intents.get(intentId);
		if (
			!intent ||
			(intent.status !== "ready" && intent.status !== "checkout_started")
		)
			throw new Error("Checkout intent is not ready.");
		intent.status = "checkout_started";
		const cart = intent.cartReference
			? this.carts.get(intent.cartReference)
			: undefined;
		if (cart) cart.status = "checkout_started";
	}

	async markFailed(intentId: string) {
		const intent = this.intents.get(intentId);
		if (!intent) return;
		intent.status = "failed";
		if (intent.cartReference) {
			const cart = this.carts.get(intent.cartReference);
			if (cart) cart.status = "superseded";
		}
	}

	async getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		const cart = this.carts.get(reference);
		if (
			!cart ||
			cart.organizationId !== organizationId ||
			cart.customerId !== customerId ||
			cart.expiresAtIso <= nowIso ||
			cart.status === "expired" ||
			cart.status === "superseded"
		)
			return null;
		return { ...cart };
	}

	async findIntentByCorrelation(organizationId: string, correlationId: string) {
		const intent = [...this.intents.values()].find(
			(value) =>
				value.organizationId === organizationId &&
				value.correlationId === correlationId,
		);
		return intent ? { ...intent } : null;
	}

	async hasProcessingIntent(
		organizationId: string,
		customerId: string,
		nowIso: string,
	) {
		return [...this.intents.values()].some(
			(intent) =>
				intent.organizationId === organizationId &&
				intent.customerId === customerId &&
				intent.expiresAtIso > nowIso &&
				(intent.status === "creating" ||
					intent.status === "ready" ||
					intent.status === "checkout_started"),
		);
	}

	async resolveIntent(
		intentId: string,
		resolution: "approved" | "rejected" | "needs_review",
	) {
		const intent = this.intents.get(intentId);
		if (intent) intent.status = resolution;
	}

	private outcomeFor(
		intent: CheckoutIntentRecord,
	): Exclude<CheckoutIntentOutcome, { kind: "created" }> {
		if (intent.expiresAtIso <= new Date().toISOString())
			return { kind: "expired" };
		if (intent.status === "creating") return { kind: "in_progress" };
		if (intent.status === "failed") return { kind: "failed" };
		const cart = intent.cartReference
			? this.carts.get(intent.cartReference)
			: undefined;
		if (
			cart &&
			(intent.status === "ready" || intent.status === "checkout_started") &&
			cart.expiresAtIso > new Date().toISOString() &&
			cart.status !== "expired" &&
			cart.status !== "superseded"
		)
			return { kind: "ready", intent: { ...intent }, cart: { ...cart } };
		return { kind: "failed" };
	}
}
