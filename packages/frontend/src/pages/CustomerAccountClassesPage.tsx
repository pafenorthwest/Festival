import type {
	CustomerClassRegistrationItem,
	FestivalSummary,
	OrganizationDivision,
	RegistrationAccompanistSummary,
	RegistrationTeacherSummary,
} from "@festival/common";
import { deriveFestivalMetadataCutoff } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import {
	getPublicDivisions,
	getPublicOrganizationLanding,
	listCustomerClassRegistrations,
	listRegistrationAccompanists,
	listRegistrationTeachers,
} from "../lib/api.js";
import {
	buildFestivalRegistrationPath,
	buildOrgCustomerAccountClassEditPath,
	buildOrgRootPath,
} from "../lib/routes.js";
import {
	formatCutoffDateTime,
	formatCutoffShort,
	formatCutoffWithYear,
	formatPiecesSummary,
	groupRegistrationsByPerformer,
} from "./customerAccountClassesHelpers.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

function formatPaidAt(paidAtIso: string | null): string {
	if (!paidAtIso) return "Payment date unavailable";
	return new Date(paidAtIso).toLocaleString(undefined, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});
}

export function CustomerAccountClassesPage(props: { slug: string }) {
	const [registrations, setRegistrations] = createSignal<
		CustomerClassRegistrationItem[]
	>([]);
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
	const [divisions, setDivisions] = createSignal<OrganizationDivision[]>([]);
	const [teachersMap, setTeachersMap] = createSignal<
		Map<string, RegistrationTeacherSummary>
	>(new Map());
	const [accompanistsMap, setAccompanistsMap] = createSignal<
		Map<string, RegistrationAccompanistSummary>
	>(new Map());
	const [selectedFestivalId, setSelectedFestivalId] =
		createSignal<string>("all");
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");

	async function loadClasses() {
		setLoading(true);
		setError("");
		try {
			const [regResponse, landingRes, divRes] = await Promise.all([
				listCustomerClassRegistrations(props.slug),
				getPublicOrganizationLanding(props.slug).catch(() => ({
					festivals: [] as FestivalSummary[],
				})),
				getPublicDivisions(props.slug).catch(() => ({
					divisions: [] as OrganizationDivision[],
				})),
			]);
			setRegistrations(regResponse.registrations);
			setFestivals(landingRes.festivals ?? []);
			setDivisions(divRes.divisions ?? []);

			// Fetch teachers and accompanists for festivals present in registrations
			const festShortNames = new Set<string>();
			for (const r of regResponse.registrations) {
				const f = landingRes.festivals?.find(
					(x) => x.id === r.entitlement.festivalId,
				);
				if (f?.shortName) festShortNames.add(f.shortName);
			}

			const tMap = new Map<string, RegistrationTeacherSummary>();
			const aMap = new Map<string, RegistrationAccompanistSummary>();

			await Promise.all(
				Array.from(festShortNames).map(async (fShort) => {
					const [accRes, teachRes] = await Promise.all([
						listRegistrationAccompanists(props.slug, fShort).catch(() => ({
							accompanists: [],
						})),
						listRegistrationTeachers(props.slug, fShort).catch(() => ({
							teachers: [],
						})),
					]);
					for (const a of accRes.accompanists ?? []) aMap.set(a.id, a);
					for (const t of teachRes.teachers ?? []) tMap.set(t.id, t);
				}),
			);

			setTeachersMap(tMap);
			setAccompanistsMap(aMap);
		} catch {
			setError("Purchased classes could not be loaded. Please try again.");
		} finally {
			setLoading(false);
		}
	}

	const filteredRegistrations = () => {
		const sel = selectedFestivalId();
		if (sel === "all") return registrations();
		return registrations().filter((r) => r.entitlement.festivalId === sel);
	};

	const performerGroups = () =>
		groupRegistrationsByPerformer(filteredRegistrations());

	const activeFestival = () => {
		const sel = selectedFestivalId();
		if (sel !== "all") {
			return festivals().find((f) => f.id === sel) ?? null;
		}
		// Default to primary festival or first festival in list
		return festivals().find((f) => f.isPrimary) ?? festivals()[0] ?? null;
	};

	const activeCutoff = () => {
		const f = activeFestival();
		if (!f?.startDate) return null;
		try {
			return deriveFestivalMetadataCutoff(f.startDate, "America/Los_Angeles");
		} catch {
			return null;
		}
	};

	const isActiveCutoffPassed = () => {
		const c = activeCutoff();
		return c ? Date.now() >= c.getTime() : false;
	};

	function getFestivalCutoff(festId: string): {
		cutoff: Date | null;
		isPassed: boolean;
	} {
		const f = festivals().find((x) => x.id === festId);
		if (!f?.startDate) return { cutoff: null, isPassed: false };
		try {
			const c = deriveFestivalMetadataCutoff(f.startDate, "America/Los_Angeles");
			return { cutoff: c, isPassed: Date.now() >= c.getTime() };
		} catch {
			return { cutoff: null, isPassed: false };
		}
	}

	function getDivisionName(divId?: string): string {
		if (!divId) return "Festival";
		return (
			divisions().find((d) => d.id === divId)?.displayName ?? "Festival Class"
		);
	}

	function getTeacherName(tId?: string): string {
		if (!tId) return "Historical name unavailable";
		return teachersMap().get(tId)?.name ?? "Historical name unavailable";
	}

	function getAccompanistName(accId?: string | null): string {
		if (!accId) return "Not required";
		return accompanistsMap().get(accId)?.name ?? "Registered accompanist";
	}

	const registerHref = () => {
		const f = activeFestival();
		return f?.shortName
			? buildFestivalRegistrationPath(props.slug, f.shortName)
			: buildOrgRootPath(props.slug);
	};

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => void loadClasses()}
		>
			{() => (
				<main id="main" class="main">
					<div class="page-heading">
						<p class="eyebrow">YOUR FAMILY’S PURCHASED CLASSES</p>
						<h1>Classes</h1>
						<p class="muted">
							Review purchased classes and keep repertoire and accompanists up
							to date.
						</p>
					</div>

					<Show when={loading()}>
						<p role="status">Loading your purchased classes…</p>
					</Show>

					<Show when={error()}>
						{(message) => (
							<p class="error-text" role="alert">
								{message()}
							</p>
						)}
					</Show>

					<Show when={!loading() && !error() && registrations().length === 0}>
						<p>No purchased classes found.</p>
					</Show>

					<Show when={!loading() && registrations().length > 0}>
						<div class="filter-row">
							<div class="field compact-field">
								<label for="festival-filter">Festival</label>
								<select
									id="festival-filter"
									data-festival-filter
									value={selectedFestivalId()}
									onChange={(e) => setSelectedFestivalId(e.currentTarget.value)}
								>
									<option value="all">All festivals</option>
									<For each={festivals()}>
										{(f) => <option value={f.id}>{f.name}</option>}
									</For>
								</select>
							</div>
							<a class="text-link" href={registerHref()}>
								Register for another class →
							</a>
						</div>

						<Show when={activeFestival() && activeCutoff()}>
							{(() => {
								const cutoffDate = activeCutoff();
								if (!cutoffDate) return null;
								return (
									<div class="note">
										<Show when={!isActiveCutoffPassed()}>
											<strong>
												{activeFestival()?.name} edits close{" "}
												{formatCutoffDateTime(cutoffDate)}.
											</strong>
											<span>
												{" "}
												Repertoire and accompanists can be changed until then.
											</span>
										</Show>
										<Show when={isActiveCutoffPassed()}>
											<strong>
												{activeFestival()?.name} editing closed{" "}
												{formatCutoffDateTime(cutoffDate)}.
											</strong>
											<span> Repertoire and accompanists are now locked.</span>
										</Show>
									</div>
								);
							})()}
						</Show>

						<div aria-live="polite">
							<For each={performerGroups()}>
								{(group) => (
									<details class="panel registration-group" open>
										<summary>
											<span>
												<strong>{group.performerName}</strong>
												<span class="muted">
													{group.registrations.length} registration
													{group.registrations.length === 1 ? "" : "s"}
												</span>
											</span>
											<span class="expand-symbol" aria-hidden="true">
												⌄
											</span>
										</summary>
										<div class="group-content">
											<For each={group.registrations}>
												{(registration) => {
													const fest = () =>
														festivals().find(
															(x) =>
																x.id === registration.entitlement.festivalId,
														);
													const festCutoff = () =>
														getFestivalCutoff(
															registration.entitlement.festivalId,
														);
													const fc = () => registration.festivalClass;
													const ageText = () => {
														const c = fc();
														return c?.minimumAge && c?.maximumAge
															? ` · Ages ${c.minimumAge}–${c.maximumAge}`
															: "";
													};

													return (
														<article
															class="list-row"
															data-festival={fest()?.code ?? fest()?.shortName}
														>
															<div class="row-main">
																<p class="eyebrow">
																	{fest()?.name?.toUpperCase() ?? "FESTIVAL"} ·{" "}
																	{getDivisionName(
																		fc()?.divisionId,
																	).toUpperCase()}
																</p>
																<div class="inline">
																	<h2>
																		{registration.festivalClass?.displayName ??
																			"Festival Class"}
																	</h2>
																	<Show
																		when={
																			registration.entitlement?.status ===
																			"confirmed"
																		}
																	>
																		<span
																			class="badge status-available"
																			data-testid="placed-confirmed-badge"
																		>
																			Placed / Confirmed
																		</span>
																	</Show>
																	<Show
																		when={
																			registration.entitlement?.status ===
																			"waitlisted"
																		}
																	>
																		<span
																			class="badge status-neutral"
																			data-testid="paid-waitlisted-badge"
																		>
																			Waitlisted (Paid)
																		</span>
																	</Show>
																</div>
																<p>
																	Teacher:{" "}
																	{getTeacherName(
																		registration.metadata?.teacherMembershipId,
																	)}
																	{ageText()}
																</p>
																<p class="muted">
																	{formatPiecesSummary(
																		registration.metadata?.repertoireJson,
																	)}
																</p>
																<p class="muted">
																	Accompanist:{" "}
																	{getAccompanistName(
																		registration.metadata
																			?.accompanistMembershipId,
																	)}
																</p>
																<p class="customer-class-card-paid-at muted">
																	{formatPaidAt(registration.paidAtIso)}
																</p>
																<p class="sr-only">
																	Performer:{" "}
																	<strong>
																		{registration.child?.name ?? "Performer"}
																	</strong>
																</p>
															</div>

															<div class="row-actions">
																<Show when={!festCutoff().isPassed}>
																	<div class="registration-edit-action">
																		<a
																			class="button secondary small"
																			href={buildOrgCustomerAccountClassEditPath(
																				props.slug,
																				registration.entitlement.id,
																			)}
																		>
																			Edit
																		</a>
																		<span class="registration-edit-help">
																			<button
																				class="registration-edit-info"
																				type="button"
																				aria-label="About editing this registration"
																				aria-describedby={`tooltip-${registration.entitlement.id}`}
																			>
																				<svg
																					viewBox="0 0 24 24"
																					width="18"
																					height="18"
																					fill="none"
																					stroke="currentColor"
																					stroke-width="1.8"
																					aria-hidden="true"
																					focusable="false"
																				>
																					<circle
																						cx="12"
																						cy="12"
																						r="9"
																					/>
																					<path d="M12 10.5v6" />
																					<circle
																						cx="12"
																						cy="7.5"
																						r=".8"
																						fill="currentColor"
																						stroke="none"
																					/>
																				</svg>
																			</button>
																			<span
																				class="registration-edit-tooltip"
																				id={`tooltip-${registration.entitlement.id}`}
																				role="tooltip"
																			>
																				Edit Repertoire / Accompanist
																			</span>
																		</span>
																	</div>
																	<span class="muted small-copy">
																		Edits open until{" "}
																		{(() => {
																			const c = festCutoff().cutoff;
																			return c ? formatCutoffShort(c) : "cutoff";
																		})()}
																	</span>
																</Show>

																<Show when={festCutoff().isPassed}>
																	<a
																		class="text-link"
																		href={buildOrgCustomerAccountClassEditPath(
																			props.slug,
																			registration.entitlement.id,
																		)}
																	>
																		View details →
																	</a>
																	<span class="muted small-copy">
																		Editing closed{" "}
																		{(() => {
																			const c = festCutoff().cutoff;
																			return c ? formatCutoffWithYear(c) : "";
																		})()}
																	</span>
																</Show>
															</div>
														</article>
													);
												}}
											</For>
										</div>
									</details>
								)}
							</For>
						</div>
					</Show>
				</main>
			)}
		</CustomerAccountPageLayout>
	);
}
