import {
	AppError,
	type FestivalRecord,
	type RegistrationCatalogValue,
} from "@festival/common";
import type { ClassCheckoutStorefrontBinding } from "./checkout-execution-types.js";
import {
	assertCheckoutIntentType,
	type CheckoutIntentOutcome,
	type CheckoutIntentRecord,
	type CheckoutRepository,
} from "./checkout-types.js";
import {
	resolveStorefrontBinding,
	runStorefrontCheckout,
	sameStorefrontBinding,
} from "./class-checkout-cart-handoff.js";
import {
	ClassCheckoutRecoveryRequiredError,
	classCheckoutRequestFingerprint,
	normalizeClassCheckoutLineInputs,
	resolvedCheckoutStatus,
	type StartClassCheckoutInput,
} from "./class-checkout-errors.js";
import {
	type ValidatedClassLineData,
	validateAndPrepareClassLines,
} from "./class-checkout-line-runner.js";
import type { ExecutionRuntimeCtx } from "./class-checkout-metadata-guard.js";
import {
	evaluatePostLookupReplayState,
	runReplayCheckoutWithTimeout,
	throwManagedExecutionGuard,
	verifyLegacyCartEvidence,
} from "./class-checkout-replay-helpers.js";

export interface ClassCheckoutResult {
	checkoutUrl: string;
	intentId: string;
	correlationId: string;
	intent?: CheckoutIntentRecord;
}

export interface WindowCtx {
	festival?: FestivalRecord;
	timezone?: string;
	subtypes?: RegistrationCatalogValue[];
}

export type ClaimedCheckoutExecutor = (
	ctx: ExecutionRuntimeCtx,
	params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		validatedLines: ValidatedClassLineData[];
		shopifyCustomerGid: string | null;
		festivalId: string;
		windowCtx?: WindowCtx;
	},
) => Promise<ClassCheckoutResult>;

function buildReplayDeps(ctx: ExecutionRuntimeCtx) {
	return {
		organizations: ctx.deps.organizations,
		checkout: ctx.deps.checkout,
		storefront: ctx.deps.storefront,
		now: ctx.now,
		resolveBinding: resolveStorefrontBinding,
		sameBinding: sameStorefrontBinding,
	};
}

async function fetchReplayCheckoutUrl(
	ctx: ExecutionRuntimeCtx,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		binding: ClassCheckoutStorefrontBinding;
		wasRetryable: boolean;
		execution: Awaited<
			ReturnType<NonNullable<CheckoutRepository["classExecutions"]>["get"]>
		>;
	},
) {
	if (params.wasRetryable) {
		return runStorefrontCheckout(
			{ ...ctx.deps, failureLogger: ctx.failureLogger, now: ctx.now },
			{
				organizationId: params.intent.organizationId,
				intentId: params.intent.id,
				correlationId: params.intent.correlationId,
				shopifyCartId: params.shopifyCartId,
				binding: params.binding,
			},
		);
	}
	return runReplayCheckoutWithTimeout(buildReplayDeps(ctx), {
		organizationId: params.intent.organizationId,
		intentId: params.intent.id,
		shopifyCartId: params.shopifyCartId,
		binding: params.binding,
		execution: params.execution,
	});
}

export async function resumeReadyCheckout(
	ctx: ExecutionRuntimeCtx,
	params: {
		intent: CheckoutIntentRecord;
		shopifyCartId: string;
		shopifyCustomerGid: string | null;
	},
): Promise<ClassCheckoutResult> {
	const { intent, shopifyCartId, shopifyCustomerGid } = params;
	const integration = await ctx.deps.organizations.getShopifyIntegration(
		intent.organizationId,
	);
	const binding = resolveStorefrontBinding(integration);
	const executions = ctx.deps.checkout.classExecutions;
	let execution = executions
		? await executions.get(intent.organizationId, intent.id)
		: null;
	const wasRetryable = execution?.state === "retryable";
	if (
		execution &&
		(execution.storefrontBinding === null ||
			!sameStorefrontBinding(execution.storefrontBinding, binding))
	) {
		execution = await verifyLegacyCartEvidence(buildReplayDeps(ctx), {
			intent,
			shopifyCartId,
			shopifyCustomerGid,
			binding,
			execution,
		});
	}
	const checkout = await fetchReplayCheckoutUrl(ctx, {
		intent,
		shopifyCartId,
		binding: execution?.storefrontBinding ?? binding,
		wasRetryable,
		execution,
	});
	await assertReplayNotWithheldOrBlocked(ctx, {
		intent,
		initialExecution: execution,
	});
	return {
		checkoutUrl: checkout.checkoutUrl,
		intentId: intent.id,
		correlationId: intent.correlationId,
		intent,
	};
}

async function assertReplayNotWithheldOrBlocked(
	ctx: ExecutionRuntimeCtx,
	params: {
		intent: CheckoutIntentRecord;
		initialExecution: Awaited<
			ReturnType<NonNullable<CheckoutRepository["classExecutions"]>["get"]>
		>;
	},
): Promise<void> {
	const withheld = await evaluatePostLookupReplayState(
		buildReplayDeps(ctx),
		params,
	);
	if (withheld) {
		throw new AppError(
			"Checkout has already been completed.",
			409,
			withheld.withheldReason.reasonCode,
		);
	}
	const executions = ctx.deps.checkout.classExecutions;
	if (
		executions &&
		(await executions.isUnissuedCartReplacementBlocked({
			organizationId: params.intent.organizationId,
			customerId: params.intent.customerId,
			replacementKey: params.intent.idempotencyKey,
		}))
	) {
		throw new AppError(
			"A payment has already been observed for the replaced checkout attempt.",
			409,
			"checkout_restart_payment_uncertain",
		);
	}
}

