import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import {
	listStaffRoster,
	type StaffMembershipRosterEntry,
} from "../lib/api.js";

export type RosterFilter = "All" | "Teacher" | "Accompanist";

function RosterFilterControl(props: {
	currentFilter: RosterFilter;
	onFilterChange: (filter: RosterFilter) => void;
}) {
	const filterOptions: RosterFilter[] = ["All", "Teacher", "Accompanist"];
	return (
		<nav
			class="roster-filter-controls"
			aria-label="Filter roster by membership type"
		>
			<For each={filterOptions}>
				{(type) => (
					<button
						type="button"
						class={`button ${props.currentFilter === type ? "primary" : "secondary"}`}
						aria-pressed={props.currentFilter === type}
						onClick={() => props.onFilterChange(type)}
					>
						{type}
					</button>
				)}
			</For>
		</nav>
	);
}

function RosterEntryCard(props: { entry: StaffMembershipRosterEntry }) {
	const entry = props.entry;
	const memberTitle = () => entry.name || entry.email || "Unnamed Member";
	const badgeClass = () =>
		entry.membershipType === "Teacher" ? "badge-active" : "badge-neutral";

	return (
		<article class="admin-membership-item roster-card">
			<div class="roster-card-header">
				<h3 class="roster-member-title">{memberTitle()}</h3>
				<span class={`badge ${badgeClass()}`}>{entry.membershipType}</span>
			</div>
			<Show when={entry.email || entry.phone || entry.city}>
				<div class="roster-contact-details">
					<Show when={entry.email}>
						<span class="roster-contact-email">{entry.email}</span>
					</Show>
					<Show when={entry.phone}>
						<span class="roster-contact-phone">{entry.phone}</span>
					</Show>
					<Show when={entry.city}>
						<span class="roster-contact-city">{entry.city}</span>
					</Show>
				</div>
			</Show>
			<span class="roster-offering-details">
				{entry.offeringName} · {entry.startsOn}–{entry.endsOn}
			</span>
			<Show when={entry.divisions.length > 0}>
				<span class="roster-divisions">
					{entry.divisions.map((division) => division.divisionName).join(", ")}
				</span>
			</Show>
		</article>
	);
}

function useStaffRoster(app: FestivalAppController) {
	const [entries, setEntries] = createSignal<StaffMembershipRosterEntry[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");

	onMount(async () => {
		const route = app.route();
		const user = app.firebaseUser();
		if (
			(route.kind !== "org-admin-roster" &&
				route.kind !== "org-admin-accompanists") ||
			!user
		)
			return;
		try {
			const roster = await listStaffRoster(await user.getIdToken(), route.slug);
			setEntries(roster);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Staff roster could not be loaded.",
			);
		} finally {
			setLoading(false);
		}
	});

	return { entries, loading, error };
}

export function AdminRosterPage(props: { app: FestivalAppController }) {
	const { entries, loading, error } = useStaffRoster(props.app);
	const [filter, setFilter] = createSignal<RosterFilter>("All");

	const allowed = () =>
		["Admin", "Division Chair", "Concert Chair"].includes(
			props.app.sessionMembership()?.role ?? "",
		);

	const filteredEntries = createMemo(() => {
		const currentFilter = filter();
		if (currentFilter === "All") return entries();
		return entries().filter((entry) => entry.membershipType === currentFilter);
	});

	return (
		<Show
			when={allowed()}
			fallback={
				<AccessDeniedPanel message="Only authorized Festival staff can view staff roster." />
			}
		>
			<section class="panel flow-panel roster-panel">
				<div class="roster-header">
					<h2>Staff roster</h2>
					<RosterFilterControl
						currentFilter={filter()}
						onFilterChange={setFilter}
					/>
				</div>
				<Show when={loading()}>
					<p role="status">Loading staff roster…</p>
				</Show>
				<Show when={error()}>
					{(message) => <p role="alert">{message()}</p>}
				</Show>
				<Show when={!loading() && !error()}>
					<Show
						when={filteredEntries().length > 0}
						fallback={<p>No active roster members.</p>}
					>
						<div class="roster-list">
							<For each={filteredEntries()}>
								{(entry) => <RosterEntryCard entry={entry} />}
							</For>
						</div>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
