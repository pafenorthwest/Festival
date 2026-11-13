import { randomUUID } from "node:crypto";
import { AppError } from "@festival/common";
import { unissuedInvalidCartRestartDecision } from "./checkout-execution-helpers.js";
import type {
	ClassCheckoutClaim,
	ClassCheckoutExecution,
	ClassCheckoutExecutionRepository,
	ClassCheckoutStorefrontBinding,
} from "./checkout-execution-types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
	ClassCheckoutReplayState,
} from "./checkout-types.js";
import {
	ClassCheckoutCartObservationError,
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutRecoveryStatus,
	ClassCheckoutReplayResolvedError,
	ClassCheckoutStorefrontChangedBeforeRequestError,
	resolvedCheckoutStatus,
} from "./class-checkout-errors.js";
import type {
	CheckoutOrganizationReadPort,
	ClassCheckoutStorefrontPort,
} from "./ports.js";

export const REPLAY_CHECKOUT_TIMEOUT_MS = 2_000;

export interface ReplayHandoffDeps {
	organizations: CheckoutOrganizationReadPort;
	checkout: CheckoutRepository;
	storefront: ClassCheckoutStorefrontPort;
	now: () => Date;
	resolveBinding: (
		integration: Awaited<
			ReturnType<CheckoutOrganizationReadPort["getShopifyIntegration"]>
		>,
	) => ClassCheckoutStorefrontBinding;
	sameBinding: (
		a: ClassCheckoutStorefrontBinding | null | undefined,
		b: ClassCheckoutStorefrontBinding | null | undefined,
	) => boolean;
}

export function buildReplayTimeoutError(): AppError {
	return new AppError(
		"Timed out waiting for Shopify checkout link.",
		503,
		"checkout_replay_timeout",
	);
}

export async function recordRecoveryRequiredFromClaim(
	executions: ClassCheckoutExecutionRepository,
	claim: ClassCheckoutClaim,
	reason: string,
	evidence?: Record<string, unknown>,
): Promise<ClassCheckoutExecution | null> {
	await executions.recordRecoveryRequired({ claim, reason, evidence });
	return executions.get(claim.organizationId, claim.intentId);
}

export function matchesInspectedCartEvidence(
	intent: CheckoutIntentRecord,
	shopifyCustomerGid: string | null | undefined,
	evidence: {
		correlationId?: string | null;
		customerGid?: string | null;
		lines: Array<{
			intentLineId?: string | null;
			variantGid: string;
			quantity: number;
		}>;
	} | null,
): boolean {
	if (!evidence || evidence.correlationId !== intent.correlationId)
		return false;
	if (shopifyCustomerGid && evidence.customerGid !== shopifyCustomerGid) {
		return false;
	}
	const expectedLines =
		intent.lines && intent.lines.length > 0
			? intent.lines.map((line) => ({
					id: line.id,
					variantGid: line.shopifyVariantGid,
				}))
			: [{ id: null, variantGid: intent.shopifyVariantGid }];
	if (evidence.lines.length !== expectedLines.length) return false;
	return expectedLines.every((expected) =>
		evidence.lines.some(
			(actual) =>
				actual.variantGid === expected.variantGid &&
				actual.quantity === 1 &&
				(expected.id === null || actual.intentLineId === expected.id),
		),
	);
}

async function releaseLegacyVerifyClaimRetryable(
	executions: ClassCheckoutExecutionRepository,
	claim: ClassCheckoutClaim,
	checkpoint: ClassCheckoutExecution["checkpoint"],
): Promise<void> {
	await executions.transition({
		claim,
		checkpoint,
		state: "retryable",
		releaseLease: true,
		eventType: "storefront_verification_unavailable",
	});
}

async function acquireLegacyVerifyClaim(
	executions: ClassCheckoutExecutionRepository,
	execution: ClassCheckoutExecution,
	intent: CheckoutIntentRecord,
): Promise<ClassCheckoutClaim> {
	const owner = `verify_${randomUUID()}`;
	const claimed = await executions.claim({
		organizationId: intent.organizationId,
		intentId: intent.id,
		owner,
		allowCompleted: true,
	});
	if (!claimed) {
		throw new ClassCheckoutRecoveryRequiredError(execution, true);
	}
	return {
		organizationId: claimed.organizationId,
		intentId: claimed.intentId,
		owner,
		generation: claimed.generation,
	};
}

