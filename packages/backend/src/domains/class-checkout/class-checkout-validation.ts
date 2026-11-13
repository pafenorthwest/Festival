import {
	type AccompanistMembershipGrant,
	AppError,
	type FestivalClassConfiguration,
	type FestivalRecord,
	isFestivalRegistrationOpen,
	type RepertoirePiece,
} from "@festival/common";
import { buildEligibilityRejectionError } from "./class-checkout-validation-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutChildAgeSnapshotRecord,
	CheckoutChildRecord,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutRepertoireReadPort,
	CheckoutTeacherDirectoryPort,
	CheckoutTeacherGrantSnapshot,
} from "./ports.js";

export const MAX_SNAPSHOT_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

export interface RepertoireValidationOptions {
	requireConcertoCatalogWork?: boolean;
	catalogWorkReader?: CheckoutRepertoireReadPort;
	organizationId?: string;
	preResolvedWorksById?: ReadonlyMap<
		string,
		Awaited<ReturnType<CheckoutRepertoireReadPort["getCatalogWorkById"]>>
	>;
}

export async function resolvePieceCatalogWorks(
	pieces: unknown[],
	options?: RepertoireValidationOptions,
): Promise<
	Map<
		string,
		Awaited<ReturnType<CheckoutRepertoireReadPort["getCatalogWorkById"]>>
	>
> {
	const map = new Map<
		string,
		Awaited<ReturnType<CheckoutRepertoireReadPort["getCatalogWorkById"]>>
	>();
	if (!options?.catalogWorkReader || !options.organizationId) return map;
	const workIds = new Set<string>();
	for (const piece of pieces) {
		if (!piece || typeof piece !== "object") continue;
		const id = (piece as { catalogWorkId?: unknown }).catalogWorkId;
		if (typeof id === "string" && id.trim()) {
			workIds.add(id.trim());
		}
	}
	await Promise.all(
		Array.from(workIds).map(async (workId) => {
			const work = await options.catalogWorkReader?.getCatalogWorkById(
				options.organizationId ?? "",
				workId,
			);
			map.set(workId, work ?? null);
		}),
	);
	return map;
}

export function validateRepertoirePiece(piece: unknown): void {
	if (!piece || typeof piece !== "object") {
		throw new AppError("Each repertoire piece must be an object.", 400);
	}
	const p = piece as Record<string, unknown>;
	if (typeof p.title !== "string" || !p.title.trim()) {
		throw new AppError("Repertoire piece title is required.", 400);
	}
	if (p.title.trim().length > 200) {
		throw new AppError(
			"Repertoire piece title cannot exceed 200 characters.",
			400,
		);
	}
	if (typeof p.composer !== "string" || !p.composer.trim()) {
		throw new AppError(
			"Each repertoire piece must have a valid composer.",
			400,
		);
	}
	if (p.composer.trim().length > 200) {
		throw new AppError(
			"Each repertoire piece must have a valid composer.",
			400,
		);
	}
	if (p.movement !== undefined && p.movement !== null) {
		if (typeof p.movement !== "string" || p.movement.trim().length > 200) {
			throw new AppError(
				"Each repertoire piece must have a valid movement.",
				400,
			);
		}
	}
	if (
		typeof p.durationSeconds !== "number" ||
		!Number.isSafeInteger(p.durationSeconds) ||
		p.durationSeconds <= 0 ||
		p.durationSeconds > 2_147_483_647
	) {
		throw new AppError(
			"Each repertoire piece must have a positive whole-number duration in seconds.",
			400,
		);
	}
}

function normalizeValidatedPiece(
	piece: RepertoirePiece,
	options?: RepertoireValidationOptions,
): RepertoirePiece {
	validateRepertoirePiece(piece);
	const catalogWorkId =
		typeof piece.catalogWorkId === "string" && piece.catalogWorkId.trim()
			? piece.catalogWorkId.trim()
			: undefined;
	if (options?.requireConcertoCatalogWork) {
		const work = catalogWorkId
			? options.preResolvedWorksById?.get(catalogWorkId)
			: undefined;
		if (
			!catalogWorkId ||
			!work?.isActive ||
			!(work.classifications ?? []).includes("concerto")
		) {
			throw new AppError(
				"Concerto class registrations require an active concerto catalog work.",
				400,
				"concerto_catalog_work_required",
			);
		}
	} else if (catalogWorkId && options?.preResolvedWorksById) {
		const work = options.preResolvedWorksById.get(catalogWorkId);
		if (!work?.isActive) {
			throw new AppError(
				"Selected catalog work was not found or is inactive.",
				400,
				"catalog_work_invalid",
			);
		}
	}
	const movement =
		typeof piece.movement === "string" && piece.movement.trim()
			? piece.movement.trim()
			: undefined;
	return {
		...(catalogWorkId ? { catalogWorkId } : {}),
		title: piece.title.trim(),
		composer: piece.composer.trim(),
		...(movement ? { movement } : {}),
		durationSeconds: piece.durationSeconds,
	};
}

