import {
	AppError,
	type ClassCheckoutRestartDto,
	type ClassCheckoutRestartRegistration,
	type ClassRegistrationSnapshot,
	type FestivalClassConfiguration,
} from "@festival/common";
import {
	isLegacyInvalidCartObservation,
	unissuedInvalidCartRestartDecision,
} from "./checkout-execution-helpers.js";
import type {
	ClassCheckoutExecution,
	ClassCheckoutExecutionEvent,
	ClassCheckoutStorefrontBinding,
} from "./checkout-execution-types.js";
import type {
	CheckoutIntentLineItemRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import { resolveStorefrontBinding } from "./class-checkout-cart-handoff.js";
import {
	type ClassCheckoutRecoveryStatus,
	recoveryStatusFor,
	resolvedCheckoutStatus,
} from "./class-checkout-errors.js";
import {
	expireIntentIfNeeded,
	preflightRecoveryOp,
	type RecoveryOpsDeps,
	resolveReadyRecoveryStatus,
} from "./class-checkout-recovery-preflight.js";
import { matchesInspectedCartEvidence } from "./class-checkout-replay-helpers.js";
import type { CheckoutChildRecord } from "./ports.js";

export {
	preflightRecoveryOp,
	type RecoveryOpsDeps,
	resolveReadyRecoveryStatus,
};

function assertMatchingFestivalFilter(
	record: ClassCheckoutExecution,
	festivalShortName?: string,
): void {
	if (!festivalShortName) return;
	const expected = (
		record.requestSnapshot as { festivalShortName?: unknown } | null
	)?.festivalShortName;
	if (
		typeof expected === "string" &&
		expected.trim().toLowerCase() !== festivalShortName.trim().toLowerCase()
	) {
		throw new AppError("Checkout recovery record not found.", 404);
	}
}

export async function recoveryStatusOp(
	deps: RecoveryOpsDeps,
	input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	},
): Promise<ClassCheckoutRecoveryStatus> {
	const executions = deps.checkout.classExecutions;
	if (!executions) throw new AppError("Checkout recovery is unavailable.", 503);
	await executions.reapExpired(input.organizationId);
	const initial = await executions.getByRecoveryReference(
		input.organizationId,
		input.recoveryReference,
	);
	if (!initial || initial.customerId !== input.customerId) {
		throw new AppError("Checkout recovery record not found.", 404);
	}
	assertMatchingFestivalFilter(initial, input.festivalShortName);
	const intent = deps.checkout.findIntentById
		? await deps.checkout.findIntentById(input.organizationId, initial.intentId)
		: null;
	const record = await expireIntentIfNeeded(deps, intent, initial);
	if (intent) {
		const resolved = resolvedCheckoutStatus(intent.status, record);
		if (resolved) return resolved;
	}
	const events = await executions.events(input.organizationId, record.intentId);
	const decision = intent
		? unissuedInvalidCartRestartDecision(record, intent.status, events)
		: null;
	const base = recoveryStatusFor(record);
	if (decision === "restartable") {
		return {
			...base,
			status: "recovery_required",
			reasonCode: "checkout_legacy_invalid_cart",
			retryAllowed: false,
			restartAllowed: true,
		};
	}
	if (record.state === "completed" || record.state === "ready") {
		return resolveReadyRecoveryStatus(deps, input, { intent, record, base });
	}
	return base;
}

export async function findUnissuedCartRestartOp(
	deps: RecoveryOpsDeps,
	input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
	},
): Promise<{ recoveryReference: string | null }> {
	const record =
		await deps.checkout.classExecutions?.findUnissuedInvalidCartRestart({
			organizationId: input.organizationId,
			customerId: input.customerId,
			festivalShortName: input.festivalShortName.trim().toLowerCase(),
		});
	return { recoveryReference: record?.recoveryReference ?? null };
}

function mapRestartRegistration(
	entry: {
		checkoutIntentLineId: string;
		registrationSnapshot: ClassRegistrationSnapshot;
	},
	lookups: {
		intentLinesById: Map<string, CheckoutIntentLineItemRecord>;
		childById: Map<string, CheckoutChildRecord>;
		classById: Map<string, FestivalClassConfiguration>;
	},
): ClassCheckoutRestartRegistration {
	const { checkoutIntentLineId, registrationSnapshot } = entry;
	const line = lookups.intentLinesById.get(checkoutIntentLineId);
	const child = line?.childId ? lookups.childById.get(line.childId) : undefined;
	const fc = line?.festivalClassId
		? lookups.classById.get(line.festivalClassId)
		: undefined;
	return {
		lineId: checkoutIntentLineId,
		childId: line?.childId ?? "",
		childName: child?.displayName ?? "",
		divisionId: registrationSnapshot.division.id,
		divisionName: registrationSnapshot.division.name ?? "",
		teacherId: registrationSnapshot.teacher.customerId,
		teacherName: registrationSnapshot.teacher.name ?? "",
		classId: registrationSnapshot.class.id,
		className: fc?.displayName ?? registrationSnapshot.class.displayName,
		classSubtypeId: registrationSnapshot.class.classSubtypeId,
		classSubtypeName: registrationSnapshot.class.classSubtypeName,
		minimumAge: registrationSnapshot.class.minimumAge,
		maximumAge: registrationSnapshot.class.maximumAge,
		priceCents: Math.round(
			Number.parseFloat(registrationSnapshot.class.price) * 100,
		),
		accompanistId: registrationSnapshot.accompanist?.customerId ?? null,
		accompanistName: registrationSnapshot.accompanist?.name ?? null,
		instrumentId:
			registrationSnapshot.instrument === "unknown"
				? undefined
				: registrationSnapshot.instrument.id,
		instrumentName:
			registrationSnapshot.instrument === "unknown"
				? undefined
				: registrationSnapshot.instrument.name,
		pieces: registrationSnapshot.repertoire,
	};
}

