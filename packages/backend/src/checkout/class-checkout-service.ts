import { randomUUID } from "node:crypto";
import type { FestivalRecord, RepertoirePiece } from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "./checkout-repository.js";

export interface ClassCheckoutStorefront {
	createCart(input: {
		organizationId: string;
		shopifyVariantGid: string;
		buyerAccessToken: string;
		correlationId: string;
	}): Promise<{ shopifyCartId: string }>;
	checkout(input: {
		organizationId: string;
		shopifyCartId: string;
	}): Promise<{ checkoutUrl: string }>;
}

export interface StartClassCheckoutInput {
	organizationId: string;
	organizationSlug?: string;
	festivalId?: string;
	festivalShortName?: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	festivalClassId: string;
	childId: string;
	divisionId?: string;
	buyerAccessToken: string;
	integrationVersion?: string | number;
	teacherId: string;
	accompanistId?: string | null;
	pieces: RepertoirePiece[];
	currency?: string;
	currencyCode?: string;
}

export interface ClassCheckoutResult {
	checkoutUrl: string;
	intentId: string;
	correlationId: string;
	intent?: CheckoutIntentRecord;
}

const MAX_SNAPSHOT_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

export class ClassCheckoutService {
	constructor(
		private readonly organizations: OrganizationRepository,
		private readonly customers: CustomerAccountRepository,
		private readonly checkout: CheckoutRepository,
		private readonly storefront: ClassCheckoutStorefront,
		_commerce?: MembershipCommerceRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

	async start(input: StartClassCheckoutInput): Promise<ClassCheckoutResult> {
		if (
			!input.organizationId?.trim() ||
			!input.customerId?.trim() ||
			!input.sessionId?.trim()
		) {
			throw new AppError("Customer session is invalid.", 401);
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
		if (!input.buyerAccessToken?.trim()) {
			throw new AppError("Buyer access token is required.", 400);
		}

		// 1. Validates parent customer auth / session
		const session = await this.customers.getSession(input.sessionId);
		const currentTime = this.now();
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

		// 2. Check for existing checkout outcome by idempotency key
		const existing = await this.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing) {
			if (existing.kind === "in_progress") {
				throw new AppError(
					"Checkout is already in progress.",
					409,
					"checkout_in_progress",
				);
			}
			if (existing.kind === "active") {
				throw new AppError(
					"This checkout has already completed.",
					409,
					"checkout_already_completed",
				);
			}
			if (existing.kind === "expired") {
				throw new AppError("Checkout has expired.", 409, "checkout_expired");
			}
			if (existing.kind === "failed") {
				throw new AppError(
					"This checkout attempt cannot continue.",
					409,
					"checkout_terminal_failure",
				);
			}
			if (existing.kind === "ready") {
				return this.resume(existing, input);
			}
		}

		// 3. Verifies child belongs to parent customer
		const children = await this.customers.listChildren(
			input.organizationId,
			input.customerId,
		);
		const child = children.find((item) => item.id === input.childId);
		if (!child) {
			throw new AppError(
				"Child not found or does not belong to parent customer.",
				404,
			);
		}

		// 4. Verifies active age snapshot for child (<= 90 days validity)
		const snapshots = await this.customers.listChildAgeSnapshots(
			input.organizationId,
			input.childId,
		);
		const activeSnapshot = snapshots.find((item) => !item.supersededAtIso);
		if (!activeSnapshot) {
			throw new AppError("Child does not have an active age snapshot.", 400);
		}

		const validUntil = new Date(activeSnapshot.validUntilIso);
		const snapshotAgeMs =
			currentTime.getTime() - new Date(activeSnapshot.createdAtIso).getTime();
		if (validUntil <= currentTime || snapshotAgeMs > MAX_SNAPSHOT_VALIDITY_MS) {
			throw new AppError("Child age snapshot has expired.", 400);
		}

		// 5. Verifies class configuration exists, is active, and is tied to the target festival and organization
		const festivals = await this.organizations.listFestivals(
			input.organizationId,
		);
		let targetFestival: FestivalRecord | undefined;
		if (input.festivalId?.trim() && input.festivalShortName?.trim()) {
			const targetShortName = input.festivalShortName.trim().toLowerCase();
			targetFestival = festivals.find(
				(item) =>
					item.id === input.festivalId?.trim() &&
					item.shortName.toLowerCase() === targetShortName,
			);
		} else if (input.festivalId?.trim()) {
			targetFestival = festivals.find(
				(item) => item.id === input.festivalId?.trim(),
			);
		} else if (input.festivalShortName?.trim()) {
			const targetShortName = input.festivalShortName.trim().toLowerCase();
			targetFestival = festivals.find(
				(item) => item.shortName.toLowerCase() === targetShortName,
			);
		} else {
			targetFestival = festivals.find((item) => item.isPrimary);
		}
		if (!targetFestival) {
			throw new AppError("Active festival not found.", 404);
		}

		const classConfigs =
			await this.organizations.listFestivalClassConfigurations(
				input.organizationId,
				targetFestival.id,
				false,
			);
		const classConfig = classConfigs.find(
			(item) => item.id === input.festivalClassId,
		);
		if (!classConfig) {
			for (const otherFest of festivals) {
				if (otherFest.id === targetFestival.id) continue;
				const otherConfigs =
					await this.organizations.listFestivalClassConfigurations(
						input.organizationId,
						otherFest.id,
						false,
					);
				if (otherConfigs.some((item) => item.id === input.festivalClassId)) {
					throw new AppError(
						"Festival class configuration does not belong to the active festival.",
						400,
					);
				}
			}
			throw new AppError("Festival class configuration not found.", 404);
		}
		if (!classConfig.isActive) {
			throw new AppError("Festival class configuration is inactive.", 400);
		}
		if (
			classConfig.organizationId !== input.organizationId ||
			classConfig.festivalId !== targetFestival.id
		) {
			throw new AppError(
				"Festival class configuration does not belong to the active festival.",
				400,
			);
		}

		// 6. Verifies child's age meets festival_class_configurations [minimum_age, maximum_age] rules
		const childAge = activeSnapshot.age;
		if (
			childAge < classConfig.minimumAge ||
			childAge > classConfig.maximumAge
		) {
			throw new AppError(
				`Child age (${childAge}) is outside the allowed range of [${classConfig.minimumAge}, ${classConfig.maximumAge}].`,
				400,
			);
		}

		// 7. Validate pieces
		if (!Array.isArray(input.pieces) || input.pieces.length === 0) {
			throw new AppError("Repertoire pieces must be a non-empty array.", 400);
		}
		if (input.pieces.length > classConfig.maximumPerformancePieces) {
			throw new AppError(
				`Number of pieces (${input.pieces.length}) exceeds the maximum allowed (${classConfig.maximumPerformancePieces}).`,
				400,
			);
		}
		for (const piece of input.pieces) {
			if (!piece || typeof piece.title !== "string" || !piece.title.trim()) {
				throw new AppError(
					"Each repertoire piece must have a valid title.",
					400,
				);
			}
			if (typeof piece.composer !== "string" || !piece.composer.trim()) {
				throw new AppError(
					"Each repertoire piece must have a valid composer.",
					400,
				);
			}
			if (
				piece.movement !== undefined &&
				piece.movement !== null &&
				typeof piece.movement !== "string"
			) {
				throw new AppError(
					"Each repertoire piece must have a valid movement.",
					400,
				);
			}
			if (
				typeof piece.durationSeconds !== "number" ||
				piece.durationSeconds <= 0 ||
				!Number.isSafeInteger(piece.durationSeconds) ||
				piece.durationSeconds > 2_147_483_647
			) {
				throw new AppError(
					"Each repertoire piece must have a positive whole-number duration in seconds.",
					400,
				);
			}
		}
		// Relational snapshots use the validated, display-ready values.
		const normalizedPieces: RepertoirePiece[] = input.pieces.map((piece) => ({
			title: piece.title.trim(),
			composer: piece.composer.trim(),
			movement:
				typeof piece.movement === "string"
					? piece.movement.trim() || undefined
					: undefined,
			durationSeconds: piece.durationSeconds,
		}));
		const totalDurationMinutes =
			normalizedPieces.reduce((sum, p) => sum + p.durationSeconds, 0) / 60;
		if (totalDurationMinutes > classConfig.performanceMinutes) {
			throw new AppError(
				`Total performance duration (${totalDurationMinutes} minutes) exceeds the maximum allowed of ${classConfig.performanceMinutes} minutes.`,
				400,
			);
		}

		// 8. Resolve teacherId
		const teacherGrants =
			await this.organizations.listEntitlementGrantSnapshots(
				input.organizationId,
				input.teacherId.trim(),
			);
		const activeTeacherGrant = teacherGrants.find(
			(grant) =>
				grant.entitlementClass === "teacher_membership" &&
				grant.divisionId === classConfig.divisionId &&
				grant.status === "active",
		);
		if (!activeTeacherGrant) {
			throw new AppError(
				"Selected teacher does not have an active membership for this division.",
				400,
			);
		}
		const teacherEntitlementId = activeTeacherGrant.id;

		// 9. Resolve optional accompanistId
		let accompanistEntitlementId: string | null = null;
		if (input.accompanistId?.trim()) {
			const accompanistGrants =
				await this.organizations.listAccompanistMembershipGrants({
					organizationId: input.organizationId,
					customerId: input.accompanistId.trim(),
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

		// 10. Check if checkout is already in progress
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

		// 11. Creates a checkout intent with intent_type: 'class_entry'
		const expiresAtIso = new Date(
			currentTime.getTime() + 30 * 60_000,
		).toISOString();
		const currencyCode = input.currencyCode ?? input.currency ?? "USD";

		const outcome = await this.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			intentType: "class_entry",
			festivalClassId: classConfig.id,
			divisionId: classConfig.divisionId,
			childId: child.id,
			shopifyProductGid: classConfig.shopifyProductGid,
			shopifyVariantGid: classConfig.shopifyVariantGid,
			amount: classConfig.price,
			currencyCode,
			expiresAtIso,
		});

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
		if (outcome.kind === "ready") {
			return this.resume(outcome, input);
		}

		const intent = outcome.intent;

		// 12. Insert registration_metadata
		await this.checkout.insertRegistrationMetadata({
			id: randomUUID(),
			organizationId: input.organizationId,
			festivalId: targetFestival.id,
			checkoutIntentId: intent.id,
			teacherMembershipId: teacherEntitlementId,
			accompanistMembershipId: accompanistEntitlementId,
			repertoireJson: input.pieces,
			repertoireSnapshotPieces: normalizedPieces,
		});

		// 13. Storefront cart, checkout, and verification
		try {
			const storefrontIntegration =
				await this.organizations.getShopifyIntegration(input.organizationId);
			if (!storefrontIntegration) {
				throw new AppError("Shopify checkout is unavailable.", 503);
			}

			const cartResponse = await this.storefront.createCart({
				organizationId: input.organizationId,
				shopifyVariantGid: classConfig.shopifyVariantGid,
				buyerAccessToken: input.buyerAccessToken,
				correlationId: intent.correlationId,
			});

			const integrationVersion =
				typeof input.integrationVersion === "number"
					? input.integrationVersion
					: Number(input.integrationVersion) || session.integrationVersion || 1;

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
		} catch (_error) {
			await this.checkout.markFailed(intent.id);
			throw retryableCheckoutError();
		}
	}

	private async resume(
		outcome: { intent: CheckoutIntentRecord; cart: { shopifyCartId: string } },
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
