import type { User } from "firebase/auth";
import { createEffect, onCleanup, onMount } from "solid-js";
import { acceptInvite } from "../lib/api.js";
import {
	clearPendingIntent,
	completePasswordlessEmailLinkSignIn,
	MissingPendingEmailError,
	readPendingIntent,
	subscribeToAuthChanges,
} from "../lib/firebase-auth.js";
import {
	type AppRoute,
	buildFestivalVolunteersPath,
	buildOrgPath,
} from "../lib/routes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";
import {
	type FestivalDataLoaders,
	getIdToken,
} from "./createFestivalDataLoaders.js";

const ORGANIZATION_LOAD_ROUTE_KINDS = new Set<AppRoute["kind"]>([
	"org-root",
	"org-admin",
	"org-admin-users",
	"org-admin-integrations",
	"org-admin-memberships",
	"org-admin-festivals",
	"org-admin-divisions",
	"org-admin-volunteers",
	"org-admin-rooms",
	"org-admin-accompanists",
	"org-admin-roster",
	"org-music-review",
	"org-billing",
	"org-communications",
	"org-admin-checkout-recovery",
]);

async function handlePostAuthIntent(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
	userOverride: User | null = state.firebaseUser(),
) {
	const intent = readPendingIntent();
	const nextSession = await loaders.refreshSession(userOverride);

	if (intent?.kind === "invite" && state.route().kind === "invite") {
		const token = await getIdToken(userOverride);
		if (!token) return;

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

	if (intent?.kind === "volunteer") {
		state.navigate(
			buildFestivalVolunteersPath(intent.slug, intent.festivalSlug),
		);
		clearPendingIntent();
		return;
	}
	if (intent?.kind === "create-org") {
		if (nextSession.membership) {
			await loaders.routeAfterSession(nextSession, userOverride);
		} else state.navigate("/create-organization");
		clearPendingIntent();
		return;
	}
	await loaders.routeAfterSession(nextSession, userOverride);
}

async function completeEmailLinkOnMount(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
) {
	try {
		const pendingIntent = await completePasswordlessEmailLinkSignIn();
		if (pendingIntent)
			state.setStatusMessage("Email link verified. Continuing sign-in.");
	} catch (error) {
		if (error instanceof MissingPendingEmailError)
			state.setNeedsEmailLinkConfirmation(true);
		else state.setErrorMessage((error as Error).message);
	}

	void loaders.refreshSession().catch((error) => {
		state.setErrorMessage((error as Error).message);
	});
}

function registerAuthLifecycle(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
) {
	onMount(() => {
		const unsubscribe = subscribeToAuthChanges((user) => {
			if (state.firebaseUser()?.uid !== user?.uid)
				state.resetOnboardingFlowState();
			state.setFirebaseUser(user);
			void (async () => {
				try {
					if (user && readPendingIntent()) {
						await handlePostAuthIntent(state, loaders, user);
						return;
					}
					await loaders.refreshSession(user);
				} catch (error) {
					state.setErrorMessage((error as Error).message);
				}
			})();
		});
		onCleanup(unsubscribe);
		onCleanup(state.clearTimers);
		void completeEmailLinkOnMount(state, loaders);
	});
}

export function useFestivalLifecycle(
	state: FestivalAppState,
	loaders: FestivalDataLoaders,
) {
	registerAuthLifecycle(state, loaders);

	createEffect(() => {
		const currentRoute = state.route();
		state.setParentNavigationOpen(false);
		if ("festivalSlug" in currentRoute) {
			state.parentRegistration.setActiveFestival(
				currentRoute.slug,
				currentRoute.festivalSlug,
			);
		}
		if (
			ORGANIZATION_LOAD_ROUTE_KINDS.has(currentRoute.kind) &&
			"slug" in currentRoute &&
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
			currentRoute.kind === "create-org" &&
			membership &&
			state.createdOrganizationSlug() !== membership.organizationSlug
		) {
			state.navigate(buildOrgPath(membership.organizationSlug));
		}
	});
}
