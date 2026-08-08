import type { OrganizationRole } from "@festival/common";
import { ORGANIZATION_ROLES } from "@festival/common";
import { For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { buildOrgPath } from "../lib/routes.js";

interface CreateOrganizationPageProps {
	app: FestivalAppController;
}

export function CreateOrganizationPage(props: CreateOrganizationPageProps) {
	return (
		<>
			<section class="panel flow-panel">
				<h2>Create organization</h2>
				<p>Enter your full organization name and a short abbreviation.</p>
				<Show when={!props.app.session().authenticated}>
					<p class="muted">
						Sign in first to continue to organization creation.
					</p>
					<button
						type="button"
						onClick={() => props.app.openSignInModal("create-org")}
					>
						Choose sign-in method
					</button>
				</Show>
				<Show when={props.app.session().authenticated}>
					<label class="field">
						<span>Organization name</span>
						<input
							type="text"
							value={props.app.organizationName()}
							onInput={(event) => {
								props.app.setOrganizationNameTouched(true);
								props.app.setOrganizationName(event.currentTarget.value);
							}}
							placeholder="Performing Arts Festival"
							aria-invalid={props.app.hasOrganizationNameError()}
							readOnly={props.app.organizationCreated()}
						/>
						<small>The full name of your organization</small>
					</label>
					<label class="field">
						<span>Short name</span>
						<input
							type="text"
							value={props.app.organizationShortName()}
							onInput={(event) => {
								props.app.setOrganizationShortNameTouched(true);
								props.app.setOrganizationShortName(event.currentTarget.value);
							}}
							placeholder="pafe"
							aria-invalid={props.app.hasOrganizationShortNameError()}
							readOnly={props.app.organizationCreated()}
						/>
						<small>Easy to remember short name: up to 16 characters</small>
						<small>Letters, numbers, and hyphens only</small>
					</label>
					<Show
						when={
							props.app.shouldShowOrganizationValidation() &&
							props.app.organizationValidationMessage()
						}
					>
						<section class="banner error-banner validation-banner">
							{props.app.organizationValidationMessage()}
						</section>
					</Show>
					<button
						type="button"
						onClick={props.app.handleCreateOrganization}
						disabled={props.app.isBusy() || props.app.organizationCreated()}
					>
						Create organization
					</button>
				</Show>
			</section>

			<Show when={props.app.sessionMembership()} keyed>
				{(membership) => (
					<Show when={props.app.organizationCreated()}>
						<section
							class="panel flow-panel"
							ref={(element) => props.app.setInvitePanelRef(element)}
						>
							<h3>Invite administrators and reviewers</h3>
							<p>Optional: send out additional invites before continuing.</p>
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
							<div class="stack-actions">
								<button
									type="button"
									onClick={props.app.handleCreateInvite}
									disabled={props.app.isBusy()}
								>
									{props.app.createdInvites().length > 0
										? "Send another invite"
										: "Send invite"}
								</button>
								<button
									type="button"
									class="secondary-button"
									onClick={() =>
										props.app.navigate(
											buildOrgPath(membership.organizationSlug),
										)
									}
								>
									Continue to organization
								</button>
							</div>
							<Show when={props.app.inviteFeedback()} keyed>
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
							<Show when={props.app.createdInvites().length > 0}>
								<ul class="invite-list">
									<For each={props.app.createdInvites()}>
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
