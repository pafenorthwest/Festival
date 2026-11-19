import {
	type DivisionFestivalRepository,
	PostgresDivisionFestivalRepository,
	PostgresRegistrationCatalogRepository,
	type RegistrationCatalogRepository,
} from "../domains/catalog-repertoire/index.js";
import {
	type AppUserMembershipRepository,
	PostgresAppUserMembershipRepository,
	PostgresTenantRepository,
	type TenantRepository,
} from "../domains/tenant-org/index.js";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../infra/s09-infra.js";

type EnsureReadyFn = () => Promise<void>;

/** Base facade delegating S09 tenant-org methods to domain repositories. */
class PostgresTenantMembershipFacade
	implements TenantRepository, AppUserMembershipRepository
{
	protected readonly schema: string;
	protected readonly ensureReadyCallback: EnsureReadyFn;
	private readonly tenantRepo: PostgresTenantRepository;
	private readonly membershipRepo: PostgresAppUserMembershipRepository;
	protected readonly divisionFestivalRepo: PostgresDivisionFestivalRepository;
	protected readonly catalogRepo: PostgresRegistrationCatalogRepository;
	private initialized = false;
	private initPromise: Promise<void> | null = null;

	constructor(schema = defaultPostgresSchemaName()) {
		this.schema = postgresSchemaName(schema);
		this.ensureReadyCallback = () => this.ensureReady();
		this.tenantRepo = new PostgresTenantRepository(
			this.schema,
			this.ensureReadyCallback,
		);
		this.membershipRepo = new PostgresAppUserMembershipRepository(
			this.schema,
			this.ensureReadyCallback,
		);
		this.divisionFestivalRepo = new PostgresDivisionFestivalRepository(
			this.schema,
			this.ensureReadyCallback,
		);
		this.catalogRepo = new PostgresRegistrationCatalogRepository(
			this.schema,
			this.ensureReadyCallback,
		);
	}

	async ensureReady(): Promise<void> {
		if (this.initialized) return;
		if (!this.initPromise) {
			this.initPromise = initializePostgresSchema(this.schema).then(() => {
				this.initialized = true;
			});
		}
		await this.initPromise;
	}

	findOrganizationById(
		...args: Parameters<TenantRepository["findOrganizationById"]>
	) {
		return this.tenantRepo.findOrganizationById(...args);
	}
	listOrganizationSlugs() {
		return this.tenantRepo.listOrganizationSlugs();
	}
	findOrganizationBySlug(
		...args: Parameters<TenantRepository["findOrganizationBySlug"]>
	) {
		return this.tenantRepo.findOrganizationBySlug(...args);
	}
	findOrganizationByName(
		...args: Parameters<TenantRepository["findOrganizationByName"]>
	) {
		return this.tenantRepo.findOrganizationByName(...args);
	}
	findOrganizationByShopDomain(
		...args: Parameters<TenantRepository["findOrganizationByShopDomain"]>
	) {
		return this.tenantRepo.findOrganizationByShopDomain(...args);
	}
	createOrganization(
		...args: Parameters<TenantRepository["createOrganization"]>
	) {
		return this.tenantRepo.createOrganization(...args);
	}
	getOrganizationTimezone(
		...args: Parameters<TenantRepository["getOrganizationTimezone"]>
	) {
		return this.tenantRepo.getOrganizationTimezone(...args);
	}
	updateOrganizationTimezone(
		...args: Parameters<TenantRepository["updateOrganizationTimezone"]>
	) {
		return this.tenantRepo.updateOrganizationTimezone(...args);
	}
	getAccompanistDivisionPolicy(
		...args: Parameters<TenantRepository["getAccompanistDivisionPolicy"]>
	) {
		return this.tenantRepo.getAccompanistDivisionPolicy(...args);
	}
	updateAccompanistDivisionPolicy(
		...args: Parameters<TenantRepository["updateAccompanistDivisionPolicy"]>
	) {
		return this.tenantRepo.updateAccompanistDivisionPolicy(...args);
	}
	listAccompanistDivisionPolicyHistory(
		...args: Parameters<
			TenantRepository["listAccompanistDivisionPolicyHistory"]
		>
	) {
		return this.tenantRepo.listAccompanistDivisionPolicyHistory(...args);
	}
	getRegistrationAgeConfiguration(
		...args: Parameters<TenantRepository["getRegistrationAgeConfiguration"]>
	) {
		return this.tenantRepo.getRegistrationAgeConfiguration(...args);
	}
	updateRegistrationAgeConfiguration(
		...args: Parameters<TenantRepository["updateRegistrationAgeConfiguration"]>
	) {
		return this.tenantRepo.updateRegistrationAgeConfiguration(...args);
	}
	upsertUser(...args: Parameters<AppUserMembershipRepository["upsertUser"]>) {
		return this.membershipRepo.upsertUser(...args);
	}
	findMembershipByUserId(
		...args: Parameters<AppUserMembershipRepository["findMembershipByUserId"]>
	) {
		return this.membershipRepo.findMembershipByUserId(...args);
	}
	listMembershipsByUserId(
		...args: Parameters<AppUserMembershipRepository["listMembershipsByUserId"]>
	) {
		return this.membershipRepo.listMembershipsByUserId(...args);
	}
	findMembershipByUserAndSlug(
		...args: Parameters<
			AppUserMembershipRepository["findMembershipByUserAndSlug"]
		>
	) {
		return this.membershipRepo.findMembershipByUserAndSlug(...args);
	}
	createMembership(
		...args: Parameters<AppUserMembershipRepository["createMembership"]>
	) {
		return this.membershipRepo.createMembership(...args);
	}
	dismissWelcome(
		...args: Parameters<AppUserMembershipRepository["dismissWelcome"]>
	) {
		return this.membershipRepo.dismissWelcome(...args);
	}
	createInvite(
		...args: Parameters<AppUserMembershipRepository["createInvite"]>
	) {
		return this.membershipRepo.createInvite(...args);
	}
	findInviteByToken(
		...args: Parameters<AppUserMembershipRepository["findInviteByToken"]>
	) {
		return this.membershipRepo.findInviteByToken(...args);
	}
	markInviteAccepted(
		...args: Parameters<AppUserMembershipRepository["markInviteAccepted"]>
	) {
		return this.membershipRepo.markInviteAccepted(...args);
	}
	listAdminUsers(
		...args: Parameters<AppUserMembershipRepository["listAdminUsers"]>
	) {
		return this.membershipRepo.listAdminUsers(...args);
	}
	deleteMembership(
		...args: Parameters<AppUserMembershipRepository["deleteMembership"]>
	) {
		return this.membershipRepo.deleteMembership(...args);
	}
	cancelInvite(
		...args: Parameters<AppUserMembershipRepository["cancelInvite"]>
	) {
		return this.membershipRepo.cancelInvite(...args);
	}
}

