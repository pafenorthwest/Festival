import { describe, expect, it } from "bun:test";

const page = await Bun.file(
	new URL("../src/pages/AdminFestivalsPage.tsx", import.meta.url),
).text();
const classesPage = await Bun.file(
	new URL("../src/pages/FestivalAdminClassesPage.tsx", import.meta.url),
).text();
const api = await Bun.file(
	new URL("../src/lib/api.ts", import.meta.url),
).text();

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
});
