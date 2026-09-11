import {
	SHOPIFY_AUTOMATICALLY_VERIFIED_SCOPES,
	SHOPIFY_REQUIRED_SCOPES,
	type ShopifyIntegrationDiagnosticCheck,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { CustomerAccountAdminCard } from "../components/CustomerAccountAdminCard.js";
import { runShopifyDiagnostics } from "../lib/api.js";

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

function webhookStatusLabel(status: string): string {
	switch (status) {
		case "ready":
			return "Ready";
		case "failed":
			return "Action required";
		case "checking":
			return "Checking";
		default:
			return "Not checked";
	}
}

function diagnosticLabel(id: ShopifyIntegrationDiagnosticCheck["id"]): string {
	return id === "orders_paid_webhook"
		? "Paid-order webhook"
		: "Public Storefront access";
}

export function missingRequiredShopifyScopes(
	verifiedScopes: readonly string[],
): string[] {
	const grantedScopes = new Set(verifiedScopes);
	return SHOPIFY_AUTOMATICALLY_VERIFIED_SCOPES.filter(
		(scope) => !grantedScopes.has(scope),
	);
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
	const [isRunningDiagnostics, setIsRunningDiagnostics] = createSignal(false);
	const [diagnosticResults, setDiagnosticResults] = createSignal<
		ShopifyIntegrationDiagnosticCheck[]
	>([]);
	const [diagnosticError, setDiagnosticError] = createSignal("");
	const diagnosticsAvailable = () => {
		const settings = props.app.shopifySettings();
		return (
			settings?.verificationStatus === "ok" &&
			Boolean(settings.verifiedShopDomain)
		);
	};

	async function handleRunDiagnostics() {
		const user = props.app.firebaseUser();
		const route = props.app.route();
		if (
			!user ||
			route.kind !== "org-admin-integrations" ||
			!diagnosticsAvailable() ||
			isRunningDiagnostics()
		) {
			return;
		}

		setIsRunningDiagnostics(true);
		setDiagnosticResults([]);
		setDiagnosticError("");
		try {
			const response = await runShopifyDiagnostics(
				await user.getIdToken(),
				route.slug,
			);
			if (response.checks.length === 0) {
				throw new Error("Shopify diagnostics returned no results.");
			}
			setDiagnosticResults(response.checks);
		} catch (error) {
			setDiagnosticError((error as Error).message);
		} finally {
			setIsRunningDiagnostics(false);
		}
	}

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
							<dd>{SHOPIFY_REQUIRED_SCOPES.join(",")}</dd>
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
						setDiagnosticResults([]);
						setDiagnosticError("");
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
							<div class="shopify-verified-settings">
								<section aria-label="Store and credential verification">
									<h3>Store and credentials</h3>
									<Show when={settings.verifiedShopDomain} keyed>
										{(domain) => <p>Verified shop: {domain}</p>}
									</Show>
								</section>
								<section aria-label="Verified Shopify scopes">
									<h3>Verified required scopes</h3>
									<ul>
										<For each={SHOPIFY_REQUIRED_SCOPES}>
											{(scope) => (
												<li>
													{scope}:{" "}
													{settings.verifiedScopes.includes(scope)
														? "Granted"
														: "Missing"}
												</li>
											)}
										</For>
									</ul>
								</section>
								<section aria-label="Paid-order webhook readiness">
									<h3>Paid-order webhook</h3>
									<p>
										<strong>Status:</strong>{" "}
										{webhookStatusLabel(settings.ordersPaidWebhook.status)}
									</p>
									<p>{settings.ordersPaidWebhook.message}</p>
									<Show when={settings.ordersPaidWebhook.requestId} keyed>
										{(requestId) => <p>Shopify request ID: {requestId}</p>}
									</Show>
								</section>
								<Show
									when={
										settings.verificationStatus === "ok" &&
										missingRequiredShopifyScopes(settings.verifiedScopes)
											.length > 0
									}
								>
									<div class="shopify-warning-banner" role="alert">
										<strong>
											Shopify is verified, but required scopes are missing.
										</strong>
										<p>
											Missing scopes:{" "}
											{missingRequiredShopifyScopes(
												settings.verifiedScopes,
											).join(", ")}
											.
										</p>
										<p>
											Update and release the Shopify app version, approve or
											install it on this store, then run Save &amp; Test again.
										</p>
									</div>
								</Show>
							</div>
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
					<label class="field">
						<span>Headless private Storefront token</span>
						<input
							type="password"
							autocomplete="new-password"
							placeholder={
								props.app.shopifySettings()?.hasStorefrontPrivateToken
									? "Leave blank to keep existing token"
									: "Optional"
							}
							value={props.app.shopifyDraft().storefrontPrivateToken}
							onInput={(event) =>
								props.app.setShopifyDraft((current) => ({
									...current,
									storefrontPrivateToken: event.currentTarget.value,
								}))
							}
						/>
						<small>Stored securely and used only by Festival’s backend.</small>
					</label>
					<Show when={props.app.shopifySettings()?.lastError} keyed>
						{(lastError) => <p class="shopify-error-text">{lastError}</p>}
					</Show>
					<Button
						type="submit"
						disabled={
							!props.app.isAdminMember() || props.app.isShopifyTesting()
						}
					>
						<Show when={props.app.isShopifyTesting()} fallback="Save & Test">
							<span class="button-spinner" aria-hidden="true" />
							<span>Testing</span>
						</Show>
					</Button>
					<section
						class="shopify-diagnostics"
						aria-labelledby="shopify-diagnostics-title"
					>
						<div>
							<h3 id="shopify-diagnostics-title">Diagnostics</h3>
							<p>Check conditions required outside Shopify Admin API setup.</p>
						</div>
						<Button
							type="button"
							variant="secondary"
							disabled={!diagnosticsAvailable() || isRunningDiagnostics()}
							onClick={() => void handleRunDiagnostics()}
						>
							{isRunningDiagnostics()
								? "Running diagnostics…"
								: "Run diagnostics"}
						</Button>
						<Show when={!diagnosticsAvailable()}>
							<p class="muted">
								Save and verify the Shopify integration before running
								diagnostics.
							</p>
						</Show>
						<Show
							when={
								diagnosticsAvailable() &&
								!isRunningDiagnostics() &&
								diagnosticResults().length === 0 &&
								!diagnosticError()
							}
						>
							<p class="muted">No diagnostics run yet.</p>
						</Show>
						<Show when={isRunningDiagnostics()}>
							<p role="status">
								Checking paid-order webhook and public Storefront access…
							</p>
						</Show>
						<For each={diagnosticResults()}>
							{(result) => (
								<div
									class={`shopify-diagnostic-result shopify-diagnostic-${result.status}`}
									role={result.status === "passed" ? "status" : "alert"}
								>
									<strong>
										{diagnosticLabel(result.id)}:{" "}
										{result.status === "passed" ? "Passed" : "Action required"}
									</strong>
									<p>{result.message}</p>
									<Show when={result.requestId} keyed>
										{(requestId) => <p>Shopify request ID: {requestId}</p>}
									</Show>
								</div>
							)}
						</For>
						<Show when={diagnosticError()} keyed>
							{(message) => (
								<div
									class="shopify-diagnostic-result shopify-diagnostic-error"
									role="alert"
								>
									<strong>Diagnostics unavailable</strong>
									<p>{message}</p>
								</div>
							)}
						</Show>
					</section>
				</form>
			</section>
			<CustomerAccountAdminCard app={props.app} />
		</Show>
	);
}
