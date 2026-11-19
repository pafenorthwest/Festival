import {
	AppError,
	type ClassCheckoutRestartRegistration,
	type PendingClassCheckoutDto,
} from "@festival/common";
import type { ClassCheckoutStorefrontBinding } from "./checkout-execution-types.js";
import {
	resolveStorefrontBinding,
	sameStorefrontBinding,
} from "./class-checkout-cart-handoff.js";
import { isValidCheckoutUrlForDomain } from "./class-checkout-cart-recovery.js";
import { matchesInspectedCartEvidence } from "./class-checkout-replay-helpers.js";
import { mapRestartRegistration } from "./class-checkout-restart-selections.js";
import {
	moneyPattern,
	pendingCheckoutOrderState,
	validMoney,
} from "./pending-checkout-payment.js";
import type {
	PendingClassCheckoutCandidate,
	PendingClassCheckoutServiceDeps,
} from "./pending-checkout-types.js";

interface Owner {
	organizationId: string;
	customerId: string;
}

interface VerifiedPendingCheckout {
	checkout: PendingClassCheckoutDto | null;
	candidate: PendingClassCheckoutCandidate | null;
	binding?: ClassCheckoutStorefrontBinding;
	shopifyCartId?: string;
	expectedCustomerGid?: string;
}

function normalizedAmount(value: string): string {
	const [whole, fraction = ""] = value.split(".");
	return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.replace(/0+$/, "")}`;
}

export class PendingClassCheckoutService {
	private readonly now: () => Date;

	constructor(private readonly deps: PendingClassCheckoutServiceDeps) {
		this.now = deps.now ?? (() => new Date());
	}

	async getPending(owner: Owner): Promise<PendingClassCheckoutDto | null> {
		return (await this.verify(owner)).checkout;
	}

	async resume(
		input: Owner & {
			recoveryReference: string;
			submissionKey?: string;
			getBuyerAccessToken?: () => Promise<string>;
		},
	): Promise<{ checkoutUrl: string; submissionMatched?: boolean }> {
		const verified = await this.verify(input);
		const { candidate, checkout } = verified;
		if (
			!candidate?.execution ||
			checkout?.recoveryReference !== input.recoveryReference
		) {
			throw new AppError("Pending checkout not found.", 404);
		}
		if (
			!checkout.resumeAllowed ||
			!verified.binding ||
			!verified.shopifyCartId
		) {
			throw new AppError(
				"This checkout needs to be resolved before continuing.",
				409,
				"pending_checkout_not_resumable",
			);
		}
		if (checkout.reasonCode === "checkout_buyer_refresh_required") {
			if (
				!input.getBuyerAccessToken ||
				!this.deps.storefront.updateBuyerIdentity
			) {
				throw new AppError(
					"Sign in again to reconnect this checkout.",
					409,
					"pending_checkout_buyer_refresh_required",
				);
			}
			const buyerAccessToken = await input.getBuyerAccessToken();
			if (!buyerAccessToken)
				throw new AppError(
					"Customer session could not reconnect this checkout.",
					401,
				);
			await this.deps.storefront.updateBuyerIdentity({
				organizationId: input.organizationId,
				shopifyCartId: verified.shopifyCartId,
				buyerAccessToken,
				expectedStorefrontBinding: verified.binding,
			});
			const cart = await this.deps.storefront.inspectCart?.({
				organizationId: input.organizationId,
				shopifyCartId: verified.shopifyCartId,
				expectedStorefrontBinding: verified.binding,
			});
			if (
				!verified.expectedCustomerGid ||
				!cart ||
				!matchesInspectedCartEvidence(
					candidate.intent,
					verified.expectedCustomerGid,
					cart,
				)
			) {
				throw new AppError(
					"Shopify checkout ownership could not be verified.",
					409,
					"pending_checkout_buyer_unverified",
				);
			}
		}
		const result = await this.deps.storefront.checkout({
			organizationId: input.organizationId,
			shopifyCartId: verified.shopifyCartId,
			expectedStorefrontBinding: verified.binding,
		});
		if (
			!isValidCheckoutUrlForDomain(
				result.checkoutUrl,
				verified.binding.shopDomain,
			)
		) {
			throw new AppError(
				"Shopify checkout could not be verified.",
				503,
				"pending_checkout_unavailable",
			);
		}
		// Recheck concurrent changes without rewriting the original session or key.
		const [latest, integration] = await Promise.all([
			this.candidates(input),
			this.deps.organizations.getShopifyIntegration(input.organizationId),
		]);
		const current = latest.candidates[0];
		if (
			!latest.complete ||
			latest.candidates.length !== 1 ||
			current?.intent.id !== candidate.intent.id ||
			current.intent.status !== candidate.intent.status ||
			current.execution?.generation !== candidate.execution.generation ||
			!sameStorefrontBinding(
				resolveStorefrontBinding(integration),
				verified.binding,
			)
		) {
			throw new AppError(
				"Checkout changed while its payment link was being checked. Refresh and try again.",
				409,
				"pending_checkout_changed",
			);
		}
		const refreshed = await this.verify(input);
		if (
			refreshed.checkout?.reasonCode !== "checkout_ready" ||
			!refreshed.checkout.resumeAllowed ||
			refreshed.candidate?.intent.id !== candidate.intent.id ||
			refreshed.candidate.execution?.generation !==
				candidate.execution.generation
		) {
			throw new AppError(
				"Checkout payment state changed. Refresh before continuing.",
				409,
				"pending_checkout_changed",
			);
		}
		return input.submissionKey === undefined
			? result
			: {
					...result,
					submissionMatched:
						refreshed.candidate.intent.idempotencyKey === input.submissionKey,
				};
	}

	private async candidates(owner: Owner) {
		if (!this.deps.checkout.listPendingClassCheckouts) {
			throw new AppError(
				"Pending checkout verification is unavailable.",
				503,
				"pending_checkout_unavailable",
			);
		}
		return this.deps.checkout.listPendingClassCheckouts(
			owner.organizationId,
			owner.customerId,
		);
	}

	private async savedDetails(
		owner: Owner,
		candidate: PendingClassCheckoutCandidate,
	) {
		const [snapshots, children, festivals] = await Promise.all([
			this.deps.checkout.listCheckoutRegistrationSnapshots?.(
				owner.organizationId,
				candidate.intent.id,
			) ?? [],
			this.deps.customers.listChildren(owner.organizationId, owner.customerId),
			this.deps.catalog.listFestivals(owner.organizationId),
		]);
		const intentLines = candidate.intent.lines ?? [];
		const snapshotByLine = new Map(
			snapshots.map((snapshot) => [snapshot.checkoutIntentLineId, snapshot]),
		);
		const ambiguousSnapshotLines = new Set(
			snapshots
				.filter(
					(entry, index) =>
						snapshots.findIndex(
							(value) =>
								value.checkoutIntentLineId === entry.checkoutIntentLineId,
						) !== index,
				)
				.map((entry) => entry.checkoutIntentLineId),
		);
		const childById = new Map(children.map((child) => [child.id, child]));
		const festivalId = snapshots[0]?.registrationSnapshot.class.festivalId;
		const festival = festivals.find((entry) => entry.id === festivalId);
		const lookups = {
			intentLinesById: new Map(intentLines.map((line) => [line.id, line])),
			childById,
			classById: new Map(),
		};
		const registrations: ClassCheckoutRestartRegistration[] =
			intentLines.flatMap((line) => {
				const saved = snapshotByLine.get(line.id);
				return saved &&
					!ambiguousSnapshotLines.has(line.id) &&
					saved.registrationSnapshot.class.id === line.festivalClassId &&
					!!line.childId &&
					childById.has(line.childId)
					? [mapRestartRegistration(saved, lookups)]
					: [];
			});
		const complete =
			intentLines.length > 0 &&
			snapshotByLine.size === snapshots.length &&
			snapshots.length === intentLines.length &&
			registrations.length === intentLines.length &&
			!!festival &&
			intentLines.every(
				(line) => !!line.childId && childById.has(line.childId),
			) &&
			intentLines.every((line) => {
				const saved = snapshotByLine.get(line.id)?.registrationSnapshot;
				return (
					!!saved &&
					saved.class.id === line.festivalClassId &&
					saved.class.currencyCode === line.currencyCode &&
					moneyPattern.test(saved.class.price) &&
					moneyPattern.test(line.amount) &&
					normalizedAmount(saved.class.price) === normalizedAmount(line.amount)
				);
			}) &&
			snapshots.every(
				(entry) => entry.registrationSnapshot.class.festivalId === festivalId,
			);
		const requestFestival = (
			candidate.execution?.requestSnapshot as {
				festivalShortName?: unknown;
			} | null
		)?.festivalShortName;
		return {
			registrations,
			complete,
			festivalShortName:
				festival?.shortName ??
				(typeof requestFestival === "string" ? requestFestival : null),
		};
	}

	private async verify(owner: Owner): Promise<VerifiedPendingCheckout> {
		const candidates = await this.candidates(owner);
		if (candidates.candidates.length === 0 && candidates.complete)
			return { checkout: null, candidate: null };
		const candidate = candidates.candidates[0];
		if (!candidate)
			throw new AppError(
				"Pending checkout verification is incomplete.",
				503,
				"pending_checkout_unavailable",
			);
		const details = await this.savedDetails(owner, candidate);
		const base: PendingClassCheckoutDto = {
			state: "needs_review",
			recoveryReference:
				candidate.execution?.recoveryReference ?? "unavailable",
			festivalShortName: details.festivalShortName,
			registrationCount: null,
			registrations: details.registrations,
			resumeAllowed: false,
			reasonCode: "checkout_verification_required",
			verifiedAtIso: null,
		};
		const review = (reasonCode: string) => ({
			checkout: { ...base, reasonCode },
			candidate,
		});
		if (!candidates.complete) return review("checkout_discovery_incomplete");
		if (candidates.candidates.length !== 1) {
			const allDetails = await Promise.all(
				candidates.candidates
					.slice(1)
					.map((entry) => this.savedDetails(owner, entry)),
			);
			base.registrations.push(
				...allDetails.flatMap((entry) => entry.registrations),
			);
			base.festivalShortName = null;
			return review("multiple_pending_checkouts");
		}
		try {
			const [customer, integration] = await Promise.all([
				this.deps.customers.getCustomer(owner.organizationId, owner.customerId),
				this.deps.organizations.getShopifyIntegration(owner.organizationId),
			]);
			if (!customer?.shopifyCustomerGid || !integration)
				return review("checkout_verification_required");
			const binding = resolveStorefrontBinding(integration);
			const storedBinding = candidate.execution?.storefrontBinding;
			if (!storedBinding || !sameStorefrontBinding(storedBinding, binding))
				return review("checkout_storefront_changed");
			const result = await this.deps.orders.listCustomerOrders({
				...owner,
				shopifyCustomerGid: customer.shopifyCustomerGid,
				sinceIso: new Date(candidate.intent.createdAtIso).toISOString(),
				expectedShopDomain: binding.shopDomain,
			});
			if (!result.complete)
				return review("checkout_order_discovery_incomplete");
			const expectedIds = new Set(
				(candidate.intent.lines ?? []).map((line) => line.id),
			);
			const expectedVariants = new Set(
				(candidate.intent.lines ?? []).map((line) => line.shopifyVariantGid),
			);
			for (const order of result.orders) {
				const claimsThisCheckout =
					order.correlationId === candidate.intent.correlationId ||
					order.lines.some(
						(line) => !!line.intentLineId && expectedIds.has(line.intentLineId),
					);
				if (
					claimsThisCheckout ||
					!order.lines.some((line) => expectedVariants.has(line.variantGid))
				)
					continue;
				// Matching merchandise with absent/corrupt purchase identifiers could
				// be this checkout with payment already in flight. Only a complete
				// identity match to another owned intent proves it is unrelated.
				const other = order.correlationId
					? await this.deps.checkout.findIntentByCorrelation(
							owner.organizationId,
							order.correlationId,
						)
					: null;
				if (
					!other ||
					other.id === candidate.intent.id ||
					other.customerId !== owner.customerId ||
					other.organizationId !== owner.organizationId ||
					!matchesInspectedCartEvidence(
						other,
						customer.shopifyCustomerGid,
						order,
					)
				) {
					return review("checkout_order_identity_incomplete");
				}
			}
			// Matching line evidence with missing/conflicting order correlation is
			// an ambiguity, never permission to resume an apparently unpaid cart.
			const matching = result.orders.filter(
				(order) =>
					order.correlationId === candidate.intent.correlationId ||
					order.lines.some(
						(line) => !!line.intentLineId && expectedIds.has(line.intentLineId),
					),
			);
			if (matching.length > 1) return review("multiple_checkout_orders");
			const order = matching[0];
			if (order) {
				if (
					!matchesInspectedCartEvidence(
						candidate.intent,
						customer.shopifyCustomerGid,
						order,
					) ||
					!details.complete
				)
					return review("checkout_order_mismatch");
				const paymentState = pendingCheckoutOrderState(
					base,
					order,
					this.now().toISOString(),
				);
				if (
					paymentState.state === "processing" &&
					["rejected", "needs_review", "superseded"].includes(
						candidate.intent.status,
					)
				) {
					return {
						checkout: {
							...paymentState,
							state: "needs_review",
							reasonCode: "checkout_registration_review",
						},
						candidate,
					};
				}
				return { checkout: paymentState, candidate };
			}
			if (!details.complete) return review("checkout_saved_details_incomplete");
			if (
				!["ready", "checkout_started", "expired"].includes(
					candidate.intent.status,
				)
			)
				return review("checkout_requires_review");
			const shopifyCartId =
				candidate.execution?.shopifyCartId ?? candidate.cart?.shopifyCartId;
			const execution = candidate.execution;
			const resumableExecution =
				execution?.checkpoint === "attached" &&
				(["ready", "retryable", "completed"].includes(execution.state) ||
					(execution.state === "recovery_required" &&
						execution.resultCode === "checkout_expired"));
			if (
				!shopifyCartId ||
				!resumableExecution ||
				!this.deps.storefront.inspectCart
			)
				return review("checkout_verification_required");
			const cart = await this.deps.storefront.inspectCart({
				organizationId: owner.organizationId,
				shopifyCartId,
				expectedStorefrontBinding: binding,
			});
			if (!cart) return review("checkout_cart_mismatch");
			const buyerRefreshRequired =
				cart.customerGid === null &&
				matchesInspectedCartEvidence(candidate.intent, null, cart);
			if (
				!buyerRefreshRequired &&
				!matchesInspectedCartEvidence(
					candidate.intent,
					customer.shopifyCustomerGid,
					cart,
				)
			)
				return review("checkout_cart_mismatch");
			// A live cart does not extend the deadline enforced by paid validation.
			const expired =
				candidate.intent.status === "expired" ||
				!Number.isFinite(Date.parse(candidate.intent.expiresAtIso)) ||
				Date.parse(candidate.intent.expiresAtIso) <= this.now().getTime();
			const checkout: PendingClassCheckoutDto = {
				...base,
				state: expired || buyerRefreshRequired ? "needs_review" : "ready",
				registrationCount: cart.lines.reduce(
					(count, line) => count + line.quantity,
					0,
				),
				resumeAllowed:
					!expired &&
					(!buyerRefreshRequired || !!this.deps.storefront.updateBuyerIdentity),
				reasonCode: expired
					? "checkout_expired"
					: buyerRefreshRequired
						? "checkout_buyer_refresh_required"
						: "checkout_ready",
				verifiedAtIso: this.now().toISOString(),
				...(validMoney(cart.estimatedTotal ?? null)
					? { estimatedTotal: cart.estimatedTotal }
					: {}),
			};
			return {
				checkout,
				candidate,
				binding,
				shopifyCartId,
				expectedCustomerGid: customer.shopifyCustomerGid,
			};
		} catch {
			return review("checkout_provider_unavailable");
		}
	}
}
