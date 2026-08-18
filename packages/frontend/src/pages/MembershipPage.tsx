import { createResource, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { getMembershipProducts } from "../lib/api.js";
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
								<span>{membershipProduct.status ?? "Unavailable"}</span>
							</div>
						</article>
					)}
				</For>
			</div>
		</section>
	);
}
