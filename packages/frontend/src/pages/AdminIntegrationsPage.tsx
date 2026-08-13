import type { ShopifyCapabilityDiagnostics } from "@festival/common";
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

function capabilityLabel(status: string): string {
	return status === "granted"
		? "Granted"
		: status === "disabled"
			? "Disabled"
			: "Missing";
}

export function missingRequiredShopifyScopes(
	capabilities: ShopifyCapabilityDiagnostics,
): string[] {
	return [
		["read_products", capabilities.read_products],
		["write_products", capabilities.write_products],
		["read_orders", capabilities.read_orders],
	]
		.filter(([, status]) => status !== "granted")
		.map(([scope]) => scope);
}

export function buildShopifyAppUrl(origin: string, shortName: string): string {
	return `${origin}/org/${shortName}/admin`;
}

function currentShopifyAppUrl(app: FestivalAppController): string {
	const route = app.route();
	if (route.kind !== "org-admin-integrations") {
		throw new Error(
			"Shopify setup instructions require the integrations route.",
		);
	}
	return buildShopifyAppUrl(window.location.origin, route.slug);
}

export function AdminIntegrationsPage(props: AdminIntegrationsPageProps) {
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage integrations." />
			}
		>
			<details class="panel flow-panel shopify-setup-card" open>
				<summary>Shopify app setup instructions</summary>
				<div class="shopify-setup-content">
					<p>
						Use these example values when configuring the tenant app in the
						Shopify Dev Dashboard.
					</p>
					<dl class="shopify-setup-values">
						<div>
							<dt>App name</dt>
							<dd>PAFE Test 2026-08</dd>
						</div>
						<div>
							<dt>Access scopes</dt>
							<dd>read_orders,read_products,write_products</dd>
						</div>
						<div>
							<dt>Use legacy install flow</dt>
							<dd>false</dd>
						</div>
						<div>
							<dt>App URL</dt>
							<dd>{currentShopifyAppUrl(props.app)}</dd>
						</div>
						<div>
							<dt>Embedded</dt>
							<dd>false</dd>
						</div>
						<div>
							<dt>Webhooks API version</dt>
							<dd>2026-07</dd>
						</div>
					</dl>
					<p class="shopify-setup-note">
						Production Shopify app URLs must use HTTPS.
					</p>
				</div>
			</details>
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
					<Show when={props.app.shopifySettings()} keyed>
						{(settings) => (
							<>
								<section aria-label="Shopify verification details">
									<Show when={settings.verifiedShopDomain} keyed>
										{(domain) => <p>Verified shop: {domain}</p>}
									</Show>
									<ul>
										<li>
											Product reads:{" "}
											{capabilityLabel(settings.capabilities.read_products)}
										</li>
										<li>
											Product writes:{" "}
											{capabilityLabel(settings.capabilities.write_products)}
										</li>
										<li>
											Order reads:{" "}
											{capabilityLabel(settings.capabilities.read_orders)}
										</li>
									</ul>
								</section>
								<Show
									when={
										settings.verificationStatus === "ok" &&
										missingRequiredShopifyScopes(settings.capabilities).length >
											0
									}
								>
									<div class="shopify-warning-banner" role="alert">
										<strong>
											Shopify is verified, but required scopes are missing.
										</strong>
										<p>
											Missing scopes:{" "}
											{missingRequiredShopifyScopes(settings.capabilities).join(
												", ",
											)}
											.
										</p>
										<p>
											Update and release the Shopify app version, approve or
											install it on this store, then run Save &amp; Test again.
										</p>
									</div>
								</Show>
							</>
						)}
					</Show>
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
