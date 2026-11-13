import {
	AppError,
	type ClassRegistrationSnapshot,
	type FestivalClassConfiguration,
	type RepertoirePiece,
} from "@festival/common";

export interface ClassCheckoutFailureLineDetail {
	childId: string;
	festivalClassId: string;
	reasonCode: string;
	availability?: "open" | "waitlist";
	reason?: string;
	message?: string;
	capacity?: number;
	placedCount?: number;
	lineItemId?: string;
}

export function buildEligibilityRejectionError(
	results: ReadonlyArray<{
		childId: string;
		festivalClassId: string;
		isEligible: boolean;
		reasonCode: string;
		message?: string;
		availability?: "open" | "waitlist";
		capacity?: number;
		placedCount?: number;
		lineItemId?: string;
	}>,
): AppError {
	const failedResults = results.filter((r) => !r.isEligible);
	const failures: ClassCheckoutFailureLineDetail[] = failedResults.map((r) => ({
		childId: r.childId,
		festivalClassId: r.festivalClassId,
		reasonCode: r.reasonCode,
		...(r.availability !== undefined ? { availability: r.availability } : {}),
		...(r.message !== undefined
			? { reason: r.message, message: r.message }
			: {}),
		...(r.capacity !== undefined ? { capacity: r.capacity } : {}),
		...(r.placedCount !== undefined ? { placedCount: r.placedCount } : {}),
		...(r.lineItemId !== undefined ? { lineItemId: r.lineItemId } : {}),
	}));
	const waitlistedClassIds = [
		...new Set(
			failures
				.filter(
					(f) => f.reasonCode === "SOLD_OUT" || f.availability === "waitlist",
				)
				.map((f) => f.festivalClassId),
		),
	];
	const primaryFailure =
		failedResults.find((r) => r.reasonCode === "REGISTRATION_CLOSED") ??
		failedResults.find((r) => r.reasonCode === "SOLD_OUT") ??
		failedResults[0];
	const message =
		primaryFailure?.reasonCode === "SOLD_OUT"
			? (primaryFailure.message ??
				"Class is at capacity and in waitlist availability.")
			: (primaryFailure?.message ?? "Class registration is not eligible.");
	const code = primaryFailure?.reasonCode?.toLowerCase() ?? "ineligible";
	return new AppError(message, 400, code, {
		failures,
		waitlistedClassIds,
	});
}

export interface CaptureLineSnapshotParams {
	festivalId: string;
	festivalClass: FestivalClassConfiguration;
	divisionName: string | null;
	subtypeName: string | null;
	currencyCode: string;
	teacherId: string;
	teacherMembershipId: string;
	teacherName: string | null;
	accompanistId: string | null;
	accompanistMembershipId: string | null;
	accompanistName: string | null;
	instrument: ClassRegistrationSnapshot["instrument"];
	pieces: RepertoirePiece[];
	capturedAtIso: string;
}

export function captureLineRegistrationSnapshot(
	params: CaptureLineSnapshotParams,
): ClassRegistrationSnapshot {
	return {
		version: 1,
		capturedAtIso: params.capturedAtIso,
		class: {
			id: params.festivalClass.id,
			festivalId: params.festivalId,
			displayName: params.festivalClass.displayName,
			classSubtypeId: params.festivalClass.classSubtypeId,
			classSubtypeName: params.subtypeName,
			minimumAge: params.festivalClass.minimumAge,
			maximumAge: params.festivalClass.maximumAge,
			price: params.festivalClass.price,
			currencyCode: params.currencyCode,
			maximumPerformancePieces: params.festivalClass.maximumPerformancePieces,
			performanceMinutes: params.festivalClass.performanceMinutes,
			capacity: params.festivalClass.capacity,
		},
		division: {
			id: params.festivalClass.divisionId,
			name: params.divisionName,
		},
		instrument: params.instrument,
		teacher: {
			customerId: params.teacherId,
			membershipId: params.teacherMembershipId,
			name: params.teacherName,
		},
		accompanist:
			params.accompanistId && params.accompanistMembershipId
				? {
						customerId: params.accompanistId,
						membershipId: params.accompanistMembershipId,
						name: params.accompanistName,
					}
				: null,
		repertoire: params.pieces,
	};
}
