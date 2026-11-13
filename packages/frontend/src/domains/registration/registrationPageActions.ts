import {
	evaluateClassCapacityStatus,
	type RepertoirePiece,
} from "@festival/common";
import {
	ApiError,
	evaluateRegistrationEligibility,
	getClassCheckoutRecoveryStatus,
	refreshCustomerChildAgeSnapshot,
	restartClassCheckout,
	startClassCheckout,
} from "../../lib/api.js";
import type { ParentRegistrationWorkspace } from "../../lib/parent-registration-state.js";
import {
	buildCartItemInput,
	cartItemsToLineItemInputs,
	type RegistrationCartItem,
	type RegistrationCheckoutSubmission,
} from "../../pages/registrationCartState.js";
import type { useCartEligibility } from "../../pages/useCartEligibility.js";
import type { useClassOptionEligibility } from "../../pages/useClassOptionEligibility.js";

export type RegistrationCart = ParentRegistrationWorkspace["cart"];

export interface WaitlistTarget {
	childId: string;
	childName: string;
	classId: string;
	className: string;
	lineId?: string;
}

export interface AddToCartActionContext {
	slug: string;
	festivalSlug: string;
	getCsrf: () => string;
	cart: RegistrationCart;
	view: () => "workspace" | "class" | "cart";
	registerPath: () => string;
	navigate: (path: string) => void;
	selectedChild: () =>
		| Parameters<typeof buildCartItemInput>[0]
		| null
		| undefined;
	selectedDivisionId: () => string;
	selectedDivisionName: () => string;
	selectedTeacher: () => Parameters<typeof buildCartItemInput>[3] | null;
	selectedClass: () =>
		| Parameters<typeof buildCartItemInput>[4]
		| null
		| undefined;
	selectedAccompanist: () => Parameters<typeof buildCartItemInput>[5] | null;
	selectedInstrument: () => Parameters<typeof buildCartItemInput>[7] | null;
	pieces: () => RepertoirePiece[];
	pieceDirty: () => boolean;
	isAdding: () => boolean;
	setIsAdding: (val: boolean) => void;
	localSelectionValid: () => boolean;
	isPurchased: (classId: string) => boolean;
	setCheckoutError: (err: string | null) => void;
	setCapacityChanged: (val: boolean) => void;
	getFormRevision: () => number;
	isDisposed: () => boolean;
	setAllowLeave: (val: boolean) => void;
	clearForm: () => void;
}

export function createAddToCartHandler(ctx: AddToCartActionContext) {
	return async function handleAddToCart() {
		ctx.setCheckoutError(null);
		ctx.setCapacityChanged(false);
		const cls = ctx.selectedClass();
		const child = ctx.selectedChild();
		if (
			!cls ||
			!child ||
			!ctx.localSelectionValid() ||
			ctx.pieceDirty() ||
			ctx.isAdding() ||
			Boolean(ctx.cart.checkoutSubmission()) ||
			ctx.isPurchased(cls.id) ||
			ctx.cart.hasItem(child.id, cls.id)
		) {
			return;
		}
		ctx.setIsAdding(true);
		const revision = ctx.getFormRevision();
		try {
			const input = buildCartItemInput(
				child,
				ctx.selectedDivisionId(),
				ctx.selectedDivisionName(),
				ctx.selectedTeacher(),
				cls,
				ctx.selectedAccompanist(),
				ctx.pieces(),
				ctx.selectedInstrument(),
			);
			const candidate = {
				...cartItemsToLineItemInputs([{ ...input, lineId: "candidate" }])[0],
				id: `candidate:${cls.id}`,
				isCandidate: true,
			};
			const response = await evaluateRegistrationEligibility(
				ctx.slug,
				ctx.festivalSlug,
				[...cartItemsToLineItemInputs(ctx.cart.items()), candidate],
				ctx.getCsrf(),
			);
			if (
				ctx.isDisposed() ||
				revision !== ctx.getFormRevision() ||
				ctx.view() !== "class"
			) {
				return;
			}
			const result = response.results.find(
				(item) =>
					item.childId === child.id &&
					item.festivalClassId === cls.id &&
					(!item.lineItemId || item.lineItemId === candidate.id),
			);
			if (
				!result?.eligible ||
				!result.isEligible ||
				result.reasonCode !== "AVAILABLE"
			) {
				ctx.setCapacityChanged(
					result?.reasonCode === "SOLD_OUT" ||
						result?.availability === "waitlist",
				);
				throw new Error(
					result?.message ||
						"This registration could not be verified. Please try again.",
				);
			}
			ctx.cart.addItem(input);
			ctx.setAllowLeave(true);
			ctx.clearForm();
			ctx.navigate(ctx.registerPath());
		} catch (error) {
			ctx.setCheckoutError(
				error instanceof Error
					? error.message
					: "Unable to add this registration.",
			);
		} finally {
			ctx.setIsAdding(false);
		}
	};
}

