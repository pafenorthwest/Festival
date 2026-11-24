import { afterEach, describe, expect, it } from "bun:test";
import type { FestivalSummary } from "@festival/common";
import { createComponent, createSignal } from "solid-js";
import { ApiError } from "../src/lib/api.js";
import {
	allEls,
	apiMocks,
	type DNode,
	dom,
	fakeUser,
	flush,
	installBrowserStubs,
	makeController,
	mountInBoundary,
	resetHarness,
	sampleFestival,
	setAuthUser,
	textOf,
} from "./helpers/solidUniversalHarness.js";

const FestivalVolunteersPage = await dom(
	"pages/FestivalVolunteersPage.tsx",
	"FestivalVolunteersPage",
);

const sampleShift = {
	id: "shift-1",
	roleId: "role-1",
	date: "2026-05-01",
	period: "AM" as const,
	available: true,
	role: {
		id: "role-1",
		slug: "door-monitor",
		displayName: "Door Monitor",
		description: "Check performers in",
		isRoomProctor: false,
	},
};

function findCheckbox(root: DNode): DNode | undefined {
	return allEls(root).find(
		(el) => el.tag === "input" && el.props.type === "checkbox",
	);
}

function findButtonByText(root: DNode, label: string): DNode | undefined {
	return allEls(root).find(
		(el) => el.tag === "button" && textOf(el).includes(label),
	);
}

afterEach(resetHarness);

