import { randomUUID } from "node:crypto";
import type {
	AccompanistMembershipGrant,
	CanonicalWork,
	ClassCheckoutLineItemInput,
	ClassCheckoutRestartDto,
	ClassCheckoutRestartRegistration,
	ClassEligibilityResult,
	ClassEntitlement,
	ClassRegistrationSnapshot,
	EntitlementGrantSnapshot,
	EvaluatePurchaseEligibilityResponse,
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
	FestivalClassConfiguration,
	FestivalRecord,
	ProposedPurchaseLineItem,
	PurchaseEligibilityMode,
	RegistrationCatalogValue,
	RepertoirePiece,
} from "@festival/common";
import {
	doesClassRequireConcerto,
	evaluatePurchaseEligibility,
	isFestivalRegistrationOpen,
	stripCandidateMarker,
} from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { AppError } from "../errors/app-error.js";
import type { RepertoireRepository } from "../repertoire/repertoire-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
	type ExpectedClassCheckoutIntentLine,
	requireClassCheckoutIntentLineMapping,
} from "./checkout-line-helpers.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentLineItemRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutIntentStatus,
	CheckoutRepository,
	CreateCheckoutIntentLineInput,
} from "./checkout-repository.js";
import {
	assertCheckoutIntentType,
	CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
} from "./checkout-repository.js";
import {
	assertExecutionFingerprint,
	type ClassCheckoutExecution,
	type ClassCheckoutExecutionRepository,
	type ClassCheckoutStorefrontBinding,
	isLegacyInvalidCartObservation,
	type TransitionClassCheckoutExecution,
} from "./class-checkout-execution.js";
import {
	ClassCheckoutPersistenceUnavailableError,
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutRecoveryStatus,
	classCheckoutRequestFingerprint,
	classCheckoutRequestSnapshot,
	type ManagedClassCheckoutExecution,
	recoveryStatusFor,
} from "./class-checkout-recovery.js";

export { ClassCheckoutRecoveryRequiredError } from "./class-checkout-recovery.js";

import {
	buildEligibilityRejectionError,
	calculateTotalAmount,
	resolveFestivalClassConfiguration,
	resolvePieceCatalogWorks,
	resolveTargetFestival,
	validateAccompanistSelection,
	validateActiveChildAgeSnapshot,
	validateAndNormalizeRepertoirePieces,
	validateChildAgeRange,
	validateChildOwnership,
	validateTeacherEntitlement,
	verifyPostCartCreateCapacityCutoff,
} from "./class-checkout-helpers.js";

export interface ClassCheckoutStorefront {
	inspectCart?(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
	}): Promise<{
		correlationId: string | null;
		customerGid: string | null;
		lines: Array<{
			intentLineId: string | null;
			variantGid: string;
			quantity: number;
		}>;
	}>;
	createCart(input: {
		organizationId: string;
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
		shopifyVariantGid?: string;
		buyerAccessToken: string;
		correlationId: string;
		currencyCode?: string;
		lines?: Array<{
			merchandiseId: string;
			quantity: number;
			attributes?: Array<{ key: string; value: string }>;
		}>;
	}): Promise<{ shopifyCartId: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
		expectedStorefrontBinding?: ClassCheckoutStorefrontBinding;
		signal?: AbortSignal;
	}): Promise<{ checkoutUrl: string }>;
}

const CHECKOUT_REPLAY_TIMEOUT_MS = 3_000;

class ClassCheckoutReplayResolvedError extends AppError {
	constructor(readonly recovery: ClassCheckoutRecoveryStatus) {
		super("This checkout has already been resolved.", 409, recovery.reasonCode);
	}
}

function resolvedCheckoutStatus(
	intentStatus: CheckoutIntentStatus,
	record: ClassCheckoutExecution,
): ClassCheckoutRecoveryStatus | undefined {
	const status = recoveryStatusFor(record);
	if (intentStatus === "needs_review" && record.state === "recovery_required")
		return { ...status, retryAllowed: false };
	if (
		!["approved", "rejected", "needs_review", "superseded"].includes(
			intentStatus,
		)
	)
		return;
	return {
		...status,
		status: "resolved",
		retryAllowed: false,
		reasonCode:
			record.resultCode === "abandoned_unknown" ||
			record.resultCode === "checkout_abandoned"
				? record.resultCode
				: intentStatus === "approved"
					? "checkout_already_completed"
					: "checkout_closed",
	};
}

/** Provider observation retained server-side even when the returned cart is invalid. */
export class ClassCheckoutCartObservationError extends AppError {
	constructor(readonly observedShopifyCartId: string) {
		super("Shopify checkout is temporarily unavailable.", 503);
	}
}

export class ClassCheckoutStorefrontChangedBeforeRequestError extends AppError {
	constructor() {
		super(
			"Shopify Storefront configuration changed before the request.",
			503,
			"checkout_storefront_binding_changed",
		);
	}
}

export interface StartClassCheckoutInput {
	organizationId: string;
	festivalId?: string;
	festivalShortName?: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	festivalClassId?: string;
	childId?: string;
	divisionId?: string;
	buyerAccessToken: string;
	integrationVersion?: string | number;
	teacherId?: string;
	accompanistId?: string | null;
	instrumentId?: string;
	pieces?: RepertoirePiece[];
	lineItems?: ClassCheckoutLineItemInput[];
}

export interface EvaluatePurchaseEligibilityInput {
	organizationId: string;
	customerId: string;
	festivalId?: string;
	festivalShortName?: string;
	items: ProposedPurchaseLineItem[];
	mode?: PurchaseEligibilityMode;
}

export interface ClassCheckoutResult {
	checkoutUrl: string;
	intentId: string;
	correlationId: string;
	intent?: CheckoutIntentRecord;
}

interface ValidatedLineItem {
	child: FestivalChildRecord;
	classConfig: FestivalClassConfiguration;
	normalizedPieces: RepertoirePiece[];
	teacherEntitlementId: string;
	accompanistEntitlementId: string | null;
	registrationSnapshot?: ClassRegistrationSnapshot;
	instrument: ClassRegistrationSnapshot["instrument"];
}

interface LineValidationCaches {
	children: Map<string, FestivalChildRecord | null>;
	ageSnapshots: Map<string, FestivalChildAgeSnapshot | null>;
	classConfigs: Map<string, FestivalClassConfiguration>;
	teacherGrants: Map<string, EntitlementGrantSnapshot | null>;
	accompanistGrants: Map<string, AccompanistMembershipGrant | null>;
	instruments?: RegistrationCatalogValue[];
	subtypes?: RegistrationCatalogValue[];
	catalogWorks?: Map<string, CanonicalWork | null>;
}

interface EligibilityLookups {
	targetFestival?: FestivalRecord;
	children?: Map<string, FestivalChildRecord | null>;
	classes?: Map<string, FestivalClassConfiguration>;
	subtypes?: RegistrationCatalogValue[];
	timezone?: string;
}

export type ClassCheckoutFailureStage =
	| "registration_metadata"
	| "registration_window"
	| "load_integration"
	| "create_cart"
	| "attach_cart"
	| "mark_checkout_started"
	| "checkout_url"
	| "verify_checkout_url"
	| "mark_failed"
	| "resume_load_integration"
	| "resume_mark_checkout_started"
	| "resume_checkout_url"
	| "resume_verify_checkout_url"
	| "resume_mark_failed";

export interface ClassCheckoutFailureLogger {
	error(
		message: string,
		context: {
			operation: "checkout.class";
			stage: ClassCheckoutFailureStage;
			organizationId: string;
			checkoutIntentId: string;
			correlationId: string;
			lineCount: number;
			errorName?: "AppError" | "Error" | "PostgresError";
			errorCode?: string;
			databaseSqlState?: string;
			databaseConstraint?: string;
			databaseTable?: string;
			databaseColumn?: string;
		},
	): void;
}

const silentClassCheckoutFailureLogger: ClassCheckoutFailureLogger = {
	error: () => undefined,
};

export const consoleClassCheckoutFailureLogger: ClassCheckoutFailureLogger = {
	error: (message, context) => console.error(message, context),
};

function sameStorefrontBinding(
	saved: ClassCheckoutStorefrontBinding | null,
	current: ClassCheckoutStorefrontBinding,
): boolean {
	return (
		saved?.shopDomain === current.shopDomain &&
		saved.integrationVersion === current.integrationVersion
	);
}

function checkoutRejectionCode(record: ClassCheckoutExecution): string | null {
	if (
		record.checkpoint === "prepared" &&
		record.state === "rejected" &&
		(record.resultCode === "checkout_integration_changed" ||
			record.resultCode === "checkout_expired")
	)
		return "checkout_pre_dispatch_rejected";
	return record.resultCode;
}

