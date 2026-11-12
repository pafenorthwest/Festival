import type { PublicMembershipProductSummary } from "@festival/common";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import {
	ApiError,
	customerMembershipPurchaseSignInPath,
	getCustomerSession,
	getMembershipProducts,
	getPublicDivisions,
	resumeCustomerMembershipPurchase,
	startCustomerCheckout,
} from "../lib/api.js";
import { buildOrgMembershipPath } from "../lib/routes.js";
import { sanitizeShopifyDescriptionHtml } from "../lib/sanitize-html.js";
import {
	readPendingTeacherDirectoryOptIn,
	resolveInitialCheckoutDirectoryOptIn,
	writePendingTeacherDirectoryOptIn,
} from "./teacherDirectoryHelpers.js";

const CHECKOUT_ERROR_MESSAGES: Record<string, string> = {
	checkout_in_progress:
		"Your checkout is still being prepared. Please wait a moment before trying again.",
	checkout_expired:
		"This checkout expired before it could continue. Start a new checkout.",
	checkout_retryable_upstream:
		"Shopify checkout is temporarily unavailable. Please try again.",
	checkout_terminal_failure:
		"This checkout attempt cannot continue. Start a new checkout.",
};
function purchaseErrorMessage(error: unknown): string {
	if (!(error instanceof ApiError))
		return "Customer authentication or membership selection could not be resumed. Please try again.";
	return (error.code && CHECKOUT_ERROR_MESSAGES[error.code]) || error.message;
}
function formatEntitlementClass(value: string): string {
	return value
		.split("_")
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join(" ");
}
function createCheckoutController(app: FestivalAppController) {
	const initial = {
		error: "",
		status: "",
		pendingOfferingId: null as string | null,
		selectedOfferingId: null as string | null,
		entitlementClass: null as string | null,
		csrfToken: null as string | null,
		divisionId: "",
		staffAccessConsent: false,
		directoryOptIn: true,
		submitting: false,
	};
	const [state, setState] = createSignal(initial);
	const patch = (next: Partial<typeof initial>) =>
		setState((cur) => ({ ...cur, ...next }));
	const slug = () =>
		app.route().kind === "org-membership"
			? (app.route() as { slug: string }).slug
			: null;
	return { state, patch, slug, app };
}
type CheckoutController = ReturnType<typeof createCheckoutController>;
async function preparePurchase(
	ctrl: CheckoutController,
	args: {
		slug: string;
		offeringId: string;
		csrfToken?: string;
		entitlementClass?: string;
	},
) {
	const { slug, offeringId, csrfToken } = args;
	const resumed = await resumeCustomerMembershipPurchase(slug, offeringId);
	if (
		resumed.selection.organizationSlug !== slug ||
		resumed.selection.offeringId !== offeringId
	)
		throw new Error("Membership selection could not be resumed.");
	const entitlementClass =
		resumed.selection.entitlementClass ??
		args.entitlementClass ??
		"teacher_membership";
	const path = `${buildOrgMembershipPath(slug)}?purchase=${encodeURIComponent(offeringId)}`;
	window.history.replaceState(null, "", path);
	if (!csrfToken)
		return ctrl.patch({
			entitlementClass,
			status:
				"Your Teacher Membership selection is authenticated. Select your division before continuing.",
		});
	ctrl.patch({
		selectedOfferingId: offeringId,
		entitlementClass,
		csrfToken,
		divisionId: "",
		staffAccessConsent: false,
		directoryOptIn: resolveInitialCheckoutDirectoryOptIn(
			readPendingTeacherDirectoryOptIn(slug),
		),
		status: "",
	});
}

