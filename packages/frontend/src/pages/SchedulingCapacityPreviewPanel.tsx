import type { SchedulingConfigurationPreview } from "@festival/common";
import { For, Show } from "solid-js";

function formatMinutes(seconds: number): string {
	const rem = seconds % 60;
	return `${Math.floor(seconds / 60)}m${rem ? ` ${rem}s` : ""}`;
}

export function SchedulingCapacityPreviewPanel(props: {
	preview: SchedulingConfigurationPreview;
}) {
	return (
		<section class="scheduling-section">
			<h3>Capacity &amp; Effective Rules Preview (Live Before Save)</h3>
			<div class="scheduling-summary-grid">
				<div class="scheduling-stat-card">
					<span class="muted">Total usable room/adjudicator time</span>
					<strong>{props.preview.totals.totalUsableMinutes} min</strong>
					<small class="muted">
						Across {props.preview.totals.totalWindows} window(s) (raw{" "}
						{props.preview.totals.totalRawMinutes} min)
					</small>
				</div>
				<div class="scheduling-stat-card">
					<span class="muted">Wednesday Concerto usable time</span>
					<strong>
						{props.preview.totals.wednesdayConcertoUsableMinutes} min
					</strong>
				</div>
				<div class="scheduling-stat-card">
					<span class="muted">Mapped class rules</span>
					<strong>{props.preview.totals.configuredClassCount}</strong>
					<small class="muted">
						Unmapped active catalog classes:{" "}
						{props.preview.totals.unmappedActiveClassCount}
					</small>
				</div>
			</div>

			<Show when={props.preview.blockingIssues.length > 0}>
				<section
					class="scheduling-card scheduling-alert-box"
					aria-label="Configuration blocking issues"
				>
					<h4>Blocking setup issues ({props.preview.blockingIssues.length})</h4>
					<ul class="scheduling-issue-list">
						<For each={props.preview.blockingIssues}>
							{(issue) => (
								<li class="scheduling-error-text">{issue.message}</li>
							)}
						</For>
					</ul>
				</section>
			</Show>

			<Show when={props.preview.warnings.length > 0}>
				<section
					class="scheduling-card scheduling-warning-box"
					aria-label="Configuration warnings"
				>
					<h4>Warnings ({props.preview.warnings.length})</h4>
					<ul class="scheduling-issue-list">
						<For each={props.preview.warnings}>
							{(issue) => <li>{issue.message}</li>}
						</For>
					</ul>
				</section>
			</Show>

			<Show when={props.preview.effectiveClassRules.length > 0}>
				<h4>Effective values by class code</h4>
				<div class="classes-table-scroll">
					<table class="scheduling-rules">
						<thead>
							<tr>
								<th>Code</th>
								<th>Catalog class</th>
								<th>Per entry (Play + Oral + 90s)</th>
								<th>Effective section size</th>
								<th>Section duration</th>
								<th>Placement group</th>
								<th>Capacity estimate</th>
								<th>Compatible windows</th>
							</tr>
						</thead>
						<tbody>
							<For each={props.preview.effectiveClassRules}>
								{(row) => (
									<tr>
										<td>
											<strong>{row.code}</strong>
											<Show when={row.isWednesdayDeadline}>
												<small>Wed deadline</small>
											</Show>
										</td>
										<td>{row.catalogName}</td>
										<td>
											{row.isAdditionalParticipant
												? "0m (shared)"
												: `${row.playingMinutes}m + ${row.oralMinutes}m + 1.5m = ${formatMinutes(row.perEntrySeconds)}`}
										</td>
										<td>
											{row.isAdditionalParticipant
												? "Primary section"
												: `${row.effectiveSectionLimits.min}–${row.effectiveSectionLimits.max} (${row.effectiveSectionLimits.isOverride ? "Override" : "Default"})`}
										</td>
										<td>
											{row.isAdditionalParticipant
												? "0m"
												: `${formatMinutes(row.minSectionSeconds)} – ${formatMinutes(row.maxSectionSeconds)}`}
										</td>
										<td>{row.placementGroupLabel}</td>
										<td>
											{row.capacity} entries →{" "}
											{formatMinutes(row.estimatedTotalSecondsAtCapacity)}
											<Show when={row.exceedsSingleDayBudgetAtCapacity}>
												<small class="scheduling-error-text">
													Exceeds 440m day budget
												</small>
											</Show>
										</td>
										<td>
											{row.compatibleWindowCount}
											<Show when={row.isWednesdayDeadline}>
												<small>
													Wed eligible: {row.eligibleWednesdayWindowCount}
												</small>
											</Show>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</Show>
		</section>
	);
}
