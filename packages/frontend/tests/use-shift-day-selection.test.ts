import { describe, expect, it } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import {
	MAX_EXTRA_SHIFT_DATES,
	type ShiftDraftFields,
} from "../src/domains/volunteers/shiftDays.js";
import { useShiftDaySelection } from "../src/domains/volunteers/useShiftDaySelection.js";
import type { VolunteerShift } from "../src/lib/api.js";

const shift = (overrides: Partial<VolunteerShift>): VolunteerShift => ({
	id: "s1",
	organizationId: "org-1",
	festivalId: "fest-1",
	roleId: "role-1",
	date: "2027-11-10",
	period: "AM",
	timeText: null,
	division: null,
	adjudicator: null,
	createdAtIso: "2027-10-01T00:00:00.000Z",
	...overrides,
});

describe("useShiftDaySelection", () => {
	it("non-destructively excludes duplicate days and restores them when the draft changes", () => {
		createRoot((dispose) => {
			const [festivalDays] = createSignal([
				"2027-11-10",
				"2027-11-11",
				"2027-11-12",
			]);
			const [existingShifts] = createSignal<VolunteerShift[]>([
				shift({ id: "s-pm", date: "2027-11-11", period: "PM" }),
			]);
			const [draft, setDraft] = createSignal<ShiftDraftFields>({
				period: "AM",
				timeText: "",
				division: "",
				adjudicator: "",
			});
			const [resetKey] = createSignal("fest-2027|role-1");

			const selection = useShiftDaySelection({
				festivalDays,
				existingShifts,
				draft,
				resetKey,
			});

			selection.selectAllDates();
			expect(selection.selectedDates()).toEqual([
				"2027-11-10",
				"2027-11-11",
				"2027-11-12",
			]);
			expect(selection.effectiveSelectedDates()).toEqual([
				"2027-11-10",
				"2027-11-11",
				"2027-11-12",
			]);

			// Temporarily switching to PM makes 2027-11-11 a duplicate.
			setDraft((current) => ({ ...current, period: "PM" }));
			expect([...selection.matchingDates()]).toEqual(["2027-11-11"]);
			expect(selection.effectiveSelectedDates()).toEqual([
				"2027-11-10",
				"2027-11-12",
			]);
			// Underlying user intent is preserved.
			expect(selection.selectedDates()).toEqual([
				"2027-11-10",
				"2027-11-11",
				"2027-11-12",
			]);

			// Switching back to AM restores 2027-11-11 automatically.
			setDraft((current) => ({ ...current, period: "AM" }));
			expect(selection.effectiveSelectedDates()).toEqual([
				"2027-11-10",
				"2027-11-11",
				"2027-11-12",
			]);

			dispose();
		});
	});

	it("isolates edit mode so matchingDates is empty and selectedDates is untouched", () => {
		createRoot((dispose) => {
			const [festivalDays] = createSignal(["2027-11-10", "2027-11-11"]);
			const [existingShifts] = createSignal<VolunteerShift[]>([
				shift({ id: "s-am", date: "2027-11-10", period: "AM" }),
			]);
			const [draft, setDraft] = createSignal<ShiftDraftFields>({
				period: "PM",
				timeText: "",
				division: "",
				adjudicator: "",
			});
			const [isEditing, setIsEditing] = createSignal(false);
			const [resetKey] = createSignal("fest-2027|role-1");

			const selection = useShiftDaySelection({
				festivalDays,
				existingShifts,
				draft,
				resetKey,
				isEditing,
			});

			selection.selectAllDates();
			expect(selection.selectedDates()).toEqual(["2027-11-10", "2027-11-11"]);

			// Entering edit mode with a draft matching an existing AM shift must not mark days taken.
			setIsEditing(true);
			setDraft((current) => ({ ...current, period: "AM" }));
			expect(selection.matchingDates().size).toBe(0);
			expect(selection.selectedDates()).toEqual(["2027-11-10", "2027-11-11"]);
			expect(selection.effectiveSelectedDates()).toEqual([
				"2027-11-10",
				"2027-11-11",
			]);

			dispose();
		});
	});

	it("validates addExtraDate against festival date bounds and enforces extra date cap", () => {
		createRoot((dispose) => {
			const [festivalDays] = createSignal(["2027-11-10", "2027-11-12"]);
			const [existingShifts] = createSignal<VolunteerShift[]>([]);
			const [draft] = createSignal<ShiftDraftFields>({
				period: "AM",
				timeText: "",
				division: "",
				adjudicator: "",
			});
			const [resetKey] = createSignal("fest-2027|role-1");
			const [dateBounds] = createSignal<{
				minDate: string;
				maxDate: string;
			} | null>({
				minDate: "2027-10-11",
				maxDate: "2027-12-12",
			});

			const selection = useShiftDaySelection({
				festivalDays,
				existingShifts,
				draft,
				resetKey,
				dateBounds,
			});

			// Wrong-year date outside bounds is rejected with allowed range.
			const outOfWindowError = selection.addExtraDate("2026-11-10");
			expect(outOfWindowError).toContain("2027-10-11");
			expect(outOfWindowError).toContain("2027-12-12");

			// In-window date is accepted.
			expect(selection.addExtraDate("2027-11-15")).toBeNull();
			expect(selection.availableDays()).toContain("2027-11-15");
			expect(selection.effectiveSelectedDates()).toContain("2027-11-15");

			// Fill up to MAX_EXTRA_SHIFT_DATES extra dates.
			let added = 1;
			for (let day = 11; day <= 31 && added < MAX_EXTRA_SHIFT_DATES; day++) {
				const date = `2027-10-${String(day).padStart(2, "0")}`;
				expect(selection.addExtraDate(date)).toBeNull();
				added++;
			}
			for (let day = 1; day <= 9 && added < MAX_EXTRA_SHIFT_DATES; day++) {
				const date = `2027-11-${String(day).padStart(2, "0")}`;
				expect(selection.addExtraDate(date)).toBeNull();
				added++;
			}
			for (let day = 16; day <= 30 && added < MAX_EXTRA_SHIFT_DATES; day++) {
				const date = `2027-11-${String(day).padStart(2, "0")}`;
				expect(selection.addExtraDate(date)).toBeNull();
				added++;
			}
			expect(added).toBe(MAX_EXTRA_SHIFT_DATES);

			// One more extra date beyond the cap is rejected.
			const capError = selection.addExtraDate("2027-12-01");
			expect(capError).not.toBeNull();
			expect(selection.availableDays()).not.toContain("2027-12-01");

			dispose();
		});
	});

	it("clears selectedDates and extraDates when resetKey changes", () => {
		let dispose!: () => void;
		let setResetKey!: (next: string) => void;
		let selection!: ReturnType<typeof useShiftDaySelection>;

		createRoot((d) => {
			dispose = d;
			const [festivalDays] = createSignal(["2027-11-10", "2027-11-11"]);
			const [existingShifts] = createSignal<VolunteerShift[]>([]);
			const [draft] = createSignal<ShiftDraftFields>({
				period: "AM",
				timeText: "",
				division: "",
				adjudicator: "",
			});
			const [resetKey, updateResetKey] = createSignal("fest-2027|role-1");
			setResetKey = updateResetKey;

			selection = useShiftDaySelection({
				festivalDays,
				existingShifts,
				draft,
				resetKey,
			});
		});

		try {
			expect(selection.addExtraDate("2027-11-15")).toBeNull();
			expect(selection.selectedDates()).toEqual(["2027-11-15"]);
			expect(selection.availableDays()).toContain("2027-11-15");

			setResetKey("fest-2027|role-2");
			expect(selection.selectedDates()).toEqual([]);
			expect(selection.effectiveSelectedDates()).toEqual([]);
			expect(selection.availableDays()).toEqual(["2027-11-10", "2027-11-11"]);
		} finally {
			dispose();
		}
	});
});