function cancelMembershipPurchase(ctrl: CheckoutController) {
	const slug = ctrl.slug();
	if (ctrl.state().submitting || !slug) return;
	ctrl.patch({
		selectedOfferingId: null,
		entitlementClass: null,
		csrfToken: null,
		divisionId: "",
		staffAccessConsent: false,
		error: "",
		status: "",
	});
	window.history.replaceState(null, "", buildOrgMembershipPath(slug));
}
async function submitMembershipCheckout(
	ctrl: CheckoutController,
	isTeacher: boolean,
	blocked: boolean,
) {
	const slug = ctrl.slug();
	const cur = ctrl.state();
	if (!slug || !cur.selectedOfferingId || !cur.csrfToken) return;
	if (!cur.divisionId || !cur.staffAccessConsent || cur.submitting || blocked)
		return;
	const storageKey = `festival-checkout:${slug}:${cur.selectedOfferingId}:${cur.divisionId}`;
	ctrl.patch({ submitting: true, error: "" });
	try {
		if (isTeacher) writePendingTeacherDirectoryOptIn(slug, cur.directoryOptIn);
		const key = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
		sessionStorage.setItem(storageKey, key);
		const checkout = await startCustomerCheckout(
			slug,
			cur.csrfToken,
			cur.selectedOfferingId,
			cur.divisionId,
			cur.staffAccessConsent,
			key,
		);
		sessionStorage.removeItem(storageKey);
		window.location.assign(checkout.checkoutUrl);
	} catch (error) {
		if (
			error instanceof ApiError &&
			(Boolean(error.code && CHECKOUT_ERROR_MESSAGES[error.code]) ||
				error.code === "membership_active")
		)
			sessionStorage.removeItem(storageKey);
		ctrl.patch({ error: purchaseErrorMessage(error) });
	} finally {
		ctrl.patch({ submitting: false });
	}
}
async function startOfferingPurchase(
	ctrl: CheckoutController,
	membershipProduct: PublicMembershipProductSummary,
) {
	const route = ctrl.app.route();
	if (route.kind !== "org-membership") return;
	ctrl.patch({
		error: "",
		status: "",
		pendingOfferingId: membershipProduct.id,
	});
	try {
		const customer = await getCustomerSession(route.slug);
		if (!customer.session.authenticated)
			return window.location.assign(
				customerMembershipPurchaseSignInPath(route.slug, membershipProduct.id),
			);
		await preparePurchase(ctrl, {
			slug: route.slug,
			offeringId: membershipProduct.id,
			csrfToken: customer.session.csrfToken,
			entitlementClass: membershipProduct.entitlementClass,
		});
	} catch (error) {
		ctrl.patch({ error: purchaseErrorMessage(error) });
	} finally {
		ctrl.patch({ pendingOfferingId: null });
	}
}
function resumePurchaseFromLocation(ctrl: CheckoutController) {
	const route = ctrl.app.route();
	const query = new URLSearchParams(window.location.search);
	if (query.get("purchaseError") === "authentication")
		return ctrl.patch({
			error: "Customer authentication was not completed. Please try again.",
		});
	const offeringId = query.get("purchase");
	if (route.kind !== "org-membership" || !offeringId) return;
	ctrl.patch({ pendingOfferingId: offeringId });
	void getCustomerSession(route.slug)
		.then((customer) => {
			if (!customer.session.authenticated)
				throw new Error("Customer session is invalid.");
			return preparePurchase(ctrl, {
				slug: route.slug,
				offeringId,
				csrfToken: customer.session.csrfToken,
			});
		})
		.catch((error) => ctrl.patch({ error: purchaseErrorMessage(error) }))
		.finally(() => ctrl.patch({ pendingOfferingId: null }));
}

