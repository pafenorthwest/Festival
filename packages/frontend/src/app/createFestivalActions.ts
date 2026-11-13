import { dismissWelcome } from "../lib/api.js";
import {
	completeEmailLinkSignInWithEmail,
	logoutCurrentUser,
	sendPasswordlessEmailLink,
	signInWithGoogle,
} from "../lib/firebase-auth.js";
import type { SignInModalKind } from "./appTypes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";
import {
	type FestivalDataLoaders,
	getIdToken,
} from "./createFestivalDataLoaders.js";

function signInIntentFor(state: FestivalAppState, kind: SignInModalKind) {
	const currentRoute = state.route();
	if (kind === "invite" && currentRoute.kind === "invite") {
		return {
			kind: "invite" as const,
			inviteToken: currentRoute.token,
			name: state.signInInviteName().trim(),
		};
	}
	if (kind === "volunteer") {
		if (currentRoute.kind !== "festival-volunteers") {
			throw new Error("Volunteer sign-in must start from a festival page.");
		}
		return {
			kind: "volunteer" as const,
			slug: currentRoute.slug,
			festivalSlug: currentRoute.festivalSlug,
		};
	}
	return { kind: "create-org" as const };
}

export function createFestivalActions(
	state: FestivalAppState,
	_loaders: FestivalDataLoaders,
) {
	async function handleGoogleSignIn(kind: SignInModalKind) {
		state.clearMessages();
		state.setIsBusy(true);
		try {
			const intent = signInIntentFor(state, kind);
			if (kind === "invite" && !state.signInInviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await signInWithGoogle(intent);
			state.setSignInModalKind(null);
			state.setSignInStep("method");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handlePasswordlessSignIn(kind: SignInModalKind) {
		state.clearMessages();
		state.setIsBusy(true);
		try {
			if (!state.signInEmail().trim()) {
				throw new Error("Email address is required.");
			}

			const intent = signInIntentFor(state, kind);
			if (kind === "invite" && !state.signInInviteName().trim()) {
				throw new Error("Name is required when accepting an invite.");
			}

			await sendPasswordlessEmailLink({
				email: state.signInEmail().trim(),
				intent,
			});
			state.setStatusMessage(
				"Sign-in email sent. Open the email link on this device to continue.",
			);
			state.setSignInModalKind(null);
			state.setSignInStep("method");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleConfirmEmailLinkSignIn() {
		state.clearMessages();
		state.setIsBusy(true);
		try {
			if (!state.signInEmail().trim()) {
				throw new Error("Email address is required.");
			}

			await completeEmailLinkSignInWithEmail(state.signInEmail().trim());
			state.setNeedsEmailLinkConfirmation(false);
			state.setSignInEmail("");
			state.setStatusMessage("Email link verified. Continuing sign-in.");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	async function handleDismissWelcome() {
		const user = state.firebaseUser();
		const membership = state.sessionMembership();
		if (!user || !membership) {
			return;
		}

		try {
			const token = await getIdToken(user);
			if (!token) {
				return;
			}
			const response = await dismissWelcome(token, membership.organizationSlug);
			state.setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			state.setMemberships((current) =>
				current.map((entry) =>
					entry.organizationSlug === response.membership.organizationSlug
						? response.membership
						: entry,
				),
			);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		}
	}

	async function handleLogout() {
		state.setIsBusy(true);
		state.clearMessages();
		try {
			await logoutCurrentUser();
			state.setFirebaseUser(null);
			state.setSession({ authenticated: false });
			state.setMemberships([]);
			state.resetOnboardingFlowState();
			state.navigate("/");
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		} finally {
			state.setIsBusy(false);
		}
	}

	return {
		handleConfirmEmailLinkSignIn,
		handleDismissWelcome,
		handleGoogleSignIn,
		handleLogout,
		handlePasswordlessSignIn,
	};
}

export type FestivalActions = ReturnType<typeof createFestivalActions>;
