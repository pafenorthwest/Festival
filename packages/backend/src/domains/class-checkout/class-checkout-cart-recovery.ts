import { AppError } from "@festival/common";
import type {
	ClassCheckoutClaim,
	ClassCheckoutStorefrontBinding,
} from "./checkout-execution-types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import {
	ClassCheckoutCartObservationError,
	type ClassCheckoutFailureLogger,
	ClassCheckoutPersistenceUnavailableError,
	ClassCheckoutRecoveryRequiredError,
	ClassCheckoutStorefrontChangedBeforeRequestError,
} from "./class-checkout-errors.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutOrganizationReadPort,
	CheckoutShopifyIntegrationRecord,
	ClassCheckoutStorefrontPort,
} from "./ports.js";

export interface CartHandoffDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog?: CheckoutCatalogReadPort;
	checkout: CheckoutRepository;
	storefront: ClassCheckoutStorefrontPort;
	commerce?: CheckoutCommerceReadPort;
	failureLogger: ClassCheckoutFailureLogger;
	now: () => Date;
}

export function resolveStorefrontBinding(
	integration: CheckoutShopifyIntegrationRecord | null,
): ClassCheckoutStorefrontBinding {
	const shopDomain =
		integration?.verifiedShopDomain ??
		integration?.storeDomain ??
		integration?.shopDomain ??
		"";
	if (!integration || !shopDomain) {
		throw new AppError(
			"Shopify storefront integration is not configured.",
			503,
			"shopify_integration_missing",
		);
	}
	return {
		shopDomain,
		integrationVersion: integration.integrationVersion,
	};
}

export function sameStorefrontBinding(
	a: ClassCheckoutStorefrontBinding | null | undefined,
	b: ClassCheckoutStorefrontBinding | null | undefined,
): boolean {
	if (!a || !b) return false;
	return (
		a.shopDomain === b.shopDomain &&
		a.integrationVersion === b.integrationVersion
	);
}

export function isInvalidShopifyCartError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const msg = error.message.toLowerCase();
	return (
		msg.includes("cart") &&
		(msg.includes("not found") ||
			msg.includes("does not exist") ||
			msg.includes("invalid") ||
			msg.includes("expired"))
	);
}

export function isValidCheckoutUrlForDomain(
	url: string,
	shopDomain: string,
): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			parsed.hostname.toLowerCase() === shopDomain.toLowerCase()
		);
	} catch {
		return false;
	}
}

export async function markAttachedRetryable(
	deps: CartHandoffDeps,
	organizationId: string,
	intentId: string,
): Promise<void> {
	if (!deps.checkout.classExecutions) return;
	const exec = await deps.checkout.classExecutions.get(
		organizationId,
		intentId,
	);
	if (!exec || exec.checkpoint !== "attached") return;
	const owner = `retry_${exec.generation}`;
	const claimed = await deps.checkout.classExecutions.claim({
		organizationId,
		intentId,
		owner,
		allowCompleted: true,
	});
	if (!claimed) return;
	await deps.checkout.classExecutions.transition({
		claim: {
			organizationId: claimed.organizationId,
			intentId: claimed.intentId,
			owner,
			generation: claimed.generation,
		},
		checkpoint: "attached",
		state: "retryable",
		releaseLease: true,
		eventType: "checkout_url_unavailable",
	});
}

async function recordInvalidCartObservation(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	claim: ClassCheckoutClaim,
	shopifyCartId: string,
): Promise<never> {
	let record = null;
	try {
		await executions.transition({
			claim,
			checkpoint: "remote_cart_known",
			shopifyCartId,
			eventType: "invalid_remote_cart_observed",
			evidence: { shopifyCartId },
		});
		await executions.recordRecoveryRequired({
			claim,
			reason: "checkout_invalid_remote_cart",
			evidence: { shopifyCartId },
		});
		record = await executions.get(claim.organizationId, claim.intentId);
	} catch {
		throw new ClassCheckoutPersistenceUnavailableError();
	}
	if (record) {
		throw new ClassCheckoutRecoveryRequiredError(record, true);
	}
	throw new ClassCheckoutPersistenceUnavailableError();
}

