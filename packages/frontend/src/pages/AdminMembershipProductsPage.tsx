import { createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	getAdminAccompanistPolicy,
	retireAdminMembershipProduct,
	saveAdminAccompanistPolicy,
} from "../lib/api.js";
import {
	buildOrgAdminIntegrationsPath,
	buildOrgAdminRosterPath,
} from "../lib/routes.js";

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
	const membershipProducts = () => props.app.membershipProducts();
	const [retirementError, setRetirementError] = createSignal("");
	const [retiringOfferingId, setRetiringOfferingId] = createSignal<string>();
	const [accompanistPolicy, setAccompanistPolicy] = createSignal<
		"exactly_one" | "one_to_two" | "one_to_all"
	>("exactly_one");
	const [policyError, setPolicyError] = createSignal("");
	const choices = [
		["exactly_one", "Exactly one division"],
		["one_to_two", "One or two divisions"],
		["one_to_all", "One or more divisions"],
	] as const;
	onMount(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return;
		void (async () => {
			try {
				const response = await getAdminAccompanistPolicy(
					await user.getIdToken(),
					route.slug,
				);
				setAccompanistPolicy(response.policy.policy);
			} catch {
				setPolicyError("Accompanist division policy could not be loaded.");
			}
		})();
	});
	const savePolicy = async (
		policy: "exactly_one" | "one_to_two" | "one_to_all",
	) => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return;
		setPolicyError("");
		try {
			await saveAdminAccompanistPolicy(
				await user.getIdToken(),
				route.slug,
				policy,
			);
			setAccompanistPolicy(policy);
		} catch {
			setPolicyError("Accompanist division policy could not be saved.");
		}
	};
	const retireOffering = async (offeringId: string, name: string) => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return;
		if (
			!window.confirm(
				`Retire ${name}? This prevents future purchases and does not change existing memberships.`,
			)
		)
			return;
		setRetirementError("");
		setRetiringOfferingId(offeringId);
		try {
			await retireAdminMembershipProduct(
				await user.getIdToken(),
				route.slug,
				offeringId,
			);
			await props.app.reloadMembershipProducts();
		} catch {
			setRetirementError("Membership offering could not be retired.");
		} finally {
			setRetiringOfferingId();
		}
	};

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
							<div class="admin-membership-header-actions">
								<Button
									type="button"
									variant="secondary"
									onClick={() => {
										const route = props.app.route();
										if (route.kind !== "org-admin-memberships") {
											return;
										}
										props.app.navigate(buildOrgAdminRosterPath(route.slug));
									}}
								>
									Staff Roster
								</Button>
								<span class="shopify-status shopify-status-ok">
									{membershipProducts().length}
								</span>
							</div>
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
						<Show when={retirementError()}>
							<p class="shopify-error-text" role="alert">
								{retirementError()}
							</p>
						</Show>

						<Show
							when={
								!props.app.isLoadingMembershipProducts() &&
								!props.app.membershipProductsLoadError()
							}
						>
							<Show
								when={membershipProducts().length > 0}
								fallback={<p class="muted">No membership products yet.</p>}
							>
								<div class="admin-membership-list">
									<For each={membershipProducts()}>
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
													<Show when={!membershipProduct.isActive}>
														<span>Retired</span>
													</Show>
													<Show when={membershipProduct.isActive}>
														<Button
															type="button"
															variant="secondary"
															disabled={
																retiringOfferingId() === membershipProduct.id
															}
															onClick={() =>
																void retireOffering(
																	membershipProduct.id,
																	membershipProduct.name,
																)
															}
														>
															{retiringOfferingId() === membershipProduct.id
																? "Retiring…"
																: "Retire"}
														</Button>
													</Show>
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
								<Button
									type="button"
									variant="secondary"
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
								</Button>
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
						<Button
							type="submit"
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
						</Button>
					</form>
				</div>
			</section>
			<section class="panel flow-panel membership-admin-form">
				<div class="shopify-card-header">
					<div>
						<h2>Accompanist division policy</h2>
						<p>Choose how many divisions an accompanist may select.</p>
					</div>
					<a
						class="secondary-link"
						href={buildOrgAdminRosterPath(
							props.app.route().kind === "org-admin-memberships"
								? (props.app.route() as { slug: string }).slug
								: "",
						)}
					>
						View Staff Roster
					</a>
				</div>
				<Show when={policyError()}>
					{(message) => <p class="shopify-error-text">{message()}</p>}
				</Show>
				<fieldset class="field">
					<legend>Division selection</legend>
					<For each={choices}>
						{([value, label]) => (
							<label>
								<input
									type="radio"
									name="accompanist-division-policy"
									checked={accompanistPolicy() === value}
									onChange={() => void savePolicy(value)}
								/>
								{label}
							</label>
						)}
					</For>
				</fieldset>
			</section>
		</Show>
	);
}
