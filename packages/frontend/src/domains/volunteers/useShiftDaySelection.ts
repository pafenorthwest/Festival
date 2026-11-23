import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	on,
} from "solid-js";
import type { VolunteerShift } from "../../lib/api.js";
import {
	datesWithMatchingShift,
	isValidShiftDate,
	mergeDays,
	type ShiftDraftFields,
} from "./shiftDays.js";

interface ShiftDaySelectionOptions {
	festivalDays: Accessor<string[]>;
	existingShifts: Accessor<VolunteerShift[] | undefined>;
	draft: Accessor<ShiftDraftFields>;
	/** A new value clears the selection, for example a different role or festival. */
	resetKey: Accessor<string>;
}

/** Which days are ticked while building a shift, and which are already taken. */
export function useShiftDaySelection(options: ShiftDaySelectionOptions) {
	const [selectedDates, setSelectedDates] = createSignal<string[]>([]);
	const [extraDates, setExtraDates] = createSignal<string[]>([]);

	const availableDays = createMemo(() =>
		mergeDays(options.festivalDays(), extraDates()),
	);
	const matchingDates = createMemo(() =>
		datesWithMatchingShift(options.existingShifts() ?? [], options.draft()),
	);

	createEffect(
		on(
			options.resetKey,
			() => {
				setSelectedDates([]);
				setExtraDates([]);
			},
			{ defer: true },
		),
	);

	// Changing the period or division can make a ticked day a duplicate.
	createEffect(() => {
		const taken = matchingDates();
		setSelectedDates((current) =>
			current.some((date) => taken.has(date))
				? current.filter((date) => !taken.has(date))
				: current,
		);
	});

	function toggleDate(date: string) {
		if (matchingDates().has(date)) return;
		setSelectedDates((current) =>
			current.includes(date)
				? current.filter((item) => item !== date)
				: [...current, date].sort(),
		);
	}

	function selectAllDates() {
		const taken = matchingDates();
		setSelectedDates(availableDays().filter((date) => !taken.has(date)));
	}

	function clearDates() {
		setSelectedDates([]);
	}

	/** Adds a day outside the festival dates and ticks it. Returns a message if it cannot. */
	function addExtraDate(date: string): string | null {
		if (!isValidShiftDate(date)) return "Enter a valid date.";
		if (matchingDates().has(date)) {
			return "This role already has that shift on that day.";
		}
		setExtraDates((current) =>
			current.includes(date) ? current : [...current, date],
		);
		setSelectedDates((current) =>
			current.includes(date) ? current : [...current, date].sort(),
		);
		return null;
	}

	return {
		availableDays,
		selectedDates,
		setSelectedDates,
		matchingDates,
		toggleDate,
		selectAllDates,
		clearDates,
		addExtraDate,
	};
}
