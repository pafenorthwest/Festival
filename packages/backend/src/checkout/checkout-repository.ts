import { randomUUID } from "node:crypto";

export type CheckoutCartStatus =
	| "ready"
	| "checkout_started"
	| "expired"
	| "superseded";
export type CheckoutIntentStatus =
	| "creating"
	| "ready"
	| "expired"
	| "superseded";

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
	offeringId: string;
	entitlementClass: "teacher_membership";
	durationDays: number;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	policyVersion: "v1";
	amount: string;
	currencyCode: string;
	cartReference: string | null;
	status: CheckoutIntentStatus;
	expiresAtIso: string;
	createdAtIso: string;
}

export interface CheckoutRepository {
	createIntent(
		record: Omit<
			CheckoutIntentRecord,
			"id" | "correlationId" | "cartReference" | "createdAtIso" | "status"
		>,
	): Promise<CheckoutIntentRecord>;
	attachCart(
		input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
			intentId: string;
		},
	): Promise<CheckoutCartRecord>;
	markCheckoutStarted(intentId: string): Promise<void>;
	getCart(
		reference: string,
		organizationId: string,
		customerId: string,
		nowIso: string,
	): Promise<CheckoutCartRecord | null>;
}

export class InMemoryCheckoutRepository implements CheckoutRepository {
	private readonly carts = new Map<string, CheckoutCartRecord>();
	private readonly intents = new Map<string, CheckoutIntentRecord>();

	async createIntent(
		record: Omit<
			CheckoutIntentRecord,
			"id" | "correlationId" | "cartReference" | "createdAtIso" | "status"
		>,
	) {
		for (const intent of this.intents.values()) {
			if (
				intent.organizationId === record.organizationId &&
				intent.customerId === record.customerId &&
				(intent.status === "creating" || intent.status === "ready")
			) {
				intent.status = "superseded";
				if (intent.cartReference) {
					const cart = this.carts.get(intent.cartReference);
					if (cart) cart.status = "superseded";
				}
			}
		}
		const value: CheckoutIntentRecord = {
			...record,
			id: randomUUID(),
			correlationId: randomUUID(),
			cartReference: null,
			status: "creating",
			createdAtIso: new Date().toISOString(),
		};
		this.intents.set(value.id, value);
		return { ...value };
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
		if (!intent || intent.status !== "ready")
			throw new Error("Checkout intent is not ready.");
		intent.status = "superseded";
		const cart = intent.cartReference
			? this.carts.get(intent.cartReference)
			: undefined;
		if (cart) cart.status = "checkout_started";
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
}