async function inspectLegacyCartOrFail(
	deps: ReplayHandoffDeps,
	executions: ClassCheckoutExecutionRepository,
	activeClaim: ClassCheckoutClaim,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		binding: ClassCheckoutStorefrontBinding;
		execution: ClassCheckoutExecution;
		hasOuterClaim: boolean;
	},
) {
	const inspectCart = deps.storefront.inspectCart;
	if (!inspectCart) {
		const updated = await recordRecoveryRequiredFromClaim(
			executions,
			activeClaim,
			"checkout_storefront_verification_required",
		);
		throw new ClassCheckoutRecoveryRequiredError(
			updated ?? params.execution,
			true,
		);
	}
	try {
		return await inspectCart({
			organizationId: params.intent.organizationId,
			shopifyCartId: params.shopifyCartId,
			expectedStorefrontBinding: params.binding,
		});
	} catch (error) {
		if (!params.hasOuterClaim) {
			await releaseLegacyVerifyClaimRetryable(
				executions,
				activeClaim,
				params.execution.checkpoint,
			);
		}
		if (error instanceof AppError) throw error;
		throw new ClassCheckoutCartObservationError(params.shopifyCartId);
	}
}

export async function verifyLegacyCartEvidence(
	deps: ReplayHandoffDeps,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		shopifyCustomerGid?: string | null;
		binding: ClassCheckoutStorefrontBinding;
		execution: ClassCheckoutExecution;
		claim?: ClassCheckoutClaim;
	},
): Promise<ClassCheckoutExecution> {
	const executions = deps.checkout.classExecutions;
	if (!executions) return params.execution;
	const activeClaim =
		params.claim ??
		(await acquireLegacyVerifyClaim(
			executions,
			params.execution,
			params.intent,
		));
	const evidence = await inspectLegacyCartOrFail(
		deps,
		executions,
		activeClaim,
		{ ...params, hasOuterClaim: Boolean(params.claim) },
	);
	if (
		!matchesInspectedCartEvidence(
			params.intent,
			params.shopifyCustomerGid,
			evidence,
		)
	) {
		const updated = await recordRecoveryRequiredFromClaim(
			executions,
			activeClaim,
			"checkout_storefront_verification_required",
		);
		throw new ClassCheckoutRecoveryRequiredError(
			updated ?? params.execution,
			true,
		);
	}
	if (!params.claim) {
		await executions.transition({
			claim: activeClaim,
			checkpoint: params.execution.checkpoint,
			state: "completed",
			storefrontBinding: params.binding,
			releaseLease: true,
			eventType: "storefront_verified",
		});
		return (
			(await executions.get(params.intent.organizationId, params.intent.id)) ??
			params.execution
		);
	}
	return params.execution;
}

function assertVerifiedCheckoutUrl(
	checkoutUrl: string,
	shopDomain: string,
): void {
	try {
		const parsed = new URL(checkoutUrl);
		if (
			parsed.protocol !== "https:" ||
			parsed.hostname.toLowerCase() !== shopDomain.toLowerCase()
		) {
			throw new AppError(
				"Shopify checkout URL verification failed.",
				503,
				"checkout_retryable_upstream",
			);
		}
	} catch (urlError) {
		if (urlError instanceof AppError) throw urlError;
		throw new AppError(
			"Shopify checkout URL verification failed.",
			503,
			"checkout_retryable_upstream",
		);
	}
}

