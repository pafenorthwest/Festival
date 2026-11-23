import type { CustomerMembershipStatusEntry } from "@festival/common";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { getCustomerMembershipStatus } from "../lib/api.js";
import {
	buildOrgAccompanistMembershipPath,
	buildOrgMembershipPath,
} from "../lib/routes.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import { CustomerTeacherDirectoryCard } from "./CustomerTeacherDirectoryCard.js";
import {
	customerMembershipViewModel,
	decideMembershipPolling,
	hasProcessingMembership,
	MEMBERSHIP_POLL_INTERVAL_MS,
	type MembershipAcquisitionState,
	membershipStatusSignature,
	resolveMembershipAcquisitionState,
} from "./customerMembershipStatus.js";
import {
	hasActiveAccompanistMembership,
	hasActiveTeacherMembership,
} from "./teacherDirectoryHelpers.js";

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
	const [statusVerified, setStatusVerified] = createSignal(false);
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
		statusVerified,
		setStatusVerified,
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
		authenticated: false,
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
		store.setStatusVerified(true);
		return response.memberships;
	} catch {
		if (!store.disposed) {
			store.setStatusVerified(false);
			store.setError(
				"Festival membership status could not be loaded. Please try again.",
			);
		}
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

function registerMembershipLifecycle(store: MembershipPollStore) {
	onCleanup(() => {
		store.disposed = true;
		stopMembershipPolling(store);
	});
	if (typeof window === "undefined") return;
	const onPageShow = (event: PageTransitionEvent) => {
		if (!event.persisted || !store.authenticated || store.disposed) return;
		store.setStatusVerified(false);
		void refreshMembershipStatus(store);
	};
	window.addEventListener("pageshow", onPageShow);
	onCleanup(() => window.removeEventListener("pageshow", onPageShow));
}

function handleAuthenticatedSession(store: MembershipPollStore) {
	store.authenticated = true;
	store.checkoutReturn =
		new URLSearchParams(window.location.search).get("checkout") ===
		"processing";
	store.setCheckoutProcessing(store.checkoutReturn);
	void initializeMembershipStatus(store);
}

function AcquireMembershipsActions(props: {
	slug: string;
	state: MembershipAcquisitionState;
	onNavigate: (path: string) => void;
}) {
	const teacherPath = () => buildOrgMembershipPath(props.slug);
	const accompanistPath = () => buildOrgAccompanistMembershipPath(props.slug);
	return (
		<div class="customer-membership-acquire-actions">
			<Button
				type="button"
				class="teachers"
				disabled={props.state.teacherDisabled}
				data-preload-path={teacherPath()}
				onClick={() => {
					if (props.state.teacherDisabled) return;
					props.onNavigate(teacherPath());
				}}
			>
				Annual Teacher
			</Button>
			<Button
				type="button"
				class="accompanists"
				disabled={props.state.accompanistDisabled}
				data-preload-path={accompanistPath()}
				onClick={() => {
					if (props.state.accompanistDisabled) return;
					props.onNavigate(accompanistPath());
				}}
			>
				Annual Accompanist
			</Button>
			<Show
				when={!props.state.teacherDisabled || !props.state.accompanistDisabled}
			>
				<p class="customer-membership-acquire-help muted">
					Click here to add a membership
				</p>
			</Show>
		</div>
	);
}

export function CustomerAccountMembershipsPage(props: {
	slug: string;
	onNavigate?: (path: string) => void;
}) {
	const store = createMembershipPollStore(() => props.slug);
	registerMembershipLifecycle(store);
	const navigate = (path: string) => {
		if (props.onNavigate) {
			props.onNavigate(path);
			return;
		}
		window.location.assign(path);
	};
	const acquisition = () =>
		resolveMembershipAcquisitionState({
			memberships: store.memberships(),
			loading: store.loading() || store.refreshing() || !store.statusVerified(),
			error: store.error(),
			checkoutProcessing: store.checkoutProcessing(),
		});

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => handleAuthenticatedSession(store)}
		>
			{(session) => (
				<>
					<h1>Acquire Memberships</h1>
					<AcquireMembershipsActions
						slug={props.slug}
						state={acquisition()}
						onNavigate={navigate}
					/>
					<h1>Current Memberships</h1>
					<FestivalMembershipsSection store={store} />
					<Show when={hasActiveTeacherMembership(store.memberships())}>
						<CustomerTeacherDirectoryCard
							slug={props.slug}
							csrfToken={session.csrfToken}
							memberships={store.memberships()}
							onSaved={() => void refreshMembershipStatus(store)}
						/>
					</Show>
					<Show when={hasActiveAccompanistMembership(store.memberships())}>
						{/* biome-ignore lint/a11y/useValidAriaRole: role selects the participant directory card variant, not a DOM ARIA role. */}
						<CustomerTeacherDirectoryCard
							role="accompanist"
							slug={props.slug}
							csrfToken={session.csrfToken}
							memberships={store.memberships()}
							onSaved={() => void refreshMembershipStatus(store)}
						/>
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
