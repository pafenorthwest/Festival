import { type Accessor, For, type Resource, type Setter, Show } from "solid-js";
import { formatScheduleDate } from "../../app/appFormatting.js";
import type { VolunteerCoverageGapsResponse } from "../../lib/api.js";

type CoverageSlot = VolunteerCoverageGapsResponse["slots"][number];

export interface VolunteerCoverageGapsPanelProps {
	coverageGaps: Resource<VolunteerCoverageGapsResponse>;
	slotStatusFilter: Accessor<"all" | "Filled" | "Open">;
	setSlotStatusFilter: Setter<"all" | "Filled" | "Open">;
	filteredSlots: Accessor<CoverageSlot[]>;
}

function CoverageMetricsBar(props: {
	gaps: VolunteerCoverageGapsResponse;
	slotStatusFilter: Accessor<"all" | "Filled" | "Open">;
	setSlotStatusFilter: Setter<"all" | "Filled" | "Open">;
}) {
	return (
		<div class="coverage-metrics">
			<button
				type="button"
				class="badge badge-neutral coverage-metrics-filter"
				aria-pressed={props.slotStatusFilter() === "all"}
				onClick={() => props.setSlotStatusFilter("all")}
			>
				Total Shifts: {props.gaps.totalShifts}
			</button>
			<button
				type="button"
				class="badge badge-active coverage-metrics-filter"
				aria-pressed={props.slotStatusFilter() === "Filled"}
				onClick={() => props.setSlotStatusFilter("Filled")}
			>
				Filled Shifts: {props.gaps.filledShifts ?? props.gaps.coveredShifts}
			</button>
			<button
				type="button"
				class="badge badge-rejected coverage-metrics-filter"
				aria-pressed={props.slotStatusFilter() === "Open"}
				onClick={() => props.setSlotStatusFilter("Open")}
			>
				Open Shifts: {props.gaps.openShifts ?? props.gaps.unfilledShifts}
			</button>
			<span class="badge badge-processing">
				Coverage Percentage: {props.gaps.coveragePercentage}%
			</span>
		</div>
	);
}

function CoverageSlotsTable(props: { slots: CoverageSlot[] }) {
	return (
		<div class="listing-table coverage-slots-table">
			<div class="listing-table-header">
				<span>Role</span>
				<span>Date</span>
				<span>Period</span>
				<span>Location</span>
				<span>Status</span>
			</div>
			<For each={props.slots}>
				{(slot) => (
					<div class="listing-table-row">
						<span>
							<strong>{slot.roleDisplayName}</strong>
						</span>
						<span>{formatScheduleDate(slot.date)}</span>
						<span>
							{slot.period}
							<Show when={slot.timeText}>
								<span class="muted"> ({slot.timeText})</span>
							</Show>
						</span>
						<span>
							{slot.division
								? `${slot.division}${slot.adjudicator ? ` (${slot.adjudicator})` : ""}`
								: "—"}
						</span>
						<span>
							<span
								class={`badge ${slot.status === "Filled" ? "badge-active" : "badge-rejected"}`}
							>
								{slot.status}
							</span>
						</span>
					</div>
				)}
			</For>
		</div>
	);
}

export function VolunteerCoverageGapsPanel(
	props: VolunteerCoverageGapsPanelProps,
) {
	return (
		<section class="flow-panel coverage-gaps-panel">
			<h3>Volunteer Shift Coverage</h3>
			<Show when={props.coverageGaps.loading}>
				<p>Loading shift coverage…</p>
			</Show>
			<Show when={props.coverageGaps.error}>
				<section class="banner error-banner">
					Could not load shift coverage: {String(props.coverageGaps.error)}
				</section>
			</Show>
			<Show when={props.coverageGaps()}>
				{(gaps) => (
					<>
						<CoverageMetricsBar
							gaps={gaps()}
							slotStatusFilter={props.slotStatusFilter}
							setSlotStatusFilter={props.setSlotStatusFilter}
						/>
						<Show
							when={props.filteredSlots().length > 0}
							fallback={
								<p class="muted">
									{props.slotStatusFilter() === "all"
										? "No shifts have been created for this festival yet."
										: `No ${props.slotStatusFilter().toLowerCase()} shifts match this filter.`}
								</p>
							}
						>
							<CoverageSlotsTable slots={props.filteredSlots()} />
						</Show>
					</>
				)}
			</Show>
		</section>
	);
}
