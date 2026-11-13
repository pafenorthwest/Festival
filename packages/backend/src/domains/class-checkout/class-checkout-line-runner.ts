import type {
	RegistrationCatalogValue as _RCV,
	AccompanistMembershipGrant,
} from "@festival/common";
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
import type { CheckoutRepository } from "./checkout-types.js";
import {
	classCheckoutRequestFingerprint,
	classCheckoutRequestSnapshot,
	type StartClassCheckoutInput,
} from "./class-checkout-errors.js";
import {
	calculateTotalAmount,
	resolveFestivalClassConfiguration,
	resolvePieceCatalogWorks,
	resolveTargetFestival,
	validateAccompanistSelection,
	validateActiveChildAgeSnapshot,
	validateAndNormalizeRepertoirePieces,
	validateChildAgeRange,
	validateChildOwnership,
	validateTeacherEntitlement,
} from "./class-checkout-validation.js";
import { captureLineRegistrationSnapshot } from "./class-checkout-validation-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutChildAgeSnapshotRecord,
	CheckoutChildRecord,
	CheckoutCustomerIdentityPort,
	CheckoutOrganizationReadPort,
	CheckoutRepertoireReadPort,
	CheckoutTeacherDirectoryPort,
	CheckoutTeacherGrantSnapshot,
} from "./ports.js";

export interface ValidatedClassLineData {
	child: CheckoutChildRecord;
	festivalClass: FestivalClassConfiguration;
	pieces: RepertoirePiece[];
	teacherMembershipId: string;
	accompanistMembershipId: string | null;
	currencyCode: string;
	registrationSnapshot: ClassRegistrationSnapshot;
}

export interface ClassLineValidationDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	teachers: CheckoutTeacherDirectoryPort;
	repertoire?: CheckoutRepertoireReadPort;
	now: () => Date;
}

interface CatalogMaps {
	divisionMap: Map<string, string>;
	subtypeMap: Map<string, RegistrationCatalogValue>;
	instrumentMap: Map<string, RegistrationCatalogValue>;
	preResolvedClasses: Map<string, FestivalClassConfiguration>;
	currencyCode: string;
	capturedAtIso: string;
	children: Map<string, Promise<CheckoutChildRecord>>;
	ageSnapshots: Map<string, Promise<CheckoutChildAgeSnapshotRecord>>;
	teacherGrants: Map<
		string,
		Promise<
			CheckoutTeacherGrantSnapshot | { id: string; contact: { name: string } }
		>
	>;
	teacherNames: Map<string, Promise<string | null>>;
	accompanistGrants: Map<string, Promise<AccompanistMembershipGrant | null>>;
}

function memoizeLookup<T>(
	cache: Map<string, Promise<T>>,
	key: string,
	loader: () => Promise<T>,
): Promise<T> {
	const existing = cache.get(key);
	if (existing) return existing;
	const pending = loader();
	cache.set(key, pending);
	return pending;
}

async function resolveTeacherName(
	deps: ClassLineValidationDeps,
	organizationId: string,
	teacherId: string,
	grantName?: string | null,
): Promise<string | null> {
	if (grantName?.trim()) return grantName.trim();
	if (!deps.organizations.findMembershipCustomerContacts) return null;
	const contacts = await deps.organizations.findMembershipCustomerContacts(
		organizationId,
		[teacherId],
	);
	return contacts.get(teacherId)?.name?.trim() || null;
}

