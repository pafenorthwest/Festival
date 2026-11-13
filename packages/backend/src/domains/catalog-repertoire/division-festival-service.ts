import { randomUUID } from "node:crypto";
import {
	AppError,
	type CreateFestivalInput,
	type CreateFestivalResponse,
	type CreateOrganizationDivisionInput,
	divisionNameUniquenessKey,
	type FestivalRecord,
	type OrganizationDivision,
	type OrganizationFestivalListResponse,
	type PublicOrganizationLandingResponse,
	type ReorderOrganizationDivisionsInput,
	type UpdateFestivalRegistrationWindowInput,
	type UpdateOrganizationDivisionInput,
	validateDivisionName,
	validateFestivalDates,
	validateFestivalName,
	validateFestivalRegistrationWindow,
	validateOrganizationShortName,
} from "@festival/common";
import {
	type DomainCacheInvalidator,
	emitDomainInvalidation,
	type S09InvalidationSink,
	type TenantContext,
} from "../../infra/s09-infra.js";
import type { TenantRepository } from "../tenant-org/index.js";
import { toFestivalSummary } from "./catalog-mappers.js";
import type { DivisionFestivalRepository } from "./division-festival-repository.js";

function requireDivisionName(value: unknown): string {
	try {
		return validateDivisionName(value);
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid division display name.",
			400,
		);
	}
}

function handleDivisionError(error: unknown): never {
	if (error instanceof AppError) throw error;
	if (
		error instanceof Error &&
		error.message === "Division display name already exists."
	) {
		throw new AppError(error.message, 409);
	}
	throw error;
}

function validateDivisionUpdate(input: UpdateOrganizationDivisionInput) {
	if (input.displayName === undefined && input.isActive === undefined) {
		throw new AppError("Division update is required.", 400);
	}
	if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
		throw new AppError("Division active state must be a boolean.", 400);
	}
	const displayName =
		input.displayName !== undefined
			? requireDivisionName(input.displayName)
			: undefined;
	return {
		displayName,
		normalizedName:
			displayName !== undefined
				? divisionNameUniquenessKey(displayName)
				: undefined,
		isActive: input.isActive,
	};
}

async function createFestivalValidated(
	repo: DivisionFestivalRepository,
	tenants: TenantRepository,
	organization: TenantContext["organization"],
	input: CreateFestivalInput,
): Promise<FestivalRecord> {
	const nameCheck = validateFestivalName(input.name);
	const dateCheck = validateFestivalDates(input);
	const shortCheck = validateOrganizationShortName(input.shortName);
	const errors = [
		...nameCheck.errors,
		...dateCheck.errors,
		...shortCheck.errors,
	];
	if (errors.length > 0) throw new AppError(errors.join(" "), 400);

	const org =
		(await tenants.findOrganizationById(organization.id)) ?? organization;
	const winCheck = validateFestivalRegistrationWindow(
		{
			registrationOpensAt: input.registrationOpensAt,
			registrationClosesAt: input.registrationClosesAt,
		},
		org.timezone,
	);
	if (winCheck.errors.length > 0) {
		throw new AppError(
			winCheck.errors[0] ?? "Registration window is invalid.",
			400,
			"invalid_registration_window",
		);
	}
	if (await repo.findFestivalByName(org.id, nameCheck.normalized)) {
		throw new AppError("Festival name is already registered.", 409);
	}
	if (await repo.findFestivalByShortName(org.id, shortCheck.normalized)) {
		throw new AppError("Festival short name is already registered.", 409);
	}
	return repo.createFestival({
		id: randomUUID(),
		organizationId: org.id,
		code: shortCheck.normalized.toUpperCase(),
		shortName: shortCheck.normalized,
		name: nameCheck.normalized,
		startDate: input.startDate,
		endDate: input.endDate,
		registrationOpensAt: winCheck.opensAtIso,
		registrationClosesAt: winCheck.closesAtIso,
	});
}

