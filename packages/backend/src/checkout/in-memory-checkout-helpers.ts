import { randomUUID } from "node:crypto";
import type {
	AppError,
	ClassRegistrationMetadata,
	ClassRegistrationSnapshot,
	RepertoirePiece,
} from "@festival/common";
import { normalizeClassRegistrationSnapshot } from "@festival/common";
import {
	assertSafeExecutionSnapshot,
	buildIntentLineRecords,
	type CheckoutCartRecord,
	type CheckoutIntentOutcome,
	type CheckoutIntentRecord,
	CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
	type ClassCheckoutClaim,
	type CreateCheckoutIntentInput,
	executionClaimMatches,
	type InMemoryClassCheckoutRestartLookup,
	repertoireItemsFromLegacyPieces,
} from "../domains/class-checkout/index.js";
import type { InMemoryClassCheckoutExecutionRepository } from "./class-checkout-execution.js";

export interface InMemoryCheckoutStore {
	carts: Map<string, CheckoutCartRecord>;
	intents: Map<string, CheckoutIntentRecord>;
	registrationMetadata: Map<string, ClassRegistrationMetadata>;
	classExecutions: InMemoryClassCheckoutExecutionRepository;
	now: () => Date;
	hasPaymentEvidence: (intent: CheckoutIntentRecord) => boolean;
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

export function computeInMemoryIntentOutcome(
	store: InMemoryCheckoutStore,
	intent: CheckoutIntentRecord,
): Exclude<CheckoutIntentOutcome, { kind: "created" }> {
	const nowIso = store.now().toISOString();
	if (intent.expiresAtIso <= nowIso) return { kind: "expired" };
	if (intent.status === "creating") return { kind: "in_progress" };
	if (intent.status === "failed") return { kind: "failed" };
	const cart = intent.cartReference
		? store.carts.get(intent.cartReference)
		: undefined;
	if (
		cart &&
		(intent.status === "ready" || intent.status === "checkout_started") &&
		cart.expiresAtIso > nowIso &&
		cart.status !== "expired" &&
		cart.status !== "superseded"
	) {
		return { kind: "ready", intent: { ...intent }, cart: { ...cart } };
	}
	return { kind: "failed" };
}

export async function createInMemoryCheckoutIntent(
	store: InMemoryCheckoutStore,
	record: CreateCheckoutIntentInput,
): Promise<CheckoutIntentOutcome> {
	if (record.classExecution) {
		assertSafeExecutionSnapshot(record.classExecution.requestSnapshot);
	}
	const existing = [...store.intents.values()].find(
		(intent) =>
			intent.organizationId === record.organizationId &&
			intent.customerId === record.customerId &&
			intent.sessionId === record.sessionId &&
			intent.idempotencyKey === record.idempotencyKey,
	);
	if (existing) return computeInMemoryIntentOutcome(store, existing);
	if (
		record.intentType === "class_entry" &&
		(await store.classExecutions.findBlocking(
			record.organizationId,
			record.customerId,
		))
	) {
		return { kind: "in_progress" };
	}
	const nowIso = store.now().toISOString();
	for (const intent of store.intents.values()) {
		if (
			intent.organizationId === record.organizationId &&
			intent.customerId === record.customerId &&
			(intent.status === "creating" ||
				intent.status === "ready" ||
				intent.status === "checkout_started") &&
			intent.expiresAtIso > nowIso
		) {
			return { kind: "in_progress" };
		}
	}
	const { lines: _l, classExecution: _e, ...rest } = record;
	const value: CheckoutIntentRecord = {
		...rest,
		intentType: record.intentType ?? "membership",
		offeringId: record.offeringId ?? null,
		entitlementClass: record.entitlementClass ?? null,
		durationDays: record.durationDays ?? null,
		festivalClassId: record.festivalClassId ?? null,
		childId: record.childId ?? null,
		policyVersion: record.policyVersion ?? null,
		divisionId: record.divisionId ?? null,
		divisionNameSnapshot: record.divisionNameSnapshot ?? null,
		staffAccessConsent: record.staffAccessConsent ?? false,
		lineIdentityProtocol:
			record.intentType === "class_entry"
				? CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL
				: null,
		id: randomUUID(),
		correlationId: randomUUID(),
		cartReference: null,
		status: "creating",
		createdAtIso: nowIso,
	};
	value.lines = buildIntentLineRecords(value, record.lines);
	store.intents.set(value.id, value);
	if (record.classExecution) {
		await store.classExecutions.prepare({
			organizationId: record.organizationId,
			customerId: record.customerId,
			intentId: value.id,
			...record.classExecution,
		});
	}
	return { kind: "created", intent: { ...value } };
}

export async function attachInMemoryCart(
	store: InMemoryCheckoutStore,
	input: Omit<CheckoutCartRecord, "reference" | "createdAtIso" | "status"> & {
		intentId: string;
		capacityCheck?: () => Promise<AppError | null>;
		executionClaim?: ClassCheckoutClaim;
	},
): Promise<CheckoutCartRecord> {
	const { capacityCheck, executionClaim, ...cartInput } = input;
	if (executionClaim) {
		const execution = await store.classExecutions.get(
			input.organizationId,
			input.intentId,
		);
		if (
			!execution ||
			!executionClaimMatches(
				execution,
				executionClaim,
				store.now().toISOString(),
			)
		) {
			throw new Error("Checkout execution claim is stale.");
		}
	}
	const attached = store.intents.get(input.intentId);
	if (executionClaim && attached?.cartReference) {
		const cart = store.carts.get(attached.cartReference);
		if (cart?.shopifyCartId === input.shopifyCartId) return { ...cart };
	}
	const failure = await capacityCheck?.();
	if (failure) throw failure;
	const intent = store.intents.get(input.intentId);
	if (
		!intent ||
		intent.organizationId !== input.organizationId ||
		intent.status !== "creating"
	) {
		throw new Error("Checkout intent cannot accept a cart.");
	}
	if (executionClaim && !store.classExecutions.markAttached(executionClaim)) {
		throw new Error("Checkout execution claim is stale.");
	}
	const value: CheckoutCartRecord = {
		...cartInput,
		reference: randomUUID(),
		status: "ready",
		createdAtIso: store.now().toISOString(),
	};
	store.carts.set(value.reference, value);
	intent.cartReference = value.reference;
	intent.status = "ready";
	return { ...value };
}

export async function insertInMemoryMetadata(
	store: InMemoryCheckoutStore,
	params: {
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
	},
): Promise<ClassRegistrationMetadata> {
	for (const existing of store.registrationMetadata.values()) {
		if (existing.id === params.id) {
			throw new Error("Registration metadata ID already exists.");
		}
		if (
			params.checkoutIntentLineId != null &&
			existing.checkoutIntentLineId === params.checkoutIntentLineId &&
			existing.organizationId === params.organizationId &&
			existing.checkoutIntentId === params.checkoutIntentId &&
			(await store.classExecutions.get(
				params.organizationId,
				params.checkoutIntentId,
			))
		) {
			return structuredClone(existing);
		}
		if (
			params.checkoutIntentLineId != null &&
			existing.checkoutIntentLineId === params.checkoutIntentLineId
		) {
			throw new Error(
				"Registration metadata checkout intent line already exists.",
			);
		}
	}
	const record: ClassRegistrationMetadata = {
		id: params.id,
		organizationId: params.organizationId,
		festivalId: params.festivalId,
		checkoutIntentId: params.checkoutIntentId,
		checkoutIntentLineId: params.checkoutIntentLineId ?? null,
		classEntitlementId: null,
		teacherMembershipId: params.teacherMembershipId,
		accompanistMembershipId: params.accompanistMembershipId,
		repertoireJson: params.repertoireJson,
		repertoireItems: repertoireItemsFromLegacyPieces(
			params.id,
			params.organizationId,
			params.repertoireSnapshotPieces ?? params.repertoireJson,
		),
		registrationSnapshot: structuredClone(
			normalizeClassRegistrationSnapshot(params.registrationSnapshot),
		),
		createdAt: store.now(),
	};
	store.registrationMetadata.set(params.id, record);
	store.registrationMetadata.set(params.checkoutIntentId, record);
	if (params.checkoutIntentLineId) {
		store.registrationMetadata.set(params.checkoutIntentLineId, record);
	}
	return structuredClone(record);
}

export function listInMemoryCheckoutSnapshots(
	store: InMemoryCheckoutStore,
	organizationId: string,
	intentId: string,
) {
	return [...new Set(store.registrationMetadata.values())].flatMap((meta) =>
		meta.organizationId === organizationId &&
		meta.checkoutIntentId === intentId &&
		meta.checkoutIntentLineId &&
		meta.registrationSnapshot
			? [
					{
						checkoutIntentLineId: meta.checkoutIntentLineId,
						registrationSnapshot: structuredClone(meta.registrationSnapshot),
					},
				]
			: [],
	);
}

export function linkInMemoryMetadataToEntitlement(
	store: InMemoryCheckoutStore,
	params: {
		checkoutIntentId?: string;
		checkoutIntentLineId?: string;
		classEntitlementId: string;
	},
): void {
	const record = [...store.registrationMetadata.values()].find((meta) =>
		params.checkoutIntentLineId
			? meta.checkoutIntentLineId === params.checkoutIntentLineId
			: meta.checkoutIntentId === params.checkoutIntentId,
	);
	if (record) record.classEntitlementId = params.classEntitlementId;
}

export function snapshotInMemoryMetadataLinks(
	store: InMemoryCheckoutStore,
	input: { checkoutIntentIds: string[]; checkoutIntentLineIds: string[] },
): Map<string, string | null> {
	const checkoutIntentIds = new Set(input.checkoutIntentIds);
	const checkoutIntentLineIds = new Set(input.checkoutIntentLineIds);
	const records = new Map<string, ClassRegistrationMetadata>();
	for (const record of store.registrationMetadata.values()) {
		if (
			checkoutIntentIds.has(record.checkoutIntentId) ||
			(typeof record.checkoutIntentLineId === "string" &&
				checkoutIntentLineIds.has(record.checkoutIntentLineId))
		) {
			records.set(record.id, record);
		}
	}
	return new Map(
		[...records.values()].map((record) => [
			record.id,
			record.classEntitlementId,
		]),
	);
}

export function restoreInMemoryMetadataLinks(
	store: InMemoryCheckoutStore,
	snapshot: Map<string, string | null>,
): void {
	const records = new Map<string, ClassRegistrationMetadata>();
	for (const record of store.registrationMetadata.values()) {
		if (snapshot.has(record.id)) records.set(record.id, record);
	}
	for (const [id, classEntitlementId] of snapshot) {
		const record = records.get(id);
		if (record) record.classEntitlementId = classEntitlementId;
	}
}

export function getInMemoryMetadataByEntitlementId(
	store: InMemoryCheckoutStore,
	organizationId: string,
	classEntitlementId: string,
): ClassRegistrationMetadata | null {
	const match = [...store.registrationMetadata.values()].find(
		(meta) =>
			meta.organizationId === organizationId &&
			meta.classEntitlementId === classEntitlementId,
	);
	return match
		? structuredClone({
				...match,
				registrationSnapshot: normalizeClassRegistrationSnapshot(
					match.registrationSnapshot,
				),
			})
		: null;
}

export function listInMemoryMetadataByEntitlementIds(
	store: InMemoryCheckoutStore,
	organizationId: string,
	classEntitlementIds: readonly string[],
): Map<string, ClassRegistrationMetadata> {
	if (classEntitlementIds.length === 0) return new Map();
	const targetIds = new Set(classEntitlementIds);
	const result = new Map<string, ClassRegistrationMetadata>();
	for (const meta of store.registrationMetadata.values()) {
		if (
			meta.organizationId === organizationId &&
			meta.classEntitlementId !== null &&
			targetIds.has(meta.classEntitlementId) &&
			!result.has(meta.classEntitlementId)
		) {
			result.set(
				meta.classEntitlementId,
				structuredClone({
					...meta,
					registrationSnapshot: normalizeClassRegistrationSnapshot(
						meta.registrationSnapshot,
					),
				}),
			);
		}
	}
	return result;
}

export function updateInMemoryMetadata(
	store: InMemoryCheckoutStore,
	registrationMetadataId: string,
	organizationId: string,
	input: { accompanistMembershipId?: string | null; pieces: RepertoirePiece[] },
): ClassRegistrationMetadata {
	const record = [...store.registrationMetadata.values()].find(
		(meta) =>
			meta.id === registrationMetadataId &&
			meta.organizationId === organizationId,
	);
	if (!record) throw new Error("Registration metadata not found.");
	if (input.accompanistMembershipId !== undefined) {
		record.accompanistMembershipId = input.accompanistMembershipId;
	}
	record.repertoireJson = input.pieces;
	record.repertoireItems = repertoireItemsFromLegacyPieces(
		record.id,
		record.organizationId,
		input.pieces,
	);
	return structuredClone({
		...record,
		registrationSnapshot: normalizeClassRegistrationSnapshot(
			record.registrationSnapshot,
		),
	});
}
