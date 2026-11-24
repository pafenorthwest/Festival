import {
	ADJUDICATOR_DAY_BUDGET_MINUTES,
	enumerateDateRange,
	FULL_DAY_LUNCH_MINUTES,
	isWednesdayDate,
	LONG_BREAK_MINUTES,
	PERFORMER_TRANSITION_SECONDS,
	type SchedulingConfiguration,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";

export function SchedulingDatesAndPoliciesSection(props: {
	config: SchedulingConfiguration;
	festivalStartDate: string;
	festivalEndDate: string;
	onUpdate: (patch: Partial<SchedulingConfiguration>) => void;
}) {
	const [newDate, setNewDate] = createSignal("");
	const wednesdayOptions = () =>
		props.config.festivalDates.filter((d) => isWednesdayDate(d));

	function addDate() {
		const candidate = newDate().trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return;
		if (props.config.festivalDates.includes(candidate)) {
			setNewDate("");
			return;
		}
		const festivalDates = [...props.config.festivalDates, candidate].sort();
		props.onUpdate({
			festivalDates,
			wednesdayDeadlineDate:
				props.config.wednesdayDeadlineDate ??
				(isWednesdayDate(candidate) ? candidate : null),
		});
		setNewDate("");
	}

	function removeDate(date: string) {
		const festivalDates = props.config.festivalDates.filter((d) => d !== date);
		props.onUpdate({
			festivalDates,
			wednesdayDeadlineDate:
				props.config.wednesdayDeadlineDate === date
					? (festivalDates.find((d) => isWednesdayDate(d)) ?? null)
					: props.config.wednesdayDeadlineDate,
		});
	}

	function resetToFestivalRange() {
		const festivalDates = enumerateDateRange(
			props.festivalStartDate,
			props.festivalEndDate,
		);
		props.onUpdate({
			festivalDates,
			wednesdayDeadlineDate:
				festivalDates.find((d) => isWednesdayDate(d)) ?? null,
		});
	}

	return (
		<section class="scheduling-section">
			<h3>Festival Dates &amp; Timing Policies</h3>
			<div class="scheduling-grid-2">
				<div class="scheduling-card">
					<h4>Festival scheduling dates</h4>
					<div class="scheduling-date-chips">
						<For
							each={props.config.festivalDates}
							fallback={<p class="muted">No scheduling dates selected.</p>}
						>
							{(date) => (
								<span class="scheduling-chip">
									<span>
										{date}
										{isWednesdayDate(date) ? " (Wed)" : ""}
									</span>
									<button
										type="button"
										aria-label={`Remove date ${date}`}
										onClick={() => removeDate(date)}
									>
										×
									</button>
								</span>
							)}
						</For>
					</div>
					<div class="scheduling-inline-row">
						<label>
							Add festival date
							<input
								type="date"
								aria-label="Add festival date"
								value={newDate()}
								onInput={(e) => setNewDate(e.currentTarget.value)}
							/>
						</label>
						<Button type="button" variant="secondary" onClick={addDate}>
							Add date
						</Button>
						<Button
							type="button"
							variant="secondary"
							onClick={resetToFestivalRange}
						>
							Use festival range
						</Button>
					</div>
					<label class="field" style="margin-top: 0.75rem;">
						<span>Concerto Wednesday deadline date</span>
						<input
							type="date"
							aria-label="Concerto Wednesday deadline date"
							value={props.config.wednesdayDeadlineDate ?? ""}
							onInput={(e) =>
								props.onUpdate({
									wednesdayDeadlineDate: e.currentTarget.value || null,
								})
							}
						/>
						<Show
							when={
								props.config.wednesdayDeadlineDate &&
								!isWednesdayDate(props.config.wednesdayDeadlineDate)
							}
						>
							<small class="scheduling-error-text">
								Selected deadline is not a Wednesday.
							</small>
						</Show>
						<Show when={wednesdayOptions().length > 0}>
							<small class="muted">
								Wednesdays in festival dates: {wednesdayOptions().join(", ")}
							</small>
						</Show>
					</label>
				</div>

				<div class="scheduling-card">
					<h4>Intervals, budget &amp; break windows</h4>
					<div class="scheduling-policy-readonly">
						<span>
							Performer transition:{" "}
							<strong>{PERFORMER_TRANSITION_SECONDS} sec</strong> (1.5 min
							fixed)
						</span>
						<span>
							Adjudicator-day budget:{" "}
							<strong>{ADJUDICATOR_DAY_BUDGET_MINUTES} min</strong> (fixed)
						</span>
						<span>
							Breaks outside budget: full day {FULL_DAY_LUNCH_MINUTES}m lunch +
							2×
							{LONG_BREAK_MINUTES}m; half day 1×{LONG_BREAK_MINUTES}m
						</span>
					</div>
					<div class="scheduling-inline-row">
						<label>
							Between-class / form gap (min)
							<input
								type="number"
								min="1"
								step="1"
								required
								aria-label="Between-class / form gap (min)"
								value={
									Number.isFinite(props.config.betweenClassGapMinutes)
										? props.config.betweenClassGapMinutes
										: ""
								}
								onInput={(e) =>
									props.onUpdate({
										betweenClassGapMinutes: e.currentTarget.valueAsNumber,
									})
								}
							/>
						</label>
						<label>
							Accompanist gap (min)
							<input
								type="number"
								min="1"
								step="1"
								required
								aria-label="Accompanist gap (min)"
								value={
									Number.isFinite(props.config.accompanistGapMinutes)
										? props.config.accompanistGapMinutes
										: ""
								}
								onInput={(e) =>
									props.onUpdate({
										accompanistGapMinutes: e.currentTarget.valueAsNumber,
									})
								}
							/>
						</label>
					</div>
					<div class="scheduling-window-times">
						<label>
							Morning break start
							<input
								type="time"
								aria-label="Morning break start"
								value={props.config.morningBreakWindowStart}
								onInput={(e) =>
									props.onUpdate({
										morningBreakWindowStart: e.currentTarget.value,
									})
								}
							/>
						</label>
						<label>
							Morning break end
							<input
								type="time"
								aria-label="Morning break end"
								value={props.config.morningBreakWindowEnd}
								onInput={(e) =>
									props.onUpdate({
										morningBreakWindowEnd: e.currentTarget.value,
									})
								}
							/>
						</label>
						<label>
							Lunch window start
							<input
								type="time"
								aria-label="Lunch window start"
								value={props.config.lunchWindowStart}
								onInput={(e) =>
									props.onUpdate({ lunchWindowStart: e.currentTarget.value })
								}
							/>
						</label>
						<label>
							Lunch window end
							<input
								type="time"
								aria-label="Lunch window end"
								value={props.config.lunchWindowEnd}
								onInput={(e) =>
									props.onUpdate({ lunchWindowEnd: e.currentTarget.value })
								}
							/>
						</label>
						<label>
							Afternoon break start
							<input
								type="time"
								aria-label="Afternoon break start"
								value={props.config.afternoonBreakWindowStart}
								onInput={(e) =>
									props.onUpdate({
										afternoonBreakWindowStart: e.currentTarget.value,
									})
								}
							/>
						</label>
						<label>
							Afternoon break end
							<input
								type="time"
								aria-label="Afternoon break end"
								value={props.config.afternoonBreakWindowEnd}
								onInput={(e) =>
									props.onUpdate({
										afternoonBreakWindowEnd: e.currentTarget.value,
									})
								}
							/>
						</label>
					</div>
				</div>
			</div>
		</section>
	);
}
