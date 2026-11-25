import type {
	SchedulingEnsemblePairing,
	SchedulingReadinessEntry,
} from "@festival/common";
import { For, Show } from "solid-js";
import { buildPairingOptions } from "./schedulingReviewHelpers.js";

function EnsembleCell(props: {
	entry: SchedulingReadinessEntry;
	entries: readonly SchedulingReadinessEntry[];
	pairings: readonly SchedulingEnsemblePairing[];
	disabled: boolean;
	onPair: (additionalId: string, primaryId: string | null) => void;
}) {
	const configured = () =>
		props.pairings.find(
			(pairing) =>
				pairing.additionalEntitlementId === props.entry.entitlementId,
		)?.primaryEntitlementId ?? null;
	const options = () =>
		buildPairingOptions(props.entry, props.entries, configured());

	return (
		<Show
			when={props.entry.role === "additional"}
			fallback={
				<Show
					when={props.entry.participantEntitlementIds.length > 0}
					fallback="—"
				>
					Primary · participants:{" "}
					{props.entry.participantEntitlementIds.join(", ")}
				</Show>
			}
		>
			<Show
				when={props.entry.primaryEntitlementId}
				fallback={
					<div class="scheduling-pairing-control">
						<select
							aria-label={`Primary ensemble entry for ${props.entry.entitlementId}`}
							value={configured() ?? ""}
							disabled={props.disabled}
							onChange={(event) =>
								props.onPair(
									props.entry.entitlementId,
									event.currentTarget.value || null,
								)
							}
						>
							<option value="">
								{options().length > 0
									? "Select primary entry…"
									: "No matching primary entries"}
							</option>
							<For each={options()}>
								{(option) => (
									<option value={option.value}>{option.label}</option>
								)}
							</For>
						</select>
						<Show when={configured()}>
							<button
								type="button"
								class="link-button"
								disabled={props.disabled}
								onClick={() => props.onPair(props.entry.entitlementId, null)}
							>
								Clear pairing
							</button>
						</Show>
					</div>
				}
			>
				{(primaryId) => (
					<div class="scheduling-pairing-control">
						<span>Paired with {primaryId()}</span>
						<button
							type="button"
							class="link-button"
							disabled={props.disabled}
							onClick={() => props.onPair(props.entry.entitlementId, null)}
						>
							Clear pairing
						</button>
					</div>
				)}
			</Show>
		</Show>
	);
}

export function SchedulingReviewEntriesTable(props: {
	entries: readonly SchedulingReadinessEntry[];
	pairings: readonly SchedulingEnsemblePairing[];
	disabled: boolean;
	onPair: (additionalId: string, primaryId: string | null) => void;
}) {
	return (
		<Show
			when={props.entries.length > 0}
			fallback={<p class="muted">No confirmed registrations yet.</p>}
		>
			<div class="classes-table-scroll">
				<table class="scheduling-rules">
					<caption class="sr-only">Confirmed scheduling entries</caption>
					<thead>
						<tr>
							<th>Registration ID</th>
							<th>Code</th>
							<th>Student</th>
							<th>Age</th>
							<th>Teacher</th>
							<th>Accompanist</th>
							<th>Ensemble</th>
						</tr>
					</thead>
					<tbody>
						<For each={props.entries}>
							{(entry) => (
								<tr>
									<td>
										<code>{entry.entitlementId}</code>
									</td>
									<td>
										{entry.code ?? (
											<span class="scheduling-error-text">Unmapped</span>
										)}
									</td>
									<td>{entry.childName}</td>
									<td>
										{entry.age ?? "—"}
										<Show when={entry.hasAge12Plus}>
											{" "}
											<span class="badge badge-neutral">12+</span>
										</Show>
									</td>
									<td>{entry.teacher?.name ?? "—"}</td>
									<td>
										{entry.accompanist
											? (entry.accompanist.name ??
												entry.accompanist.membershipId)
											: "—"}
									</td>
									<td>
										<EnsembleCell
											entry={entry}
											entries={props.entries}
											pairings={props.pairings}
											disabled={props.disabled}
											onPair={props.onPair}
										/>
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
