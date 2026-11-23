import {
	ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
	type EntitlementClass,
	type EntitlementLifecycleState,
	type EntitlementReportDivisionOption,
	type EntitlementReportEntry,
	type EntitlementSummaryCounts,
	type ProfileApprovalStatus,
} from "@festival/common";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	Show,
	untrack,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	getAdminEntitlementReport,
	revokeAdminEntitlement,
	updateAdminAccompanistProfileApproval,
	updateAdminTeacherProfileApproval,
	updateAdminTeacherProfileDivisions,
} from "../lib/api.js";
import { AdminEntitlementTable } from "./AdminEntitlementTable.js";
import {
	EMPTY_ENTITLEMENT_SUMMARY_COUNTS,
	ENTITLEMENT_CLASS_FILTER_OPTIONS,
	ENTITLEMENT_STATUS_FILTER_OPTIONS,
	entitlementPageNumbers,
	entitlementStatusBadgeClass,
	formatEntitlementPageRange,
} from "./adminEntitlementReportHelpers.js";

const SEARCH_DEBOUNCE_MS = 300;

async function getEntitlementAdminAuth(app: FestivalAppController) {
	const route = app.route();
	const user = app.firebaseUser();
	if (!user || route.kind !== "org-admin-memberships" || !app.isAdminMember()) {
		throw new Error("Sign in as an Admin to update memberships.");
	}
	const isCurrent = () => {
		const currentRoute = app.route();
		return (
			currentRoute.kind === "org-admin-memberships" &&
			currentRoute.slug === route.slug &&
			app.firebaseUser() === user &&
			app.isAdminMember()
		);
	};
	const token = await user.getIdToken();
	if (!isCurrent()) throw new Error("The Admin session changed. Try again.");
	return { token, slug: route.slug, isCurrent };
}

function SummaryCountsSection(props: {
	summaryCounts: EntitlementSummaryCounts;
}) {
	return (
		<ul
			class="entitlement-summary-counts"
			aria-label="Entitlement status summary"
		>
			<For each={ENTITLEMENT_STATUS_FILTER_OPTIONS}>
				{(item) => (
					<li class="entitlement-summary-card">
						<span class={entitlementStatusBadgeClass(item.value)}>
							{item.label}
						</span>
						<strong>{props.summaryCounts[item.value]}</strong>
					</li>
				)}
			</For>
		</ul>
	);
}