async function validateSingleClassLine(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	festivalId: string,
	line: ClassCheckoutLineItemInput,
	maps: CatalogMaps,
): Promise<ValidatedClassLineData> {
	const child = await memoizeLookup(maps.children, line.childId, () =>
		validateChildOwnership(
			deps.customers,
			input.organizationId,
			input.customerId,
			line.childId,
		),
	);
	const ageSnap = await memoizeLookup(maps.ageSnapshots, child.id, () =>
		validateActiveChildAgeSnapshot(
			deps.customers,
			input.organizationId,
			child.id,
			deps.now(),
		),
	);
	const preResolved = maps.preResolvedClasses.get(line.festivalClassId);
	const festivalClass =
		preResolved ??
		(await resolveFestivalClassConfiguration(
			deps.catalog,
			input.organizationId,
			festivalId,
			line.festivalClassId,
		));
	if (!festivalClass.isActive) {
		throw input.festivalShortName
			? new AppError("Festival class configuration not found.", 404)
			: new AppError("Festival class configuration is inactive.", 400);
	}
	if (
		input.divisionId !== undefined &&
		festivalClass.divisionId !== input.divisionId
	) {
		throw new AppError(
			"Selected class does not belong to the requested division.",
			400,
		);
	}
	validateChildAgeRange(ageSnap.age, festivalClass);
	const teacherKey = `${line.teacherId}:${festivalClass.divisionId}`;
	const teacherGrant = await memoizeLookup(maps.teacherGrants, teacherKey, () =>
		validateTeacherEntitlement(
			deps.teachers,
			input.organizationId,
			line.teacherId,
			festivalClass.divisionId,
			deps.now(),
		),
	);
	const teacherName = await memoizeLookup(
		maps.teacherNames,
		line.teacherId,
		() =>
			resolveTeacherName(
				deps,
				input.organizationId,
				line.teacherId,
				teacherGrant.contact?.name ?? null,
			),
	);
	const trimmedAccomp = line.accompanistId?.trim() || "";
	const accompanistGrant = trimmedAccomp
		? await memoizeLookup(maps.accompanistGrants, trimmedAccomp, () =>
				validateAccompanistSelection(
					deps.teachers,
					input.organizationId,
					trimmedAccomp,
				),
			)
		: null;
	const worksMap = await resolvePieceCatalogWorks(line.pieces ?? [], {
		catalogWorkReader: deps.repertoire,
		organizationId: input.organizationId,
	});
	const subtype = maps.subtypeMap.get(festivalClass.classSubtypeId) ?? null;
	const pieces = validateAndNormalizeRepertoirePieces(
		line.pieces ?? [],
		festivalClass,
		{
			requireConcertoCatalogWork: doesClassRequireConcerto(
				festivalClass,
				subtype,
			),
			preResolvedWorksById: worksMap,
		},
	);
	let inst: RegistrationCatalogValue | undefined;
	if (line.instrumentId !== undefined) {
		if (typeof line.instrumentId !== "string" || !line.instrumentId.trim()) {
			throw new AppError(
				"Selected instrument is invalid.",
				400,
				"instrument_invalid",
			);
		}
		inst = maps.instrumentMap.get(line.instrumentId.trim());
		if (!inst) {
			throw new AppError(
				"Selected instrument is invalid.",
				400,
				"instrument_invalid",
			);
		}
	}
	return {
		child,
		festivalClass,
		pieces,
		teacherMembershipId: teacherGrant.id,
		accompanistMembershipId: accompanistGrant?.id ?? null,
		currencyCode: maps.currencyCode,
		registrationSnapshot: captureLineRegistrationSnapshot({
			festivalId: festivalClass.festivalId,
			festivalClass,
			divisionName: maps.divisionMap.get(festivalClass.divisionId) ?? null,
			subtypeName: subtype?.displayName ?? null,
			currencyCode: maps.currencyCode,
			teacherId: line.teacherId,
			teacherMembershipId: teacherGrant.id,
			teacherName,
			accompanistId: line.accompanistId ?? null,
			accompanistMembershipId: accompanistGrant?.id ?? null,
			accompanistName: accompanistGrant ? accompanistGrant.contact.name : null,
			instrument: inst ? { id: inst.id, name: inst.displayName } : "unknown",
			pieces,
			capturedAtIso: maps.capturedAtIso,
		}),
	};
}