describe("Item 7: FestivalVolunteersPage enrollment scope and 404 localStorage cleanup", () => {
	it("resets isEnrolled, selectedShiftIds, and transient banners when switching authenticated users or signing out", async () => {
		installBrowserStubs("/org/pafe/festival/spring-2026/volunteers");
		const userA = fakeUser("vol-a", "a@example.com", "tok-a");
		const userB = fakeUser("vol-b", "b@example.com", "tok-b");
		const userC = fakeUser("vol-c", "c@example.com", "tok-c");
		setAuthUser(userA);

		Object.assign(apiMocks, {
			getPublicFestival: async () => ({ festival: sampleFestival }),
			enrollVolunteer: async () => ({ enrolled: true }),
			getMyVolunteerSchedule: async () => [],
			listVolunteerShifts: async () => [sampleShift],
		});

		const app = makeController({
			kind: "festival-volunteers",
			slug: "pafe",
			festivalSlug: "spring-2026",
		});
		const mounted = mountInBoundary(() =>
			createComponent(FestivalVolunteersPage, {
				app,
				slug: "pafe",
				festivalSlug: "spring-2026",
			}),
		);

		try {
			await flush();
			const form = allEls(mounted.root).find((el) => el.tag === "form");
			expect(form).toBeDefined();
			await (
				form?.props.onSubmit as (ev: { preventDefault: () => void }) => unknown
			)({ preventDefault: () => undefined });
			await flush();

			expect(textOf(mounted.root)).toContain("Enrolled successfully!");
			expect(textOf(mounted.root)).toContain("Available Shifts");

			const checkboxA = findCheckbox(mounted.root);
			expect(checkboxA).toBeDefined();
			(checkboxA?.props.onChange as () => void)();
			await flush();
			expect(textOf(mounted.root)).toContain("Confirm Shifts (1)");

			// Switch directly from enrolled User A to unenrolled User B
			setAuthUser(userB);
			await flush();

			expect(textOf(mounted.root)).toContain("Signed in as b@example.com.");
			expect(textOf(mounted.root)).toContain("Volunteer Enrollment");
			expect(textOf(mounted.root)).not.toContain("Available Shifts");
			expect(textOf(mounted.root)).not.toContain("Enrolled successfully!");

			// Even when User B enrolls, User A's shift selection must not carry over
			localStorage.setItem("volunteer_enrolled_pafe_spring-2026_vol-b", "true");
			setAuthUser(fakeUser("vol-b", "b@example.com", "tok-b-2"));
			await flush();
			expect(textOf(mounted.root)).toContain("Sign Up for Shifts");
			expect(textOf(mounted.root)).not.toContain("Confirm Shifts (1)");
			expect(findCheckbox(mounted.root)?.props.checked).toBe(false);

			// Sign out then sign in as unenrolled User C
			setAuthUser(null);
			await flush();
			setAuthUser(userC);
			await flush();
			expect(textOf(mounted.root)).toContain("Volunteer Enrollment");
			expect(textOf(mounted.root)).not.toContain("Available Shifts");
		} finally {
			mounted.dispose();
		}
	});

	it("resets isEnrolled, selectedShiftIds, and transient banners when (slug, festivalSlug) props change", async () => {
		installBrowserStubs("/org/org-a/festival/spring-2026/volunteers");
		setAuthUser(fakeUser("vol-a", "a@example.com", "tok-a"));
		localStorage.setItem("volunteer_enrolled_org-a_spring-2026_vol-a", "true");
		localStorage.setItem("volunteer_enrolled_org-b_winter-2026_vol-a", "true");

		Object.assign(apiMocks, {
			getPublicFestival: async (slug: string, festivalSlug: string) => ({
				festival: {
					...sampleFestival,
					shortName: festivalSlug,
					name: `${slug}:${festivalSlug}`,
				} as FestivalSummary,
			}),
			getMyVolunteerSchedule: async () => [],
			listVolunteerShifts: async () => [sampleShift],
			bookVolunteerShifts: async () => {
				throw new ApiError("Conflict", 409);
			},
		});

		const [scope, setScope] = createSignal({
			slug: "org-a",
			festivalSlug: "spring-2026",
		});
		const app = makeController(() => ({
			kind: "festival-volunteers",
			slug: scope().slug,
			festivalSlug: scope().festivalSlug,
		}));

		const mounted = mountInBoundary(() =>
			createComponent(FestivalVolunteersPage, {
				app,
				get slug() {
					return scope().slug;
				},
				get festivalSlug() {
					return scope().festivalSlug;
				},
			}),
		);

		try {
			await flush();
			expect(textOf(mounted.root)).toContain("Available Shifts");

			(findCheckbox(mounted.root)?.props.onChange as () => void)();
			await flush();
			expect(textOf(mounted.root)).toContain("Confirm Shifts (1)");

			await (
				findButtonByText(mounted.root, "Confirm Shifts (1)")?.props
					.onClick as () => Promise<void>
			)();
			await flush();
			expect(textOf(mounted.root)).toContain("Shift booking conflict");

			// Navigate to unenrolled festival fall-2026
			setScope({ slug: "org-a", festivalSlug: "fall-2026" });
			await flush();
			expect(textOf(mounted.root)).toContain("Volunteer for org-a:fall-2026");
			expect(textOf(mounted.root)).toContain("Volunteer Enrollment");
			expect(textOf(mounted.root)).not.toContain("Available Shifts");
			expect(textOf(mounted.root)).not.toContain("Shift booking conflict");

			// Navigate to enrolled org-b / winter-2026: shift selection must be empty
			setScope({ slug: "org-b", festivalSlug: "winter-2026" });
			await flush();
			expect(textOf(mounted.root)).toContain("Volunteer for org-b:winter-2026");
			expect(textOf(mounted.root)).toContain("Sign Up for Shifts");
			expect(textOf(mounted.root)).not.toContain("Confirm Shifts (1)");
			expect(findCheckbox(mounted.root)?.props.checked).toBe(false);
		} finally {
			mounted.dispose();
		}
	});

	it("clears persisted localStorage key on HTTP 404 during shift booking so enrollment does not resurrect", async () => {
		installBrowserStubs("/org/pafe/festival/spring-2026/volunteers");
		const storageKey = "volunteer_enrolled_pafe_spring-2026_vol-a";
		localStorage.setItem(storageKey, "true");
		setAuthUser(fakeUser("vol-a", "a@example.com", "tok-a-1"));

		Object.assign(apiMocks, {
			getPublicFestival: async () => ({ festival: sampleFestival }),
			getMyVolunteerSchedule: async () => [],
			listVolunteerShifts: async () => [sampleShift],
			bookVolunteerShifts: async () => {
				throw new ApiError("Enrollment missing", 404);
			},
		});

		const app = makeController({
			kind: "festival-volunteers",
			slug: "pafe",
			festivalSlug: "spring-2026",
		});
		const mounted = mountInBoundary(() =>
			createComponent(FestivalVolunteersPage, {
				app,
				slug: "pafe",
				festivalSlug: "spring-2026",
			}),
		);

		try {
			await flush();
			expect(textOf(mounted.root)).toContain("Available Shifts");
			(findCheckbox(mounted.root)?.props.onChange as () => void)();
			await flush();

			await (
				findButtonByText(mounted.root, "Confirm Shifts (1)")?.props
					.onClick as () => Promise<void>
			)();
			await flush();

			expect(localStorage.getItem(storageKey)).toBeNull();
			expect(textOf(mounted.root)).toContain(
				"Volunteer enrollment not found. Please complete enrollment first.",
			);
			expect(textOf(mounted.root)).toContain("Volunteer Enrollment");

			// Subsequent token refresh / schedule refetch must not flip isEnrolled back to true
			setAuthUser(fakeUser("vol-a", "a@example.com", "tok-a-refreshed"));
			await flush();
			expect(textOf(mounted.root)).toContain("Volunteer Enrollment");
			expect(textOf(mounted.root)).not.toContain("Available Shifts");
		} finally {
			mounted.dispose();
		}

		// Remounting the page must also stay gated on Volunteer Enrollment
		const remounted = mountInBoundary(() =>
			createComponent(FestivalVolunteersPage, {
				app,
				slug: "pafe",
				festivalSlug: "spring-2026",
			}),
		);
		try {
			await flush();
			expect(textOf(remounted.root)).toContain("Volunteer Enrollment");
			expect(textOf(remounted.root)).not.toContain("Available Shifts");
		} finally {
			remounted.dispose();
		}
	});
});
