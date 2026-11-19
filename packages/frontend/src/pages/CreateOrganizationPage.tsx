import type { OrganizationRole } from "@festival/common";
import { ORGANIZATION_ROLES } from "@festival/common";
import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { useAdminOrg } from "../domains/admin-org/AdminOrgContext.js";
import { buildOrgPath } from "../lib/routes.js";

interface CreateOrganizationPageProps {
	app: FestivalAppController;
}

export function CreateOrganizationPage(props: CreateOrganizationPageProps) {
	const adminOrg = useAdminOrg();
	return (
		<>
			<section class="panel flow-panel">
				<h2>Create organization</h2>
				<p>Enter your full organization name and a short abbreviation.</p>
				<Show when={!props.app.session().authenticated}>
					<p class="muted">
						Sign in first to continue to organization creation.
					</p>
					<Button
						type="button"
						onClick={() => props.app.openSignInModal("create-org")}
					>
						Choose sign-in method
					</Button>
				</Show>
				<Show when={props.app.session().authenticated}>
					<label class="field">
						<span>Organization name</span>
						<input
							type="text"
							value={adminOrg.organizationName()}
							onInput={(event) => {
								adminOrg.setOrganizationNameTouched(true);
								adminOrg.setOrganizationName(event.currentTarget.value);
							}}
							placeholder="Performing Arts Festival"
							aria-invalid={adminOrg.hasOrganizationNameError()}
							readOnly={adminOrg.organizationCreated()}
						/>
						<small>The full name of your organization</small>
					</label>
					<label class="field">
						<span>Short name</span>
						<input
							type="text"
							value={adminOrg.organizationShortName()}
							onInput={(event) => {
								adminOrg.setOrganizationShortNameTouched(true);
								adminOrg.setOrganizationShortName(event.currentTarget.value);
							}}
							placeholder="pafe"
							aria-invalid={adminOrg.hasOrganizationShortNameError()}
							readOnly={adminOrg.organizationCreated()}
						/>
						<small>Easy to remember short name: up to 16 characters</small>
						<small>Letters, numbers, and hyphens only</small>
					</label>
					<Show
						when={
							adminOrg.shouldShowOrganizationValidation() &&
							adminOrg.organizationValidationMessage()
						}
					>
						<section class="banner error-banner validation-banner">
							{adminOrg.organizationValidationMessage()}
						</section>
					</Show>
					<Button
						type="button"
						onClick={adminOrg.handleCreateOrganization}
						disabled={props.app.isBusy() || adminOrg.organizationCreated()}
					>
						Create organization
					</Button>
				</Show>
			</section>

			<Show when={props.app.sessionMembership()} keyed>
				{(membership) => (
					<Show when={adminOrg.organizationCreated()}>
						<section
							class="panel flow-panel"
							ref={(element) => adminOrg.setInvitePanelRef(element)}
						>
							<h3>Invite administrators and reviewers</h3>
							<p>Optional: send out additional invites before continuing.</p>
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
							<div class="stack-actions">
								<Button
									type="button"
									onClick={adminOrg.handleCreateInvite}
									disabled={props.app.isBusy()}
								>
									{adminOrg.createdInvites().length > 0
										? "Send another invite"
										: "Send invite"}
								</Button>
								<Button
									type="button"
									variant="secondary"
									data-preload-path={buildOrgPath(membership.organizationSlug)}
									onClick={() =>
										props.app.navigate(
											buildOrgPath(membership.organizationSlug),
										)
									}
								>
									Continue to organization
								</Button>
							</div>
							<Show when={adminOrg.inviteFeedback()} keyed>
								{(feedback) => (
									<div
										class={`invite-feedback invite-feedback-${feedback.status}`}
									>
										<sup aria-hidden="true" />
										<span class="sr-only">
											{feedback.status === "success"
												? "Invite sent"
												: "Invite failed"}
										</span>
										<span>{feedback.email}</span>
										<span>{feedback.role}</span>
									</div>
								)}
							</Show>
							<Show when={adminOrg.createdInvites().length > 0}>
								<ul class="invite-list">
									<For each={adminOrg.createdInvites()}>
										{(entry) => (
											<li>
												<strong>{entry.email}</strong>
												<span>{entry.role}</span>
											</li>
										)}
									</For>
								</ul>
							</Show>
						</section>
					</Show>
				)}
			</Show>
		</>
	);
}
