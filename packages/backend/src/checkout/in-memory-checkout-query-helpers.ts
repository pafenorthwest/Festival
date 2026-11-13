import type {
	CheckoutCartRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutIntentType,
	ClassCheckoutReplayState,
	InMemoryClassCheckoutRestartLookup,
} from "../domains/class-checkout/index.js";
import { InMemoryClassCheckoutExecutionRepository } from "./class-checkout-execution.js";
import {
	computeInMemoryIntentOutcome,
	type InMemoryCheckoutStore,
} from "./in-memory-checkout-helpers.js";

async function hasNewerClassCheckoutIntent(
	store: InMemoryCheckoutStore,
	input: {
		organizationId: string;
		customerId: string;
		intentId: string;
		festivalShortName: string;
	},
	replacementKey: string,
): Promise<boolean> {
	const original = store.intents.get(input.intentId);
	if (!original) return false;
	const originalMetadata = store.registrationMetadata.get(original.id);
	let newer = false;
	for (const intent of store.intents.values()) {
		if (intent.id === original.id) {
			newer = true;
			continue;
		}
		if (
			!newer ||
			intent.organizationId !== input.organizationId ||
			intent.customerId !== input.customerId ||
			intent.intentType !== "class_entry" ||
			intent.idempotencyKey === replacementKey
		) {
			continue;
		}
		const metadata = store.registrationMetadata.get(intent.id);
		const execution = await store.classExecutions.get(
			input.organizationId,
			intent.id,
		);
		const snapshot = execution?.requestSnapshot as
			| { festivalShortName?: string }
			| undefined;
		if (
			(original.festivalClassId &&
				original.festivalClassId === intent.festivalClassId) ||
			(originalMetadata &&
				metadata?.festivalId === originalMetadata.festivalId) ||
			snapshot?.festivalShortName?.toLowerCase() ===
				input.festivalShortName.toLowerCase()
		) {
			return true;
		}
	}
	return false;
}

export function buildInMemoryRestartLookup(
	store: InMemoryCheckoutStore,
): InMemoryClassCheckoutRestartLookup {
	return {
		intent: ({ organizationId, customerId, intentId }) => {
			const intent = store.intents.get(intentId);
			return intent?.organizationId === organizationId &&
				intent.customerId === customerId &&
				intent.intentType === "class_entry"
				? {
						status: intent.status,
						cartReference: intent.cartReference,
						paymentObserved: store.hasPaymentEvidence(intent),
					}
				: null;
		},
		replacementClosed: (input, replacementKey) =>
			[...store.intents.values()].some(
				(intent) =>
					intent.organizationId === input.organizationId &&
					intent.customerId === input.customerId &&
					intent.intentType === "class_entry" &&
					intent.idempotencyKey === replacementKey &&
					(!["creating", "ready", "checkout_started"].includes(intent.status) ||
						store.hasPaymentEvidence(intent)),
			),
		hasNewerCheckout: async (input, replacementKey) =>
			hasNewerClassCheckoutIntent(store, input, replacementKey),
	};
}

export function findInMemoryIntentById(
	store: InMemoryCheckoutStore,
	organizationId: string,
	intentId: string,
): CheckoutIntentRecord | null {
	const intent = store.intents.get(intentId);
	if (!intent || intent.organizationId !== organizationId) return null;
	return { ...intent };
}

export function createInMemoryClassExecutionsRepo(
	getStore: () => InMemoryCheckoutStore,
	now: () => Date,
): InMemoryClassCheckoutExecutionRepository {
	const lazyStore: InMemoryCheckoutStore = {
		get carts() {
			return getStore().carts;
		},
		get intents() {
			return getStore().intents;
		},
		get registrationMetadata() {
			return getStore().registrationMetadata;
		},
		get classExecutions() {
			return getStore().classExecutions;
		},
		now,
		hasPaymentEvidence: (intent) => getStore().hasPaymentEvidence(intent),
	};
	return new InMemoryClassCheckoutExecutionRepository(
		now,
		(org, intentId) => {
			const intent = getStore().intents.get(intentId);
			return Boolean(
				intent &&
					intent.organizationId === org &&
					["approved", "rejected", "needs_review", "superseded"].includes(
						intent.status,
					),
			);
		},
		(org, intentId) => {
			const intent = getStore().intents.get(intentId);
			if (intent?.organizationId === org) intent.status = "superseded";
		},
		(org, customer, intentId, nowIso) =>
			[...getStore().intents.values()].some(
				(intent) =>
					intent.organizationId === org &&
					intent.customerId === customer &&
					intent.id !== intentId &&
					["creating", "ready", "checkout_started"].includes(intent.status) &&
					intent.expiresAtIso > nowIso,
			),
		(org, intentId) =>
			getStore().intents.get(intentId)?.organizationId === org
				? (getStore().intents.get(intentId)?.expiresAtIso ?? null)
				: null,
		buildInMemoryRestartLookup(lazyStore),
	);
}

