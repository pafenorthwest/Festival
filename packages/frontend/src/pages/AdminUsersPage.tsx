import type { OrganizationRole } from "@festival/common";
import { ORGANIZATION_ROLES } from "@festival/common";
import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { useAdminOrg } from "../domains/admin-org/AdminOrgContext.js";

interface AdminUsersPageProps {
	app: FestivalAppController;
}

export function AdminUsersPage(props: AdminUsersPageProps) {
	const adminOrg = useAdminOrg();
	const isBusy = () =>
		props.app.isBusy() || adminOrg.isAdminUsersMutationPending();
	return (
		<Show
			when={
				adminOrg.canManageAdminUsers() ||
				adminOrg.isLoadingAdminUsers() ||
				adminOrg.adminUsersLoadError()
			}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage organization users." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Users</h2>
						<p>Accepted members and pending invites.</p>
					</div>
				</header>
				<Show when={adminOrg.adminUsersStatusMessage()}>
					{(message) => <p role="status">{message()}</p>}
				</Show>
				<Show when={adminOrg.isLoadingAdminUsers()}>
					<p role="status">Loading organization users…</p>
				</Show>
				<Show when={adminOrg.adminUsersLoadError()}>
					{(message) => (
						<>
							<p class="field-error" role="alert">
								{message()}
							</p>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void adminOrg.retryAdminUsers()}
							>
								Try again
							</Button>
						</>
					)}
				</Show>
				<Show when={adminOrg.canManageAdminUsers()}>
					<Show when={adminOrg.adminUsersMutationError()}>
						{(message) => (
							<p class="field-error" role="alert">
								{message()}
							</p>
						)}
					</Show>
					<div class="admin-list">
						<For each={adminOrg.adminUsers()}>
							{(entry) => (
								<div class={`admin-user-row admin-user-row-${entry.status}`}>
									<span class="status-dot" aria-hidden="true" />
									<strong>{entry.email}</strong>
									<span>{entry.role}</span>
									<button
										type="button"
										class="icon-button trash-button"
										aria-label={`Remove ${entry.email}`}
										onClick={() => void adminOrg.handleDeleteAdminUser(entry)}
										disabled={isBusy() || entry.isSelf}
									/>
								</div>
							)}
						</For>
					</div>
					<label class="field">
						<span>Email</span>
						<input
							type="email"
							value={adminOrg.inviteDraft().email}
							onInput={(event) =>
								adminOrg.setInviteDraft((current) => ({
									...current,
									email: event.currentTarget.value,
								}))
							}
						/>
					</label>
					<label class="field">
						<span>Role</span>
						<select
							value={adminOrg.inviteDraft().role}
							onInput={(event) =>
								adminOrg.setInviteDraft((current) => ({
									...current,
									role: event.currentTarget.value as OrganizationRole,
								}))
							}
						>
							<For each={ORGANIZATION_ROLES}>
								{(role) => <option value={role}>{role}</option>}
							</For>
						</select>
					</label>
					<Button
						type="button"
						onClick={adminOrg.handleCreateAdminInvite}
						disabled={isBusy()}
					>
						Send invite
					</Button>
				</Show>
			</section>
		</Show>
	);
}