export function AdminEntitlementReportPanel(props: {
	app: FestivalAppController;
}) {
	const [report, setReport] = createStore({
		entries: [] as EntitlementReportEntry[],
		editableDivisions: [] as EntitlementReportDivisionOption[],
	});
	const [loading, setLoading] = createSignal(false);
	// Filter and page loads remount the table before a row mutation may finish.
	const [mutationPending, setMutationPending] = createSignal(false);
	const [error, setError] = createSignal("");
	const [search, setSearch] = createSignal("");
	const [entitlementClass, setEntitlementClass] = createSignal<
		EntitlementClass | ""
	>("");
	const [status, setStatus] = createSignal<EntitlementLifecycleState | "">("");
	const [divisionId, setDivisionId] = createSignal("");
	const [divisions, setDivisions] = createSignal<
		EntitlementReportDivisionOption[]
	>([]);
	const [page, setPage] = createSignal(1);
	const [total, setTotal] = createSignal(0);
	const [totalPages, setTotalPages] = createSignal(1);
	const [summaryCounts, setSummaryCounts] =
		createSignal<EntitlementSummaryCounts>(EMPTY_ENTITLEMENT_SUMMARY_COUNTS);
	const hasFilters = () =>
		Boolean(search().trim() || entitlementClass() || status() || divisionId());

	let controller: AbortController | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;

	const load = async (background = false) => {
		if (disposed) return;
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships") {
			setLoading(false);
			return;
		}
		if (!user) {
			controller?.abort();
			setReport({ entries: [], editableDivisions: [] });
			setTotal(0);
			setTotalPages(1);
			setLoading(false);
			return;
		}
		controller?.abort();
		const current = new AbortController();
		controller = current;
		if (!background) setLoading(true);
		setError("");
		try {
			const response = await getAdminEntitlementReport(
				await user.getIdToken(),
				route.slug,
				{
					search: search().trim() || undefined,
					entitlementClass: entitlementClass() || undefined,
					status: status() || undefined,
					divisionId: divisionId() || undefined,
				},
				{
					page: page(),
					pageSize: ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
				},
				{ signal: current.signal },
			);
			if (current.signal.aborted) return;
			setReport(
				reconcile({
					entries: response.entries,
					editableDivisions: response.editableDivisions ?? [],
				}),
			);
			setTotal(response.total);
			setTotalPages(response.totalPages);
			setDivisions((previous) => {
				const selected = previous.find(
					(option) => option.divisionId === divisionId(),
				);
				// A division edit can move the last row out of this filter.
				if (
					selected &&
					!response.divisions.some(
						(option) => option.divisionId === selected.divisionId,
					)
				) {
					return [...response.divisions, selected];
				}
				return response.divisions;
			});
			if (response.summaryCounts) setSummaryCounts(response.summaryCounts);
			// The server clamps a page past the end (e.g. rows were removed elsewhere).
			setPage(response.page);
		} catch (reason) {
			if (current.signal.aborted) return;
			setReport({ entries: [], editableDivisions: [] });
			setTotal(0);
			setTotalPages(1);
			setError(
				reason instanceof Error && reason.message
					? reason.message
					: "Entitlements could not be loaded.",
			);
		} finally {
			if (!current.signal.aborted) setLoading(false);
		}
	};

	const saveDivision = async (profileId: string, divisionId: string) => {
		const auth = await getEntitlementAdminAuth(props.app);
		await updateAdminTeacherProfileDivisions(auth.token, auth.slug, {
			profileId,
			divisionIds: [divisionId],
		});
		if (auth.isCurrent()) await load(true);
	};

	const revoke = async (entry: EntitlementReportEntry, reason: string) => {
		const auth = await getEntitlementAdminAuth(props.app);
		await revokeAdminEntitlement(auth.token, auth.slug, entry.id, {
			confirmed: true,
			reason,
		});
		if (auth.isCurrent()) await load(true);
	};

	const saveDirectory = async (
		entry: EntitlementReportEntry,
		approvalStatus: ProfileApprovalStatus,
	) => {
		const profile = entry.directoryProfile;
		if (!profile?.publicDirectoryOptIn)
			throw new Error("This profile has opted out of the public directory.");
		const auth = await getEntitlementAdminAuth(props.app);
		const update =
			entry.entitlementClass === "teacher_membership"
				? updateAdminTeacherProfileApproval
				: updateAdminAccompanistProfileApproval;
		await update(auth.token, auth.slug, {
			profileId: profile.id,
			approvalStatus,
		});
		if (auth.isCurrent()) await load(true);
	};

	const scheduleLoad = () => {
		clearTimeout(debounce);
		debounce = setTimeout(() => void load(), SEARCH_DEBOUNCE_MS);
	};

	// Any filter change starts over at the first page.
	const reloadFromFirstPage = () => {
		clearTimeout(debounce);
		setPage(1);
		void load();
	};

	const goToPage = (next: number) => {
		if (next < 1 || next > totalPages() || next === page()) return;
		clearTimeout(debounce);
		setPage(next);
		void load();
	};

	createEffect(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) {
			controller?.abort();
			setReport({ entries: [], editableDivisions: [] });
			setTotal(0);
			setTotalPages(1);
			setLoading(false);
			return;
		}
		setDivisionId("");
		setDivisions([]);
		untrack(() => void load());
	});

	onCleanup(() => {
		disposed = true;
		clearTimeout(debounce);
		controller?.abort();
	});

	return (
		<section
			class="panel flow-panel entitlement-report"
			aria-labelledby="entitlement-report-title"
		>
			<div class="shopify-card-header">
				<div>
					<h2 id="entitlement-report-title">Entitlements</h2>
					<p>
						Report and operational lifecycle controls for Teacher and
						Accompanist memberships held by customers.
					</p>
				</div>
				<Show when={!loading() && !error()}>
					<span class="shopify-status shopify-status-ok">{total()}</span>
				</Show>
			</div>

			<SummaryCountsSection summaryCounts={summaryCounts()} />

			<form
				class="entitlement-report-filters"
				onSubmit={(event) => {
					event.preventDefault();
					reloadFromFirstPage();
				}}
			>
				<label class="field">
					<span>Customer</span>
					<input
						type="search"
						placeholder="Search by name or email"
						value={search()}
						onInput={(event) => {
							setSearch(event.currentTarget.value);
							setPage(1);
							scheduleLoad();
						}}
					/>
				</label>
				<label class="field">
					<span>Type</span>
					<select
						value={entitlementClass()}
						onChange={(event) => {
							setEntitlementClass(
								event.currentTarget.value as EntitlementClass | "",
							);
							reloadFromFirstPage();
						}}
					>
						<option value="">All types</option>
						<For each={ENTITLEMENT_CLASS_FILTER_OPTIONS}>
							{(option) => <option value={option.value}>{option.label}</option>}
						</For>
					</select>
				</label>
				<label class="field">
					<span>Division</span>
					<select
						value={divisionId()}
						onChange={(event) => {
							setDivisionId(event.currentTarget.value);
							reloadFromFirstPage();
						}}
					>
						<option value="">All divisions</option>
						{/* The list is replaced on every response, which rebuilds the
						    options and would reset the select, so each one re-asserts
						    whether it is the chosen division. */}
						<For each={divisions()}>
							{(option) => (
								<option
									value={option.divisionId}
									selected={option.divisionId === divisionId()}
								>
									{option.divisionName}
								</option>
							)}
						</For>
					</select>
				</label>
				<label class="field">
					<span>Status</span>
					<select
						value={status()}
						onChange={(event) => {
							setStatus(
								event.currentTarget.value as EntitlementLifecycleState | "",
							);
							reloadFromFirstPage();
						}}
					>
						<option value="">All statuses</option>
						<For each={ENTITLEMENT_STATUS_FILTER_OPTIONS}>
							{(option) => <option value={option.value}>{option.label}</option>}
						</For>
					</select>
				</label>
			</form>

			<Show when={loading()}>
				<p class="muted" role="status">
					Loading entitlements…
				</p>
			</Show>
			<Show when={error()}>
				{(message) => (
					<p class="shopify-error-text" role="alert">
						{message()}
					</p>
				)}
			</Show>

			<Show when={!loading() && !error()}>
				<AdminEntitlementTable
					entries={report.entries}
					editableDivisions={report.editableDivisions}
					hasFilters={hasFilters()}
					canEdit={props.app.isAdminMember()}
					mutationPending={mutationPending()}
					onMutationPendingChange={setMutationPending}
					onDivisionChange={saveDivision}
					onDirectoryChange={saveDirectory}
					onRevoke={revoke}
				/>
				<Show when={total() > 0}>
					<nav class="entitlement-report-pager" aria-label="Entitlement pages">
						<span class="muted entitlement-report-range">
							{formatEntitlementPageRange({
								total: total(),
								page: page(),
								pageSize: ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
								entries: report.entries,
							})}
						</span>
						<Show when={totalPages() > 1}>
							<div class="entitlement-report-pages">
								<button
									type="button"
									class="secondary-button"
									disabled={page() <= 1}
									onClick={() => goToPage(page() - 1)}
								>
									Previous
								</button>
								<For each={entitlementPageNumbers(page(), totalPages())}>
									{(item) =>
										item === "gap" ? (
											<span class="entitlement-report-gap" aria-hidden="true">
												…
											</span>
										) : (
											<button
												type="button"
												class={
													item === page()
														? "secondary-button entitlement-report-page-current"
														: "secondary-button"
												}
												aria-current={item === page() ? "page" : undefined}
												aria-label={`Page ${item}`}
												onClick={() => goToPage(item)}
											>
												{item}
											</button>
										)
									}
								</For>
								<button
									type="button"
									class="secondary-button"
									disabled={page() >= totalPages()}
									onClick={() => goToPage(page() + 1)}
								>
									Next
								</button>
							</div>
						</Show>
					</nav>
				</Show>
			</Show>
		</section>
	);
}
