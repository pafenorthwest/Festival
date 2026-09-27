import { For, Show } from "solid-js";
import type { VolunteerScheduleEntry } from "../lib/api.js";
import { Button } from "./Button.js";

export interface VolunteerMyShiftsSectionProps {
	schedule: VolunteerScheduleEntry[] | undefined;
	loading: boolean;
	onCancelShift: (assignmentId: string) => Promise<void>;
	cancelingId: string | null;
}

export function VolunteerMyShiftsSection(props: VolunteerMyShiftsSectionProps) {
	return (
		<section class="flow-panel">
			<h3>My Shifts</h3>
			<Show when={props.loading}>
				<p>Loading your schedule…</p>
			</Show>
			<Show
				when={
					!props.loading && (!props.schedule || props.schedule.length === 0)
				}
			>
				<p class="muted">You have no booked shifts yet.</p>
			</Show>
			<Show when={props.schedule && props.schedule.length > 0}>
				<div class="listing-table volunteer-schedule-table">
					<div class="listing-table-header">
						<span>Date & Period</span>
						<span>Role</span>
						<span>Actions</span>
					</div>
					<For each={props.schedule}>
						{(entry) => (
							<div class="listing-table-row">
								<span>
									<strong>{entry.shift.date}</strong> ({entry.shift.period})
									<Show when={entry.shift.timeText}>
										<span class="muted"> — {entry.shift.timeText}</span>
									</Show>
									<Show when={entry.shift.division || entry.shift.adjudicator}>
										<span class="muted">
											{" "}
											— {entry.shift.division} / {entry.shift.adjudicator}
										</span>
									</Show>
								</span>
								<span>
									<strong>{entry.role.displayName}</strong>
								</span>
								<span class="listing-table-actions">
									<Button
										type="button"
										variant="secondary"
										disabled={props.cancelingId === entry.assignment.id}
										onClick={() => props.onCancelShift(entry.assignment.id)}
									>
										{props.cancelingId === entry.assignment.id
											? "Canceling…"
											: "Cancel Shift"}
									</Button>
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</section>
	);
}
