import {
	AppError,
	type CanonicalWork,
	type ClassRegistrationMetadata,
	type CustomerClassRegistrationsResponse,
	calendarDateInTimezone,
	deriveFestivalMetadataCutoff,
	type FestivalClassConfiguration,
	isAccompanistMembershipGrantActive,
	type RegistrationAccompanistSummary,
	type RegistrationEligibleClass,
	type RegistrationTeacherSummary,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import {
	resolvePieceCatalogWorks,
	validateAndNormalizeRepertoirePieces,
} from "../checkout/class-checkout-helpers.js";
import { lifecycleForEntitlementRead } from "../commerce/entitlement-lifecycle.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type {
	CustomerChildProfileService,
	CustomerOAuthSessionService,
} from "../domains/customer-identity/index.js";
import type { RepertoireRepository } from "../repertoire/repertoire-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { CustomerAccountRepository } from "./customer-account-repository.js";
import {
	loadEligibleClassesList,
	loadRegistrationResponseItems,
	lookupFestivalById,
} from "./customer-registration-legacy-mappers.js";

type LegacyOAuthPort = Pick<
	CustomerOAuthSessionService,
	| "validateSession"
	| "loadOrganizationBySlug"
	| "checkoutAccess"
	| "customerReadAccess"
	| "now"
>;

interface LegacyRegistrationDeps {
	commerce?: MembershipCommerceRepository;
	checkout?: CheckoutRepository;
	repertoire?: RepertoireRepository;
}

async function validateLegacyAccompanist(
	organizations: OrganizationRepository,
	organizationId: string,
	rawAcc: unknown,
	currentId: string | null,
): Promise<string | null> {
	if (rawAcc === undefined) return currentId;
	if (rawAcc === null) return null;
	if (typeof rawAcc !== "string") {
		throw new AppError(
			"Selected accompanist does not have an active membership.",
			400,
		);
	}
	const trimmed = rawAcc.trim();
	if (!trimmed) return null;
	const grants = await organizations.listAccompanistMembershipGrants({
		organizationId,
		currentOnly: true,
	});
	const active = grants.find(
		(g) =>
			(g.id === trimmed || g.customerId === trimmed) &&
			isAccompanistMembershipGrantActive(g),
	);
	if (!active) {
		throw new AppError(
			"Selected accompanist does not have an active membership.",
			400,
		);
	}
	return active.id;
}

async function applyLegacyMetadataUpdate(
	organizations: OrganizationRepository,
	deps: LegacyRegistrationDeps,
	organizationId: string,
	existing: ClassRegistrationMetadata,
	classConfig: FestivalClassConfiguration,
	input: unknown,
): Promise<ClassRegistrationMetadata> {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new AppError("Invalid request body.", 400);
	}
	const payload = input as {
		pieces?: unknown;
		accompanistMembershipId?: unknown;
		accompanistId?: unknown;
	};
	const subtypes = await organizations.listRegistrationCatalogValues(
		organizationId,
		"class_subtype",
		false,
	);
	const subtype =
		subtypes.find((s) => s.id === classConfig.classSubtypeId) ?? null;
	const catalogWorksById = deps.repertoire
		? await resolvePieceCatalogWorks(
				payload.pieces,
				organizationId,
				deps.repertoire,
			)
		: undefined;
	const pieces = validateAndNormalizeRepertoirePieces(
		payload.pieces,
		classConfig,
		{
			subtype,
			catalogWorksById,
		},
	);
	const rawAcc =
		payload.accompanistMembershipId !== undefined
			? payload.accompanistMembershipId
			: payload.accompanistId;
	const accompanistMembershipId = await validateLegacyAccompanist(
		organizations,
		organizationId,
		rawAcc,
		existing.accompanistMembershipId,
	);
	if (!deps.checkout) {
		throw new AppError("Checkout repository is not configured.", 500);
	}
	return deps.checkout.updateRegistrationMetadata(existing.id, organizationId, {
		accompanistMembershipId,
		pieces,
	});
}

async function requireFestivalAndActiveDivision(
	organizations: OrganizationRepository,
	orgId: string,
	shortName: string,
	divisionId: string,
) {
	if (!shortName || typeof shortName !== "string") {
		throw new AppError("Festival short name is required.", 400);
	}
	const festival = await organizations.findFestivalByShortName(
		orgId,
		shortName,
	);
	if (!festival) throw new AppError("Festival was not found.", 404);
	if (!divisionId || typeof divisionId !== "string") {
		throw new AppError("Division ID is required.", 400);
	}
	const division = (await organizations.listDivisions(orgId, true)).find(
		(d) => d.id === divisionId,
	);
	if (!division) throw new AppError("Division was not found.", 404);
	return { festival, division };
}

