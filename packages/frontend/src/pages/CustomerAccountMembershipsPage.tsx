import type { CustomerMembershipStatusEntry } from "@festival/common";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { getCustomerMembershipStatus } from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	hasProcessingMembership,
	MEMBERSHIP_POLL_INTERVAL_MS,
	membershipStatusSignature,
} from "./customerMembershipStatus.js";

export function CustomerAccountMembershipsPage(props: { slug: string }) {
	const [memberships, setMemberships] = createSignal<
		CustomerMembershipStatusEntry[]
	>([]);
	const [membershipLoading, setMembershipLoading] = createSignal(true);
	const [membershipRefreshing, setMembershipRefreshing] = createSignal(false);
	const [membershipError, setMembershipError] = createSignal("");
	const [membershipPollTimedOut, setMembershipPollTimedOut] =
		createSignal(false);
	const [checkoutProcessing, setCheckoutProcessing] = createSignal(false);
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
		checkoutReturn = false;
		setCheckoutProcessing(false);
		removeCheckoutProcessingQuery();
	}

	async function requestMembershipStatus(initial = false) {
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
		if (decision === "terminal") return finishMembershipPolling();
		if (decision === "timeout") return setMembershipPollTimedOut(true);
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
		if (decision === "terminal") return finishMembershipPolling();
		if (decision === "continue") startMembershipPolling();
	}

	onCleanup(() => {
		disposed = true;
		stopMembershipPolling();
	});

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => {
				checkoutReturn =
					new URLSearchParams(window.location.search).get("checkout") ===
					"processing";
				setCheckoutProcessing(checkoutReturn);
				void initializeMembershipStatus();
			}}
		>
			{() => (
				<>
					<h1>Memberships</h1>
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
							<Button
								type="button"
								variant="secondary"
								disabled={membershipLoading() || membershipRefreshing()}
								onClick={() => void refreshMembershipStatus()}
							>
								{membershipRefreshing()
									? "Refreshing…"
									: "Refresh membership status"}
							</Button>
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
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
