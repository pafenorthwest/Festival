import { For, Show } from "solid-js";
import { formatScheduleDate } from "../app/appFormatting.js";
import type { VolunteerRole, VolunteerShiftListing } from "../lib/api.js";
import { Button } from "./Button.js";

export interface VolunteerAvailableShiftsSectionProps {
	shiftsByRole: Array<{ role: VolunteerRole; shifts: VolunteerShiftListing[] }>;
	loading: boolean;
	selectedShiftIds: string[];
	onToggleShift: (shiftId: string) => void;
	onBookShifts: () => Promise<void>;
	isBooking: boolean;
}

export function VolunteerAvailableShiftsSection(
	props: VolunteerAvailableShiftsSectionProps,
) {
	return (
		<section class="flow-panel">
			<h3>Available Shifts</h3>
			<Show when={props.loading}>
				<p>Loading available shifts…</p>
			</Show>
			<Show when={!props.loading && props.shiftsByRole.length === 0}>
				<p class="muted">No shifts are currently available for sign up.</p>
			</Show>
			<For each={props.shiftsByRole}>
				{(group) => (
					<div class="panel flow-panel">
						<header>
							<h4>{group.role.displayName}</h4>
							<p class="muted">{group.role.description}</p>
							<Show when={group.role.detailsUrl}>
								<p>
									<a
										href={group.role.detailsUrl ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
									>
										Role Details
									</a>
								</p>
							</Show>
						</header>
						<div class="listing-table volunteer-available-table">
							<div class="listing-table-header">
								<span>Select</span>
								<span>Date & Period</span>
								<span>Details</span>
							</div>
							<For each={group.shifts}>
								{(shift) => (
									<div class="listing-table-row">
										<span>
											<label class="field-checkbox">
												<input
													type="checkbox"
													checked={props.selectedShiftIds.includes(shift.id)}
													onChange={() => props.onToggleShift(shift.id)}
												/>
											</label>
										</span>
										<span>
											<strong>{formatScheduleDate(shift.date)}</strong> (
											{shift.period})
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
									</div>
								)}
							</For>
						</div>
					</div>
				)}
			</For>
			<Show when={props.shiftsByRole.length > 0}>
				<div class="volunteer-signup-actions">
					<Button
						type="button"
						disabled={props.isBooking || props.selectedShiftIds.length === 0}
						onClick={props.onBookShifts}
					>
						{props.isBooking
							? "Confirming…"
							: props.selectedShiftIds.length > 0
								? `Confirm Shifts (${props.selectedShiftIds.length})`
								: "Sign Up for Shifts"}
					</Button>
				</div>
			</Show>
		</section>
	);
}