export interface CheckoutRecoveryActionContext {
	slug: string;
	festivalSlug: string;
	getCsrf: () => string;
	cart: RegistrationCart;
	eligibility: ReturnType<typeof useCartEligibility>;
	isSubmittingCheckout: () => boolean;
	setIsSubmittingCheckout: (val: boolean) => void;
	setCheckoutError: (err: string | null) => void;
	setDiscoveredRestart: (ref: string | null) => void;
	checkoutRestartReference: () => string | null;
	isDisposed: () => boolean;
	setHandingOff: (val: boolean) => void;
	isHandingOff: () => boolean;
	setCompleteHandoff: (fn: (() => void) | undefined) => void;
	getCompleteHandoff: () => (() => void) | undefined;
}

export function createCheckoutRecoveryHandlers(
	ctx: CheckoutRecoveryActionContext,
) {
	function handOffCheckout(
		checkoutUrl: string,
		submission: RegistrationCheckoutSubmission,
	) {
		ctx.setHandingOff(true);
		const onPageHide = () => {
			ctx.setDiscoveredRestart(null);
			ctx.cart.completeCheckout(submission);
			ctx.setHandingOff(false);
			ctx.setIsSubmittingCheckout(false);
		};
		ctx.setCompleteHandoff(onPageHide);
		window.addEventListener("pagehide", onPageHide, { once: true });
		window.location.assign(checkoutUrl);
	}

	function handleCheckoutError(error: unknown, validationMayRelease = false) {
		ctx.setHandingOff(false);
		const completeHandoff = ctx.getCompleteHandoff();
		if (completeHandoff) {
			window.removeEventListener("pagehide", completeHandoff);
		}
		if (error instanceof ApiError && error.recovery) {
			ctx.cart.setCheckoutRecovery(error.recovery);
		} else if (
			validationMayRelease &&
			error instanceof ApiError &&
			error.status === 409 &&
			error.code === "checkout_pre_dispatch_rejected"
		) {
			ctx.cart.releaseCheckout({ retireKey: true });
			ctx.setCheckoutError(
				"Your registrations are still in your cart. Please try checking out again.",
			);
			return;
		} else if (
			validationMayRelease &&
			error instanceof ApiError &&
			[400, 404, 422].includes(error.status)
		) {
			ctx.cart.releaseCheckout();
		}
		ctx.setCheckoutError(
			error instanceof Error
				? error.message
				: "Checkout failed. Please try again.",
		);
	}

	async function handleRefreshCheckout() {
		const recovery = ctx.cart.checkoutRecovery();
		const submission = ctx.cart.checkoutSubmission();
		if (!recovery || !submission || ctx.isSubmittingCheckout()) return;
		ctx.setCheckoutError(null);
		ctx.setIsSubmittingCheckout(true);
		try {
			const result = await getClassCheckoutRecoveryStatus(
				ctx.slug,
				recovery.festivalShortName ?? ctx.festivalSlug,
				recovery.recoveryReference,
				ctx.getCsrf(),
				submission.idempotencyKey,
			);
			if (ctx.isDisposed() || ctx.cart.checkoutSubmission() !== submission) {
				return;
			}
			ctx.cart.setCheckoutRecovery(result);
			if (result.checkoutUrl) handOffCheckout(result.checkoutUrl, submission);
		} catch (error) {
			handleCheckoutError(error);
		} finally {
			if (!ctx.isHandingOff()) ctx.setIsSubmittingCheckout(false);
		}
	}

	function handleRestartCheckout() {
		if (ctx.isSubmittingCheckout()) return;
		if (ctx.cart.restartAbandonedCheckout()) ctx.setCheckoutError(null);
	}

	async function handleRestoreCheckout() {
		const recoveryReference = ctx.checkoutRestartReference();
		if (!recoveryReference || ctx.isSubmittingCheckout()) return;
		const csrfToken = ctx.getCsrf();
		ctx.setCheckoutError(null);
		ctx.setIsSubmittingCheckout(true);
		try {
			const restart = await restartClassCheckout(
				ctx.slug,
				ctx.festivalSlug,
				recoveryReference,
				csrfToken,
			);
			if (!ctx.isDisposed() && ctx.getCsrf() === csrfToken) {
				ctx.cart.restoreCheckout(recoveryReference, restart);
			}
		} catch (error) {
			if (!ctx.isDisposed() && ctx.getCsrf() === csrfToken) {
				handleCheckoutError(error);
			}
		} finally {
			ctx.setIsSubmittingCheckout(false);
		}
	}

	async function handleCartCheckout() {
		if (ctx.cart.itemCount() === 0 || ctx.isSubmittingCheckout()) return;
		const recovery = ctx.cart.checkoutRecovery();
		if (recovery && !recovery.retryAllowed) return;
		ctx.setCheckoutError(null);
		ctx.setIsSubmittingCheckout(true);
		try {
			if (!ctx.cart.checkoutSubmission()) {
				await ctx.eligibility.recheck();
				if (!ctx.eligibility.isCartEligible()) {
					throw new Error(
						ctx.eligibility.error() ||
							"Resolve the cart's eligibility issues before checkout.",
					);
				}
			}
			const submission = ctx.cart.beginCheckout();
			const res = await startClassCheckout(ctx.slug, ctx.festivalSlug, {
				lineItems: submission.lineItems,
				csrfToken: ctx.getCsrf(),
				idempotencyKey: submission.idempotencyKey,
			});
			if (ctx.isDisposed() || ctx.cart.checkoutSubmission() !== submission) {
				return;
			}
			if (!res?.checkoutUrl) {
				throw new Error("Checkout failed to initialize. Please try again.");
			}
			handOffCheckout(res.checkoutUrl, submission);
		} catch (error) {
			handleCheckoutError(error, true);
		} finally {
			if (!ctx.isHandingOff()) ctx.setIsSubmittingCheckout(false);
		}
	}

	return {
		handleRefreshCheckout,
		handleRestartCheckout,
		handleRestoreCheckout,
		handleCartCheckout,
	};
}

