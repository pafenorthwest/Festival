import { Match, Show, Switch } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "./Button.js";

interface SignInModalProps {
	app: FestivalAppController;
}

const signInHeadings = {
	"create-org": "Choose a sign-in method",
	invite: "Accept organization invite",
	login: "Log in to your account",
	volunteer: "Choose a sign-in method",
};

export function SignInModal(props: SignInModalProps) {
	const homeSignUp = () =>
		props.app.route().kind === "home" &&
		props.app.signInModalKind() === "create-org";

	return (
		<Show when={props.app.signInModalKind()} keyed>
			{(modalKind) => (
				<div class="modal-backdrop" role="presentation">
					<section
						class="modal-card sign-in-card"
						role="dialog"
						aria-modal="true"
						aria-labelledby="sign-in-modal-heading"
					>
						<h3 id="sign-in-modal-heading">
							{homeSignUp()
								? "Start a new organization"
								: signInHeadings[modalKind]}
						</h3>
						<Show when={modalKind === "login"}>
							<p>Choose a sign-in method for your existing account.</p>
						</Show>
						<Show when={homeSignUp()}>
							<p>Choose a sign-in method to get started.</p>
						</Show>
						<Show when={modalKind === "invite"}>
							<label class="field">
								<span>Name</span>
								<input
									type="text"
									value={props.app.signInInviteName?.() ?? ""}
									onInput={(event) =>
										props.app.setSignInInviteName?.(event.currentTarget.value)
									}
									placeholder="Your full name"
								/>
							</label>
						</Show>
						<Switch>
							<Match when={props.app.signInStep() === "method"}>
								<div class="auth-method-stack">
									<Button
										type="button"
										onClick={() => void props.app.handleGoogleSignIn(modalKind)}
										disabled={props.app.isBusy()}
									>
										Google Auth
									</Button>
									<Button
										type="button"
										variant="secondary"
										onClick={() => props.app.setSignInStep("email")}
										disabled={props.app.isBusy()}
									>
										Email Link Auth
									</Button>
								</div>
							</Match>
							<Match when={props.app.signInStep() === "email"}>
								<div class="email-link-step">
									<label class="field">
										<span>Email address</span>
										<input
											type="email"
											value={props.app.signInEmail()}
											onInput={(event) =>
												props.app.setSignInEmail(event.currentTarget.value)
											}
											placeholder="you@example.com"
										/>
									</label>
									<div class="modal-actions">
										<Button
											type="button"
											onClick={() =>
												void props.app.handlePasswordlessSignIn(modalKind)
											}
											disabled={props.app.isBusy()}
										>
											Send email link
										</Button>
										<Button
											type="button"
											variant="secondary"
											onClick={() => props.app.setSignInStep("method")}
											disabled={props.app.isBusy()}
										>
											Back
										</Button>
									</div>
								</div>
							</Match>
						</Switch>
						<button
							type="button"
							class="link-button"
							onClick={props.app.closeSignInModal}
						>
							Cancel
						</button>
					</section>
				</div>
			)}
		</Show>
	);
}