function MembershipConsentSteps(props: {
	isTeacher: boolean;
	ctrl: CheckoutController;
}) {
	const s = () => props.ctrl.state();
	return (
		<>
			<section class="membership-checkout-step">
				<h3>2. Agree to sharing data</h3>
				<label class="membership-consent">
					<input
						type="checkbox"
						checked={s().staffAccessConsent}
						disabled={s().submitting}
						aria-describedby="membership-consent-required"
						onInput={(e) =>
							props.ctrl.patch({ staffAccessConsent: e.currentTarget.checked })
						}
					/>
					<span>
						Agree to sharing Shopify-provided contact details to support my
						membership
					</span>
				</label>
				<p class="muted" id="membership-consent-required">
					Required to purchase this membership. See our{" "}
					<a href="/privacy-policy">Privacy Policy</a> for details.
				</p>
			</section>
			<Show when={props.isTeacher}>
				<section class="membership-checkout-step">
					<h3>Public Teacher Directory</h3>
					<label class="membership-consent">
						<input
							type="checkbox"
							checked={s().directoryOptIn}
							disabled={s().submitting}
							onChange={(e) => {
								const checked = e.currentTarget.checked;
								props.ctrl.patch({ directoryOptIn: checked });
								const slug = props.ctrl.slug();
								if (slug) writePendingTeacherDirectoryOptIn(slug, checked);
							}}
						/>
						<span>
							List my name and approved divisions in the Public Teacher
							Directory
						</span>
					</label>
				</section>
			</Show>
		</>
	);
}

function MembershipSubmitStep(props: {
	isTeacher: boolean;
	blocked: boolean;
	ctrl: CheckoutController;
}) {
	const s = () => props.ctrl.state();
	const incomplete = () => !s().divisionId || !s().staffAccessConsent;
	return (
		<section class="membership-checkout-step">
			<h3>3. Purchase or Cancel</h3>
			<p>
				You’ll complete payment securely on Shopify. After payment, choose
				“Return to Festival account” on the confirmation page to view your
				membership status.
			</p>
			<Show when={incomplete()}>
				<p class="muted">
					Select a division and agree to sharing data to enable Purchase.
				</p>
			</Show>
			<div class="membership-checkout-actions">
				<Button
					type="button"
					variant="secondary"
					disabled={s().submitting}
					onClick={() => cancelMembershipPurchase(props.ctrl)}
				>
					Cancel
				</Button>
				<Button
					type="button"
					disabled={incomplete() || props.blocked || s().submitting}
					onClick={() =>
						void submitMembershipCheckout(
							props.ctrl,
							props.isTeacher,
							props.blocked,
						)
					}
				>
					{s().submitting ? "Opening Shopify…" : "Purchase"}
				</Button>
			</div>
		</section>
	);
}

