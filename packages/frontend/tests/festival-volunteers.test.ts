import { afterEach, describe, expect, it } from "bun:test";
import {
	bookVolunteerShifts,
	cancelVolunteerAssignment,
	enrollVolunteer,
	getMyVolunteerSchedule,
	getVolunteerCoverageGaps,
	getVolunteerRoles,
	listVolunteerShifts,
} from "../src/lib/api.js";
import { buildEmailLinkUrl } from "../src/lib/firebase-auth.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
	(globalThis as { window?: unknown }).window = originalWindow;
});

describe("volunteer sign-in flow", () => {
	it("uses volunteer admin intent for volunteer management", async () => {
		const state = await read("../src/app/createFestivalAppState.ts");
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const app = await read("../src/App.tsx");
		const home = await read("../src/pages/AdminHomePage.tsx");

		expect(state).toContain("hasVolunteerAdminIntent");
		expect(state).toContain('"Division Chair"');
		expect(state).toContain('"Concert Chair"');
		expect(lifecycle).toContain('currentRoute.kind === "org-admin-volunteers"');
		expect(lifecycle).toContain("state.hasVolunteerAdminIntent()");
		expect(lifecycle).toContain("loadFestivals(currentRoute.slug)");
		expect(page).toContain("props.app.hasVolunteerAdminIntent()");
		expect(page).toContain("AccessDeniedPanel");
		expect(page).toContain("selectedFestivalShortName");
		expect(page).toContain("<select");
		expect(page).toContain(
			"getVolunteerRoles(token, props.slug, festivalShortName)",
		);
		expect(app).toContain("<VolunteerRolesPage");
		expect(app).toContain("app={app}");
		const volunteersLabelIndex = home.indexOf("<strong>Volunteers</strong>");
		const volunteersCard = home.slice(
			home.lastIndexOf("<button", volunteersLabelIndex),
			volunteersLabelIndex,
		);
		expect(volunteersCard).toContain("props.app.hasVolunteerAdminIntent()");
		expect(volunteersCard).not.toContain("props.app.isAdminMember()");
		const festivalsCard = home.slice(
			home.lastIndexOf("<button", home.indexOf("<strong>Festivals</strong>")),
			home.indexOf("<strong>Festivals</strong>"),
		);
		expect(festivalsCard).toContain("props.app.isAdminMember()");
		expect(festivalsCard).not.toContain("props.app.hasVolunteerAdminIntent()");
	});

	it("loads the URL organization before evaluating a volunteer-admin direct link", async () => {
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");
		const organizationLoadStart = lifecycle.indexOf(
			'currentRoute.kind === "org-root"',
		);
		const organizationLoadCondition = lifecycle.slice(
			organizationLoadStart,
			lifecycle.indexOf("state.firebaseUser()", organizationLoadStart),
		);
		const volunteerAdminLoad = lifecycle.indexOf(
			'currentRoute.kind === "org-admin-volunteers"',
		);
		const volunteerAdminIntent = lifecycle.indexOf(
			"state.hasVolunteerAdminIntent()",
		);

		expect(organizationLoadCondition).toContain(
			'currentRoute.kind === "org-admin-volunteers"',
		);
		expect(volunteerAdminLoad).toBeLessThan(volunteerAdminIntent);
		expect(lifecycle).toContain("loadOrganization(currentRoute.slug)");
	});

	it("requests roles for the selected festival", async () => {
		const originalFetch = globalThis.fetch;
		let request: { url: string; authorization: string | null } | undefined;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			request = {
				url:
					typeof input === "string"
						? input
						: input instanceof URL
							? input.pathname
							: input.url,
				authorization: new Headers(init?.headers).get("Authorization"),
			};
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		try {
			await getVolunteerRoles("token", "pafe nw", "spring 2026");
			expect(request?.url).toBe(
				"/api/organizations/pafe%20nw/festivals/spring%202026/volunteers/roles",
			);
			expect(request?.authorization).toBe("Bearer token");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("returns volunteers to their festival page from the email link, not create-organization", () => {
		(globalThis as { window?: unknown }).window = {
			location: { origin: "https://festival.example" },
		};

		expect(
			buildEmailLinkUrl({
				kind: "volunteer",
				slug: "pafe",
				festivalSlug: "spring",
			}),
		).toBe("https://festival.example/org/pafe/festival/spring/volunteers");
		expect(buildEmailLinkUrl({ kind: "create-org" })).toBe(
			"https://festival.example/create-organization",
		);
		expect(
			buildEmailLinkUrl({ kind: "invite", inviteToken: "t", name: "N" }),
		).toBe("https://festival.example/invite/t");
	});

	it("remembers the festival before sign-in and navigates back instead of creating an organization", async () => {
		const actions = await read("../src/app/createFestivalActions.ts");
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");

		expect(actions).toContain('kind: "volunteer" as const');
		expect(actions).toContain("route.festivalSlug");
		expect(actions).toContain(
			"Volunteer sign-in must start from a festival page.",
		);
		expect(lifecycle).toContain('intent?.kind === "volunteer"');
		expect(lifecycle.indexOf('intent?.kind === "volunteer"')).toBeLessThan(
			lifecycle.indexOf('intent?.kind === "create-org"'),
		);
		expect(lifecycle).toContain("buildFestivalVolunteersPath");
	});

	it("shows a public volunteer page that verifies the festival and offers sign-in", async () => {
		const page = await read("../src/pages/FestivalVolunteersPage.tsx");
		const app = await read("../src/App.tsx");

		expect(page).toContain("getPublicFestival");
		expect(page).toContain("Festival not found.");
		expect(page).toContain('festival.state === "errored"');
		expect(page).toContain('openSignInModal("volunteer")');
		expect(app).toContain('app.route().kind === "festival-volunteers"');
		expect(app).toContain("<FestivalVolunteersPage");
	});

	it("interacts with volunteer API endpoints with proper paths and options", async () => {
		const originalFetch = globalThis.fetch;
		const calls: Array<{
			url: string;
			method: string;
			body?: unknown;
			authorization?: string | null;
		}> = [];

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.pathname + input.search
						: input.url;
			calls.push({
				url,
				method: init?.method ?? "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
				authorization: new Headers(init?.headers).get("Authorization"),
			});
			return new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		try {
			await listVolunteerShifts("pafe", "spring", {
				availableOnly: true,
				idToken: "test-token",
			});
			expect(calls[0].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/shifts?available=true",
			);
			expect(calls[0].method).toBe("GET");
			expect(calls[0].authorization).toBe("Bearer test-token");

			await bookVolunteerShifts(
				"pafe",
				"spring",
				["shift-1", "shift-2"],
				"test-token",
			);
			expect(calls[1].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/book",
			);
			expect(calls[1].method).toBe("POST");
			expect(calls[1].body).toEqual({ shiftIds: ["shift-1", "shift-2"] });

			await getMyVolunteerSchedule("pafe", "spring", "test-token");
			expect(calls[2].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/my-schedule",
			);
			expect(calls[2].method).toBe("GET");

			await cancelVolunteerAssignment(
				"pafe",
				"spring",
				"assign-123",
				"test-token",
			);
			expect(calls[3].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/assignments/assign-123/cancel",
			);
			expect(calls[3].method).toBe("POST");

			await getVolunteerCoverageGaps("pafe", "spring", "test-token");
			expect(calls[4].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/coverage-gaps",
			);
			expect(calls[4].method).toBe("GET");

			await enrollVolunteer(
				"pafe",
				"spring",
				{ name: "Jane Doe", phone: "555-9876" },
				"test-token",
			);
			expect(calls[5].url).toBe(
				"/api/organizations/pafe/festivals/spring/volunteers/enroll",
			);
			expect(calls[5].method).toBe("POST");
			expect(calls[5].body).toEqual({ name: "Jane Doe", phone: "555-9876" });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("supports full self-serve volunteer flow in source", async () => {
		const page = await read("../src/pages/FestivalVolunteersPage.tsx");
		const enrollment = await read(
			"../src/components/VolunteerEnrollmentForm.tsx",
		);
		const myShifts = await read(
			"../src/components/VolunteerMyShiftsSection.tsx",
		);
		const available = await read(
			"../src/components/VolunteerAvailableShiftsSection.tsx",
		);

		// Enrollment form
		expect(enrollment).toContain("Volunteer Enrollment");
		expect(enrollment).toContain('type="email" disabled');
		expect(enrollment).toContain('type="tel"');
		expect(enrollment).toContain("props.onEnroll");
		expect(page).toContain("enrollVolunteer");

		// My Shifts
		expect(myShifts).toContain("My Shifts");
		expect(myShifts).toContain("Cancel Shift");
		expect(myShifts).toContain("listing-table volunteer-schedule-table");
		expect(page).toContain("cancelVolunteerAssignment");

		// Available Shifts
		expect(available).toContain("Available Shifts");
		expect(available).toContain('type="checkbox"');
		expect(available).toContain("Confirm Shifts");
		expect(available).toContain("listing-table volunteer-available-table");
		expect(page).toContain("bookVolunteerShifts");

		// Conflict & error feedback
		expect(page).toContain("Shift booking conflict");
		expect(page).toContain("Volunteer enrollment not found");
	});
});
