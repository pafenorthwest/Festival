import { type Accessor, createSignal, For, Show } from "solid-js";
import { formatScheduleDate } from "../../app/appFormatting.js";
import { Button } from "../../components/Button.js";

export interface VolunteerShiftDayPickerProps {
	days: Accessor<string[]>;
	selected: Accessor<string[]>;
	/** Days where this role already has an identical shift. */
	taken: Accessor<Set<string>>;
	disabled: Accessor<boolean>;
	onToggle: (date: string) => void;
	onSelectAll: () => void;
	onClear: () => void;
	/** Returns a message when the date cannot be added. */
	onAddDate: (date: string) => string | null;
}

export function VolunteerShiftDayPicker(props: VolunteerShiftDayPickerProps) {
	const [extraDate, setExtraDate] = createSignal("");
	const [extraError, setExtraError] = createSignal<string | null>(null);

	function addExtraDate() {
		const error = props.onAddDate(extraDate());
		setExtraError(error);
		if (!error) setExtraDate("");
	}

	return (
		<fieldset class="field volunteer-shift-days" disabled={props.disabled()}>
			<legend>Days</legend>
			<Show when={props.days().length === 0}>
				<p class="muted">
					This festival has no dates set. Add the days you need below.
				</p>
			</Show>
			<div class="volunteer-shift-day-grid">
				<For each={props.days()}>
					{(day) => {
						const isTaken = () => props.taken().has(day);
						return (
							<label class="field-checkbox">
								<input
									type="checkbox"
									checked={props.selected().includes(day)}
									disabled={isTaken()}
									onChange={() => props.onToggle(day)}
								/>
								<span>
									{formatScheduleDate(day)}
									<Show when={isTaken()}>
										<span class="muted"> (already added)</span>
									</Show>
								</span>
							</label>
						);
					}}
				</For>
			</div>
			<div class="volunteer-shift-day-actions">
				<Button type="button" variant="secondary" onClick={props.onSelectAll}>
					Select all
				</Button>
				<Button type="button" variant="secondary" onClick={props.onClear}>
					Clear
				</Button>
				<span class="muted" role="status">
					{props.selected().length === 0
						? "No days selected"
						: `${props.selected().length} ${props.selected().length === 1 ? "day" : "days"} selected`}
				</span>
			</div>
			<div class="volunteer-shift-day-actions">
				<label class="field">
					<span>Add another date</span>
					<input
						type="date"
						value={extraDate()}
						onInput={(event) => {
							setExtraDate(event.currentTarget.value);
							setExtraError(null);
						}}
						onKeyDown={(event) => {
							// Enter must add the date, not submit the whole form.
							if (event.key === "Enter") {
								event.preventDefault();
								addExtraDate();
							}
						}}
					/>
				</label>
				<Button type="button" variant="secondary" onClick={addExtraDate}>
					Add date
				</Button>
			</div>
			<Show when={extraError()}>
				{(message) => (
					<p class="field-error" role="alert">
						{message()}
					</p>
				)}
			</Show>
		</fieldset>
	);
}