async function prepareLegacyMetadataUpdate(
	organizations: OrganizationRepository,
	oauth: LegacyOAuthPort,
	deps: LegacyRegistrationDeps,
	params: {
		slug: string;
		festivalShortName?: string;
		registrationId: string;
		sessionId?: string;
		csrfToken?: string;
		origin?: string;
	},
) {
	const access = await oauth.checkoutAccess(
		params.slug,
		params.sessionId,
		params.csrfToken,
		params.origin,
	);
	const organization = await oauth.loadOrganizationBySlug(params.slug);
	if (!organization) throw new AppError("Organization not found.", 404);
	if (!deps.commerce || !deps.checkout) {
		throw new AppError(
			"Commerce or checkout repository is not configured.",
			500,
		);
	}
	const entitlement = await deps.commerce.getClassEntitlement(
		access.organizationId,
		params.registrationId,
	);
	if (!entitlement || entitlement.parentCustomerId !== access.customerId) {
		throw new AppError("Registration not found.", 404);
	}
	const festival = await lookupFestivalById(
		organizations,
		access.organizationId,
		entitlement.festivalId,
		params.festivalShortName,
	);
	const cutoff = deriveFestivalMetadataCutoff(
		festival.startDate,
		organization.timezone || "UTC",
	);
	if (oauth.now().getTime() >= cutoff.getTime()) {
		throw new AppError(
			"Registration metadata edits are closed for this festival.",
			422,
		);
	}
	return { access, entitlement, festival };
}

async function collectActiveAccompanists(
	organizations: OrganizationRepository,
	organizationId: string,
	nowIso: string,
): Promise<RegistrationAccompanistSummary[]> {
	const [timezone, grants] = await Promise.all([
		organizations.getOrganizationTimezone(organizationId),
		organizations.listAccompanistMembershipGrants({
			organizationId,
			currentOnly: true,
		}),
	]);
	const today = calendarDateInTimezone(nowIso, timezone);
	const seen = new Set<string>();
	const accompanists: RegistrationAccompanistSummary[] = [];
	for (const grant of grants) {
		if (
			lifecycleForEntitlementRead(grant, today) === "active" &&
			!seen.has(grant.customerId)
		) {
			seen.add(grant.customerId);
			accompanists.push({ id: grant.customerId, name: grant.contact.name });
		}
	}
	return accompanists.sort((a, b) => a.name.localeCompare(b.name));
}

/** Temporary registration/eligibility helper for CustomerAccountService until S14 wires S11. */
export class CustomerRegistrationLegacyHelper {
	constructor(
		private readonly repository: CustomerAccountRepository,
		private readonly organizations: OrganizationRepository,
		private readonly oauth: LegacyOAuthPort,
		private readonly children: CustomerChildProfileService,
		private readonly deps: LegacyRegistrationDeps,
	) {}

	async listClassRegistrations(
		slug: string,
		sessionToken: string,
		festivalShortName?: string,
	): Promise<CustomerClassRegistrationsResponse> {
		const session = await this.oauth.validateSession(slug, sessionToken);
		if (!this.deps.commerce || !this.deps.checkout) {
			throw new AppError(
				"Commerce or checkout repository is not configured.",
				500,
			);
		}
		const festival = festivalShortName
			? await this.organizations.findFestivalByShortName(
					session.organizationId,
					festivalShortName,
				)
			: undefined;
		if (festivalShortName && !festival) {
			throw new AppError("Festival not found.", 404);
		}
		const [children, entitlements, organization, festivals] = await Promise.all(
			[
				this.repository.listChildren(
					session.organizationId,
					session.customerId,
				),
				this.deps.commerce.listClassEntitlements({
					organizationId: session.organizationId,
					parentCustomerId: session.customerId,
					festivalId: festival?.id,
				}),
				this.oauth.loadOrganizationBySlug(slug),
				festival
					? Promise.resolve([festival])
					: this.organizations.listFestivals(session.organizationId),
			],
		);
		if (!organization) throw new AppError("Organization not found.", 404);
		return {
			registrations: await loadRegistrationResponseItems(
				this.organizations,
				this.deps.commerce,
				this.deps.checkout,
				{
					organizationId: organization.id,
					timezone: organization.timezone || "UTC",
					children,
					festivals,
					entitlements,
					nowMs: this.oauth.now().getTime(),
				},
			),
		};
	}

