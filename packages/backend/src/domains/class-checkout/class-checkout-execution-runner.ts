import { randomUUID } from "node:crypto";
import { AppError } from "@festival/common";
import type {
	ClassCheckoutClaim,
	ClassCheckoutExecution,
	ClassCheckoutStorefrontBinding,
} from "./checkout-execution-types.js";
import { requireClassCheckoutIntentLineMapping } from "./checkout-line-helpers.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import {
	attachCartAndStartCheckout,
	buildMultiLineCapacityCheck,
	createShopifyCartForIntent,
	resolveStorefrontBinding,
	sameStorefrontBinding,
} from "./class-checkout-cart-handoff.js";
import {
	ClassCheckoutPersistenceUnavailableError,
	ClassCheckoutRecoveryRequiredError,
	normalizeClassCheckoutLineInputs,
	type StartClassCheckoutInput,
} from "./class-checkout-errors.js";
import {
	createClassCheckoutIntent,
	type ValidatedClassLineData,
	validateAndPrepareClassLines,
} from "./class-checkout-line-runner.js";
import {
	assertCartEligibility,
	type ExecutionRuntimeCtx,
	emitCheckoutEvents,
	persistMetadataAndFinalWindowGuard,
	releasePreparedRetryable,
	validateSessionAndCustomer,
} from "./class-checkout-metadata-guard.js";
import { verifyLegacyCartEvidence } from "./class-checkout-replay-helpers.js";
import {
	type ClassCheckoutResult,
	resolveNonCreatedOutcome,
	type WindowCtx,
} from "./class-checkout-resume-runner.js";

export type { ClassCheckoutResult };

async function claimExecutionIfSupported(
	ctx: ExecutionRuntimeCtx,
	organizationId: string,
	intentId: string,
): Promise<{
	claim?: ClassCheckoutClaim;
	knownCartId: string | null;
	execution: ClassCheckoutExecution | null;
}> {
	if (!ctx.deps.checkout.classExecutions) {
		return { claim: undefined, knownCartId: null, execution: null };
	}
	const owner = `worker_${randomUUID()}`;
	const claimed = await ctx.deps.checkout.classExecutions.claim({
		organizationId,
		intentId,
		owner,
	});
	if (!claimed) {
		const blocking = await ctx.deps.checkout.classExecutions.get(
			organizationId,
			intentId,
		);
		if (blocking) throw new ClassCheckoutRecoveryRequiredError(blocking, true);
		throw new AppError("Checkout is already being processed.", 409);
	}
	return {
		claim: {
			organizationId: claimed.organizationId,
			intentId: claimed.intentId,
			owner,
			generation: claimed.generation,
		},
		knownCartId: claimed.shopifyCartId,
		execution: claimed,
	};
}

async function rejectExpiredClaimIfNeeded(
	executions: NonNullable<CheckoutRepository["classExecutions"]> | undefined,
	params: {
		claim?: ClassCheckoutClaim;
		execution: ClassCheckoutExecution | null;
		intent: CheckoutIntentRecord;
		nowMs: number;
	},
): Promise<void> {
	if (
		!params.claim ||
		!executions ||
		(params.execution && params.execution.checkpoint !== "prepared") ||
		Date.parse(params.intent.expiresAtIso) > params.nowMs
	) {
		return;
	}
	try {
		const ok = await executions.transition({
			claim: params.claim,
			checkpoint: "prepared",
			state: "rejected",
			storefrontBinding: null,
			resultCode: "checkout_expired",
			releaseLease: true,
			eventType: "pre_dispatch_expired",
		});
		if (!ok) throw new ClassCheckoutPersistenceUnavailableError();
	} catch (err) {
		if (err instanceof AppError) throw err;
		throw new ClassCheckoutPersistenceUnavailableError();
	}
	throw new AppError(
		"Checkout attempt expired before dispatch.",
		409,
		"checkout_pre_dispatch_rejected",
	);
}