async function updateFestivalWindowValidated(
	repo: DivisionFestivalRepository,
	tenants: TenantRepository,
	organization: TenantContext["organization"],
	festivalShortName: string,
	input: UpdateFestivalRegistrationWindowInput,
): Promise<FestivalRecord> {
	const org =
		(await tenants.findOrganizationById(organization.id)) ?? organization;
	const winCheck = validateFestivalRegistrationWindow(input, org.timezone);
	if (winCheck.errors.length > 0) {
		throw new AppError(
			winCheck.errors[0] ?? "Registration window is invalid.",
			400,
			"invalid_registration_window",
		);
	}
	const festival = await repo.findFestivalByShortName(
		org.id,
		festivalShortName,
	);
	if (!festival) throw new AppError("Festival not found.", 404);
	return repo.updateFestivalRegistrationWindow(org.id, festival.id, {
		registrationOpensAt: winCheck.opensAtIso,
		registrationClosesAt: winCheck.closesAtIso,
	});
}

async function loadPublicLanding(
	repo: DivisionFestivalRepository,
	tenants: TenantRepository,
	organizationSlug: string,
	options?: { enableDropTransfer?: boolean },
): Promise<PublicOrganizationLandingResponse> {
	const org = await tenants.findOrganizationBySlug(organizationSlug);
	if (!org) throw new AppError("Organization not found.", 404);
	const today = new Date().toISOString().slice(0, 10);
	const festivals = (await repo.listFestivals(org.id))
		.filter((festival) => festival.endDate >= today)
		.sort((a, b) => a.startDate.localeCompare(b.startDate))
		.map(toFestivalSummary);
	return {
		organization: { name: org.name, slug: org.slug },
		festivals,
		features: { dropTransfer: Boolean(options?.enableDropTransfer) },
	};
}

async function loadPrimaryFestivalPath(
	repo: DivisionFestivalRepository,
	tenants: TenantRepository,
	slug: string,
): Promise<{ status: 301 | 404; path: string }> {
	const organization = await tenants.findOrganizationBySlug(slug);
	if (!organization) throw new AppError("Organization not found.", 404);
	const primary = (await repo.listFestivals(organization.id)).find(
		(festival) => festival.isPrimary,
	);
	return primary
		? {
				status: 301,
				path: `/org/${organization.slug}/festival/${primary.shortName}`,
			}
		: { status: 404, path: "" };
}

async function fetchFestivalByShortName(
	repo: DivisionFestivalRepository,
	organizationId: string,
	shortName: string,
): Promise<FestivalRecord> {
	const festival = await repo.findFestivalByShortName(
		organizationId,
		shortName,
	);
	if (!festival) throw new AppError("Festival not found.", 404);
	return festival;
}

