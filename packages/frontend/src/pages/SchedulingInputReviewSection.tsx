import { formatDurationSeconds } from "@festival/common";
import { createSignal, For, type JSX, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { ApiError, type SchedulingReadinessResponse } from "../lib/api.js";
import type {
	SchedulingEditorState,
	SchedulingSaveFn,
} from "./SchedulingEditorState.js";
import { SchedulingIssueList } from "./SchedulingIssueList.js";
import { SchedulingReviewAvailabilityTable } from "./SchedulingReviewAvailabilityTable.js";
import { SchedulingReviewEntriesTable } from "./SchedulingReviewEntriesTable.js";
import { formatServerSchedulingIssue } from "./SchedulingValidationIssues.js";
import {
	readinessErrorMessage,
	updateEnsemblePairings,
} from "./schedulingReviewHelpers.js";

export interface SchedulingReadinessView {
	loading: () => boolean;
	error: () => unknown;
	data: () => SchedulingReadinessResponse | undefined;
}

/** Loading / error / refresh frame shared by Input review and Generate. */
export function SchedulingReadinessFrame(props: {
	state: SchedulingEditorState;
	readiness: SchedulingReadinessView;
	refresh: () => void;
	children: (loaded: SchedulingReadinessResponse) => JSX.Element;
}) {
	return (
		<>
			<div class="scheduling-review-toolbar">
				<Show when={props.readiness.data()}>
					{(loaded) => (
						<p class="scheduling-meta-line">
							Readiness computed from configuration revision{" "}
							{loaded().configRevision}.
						</p>
					)}
				</Show>
				<Button
					type="button"
					variant="secondary"
					disabled={props.readiness.loading()}
					onClick={props.refresh}
				>
					{props.readiness.loading() ? "Refreshing…" : "Refresh"}
				</Button>
			</div>
			<Show when={props.state.changed()}>
				<p class="muted" role="note">
					Review reflects saved revision {props.state.saved().revision}; unsaved
					Setup edits are not included.
				</p>
			</Show>
			<Show when={props.readiness.error()}>
				{(cause) => <p role="alert">{readinessErrorMessage(cause())}</p>}
			</Show>
			<Show
				when={props.readiness.data()}
				keyed
				fallback={
					<Show when={props.readiness.loading()}>
						<p role="status">Loading scheduling readiness…</p>
					</Show>
				}
			>
				{(loaded) => props.children(loaded)}
			</Show>
		</>
	);
}

function StatCard(props: { label: string; value: string | number }) {
	return (
		<div class="scheduling-stat-card">
			<span class="muted">{props.label}</span>
			<strong>{props.value}</strong>
		</div>
	);
}

export function SchedulingInputReviewSection(props: {
	state: SchedulingEditorState;
	readiness: SchedulingReadinessView;
	refresh: () => void;
	save: SchedulingSaveFn;
	reload: () => void;
}) {
	const [pairingError, setPairingError] = createSignal("");
	const [pairingNotice, setPairingNotice] = createSignal("");
	const state = props.state;
	const pairingLocked = () =>
		state.changed() || state.saving() || state.stale();

	async function savePairing(
		additionalId: string,
		primaryId: string | null,
	): Promise<void> {
		setPairingNotice("");
		if (state.changed()) {
			setPairingError(
				"Save your Setup edits first; ensemble pairings are saved against the latest saved revision.",
			);
			return;
		}
		if (state.saving() || state.stale()) return;
		const current = state.saved();
		const config = {
			...current.config,
			ensemblePairings: updateEnsemblePairings(
				current.config.ensemblePairings,
				additionalId,
				primaryId,
			),
		};
		state.setSaving(true);
		setPairingError("");
		try {
			const result = await props.save(current.revision, config);
			state.setSaved(result);
			state.setDraft(structuredClone(result.config));
			setPairingNotice(
				`${primaryId ? "Paired" : "Cleared pairing for"} ${additionalId}. Saved revision ${result.revision}.`,
			);
		} catch (cause) {
			if (cause instanceof ApiError && cause.status === 409) {
				state.setStale(true);
				setPairingError(
					"Another editor saved a newer revision. Reload the saved configuration before changing pairings.",
				);
			} else if (cause instanceof ApiError && cause.status === 400) {
				const issue = formatServerSchedulingIssue(cause);
				setPairingError(
					issue.path ? `${issue.path}: ${issue.message}` : issue.message,
				);
			} else {
				setPairingError(
					cause instanceof Error
						? cause.message
						: "Could not save the ensemble pairing.",
				);
			}
		} finally {
			state.setSaving(false);
		}
	}

	return (
		<div class="scheduling-card scheduling-review">
			<h3>Input review</h3>
			<SchedulingReadinessFrame
				state={state}
				readiness={props.readiness}
				refresh={props.refresh}
			>
				{(loaded) => {
					const r = loaded.readiness;
					return (
						<>
							<div class="scheduling-summary-grid">
								<StatCard
									label="Scheduling entries"
									value={r.totals.entryCount}
								/>
								<StatCard
									label="Additional participants"
									value={r.totals.participantCount}
								/>
								<StatCard
									label="Estimated total"
									value={formatDurationSeconds(r.totals.estimatedSeconds)}
								/>
								<StatCard
									label="Wednesday concerto estimate"
									value={formatDurationSeconds(
										r.totals.wednesdayConcertoEstimatedSeconds,
									)}
								/>
								<StatCard
									label="Generation"
									value={r.canGenerate ? "Can generate" : "Cannot generate"}
								/>
							</div>

							<SchedulingIssueList
								title="Blocking issues"
								issues={r.blockingIssues}
								tone="error"
								ariaLabel="Readiness blocking issues"
							/>
							<SchedulingIssueList
								title="Warnings"
								issues={r.warnings}
								tone="warning"
								ariaLabel="Readiness warnings"
							/>

							<section class="scheduling-section">
								<h4>Demand by class code</h4>
								<Show
									when={r.perCode.length > 0}
									fallback={<p class="muted">No mapped class codes.</p>}
								>
									<div class="classes-table-scroll">
										<table class="scheduling-rules">
											<thead>
												<tr>
													<th>Code</th>
													<th>Entries</th>
													<th>Participants</th>
													<th>Section size</th>
													<th>Sections</th>
													<th>Feasible</th>
													<th>Estimated time</th>
												</tr>
											</thead>
											<tbody>
												<For each={r.perCode}>
													{(row) => (
														<tr>
															<td>
																<strong>{row.code}</strong>
															</td>
															<td>{row.entryCount}</td>
															<td>{row.participantCount}</td>
															<td>
																{row.limits.min}–{row.limits.max}
															</td>
															<td>
																{row.entryCount === 0
																	? "—"
																	: `${row.minSections}–${row.maxSections}`}
															</td>
															<td>
																<span
																	class={`badge ${row.feasible ? "badge-active" : "badge-rejected"}`}
																>
																	{row.feasible ? "Feasible" : "Infeasible"}
																</span>
															</td>
															<td>
																{formatDurationSeconds(row.estimatedSeconds)}
															</td>
														</tr>
													)}
												</For>
											</tbody>
										</table>
									</div>
								</Show>
							</section>

							<section class="scheduling-section">
								<h4>Confirmed entries</h4>
								<Show when={state.changed()}>
									<p class="muted">
										Ensemble pairing is disabled while Setup has unsaved edits.
										Save or reload Setup first.
									</p>
								</Show>
								<SchedulingReviewEntriesTable
									entries={r.entries}
									pairings={state.saved().config.ensemblePairings}
									disabled={pairingLocked()}
									onPair={(additionalId, primaryId) =>
										void savePairing(additionalId, primaryId)
									}
								/>
								<Show when={pairingError()}>
									<p role="alert">{pairingError()}</p>
								</Show>
								<Show when={state.stale()}>
									<Button
										type="button"
										variant="secondary"
										onClick={props.reload}
									>
										Reload saved configuration
									</Button>
								</Show>
								<p role="status">{pairingNotice()}</p>
							</section>

							<section class="scheduling-section">
								<h4>Availability</h4>
								<SchedulingReviewAvailabilityTable people={r.people} />
							</section>
						</>
					);
				}}
			</SchedulingReadinessFrame>
		</div>
	);
}
