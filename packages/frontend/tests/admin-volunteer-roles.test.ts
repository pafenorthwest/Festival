import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("admin volunteer role and shift management", () => {
	it("exposes API helpers for creating roles and shifts, scoped to a festival", async () => {
		const api = await read("../src/lib/api/volunteers.ts");
		const commonVolunteers = await read("../../common/src/volunteers.ts");

		expect(api).toContain("export function createVolunteerRole");
		expect(api).toContain("export function getVolunteerShiftsForRole");
		expect(api).toContain("export function createVolunteerShift");
		expect(commonVolunteers).toContain("displayName: v.string(),");
		expect(api).toContain("const enc = encodeURIComponent;");
		expect(api).toContain(
			"slug: enc(slug), festivalShortName: enc(festivalShortName)",
		);
	});

	it("shows the create-role and shift-management forms to volunteer administrators", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const roleForm = await read(
			"../src/domains/volunteers/VolunteerRoleForm.tsx",
		);
		const shiftsPanel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);

		expect(page).toContain("volunteers.hasVolunteerAdminIntent()");
		expect(roleForm).toContain("Create a role");
		expect(shiftsPanel).toContain("Add a shift");
		expect(roleForm).toContain("Room Proctor role");
	});

	it("defaults to the primary festival and permits selecting another festival", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const selection = await read("../src/pages/useAdminFestivalSelection.ts");

		expect(page).toContain("useAdminFestivalSelection");
		expect(page).toContain("<FestivalSelector");
		expect(selection).toContain("festival.isPrimary");
		expect(page).toContain("No festivals have been created yet.");
	});

	it("presents roles and shifts as listing tables, per specs/Style.md", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		const shiftsPanel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);
		const styles = await read("../src/styles.css");

		expect(page).toContain("listing-table volunteer-roles-table");
		expect(shiftsPanel).toContain("listing-table volunteer-shifts-table");
		expect(page).toContain("listing-table-header");
		expect(page).toContain("listing-table-row");
		expect(page).toContain("listing-table-badges");
		expect(page).toContain("listing-table-actions");
		expect(page).not.toContain("<table");
		expect(page).not.toContain('role="table"');
		expect(shiftsPanel).not.toContain("<table");
		expect(shiftsPanel).not.toContain('role="table"');

		expect(styles).toContain(".listing-table {");
		expect(styles).toContain(".listing-table-row:not(:last-child)::after");
		expect(styles).toContain(".badge-neutral");
		expect(page).toContain("badge badge-neutral");
	});

	it("passes the app controller into the admin volunteers page", async () => {
		const routes = await read("../src/app/AdminRoutes.tsx");

		expect(routes).toContain('path="/admin/volunteers"');
		expect(routes).toContain("<Pages.VolunteerRolesPage");
		expect(routes).toContain("app={app}");
	});

	it("loads the festival list when visiting the admin volunteers page", async () => {
		const lifecycle = await read("../src/app/useFestivalLifecycle.ts");

		expect(lifecycle).toContain('"org-admin-volunteers"');
	});

	it("renders a shift coverage section with metric badges and coverage percentage", async () => {
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		const coveragePanel = await read(
			"../src/domains/volunteers/VolunteerCoverageGapsPanel.tsx",
		);
		const styles = await read("../src/styles.css");

		expect(coveragePanel).toContain("Volunteer Shift Coverage");
		expect(state).toContain("getVolunteerCoverageGaps");
		expect(coveragePanel).toContain("Total Shifts:");
		expect(coveragePanel).toContain("Filled Shifts:");
		expect(coveragePanel).toContain("Open Shifts:");
		expect(coveragePanel).toContain("Coverage Percentage:");
		expect(styles).toContain(".coverage-metrics");
	});

	it("exposes API helpers for updating and deleting roles and shifts", async () => {
		const api = await read("../src/lib/api/volunteers.ts");

		expect(api).toContain("export function updateVolunteerRole");
		expect(api).toContain("export function deleteVolunteerRole");
		expect(api).toContain("export function updateVolunteerShift");
		expect(api).toContain("export function deleteVolunteerShift");
		expect(api).toContain(".$patch(");
		expect(api).toContain(".$delete(");
	});

	it("lets an admin edit or delete a role, per the volunteer admin build screen", async () => {
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		const roleForm = await read(
			"../src/domains/volunteers/VolunteerRoleForm.tsx",
		);

		expect(state).toContain("startEditRole");
		expect(state).toContain("handleDeleteRole");
		expect(state).toContain("handleRoleFormSubmit");
		expect(state).toContain('Delete the "');
		expect(state).toContain('" role? This also deletes all of its shifts.');
		expect(roleForm).toContain(
			'{props.editingRoleId() ? "Edit role" : "Create a role"}',
		);
		expect(roleForm).toContain(
			'{props.editingRoleId() ? "Save changes" : "Create role"}',
		);
		expect(state).toContain("cancelEditRole");
		expect(state).toContain("Could not delete role.");
	});

	it("clears an in-progress shift edit when switching the selected role, per review on #255", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");

		// Without this, submitting a shift edit after switching roles (or
		// hiding the current role's shifts) would send the previous role's
		// editingShiftId scoped under the newly selected role, which the
		// backend rejects as a 404 (shift not found under that role).
		const manageShiftsButton = page.slice(
			page.indexOf(
				"<Button",
				page.indexOf('span class="listing-table-actions"'),
			),
			page.indexOf("Manage shifts"),
		);
		expect(manageShiftsButton).toContain("cancelEditShift();");
		expect(manageShiftsButton).toContain("setSelectedRoleId((current) =>");
		expect(manageShiftsButton.indexOf("cancelEditShift()")).toBeLessThan(
			manageShiftsButton.indexOf("setSelectedRoleId("),
		);
	});

	it("lets an admin edit or delete a shift, per the volunteer admin build screen", async () => {
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		const shiftsPanel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);

		expect(state).toContain("startEditShift");
		expect(state).toContain("handleDeleteShift");
		expect(state).toContain("handleShiftFormSubmit");
		expect(shiftsPanel).toContain(
			'{props.editingShiftId() ? "Edit shift" : "Add a shift"}',
		);
		expect(shiftsPanel).toContain(
			'{props.editingShiftId() ? "Save changes" : "Add shift"}',
		);
		expect(state).toContain("cancelEditShift");
		expect(state).toContain("Could not delete shift.");
	});

	it("shows an Open/Filled status badge on every listed shift, per #232", async () => {
		const coveragePanel = await read(
			"../src/domains/volunteers/VolunteerCoverageGapsPanel.tsx",
		);
		const styles = await read("../src/styles.css");

		expect(coveragePanel).toContain("listing-table coverage-slots-table");
		expect(coveragePanel).toContain("props.filteredSlots()");
		expect(coveragePanel).toContain("slot.status");
		expect(styles).toContain(".coverage-slots-table");
	});

	it("makes the Total/Filled/Open summary badges into accessible filters, per #232", async () => {
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		const coveragePanel = await read(
			"../src/domains/volunteers/VolunteerCoverageGapsPanel.tsx",
		);
		const styles = await read("../src/styles.css");

		expect(state).toContain("slotStatusFilter");
		expect(state).toContain("setSlotStatusFilter");
		expect(coveragePanel).toContain("coverage-metrics-filter");
		expect(coveragePanel).toContain(
			'aria-pressed={props.slotStatusFilter() === "all"}',
		);
		expect(coveragePanel).toContain(
			'aria-pressed={props.slotStatusFilter() === "Filled"}',
		);
		expect(coveragePanel).toContain(
			'aria-pressed={props.slotStatusFilter() === "Open"}',
		);
		expect(styles).toContain(".coverage-metrics-filter");
		expect(styles).toContain('.coverage-metrics-filter[aria-pressed="true"]');
	});

	it("shows a filter-aware empty state when no shifts match the active filter, per #232", async () => {
		const coveragePanel = await read(
			"../src/domains/volunteers/VolunteerCoverageGapsPanel.tsx",
		);

		expect(coveragePanel).toContain(
			"No shifts have been created for this festival yet.",
		);
		expect(coveragePanel).toContain("shifts match this filter.");
	});

	it("displays shift dates as weekday + MM/DD, per specs/VOLUNTEER-PORTAL.md", async () => {
		const shiftsPanel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);
		const coveragePanel = await read(
			"../src/domains/volunteers/VolunteerCoverageGapsPanel.tsx",
		);

		expect(shiftsPanel).toContain(
			'import { formatScheduleDate } from "../../app/appFormatting.js"',
		);
		expect(coveragePanel).toContain(
			'import { formatScheduleDate } from "../../app/appFormatting.js"',
		);
		expect(shiftsPanel).toContain("formatScheduleDate(shift.date)");
		expect(coveragePanel).toContain("formatScheduleDate(slot.date)");
	});
});
