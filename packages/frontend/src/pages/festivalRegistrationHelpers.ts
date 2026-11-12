import {
	type CanonicalWork,
	doesClassRequireConcerto,
	isCatalogWorkClassifiedAsConcerto,
	type RepertoirePiece,
} from "@festival/common";

export { doesClassRequireConcerto };

export interface RepertoirePieceDraft {
	title: string;
	composer: string;
	movement: string;
	durationMinutes: number;
	durationSeconds: number;
	catalogWorkId?: string | null;
}

export function createEmptyPieceDraft(): RepertoirePieceDraft {
	return {
		title: "",
		composer: "",
		movement: "",
		durationMinutes: 3,
		durationSeconds: 0,
	};
}

export function validatePieceTitle(title: string): string | null {
	if (!title?.trim()) return "Title is required.";
	return null;
}

export function validatePieceComposer(composer: string): string | null {
	if (!composer?.trim()) return "Composer is required.";
	return null;
}

export function validatePieceDuration(
	minutes: number,
	seconds: number,
): string | null {
	if (!Number.isInteger(minutes) || minutes < 0) {
		return "Minutes must be a non-negative integer.";
	}
	if (!Number.isInteger(seconds) || seconds < 0 || seconds >= 60) {
		return "Seconds must be between 0 and 59.";
	}
	const total = minutes * 60 + seconds;
	if (total <= 0) {
		return "Duration must be greater than 0 seconds.";
	}
	return null;
}

export function hasPieceDraftContent(draft: RepertoirePieceDraft): boolean {
	return Boolean(
		draft.title.trim() ||
			draft.composer.trim() ||
			draft.movement.trim() ||
			draft.catalogWorkId?.trim() ||
			draft.durationMinutes ||
			draft.durationSeconds,
	);
}

export function getRepertoirePolicyError(
	pieces: readonly RepertoirePiece[],
	maximumPieces: number,
	performanceMinutes?: number,
): string | null {
	if (pieces.length === 0) return "Save at least one piece before continuing.";
	if (pieces.length > maximumPieces)
		return `This class allows at most ${maximumPieces} pieces.`;
	if (
		pieces.some(
			(piece) =>
				!Number.isSafeInteger(piece.durationSeconds) ||
				piece.durationSeconds <= 0,
		)
	)
		return "Every piece needs a positive whole-number duration.";
	if (
		performanceMinutes !== undefined &&
		pieces.reduce((sum, piece) => sum + piece.durationSeconds, 0) >
			performanceMinutes * 60
	)
		return `Total repertoire must be no more than ${performanceMinutes} minutes.`;
	return null;
}

export type CatalogWorkValidationOptions = {
	requiresConcerto?: boolean;
	catalogWorks?: ReadonlyArray<
		Pick<CanonicalWork, "id" | "classifications" | "isActive">
	>;
};

export function validatePieceCatalogWork(
	piece: { catalogWorkId?: string | null },
	optionsOrRequiresConcerto?: CatalogWorkValidationOptions | boolean,
	catalogWorksArg?: ReadonlyArray<
		Pick<CanonicalWork, "id" | "classifications" | "isActive">
	>,
): string | null {
	const options: CatalogWorkValidationOptions | undefined =
		typeof optionsOrRequiresConcerto === "boolean"
			? {
					requiresConcerto: optionsOrRequiresConcerto,
					catalogWorks: catalogWorksArg,
				}
			: optionsOrRequiresConcerto;
	if (!options?.requiresConcerto) return null;
	const workId = piece.catalogWorkId?.trim();
	if (!workId) {
		return "Concerto classes require selecting a concerto work from the catalog.";
	}
	if (options.catalogWorks) {
		const work = options.catalogWorks.find((w) => w.id === workId);
		if (!work || !isCatalogWorkClassifiedAsConcerto(work)) {
			return "Selected catalog work must be classified as a concerto.";
		}
	}
	return null;
}

export function applyCatalogWorkSelection(
	draft: RepertoirePieceDraft,
	workId: string,
	catalogWorks?: ReadonlyArray<
		Pick<CanonicalWork, "id" | "title" | "composerName">
	>,
): RepertoirePieceDraft {
	const trimmedId = workId.trim();
	if (!trimmedId) {
		return {
			...draft,
			catalogWorkId: undefined,
		};
	}
	const selected = catalogWorks?.find((w) => w.id === trimmedId);
	return {
		...draft,
		catalogWorkId: trimmedId,
		...(selected
			? {
					title: selected.title,
					composer: selected.composerName ?? draft.composer,
				}
			: {}),
	};
}

export function validatePieceDrafts(
	pieces: readonly (RepertoirePieceDraft | RepertoirePiece)[],
	optionsOrRequiresConcerto?: CatalogWorkValidationOptions | boolean,
	catalogWorksArg?: ReadonlyArray<
		Pick<CanonicalWork, "id" | "classifications" | "isActive">
	>,
): boolean {
	const options: CatalogWorkValidationOptions | undefined =
		typeof optionsOrRequiresConcerto === "boolean"
			? {
					requiresConcerto: optionsOrRequiresConcerto,
					catalogWorks: catalogWorksArg,
				}
			: optionsOrRequiresConcerto;
	const drafts: RepertoirePieceDraft[] = pieces.map((piece) =>
		"durationMinutes" in piece
			? (piece as RepertoirePieceDraft)
			: repertoirePieceToDraft(piece),
	);
	return arePiecesValid(drafts, options);
}

