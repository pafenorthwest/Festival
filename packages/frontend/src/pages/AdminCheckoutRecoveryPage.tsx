import { createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
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

interface AdminCheckoutRecoveryPageProps {
	app: FestivalAppController;
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString();
	} catch {
		return iso;
	}
}

function formatIntentType(intent: AdminCheckoutIntent): string {
	if (intent.intentType === "membership") return "Membership";
	if (intent.intentType === "festival_class") return "Festival Class";
	return intent.intentType;
}

function formatDiagnostic(intent: AdminCheckoutIntent): string {
	const expiresMs = Date.parse(intent.expiresAtIso);
	if (Number.isNaN(expiresMs)) return intent.expiresAtIso;
	const isExpired = expiresMs <= Date.now();
	const dateStr = new Date(expiresMs).toLocaleDateString();
	return isExpired ? `Expired (${dateStr})` : `Expires ${dateStr}`;
}

export function AdminCheckoutRecoveryPage(
	props: AdminCheckoutRecoveryPageProps,
) {
	const [searchQuery, setSearchQuery] = createSignal("");
	const [isSearching, setIsSearching] = createSignal(false);
	const [searchResults, setSearchResults] = createSignal<
		AdminCustomerSearchResult[]
	>([]);
	const [selectedCustomer, setSelectedCustomer] =
		createSignal<AdminCustomerSearchResult | null>(null);
	const [intents, setIntents] = createSignal<AdminCheckoutIntent[]>([]);
	const [isLoadingIntents, setIsLoadingIntents] = createSignal(false);
	const [actionLoading, setActionLoading] = createSignal<string | null>(null);
	const [confirmInvalidateId, setConfirmInvalidateId] = createSignal<
		string | null
	>(null);
	const [recoveryUrl, setRecoveryUrl] = createSignal<string | null>(null);
	const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);
	const [feedbackMessage, setFeedbackMessage] = createSignal<string | null>(
		null,
	);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	const orgSlug = () => {
		const r = props.app.route();
		if ("slug" in r && r.slug) return r.slug;
		return props.app.sessionMembership()?.organizationSlug ?? "";
	};

	async function handleSearch(e: Event) {
		e.preventDefault();
		const query = searchQuery().trim();
		if (query.length < 2) {
			setErrorMessage("Please enter at least 2 characters to search.");
			return;
		}
		setErrorMessage(null);
		setFeedbackMessage(null);
		setIsSearching(true);
		try {
			const res = await searchAdminCustomers(orgSlug(), query);
			setSearchResults(res.customers);
			if (res.customers.length === 0) {
				setFeedbackMessage("No customers found matching that query.");
			}
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Customer search failed.",
			);
		} finally {
			setIsSearching(false);
		}
	}

	async function loadCustomerIntents(customerId: string) {
		setIsLoadingIntents(true);
		setErrorMessage(null);
		try {
			const res = await getAdminCustomerCheckoutIntents(orgSlug(), customerId);
			setIntents(res.intents);
		} catch (err) {
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Failed to load customer checkout intents.",
			);
		} finally {
			setIsLoadingIntents(false);
		}
	}

	function handleSelectCustomer(customer: AdminCustomerSearchResult) {
		setSelectedCustomer(customer);
		setRecoveryUrl(null);
		setConfirmInvalidateId(null);
		void loadCustomerIntents(customer.customerId);
	}

	async function handleInvalidate(intentId: string) {
		setActionLoading(intentId);
		setErrorMessage(null);
		try {
			await invalidateAdminCheckoutIntent(orgSlug(), intentId);
			setConfirmInvalidateId(null);
			setFeedbackMessage("Checkout intent invalidated successfully.");
			const currentCust = selectedCustomer();
			if (currentCust) {
				await loadCustomerIntents(currentCust.customerId);
			}
		} catch (err) {
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Failed to invalidate checkout intent.",
			);
		} finally {
			setActionLoading(null);
		}
	}

	async function handleAttemptRecovery(intentId: string) {
		setActionLoading(intentId);
		setErrorMessage(null);
		try {
			const result = await recoverAdminCheckoutIntent(orgSlug(), intentId);
			const fullUrl = result.recoveryUrl.startsWith("http")
				? result.recoveryUrl
				: `${window.location.origin}${result.recoveryUrl}`;
			setRecoveryUrl(fullUrl);
			setFeedbackMessage("Recovery link generated.");
		} catch (err) {
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Failed to create recovery request.",
			);
		} finally {
			setActionLoading(null);
		}
	}

	async function handleCopyLink() {
		const link = recoveryUrl();
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			setCopyFeedback("Copied to clipboard!");
			setTimeout(() => setCopyFeedback(null), 2500);
		} catch {
			setCopyFeedback("Copy failed");
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

				<Show when={errorMessage()}>
					<div class="alert alert-error" role="alert">
						<p>{errorMessage()}</p>
					</div>
				</Show>
				<Show when={feedbackMessage()}>
					<div class="alert alert-success" role="status">
						<p>{feedbackMessage()}</p>
					</div>
				</Show>

				<form class="customer-search-form" onSubmit={handleSearch}>
					<label class="field">
						<span>Search Customer (Name or Email)</span>
						<input
							type="search"
							placeholder="e.g. customer@example.com"
							value={searchQuery()}
							onInput={(e) => setSearchQuery(e.currentTarget.value)}
						/>
					</label>
					<Button type="submit" disabled={isSearching()}>
						{isSearching() ? "Searching…" : "Search"}
					</Button>
				</form>

				<Show when={searchResults().length > 0}>
					<div class="search-results-list">
						<h3>Matching Customers</h3>
						<For each={searchResults()}>
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

				<Show when={recoveryUrl()}>
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
								value={recoveryUrl() ?? ""}
								aria-label="Recovery Link"
							/>
							<Button type="button" onClick={handleCopyLink}>
								{copyFeedback() ?? "Copy Link"}
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

						<Show when={isLoadingIntents()}>
							<p>Loading checkout intents…</p>
						</Show>

						<Show when={!isLoadingIntents() && intents().length === 0}>
							<p class="muted">
								No recoverable checkout intents found for this customer.
							</p>
						</Show>

						<Show when={!isLoadingIntents() && intents().length > 0}>
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
										<For each={intents()}>
											{(intent) => (
												<tr>
													<td>{formatDate(intent.createdAtIso)}</td>
													<td>
														<strong>{formatIntentType(intent)}</strong>
														<Show when={intent.offeringId}>
															<small> ({intent.offeringId})</small>
														</Show>
													</td>
													<td>
														{intent.divisionNameSnapshot ??
															intent.divisionId ??
															"—"}
													</td>
													<td>
														{intent.amount} {intent.currencyCode}
													</td>
													<td>
														<span
															class={`status-badge status-${intent.status}`}
														>
															{intent.status}
														</span>
													</td>
													<td>{formatDiagnostic(intent)}</td>
													<td class="action-cell">
														<Show
															when={confirmInvalidateId() === intent.id}
															fallback={
																<div class="action-buttons">
																	<Button
																		type="button"
																		class="button-secondary"
																		disabled={actionLoading() === intent.id}
																		onClick={() =>
																			setConfirmInvalidateId(intent.id)
																		}
																	>
																		Invalidate
																	</Button>
																	<Button
																		type="button"
																		class="button-primary"
																		disabled={actionLoading() === intent.id}
																		onClick={() =>
																			handleAttemptRecovery(intent.id)
																		}
																	>
																		{actionLoading() === intent.id
																			? "Creating…"
																			: "Attempt Recovery"}
																	</Button>
																</div>
															}
														>
															<div class="confirm-box">
																<span>Confirm invalidate?</span>
																<Button
																	type="button"
																	class="button-danger"
																	disabled={actionLoading() === intent.id}
																	onClick={() => handleInvalidate(intent.id)}
																>
																	Yes, Invalidate
																</Button>
																<Button
																	type="button"
																	class="button-secondary"
																	onClick={() => setConfirmInvalidateId(null)}
																>
																	Cancel
																</Button>
															</div>
														</Show>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</Show>
					</div>
				</Show>
			</section>
		</Show>
	);
}
