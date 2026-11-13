import { randomUUID } from "node:crypto";
import {
	type ClassCheckoutEvidence,
	type ClassCheckoutExecution,
	type ClassCheckoutExecutionEvent,
	copyStorefrontBinding,
	executionClaimMatches,
	type FindUnissuedInvalidCartRestartInput,
	type InMemoryClassCheckoutRestartLookup,
	isBlockingExecution,
	type ResolveClassCheckoutExecution,
	type RestartUnissuedInvalidCartInput,
	resolvedExecution,
	type TransitionClassCheckoutExecution,
	type UnissuedCartReplacementInput,
	unissuedInvalidCartRestartDecision,
} from "../domains/class-checkout/index.js";

export interface InMemoryExecutionStore {
	records: Map<string, ClassCheckoutExecution>;
	history: ClassCheckoutExecutionEvent[];
	now: () => Date;
	isTerminal: (org: string, intentId: string) => boolean;
	abandonIntent: (org: string, intentId: string) => void;
	hasOtherActive: (
		org: string,
		customer: string,
		intent: string,
		nowIso: string,
	) => boolean;
	intentExpiry: (org: string, intentId: string) => string | null;
	restartLookup?: InMemoryClassCheckoutRestartLookup;
	blocks: (value: ClassCheckoutExecution) => boolean;
	appendEvent: (
		value: ClassCheckoutExecution,
		eventType: string,
		evidence?: ClassCheckoutEvidence,
		id?: string,
	) => void;
}

export function execKey(org: string, intent: string): string {
	return JSON.stringify([org, intent]);
}

export function claimInMemoryExecution(
	store: InMemoryExecutionStore,
	input: {
		organizationId: string;
		intentId: string;
		owner: string;
		leaseMs?: number;
		allowCompleted?: boolean;
	},
): ClassCheckoutExecution | null {
	const value = store.records.get(
		execKey(input.organizationId, input.intentId),
	);
	const now = store.now();
	const nowIso = now.toISOString();
	if (
		!value ||
		store.isTerminal(input.organizationId, input.intentId) ||
		store.hasOtherActive(
			input.organizationId,
			value.customerId,
			input.intentId,
			nowIso,
		) ||
		[...store.records.values()].some(
			(other) =>
				other.intentId !== value.intentId &&
				other.organizationId === value.organizationId &&
				other.customerId === value.customerId &&
				store.blocks(other),
		) ||
		value.state === "recovery_required" ||
		(value.state === "completed" &&
			!(input.allowCompleted && value.checkpoint === "attached")) ||
		value.state === "rejected" ||
		(value.leaseExpiresAtIso && value.leaseExpiresAtIso > nowIso) ||
		(value.state === "running" && value.checkpoint === "create_dispatched")
	) {
		return null;
	}
	value.state = "running";
	value.generation++;
	value.leaseOwner = input.owner;
	value.leaseExpiresAtIso = new Date(
		now.getTime() + Math.max(1, input.leaseMs ?? 30_000),
	).toISOString();
	value.updatedAtIso = nowIso;
	store.appendEvent(value, "claimed");
	return structuredClone(value);
}

export function transitionInMemoryExecution(
	store: InMemoryExecutionStore,
	input: TransitionClassCheckoutExecution,
): boolean {
	const value = store.records.get(
		execKey(input.claim.organizationId, input.claim.intentId),
	);
	if (
		!value ||
		!executionClaimMatches(value, input.claim, store.now().toISOString())
	) {
		return false;
	}
	if (input.state === "rejected" && value.checkpoint !== "prepared") {
		throw new Error(
			"An externally dispatched checkout requires audited recovery.",
		);
	}
	if (input.checkpoint) value.checkpoint = input.checkpoint;
	if (input.state) value.state = input.state;
	if (input.shopifyCartId) value.shopifyCartId = input.shopifyCartId;
	if (input.storefrontBinding !== undefined) {
		value.storefrontBinding = input.storefrontBinding
			? copyStorefrontBinding(input.storefrontBinding)
			: null;
	}
	if (input.resultCode !== undefined) value.resultCode = input.resultCode;
	if (input.releaseLease || (input.state && input.state !== "running")) {
		value.leaseOwner = null;
		value.leaseExpiresAtIso = null;
	}
	if (input.state === "recovery_required") {
		value.recoveryRecordedAtIso ??= store.now().toISOString();
	}
	value.updatedAtIso = store.now().toISOString();
	if (input.state === "rejected") {
		store.abandonIntent(value.organizationId, value.intentId);
	}
	store.appendEvent(
		value,
		input.eventType ?? input.checkpoint ?? input.state ?? "transition",
		input.evidence,
	);
	return true;
}

