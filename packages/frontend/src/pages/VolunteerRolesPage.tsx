import {
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
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

	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	// Volunteer activity is scoped to one festival (see
	// VOLUNTEER-PORTAL.md's "Festival scope"). This page defaults to the
	// organization's primary festival; props.app already loads the
	// festival list for this route (useFestivalLifecycle.ts).
	const primaryFestivalShortName = createMemo(
		() =>
			props.app.festivals().find((festival) => festival.isPrimary)?.shortName ??
			null,
	);

	const [roles, { refetch: refetchRoles }] = createResource(
		() => {
			const token = idToken();
			const festivalShortName = primaryFestivalShortName();
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
		const festivalShortName = primaryFestivalShortName();
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
			const festivalShortName = primaryFestivalShortName();
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
		const festivalShortName = primaryFestivalShortName();
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
		<section class="panel flow-panel">
			<header class="admin-page-header">
				<div>
					<h2>Volunteer Roles</h2>
					<p>Roles volunteers can sign up for at this festival.</p>
				</div>
			</header>
			<Show when={!primaryFestivalShortName()}>
				<p>
					This organization has no primary festival yet. Create a festival and
					mark it primary before managing volunteers.
				</p>
			</Show>
			<Show when={primaryFestivalShortName()}>
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
				<ul class="volunteer-role-list">
					<For each={roles()}>
						{(role) => (
							<li class="volunteer-role-row">
								<strong>{role.displayName}</strong>
								<span>{role.description}</span>
								<Show when={role.isRoomProctor}>
									<span class="badge">Room Proctor</span>
								</Show>
								<Show when={props.app.isAdminMember()}>
									<Button
										type="button"
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
							</li>
						)}
					</For>
				</ul>

				<Show when={props.app.isAdminMember() && selectedRole()}>
					{(role) => (
						<section class="flow-panel">
							<h3>Shifts for {role().displayName}</h3>
							<Show when={shifts.loading}>
								<p>Loading shifts…</p>
							</Show>
							<Show when={shifts() && shifts()?.length === 0}>
								<p>No shifts have been created for this role yet.</p>
							</Show>
							<ul class="volunteer-role-list">
								<For each={shifts()}>
									{(shift) => (
										<li class="volunteer-role-row">
											<strong>
												{shift.date} {shift.period}
											</strong>
											<Show when={shift.timeText}>
												<span>{shift.timeText}</span>
											</Show>
											<Show when={shift.division || shift.adjudicator}>
												<span>
													{shift.division} / {shift.adjudicator}
												</span>
											</Show>
										</li>
									)}
								</For>
							</ul>

							<form class="flow-panel" onSubmit={handleCreateShift}>
								<h3>Add a shift</h3>
								<Show when={role().isRoomProctor}>
									<p class="muted">
										This is a Room Proctor role, so each shift needs a Division
										and Adjudicator.
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

				<Show when={props.app.isAdminMember()}>
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
	);
}
