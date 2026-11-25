import { createEffect, For, on, onCleanup, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { AdminClassCheckoutRecoveries } from "../components/AdminClassCheckoutRecoveries.js";
import { Button } from "../components/Button.js";
import type {
	AdminCheckoutIntent,
	AdminCustomerSearchResult,
} from "../lib/api.js";
import {
	getAdminCustomerCheckoutIntents,
	invalidateAdminCheckoutIntent,
	recoverAdminCheckoutIntent,
	searchAdminCustomers,
} from "../lib/api.js";
import {
	createCheckoutRecoveryPageSignals,
	formatIntentDate,
	formatIntentDiagnostic,
	formatIntentType,
	resolveRecoveryError,
} from "./checkoutRecoveryPresentation.js";

interface AdminCheckoutRecoveryPageProps {
	app: FestivalAppController;
	slug?: string;
}

function IntentRow(props: {
	intent: AdminCheckoutIntent;
	actionLoadingId: string | null;
	confirming: boolean;
	onPromptInvalidate: (id: string) => void;
	onCancelInvalidate: () => void;
	onConfirmInvalidate: (id: string) => void;
	onAttemptRecovery: (id: string) => void;
}) {
	const busy = () => props.actionLoadingId === props.intent.id;
	return (
		<tr>
			<td>{formatIntentDate(props.intent.createdAtIso)}</td>
			<td>
				<strong>{formatIntentType(props.intent)}</strong>
				<Show when={props.intent.offeringId}>
					<small> ({props.intent.offeringId})</small>
				</Show>
			</td>
			<td>
				{props.intent.divisionNameSnapshot ?? props.intent.divisionId ?? "—"}
			</td>
			<td>
				{props.intent.amount} {props.intent.currencyCode}
			</td>
			<td>
				<span class={`status-badge status-${props.intent.status}`}>
					{props.intent.status}
				</span>
			</td>
			<td>{formatIntentDiagnostic(props.intent)}</td>
			<td class="action-cell">
				<Show
					when={props.confirming}
					fallback={
						<div class="action-buttons">
							<Button
								type="button"
								class="button-secondary"
								disabled={busy()}
								onClick={() => props.onPromptInvalidate(props.intent.id)}
							>
								Invalidate
							</Button>
							<Button
								type="button"
								class="button-primary"
								disabled={busy()}
								onClick={() => props.onAttemptRecovery(props.intent.id)}
							>
								{busy() ? "Creating…" : "Attempt Recovery"}
							</Button>
						</div>
					}
				>
					<div class="confirm-box">
						<span>Confirm invalidate?</span>
						<Button
							type="button"
							class="button-danger"
							disabled={busy()}
							onClick={() => props.onConfirmInvalidate(props.intent.id)}
						>
							Yes, Invalidate
						</Button>
						<Button
							type="button"
							class="button-secondary"
							onClick={props.onCancelInvalidate}
						>
							Cancel
						</Button>
					</div>
				</Show>
			</td>
		</tr>
	);
}

export function AdminCheckoutRecoveryPage(
	props: AdminCheckoutRecoveryPageProps,
) {
	const s = createCheckoutRecoveryPageSignals();
	const { selectedCustomer } = s;

	let latestSearchRequest = 0;
	let latestIntentsRequest = 0;
	onCleanup(() => {
		latestSearchRequest += 1;
		latestIntentsRequest += 1;
	});

	const orgSlug = () => {
		if (props.slug) return props.slug;
		const r = props.app.route();
		if ("slug" in r && r.slug) return r.slug;
		return props.app.sessionMembership()?.organizationSlug ?? "";
	};

	createEffect(
		on(
			orgSlug,
			() => {
				latestSearchRequest += 1;
				latestIntentsRequest += 1;
				s.resetForOrgChange();
			},
			{ defer: true },
		),
	);

	async function handleSearch(e: Event) {
		e.preventDefault();
		const query = s.searchQuery().trim();
		if (query.length < 2) {
			s.setErrorMessage("Please enter at least 2 characters to search.");
			return;
		}
		const slug = orgSlug();
		const requestId = ++latestSearchRequest;
		s.setErrorMessage(null);
		s.setFeedbackMessage(null);
		s.setIsSearching(true);
		try {
			const res = await searchAdminCustomers(slug, query);
			if (requestId !== latestSearchRequest) return;
			s.setSearchResults(res.customers);
			if (res.customers.length === 0) {
				s.setFeedbackMessage("No customers found matching that query.");
			}
		} catch (err) {
			if (requestId !== latestSearchRequest) return;
			s.setErrorMessage(resolveRecoveryError(err, "Customer search failed."));
		} finally {
			if (requestId === latestSearchRequest) s.setIsSearching(false);
		}
	}

	async function loadCustomerIntents(customerId: string) {
		const slug = orgSlug();
		const requestId = ++latestIntentsRequest;
		s.setIsLoadingIntents(true);
		s.setErrorMessage(null);
		try {
			const res = await getAdminCustomerCheckoutIntents(slug, customerId);
			if (requestId !== latestIntentsRequest) return;
			s.setIntents(res.intents);
		} catch (err) {
			if (requestId !== latestIntentsRequest) return;
			s.setIntents([]);
			s.setErrorMessage(
				resolveRecoveryError(err, "Failed to load customer checkout intents."),
			);
		} finally {
			if (requestId === latestIntentsRequest) s.setIsLoadingIntents(false);
		}
	}

	function handleSelectCustomer(customer: AdminCustomerSearchResult) {
		s.setSelectedCustomer(customer);
		s.setIntents([]);
		s.setRecoveryUrl(null);
		s.setConfirmInvalidateId(null);
		void loadCustomerIntents(customer.customerId);
	}

	async function handleInvalidate(intentId: string) {
		s.setActionLoading(intentId);
		s.setErrorMessage(null);
		try {
			await invalidateAdminCheckoutIntent(orgSlug(), intentId);
			s.setConfirmInvalidateId(null);
			s.setFeedbackMessage("Checkout intent invalidated successfully.");
			const currentCust = selectedCustomer();
			if (currentCust) await loadCustomerIntents(currentCust.customerId);
		} catch (err) {
			s.setErrorMessage(
				resolveRecoveryError(err, "Failed to invalidate checkout intent."),
			);
		} finally {
			s.setActionLoading(null);
		}
	}

	async function handleAttemptRecovery(intentId: string) {
		s.setActionLoading(intentId);
		s.setErrorMessage(null);
		try {
			const result = await recoverAdminCheckoutIntent(orgSlug(), intentId);
			const fullUrl = result.recoveryUrl.startsWith("http")
				? result.recoveryUrl
				: `${window.location.origin}${result.recoveryUrl}`;
			s.setRecoveryUrl(fullUrl);
			s.setFeedbackMessage("Recovery link generated.");
		} catch (err) {
			s.setErrorMessage(
				resolveRecoveryError(err, "Failed to create recovery request."),
			);
		} finally {
			s.setActionLoading(null);
		}
	}

	async function handleCopyLink() {
		const link = s.recoveryUrl();
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			s.setCopyFeedback("Copied to clipboard!");
			setTimeout(() => s.setCopyFeedback(null), 2500);
		} catch {
			s.setCopyFeedback("Copy failed");
		}
	}

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can access checkout recovery." />
			}
		>
			<section class="panel flow-panel checkout-recovery-admin">
				<header class="admin-page-header">
					<div>
						<h2>Checkout Recovery</h2>
						<p>
							Search customer sessions, review interrupted checkouts, and
							generate recovery links.
						</p>
					</div>
				</header>

				<Show when={s.errorMessage()}>
					<div class="alert alert-error" role="alert">
						<p>{s.errorMessage()}</p>
					</div>
				</Show>
				<Show when={s.feedbackMessage()}>
					<div class="alert alert-success" role="status">
						<p>{s.feedbackMessage()}</p>
					</div>
				</Show>

				<form class="customer-search-form" onSubmit={handleSearch}>
					<label class="field">
						<span>Search Customer (Name or Email)</span>
						<input
							type="search"
							placeholder="e.g. customer@example.com"
							value={s.searchQuery()}
							onInput={(e) => s.setSearchQuery(e.currentTarget.value)}
						/>
					</label>
					<Button type="submit" disabled={s.isSearching()}>
						{s.isSearching() ? "Searching…" : "Search"}
					</Button>
				</form>

				<Show when={s.searchResults().length > 0}>
					<div class="search-results-list">
						<h3>Matching Customers</h3>
						<For each={s.searchResults()}>
							{(cust) => (
								<button
									type="button"
									class={`customer-result-item ${
										selectedCustomer()?.customerId === cust.customerId
											? "is-selected"
											: ""
									}`}
									onClick={() => handleSelectCustomer(cust)}
								>
									<strong>{cust.name ?? "Unnamed Customer"}</strong>
									<span>{cust.email ?? "No email"}</span>
									<small>{cust.phone ?? cust.customerId}</small>
								</button>
							)}
						</For>
					</div>
				</Show>

				<Show when={s.recoveryUrl()}>
					<div class="recovery-result-box panel">
						<h3>Recovery Link Ready</h3>
						<p>
							Provide this link to the customer to resume their checkout
							session:
						</p>
						<div class="recovery-url-row">
							<input
								type="text"
								readonly
								value={s.recoveryUrl() ?? ""}
								aria-label="Recovery Link"
							/>
							<Button type="button" onClick={handleCopyLink}>
								{s.copyFeedback() ?? "Copy Link"}
							</Button>
						</div>
					</div>
				</Show>

				<Show when={selectedCustomer()}>
					<div class="customer-intents-section">
						<h3>
							Checkout Intents for{" "}
							{selectedCustomer()?.name ?? selectedCustomer()?.email}
						</h3>

						<Show when={s.isLoadingIntents()}>
							<p>Loading checkout intents…</p>
						</Show>

						<Show when={!s.isLoadingIntents() && s.intents().length === 0}>
							<p class="muted">
								No recoverable checkout intents found for this customer.
							</p>
						</Show>

						<Show when={!s.isLoadingIntents() && s.intents().length > 0}>
							<div class="table-container">
								<table class="admin-table">
									<thead>
										<tr>
											<th>Date</th>
											<th>Type / Offering</th>
											<th>Division</th>
											<th>Amount</th>
											<th>Status</th>
											<th>Diagnostic State</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										<For each={s.intents()}>
											{(intent) => (
												<IntentRow
													intent={intent}
													actionLoadingId={s.actionLoading()}
													confirming={s.confirmInvalidateId() === intent.id}
													onPromptInvalidate={s.setConfirmInvalidateId}
													onCancelInvalidate={() =>
														s.setConfirmInvalidateId(null)
													}
													onConfirmInvalidate={(id) =>
														void handleInvalidate(id)
													}
													onAttemptRecovery={(id) =>
														void handleAttemptRecovery(id)
													}
												/>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</Show>
					</div>
				</Show>

				<AdminClassCheckoutRecoveries
					slug={orgSlug()}
					customer={selectedCustomer()}
				/>
			</section>
		</Show>
	);
}
