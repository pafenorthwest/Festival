import { afterEach, describe, expect, it } from "bun:test";
import {
	createFestival,
	createFestivalClassSubtype,
	updateAdminClassSubtype,
	updateFestivalRegistrationWindow,
} from "../src/lib/api.js";
import {
	buildRegistrationWindowPayload,
	formatFestivalRegistrationWindow,
	toRegistrationWindowInputValue,
} from "../src/pages/adminFestivalsHelpers.js";

const page = await Bun.file(
	new URL("../src/pages/AdminFestivalsPage.tsx", import.meta.url),
).text();
const windowEditor = await Bun.file(
	new URL(
		"../src/components/FestivalRegistrationWindowEditor.tsx",
		import.meta.url,
	),
).text();
const classesPage = await Bun.file(
	new URL("../src/pages/FestivalAdminClassesPage.tsx", import.meta.url),
).text();
const api = await Bun.file(
	new URL("../src/lib/api.ts", import.meta.url),
).text();

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function mockFetch() {
	fetchCalls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const requestUrl =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		fetchCalls.push({ url: requestUrl, init });
		return Promise.resolve(
			new Response(
				JSON.stringify({
					value: {
						id: "sub-1",
						organizationId: "org-1",
						displayName: "Solo",
						isActive: true,
						displayOrder: 1,
						requiredSubtypeId: null,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
	}) as typeof fetch;
}

afterEach(() => {
	fetchCalls = [];
	globalThis.fetch = originalFetch;
});

describe("Registration window editor payloads", () => {
	it.each([
		{
			registrationOpensAt: "2026-05-01",
			registrationClosesAt: "2026-05-15",
		},
		{
			registrationOpensAt: "2026-05-01T09:00:12.345Z",
			registrationClosesAt: "2026-05-15T23:59:59.999Z",
		},
	])("preserves unchanged date boundaries and timestamp precision: %j", (original) => {
		const result = buildRegistrationWindowPayload(
			toRegistrationWindowInputValue(original.registrationOpensAt),
			toRegistrationWindowInputValue(original.registrationClosesAt),
			"UTC",
			original,
		);
		expect(result.isValid).toBe(true);
		expect(result.payload).toEqual(original);
	});

	it("preserves the second repeated DST hour on an unchanged save", () => {
		const original = {
			registrationOpensAt: "2026-10-31T16:00:12.345Z",
			registrationClosesAt: "2026-11-01T09:30:00.000Z",
		};
		const timezone = "America/Los_Angeles";
		const closesDraft = toRegistrationWindowInputValue(
			original.registrationClosesAt,
			timezone,
		);
		expect(closesDraft).toBe("2026-11-01T01:30");
		const result = buildRegistrationWindowPayload(
			toRegistrationWindowInputValue(original.registrationOpensAt, timezone),
			closesDraft,
			timezone,
			original,
		);
		expect(result.isValid).toBe(true);
		expect(result.payload).toEqual(original);
	});

	it("preserves each unchanged endpoint while validating edits against the full window", () => {
		const original = {
			registrationOpensAt: "2026-10-31T16:00:12.345Z",
			registrationClosesAt: "2026-11-01T09:30:00.000Z",
		};
		const timezone = "America/Los_Angeles";
		const closesDraft = toRegistrationWindowInputValue(
			original.registrationClosesAt,
			timezone,
		);
		const changedOpen = buildRegistrationWindowPayload(
			"2026-11-01T01:45",
			closesDraft,
			timezone,
			original,
		);
		expect(changedOpen.isValid).toBe(true);
		expect(changedOpen.payload).toEqual({
			registrationOpensAt: "2026-11-01T01:45",
			registrationClosesAt: original.registrationClosesAt,
		});

		const changedClose = buildRegistrationWindowPayload(
			toRegistrationWindowInputValue(original.registrationOpensAt, timezone),
			"2026-11-02T01:30",
			timezone,
			original,
		);
		expect(changedClose.isValid).toBe(true);
		expect(changedClose.payload).toEqual({
			registrationOpensAt: original.registrationOpensAt,
			registrationClosesAt: "2026-11-02T01:30",
		});

		const invalidOrder = buildRegistrationWindowPayload(
			"2026-11-01T03:00",
			closesDraft,
			timezone,
			original,
		);
		expect(invalidOrder.isValid).toBe(false);
		expect(invalidOrder.error).toContain("on or after the open timestamp");
	});

	it("allows clearing both endpoints and rejects clearing only one", () => {
		const original = {
			registrationOpensAt: "2026-05-01T09:00:12.345Z",
			registrationClosesAt: "2026-05-15T23:59:59.999Z",
		};
		const cleared = buildRegistrationWindowPayload(null, null, "UTC", original);
		expect(cleared.isValid).toBe(true);
		expect(cleared.payload).toEqual({
			registrationOpensAt: null,
			registrationClosesAt: null,
		});
		expect(
			buildRegistrationWindowPayload(
				null,
				toRegistrationWindowInputValue(original.registrationClosesAt),
				"UTC",
				original,
			).isValid,
		).toBe(false);
	});
});

describe("Festival Admin class subtype setup", () => {
	it("loads and creates class subtypes in the selected festival context", () => {
		expect(page).toContain("listFestivalClassSubtypes");
		expect(page).toContain("createFestivalClassSubtype");
		expect(page).toContain("Select a festival");
		expect(page).toContain("selectedFestivalSlug()");
		expect(page).toContain("Create class subtype");
	});

	it("keeps the per-festival Classes link unavailable until a subtype exists", () => {
		expect(page).toContain("buildFestivalAdminClassesPath");
		expect(page).toContain("🎓");
		expect(page).toContain("Classes");
		expect(page).toContain("Create class subtypes first");
		expect(page).toContain("disabled={!hasClassSubtypes()}");
	});

	it("uses the festival-scoped subtype API in the builder", () => {
		expect(api).toContain("export function listFestivalClassSubtypes");
		expect(api).toContain("export function createFestivalClassSubtype");
		expect(api).toContain("/class-subtypes");
		expect(classesPage).toContain("listFestivalClassSubtypes");
	});

	it("supports required subtype prerequisites in creation and updates", async () => {
		expect(page).toContain("Requires Subtype");
		expect(page).toContain("requiredSubtypeDraft()");
		expect(page).toContain("updateAdminClassSubtype");
		expect(page).toContain("option.id !== subtype.id");
		expect(page).toContain("(requires: ");
		expect(api).toContain("export function updateAdminClassSubtype");
		expect(api).toContain("requiredSubtypeId?: string | null");

		mockFetch();
		await createFestivalClassSubtype(
			"test-token",
			"pafe",
			"spring-2026",
			"Solo",
			"prereq-1",
		);
		expect(fetchCalls[0].url).toBe(
			"/api/organizations/pafe/admin/festivals/spring-2026/class-subtypes",
		);
		expect(fetchCalls[0].init?.method).toBe("POST");
		expect(JSON.parse(fetchCalls[0].init?.body as string)).toEqual({
			displayName: "Solo",
			requiredSubtypeId: "prereq-1",
		});

		await updateAdminClassSubtype("test-token", "pafe", "sub-1", {
			requiredSubtypeId: "prereq-2",
		});
		expect(fetchCalls[1].url).toBe(
			"/api/organizations/pafe/admin/class-subtypes/sub-1",
		);
		expect(fetchCalls[1].init?.method).toBe("POST");
		expect(JSON.parse(fetchCalls[1].init?.body as string)).toEqual({
			requiredSubtypeId: "prereq-2",
		});
	});

	it("displays and edits festival registration windows and keeps AdminFestivalsPage under 500 lines", async () => {
		expect(page.split("\n").length).toBeLessThan(500);
		expect(page).toContain("Registration window not set (Closed)");
		expect(page).toContain("FestivalRegistrationWindowEditor");
		expect(windowEditor).toContain("Registration opens at");
		expect(windowEditor).toContain("Registration closes at");
		expect(windowEditor).toContain("Save registration window");
		expect(windowEditor).toContain("Clear window");
		expect(windowEditor).toContain("Registration opens at (optional)");
		expect(windowEditor).toContain("Registration closes at (optional)");
		expect(api).toContain("export function updateFestivalRegistrationWindow");
		expect(api).toContain("/registration-window");

		expect(
			formatFestivalRegistrationWindow(
				{ registrationOpensAt: null, registrationClosesAt: null },
				"UTC",
			),
		).toBe("Registration window not set (Closed)");

		expect(
			formatFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-05-01T00:00:00.000Z",
					registrationClosesAt: "2026-05-15T23:59:00.000Z",
				},
				"UTC",
				new Date("2026-05-10T12:00:00.000Z"),
			),
		).toBe("2026-05-01 00:00 – 2026-05-15 23:59 (Open)");

		expect(
			formatFestivalRegistrationWindow(
				{
					registrationOpensAt: "2026-05-01T00:00:00.000Z",
					registrationClosesAt: "2026-05-15T23:59:00.000Z",
				},
				"UTC",
				new Date("2026-06-01T00:00:00.000Z"),
			),
		).toBe("2026-05-01 00:00 – 2026-05-15 23:59 (Closed)");

		expect(
			toRegistrationWindowInputValue("2026-05-01T14:30:00.000Z", "UTC"),
		).toBe("2026-05-01T14:30");

		const invalidHalf = buildRegistrationWindowPayload(
			"2026-05-01T09:00",
			"",
			"UTC",
		);
		expect(invalidHalf.isValid).toBe(false);
		expect(invalidHalf.error).toContain("Both registration open and close");

		const validPayload = buildRegistrationWindowPayload(
			"2026-05-01T09:00",
			"2026-05-15T17:00",
			"UTC",
		);
		expect(validPayload.isValid).toBe(true);
		expect(validPayload.payload).toEqual({
			registrationOpensAt: "2026-05-01T09:00",
			registrationClosesAt: "2026-05-15T17:00",
		});

		mockFetch();
		await createFestival("test-token", "pafe", {
			shortName: "spring-2026",
			name: "Spring Festival 2026",
			startDate: "2026-06-01",
			endDate: "2026-06-05",
			registrationOpensAt: "2026-05-01T09:00",
			registrationClosesAt: "2026-05-15T17:00",
		});
		expect(fetchCalls[0].url).toBe("/api/organizations/pafe/admin/festivals");
		expect(fetchCalls[0].init?.method).toBe("POST");
		expect(JSON.parse(fetchCalls[0].init?.body as string)).toEqual({
			shortName: "spring-2026",
			name: "Spring Festival 2026",
			startDate: "2026-06-01",
			endDate: "2026-06-05",
			registrationOpensAt: "2026-05-01T09:00",
			registrationClosesAt: "2026-05-15T17:00",
		});

		await updateFestivalRegistrationWindow(
			"test-token",
			"pafe",
			"spring-2026",
			{
				registrationOpensAt: "2026-05-02T09:00",
				registrationClosesAt: "2026-05-20T17:00",
			},
		);
		expect(fetchCalls[1].url).toBe(
			"/api/organizations/pafe/admin/festivals/spring-2026/registration-window",
		);
		expect(fetchCalls[1].init?.method).toBe("PUT");
		expect(JSON.parse(fetchCalls[1].init?.body as string)).toEqual({
			registrationOpensAt: "2026-05-02T09:00",
			registrationClosesAt: "2026-05-20T17:00",
		});
	});
});
