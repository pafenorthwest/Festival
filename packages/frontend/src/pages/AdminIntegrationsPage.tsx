import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";

interface AdminIntegrationsPageProps {
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

export function AdminIntegrationsPage(props: AdminIntegrationsPageProps) {
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage integrations." />
			}
		>
			<section class="panel flow-panel">
				<form
					class="shopify-integration-card"
					onSubmit={(event) => {
						event.preventDefault();
						void props.app.handleSaveShopifySettings();
					}}
				>
					<div class="shopify-card-header">
						<div>
							<h2>Shopify Integration</h2>
							<p>Store credentials and verify Admin API access.</p>
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
			</section>
		</Show>
	);
}
