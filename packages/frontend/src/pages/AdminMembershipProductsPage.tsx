import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { buildOrgAdminIntegrationsPath } from "../lib/routes.js";

interface AdminMembershipProductsPageProps {
	app: FestivalAppController;
}

function formatOption(value: string): string {
	return value
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function AdminMembershipProductsPage(
	props: AdminMembershipProductsPageProps,
) {
	const shopifyIntegrationVerified = () =>
		props.app.shopifySettings()?.verificationStatus === "ok";

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage memberships." />
			}
		>
			<section class="panel flow-panel">
				<div class="membership-admin-layout">
					<section
						class="membership-admin-list"
						aria-labelledby="memberships-title"
					>
						<div class="shopify-card-header">
							<div>
								<h2 id="memberships-title">Memberships</h2>
								<p>Review Shopify-backed membership products.</p>
							</div>
							<span class="shopify-status shopify-status-ok">
								{props.app.membershipProducts().length}
							</span>
						</div>

						<Show when={props.app.isLoadingMembershipProducts()}>
							<p class="muted" role="status">
								Loading memberships...
							</p>
						</Show>

						<Show when={props.app.membershipProductsLoadError()}>
							{(message) => (
								<p class="shopify-error-text" role="alert">
									{message()}
								</p>
							)}
						</Show>

						<Show
							when={
								!props.app.isLoadingMembershipProducts() &&
								!props.app.membershipProductsLoadError()
							}
						>
							<Show
								when={props.app.membershipProducts().length > 0}
								fallback={<p class="muted">No membership products yet.</p>}
							>
								<div class="admin-membership-list">
									<For each={props.app.membershipProducts()}>
										{(membershipProduct) => (
											<article class="admin-membership-item">
												<div>
													<strong>{membershipProduct.name}</strong>
													<span>
														{formatOption(membershipProduct.entitlementClass)} ·{" "}
														{membershipProduct.durationDays} days
													</span>
												</div>
												<div class="admin-membership-meta">
													<span>Plan: {membershipProduct.variantName}</span>
													<strong>
														{membershipProduct.price.amount}{" "}
														{membershipProduct.price.currencyCode}
													</strong>
												</div>
											</article>
										)}
									</For>
								</div>
							</Show>
						</Show>
					</section>

					<form
						class="shopify-integration-card membership-admin-form"
						onSubmit={(event) => {
							event.preventDefault();
							void props.app.handleCreateMembershipProduct();
						}}
					>
						<div class="shopify-card-header">
							<div>
								<h2>Create Membership</h2>
								<p>
									Shopify creates the product; Festival stores the association.
								</p>
							</div>
							<span
								class={`shopify-status ${props.app.shopifyPrerequisiteMet() ? "shopify-status-ok" : "shopify-status-not-ready"}`}
							>
								{props.app.shopifyPrerequisiteMet() ? "Ready" : "Not Ready"}
							</span>
						</div>

						<Show when={!shopifyIntegrationVerified()}>
							<div class="membership-prerequisite" role="status">
								<p>
									Verified Shopify integration is required before creating
									memberships.
								</p>
								<button
									type="button"
									class="secondary-button"
									onClick={() => {
										const route = props.app.route();
										if (route.kind !== "org-admin-memberships") {
											return;
										}

										props.app.navigate(
											buildOrgAdminIntegrationsPath(route.slug),
										);
									}}
								>
									Open Shopify Integration
								</button>
							</div>
						</Show>

						<label class="field">
							<span>Membership name</span>
							<input
								type="text"
								value={props.app.membershipProductDraft().name}
								aria-invalid={
									props.app.shouldShowMembershipProductValidation() &&
									!props.app.membershipProductDraft().name.trim()
								}
								onInput={(event) =>
									props.app.setMembershipProductDraft((current) => ({
										...current,
										name: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label class="field">
							<span>Description</span>
							<textarea
								rows="4"
								value={props.app.membershipProductDraft().description}
								onInput={(event) =>
									props.app.setMembershipProductDraft((current) => ({
										...current,
										description: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label class="field">
							<span>Annual price</span>
							<input
								type="text"
								inputmode="decimal"
								placeholder="75.00"
								value={props.app.membershipProductDraft().price}
								aria-invalid={
									props.app.shouldShowMembershipProductValidation() &&
									!props.app.membershipProductValidation().valid
								}
								onInput={(event) =>
									props.app.setMembershipProductDraft((current) => ({
										...current,
										price: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<p class="muted">Teacher Membership · 365 days · Plan: Standard</p>
						<Show when={props.app.shouldShowMembershipProductValidation()}>
							<p class="shopify-error-text">
								{props.app.membershipProductValidationMessage()}
							</p>
						</Show>
						<button
							type="submit"
							class="shopify-submit-button"
							disabled={
								!props.app.shopifyPrerequisiteMet() ||
								props.app.isCreatingMembershipProduct()
							}
						>
							<Show
								when={props.app.isCreatingMembershipProduct()}
								fallback="Create Membership"
							>
								<span class="button-spinner" aria-hidden="true" />
								<span>Creating</span>
							</Show>
						</button>
					</form>
				</div>
			</section>
		</Show>
	);
}
