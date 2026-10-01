import { afterEach, describe, expect, it } from "bun:test";
import {
	createFestivalClassSubtype,
	updateAdminClassSubtype,
} from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/AdminFestivalsPage.tsx", import.meta.url),
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
});
