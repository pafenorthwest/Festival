import { type Accessor, For, type Resource, type Setter, Show } from "solid-js";
import { Button } from "../../components/Button.js";
import type {
	CreateVolunteerShiftInput,
	VolunteerRole,
	VolunteerShift,
} from "../../lib/api.js";
import { addShiftsLabel, formatShiftDateLabel } from "./shiftDays.js";
import { VolunteerShiftDayPicker } from "./VolunteerShiftDayPicker.js";

export interface VolunteerShiftDayProps {
	availableDays: Accessor<string[]>;
	selectedDates: Accessor<string[]>;
	effectiveSelectedDates: Accessor<string[]>;
	matchingDates: Accessor<Set<string>>;
	pickerResetKey: Accessor<string>;
	minDate?: Accessor<string | undefined>;
	maxDate?: Accessor<string | undefined>;
	festivalStartDate?: Accessor<string | undefined>;
	festivalEndDate?: Accessor<string | undefined>;
	onToggleDate: (date: string) => void;
	onSelectAllDates: () => void;
	onClearDates: () => void;
	onAddExtraDate: (date: string) => string | null;
}

export interface VolunteerShiftsPanelProps extends VolunteerShiftDayProps {
	role: VolunteerRole;
	shifts: Resource<VolunteerShift[]>;
	shiftDraft: Accessor<CreateVolunteerShiftInput>;
	setShiftDraft: Setter<CreateVolunteerShiftInput>;
	editingShiftId: Accessor<string | null>;
	deletingShiftId: Accessor<string | null>;
	isCreatingShift: Accessor<boolean>;
	shiftFormError: Accessor<string | null>;
	onStartEditShift: (shift: VolunteerShift) => void;
	onCancelEditShift: () => void;
	onDeleteShift: (shift: VolunteerShift) => void;
	onSubmitShift: (event: Event) => void;
}

function VolunteerShiftsTable(props: {
	shifts: VolunteerShift[];
	festivalStartDate?: Accessor<string | undefined>;
	festivalEndDate?: Accessor<string | undefined>;
	deletingShiftId: Accessor<string | null>;
	onStartEditShift: (shift: VolunteerShift) => void;
	onDeleteShift: (shift: VolunteerShift) => void;
}) {
	return (
		<div class="listing-table volunteer-shifts-table">
			<div class="listing-table-header">
				<span>Date</span>
				<span>Details</span>
				<span>Actions</span>
			</div>
			<For each={props.shifts}>
				{(shift) => (
					<div class="listing-table-row">
						<span>
							<strong>
								{formatShiftDateLabel(
									shift.date,
									props.festivalStartDate?.(),
									props.festivalEndDate?.(),
								)}{" "}
								{shift.period}
							</strong>
						</span>
						<span>
							<Show when={shift.timeText}>
								<span>{shift.timeText}</span>
							</Show>
							<Show when={shift.division || shift.adjudicator}>
								<span>
									{shift.division} / {shift.adjudicator}
								</span>
							</Show>
						</span>
						<span class="listing-table-actions">
							<Button
								type="button"
								variant="secondary"
								onClick={() => props.onStartEditShift(shift)}
							>
								Edit
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={props.deletingShiftId() === shift.id}
								onClick={() => props.onDeleteShift(shift)}
							>
								{props.deletingShiftId() === shift.id ? "Deleting…" : "Delete"}
							</Button>
						</span>
					</div>
				)}
			</For>
		</div>
	);
}

function ShiftTextField(props: {
	label: string;
	type?: string;
	placeholder?: string;
	min?: string;
	max?: string;
	value: string;
	onInput: (value: string) => void;
}) {
	return (
		<label class="field">
			<span>{props.label}</span>
			<input
				type={props.type ?? "text"}
				placeholder={props.placeholder}
				min={props.min}
				max={props.max}
				value={props.value}
				onInput={(event) => props.onInput(event.currentTarget.value)}
			/>
		</label>
	);
}

