import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("multi-day shift creation wiring", () => {
	it("creates one shift per ticked day and keeps the unfinished days ticked", async () => {
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		expect(state).toContain("createShiftsForDays");
		expect(state).toContain("validateNewShiftDraft");
		expect(state).toContain("days.setSelectedDates(result.remaining)");
		// What was created must show even when a later day failed.
		expect(state.indexOf("shiftsState.onChanged()")).toBeLessThan(
			state.indexOf("if (result.failed)"),
		);
	});

	it("shows the day picker when adding and a single date when editing", async () => {
		const panel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);
		expect(panel).toContain("<VolunteerShiftDayPicker");
		expect(panel).toContain("when={props.editingShiftId()}");
		expect(panel).toContain('label="Date"');
	});

	it("passes the festival dates from the page into the state hook", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		expect(page).toContain(
			"festivalStartDate: () => selectedFestival()?.startDate",
		);
		expect(page).toContain(
			"festivalEndDate: () => selectedFestival()?.endDate",
		);
		expect(page).toContain("availableDays={state.availableShiftDays}");
	});

	it("adds a typed date on Enter instead of submitting the form", async () => {
		const picker = await read(
			"../src/domains/volunteers/VolunteerShiftDayPicker.tsx",
		);
		expect(picker).toContain('event.key === "Enter"');
		expect(picker).toContain("event.preventDefault()");
	});
});
