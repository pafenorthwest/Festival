import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	buildOrgAdminFestivalsPath,
	buildOrgAdminUsersPath,
} from "../lib/routes.js";

interface AdminHomePageProps {
	app: FestivalAppController;
}

function shopifyStatusLabel(status: string | undefined): string {
	switch (status) {
		case "ok":
			return "OK";
		case "failed":
			return "Failed";
		default:
			return "Unknown";
	}
}

export function AdminHomePage(props: AdminHomePageProps) {
	return (
		<section class="panel org-shell">
			<header class="org-header">
				<h2 class="org-title">
					{props.app.organization()?.name ??
						props.app.sessionMembership()?.organizationName}{" "}
					admin
				</h2>
			</header>

			<Show when={props.app.sessionMembership()?.showWelcome}>
				<div class="welcome-box">
					<div>
						<strong>Welcome to the organization.</strong>
						<p>
							This is your first landing after invite acceptance. Future
							getting-started instructions can live here.
						</p>
					</div>
					<button type="button" onClick={props.app.handleDismissWelcome}>
						Dismiss
					</button>
				</div>
			</Show>

			<div class="admin-card-grid">
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminUsersPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Users</strong>
					<span>Manage members and pending invites.</span>
				</button>
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminFestivalsPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Festivals</strong>
					<span>Create and review festival dates.</span>
				</button>
				<form
					class="admin-workflow-card shopify-integration-card"
					onSubmit={(event) => {
						event.preventDefault();
						void props.app.handleSaveShopifySettings();
					}}
				>
					<div class="shopify-card-header">
						<div>
							<strong>Shopify Integration</strong>
							<span>Store credentials and verify Admin API access.</span>
						</div>
						<span
							class={`shopify-status shopify-status-${props.app.shopifySettings()?.verificationStatus ?? "unknown"}`}
						>
							{shopifyStatusLabel(
								props.app.shopifySettings()?.verificationStatus,
							)}
						</span>
					</div>
					<label class="field">
						<span>Store URL</span>
						<input
							type="text"
							autocomplete="off"
							placeholder="example.myshopify.com"
							value={props.app.shopifyDraft().storeUrl}
							onInput={(event) =>
								props.app.setShopifyDraft((current) => ({
									...current,
									storeUrl: event.currentTarget.value,
								}))
							}
						/>
					</label>
					<label class="field">
						<span>Client ID</span>
						<input
							type="text"
							autocomplete="off"
							value={props.app.shopifyDraft().clientId}
							onInput={(event) =>
								props.app.setShopifyDraft((current) => ({
									...current,
									clientId: event.currentTarget.value,
								}))
							}
						/>
					</label>
					<label class="field">
						<span>Client Secret</span>
						<input
							type="password"
							autocomplete="new-password"
							placeholder={
								props.app.shopifySettings()?.hasClientSecret
									? "Leave blank to keep existing secret"
									: ""
							}
							value={props.app.shopifyDraft().clientSecret}
							onInput={(event) =>
								props.app.setShopifyDraft((current) => ({
									...current,
									clientSecret: event.currentTarget.value,
								}))
							}
						/>
					</label>
					<Show when={props.app.shopifySettings()?.lastError} keyed>
						{(lastError) => <p class="shopify-error-text">{lastError}</p>}
					</Show>
					<button
						type="submit"
						class="shopify-submit-button"
						disabled={
							!props.app.isAdminMember() || props.app.isShopifyTesting()
						}
					>
						<Show when={props.app.isShopifyTesting()} fallback="Save & Test">
							<span class="button-spinner" aria-hidden="true" />
							<span>Testing</span>
						</Show>
					</button>
				</form>
			</div>
		</section>
	);
}
