import type { SessionResponse } from "@festival/common";
import type { User } from "firebase/auth";
import {
	getBootstrap,
	getFirebaseSession,
	getMemberships,
	getOrganization,
} from "../lib/api.js";
import {
	type AppRoute,
	buildOrgPath,
	STAFF_ORGANIZATION_CHOOSER_PATH,
} from "../lib/routes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";

export async function getIdToken(user: User | null): Promise<string | null> {
	return user ? user.getIdToken() : null;
}

export function mergeSessionWithOrgMembership(
	current: SessionResponse["session"],
	incoming: SessionResponse["session"],
	route: AppRoute,
): SessionResponse["session"] {
	const routeSlug =
		"slug" in route && typeof route.slug === "string"
			? route.slug.toLowerCase()
			: null;
	const currentSlug = current.membership?.organizationSlug.toLowerCase();
	const incomingSlug = incoming.membership?.organizationSlug.toLowerCase();
	if (
		incoming.authenticated &&
		routeSlug !== null &&
		currentSlug === routeSlug &&
		incomingSlug !== routeSlug
	) {
		return { ...incoming, membership: current.membership };
	}
	return incoming;
}

export function createFestivalDataLoaders(state: FestivalAppState) {
	let latestSessionRequest = 0;
	let latestOrganizationRequest = 0;

	async function refreshSession(
		userOverride: User | null = state.firebaseUser(),
	) {
		const requestId = ++latestSessionRequest;
		const expectedUid = userOverride?.uid ?? null;
		state.setIsSessionLoading(true);
		try {
			const token = await getIdToken(userOverride);
			const response = token
				? await getFirebaseSession(token)
				: await getBootstrap();
			if (
				requestId !== latestSessionRequest ||
				(state.firebaseUser()?.uid ?? null) !== expectedUid
			) {
				return response.session;
			}
			state.setSession((current) =>
				mergeSessionWithOrgMembership(current, response.session, state.route()),
			);

			if (!token) {
				state.setMemberships([]);
				return response.session;
			}

			const membershipResponse = await getMemberships(token);
			if (
				requestId !== latestSessionRequest ||
				(state.firebaseUser()?.uid ?? null) !== expectedUid
			) {
				return response.session;
			}
			state.setMemberships(membershipResponse.memberships);
			return response.session;
		} finally {
			if (requestId === latestSessionRequest) {
				state.setIsSessionLoading(false);
			}
		}
	}

	async function routeAfterSession(
		nextSession: SessionResponse["session"],
		userOverride: User | null = state.firebaseUser(),
	) {
		const token = await getIdToken(userOverride);
		if (!token) {
			return;
		}

		const membershipResponse = await getMemberships(token);
		state.setMemberships(membershipResponse.memberships);

		if (membershipResponse.memberships.length > 1) {
			state.navigate(STAFF_ORGANIZATION_CHOOSER_PATH);
			return;
		}

		const membership =
			membershipResponse.memberships[0] ?? nextSession.membership ?? null;
		if (membership) {
			state.navigate(buildOrgPath(membership.organizationSlug));
			return;
		}

		state.navigate("/create-organization");
	}

	async function loadOrganization(slug: string) {
		const user = state.firebaseUser();
		if (!user) {
			return;
		}
		const requestId = ++latestOrganizationRequest;
		const expectedUid = user.uid;
		state.setIsOrganizationLoading(true);
		try {
			const token = await getIdToken(user);
			if (
				!token ||
				requestId !== latestOrganizationRequest ||
				(state.firebaseUser()?.uid ?? null) !== expectedUid
			) {
				return;
			}

			const response = await getOrganization(token, slug);
			if (
				requestId !== latestOrganizationRequest ||
				(state.firebaseUser()?.uid ?? null) !== expectedUid
			) {
				return;
			}
			state.setOrganization(response.organization);
			state.setSession((current) => ({
				...current,
				membership: response.membership,
			}));
		} finally {
			if (requestId === latestOrganizationRequest) {
				state.setIsOrganizationLoading(false);
			}
		}
	}

	return {
		loadOrganization,
		refreshSession,
		routeAfterSession,
	};
}

export type FestivalDataLoaders = ReturnType<typeof createFestivalDataLoaders>;
