import { randomUUID } from "node:crypto";
import type {
	AccompanistMembershipGrant,
	ClassCheckoutLineItemInput,
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
	evaluatePurchaseEligibility,
	isFestivalRegistrationOpen,
	stripCandidateMarker,
} from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { AppError } from "../errors/app-error.js";
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
	CheckoutRepository,
	CreateCheckoutIntentLineInput,
} from "./checkout-repository.js";
import { CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL } from "./checkout-repository.js";
import {
	buildEligibilityRejectionError,
	calculateTotalAmount,
	resolveFestivalClassConfiguration,
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
	createCart(input: {
		organizationId: string;
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
	}): Promise<{ checkoutUrl: string }>;
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

export class ClassCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly customers: CustomerAccountRepository,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: ClassCheckoutStorefront,
		private readonly commerce?: MembershipCommerceRepository,
		private readonly now: () => Date = () => new Date(),
		private readonly failureLogger: ClassCheckoutFailureLogger = silentClassCheckoutFailureLogger,
	) {}

	async evaluateEligibility(
		input: EvaluatePurchaseEligibilityInput,
		preloaded?: {
			targetFestival?: FestivalRecord;
			children?: Map<string, FestivalChildRecord | null>;
			classes?: Map<string, FestivalClassConfiguration>;
		},
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

		const activeEntitlements = await this.loadTargetedEntitlements({
			organizationId: input.organizationId,
			festivalId: targetFestival.id,
			uniqueClassIds,
			uniqueChildIds,
			classes,
		});
		const [subtypes, timezone] = await Promise.all([
			this.organizations.listRegistrationCatalogValues(
				input.organizationId,
				"class_subtype",
			),
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
		const existing = await this.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing) {
			if (existing.kind === "ready") return this.resume(existing, input);
			this.handleOutcome(existing);
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
			await this.checkout.hasProcessingIntent(
				input.organizationId,
				input.customerId,
				currentTime.toISOString(),
			)
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
		const expiresAtIso = new Date(
			currentTime.getTime() + 30 * 60_000,
		).toISOString();
		const eligibilityResults = await this.checkEligibility(
			input.organizationId,
			input.customerId,
			targetFestivalId,
			lineItems,
			caches,
		);
		await this.captureRegistrationSnapshots(
			input.organizationId,
			validatedLines,
			lineItems,
			caches,
			currencyCode,
			currentTime.toISOString(),
		);
		const outcome = await this.createMultiLineIntent(
			input,
			validatedLines,
			currencyCode,
			expiresAtIso,
		);
		if (outcome.kind === "ready") return this.resume(outcome, input);
		this.handleOutcome(outcome);
		if (outcome.kind !== "created")
			throw new AppError("Failed to create checkout intent.", 500);

		return this.executeStorefrontCheckout(
			input,
			targetFestivalId,
			eligibilityResults,
			outcome.intent,
			validatedLines,
			currencyCode,
			expiresAtIso,
			session.integrationVersion || 1,
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
		const normalizedPieces = validateAndNormalizeRepertoirePieces(
			line.pieces,
			classConfig,
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
		caches: LineValidationCaches,
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
			{
				children: caches.children,
				classes: caches.classConfigs,
			},
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
			this.organizations.listRegistrationCatalogValues(
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
		const cartResponse = await this.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: validatedLines[0].classConfig.shopifyVariantGid,
			lines: cartLines,
			buyerAccessToken: input.buyerAccessToken,
			correlationId: intent.correlationId,
			currencyCode,
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
		};
		let cart: CheckoutCartRecord;
		try {
			cart = this.checkout.markIntentReady
				? await this.checkout.markIntentReady(attachCartInput)
				: await this.checkout.attachCart(attachCartInput);
		} catch (error) {
			if (error instanceof AppError && error.code === "sold_out") {
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

		setStage("mark_checkout_started");
		await this.checkout.markCheckoutStarted(intent.id);

		setStage("checkout_url");
		const checkout = await this.storefront.checkout({
			organizationId: input.organizationId,
			shopifyCartId: cart.shopifyCartId,
		});

		setStage("verify_checkout_url");
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
				setStage: (nextStage) => {
					stage = nextStage;
				},
			});
		} catch (error) {
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

	private async resume(
		outcome: {
			intent: CheckoutIntentRecord;
			cart: CheckoutCartRecord | { shopifyCartId: string };
		},
		input: { organizationId: string },
	): Promise<ClassCheckoutResult> {
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
