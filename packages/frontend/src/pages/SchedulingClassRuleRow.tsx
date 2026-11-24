import {
	ADJUDICATOR_DAY_BUDGET_MINUTES,
	type FestivalClassConfigurationDto,
	isConcertoClassCode,
	SCHEDULING_CLASS_DEFAULTS,
	type SchedulingClassRule,
	schedulingSectionLimits,
	schedulingSectionSeconds,
} from "@festival/common";
import { For, Show } from "solid-js";

const defaults = new Map(
	SCHEDULING_CLASS_DEFAULTS.map((row) => [row.code, row]),
);

function duration(seconds: number) {
	const remaining = seconds % 60;
	return `${Math.floor(seconds / 60)} min${remaining ? ` ${remaining} sec` : ""}`;
}

function sectionPreview(rule: SchedulingClassRule) {
	if (defaults.get(rule.code)?.additionalParticipant)
		return "Shares the primary entry (0 extra time)";
	const limits =
		rule.sectionLimits ?? schedulingSectionLimits(rule.playingMinutes);
	if (
		!(
			rule.playingMinutes > 0 &&
			rule.oralMinutes >= 0 &&
			limits.min > 0 &&
			limits.max >= limits.min
		)
	)
		return "—";
	const time = (n: number) =>
		duration(
			schedulingSectionSeconds(rule.playingMinutes, rule.oralMinutes, n),
		);
	return limits.min === limits.max
		? time(limits.min)
		: `${time(limits.min)} – ${time(limits.max)}`;
}