export async function recordRemoteCartKnownOrThrow(
	deps: CartHandoffDeps,
	params: {
		organizationId: string;
		intent: CheckoutIntentRecord;
		claim: ClassCheckoutClaim;
		shopifyCartId: string;
	},
): Promise<void> {
	const executions = deps.checkout.classExecutions;
	if (!executions) return;
	const recorded = await executions.transition({
		claim: params.claim,
		checkpoint: "remote_cart_known",
		shopifyCartId: params.shopifyCartId,
		eventType: "remote_cart_known",
		evidence: { shopifyCartId: params.shopifyCartId },
	});
	if (recorded) return;
	const current = await executions.get(params.organizationId, params.intent.id);
	await executions.appendLateEvidence({
		organizationId: params.organizationId,
		intentId: params.intent.id,
		generation: current?.generation ?? params.claim.generation,
		eventType: "late_remote_cart_observed",
		evidence: { shopifyCartId: params.shopifyCartId, stage: "create_cart" },
	});
	deps.failureLogger.error("Class checkout failed.", {
		operation: "checkout.class",
		stage: "persistence",
		organizationId: params.organizationId,
		checkoutIntentId: params.intent.id,
		correlationId: params.intent.correlationId,
	});
	const updated =
		current ?? (await executions.get(params.organizationId, params.intent.id));
	if (updated) {
		throw new ClassCheckoutRecoveryRequiredError(updated, true);
	}
	throw new ClassCheckoutPersistenceUnavailableError();
}

async function handleClaimedCreateCartFailure(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		organizationId: string;
		intentId: string;
		claim: ClassCheckoutClaim;
	},
	error: unknown,
): Promise<never> {
	if (error instanceof ClassCheckoutStorefrontChangedBeforeRequestError) {
		await executions.transition({
			claim: params.claim,
			checkpoint: "prepared",
			state: "retryable",
			storefrontBinding: null,
			releaseLease: true,
			eventType: "pre_dispatch_storefront_changed",
		});
		throw new AppError(
			"Shopify Storefront configuration changed before dispatch.",
			503,
			"checkout_retryable_upstream",
		);
	}
	if (error instanceof ClassCheckoutCartObservationError) {
		await recordInvalidCartObservation(
			executions,
			params.claim,
			error.observedShopifyCartId,
		);
	}
	let record = null;
	try {
		await executions.recordRecoveryRequired({
			claim: params.claim,
			reason: "checkout_creation_unknown",
			evidence: { stage: "create_cart", code: "checkout_creation_unknown" },
		});
		record = await executions.get(params.organizationId, params.intentId);
	} catch {
		throw new ClassCheckoutPersistenceUnavailableError();
	}
	if (record) throw new ClassCheckoutRecoveryRequiredError(record, true);
	if (error instanceof AppError) throw error;
	throw new ClassCheckoutPersistenceUnavailableError();
}

export async function handleCreateCartFailure(
	deps: CartHandoffDeps,
	params: {
		organizationId: string;
		intent: CheckoutIntentRecord;
		claim?: ClassCheckoutClaim;
	},
	error: unknown,
): Promise<never> {
	if (params.claim && deps.checkout.classExecutions) {
		return handleClaimedCreateCartFailure(
			deps.checkout.classExecutions,
			{
				organizationId: params.organizationId,
				intentId: params.intent.id,
				claim: params.claim,
			},
			error,
		);
	}
	if (!deps.checkout.classExecutions) {
		await deps.checkout.markFailed(params.intent.id);
		if (error instanceof AppError) throw error;
		throw new AppError(
			"Shopify checkout is temporarily unavailable.",
			503,
			"checkout_retryable_upstream",
		);
	}
	if (error instanceof AppError) throw error;
	deps.failureLogger.error("Class checkout failed.", {
		operation: "checkout.class",
		stage: "create_cart",
		organizationId: params.organizationId,
		checkoutIntentId: params.intent.id,
		correlationId: params.intent.correlationId,
		errorName: error instanceof Error ? error.name : typeof error,
	});
	throw new AppError("Failed to create Shopify checkout cart.", 502);
}

