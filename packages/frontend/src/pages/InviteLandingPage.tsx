import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { useAdminOrg } from "../domains/admin-org/AdminOrgContext.js";

interface InviteLandingPageProps {
	app: FestivalAppController;
}

export function InviteLandingPage(props: InviteLandingPageProps) {
	const adminOrg = useAdminOrg();
	return (
		<section class="panel flow-panel">
			<h2>Invitation landing</h2>
			<p>
				Accept the invite and join the organization with your assigned role.
			</p>
			<Show when={adminOrg.invite()} keyed>
				{(inviteSummary) => (
					<div class="invite-summary">
						<div>
							<strong>Organization:</strong> {inviteSummary.organizationName}
						</div>
						<div>
							<strong>Assigned role:</strong> {inviteSummary.role}
						</div>
						<div>
							<strong>Invite email:</strong> {inviteSummary.email}
						</div>
					</div>
				)}
			</Show>
			<label class="field">
				<span>Name</span>
				<input
					type="text"
					value={adminOrg.inviteName()}
					onInput={(event) => adminOrg.setInviteName(event.currentTarget.value)}
					placeholder="Your name"
				/>
			</label>
			<Show when={!props.app.session().authenticated}>
				<Button
					type="button"
					onClick={() =>
						props.app.openSignInModal("invite", adminOrg.inviteName())
					}
				>
					Sign up to accept invite
				</Button>
			</Show>
			<Show
				when={
					props.app.session().authenticated && !props.app.sessionMembership()
				}
			>
				<Button
					type="button"
					onClick={adminOrg.handleAcceptInvite}
					disabled={props.app.isBusy()}
				>
					Accept invite
				</Button>
			</Show>
		</section>
	);
}
