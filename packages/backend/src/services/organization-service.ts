import type {
	AcceptInviteInput,
	AuthenticatedUser,
	CreateFestivalInput,
	CreateInviteInput,
	CreateOrganizationDivisionInput,
	CreateOrganizationInput,
	ReorderOrganizationDivisionsInput,
	UpdateFestivalRegistrationWindowInput,
	UpdateOrganizationDivisionInput,
	UpdateOrganizationTimezoneInput,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import {
	DivisionFestivalService,
	RegistrationCatalogService,
} from "../domains/catalog-repertoire/index.js";
import {
	OrganizationAgeConfigService,
	OrganizationStaffInviteService,
	RoomService,
	TenantOrganizationService,
} from "../domains/tenant-org/index.js";
import { AppError } from "../errors/app-error.js";
import type { DomainCacheInvalidator } from "../lib/domain-cache-invalidator.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { RoomRepository } from "../rooms/room-repository.js";
import type { AdminClassCatalogService } from "./admin-class-catalog.service.js";

/** Base compatibility facade holding division, festival, and catalog delegators. */
class OrganizationCatalogServiceFacade {
	protected readonly divisionFestivalService: DivisionFestivalService;
	protected readonly registrationCatalogService: RegistrationCatalogService;

	constructor(
		readonly repository: OrganizationRepository,
		adminClassCatalogService?: AdminClassCatalogService,
		options?: { enableDropTransfer?: boolean },
		commerce?: Pick<
			MembershipCommerceRepository,
			"countConfirmedClassEntitlements"
		>,
	) {
		this.divisionFestivalService = new DivisionFestivalService(
			repository,
			repository,
			options,
		);
		this.registrationCatalogService = new RegistrationCatalogService(
			repository,
			repository,
			repository,
			adminClassCatalogService,
			commerce,
		);
	}

	listDivisionsForTenant(tenant: TenantContext) {
		return this.divisionFestivalService.listDivisionsForTenant(tenant);
	}
	listDivisions(organizationId: string, activeOnly?: boolean) {
		return this.divisionFestivalService.listDivisions(
			organizationId,
			activeOnly,
		);
	}
	async listPublicDivisions(organizationSlug: string) {
		const organization =
			await this.repository.findOrganizationBySlug(organizationSlug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const [divisions, instruments] = await Promise.all([
			this.divisionFestivalService.listPublicDivisions(organization.id),
			this.repository.listRegistrationCatalogValues(
				organization.id,
				"instrument",
				true,
			),
		]);
		return {
			divisions,
			instruments: instruments.map(({ id, displayName, displayOrder }) => ({
				id,
				displayName,
				displayOrder,
			})),
		};
	}
	requireSelectableDivision(organizationId: string, divisionId: string) {
		return this.divisionFestivalService.requireSelectableDivision(
			organizationId,
			divisionId,
		);
	}
	createRegistrationCatalogValueForTenant(
		tenant: TenantContext,
		kind: "class_subtype" | "instrument",
		value: unknown,
		requiredSubtypeId?: unknown,
	) {
		return this.registrationCatalogService.createRegistrationCatalogValueForTenant(
			tenant,
			kind,
			value,
			requiredSubtypeId,
		);
	}
	updateRegistrationCatalogValueForTenant(
		tenant: TenantContext,
		kind: "class_subtype" | "instrument",
		id: string,
		input: {
			displayName?: unknown;
			isActive?: unknown;
			requiredSubtypeId?: unknown;
		},
	) {
		return this.registrationCatalogService.updateRegistrationCatalogValueForTenant(
			tenant,
			kind,
			id,
			input,
		);
	}
	reorderRegistrationCatalogValuesForTenant(
		tenant: TenantContext,
		kind: "class_subtype" | "instrument",
		ids: unknown,
	) {
		return this.registrationCatalogService.reorderRegistrationCatalogValuesForTenant(
			tenant,
			kind,
			ids,
		);
	}
	createDivisionForTenant(
		tenant: TenantContext,
		input: CreateOrganizationDivisionInput,
	) {
		return this.divisionFestivalService.createDivisionForTenant(tenant, input);
	}
	updateDivisionForTenant(
		tenant: TenantContext,
		divisionId: string,
		input: UpdateOrganizationDivisionInput,
	) {
		return this.divisionFestivalService.updateDivisionForTenant(
			tenant,
			divisionId,
			input,
		);
	}
	reorderDivisionsForTenant(
		tenant: TenantContext,
		input: ReorderOrganizationDivisionsInput,
	) {
		return this.divisionFestivalService.reorderDivisionsForTenant(
			tenant,
			input,
		);
	}
	listFestivalsForTenant(tenant: TenantContext) {
		return this.divisionFestivalService.listFestivalsForTenant(tenant);
	}
	getPublicLanding(slug: string) {
		return this.divisionFestivalService.getPublicLanding(slug);
	}
	createFestivalForTenant(tenant: TenantContext, input: CreateFestivalInput) {
		return this.divisionFestivalService.createFestivalForTenant(tenant, input);
	}
	updateFestivalRegistrationWindowForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		input: UpdateFestivalRegistrationWindowInput,
	) {
		return this.divisionFestivalService.updateFestivalRegistrationWindowForTenant(
			tenant,
			festivalShortName,
			input,
		);
	}
	getPrimaryFestivalPath(slug: string) {
		return this.divisionFestivalService.getPrimaryFestivalPath(slug);
	}
	getPublicFestival(organizationSlug: string, festivalShortName: string) {
		return this.divisionFestivalService.getPublicFestival(
			organizationSlug,
			festivalShortName,
		);
	}
	getAdminFestivalForTenant(tenant: TenantContext, festivalShortName: string) {
		return this.divisionFestivalService.getAdminFestivalForTenant(
			tenant,
			festivalShortName,
		);
	}
	setPrimaryFestivalForTenant(tenant: TenantContext, shortName: string) {
		return this.divisionFestivalService.setPrimaryFestivalForTenant(
			tenant,
			shortName,
		);
	}
	listFestivalClasses(orgSlug: string, festivalShortName: string) {
		return this.registrationCatalogService.listFestivalClasses(
			orgSlug,
			festivalShortName,
		);
	}
	listFestivalClassSubtypesForTenant(
		tenant: TenantContext,
		festivalShortName: string,
	) {
		return this.registrationCatalogService.listFestivalClassSubtypesForTenant(
			tenant,
			festivalShortName,
		);
	}
	createFestivalClassSubtypeForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		value: unknown,
		requiredSubtypeId?: unknown,
	) {
		return this.registrationCatalogService.createFestivalClassSubtypeForTenant(
			tenant,
			festivalShortName,
			value,
			requiredSubtypeId,
		);
	}
	createFestivalClass(
		orgSlug: string,
		festivalShortName: string,
		input: Parameters<RegistrationCatalogService["createFestivalClass"]>[2],
		actorUid?: string,
	) {
		return this.registrationCatalogService.createFestivalClass(
			orgSlug,
			festivalShortName,
			input,
			actorUid,
		);
	}
	updateFestivalClass(
		orgSlug: string,
		festivalShortName: string,
		classId: string,
		input: unknown,
		actorUid?: string,
	) {
		return this.registrationCatalogService.updateFestivalClass(
			orgSlug,
			festivalShortName,
			classId,
			input,
			actorUid,
		);
	}
}

