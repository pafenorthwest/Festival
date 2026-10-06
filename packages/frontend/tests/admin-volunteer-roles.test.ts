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

	it("presents roles and shifts as listing tables, per specs/Style.md", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const styles = await read("../src/styles.css");

		expect(page).toContain("listing-table volunteer-roles-table");
		expect(page).toContain("listing-table volunteer-shifts-table");
		expect(page).toContain("listing-table-header");
		expect(page).toContain("listing-table-row");
		expect(page).toContain("listing-table-badges");
		expect(page).toContain("listing-table-actions");
		expect(page).not.toContain("<table");
		expect(page).not.toContain('role="table"');

		expect(styles).toContain(".listing-table {");
		expect(styles).toContain(".listing-table-row:not(:last-child)::after");
		expect(styles).toContain(".badge-neutral");
		expect(page).toContain("badge badge-neutral");
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

	it("renders coverage gaps section with metric badges and unfilled shifts", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const styles = await read("../src/styles.css");

		expect(page).toContain("Coverage Gaps");
		expect(page).toContain("getVolunteerCoverageGaps");
		expect(page).toContain("Total Shifts:");
		expect(page).toContain("Filled Shifts:");
		expect(page).toContain("Open Shifts:");
		expect(page).toContain("Coverage Percentage:");
		expect(page).toContain("listing-table coverage-gaps-table");
		expect(styles).toContain(".coverage-gaps-table");
		expect(styles).toContain(".coverage-metrics");
	});

	it("exposes API helpers for updating and deleting roles and shifts", async () => {
		const api = await read("../src/lib/api.ts");

		expect(api).toContain("export function updateVolunteerRole");
		expect(api).toContain("export function deleteVolunteerRole");
		expect(api).toContain("export function updateVolunteerShift");
		expect(api).toContain("export function deleteVolunteerShift");
		expect(api).toContain('method: "PATCH"');
		expect(api).toContain('method: "DELETE"');
	});

	it("lets an admin edit or delete a role, per the volunteer admin build screen", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");

		expect(page).toContain("startEditRole");
		expect(page).toContain("handleDeleteRole");
		expect(page).toContain("handleRoleFormSubmit");
		expect(page).toContain('Delete the "');
		expect(page).toContain('" role? This also deletes all of its shifts.');
		expect(page).toContain('{editingRoleId() ? "Edit role" : "Create a role"}');
		expect(page).toContain(
			'{editingRoleId() ? "Save changes" : "Create role"}',
		);
		expect(page).toContain("cancelEditRole");
		expect(page).toContain("Could not delete role.");
	});

	it("lets an admin edit or delete a shift, per the volunteer admin build screen", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");

		expect(page).toContain("startEditShift");
		expect(page).toContain("handleDeleteShift");
		expect(page).toContain("handleShiftFormSubmit");
		expect(page).toContain('{editingShiftId() ? "Edit shift" : "Add a shift"}');
		expect(page).toContain('{editingShiftId() ? "Save changes" : "Add shift"}');
		expect(page).toContain("cancelEditShift");
		expect(page).toContain("Could not delete shift.");
	});
});