export function reapInMemoryExpiredExecutions(
	store: InMemoryExecutionStore,
	org: string,
	intent?: string,
): number {
	let count = 0;
	const now = store.now().toISOString();
	for (const value of store.records.values()) {
		if (
			value.organizationId === org &&
			(!intent || value.intentId === intent) &&
			value.state === "running" &&
			value.leaseExpiresAtIso &&
			value.leaseExpiresAtIso <= now
		) {
			value.state =
				value.checkpoint === "create_dispatched"
					? "recovery_required"
					: "retryable";
			value.resultCode =
				value.state === "recovery_required"
					? "checkout_creation_unknown"
					: null;
			if (value.state === "recovery_required") {
				value.recoveryRecordedAtIso ??= now;
			}
			value.leaseOwner = null;
			value.leaseExpiresAtIso = null;
			value.updatedAtIso = now;
			store.appendEvent(value, "lease_expired", { stage: value.checkpoint });
			count++;
		}
	}
	return count;
}

export function resolveInMemoryExecution(
	store: InMemoryExecutionStore,
	input: ResolveClassCheckoutExecution,
): ClassCheckoutExecution | null {
	if (store.isTerminal(input.organizationId, input.intentId)) return null;
	const value = store.records.get(
		execKey(input.organizationId, input.intentId),
	);
	if (!value) return null;
	const next = resolvedExecution(value, input);
	if (!next) return null;
	if (input.action === "abandon") {
		store.abandonIntent(input.organizationId, input.intentId);
	}
	next.updatedAtIso = store.now().toISOString();
	store.records.set(execKey(input.organizationId, input.intentId), next);
	store.appendEvent(next, "resolved", {
		actorId: input.actorId,
		message: input.reason,
		resolution: input.action,
		shopifyCartId: input.shopifyCartId,
	});
	return structuredClone(next);
}

export function restartDecisionInMemory(
	store: InMemoryExecutionStore,
	input: RestartUnissuedInvalidCartInput,
) {
	const value = store.records.get(
		execKey(input.organizationId, input.intentId),
	);
	const intent = store.restartLookup?.intent(input);
	if (
		!value ||
		value.customerId !== input.customerId ||
		!intent ||
		intent.cartReference ||
		intent.paymentObserved
	) {
		return null;
	}
	const events = store.history.filter(
		(event) =>
			event.organizationId === input.organizationId &&
			event.intentId === input.intentId,
	);
	const decision = unissuedInvalidCartRestartDecision(
		value,
		intent.status,
		events,
	);
	return decision ? { value, decision } : null;
}

export function applyUnissuedRestartInMemory(
	store: InMemoryExecutionStore,
	input: RestartUnissuedInvalidCartInput,
): { replacementKey: string } | null {
	const candidate = restartDecisionInMemory(store, input);
	if (!candidate) return null;
	if (candidate.decision !== "restartable") {
		return store.restartLookup?.replacementClosed(
			input,
			candidate.decision.replacementKey,
		)
			? null
			: candidate.decision;
	}
	const { value } = candidate;
	const replacementKey = randomUUID();
	store.abandonIntent(input.organizationId, input.intentId);
	value.generation++;
	value.state = "rejected";
	value.resultCode = "checkout_restarted_unissued";
	value.leaseOwner = null;
	value.leaseExpiresAtIso = null;
	value.updatedAtIso = store.now().toISOString();
	store.appendEvent(
		value,
		"customer_restarted_unissued",
		{ actorId: input.customerId, code: value.resultCode },
		replacementKey,
	);
	return { replacementKey };
}