/** Compatibility facade delegating OrganizationService calls to S09 domain services. */
export class OrganizationService extends OrganizationCatalogServiceFacade {
	private readonly tenantOrgService: TenantOrganizationService;
	private readonly staffInviteService: OrganizationStaffInviteService;
	private readonly ageConfigService: OrganizationAgeConfigService;
	private readonly roomService: RoomService;

	constructor(
		repository: OrganizationRepository,
		adminClassCatalogService?: AdminClassCatalogService,
		options?: { enableDropTransfer?: boolean },
		roomRepository?: RoomRepository,
		commerce?: Pick<
			MembershipCommerceRepository,
			"countConfirmedClassEntitlements"
		>,
	) {
		super(repository, adminClassCatalogService, options, commerce);
		this.tenantOrgService = new TenantOrganizationService(
			repository,
			repository,
			options,
		);
		this.staffInviteService = new OrganizationStaffInviteService(repository);
		this.ageConfigService = new OrganizationAgeConfigService(repository);
		this.roomService = new RoomService(roomRepository, repository);
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.tenantOrgService.bindCacheInvalidator(invalidator);
		this.ageConfigService.bindCacheInvalidator(invalidator);
		this.divisionFestivalService.bindCacheInvalidator(invalidator);
		this.registrationCatalogService.bindCacheInvalidator(invalidator);
	}

