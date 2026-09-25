import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("admin volunteer role and shift management", () => {
	it("exposes API helpers for creating roles and shifts, scoped to a festival", async () => {
		const api = await read("../src/lib/api.ts");

		expect(api).toContain("export function createVolunteerRole");
		expect(api).toContain("export function getVolunteerShiftsForRole");
		expect(api).toContain("export function createVolunteerShift");
		expect(api).toContain("displayName: string;");
		expect(api).toContain("encodeURIComponent(slug)");
		expect(api).toContain("encodeURIComponent(festivalShortName)");
	});

	it("shows the create-role and shift-management forms to volunteer administrators", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");

		expect(page).toContain("props.app.hasVolunteerAdminIntent()");
		expect(page).toContain("Create a role");
		expect(page).toContain("Add a shift");
		expect(page).toContain("Room Proctor role");
	});

	it("defaults to the primary festival and permits selecting another festival", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");

		expect(page).toContain("selectedFestivalShortName");
		expect(page).toContain("festival.isPrimary");
		expect(page).toContain("No festivals have been created yet.");
	});

	it("passes the app controller into the admin volunteers page", async () => {
		const app = await read("../src/App.tsx");

		expect(app).toContain('app.route().kind === "org-admin-volunteers"');
		expect(app).toContain("<VolunteerRolesPage");
		expect(app).toContain("app={app}");
	});

	it("loads the festival list when visiting the admin volunteers page", async () => {
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");

		expect(lifecycle).toContain('"org-admin-volunteers"');
	});
});
