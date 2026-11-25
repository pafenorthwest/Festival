import {
	type OrganizationDivision,
	type Room,
	type RoomWindowPreview,
	SCHEDULING_CLASS_TYPES,
	type SchedulingAdjudicator,
	type SchedulingClassType,
	type SchedulingRoomWindow,
} from "@festival/common";
import { For, Index, Show } from "solid-js";
import { Button } from "../components/Button.js";

function formatRoomPianos(room: Room | undefined): string {
	if (!room) return "No room selected";
	if (room.pianoConfigurations.length === 0) return "No pianos";
	return room.pianoConfigurations
		.map((cfg) => `${cfg.count} ${cfg.pianoType}`)
		.join(", ");
}

export function SchedulingRoomWindowsSection(props: {
	windows: SchedulingRoomWindow[];
	windowSummaries: RoomWindowPreview[];
	festivalDates: string[];
	rooms: Room[];
	adjudicators: SchedulingAdjudicator[];
	divisions: OrganizationDivision[];
	onChange: (windows: SchedulingRoomWindow[]) => void;
}) {
	const roomById = () => new Map(props.rooms.map((r) => [r.id, r]));
	const summaryById = () =>
		new Map(props.windowSummaries.map((s) => [s.windowId, s]));

	function addWindow() {
		const id =
			typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
				? `win-${crypto.randomUUID().slice(0, 8)}`
				: `win-${Date.now()}`;
		props.onChange([
			...props.windows,
			{
				id,
				festivalDate: props.festivalDates[0] ?? "",
				roomId: props.rooms[0]?.id ?? "",
				adjudicatorId: props.adjudicators[0]?.id ?? "",
				startTime: "08:30",
				endTime: "17:00",
				dayType: "full",
				eligibleDivisionIds: [],
				eligibleClassTypes: ["solo", "concerto", "ensemble"],
				concertoEligible: true,
				blockedIntervals: [],
			},
		]);
	}

	function updateWindow(index: number, patch: Partial<SchedulingRoomWindow>) {
		props.onChange(
			props.windows.map((win, idx) =>
				idx === index ? { ...win, ...patch } : win,
			),
		);
	}

	function removeWindow(index: number) {
		props.onChange(props.windows.filter((_, idx) => idx !== index));
	}

	function toggleDivision(index: number, divisionId: string, checked: boolean) {
		const current = props.windows[index]?.eligibleDivisionIds ?? [];
		const next = checked
			? [...new Set([...current, divisionId])]
			: current.filter((id) => id !== divisionId);
		updateWindow(index, { eligibleDivisionIds: next });
	}

	function toggleClassType(
		index: number,
		classType: SchedulingClassType,
		checked: boolean,
	) {
		const current = props.windows[index]?.eligibleClassTypes ?? [];
		const next = checked
			? [...new Set([...current, classType])]
			: current.filter((t) => t !== classType);
		updateWindow(index, {
			eligibleClassTypes: next,
			concertoEligible:
				classType === "concerto"
					? checked
					: props.windows[index]?.concertoEligible,
		});
	}

	function addBlockedInterval(index: number) {
		const current = props.windows[index]?.blockedIntervals ?? [];
		updateWindow(index, {
			blockedIntervals: [
				...current,
				{ startTime: "12:00", endTime: "12:30", label: "Blocked" },
			],
		});
	}

	function updateBlockedInterval(
		winIndex: number,
		blockIndex: number,
		patch: Partial<SchedulingRoomWindow["blockedIntervals"][number]>,
	) {
		const blocks = props.windows[winIndex]?.blockedIntervals ?? [];
		updateWindow(winIndex, {
			blockedIntervals: blocks.map((b, idx) =>
				idx === blockIndex ? { ...b, ...patch } : b,
			),
		});
	}

	function removeBlockedInterval(winIndex: number, blockIndex: number) {
		const blocks = props.windows[winIndex]?.blockedIntervals ?? [];
		updateWindow(winIndex, {
			blockedIntervals: blocks.filter((_, idx) => idx !== blockIndex),
		});
	}

	return (
		<section class="scheduling-section">
			<div class="scheduling-section-header">
				<div>
					<h3>Room &amp; Adjudicator Windows</h3>
					<p class="muted">
						Assign rooms, adjudicators, full/half-day blocks, eligible
						divisions/types, and blocked intervals. Overlaps and missing
						references are flagged immediately.
					</p>
				</div>
				<Button type="button" variant="secondary" onClick={addWindow}>
					Add room window
				</Button>
			</div>
			<Show
				when={props.windows.length > 0}
				fallback={<p class="muted">No room/day windows configured yet.</p>}
			>
				<div class="scheduling-window-list">
					<Index each={props.windows}>
						{(win, i) => {
							const index = () => i;
							const room = () => roomById().get(win().roomId);
							const summary = () => summaryById().get(win().id);
							return (
								<div class="scheduling-card scheduling-window-card">
									<div class="scheduling-section-header">
										<div>
											<strong>Window {index() + 1}</strong>{" "}
											<code class="muted">{win().id}</code>
											<Show when={summary()}>
												{(s) => (
													<span class="scheduling-usable-pill">
														Usable: {s().usableSchedulingMinutes} / 440 min (raw{" "}
														{s().rawMinutes}m, breaks {s().breakAndLunchMinutes}
														m, blocked {s().blockedMinutes}m)
													</span>
												)}
											</Show>
										</div>
										<Button
											type="button"
											variant="secondary"
											onClick={() => removeWindow(index())}
										>
											Remove window
										</Button>
									</div>

									<div class="scheduling-window-grid">
										<label>
											Festival date
											<input
												type="date"
												required
												aria-label={`Window ${index() + 1} date`}
												list="scheduling-festival-dates"
												value={win().festivalDate}
												onInput={(e) =>
													updateWindow(index(), {
														festivalDate: e.currentTarget.value,
													})
												}
											/>
										</label>

										<label>
											Room
											<select
												aria-label={`Window ${index() + 1} room`}
												value={win().roomId}
												onChange={(e) =>
													updateWindow(index(), {
														roomId: e.currentTarget.value,
													})
												}
											>
												<option value="">Select room…</option>
												<For each={props.rooms}>
													{(r) => <option value={r.id}>{r.name}</option>}
												</For>
											</select>
											<small class="muted">
												Pianos: {formatRoomPianos(room())}
											</small>
										</label>

										<label>
											Adjudicator
											<select
												aria-label={`Window ${index() + 1} adjudicator`}
												value={win().adjudicatorId}
												onChange={(e) =>
													updateWindow(index(), {
														adjudicatorId: e.currentTarget.value,
													})
												}
											>
												<option value="">Select adjudicator…</option>
												<For each={props.adjudicators}>
													{(adj) => (
														<option value={adj.id}>{adj.name || adj.id}</option>
													)}
												</For>
											</select>
										</label>

										<label>
											Day type
											<select
												aria-label={`Window ${index() + 1} day type`}
												value={win().dayType}
												onChange={(e) =>
													updateWindow(index(), {
														dayType: e.currentTarget.value as "full" | "half",
													})
												}
											>
												<option value="full">Full day (50m breaks)</option>
												<option value="half">Half day (10m break)</option>
											</select>
										</label>

										<label>
											Start time
											<input
												type="time"
												required
												aria-label={`Window ${index() + 1} start time`}
												value={win().startTime}
												onInput={(e) =>
													updateWindow(index(), {
														startTime: e.currentTarget.value,
													})
												}
											/>
										</label>

										<label>
											End time
											<input
												type="time"
												required
												aria-label={`Window ${index() + 1} end time`}
												value={win().endTime}
												onInput={(e) =>
													updateWindow(index(), {
														endTime: e.currentTarget.value,
													})
												}
											/>
										</label>
									</div>

									<div class="scheduling-window-filters">
										<div>
											<span class="scheduling-sublabel">
												Eligible divisions (none = all):
											</span>
											<div class="scheduling-checkbox-group">
												<For each={props.divisions}>
													{(div) => (
														<label class="scheduling-checkbox-pill">
															<input
																type="checkbox"
																checked={win().eligibleDivisionIds.includes(
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
										</div>

										<div>
											<span class="scheduling-sublabel">
												Eligible class types &amp; Concerto:
											</span>
											<div class="scheduling-checkbox-group">
												<For each={SCHEDULING_CLASS_TYPES}>
													{(ct) => (
														<label class="scheduling-checkbox-pill">
															<input
																type="checkbox"
																checked={win().eligibleClassTypes.includes(ct)}
																onChange={(e) =>
																	toggleClassType(
																		index(),
																		ct,
																		e.currentTarget.checked,
																	)
																}
															/>
															<span>{ct}</span>
														</label>
													)}
												</For>
												<label class="scheduling-checkbox-pill">
													<input
														type="checkbox"
														checked={win().concertoEligible}
														onChange={(e) =>
															updateWindow(index(), {
																concertoEligible: e.currentTarget.checked,
															})
														}
													/>
													<span>Concerto eligible</span>
												</label>
											</div>
										</div>
									</div>

									<div class="scheduling-blocked-intervals">
										<div class="scheduling-inline-row">
											<span class="scheduling-sublabel">Blocked intervals</span>
											<Button
												type="button"
												variant="secondary"
												onClick={() => addBlockedInterval(index())}
											>
												Add block
											</Button>
										</div>
										<Index each={win().blockedIntervals}>
											{(block, bi) => {
												const blockIdx = () => bi;
												return (
													<div class="scheduling-inline-row">
														<input
															type="time"
															aria-label={`Window ${index() + 1} block ${blockIdx() + 1} start`}
															value={block().startTime}
															onInput={(e) =>
																updateBlockedInterval(index(), blockIdx(), {
																	startTime: e.currentTarget.value,
																})
															}
														/>
														<span>–</span>
														<input
															type="time"
															aria-label={`Window ${index() + 1} block ${blockIdx() + 1} end`}
															value={block().endTime}
															onInput={(e) =>
																updateBlockedInterval(index(), blockIdx(), {
																	endTime: e.currentTarget.value,
																})
															}
														/>
														<input
															type="text"
															placeholder="Reason"
															aria-label={`Window ${index() + 1} block ${blockIdx() + 1} label`}
															value={block().label ?? ""}
															onInput={(e) =>
																updateBlockedInterval(index(), blockIdx(), {
																	label: e.currentTarget.value,
																})
															}
														/>
														<Button
															type="button"
															variant="secondary"
															onClick={() =>
																removeBlockedInterval(index(), blockIdx())
															}
														>
															Remove
														</Button>
													</div>
												);
											}}
										</Index>
									</div>

									<Show when={(summary()?.issues.length ?? 0) > 0}>
										<ul class="scheduling-issue-list">
											<For each={summary()?.issues}>
												{(issue) => (
													<li class="scheduling-error-text">{issue.message}</li>
												)}
											</For>
										</ul>
									</Show>
								</div>
							);
						}}
					</Index>
				</div>
				<datalist id="scheduling-festival-dates">
					<For each={props.festivalDates}>
						{(date) => <option value={date} />}
					</For>
				</datalist>
			</Show>
		</section>
	);
}
