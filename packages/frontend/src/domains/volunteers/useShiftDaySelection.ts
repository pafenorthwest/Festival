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
	MAX_EXTRA_SHIFT_DATES,
	MAX_SHIFT_BATCH_DATES,
	mergeDays,
	type ShiftDateBounds,
	type ShiftDraftFields,
} from "./shiftDays.js";

export interface ShiftDaySelectionOptions {
	festivalDays: Accessor<string[]>;
	existingShifts: Accessor<VolunteerShift[] | undefined>;
	draft: Accessor<ShiftDraftFields>;
	/** A new value clears the selection, for example a different role or festival. */
	resetKey: Accessor<string>;
	isEditing?: Accessor<boolean>;
	dateBounds?: Accessor<ShiftDateBounds | null>;
}

/** Which days are ticked while building a shift, and which are already taken. */
export function useShiftDaySelection(options: ShiftDaySelectionOptions) {
	const [selectedDates, setSelectedDates] = createSignal<string[]>([]);
	const [extraDates, setExtraDates] = createSignal<string[]>([]);

	const availableDays = createMemo(() =>
		mergeDays(options.festivalDays(), extraDates()),
	);
	const matchingDates = createMemo(() =>
		options.isEditing?.()
			? new Set<string>()
			: datesWithMatchingShift(options.existingShifts() ?? [], options.draft()),
	);
	const effectiveSelectedDates = createMemo(() => {
		const taken = matchingDates();
		return selectedDates().filter((date) => !taken.has(date));
	});

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
		const bounds = options.dateBounds?.();
		if (bounds && (date < bounds.minDate || date > bounds.maxDate)) {
			return `Date must be between ${bounds.minDate} and ${bounds.maxDate}.`;
		}
		if (matchingDates().has(date)) {
			return "This role already has that shift on that day.";
		}
		const alreadyAvailable = availableDays().includes(date);
		if (
			!alreadyAvailable &&
			(extraDates().length >= MAX_EXTRA_SHIFT_DATES ||
				availableDays().length >= MAX_SHIFT_BATCH_DATES)
		) {
			return `You can add at most ${MAX_EXTRA_SHIFT_DATES} extra dates (up to ${MAX_SHIFT_BATCH_DATES} total days).`;
		}
		if (!options.festivalDays().includes(date)) {
			setExtraDates((current) =>
				current.includes(date) ? current : [...current, date],
			);
		}
		setSelectedDates((current) =>
			current.includes(date) ? current : [...current, date].sort(),
		);
		return null;
	}

	return {
		availableDays,
		selectedDates,
		effectiveSelectedDates,
		setSelectedDates,
		matchingDates,
		toggleDate,
		selectAllDates,
		clearDates,
		addExtraDate,
	};
}