export interface RestartUnissuedCartInput {
	organizationId: string;
	customerId: string;
	festivalShortName: string;
	recoveryReference: string;
}

export async function restartUnissuedCartOp(
	deps: RecoveryOpsDeps,
	input: RestartUnissuedCartInput,
): Promise<ClassCheckoutRestartDto> {
	const executions = deps.checkout.classExecutions;
	if (!executions || !deps.checkout.listCheckoutRegistrationSnapshots) {
		throw new AppError("Checkout restart is unavailable.", 503);
	}
	const record = await executions.getByRecoveryReference(
		input.organizationId,
		input.recoveryReference,
	);
	if (!record || record.customerId !== input.customerId) {
		throw new AppError("Checkout recovery record not found.", 404);
	}
	const intent = deps.checkout.findIntentById
		? await deps.checkout.findIntentById(input.organizationId, record.intentId)
		: null;
	if (!intent) throw new AppError("Checkout intent not found.", 404);
	const festival = await deps.catalog.findFestivalByShortName(
		input.organizationId,
		input.festivalShortName.trim(),
	);
	const [snapshots, children, classes] = await Promise.all([
		deps.checkout.listCheckoutRegistrationSnapshots(
			input.organizationId,
			record.intentId,
		),
		deps.customers.listChildren(input.organizationId, input.customerId),
		festival
			? deps.catalog.listFestivalClassConfigurations(
					input.organizationId,
					festival.id,
					false,
				)
			: Promise.resolve([]),
	]);
	const restarted = await executions.restartUnissuedInvalidCart({
		organizationId: input.organizationId,
		customerId: input.customerId,
		intentId: record.intentId,
	});
	if (!restarted) {
		throw new AppError(
			"This checkout is not eligible for customer cart restart.",
			409,
			"checkout_restart_unavailable",
		);
	}
	const lookups = {
		intentLinesById: new Map(
			(intent.lines ?? []).map((line) => [line.id, line]),
		),
		childById: new Map(children.map((c) => [c.id, c])),
		classById: new Map(classes.map((c) => [c.id, c])),
	};
	return {
		replacementKey: restarted.replacementKey,
		registrations: snapshots.map((entry) =>
			mapRestartRegistration(entry, lookups),
		),
	};
}

export async function listRecoveriesOp(
	deps: RecoveryOpsDeps,
	input: { organizationId: string; customerId?: string },
) {
	const executions = deps.checkout.classExecutions;
	if (!executions) throw new AppError("Checkout recovery is unavailable.", 503);
	const records = await executions.listRecovery(
		input.organizationId,
		input.customerId,
	);
	return Promise.all(
		records.map(async (record: ClassCheckoutExecution) => {
			const events = await executions.events(
				input.organizationId,
				record.intentId,
			);
			return {
				...recoveryStatusFor(record),
				generation: record.generation,
				intentId: record.intentId,
				checkpoint: record.checkpoint,
				updatedAtIso: record.updatedAtIso,
				events: events.map((event) => {
					const { shopifyCartId, ...safeEvidence } = event.evidence ?? {};
					return {
						...event,
						evidence: safeEvidence,
						hasCartEvidence: Boolean(shopifyCartId),
					};
				}),
			};
		}),
	);
}

async function assertAbandonAcknowledgement(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	organizationId: string,
	existing: ClassCheckoutExecution,
	acknowledgeUnknown?: boolean,
): Promise<void> {
	const events: ClassCheckoutExecutionEvent[] = await executions.events(
		organizationId,
		existing.intentId,
	);
	const hasLegacyInvalid = events.some(isLegacyInvalidCartObservation);
	if (
		existing.checkpoint !== "prepared" &&
		!acknowledgeUnknown &&
		!hasLegacyInvalid
	) {
		throw new AppError(
			"Abandoning an uncertain checkout requires acknowledgement.",
			409,
			"checkout_recovery_acknowledgement_required",
		);
	}
}