type DivisionsResource = {
	(): Awaited<ReturnType<typeof getPublicDivisions>> | undefined;
	loading: boolean;
	error: unknown;
};
function MembershipDivisionStep(props: {
	divisions: DivisionsResource;
	ctrl: CheckoutController;
}) {
	const s = () => props.ctrl.state();
	return (
		<section class="membership-checkout-step">
			<h3>
				<label for="membership-division">1. Select Division</label>
			</h3>
			<select
				id="membership-division"
				value={s().divisionId}
				disabled={s().submitting || props.divisions.loading}
				onInput={(e) => props.ctrl.patch({ divisionId: e.currentTarget.value })}
			>
				<option value="">Select a division</option>
				<For each={props.divisions()?.divisions ?? []}>
					{(d) => <option value={d.id}>{d.displayName}</option>}
				</For>
			</select>
			<Show when={props.divisions.loading}>
				<p class="muted">Loading available divisions.</p>
			</Show>
			<Show when={Boolean(props.divisions.error)}>
				<p class="membership-unavailable" role="alert">
					Available divisions could not be loaded. Please try again.
				</p>
			</Show>
		</section>
	);
}
function MembershipCheckoutDetails(props: {
	product?: PublicMembershipProductSummary;
	divisions: DivisionsResource;
	ctrl: CheckoutController;
}) {
	const isTeacher = () =>
		(props.product?.entitlementClass ?? props.ctrl.state().entitlementClass) ===
		"teacher_membership";
	return (
		<section
			class="membership-checkout-details"
			aria-label="Membership checkout details"
		>
			<header class="membership-checkout-summary">
				<h2>Purchase membership</h2>
				<Show when={props.product}>
					{(p) => (
						<>
							<strong>{p().name}</strong>
							<p>{`${p().price.amount} ${p().price.currencyCode}`}</p>
						</>
					)}
				</Show>
			</header>
			<MembershipDivisionStep divisions={props.divisions} ctrl={props.ctrl} />
			<MembershipConsentSteps isTeacher={isTeacher()} ctrl={props.ctrl} />
			<MembershipSubmitStep
				isTeacher={isTeacher()}
				blocked={props.divisions.loading || Boolean(props.divisions.error)}
				ctrl={props.ctrl}
			/>
		</section>
	);
}
function MembershipProductGrid(props: {
	products: readonly PublicMembershipProductSummary[];
	ctrl: CheckoutController;
}) {
	const pending = () => props.ctrl.state().pendingOfferingId;
	const btnLabel = (item: PublicMembershipProductSummary) =>
		!item.available
			? "Unavailable"
			: pending() === item.id
				? "Continuing…"
				: "Purchase";
	return (
		<div class="membership-product-grid">
			<For each={props.products}>
				{(membershipProduct) => (
					<article class="membership-product-card">
						<div>
							<p class="membership-product-type">
								{formatEntitlementClass(membershipProduct.entitlementClass)}
							</p>
							<h2>{membershipProduct.name}</h2>
						</div>
						<Show when={membershipProduct.description}>
							<div
								class="membership-description"
								innerHTML={sanitizeShopifyDescriptionHtml(
									membershipProduct.description ?? "",
								)}
							/>
						</Show>
						<div class="membership-product-footer">
							<strong>{`${membershipProduct.price.amount} ${membershipProduct.price.currencyCode}`}</strong>
							<Button
								type="button"
								disabled={
									!membershipProduct.available ||
									pending() === membershipProduct.id
								}
								onClick={() =>
									void startOfferingPurchase(props.ctrl, membershipProduct)
								}
							>
								{btnLabel(membershipProduct)}
							</Button>
						</div>
					</article>
				)}
			</For>
		</div>
	);
}
export function MembershipPage(props: { app: FestivalAppController }) {
	const ctrl = createCheckoutController(props.app);
	const [response] = createResource(ctrl.slug, (slug) =>
		getMembershipProducts(slug),
	);
	const [divisions] = createResource(ctrl.slug, getPublicDivisions);
	onMount(() => resumePurchaseFromLocation(ctrl));
	const s = () => ctrl.state();
	const isEmpty = () =>
		!response.loading &&
		!response.error &&
		response()?.membershipProducts.length === 0;
	return (
		<section class="panel membership-page">
			<Show when={response.loading}>
				<p class="muted">Loading membership information.</p>
			</Show>
			<Show when={response.error}>
				<div class="membership-unavailable" role="status">
					Membership information is temporarily unavailable. Please try again
					later.
				</div>
			</Show>
			<Show when={s().error}>
				<div class="membership-unavailable" role="alert">
					{s().error}
				</div>
			</Show>
			<Show when={s().status}>
				<div class="membership-purchase-status" role="status">
					{s().status}
				</div>
			</Show>
			<Show when={s().selectedOfferingId}>
				<MembershipCheckoutDetails
					product={response()?.membershipProducts.find(
						(p) => p.id === s().selectedOfferingId,
					)}
					divisions={divisions}
					ctrl={ctrl}
				/>
			</Show>
			<Show when={isEmpty()}>
				<p class="muted">No memberships are available right now.</p>
			</Show>
			<Show when={!s().selectedOfferingId && !s().pendingOfferingId}>
				<MembershipProductGrid
					products={response()?.membershipProducts ?? []}
					ctrl={ctrl}
				/>
			</Show>
		</section>
	);
}
