import { randomUUID } from "node:crypto";
import { AppError } from "@festival/common";
import { unissuedInvalidCartRestartDecision } from "./checkout-execution-helpers.js";
import type { ClassCheckoutExecution } from "./checkout-execution-types.js";
import {
	assertCheckoutIntentType,
	type CheckoutIntentRecord,
	type CheckoutRepository,
} from "./checkout-types.js";
import {
	resolveStorefrontBinding,
	sameStorefrontBinding,
} from "./class-checkout-cart-handoff.js";
import {
	type ClassCheckoutFailureLogger,
	ClassCheckoutPersistenceUnavailableError,
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutRecoveryStatus,
	classCheckoutRequestFingerprint,
	resolvedCheckoutStatus,
	type StartClassCheckoutInput,
} from "./class-checkout-errors.js";
import {
	evaluatePostLookupReplayState,
	runReplayCheckoutWithTimeout,
	throwManagedExecutionGuard,
	verifyLegacyCartEvidence,
} from "./class-checkout-replay-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
	ClassCheckoutStorefrontPort,
} from "./ports.js";

export interface RecoveryOpsDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	checkout: CheckoutRepository;
	storefront?: ClassCheckoutStorefrontPort;
	failureLogger: ClassCheckoutFailureLogger;
	now: () => Date;
}

const RESOLVED_INTENT_STATUSES = new Set([
	"approved",
	"rejected",
	"needs_review",
	"superseded",
]);

export async function expireIntentIfNeeded(
	deps: RecoveryOpsDeps,
	intent: CheckoutIntentRecord | null,
	record: ClassCheckoutExecution,
): Promise<ClassCheckoutExecution> {
	const executions = deps.checkout.classExecutions;
	if (
		!executions ||
		!intent ||
		RESOLVED_INTENT_STATUSES.has(intent.status) ||
		record.checkpoint !== "attached" ||
		deps.now().getTime() < Date.parse(intent.expiresAtIso)
	) {
		return record;
	}
	const updated = await executions.recordApplicationExpiry({
		organizationId: intent.organizationId,
		intentId: intent.id,
		expectedGeneration: record.generation,
	});
	return (
		updated ??
		(await executions.get(intent.organizationId, intent.id)) ??
		record
	);
}

async function rejectExpiredPreparedExecution(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	organizationId: string,
	intentId: string,
): Promise<never> {
	const owner = `expiry_${randomUUID()}`;
	const claimed = await executions.claim({ organizationId, intentId, owner });
	if (!claimed) {
		const latest = await executions.get(organizationId, intentId);
		if (latest) throw new ClassCheckoutRecoveryRequiredError(latest, true);
		throw new ClassCheckoutPersistenceUnavailableError();
	}
	try {
		const ok = await executions.transition({
			claim: {
				organizationId,
				intentId,
				owner,
				generation: claimed.generation,
			},
			checkpoint: "prepared",
			state: "rejected",
			storefrontBinding: null,
			resultCode: "checkout_expired",
			releaseLease: true,
			eventType: "pre_dispatch_expired",
		});
		if (!ok) throw new ClassCheckoutPersistenceUnavailableError();
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new ClassCheckoutPersistenceUnavailableError();
	}
	throw new AppError(
		"Checkout attempt expired before dispatch.",
		409,
		"checkout_pre_dispatch_rejected",
	);
}

async function preflightExistingIntent(
	deps: RecoveryOpsDeps,
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		fingerprint: string;
	},
): Promise<void> {
	const { input, intent, fingerprint } = params;
	assertCheckoutIntentType(intent, "class_entry");
	let existing = await executions.get(input.organizationId, intent.id);
	if (existing?.state === "running") {
		await executions.reapExpired(input.organizationId, intent.id);
		existing = await executions.get(input.organizationId, intent.id);
	}
	if (!existing) return;
	if (
		existing.checkpoint === "prepared" &&
		existing.state !== "rejected" &&
		!RESOLVED_INTENT_STATUSES.has(intent.status) &&
		Date.parse(intent.expiresAtIso) <= deps.now().getTime()
	) {
		await rejectExpiredPreparedExecution(
			executions,
			input.organizationId,
			intent.id,
		);
	}
	const record = await expireIntentIfNeeded(deps, intent, existing);
	if (
		record.fingerprint !== fingerprint ||
		resolvedCheckoutStatus(intent.status, record) ||
		record.state === "recovery_required" ||
		record.state === "running"
	) {
		await throwManagedExecutionGuard(executions, intent, record, fingerprint);
	}
	const events = await executions.events(input.organizationId, intent.id);
	if (
		unissuedInvalidCartRestartDecision(record, intent.status, events) ===
		"restartable"
	) {
		throw new ClassCheckoutRecoveryRequiredError(record, true, {
			restartAllowed: true,
		});
	}
}

