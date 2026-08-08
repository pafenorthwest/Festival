import type { OrganizationRole } from "@festival/common";
import { ORGANIZATION_ROLES } from "@festival/common";
import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";

interface AdminUsersPageProps {
	app: FestivalAppController;
}

export function AdminUsersPage(props: AdminUsersPageProps) {
	return (
		<Show
			when={props.app.isAdminMember()}
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
				<div class="admin-list">
					<For each={props.app.adminUsers()}>
						{(entry) => (
							<div class={`admin-user-row admin-user-row-${entry.status}`}>
								<span class="status-dot" aria-hidden="true" />
								<strong>{entry.email}</strong>
								<span>{entry.role}</span>
								<button
									type="button"
									class="icon-button trash-button"
									aria-label={`Remove ${entry.email}`}
									onClick={() => void props.app.handleDeleteAdminUser(entry)}
									disabled={props.app.isBusy() || entry.isSelf}
								/>
							</div>
						)}
					</For>
				</div>
				<label class="field">
					<span>Email</span>
					<input
						type="email"
						value={props.app.inviteDraft().email}
						onInput={(event) =>
							props.app.setInviteDraft((current) => ({
								...current,
								email: event.currentTarget.value,
							}))
						}
					/>
				</label>
				<label class="field">
					<span>Role</span>
					<select
						value={props.app.inviteDraft().role}
						onInput={(event) =>
							props.app.setInviteDraft((current) => ({
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
				<button
					type="button"
					onClick={props.app.handleCreateAdminInvite}
					disabled={props.app.isBusy()}
				>
					Send invite
				</button>
			</section>
		</Show>
	);
}