export function findInMemoryIntentByKey(
	store: InMemoryCheckoutStore,
	input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	},
): CheckoutIntentRecord | null {
	const value = [...store.intents.values()].find(
		(item) =>
			item.organizationId === input.organizationId &&
			item.customerId === input.customerId &&
			item.sessionId === input.sessionId &&
			item.idempotencyKey === input.idempotencyKey,
	);
	return value ? structuredClone(value) : null;
}

export function getInMemoryOutcome(
	store: InMemoryCheckoutStore,
	input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		idempotencyKey: string;
	},
): Exclude<CheckoutIntentOutcome, { kind: "created" }> | null {
	const intent = [...store.intents.values()].find(
		(item) =>
			item.organizationId === input.organizationId &&
			item.customerId === input.customerId &&
			item.sessionId === input.sessionId &&
			item.idempotencyKey === input.idempotencyKey,
	);
	return intent ? computeInMemoryIntentOutcome(store, intent) : null;
}

export function markInMemoryCheckoutStarted(
	store: InMemoryCheckoutStore,
	intentId: string,
): void {
	const intent = store.intents.get(intentId);
	if (
		!intent ||
		(intent.status !== "ready" && intent.status !== "checkout_started")
	) {
		throw new Error("Checkout intent is not ready.");
	}
	intent.status = "checkout_started";
	const cart = intent.cartReference
		? store.carts.get(intent.cartReference)
		: undefined;
	if (cart) cart.status = "checkout_started";
}

export function markInMemoryFailed(
	store: InMemoryCheckoutStore,
	intentId: string,
): void {
	const intent = store.intents.get(intentId);
	if (!intent) return;
	intent.status = "failed";
	if (intent.cartReference) {
		const cart = store.carts.get(intent.cartReference);
		if (cart) cart.status = "superseded";
	}
}

export function getInMemoryCart(
	store: InMemoryCheckoutStore,
	reference: string,
	organizationId: string,
	customerId: string,
	nowIso: string,
): CheckoutCartRecord | null {
	const cart = store.carts.get(reference);
	if (
		!cart ||
		cart.organizationId !== organizationId ||
		cart.customerId !== customerId ||
		cart.expiresAtIso <= nowIso ||
		cart.status === "expired" ||
		cart.status === "superseded"
	) {
		return null;
	}
	return { ...cart };
}

export function findInMemoryIntentByCorrelation(
	store: InMemoryCheckoutStore,
	organizationId: string,
	correlationId: string,
): CheckoutIntentRecord | null {
	const intent = [...store.intents.values()].find(
		(value) =>
			value.organizationId === organizationId &&
			value.correlationId === correlationId,
	);
	return intent ? { ...intent } : null;
}

export function getInMemoryClassCheckoutReplayState(
	store: InMemoryCheckoutStore,
	organizationId: string,
	intentId: string,
): ClassCheckoutReplayState | null {
	const execution = store.classExecutions.getSnapshot(organizationId, intentId);
	const intent = store.intents.get(intentId);
	if (!execution || intent?.organizationId !== organizationId) return null;
	return {
		intentStatus: intent.status,
		state: execution.state,
		generation: execution.generation,
		resultCode: execution.resultCode,
	};
}

export async function hasInMemoryProcessingIntent(
	store: InMemoryCheckoutStore,
	organizationId: string,
	customerId: string,
	nowIso: string,
	intentType: CheckoutIntentType = "class_entry",
): Promise<boolean> {
	if (
		intentType === "class_entry" &&
		(await store.classExecutions.findBlocking(organizationId, customerId))
	) {
		return true;
	}
	return [...store.intents.values()].some(
		(intent) =>
			intent.organizationId === organizationId &&
			intent.customerId === customerId &&
			intent.expiresAtIso > nowIso &&
			["creating", "ready", "checkout_started"].includes(intent.status),
	);
}