export function validateAndNormalizeRepertoirePieces(
	pieces: RepertoirePiece[],
	festivalClass: Pick<
		FestivalClassConfiguration,
		"maximumPerformancePieces" | "performanceMinutes"
	>,
	options?: RepertoireValidationOptions,
): RepertoirePiece[] {
	if (!Array.isArray(pieces) || pieces.length === 0) {
		throw new AppError("Repertoire pieces must be a non-empty array.", 400);
	}
	if (pieces.length > festivalClass.maximumPerformancePieces) {
		throw new AppError(
			`Number of pieces (${pieces.length}) exceeds the maximum allowed (${festivalClass.maximumPerformancePieces}).`,
			400,
		);
	}
	const normalized = pieces.map((piece) =>
		normalizeValidatedPiece(piece, options),
	);
	const totalDurationMinutes =
		normalized.reduce((sum, piece) => sum + piece.durationSeconds, 0) / 60;
	if (totalDurationMinutes > festivalClass.performanceMinutes) {
		throw new AppError(
			`Total performance duration (${totalDurationMinutes} minutes) exceeds the maximum allowed of ${festivalClass.performanceMinutes} minutes.`,
			400,
		);
	}
	return normalized;
}

export async function validateChildOwnership(
	customers: CheckoutCustomerIdentityPort,
	organizationId: string,
	customerId: string,
	childId: string,
): Promise<CheckoutChildRecord> {
	const child = await customers.findChild(organizationId, customerId, childId);
	if (!child) {
		throw new AppError("Child not found.", 404);
	}
	return child;
}

export async function validateActiveChildAgeSnapshot(
	customers: CheckoutCustomerIdentityPort,
	organizationId: string,
	childId: string,
	now: Date,
): Promise<CheckoutChildAgeSnapshotRecord> {
	const snapshot = await customers.findActiveChildAgeSnapshot(
		organizationId,
		childId,
		now.toISOString(),
	);
	if (!snapshot) {
		throw new AppError("An active child age snapshot is required.", 400);
	}
	if (Date.parse(snapshot.validUntilIso) <= now.getTime()) {
		throw new AppError("Child age snapshot has expired.", 400);
	}
	if (
		now.getTime() - Date.parse(snapshot.createdAtIso) >
		MAX_SNAPSHOT_VALIDITY_MS
	) {
		throw new AppError(
			"Child age snapshot has exceeded the 90-day validity window.",
			400,
		);
	}
	return snapshot;
}

export function validateChildAgeRange(
	age: number,
	festivalClass: Pick<FestivalClassConfiguration, "minimumAge" | "maximumAge">,
): void {
	if (age < festivalClass.minimumAge || age > festivalClass.maximumAge) {
		throw new AppError(
			`Child age (${age}) is outside the allowed range of [${festivalClass.minimumAge}, ${festivalClass.maximumAge}].`,
			400,
		);
	}
}

export async function validateTeacherEntitlement(
	teachers: CheckoutTeacherDirectoryPort,
	organizationId: string,
	teacherId: string,
	divisionId: string,
	now: Date,
): Promise<
	CheckoutTeacherGrantSnapshot | { id: string; contact: { name: string } }
> {
	if (teachers.findActiveTeacherEntitlementGrant) {
		const today = now.toISOString().slice(0, 10);
		const grant = await teachers.findActiveTeacherEntitlementGrant({
			organizationId,
			customerId: teacherId,
			divisionId,
			onDate: today,
		});
		if (!grant) {
			throw new AppError(
				"Selected teacher does not have an active membership for this division.",
				400,
			);
		}
		return grant;
	}
	const list = await teachers.listActiveTeachersForDivision(
		organizationId,
		divisionId,
	);
	const matched = list.find((t) => t.id === teacherId);
	if (!matched) {
		throw new AppError(
			"Selected teacher does not have an active membership for this division.",
			400,
		);
	}
	return { id: matched.id, contact: { name: matched.name } };
}

