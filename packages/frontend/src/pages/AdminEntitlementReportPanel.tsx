import {
	ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
	type EntitlementClass,
	type EntitlementLifecycleState,
	type EntitlementReportDivisionOption,
	type EntitlementReportEntry,
} from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { getAdminEntitlementReport } from "../lib/api.js";
import {
	ENTITLEMENT_CLASS_FILTER_OPTIONS,
	ENTITLEMENT_STATUS_FILTER_OPTIONS,
	entitlementPageNumbers,
	entitlementStatusBadgeClass,
	formatEntitlementClass,
	formatEntitlementCustomer,
	formatEntitlementDivisions,
	formatEntitlementPageRange,
	formatEntitlementSource,
	formatEntitlementStatus,
} from "./adminEntitlementReportHelpers.js";

const SEARCH_DEBOUNCE_MS = 300;

export function AdminEntitlementReportPanel(props: {
	app: FestivalAppController;
}) {
	const [entries, setEntries] = createSignal<EntitlementReportEntry[]>([]);
	const [loading, setLoading] = createSignal(true);
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
	const hasFilters = () =>
		Boolean(search().trim() || entitlementClass() || status() || divisionId());

	let controller: AbortController | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;

	const load = async () => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return;
		controller?.abort();
		const current = new AbortController();
		controller = current;
		setLoading(true);
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
				{ page: page(), pageSize: ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE },
				{ signal: current.signal },
			);
			if (current.signal.aborted) return;
			setEntries(response.entries);
			setTotal(response.total);
			setTotalPages(response.totalPages);
			setDivisions(response.divisions);
			// The server clamps a page past the end (e.g. rows were removed elsewhere).
			setPage(response.page);
		} catch (reason) {
			if (current.signal.aborted) return;
			setEntries([]);
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

	onMount(() => void load());
	onCleanup(() => {
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
						Read-only report of Teacher and Accompanist memberships held by
						customers.
					</p>
				</div>
				<Show when={!loading() && !error()}>
					<span class="shopify-status shopify-status-ok">{total()}</span>
				</Show>
			</div>

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
				<div class="listing-table entitlement-report-table">
					<div class="listing-table-header">
						<span>Customer</span>
						<span>Type / source</span>
						<span>Divisions</span>
						<span>Period</span>
						<span>Status</span>
					</div>
					<Show when={entries().length === 0}>
						<div class="listing-table-empty">
							{hasFilters()
								? "No entitlements match these filters."
								: "No entitlements yet."}
						</div>
					</Show>
					<For each={entries()}>
						{(entry) => {
							const customer = formatEntitlementCustomer(entry);
							return (
								<div class="listing-table-row">
									<span>
										<strong>{customer.primary}</strong>
										<Show when={customer.secondary}>
											<span class="entitlement-report-secondary">
												{customer.secondary}
											</span>
										</Show>
									</span>
									<span>
										<strong>
											{formatEntitlementClass(entry.entitlementClass)}
										</strong>
										<span class="entitlement-report-secondary">
											{formatEntitlementSource(entry.source)}
										</span>
									</span>
									<span>{formatEntitlementDivisions(entry.divisions)}</span>
									<span>
										{entry.startsOn} – {entry.endsOn}
									</span>
									<span class="listing-table-badges">
										<span class={entitlementStatusBadgeClass(entry.status)}>
											{formatEntitlementStatus(entry.status)}
										</span>
									</span>
								</div>
							);
						}}
					</For>
				</div>
				<Show when={total() > 0}>
					<nav class="entitlement-report-pager" aria-label="Entitlement pages">
						<span class="muted entitlement-report-range">
							{formatEntitlementPageRange({
								total: total(),
								page: page(),
								pageSize: ENTITLEMENT_REPORT_DEFAULT_PAGE_SIZE,
								entries: entries(),
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
