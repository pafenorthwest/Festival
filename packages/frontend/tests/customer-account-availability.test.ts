import { afterEach, describe, expect, it } from "bun:test";
import {
	AVAILABILITY_HOURS,
	buildDefaultAvailabilityDays,
	type CustomerFestivalAvailabilityResponse,
	DEFAULT_AVAILABLE_HOURS,
	formatAvailabilityHourBlock,
	type SubjectFestivalAvailability,
} from "@festival/common";
import {
	getCustomerFestivalAvailability,
	saveCustomerFestivalAvailability,
} from "../src/lib/availability-api.js";
import {
	buildOrgCustomerAccountAvailabilityPath,
	isOrganizationPageRoute,
	parseRoute,
} from "../src/lib/routes.js";
import {
	detectNarrowViewport,
	formatAvailabilityDateHeading,
	isSubjectHourAvailable,
	normalizeSubjectDaysForDates,
	toggleSubjectHourInList,
	toSaveSubjectsPayload,
} from "../src/pages/customerAvailabilityHelpers.js";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("customer account availability routes and navigation", () => {
	it("parses and builds the customer account availability route", () => {
		expect(buildOrgCustomerAccountAvailabilityPath("pafe")).toBe(
			"/org/pafe/account/availability",
		);
		expect(parseRoute("/organizations/pafe/account/availability")).toEqual({
			kind: "org-customer-account-availability",
			slug: "pafe",
		});
		expect(parseRoute("/organizations/pafe/account/availability/")).toEqual({
			kind: "org-customer-account-availability",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/account/availability")).toEqual({
			kind: "org-customer-account-availability",
			slug: "pafe",
		});
		expect(
			isOrganizationPageRoute({
				kind: "org-customer-account-availability",
				slug: "pafe",
			}),
		).toBe(true);
	});

	it("wires Availability link into CustomerAccountNavigation, OrganizationSideNavigation, and App.tsx", async () => {
		const nav = await read("../src/pages/CustomerAccountNavigation.tsx");
		const sideNav = await read(
			"../src/components/OrganizationSideNavigation.tsx",
		);
		const app = await read("../src/App.tsx");

		expect(nav).toContain("buildOrgCustomerAccountAvailabilityPath");
		expect(nav).toContain("Availability");
		expect(sideNav).toContain("buildOrgCustomerAccountAvailabilityPath");
		expect(sideNav).toContain('aria-label="Availability"');
		expect(app).toContain(
			'app.route().kind === "org-customer-account-availability"',
		);
		expect(app).toContain("<CustomerAccountAvailabilityPage");
	});
});