async function handleClaimedAttachCartFailure(
	executions: NonNullable<CheckoutRepository["classExecutions"]>,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		claim: ClassCheckoutClaim;
	},
	error: unknown,
): Promise<never> {
	await executions.reapExpired(params.intent.organizationId, params.intent.id);
	const current = await executions.get(
		params.intent.organizationId,
		params.intent.id,
	);
	if (current?.state === "recovery_required") {
		throw new ClassCheckoutRecoveryRequiredError(current, true);
	}
	if (
		!current ||
		current.leaseOwner !== params.claim.owner ||
		current.generation !== params.claim.generation ||
		current.state !== "running"
	) {
		throw new AppError(
			"Checkout execution lease expired during cart attachment.",
			409,
			"checkout_execution_changed",
		);
	}
	await executions.recordRecoveryRequired({
		claim: params.claim,
		reason: "checkout_attachment_incomplete",
		evidence: {
			shopifyCartId: params.shopifyCartId,
			stage: "attach_cart",
			code:
				error instanceof AppError && error.code
					? error.code
					: "checkout_attachment_incomplete",
		},
	});
	const updated = await executions.get(
		params.intent.organizationId,
		params.intent.id,
	);
	if (updated) throw new ClassCheckoutRecoveryRequiredError(updated, true);
	throw new ClassCheckoutPersistenceUnavailableError();
}

export async function handleAttachCartFailure(
	deps: CartHandoffDeps,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		claim?: ClassCheckoutClaim;
	},
	error: unknown,
): Promise<never> {
	if (params.claim && deps.checkout.classExecutions) {
		return handleClaimedAttachCartFailure(
			deps.checkout.classExecutions,
			{
				intent: params.intent,
				shopifyCartId: params.shopifyCartId,
				claim: params.claim,
			},
			error,
		);
	}
	if (error instanceof AppError) throw error;
	deps.failureLogger.error("Class checkout failed.", {
		operation: "checkout.class",
		stage: "attach_cart",
		organizationId: params.intent.organizationId,
		checkoutIntentId: params.intent.id,
		correlationId: params.intent.correlationId,
		errorName: error instanceof Error ? error.name : typeof error,
	});
	throw new AppError("Failed to attach Shopify cart to checkout.", 500);
}

export async function handleStorefrontCheckoutError(
	deps: CartHandoffDeps,
	params: {
		organizationId: string;
		intentId: string;
		correlationId?: string;
		shopifyCartId: string;
	},
	error: unknown,
): Promise<never> {
	if (
		error instanceof AppError &&
		error.code === "checkout_retryable_upstream"
	) {
		throw error;
	}
	if (deps.checkout.classExecutions) {
		const exec = await deps.checkout.classExecutions.get(
			params.organizationId,
			params.intentId,
		);
		if (exec && isInvalidShopifyCartError(error)) {
			await deps.checkout.classExecutions.appendLateEvidence({
				organizationId: params.organizationId,
				intentId: params.intentId,
				generation: exec.generation,
				eventType: "invalid_remote_cart_observed",
				evidence: { shopifyCartId: params.shopifyCartId },
			});
		} else {
			await markAttachedRetryable(deps, params.organizationId, params.intentId);
		}
	}
	deps.failureLogger.error("Class checkout failed.", {
		operation: "checkout.class",
		stage: "checkout_url",
		organizationId: params.organizationId,
		checkoutIntentId: params.intentId,
		...(params.correlationId ? { correlationId: params.correlationId } : {}),
		errorName: error instanceof Error ? error.name : typeof error,
	});
	if (error instanceof AppError) throw error;
	throw new AppError(
		"Shopify checkout URL is temporarily unavailable.",
		503,
		"checkout_retryable_upstream",
	);
}
