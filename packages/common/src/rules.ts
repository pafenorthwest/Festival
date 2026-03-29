import type {
	EligibilityContext,
	FestivalClass,
	RegistrationSelection,
	ValidationResult,
} from "./domain.js";

export function filterEligibleClassIds(
	classIds: string[],
	eligibility: EligibilityContext,
): { eligible: string[]; blocked: string[] } {
	const allowed = new Set(eligibility.allowedClassIds);
	const eligible = classIds.filter((id) => allowed.has(id));
	const blocked = classIds.filter((id) => !allowed.has(id));

	return { eligible, blocked };
}

export function validateCartRules(
	selection: RegistrationSelection,
	classes: FestivalClass[],
	eligibility: EligibilityContext,
): ValidationResult {
	const classById = new Map(
		classes.map((festivalClass) => [festivalClass.id, festivalClass]),
	);
	const errors: string[] = [];

	const { eligible, blocked } = filterEligibleClassIds(
		selection.classIds,
		eligibility,
	);
	for (const blockedClassId of blocked) {
		errors.push(`Class ${blockedClassId} is not eligible for this student.`);
	}

	const selectedClasses = eligible
		.map((id) => classById.get(id))
		.filter(Boolean) as FestivalClass[];

	if (
		selectedClasses.some(
			(festivalClass) => festivalClass.classType === "concert",
		)
	) {
		const hasSolo = selectedClasses.some(
			(festivalClass) => festivalClass.classType === "solo",
		);
		if (!hasSolo) {
			errors.push(
				"Concert registration requires at least one Solo class registration.",
			);
		}
	}

	for (const festivalClass of selectedClasses.filter(
		(item) => item.classType === "ensemble",
	)) {
		const participants = selection.participantsByClass[festivalClass.id] ?? 0;
		if (participants < festivalClass.minParticipants) {
			errors.push(
				`Ensemble class ${festivalClass.id} requires ${festivalClass.minParticipants} participants.`,
			);
		}
	}

	return {
		valid: errors.length === 0,
		selectedClassIds: eligible,
		errors,
	};
}
