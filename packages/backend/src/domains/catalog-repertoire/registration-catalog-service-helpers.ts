import {
	AppError,
	DEFAULT_FESTIVAL_CLASS_CAPACITY,
	divisionNameUniquenessKey,
	type FestivalClassConfiguration,
	validateDivisionName,
} from "@festival/common";
import {
	type ClassEntitlementCounter,
	validateCreateClassInput,
	validateUpdateClassInput,
} from "../../infra/s09-infra.js";
import type {
	CreateFestivalClassConfigurationInput,
	RegistrationCatalogKind,
} from "./catalog-mappers.js";
import type { DivisionFestivalRepository } from "./division-festival-repository.js";
import type { RegistrationCatalogRepository } from "./registration-catalog-repository.js";

function parseRequiredSubtypeId(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new AppError("Required class subtype must be a string or null.", 400);
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function handleCatalogRepositoryError(error: unknown): never {
	if (error instanceof AppError) throw error;
	if (error instanceof Error) {
		if (error.message === "Registration catalog value already exists.") {
			throw new AppError(error.message, 409);
		}
		if (
			error.message.includes("subtype") ||
			error.message.includes("cycle") ||
			error.message.includes("depend")
		) {
			throw new AppError(error.message, 400);
		}
	}
	throw error;
}

function requireCatalogDisplayName(value: unknown): string {
	try {
		return validateDivisionName(value);
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid catalog display name.",
			400,
		);
	}
}

export async function createClassDirect(
	catalog: RegistrationCatalogRepository,
	divisionFestivals: DivisionFestivalRepository,
	organizationId: string,
	festivalId: string,
	input: Omit<
		CreateFestivalClassConfigurationInput,
		"organizationId" | "festivalId"
	>,
	actorUid?: string,
): Promise<FestivalClassConfiguration> {
	const validated = validateCreateClassInput(input);
	if (validated.divisionId) {
		const divisions = await divisionFestivals.listDivisions(organizationId);
		if (!divisions.some((d) => d.id === validated.divisionId)) {
			throw new AppError("Division not found.", 404);
		}
	}
	if (validated.classSubtypeId) {
		const subtypes = await catalog.listRegistrationCatalogValues(
			organizationId,
			"class_subtype",
		);
		if (!subtypes.some((s) => s.id === validated.classSubtypeId)) {
			throw new AppError("Class subtype not found.", 404);
		}
	}
	return catalog.createFestivalClassConfigurationWithCapacityAudit(
		{
			...validated,
			maximumPerformancePieces: validated.maximumPerformancePieces ?? 1,
			capacity: validated.capacity ?? DEFAULT_FESTIVAL_CLASS_CAPACITY,
			organizationId,
			festivalId,
		},
		actorUid,
	);
}

export async function updateClassDirect(
	catalog: RegistrationCatalogRepository,
	commerce: ClassEntitlementCounter | undefined,
	organizationId: string,
	festivalId: string,
	classId: string,
	input: unknown,
	actorUid?: string,
): Promise<FestivalClassConfiguration> {
	const validated = validateUpdateClassInput(input);
	const existing = await catalog.findFestivalClassConfigurationById(
		organizationId,
		festivalId,
		classId,
	);
	if (!existing) {
		throw new AppError("Festival class configuration not found.", 404);
	}
	try {
		return await catalog.updateFestivalClassConfigurationWithCapacityAudit(
			{ ...validated, id: classId, organizationId, festivalId },
			actorUid,
			commerce
				? () =>
						commerce.countConfirmedClassEntitlements(organizationId, classId)
				: undefined,
		);
	} catch (error) {
		if (error instanceof AppError) throw error;
		if (
			error instanceof Error &&
			error.message === "Festival class configuration not found."
		) {
			throw new AppError(error.message, 404);
		}
		throw error;
	}
}

export async function updateCatalogValueImpl(
	catalog: RegistrationCatalogRepository,
	organizationId: string,
	kind: RegistrationCatalogKind,
	id: string,
	input: {
		displayName?: unknown;
		isActive?: unknown;
		requiredSubtypeId?: unknown;
	},
) {
	if (
		input.displayName === undefined &&
		input.isActive === undefined &&
		input.requiredSubtypeId === undefined
	) {
		throw new AppError("Registration catalog update is required.", 400);
	}
	if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
		throw new AppError("isActive must be a boolean.", 400);
	}
	const parsedRequiredSubtypeId = parseRequiredSubtypeId(
		input.requiredSubtypeId,
	);
	const displayName =
		input.displayName !== undefined
			? requireCatalogDisplayName(input.displayName)
			: undefined;
	try {
		const value = await catalog.updateRegistrationCatalogValue({
			organizationId,
			kind,
			id,
			displayName,
			normalizedName:
				displayName !== undefined
					? divisionNameUniquenessKey(displayName)
					: undefined,
			isActive: input.isActive,
			requiredSubtypeId: parsedRequiredSubtypeId,
		});
		if (!value) {
			throw new AppError("Registration catalog value not found.", 404);
		}
		return value;
	} catch (error) {
		handleCatalogRepositoryError(error);
	}
}

export async function createFestivalSubtypeImpl(
	catalog: RegistrationCatalogRepository,
	organizationId: string,
	festivalId: string,
	value: unknown,
	requiredSubtypeId?: unknown,
) {
	const displayName = requireCatalogDisplayName(value);
	const normalizedName = divisionNameUniquenessKey(displayName);
	const parsedRequiredSubtypeId = parseRequiredSubtypeId(requiredSubtypeId);
	try {
		const existing = (
			await catalog.listRegistrationCatalogValues(
				organizationId,
				"class_subtype",
				false,
			)
		).find(
			(item) => divisionNameUniquenessKey(item.displayName) === normalizedName,
		);
		const created =
			existing ??
			(await catalog.createRegistrationCatalogValue({
				organizationId,
				kind: "class_subtype",
				displayName,
				normalizedName,
				requiredSubtypeId: parsedRequiredSubtypeId,
			}));
		await catalog.associateFestivalClassSubtype({
			organizationId,
			festivalId,
			classSubtypeId: created.id,
		});
		return created;
	} catch (error) {
		handleCatalogRepositoryError(error);
	}
}

export async function reorderCatalogValuesImpl(
	catalog: RegistrationCatalogRepository,
	organizationId: string,
	kind: RegistrationCatalogKind,
	ids: unknown,
) {
	if (!Array.isArray(ids)) {
		throw new AppError("Registration catalog order is invalid.", 400);
	}
	try {
		return await catalog.reorderRegistrationCatalogValues(
			organizationId,
			kind,
			ids,
		);
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw new AppError(
			error instanceof Error
				? error.message
				: "Registration catalog order is invalid.",
			400,
		);
	}
}

export async function createCatalogValueImpl(
	catalog: RegistrationCatalogRepository,
	organizationId: string,
	kind: RegistrationCatalogKind,
	displayNameInput: unknown,
	requiredSubtypeId?: unknown,
) {
	const displayName = requireCatalogDisplayName(displayNameInput);
	const parsedRequiredSubtypeId = parseRequiredSubtypeId(requiredSubtypeId);
	try {
		return await catalog.createRegistrationCatalogValue({
			organizationId,
			kind,
			displayName,
			normalizedName: divisionNameUniquenessKey(displayName),
			requiredSubtypeId: parsedRequiredSubtypeId,
		});
	} catch (error) {
		handleCatalogRepositoryError(error);
	}
}
