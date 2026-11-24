import type {
	OrganizationDivision,
	SchedulingAdjudicator,
} from "@festival/common";
import { For, Index, Show } from "solid-js";
import { Button } from "../components/Button.js";

export function SchedulingAdjudicatorsSection(props: {
	adjudicators: SchedulingAdjudicator[];
	divisions: OrganizationDivision[];
	onChange: (adjudicators: SchedulingAdjudicator[]) => void;
}) {
	function addAdjudicator() {
		const id =
			typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? `adj-${crypto.randomUUID().slice(0, 8)}`
				: `adj-${Date.now()}`;
		props.onChange([
			...props.adjudicators,
			{ id, name: "", eligibleDivisionIds: [] },
		]);
	}

	function updateAdjudicator(
		index: number,
		patch: Partial<SchedulingAdjudicator>,
	) {
		props.onChange(
			props.adjudicators.map((adj, idx) =>
				idx === index ? { ...adj, ...patch } : adj,
			),
		);
	}

	function toggleDivision(index: number, divisionId: string, checked: boolean) {
		const current = props.adjudicators[index]?.eligibleDivisionIds ?? [];
		const next = checked
			? [...new Set([...current, divisionId])]
			: current.filter((id) => id !== divisionId);
		updateAdjudicator(index, { eligibleDivisionIds: next });
	}

	function removeAdjudicator(index: number) {
		props.onChange(props.adjudicators.filter((_, idx) => idx !== index));
	}

	return (
		<section class="scheduling-section">
			<div class="scheduling-section-header">
				<div>
					<h3>Adjudicators</h3>
					<p class="muted">
						Festival-scoped adjudicator records with stable IDs and eligible
						divisions. Leaving all divisions unchecked allows any division.
					</p>
				</div>
				<Button type="button" variant="secondary" onClick={addAdjudicator}>
					Add adjudicator
				</Button>
			</div>
			<Show
				when={props.adjudicators.length > 0}
				fallback={<p class="muted">No adjudicators configured yet.</p>}
			>
				<div class="classes-table-scroll">
					<table class="scheduling-rules">
						<thead>
							<tr>
								<th>Stable ID</th>
								<th>Adjudicator name</th>
								<th>Eligible divisions</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							<Index each={props.adjudicators}>
								{(adj, i) => {
									const index = () => i;
									return (
										<tr>
											<td>
												<code>{adj().id}</code>
											</td>
											<td>
												<input
													type="text"
													required
													maxLength={200}
													aria-label={`Adjudicator name for ${adj().id}`}
													placeholder="e.g. Dr. Jane Doe"
													value={adj().name}
													onInput={(e) =>
														updateAdjudicator(index(), {
															name: e.currentTarget.value,
														})
													}
												/>
											</td>
											<td>
												<div class="scheduling-checkbox-group">
													<For each={props.divisions}>
														{(div) => (
															<label class="scheduling-checkbox-pill">
																<input
																	type="checkbox"
																	checked={adj().eligibleDivisionIds.includes(
																		div.id,
																	)}
																	onChange={(e) =>
																		toggleDivision(
																			index(),
																			div.id,
																			e.currentTarget.checked,
																		)
																	}
																/>
																<span>{div.displayName}</span>
															</label>
														)}
													</For>
												</div>
											</td>
											<td>
												<Button
													type="button"
													variant="secondary"
													onClick={() => removeAdjudicator(index())}
												>
													Remove
												</Button>
											</td>
										</tr>
									);
								}}
							</Index>
						</tbody>
					</table>
				</div>
			</Show>
		</section>
	);
}
