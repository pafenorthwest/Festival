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
	getVolunteerRoles,
	getVolunteerShiftsForRole,
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

	async function handleCreateRole(event: Event) {
		event.preventDefault();
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		if (!token || !festivalShortName) return;
		setRoleFormError(null);
		setIsCreatingRole(true);
		try {
			await createVolunteerRole(
				token,
				props.slug,
				festivalShortName,
				roleDraft(),
			);
			setRoleDraft(emptyRoleDraft);
			await refetchRoles();
		} catch (error) {
			setRoleFormError(
				error instanceof Error ? error.message : "Could not create role.",
			);
		} finally {
			setIsCreatingRole(false);
		}
	}

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

	async function handleCreateShift(event: Event) {
		event.preventDefault();
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		const roleId = selectedRoleId();
		if (!token || !festivalShortName || !roleId) return;
		setShiftFormError(null);
		setIsCreatingShift(true);
		try {
			await createVolunteerShift(
				token,
				props.slug,
				festivalShortName,
				roleId,
				shiftDraft(),
			);
			setShiftDraft(emptyShiftDraft);
			await refetchShifts();
		} catch (error) {
			setShiftFormError(
				error instanceof Error ? error.message : "Could not create shift.",
			);
		} finally {
			setIsCreatingShift(false);
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
												</div>
											)}
										</For>
									</div>
								</Show>

								<form class="flow-panel" onSubmit={handleCreateShift}>
									<h3>Add a shift</h3>
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
										Add shift
									</Button>
								</form>
							</section>
						)}
					</Show>

					<Show when={props.app.hasVolunteerAdminIntent()}>
						<form class="flow-panel" onSubmit={handleCreateRole}>
							<h3>Create a role</h3>
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
								Create role
							</Button>
						</form>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
