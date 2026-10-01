import { randomUUID } from "node:crypto";
import type {
	ClassCheckoutLineItemInput,
	EvaluatePurchaseEligibilityResponse,
	FestivalChildRecord,
	FestivalClassConfiguration,
	FestivalRecord,
	ProposedPurchaseLineItem,
	RepertoirePiece,
} from "@festival/common";
import { evaluatePurchaseEligibility } from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	CheckoutCartRecord,
	CheckoutIntentOutcome,
	CheckoutIntentRecord,
	CheckoutRepository,
	CreateCheckoutIntentLineInput,
} from "./checkout-repository.js";
import {
	calculateTotalAmount,
	resolveFestivalClassConfiguration,
	resolveTargetFestival,
	validateActiveChildAgeSnapshot,
	validateAndNormalizeRepertoirePieces,
	validateChildAgeRange,
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
	pieces?: RepertoirePiece[];
	lineItems?: ClassCheckoutLineItemInput[];
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
}

export class ClassCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly customers: CustomerAccountRepository,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: ClassCheckoutStorefront,
		private readonly commerce?: MembershipCommerceRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async evaluateEligibility(input: {
		organizationId: string;
		festivalId?: string;
		festivalShortName?: string;
		items: ProposedPurchaseLineItem[];
	}): Promise<EvaluatePurchaseEligibilityResponse> {
		const festivals = await this.organizations.listFestivals(
			input.organizationId,
		);
		const targetFestival = resolveTargetFestival(festivals, {
			festivalId: input.festivalId,
			festivalShortName: input.festivalShortName,
		});
		const classes = await this.organizations.listFestivalClassConfigurations(
			input.organizationId,
			targetFestival.id,
			false,
		);
		const subtypes = await this.organizations.listRegistrationCatalogValues(
			input.organizationId,
			"class_subtype",
		);
		const activeEntitlements = this.commerce
			? await this.commerce.listClassEntitlements({
					organizationId: input.organizationId,
					festivalId: targetFestival.id,
				})
			: [];
		return evaluatePurchaseEligibility({
			organizationId: input.organizationId,
			festivalId: targetFestival.id,
			items: input.items,
			classes,
			subtypes,
			activeEntitlements,
		});
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
		const festivals = await this.organizations.listFestivals(
			input.organizationId,
		);
		const targetFestival = resolveTargetFestival(festivals, {
			festivalId: input.festivalId,
			festivalShortName: input.festivalShortName,
		});
		const lineItems = this.normalizeLineItems(input);
		const children = await this.customers.listChildren(
			input.organizationId,
			input.customerId,
		);
		const validatedLines: ValidatedLineItem[] = [];
		for (const line of lineItems) {
			const vl = await this.validateLine(input.organizationId, line, {
				targetFestival,
				festivals,
				children,
				currentTime,
				divisionId: lineItems.length === 1 ? input.divisionId : undefined,
			});
			validatedLines.push(vl);
		}
		await this.checkEligibility(
			input.organizationId,
			targetFestival.id,
			lineItems,
		);
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
			targetFestival,
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
			return input.lineItems;
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
			{
				festivalClassId: input.festivalClassId,
				childId: input.childId,
				teacherId: input.teacherId,
				accompanistId: input.accompanistId,
				pieces: input.pieces ?? [],
			},
		];
	}

	private async validateTeacherAndAccompanist(
		organizationId: string,
		divisionId: string,
		teacherId: string,
		accompanistId?: string | null,
	): Promise<{
		teacherEntitlementId: string;
		accompanistEntitlementId: string | null;
	}> {
		const teacherGrants =
			await this.organizations.listEntitlementGrantSnapshots(
				organizationId,
				teacherId.trim(),
			);
		const activeTeacherGrant = teacherGrants.find(
			(grant) =>
				grant.entitlementClass === "teacher_membership" &&
				grant.divisionId === divisionId &&
				grant.status === "active",
		);
		if (!activeTeacherGrant) {
			throw new AppError(
				"Selected teacher does not have an active membership for this division.",
				400,
			);
		}
		let accompanistEntitlementId: string | null = null;
		if (accompanistId?.trim()) {
			const accompanistGrants =
				await this.organizations.listAccompanistMembershipGrants({
					organizationId,
					customerId: accompanistId.trim(),
					currentOnly: true,
				});
			const activeAccompanistGrant = accompanistGrants.find(
				(grant) => grant.status === "active" || grant.isCurrent === true,
			);
			if (!activeAccompanistGrant) {
				throw new AppError(
					"Selected accompanist does not have an active membership.",
					400,
				);
			}
			accompanistEntitlementId = activeAccompanistGrant.id;
		}
		return {
			teacherEntitlementId: activeTeacherGrant.id,
			accompanistEntitlementId,
		};
	}

	private async validateLine(
		organizationId: string,
		line: ClassCheckoutLineItemInput,
		ctx: {
			targetFestival: FestivalRecord;
			festivals: FestivalRecord[];
			children: FestivalChildRecord[];
			currentTime: Date;
			divisionId?: string;
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
		const child = ctx.children.find((c) => c.id === line.childId);
		if (!child) {
			throw new AppError(
				"Child not found or does not belong to parent customer.",
				404,
			);
		}
		const snapshots = await this.customers.listChildAgeSnapshots(
			organizationId,
			line.childId,
		);
		const activeSnapshot = validateActiveChildAgeSnapshot(
			snapshots,
			ctx.currentTime,
		);
		const classConfig = await resolveFestivalClassConfiguration(
			this.organizations,
			{
				organizationId,
				targetFestival: ctx.targetFestival,
				festivals: ctx.festivals,
				festivalClassId: line.festivalClassId,
				divisionId:
					(line as { divisionId?: string }).divisionId ?? ctx.divisionId,
			},
		);
		validateChildAgeRange(activeSnapshot.age, classConfig);
		const normalizedPieces = validateAndNormalizeRepertoirePieces(
			line.pieces,
			classConfig,
		);
		const { teacherEntitlementId, accompanistEntitlementId } =
			await this.validateTeacherAndAccompanist(
				organizationId,
				classConfig.divisionId,
				line.teacherId,
				line.accompanistId,
			);
		return {
			child,
			classConfig,
			normalizedPieces,
			teacherEntitlementId,
			accompanistEntitlementId,
		};
	}

	private async checkEligibility(
		organizationId: string,
		festivalId: string,
		lineItems: ClassCheckoutLineItemInput[],
	): Promise<void> {
		const eligibility = await this.evaluateEligibility({
			organizationId,
			festivalId,
			items: lineItems,
		});
		if (!eligibility.isEligible) {
			const failure = eligibility.results.find((r) => !r.isEligible);
			throw new AppError(
				failure?.message ?? "Class registration is not eligible.",
				400,
				failure?.reasonCode?.toLowerCase(),
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
				divisionNameSnapshot: vl.classConfig.divisionId ?? null,
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
	): Promise<void> {
		for (let i = 0; i < validatedLines.length; i++) {
			const vl = validatedLines[i];
			const lineRecord = intent.lines?.[i];
			await this.checkout.insertRegistrationMetadata({
				id: randomUUID(),
				organizationId,
				festivalId,
				checkoutIntentId: intent.id,
				checkoutIntentLineId: lineRecord?.id ?? null,
				teacherMembershipId: vl.teacherEntitlementId,
				accompanistMembershipId: vl.accompanistEntitlementId,
				repertoireJson: vl.normalizedPieces,
				repertoireSnapshotPieces: vl.normalizedPieces,
			});
		}
	}

	private async createAndVerifyCart(params: {
		input: StartClassCheckoutInput;
		intent: CheckoutIntentRecord;
		validatedLines: ValidatedLineItem[];
		currencyCode: string;
		expiresAtIso: string;
		defaultIntegrationVersion: number;
	}): Promise<ClassCheckoutResult> {
		const { input, intent, validatedLines, currencyCode, expiresAtIso } =
			params;
		const storefrontIntegration =
			await this.organizations.getShopifyIntegration(input.organizationId);
		if (!storefrontIntegration) {
			throw new AppError("Shopify checkout is unavailable.", 503);
		}

		const cartLines = validatedLines.map((vl, index) => {
			const lineRecord = intent.lines?.[index];
			return {
				merchandiseId: vl.classConfig.shopifyVariantGid,
				quantity: 1,
				attributes: [
					{
						key: "festival_checkout_intent_line_id",
						value: lineRecord?.id ?? "",
					},
				],
			};
		});

		const cartResponse = await this.storefront.createCart({
			organizationId: input.organizationId,
			shopifyVariantGid: validatedLines[0].classConfig.shopifyVariantGid,
			lines: cartLines,
			buyerAccessToken: input.buyerAccessToken,
			correlationId: intent.correlationId,
			currencyCode,
		});

		const integrationVersion =
			typeof input.integrationVersion === "number"
				? input.integrationVersion
				: Number(input.integrationVersion) || params.defaultIntegrationVersion;

		const cart = await this.checkout.attachCart({
			intentId: intent.id,
			shopifyCartId: cartResponse.shopifyCartId,
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			integrationVersion,
			expiresAtIso,
		});

		await this.checkout.markCheckoutStarted(intent.id);

		const checkout = await this.storefront.checkout({
			organizationId: input.organizationId,
			shopifyCartId: cart.shopifyCartId,
		});

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
		targetFestival: FestivalRecord,
		intent: CheckoutIntentRecord,
		validatedLines: ValidatedLineItem[],
		currencyCode: string,
		expiresAtIso: string,
		defaultIntegrationVersion: number,
	): Promise<ClassCheckoutResult> {
		try {
			await this.insertAllRegistrationMetadata(
				input.organizationId,
				targetFestival.id,
				intent,
				validatedLines,
			);
			return await this.createAndVerifyCart({
				input,
				intent,
				validatedLines,
				currencyCode,
				expiresAtIso,
				defaultIntegrationVersion,
			});
		} catch (_error) {
			await this.checkout.markFailed(intent.id);
			throw retryableCheckoutError();
		}
	}

	private async resume(
		outcome: {
			intent: CheckoutIntentRecord;
			cart: CheckoutCartRecord | { shopifyCartId: string };
		},
		input: { organizationId: string },
	): Promise<ClassCheckoutResult> {
		try {
			const storefrontIntegration =
				await this.organizations.getShopifyIntegration(input.organizationId);
			if (!storefrontIntegration) {
				throw new AppError("Shopify checkout is unavailable.", 503);
			}
			await this.checkout.markCheckoutStarted(outcome.intent.id);
			const checkout = await this.storefront.checkout({
				organizationId: input.organizationId,
				shopifyCartId: outcome.cart.shopifyCartId,
			});
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
		} catch (_error) {
			await this.checkout.markFailed(outcome.intent.id);
			throw retryableCheckoutError();
		}
	}
}

function retryableCheckoutError(): AppError {
	return new AppError(
		"Shopify checkout is temporarily unavailable. Please try again.",
		503,
		"checkout_retryable_upstream",
	);
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
