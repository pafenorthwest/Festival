import type { SchedulingReadinessPerson } from "@festival/common";
import { For, Show } from "solid-js";
import {
	availabilityEnforcementLabel,
	formatAvailabilityHours,
} from "./schedulingReviewHelpers.js";

export function SchedulingReviewAvailabilityTable(props: {
	people: readonly SchedulingReadinessPerson[];
}) {
	return (
		<Show
			when={props.people.length > 0}
			fallback={<p class="muted">No students or accompanists to review.</p>}
		>
			<p class="muted">
				Stated availability constrains placement only for people available on at
				least three festival days. Days without saved availability use the
				default hours.
			</p>
			<div class="classes-table-scroll">
				<table class="scheduling-rules">
					<caption class="sr-only">
						Student and accompanist availability
					</caption>
					<thead>
						<tr>
							<th>Person</th>
							<th>Role</th>
							<th>Available days</th>
							<th>Hours by day</th>
							<th>Three-day rule</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.people}>
							{(person) => (
								<tr>
									<td>
										{person.name ?? <code>{person.subjectId}</code>}
										<small class="muted scheduling-review-ids">
											{person.entitlementIds.join(", ")}
										</small>
									</td>
									<td>
										{person.role === "student" ? "Student" : "Accompanist"}
									</td>
									<td>{person.availableDayCount}</td>
									<td>
										<ul class="scheduling-availability-days">
											<For each={person.days}>
												{(day) => (
													<li>
														<strong>{day.date}</strong>:{" "}
														{formatAvailabilityHours(day.availableHours)}{" "}
														<span
															class={`badge ${day.provenance === "saved" ? "badge-processing" : "badge-neutral"}`}
														>
															{day.provenance === "saved" ? "Saved" : "Default"}
														</span>
													</li>
												)}
											</For>
										</ul>
									</td>
									<td>
										<span
											class={`badge ${person.enforced ? "badge-active" : "badge-inactive"}`}
										>
											{availabilityEnforcementLabel(person)}
										</span>
									</td>
								</tr>
							)}
						</For>
					</tbody>
				</table>
			</div>
		</Show>
	);
}
