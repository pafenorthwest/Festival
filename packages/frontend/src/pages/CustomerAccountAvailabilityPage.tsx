import type {
	AvailabilityHour,
	AvailabilitySubjectType,
	FestivalSummary,
	SubjectFestivalAvailability,
} from "@festival/common";
import { createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	getCustomerFestivalAvailability,
	saveCustomerFestivalAvailability,
} from "../lib/availability-api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import { SubjectAvailabilitySection } from "./CustomerAvailabilitySubjectSection.js";
import {
	detectNarrowViewport,
	formatAvailabilityDateHeading,
	normalizeSubjectDaysForDates,
	toggleSubjectHourInList,
	toSaveSubjectsPayload,
} from "./customerAvailabilityHelpers.js";

export {
	detectNarrowViewport,
	formatAvailabilityDateHeading,
	normalizeSubjectDaysForDates,
	toggleSubjectHourInList,
	toSaveSubjectsPayload,
} from "./customerAvailabilityHelpers.js";

export function CustomerAccountAvailabilityPage(props: { slug: string }) {
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
	const [selectedFestivalId, setSelectedFestivalId] = createSignal<
		string | null
	>(null);
	const [dates, setDates] = createSignal<string[]>([]);
	const [subjects, setSubjects] = createSignal<SubjectFestivalAvailability[]>(
		[],
	);
	const [loading, setLoading] = createSignal(true);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const [status, setStatus] = createSignal("");
	const [singleDayMode, setSingleDayMode] = createSignal(
		detectNarrowViewport(),
	);
	const [currentDayIndex, setCurrentDayIndex] = createSignal(0);
	const [csrfToken, setCsrfToken] = createSignal("");

	onMount(() => {
		if (
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		) {
			return;
		}
		const media = window.matchMedia("(max-width: 768px)");
		const listener = (event: MediaQueryListEvent) => {
			setSingleDayMode(event.matches);
		};
		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", listener);
			onCleanup(() => media.removeEventListener("change", listener));
		}
	});

	function applyAvailabilityResponse(response: {
		festivals: FestivalSummary[];
		selectedFestivalId: string | null;
		dates: string[];
		subjects: SubjectFestivalAvailability[];
	}) {
		setFestivals(response.festivals);
		setSelectedFestivalId(response.selectedFestivalId);
		setDates(response.dates);
		setSubjects(
			response.subjects.map((subject) =>
				normalizeSubjectDaysForDates(subject, response.dates),
			),
		);
		setCurrentDayIndex((prev) =>
			response.dates.length === 0
				? 0
				: Math.min(prev, response.dates.length - 1),
		);
	}

	async function loadAvailability(festivalId?: string) {
		setLoading(true);
		setError("");
		setStatus("");
		try {
			const response = await getCustomerFestivalAvailability(
				props.slug,
				festivalId,
			);
			setCurrentDayIndex(0);
			applyAvailabilityResponse(response);
		} catch (reason) {
			setError(
				(reason as Error).message ||
					"Availability could not be loaded. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	}

	function handleToggleHour(
		subjectType: AvailabilitySubjectType,
		subjectId: string,
		date: string,
		hour: AvailabilityHour,
	) {
		setStatus("");
		setError("");
		setSubjects((current) =>
			toggleSubjectHourInList(current, subjectType, subjectId, date, hour),
		);
	}

	async function handleSave() {
		const festivalId = selectedFestivalId();
		if (!festivalId) return;
		setSaving(true);
		setError("");
		setStatus("");
		try {
			const response = await saveCustomerFestivalAvailability(
				props.slug,
				csrfToken(),
				{
					festivalId,
					subjects: toSaveSubjectsPayload(subjects()),
				},
			);
			applyAvailabilityResponse(response);
			setStatus("Availability saved.");
		} catch (reason) {
			setError(
				(reason as Error).message ||
					"Availability could not be saved. Please try again.",
			);
		} finally {
			setSaving(false);
		}
	}

	const visibleDates = () => {
		const allDates = dates();
		if (!singleDayMode() || allDates.length <= 1) {
			return allDates;
		}
		const safeIndex = Math.min(
			Math.max(0, currentDayIndex()),
			allDates.length - 1,
		);
		const day = allDates[safeIndex];
		return day ? [day] : [];
	};

	const selectedFestival = () =>
		festivals().find((item) => item.id === selectedFestivalId()) ?? null;

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={(session) => {
				setCsrfToken(session.csrfToken);
				void loadAvailability();
			}}
		>
			{() => (
				<>
					<h1>Availability</h1>
					<p class="muted">
						Select the hours each participant or accompanist is available during
						the festival. Hours from 8:00 a.m. to 5:00 p.m. default to
						available, and 5:00 p.m. to 6:00 p.m. defaults to unavailable.
					</p>

					<Show when={loading()}>
						<p role="status">Loading festival availability…</p>
					</Show>

					<Show when={!loading() && festivals().length === 0}>
						<p>No festivals are currently configured for this organization.</p>
					</Show>

					<Show when={!loading() && festivals().length === 1}>
						<Show when={selectedFestival()}>
							{(festival) => (
								<div class="availability-festival-banner">
									<h2>{festival().name}</h2>
									<p class="muted">
										{festival().startDate} to {festival().endDate}
									</p>
								</div>
							)}
						</Show>
					</Show>

					<Show when={!loading() && festivals().length > 1}>
						<label class="field availability-festival-selector">
							<span>Festival</span>
							<select
								aria-label="Festival"
								value={selectedFestivalId() ?? ""}
								onChange={(event) =>
									void loadAvailability(event.currentTarget.value)
								}
							>
								<For each={festivals()}>
									{(festival) => (
										<option value={festival.id}>
											{festival.name} ({festival.startDate} to{" "}
											{festival.endDate})
										</option>
									)}
								</For>
							</select>
						</label>
					</Show>

					<Show
						when={
							!loading() && festivals().length > 0 && subjects().length === 0
						}
					>
						<p class="availability-empty-subjects">
							Add a child on the Children page or activate an accompanist
							membership to manage festival availability.
						</p>
					</Show>

					<Show
						when={!loading() && subjects().length > 0 && dates().length > 0}
					>
						<div class="availability-toolbar">
							<Show when={dates().length > 1}>
								<Button
									type="button"
									variant="secondary"
									onClick={() => setSingleDayMode((current) => !current)}
								>
									{singleDayMode() ? "Show all days" : "Single-day view"}
								</Button>
							</Show>

							<Show when={singleDayMode() && dates().length > 1}>
								<fieldset class="availability-day-navigation">
									<legend class="sr-only">Festival day navigation</legend>
									<Button
										type="button"
										variant="secondary"
										disabled={currentDayIndex() <= 0}
										onClick={() =>
											setCurrentDayIndex((idx) => Math.max(0, idx - 1))
										}
									>
										Previous day
									</Button>
									<span class="availability-day-indicator" aria-live="polite">
										Day {currentDayIndex() + 1} of {dates().length}:{" "}
										{formatAvailabilityDateHeading(
											dates()[currentDayIndex()] ?? "",
										)}
									</span>
									<Button
										type="button"
										variant="secondary"
										disabled={currentDayIndex() >= dates().length - 1}
										onClick={() =>
											setCurrentDayIndex((idx) =>
												Math.min(dates().length - 1, idx + 1),
											)
										}
									>
										Next day
									</Button>
								</fieldset>
							</Show>
						</div>

						<div class="availability-subjects-list">
							<Index each={subjects()}>
								{(subject) => (
									<SubjectAvailabilitySection
										subject={subject()}
										visibleDates={visibleDates()}
										disabled={saving()}
										onToggleHour={handleToggleHour}
									/>
								)}
							</Index>
						</div>

						<div class="availability-actions">
							<Button
								type="button"
								disabled={saving()}
								onClick={() => void handleSave()}
							>
								{saving() ? "Saving…" : "Save availability"}
							</Button>
						</div>
					</Show>

					<Show when={status()}>
						{(message) => <p role="status">{message()}</p>}
					</Show>
					<Show when={error()}>
						{(message) => (
							<p class="error-text" role="alert">
								{message()}
							</p>
						)}
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