async function preflightBlockingExecution(
	deps: RecoveryOpsDeps,
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		input: StartClassCheckoutInput;
		intentId?: string;
		fingerprint: string;
	},
): Promise<void> {
	const { input, intentId, fingerprint } = params;
	let blocking = await executions.findBlocking(
		input.organizationId,
		input.customerId,
	);
	if (!blocking || blocking.intentId === intentId) return;
	if (blocking.state === "running") {
		await executions.reapExpired(input.organizationId, blocking.intentId);
		blocking = await executions.findBlocking(
			input.organizationId,
			input.customerId,
		);
	}
	if (!blocking || blocking.intentId === intentId) return;
	if (blocking.state === "running") {
		throw new AppError(
			"Checkout is currently in progress.",
			409,
			"checkout_in_progress",
		);
	}
	const blockingIntent = deps.checkout.findIntentById
		? await deps.checkout.findIntentById(
				input.organizationId,
				blocking.intentId,
			)
		: null;
	const refreshed = await expireIntentIfNeeded(deps, blockingIntent, blocking);
	const events = await executions.events(
		input.organizationId,
		blocking.intentId,
	);
	const decision = blockingIntent
		? unissuedInvalidCartRestartDecision(
				refreshed,
				blockingIntent.status,
				events,
			)
		: null;
	throw new ClassCheckoutRecoveryRequiredError(
		refreshed,
		refreshed.fingerprint === fingerprint,
		decision === "restartable" ? { restartAllowed: true } : undefined,
	);
}

export async function preflightRecoveryOp(
	deps: RecoveryOpsDeps,
	input: StartClassCheckoutInput,
): Promise<void> {
	const executions = deps.checkout.classExecutions;
	if (!executions || !deps.checkout.findIntentByKey) return;
	if (
		await executions.isUnissuedCartReplacementBlocked({
			organizationId: input.organizationId,
			customerId: input.customerId,
			replacementKey: input.idempotencyKey,
		})
	) {
		throw new AppError(
			"A payment has already been observed for the replaced checkout attempt.",
			409,
			"checkout_restart_payment_uncertain",
		);
	}
	const intent = await deps.checkout.findIntentByKey(input);
	const fingerprint = classCheckoutRequestFingerprint(input);
	if (intent) {
		await preflightExistingIntent(deps, executions, {
			input,
			intent,
			fingerprint,
		});
	}
	await preflightBlockingExecution(deps, executions, {
		input,
		intentId: intent?.id,
		fingerprint,
	});
}

export interface ReadyRecoveryInput {
	organizationId: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
}

export interface ReadyRecoveryContext {
	intent: CheckoutIntentRecord | null;
	record: ClassCheckoutExecution;
	base: ClassCheckoutRecoveryStatus;
}

export async function resolveReadyRecoveryStatus(
	deps: RecoveryOpsDeps,
	input: ReadyRecoveryInput,
	params: ReadyRecoveryContext,
): Promise<ClassCheckoutRecoveryStatus> {
	const { intent, record, base } = params;
	if (
		!intent ||
		intent.sessionId !== input.sessionId ||
		intent.idempotencyKey !== input.idempotencyKey
	) {
		return { ...base, retryAllowed: false };
	}
	if (!record.shopifyCartId || !deps.storefront) return base;
	const binding = resolveStorefrontBinding(
		await deps.organizations.getShopifyIntegration(input.organizationId),
	);
	const replayDeps = {
		organizations: deps.organizations,
		checkout: deps.checkout,
		storefront: deps.storefront,
		now: deps.now,
		resolveBinding: resolveStorefrontBinding,
		sameBinding: sameStorefrontBinding,
	};
	let activeRecord = record;
	if (activeRecord.storefrontBinding === null) {
		const customer = await deps.customers.getCustomer(
			input.organizationId,
			input.customerId,
		);
		activeRecord = await verifyLegacyCartEvidence(replayDeps, {
			intent,
			shopifyCartId: record.shopifyCartId,
			shopifyCustomerGid: customer?.shopifyCustomerGid,
			binding,
			execution: activeRecord,
		});
	}
	const result = await runReplayCheckoutWithTimeout(replayDeps, {
		organizationId: input.organizationId,
		intentId: intent.id,
		shopifyCartId: record.shopifyCartId,
		binding: activeRecord.storefrontBinding ?? binding,
		execution: activeRecord,
	});
	const withheld = await evaluatePostLookupReplayState(replayDeps, {
		intent,
		initialExecution: activeRecord,
	});
	if (withheld) return withheld.withheldReason;
	return {
		...base,
		status: "ready",
		retryAllowed: true,
		checkoutUrl: result.checkoutUrl,
	};
}