async function verifyLineMappingAndBinding(
	ctx: ExecutionRuntimeCtx,
	params: {
		organizationId: string;
		intent: CheckoutIntentRecord;
		shopifyCustomerGid: string | null;
		expectedLineSpecs: Array<{
			festivalClassId: string;
			childId: string;
			shopifyProductGid: string;
			shopifyVariantGid: string;
			amount: string;
			currencyCode: string;
		}>;
		knownCartId: string | null;
		claim?: ClassCheckoutClaim;
		execution: ClassCheckoutExecution | null;
	},
): Promise<ClassCheckoutStorefrontBinding> {
	if (!params.knownCartId) {
		try {
			requireClassCheckoutIntentLineMapping(
				params.intent,
				params.expectedLineSpecs,
			);
		} catch {
			await releasePreparedRetryable(ctx, params.claim);
			throw new AppError(
				"Checkout intent line persistence is incomplete.",
				503,
				"checkout_retryable_upstream",
			);
		}
	}
	let binding: ClassCheckoutStorefrontBinding;
	try {
		binding = resolveStorefrontBinding(
			await ctx.deps.organizations.getShopifyIntegration(params.organizationId),
		);
	} catch (error) {
		await releasePreparedRetryable(ctx, params.claim);
		throw error;
	}
	if (
		params.claim &&
		params.execution &&
		params.knownCartId &&
		params.execution.storefrontBinding === null
	) {
		await verifyLegacyCartAndBinding(ctx, {
			intent: params.intent,
			knownCartId: params.knownCartId,
			shopifyCustomerGid: params.shopifyCustomerGid,
			binding,
			execution: params.execution,
			claim: params.claim,
		});
	}
	return binding;
}

async function verifyLegacyCartAndBinding(
	ctx: ExecutionRuntimeCtx,
	params: {
		intent: CheckoutIntentRecord;
		knownCartId: string;
		shopifyCustomerGid: string | null;
		binding: ClassCheckoutStorefrontBinding;
		execution: ClassCheckoutExecution;
		claim: ClassCheckoutClaim;
	},
): Promise<void> {
	await verifyLegacyCartEvidence(
		{
			organizations: ctx.deps.organizations,
			checkout: ctx.deps.checkout,
			storefront: ctx.deps.storefront,
			now: ctx.now,
			resolveBinding: resolveStorefrontBinding,
			sameBinding: sameStorefrontBinding,
		},
		{
			intent: params.intent,
			shopifyCartId: params.knownCartId,
			shopifyCustomerGid: params.shopifyCustomerGid,
			binding: params.binding,
			execution: params.execution,
			claim: params.claim,
		},
	);
	await ctx.deps.checkout.classExecutions?.transition({
		claim: params.claim,
		checkpoint: params.execution.checkpoint,
		storefrontBinding: params.binding,
		eventType: "storefront_verified",
	});
}

function buildExpectedLineSpecs(validatedLines: ValidatedClassLineData[]) {
	return validatedLines.map((l) => ({
		festivalClassId: l.festivalClass.id,
		childId: l.child.id,
		shopifyProductGid: l.festivalClass.shopifyProductGid,
		shopifyVariantGid: l.festivalClass.shopifyVariantGid,
		amount: l.festivalClass.price,
		currencyCode: l.currencyCode,
	}));
}

async function resolveOrCreateCartAndCheckoutUrl(
	ctx: ExecutionRuntimeCtx,
	params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		validatedLines: ValidatedClassLineData[];
		shopifyCustomerGid: string | null;
		festivalId: string;
		windowCtx?: WindowCtx;
		expectedLineSpecs: ReturnType<typeof buildExpectedLineSpecs>;
		binding: ClassCheckoutStorefrontBinding;
		knownCartId: string | null;
		claim?: ClassCheckoutClaim;
	},
): Promise<string> {
	const handoffDeps = {
		...ctx.deps,
		failureLogger: ctx.failureLogger,
		now: ctx.now,
	};
	if (!params.knownCartId) {
		await persistMetadataAndFinalWindowGuard(ctx, {
			input: params.input,
			intent: params.intent,
			validatedLines: params.validatedLines,
			festivalId: params.festivalId,
			claim: params.claim,
			windowCtx: params.windowCtx,
		});
	}
	const shopifyCartId =
		params.knownCartId ??
		(
			await createShopifyCartForIntent(handoffDeps, {
				organizationId: params.input.organizationId,
				customerId: params.input.customerId,
				buyerAccessToken: params.input.buyerAccessToken,
				shopifyCustomerGid: params.shopifyCustomerGid,
				intent: params.intent,
				expectedLineSpecs: params.expectedLineSpecs,
				binding: params.binding,
				claim: params.claim,
			})
		).shopifyCartId;
	const { checkoutUrl } = await attachCartAndStartCheckout(handoffDeps, {
		intent: params.intent,
		shopifyCartId,
		binding: params.binding,
		capacityCheck: buildMultiLineCapacityCheck(
			ctx.deps,
			params.input.organizationId,
			params.validatedLines,
		),
		claim: params.claim,
	});
	return checkoutUrl;
}

export interface ExecuteClaimedParams {
	input: StartClassCheckoutInput;
	intent: CheckoutIntentRecord;
	validatedLines: ValidatedClassLineData[];
	shopifyCustomerGid: string | null;
	festivalId: string;
	windowCtx?: WindowCtx;
}

