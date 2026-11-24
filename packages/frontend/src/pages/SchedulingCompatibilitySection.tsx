import {
	type OrganizationDivision,
	PIANO_TYPES,
	type PianoType,
	SCHEDULING_CLASS_TYPES,
	type SchedulingAdjudicator,
	type SchedulingClassRule,
	type SchedulingRoomCompatibilityRule,
} from "@festival/common";
import { For, Index, Show } from "solid-js";
import { Button } from "../components/Button.js";

export function SchedulingCompatibilitySection(props: {
	rules: SchedulingRoomCompatibilityRule[];
	divisions: OrganizationDivision[];
	classRules: SchedulingClassRule[];
	adjudicators: SchedulingAdjudicator[];
	onChange: (rules: SchedulingRoomCompatibilityRule[]) => void;
}) {
	function addRule() {
		const id =
			typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? `compat-${crypto.randomUUID().slice(0, 8)}`
				: `compat-${Date.now()}`;
		const defaultScopeValue =
			props.divisions[0]?.id ?? props.classRules[0]?.code ?? "concerto";
		props.onChange([
			...props.rules,
			{
				id,
				scopeType: props.divisions[0]
					? "division"
					: props.classRules[0]
						? "class_code"
						: "class_type",
				scopeValue: defaultScopeValue,
				requiredPianoType: null,
				minimumPianoCount: 1,
				allowedAdjudicatorIds: [],
			},
		]);
	}

	function updateRule(
		index: number,
		patch: Partial<SchedulingRoomCompatibilityRule>,
	) {
		props.onChange(
			props.rules.map((r, idx) => (idx === index ? { ...r, ...patch } : r)),
		);
	}

	function toggleAdjudicator(
		index: number,
		adjudicatorId: string,
		checked: boolean,
	) {
		const current = props.rules[index]?.allowedAdjudicatorIds ?? [];
		const next = checked
			? [...new Set([...current, adjudicatorId])]
			: current.filter((id) => id !== adjudicatorId);
		updateRule(index, { allowedAdjudicatorIds: next });
	}

	function removeRule(index: number) {
		props.onChange(props.rules.filter((_, idx) => idx !== index));
	}

	return (
		<section class="scheduling-section">
			<div class="scheduling-section-header">
				<div>
					<h3>Room / Instrument Compatibility &amp; Adjudicator Mapping</h3>
					<p class="muted">
						Require piano type or minimum count and optionally restrict allowed
						adjudicators by division, class code, or class type.
					</p>
				</div>
				<Button type="button" variant="secondary" onClick={addRule}>
					Add compatibility rule
				</Button>
			</div>
			<Show
				when={props.rules.length > 0}
				fallback={<p class="muted">No compatibility rules configured yet.</p>}
			>
				<div class="classes-table-scroll">
					<table class="scheduling-rules">
						<thead>
							<tr>
								<th>Scope</th>
								<th>Target</th>
								<th>Required piano type</th>
								<th>Min pianos</th>
								<th>Allowed adjudicators (none = any)</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							<Index each={props.rules}>
								{(rule, i) => {
									const index = () => i;
									return (
										<tr>
											<td>
												<select
													aria-label={`Compatibility ${index() + 1} scope`}
													value={rule().scopeType}
													onChange={(e) => {
														const scopeType = e.currentTarget
															.value as SchedulingRoomCompatibilityRule["scopeType"];
														const scopeValue =
															scopeType === "division"
																? (props.divisions[0]?.id ?? "")
																: scopeType === "class_code"
																	? (props.classRules[0]?.code ?? "")
																	: "concerto";
														updateRule(index(), { scopeType, scopeValue });
													}}
												>
													<option value="division">Division</option>
													<option value="class_code">Class code</option>
													<option value="class_type">Class type</option>
												</select>
											</td>
											<td>
												<Show when={rule().scopeType === "division"}>
													<select
														aria-label={`Compatibility ${index() + 1} division`}
														value={rule().scopeValue}
														onChange={(e) =>
															updateRule(index(), {
																scopeValue: e.currentTarget.value,
															})
														}
													>
														<For each={props.divisions}>
															{(div) => (
																<option value={div.id}>
																	{div.displayName}
																</option>
															)}
														</For>
													</select>
												</Show>
												<Show when={rule().scopeType === "class_type"}>
													<select
														aria-label={`Compatibility ${index() + 1} class type`}
														value={rule().scopeValue}
														onChange={(e) =>
															updateRule(index(), {
																scopeValue: e.currentTarget.value,
															})
														}
													>
														<For each={SCHEDULING_CLASS_TYPES}>
															{(ct) => <option value={ct}>{ct}</option>}
														</For>
													</select>
												</Show>
												<Show when={rule().scopeType === "class_code"}>
													<input
														type="text"
														required
														aria-label={`Compatibility ${index() + 1} class code`}
														value={rule().scopeValue}
														onInput={(e) =>
															updateRule(index(), {
																scopeValue: e.currentTarget.value.toUpperCase(),
															})
														}
													/>
												</Show>
											</td>
											<td>
												<select
													aria-label={`Compatibility ${index() + 1} piano type`}
													value={rule().requiredPianoType ?? ""}
													onChange={(e) =>
														updateRule(index(), {
															requiredPianoType:
																(e.currentTarget.value as PianoType) || null,
														})
													}
												>
													<option value="">Any</option>
													<For each={PIANO_TYPES}>
														{(pt) => <option value={pt}>{pt}</option>}
													</For>
												</select>
											</td>
											<td>
												<input
													type="number"
													min="0"
													max="3"
													step="1"
													aria-label={`Compatibility ${index() + 1} min pianos`}
													value={rule().minimumPianoCount}
													onInput={(e) =>
														updateRule(index(), {
															minimumPianoCount: Number.isFinite(
																e.currentTarget.valueAsNumber,
															)
																? e.currentTarget.valueAsNumber
																: 0,
														})
													}
												/>
											</td>
											<td>
												<div class="scheduling-checkbox-group">
													<For each={props.adjudicators}>
														{(adj) => (
															<label class="scheduling-checkbox-pill">
																<input
																	type="checkbox"
																	checked={rule().allowedAdjudicatorIds.includes(
																		adj.id,
																	)}
																	onChange={(e) =>
																		toggleAdjudicator(
																			index(),
																			adj.id,
																			e.currentTarget.checked,
																		)
																	}
																/>
																<span>{adj.name || adj.id}</span>
															</label>
														)}
													</For>
												</div>
											</td>
											<td>
												<Button
													type="button"
													variant="secondary"
													onClick={() => removeRule(index())}
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
