import type { PublicMembershipProductSummary } from "@festival/common";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
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

interface MembershipPageProps {
	app: FestivalAppController;
}

function purchaseErrorMessage(error: unknown): string {
	if (!(error instanceof ApiError))
		return "Customer authentication or membership selection could not be resumed. Please try again.";
	switch (error.code) {
		case "checkout_in_progress":
			return "Your checkout is still being prepared. Please wait a moment before trying again.";
		case "checkout_expired":
			return "This checkout expired before it could continue. Start a new checkout.";
		case "checkout_retryable_upstream":
			return "Shopify checkout is temporarily unavailable. Please try again.";
		case "checkout_terminal_failure":
			return "This checkout attempt cannot continue. Start a new checkout.";
		default:
			return error.message;
	}
}

function formatEntitlementClass(value: string): string {
	return value
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function MembershipPage(props: MembershipPageProps) {
	const [purchaseError, setPurchaseError] = createSignal("");
	const [purchaseStatus, setPurchaseStatus] = createSignal("");
	const [pendingOfferingId, setPendingOfferingId] = createSignal<string | null>(
		null,
	);
	const [selectedOfferingId, setSelectedOfferingId] = createSignal<
		string | null
	>(null);
	const [checkoutCsrfToken, setCheckoutCsrfToken] = createSignal<string | null>(
		null,
	);
	const [selectedDivisionId, setSelectedDivisionId] = createSignal("");
	const [staffAccessConsent, setStaffAccessConsent] = createSignal(false);
	const [checkoutSubmitting, setCheckoutSubmitting] = createSignal(false);
	const [response] = createResource(
		() => {
			const route = props.app.route();
			return route.kind === "org-membership" ? route.slug : null;
		},
		async (slug) => {
			if (!slug) {
				throw new Error("Organization slug is required.");
			}

			return getMembershipProducts(slug);
		},
	);
	const [divisions] = createResource(
		() => {
			const route = props.app.route();
			return route.kind === "org-membership" ? route.slug : null;
		},
		async (slug) => {
			if (!slug) throw new Error("Organization slug is required.");
			return getPublicDivisions(slug);
		},
	);

	async function preparePurchase(
		slug: string,
		offeringId: string,
		csrfToken?: string,
	) {
		const resumed = await resumeCustomerMembershipPurchase(slug, offeringId);
		if (
			resumed.selection.organizationSlug !== slug ||
			resumed.selection.offeringId !== offeringId
		) {
			throw new Error("Membership selection could not be resumed.");
		}
		window.history.replaceState(
			null,
			"",
			`${buildOrgMembershipPath(slug)}?purchase=${encodeURIComponent(offeringId)}`,
		);
		if (!csrfToken) {
			setPurchaseStatus(
				"Your Teacher Membership selection is authenticated. Select your division before continuing.",
			);
			return;
		}
		setSelectedOfferingId(offeringId);
		setCheckoutCsrfToken(csrfToken);
		setSelectedDivisionId("");
		setStaffAccessConsent(false);
		setPurchaseStatus(
			"Select your division and optional staff-access consent before continuing to Shopify.",
		);
	}

	async function startCheckout(slug: string) {
		const offeringId = selectedOfferingId();
		const csrfToken = checkoutCsrfToken();
		const divisionId = selectedDivisionId();
		if (!offeringId || !csrfToken || !divisionId) return;
		const storageKey = `festival-checkout:${slug}:${offeringId}:${divisionId}`;
		setCheckoutSubmitting(true);
		setPurchaseError("");
		try {
			const idempotencyKey =
				sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
			sessionStorage.setItem(storageKey, idempotencyKey);
			const checkout = await startCustomerCheckout(
				slug,
				csrfToken,
				offeringId,
				divisionId,
				staffAccessConsent(),
				idempotencyKey,
			);
			sessionStorage.removeItem(storageKey);
			window.location.assign(checkout.checkoutUrl);
		} catch (error) {
			if (
				error instanceof ApiError &&
				(error.code === "checkout_expired" ||
					error.code === "checkout_terminal_failure" ||
					error.code === "membership_active")
			)
				sessionStorage.removeItem(storageKey);
			setPurchaseError(purchaseErrorMessage(error));
		} finally {
			setCheckoutSubmitting(false);
		}
	}

	async function purchase(membershipProduct: PublicMembershipProductSummary) {
		const route = props.app.route();
		if (route.kind !== "org-membership") return;
		setPurchaseError("");
		setPurchaseStatus("");
		setPendingOfferingId(membershipProduct.id);
		try {
			const customer = await getCustomerSession(route.slug);
			if (!customer.session.authenticated) {
				window.location.assign(
					customerMembershipPurchaseSignInPath(
						route.slug,
						membershipProduct.id,
					),
				);
				return;
			}
			await preparePurchase(
				route.slug,
				membershipProduct.id,
				customer.session.csrfToken,
			);
		} catch (error) {
			setPurchaseError(purchaseErrorMessage(error));
		} finally {
			setPendingOfferingId(null);
		}
	}

	onMount(() => {
		const route = props.app.route();
		const query = new URLSearchParams(window.location.search);
		if (query.get("purchaseError") === "authentication") {
			setPurchaseError(
				"Customer authentication was not completed. Please try again.",
			);
			return;
		}
		const offeringId = query.get("purchase");
		if (route.kind !== "org-membership" || !offeringId) return;
		setPendingOfferingId(offeringId);
		void getCustomerSession(route.slug)
			.then((customer) => {
				if (!customer.session.authenticated)
					throw new Error("Customer session is invalid.");
				return preparePurchase(
					route.slug,
					offeringId,
					customer.session.csrfToken,
				);
			})
			.catch((error) => {
				setPurchaseError(purchaseErrorMessage(error));
			})
			.finally(() => setPendingOfferingId(null));
	});

	return (
		<section class="panel membership-page">
			<header class="membership-header">
				<div>
					<p class="eyebrow">Memberships</p>
					<h1>{response()?.organization.name ?? "Organization Memberships"}</h1>
				</div>
			</header>

			<Show when={response.loading}>
				<p class="muted">Loading membership information.</p>
			</Show>

			<Show when={response.error}>
				<div class="membership-unavailable" role="status">
					Membership information is temporarily unavailable. Please try again
					later.
				</div>
			</Show>

			<Show when={purchaseError()}>
				<div class="membership-unavailable" role="alert">
					{purchaseError()}
				</div>
			</Show>
			<Show when={purchaseStatus()}>
				<div class="membership-purchase-status" role="status">
					{purchaseStatus()}
				</div>
			</Show>
			<Show when={selectedOfferingId()}>
				<section
					class="membership-checkout-details"
					aria-label="Membership checkout details"
				>
					<h2>Membership details</h2>
					<p class="muted">
						Choose the Festival division this Teacher Membership supports.
					</p>
					<label>
						Division
						<select
							value={selectedDivisionId()}
							onInput={(event) =>
								setSelectedDivisionId(event.currentTarget.value)
							}
						>
							<option value="">Select a division</option>
							<For each={divisions()?.divisions ?? []}>
								{(division) => (
									<option value={division.id}>{division.displayName}</option>
								)}
							</For>
						</select>
					</label>
					<Show when={divisions.loading}>
						<p class="muted">Loading available divisions.</p>
					</Show>
					<Show when={divisions.error}>
						<p class="membership-unavailable" role="alert">
							Available divisions could not be loaded. Please try again.
						</p>
					</Show>
					<label class="membership-consent">
						<input
							type="checkbox"
							checked={staffAccessConsent()}
							onInput={(event) =>
								setStaffAccessConsent(event.currentTarget.checked)
							}
						/>
						<span>
							I consent to Festival staff accessing Shopify-provided contact
							details when needed to support my membership.
						</span>
					</label>
					<button
						type="button"
						disabled={
							!selectedDivisionId() || divisions.loading || checkoutSubmitting()
						}
						onClick={() => {
							const route = props.app.route();
							if (route.kind === "org-membership") {
								void startCheckout(route.slug);
							}
						}}
					>
						{checkoutSubmitting() ? "Opening Shopify…" : "Continue to Shopify"}
					</button>
				</section>
			</Show>

			<Show
				when={
					!response.loading &&
					!response.error &&
					response()?.membershipProducts.length === 0
				}
			>
				<p class="muted">No memberships are available right now.</p>
			</Show>

			<div class="membership-product-grid">
				<For each={response()?.membershipProducts ?? []}>
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
								<strong>
									{membershipProduct.price.amount}{" "}
									{membershipProduct.price.currencyCode}
								</strong>
								<button
									type="button"
									disabled={
										!membershipProduct.available ||
										pendingOfferingId() === membershipProduct.id
									}
									onClick={() => void purchase(membershipProduct)}
								>
									{membershipProduct.available
										? pendingOfferingId() === membershipProduct.id
											? "Continuing…"
											: "Purchase"
										: "Unavailable"}
								</button>
							</div>
						</article>
					)}
				</For>
			</div>
		</section>
	);
}