export class ClassCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly customers: CustomerAccountRepository,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: ClassCheckoutStorefront,
		private readonly commerce?: MembershipCommerceRepository,
		private readonly now: () => Date = () => new Date(),
		private readonly failureLogger: ClassCheckoutFailureLogger = silentClassCheckoutFailureLogger,
		private readonly repertoire?: RepertoireRepository,
	) {}

	async evaluateEligibility(
		input: EvaluatePurchaseEligibilityInput,
		preloaded?: EligibilityLookups,
	): Promise<EvaluatePurchaseEligibilityResponse> {
		if (!input.customerId?.trim()) {
			throw new AppError("Customer ID is required.", 400);
		}
		const uniqueChildIds = [
			...new Set(input.items.map((item) => item.childId)),
		];
		for (const childId of uniqueChildIds) {
			const child = preloaded?.children?.has(childId)
				? (preloaded.children.get(childId) ?? null)
				: await this.customers.findChild(
						input.organizationId,
						input.customerId,
						childId,
					);
			if (!child) {
				throw new AppError("Child not found.", 404);
			}
		}

		const targetFestival =
			preloaded?.targetFestival ??
			resolveTargetFestival(
				await this.organizations.listFestivals(input.organizationId),
				{
					festivalId: input.festivalId,
					festivalShortName: input.festivalShortName,
				},
			);

		const classes = new Map<string, FestivalClassConfiguration>(
			preloaded?.classes,
		);
		const uniqueClassIds = [
			...new Set(input.items.map((item) => item.festivalClassId)),
		];
		const missingClassIds = uniqueClassIds.filter((id) => !classes.has(id));
		if (missingClassIds.length > 0) {
			const configs =
				await this.organizations.findFestivalClassConfigurationsByIds(
					input.organizationId,
					targetFestival.id,
					missingClassIds,
				);
			for (const cfg of configs) classes.set(cfg.id, cfg);
		}

		const [activeEntitlements, subtypes, timezone] = await Promise.all([
			this.loadTargetedEntitlements({
				organizationId: input.organizationId,
				festivalId: targetFestival.id,
				uniqueClassIds,
				uniqueChildIds,
				classes,
			}),
			preloaded?.subtypes ??
				this.organizations.listRegistrationCatalogValues(
					input.organizationId,
					"class_subtype",
				),
			preloaded?.timezone ??
				this.organizations.getOrganizationTimezone(input.organizationId),
		]);
		const isRegistrationOpen = isFestivalRegistrationOpen(
			targetFestival,
			this.now(),
			timezone,
		);
		return evaluatePurchaseEligibility({
			organizationId: input.organizationId,
			festivalId: targetFestival.id,
			items: input.items,
			classes,
			subtypes,
			activeEntitlements,
			isRegistrationOpen,
			mode: input.mode ?? "cart",
		});
	}

	private async loadTargetedEntitlements(input: {
		organizationId: string;
		festivalId: string;
		uniqueClassIds: string[];
		uniqueChildIds: string[];
		classes: Map<string, FestivalClassConfiguration>;
	}): Promise<ClassEntitlement[]> {
		if (!this.commerce) return [];
		const [entitlementsByClass, entitlementsByChild] = await Promise.all([
			input.uniqueClassIds.length > 0
				? this.commerce.listClassEntitlements({
						organizationId: input.organizationId,
						festivalId: input.festivalId,
						festivalClassIds: input.uniqueClassIds,
					})
				: Promise.resolve([]),
			input.uniqueChildIds.length > 0
				? this.commerce.listClassEntitlements({
						organizationId: input.organizationId,
						festivalId: input.festivalId,
						childIds: input.uniqueChildIds,
					})
				: Promise.resolve([]),
		]);
		const merged = new Map<string, ClassEntitlement>();
		for (const ent of entitlementsByClass) merged.set(ent.id, ent);
		const prerequisiteClassIds = new Set<string>();
		for (const ent of entitlementsByChild) {
			merged.set(ent.id, ent);
			if (
				ent.status === "confirmed" &&
				!input.classes.has(ent.festivalClassId)
			) {
				prerequisiteClassIds.add(ent.festivalClassId);
			}
		}
		if (prerequisiteClassIds.size > 0) {
			const configs =
				await this.organizations.findFestivalClassConfigurationsByIds(
					input.organizationId,
					input.festivalId,
					[...prerequisiteClassIds],
				);
			for (const cfg of configs) input.classes.set(cfg.id, cfg);
		}
		return [...merged.values()];
	}

	async start(input: StartClassCheckoutInput): Promise<ClassCheckoutResult> {
		const currentTime = this.now();
		const { session } = await this.validateSessionAndCustomer(
			input,
			currentTime,
		);
		await this.requireSafeReplacement(input);
		const executions = this.checkout.classExecutions;
		const priorIntent =
			executions && this.checkout.findIntentByKey
				? await this.checkout.findIntentByKey(input)
				: null;
		if (priorIntent) assertCheckoutIntentType(priorIntent, "class_entry");
		let priorExecution =
			priorIntent && executions
				? await executions.get(input.organizationId, priorIntent.id)
				: null;
		if (priorIntent && priorExecution && executions) {
			priorExecution = await this.checkExistingExecution(
				executions,
				input,
				priorIntent,
				priorExecution,
			);
			if (
				priorExecution.checkpoint === "attached" &&
				priorExecution.shopifyCartId
			)
				return this.resumeTrackedCart(priorIntent, priorExecution);
		}
		if (!priorIntent && executions) {
			await this.assertNoBlockingExecution(
				input.organizationId,
				input.customerId,
				input.festivalShortName,
			);
		}
		let managed = priorExecution
			? await this.claimCheckoutExecution(priorExecution)
			: undefined;
		try {
			if (
				managed &&
				priorIntent &&
				Date.parse(priorIntent.expiresAtIso) <= currentTime.getTime()
			)
				throw new AppError("Checkout has expired.", 409, "checkout_expired");
			if (!priorExecution) {
				const existing = await this.checkout.getOutcome({
					organizationId: input.organizationId,
					customerId: input.customerId,
					sessionId: input.sessionId,
					idempotencyKey: input.idempotencyKey,
				});
				if (existing?.kind === "ready") return this.resume(existing, input);
				if (existing) this.handleOutcome(existing);
			}
			const namedFestival = input.festivalShortName?.trim();
			const festivals = namedFestival
				? []
				: await this.organizations.listFestivals(input.organizationId);
			const targetFestival = namedFestival
				? undefined
				: resolveTargetFestival(festivals, { festivalId: input.festivalId });
			const lineItems = this.normalizeLineItems(input);
			const caches: LineValidationCaches = {
				children: new Map(),
				ageSnapshots: new Map(),
				classConfigs: new Map(),
				teacherGrants: new Map(),
				accompanistGrants: new Map(),
			};
			const validatedLines: ValidatedLineItem[] = [];
			for (const line of lineItems) {
				const vl = await this.validateLine(input.organizationId, line, {
					customerId: input.customerId,
					targetFestival,
					festivals,
					festivalShortName: namedFestival,
					festivalId: input.festivalId,
					currentTime,
					divisionId: lineItems.length === 1 ? input.divisionId : undefined,
					caches,
				});
				validatedLines.push(vl);
			}
			const targetFestivalId =
				targetFestival?.id ?? validatedLines[0].classConfig.festivalId;
			if (
				namedFestival &&
				validatedLines.some(
					(line) => line.classConfig.festivalId !== targetFestivalId,
				)
			) {
				throw new AppError("Festival class configuration not found.", 404);
			}
			if (
				!priorExecution &&
				(await this.checkout.hasProcessingIntent(
					input.organizationId,
					input.customerId,
					currentTime.toISOString(),
					"class_entry",
				))
			) {
				throw new AppError(
					"Checkout is already in progress.",
					409,
					"checkout_in_progress",
				);
			}
			const organization = await this.organizations.findOrganizationById(
				input.organizationId,
			);
			if (!organization) throw new AppError("Organization was not found.", 404);
			const currencyCode = organization.defaultCurrencyCode || "USD";
			const expiresAtIso =
				priorIntent?.expiresAtIso ??
				new Date(currentTime.getTime() + 30 * 60_000).toISOString();
			const eligibilityResults = await this.checkEligibility(
				input.organizationId,
				input.customerId,
				targetFestivalId,
				lineItems,
				{
					targetFestival,
					children: caches.children,
					classes: caches.classConfigs,
					subtypes: caches.subtypes,
					timezone: organization.timezone,
				},
			);
			await this.captureRegistrationSnapshots(
				input.organizationId,
				validatedLines,
				lineItems,
				caches,
				currencyCode,
				currentTime.toISOString(),
			);
			const outcome: CheckoutIntentOutcome =
				priorIntent && priorExecution
					? { kind: "created", intent: priorIntent }
					: await this.createMultiLineIntent(
							input,
							validatedLines,
							currencyCode,
							expiresAtIso,
							{
								...classCheckoutRequestSnapshot(input),
								integrationVersion: session.integrationVersion || 1,
							},
						);
			if (outcome.kind === "ready") return this.resume(outcome, input);
			this.handleOutcome(outcome);
			if (outcome.kind !== "created")
				throw new AppError("Failed to create checkout intent.", 500);
			if (executions && !managed) {
				let record: ClassCheckoutExecution;
				try {
					record = await executions.prepare({
						organizationId: input.organizationId,
						customerId: input.customerId,
						intentId: outcome.intent.id,
						fingerprint: classCheckoutRequestFingerprint(input),
						requestSnapshot: {
							...classCheckoutRequestSnapshot(input),
							integrationVersion: session.integrationVersion || 1,
						},
					});
				} catch (error) {
					if (
						error instanceof AppError &&
						error.code === "checkout_payload_conflict"
					)
						throw error;
					throw new ClassCheckoutPersistenceUnavailableError();
				}
				const owner = randomUUID();
				const claimed = await executions.claim({
					organizationId: input.organizationId,
					intentId: record.intentId,
					owner,
				});
				if (!claimed)
					throw new AppError(
						"Checkout is already in progress.",
						409,
						"checkout_in_progress",
					);
				managed = {
					record: claimed,
					claim: {
						organizationId: input.organizationId,
						intentId: claimed.intentId,
						owner,
						generation: claimed.generation,
					},
				};
			}

			return await this.executeStorefrontCheckout(
				input,
				targetFestivalId,
				eligibilityResults,
				outcome.intent,
				validatedLines,
				currencyCode,
				expiresAtIso,
				session.integrationVersion || 1,
				managed,
			);
		} catch (error) {
			if (managed?.record.state === "running")
				return this.handleExecutionFailure(
					managed,
					"registration_window",
					error,
				);
			throw error;
		}
	}

	private async checkExistingExecution(
		executions: ClassCheckoutExecutionRepository,
		input: StartClassCheckoutInput,
		intent: CheckoutIntentRecord,
		record: ClassCheckoutExecution,
	) {
		assertExecutionFingerprint(record, classCheckoutRequestFingerprint(input));
		if (
			!(
				intent.status === "needs_review" && record.state === "recovery_required"
			) &&
			["approved", "rejected", "needs_review", "superseded"].includes(
				intent.status,
			)
		)
			throw new AppError(
				"This checkout has already been resolved.",
				409,
				intent.status === "approved"
					? "checkout_already_completed"
					: (checkoutRejectionCode(record) ?? "checkout_terminal_failure"),
			);
		let refreshed = record;
		if (record.state === "running") {
			await executions.reapExpired(intent.organizationId, intent.id);
			refreshed =
				(await executions.get(intent.organizationId, intent.id)) ?? record;
		}
		const legacyInvalid = await this.legacyInvalidCartRecovery(
			refreshed,
			input.festivalShortName,
		);
		if (legacyInvalid) throw legacyInvalid;
		const current = await this.recordKnownCartExpiry(intent, refreshed);
		if (current.state === "recovery_required")
			throw new ClassCheckoutRecoveryRequiredError(current);
		if (current.state === "rejected")
			throw new AppError(
				"This checkout has been closed.",
				409,
				checkoutRejectionCode(current) ?? "checkout_terminal_failure",
			);
		if (current.state === "running")
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		return current;
	}

	/** Replay durable local outcomes before any OAuth refresh or Shopify call. */
	async preflightRecovery(input: StartClassCheckoutInput): Promise<void> {
		await this.validateSessionAndCustomer(
			{ ...input, buyerAccessToken: "local-preflight" },
			this.now(),
		);
		await this.requireSafeReplacement(input);
		const executions = this.checkout.classExecutions;
		if (!executions || !this.checkout.findIntentByKey) return;
		const intent = await this.checkout.findIntentByKey(input);
		if (intent) {
			assertCheckoutIntentType(intent, "class_entry");
			let record = await executions.get(input.organizationId, intent.id);
			if (!record) return;
			assertExecutionFingerprint(
				record,
				classCheckoutRequestFingerprint(input),
			);
			await executions.reapExpired(input.organizationId, intent.id);
			record =
				(await executions.get(input.organizationId, intent.id)) ?? record;
			const legacyInvalid = await this.legacyInvalidCartRecovery(
				record,
				input.festivalShortName,
			);
			if (legacyInvalid) throw legacyInvalid;
			record = await this.recordKnownCartExpiry(intent, record);
			if (record.state === "recovery_required")
				throw new ClassCheckoutRecoveryRequiredError(record);
			if (
				record.state === "rejected" ||
				["approved", "rejected", "needs_review", "superseded"].includes(
					intent.status,
				)
			)
				throw new AppError(
					"This checkout has already been resolved.",
					409,
					checkoutRejectionCode(record) ?? "checkout_terminal_failure",
				);
			if (record.state === "running")
				throw new AppError(
					"Checkout is already in progress.",
					409,
					"checkout_in_progress",
				);
			if (
				record.checkpoint === "prepared" &&
				Date.parse(intent.expiresAtIso) <= this.now().getTime()
			)
				return this.handleExecutionFailure(
					await this.claimCheckoutExecution(record),
					"registration_window",
					new AppError("Checkout has expired.", 409, "checkout_expired"),
				);
			return;
		}
		await this.assertNoBlockingExecution(
			input.organizationId,
			input.customerId,
			input.festivalShortName,
		);
	}

	private async claimCheckoutExecution(
		record: ClassCheckoutExecution,
	): Promise<ManagedClassCheckoutExecution> {
		const owner = randomUUID();
		const claimed = await this.checkout.classExecutions?.claim({
			organizationId: record.organizationId,
			intentId: record.intentId,
			owner,
		});
		if (!claimed)
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		return {
			record: claimed,
			claim: {
				organizationId: claimed.organizationId,
				intentId: claimed.intentId,
				owner,
				generation: claimed.generation,
			},
		};
	}

	private async assertNoBlockingExecution(
		organizationId: string,
		customerId: string,
		festivalShortName?: string,
	): Promise<void> {
		let blocking = await this.checkout.classExecutions?.findBlocking(
			organizationId,
			customerId,
		);
		if (!blocking) return;
		const legacyInvalid = await this.legacyInvalidCartRecovery(
			blocking,
			festivalShortName,
		);
		if (legacyInvalid) throw legacyInvalid;
		if (blocking.state === "running")
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		const intent = await this.checkout.findIntentById?.(
			organizationId,
			blocking.intentId,
		);
		if (
			intent &&
			["approved", "rejected", "needs_review", "superseded"].includes(
				intent.status,
			) &&
			blocking.state !== "recovery_required"
		)
			return;
		if (intent) blocking = await this.recordKnownCartExpiry(intent, blocking);
		throw new ClassCheckoutRecoveryRequiredError(blocking, false);
	}

	private async legacyInvalidCartRecovery(
		record: ClassCheckoutExecution,
		festivalShortName?: string,
	): Promise<ClassCheckoutRecoveryRequiredError | null> {
		if (
			record.checkpoint !== "remote_cart_known" ||
			record.state === "rejected" ||
			record.state === "completed"
		)
			return null;
		const events = await this.checkout.classExecutions?.events(
			record.organizationId,
			record.intentId,
		);
		if (
			!events?.some(isLegacyInvalidCartObservation) ||
			events.some(
				(event) =>
					event.evidence.resolution === "resume_known_cart" ||
					event.eventType === "paid_order_observed" ||
					Boolean(event.evidence.shopifyOrderGid),
			)
		)
			return null;
		const available = festivalShortName
			? await this.findUnissuedCartRestart({
					organizationId: record.organizationId,
					customerId: record.customerId,
					festivalShortName,
				})
			: null;
		return new ClassCheckoutRecoveryRequiredError(record, false, {
			restartAllowed: available?.recoveryReference === record.recoveryReference,
		});
	}

	private async requireSafeReplacement(input: {
		organizationId: string;
		customerId: string;
		idempotencyKey: string;
	}): Promise<void> {
		if (
			await this.checkout.classExecutions?.isUnissuedCartReplacementBlocked({
				organizationId: input.organizationId,
				customerId: input.customerId,
				replacementKey: input.idempotencyKey,
			})
		)
			throw new AppError(
				"The previous checkout has a payment under review. Your registrations are still saved.",
				409,
				"checkout_restart_payment_uncertain",
			);
	}

	private async validateSessionAndCustomer(
		input: StartClassCheckoutInput,
		currentTime: Date,
	) {
		if (
			!input.organizationId?.trim() ||
			!input.customerId?.trim() ||
			!input.sessionId?.trim()
		) {
			throw new AppError("Customer session is invalid.", 401);
		}
		if (!input.buyerAccessToken?.trim()) {
			throw new AppError("Buyer access token is required.", 400);
		}
		const session = await this.customers.getSession(input.sessionId);
		if (
			!session ||
			session.revokedAtIso ||
			session.organizationId !== input.organizationId ||
			session.customerId !== input.customerId ||
			new Date(session.expiresAtIso) <= currentTime
		) {
			throw new AppError("Customer session is invalid.", 401);
		}
		const customer = await this.customers.getCustomer(
			input.organizationId,
			input.customerId,
		);
		if (
			!customer ||
			customer.shopifyCustomerGid !== session.shopifyCustomerGid
		) {
			throw new AppError("Customer session is invalid.", 401);
		}
		return { session, customer };
	}

	private normalizeLineItems(
		input: StartClassCheckoutInput,
	): ClassCheckoutLineItemInput[] {
		if (input.lineItems) {
			if (input.lineItems.length === 0) {
				throw new AppError(
					"Class checkout requires at least one line item.",
					400,
				);
			}
			return input.lineItems.map(
				(item) => stripCandidateMarker(item) as ClassCheckoutLineItemInput,
			);
		}
		if (!input.festivalClassId?.trim()) {
			throw new AppError("Festival class ID is required.", 400);
		}
		if (!input.childId?.trim()) {
			throw new AppError("Child ID is required.", 400);
		}
		if (!input.teacherId?.trim()) {
			throw new AppError("Teacher ID is required.", 400);
		}
		return [
			stripCandidateMarker({
				festivalClassId: input.festivalClassId,
				childId: input.childId,
				teacherId: input.teacherId,
				accompanistId: input.accompanistId,
				instrumentId: input.instrumentId,
				pieces: input.pieces ?? [],
			}) as ClassCheckoutLineItemInput,
		];
	}

	private async validateTeacherAndAccompanist(
		organizationId: string,
		classConfig: FestivalClassConfiguration,
		teacherId: string,
		accompanistId: string | null | undefined,
		caches: LineValidationCaches,
	): Promise<{
		teacherEntitlementId: string;
		accompanistEntitlementId: string | null;
	}> {
		const normalizedTeacherId = teacherId.trim();
		const teacherCacheKey = `${normalizedTeacherId}\u0000${classConfig.divisionId}`;
		if (!caches.teacherGrants.has(teacherCacheKey)) {
			caches.teacherGrants.set(
				teacherCacheKey,
				await this.organizations.findActiveTeacherEntitlementGrant({
					organizationId,
					customerId: normalizedTeacherId,
					divisionId: classConfig.divisionId,
				}),
			);
		}
		const activeTeacherGrant = validateTeacherEntitlement(
			caches.teacherGrants.get(teacherCacheKey),
			classConfig.divisionId,
			normalizedTeacherId,
		);

		const normalizedAccompanistId = accompanistId?.trim();
		const accompanimentRequired = Boolean(
			(classConfig as { accompanimentRequired?: boolean })
				.accompanimentRequired,
		);
		let accompanistGrant: AccompanistMembershipGrant | null | undefined;
		if (normalizedAccompanistId) {
			if (!caches.accompanistGrants.has(normalizedAccompanistId)) {
				caches.accompanistGrants.set(
					normalizedAccompanistId,
					await this.organizations.findCurrentAccompanistMembershipGrant({
						organizationId,
						customerId: normalizedAccompanistId,
					}),
				);
			}
			accompanistGrant = caches.accompanistGrants.get(normalizedAccompanistId);
		}
		const accompanistEntitlementId = validateAccompanistSelection(
			accompanistGrant,
			normalizedAccompanistId,
			accompanimentRequired,
		);

		return {
			teacherEntitlementId: activeTeacherGrant.id,
			accompanistEntitlementId,
		};
	}

	private async validateLine(
		organizationId: string,
		line: ClassCheckoutLineItemInput,
		ctx: {
			customerId: string;
			targetFestival?: FestivalRecord;
			festivals: FestivalRecord[];
			festivalShortName?: string;
			festivalId?: string;
			currentTime: Date;
			divisionId?: string;
			caches: LineValidationCaches;
		},
	): Promise<ValidatedLineItem> {
		if (!line.festivalClassId?.trim()) {
			throw new AppError("Festival class ID is required.", 400);
		}
		if (!line.childId?.trim()) {
			throw new AppError("Child ID is required.", 400);
		}
		if (!line.teacherId?.trim()) {
			throw new AppError("Teacher ID is required.", 400);
		}
		if (!ctx.caches.children.has(line.childId)) {
			ctx.caches.children.set(
				line.childId,
				await this.customers.findChild(
					organizationId,
					ctx.customerId,
					line.childId,
				),
			);
		}
		const child = validateChildOwnership(
			ctx.caches.children.get(line.childId),
			line.childId,
			ctx.customerId,
		);
		if (!ctx.caches.ageSnapshots.has(line.childId)) {
			ctx.caches.ageSnapshots.set(
				line.childId,
				await this.customers.findActiveChildAgeSnapshot(
					organizationId,
					line.childId,
				),
			);
		}
		const activeSnapshot = validateActiveChildAgeSnapshot(
			ctx.caches.ageSnapshots.get(line.childId) ?? null,
			ctx.currentTime,
		);
		const requestedDivisionId =
			(line as { divisionId?: string }).divisionId ?? ctx.divisionId;
		let classConfig: FestivalClassConfiguration | null | undefined =
			ctx.caches.classConfigs.get(line.festivalClassId);
		if (!classConfig) {
			if (ctx.festivalShortName) {
				classConfig =
					await this.organizations.findActiveFestivalClassByShortName(
						organizationId,
						ctx.festivalShortName,
						line.festivalClassId,
						ctx.festivalId,
					);
			} else if (ctx.targetFestival) {
				classConfig = await resolveFestivalClassConfiguration(
					this.organizations,
					{
						organizationId,
						targetFestival: ctx.targetFestival,
						festivals: ctx.festivals,
						festivalClassId: line.festivalClassId,
						divisionId: requestedDivisionId,
					},
				);
			} else {
				throw new AppError("Active festival not found.", 404);
			}
			if (!classConfig) {
				throw new AppError("Festival class configuration not found.", 404);
			}
			ctx.caches.classConfigs.set(line.festivalClassId, classConfig);
		}
		if (
			requestedDivisionId !== undefined &&
			requestedDivisionId !== classConfig.divisionId
		) {
			throw new AppError(
				"Selected class does not belong to the requested division.",
				400,
			);
		}
		validateChildAgeRange(activeSnapshot.age, classConfig);
		ctx.caches.subtypes ??=
			await this.organizations.listRegistrationCatalogValues(
				organizationId,
				"class_subtype",
				false,
			);
		const subtype =
			ctx.caches.subtypes.find((s) => s.id === classConfig.classSubtypeId) ??
			null;
		let catalogWorksById: ReadonlyMap<string, CanonicalWork | null> | undefined;
		if (
			this.repertoire &&
			(doesClassRequireConcerto(classConfig, subtype) ||
				(Array.isArray(line.pieces) &&
					line.pieces.some((p) => Boolean(p?.catalogWorkId))))
		) {
			ctx.caches.catalogWorks ??= new Map();
			catalogWorksById = await resolvePieceCatalogWorks(
				line.pieces,
				organizationId,
				this.repertoire,
				ctx.caches.catalogWorks,
			);
		}
		const normalizedPieces = validateAndNormalizeRepertoirePieces(
			line.pieces,
			classConfig,
			{ subtype, catalogWorksById },
		);
		const { teacherEntitlementId, accompanistEntitlementId } =
			await this.validateTeacherAndAccompanist(
				organizationId,
				classConfig,
				line.teacherId,
				line.accompanistId,
				ctx.caches,
			);
		let instrument: ClassRegistrationSnapshot["instrument"] = "unknown";
		if (line.instrumentId !== undefined) {
			if (typeof line.instrumentId !== "string" || !line.instrumentId.trim()) {
				throw new AppError(
					"Select a valid instrument.",
					400,
					"instrument_invalid",
				);
			}
			ctx.caches.instruments ??=
				await this.organizations.listRegistrationCatalogValues(
					organizationId,
					"instrument",
					true,
				);
			const selected = ctx.caches.instruments.find(
				(value) =>
					value.id === line.instrumentId?.trim() &&
					value.organizationId === organizationId &&
					value.isActive,
			);
			if (!selected)
				throw new AppError(
					"Select a valid instrument.",
					400,
					"instrument_invalid",
				);
			instrument = { id: selected.id, name: selected.displayName };
		}
		return {
			child,
			classConfig,
			normalizedPieces,
			teacherEntitlementId,
			accompanistEntitlementId,
			instrument,
		};
	}

	private async checkEligibility(
		organizationId: string,
		customerId: string,
		festivalId: string,
		lineItems: ClassCheckoutLineItemInput[],
		preloaded: EligibilityLookups,
	): Promise<ClassEligibilityResult[]> {
		const eligibility = await this.evaluateEligibility(
			{
				organizationId,
				customerId,
				festivalId,
				items: lineItems.map(
					(item) => stripCandidateMarker(item) as ClassCheckoutLineItemInput,
				),
				mode: "cart",
			},
			preloaded,
		);
		if (
			!eligibility.isEligible ||
			eligibility.results.some((r) => !r.isEligible)
		) {
			throw buildEligibilityRejectionError(eligibility.results);
		}
		return eligibility.results;
	}

	private async requireRegistrationOpen(
		organizationId: string,
		festivalId: string,
		eligibilityResults: readonly ClassEligibilityResult[],
	): Promise<void> {
		const [festivals, timezone] = await Promise.all([
			this.organizations.listFestivals(organizationId),
			this.organizations.getOrganizationTimezone(organizationId),
		]);
		const festival = resolveTargetFestival(festivals, { festivalId });
		if (!isFestivalRegistrationOpen(festival, this.now(), timezone)) {
			throw buildEligibilityRejectionError(
				eligibilityResults.map((result) => ({
					...result,
					eligible: false,
					isEligible: false,
					reasonCode: "REGISTRATION_CLOSED",
					message: "Registration is closed for this festival.",
				})),
			);
		}
	}

	private async createMultiLineIntent(
		input: StartClassCheckoutInput,
		validatedLines: ValidatedLineItem[],
		currencyCode: string,
		expiresAtIso: string,
		requestSnapshot?: unknown,
	): Promise<CheckoutIntentOutcome> {
		const intentLines: CreateCheckoutIntentLineInput[] = validatedLines.map(
			(vl, index) => ({
				lineIndex: index,
				lineType: "class_entry",
				festivalClassId: vl.classConfig.id,
				childId: vl.child.id,
				shopifyProductGid: vl.classConfig.shopifyProductGid,
				shopifyVariantGid: vl.classConfig.shopifyVariantGid,
				amount: vl.classConfig.price,
				currencyCode,
				divisionId: vl.classConfig.divisionId,
				divisionNameSnapshot: vl.registrationSnapshot?.division.name ?? null,
			}),
		);
		const totalAmount = calculateTotalAmount(intentLines.map((l) => l.amount));

		return this.checkout.createIntent({
			...(this.checkout.classExecutions
				? {
						classExecution: {
							fingerprint: classCheckoutRequestFingerprint(input),
							requestSnapshot,
						},
					}
				: {}),
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			intentType: "class_entry",
			festivalClassId: validatedLines[0].classConfig.id,
			divisionId: validatedLines[0].classConfig.divisionId,
			childId: validatedLines[0].child.id,
			shopifyProductGid: validatedLines[0].classConfig.shopifyProductGid,
			shopifyVariantGid: validatedLines[0].classConfig.shopifyVariantGid,
			amount: totalAmount,
			currencyCode,
			expiresAtIso,
			lineIdentityProtocol: CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
			lines: intentLines,
		});
	}

	private handleOutcome(outcome: CheckoutIntentOutcome): void {
		if (outcome.kind === "in_progress") {
			throw new AppError(
				"Checkout is already in progress.",
				409,
				"checkout_in_progress",
			);
		}
		if (outcome.kind === "active") {
			throw new AppError(
				"This checkout has already completed.",
				409,
				"checkout_already_completed",
			);
		}
		if (outcome.kind === "expired") {
			throw new AppError("Checkout has expired.", 409, "checkout_expired");
		}
		if (outcome.kind === "failed") {
			throw new AppError(
				"This checkout attempt cannot continue.",
				409,
				"checkout_terminal_failure",
			);
		}
	}

	private async insertAllRegistrationMetadata(
		organizationId: string,
		festivalId: string,
		intent: CheckoutIntentRecord,
		validatedLines: ValidatedLineItem[],
		intentLines: readonly CheckoutIntentLineItemRecord[],
	): Promise<void> {
		for (let i = 0; i < validatedLines.length; i++) {
			const vl = validatedLines[i];
			const lineRecord = intentLines[i];
			await this.checkout.insertRegistrationMetadata({
				id: randomUUID(),
				organizationId,
				festivalId,
				checkoutIntentId: intent.id,
				checkoutIntentLineId: lineRecord.id,
				teacherMembershipId: vl.teacherEntitlementId,
				accompanistMembershipId: vl.accompanistEntitlementId,
				repertoireJson: vl.normalizedPieces,
				repertoireSnapshotPieces: vl.normalizedPieces,
				registrationSnapshot: vl.registrationSnapshot,
			});
		}
	}

	private async captureRegistrationSnapshots(
		organizationId: string,
		validatedLines: ValidatedLineItem[],
		lineItems: ClassCheckoutLineItemInput[],
		caches: LineValidationCaches,
		currencyCode: string,
		capturedAtIso: string,
	): Promise<void> {
		const [divisions, subtypes, teacherRosters] = await Promise.all([
			this.organizations.listDivisions(organizationId, false),
			caches.subtypes
				? Promise.resolve(caches.subtypes)
				: this.organizations.listRegistrationCatalogValues(
						organizationId,
						"class_subtype",
						false,
					),
			Promise.all(
				[
					...new Set(validatedLines.map((line) => line.classConfig.divisionId)),
				].map(
					async (divisionId) =>
						[
							divisionId,
							await this.organizations.listActiveTeachersForDivision(
								organizationId,
								divisionId,
							),
						] as const,
				),
			),
		]);
		const teachers = new Map(teacherRosters);
		for (const [index, line] of validatedLines.entries()) {
			const config = line.classConfig;
			const selection = lineItems[index];
			const teacherId = selection.teacherId.trim();
			const accompanistId = selection.accompanistId?.trim();
			const accompanist = accompanistId
				? caches.accompanistGrants.get(accompanistId)
				: null;
			line.registrationSnapshot = {
				version: 1,
				capturedAtIso,
				class: {
					id: config.id,
					festivalId: config.festivalId,
					displayName: config.displayName,
					classSubtypeId: config.classSubtypeId,
					classSubtypeName:
						subtypes.find((subtype) => subtype.id === config.classSubtypeId)
							?.displayName ?? null,
					minimumAge: config.minimumAge,
					maximumAge: config.maximumAge,
					price: config.price,
					currencyCode,
					maximumPerformancePieces: config.maximumPerformancePieces,
					performanceMinutes: config.performanceMinutes,
					capacity: config.capacity,
				},
				division: {
					id: config.divisionId,
					name:
						divisions.find((division) => division.id === config.divisionId)
							?.displayName ?? null,
				},
				instrument: line.instrument,
				teacher: {
					customerId: teacherId,
					membershipId: line.teacherEntitlementId,
					name:
						teachers
							.get(config.divisionId)
							?.find((teacher) => teacher.id === teacherId)?.name || null,
				},
				accompanist:
					accompanist && line.accompanistEntitlementId
						? {
								customerId: accompanist.customerId,
								membershipId: line.accompanistEntitlementId,
								name: accompanist.contact.name || null,
							}
						: null,
				repertoire: structuredClone(line.normalizedPieces),
			};
		}
	}

	private async createAndVerifyCart(params: {
		input: StartClassCheckoutInput;
		festivalId: string;
		eligibilityResults: readonly ClassEligibilityResult[];
		intent: CheckoutIntentRecord;
		validatedLines: ValidatedLineItem[];
		intentLines: readonly CheckoutIntentLineItemRecord[];
		currencyCode: string;
		expiresAtIso: string;
		defaultIntegrationVersion: number;
		setStage: (stage: ClassCheckoutFailureStage) => void;
		managed?: ManagedClassCheckoutExecution;
	}): Promise<ClassCheckoutResult> {
		const {
			input,
			festivalId,
			intent,
			validatedLines,
			intentLines,
			currencyCode,
			expiresAtIso,
			setStage,
		} = params;
		setStage("load_integration");
		const storefrontIntegration =
			await this.organizations.getShopifyIntegration(input.organizationId);
		if (!storefrontIntegration) {
			throw new AppError("Shopify checkout is unavailable.", 503);
		}
		const storefrontBinding = this.storefrontBinding(storefrontIntegration);

		const cartLines = validatedLines.map((vl, index) => {
			const lineRecord = intentLines[index];
			return {
				merchandiseId: vl.classConfig.shopifyVariantGid,
				quantity: 1,
				attributes: [
					{
						key: CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
						value: lineRecord.id,
					},
				],
			};
		});

		setStage("registration_window");
		await this.requireRegistrationOpen(
			input.organizationId,
			festivalId,
			params.eligibilityResults,
		);
		setStage("create_cart");
		if (params.managed) {
			if (params.managed.record.shopifyCartId) {
				await this.verifyTrackedCartBinding(
					params.managed,
					intent,
					storefrontBinding,
				);
			} else {
				if (params.managed.record.checkpoint !== "prepared")
					throw new AppError("Shopify cart creation needs recovery.", 503);
				await this.advanceExecution(params.managed, {
					checkpoint: "create_dispatched",
					storefrontBinding,
					eventType: "create_dispatched",
				});
			}
		}
		let cartResponse: { shopifyCartId: string };
		try {
			cartResponse = params.managed?.record.shopifyCartId
				? { shopifyCartId: params.managed.record.shopifyCartId }
				: await this.storefront.createCart({
						organizationId: input.organizationId,
						shopifyVariantGid: validatedLines[0].classConfig.shopifyVariantGid,
						lines: cartLines,
						buyerAccessToken: input.buyerAccessToken,
						correlationId: intent.correlationId,
						currencyCode,
						...(params.managed
							? { expectedStorefrontBinding: storefrontBinding }
							: {}),
					});
		} catch (error) {
			if (params.managed && error instanceof ClassCheckoutCartObservationError)
				return this.requireTrackedCartRecovery(
					params.managed,
					"checkout_attachment_incomplete",
					error.observedShopifyCartId,
				);
			throw error;
		}
		if (params.managed)
			await this.advanceExecution(params.managed, {
				checkpoint: "remote_cart_known",
				shopifyCartId: cartResponse.shopifyCartId,
				eventType: "remote_cart_observed",
			});

		setStage("attach_cart");
		const capacityCheck = () =>
			verifyPostCartCreateCapacityCutoff({
				organizationId: input.organizationId,
				festivalId,
				lines: validatedLines.map((vl) => ({
					childId: vl.child.id,
					festivalClassId: vl.classConfig.id,
				})),
				organizations: this.organizations,
				countConfirmedEntitlements: this.commerce
					? (orgId, classId) =>
							this.commerce?.countConfirmedClassEntitlements(orgId, classId) ??
							Promise.resolve(0)
					: undefined,
			});
		const integrationVersion =
			typeof input.integrationVersion === "number"
				? input.integrationVersion
				: Number(input.integrationVersion) || params.defaultIntegrationVersion;

		const attachCartInput = {
			capacityCheck,
			intentId: intent.id,
			shopifyCartId: cartResponse.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion,
			expiresAtIso,
			...(params.managed ? { executionClaim: params.managed.claim } : {}),
		};
		let cart: CheckoutCartRecord;
		try {
			cart = this.checkout.markIntentReady
				? await this.checkout.markIntentReady(attachCartInput)
				: await this.checkout.attachCart(attachCartInput);
		} catch (error) {
			if (error instanceof AppError && error.code === "sold_out") {
				if (params.managed) throw error;
				if (this.checkout.markIntentFailed) {
					await this.checkout.markIntentFailed({
						organizationId: input.organizationId,
						intentId: intent.id,
						failureCode: "sold_out",
						failureMessage: error.message,
					});
				} else {
					await this.checkout.markFailed(intent.id);
				}
			}
			throw error;
		}
		if (params.managed) {
			const attached = await this.checkout.classExecutions?.get(
				input.organizationId,
				intent.id,
			);
			if (!attached || attached.checkpoint !== "attached")
				throw new ClassCheckoutPersistenceUnavailableError();
			params.managed.record = attached;
		}

		setStage("mark_checkout_started");
		await this.checkout.markCheckoutStarted(intent.id);

		setStage("checkout_url");
		const checkout = await this.storefront.checkout({
			organizationId: input.organizationId,
			shopifyCartId: cart.shopifyCartId,
			...(params.managed
				? { expectedStorefrontBinding: storefrontBinding }
				: {}),
		});

		setStage("verify_checkout_url");
		const integration = await this.organizations.getShopifyIntegration(
			input.organizationId,
		);
		if (
			!integration ||
			!sameStorefrontBinding(
				storefrontBinding,
				this.storefrontBinding(integration),
			) ||
			!isAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain)
		) {
			throw new AppError("Shopify checkout is unavailable.", 503);
		}
		await this.requireSafeReplacement(input);
		if (params.managed) {
			if (Date.parse(expiresAtIso) <= this.now().getTime())
				return this.requireTrackedCartRecovery(
					params.managed,
					"checkout_expired",
				);
			await this.advanceExecution(params.managed, {
				state: "completed",
				releaseLease: true,
				eventType: "checkout_ready",
			});
		}

		return {
			checkoutUrl: checkout.checkoutUrl,
			intentId: intent.id,
			correlationId: intent.correlationId,
			intent,
		};
	}

	private async executeStorefrontCheckout(
		input: StartClassCheckoutInput,
		festivalId: string,
		eligibilityResults: readonly ClassEligibilityResult[],
		intent: CheckoutIntentRecord,
		validatedLines: ValidatedLineItem[],
		currencyCode: string,
		expiresAtIso: string,
		defaultIntegrationVersion: number,
		managed?: ManagedClassCheckoutExecution,
	): Promise<ClassCheckoutResult> {
		let stage: ClassCheckoutFailureStage = "registration_metadata";
		try {
			const expectedIntentLines: ExpectedClassCheckoutIntentLine[] =
				validatedLines.map((line) => ({
					festivalClassId: line.classConfig.id,
					childId: line.child.id,
					shopifyProductGid: line.classConfig.shopifyProductGid,
					shopifyVariantGid: line.classConfig.shopifyVariantGid,
					amount: line.classConfig.price,
					currencyCode,
				}));
			const intentLines = requireClassCheckoutIntentLineMapping(
				intent,
				expectedIntentLines,
			);
			await this.insertAllRegistrationMetadata(
				input.organizationId,
				festivalId,
				intent,
				validatedLines,
				intentLines,
			);
			return await this.createAndVerifyCart({
				input,
				festivalId,
				eligibilityResults,
				intent,
				validatedLines,
				intentLines,
				currencyCode,
				expiresAtIso,
				defaultIntegrationVersion,
				managed,
				setStage: (nextStage) => {
					stage = nextStage;
				},
			});
		} catch (error) {
			if (managed) return this.handleExecutionFailure(managed, stage, error);
			if (
				error instanceof AppError &&
				error.status === 400 &&
				error.code !== "registration_closed"
			) {
				throw error;
			}
			return this.reportAndMarkFailed({
				stage,
				organizationId: input.organizationId,
				intent,
				lineCount: validatedLines.length,
				error,
				markFailedStage: "mark_failed",
			});
		}
	}

	private async advanceExecution(
		managed: ManagedClassCheckoutExecution,
		change: Omit<TransitionClassCheckoutExecution, "claim">,
	): Promise<void> {
		const executions = this.checkout.classExecutions;
		if (!executions) throw new ClassCheckoutPersistenceUnavailableError();
		let changed: boolean;
		try {
			changed = await executions.transition({
				...change,
				claim: managed.claim,
			});
		} catch {
			throw new ClassCheckoutPersistenceUnavailableError();
		}
		if (!changed) {
			if (change.shopifyCartId) {
				try {
					await executions.appendLateEvidence({
						...managed.claim,
						eventType: "late_remote_cart_observed",
						evidence: {
							shopifyCartId: change.shopifyCartId,
							stage: "create_cart",
						},
					});
				} catch {
					throw new ClassCheckoutPersistenceUnavailableError();
				}
			}
			const current = await executions.get(
				managed.claim.organizationId,
				managed.claim.intentId,
			);
			if (current?.state === "recovery_required")
				throw new ClassCheckoutRecoveryRequiredError(current);
			throw new AppError(
				"Checkout execution has changed. Check its status before continuing.",
				409,
				"checkout_execution_changed",
			);
		}
		managed.record = {
			...managed.record,
			...(change.checkpoint ? { checkpoint: change.checkpoint } : {}),
			...(change.state ? { state: change.state } : {}),
			...(change.shopifyCartId ? { shopifyCartId: change.shopifyCartId } : {}),
			...(change.resultCode !== undefined
				? { resultCode: change.resultCode }
				: {}),
			...(change.storefrontBinding !== undefined
				? { storefrontBinding: change.storefrontBinding }
				: {}),
		};
	}

	private storefrontBinding(integration: {
		storeDomain: string;
		integrationVersion: number;
	}): ClassCheckoutStorefrontBinding {
		return {
			shopDomain: integration.storeDomain.toLowerCase(),
			integrationVersion: integration.integrationVersion,
		};
	}

	private async verifyShopifyCartEvidence(
		intent: CheckoutIntentRecord,
		cartId: string,
		binding: ClassCheckoutStorefrontBinding,
		previousBinding: ClassCheckoutStorefrontBinding | null,
	): Promise<void> {
		if (!this.storefront.inspectCart)
			throw new AppError(
				"A verifiable Shopify cart is required.",
				409,
				"checkout_recovery_evidence_required",
			);
		if (previousBinding && previousBinding.shopDomain !== binding.shopDomain)
			throw new AppError(
				"The Shopify shop changed; cart evidence cannot be verified.",
				409,
				"checkout_recovery_evidence_invalid",
			);
		const observed = await this.storefront.inspectCart({
			organizationId: intent.organizationId,
			shopifyCartId: cartId,
			expectedStorefrontBinding: binding,
		});
		const customer = await this.customers.getCustomer(
			intent.organizationId,
			intent.customerId,
		);
		const expected = new Map(
			(intent.lines ?? []).map((line) => [line.id, line]),
		);
		const seen = new Set<string>();
		const current = await this.organizations.getShopifyIntegration(
			intent.organizationId,
		);
		if (
			!current ||
			!sameStorefrontBinding(binding, this.storefrontBinding(current))
		)
			throw new AppError(
				"Shopify Storefront configuration changed during cart verification.",
				503,
				"checkout_storefront_verification_unavailable",
			);
		if (
			!customer ||
			observed.customerGid !== customer.shopifyCustomerGid ||
			observed.correlationId !== intent.correlationId ||
			observed.lines.length !== expected.size ||
			expected.size === 0 ||
			observed.lines.some((line) => {
				const match = line.intentLineId
					? expected.get(line.intentLineId)
					: null;
				if (
					!line.intentLineId ||
					seen.has(line.intentLineId) ||
					!match ||
					match.shopifyVariantGid !== line.variantGid ||
					line.quantity !== 1
				)
					return true;
				seen.add(line.intentLineId);
				return false;
			})
		)
			throw new AppError(
				"Shopify cart evidence does not match this checkout.",
				409,
				"checkout_recovery_evidence_invalid",
			);
	}

	private async verifyTrackedCartBinding(
		managed: ManagedClassCheckoutExecution,
		intent: CheckoutIntentRecord,
		binding: ClassCheckoutStorefrontBinding,
	): Promise<void> {
		const { storefrontBinding, shopifyCartId } = managed.record;
		if (sameStorefrontBinding(storefrontBinding, binding)) return;
		try {
			if (!shopifyCartId) throw new Error("Expected an existing Shopify cart.");
			await this.verifyShopifyCartEvidence(
				intent,
				shopifyCartId,
				binding,
				storefrontBinding,
			);
		} catch (error) {
			if (
				error instanceof AppError &&
				[
					"checkout_recovery_evidence_invalid",
					"checkout_recovery_evidence_required",
				].includes(error.code ?? "")
			)
				return this.requireTrackedCartRecovery(
					managed,
					"checkout_storefront_verification_required",
				);
			throw new AppError(
				"Shopify cart verification is temporarily unavailable.",
				503,
				"checkout_storefront_verification_unavailable",
			);
		}
		if (Date.parse(intent.expiresAtIso) <= this.now().getTime())
			return this.requireTrackedCartRecovery(managed, "checkout_expired");
		await this.advanceExecution(managed, {
			storefrontBinding: binding,
			eventType: "storefront_binding_verified",
		});
	}

	private async requireTrackedCartRecovery(
		managed: ManagedClassCheckoutExecution,
		reason: string,
		invalidCartId?: string,
	): Promise<never> {
		await this.advanceExecution(managed, {
			state: "recovery_required",
			resultCode: reason,
			eventType: invalidCartId
				? "invalid_remote_cart_observed"
				: "recovery_required",
			evidence: {
				code: reason,
				...(invalidCartId ? { shopifyCartId: invalidCartId } : {}),
			},
			...(invalidCartId
				? { checkpoint: "remote_cart_known", shopifyCartId: invalidCartId }
				: {}),
		});
		const recorded = await this.checkout.classExecutions?.get(
			managed.claim.organizationId,
			managed.claim.intentId,
		);
		if (!recorded) throw new ClassCheckoutPersistenceUnavailableError();
		if (recorded.state !== "recovery_required")
			throw new AppError(
				"Checkout execution has changed. Check its status before continuing.",
				409,
				"checkout_execution_changed",
			);
		throw new ClassCheckoutRecoveryRequiredError(recorded);
	}

	private async handleExecutionFailure(
		managed: ManagedClassCheckoutExecution,
		stage: ClassCheckoutFailureStage,
		error: unknown,
	): Promise<never> {
		if (
			error instanceof ClassCheckoutPersistenceUnavailableError ||
			error instanceof ClassCheckoutRecoveryRequiredError ||
			(error instanceof AppError && error.code === "checkout_execution_changed")
		)
			throw error;
		const executions = this.checkout.classExecutions;
		if (!executions) throw new ClassCheckoutPersistenceUnavailableError();
		const intent = await this.checkout.findIntentById?.(
			managed.claim.organizationId,
			managed.claim.intentId,
		);
		if (intent)
			this.logFailure({
				stage,
				organizationId: intent.organizationId,
				intent,
				lineCount: intent.lines?.length ?? 0,
				error,
			});
		const checkpoint = managed.record.checkpoint;
		const replayTimedOut =
			error instanceof AppError && error.code === "checkout_replay_timeout";
		const verificationUnavailable =
			error instanceof AppError &&
			error.code === "checkout_storefront_verification_unavailable";
		if (
			stage === "create_cart" &&
			checkpoint === "create_dispatched" &&
			error instanceof ClassCheckoutStorefrontChangedBeforeRequestError
		) {
			await this.advanceExecution(managed, {
				checkpoint: "prepared",
				state: "retryable",
				storefrontBinding: null,
				resultCode: "checkout_preparation_unavailable",
				eventType: "storefront_changed_before_dispatch",
			});
			throw checkoutFailureError(error);
		}
		if (
			!verificationUnavailable &&
			(checkpoint === "create_dispatched" || checkpoint === "remote_cart_known")
		) {
			let recorded: boolean;
			try {
				recorded = await executions.recordRecoveryRequired({
					claim: managed.claim,
					reason:
						checkpoint === "create_dispatched"
							? "checkout_creation_unknown"
							: "checkout_attachment_incomplete",
					evidence: {
						stage,
						code: "checkout_recovery_required",
						...(managed.record.shopifyCartId
							? { shopifyCartId: managed.record.shopifyCartId }
							: {}),
					},
				});
			} catch {
				throw new ClassCheckoutPersistenceUnavailableError();
			}
			const current = await executions.get(
				managed.claim.organizationId,
				managed.claim.intentId,
			);
			if (current?.state === "recovery_required")
				throw new ClassCheckoutRecoveryRequiredError(current);
			if (!recorded)
				throw new AppError(
					"Checkout execution has changed. Check its status before continuing.",
					409,
					"checkout_execution_changed",
				);
			throw new ClassCheckoutPersistenceUnavailableError();
		}
		const terminal =
			checkpoint === "prepared" &&
			error instanceof AppError &&
			error.status >= 400 &&
			error.status < 500;
		if (
			terminal &&
			managed.record.leaseExpiresAtIso &&
			Date.parse(managed.record.leaseExpiresAtIso) <= this.now().getTime()
		) {
			// A definitive pre-dispatch rejection is safe to record under a fresh
			// claim, provided no successor has changed the operation meanwhile.
			const current = await executions.get(
				managed.claim.organizationId,
				managed.claim.intentId,
			);
			if (
				current?.generation === managed.claim.generation &&
				current.checkpoint === "prepared" &&
				current.state === "running"
			) {
				const owner = randomUUID();
				const reclaimed = await executions.claim({
					organizationId: managed.claim.organizationId,
					intentId: managed.claim.intentId,
					owner,
				});
				if (reclaimed) {
					managed.record = reclaimed;
					managed.claim = {
						organizationId: reclaimed.organizationId,
						intentId: reclaimed.intentId,
						generation: reclaimed.generation,
						owner,
					};
				}
			}
		}
		await this.advanceExecution(managed, {
			state: terminal ? "rejected" : "retryable",
			resultCode:
				terminal && error instanceof AppError
					? (error.code ?? "checkout_rejected")
					: replayTimedOut
						? "checkout_replay_timeout"
						: verificationUnavailable
							? "checkout_storefront_verification_unavailable"
							: checkpoint === "attached"
								? "checkout_url_unavailable"
								: "checkout_preparation_unavailable",
			releaseLease: true,
			eventType: "execution_failed",
			evidence: {
				stage,
				code: replayTimedOut
					? "checkout_replay_timeout"
					: terminal
						? "checkout_rejected"
						: "checkout_retryable",
			},
		});
		if (
			terminal &&
			checkoutRejectionCode(managed.record) === "checkout_pre_dispatch_rejected"
		)
			throw new AppError(
				error.message,
				error.status,
				"checkout_pre_dispatch_rejected",
			);
		if (
			terminal ||
			replayTimedOut ||
			(error instanceof AppError &&
				error.code === "checkout_restart_payment_uncertain")
		)
			throw error;
		throw checkoutFailureError(error);
	}

	private async recordKnownCartExpiry(
		intent: CheckoutIntentRecord,
		record: ClassCheckoutExecution,
	): Promise<ClassCheckoutExecution> {
		if (
			Date.parse(intent.expiresAtIso) > this.now().getTime() ||
			!["attached", "remote_cart_known"].includes(record.checkpoint) ||
			record.state === "recovery_required" ||
			["approved", "rejected", "needs_review", "superseded"].includes(
				intent.status,
			)
		)
			return record;
		const executions = this.checkout.classExecutions;
		if (!executions) throw new ClassCheckoutPersistenceUnavailableError();
		try {
			const recorded = await executions.recordApplicationExpiry({
				organizationId: record.organizationId,
				intentId: record.intentId,
				expectedGeneration: record.generation,
			});
			if (recorded) return recorded;
			const current = await executions.get(
				record.organizationId,
				record.intentId,
			);
			if (current?.state === "recovery_required") return current;
		} catch {
			throw new ClassCheckoutPersistenceUnavailableError();
		}
		throw new AppError(
			"Checkout execution has changed. Check its status before continuing.",
			409,
			"checkout_execution_changed",
		);
	}

	private async lookupCompletedCartUrl(
		input: Parameters<ClassCheckoutStorefront["checkout"]>[0],
	) {
		const controller = new AbortController();
		const error = new AppError(
			"Shopify took too long to return the checkout link. Check its status or try again.",
			503,
			"checkout_replay_timeout",
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				controller.abort(error);
				reject(error);
			}, CHECKOUT_REPLAY_TIMEOUT_MS);
		});
		try {
			return await Promise.race([
				this.storefront.checkout({ ...input, signal: controller.signal }),
				deadline,
			]);
		} finally {
			clearTimeout(timer);
		}
	}

	private async assertCompletedCartReplayCurrent(
		record: ClassCheckoutExecution,
	) {
		const current = await this.checkout
			.getClassCheckoutReplayState(record.organizationId, record.intentId)
			.catch(() => {
				throw new ClassCheckoutPersistenceUnavailableError();
			});
		if (current) {
			const currentRecord = { ...record, ...current };
			const resolved = resolvedCheckoutStatus(
				current.intentStatus,
				currentRecord,
			);
			if (resolved?.status === "resolved")
				throw new ClassCheckoutReplayResolvedError(resolved);
			if (current.state === "recovery_required")
				throw new ClassCheckoutRecoveryRequiredError(currentRecord);
			if (
				current.intentStatus === "checkout_started" &&
				current.state === "completed" &&
				current.generation === record.generation
			)
				return;
		}
		throw new AppError(
			"Checkout execution has changed. Check its status before continuing.",
			409,
			"checkout_execution_changed",
		);
	}

	private async resumeTrackedCart(
		intent: CheckoutIntentRecord,
		record: ClassCheckoutExecution,
	): Promise<ClassCheckoutResult> {
		await this.requireSafeReplacement(intent);
		if (
			["approved", "rejected", "needs_review", "superseded"].includes(
				intent.status,
			)
		)
			throw new AppError(
				"This checkout has already been resolved.",
				409,
				"checkout_already_completed",
			);
		if (Date.parse(intent.expiresAtIso) <= this.now().getTime()) {
			const expired = await this.recordKnownCartExpiry(intent, record);
			if (expired.state === "recovery_required")
				throw new ClassCheckoutRecoveryRequiredError(expired);
			throw new AppError("Checkout has expired.", 409, "checkout_expired");
		}
		let managed: ManagedClassCheckoutExecution | undefined;
		try {
			const integration = await this.organizations.getShopifyIntegration(
				intent.organizationId,
			);
			if (!integration)
				throw new AppError("Shopify checkout is unavailable.", 503);
			const binding = this.storefrontBinding(integration);
			const needsVerification = !sameStorefrontBinding(
				record.storefrontBinding,
				binding,
			);
			if (record.state !== "completed" || needsVerification) {
				const owner = randomUUID();
				const claimed = await this.checkout.classExecutions?.claim({
					organizationId: intent.organizationId,
					intentId: intent.id,
					owner,
					allowCompleted: needsVerification,
				});
				if (!claimed)
					throw new AppError(
						"Checkout is already in progress.",
						409,
						"checkout_in_progress",
					);
				managed = {
					record: claimed,
					claim: {
						organizationId: intent.organizationId,
						intentId: intent.id,
						owner,
						generation: claimed.generation,
					},
				};
				await this.verifyTrackedCartBinding(managed, intent, binding);
			}
			await this.checkout.markCheckoutStarted(intent.id);
			const lookup = {
				organizationId: intent.organizationId,
				shopifyCartId:
					managed?.record.shopifyCartId ?? record.shopifyCartId ?? "",
				expectedStorefrontBinding: binding,
			};
			const result =
				record.state === "completed"
					? await this.lookupCompletedCartUrl(lookup)
					: await this.storefront.checkout(lookup);
			const current = await this.organizations.getShopifyIntegration(
				intent.organizationId,
			);
			if (
				!current ||
				!sameStorefrontBinding(binding, this.storefrontBinding(current)) ||
				!isAllowedCheckoutUrl(result.checkoutUrl, current.storeDomain)
			)
				throw new AppError("Shopify checkout is unavailable.", 503);
			await this.requireSafeReplacement(intent);
			if (managed) {
				if (Date.parse(intent.expiresAtIso) <= this.now().getTime())
					return this.requireTrackedCartRecovery(managed, "checkout_expired");
				await this.advanceExecution(managed, {
					state: "completed",
					releaseLease: true,
					eventType: "checkout_ready",
				});
			}
			if (record.state === "completed") {
				const completed = managed?.record ?? record;
				await this.assertCompletedCartReplayCurrent(completed);
				if (Date.parse(intent.expiresAtIso) <= this.now().getTime())
					throw new ClassCheckoutRecoveryRequiredError(
						await this.recordKnownCartExpiry(intent, completed),
					);
			}
			return {
				checkoutUrl: result.checkoutUrl,
				intentId: intent.id,
				correlationId: intent.correlationId,
				intent,
			};
		} catch (error) {
			if (
				error instanceof ClassCheckoutReplayResolvedError ||
				error instanceof ClassCheckoutPersistenceUnavailableError
			)
				throw error;
			if (managed)
				return this.handleExecutionFailure(
					managed,
					"resume_checkout_url",
					error,
				);
			if (
				error instanceof ClassCheckoutRecoveryRequiredError ||
				(error instanceof AppError &&
					[
						"checkout_in_progress",
						"checkout_execution_changed",
						"checkout_restart_payment_uncertain",
					].includes(error.code ?? ""))
			)
				throw error;
			const replayTimedOut =
				error instanceof AppError && error.code === "checkout_replay_timeout";
			try {
				await this.checkout.classExecutions?.appendLateEvidence({
					organizationId: intent.organizationId,
					intentId: intent.id,
					generation: record.generation,
					eventType: "checkout_url_unavailable",
					evidence: {
						stage: "resume_checkout_url",
						code: replayTimedOut
							? "checkout_replay_timeout"
							: "checkout_retryable",
					},
				});
			} catch {
				throw new ClassCheckoutPersistenceUnavailableError();
			}
			if (replayTimedOut) throw error;
			throw checkoutFailureError(error);
		}
	}

	async recoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}): Promise<ClassCheckoutRecoveryStatus> {
		const executions = this.checkout.classExecutions;
		if (!executions)
			throw new AppError("Checkout recovery is unavailable.", 503);
		let record = await executions.getByRecoveryReference(
			input.organizationId,
			input.recoveryReference,
		);
		const intent = record
			? await this.checkout.findIntentById?.(
					input.organizationId,
					record.intentId,
				)
			: null;
		if (!record || !intent || record.customerId !== input.customerId)
			throw new AppError("Checkout recovery was not found.", 404);
		if (input.festivalShortName) {
			const snapshot = record.requestSnapshot as {
				festivalShortName?: string | null;
			};
			if (
				snapshot.festivalShortName &&
				snapshot.festivalShortName !== input.festivalShortName
			)
				throw new AppError("Checkout recovery was not found.", 404);
		}
		await executions.reapExpired(input.organizationId, record.intentId);
		record =
			(await executions.get(input.organizationId, record.intentId)) ?? record;
		const legacyInvalid = await this.legacyInvalidCartRecovery(
			record,
			input.festivalShortName,
		);
		if (legacyInvalid) return legacyInvalid.recovery;
		record = await this.recordKnownCartExpiry(intent, record);
		const status = recoveryStatusFor(record);
		const resolved = resolvedCheckoutStatus(intent.status, record);
		if (resolved) return resolved;
		if (
			input.idempotencyKey !== intent.idempotencyKey ||
			input.sessionId !== intent.sessionId
		)
			return { ...status, retryAllowed: false };
		if (
			record.checkpoint === "attached" &&
			record.shopifyCartId &&
			(record.state === "completed" || record.state === "retryable")
		) {
			try {
				const ready = await this.resumeTrackedCart(intent, record);
				return {
					...status,
					status: "ready",
					checkoutUrl: ready.checkoutUrl,
					correlationId: ready.correlationId,
				};
			} catch (error) {
				if (
					error instanceof ClassCheckoutRecoveryRequiredError ||
					error instanceof ClassCheckoutReplayResolvedError
				)
					return error.recovery;
				if (error instanceof ClassCheckoutPersistenceUnavailableError)
					throw error;
				if (
					error instanceof AppError &&
					error.code === "checkout_restart_payment_uncertain"
				)
					return {
						...status,
						status: "recovery_required",
						retryAllowed: false,
						reasonCode: error.code,
					};
				return {
					...status,
					reasonCode:
						error instanceof AppError
							? (error.code ?? "checkout_url_unavailable")
							: "checkout_url_unavailable",
				};
			}
		}
		return status;
	}

	async findUnissuedCartRestart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
	}): Promise<{ recoveryReference: string | null }> {
		const record =
			await this.checkout.classExecutions?.findUnissuedInvalidCartRestart({
				...input,
				festivalShortName: input.festivalShortName.trim().toLowerCase(),
			});
		return { recoveryReference: record?.recoveryReference ?? null };
	}

	async restartUnissuedCart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
		recoveryReference: string;
	}): Promise<ClassCheckoutRestartDto> {
		const executions = this.checkout.classExecutions;
		if (!executions || !this.checkout.listCheckoutRegistrationSnapshots)
			throw new AppError("Checkout restart is unavailable.", 503);
		const { organizationId, customerId } = input;
		const record = await executions.getByRecoveryReference(
			organizationId,
			input.recoveryReference,
		);
		const intent =
			record &&
			(await this.checkout.findIntentById?.(organizationId, record.intentId));
		if (
			!record ||
			!intent ||
			record.customerId !== customerId ||
			intent.customerId !== customerId
		)
			throw new AppError("Checkout recovery was not found.", 404);

		const festival = await this.organizations.findFestivalByShortName(
			organizationId,
			input.festivalShortName.trim(),
		);
		const saved = await this.checkout.listCheckoutRegistrationSnapshots(
			organizationId,
			intent.id,
		);
		if (
			!festival ||
			(saved.length > 0 &&
				saved.some(
					({ registrationSnapshot }) =>
						registrationSnapshot.class.festivalId !== festival.id,
				))
		)
			throw new AppError("Checkout recovery was not found.", 404);
		const lines = intent.lines ?? [];
		const snapshots = new Map(
			saved.map(({ checkoutIntentLineId, registrationSnapshot }) => [
				checkoutIntentLineId,
				registrationSnapshot,
			]),
		);
		if (!lines.length || snapshots.size !== lines.length)
			throw new AppError(
				"The previous registrations could not be restored.",
				409,
				"checkout_restart_unavailable",
			);

		const [children, classes] = await Promise.all([
			this.customers.listChildren(organizationId, customerId),
			this.organizations.listFestivalClassConfigurations(
				organizationId,
				festival.id,
			),
		]);
		const registrations = lines.map(
			(line): ClassCheckoutRestartRegistration => {
				const selection = snapshots.get(line.id);
				if (
					!line.childId ||
					!selection ||
					selection.class.id !== line.festivalClassId
				)
					throw new AppError(
						"The previous registrations could not be restored.",
						409,
						"checkout_restart_unavailable",
					);
				const currentClass = classes.find(
					(entry) => entry.id === selection.class.id,
				);
				return {
					lineId: line.id,
					childId: line.childId,
					childName:
						children.find((child) => child.id === line.childId)?.displayName ??
						"Performer",
					divisionId: selection.division.id,
					divisionName: selection.division.name ?? "Division",
					teacherId: selection.teacher.customerId,
					teacherName: selection.teacher.name ?? "Teacher",
					classId: selection.class.id,
					className: selection.class.displayName,
					classSubtypeId: selection.class.classSubtypeId,
					classSubtypeName: selection.class.classSubtypeName,
					minimumAge: selection.class.minimumAge,
					maximumAge: selection.class.maximumAge,
					priceCents: Math.round(
						Number(currentClass?.price ?? selection.class.price) * 100,
					),
					accompanistId: selection.accompanist?.customerId ?? null,
					accompanistName: selection.accompanist?.name ?? null,
					...(selection.instrument === "unknown"
						? {}
						: {
								instrumentId: selection.instrument.id,
								instrumentName: selection.instrument.name,
							}),
					pieces: selection.repertoire,
				};
			},
		);
		const replacement = await executions.restartUnissuedInvalidCart({
			organizationId,
			customerId,
			intentId: intent.id,
		});
		if (!replacement)
			throw new AppError(
				"The previous checkout may still accept payment. Its registrations are saved while the payment status is checked.",
				409,
				"checkout_restart_unavailable",
			);
		return { replacementKey: replacement.replacementKey, registrations };
	}

	async getRecoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}) {
		return this.recoveryStatus(input);
	}

	async listRecoveries(input: { organizationId: string; customerId?: string }) {
		const executions = this.checkout.classExecutions;
		if (!executions)
			throw new AppError("Checkout recovery is unavailable.", 503);
		const records = await executions.listRecovery(
			input.organizationId,
			input.customerId,
		);
		return Promise.all(
			records.map(async (record) => ({
				...recoveryStatusFor(record),
				generation: record.generation,
				intentId: record.intentId,
				checkpoint: record.checkpoint,
				updatedAtIso: record.updatedAtIso,
				events: (
					await executions.events(input.organizationId, record.intentId)
				).map((event) => ({
					id: event.id,
					eventType: event.eventType,
					generation: event.generation,
					occurredAtIso: event.createdAtIso,
					code: event.evidence.code,
					stage: event.evidence.stage,
					actorId: event.evidence.actorId,
					resolution: event.evidence.resolution,
					hasCartEvidence: Boolean(event.evidence.shopifyCartId),
				})),
			})),
		);
	}

	async reapExpiredRecoveries(input: { organizationId: string }) {
		return (
			this.checkout.classExecutions?.reapExpired(input.organizationId) ?? 0
		);
	}

	async resolveRecovery(input: {
		organizationId: string;
		recoveryReference: string;
		expectedGeneration: number;
		actorId: string;
		reason: string;
		action: "adopt_cart" | "retry_pre_dispatch" | "abandon_unknown";
		shopifyCartId?: string;
		evidenceEventId?: string;
		acknowledgeUnknown?: boolean;
	}) {
		const executions = this.checkout.classExecutions;
		if (!executions)
			throw new AppError("Checkout recovery is unavailable.", 503);
		if (
			!input.reason.trim() ||
			input.reason.length > 500 ||
			Array.from(input.reason).some(
				(character) => character.charCodeAt(0) < 32,
			) ||
			/https?:\/\/|gid:\/\/|bearer\s|(?:token|secret|password)\s*[:=]/i.test(
				input.reason,
			)
		)
			throw new AppError(
				"Provide a short recovery reason without credentials or provider identifiers.",
				400,
			);
		const record = await executions.getByRecoveryReference(
			input.organizationId,
			input.recoveryReference,
		);
		const intent = record
			? await this.checkout.findIntentById?.(
					input.organizationId,
					record.intentId,
				)
			: null;
		if (!record || !intent)
			throw new AppError("Checkout recovery was not found.", 404);
		if (
			record.state !== "recovery_required" ||
			record.generation !== input.expectedGeneration
		)
			throw new AppError(
				"Checkout recovery has changed.",
				409,
				"checkout_recovery_conflict",
			);
		if (input.action === "abandon_unknown" && input.acknowledgeUnknown !== true)
			throw new AppError(
				"Acknowledge that Shopify cancellation is unverified.",
				400,
				"checkout_recovery_acknowledgement_required",
			);
		let storefrontBinding: ClassCheckoutStorefrontBinding | undefined;
		let cartId = input.shopifyCartId ?? record.shopifyCartId ?? undefined;
		if (input.action === "adopt_cart") {
			if (Date.parse(intent.expiresAtIso) <= this.now().getTime())
				throw new AppError("Checkout has expired.", 409, "checkout_expired");
			if (input.evidenceEventId || !cartId) {
				const observations = (
					await executions.events(input.organizationId, intent.id)
				).filter(
					(event) =>
						(!input.evidenceEventId || event.id === input.evidenceEventId) &&
						Boolean(event.evidence.shopifyCartId),
				);
				const observedIds = [
					...new Set(
						observations
							.map((event) => event.evidence.shopifyCartId)
							.filter((value): value is string => Boolean(value)),
					),
				];
				if (observedIds.length !== 1)
					throw new AppError(
						"Select one unambiguous recorded cart observation.",
						409,
						"checkout_recovery_evidence_required",
					);
				cartId = observedIds[0];
			}
			if (!cartId)
				throw new AppError(
					"A verifiable Shopify cart is required.",
					409,
					"checkout_recovery_evidence_required",
				);
			const integration = await this.organizations.getShopifyIntegration(
				input.organizationId,
			);
			if (!integration)
				throw new AppError("Shopify checkout is unavailable.", 503);
			storefrontBinding = this.storefrontBinding(integration);
			await this.verifyShopifyCartEvidence(
				intent,
				cartId,
				storefrontBinding,
				record.storefrontBinding,
			);
			if (Date.parse(intent.expiresAtIso) <= this.now().getTime())
				throw new AppError("Checkout has expired.", 409, "checkout_expired");
		} else cartId = undefined;
		const resolved = await executions.resolve({
			organizationId: input.organizationId,
			intentId: intent.id,
			expectedGeneration: input.expectedGeneration,
			actorId: input.actorId,
			reason: input.reason.trim(),
			action:
				input.action === "adopt_cart"
					? "resume_known_cart"
					: input.action === "abandon_unknown"
						? "abandon"
						: "retry_pre_dispatch",
			...(cartId ? { shopifyCartId: cartId } : {}),
			...(storefrontBinding ? { storefrontBinding } : {}),
		});
		if (!resolved)
			throw new AppError(
				"Checkout recovery has changed.",
				409,
				"checkout_recovery_conflict",
			);
		return { ...recoveryStatusFor(resolved), generation: resolved.generation };
	}

	private async resume(
		outcome: {
			intent: CheckoutIntentRecord;
			cart: CheckoutCartRecord | { shopifyCartId: string };
		},
		input: StartClassCheckoutInput,
	): Promise<ClassCheckoutResult> {
		assertCheckoutIntentType(outcome.intent, "class_entry");
		const executions = this.checkout.classExecutions;
		const record = await executions?.get(
			input.organizationId,
			outcome.intent.id,
		);
		if (record && executions) {
			const current = await this.checkExistingExecution(
				executions,
				input,
				outcome.intent,
				record,
			);
			if (current.checkpoint === "attached" && current.shopifyCartId)
				return this.resumeTrackedCart(outcome.intent, current);
			throw new AppError(
				"Checkout execution has changed. Check its status before continuing.",
				409,
				"checkout_execution_changed",
			);
		}
		let stage: ClassCheckoutFailureStage = "resume_load_integration";
		try {
			const storefrontIntegration =
				await this.organizations.getShopifyIntegration(input.organizationId);
			if (!storefrontIntegration) {
				throw new AppError("Shopify checkout is unavailable.", 503);
			}
			stage = "resume_mark_checkout_started";
			await this.checkout.markCheckoutStarted(outcome.intent.id);
			stage = "resume_checkout_url";
			const checkout = await this.storefront.checkout({
				organizationId: input.organizationId,
				shopifyCartId: outcome.cart.shopifyCartId,
			});
			stage = "resume_verify_checkout_url";
			const integration = await this.organizations.getShopifyIntegration(
				input.organizationId,
			);
			if (
				!integration ||
				integration.integrationVersion !==
					storefrontIntegration.integrationVersion ||
				!isAllowedCheckoutUrl(checkout.checkoutUrl, integration.storeDomain)
			) {
				throw new AppError("Shopify checkout is unavailable.", 503);
			}
			return {
				checkoutUrl: checkout.checkoutUrl,
				intentId: outcome.intent.id,
				correlationId: outcome.intent.correlationId,
				intent: outcome.intent,
			};
		} catch (error) {
			return this.reportAndMarkFailed({
				stage,
				organizationId: input.organizationId,
				intent: outcome.intent,
				lineCount: outcome.intent.lines?.length ?? 0,
				error,
				markFailedStage: "resume_mark_failed",
			});
		}
	}

	private async reportAndMarkFailed(params: {
		stage: ClassCheckoutFailureStage;
		organizationId: string;
		intent: CheckoutIntentRecord;
		lineCount: number;
		error: unknown;
		markFailedStage: "mark_failed" | "resume_mark_failed";
	}): Promise<never> {
		this.logFailure(params);
		try {
			await this.checkout.markFailed(params.intent.id);
		} catch (markFailedError) {
			this.logFailure({
				...params,
				stage: params.markFailedStage,
				error: markFailedError,
			});
			throw checkoutFailureError(markFailedError);
		}
		throw params.error instanceof AppError &&
			params.error.code === "registration_closed"
			? params.error
			: checkoutFailureError(params.error);
	}

	private logFailure(params: {
		stage: ClassCheckoutFailureStage;
		organizationId: string;
		intent: CheckoutIntentRecord;
		lineCount: number;
		error: unknown;
	}): void {
		const postgres = postgresDiagnostic(params.error);
		this.failureLogger.error("Class checkout failed.", {
			operation: "checkout.class",
			stage: params.stage,
			organizationId: params.organizationId,
			checkoutIntentId: params.intent.id,
			correlationId: params.intent.correlationId,
			lineCount: params.lineCount,
			...safeErrorDiagnostic(params.error),
			...postgres,
		});
	}
}