	getSession(identity?: AuthenticatedUser) {
		return this.tenantOrgService.getSession(identity);
	}
	listMemberships(identity: AuthenticatedUser) {
		return this.tenantOrgService.listMemberships(identity);
	}
	createOrganization(
		identity: AuthenticatedUser,
		input: CreateOrganizationInput,
	) {
		return this.tenantOrgService.createOrganization(identity, input);
	}
	getAccompanistDivisionPolicy(organizationId: string) {
		return this.tenantOrgService.getAccompanistDivisionPolicy(organizationId);
	}
	updateAccompanistDivisionPolicy(
		options: Parameters<
			TenantOrganizationService["updateAccompanistDivisionPolicy"]
		>[0],
	) {
		return this.tenantOrgService.updateAccompanistDivisionPolicy(options);
	}
	async getRegistrationConfigurationForTenant(tenant: TenantContext) {
		const [ageConfig, catalogConfig] = await Promise.all([
			this.ageConfigService.getRegistrationConfigurationForTenant(tenant),
			this.registrationCatalogService.listRegistrationCatalogConfiguration(
				tenant.organization.id,
			),
		]);
		return { ...ageConfig, ...catalogConfig };
	}
	updateRegistrationAgeDateForTenant(tenant: TenantContext, value: unknown) {
		return this.ageConfigService.updateRegistrationAgeDateForTenant(
			tenant,
			value,
		);
	}
	getTimezoneForTenant(tenant: TenantContext) {
		return this.tenantOrgService.getTimezoneForTenant(tenant);
	}
	updateTimezoneForTenant(
		tenant: TenantContext,
		input: UpdateOrganizationTimezoneInput,
	) {
		return this.tenantOrgService.updateTimezoneForTenant(tenant, input);
	}
	createInvite(identity: AuthenticatedUser, input: CreateInviteInput) {
		return this.staffInviteService.createInvite(identity, input);
	}
	createInviteForTenant(tenant: TenantContext, input: CreateInviteInput) {
		return this.staffInviteService.createInviteForTenant(tenant, input);
	}
	listAdminUsersForTenant(tenant: TenantContext) {
		return this.staffInviteService.listAdminUsersForTenant(tenant);
	}
	deleteMembershipForTenant(tenant: TenantContext, membershipId: string) {
		return this.staffInviteService.deleteMembershipForTenant(
			tenant,
			membershipId,
		);
	}
	cancelInviteForTenant(tenant: TenantContext, inviteId: string) {
		return this.staffInviteService.cancelInviteForTenant(tenant, inviteId);
	}
	listRoomsForTenant(tenant: TenantContext, festivalShortName: string) {
		return this.roomService.listRoomsForTenant(tenant, festivalShortName);
	}
	createRoomForTenant(
		tenant: TenantContext,
		festivalShortName: string,
		payload: unknown,
	) {
		return this.roomService.createRoomForTenant(
			tenant,
			festivalShortName,
			payload,
		);
	}
	getInvite(token: string) {
		return this.staffInviteService.getInvite(token);
	}
	acceptInvite(
		identity: AuthenticatedUser,
		token: string,
		input: AcceptInviteInput,
	) {
		return this.staffInviteService.acceptInvite(identity, token, input);
	}
	getOrganizationLanding(identity: AuthenticatedUser, slug: string) {
		return this.tenantOrgService.getOrganizationLanding(identity, slug);
	}
	getOrganizationLandingForTenant(tenant: TenantContext) {
		return this.tenantOrgService.getOrganizationLandingForTenant(tenant);
	}
	dismissWelcome(identity: AuthenticatedUser, slug: string) {
		return this.tenantOrgService.dismissWelcome(identity, slug);
	}
	dismissWelcomeForTenant(tenant: TenantContext) {
		return this.tenantOrgService.dismissWelcomeForTenant(tenant);
	}
}