async function resolveAdoptedCartId(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		organizationId: string;
		existing: ClassCheckoutExecution;
		shopifyCartId?: string;
		evidenceEventId?: string;
	},
): Promise<string | undefined> {
	let adoptedCartId = params.shopifyCartId?.trim();
	if (!adoptedCartId && params.evidenceEventId) {
		const events = await executions.events(
			params.organizationId,
			params.existing.intentId,
		);
		const matched = events.find((e) => e.id === params.evidenceEventId);
		const eventCartId = matched?.evidence?.shopifyCartId;
		if (typeof eventCartId === "string" && eventCartId.trim()) {
			adoptedCartId = eventCartId.trim();
		}
	}
	if (!adoptedCartId && params.existing.shopifyCartId?.trim()) {
		adoptedCartId = params.existing.shopifyCartId.trim();
	}
	return adoptedCartId;
}

async function verifyAdoptCartEvidence(
	deps: RecoveryOpsDeps,
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		organizationId: string;
		existing: ClassCheckoutExecution;
		binding?: ClassCheckoutStorefrontBinding;
		shopifyCartId?: string;
		evidenceEventId?: string;
	},
): Promise<string> {
	const adoptedCartId = await resolveAdoptedCartId(executions, params);
	const intent = deps.checkout.findIntentById
		? await deps.checkout.findIntentById(
				params.organizationId,
				params.existing.intentId,
			)
		: null;
	const customer = await deps.customers.getCustomer(
		params.organizationId,
		params.existing.customerId,
	);
	if (!adoptedCartId || !intent || !deps.storefront?.inspectCart) {
		throw new AppError(
			"Shopify cart evidence could not be verified for this recovery.",
			409,
			"checkout_recovery_evidence_invalid",
		);
	}
	let evidence = null;
	try {
		evidence = await deps.storefront.inspectCart({
			organizationId: params.organizationId,
			shopifyCartId: adoptedCartId,
			expectedStorefrontBinding: params.binding,
		});
	} catch {
		evidence = null;
	}
	if (
		!matchesInspectedCartEvidence(
			intent,
			customer?.shopifyCustomerGid ?? null,
			evidence,
		)
	) {
		throw new AppError(
			"Shopify cart evidence could not be verified for this recovery.",
			409,
			"checkout_recovery_evidence_invalid",
		);
	}
	return adoptedCartId;
}

function mapResolveAction(
	action: "adopt_cart" | "retry_pre_dispatch" | "abandon_unknown",
) {
	if (action === "adopt_cart") return "resume_known_cart" as const;
	if (action === "abandon_unknown") return "abandon" as const;
	return "retry_pre_dispatch" as const;
}

export interface ResolveRecoveryInput {
	organizationId: string;
	recoveryReference: string;
	expectedGeneration: number;
	actorId: string;
	reason: string;
	action: "adopt_cart" | "retry_pre_dispatch" | "abandon_unknown";
	shopifyCartId?: string;
	evidenceEventId?: string;
	acknowledgeUnknown?: boolean;
}

export async function resolveRecoveryOp(
	deps: RecoveryOpsDeps,
	input: ResolveRecoveryInput,
) {
	const executions = deps.checkout.classExecutions;
	if (!executions) throw new AppError("Checkout recovery is unavailable.", 503);
	if (!input.reason.trim())
		throw new AppError("Recovery reason is required.", 400);
	const existing = await executions.getByRecoveryReference(
		input.organizationId,
		input.recoveryReference,
	);
	if (!existing) throw new AppError("Checkout recovery record not found.", 404);
	const mappedAction = mapResolveAction(input.action);
	if (mappedAction === "abandon") {
		await assertAbandonAcknowledgement(
			executions,
			input.organizationId,
			existing,
			input.acknowledgeUnknown,
		);
	}
	const integration = await deps.organizations.getShopifyIntegration(
		input.organizationId,
	);
	const binding = integration
		? resolveStorefrontBinding(integration)
		: undefined;
	const adoptedCartId =
		input.action === "adopt_cart"
			? await verifyAdoptCartEvidence(deps, executions, {
					...input,
					existing,
					binding,
				})
			: undefined;
	const resolved = await executions.resolve({
		organizationId: input.organizationId,
		intentId: existing.intentId,
		expectedGeneration: input.expectedGeneration,
		actorId: input.actorId,
		reason: input.reason,
		action: mappedAction,
		shopifyCartId: adoptedCartId ?? input.shopifyCartId,
		storefrontBinding: binding,
	});
	if (!resolved) {
		throw new AppError(
			"Checkout recovery state changed concurrently.",
			409,
			"checkout_recovery_conflict",
		);
	}
	return {
		...recoveryStatusFor(resolved),
		generation: resolved.generation,
		intentId: resolved.intentId,
		customerId: resolved.customerId,
	};
}