	async updateRegistrationMetadata(params: {
		slug: string;
		festivalShortName?: string;
		registrationId: string;
		sessionId?: string;
		csrfToken?: string;
		origin?: string;
		input: unknown;
	}): Promise<{ metadata: ClassRegistrationMetadata }> {
		const { access, entitlement, festival } = await prepareLegacyMetadataUpdate(
			this.organizations,
			this.oauth,
			this.deps,
			params,
		);
		const checkout = this.deps.checkout;
		if (!checkout) {
			throw new AppError("Checkout repository is not configured.", 500);
		}
		const [existing, configs] = await Promise.all([
			checkout.getRegistrationMetadataByEntitlementId(
				access.organizationId,
				entitlement.id,
			),
			this.organizations.listFestivalClassConfigurations(
				access.organizationId,
				festival.id,
			),
		]);
		if (!existing) throw new AppError("Registration metadata not found.", 404);
		const classConfig = configs.find(
			(c) => c.id === entitlement.festivalClassId,
		);
		if (!classConfig) {
			throw new AppError("Festival class configuration not found.", 404);
		}
		return {
			metadata: await applyLegacyMetadataUpdate(
				this.organizations,
				this.deps,
				access.organizationId,
				existing,
				classConfig,
				params.input,
			),
		};
	}

	async listRegistrationTeachers(
		slug: string,
		festivalShortName: string,
		sessionId: string | undefined,
		childId: string,
		divisionId: string,
	): Promise<{ teachers: RegistrationTeacherSummary[] }> {
		const access = await this.oauth.customerReadAccess(slug, sessionId);
		await requireFestivalAndActiveDivision(
			this.organizations,
			access.organizationId,
			festivalShortName,
			divisionId,
		);
		await this.children.requireValidChildAge(
			access.organizationId,
			access.customerId,
			childId,
		);
		const teachers = await this.organizations.listActiveTeachersForDivision(
			access.organizationId,
			divisionId,
		);
		return { teachers: teachers.map((t) => ({ id: t.id, name: t.name })) };
	}

	async searchRegistrationConcertoCatalog(
		slug: string,
		festivalShortName: string,
		sessionId: string | undefined,
		query: string,
	): Promise<{ works: CanonicalWork[] }> {
		const { organizationId } = await this.oauth.customerReadAccess(
			slug,
			sessionId,
		);
		if (!festivalShortName || typeof festivalShortName !== "string") {
			throw new AppError("Festival short name is required.", 400);
		}
		if (
			!(await this.organizations.findFestivalByShortName(
				organizationId,
				festivalShortName,
			))
		) {
			throw new AppError("Festival was not found.", 404);
		}
		if (!this.deps.repertoire) {
			throw new AppError("Repertoire catalog is unavailable.", 503);
		}
		const works = await this.deps.repertoire.searchCatalogWorks({
			organizationId,
			query,
			concertoOnly: true,
		});
		return { works };
	}

	async listRegistrationEligibleClasses(
		slug: string,
		festivalShortName: string,
		sessionId: string | undefined,
		childId: string,
		divisionId: string,
		teacherId: string,
	): Promise<{ classes: RegistrationEligibleClass[] }> {
		const access = await this.oauth.customerReadAccess(slug, sessionId);
		const { festival } = await requireFestivalAndActiveDivision(
			this.organizations,
			access.organizationId,
			festivalShortName,
			divisionId,
		);
		const childAge = await this.children.requireValidChildAge(
			access.organizationId,
			access.customerId,
			childId,
		);
		if (!teacherId || typeof teacherId !== "string") {
			throw new AppError("Teacher ID is required.", 400);
		}
		const activeTeachers =
			await this.organizations.listActiveTeachersForDivision(
				access.organizationId,
				divisionId,
			);
		if (!activeTeachers.some((t) => t.id === teacherId)) {
			throw new AppError(
				"Selected teacher is not eligible in this division.",
				400,
			);
		}
		return {
			classes: await loadEligibleClassesList(
				this.organizations,
				this.deps.commerce,
				{
					organizationId: access.organizationId,
					festival,
					divisionId,
					childAge,
					now: this.oauth.now(),
				},
			),
		};
	}

	async listRegistrationAccompanists(
		slug: string,
		festivalShortName: string,
		sessionId: string | undefined,
	): Promise<{ accompanists: RegistrationAccompanistSummary[] }> {
		const access = await this.oauth.customerReadAccess(slug, sessionId);
		if (!festivalShortName || typeof festivalShortName !== "string") {
			throw new AppError("Festival short name is required.", 400);
		}
		if (
			!(await this.organizations.findFestivalByShortName(
				access.organizationId,
				festivalShortName,
			))
		) {
			throw new AppError("Festival was not found.", 404);
		}
		return {
			accompanists: await collectActiveAccompanists(
				this.organizations,
				access.organizationId,
				this.oauth.now().toISOString(),
			),
		};
	}
}
