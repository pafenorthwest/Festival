import type { PublicMembershipProductSummary } from "@festival/common";
import { createResource, createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	customerMembershipPurchaseSignInPath,
	getCustomerSession,
	getMembershipProducts,
	resumeCustomerMembershipPurchase,
	startCustomerCheckout,
} from "../lib/api.js";
import { buildOrgMembershipPath } from "../lib/routes.js";
import { sanitizeShopifyDescriptionHtml } from "../lib/sanitize-html.js";

interface MembershipPageProps {
	app: FestivalAppController;
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

	async function continuePurchase(
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
				"Your Teacher Membership selection is authenticated and ready to continue.",
			);
			return;
		}
		const checkout = await startCustomerCheckout(slug, csrfToken, offeringId);
		window.location.assign(checkout.checkoutUrl);
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
			await continuePurchase(
				route.slug,
				membershipProduct.id,
				customer.session.csrfToken,
			);
		} catch {
			setPurchaseError(
				"Customer authentication or membership selection could not be resumed. Please try again.",
			);
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
		void continuePurchase(route.slug, offeringId)
			.catch(() => {
				setPurchaseError(
					"Customer authentication or membership selection could not be resumed. Please try again.",
				);
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
