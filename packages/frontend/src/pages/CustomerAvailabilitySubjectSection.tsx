import type {
	AvailabilityHour,
	AvailabilitySubjectType,
	SubjectFestivalAvailability,
} from "@festival/common";
import { For } from "solid-js";
import {
	AVAILABILITY_HOURS,
	formatAvailabilityDateHeading,
	formatAvailabilityHourBlock,
	isSubjectHourAvailable,
} from "./customerAvailabilityHelpers.js";

export interface SubjectAvailabilitySectionProps {
	subject: SubjectFestivalAvailability;
	visibleDates: readonly string[];
	disabled?: boolean;
	onToggleHour: (
		subjectType: AvailabilitySubjectType,
		subjectId: string,
		date: string,
		hour: AvailabilityHour,
	) => void;
}

export function SubjectAvailabilitySection(
	props: SubjectAvailabilitySectionProps,
) {
	const headingId = () =>
		`availability-subject-${props.subject.subjectType}-${props.subject.subjectId}`;

	return (
		<section class="availability-subject-section" aria-labelledby={headingId()}>
			<header class="availability-subject-header">
				<h2 id={headingId()}>{props.subject.label}</h2>
				<span class="badge badge-neutral">
					{props.subject.subjectType === "accompanist"
						? "Accompanist"
						: "Performer"}
				</span>
			</header>
			<div class="availability-days-grid">
				<For each={props.visibleDates}>
					{(date) => (
						<div class="availability-day-column">
							<h3 class="availability-day-heading">
								{formatAvailabilityDateHeading(date)}
							</h3>
							<div class="availability-hours-stack">
								<For each={AVAILABILITY_HOURS}>
									{(hour) => {
										const available = () =>
											isSubjectHourAvailable(props.subject, date, hour);
										const label = () => formatAvailabilityHourBlock(hour);
										return (
											<button
												type="button"
												class="availability-hour-slot"
												classList={{
													"is-available": available(),
													"is-unavailable": !available(),
												}}
												aria-pressed={available()}
												aria-label={`${props.subject.label} ${date} ${label()} ${available() ? "Available" : "Unavailable"}`}
												disabled={props.disabled}
												onClick={() =>
													props.onToggleHour(
														props.subject.subjectType,
														props.subject.subjectId,
														date,
														hour,
													)
												}
											>
												<span class="availability-hour-time">{label()}</span>
												<span class="availability-hour-state">
													{available() ? "Available" : "Unavailable"}
												</span>
											</button>
										);
									}}
								</For>
							</div>
						</div>
					)}
				</For>
			</div>
		</section>
	);
}
