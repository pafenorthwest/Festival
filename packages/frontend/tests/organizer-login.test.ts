import { describe, expect, it } from "bun:test";
import type { SessionMembership } from "@festival/common";
import type { User } from "firebase/auth";
import type { FestivalAppState } from "../src/app/createFestivalAppState.js";
import { createFestivalDataLoaders } from "../src/app/createFestivalDataLoaders.js";
import { isOrganizerLoginEmailLink } from "../src/lib/firebase-auth.js";
import { STAFF_ORGANIZATION_CHOOSER_PATH } from "../src/lib/routes.js";

const actionParams = "apiKey=test-key&oobCode=test-code&mode=signIn";
const callback = "https://festival.example/?organizer-login=1";

describe("organizer login email callbacks", () => {
	it("recognizes the login intent without access to the requesting browser's storage", () => {
		expect(isOrganizerLoginEmailLink(`${callback}&${actionParams}`)).toBe(true);
		expect(
			isOrganizerLoginEmailLink(
				`https://festival.example/?${actionParams}&continueUrl=${encodeURIComponent(callback)}`,
			),
		).toBe(true);
	});

	it("requires a Firebase sign-in link and ignores other flows and origins", () => {
		expect(isOrganizerLoginEmailLink(callback)).toBe(false);
		expect(
			isOrganizerLoginEmailLink(
				`https://festival.example/create-organization?${actionParams}`,
			),
		).toBe(false);
		expect(
			isOrganizerLoginEmailLink(
				`https://festival.example/?${actionParams}&continueUrl=${encodeURIComponent(
					"https://other.example/?organizer-login=1",
				)}`,
			),
		).toBe(false);
	});
});

const membership: SessionMembership = {
	organizationId: "org-alpha",
	organizationName: "Alpha Festival",
	organizationSlug: "alpha",
	role: "Admin",
	showWelcome: false,
};
const otherMembership: SessionMembership = {
	...membership,
	organizationId: "org-beta",
	organizationName: "Beta Festival",
	organizationSlug: "beta",
};
const organizer = {
	uid: "organizer",
	getIdToken: async () => "test-token",
} as User;

async function routeOrganizer(
	memberships: SessionMembership[],
	currentUser = organizer,
	alsoRefreshSession = false,
) {
	const destinations: string[] = [];
	const errors: string[] = [];
	const requests: string[] = [];
	const session = { authenticated: true, membership: otherMembership };
	const state = {
		firebaseUser: () => currentUser,
		session: () => session,
		route: () => ({ kind: "home" }),
		setSession: () => {},
		setIsSessionLoading: () => {},
		setMemberships: () => {},
		navigate: (path: string) => destinations.push(path),
		setErrorMessage: (message: string) => errors.push(message),
	} as unknown as FestivalAppState;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string) => {
		requests.push(input);
		return Response.json(
			input.endsWith("/firebase-session") ? { session } : { memberships },
		);
	}) as typeof fetch;
	try {
		const loaders = createFestivalDataLoaders(state);
		const route = loaders.routeAfterOrganizerLogin(organizer);
		if (alsoRefreshSession) await loaders.refreshSession(currentUser);
		await route;
		return { destinations, errors, requests };
	} finally {
		globalThis.fetch = originalFetch;
	}
}

describe("organizer login destinations", () => {
	it("routes one membership to its admin page", async () => {
		const result = await routeOrganizer([membership]);
		expect(result.destinations).toEqual(["/org/alpha/admin"]);
		expect(result.errors).toEqual([]);
	});

	it("routes multiple memberships to the chooser", async () => {
		const result = await routeOrganizer([membership, otherMembership]);
		expect(result.destinations).toEqual([STAFF_ORGANIZATION_CHOOSER_PATH]);
		expect(result.errors).toEqual([]);
	});

	it("keeps accounts without membership on the homepage", async () => {
		const result = await routeOrganizer([]);
		expect(result.destinations).toEqual([]);
		expect(result.errors[0]).toContain(
			"Try logging in with a different account",
		);
	});

	it("ignores a login result for a replaced account", async () => {
		const result = await routeOrganizer([membership], {
			...organizer,
			uid: "replaced",
		});
		expect(result.destinations).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(result.requests).toEqual([]);
	});

	it("reuses an in-flight refresh and requests the session before memberships", async () => {
		const result = await routeOrganizer([membership], organizer, true);
		expect(result.requests).toEqual([
			"/api/firebase-session",
			"/api/memberships",
		]);
		expect(result.destinations).toEqual(["/org/alpha/admin"]);
	});
});
