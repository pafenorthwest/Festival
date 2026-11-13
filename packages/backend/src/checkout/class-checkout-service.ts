import type {
	ClassCheckoutRestartDto,
	EvaluatePurchaseEligibilityResponse,
} from "@festival/common";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { CustomerAccountRepository } from "../customer/customer-account-repository.js";
import {
	ClassCheckoutCartObservationError,
	ClassCheckoutExecutionService,
	type ClassCheckoutFailureLogger,
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutResult,
	type ClassCheckoutStorefrontBinding,
	ClassCheckoutStorefrontChangedBeforeRequestError,
	type ClassCheckoutStorefrontPort,
	consoleClassCheckoutFailureLogger,
	type EligibilityLookups,
	type EvaluatePurchaseEligibilityInput,
	type StartClassCheckoutInput,
	silentClassCheckoutFailureLogger,
} from "../domains/class-checkout/index.js";
import type { RepertoireRepository } from "../repertoire/repertoire-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { CheckoutRepository } from "./checkout-repository.js";

export {
	ClassCheckoutCartObservationError,
	type ClassCheckoutFailureLogger,
	ClassCheckoutRecoveryRequiredError,
	type ClassCheckoutResult,
	ClassCheckoutStorefrontChangedBeforeRequestError,
	consoleClassCheckoutFailureLogger,
	type EvaluatePurchaseEligibilityInput,
	type StartClassCheckoutInput,
};

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

function adaptStorefront(
	storefront: ClassCheckoutStorefront,
): ClassCheckoutStorefrontPort {
	return {
		get inspectCart() {
			const inspectCart = storefront.inspectCart;
			return inspectCart
				? (
						input: Parameters<
							NonNullable<ClassCheckoutStorefrontPort["inspectCart"]>
						>[0],
					) => inspectCart(input)
				: undefined;
		},
		createCart: (input) =>
			storefront.createCart({
				organizationId: input.organizationId,
				expectedStorefrontBinding: input.expectedStorefrontBinding,
				shopifyVariantGid: input.shopifyVariantGid,
				buyerAccessToken: input.buyerAccessToken ?? "",
				correlationId: input.correlationId,
				currencyCode: input.currencyCode,
				lines: input.lines?.map((line) => ({
					merchandiseId:
						line.merchandiseId ??
						line.shopifyVariantGid ??
						line.variantGid ??
						"",
					quantity: line.quantity,
					attributes: line.attributes,
				})),
			}),
		checkout: (input) => storefront.checkout(input),
	};
}

export class ClassCheckoutService {
	private readonly domain: ClassCheckoutExecutionService;

	constructor(
		organizations: OrganizationRepository,
		customers: CustomerAccountRepository,
		checkout: CheckoutRepository,
		storefront: ClassCheckoutStorefront,
		commerce?: MembershipCommerceRepository,
		now: () => Date = () => new Date(),
		failureLogger: ClassCheckoutFailureLogger = silentClassCheckoutFailureLogger,
		repertoire?: RepertoireRepository,
	) {
		this.domain = new ClassCheckoutExecutionService({
			organizations,
			catalog: organizations,
			customers,
			teachers: organizations,
			checkout,
			storefront: adaptStorefront(storefront),
			commerce,
			repertoire,
			now,
			failureLogger,
		});
	}

	evaluateEligibility(
		input: EvaluatePurchaseEligibilityInput,
		preloaded?: EligibilityLookups,
	): Promise<EvaluatePurchaseEligibilityResponse> {
		return this.domain.evaluateEligibility(input, preloaded);
	}

	preflightRecovery(input: StartClassCheckoutInput): Promise<void> {
		return this.domain.preflightRecovery(input);
	}

	start(input: StartClassCheckoutInput): Promise<ClassCheckoutResult> {
		return this.domain.start(input);
	}

	recoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}) {
		return this.domain.recoveryStatus(input);
	}

	getRecoveryStatus(input: {
		organizationId: string;
		customerId: string;
		sessionId: string;
		recoveryReference: string;
		idempotencyKey: string;
		festivalShortName?: string;
	}) {
		return this.domain.getRecoveryStatus(input);
	}

	findUnissuedCartRestart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
	}): Promise<{ recoveryReference: string | null }> {
		return this.domain.findUnissuedCartRestart(input);
	}

	restartUnissuedCart(input: {
		organizationId: string;
		customerId: string;
		festivalShortName: string;
		recoveryReference: string;
	}): Promise<ClassCheckoutRestartDto> {
		return this.domain.restartUnissuedCart(input);
	}

	listRecoveries(input: { organizationId: string; customerId?: string }) {
		return this.domain.listRecoveries(input);
	}

	reapExpiredRecoveries(input: { organizationId: string }): Promise<number> {
		return this.domain.reapExpiredRecoveries(input);
	}

	resolveRecovery(input: {
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
		return this.domain.resolveRecovery(input);
	}
}
