import type {
	AuthenticatedUser,
	InviteSummary,
	OrganizationLandingResponse,
	OrganizationRole,
	SessionResponse,
} from "@festival/common";
import { ORGANIZATION_ROLES } from "@festival/common";
import type { User } from "firebase/auth";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import {
	acceptInvite,
	createInvite,
	createOrganization,
	dismissWelcome,
	getInvite,
	getOrganization,
	getSession,
} from "./lib/api.js";
import {
	clearPendingIntent,
	completePasswordlessEmailLinkSignIn,
	logoutCurrentUser,
	readPendingIntent,
	sendPasswordlessEmailLink,
	signInWithGoogle,
	subscribeToAuthChanges,
} from "./lib/firebase-auth.js";
import { type AppRoute, buildOrgPath, parseRoute } from "./lib/routes.js";

interface InviteDraft {
	email: string;
	role: OrganizationRole;
}

function navigate(path: string) {
	if (window.location.pathname === path) {
		return;
	}

	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
}

async function getIdToken(user: User | null): Promise<string | null> {
	return user ? user.getIdToken() : null;
}

function toAuthenticatedUser(user: User): AuthenticatedUser {
	return {
		uid: user.uid,
		email: user.email ?? "",
		displayName: user.displayName ?? user.email ?? user.uid,
	};
}

