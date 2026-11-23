import { randomUUID } from "node:crypto";
import type {
	CheckoutIntentRecord,
	CheckoutRecoveryRequestRecord,
	ConsumeRecoveryRequestParams,
	CreateRecoveryRequestParams,
	RecoverableCheckoutIntentRecord,
} from "../domains/class-checkout/index.js";

export interface OrderProjectionRef {
	organizationId: string;
	correlationId: string;
}

export interface EntitlementRef {
	organizationId: string;
	checkoutIntentId: string;
}

export interface InMemoryRecoveryStore {
	intents: Map<string, CheckoutIntentRecord>;
	recoveryRequests: Map<string, CheckoutRecoveryRequestRecord>;
	orderProjections: OrderProjectionRef[];
	classEntitlements: EntitlementRef[];
	membershipEntitlements: EntitlementRef[];
}

export function hasCompletedRecoveryTarget(
	store: InMemoryRecoveryStore,
	organizationId: string,
	intent: { id: string; correlationId: string },
): boolean {
	if (
		store.orderProjections.some(
			(p) =>
				p.organizationId === organizationId &&
				p.correlationId === intent.correlationId,
		)
	) {
		return true;
	}
	if (
		store.classEntitlements.some(
			(e) =>
				e.organizationId === organizationId && e.checkoutIntentId === intent.id,
		)
	) {
		return true;
	}
	return store.membershipEntitlements.some(
		(e) =>
			e.organizationId === organizationId && e.checkoutIntentId === intent.id,
	);
}

export function cancelPendingRecoveryRequestsInMemory(
	store: InMemoryRecoveryStore,
	organizationId: string,
	sourceIntentId: string,
): void {
	for (const req of store.recoveryRequests.values()) {
		if (
			req.organizationId === organizationId &&
			req.sourceCheckoutIntentId === sourceIntentId &&
			req.status === "pending"
		) {
			req.status = "cancelled";
		}
	}
}

export function listRecoverableInMemory(
	store: InMemoryRecoveryStore,
	organizationId: string,
	customerId: string,
): RecoverableCheckoutIntentRecord[] {
	const recoverable: RecoverableCheckoutIntentRecord[] = [];
	for (const intent of store.intents.values()) {
		if (
			intent.organizationId !== organizationId ||
			intent.customerId !== customerId
		) {
			continue;
		}
		if (intent.status === "approved" || intent.status === "superseded") {
			continue;
		}
		if (intent.intentType === "class_entry") continue;
		if (hasCompletedRecoveryTarget(store, organizationId, intent)) continue;
		recoverable.push({ ...intent });
	}
	return recoverable.sort((a, b) =>
		b.createdAtIso.localeCompare(a.createdAtIso),
	);
}

export function createRecoveryRequestInMemory(
	store: InMemoryRecoveryStore,
	params: CreateRecoveryRequestParams,
): CheckoutRecoveryRequestRecord {
	const intent = store.intents.get(params.sourceCheckoutIntentId);
	if (!intent || intent.organizationId !== params.organizationId) {
		throw new Error("Checkout intent not found.");
	}
	if (intent.customerId !== params.customerId) {
		throw new Error("Customer mismatch for checkout intent.");
	}
	if (hasCompletedRecoveryTarget(store, params.organizationId, intent)) {
		throw new Error(
			"Cannot recover checkout intent: completed order projection or entitlement exists.",
		);
	}
	cancelPendingRecoveryRequestsInMemory(
		store,
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
	store.recoveryRequests.set(id, record);
	return { ...record };
}

export function consumeRecoveryRequestInMemory(
	store: InMemoryRecoveryStore,
	paramsOrToken: ConsumeRecoveryRequestParams | string,
	maybeOrgId?: string,
): CheckoutRecoveryRequestRecord {
	const tokenHash =
		typeof paramsOrToken === "string" ? paramsOrToken : paramsOrToken.tokenHash;
	const orgId =
		typeof paramsOrToken === "string"
			? maybeOrgId
			: paramsOrToken.organizationId;
	const consumedAt =
		typeof paramsOrToken === "object" && paramsOrToken.consumedAtIso
			? paramsOrToken.consumedAtIso
			: new Date().toISOString();
	let matchedReq: CheckoutRecoveryRequestRecord | null = null;
	for (const req of store.recoveryRequests.values()) {
		if (req.tokenHash === tokenHash) {
			if (orgId && req.organizationId !== orgId) break;
			matchedReq = req;
			break;
		}
	}
	if (!matchedReq) throw new Error("Recovery request not found.");
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
