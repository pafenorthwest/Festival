import { describe, expect, it } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("multi-day shift creation wiring", () => {
	it("creates shifts atomically via batch API, guards shifts.error, and resets on festival switch", async () => {
		const api = await read("../src/lib/api/volunteers.ts");
		const state = await read(
			"../src/domains/volunteers/useVolunteerRolesState.ts",
		);
		expect(api).toContain("export function createVolunteerShiftsBatch");
		expect(api).toContain(".shifts.batch");
		expect(state).toContain("createVolunteerShiftsBatch");
		expect(state).toContain("buildShiftBatchInput");
		expect(state).toContain("validateNewShiftDraft");
		expect(state).toContain("days.effectiveSelectedDates()");
		expect(state).toContain("shifts.error ? undefined : shifts()");
		expect(state).toContain("params.festivalShortName");
		expect(state).toContain("setSelectedRoleId(null)");
		expect(state).toContain("roleCrud.cancelEditRole()");
		expect(state).toContain("shiftCrud.cancelEditShift()");
	});

	it("guards shifts.error, uses effectiveSelectedDates, and sets min/max on date inputs", async () => {
		const panel = await read(
			"../src/domains/volunteers/VolunteerShiftsPanel.tsx",
		);
		expect(panel).toContain("<VolunteerShiftDayPicker");
		expect(panel).toContain("when={props.editingShiftId()}");
		expect(panel).toContain('label="Date"');
		expect(panel).toContain("props.shifts.error");
		expect(panel).toContain("!props.shifts.loading && !props.shifts.error");
		expect(panel).toContain("props.effectiveSelectedDates().length");
		expect(panel).toContain("min={props.minDate?.()}");
		expect(panel).toContain("max={props.maxDate?.()}");
		expect(panel).toContain("formatShiftDateLabel(");
	});

	it("passes festival dates, bounds, effectiveSelectedDates, and resetKey from the page", async () => {
		const page = await read("../src/pages/VolunteerRolesPage.tsx");
		expect(page).toContain(
			"festivalStartDate: () => selectedFestival()?.startDate",
		);
		expect(page).toContain(
			"festivalEndDate: () => selectedFestival()?.endDate",
		);
		expect(page).toContain("availableDays={state.availableShiftDays}");
		expect(page).toContain(
			"effectiveSelectedDates={state.effectiveSelectedShiftDates}",
		);
		expect(page).toContain("pickerResetKey={state.shiftPickerResetKey}");
		expect(page).toContain("minDate={state.shiftMinDate}");
		expect(page).toContain("maxDate={state.shiftMaxDate}");
	});

	it("resets picker extraDate/extraError on resetKey, sets min/max, and adds on Enter", async () => {
		const picker = await read(
			"../src/domains/volunteers/VolunteerShiftDayPicker.tsx",
		);
		expect(picker).toContain('event.key === "Enter"');
		expect(picker).toContain("event.preventDefault()");
		expect(picker).toContain("props.resetKey");
		expect(picker).toContain("min={props.minDate?.()}");
		expect(picker).toContain("max={props.maxDate?.()}");
		expect(picker).toContain("formatShiftDateLabel(");
	});
});