export async function executeClaimedCheckout(
	ctx: ExecutionRuntimeCtx,
	params: ExecuteClaimedParams,
): Promise<ClassCheckoutResult> {
	const { input, intent, validatedLines, shopifyCustomerGid } = params;
	const { claim, knownCartId, execution } = await claimExecutionIfSupported(
		ctx,
		input.organizationId,
		intent.id,
	);
	const executions = ctx.deps.checkout.classExecutions;
	await rejectExpiredClaimIfNeeded(executions, {
		claim,
		execution,
		intent,
		nowMs: ctx.now().getTime(),
	});
	const expectedLineSpecs = buildExpectedLineSpecs(validatedLines);
	const binding = await verifyLineMappingAndBinding(ctx, {
		organizationId: input.organizationId,
		intent,
		shopifyCustomerGid,
		expectedLineSpecs,
		knownCartId,
		claim,
		execution,
	});
	const checkoutUrl = await resolveOrCreateCartAndCheckoutUrl(ctx, {
		...params,
		expectedLineSpecs,
		binding,
		knownCartId,
		claim,
	});
	if (
		executions &&
		(await executions.isUnissuedCartReplacementBlocked({
			organizationId: input.organizationId,
			customerId: input.customerId,
			replacementKey: input.idempotencyKey,
		}))
	) {
		throw new AppError(
			"A payment has already been observed for the replaced checkout attempt.",
			409,
			"checkout_restart_payment_uncertain",
		);
	}
	emitCheckoutEvents(ctx, {
		organizationId: input.organizationId,
		customerId: input.customerId,
		checkoutIntentId: intent.id,
		validatedLines,
	});
	return {
		checkoutUrl,
		intentId: intent.id,
		correlationId: intent.correlationId,
		intent,
	};
}

async function checkExistingStartOutcome(
	ctx: ExecutionRuntimeCtx,
	input: StartClassCheckoutInput,
	shopifyCustomerGid: string | null,
): Promise<ClassCheckoutResult | null> {
	const executions = ctx.deps.checkout.classExecutions;
	const existingIntent = ctx.deps.checkout.findIntentByKey
		? await ctx.deps.checkout.findIntentByKey(input)
		: null;
	const existingExec =
		existingIntent && executions
			? await executions.get(input.organizationId, existingIntent.id)
			: null;
	const skipPreOutcome =
		existingExec?.checkpoint === "prepared" &&
		existingExec.state === "retryable";
	if (!skipPreOutcome) {
		const preOutcome = await ctx.deps.checkout.getOutcome(input);
		if (preOutcome) {
			return resolveNonCreatedOutcome(ctx, executeClaimedCheckout, {
				input,
				outcome: preOutcome,
				shopifyCustomerGid,
			});
		}
	}
	if (
		!existingIntent &&
		(await ctx.deps.checkout.hasProcessingIntent(
			input.organizationId,
			input.customerId,
			ctx.now().toISOString(),
			"class_entry",
		))
	) {
		throw new AppError(
			"Another checkout is currently in progress.",
			409,
			"checkout_in_progress",
		);
	}
	return null;
}

export async function startClassCheckout(
	ctx: ExecutionRuntimeCtx,
	input: StartClassCheckoutInput,
	preflightRecovery: (input: StartClassCheckoutInput) => Promise<void>,
): Promise<ClassCheckoutResult> {
	const customer = await validateSessionAndCustomer(ctx, input);
	await preflightRecovery(input);
	const early = await checkExistingStartOutcome(
		ctx,
		input,
		customer.shopifyCustomerGid,
	);
	if (early) return early;
	const lineInputs = normalizeClassCheckoutLineInputs(input);
	if (lineInputs.length === 0) {
		throw new AppError("Class checkout requires at least one line item.", 400);
	}
	const { festival, festivalId, timezone, subtypes, validatedLines } =
		await validateAndPrepareClassLines(
			{ ...ctx.deps, now: ctx.now },
			input,
			lineInputs,
		);
	await assertCartEligibility(ctx, {
		input,
		festivalId,
		validatedLines,
		subtypes,
	});
	const outcome = await createClassCheckoutIntent(
		ctx.deps.checkout,
		input,
		validatedLines,
		ctx.now(),
	);
	if (outcome.kind !== "created") {
		return resolveNonCreatedOutcome(ctx, executeClaimedCheckout, {
			input,
			outcome,
			shopifyCustomerGid: customer.shopifyCustomerGid,
			validatedLines,
			festivalId,
			windowCtx: { festival, timezone, subtypes },
		});
	}
	return executeClaimedCheckout(ctx, {
		input,
		intent: outcome.intent,
		validatedLines,
		shopifyCustomerGid: customer.shopifyCustomerGid,
		festivalId,
		windowCtx: { festival, timezone, subtypes },
	});
}