export function createSnapshotHandler(params: {
	slug: string;
	getCsrf: () => string;
	selectedChildId: () => string;
	birthdayDraft: () => string;
	setBirthdayDraft: (val: string) => void;
	setIsRefreshingSnapshot: (val: boolean) => void;
	setSnapshotError: (err: string | null) => void;
	loadChildren: () => Promise<unknown>;
}) {
	return async (e: Event) => {
		e.preventDefault();
		const childId = params.selectedChildId();
		const birthday = params.birthdayDraft();
		if (!childId || !birthday) return;
		params.setIsRefreshingSnapshot(true);
		params.setSnapshotError(null);
		try {
			await refreshCustomerChildAgeSnapshot(
				params.slug,
				childId,
				params.getCsrf(),
				birthday,
			);
			await params.loadChildren();
			params.setBirthdayDraft("");
		} catch (err) {
			params.setSnapshotError(
				err instanceof Error ? err.message : "Failed to verify birthdate.",
			);
		} finally {
			params.setIsRefreshingSnapshot(false);
		}
	};
}

export function canJoinCartWaitlistItem(
	item: RegistrationCartItem,
	isSubmittingCheckout: boolean,
	cart: RegistrationCart,
	eligibility: ReturnType<typeof useCartEligibility>,
): boolean {
	const result = eligibility.getResult(item.childId, item.classId);
	return (
		!isSubmittingCheckout &&
		!cart.checkoutSubmission() &&
		!eligibility.isEvaluating() &&
		!eligibility.error() &&
		result?.reasonCode === "SOLD_OUT" &&
		typeof result.capacity === "number" &&
		typeof result.placedCount === "number" &&
		evaluateClassCapacityStatus(result.capacity, result.placedCount)
			.availability === "waitlist"
	);
}

export function formatClassStatus(
	classId: string,
	selectedChildId: string,
	isPurchased: (id: string) => boolean,
	cart: RegistrationCart,
	classOptionEligibility: ReturnType<typeof useClassOptionEligibility>,
): string {
	if (isPurchased(classId)) return "Purchased";
	if (cart.hasItem(selectedChildId, classId)) return "In cart";
	if (classOptionEligibility.isWaitlist(classId)) return "Waitlist";
	const info = classOptionEligibility.getOption(classId);
	if (info?.isEligible) return "Available";
	if (info?.reasonCode === "MISSING_PREREQUISITE") return "Prerequisite unmet";
	if (info?.reasonCode === "ALREADY_REGISTERED") return "Purchased";
	return "Unavailable";
}
