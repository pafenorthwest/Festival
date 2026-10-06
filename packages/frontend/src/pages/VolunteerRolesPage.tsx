import {
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	type CreateVolunteerRoleInput,
	type CreateVolunteerShiftInput,
	createVolunteerRole,
	createVolunteerShift,
	deleteVolunteerRole,
	deleteVolunteerShift,
	getVolunteerCoverageGaps,
	getVolunteerRoles,
	getVolunteerShiftsForRole,
	updateVolunteerRole,
	updateVolunteerShift,
} from "../lib/api.js";
import { subscribeToAuthChanges } from "../lib/firebase-auth.js";

interface VolunteerRolesPageProps {
	app: FestivalAppController;
	slug: string;
}

const emptyRoleDraft: CreateVolunteerRoleInput = {
	slug: "",
	displayName: "",
	description: "",
	detailsUrl: "",
	isRoomProctor: false,
};

const emptyShiftDraft: CreateVolunteerShiftInput = {
	date: "",
	period: "AM",
	timeText: "",
	division: "",
	adjudicator: "",
};

export function VolunteerRolesPage(props: VolunteerRolesPageProps) {
	const [idToken, setIdToken] = createSignal<string | null>(null);
	const [selectedFestivalShortName, setSelectedFestivalShortName] =
		createSignal("");
	const selectedFestival = createMemo(() => {
		const festivals = props.app.festivals();
		return (
			festivals.find(
				(festival) => festival.shortName === selectedFestivalShortName(),
			) ??
			festivals.find((festival) => festival.isPrimary) ??
			festivals[0]
		);
	});

	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	const [roles, { refetch: refetchRoles }] = createResource(
		() => {
			const token = idToken();
			const festival = selectedFestival();
			const festivalShortName = festival?.shortName;
			return token && festivalShortName
				? ([token, festivalShortName] as const)
				: undefined;
		},
		([token, festivalShortName]) =>
			getVolunteerRoles(token, props.slug, festivalShortName),
	);

	const [roleDraft, setRoleDraft] = createSignal(emptyRoleDraft);
	const [roleFormError, setRoleFormError] = createSignal<string | null>(null);
	const [isCreatingRole, setIsCreatingRole] = createSignal(false);
	const [editingRoleId, setEditingRoleId] = createSignal<string | null>(null);
	const [deletingRoleId, setDeletingRoleId] = createSignal<string | null>(null);

	function startEditRole(role: {
		id: string;
		displayName: string;
		description: string;
		detailsUrl: string | null;
		isRoomProctor: boolean;
	}) {
		setRoleFormError(null);
		setEditingRoleId(role.id);
		setRoleDraft({
			slug: "",
			displayName: role.displayName,
			description: role.description,
			detailsUrl: role.detailsUrl ?? "",
			isRoomProctor: role.isRoomProctor,
		});
	}

	function cancelEditRole() {
		setEditingRoleId(null);
		setRoleDraft(emptyRoleDraft);
		setRoleFormError(null);
	}

	async function handleRoleFormSubmit(event: Event) {
		event.preventDefault();
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		if (!token || !festivalShortName) return;
		setRoleFormError(null);
		setIsCreatingRole(true);
		const editingId = editingRoleId();
		try {
			if (editingId) {
				await updateVolunteerRole(
					token,
					props.slug,
					festivalShortName,
					editingId,
					roleDraft(),
				);
				setEditingRoleId(null);
			} else {
				await createVolunteerRole(
					token,
					props.slug,
					festivalShortName,
					roleDraft(),
				);
			}
			setRoleDraft(emptyRoleDraft);
			await refetchRoles();
			await refetchCoverageGaps();
		} catch (error) {
			setRoleFormError(
				error instanceof Error
					? error.message
					: `Could not ${editingId ? "update" : "create"} role.`,
			);
		} finally {
			setIsCreatingRole(false);
		}
	}

	async function handleDeleteRole(role: { id: string; displayName: string }) {
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		if (!token || !festivalShortName) return;
		if (
			!confirm(
				`Delete the "${role.displayName}" role? This also deletes all of its shifts.`,
			)
		) {
			return;
		}
		setRoleFormError(null);
		setDeletingRoleId(role.id);
		try {
			await deleteVolunteerRole(token, props.slug, festivalShortName, role.id);
			if (editingRoleId() === role.id) cancelEditRole();
			if (selectedRoleId() === role.id) setSelectedRoleId(null);
			await refetchRoles();
			await refetchCoverageGaps();
		} catch (error) {
			setRoleFormError(
				error instanceof Error ? error.message : "Could not delete role.",
			);
		} finally {
			setDeletingRoleId(null);
		}
	}

	const [coverageGaps, { refetch: refetchCoverageGaps }] = createResource(
		() => {
			const token = idToken();
			const festivalShortName = selectedFestival()?.shortName;
			return token && festivalShortName
				? ([token, festivalShortName] as const)
				: undefined;
		},
		([token, festivalShortName]) =>
			getVolunteerCoverageGaps(props.slug, festivalShortName, token),
	);

	const [selectedRoleId, setSelectedRoleId] = createSignal<string | null>(null);
	const selectedRole = () =>
		roles()?.find((role) => role.id === selectedRoleId()) ?? null;

	const [shifts, { refetch: refetchShifts }] = createResource(
		() => {
			const token = idToken();
			const festivalShortName = selectedFestival()?.shortName;
			const roleId = selectedRoleId();
			return token && festivalShortName && roleId
				? ([token, festivalShortName, roleId] as const)
				: undefined;
		},
		([token, festivalShortName, roleId]) =>
			getVolunteerShiftsForRole(token, props.slug, festivalShortName, roleId),
	);

	const [shiftDraft, setShiftDraft] = createSignal(emptyShiftDraft);
	const [shiftFormError, setShiftFormError] = createSignal<string | null>(null);
	const [isCreatingShift, setIsCreatingShift] = createSignal(false);
	const [editingShiftId, setEditingShiftId] = createSignal<string | null>(null);
	const [deletingShiftId, setDeletingShiftId] = createSignal<string | null>(
		null,
	);

	function startEditShift(shift: {
		id: string;
		date: string;
		period: "AM" | "PM";
		timeText: string | null;
		division: string | null;
		adjudicator: string | null;
	}) {
		setShiftFormError(null);
		setEditingShiftId(shift.id);
		setShiftDraft({
			date: shift.date,
			period: shift.period,
			timeText: shift.timeText ?? "",
			division: shift.division ?? "",
			adjudicator: shift.adjudicator ?? "",
		});
	}

	function cancelEditShift() {
		setEditingShiftId(null);
		setShiftDraft(emptyShiftDraft);
		setShiftFormError(null);
	}

	async function handleShiftFormSubmit(event: Event) {
		event.preventDefault();
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		const roleId = selectedRoleId();
		if (!token || !festivalShortName || !roleId) return;
		setShiftFormError(null);
		setIsCreatingShift(true);
		const editingId = editingShiftId();
		try {
			if (editingId) {
				await updateVolunteerShift(
					token,
					props.slug,
					festivalShortName,
					roleId,
					editingId,
					shiftDraft(),
				);
				setEditingShiftId(null);
			} else {
				await createVolunteerShift(
					token,
					props.slug,
					festivalShortName,
					roleId,
					shiftDraft(),
				);
			}
			setShiftDraft(emptyShiftDraft);
			await refetchShifts();
			await refetchCoverageGaps();
		} catch (error) {
			setShiftFormError(
				error instanceof Error
					? error.message
					: `Could not ${editingId ? "update" : "create"} shift.`,
			);
		} finally {
			setIsCreatingShift(false);
		}
	}

	async function handleDeleteShift(shift: { id: string }) {
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		const roleId = selectedRoleId();
		if (!token || !festivalShortName || !roleId) return;
		if (!confirm("Delete this shift?")) return;
		setShiftFormError(null);
		setDeletingShiftId(shift.id);
		try {
			await deleteVolunteerShift(
				token,
				props.slug,
				festivalShortName,
				roleId,
				shift.id,
			);
			if (editingShiftId() === shift.id) cancelEditShift();
			await refetchShifts();
			await refetchCoverageGaps();
		} catch (error) {
			setShiftFormError(
				error instanceof Error ? error.message : "Could not delete shift.",
			);
		} finally {
			setDeletingShiftId(null);
		}
	}

	return (
		<Show
			when={props.app.hasVolunteerAdminIntent()}
			fallback={
				<AccessDeniedPanel message="Volunteer administration is available to Admin, Division Chair, and Concert Chair members." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Volunteer Roles</h2>
						<p>Roles volunteers can sign up for at this festival.</p>
					</div>
				</header>
				<Show
					when={selectedFestival()}
					fallback={<p>No festivals have been created yet.</p>}
				>
					<label class="field">
						<span>Festival</span>
						<select
							value={selectedFestival()?.shortName ?? ""}
							onChange={(event) =>
								setSelectedFestivalShortName(event.currentTarget.value)
							}
						>
							<For each={props.app.festivals()}>
								{(festival) => (
									<option value={festival.shortName}>{festival.name}</option>
								)}
							</For>
						</select>
					</label>
					<Show when={roles.loading}>
						<p>Loading roles…</p>
					</Show>
					<Show when={roles.error}>
						<section class="banner error-banner">
							Could not load volunteer roles: {String(roles.error)}
						</section>
					</Show>
					<Show when={roles() && roles()?.length === 0}>
						<p>No volunteer roles have been created yet.</p>
					</Show>
					<Show when={roles()?.length}>
						<div class="listing-table volunteer-roles-table">
							<div class="listing-table-header">
								<span>Role</span>
								<span>Type</span>
								<span>Actions</span>
							</div>
							<For each={roles()}>
								{(role) => (
									<div class="listing-table-row">
										<span>
											<strong>{role.displayName}</strong>
											<span class="muted"> — {role.description}</span>
										</span>
										<span class="listing-table-badges">
											<Show when={role.isRoomProctor}>
												<span class="badge badge-neutral">Room Proctor</span>
											</Show>
										</span>
										<span class="listing-table-actions">
											<Show when={props.app.hasVolunteerAdminIntent()}>
												<Button
													type="button"
													variant="secondary"
													onClick={() =>
														setSelectedRoleId((current) =>
															current === role.id ? null : role.id,
														)
													}
												>
													{selectedRoleId() === role.id
														? "Hide shifts"
														: "Manage shifts"}
												</Button>
												<Button
													type="button"
													variant="secondary"
													onClick={() => startEditRole(role)}
												>
													Edit
												</Button>
												<Button
													type="button"
													variant="secondary"
													disabled={deletingRoleId() === role.id}
													onClick={() => handleDeleteRole(role)}
												>
													{deletingRoleId() === role.id
														? "Deleting…"
														: "Delete"}
												</Button>
											</Show>
										</span>
									</div>
								)}
							</For>
						</div>
					</Show>

					<Show when={props.app.hasVolunteerAdminIntent() && selectedRole()}>
						{(role) => (
							<section class="flow-panel">
								<h3>Shifts for {role().displayName}</h3>
								<Show when={shifts.loading}>
									<p>Loading shifts…</p>
								</Show>
								<Show when={shifts() && shifts()?.length === 0}>
									<p>No shifts have been created for this role yet.</p>
								</Show>
								<Show when={shifts()?.length}>
									<div class="listing-table volunteer-shifts-table">
										<div class="listing-table-header">
											<span>Date</span>
											<span>Details</span>
											<span>Actions</span>
										</div>
										<For each={shifts()}>
											{(shift) => (
												<div class="listing-table-row">
													<span>
														<strong>
															{shift.date} {shift.period}
														</strong>
													</span>
													<span>
														<Show when={shift.timeText}>
															<span>{shift.timeText}</span>
														</Show>
														<Show when={shift.division || shift.adjudicator}>
															<span>
																{shift.division} / {shift.adjudicator}
															</span>
														</Show>
													</span>
													<span class="listing-table-actions">
														<Button
															type="button"
															variant="secondary"
															onClick={() => startEditShift(shift)}
														>
															Edit
														</Button>
														<Button
															type="button"
															variant="secondary"
															disabled={deletingShiftId() === shift.id}
															onClick={() => handleDeleteShift(shift)}
														>
															{deletingShiftId() === shift.id
																? "Deleting…"
																: "Delete"}
														</Button>
													</span>
												</div>
											)}
										</For>
									</div>
								</Show>

								<form class="flow-panel" onSubmit={handleShiftFormSubmit}>
									<h3>{editingShiftId() ? "Edit shift" : "Add a shift"}</h3>
									<Show when={role().isRoomProctor}>
										<p class="muted">
											This is a Room Proctor role, so each shift needs a
											Division and Adjudicator.
										</p>
									</Show>
									<label class="field">
										<span>Date</span>
										<input
											type="date"
											value={shiftDraft().date}
											onInput={(event) =>
												setShiftDraft((current) => ({
													...current,
													date: event.currentTarget.value,
												}))
											}
										/>
									</label>
									<label class="field">
										<span>Period</span>
										<select
											value={shiftDraft().period}
											onChange={(event) =>
												setShiftDraft((current) => ({
													...current,
													period: event.currentTarget.value as "AM" | "PM",
												}))
											}
										>
											<option value="AM">AM</option>
											<option value="PM">PM</option>
										</select>
									</label>
									<label class="field">
										<span>Informational time (optional)</span>
										<input
											type="text"
											placeholder="9am - 4:30pm"
											value={shiftDraft().timeText ?? ""}
											onInput={(event) =>
												setShiftDraft((current) => ({
													...current,
													timeText: event.currentTarget.value,
												}))
											}
										/>
									</label>
									<Show when={role().isRoomProctor}>
										<label class="field">
											<span>Division</span>
											<input
												type="text"
												value={shiftDraft().division ?? ""}
												onInput={(event) =>
													setShiftDraft((current) => ({
														...current,
														division: event.currentTarget.value,
													}))
												}
											/>
										</label>
										<label class="field">
											<span>Adjudicator</span>
											<input
												type="text"
												value={shiftDraft().adjudicator ?? ""}
												onInput={(event) =>
													setShiftDraft((current) => ({
														...current,
														adjudicator: event.currentTarget.value,
													}))
												}
											/>
										</label>
									</Show>
									<Show when={shiftFormError()}>
										<section class="banner error-banner">
											{shiftFormError()}
										</section>
									</Show>
									<Button type="submit" disabled={isCreatingShift()}>
										{editingShiftId() ? "Save changes" : "Add shift"}
									</Button>
									<Show when={editingShiftId()}>
										<Button
											type="button"
											variant="secondary"
											onClick={cancelEditShift}
										>
											Cancel
										</Button>
									</Show>
								</form>
							</section>
						)}
					</Show>

					<Show when={props.app.hasVolunteerAdminIntent()}>
						<form class="flow-panel" onSubmit={handleRoleFormSubmit}>
							<h3>{editingRoleId() ? "Edit role" : "Create a role"}</h3>
							<Show when={!editingRoleId()}>
								<label class="field">
									<span>Slug</span>
									<input
										type="text"
										value={roleDraft().slug}
										onInput={(event) =>
											setRoleDraft((current) => ({
												...current,
												slug: event.currentTarget.value,
											}))
										}
									/>
								</label>
							</Show>
							<label class="field">
								<span>Display name</span>
								<input
									type="text"
									value={roleDraft().displayName}
									onInput={(event) =>
										setRoleDraft((current) => ({
											...current,
											displayName: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<label class="field">
								<span>Description</span>
								<input
									type="text"
									value={roleDraft().description}
									onInput={(event) =>
										setRoleDraft((current) => ({
											...current,
											description: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<label class="field">
								<span>Details link (optional)</span>
								<input
									type="text"
									value={roleDraft().detailsUrl ?? ""}
									onInput={(event) =>
										setRoleDraft((current) => ({
											...current,
											detailsUrl: event.currentTarget.value,
										}))
									}
								/>
							</label>
							<label class="field field-checkbox">
								<input
									type="checkbox"
									checked={roleDraft().isRoomProctor}
									onChange={(event) =>
										setRoleDraft((current) => ({
											...current,
											isRoomProctor: event.currentTarget.checked,
										}))
									}
								/>
								<span>Room Proctor role</span>
							</label>
							<Show when={roleFormError()}>
								<section class="banner error-banner">{roleFormError()}</section>
							</Show>
							<Button type="submit" disabled={isCreatingRole()}>
								{editingRoleId() ? "Save changes" : "Create role"}
							</Button>
							<Show when={editingRoleId()}>
								<Button
									type="button"
									variant="secondary"
									onClick={cancelEditRole}
								>
									Cancel
								</Button>
							</Show>
						</form>
					</Show>

					<Show when={props.app.hasVolunteerAdminIntent()}>
						<section class="flow-panel coverage-gaps-panel">
							<h3>Coverage Gaps</h3>
							<Show when={coverageGaps.loading}>
								<p>Loading coverage gaps…</p>
							</Show>
							<Show when={coverageGaps.error}>
								<section class="banner error-banner">
									Could not load coverage gaps: {String(coverageGaps.error)}
								</section>
							</Show>
							<Show when={coverageGaps()}>
								{(gaps) => (
									<>
										<div class="coverage-metrics">
											<span class="badge badge-neutral">
												Total Shifts: {gaps().totalShifts}
											</span>
											<span class="badge badge-active">
												Filled Shifts:{" "}
												{gaps().filledShifts ?? gaps().coveredShifts}
											</span>
											<span class="badge badge-rejected">
												Open Shifts:{" "}
												{gaps().openShifts ?? gaps().unfilledShifts}
											</span>
											<span class="badge badge-processing">
												Coverage Percentage: {gaps().coveragePercentage}%
											</span>
										</div>
										<Show
											when={(gaps().unfilled ?? gaps().gaps).length > 0}
											fallback={
												<p class="muted">All shifts are currently filled.</p>
											}
										>
											<div class="listing-table coverage-gaps-table">
												<div class="listing-table-header">
													<span>Role</span>
													<span>Date</span>
													<span>Period</span>
													<span>Location</span>
												</div>
												<For each={gaps().unfilled ?? gaps().gaps}>
													{(gap) => (
														<div class="listing-table-row">
															<span>
																<strong>
																	{gap.roleDisplayName || gap.roleName}
																</strong>
															</span>
															<span>{gap.date}</span>
															<span>
																{gap.period}
																<Show when={gap.timeText}>
																	<span class="muted"> ({gap.timeText})</span>
																</Show>
															</span>
															<span>
																{gap.division
																	? `${gap.division}${gap.adjudicator ? ` (${gap.adjudicator})` : ""}`
																	: ((gap as { location?: string }).location ??
																		"—")}
															</span>
														</div>
													)}
												</For>
											</div>
										</Show>
									</>
								)}
							</Show>
						</section>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
