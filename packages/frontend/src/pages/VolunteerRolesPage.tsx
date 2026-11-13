import {
	type Accessor,
	createResource,
	For,
	type Setter,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { FestivalSelector } from "../components/FestivalSelector.js";
import { useVolunteerRolesState } from "../domains/volunteers/useVolunteerRolesState.js";
import { VolunteerCoverageGapsPanel } from "../domains/volunteers/VolunteerCoverageGapsPanel.js";
import { VolunteerRoleForm } from "../domains/volunteers/VolunteerRoleForm.js";
import { VolunteerShiftsPanel } from "../domains/volunteers/VolunteerShiftsPanel.js";
import { useVolunteers } from "../domains/volunteers/VolunteersContext.js";
import { getVolunteerRoles, type VolunteerRole } from "../lib/api.js";
import { useAdminFestivalSelection } from "./useAdminFestivalSelection.js";

interface VolunteerRolesPageProps {
	app: FestivalAppController;
	slug: string;
}

function VolunteerRolesTable(props: {
	roles: VolunteerRole[];
	hasVolunteerAdminIntent: boolean;
	selectedRoleId: Accessor<string | null>;
	deletingRoleId: Accessor<string | null>;
	setSelectedRoleId: Setter<string | null>;
	cancelEditShift: () => void;
	startEditRole: (role: VolunteerRole) => void;
	handleDeleteRole: (role: VolunteerRole) => void;
}) {
	return (
		<div class="listing-table volunteer-roles-table">
			<div class="listing-table-header">
				<span>Role</span>
				<span>Type</span>
				<span>Actions</span>
			</div>
			<For each={props.roles}>
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
							<Show when={props.hasVolunteerAdminIntent}>
								<Button
									type="button"
									variant="secondary"
									onClick={() => {
										props.cancelEditShift();
										props.setSelectedRoleId((current) =>
											current === role.id ? null : role.id,
										);
									}}
								>
									{props.selectedRoleId() === role.id
										? "Hide shifts"
										: "Manage shifts"}
								</Button>
								<Button
									type="button"
									variant="secondary"
									onClick={() => props.startEditRole(role)}
								>
									Edit
								</Button>
								<Button
									type="button"
									variant="secondary"
									disabled={props.deletingRoleId() === role.id}
									onClick={() => props.handleDeleteRole(role)}
								>
									{props.deletingRoleId() === role.id ? "Deleting…" : "Delete"}
								</Button>
							</Show>
						</span>
					</div>
				)}
			</For>
		</div>
	);
}

export function VolunteerRolesPage(props: VolunteerRolesPageProps) {
	const volunteers = useVolunteers();
	const { idToken, selectedFestival, setSelectedFestivalShortName } =
		useAdminFestivalSelection(() => volunteers.festivals());

	const [roles, { refetch: refetchRoles }] = createResource(
		() => {
			const token = idToken();
			const festivalShortName = selectedFestival()?.shortName;
			return token && festivalShortName
				? ([token, festivalShortName] as const)
				: undefined;
		},
		([token, festivalShortName]) =>
			getVolunteerRoles(token, props.slug, festivalShortName),
	);

	const state = useVolunteerRolesState({
		slug: () => props.slug,
		idToken,
		festivalShortName: () => selectedFestival()?.shortName,
		roles,
		refetchRoles,
	});

	return (
		<Show
			when={volunteers.hasVolunteerAdminIntent()}
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
					<FestivalSelector
						festivals={volunteers.festivals()}
						value={selectedFestival()?.shortName ?? ""}
						onChange={setSelectedFestivalShortName}
					/>
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
						<VolunteerRolesTable
							roles={roles() ?? []}
							hasVolunteerAdminIntent={volunteers.hasVolunteerAdminIntent()}
							selectedRoleId={state.selectedRoleId}
							deletingRoleId={state.deletingRoleId}
							setSelectedRoleId={state.setSelectedRoleId}
							cancelEditShift={state.cancelEditShift}
							startEditRole={state.startEditRole}
							handleDeleteRole={state.handleDeleteRole}
						/>
					</Show>
					<Show
						when={volunteers.hasVolunteerAdminIntent() && state.selectedRole()}
					>
						{(role) => (
							<VolunteerShiftsPanel
								role={role()}
								shifts={state.shifts}
								shiftDraft={state.shiftDraft}
								setShiftDraft={state.setShiftDraft}
								editingShiftId={state.editingShiftId}
								deletingShiftId={state.deletingShiftId}
								isCreatingShift={state.isCreatingShift}
								shiftFormError={state.shiftFormError}
								onStartEditShift={state.startEditShift}
								onCancelEditShift={state.cancelEditShift}
								onDeleteShift={state.handleDeleteShift}
								onSubmitShift={state.handleShiftFormSubmit}
							/>
						)}
					</Show>
					<Show when={volunteers.hasVolunteerAdminIntent()}>
						<VolunteerRoleForm
							roleDraft={state.roleDraft}
							setRoleDraft={state.setRoleDraft}
							editingRoleId={state.editingRoleId}
							isCreatingRole={state.isCreatingRole}
							roleFormError={state.roleFormError}
							onSubmit={state.handleRoleFormSubmit}
							onCancelEdit={state.cancelEditRole}
						/>
						<VolunteerCoverageGapsPanel
							coverageGaps={state.coverageGaps}
							slotStatusFilter={state.slotStatusFilter}
							setSlotStatusFilter={state.setSlotStatusFilter}
							filteredSlots={state.filteredSlots}
						/>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
