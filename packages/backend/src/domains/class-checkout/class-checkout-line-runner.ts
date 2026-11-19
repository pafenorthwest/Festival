import type { AccompanistMembershipGrant } from "@festival/common";
import {
	AppError,
	type ClassCheckoutLineItemInput,
	type ClassRegistrationSnapshot,
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
	buildValidatedLineData,
	resolveFestivalByShortNameLookup,
	resolveLinePiecesAndInstrument,
} from "./class-checkout-line-helpers.js";
import {
	calculateTotalAmount,
	resolveFestivalClassConfiguration,
	resolveTargetFestival,
	validateAccompanistSelection,
	validateActiveChildAgeSnapshot,
	validateChildAgeRange,
	validateChildOwnership,
	validateTeacherEntitlement,
} from "./class-checkout-validation.js";
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

async function resolveValidatedClassForLine(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	festivalId: string,
	festivalClassId: string,
	maps: CatalogMaps,
): Promise<FestivalClassConfiguration> {
	const preResolved = maps.preResolvedClasses.get(festivalClassId);
	const festivalClass =
		preResolved ??
		(await resolveFestivalClassConfiguration(
			deps.catalog,
			input.organizationId,
			festivalId,
			festivalClassId,
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
	return festivalClass;
}

async function resolveLineParticipants(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	line: ClassCheckoutLineItemInput,
	divisionId: string,
	maps: CatalogMaps,
) {
	const teacherKey = `${line.teacherId}:${divisionId}`;
	const teacherGrant = await memoizeLookup(maps.teacherGrants, teacherKey, () =>
		validateTeacherEntitlement(
			deps.teachers,
			input.organizationId,
			line.teacherId,
			divisionId,
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
	return { teacherGrant, teacherName, accompanistGrant };
}

async function resolveLineChildAndAge(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	childId: string,
	maps: CatalogMaps,
) {
	const child = await memoizeLookup(maps.children, childId, () =>
		validateChildOwnership(
			deps.customers,
			input.organizationId,
			input.customerId,
			childId,
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
	return { child, ageSnap };
}

async function validateSingleClassLine(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	festivalId: string,
	line: ClassCheckoutLineItemInput,
	maps: CatalogMaps,
): Promise<ValidatedClassLineData> {
	const { child, ageSnap } = await resolveLineChildAndAge(
		deps,
		input,
		line.childId,
		maps,
	);
	const festivalClass = await resolveValidatedClassForLine(
		deps,
		input,
		festivalId,
		line.festivalClassId,
		maps,
	);
	validateChildAgeRange(ageSnap.age, festivalClass);
	const { teacherGrant, teacherName, accompanistGrant } =
		await resolveLineParticipants(
			deps,
			input,
			line,
			festivalClass.divisionId,
			maps,
		);
	const subtype = maps.subtypeMap.get(festivalClass.classSubtypeId) ?? null;
	const { pieces, instrument } = await resolveLinePiecesAndInstrument({
		repertoire: deps.repertoire,
		organizationId: input.organizationId,
		line,
		festivalClass,
		subtype,
		instrumentMap: maps.instrumentMap,
	});
	return buildValidatedLineData({
		child,
		festivalClass,
		line,
		divisionName: maps.divisionMap.get(festivalClass.divisionId) ?? null,
		subtype,
		currencyCode: maps.currencyCode,
		capturedAtIso: maps.capturedAtIso,
		teacherGrant,
		teacherName,
		accompanistGrant,
		pieces,
		instrument,
	});
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
			return resolveFestivalByShortNameLookup(
				deps.catalog,
				input,
				trimmed,
				lineInputs,
				preResolvedClasses,
			);
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

async function loadLineCatalogMaps(
	deps: ClassLineValidationDeps,
	input: StartClassCheckoutInput,
	lineInputs: ClassCheckoutLineItemInput[],
	currencyCode: string,
): Promise<{
	festival?: FestivalRecord;
	festivalId: string;
	subtypes: RegistrationCatalogValue[];
	maps: CatalogMaps;
}> {
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
	return {
		festival,
		festivalId,
		subtypes,
		maps: {
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
		},
	};
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
	const { festival, festivalId, subtypes, maps } = await loadLineCatalogMaps(
		deps,
		input,
		lineInputs,
		currencyCode,
	);
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