/** Facade delegating S09 tenant-org and catalog-repertoire methods to domain repositories. */
export class PostgresTenantCatalogFacade
	extends PostgresTenantMembershipFacade
	implements DivisionFestivalRepository, RegistrationCatalogRepository
{
	listDivisions(
		...args: Parameters<DivisionFestivalRepository["listDivisions"]>
	) {
		return this.divisionFestivalRepo.listDivisions(...args);
	}
	createDivision(
		...args: Parameters<DivisionFestivalRepository["createDivision"]>
	) {
		return this.divisionFestivalRepo.createDivision(...args);
	}
	updateDivision(
		...args: Parameters<DivisionFestivalRepository["updateDivision"]>
	) {
		return this.divisionFestivalRepo.updateDivision(...args);
	}
	reorderDivisions(
		...args: Parameters<DivisionFestivalRepository["reorderDivisions"]>
	) {
		return this.divisionFestivalRepo.reorderDivisions(...args);
	}
	listFestivals(
		...args: Parameters<DivisionFestivalRepository["listFestivals"]>
	) {
		return this.divisionFestivalRepo.listFestivals(...args);
	}
	createFestival(
		...args: Parameters<DivisionFestivalRepository["createFestival"]>
	) {
		return this.divisionFestivalRepo.createFestival(...args);
	}
	findFestivalByName(
		...args: Parameters<DivisionFestivalRepository["findFestivalByName"]>
	) {
		return this.divisionFestivalRepo.findFestivalByName(...args);
	}
	findFestivalByShortName(
		...args: Parameters<DivisionFestivalRepository["findFestivalByShortName"]>
	) {
		return this.divisionFestivalRepo.findFestivalByShortName(...args);
	}
	setPrimaryFestival(
		...args: Parameters<DivisionFestivalRepository["setPrimaryFestival"]>
	) {
		return this.divisionFestivalRepo.setPrimaryFestival(...args);
	}
	updateFestivalRegistrationWindow(
		...args: Parameters<
			DivisionFestivalRepository["updateFestivalRegistrationWindow"]
		>
	) {
		return this.divisionFestivalRepo.updateFestivalRegistrationWindow(...args);
	}
	listRegistrationCatalogValues(
		...args: Parameters<
			RegistrationCatalogRepository["listRegistrationCatalogValues"]
		>
	) {
		return this.catalogRepo.listRegistrationCatalogValues(...args);
	}
	listFestivalClassSubtypes(
		...args: Parameters<
			RegistrationCatalogRepository["listFestivalClassSubtypes"]
		>
	) {
		return this.catalogRepo.listFestivalClassSubtypes(...args);
	}
	associateFestivalClassSubtype(
		...args: Parameters<
			RegistrationCatalogRepository["associateFestivalClassSubtype"]
		>
	) {
		return this.catalogRepo.associateFestivalClassSubtype(...args);
	}
	createRegistrationCatalogValue(
		...args: Parameters<
			RegistrationCatalogRepository["createRegistrationCatalogValue"]
		>
	) {
		return this.catalogRepo.createRegistrationCatalogValue(...args);
	}
	updateRegistrationCatalogValue(
		...args: Parameters<
			RegistrationCatalogRepository["updateRegistrationCatalogValue"]
		>
	) {
		return this.catalogRepo.updateRegistrationCatalogValue(...args);
	}
	reorderRegistrationCatalogValues(
		...args: Parameters<
			RegistrationCatalogRepository["reorderRegistrationCatalogValues"]
		>
	) {
		return this.catalogRepo.reorderRegistrationCatalogValues(...args);
	}
	createFestivalClassConfigurationWithCapacityAudit(
		...args: Parameters<
			RegistrationCatalogRepository["createFestivalClassConfigurationWithCapacityAudit"]
		>
	) {
		return this.catalogRepo.createFestivalClassConfigurationWithCapacityAudit(
			...args,
		);
	}
	updateFestivalClassConfigurationWithCapacityAudit(
		...args: Parameters<
			RegistrationCatalogRepository["updateFestivalClassConfigurationWithCapacityAudit"]
		>
	) {
		return this.catalogRepo.updateFestivalClassConfigurationWithCapacityAudit(
			...args,
		);
	}
	createFestivalClassConfiguration(
		...args: Parameters<
			RegistrationCatalogRepository["createFestivalClassConfiguration"]
		>
	) {
		return this.catalogRepo.createFestivalClassConfiguration(...args);
	}
	updateFestivalClassConfiguration(
		...args: Parameters<
			RegistrationCatalogRepository["updateFestivalClassConfiguration"]
		>
	) {
		return this.catalogRepo.updateFestivalClassConfiguration(...args);
	}
	findFestivalClassConfigurationsByIds(
		...args: Parameters<
			RegistrationCatalogRepository["findFestivalClassConfigurationsByIds"]
		>
	) {
		return this.catalogRepo.findFestivalClassConfigurationsByIds(...args);
	}
	findFestivalClassConfigurationById(
		organizationId: string,
		festivalId: string,
		classId: string,
	): ReturnType<
		RegistrationCatalogRepository["findFestivalClassConfigurationById"]
	>;
	findFestivalClassConfigurationById(
		organizationId: string,
		classId: string,
	): ReturnType<
		RegistrationCatalogRepository["findFestivalClassConfigurationById"]
	>;
	findFestivalClassConfigurationById(
		organizationId: string,
		festivalIdOrClassId: string,
		classId?: string,
	) {
		return classId === undefined
			? this.catalogRepo.findFestivalClassConfigurationById(
					organizationId,
					festivalIdOrClassId,
				)
			: this.catalogRepo.findFestivalClassConfigurationById(
					organizationId,
					festivalIdOrClassId,
					classId,
				);
	}
	findActiveFestivalClassByShortName(
		...args: Parameters<
			RegistrationCatalogRepository["findActiveFestivalClassByShortName"]
		>
	) {
		return this.catalogRepo.findActiveFestivalClassByShortName(...args);
	}
	listFestivalClassConfigurations(
		...args: Parameters<
			RegistrationCatalogRepository["listFestivalClassConfigurations"]
		>
	) {
		return this.catalogRepo.listFestivalClassConfigurations(...args);
	}
	recordFestivalClassCapacityAudit(
		...args: Parameters<
			RegistrationCatalogRepository["recordFestivalClassCapacityAudit"]
		>
	) {
		return this.catalogRepo.recordFestivalClassCapacityAudit(...args);
	}
	listFestivalClassCapacityAudits(
		...args: Parameters<
			RegistrationCatalogRepository["listFestivalClassCapacityAudits"]
		>
	) {
		return this.catalogRepo.listFestivalClassCapacityAudits(...args);
	}
}
