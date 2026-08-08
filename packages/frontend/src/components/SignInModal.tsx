import { Match, Show, Switch } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";

interface SignInModalProps {
	app: FestivalAppController;
}

export function SignInModal(props: SignInModalProps) {
	return (
		<Show when={props.app.signInModalKind()} keyed>
			{(modalKind) => (
				<div class="modal-backdrop" role="presentation">
					<section
						class="modal-card sign-in-card"
						role="dialog"
						aria-modal="true"
					>
						<h3>
							{modalKind === "invite"
								? "Accept organization invite"
								: "Choose a sign-in method"}
						</h3>
						<Show when={modalKind === "invite"}>
							<label class="field">
								<span>Name</span>
								<input
									type="text"
									value={props.app.inviteName()}
									onInput={(event) =>
										props.app.setInviteName(event.currentTarget.value)
									}
									placeholder="Your full name"
								/>
							</label>
						</Show>
						<Switch>
							<Match when={props.app.signInStep() === "method"}>
								<div class="auth-method-stack">
									<button
										type="button"
										onClick={() => void props.app.handleGoogleSignIn(modalKind)}
										disabled={props.app.isBusy()}
									>
										Google Auth
									</button>
									<button
										type="button"
										class="secondary-button"
										onClick={() => props.app.setSignInStep("email")}
										disabled={props.app.isBusy()}
									>
										Email Link Auth
									</button>
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
										<button
											type="button"
											onClick={() =>
												void props.app.handlePasswordlessSignIn(modalKind)
											}
											disabled={props.app.isBusy()}
										>
											Send email link
										</button>
										<button
											type="button"
											class="secondary-button"
											onClick={() => props.app.setSignInStep("method")}
											disabled={props.app.isBusy()}
										>
											Back
										</button>
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