function checkoutFailureError(error: unknown): AppError {
	return postgresDiagnostic(error)
		? databaseCheckoutError()
		: retryableCheckoutError();
}

function databaseCheckoutError(): AppError {
	return new AppError(
		"We couldn't save this class registration. Please try again.",
		500,
		"checkout_database_failure",
	);
}

function retryableCheckoutError(): AppError {
	return new AppError(
		"Shopify checkout is temporarily unavailable. Please try again.",
		503,
		"checkout_retryable_upstream",
	);
}

function safeErrorDiagnostic(error: unknown): {
	errorName?: "AppError" | "Error" | "PostgresError";
	errorCode?: string;
} {
	if (isPostgresError(error)) {
		const code = readStringProperty(error, "code");
		return {
			errorName: "PostgresError",
			...(code && /^ERR_POSTGRES_[A-Z0-9_]{1,96}$/.test(code)
				? { errorCode: code }
				: {}),
		};
	}
	if (error instanceof AppError) {
		return {
			errorName: "AppError",
			...(error.code ? { errorCode: error.code } : {}),
		};
	}
	return error instanceof Error ? { errorName: "Error" } : {};
}

function postgresDiagnostic(error: unknown): {
	databaseSqlState?: string;
	databaseConstraint?: string;
	databaseTable?: string;
	databaseColumn?: string;
} | null {
	if (!isPostgresError(error)) return null;
	return {
		...safeSqlState(readStringProperty(error, "errno")),
		...safeDatabaseIdentifier(
			"databaseConstraint",
			readStringProperty(error, "constraint"),
		),
		...safeDatabaseIdentifier(
			"databaseTable",
			readStringProperty(error, "table"),
		),
		...safeDatabaseIdentifier(
			"databaseColumn",
			readStringProperty(error, "column"),
		),
	};
}

function isPostgresError(error: unknown): error is object {
	return (
		!!error &&
		typeof error === "object" &&
		readStringProperty(error, "name") === "PostgresError"
	);
}

function readStringProperty(
	value: object,
	property: string,
): string | undefined {
	const candidate = (value as Record<string, unknown>)[property];
	return typeof candidate === "string" ? candidate : undefined;
}

function safeSqlState(value: string | undefined): {
	databaseSqlState?: string;
} {
	return value && /^[0-9A-Z]{5}$/.test(value)
		? { databaseSqlState: value }
		: {};
}

function safeDatabaseIdentifier(
	property: "databaseConstraint" | "databaseTable" | "databaseColumn",
	value: string | undefined,
): Partial<
	Record<"databaseConstraint" | "databaseTable" | "databaseColumn", string>
> {
	return value && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)
		? { [property]: value }
		: {};
}

function isAllowedCheckoutUrl(value: string, storeDomain: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			url.hostname === storeDomain.toLowerCase() &&
			url.port === ""
		);
	} catch {
		return false;
	}
}