export function pieceDraftToRepertoirePiece(
	draft: RepertoirePieceDraft,
): RepertoirePiece {
	return {
		title: draft.title.trim(),
		composer: draft.composer.trim(),
		movement: draft.movement.trim() ? draft.movement.trim() : null,
		durationSeconds: Math.max(
			1,
			Math.floor(draft.durationMinutes * 60 + draft.durationSeconds),
		),
		...(draft.catalogWorkId?.trim()
			? { catalogWorkId: draft.catalogWorkId.trim() }
			: {}),
	};
}

export function repertoirePieceToDraft(
	piece: RepertoirePiece,
): RepertoirePieceDraft {
	const total = Math.max(1, piece.durationSeconds);
	return {
		title: piece.title,
		composer: piece.composer,
		movement: piece.movement ?? "",
		durationMinutes: Math.floor(total / 60),
		durationSeconds: total % 60,
		...(piece.catalogWorkId !== undefined
			? { catalogWorkId: piece.catalogWorkId }
			: {}),
	};
}

export function arePiecesValid(
	pieces: RepertoirePieceDraft[],
	options?: {
		requiresConcerto?: boolean;
		catalogWorks?: ReadonlyArray<
			Pick<CanonicalWork, "id" | "classifications" | "isActive">
		>;
	},
): boolean {
	if (pieces.length === 0) return false;
	return pieces.every(
		(p) =>
			!validatePieceTitle(p.title) &&
			!validatePieceComposer(p.composer) &&
			!validatePieceDuration(p.durationMinutes, p.durationSeconds) &&
			!validatePieceCatalogWork(p, options),
	);
}

export function formatTotalDuration(pieces: RepertoirePiece[]): string {
	const totalSecs = pieces.reduce((sum, p) => sum + p.durationSeconds, 0);
	const mins = Math.floor(totalSecs / 60);
	const secs = totalSecs % 60;
	if (secs === 0) return `${mins} min`;
	return `${mins}m ${secs}s`;
}

export function isRegistrationSelectionValid(
	child: { hasCurrentValidAgeSnapshot?: boolean } | null,
	classConfig: {
		maximumPerformancePieces: number;
		performanceMinutes?: number;
		isRegistrationOpen?: boolean;
		requiresConcerto?: boolean;
		classSubtypeName?: string | null;
		displayName?: string | null;
	} | null,
	divisionId: string,
	teacherId: string,
	classId: string,
	pieces: RepertoirePiece[],
	catalogWorks?: ReadonlyArray<
		Pick<CanonicalWork, "id" | "classifications" | "isActive">
	>,
): boolean {
	if (!child?.hasCurrentValidAgeSnapshot || !classConfig) return false;
	if (classConfig.isRegistrationOpen === false) return false;
	if (!divisionId || !teacherId || !classId) return false;
	if (
		pieces.length < 1 ||
		pieces.length > classConfig.maximumPerformancePieces
	) {
		return false;
	}
	const requiresConcerto = doesClassRequireConcerto(classConfig);
	return (
		!getRepertoirePolicyError(
			pieces,
			classConfig.maximumPerformancePieces,
			classConfig.performanceMinutes,
		) && validatePieceDrafts(pieces, { requiresConcerto, catalogWorks })
	);
}

export function normalizeMaxPieces(pieces?: number): 1 | 2 | 3 {
	if (pieces === 2) return 2;
	if (pieces === 3) return 3;
	return 1;
}

export function isInstrumentSelectionValid(
	instruments: { id: string }[],
	selectedId: string,
): boolean {
	return (
		instruments.length === 0 ||
		instruments.some((instrument) => instrument.id === selectedId)
	);
}

export function findById<T extends { id: string }>(
	items: T[] | undefined,
	id: string,
): T | null {
	return items?.find((item) => item.id === id) ?? null;
}

export function formatClassOption(c: {
	displayName: string;
	price: string;
	minimumAge: number;
	maximumAge: number;
}): string {
	return `${c.displayName} · $${c.price} (${c.minimumAge}–${c.maximumAge} yrs)`;
}

export function createSelectHandler(
	setter: (val: string) => void,
	clearSetters: ((val: string) => void)[] = [],
) {
	return (e: Event & { currentTarget: HTMLSelectElement }) => {
		setter(e.currentTarget.value);
		for (const clear of clearSetters) clear("");
	};
}

export function createRegistrationSelectHandlers(
	setChild: (id: string) => void,
	setDivision: (id: string) => void,
	setTeacher: (id: string) => void,
	setClass: (id: string) => void,
	setAccompanist: (id: string) => void,
	setInstrument: (id: string) => void = () => {},
) {
	return {
		onChildChange: createSelectHandler(setChild, [
			setDivision,
			setTeacher,
			setClass,
			setAccompanist,
			setInstrument,
		]),
		onDivisionChange: createSelectHandler(setDivision, [
			setTeacher,
			setClass,
			setInstrument,
		]),
		onTeacherChange: createSelectHandler(setTeacher, [setClass, setInstrument]),
		onClassChange: createSelectHandler(setClass, [setInstrument]),
		onAccompanistChange: createSelectHandler(setAccompanist),
		onInstrumentChange: createSelectHandler(setInstrument),
	};
}
