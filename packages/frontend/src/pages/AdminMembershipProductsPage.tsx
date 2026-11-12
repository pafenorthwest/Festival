import type { MembershipProductSummary } from "@festival/common";
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
import { AdminEntitlementReportPanel } from "./AdminEntitlementReportPanel.js";
import { AdminTeacherDirectoryPanel } from "./AdminTeacherDirectoryPanel.js";
import {
	AdminTeacherOfferingEditForm,
	canEditTeacherOffering,
	TEACHER_OFFERING_UPDATED_MESSAGE,
} from "./AdminTeacherOfferingEditForm.js";

const ACCOMPANIST_POLICY_CHOICES = [
	["exactly_one", "Exactly one division"],
	["one_to_two", "One or two divisions"],
	["one_to_all", "One or more divisions"],
] as const;
type AccompanistPolicyValue = (typeof ACCOMPANIST_POLICY_CHOICES)[number][0];

function formatOption(value: string): string {
	return value
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function AdminMembershipOfferingItem(props: {
	app: FestivalAppController;
	offering: MembershipProductSummary;
	editingId: string | undefined;
	retiringId: string | undefined;
	onSelectEdit: (id?: string) => void;
	onSavedEdit: () => void;
	onRetire: (offering: MembershipProductSummary) => void;
}) {
	const item = () => props.offering;
	const editing = () => props.editingId === item().id;
	const retiring = () => props.retiringId === item().id;
	return (
		<article class="admin-membership-item">
			<div>
				<strong>{item().name}</strong>
				<Show when={item().description}>
					<p class="muted">{item().description}</p>
				</Show>
				<span>{`${formatOption(item().entitlementClass)} · ${item().durationDays} days`}</span>
			</div>
			<div class="admin-membership-meta">
				<span>Plan: {item().variantName}</span>
				<strong>{`${item().price.amount} ${item().price.currencyCode}`}</strong>
				<Show when={!item().isActive}>
					<span>Retired</span>
				</Show>
				<Show when={canEditTeacherOffering(item())}>
					<Button
						type="button"
						variant="secondary"
						disabled={editing()}
						onClick={() => props.onSelectEdit(item().id)}
					>
						Edit
					</Button>
				</Show>
				<Show when={item().isActive}>
					<Button
						type="button"
						variant="secondary"
						disabled={retiring() || editing()}
						onClick={() => props.onRetire(item())}
					>
						{retiring() ? "Retiring…" : "Retire"}
					</Button>
				</Show>
			</div>
			<Show when={canEditTeacherOffering(item()) && editing()}>
				<AdminTeacherOfferingEditForm
					app={props.app}
					offering={item()}
					onClose={() => props.onSelectEdit()}
					onSaved={props.onSavedEdit}
				/>
			</Show>
		</article>
	);
}
async function confirmAndRetireOffering(
	app: FestivalAppController,
	offering: MembershipProductSummary,
	patch: (next: { error?: string; retiringId?: string }) => void,
) {
	const route = app.route();
	const user = app.firebaseUser();
	if (route.kind !== "org-admin-memberships" || !user) return;
	if (
		!window.confirm(
			`Retire ${offering.name}? This prevents future purchases and does not change existing memberships.`,
		)
	)
		return;
	patch({ error: "", retiringId: offering.id });
	try {
		await retireAdminMembershipProduct(
			await user.getIdToken(),
			route.slug,
			offering.id,
		);
		await app.loadMembershipProducts(route.slug);
	} catch {
		patch({ error: "Membership offering could not be retired." });
	} finally {
		patch({ retiringId: undefined });
	}
}
function AdminMembershipListHeader(props: { app: FestivalAppController }) {
	const rosterPath = () =>
		props.app.route().kind === "org-admin-memberships"
			? buildOrgAdminRosterPath(props.app.slug)
			: undefined;
	return (
		<div class="shopify-card-header">
			<div>
				<h2 id="memberships-title">Memberships</h2>
				<p>Review Shopify-backed membership products.</p>
			</div>
			<div class="admin-membership-header-actions">
				<Button
					type="button"
					variant="secondary"
					data-preload-path={rosterPath()}
					onClick={() => {
						const route = props.app.route();
						if (route.kind === "org-admin-memberships")
							props.app.navigate(buildOrgAdminRosterPath(route.slug));
					}}
				>
					Staff Roster
				</Button>
				<span class="shopify-status shopify-status-ok">
					{props.app.membershipProducts().length}
				</span>
			</div>
		</div>
	);
}
function AdminOfferingsStatusBanners(props: {
	app: FestivalAppController;
	error: string;
	status: string;
}) {
	const errMsg = () => props.app.membershipProductsLoadError() || props.error;
	return (
		<>
			<Show when={props.app.isLoadingMembershipProducts()}>
				<p class="muted" role="status">
					Loading memberships...
				</p>
			</Show>
			<Show when={errMsg()}>
				<p class="shopify-error-text" role="alert">
					{errMsg()}
				</p>
			</Show>
			<Show when={props.status}>
				<p role="status">{props.status}</p>
			</Show>
		</>
	);
}
function AdminMembershipOfferingsSection(props: {
	app: FestivalAppController;
}) {
	const [ui, setUi] = createSignal({
		error: "",
		retiringId: undefined as string | undefined,
		editingId: undefined as string | undefined,
		status: "",
	});
	const patch = (next: Partial<ReturnType<typeof ui>>) =>
		setUi((cur) => ({ ...cur, ...next }));
	const ready = () =>
		!props.app.isLoadingMembershipProducts() &&
		!props.app.membershipProductsLoadError();
	return (
		<section class="membership-admin-list" aria-labelledby="memberships-title">
			<AdminMembershipListHeader app={props.app} />
			<AdminOfferingsStatusBanners
				app={props.app}
				error={ui().error}
				status={ui().status}
			/>
			<Show when={ready()}>
				<Show
					when={props.app.membershipProducts().length > 0}
					fallback={<p class="muted">No membership products yet.</p>}
				>
					<div class="admin-membership-list">
						<For each={props.app.membershipProducts()}>
							{(offering) => (
								<AdminMembershipOfferingItem
									app={props.app}
									offering={offering}
									editingId={ui().editingId}
									retiringId={ui().retiringId}
									onSelectEdit={(id) =>
										patch(
											id ? { editingId: id, status: "" } : { editingId: id },
										)
									}
									onSavedEdit={() =>
										patch({
											editingId: undefined,
											status: TEACHER_OFFERING_UPDATED_MESSAGE,
										})
									}
									onRetire={(item) =>
										void confirmAndRetireOffering(props.app, item, patch)
									}
								/>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</section>
	);
}
function CreateMembershipFields(props: { app: FestivalAppController }) {
	const draft = () => props.app.membershipProductDraft();
	const showVal = () => props.app.shouldShowMembershipProductValidation();
	const patchDraft = (
		next: Partial<ReturnType<FestivalAppController["membershipProductDraft"]>>,
	) =>
		props.app.setMembershipProductDraft((current) => ({ ...current, ...next }));
	return (
		<>
			<label class="field">
				<span>Membership name</span>
				<input
					type="text"
					value={draft().name}
					aria-invalid={showVal() && !draft().name.trim()}
					onInput={(e) => patchDraft({ name: e.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Description</span>
				<textarea
					rows="4"
					value={draft().description}
					onInput={(e) => patchDraft({ description: e.currentTarget.value })}
				/>
			</label>
			<label class="field">
				<span>Annual price</span>
				<input
					type="text"
					inputmode="decimal"
					placeholder="75.00"
					value={draft().price}
					aria-invalid={
						showVal() && !props.app.membershipProductValidation().valid
					}
					onInput={(e) => patchDraft({ price: e.currentTarget.value })}
				/>
			</label>
		</>
	);
}

function ShopifyPrerequisiteNotice(props: { app: FestivalAppController }) {
	const route = () => props.app.route();
	const path = () =>
		route().kind === "org-admin-memberships"
			? buildOrgAdminIntegrationsPath(props.app.slug)
			: undefined;
	return (
		<div class="membership-prerequisite" role="status">
			<p>
				Verified Shopify integration is required before creating memberships.
			</p>
			<Button
				type="button"
				variant="secondary"
				data-preload-path={path()}
				onClick={() => {
					const r = route();
					if (r.kind === "org-admin-memberships")
						props.app.navigate(buildOrgAdminIntegrationsPath(r.slug));
				}}
			>
				Open Shopify Integration
			</Button>
		</div>
	);
}

function CreateMembershipForm(props: { app: FestivalAppController }) {
	const shopifyIntegrationVerified = () =>
		props.app.shopifySettings()?.verificationStatus === "ok";
	return (
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
					<p>Shopify creates the product; Festival stores the association.</p>
				</div>
				<span
					class={`shopify-status ${props.app.shopifyPrerequisiteMet() ? "shopify-status-ok" : "shopify-status-not-ready"}`}
				>
					{props.app.shopifyPrerequisiteMet() ? "Ready" : "Not Ready"}
				</span>
			</div>
			<Show when={!shopifyIntegrationVerified()}>
				<ShopifyPrerequisiteNotice app={props.app} />
			</Show>
			<CreateMembershipFields app={props.app} />
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
	);
}

async function syncAccompanistPolicy(
	app: FestivalAppController,
	next: AccompanistPolicyValue | null,
	callbacks: {
		setPolicy: (p: AccompanistPolicyValue) => void;
		setError: (msg: string) => void;
	},
) {
	const route = app.route();
	const user = app.firebaseUser();
	if (route.kind !== "org-admin-memberships" || !user) return;
	if (next) callbacks.setError("");
	try {
		const token = await user.getIdToken();
		if (next) {
			await saveAdminAccompanistPolicy(token, route.slug, next);
			callbacks.setPolicy(next);
		} else {
			const res = await getAdminAccompanistPolicy(token, route.slug);
			callbacks.setPolicy(res.policy.policy);
		}
	} catch {
		callbacks.setError(
			next
				? "Accompanist division policy could not be saved."
				: "Accompanist division policy could not be loaded.",
		);
	}
}

function AccompanistPolicySection(props: { app: FestivalAppController }) {
	const [policy, setPolicy] =
		createSignal<AccompanistPolicyValue>("exactly_one");
	const [policyError, setPolicyError] = createSignal("");
	const callbacks = { setPolicy, setError: setPolicyError };
	onMount(() => void syncAccompanistPolicy(props.app, null, callbacks));
	const rosterHref = () =>
		buildOrgAdminRosterPath(
			props.app.route().kind === "org-admin-memberships"
				? (props.app.route() as { slug: string }).slug
				: "",
		);

	return (
		<section class="panel flow-panel membership-admin-form">
			<div class="shopify-card-header">
				<div>
					<h2>Accompanist division policy</h2>
					<p>Choose how many divisions an accompanist may select.</p>
				</div>
				<a class="secondary-link" href={rosterHref()}>
					View Staff Roster
				</a>
			</div>
			<Show when={policyError()}>
				{(msg) => <p class="shopify-error-text">{msg()}</p>}
			</Show>
			<fieldset class="field">
				<legend>Division selection</legend>
				<For each={ACCOMPANIST_POLICY_CHOICES}>
					{([value, label]) => (
						<label>
							<input
								type="radio"
								name="accompanist-division-policy"
								checked={policy() === value}
								onChange={() =>
									void syncAccompanistPolicy(props.app, value, callbacks)
								}
							/>
							{label}
						</label>
					)}
				</For>
			</fieldset>
		</section>
	);
}

export function AdminMembershipProductsPage(props: {
	app: FestivalAppController;
}) {
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage memberships." />
			}
		>
			<section class="panel flow-panel">
				<div class="membership-admin-layout">
					<AdminMembershipOfferingsSection app={props.app} />
					<CreateMembershipForm app={props.app} />
				</div>
			</section>
			<AccompanistPolicySection app={props.app} />
			<AdminTeacherDirectoryPanel app={props.app} />
			<AdminEntitlementReportPanel app={props.app} />
		</Show>
	);
}
