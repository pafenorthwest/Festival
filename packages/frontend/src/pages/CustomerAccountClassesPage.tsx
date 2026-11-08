import type { FestivalSummary } from "@festival/common";
import {
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Button } from "../components/Button.js";
import type { CustomerClassRegistrationItem } from "../lib/api.js";
import {
	getPublicDivisions,
	getPublicOrganizationLanding,
	listCustomerClassRegistrations,
} from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import { PurchasedRegistrationEditHelp } from "./PurchasedRegistrationEditHelp.js";
import { PurchasedRegistrationEditor } from "./PurchasedRegistrationEditor.js";
import {
	canEditPurchasedRegistration,
	formatPurchasedCutoff,
	groupPurchasedRegistrations,
	purchasedRegistrationReadOnlyReason,
} from "./PurchasedRegistrationHelpers.js";

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
function pieceDuration(seconds: number): string {
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CustomerAccountClassesPage(props: { slug: string }) {
	const [registrations, setRegistrations] = createSignal<
		CustomerClassRegistrationItem[]
	>([]);
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
	const [divisions, setDivisions] = createSignal(new Map<string, string>());
	const [festivalFilter, setFestivalFilter] = createSignal("");
	const [selectedId, setSelectedId] = createSignal("");
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");
	const [contextError, setContextError] = createSignal("");
	const [notice, setNotice] = createSignal("");
	const [now, setNow] = createSignal(Date.now());
	const festivalById = createMemo(
		() => new Map(festivals().map((festival) => [festival.id, festival])),
	);
	const festivalChoices = createMemo(() => [
		...new Set(
			registrations().map(
				(registration) => registration.entitlement.festivalId,
			),
		),
	]);
	const groups = createMemo(() =>
		groupPurchasedRegistrations(registrations(), festivalFilter()),
	);
	const activeRegistration = () =>
		registrations().find(
			(registration) => registration.entitlement.id === selectedId(),
		);
	const divisionName = (registration: CustomerClassRegistrationItem) =>
		divisions().get(registration.festivalClass?.divisionId ?? "") ??
		"Division details unavailable";
	const canEdit = (registration: CustomerClassRegistrationItem) =>
		festivalById().has(registration.entitlement.festivalId) &&
		canEditPurchasedRegistration(registration, now());
	onMount(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		onCleanup(() => window.clearInterval(timer));
	});
	async function reloadRegistrations() {
		const response = await listCustomerClassRegistrations(props.slug);
		setRegistrations(response.registrations);
	}
	async function loadClasses() {
		setLoading(true);
		setError("");
		setContextError("");
		const results = await Promise.allSettled([
			reloadRegistrations(),
			getPublicOrganizationLanding(props.slug).then((response) =>
				setFestivals(response.festivals),
			),
			getPublicDivisions(props.slug).then((response) =>
				setDivisions(
					new Map(
						response.divisions.map((division) => [
							division.id,
							division.displayName,
						]),
					),
				),
			),
		]);
		if (results[0].status === "rejected")
			setError("Purchased classes could not be loaded. Please try again.");
		if (results[1].status === "rejected" || results[2].status === "rejected")
			setContextError(
				"Some festival details could not be loaded. Refresh to retry; your purchased classes are still shown.",
			);
		setLoading(false);
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => void loadClasses()}
		>
			{(session) => (
				<div class="purchased-registrations" aria-live="polite">
					<Show
						when={activeRegistration()}
						fallback={
							<>
								<header class="parent-page-heading">
									<p class="eyebrow">Your family’s purchased classes</p>
									<h1>My Registrations</h1>
									<p class="muted">
										Review purchased classes and keep repertoire and
										accompanists up to date.
									</p>
								</header>
								<Show when={notice()}>
									<p class="parent-note" role="status">
										{notice()}
									</p>
								</Show>
								<Show when={loading()}>
									<p role="status">Loading your purchased classes…</p>
								</Show>
								<Show when={error()}>
									<p class="error-text" role="alert">
										{error()}
									</p>
								</Show>
								<Show when={contextError()}>
									<p class="parent-note" role="status">
										{contextError()}
									</p>
								</Show>
								<Show when={error() || contextError()}>
									<Button
										type="button"
										variant="secondary"
										onClick={() => void loadClasses()}
									>
										Refresh registrations
									</Button>
								</Show>
								<Show
									when={!loading() && !error() && registrations().length === 0}
								>
									<p>No purchased classes found.</p>
								</Show>
								<Show when={registrations().length > 0}>
									<div class="purchased-registration-filters">
										<label class="field" for="purchased-festival-filter">
											<span>Festival</span>
											<select
												id="purchased-festival-filter"
												value={festivalFilter()}
												onChange={(event) =>
													setFestivalFilter(event.currentTarget.value)
												}
											>
												<option value="">All festivals</option>
												<For each={festivalChoices()}>
													{(id) => (
														<option value={id}>
															{festivalById().get(id)?.name ??
																"Festival details unavailable"}
														</option>
													)}
												</For>
											</select>
										</label>
									</div>
									<For each={groups()}>
										{(group) => (
											<details class="registration-group panel" open>
												<summary>
													<strong>{group.name}</strong>
													<span class="muted">
														{group.registrations.length} registration
														{group.registrations.length === 1 ? "" : "s"}
													</span>
												</summary>
												<div class="registration-group-content">
													<For each={group.registrations}>
														{(registration) => (
															<article class="registration-row">
																<div class="registration-row-main">
																	<p class="eyebrow">
																		{festivalById().get(
																			registration.entitlement.festivalId,
																		)?.name ??
																			"Festival details unavailable"}{" "}
																		· {divisionName(registration)}
																	</p>
																	<div class="parent-inline">
																		<h2>
																			{registration.festivalClass
																				?.displayName ?? "Festival Class"}
																		</h2>
																		<Show
																			when={
																				registration.entitlement.status ===
																				"confirmed"
																			}
																		>
																			<span
																				class="badge badge-success"
																				data-testid="placed-confirmed-badge"
																			>
																				Placed / Confirmed
																			</span>
																		</Show>
																		<Show
																			when={
																				registration.entitlement.status ===
																				"waitlisted"
																			}
																		>
																			<span
																				class="badge badge-neutral"
																				data-testid="paid-waitlisted-badge"
																			>
																				Waitlisted (Paid)
																			</span>
																		</Show>
																		<Show
																			when={
																				registration.entitlement.status !==
																					"confirmed" &&
																				registration.entitlement.status !==
																					"waitlisted"
																			}
																		>
																			<span class="badge badge-neutral">
																				{registration.entitlement.status}
																			</span>
																		</Show>
																	</div>
																	<p>
																		Teacher:{" "}
																		{registration.metadata?.teacherName ??
																			"Historical name unavailable"}
																	</p>
																	<Show when={registration.festivalClass}>
																		<p class="muted">
																			Ages{" "}
																			{registration.festivalClass?.minimumAge}–
																			{registration.festivalClass?.maximumAge}
																		</p>
																	</Show>
																	<Show
																		when={
																			registration.metadata?.repertoireJson
																				.length
																		}
																		fallback={
																			<p class="muted">
																				Repertoire details unavailable
																			</p>
																		}
																	>
																		<For
																			each={
																				registration.metadata?.repertoireJson
																			}
																		>
																			{(piece) => (
																				<p class="muted">
																					{piece.title} · {piece.composer}
																					{piece.movement
																						? ` · ${piece.movement}`
																						: ""}{" "}
																					·{" "}
																					{pieceDuration(piece.durationSeconds)}
																				</p>
																			)}
																		</For>
																	</Show>
																	<p class="muted">
																		Accompanist:{" "}
																		{registration.metadata
																			?.accompanistMembershipId
																			? "Registered accompanist"
																			: "Not required"}
																	</p>
																	<p class="muted small-copy">
																		{formatPaidAt(registration.paidAtIso)}
																	</p>
																</div>
																<div class="registration-row-actions">
																	<Show
																		when={canEdit(registration)}
																		fallback={
																			<>
																				<Button
																					type="button"
																					variant="secondary"
																					onClick={() =>
																						setSelectedId(
																							registration.entitlement.id,
																						)
																					}
																				>
																					View details
																				</Button>
																				<span class="muted small-copy">
																					{purchasedRegistrationReadOnlyReason(
																						registration,
																						now(),
																					)}
																				</span>
																			</>
																		}
																	>
																		<div class="registration-edit-action">
																			<Button
																				type="button"
																				variant="secondary"
																				onClick={() =>
																					setSelectedId(
																						registration.entitlement.id,
																					)
																				}
																			>
																				Edit
																			</Button>
																			<PurchasedRegistrationEditHelp
																				id={`registration-${registration.entitlement.id}-edit-help`}
																			/>
																		</div>
																		<span class="muted small-copy">
																			Edits close{" "}
																			{formatPurchasedCutoff(
																				registration.metadataEditCutoffIso,
																			)}
																		</span>
																	</Show>
																</div>
															</article>
														)}
													</For>
												</div>
											</details>
										)}
									</For>
								</Show>
							</>
						}
					>
						{(registration) => (
							<PurchasedRegistrationEditor
								slug={props.slug}
								registration={registration()}
								festival={festivalById().get(
									registration().entitlement.festivalId,
								)}
								divisionName={divisionName(registration())}
								csrfToken={session.csrfToken}
								onClose={() => setSelectedId("")}
								onRefresh={async () => {
									try {
										await reloadRegistrations();
									} catch {
										/* Keep the edit draft when a refresh fails. */
									}
								}}
								onSaved={async () => {
									try {
										await reloadRegistrations();
										setNotice("Registration details saved.");
									} catch {
										setNotice(
											"Registration details were saved. Refresh to see the updated list.",
										);
									}
									setSelectedId("");
								}}
							/>
						)}
					</Show>
				</div>
			)}
		</CustomerAccountPageLayout>
	);
}