async function throwOutcomeError(
	executions: NonNullable<CheckoutRepository["classExecutions"]> | undefined,
	input: StartClassCheckoutInput,
	outcome: Exclude<CheckoutIntentOutcome, { kind: "created" | "ready" }>,
): Promise<never> {
	if (outcome.kind === "in_progress") {
		if (executions) {
			const blocking = await executions.findBlocking(
				input.organizationId,
				input.customerId,
			);
			if (blocking) {
				throw new ClassCheckoutRecoveryRequiredError(
					blocking,
					blocking.fingerprint === classCheckoutRequestFingerprint(input),
				);
			}
		}
		throw new AppError(
			"Checkout is currently in progress.",
			409,
			"checkout_in_progress",
		);
	}
	if (outcome.kind === "active") {
		throw new AppError(
			"Checkout has already been started for this request.",
			409,
			"checkout_already_started",
		);
	}
	if (outcome.kind === "expired") {
		throw new AppError(
			"Checkout attempt has expired.",
			409,
			"checkout_expired",
		);
	}
	throw new AppError(
		"Previous checkout attempt failed.",
		409,
		"checkout_terminal_failure",
	);
}

async function resolveRetryableOutcome(
	ctx: ExecutionRuntimeCtx,
	executeClaimed: ClaimedCheckoutExecutor,
	params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		shopifyCustomerGid: string | null;
		validatedLines?: ValidatedClassLineData[];
		festivalId?: string;
		windowCtx?: WindowCtx;
	},
): Promise<ClassCheckoutResult> {
	if (!params.validatedLines || !params.festivalId) {
		const lineInputs = normalizeClassCheckoutLineInputs(params.input);
		const prepared = await validateAndPrepareClassLines(
			{ ...ctx.deps, now: ctx.now },
			params.input,
			lineInputs,
		);
		return executeClaimed(ctx, {
			input: params.input,
			intent: params.intent,
			validatedLines: prepared.validatedLines,
			shopifyCustomerGid: params.shopifyCustomerGid,
			festivalId: prepared.festivalId,
			windowCtx: {
				festival: prepared.festival,
				timezone: prepared.timezone,
				subtypes: prepared.subtypes,
			},
		});
	}
	return executeClaimed(ctx, {
		input: params.input,
		intent: params.intent,
		validatedLines: params.validatedLines,
		shopifyCustomerGid: params.shopifyCustomerGid,
		festivalId: params.festivalId,
		windowCtx: params.windowCtx,
	});
}

export interface ResolveOutcomeParams {
	input: StartClassCheckoutInput;
	outcome: Exclude<CheckoutIntentOutcome, { kind: "created" }>;
	shopifyCustomerGid: string | null;
	validatedLines?: ValidatedClassLineData[];
	festivalId?: string;
	windowCtx?: WindowCtx;
}

async function resolveManagedExecutionOutcome(
	ctx: ExecutionRuntimeCtx,
	executeClaimed: ClaimedCheckoutExecutor,
	params: ResolveOutcomeParams & { intent: CheckoutIntentRecord },
): Promise<ClassCheckoutResult | null> {
	const executions = ctx.deps.checkout.classExecutions;
	if (!executions) return null;
	let record = await executions.get(
		params.input.organizationId,
		params.intent.id,
	);
	if (record?.state === "running") {
		await executions.reapExpired(params.input.organizationId, params.intent.id);
		record = await executions.get(
			params.input.organizationId,
			params.intent.id,
		);
	}
	if (!record) return null;
	const fingerprint = classCheckoutRequestFingerprint(params.input);
	if (
		record.fingerprint !== fingerprint ||
		resolvedCheckoutStatus(params.intent.status, record) ||
		record.state === "recovery_required" ||
		record.state === "running"
	) {
		await throwManagedExecutionGuard(
			executions,
			params.intent,
			record,
			fingerprint,
		);
	}
	if (params.outcome.kind === "ready") {
		return resumeReadyCheckout(ctx, {
			intent: params.intent,
			shopifyCartId: params.outcome.cart.shopifyCartId,
			shopifyCustomerGid: params.shopifyCustomerGid,
		});
	}
	if (record.state === "retryable" || record.state === "ready") {
		return resolveRetryableOutcome(ctx, executeClaimed, params);
	}
	return null;
}

export async function resolveNonCreatedOutcome(
	ctx: ExecutionRuntimeCtx,
	executeClaimed: ClaimedCheckoutExecutor,
	params: ResolveOutcomeParams,
): Promise<ClassCheckoutResult> {
	const { input, outcome, shopifyCustomerGid } = params;
	const executions = ctx.deps.checkout.classExecutions;
	const intent =
		outcome.kind === "ready"
			? outcome.intent
			: ctx.deps.checkout.findIntentByKey
				? await ctx.deps.checkout.findIntentByKey(input)
				: null;
	if (intent) {
		assertCheckoutIntentType(intent, "class_entry");
		const handled = await resolveManagedExecutionOutcome(ctx, executeClaimed, {
			...params,
			intent,
		});
		if (handled) return handled;
	}
	if (outcome.kind === "ready") {
		return resumeReadyCheckout(ctx, {
			intent: outcome.intent,
			shopifyCartId: outcome.cart.shopifyCartId,
			shopifyCustomerGid,
		});
	}
	return throwOutcomeError(executions, input, outcome);
}
