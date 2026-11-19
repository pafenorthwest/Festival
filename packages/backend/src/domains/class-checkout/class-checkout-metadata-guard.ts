import { randomUUID } from "node:crypto";
import {
	AppError,
	type FestivalRecord,
	isFestivalRegistrationOpen,
	type RegistrationCatalogValue,
} from "@festival/common";
import type { ClassCheckoutClaim } from "./checkout-execution-types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-types.js";
import type {
	ClassCheckoutFailureLogger,
	StartClassCheckoutInput,
} from "./class-checkout-errors.js";
import type { ValidatedClassLineData } from "./class-checkout-line-runner.js";
import {
	buildEligibilityRejectionError,
	type ClassEligibilityService,
} from "./class-eligibility-service.js";
import type { ClassCheckoutEventBus } from "./events.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
	CheckoutRepertoireReadPort,
	CheckoutTeacherDirectoryPort,
	ClassCheckoutStorefrontPort,
} from "./ports.js";

export interface ClassCheckoutExecutionServiceDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	teachers: CheckoutTeacherDirectoryPort;
	checkout: CheckoutRepository;
	storefront: ClassCheckoutStorefrontPort;
	commerce?: CheckoutCommerceReadPort;
	repertoire?: CheckoutRepertoireReadPort;
	eventBus?: ClassCheckoutEventBus;
	now?: () => Date;
	failureLogger?: ClassCheckoutFailureLogger;
}

export interface ExecutionRuntimeCtx {
	deps: ClassCheckoutExecutionServiceDeps;
	eligibility: ClassEligibilityService;
	now: () => Date;
	failureLogger: ClassCheckoutFailureLogger;
}

export async function validateSessionAndCustomer(
	ctx: ExecutionRuntimeCtx,
	input: StartClassCheckoutInput,
) {
	const session =
		ctx.deps.customers.getSession.length >= 2
			? await ctx.deps.customers.getSession(
					input.organizationId,
					input.sessionId,
				)
			: await (
					ctx.deps.customers.getSession as (
						s: string,
					) => Promise<
						Awaited<ReturnType<CheckoutCustomerIdentityPort["getSession"]>>
					>
				).call(ctx.deps.customers, input.sessionId);
	const nowMs = ctx.now().getTime();
	if (
		!session ||
		session.organizationId !== input.organizationId ||
		session.customerId !== input.customerId ||
		session.revokedAtIso ||
		(session.expiresAtIso && Date.parse(session.expiresAtIso) <= nowMs) ||
		(session.idleExpiresAtIso &&
			Date.parse(session.idleExpiresAtIso) <= nowMs) ||
		(session.absoluteExpiresAtIso &&
			Date.parse(session.absoluteExpiresAtIso) <= nowMs)
	) {
		throw new AppError("Customer session is invalid or expired.", 401);
	}
	const customer = await ctx.deps.customers.getCustomer(
		input.organizationId,
		input.customerId,
	);
	if (!customer) throw new AppError("Customer account not found.", 404);
	return customer;
}

export async function assertCartEligibility(
	ctx: ExecutionRuntimeCtx,
	params: {
		input: StartClassCheckoutInput;
		festivalId: string;
		validatedLines: ValidatedClassLineData[];
		subtypes?: RegistrationCatalogValue[];
	},
): Promise<void> {
	const evalResult = await ctx.eligibility.evaluateEligibility(
		{
			organizationId: params.input.organizationId,
			customerId: params.input.customerId,
			festivalId: params.festivalId,
			items: params.validatedLines.map((line) => ({
				childId: line.child.id,
				festivalClassId: line.festivalClass.id,
			})),
			mode: "cart",
		},
		{
			classes: params.validatedLines.map((l) => l.festivalClass),
			...(params.subtypes ? { subtypes: params.subtypes } : {}),
		},
	);
	if (!evalResult.isEligible) {
		throw buildEligibilityRejectionError(evalResult.results);
	}
}

export async function releasePreparedRetryable(
	ctx: ExecutionRuntimeCtx,
	claim?: ClassCheckoutClaim,
): Promise<void> {
	if (!claim || !ctx.deps.checkout.classExecutions) return;
	await ctx.deps.checkout.classExecutions.transition({
		claim,
		checkpoint: "prepared",
		state: "retryable",
		storefrontBinding: null,
		releaseLease: true,
		eventType: "pre_dispatch_retryable_failure",
	});
}

function extractPostgresErrorMeta(error: unknown): {
	isDatabaseError: boolean;
	errorName: string;
	errorCode?: string;
	sqlState?: string;
} {
	if (!(error instanceof Error)) {
		return { isDatabaseError: false, errorName: typeof error };
	}
	const errObj = error as Error & {
		code?: unknown;
		errno?: unknown;
		sqlState?: unknown;
	};
	const errorCode =
		typeof errObj.code === "string" && errObj.code ? errObj.code : undefined;
	const rawState =
		typeof errObj.sqlState === "string" && errObj.sqlState
			? errObj.sqlState
			: typeof errObj.errno === "string" && errObj.errno
				? errObj.errno
				: undefined;
	const isDatabaseError =
		error.name === "PostgresError" ||
		Boolean(rawState) ||
		Boolean(errorCode?.startsWith("ERR_POSTGRES"));
	return {
		isDatabaseError,
		errorName: error.name || "Error",
		errorCode,
		sqlState: rawState,
	};
}

