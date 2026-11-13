import {
	AppError,
	type CanonicalWork,
	doesClassRequireConcerto,
	type FestivalClassConfiguration,
	type RegistrationCatalogValue,
	type RepertoirePiece,
} from "@festival/common";
import {
	type RepertoireValidationOptions,
	resolvePieceCatalogWorks as resolveDomainPieceCatalogWorks,
	validateAndNormalizeRepertoirePieces as validateDomainRepertoirePieces,
} from "../domains/class-checkout/class-checkout-validation.js";
import type { CheckoutRepertoireReadPort } from "../domains/class-checkout/ports.js";

export {
	assertFestivalOpenForCheckout,
	buildEligibilityRejectionError,
	calculateTotalAmount,
	MAX_SNAPSHOT_VALIDITY_MS,
	type RepertoireValidationOptions,
	resolveFestivalAndClassConfig,
	resolveFestivalClassConfiguration,
	resolveTargetFestival,
	validateAccompanistSelection,
	validateActiveChildAgeSnapshot,
	validateChildAgeRange,
	validateChildOwnership,
	validateRepertoirePiece,
	validateTeacherEntitlement,
} from "../domains/class-checkout/class-checkout-validation.js";

export async function resolvePieceCatalogWorks(
	pieces: unknown,
	organizationIdOrOptions?: string | RepertoireValidationOptions,
	repertoire?: CheckoutRepertoireReadPort,
): Promise<Map<string, CanonicalWork | null>> {
	const list = Array.isArray(pieces) ? pieces : [];
	if (typeof organizationIdOrOptions === "string") {
		return resolveDomainPieceCatalogWorks(list, {
			organizationId: organizationIdOrOptions,
			catalogWorkReader: repertoire,
		});
	}
	return resolveDomainPieceCatalogWorks(list, organizationIdOrOptions);
}

export interface LegacyRepertoireValidationOptions
	extends RepertoireValidationOptions {
	requireConcertoMovement?: boolean;
	subtype?: RegistrationCatalogValue | null;
	catalogWorksById?: ReadonlyMap<string, CanonicalWork | null>;
}

export function validateAndNormalizeRepertoirePieces(
	pieces: unknown,
	festivalClass: FestivalClassConfiguration,
	options?: LegacyRepertoireValidationOptions,
): RepertoirePiece[] {
	if (!Array.isArray(pieces)) {
		throw new AppError("Repertoire pieces must be a non-empty array.", 400);
	}
	const requireConcertoCatalogWork =
		options?.requireConcertoCatalogWork ??
		options?.requireConcertoMovement ??
		doesClassRequireConcerto(festivalClass, options?.subtype ?? null);
	return validateDomainRepertoirePieces(
		pieces as RepertoirePiece[],
		festivalClass,
		{
			...options,
			requireConcertoCatalogWork,
			preResolvedWorksById:
				options?.preResolvedWorksById ?? options?.catalogWorksById,
		},
	);
}

export interface ClassCheckoutFailureLineDetail {
	childId: string;
	festivalClassId: string;
	code: string;
	reason: string;
	capacity?: number;
	placedCount?: number;
}

type CapacityClassConfig = {
	id: string;
	organizationId: string;
	festivalId: string;
	isActive: boolean;
	capacity: number;
};

function collectClassCapacityFailures(
	organizationId: string,
	festivalId: string,
	freshClass: CapacityClassConfig | null,
	placedCount: number,
	matchingLines: ReadonlyArray<{ childId: string; festivalClassId: string }>,
): ClassCheckoutFailureLineDetail[] {
	if (
		freshClass?.isActive &&
		freshClass.organizationId === organizationId &&
		freshClass.festivalId === festivalId &&
		freshClass.capacity > 0 &&
		placedCount + matchingLines.length <= freshClass.capacity
	) {
		return [];
	}
	const capacity = freshClass?.capacity ?? 0;
	const reason = !freshClass?.isActive
		? "Class is no longer available and is in waitlist state."
		: `Class has reached capacity (${placedCount}/${capacity}) and is in waitlist state.`;
	return matchingLines.map((line) => ({
		childId: line.childId,
		festivalClassId: line.festivalClassId,
		code: "class_at_capacity",
		reason,
		capacity,
		placedCount,
	}));
}

export async function verifyPostCartCreateCapacityCutoff(params: {
	organizationId: string;
	festivalId: string;
	lines: ReadonlyArray<{ childId: string; festivalClassId: string }>;
	organizations: {
		findFestivalClassConfigurationsByIds(
			organizationId: string,
			festivalId: string,
			classIds: string[],
		): Promise<CapacityClassConfig[]>;
	};
	countConfirmedEntitlements?: (
		organizationId: string,
		festivalClassId: string,
	) => Promise<number>;
}): Promise<AppError | null> {
	const distinctClassIds = [
		...new Set(params.lines.map((l) => l.festivalClassId)),
	];
	const configs =
		await params.organizations.findFestivalClassConfigurationsByIds(
			params.organizationId,
			params.festivalId,
			distinctClassIds,
		);
	const classMap = new Map(configs.map((c) => [c.id, c]));
	const failures: ClassCheckoutFailureLineDetail[] = [];

	for (const classId of distinctClassIds) {
		const placedCount = params.countConfirmedEntitlements
			? await params.countConfirmedEntitlements(params.organizationId, classId)
			: 0;
		const matchingLines = params.lines.filter(
			(l) => l.festivalClassId === classId,
		);
		failures.push(
			...collectClassCapacityFailures(
				params.organizationId,
				params.festivalId,
				classMap.get(classId) ?? null,
				placedCount,
				matchingLines,
			),
		);
	}
	if (failures.length === 0) return null;
	const waitlistedClassIds = [
		...new Set(failures.map((failure) => failure.festivalClassId)),
	];
	return new AppError(failures[0].reason, 400, "class_at_capacity", {
		failures,
		waitlistedClassIds,
	});
}
