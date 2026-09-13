import { createSignal, For, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { getStaffAccompanists } from "../lib/api.js";

export function AdminAccompanistsPage(props: { app: FestivalAppController }) {
	const [entries, setEntries] = createSignal<
		Array<{
			offeringName: string;
			startsOn: string;
			endsOn: string;
			name: string;
			email: string;
			phone: string;
			city: string;
			divisions: Array<{ divisionId: string; divisionName: string }>;
		}>
	>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");
	onMount(async () => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-accompanists" || !user) return;
		try {
			setEntries(
				(await getStaffAccompanists(await user.getIdToken(), route.slug))
					.accompanists,
			);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Accompanist roster could not be loaded.",
			);
		} finally {
			setLoading(false);
		}
	});
	const allowed = () =>
		["Admin", "Division Chair", "Concert Chair"].includes(
			props.app.sessionMembership()?.role ?? "",
		);
	return (
		<Show
			when={allowed()}
			fallback={
				<AccessDeniedPanel message="Only authorized Festival staff can view accompanist contacts." />
			}
		>
			<section class="panel flow-panel">
				<h2>Accompanist roster</h2>
				<Show when={loading()}>
					<p role="status">Loading accompanists…</p>
				</Show>
				<Show when={error()}>
					{(message) => <p role="alert">{message()}</p>}
				</Show>
				<Show when={!loading() && !error()}>
					<Show
						when={entries().length}
						fallback={<p>No active accompanists.</p>}
					>
						<For each={entries()}>
							{(entry) => (
								<article class="admin-membership-item">
									<strong>{entry.name}</strong>
									<span>
										{entry.email} · {entry.phone} · {entry.city}
									</span>
									<span>
										{entry.offeringName} · {entry.startsOn}–{entry.endsOn}
									</span>
									<span>
										{entry.divisions
											.map((division) => division.divisionName)
											.join(", ")}
									</span>
								</article>
							)}
						</For>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