async function handleMetadataInsertError(
	ctx: ExecutionRuntimeCtx,
	params: {
		organizationId: string;
		intent: CheckoutIntentRecord;
		lineCount: number;
		claim?: ClassCheckoutClaim;
	},
	error: unknown,
): Promise<never> {
	const executions = ctx.deps.checkout.classExecutions;
	if (error instanceof AppError && error.status >= 400 && error.status < 500) {
		if (params.claim && executions) {
			await executions.transition({
				claim: params.claim,
				checkpoint: "prepared",
				state: "rejected",
				storefrontBinding: null,
				resultCode: error.code ?? "checkout_pre_dispatch_rejected",
				releaseLease: true,
				eventType: "pre_dispatch_rejected",
			});
		}
		throw error;
	}
	await releasePreparedRetryable(ctx, params.claim);
	const meta = extractPostgresErrorMeta(error);
	if (meta.isDatabaseError) {
		ctx.failureLogger.error("Class checkout failed.", {
			operation: "checkout.class",
			stage: "registration_metadata",
			organizationId: params.organizationId,
			checkoutIntentId: params.intent.id,
			correlationId: params.intent.correlationId,
			lineCount: params.lineCount,
			errorName: meta.errorName,
			...(meta.errorCode ? { errorCode: meta.errorCode } : {}),
			...(meta.sqlState ? { databaseSqlState: meta.sqlState } : {}),
		});
		throw new AppError(
			"We couldn't save this class registration. Please try again.",
			500,
			"checkout_database_failure",
		);
	}
	throw new AppError(
		"Failed to prepare class registration metadata.",
		503,
		"checkout_retryable_upstream",
	);
}

export interface FinalWindowGuardParams {
	input: StartClassCheckoutInput;
	intent: CheckoutIntentRecord;
	validatedLines: ValidatedClassLineData[];
	festivalId: string;
	claim?: ClassCheckoutClaim;
	windowCtx?: {
		festival?: FestivalRecord;
		timezone?: string;
		subtypes?: RegistrationCatalogValue[];
	};
}

async function assertFinalRegistrationWindow(
	ctx: ExecutionRuntimeCtx,
	params: FinalWindowGuardParams,
): Promise<void> {
	const executions = ctx.deps.checkout.classExecutions;
	try {
		if (params.windowCtx?.festival && params.windowCtx.timezone) {
			if (
				!isFestivalRegistrationOpen(
					params.windowCtx.festival,
					ctx.now(),
					params.windowCtx.timezone,
				)
			) {
				throw buildEligibilityRejectionError(
					params.validatedLines.map((line) => ({
						childId: line.child.id,
						festivalClassId: line.festivalClass.id,
						isEligible: false,
						reasonCode: "REGISTRATION_CLOSED",
						message: "Registration is closed for this festival.",
					})),
				);
			}
		} else {
			await assertCartEligibility(ctx, {
				input: params.input,
				festivalId: params.festivalId,
				validatedLines: params.validatedLines,
				subtypes: params.windowCtx?.subtypes,
			});
		}
	} catch (error) {
		if (params.claim && executions) {
			await executions.transition({
				claim: params.claim,
				checkpoint: "prepared",
				state: "rejected",
				storefrontBinding: null,
				resultCode:
					error instanceof AppError && error.code
						? error.code
						: "registration_closed",
				releaseLease: true,
				eventType: "pre_dispatch_rejected",
			});
		}
		await ctx.deps.checkout.markFailed(params.intent.id);
		throw error;
	}
}

export async function persistMetadataAndFinalWindowGuard(
	ctx: ExecutionRuntimeCtx,
	params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		validatedLines: ValidatedClassLineData[];
		festivalId: string;
		claim?: ClassCheckoutClaim;
		windowCtx?: {
			festival?: FestivalRecord;
			timezone?: string;
			subtypes?: RegistrationCatalogValue[];
		};
	},
): Promise<void> {
	try {
		for (let i = 0; i < params.validatedLines.length; i += 1) {
			const line = params.validatedLines[i];
			await ctx.deps.checkout.insertRegistrationMetadata({
				id: randomUUID(),
				organizationId: params.input.organizationId,
				festivalId: line.festivalClass.festivalId,
				checkoutIntentId: params.intent.id,
				checkoutIntentLineId: params.intent.lines?.[i]?.id ?? null,
				teacherMembershipId: line.teacherMembershipId,
				accompanistMembershipId: line.accompanistMembershipId,
				repertoireJson: line.pieces,
				repertoireSnapshotPieces: line.pieces,
				registrationSnapshot: line.registrationSnapshot,
			});
		}
	} catch (error) {
		return handleMetadataInsertError(
			ctx,
			{
				organizationId: params.input.organizationId,
				intent: params.intent,
				lineCount: params.validatedLines.length,
				claim: params.claim,
			},
			error,
		);
	}
	await assertFinalRegistrationWindow(ctx, params);
}

export function emitCheckoutEvents(
	ctx: ExecutionRuntimeCtx,
	params: {
		organizationId: string;
		customerId: string;
		checkoutIntentId: string;
		validatedLines: ValidatedClassLineData[];
	},
): void {
	ctx.deps.eventBus?.emit({
		type: "CheckoutIntentResolved",
		organizationId: params.organizationId,
		customerId: params.customerId,
		checkoutIntentId: params.checkoutIntentId,
	});
	for (const line of params.validatedLines) {
		ctx.deps.eventBus?.emit({
			type: "ClassCapacityChanged",
			organizationId: params.organizationId,
			festivalId: line.festivalClass.festivalId,
			festivalClassId: line.festivalClass.id,
		});
	}
}