export async function findUnissuedRestartInMemory(
	store: InMemoryExecutionStore,
	input: FindUnissuedInvalidCartRestartInput,
): Promise<ClassCheckoutExecution | null> {
	for (const value of [...store.records.values()].reverse()) {
		const snapshot = value.requestSnapshot as { festivalShortName?: string };
		if (
			value.organizationId !== input.organizationId ||
			value.customerId !== input.customerId ||
			snapshot?.festivalShortName?.toLowerCase() !==
				input.festivalShortName.toLowerCase()
		) {
			continue;
		}
		const candidateInput = { ...input, intentId: value.intentId };
		const candidate = restartDecisionInMemory(store, candidateInput);
		if (
			candidate &&
			(candidate.decision === "restartable" ||
				(!store.restartLookup?.replacementClosed(
					candidateInput,
					candidate.decision.replacementKey,
				) &&
					!(await store.restartLookup?.hasNewerCheckout(
						candidateInput,
						candidate.decision.replacementKey,
					))))
		) {
			return structuredClone(value);
		}
	}
	return null;
}

export function isUnissuedReplacementBlockedInMemory(
	store: InMemoryExecutionStore,
	input: UnissuedCartReplacementInput,
): boolean {
	const event = store.history.find(
		(e) =>
			e.organizationId === input.organizationId &&
			e.id === input.replacementKey &&
			e.eventType === "customer_restarted_unissued",
	);
	if (!event) return false;
	const value = store.records.get(
		execKey(input.organizationId, event.intentId),
	);
	if (!value || value.customerId !== input.customerId) return false;
	const candidate = restartDecisionInMemory(store, {
		...input,
		intentId: event.intentId,
	});
	return (
		!candidate ||
		candidate.decision === "restartable" ||
		candidate.decision.replacementKey !== input.replacementKey
	);
}

export function recordApplicationExpiryInMemory(
	store: InMemoryExecutionStore,
	input: {
		organizationId: string;
		intentId: string;
		expectedGeneration: number;
	},
): ClassCheckoutExecution | null {
	const value = store.records.get(
		execKey(input.organizationId, input.intentId),
	);
	const now = store.now().toISOString();
	const expires = store.intentExpiry(input.organizationId, input.intentId);
	if (
		!value ||
		value.generation !== input.expectedGeneration ||
		store.isTerminal(input.organizationId, input.intentId) ||
		!expires ||
		expires > now
	) {
		return null;
	}
	if (value.state === "recovery_required") return structuredClone(value);
	if (
		!["ready", "retryable", "completed"].includes(value.state) ||
		!["attached", "remote_cart_known"].includes(value.checkpoint)
	) {
		return null;
	}
	value.generation++;
	value.state = "recovery_required";
	value.resultCode = "checkout_expired";
	value.recoveryRecordedAtIso ??= now;
	value.leaseOwner = null;
	value.leaseExpiresAtIso = null;
	value.updatedAtIso = now;
	store.appendEvent(value, "application_checkout_expired", {
		stage: value.checkpoint,
		code: "checkout_expired",
	});
	return structuredClone(value);
}

export function shouldExecutionBlock(
	store: Pick<InMemoryExecutionStore, "isTerminal" | "intentExpiry" | "now">,
	value: ClassCheckoutExecution,
): boolean {
	if (store.isTerminal(value.organizationId, value.intentId)) return false;
	if (isBlockingExecution(value)) return true;
	const expires = store.intentExpiry(value.organizationId, value.intentId);
	return (
		value.checkpoint === "attached" &&
		["ready", "retryable", "completed"].includes(value.state) &&
		Boolean(expires && expires <= store.now().toISOString())
	);
}
