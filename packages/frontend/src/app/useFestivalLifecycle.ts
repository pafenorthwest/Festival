import type { User } from "firebase/auth";
import { createEffect, onCleanup, onMount } from "solid-js";
import { acceptInvite } from "../lib/api.js";
import {
	clearPendingIntent,
	completePasswordlessEmailLinkSignIn,
	readPendingIntent,
	subscribeToAuthChanges,
} from "../lib/firebase-auth.js";
import { buildOrgPath } from "../lib/routes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";
import {
	type FestivalDataLoaders,
	getIdToken,
} from "./createFestivalDataLoaders.js";

export function useFestivalLifecycle(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
) {
	async function handlePostAuthIntent(
		userOverride: User | null = state.firebaseUser(),
	) {
		const intent = readPendingIntent();
		const nextSession = await loaders.refreshSession(userOverride);

		if (intent?.kind === "invite" && state.currentInviteToken()) {
			const token = await getIdToken(userOverride);
			if (!token) {
				return;
			}

			const response = await acceptInvite(token, intent.inviteToken, {
				name: intent.name,
			});
			state.setSession((current) => ({
				...current,
				membership: response.membership,
			}));
			state.setMemberships((current) => [...current, response.membership]);
			state.navigate(buildOrgPath(response.membership.organizationSlug));
			clearPendingIntent();
			return;
		}

		if (intent?.kind === "create-org") {
			if (nextSession.membership) {
				await loaders.routeAfterSession(nextSession, userOverride);
			} else {
				state.navigate("/create-organization");
			}
			clearPendingIntent();
			return;
		}

		await loaders.routeAfterSession(nextSession, userOverride);
	}

	onMount(() => {
		const unsubscribe = subscribeToAuthChanges((user) => {
			const previousUser = state.firebaseUser();
			if (previousUser?.uid !== user?.uid) {
				state.resetOnboardingFlowState();
			}

			state.setFirebaseUser(user);
			void (async () => {
				try {
					if (user && readPendingIntent()) {
						await handlePostAuthIntent(user);
						return;
					}

					await loaders.refreshSession(user);
				} catch (error) {
					state.setErrorMessage((error as Error).message);
				}
			})();
		});
		onCleanup(() => unsubscribe());
		onCleanup(state.clearTimers);

		void (async () => {
			try {
				const pendingIntent = await completePasswordlessEmailLinkSignIn();
				if (pendingIntent) {
					state.setStatusMessage("Email link verified. Continuing sign-in.");
				}
			} catch (error) {
				state.setErrorMessage((error as Error).message);
			}

			void loaders.refreshSession().catch((error) => {
				state.setErrorMessage((error as Error).message);
			});
		})();
	});

	createEffect(() => {
		const token = state.currentInviteToken();
		if (token) {
			void loaders.loadInvite(token);
			return;
		}

		state.setInvite(null);
	});

	createEffect(() => {
		const currentRoute = state.route();

		if (
			(currentRoute.kind === "org-root" ||
				currentRoute.kind === "org-admin" ||
				currentRoute.kind === "org-admin-users" ||
				currentRoute.kind === "org-admin-festivals") &&
			currentRoute.slug &&
			state.firebaseUser()
		) {
			void loaders.loadOrganization(currentRoute.slug);
		}
	});

	createEffect(() => {
		const currentRoute = state.route();
		const membership = state.sessionMembership();

		if (
			currentRoute.kind === "home" &&
			state.memberships().length === 1 &&
			state.memberships()[0]
		) {
			state.navigate(buildOrgPath(state.memberships()[0].organizationSlug));
			return;
		}

		if (
			currentRoute.kind === "create-org" &&
			membership &&
			state.createdOrganizationSlug() !== membership.organizationSlug
		) {
			state.navigate(buildOrgPath(membership.organizationSlug));
		}
	});

	createEffect(() => {
		const currentRoute = state.route();
		if (!state.isAdminMember()) {
			return;
		}

		if (currentRoute.kind === "org-admin-users") {
			void loaders.loadAdminUsers(currentRoute.slug);
			return;
		}

		if (currentRoute.kind === "org-admin-festivals") {
			void loaders.loadFestivals(currentRoute.slug);
		}
	});
}
