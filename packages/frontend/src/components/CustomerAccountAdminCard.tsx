import type { CustomerAccountSettings } from "@festival/common";
import { createSignal, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	getCustomerAccountSettings,
	saveCustomerAccountSettings,
} from "../lib/api.js";

export function CustomerAccountAdminCard(props: {
	app: FestivalAppController;
}) {
	const route = props.app.route();
	if (route.kind !== "org-admin-integrations")
		throw new Error(
			"Customer Account settings require the integrations route.",
		);
	const slug = route.slug;
	const [settings, setSettings] = createSignal<CustomerAccountSettings | null>(
		null,
	);
	const [domain, setDomain] = createSignal("");
	const [clientId, setClientId] = createSignal("");
	const [secret, setSecret] = createSignal("");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	onMount(
		() =>
			void (async () => {
				const user = props.app.firebaseUser();
				if (!user) return;
				try {
					const response = await getCustomerAccountSettings(
						await user.getIdToken(),
						slug,
					);
					setSettings(response.settings);
					setDomain(response.settings?.storefrontDomain ?? "");
					setClientId(response.settings?.clientId ?? "");
				} catch (e) {
					setError((e as Error).message);
				}
			})(),
	);
	async function save() {
		const user = props.app.firebaseUser();
		if (!user) return;
		setBusy(true);
		setError("");
		try {
			const response = await saveCustomerAccountSettings(
				await user.getIdToken(),
				slug,
				{
					storefrontDomain: domain(),
					clientId: clientId(),
					clientSecret: secret() || undefined,
				},
			);
			setSettings(response.settings);
			setSecret("");
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<section class="panel flow-panel">
			<form
				class="shopify-integration-card"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div class="shopify-card-header">
					<div>
						<h2>Shopify Customer Accounts</h2>
						<p>
							Configure the tenant Headless Customer Account confidential client
							separately from Admin API credentials.
						</p>
					</div>
					<span
						class={`shopify-status shopify-status-${settings()?.readiness ?? "unknown"}`}
					>
						{settings()?.readiness ?? "Unknown"}
					</span>
				</div>
				<label class="field">
					<span>Storefront/account domain</span>
					<input
						value={domain()}
						onInput={(event) => setDomain(event.currentTarget.value)}
						autocomplete="off"
					/>
				</label>
				<label class="field">
					<span>Customer Account client ID</span>
					<input
						value={clientId()}
						onInput={(event) => setClientId(event.currentTarget.value)}
						autocomplete="off"
					/>
				</label>
				<label class="field">
					<span>Customer Account client secret</span>
					<input
						type="password"
						value={secret()}
						onInput={(event) => setSecret(event.currentTarget.value)}
						autocomplete="new-password"
						placeholder={
							settings()?.hasClientSecret
								? "Leave blank to keep existing secret"
								: ""
						}
					/>
				</label>
				<Show when={settings()} keyed>
					{(value) => (
						<dl class="shopify-setup-values">
							<div>
								<dt>Callback URL</dt>
								<dd>{value.callbackUrl}</dd>
							</div>
							<div>
								<dt>Logout return URL</dt>
								<dd>{value.logoutUrl}</dd>
							</div>
							<div>
								<dt>Customer order access</dt>
								<dd>
									{value.canReadOrders
										? "Verified by a customer order request"
										: "Pending customer verification"}
								</dd>
							</div>
						</dl>
					)}
				</Show>
				<Show when={settings()?.lastError}>
					{(message) => <p class="shopify-error-text">{message()}</p>}
				</Show>
				<Show when={error()}>
					{(message) => (
						<p class="shopify-error-text" role="alert">
							{message()}
						</p>
					)}
				</Show>
				<button type="submit" class="shopify-submit-button" disabled={busy()}>
					{busy() ? "Verifying…" : "Save & Verify"}
				</button>
			</form>
		</section>
	);
}
