import type {
	FestivalChildAgeSnapshot,
	FestivalClassConfiguration,
	FestivalRecord,
	RepertoirePiece,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";

export const MAX_SNAPSHOT_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

export function validateRepertoirePiece(piece: unknown): void {
	if (
		!piece ||
		typeof (piece as RepertoirePiece).title !== "string" ||
		!(piece as RepertoirePiece).title.trim()
	) {
		throw new AppError("Each repertoire piece must have a valid title.", 400);
	}
	const p = piece as RepertoirePiece;
	if (typeof p.composer !== "string" || p.composer.trim().length === 0) {
		throw new AppError(
			"Each repertoire piece must have a valid composer.",
			400,
		);
	}
	if (
		p.movement !== undefined &&
		p.movement !== null &&
		typeof p.movement !== "string"
	) {
		throw new AppError(
			"Each repertoire piece must have a valid movement.",
			400,
		);
	}
	if (
		typeof p.durationSeconds !== "number" ||
		p.durationSeconds <= 0 ||
		!Number.isSafeInteger(p.durationSeconds) ||
		p.durationSeconds > 2_147_483_647
	) {
		throw new AppError(
			"Each repertoire piece must have a positive whole-number duration in seconds.",
			400,
		);
	}
}

export function validateAndNormalizeRepertoirePieces(
	pieces: unknown,
	classConfig: { maximumPerformancePieces: number; performanceMinutes: number },
): RepertoirePiece[] {
	if (!Array.isArray(pieces) || pieces.length === 0) {
		throw new AppError("Repertoire pieces must be a non-empty array.", 400);
	}
	if (pieces.length > classConfig.maximumPerformancePieces) {
		throw new AppError(
			`Number of pieces (${pieces.length}) exceeds the maximum allowed (${classConfig.maximumPerformancePieces}).`,
			400,
		);
	}
	for (const piece of pieces) {
		validateRepertoirePiece(piece);
	}
	const normalizedPieces: RepertoirePiece[] = pieces.map(
		(piece: RepertoirePiece) => ({
			title: piece.title.trim(),
			composer: piece.composer.trim(),
			movement:
				typeof piece.movement === "string"
					? piece.movement.trim() || undefined
					: undefined,
			durationSeconds: piece.durationSeconds,
		}),
	);
	const totalDurationMinutes =
		normalizedPieces.reduce((sum, p) => sum + p.durationSeconds, 0) / 60;
	if (totalDurationMinutes > classConfig.performanceMinutes) {
		throw new AppError(
			`Total performance duration (${totalDurationMinutes} minutes) exceeds the maximum allowed of ${classConfig.performanceMinutes} minutes.`,
			400,
		);
	}
	return normalizedPieces;
}

export function validateActiveChildAgeSnapshot(
	snapshots: FestivalChildAgeSnapshot[],
	currentTime: Date,
): FestivalChildAgeSnapshot {
	const activeSnapshot = snapshots.find((item) => !item.supersededAtIso);
	if (!activeSnapshot) {
		throw new AppError("Child does not have an active age snapshot.", 400);
	}
	const validUntil = new Date(activeSnapshot.validUntilIso);
	const snapshotAgeMs =
		currentTime.getTime() - new Date(activeSnapshot.createdAtIso).getTime();
	if (validUntil <= currentTime || snapshotAgeMs > MAX_SNAPSHOT_VALIDITY_MS) {
		throw new AppError("Child age snapshot has expired.", 400);
	}
	return activeSnapshot;
}

export function validateChildAgeRange(
	childAge: number,
	classConfig: { minimumAge: number; maximumAge: number },
): void {
	if (childAge < classConfig.minimumAge || childAge > classConfig.maximumAge) {
		throw new AppError(
			`Child age (${childAge}) is outside the allowed range of [${classConfig.minimumAge}, ${classConfig.maximumAge}].`,
			400,
		);
	}
}

export function resolveTargetFestival(
	festivals: FestivalRecord[],
	input: { festivalId?: string; festivalShortName?: string },
): FestivalRecord {
	let targetFestival: FestivalRecord | undefined;
	if (input.festivalId?.trim() && input.festivalShortName?.trim()) {
		const targetShortName = input.festivalShortName.trim().toLowerCase();
		targetFestival = festivals.find(
			(item) =>
				item.id === input.festivalId?.trim() &&
				item.shortName.toLowerCase() === targetShortName,
		);
	} else if (input.festivalId?.trim()) {
		targetFestival = festivals.find(
			(item) => item.id === input.festivalId?.trim(),
		);
	} else if (input.festivalShortName?.trim()) {
		const targetShortName = input.festivalShortName.trim().toLowerCase();
		targetFestival = festivals.find(
			(item) => item.shortName.toLowerCase() === targetShortName,
		);
	} else {
		targetFestival = festivals.find((item) => item.isPrimary);
	}
	if (!targetFestival) {
		throw new AppError("Active festival not found.", 404);
	}
	return targetFestival;
}

export async function resolveFestivalClassConfiguration(
	organizations: OrganizationRepository,
	input: {
		organizationId: string;
		targetFestival: FestivalRecord;
		festivals: FestivalRecord[];
		festivalClassId: string;
		divisionId?: string;
	},
): Promise<FestivalClassConfiguration> {
	const classConfigs = await organizations.listFestivalClassConfigurations(
		input.organizationId,
		input.targetFestival.id,
		false,
	);
	const classConfig = classConfigs.find(
		(item) => item.id === input.festivalClassId,
	);
	if (!classConfig) {
		for (const otherFest of input.festivals) {
			if (otherFest.id === input.targetFestival.id) continue;
			const otherConfigs = await organizations.listFestivalClassConfigurations(
				input.organizationId,
				otherFest.id,
				false,
			);
			if (otherConfigs.some((item) => item.id === input.festivalClassId)) {
				throw new AppError(
					"Festival class configuration does not belong to the active festival.",
					400,
				);
			}
		}
		throw new AppError("Festival class configuration not found.", 404);
	}
	if (!classConfig.isActive) {
		throw new AppError("Festival class configuration is inactive.", 400);
	}
	if (
		classConfig.organizationId !== input.organizationId ||
		classConfig.festivalId !== input.targetFestival.id
	) {
		throw new AppError(
			"Festival class configuration does not belong to the active festival.",
			400,
		);
	}
	if (
		input.divisionId !== undefined &&
		input.divisionId !== classConfig.divisionId
	) {
		throw new AppError(
			"Selected class does not belong to the requested division.",
			400,
		);
	}
	return classConfig;
}

export async function resolveFestivalAndClassConfig(
	organizations: OrganizationRepository,
	input: {
		organizationId: string;
		festivalId?: string;
		festivalShortName?: string;
		festivalClassId: string;
		divisionId?: string;
	},
): Promise<{
	targetFestival: FestivalRecord;
	classConfig: FestivalClassConfiguration;
	festivals: FestivalRecord[];
}> {
	const festivals = await organizations.listFestivals(input.organizationId);
	const targetFestival = resolveTargetFestival(festivals, {
		festivalId: input.festivalId,
		festivalShortName: input.festivalShortName,
	});
	const classConfig = await resolveFestivalClassConfiguration(organizations, {
		organizationId: input.organizationId,
		targetFestival,
		festivals,
		festivalClassId: input.festivalClassId,
		divisionId: input.divisionId,
	});
	return { targetFestival, classConfig, festivals };
}

export function calculateTotalAmount(
	items: Array<{ price?: string; amount?: string } | string>,
): string {
	let totalCents = 0;
	for (const item of items) {
		const priceStr =
			typeof item === "string" ? item : (item.amount ?? item.price ?? "0");
		const cents = Math.round(Number.parseFloat(priceStr || "0") * 100);
		totalCents += cents;
	}
	return (totalCents / 100).toFixed(2);
}