export default function App() {
	const [route, setRoute] = createSignal<AppRoute>(
		parseRoute(window.location.pathname),
	);
	const [firebaseUser, setFirebaseUser] = createSignal<User | null>(null);
	const [session, setSession] = createSignal<SessionResponse["session"]>({
		authenticated: false,
	});
	const [organization, setOrganization] = createSignal<
		OrganizationLandingResponse["organization"] | null
	>(null);
	const [invite, setInvite] = createSignal<InviteSummary | null>(null);
	const [createdOrganizationSlug, setCreatedOrganizationSlug] = createSignal<
		string | null
	>(null);
	const [createdInvites, setCreatedInvites] = createSignal<InviteSummary[]>([]);
	const [signInModalKind, setSignInModalKind] = createSignal<
		"create-org" | "invite" | null
	>(null);
	const [signInEmail, setSignInEmail] = createSignal("");
	const [inviteName, setInviteName] = createSignal("");
	const [organizationName, setOrganizationName] = createSignal("");
	const [inviteDraft, setInviteDraft] = createSignal<InviteDraft>({
		email: "",
		role: "Admin",
	});
	const [statusMessage, setStatusMessage] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [isBusy, setIsBusy] = createSignal(false);

	const sessionMembership = createMemo(() => session().membership ?? null);
	const currentInviteToken = createMemo(() => {
		const currentRoute = route();
		return currentRoute.kind === "invite" ? currentRoute.token : null;
	});
	const authenticatedUser = createMemo(() => {
		const user = firebaseUser();
		return user ? toAuthenticatedUser(user) : null;
	});

	async function refreshSession(userOverride: User | null = firebaseUser()) {
		const token = await getIdToken(userOverride);
		const response = await getSession(token);
		setSession(response.session);
		return response.session;
	}

	async function loadOrganization(slug: string) {
		const token = await getIdToken(firebaseUser());
		if (!token) {
			return;
		}

		const response = await getOrganization(token, slug);
		setOrganization(response.organization);
		setSession((current) => ({
			...current,
			membership: response.membership,
		}));
	}

	async function loadInvite(token: string) {
		try {
			const response = await getInvite(token);
			setInvite(response.invite);
		} catch (error) {
			setErrorMessage((error as Error).message);
		}
	}

	async function handlePostAuthIntent(
		userOverride: User | null = firebaseUser(),
	) {
		const intent = readPendingIntent();
		const nextSession = await refreshSession(userOverride);

		if (nextSession.membership) {
			setCreatedOrganizationSlug(null);
			navigate(buildOrgPath(nextSession.membership.organizationSlug));
			clearPendingIntent();
			return;
		}

		if (intent?.kind === "invite" && currentInviteToken()) {
			const token = await getIdToken(userOverride);
			if (!token) {
				return;
			}

			const response = await acceptInvite(token, intent.inviteToken, {
				name: intent.name,
			});
			setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			navigate(buildOrgPath(response.membership.organizationSlug));
			clearPendingIntent();
			return;
		}

		if (intent?.kind === "create-org") {
			navigate("/create-organization");
			clearPendingIntent();
		}
	}

	onMount(() => {
		const onPopState = () => setRoute(parseRoute(window.location.pathname));
		window.addEventListener("popstate", onPopState);
		onCleanup(() => window.removeEventListener("popstate", onPopState));

		const unsubscribe = subscribeToAuthChanges((user) => {
			setFirebaseUser(user);
			void (async () => {
				try {
					if (user && readPendingIntent()) {
						await handlePostAuthIntent(user);
						return;
					}

					await refreshSession(user);
				} catch (error) {
					setErrorMessage((error as Error).message);
				}
			})();
		});
		onCleanup(() => unsubscribe());

		void (async () => {
			try {
				const pendingIntent = await completePasswordlessEmailLinkSignIn();
				if (pendingIntent) {
					setStatusMessage("Email link verified. Continuing sign-in.");
				}
			} catch (error) {
				setErrorMessage((error as Error).message);
			}

			void refreshSession().catch((error) => {
				setErrorMessage((error as Error).message);
			});
		})();
	});

	createEffect(() => {
		const token = currentInviteToken();
		if (token) {
			void loadInvite(token);
			return;
		}

		setInvite(null);
	});

	createEffect(() => {
		const currentRoute = route();
		const membership = sessionMembership();

		if (currentRoute.kind === "org" && currentRoute.slug && firebaseUser()) {
			void loadOrganization(currentRoute.slug);
			return;
		}

		if (membership && currentRoute.kind === "home") {
			navigate(buildOrgPath(membership.organizationSlug));
			return;
		}

		if (
			currentRoute.kind === "create-org" &&
			membership &&
			createdOrganizationSlug() !== membership.organizationSlug
		) {
			navigate(buildOrgPath(membership.organizationSlug));
		}
	});

	async function handleGoogleSignIn(kind: "create-org" | "invite") {
		setErrorMessage("");
		setIsBusy(true);
		try {
			const intent =
				kind === "invite" && currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: currentInviteToken() ?? "",
							name: inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await signInWithGoogle(intent);
			setSignInModalKind(null);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handlePasswordlessSignIn(kind: "create-org" | "invite") {
		setErrorMessage("");
		setIsBusy(true);
		try {
			if (!signInEmail().trim()) {
				throw new Error("Email address is required.");
			}

			const intent =
				kind === "invite" && currentInviteToken()
					? {
							kind: "invite" as const,
							inviteToken: currentInviteToken() ?? "",
							name: inviteName().trim(),
						}
					: { kind: "create-org" as const };

			if (kind === "invite" && !inviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await sendPasswordlessEmailLink({
				email: signInEmail().trim(),
				intent,
			});
			setStatusMessage(
				"Sign-in email sent. Open the email link on this device to continue.",
			);
			setSignInModalKind(null);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateOrganization() {
		const user = firebaseUser();
		if (!user) {
			setErrorMessage("Sign in before creating an organization.");
			return;
		}

		setIsBusy(true);
		setErrorMessage("");
		try {
			const token = await user.getIdToken();
			const response = await createOrganization(token, {
				name: organizationName(),
			});
			setCreatedOrganizationSlug(response.organization.slug);
			setSession((current) => ({
				...current,
				authenticated: true,
				user: authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			setStatusMessage("Organization created. Invite admins now or continue.");
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleCreateInvite() {
		const user = firebaseUser();
		const membership = sessionMembership();
		if (!user || !membership) {
			setErrorMessage("Create an organization before inviting members.");
			return;
		}

		setIsBusy(true);
		setErrorMessage("");
		try {
			const token = await user.getIdToken();
			const response = await createInvite(token, {
				organizationSlug: membership.organizationSlug,
				email: inviteDraft().email,
				role: inviteDraft().role,
			});
			setCreatedInvites((current) => [...current, response.invite]);
			setInviteDraft({
				email: "",
				role: "Admin",
			});
			setStatusMessage(`Invite created for ${response.invite.email}.`);
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleAcceptInvite() {
		const user = firebaseUser();
		const token = currentInviteToken();
		if (!user || !token) {
			setErrorMessage("Sign in before accepting this invite.");
			return;
		}

		setIsBusy(true);
		setErrorMessage("");
		try {
			const idToken = await user.getIdToken();
			const response = await acceptInvite(idToken, token, {
				name: inviteName(),
			});
			setSession((current) => ({
				...current,
				authenticated: true,
				user: authenticatedUser() ?? undefined,
				membership: response.membership,
			}));
			clearPendingIntent();
			navigate(buildOrgPath(response.membership.organizationSlug));
		} catch (error) {
			setErrorMessage((error as Error).message);
		} finally {
			setIsBusy(false);
		}
	}

	async function handleDismissWelcome() {
		const user = firebaseUser();
		const membership = sessionMembership();
		if (!user || !membership) {
			return;
		}

		try {
			const token = await user.getIdToken();
			const response = await dismissWelcome(token, membership.organizationSlug);
			setSession((current) => ({
				...current,
				membership: response.membership,
			}));
		} catch (error) {
			setErrorMessage((error as Error).message);
		}
	}

	async function handleLogout() {
		try {
			await logoutCurrentUser();
			setFirebaseUser(null);
			setSession({ authenticated: false });
			setOrganization(null);
			setCreatedOrganizationSlug(null);
			navigate("/");
		} catch (error) {
			setErrorMessage((error as Error).message);
		}
	}

	return (
		<main class="shell">
			<header class="masthead">
				<div>
					<p class="eyebrow">Festival Organizational Login</p>
					<h1>Organization onboarding without a default schema safety net.</h1>
					<p class="lede">
						Use Google SSO or passwordless email-link authentication, then land
						in a schema-aware multi-tenant organization flow.
					</p>
				</div>
				<Show when={sessionMembership()}>
					<div class="identity-card">
						<div class="identity-label">Signed in as</div>
						<div>{session().user?.displayName}</div>
						<div class="identity-email">{session().user?.email}</div>
					</div>
				</Show>
			</header>

			<Show when={errorMessage()}>
				<section class="banner error-banner">{errorMessage()}</section>
			</Show>
			<Show when={statusMessage()}>
				<section class="banner status-banner">{statusMessage()}</section>
			</Show>

			<Switch>
				<Match when={route().kind === "home"}>
					<section class="panel hero-panel">
						<h2>Start a new organization</h2>
						<p>
							Choose a sign-in method, create your organization slug, and become
							the initial <code>Admin</code>.
						</p>
						<div class="hero-actions">
							<button
								type="button"
								onClick={() => setSignInModalKind("create-org")}
							>
								Sign up and start an organization
							</button>
						</div>
					</section>
				</Match>

				<Match when={route().kind === "create-org"}>
					<section class="panel flow-panel">
						<h2>Create organization</h2>
						<p>
							Organization names become the route slug and may only use
							lowercase letters and hyphens.
						</p>
						<Show when={!session().authenticated}>
							<p class="muted">
								Sign in first to continue to organization creation.
							</p>
							<button
								type="button"
								onClick={() => setSignInModalKind("create-org")}
							>
								Choose sign-in method
							</button>
						</Show>
						<Show when={session().authenticated}>
							<label class="field">
								<span>Organization name</span>
								<input
									type="text"
									value={organizationName()}
									onInput={(event) =>
										setOrganizationName(event.currentTarget.value)
									}
									placeholder="festival-admins"
								/>
							</label>
							<button
								type="button"
								onClick={handleCreateOrganization}
								disabled={isBusy()}
							>
								Create organization
							</button>
						</Show>
					</section>

					<Show when={sessionMembership()} keyed>
						{(membership) => (
							<Show when={createdOrganizationSlug()}>
								<section class="panel flow-panel">
									<h3>Invite administrators and reviewers</h3>
									<p>
										Add optional invites before continuing to{" "}
										<code>{buildOrgPath(membership.organizationSlug)}</code>.
									</p>
									<label class="field">
										<span>Email</span>
										<input
											type="email"
											value={inviteDraft().email}
											onInput={(event) =>
												setInviteDraft((current) => ({
													...current,
													email: event.currentTarget.value,
												}))
											}
										/>
									</label>
									<label class="field">
										<span>Role</span>
										<select
											value={inviteDraft().role}
											onInput={(event) =>
												setInviteDraft((current) => ({
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
											onClick={handleCreateInvite}
											disabled={isBusy()}
										>
											Send invite
										</button>
										<button
											type="button"
											class="secondary-button"
											onClick={() =>
												navigate(buildOrgPath(membership.organizationSlug))
											}
										>
											Continue to organization
										</button>
									</div>
									<Show when={createdInvites().length > 0}>
										<ul class="invite-list">
											<For each={createdInvites()}>
												{(entry) => (
													<li>
														<strong>{entry.email}</strong>
														<span>{entry.role}</span>
														<code>
															{window.location.origin}/invite/{entry.token}
														</code>
													</li>
												)}
											</For>
										</ul>
									</Show>
								</section>
							</Show>
						)}
					</Show>
				</Match>

				<Match when={route().kind === "invite"}>
					<section class="panel flow-panel">
						<h2>Invitation landing</h2>
						<p>
							Accept the invite and join the organization with your assigned
							role.
						</p>
						<Show when={invite()} keyed>
							{(inviteSummary) => (
								<div class="invite-summary">
									<div>
										<strong>Organization:</strong>{" "}
										{inviteSummary.organizationName}
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
								value={inviteName()}
								onInput={(event) => setInviteName(event.currentTarget.value)}
								placeholder="Your name"
							/>
						</label>
						<Show when={!session().authenticated}>
							<button
								type="button"
								onClick={() => setSignInModalKind("invite")}
							>
								Sign up to accept invite
							</button>
						</Show>
						<Show when={session().authenticated && !sessionMembership()}>
							<button
								type="button"
								onClick={handleAcceptInvite}
								disabled={isBusy()}
							>
								Accept invite
							</button>
						</Show>
					</section>
				</Match>

				<Match when={route().kind === "org"}>
					<section class="panel org-shell">
						<header class="org-header">
							<button
								type="button"
								class="org-title"
								onClick={() => {
									const membership = sessionMembership();
									if (!membership) {
										return;
									}

									navigate(buildOrgPath(membership.organizationSlug));
								}}
							>
								{organization()?.name ?? sessionMembership()?.organizationName}
							</button>
							<button
								type="button"
								class="secondary-button"
								onClick={handleLogout}
							>
								Log out
							</button>
						</header>

						<Show when={sessionMembership()?.showWelcome}>
							<div class="welcome-box">
								<div>
									<strong>Welcome to the organization.</strong>
									<p>
										This is your first landing after invite acceptance. Future
										getting-started instructions can live here.
									</p>
								</div>
								<button type="button" onClick={handleDismissWelcome}>
									Dismiss
								</button>
							</div>
						</Show>

						<p class="org-copy">
							Welcome to{" "}
							{organization()?.name ?? sessionMembership()?.organizationName}{" "}
							you are {sessionMembership()?.role} role
						</p>
					</section>
				</Match>
			</Switch>

			<Show when={signInModalKind()} keyed>
				{(modalKind) => (
					<div class="modal-backdrop" role="presentation">
						<section class="modal-card" role="dialog" aria-modal="true">
							<h3>
								{modalKind === "invite"
									? "Accept organization invite"
									: "Choose a sign-in method"}
							</h3>
							<p>
								Use Google SSO or request a passwordless email link. Cancel
								returns to the no-organization landing page.
							</p>
							<label class="field">
								<span>Email address</span>
								<input
									type="email"
									value={signInEmail()}
									onInput={(event) => setSignInEmail(event.currentTarget.value)}
									placeholder="you@example.com"
								/>
							</label>
							<Show when={modalKind === "invite"}>
								<label class="field">
									<span>Name</span>
									<input
										type="text"
										value={inviteName()}
										onInput={(event) =>
											setInviteName(event.currentTarget.value)
										}
										placeholder="Your full name"
									/>
								</label>
							</Show>
							<div class="modal-actions">
								<button
									type="button"
									onClick={() => void handleGoogleSignIn(modalKind)}
									disabled={isBusy()}
								>
									Continue with Google
								</button>
								<button
									type="button"
									class="secondary-button"
									onClick={() => void handlePasswordlessSignIn(modalKind)}
									disabled={isBusy()}
								>
									Send email link
								</button>
							</div>
							<button
								type="button"
								class="link-button"
								onClick={() => {
									setSignInModalKind(null);
									navigate("/");
								}}
							>
								Cancel
							</button>
						</section>
					</div>
				)}
			</Show>
		</main>
	);
}