export function SchedulingClassRuleRow(props: {
	item: FestivalClassConfigurationDto;
	rule?: SchedulingClassRule;
	saved?: SchedulingClassRule;
	onChange: (rule?: SchedulingClassRule) => void;
}) {
	const selected = () =>
		props.rule ? (defaults.get(props.rule.code)?.code ?? "custom") : "";
	const additional = () =>
		defaults.get(props.rule?.code ?? "")?.additionalParticipant;
	const concerto = () => isConcertoClassCode(props.rule?.code ?? "");
	const limits = () =>
		props.rule?.sectionLimits ??
		schedulingSectionLimits(props.rule?.playingMinutes ?? 0);
	const capacitySeconds = () => {
		const rule = props.rule;
		if (
			!rule ||
			additional() ||
			!(rule.playingMinutes > 0 && rule.oralMinutes >= 0)
		) {
			return 0;
		}
		return schedulingSectionSeconds(
			rule.playingMinutes,
			rule.oralMinutes,
			props.item.capacity,
		);
	};
	function selectCode(code: string) {
		if (!code) {
			props.onChange(undefined);
			return;
		}
		const preset = defaults.get(code);
		props.onChange({
			classId: props.item.id,
			code: preset?.code ?? "",
			playingMinutes: preset?.playingMinutes ?? Number.NaN,
			oralMinutes: preset?.oralMinutes ?? Number.NaN,
			sectionLimits: null,
			placementGroupException: null,
		});
	}
	function update(patch: Partial<SchedulingClassRule>) {
		if (props.rule) props.onChange({ ...props.rule, ...patch });
	}
	function updateGroupException(patch: {
		maxSectionsPerGroup?: number | null;
		allowTueWedSplit?: boolean;
	}) {
		if (!props.rule) return;
		const current = props.rule.placementGroupException ?? {
			maxSectionsPerGroup: null,
			allowTueWedSplit: false,
		};
		const next = { ...current, ...patch };
		update({
			placementGroupException:
				next.maxSectionsPerGroup === null && !next.allowTueWedSplit
					? null
					: next,
		});
	}
	function label(text: string) {
		return `${text} for ${props.item.displayName}`;
	}
	const preview = () => (props.rule ? sectionPreview(props.rule) : "Unmapped");
	return (
		<tr>
			<th scope="row">
				{props.item.displayName}
				<Show when={!props.item.isActive}>
					<small>Inactive</small>
				</Show>
			</th>
			<td>
				<select
					aria-label={label("Scheduling code")}
					value={selected()}
					onChange={(e) => selectCode(e.currentTarget.value)}
				>
					<option value="">Unmapped</option>
					<For each={SCHEDULING_CLASS_DEFAULTS}>
						{(preset) => (
							<option value={preset.code}>
								{preset.code} · {preset.name}
							</option>
						)}
					</For>
					<option value="custom">Custom code</option>
				</select>
				<Show when={selected() === "custom"}>
					<input
						aria-label={label("Custom code")}
						placeholder="Custom code"
						required
						maxLength={200}
						value={props.rule?.code ?? ""}
						onInput={(e) => {
							const code = e.currentTarget.value;
							const preset = defaults.get(code.trim().toUpperCase());
							if (preset) selectCode(preset.code);
							else update({ code });
						}}
					/>
				</Show>
			</td>
			<td>
				{props.item.performanceMinutes} min
				<Show
					when={
						!additional() &&
						Number.isFinite(props.rule?.playingMinutes) &&
						props.rule?.playingMinutes !== props.item.performanceMinutes
					}
				>
					<small>Differs from Scheduling Playing.</small>
				</Show>
			</td>
			<For each={["playingMinutes", "oralMinutes"] as const}>
				{(field) => (
					<td>
						<input
							type="number"
							min="0"
							step="any"
							required
							disabled={!props.rule || additional()}
							aria-label={label(
								field === "playingMinutes" ? "Playing minutes" : "Oral minutes",
							)}
							value={
								Number.isFinite(props.rule?.[field]) ? props.rule?.[field] : ""
							}
							onInput={(e) =>
								update({ [field]: e.currentTarget.valueAsNumber })
							}
						/>
					</td>
				)}
			</For>
			<td>
				<Show
					when={props.rule && !additional()}
					fallback={additional() ? "Primary section" : "—"}
				>
					<label>
						<input
							type="checkbox"
							aria-label={label("Override section limits")}
							checked={!!props.rule?.sectionLimits}
							onChange={(e) =>
								update({
									sectionLimits: e.currentTarget.checked
										? { ...limits() }
										: null,
								})
							}
						/>{" "}
						Override
					</label>
					<Show
						when={props.rule?.sectionLimits}
						fallback={
							<small>
								Default · {limits().min}–{limits().max} entries
							</small>
						}
					>
						<div class="scheduling-limits">
							<For each={["min", "max"] as const}>
								{(key) => (
									<label>
										{key === "min" ? "Min" : "Max"}
										<input
											type="number"
											min="1"
											step="1"
											required
											aria-label={label(
												key === "min" ? "Minimum entries" : "Maximum entries",
											)}
											value={
												Number.isFinite(limits()[key]) ? limits()[key] : ""
											}
											onInput={(e) =>
												update({
													sectionLimits: {
														...limits(),
														[key]: e.currentTarget.valueAsNumber,
													},
												})
											}
										/>
									</label>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</td>
			<td>
				{preview()}
				<Show when={props.saved && sectionPreview(props.saved) !== preview()}>
					<small>Saved · {props.saved && sectionPreview(props.saved)}</small>
				</Show>
			</td>
			<td>
				<Show
					when={props.rule && !additional()}
					fallback={additional() ? "With primary" : "—"}
				>
					<div class="scheduling-group-exception">
						<small class="muted">
							{concerto()
								? "Default · All in 1 day"
								: "Default · Balanced (max 2)"}
						</small>
						<label>
							Max sections
							<input
								type="number"
								min="1"
								step="1"
								placeholder="Default"
								aria-label={label("Max sections per group")}
								value={
									props.rule?.placementGroupException?.maxSectionsPerGroup ?? ""
								}
								onInput={(e) => {
									const val = e.currentTarget.valueAsNumber;
									updateGroupException({
										maxSectionsPerGroup: Number.isFinite(val) ? val : null,
									});
								}}
							/>
						</label>
						<Show when={concerto()}>
							<label class="scheduling-checkbox-pill">
								<input
									type="checkbox"
									aria-label={label("Allow Tue/Wed split")}
									checked={Boolean(
										props.rule?.placementGroupException?.allowTueWedSplit,
									)}
									onChange={(e) =>
										updateGroupException({
											allowTueWedSplit: e.currentTarget.checked,
										})
									}
								/>
								<span>Tue/Wed split</span>
							</label>
							<Show when={capacitySeconds() > 0}>
								<small title="Estimated from the class registration capacity, not actual registrations.">
									Est. from registration capacity ({props.item.capacity}{" "}
									entries): {duration(capacitySeconds())}
									{capacitySeconds() > ADJUDICATOR_DAY_BUDGET_MINUTES * 60
										? ` (> ${ADJUDICATOR_DAY_BUDGET_MINUTES}m day)`
										: ""}
								</small>
							</Show>
						</Show>
					</div>
				</Show>
			</td>
		</tr>
	);
}
