import type {
	CustomerMembershipStatusEntry,
	CustomerOrderSummary,
	CustomerSessionProfile,
	UpdateCustomerProfileInput,
} from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
	customerSignInPath,
	getCustomerMembershipStatus,
	getCustomerOrders,
	getCustomerProfile,
	getCustomerSession,
	logoutCustomer,
	updateCustomerProfile,
} from "../lib/api.js";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	hasProcessingMembership,
	MEMBERSHIP_POLL_INTERVAL_MS,
	membershipStatusSignature,
} from "./customerMembershipStatus.js";

export function CustomerAccountPage(props: { slug: string }) {
	const [session, setSession] = createSignal<CustomerSessionProfile | null>(
		null,
	);
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [memberships, setMemberships] = createSignal<
		CustomerMembershipStatusEntry[]
	>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [loading, setLoading] = createSignal(true);
	const [membershipLoading, setMembershipLoading] = createSignal(true);
	const [membershipRefreshing, setMembershipRefreshing] = createSignal(false);
	const [membershipError, setMembershipError] = createSignal("");
	const [membershipPollTimedOut, setMembershipPollTimedOut] =
		createSignal(false);
	const [checkoutProcessing, setCheckoutProcessing] = createSignal(false);
	const [savingProfile, setSavingProfile] = createSignal(false);
	const [profile, setProfile] = createSignal<UpdateCustomerProfileInput>({
		name: "",
		email: "",
		mailingAddress: {
			line1: "",
			line2: "",
			city: "",
			region: "",
			postalCode: "",
			countryCode: "",
		},
		phone: "",
	});
	let membershipPollTimer: ReturnType<typeof setTimeout> | undefined;
	let membershipPollStartedAt = 0;
	let membershipInitialSignature = membershipStatusSignature([]);
	let membershipSawProcessing = false;
	let membershipRequestInFlight = false;
	let checkoutReturn = false;
	let disposed = false;

	function stopMembershipPolling() {
		if (membershipPollTimer !== undefined) {
			clearTimeout(membershipPollTimer);
			membershipPollTimer = undefined;
		}
	}

	function removeCheckoutProcessingQuery() {
		const url = new URL(window.location.href);
		if (url.searchParams.get("checkout") !== "processing") return;
		url.searchParams.delete("checkout");
		window.history.replaceState(
			null,
			"",
			`${url.pathname}${url.search}${url.hash}`,
		);
	}

	function finishMembershipPolling() {
		stopMembershipPolling();
		setMembershipPollTimedOut(false);
		if (checkoutReturn) {
			checkoutReturn = false;
			setCheckoutProcessing(false);
			removeCheckoutProcessingQuery();
		}
	}

	async function requestMembershipStatus(
		initial = false,
	): Promise<CustomerMembershipStatusEntry[] | null> {
		if (membershipRequestInFlight) return null;
		membershipRequestInFlight = true;
		if (initial) setMembershipLoading(true);
		else setMembershipRefreshing(true);
		setMembershipError("");
		try {
			const response = await getCustomerMembershipStatus(props.slug);
			if (disposed) return null;
			setMemberships(response.memberships);
			return response.memberships;
		} catch {
			if (!disposed) {
				setMembershipError(
					"Festival membership status could not be loaded. Please try again.",
				);
			}
			return null;
		} finally {
			membershipRequestInFlight = false;
			if (!disposed) {
				setMembershipLoading(false);
				setMembershipRefreshing(false);
			}
		}
	}

	function scheduleMembershipPoll() {
		stopMembershipPolling();
		membershipPollTimer = setTimeout(() => {
			membershipPollTimer = undefined;
			void pollMembershipStatus();
		}, MEMBERSHIP_POLL_INTERVAL_MS);
	}

	async function pollMembershipStatus() {
		const current = await requestMembershipStatus();
		if (!current) return;
		membershipSawProcessing ||= hasProcessingMembership(current);
		const decision = decideMembershipPolling({
			memberships: current,
			checkoutReturn,
			initialSignature: membershipInitialSignature,
			sawProcessing: membershipSawProcessing,
			elapsedMs: Date.now() - membershipPollStartedAt,
		});
		if (decision === "terminal") {
			finishMembershipPolling();
			return;
		}
		if (decision === "timeout") {
			setMembershipPollTimedOut(true);
			return;
		}
		if (decision === "continue") scheduleMembershipPoll();
	}

	function startMembershipPolling() {
		setMembershipPollTimedOut(false);
		membershipPollStartedAt = Date.now();
		scheduleMembershipPoll();
	}

	async function initializeMembershipStatus() {
		const current = await requestMembershipStatus(true);
		if (!current) return;
		membershipInitialSignature = membershipStatusSignature(current);
		membershipSawProcessing = hasProcessingMembership(current);
		if (checkoutReturn || membershipSawProcessing) startMembershipPolling();
	}

	async function refreshMembershipStatus() {
		stopMembershipPolling();
		setMembershipPollTimedOut(false);
		const current = await requestMembershipStatus();
		if (!current) return;
		membershipSawProcessing ||= hasProcessingMembership(current);
		const decision = decideMembershipPolling({
			memberships: current,
			checkoutReturn,
			initialSignature: membershipInitialSignature,
			sawProcessing: membershipSawProcessing,
			elapsedMs: 0,
		});
		if (decision === "terminal") {
			finishMembershipPolling();
			return;
		}
		if (decision === "continue") startMembershipPolling();
	}

	onCleanup(() => {
		disposed = true;
		stopMembershipPolling();
	});

	async function loadOrders(after?: string) {
		const response = await getCustomerOrders(props.slug, after);
		setOrders((current) =>
			after ? [...current, ...response.orders] : response.orders,
		);
		setNext(response.pageInfo.hasNextPage ? response.pageInfo.endCursor : null);
	}
	onMount(
		() =>
			void (async () => {
				checkoutReturn =
					new URLSearchParams(window.location.search).get("checkout") ===
					"processing";
				setCheckoutProcessing(checkoutReturn);
				try {
					const response = await getCustomerSession(props.slug);
					if (response.session.authenticated) {
						setSession(response.session);
						void loadOrders().catch((error) =>
							setError((error as Error).message),
						);
						void initializeMembershipStatus();
						const profileResponse = await getCustomerProfile(props.slug);
						const current = profileResponse.profile;
						setProfile({
							name: current.name ?? "",
							email: current.email ?? "",
							mailingAddress: {
								line1: current.mailingAddress?.line1 ?? "",
								line2: current.mailingAddress?.line2 ?? "",
								city: current.mailingAddress?.city ?? "",
								region: current.mailingAddress?.region ?? "",
								postalCode: current.mailingAddress?.postalCode ?? "",
								countryCode: current.mailingAddress?.countryCode ?? "",
							},
							phone: current.phone ?? "",
						});
					}
				} catch (error) {
					setError((error as Error).message);
				} finally {
					setLoading(false);
				}
			})(),
	);
	async function logout() {
		const current = session();
		if (!current) return;
		try {
			logoutCustomer(props.slug, current.csrfToken);
		} catch (error) {
			setError((error as Error).message);
		}
	}
	async function saveProfile(event: SubmitEvent) {
		event.preventDefault();
		const current = session();
		if (!current) return;
		setError("");
		setStatus("");
		setSavingProfile(true);
		try {
			const response = await updateCustomerProfile(
				props.slug,
				current.csrfToken,
				profile(),
			);
			setProfile({
				name: response.profile.name ?? "",
				email: response.profile.email ?? "",
				mailingAddress: {
					line1: response.profile.mailingAddress?.line1 ?? "",
					line2: response.profile.mailingAddress?.line2 ?? "",
					city: response.profile.mailingAddress?.city ?? "",
					region: response.profile.mailingAddress?.region ?? "",
					postalCode: response.profile.mailingAddress?.postalCode ?? "",
					countryCode: response.profile.mailingAddress?.countryCode ?? "",
				},
				phone: response.profile.phone ?? "",
			});
			setStatus("Profile saved in Festival.");
		} catch (error) {
			setError((error as Error).message);
		} finally {
			setSavingProfile(false);
		}
	}
	return (
		<section class="panel flow-panel customer-account-page">
			<h1>Customer account</h1>
			<Show when={!loading()} fallback={<p>Loading customer session…</p>}>
				<Show
					when={session()}
					fallback={
						<>
							<p>Sign in with Shopify to view your order history and status.</p>
							<a class="primary-button" href={customerSignInPath(props.slug)}>
								Sign in with Shopify
							</a>
						</>
					}
				>
					<p>Your Shopify customer session is active.</p>
					<form
						class="flow-panel"
						onSubmit={(event) => void saveProfile(event)}
					>
						<h2>Festival profile</h2>
						<p class="muted">
							These details are stored in Festival. Changes here do not update
							Shopify.
						</p>
						<label>
							<span>Name</span>
							<input
								required
								value={profile().name}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										name: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Email</span>
							<input
								type="email"
								required
								value={profile().email}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										email: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Phone</span>
							<input
								type="tel"
								required
								value={profile().phone}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										phone: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<fieldset>
							<legend>Mailing address</legend>
							{(
								[
									["line1", "Address line 1"],
									["line2", "Address line 2"],
									["city", "City"],
									["region", "State or region"],
									["postalCode", "Postal code"],
									["countryCode", "Two-letter country code"],
								] as const
							).map(([field, label]) => (
								<label>
									<span>{label}</span>
									<input
										required={field !== "line2"}
										maxlength={field === "countryCode" ? 2 : undefined}
										value={profile().mailingAddress[field] ?? ""}
										onInput={(event) =>
											setProfile((current) => ({
												...current,
												mailingAddress: {
													...current.mailingAddress,
													[field]: event.currentTarget.value,
												},
											}))
										}
									/>
								</label>
							))}
						</fieldset>
						<button type="submit" disabled={savingProfile()}>
							{savingProfile() ? "Saving…" : "Save Festival profile"}
						</button>
					</form>
					<Show when={status()}>
						{(message) => <p role="status">{message()}</p>}
					</Show>
					<button
						type="button"
						class="secondary-button"
						onClick={() => void logout()}
					>
						Log out
					</button>
					<section
						class="customer-membership-section"
						aria-labelledby="festival-memberships-heading"
					>
						<header class="customer-membership-section-header">
							<div>
								<h2 id="festival-memberships-heading">Festival memberships</h2>
								<p class="muted">
									Festival validates Shopify payments before granting membership
									rights.
								</p>
							</div>
							<button
								type="button"
								class="secondary-button"
								disabled={membershipLoading() || membershipRefreshing()}
								onClick={() => void refreshMembershipStatus()}
							>
								{membershipRefreshing()
									? "Refreshing…"
									: "Refresh membership status"}
							</button>
						</header>
						<Show when={membershipLoading()}>
							<p role="status">Loading Festival membership status…</p>
						</Show>
						<Show when={membershipError()}>
							{(message) => (
								<p class="error-text" role="alert">
									{message()}
								</p>
							)}
						</Show>
						<Show
							when={
								checkoutProcessing() &&
								!membershipLoading() &&
								memberships().length === 0
							}
						>
							<article
								class="customer-membership-card customer-membership-processing"
								role="status"
							>
								<header>
									<h3>Teacher Membership</h3>
									<span class="customer-membership-badge">Processing</span>
								</header>
								<p>
									Festival is waiting for Shopify payment evidence. This does
									not grant active membership rights yet.
								</p>
							</article>
						</Show>
						<Show when={memberships().length > 0}>
							<div class="customer-membership-list" aria-live="polite">
								<For each={memberships()}>
									{(membership) => {
										const view = customerMembershipViewModel(membership);
										return (
											<article
												class={`customer-membership-card customer-membership-${view.tone}`}
											>
												<header>
													<h3>{membership.displayName}</h3>
													<span class="customer-membership-badge">
														{view.label}
													</span>
												</header>
												<p>{view.description}</p>
												<Show when={view.details.length > 0}>
													<dl class="customer-membership-details">
														<For each={view.details}>
															{(detail) => (
																<div>
																	<dt>{detail.label}</dt>
																	<dd>{detail.value}</dd>
																</div>
															)}
														</For>
													</dl>
												</Show>
											</article>
										);
									}}
								</For>
							</div>
						</Show>
						<Show
							when={
								!membershipLoading() &&
								!membershipError() &&
								!checkoutProcessing() &&
								memberships().length === 0
							}
						>
							<p>No Festival memberships found.</p>
						</Show>
						<Show when={membershipPollTimedOut()}>
							<p class="muted" role="status">
								Membership validation is still processing. Use Refresh
								membership status to check again.
							</p>
						</Show>
					</section>
					<section aria-labelledby="shopify-orders-heading">
						<h2 id="shopify-orders-heading">Shopify orders</h2>
						<p class="muted">
							Shopify order and payment history is separate from Festival
							membership status.
						</p>
						<Show when={orders().length > 0} fallback={<p>No orders found.</p>}>
							<ul class="customer-order-list">
								<For each={orders()}>
									{(order) => (
										<li>
											<h3>Order {order.orderNumber}</h3>
											<p>
												{order.createdAtIso} · {order.total.amount}{" "}
												{order.total.currencyCode}
											</p>
											<p>
												Payment: {order.financialStatus ?? "Unknown"} ·
												Fulfillment: {order.fulfillmentStatus}
											</p>
											<Show when={order.cancellation}>
												<p>
													Cancelled:{" "}
													{order.cancellation?.reason ?? "No reason provided"}
												</p>
											</Show>
											<Show when={order.refund}>
												<p>
													Refunded: {order.refund?.total.amount}{" "}
													{order.refund?.total.currencyCode}
												</p>
											</Show>
											<ul>
												<For each={order.lineItems}>
													{(line) => (
														<li>
															{line.quantity} × {line.title} —{" "}
															{line.total.amount} {line.total.currencyCode}
														</li>
													)}
												</For>
											</ul>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={next()} keyed>
							{(cursor) => (
								<button
									type="button"
									class="secondary-button"
									onClick={() => void loadOrders(cursor)}
								>
									Load more
								</button>
							)}
						</Show>
					</section>
				</Show>
			</Show>
			<Show when={error()}>
				{(message) => (
					<p class="error-text" role="alert">
						{message()}
					</p>
				)}
			</Show>
		</section>
	);
}