export async function validateAccompanistSelection(
	teachers: CheckoutTeacherDirectoryPort,
	organizationId: string,
	accompanistId: string | null | undefined,
): Promise<AccompanistMembershipGrant | null> {
	if (!accompanistId?.trim()) return null;
	if (!teachers.findCurrentAccompanistMembershipGrant) {
		throw new AppError("Accompanist membership lookup is not available.", 400);
	}
	const grant = await teachers.findCurrentAccompanistMembershipGrant({
		organizationId,
		customerId: accompanistId.trim(),
	});
	if (!grant) {
		throw new AppError(
			"Selected accompanist does not hold a current accompanist membership.",
			400,
		);
	}
	return grant;
}

export function resolveTargetFestival(
	festivals: FestivalRecord[],
	festivalShortName: string,
): FestivalRecord {
	const normalized = festivalShortName.trim().toLowerCase();
	const found = festivals.find(
		(f) => f.shortName.trim().toLowerCase() === normalized,
	);
	if (!found) {
		throw new AppError("Festival not found.", 404);
	}
	return found;
}

export async function resolveFestivalClassConfiguration(
	catalog: CheckoutCatalogReadPort,
	organizationId: string,
	festivalId: string,
	classId: string,
): Promise<FestivalClassConfiguration> {
	if (catalog.findFestivalClassConfigurationById) {
		const found = await catalog.findFestivalClassConfigurationById(
			organizationId,
			festivalId,
			classId,
		);
		if (found) return found;
		const inOrg = await catalog.findFestivalClassConfigurationById(
			organizationId,
			classId,
		);
		if (inOrg) {
			throw new AppError(
				"Class configuration does not belong to the specified festival.",
				400,
			);
		}
		throw new AppError("Festival class configuration not found.", 404);
	}
	const list = await catalog.listFestivalClassConfigurations(
		organizationId,
		festivalId,
		false,
	);
	const match = list.find((c) => c.id === classId);
	if (!match) {
		throw new AppError("Festival class configuration not found.", 404);
	}
	return match;
}

export async function resolveFestivalAndClassConfig(
	catalog: CheckoutCatalogReadPort,
	organizationId: string,
	festivalShortName: string,
	classId: string,
): Promise<{
	festival: FestivalRecord;
	festivalClass: FestivalClassConfiguration;
}> {
	const festival = await catalog.findFestivalByShortName(
		organizationId,
		festivalShortName.trim(),
	);
	if (!festival) {
		throw new AppError("Festival not found.", 404);
	}
	const festivalClass = await resolveFestivalClassConfiguration(
		catalog,
		organizationId,
		festival.id,
		classId,
	);
	return { festival, festivalClass };
}

export function calculateTotalAmount(amounts: readonly string[]): string {
	let cents = 0;
	for (const amount of amounts) {
		const parsed = Number.parseFloat(amount);
		if (!Number.isFinite(parsed) || parsed < 0) {
			throw new AppError("Class price is invalid.", 500);
		}
		cents += Math.round(parsed * 100);
	}
	return (cents / 100).toFixed(2);
}

export async function verifyPostCartCreateCapacityCutoff(params: {
	commerce: CheckoutCommerceReadPort;
	organizations?: Pick<
		import("./ports.js").CheckoutOrganizationReadPort,
		"getClassCapacity" | "getCapacity"
	>;
	catalog?: Pick<CheckoutCatalogReadPort, "findFestivalClassConfigurationById">;
	organizationId: string;
	festivalClass: FestivalClassConfiguration;
	requestedSeats?: number;
}): Promise<AppError | null> {
	const confirmed = await params.commerce.countConfirmedClassEntitlements(
		params.organizationId,
		params.festivalClass.id,
	);
	let liveCapacity = params.festivalClass.capacity;
	const capFn =
		params.organizations?.getClassCapacity ?? params.organizations?.getCapacity;
	if (capFn) {
		const res = await capFn.call(
			params.organizations,
			params.organizationId,
			params.festivalClass.id,
		);
		const num = typeof res === "number" ? res : res?.capacity;
		if (typeof num === "number" && Number.isFinite(num)) {
			liveCapacity = num;
		}
	}
	const requested = params.requestedSeats ?? 1;
	if (confirmed + requested > liveCapacity) {
		return new AppError(
			`Class "${params.festivalClass.displayName}" has reached capacity.`,
			409,
			"class_capacity_full",
		);
	}
	return null;
}

export function assertFestivalOpenForCheckout(
	festival: FestivalRecord,
	now: Date,
	timezone: string,
): void {
	if (!isFestivalRegistrationOpen(festival, now, timezone || "UTC")) {
		throw new AppError(
			"Registration is not currently open for this festival.",
			409,
			"registration_closed",
		);
	}
}

export { buildEligibilityRejectionError };
