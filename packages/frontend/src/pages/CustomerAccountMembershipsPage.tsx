import type { CustomerMembershipStatusEntry } from "@festival/common";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { getCustomerMembershipStatus } from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import { CustomerTeacherDirectoryCard } from "./CustomerTeacherDirectoryCard.js";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	hasProcessingMembership,
	MEMBERSHIP_POLL_INTERVAL_MS,
	membershipStatusSignature,
} from "./customerMembershipStatus.js";
import { hasActiveTeacherMembership } from "./teacherDirectoryHelpers.js";

function membershipDisplayName(entitlementClass: string): string {
	const name = entitlementClass.split("_", 1)[0] ?? "";
	return `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
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

function createMembershipPollStore(getSlug: () => string) {
	const [memberships, setMemberships] = createSignal<
		CustomerMembershipStatusEntry[]
	>([]);
	const [loading, setLoading] = createSignal(true);
	const [refreshing, setRefreshing] = createSignal(false);
	const [error, setError] = createSignal("");
	const [pollTimedOut, setPollTimedOut] = createSignal(false);
	const [checkoutProcessing, setCheckoutProcessing] = createSignal(false);
	return {
		getSlug,
		memberships,
		setMemberships,
		loading,
		setLoading,
		refreshing,
		setRefreshing,
		error,
		setError,
		pollTimedOut,
		setPollTimedOut,
		checkoutProcessing,
		setCheckoutProcessing,
		pollTimer: undefined as ReturnType<typeof setTimeout> | undefined,
		pollStartedAt: 0,
		membershipInitialSignature: membershipStatusSignature([]),
		sawProcessing: false,
		membershipRequestInFlight: false,
		checkoutReturn: false,
		disposed: false,
	};
}

type MembershipPollStore = ReturnType<typeof createMembershipPollStore>;

function stopMembershipPolling(store: MembershipPollStore) {
	if (store.pollTimer !== undefined) {
		clearTimeout(store.pollTimer);
		store.pollTimer = undefined;
	}
}

function finishMembershipPolling(store: MembershipPollStore) {
	stopMembershipPolling(store);
	store.setPollTimedOut(false);
	store.checkoutReturn = false;
	store.setCheckoutProcessing(false);
	removeCheckoutProcessingQuery();
}

async function requestMembershipStatus(
	store: MembershipPollStore,
	initial = false,
) {
	if (store.membershipRequestInFlight) return null;
	store.membershipRequestInFlight = true;
	if (initial) store.setLoading(true);
	else store.setRefreshing(true);
	store.setError("");
	try {
		const response = await getCustomerMembershipStatus(store.getSlug());
		if (store.disposed) return null;
		store.setMemberships(response.memberships);
		return response.memberships;
	} catch {
		if (!store.disposed)
			store.setError(
				"Festival membership status could not be loaded. Please try again.",
			);
		return null;
	} finally {
		store.membershipRequestInFlight = false;
		if (!store.disposed) {
			store.setLoading(false);
			store.setRefreshing(false);
		}
	}
}

function scheduleMembershipPoll(store: MembershipPollStore) {
	stopMembershipPolling(store);
	store.pollTimer = setTimeout(() => {
		store.pollTimer = undefined;
		void pollMembershipStatus(store);
	}, MEMBERSHIP_POLL_INTERVAL_MS);
}

async function pollMembershipStatus(store: MembershipPollStore) {
	const current = await requestMembershipStatus(store);
	if (!current) return;
	store.sawProcessing ||= hasProcessingMembership(current);
	const decision = decideMembershipPolling({
		memberships: current,
		checkoutReturn: store.checkoutReturn,
		initialSignature: store.membershipInitialSignature,
		sawProcessing: store.sawProcessing,
		elapsedMs: Date.now() - store.pollStartedAt,
	});
	if (decision === "terminal") return finishMembershipPolling(store);
	if (decision === "timeout") return store.setPollTimedOut(true);
	if (decision === "continue") scheduleMembershipPoll(store);
}

async function initializeMembershipStatus(store: MembershipPollStore) {
	const current = await requestMembershipStatus(store, true);
	if (!current) return;
	store.membershipInitialSignature = membershipStatusSignature(current);
	store.sawProcessing = hasProcessingMembership(current);
	if (store.checkoutReturn || store.sawProcessing) {
		store.setPollTimedOut(false);
		store.pollStartedAt = Date.now();
		scheduleMembershipPoll(store);
	}
}

async function refreshMembershipStatus(store: MembershipPollStore) {
	stopMembershipPolling(store);
	store.setPollTimedOut(false);
	const current = await requestMembershipStatus(store);
	if (!current) return;
	store.sawProcessing ||= hasProcessingMembership(current);
	const decision = decideMembershipPolling({
		memberships: current,
		checkoutReturn: store.checkoutReturn,
		initialSignature: store.membershipInitialSignature,
		sawProcessing: store.sawProcessing,
		elapsedMs: 0,
	});
	if (decision === "terminal") return finishMembershipPolling(store);
	if (decision === "continue") {
		store.setPollTimedOut(false);
		store.pollStartedAt = Date.now();
		scheduleMembershipPoll(store);
	}
}

function CustomerMembershipList(props: {
	memberships: readonly CustomerMembershipStatusEntry[];
}) {
	return (
		<div class="customer-membership-list" aria-live="polite">
			<For each={props.memberships}>
				{(membership) => {
					const view = customerMembershipViewModel(membership);
					return (
						<article
							class={`customer-membership-card customer-membership-${view.tone}`}
						>
							<header>
								<h3>{membershipDisplayName(membership.entitlementClass)}</h3>
								<span class="customer-membership-badge">{view.label}</span>
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
	);
}

function CheckoutProcessingCard() {
	return (
		<article
			class="customer-membership-card customer-membership-processing"
			role="status"
		>
			<header>
				<h3>Teacher Membership</h3>
				<span class="customer-membership-badge">Processing</span>
			</header>
			<p>
				Festival is waiting for Shopify payment evidence. This does not grant
				active membership rights yet.
			</p>
		</article>
	);
}

function FestivalMembershipsSection(props: { store: MembershipPollStore }) {
	const s = props.store;
	const showEmpty = () =>
		!s.loading() &&
		!s.error() &&
		!s.checkoutProcessing() &&
		s.memberships().length === 0;
	const showProcessing = () =>
		s.checkoutProcessing() && !s.loading() && s.memberships().length === 0;
	return (
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
					disabled={s.loading() || s.refreshing()}
					onClick={() => void refreshMembershipStatus(s)}
				>
					{s.refreshing() ? "Refreshing…" : "Refresh membership status"}
				</Button>
			</header>
			<Show when={s.loading()}>
				<p role="status">Loading Festival membership status…</p>
			</Show>
			<Show when={s.error()}>
				{(msg) => (
					<p class="error-text" role="alert">
						{msg()}
					</p>
				)}
			</Show>
			<Show when={showProcessing()}>
				<CheckoutProcessingCard />
			</Show>
			<Show when={s.memberships().length > 0}>
				<CustomerMembershipList memberships={s.memberships()} />
			</Show>
			<Show when={showEmpty()}>
				<p>No Festival memberships found.</p>
			</Show>
			<Show when={s.pollTimedOut()}>
				<p class="muted" role="status">
					Membership validation is still processing. Use Refresh membership
					status to check again.
				</p>
			</Show>
		</section>
	);
}

export function CustomerAccountMembershipsPage(props: { slug: string }) {
	const store = createMembershipPollStore(() => props.slug);
	onCleanup(() => {
		store.disposed = true;
		stopMembershipPolling(store);
	});

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => {
				store.checkoutReturn =
					new URLSearchParams(window.location.search).get("checkout") ===
					"processing";
				store.setCheckoutProcessing(store.checkoutReturn);
				void initializeMembershipStatus(store);
			}}
		>
			{(session) => (
				<>
					<h1>Memberships</h1>
					<FestivalMembershipsSection store={store} />
					<Show when={hasActiveTeacherMembership(store.memberships())}>
						<CustomerTeacherDirectoryCard
							slug={props.slug}
							csrfToken={session.csrfToken}
							memberships={store.memberships()}
						/>
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