async function resolveFestivalContextForLines(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	lineInputs: ClassCheckoutLineItemInput[],
): Promise<{
	festival?: FestivalRecord;
	festivalId: string;
	preResolvedClasses: Map<string, FestivalClassConfiguration>;
}> {
	const preResolvedClasses = new Map<string, FestivalClassConfiguration>();
	if (input.festivalShortName !== undefined) {
		const trimmed = input.festivalShortName.trim();
		if (!trimmed) {
			throw new AppError("Festival not found.", 404);
		}
		if (deps.catalog.findActiveFestivalClassByShortName) {
			let resolvedFestivalId = input.festivalId ?? "";
			let resolvedFestival: FestivalRecord | undefined;
			for (const line of lineInputs) {
				if (preResolvedClasses.has(line.festivalClassId)) continue;
				const result = await deps.catalog.findActiveFestivalClassByShortName(
					input.organizationId,
					trimmed,
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
		const festivals = await deps.catalog.listFestivals(input.organizationId);
		const festival = resolveTargetFestival(festivals, trimmed);
		if (input.festivalId && festival.id !== input.festivalId) {
			throw new AppError("Festival not found.", 404);
		}
		return { festival, festivalId: festival.id, preResolvedClasses };
	}
	const festivals = await deps.catalog.listFestivals(input.organizationId);
	const festival = input.festivalId
		? festivals.find((f) => f.id === input.festivalId)
		: festivals.find((f) => f.isPrimary);
	if (!festival) {
		throw new AppError("Festival not found.", 404);
	}
	return { festival, festivalId: festival.id, preResolvedClasses };
}

export async function validateAndPrepareClassLines(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	lineInputs: ClassCheckoutLineItemInput[],
): Promise<{
	festival?: FestivalRecord;
	festivalId: string;
	timezone: string;
	currencyCode: string;
	subtypes: RegistrationCatalogValue[];
	validatedLines: ValidatedClassLineData[];
}> {
	const organization = await deps.organizations.findOrganizationById(
		input.organizationId,
	);
	if (!organization) {
		throw new AppError("Organization was not found.", 404);
	}
	const currencyCode = organization.defaultCurrencyCode?.trim() || "USD";
	const [
		{ festival, festivalId, preResolvedClasses },
		divisions,
		subtypes,
		instruments,
	] = await Promise.all([
		resolveFestivalContextForLines(deps, input, lineInputs),
		deps.catalog.listDivisions(input.organizationId, false),
		deps.catalog.listRegistrationCatalogValues(
			input.organizationId,
			"class_subtype",
			false,
		),
		deps.catalog.listRegistrationCatalogValues(
			input.organizationId,
			"instrument",
			true,
		),
	]);
	const maps: CatalogMaps = {
		divisionMap: new Map(divisions.map((d) => [d.id, d.displayName])),
		subtypeMap: new Map(subtypes.map((s) => [s.id, s])),
		instrumentMap: new Map(instruments.map((i) => [i.id, i])),
		preResolvedClasses,
		currencyCode,
		capturedAtIso: deps.now().toISOString(),
		children: new Map(),
		ageSnapshots: new Map(),
		teacherGrants: new Map(),
		teacherNames: new Map(),
		accompanistGrants: new Map(),
	};
	const validatedLines: ValidatedClassLineData[] = [];
	for (const line of lineInputs) {
		validatedLines.push(
			await validateSingleClassLine(deps, input, festivalId, line, maps),
		);
	}
	return {
		festival,
		festivalId,
		timezone: organization.timezone || "UTC",
		currencyCode,
		subtypes,
		validatedLines,
	};
}

export async function createClassCheckoutIntent(
	checkout: CheckoutRepository,
	input: StartClassCheckoutInput,
	validatedLines: ValidatedClassLineData[],
	now: Date,
) {
	const first = validatedLines[0];
	const currencyCode = first.currencyCode;
	const totalAmount = calculateTotalAmount(
		validatedLines.map((l) => l.festivalClass.price),
	);
	const expiresAtIso = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
	return checkout.createIntent({
		organizationId: input.organizationId,
		customerId: input.customerId,
		sessionId: input.sessionId,
		idempotencyKey: input.idempotencyKey,
		intentType: "class_entry",
		festivalClassId: first.festivalClass.id,
		childId: first.child.id,
		shopifyProductGid: first.festivalClass.shopifyProductGid,
		shopifyVariantGid: first.festivalClass.shopifyVariantGid,
		divisionId: first.festivalClass.divisionId,
		divisionNameSnapshot: first.registrationSnapshot.division?.name ?? null,
		amount: totalAmount,
		currencyCode,
		expiresAtIso,
		lines: validatedLines.map((line, lineIndex) => ({
			lineIndex,
			lineType: "class_entry",
			festivalClassId: line.festivalClass.id,
			childId: line.child.id,
			shopifyProductGid: line.festivalClass.shopifyProductGid,
			shopifyVariantGid: line.festivalClass.shopifyVariantGid,
			amount: line.festivalClass.price,
			currencyCode,
			divisionId: line.festivalClass.divisionId,
			divisionNameSnapshot: line.registrationSnapshot.division?.name ?? null,
		})),
		...(checkout.classExecutions
			? {
					classExecution: {
						fingerprint: classCheckoutRequestFingerprint(input),
						requestSnapshot: classCheckoutRequestSnapshot(input),
					},
				}
			: {}),
	});
}
