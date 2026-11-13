import { AppError } from "@festival/common";
import {
	assertCheckoutIntentType,
	type CheckoutCartRecord,
	type CheckoutIntentRecord,
	type CheckoutRepository,
} from "./checkout-types.js";
import type { ClassCheckoutEventBus } from "./events.js";
import {
	assertNoDuplicateActiveMembershipOp,
	createAndAttachMembershipCartOp,
	type MembershipCheckoutHelperDeps,
	resolveMembershipOfferingAndProductOp,
	startMembershipStorefrontCheckoutOp,
	validateStartMembershipInput,
} from "./membership-checkout-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutOrganizationReadPort,
	CheckoutTeacherDirectoryPort,
	MembershipCheckoutStorefrontPort,
	MembershipListingsPort,
} from "./ports.js";

export type MembershipCheckoutStorefront = MembershipCheckoutStorefrontPort;

export interface StartTeacherMembershipCheckoutInput {
	organizationId: string;
	organizationSlug: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	buyerAccessToken: string;
	shopifyCustomerGid?: string | null;
	offeringId: string;
	divisionId: string;
	staffAccessConsent: boolean;
}

export class MembershipCheckoutService {
	private readonly deps: MembershipCheckoutHelperDeps;

	constructor(
		organizations: CheckoutOrganizationReadPort,
		catalog: CheckoutCatalogReadPort,
		teachers: CheckoutTeacherDirectoryPort,
		checkout: CheckoutRepository,
		storefront: MembershipCheckoutStorefrontPort,
		listings: MembershipListingsPort,
		now: () => Date = () => new Date(),
		eventBus?: ClassCheckoutEventBus,
	) {
		this.deps = {
			organizations,
			catalog,
			teachers,
			checkout,
			storefront,
			listings,
			now,
			eventBus,
		};
	}

	async start(input: StartTeacherMembershipCheckoutInput): Promise<{
		checkoutUrl: string;
		intentId: string;
		correlationId: string;
	}> {
		validateStartMembershipInput(input);
		const existing = await this.deps.checkout.getOutcome({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
		});
		if (existing?.kind === "ready") {
			return this.resumeReadyIntent(input, existing.intent, existing.cart);
		}
		if (existing?.kind === "active" || existing?.kind === "in_progress") {
			throw new AppError("Checkout is already in progress.", 409);
		}
		if (existing?.kind === "expired" || existing?.kind === "failed") {
			throw new AppError("Previous checkout attempt is no longer active.", 409);
		}
		const division = await this.validateDivisionAndEligibility(input);
		const { listing } = await resolveMembershipOfferingAndProductOp(
			this.deps,
			input,
		);
		const outcome = await this.createMembershipIntent(input, division, listing);
		if (outcome.kind === "ready") {
			return this.resumeReadyIntent(input, outcome.intent, outcome.cart);
		}
		if (outcome.kind !== "created") {
			throw new AppError("Unable to start membership checkout.", 409);
		}
		const cart = await createAndAttachMembershipCartOp(
			this.deps,
			input,
			outcome.intent,
		);
		return startMembershipStorefrontCheckoutOp(this.deps, outcome.intent, cart);
	}

	private async validateDivisionAndEligibility(
		input: StartTeacherMembershipCheckoutInput,
	) {
		const divisions = await this.deps.catalog.listDivisions(
			input.organizationId,
			true,
		);
		const division = divisions.find((d) => d.id === input.divisionId.trim());
		if (!division) {
			throw new AppError("Selected division is invalid or inactive.", 400);
		}
		await assertNoDuplicateActiveMembershipOp(
			this.deps,
			input.organizationId,
			input.customerId,
			division.id,
		);
		const processing = await this.deps.checkout.hasProcessingIntent(
			input.organizationId,
			input.customerId,
			this.deps.now().toISOString(),
			"membership",
		);
		if (processing) {
			throw new AppError(
				"Another membership checkout is already in progress.",
				409,
			);
		}
		return division;
	}

	private createMembershipIntent(
		input: StartTeacherMembershipCheckoutInput,
		division: { id: string; displayName: string },
		listing: Awaited<
			ReturnType<typeof resolveMembershipOfferingAndProductOp>
		>["listing"],
	) {
		return this.deps.checkout.createIntent({
			organizationId: input.organizationId,
			customerId: input.customerId,
			sessionId: input.sessionId,
			idempotencyKey: input.idempotencyKey,
			intentType: "membership",
			offeringId: listing.offeringId,
			entitlementClass: "teacher_membership",
			durationDays: listing.durationDays,
			shopifyProductGid: listing.shopifyProductGid,
			shopifyVariantGid: listing.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			staffAccessConsent: true,
			amount: listing.amount,
			currencyCode: listing.currencyCode,
			expiresAtIso: new Date(
				this.deps.now().getTime() + 15 * 60 * 1000,
			).toISOString(),
		});
	}

	private async resumeReadyIntent(
		_input: StartTeacherMembershipCheckoutInput,
		intent: CheckoutIntentRecord,
		cart: CheckoutCartRecord,
	) {
		assertCheckoutIntentType(intent, "membership");
		return startMembershipStorefrontCheckoutOp(this.deps, intent, cart);
	}
}
