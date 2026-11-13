import type { AccompanistMembershipGrant } from "@festival/common";
import {
	AppError,
	type ClassCheckoutLineItemInput,
	type ClassRegistrationSnapshot,
	doesClassRequireConcerto,
	type FestivalClassConfiguration,
	type FestivalRecord,
	type RegistrationCatalogValue,
	type RepertoirePiece,
} from "@festival/common";
import type { StartClassCheckoutInput } from "./class-checkout-errors.js";
import {
	resolvePieceCatalogWorks,
	validateAndNormalizeRepertoirePieces,
} from "./class-checkout-validation.js";
import { captureLineRegistrationSnapshot } from "./class-checkout-validation-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutChildRecord,
	CheckoutRepertoireReadPort,
	CheckoutTeacherGrantSnapshot,
} from "./ports.js";

export async function resolveLinePiecesAndInstrument(params: {
	repertoire?: CheckoutRepertoireReadPort;
	organizationId: string;
	line: ClassCheckoutLineItemInput;
	festivalClass: FestivalClassConfiguration;
	subtype: RegistrationCatalogValue | null;
	instrumentMap: Map<string, RegistrationCatalogValue>;
}): Promise<{
	pieces: RepertoirePiece[];
	instrument: ClassRegistrationSnapshot["instrument"];
}> {
	const worksMap = await resolvePieceCatalogWorks(params.line.pieces ?? [], {
		catalogWorkReader: params.repertoire,
		organizationId: params.organizationId,
	});
	const pieces = validateAndNormalizeRepertoirePieces(
		params.line.pieces ?? [],
		params.festivalClass,
		{
			requireConcertoCatalogWork: doesClassRequireConcerto(
				params.festivalClass,
				params.subtype,
			),
			preResolvedWorksById: worksMap,
		},
	);
	let inst: RegistrationCatalogValue | undefined;
	if (params.line.instrumentId !== undefined) {
		if (
			typeof params.line.instrumentId !== "string" ||
			!params.line.instrumentId.trim()
		) {
			throw new AppError(
				"Selected instrument is invalid.",
				400,
				"instrument_invalid",
			);
		}
		inst = params.instrumentMap.get(params.line.instrumentId.trim());
		if (!inst) {
			throw new AppError(
				"Selected instrument is invalid.",
				400,
				"instrument_invalid",
			);
		}
	}
	return {
		pieces,
		instrument: inst ? { id: inst.id, name: inst.displayName } : "unknown",
	};
}

export async function resolveFestivalByShortNameLookup(
	catalog: CheckoutCatalogReadPort,
	input: StartClassCheckoutInput,
	trimmedShortName: string,
	lineInputs: ClassCheckoutLineItemInput[],
	preResolvedClasses: Map<string, FestivalClassConfiguration>,
): Promise<{
	festival?: FestivalRecord;
	festivalId: string;
	preResolvedClasses: Map<string, FestivalClassConfiguration>;
}> {
	let resolvedFestivalId = input.festivalId ?? "";
	let resolvedFestival: FestivalRecord | undefined;
	for (const line of lineInputs) {
		if (preResolvedClasses.has(line.festivalClassId)) continue;
		const result = await catalog.findActiveFestivalClassByShortName?.(
			input.organizationId,
			trimmedShortName,
			line.festivalClassId,
			input.festivalId,
		);
		if (!result) {
			throw new AppError("Festival class configuration not found.", 404);
		}
		const fc = "festivalClass" in result ? result.festivalClass : result;
		if ("festival" in result && result.festival) {
			resolvedFestival = result.festival;
		}
		if (resolvedFestivalId && fc.festivalId !== resolvedFestivalId) {
			throw new AppError("Festival class configuration not found.", 404);
		}
		resolvedFestivalId = fc.festivalId;
		preResolvedClasses.set(line.festivalClassId, fc);
	}
	return {
		festival: resolvedFestival,
		festivalId: resolvedFestivalId,
		preResolvedClasses,
	};
}

export function buildValidatedLineData(params: {
	child: CheckoutChildRecord;
	festivalClass: FestivalClassConfiguration;
	line: ClassCheckoutLineItemInput;
	divisionName: string | null;
	subtype: RegistrationCatalogValue | null;
	currencyCode: string;
	capturedAtIso: string;
	teacherGrant:
		| CheckoutTeacherGrantSnapshot
		| { id: string; contact: { name: string } };
	teacherName: string | null;
	accompanistGrant: AccompanistMembershipGrant | null;
	pieces: RepertoirePiece[];
	instrument: ClassRegistrationSnapshot["instrument"];
}) {
	return {
		child: params.child,
		festivalClass: params.festivalClass,
		pieces: params.pieces,
		teacherMembershipId: params.teacherGrant.id,
		accompanistMembershipId: params.accompanistGrant?.id ?? null,
		currencyCode: params.currencyCode,
		registrationSnapshot: captureLineRegistrationSnapshot({
			festivalId: params.festivalClass.festivalId,
			festivalClass: params.festivalClass,
			divisionName: params.divisionName,
			subtypeName: params.subtype?.displayName ?? null,
			currencyCode: params.currencyCode,
			teacherId: params.line.teacherId,
			teacherMembershipId: params.teacherGrant.id,
			teacherName: params.teacherName,
			accompanistId: params.line.accompanistId ?? null,
			accompanistMembershipId: params.accompanistGrant?.id ?? null,
			accompanistName: params.accompanistGrant
				? params.accompanistGrant.contact.name
				: null,
			instrument: params.instrument,
			pieces: params.pieces,
			capturedAtIso: params.capturedAtIso,
		}),
	};
}