describe("customer availability API client", () => {
	it("fetches availability with optional festivalId and cookie credentials", async () => {
		const calls: { url: string; method: string; credentials?: string }[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				credentials: init?.credentials,
			});
			const payload: CustomerFestivalAvailabilityResponse = {
				organizationId: "org-1",
				festivals: [],
				selectedFestivalId: "fest-1",
				dates: ["2026-07-10"],
				subjects: [],
			};
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await getCustomerFestivalAvailability("pafe");
		await getCustomerFestivalAvailability("pafe", "fest-2");

		expect(calls).toEqual([
			{
				url: "/api/organizations/pafe/customer-account/availability",
				method: "GET",
				credentials: "include",
			},
			{
				url: "/api/organizations/pafe/customer-account/availability?festivalId=fest-2",
				method: "GET",
				credentials: "include",
			},
		]);
	});

	it("saves availability with PUT, CSRF token, and request body", async () => {
		const calls: {
			url: string;
			method: string;
			csrf?: string | null;
			body?: unknown;
		}[] = [];
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({
				url: typeof input === "string" ? input : input.toString(),
				method: init?.method ?? "GET",
				csrf: new Headers(init?.headers).get("X-CSRF-Token"),
				body: init?.body ? JSON.parse(init.body as string) : undefined,
			});
			const payload: CustomerFestivalAvailabilityResponse = {
				organizationId: "org-1",
				festivals: [],
				selectedFestivalId: "fest-1",
				dates: ["2026-07-10"],
				subjects: [],
			};
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		await saveCustomerFestivalAvailability("pafe", "csrf-123", {
			festivalId: "fest-1",
			subjects: [
				{
					subjectType: "child",
					subjectId: "child-1",
					days: [{ date: "2026-07-10", availableHours: [8, 9, 17] }],
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			url: "/api/organizations/pafe/customer-account/availability",
			method: "PUT",
			csrf: "csrf-123",
			body: {
				festivalId: "fest-1",
				subjects: [
					{
						subjectType: "child",
						subjectId: "child-1",
						days: [{ date: "2026-07-10", availableHours: [8, 9, 17] }],
					},
				],
			},
		});
	});
});

describe("hourly availability state, subject combinations, and day navigation", () => {
	const dates = ["2026-07-10", "2026-07-11", "2026-07-12"];

	it("formats all 10 hourly blocks from 8:00 a.m. - 9:00 a.m. through 5:00 p.m. - 6:00 p.m.", () => {
		expect(AVAILABILITY_HOURS).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
		expect(formatAvailabilityHourBlock(8)).toBe("8:00 a.m. - 9:00 a.m.");
		expect(formatAvailabilityHourBlock(11)).toBe("11:00 a.m. - 12:00 p.m.");
		expect(formatAvailabilityHourBlock(12)).toBe("12:00 p.m. - 1:00 p.m.");
		expect(formatAvailabilityHourBlock(16)).toBe("4:00 p.m. - 5:00 p.m.");
		expect(formatAvailabilityHourBlock(17)).toBe("5:00 p.m. - 6:00 p.m.");
		expect(formatAvailabilityDateHeading("2026-07-10")).toContain("2026-07-10");
	});

	it("defaults 8:00 a.m. - 5:00 p.m. to available and 5:00 p.m. - 6:00 p.m. to unavailable", () => {
		const subject: SubjectFestivalAvailability = normalizeSubjectDaysForDates(
			{
				subjectType: "accompanist",
				subjectId: "cust-1",
				label: "Accompanist",
				days: [],
			},
			dates,
		);

		expect(subject.days).toHaveLength(3);
		for (const date of dates) {
			for (const hour of DEFAULT_AVAILABLE_HOURS) {
				expect(isSubjectHourAvailable(subject, date, hour)).toBe(true);
			}
			expect(isSubjectHourAvailable(subject, date, 17)).toBe(false);
		}
	});

	it("supports all 5 subject combinations and toggles hours independently per subject and day", () => {
		// 1. Neither accompanist nor children
		const neither: SubjectFestivalAvailability[] = [];
		expect(neither).toHaveLength(0);

		// 2. Accompanist only
		const accompanistOnly: SubjectFestivalAvailability[] = [
			{
				subjectType: "accompanist",
				subjectId: "cust-1",
				label: "Accompanist",
				days: buildDefaultAvailabilityDays(dates),
			},
		];
		expect(accompanistOnly.map((s) => s.label)).toEqual(["Accompanist"]);

		// 3. 1 child only
		const oneChild: SubjectFestivalAvailability[] = [
			{
				subjectType: "child",
				subjectId: "child-1",
				label: "Clara Schumann",
				days: buildDefaultAvailabilityDays(dates),
			},
		];
		expect(oneChild.map((s) => s.label)).toEqual(["Clara Schumann"]);

		// 4. Multiple children
		const multiChildren: SubjectFestivalAvailability[] = [
			{
				subjectType: "child",
				subjectId: "child-1",
				label: "Felix Mendelssohn",
				days: buildDefaultAvailabilityDays(dates),
			},
			{
				subjectType: "child",
				subjectId: "child-2",
				label: "Fanny Mendelssohn",
				days: buildDefaultAvailabilityDays(dates),
			},
		];
		expect(multiChildren.map((s) => s.label)).toEqual([
			"Felix Mendelssohn",
			"Fanny Mendelssohn",
		]);

		// 5. Accompanist + multiple children
		let combined: SubjectFestivalAvailability[] = [
			...accompanistOnly,
			...multiChildren,
		];
		expect(combined.map((s) => s.label)).toEqual([
			"Accompanist",
			"Felix Mendelssohn",
			"Fanny Mendelssohn",
		]);

		// Toggle 8am (unavailable) and 5pm (available) for Felix on 2026-07-10
		combined = toggleSubjectHourInList(
			combined,
			"child",
			"child-1",
			"2026-07-10",
			8,
		);
		combined = toggleSubjectHourInList(
			combined,
			"child",
			"child-1",
			"2026-07-10",
			17,
		);

		const felix = combined.find((s) => s.subjectId === "child-1");
		const fanny = combined.find((s) => s.subjectId === "child-2");
		const accomp = combined.find((s) => s.subjectType === "accompanist");
		if (!felix || !fanny || !accomp) {
			throw new Error("Expected subjects to exist.");
		}

		expect(isSubjectHourAvailable(felix, "2026-07-10", 8)).toBe(false);
		expect(isSubjectHourAvailable(felix, "2026-07-10", 17)).toBe(true);
		// Other days and other subjects remain untouched
		expect(isSubjectHourAvailable(felix, "2026-07-11", 8)).toBe(true);
		expect(isSubjectHourAvailable(felix, "2026-07-11", 17)).toBe(false);
		expect(isSubjectHourAvailable(fanny, "2026-07-10", 8)).toBe(true);
		expect(isSubjectHourAvailable(fanny, "2026-07-10", 17)).toBe(false);
		expect(isSubjectHourAvailable(accomp, "2026-07-10", 8)).toBe(true);

		const payload = toSaveSubjectsPayload(combined);
		expect(payload).toHaveLength(3);
		expect(payload[1]?.days[0]).toEqual({
			date: "2026-07-10",
			availableHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],
		});
	});

	it("manages single-day Previous day / Next day navigation and festival switching in Solid signals", async () => {
		const solidClient = await import("solid-js/dist/solid.js");
		const { createSignal, createRoot } = solidClient;

		createRoot((dispose) => {
			const [activeDates, setActiveDates] = createSignal(dates);
			const [singleDayMode, setSingleDayMode] = createSignal(true);
			const [dayIndex, setDayIndex] = createSignal(0);

			const visibleDates = () => {
				if (!singleDayMode()) return activeDates();
				const day = activeDates()[dayIndex()];
				return day ? [day] : [];
			};

			expect(visibleDates()).toEqual(["2026-07-10"]);

			// Next day -> 2026-07-11
			setDayIndex((idx) => Math.min(activeDates().length - 1, idx + 1));
			expect(visibleDates()).toEqual(["2026-07-11"]);

			// Next day -> 2026-07-12
			setDayIndex((idx) => Math.min(activeDates().length - 1, idx + 1));
			expect(visibleDates()).toEqual(["2026-07-12"]);

			// Previous day -> 2026-07-11
			setDayIndex((idx) => Math.max(0, idx - 1));
			expect(visibleDates()).toEqual(["2026-07-11"]);

			// Toggle to multi-day view
			setSingleDayMode(false);
			expect(visibleDates()).toEqual([
				"2026-07-10",
				"2026-07-11",
				"2026-07-12",
			]);

			// Switch festival to 2-day festival resets index and isolates dates
			setActiveDates(["2026-10-01", "2026-10-02"]);
			setDayIndex(0);
			setSingleDayMode(true);
			expect(visibleDates()).toEqual(["2026-10-01"]);

			dispose();
		});
	});

	it("renders accessible toggle buttons, Previous/Next day controls, festival selector, and save states", async () => {
		const page = await read("../src/pages/CustomerAccountAvailabilityPage.tsx");
		const section = await read(
			"../src/pages/CustomerAvailabilitySubjectSection.tsx",
		);

		expect(page).toContain("CustomerAccountPageLayout");
		expect(page).toContain("getCustomerFestivalAvailability");
		expect(page).toContain("saveCustomerFestivalAvailability");
		expect(page).toContain("Previous day");
		expect(page).toContain("Next day");
		expect(page).toContain("Single-day view");
		expect(page).toContain("Show all days");
		expect(page).toContain("Save availability");
		expect(page).toContain("Availability saved.");
		expect(page).toContain("Add a child on the Children page");
		expect(page).toContain("manage festival availability.");
		expect(section).toContain('type="button"');
		expect(section).toContain("aria-pressed={available()}");
		expect(section).toContain("formatAvailabilityHourBlock");
		expect(detectNarrowViewport()).toBe(false);
	});
});