/** Manages divisions, festivals, registration windows, and public organization landing. */
export class DivisionFestivalService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(
		private readonly repo: DivisionFestivalRepository,
		private readonly tenants: TenantRepository,
		private readonly options?: { enableDropTransfer?: boolean },
	) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	async listDivisionsForTenant(tenant: TenantContext, activeOnly = false) {
		return {
			divisions: await this.repo.listDivisions(
				tenant.organization.id,
				activeOnly,
			),
		};
	}

	async listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<OrganizationDivision[]> {
		return this.repo.listDivisions(organizationId, activeOnly);
	}

	async listPublicDivisions(organizationId: string) {
		const organization =
			await this.tenants.findOrganizationById(organizationId);
		if (!organization) throw new AppError("Organization not found.", 404);
		const active = await this.repo.listDivisions(organizationId, true);
		return active.map((d) => ({
			id: d.id,
			displayName: d.displayName,
			displayOrder: d.displayOrder,
		}));
	}

	async requireSelectableDivision(organizationId: string, divisionId: string) {
		const divisions = await this.repo.listDivisions(organizationId, true);
		const found = divisions.find((d) => d.id === divisionId);
		if (!found) {
			throw new AppError("Division is not available for a new purchase.", 400);
		}
		return found;
	}

	async createDivisionForTenant(
		tenant: TenantContext,
		input: CreateOrganizationDivisionInput,
	) {
		const displayName = requireDivisionName(input.displayName);
		try {
			const division = await this.repo.createDivision({
				organizationId: tenant.organization.id,
				displayName,
				normalizedName: divisionNameUniquenessKey(displayName),
			});
			this.emitUpdated(tenant.organization.id, tenant.organization.slug);
			return { division };
		} catch (error) {
			handleDivisionError(error);
		}
	}

	async updateDivisionForTenant(
		tenant: TenantContext,
		divisionId: string,
		input: UpdateOrganizationDivisionInput,
	) {
		const parsed = validateDivisionUpdate(input);
		try {
			const division = await this.repo.updateDivision({
				organizationId: tenant.organization.id,
				divisionId,
				...parsed,
			});
			if (!division) throw new AppError("Division not found.", 404);
			this.emitUpdated(tenant.organization.id, tenant.organization.slug);
			return { division };
		} catch (error) {
			handleDivisionError(error);
		}
	}

	async reorderDivisionsForTenant(
		tenant: TenantContext,
		input: ReorderOrganizationDivisionsInput,
	) {
		if (!Array.isArray(input.divisionIds)) {
			throw new AppError("divisionIds must be an array of division IDs.", 400);
		}
		try {
			const divisions = await this.repo.reorderDivisions(
				tenant.organization.id,
				input.divisionIds,
			);
			this.emitUpdated(tenant.organization.id, tenant.organization.slug);
			return { divisions };
		} catch (error) {
			if (error instanceof AppError) throw error;
			if (
				error instanceof Error &&
				error.message ===
					"Division order must contain every organization division exactly once."
			) {
				throw new AppError(error.message, 400);
			}
			throw error;
		}
	}

	async getPublicLanding(
		organizationSlug: string,
	): Promise<PublicOrganizationLandingResponse> {
		return loadPublicLanding(
			this.repo,
			this.tenants,
			organizationSlug,
			this.options,
		);
	}

	async listFestivalsForTenant(
		tenant: TenantContext,
	): Promise<OrganizationFestivalListResponse> {
		const festivals = await this.repo.listFestivals(tenant.organization.id);
		return { festivals: festivals.map(toFestivalSummary) };
	}

	async createFestivalForTenant(
		tenant: TenantContext,
		input: CreateFestivalInput,
	): Promise<CreateFestivalResponse> {
		const festival = await createFestivalValidated(
			this.repo,
			this.tenants,
			tenant.organization,
			input,
		);
		this.emitUpdated(
			tenant.organization.id,
			tenant.organization.slug,
			festival.id,
		);
		return { festival: toFestivalSummary(festival) };
	}

	async updateFestivalRegistrationWindowForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		input: UpdateFestivalRegistrationWindowInput,
	): Promise<CreateFestivalResponse> {
		const updated = await updateFestivalWindowValidated(
			this.repo,
			this.tenants,
			tenant.organization,
			festivalShortName,
			input,
		);
		this.emitUpdated(
			tenant.organization.id,
			tenant.organization.slug,
			updated.id,
		);
		return { festival: toFestivalSummary(updated) };
	}

	async getPrimaryFestivalPath(
		slug: string,
	): Promise<{ status: 301 | 404; path: string }> {
		return loadPrimaryFestivalPath(this.repo, this.tenants, slug);
	}

	async getPublicFestival(
		organizationSlug: string,
		festivalShortName: string,
	): Promise<CreateFestivalResponse> {
		const organization =
			await this.tenants.findOrganizationBySlug(organizationSlug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const festival = await fetchFestivalByShortName(
			this.repo,
			organization.id,
			festivalShortName,
		);
		return { festival: toFestivalSummary(festival) };
	}

	async getAdminFestivalForTenant(
		tenant: TenantContext,
		festivalShortName: string,
	): Promise<CreateFestivalResponse> {
		const festival = await fetchFestivalByShortName(
			this.repo,
			tenant.organization.id,
			festivalShortName,
		);
		return { festival: toFestivalSummary(festival) };
	}

	async setPrimaryFestivalForTenant(
		tenant: TenantContext,
		shortName: string,
	): Promise<CreateFestivalResponse> {
		const festival = await fetchFestivalByShortName(
			this.repo,
			tenant.organization.id,
			shortName,
		);
		const updated = await this.repo.setPrimaryFestival(
			tenant.organization.id,
			festival.id,
		);
		this.emitUpdated(
			tenant.organization.id,
			tenant.organization.slug,
			updated.id,
		);
		return { festival: toFestivalSummary(updated) };
	}

	private emitUpdated(
		organizationId: string,
		slug?: string,
		festivalId?: string,
	): void {
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "FestivalCatalogUpdated",
			organizationId,
			slug,
			festivalId,
		});
	}
}
