import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";

interface InviteLandingPageProps {
	app: FestivalAppController;
}

export function InviteLandingPage(props: InviteLandingPageProps) {
	return (
		<section class="panel flow-panel">
			<h2>Invitation landing</h2>
			<p>
				Accept the invite and join the organization with your assigned role.
			</p>
			<Show when={props.app.invite()} keyed>
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
					value={props.app.inviteName()}
					onInput={(event) =>
						props.app.setInviteName(event.currentTarget.value)
					}
					placeholder="Your name"
				/>
			</label>
			<Show when={!props.app.session().authenticated}>
				<Button
					type="button"
					onClick={() => props.app.openSignInModal("invite")}
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
					onClick={props.app.handleAcceptInvite}
					disabled={props.app.isBusy()}
				>
					Accept invite
				</Button>
			</Show>
		</section>
	);
}