export async function runReplayCheckoutWithTimeout(
	deps: ReplayHandoffDeps,
	params: {
		organizationId: string;
		intentId: string;
		shopifyCartId: string;
		binding: ClassCheckoutStorefrontBinding;
		execution: ClassCheckoutExecution | null;
	},
): Promise<{ checkoutUrl: string }> {
	const current = await deps.organizations.getShopifyIntegration(
		params.organizationId,
	);
	if (!deps.sameBinding(deps.resolveBinding(current), params.binding)) {
		throw new ClassCheckoutStorefrontChangedBeforeRequestError();
	}
	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
			reject(buildReplayTimeoutError());
		}, REPLAY_CHECKOUT_TIMEOUT_MS);
	});
	try {
		const checkoutPromise = deps.storefront.checkout({
			organizationId: params.organizationId,
			shopifyCartId: params.shopifyCartId,
			expectedStorefrontBinding: params.binding,
			signal: controller.signal,
		});
		void checkoutPromise.catch(() => undefined);
		const result = await Promise.race([checkoutPromise, timeoutPromise]);
		if (timedOut) throw buildReplayTimeoutError();
		assertVerifiedCheckoutUrl(result.checkoutUrl, params.binding.shopDomain);
		return result;
	} catch (error) {
		if (timedOut) {
			if (deps.checkout.classExecutions && params.execution) {
				await deps.checkout.classExecutions.appendLateEvidence({
					organizationId: params.organizationId,
					intentId: params.intentId,
					generation: params.execution.generation,
					eventType: "checkout_url_unavailable",
					evidence: {
						stage: "resume_checkout_url",
						code: "checkout_replay_timeout",
					},
				});
			}
			throw buildReplayTimeoutError();
		}
		if (error instanceof AppError) throw error;
		throw new ClassCheckoutCartObservationError(params.shopifyCartId);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function buildResolvedReplayStatus(
	intentStatus: ClassCheckoutReplayState["intentStatus"],
	exec: ClassCheckoutExecution | null,
): ClassCheckoutRecoveryStatus {
	if (!exec) {
		return {
			status: "resolved",
			recoveryReference: "",
			reasonCode:
				intentStatus === "approved"
					? "checkout_already_completed"
					: "checkout_needs_review",
			retryAllowed: false,
		};
	}
	return (
		resolvedCheckoutStatus(intentStatus, exec) ?? {
			status: "resolved",
			recoveryReference: exec.recoveryReference,
			reasonCode: "checkout_already_completed",
			retryAllowed: false,
		}
	);
}

const TERMINAL_INTENT_STATUSES = [
	"approved",
	"rejected",
	"needs_review",
	"superseded",
];

async function recordReplayExpiryIfNeeded(
	checkout: CheckoutRepository,
	intent: CheckoutIntentRecord,
	initialExecution: ClassCheckoutExecution,
): Promise<never> {
	const recorded = await checkout.classExecutions?.recordApplicationExpiry({
		organizationId: intent.organizationId,
		intentId: intent.id,
		expectedGeneration: initialExecution.generation,
	});
	const exec =
		recorded ??
		(await checkout.classExecutions?.get(intent.organizationId, intent.id)) ??
		initialExecution;
	throw new ClassCheckoutRecoveryRequiredError(exec, true);
}

export async function evaluatePostLookupReplayState(
	deps: Pick<ReplayHandoffDeps, "checkout" | "now">,
	params: {
		intent: CheckoutIntentRecord;
		initialExecution: ClassCheckoutExecution | null;
	},
): Promise<{ withheldReason: ClassCheckoutRecoveryStatus } | null> {
	const state: ClassCheckoutReplayState | null =
		await deps.checkout.getClassCheckoutReplayState(
			params.intent.organizationId,
			params.intent.id,
		);
	const expiredByClock =
		deps.now().getTime() >= Date.parse(params.intent.expiresAtIso);
	if (
		state &&
		params.initialExecution &&
		!TERMINAL_INTENT_STATUSES.includes(state.intentStatus) &&
		expiredByClock
	) {
		await recordReplayExpiryIfNeeded(
			deps.checkout,
			params.intent,
			params.initialExecution,
		);
	}
	if (!state) return null;
	if (TERMINAL_INTENT_STATUSES.includes(state.intentStatus)) {
		return {
			withheldReason: buildResolvedReplayStatus(
				state.intentStatus,
				params.initialExecution,
			),
		};
	}
	if (
		params.initialExecution &&
		(state.generation !== params.initialExecution.generation ||
			state.state !== params.initialExecution.state)
	) {
		throw new AppError(
			"Checkout execution state changed while preparing checkout link.",
			409,
			"checkout_execution_changed",
		);
	}
	return null;
}

export async function throwManagedExecutionGuard(
	executions: ClassCheckoutExecutionRepository,
	intent: CheckoutIntentRecord,
	record: ClassCheckoutExecution,
	expectedFingerprint: string,
): Promise<never> {
	if (record.fingerprint !== expectedFingerprint) {
		throw new AppError(
			"Checkout identity belongs to different registration contents.",
			409,
			"checkout_payload_conflict",
		);
	}
	const resolved = resolvedCheckoutStatus(intent.status, record);
	if (resolved && record.state !== "retryable") {
		throw new ClassCheckoutReplayResolvedError(resolved);
	}
	if (record.state === "running") {
		throw new AppError(
			"Checkout is currently in progress.",
			409,
			"checkout_in_progress",
		);
	}
	if (record.state === "recovery_required") {
		const events = await executions.events(intent.organizationId, intent.id);
		const decision = unissuedInvalidCartRestartDecision(
			record,
			intent.status,
			events,
		);
		throw new ClassCheckoutRecoveryRequiredError(
			record,
			true,
			decision === "restartable" ? { restartAllowed: true } : undefined,
		);
	}
	throw new ClassCheckoutRecoveryRequiredError(record, true);
}