function VolunteerShiftForm(
	props: VolunteerShiftDayProps & {
		isRoomProctor: boolean;
		shiftDraft: Accessor<CreateVolunteerShiftInput>;
		setShiftDraft: Setter<CreateVolunteerShiftInput>;
		editingShiftId: Accessor<string | null>;
		isCreatingShift: Accessor<boolean>;
		shiftFormError: Accessor<string | null>;
		onCancelEditShift: () => void;
		onSubmitShift: (event: Event) => void;
	},
) {
	const updateDraft = (patch: Partial<CreateVolunteerShiftInput>) =>
		props.setShiftDraft((current) => ({ ...current, ...patch }));

	return (
		<form class="flow-panel" onSubmit={props.onSubmitShift}>
			<h3>{props.editingShiftId() ? "Edit shift" : "Add a shift"}</h3>
			<Show when={props.isRoomProctor}>
				<p class="muted">
					This is a Room Proctor role, so each shift needs a Division and
					Adjudicator.
				</p>
			</Show>
			<Show
				when={props.editingShiftId()}
				fallback={
					<VolunteerShiftDayPicker
						days={props.availableDays}
						selected={props.effectiveSelectedDates}
						taken={props.matchingDates}
						disabled={props.isCreatingShift}
						resetKey={props.pickerResetKey}
						minDate={props.minDate}
						maxDate={props.maxDate}
						festivalStartDate={props.festivalStartDate}
						festivalEndDate={props.festivalEndDate}
						onToggle={props.onToggleDate}
						onSelectAll={props.onSelectAllDates}
						onClear={props.onClearDates}
						onAddDate={props.onAddExtraDate}
					/>
				}
			>
				<ShiftTextField
					label="Date"
					type="date"
					min={props.minDate?.()}
					max={props.maxDate?.()}
					value={props.shiftDraft().date}
					onInput={(date) => updateDraft({ date })}
				/>
			</Show>
			<label class="field">
				<span>Period</span>
				<select
					value={props.shiftDraft().period}
					onChange={(event) =>
						updateDraft({ period: event.currentTarget.value as "AM" | "PM" })
					}
				>
					<option value="AM">AM</option>
					<option value="PM">PM</option>
				</select>
			</label>
			<ShiftTextField
				label="Informational time (optional)"
				placeholder="9am - 4:30pm"
				value={props.shiftDraft().timeText ?? ""}
				onInput={(timeText) => updateDraft({ timeText })}
			/>
			<Show when={props.isRoomProctor}>
				<ShiftTextField
					label="Division"
					value={props.shiftDraft().division ?? ""}
					onInput={(division) => updateDraft({ division })}
				/>
				<ShiftTextField
					label="Adjudicator"
					value={props.shiftDraft().adjudicator ?? ""}
					onInput={(adjudicator) => updateDraft({ adjudicator })}
				/>
			</Show>
			<Show when={props.shiftFormError()}>
				<section class="banner error-banner">{props.shiftFormError()}</section>
			</Show>
			<Button
				type="submit"
				disabled={
					props.isCreatingShift() ||
					(!props.editingShiftId() &&
						props.effectiveSelectedDates().length === 0)
				}
			>
				{props.editingShiftId()
					? "Save changes"
					: addShiftsLabel(props.effectiveSelectedDates().length)}
			</Button>
			<Show when={props.editingShiftId()}>
				<Button
					type="button"
					variant="secondary"
					onClick={props.onCancelEditShift}
				>
					Cancel
				</Button>
			</Show>
		</form>
	);
}

export function VolunteerShiftsPanel(props: VolunteerShiftsPanelProps) {
	return (
		<section class="flow-panel">
			<h3>Shifts for {props.role.displayName}</h3>
			<Show when={props.shifts.loading}>
				<p>Loading shifts…</p>
			</Show>
			<Show when={props.shifts.error}>
				<p class="form-error" role="alert">
					Could not load shifts: {String(props.shifts.error)}
				</p>
			</Show>
			<Show
				when={
					!props.shifts.loading &&
					!props.shifts.error &&
					props.shifts()?.length === 0
				}
			>
				<p>No shifts have been created for this role yet.</p>
			</Show>
			<Show
				when={
					!props.shifts.loading && !props.shifts.error && props.shifts()?.length
				}
			>
				<VolunteerShiftsTable
					shifts={props.shifts() ?? []}
					festivalStartDate={props.festivalStartDate}
					festivalEndDate={props.festivalEndDate}
					deletingShiftId={props.deletingShiftId}
					onStartEditShift={props.onStartEditShift}
					onDeleteShift={props.onDeleteShift}
				/>
			</Show>
			<VolunteerShiftForm
				availableDays={props.availableDays}
				selectedDates={props.selectedDates}
				effectiveSelectedDates={props.effectiveSelectedDates}
				matchingDates={props.matchingDates}
				pickerResetKey={props.pickerResetKey}
				minDate={props.minDate}
				maxDate={props.maxDate}
				festivalStartDate={props.festivalStartDate}
				festivalEndDate={props.festivalEndDate}
				onToggleDate={props.onToggleDate}
				onSelectAllDates={props.onSelectAllDates}
				onClearDates={props.onClearDates}
				onAddExtraDate={props.onAddExtraDate}
				isRoomProctor={props.role.isRoomProctor}
				shiftDraft={props.shiftDraft}
				setShiftDraft={props.setShiftDraft}
				editingShiftId={props.editingShiftId}
				isCreatingShift={props.isCreatingShift}
				shiftFormError={props.shiftFormError}
				onCancelEditShift={props.onCancelEditShift}
				onSubmitShift={props.onSubmitShift}
			/>
		</section>
	);
}
