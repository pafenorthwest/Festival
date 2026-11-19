import type {
	DivisionFestivalRepository,
	RegistrationCatalogRepository,
} from "../domains/catalog-repertoire/index.js";
import type {
	AppUserMembershipRepository,
	TenantRepository,
} from "../domains/tenant-org/index.js";
import { withInMemoryCapacityLock } from "./in-memory-capacity-lock.js";
import {
	inMemAssociateFestivalClassSubtype,
	inMemCreateDivision,
	inMemCreateFestival,
	inMemCreateRegistrationCatalogValue,
	inMemListRegistrationCatalogValues,
	inMemReorderDivisions,
	inMemReorderRegistrationCatalogValues,
	inMemSetPrimaryFestival,
	inMemUpdateDivision,
	inMemUpdateFestivalRegistrationWindow,
	inMemUpdateRegistrationCatalogValue,
	orderedDivisions,
} from "./in-memory-org-catalog.js";
import {
	createClassConfigurationUnlocked,
	inMemCreateClassWithAudit,
	inMemRecordCapacityAudit,
	inMemUpdateClassWithAudit,
	updateClassConfigurationUnlocked,
} from "./in-memory-org-class-catalog.js";
import { inMemFindOrgByShopDomain } from "./in-memory-org-commerce.js";
import {
	createInMemoryOrgState,
	type InMemoryOrgState,
} from "./in-memory-org-state.js";
import {
	inMemCancelInvite,
	inMemCreateInvite,
	inMemCreateMembership,
	inMemCreateOrganization,
	inMemDeleteMembership,
	inMemDismissWelcome,
	inMemFindInviteByToken,
	inMemFindMembershipByUserAndSlug,
	inMemFindMembershipByUserId,
	inMemGetAccompanistDivisionPolicy,
	inMemGetOrganizationTimezone,
	inMemListAccompanistDivisionPolicyHistory,
	inMemListAdminUsers,
	inMemListMembershipsByUserId,
	inMemMarkInviteAccepted,
	inMemUpdateAccompanistDivisionPolicy,
	inMemUpdateOrganizationTimezone,
	inMemUpdateRegistrationAgeConfiguration,
	inMemUpsertUser,
} from "./in-memory-org-tenant.js";

/** Tenant and membership portion of the in-memory adapter base. */
class InMemoryTenantAdapterBase
	implements TenantRepository, AppUserMembershipRepository
{
	protected readonly state: InMemoryOrgState;
	readonly now: () => Date;

	constructor(now: () => Date = () => new Date()) {
		this.now = now;
		this.state = createInMemoryOrgState(now);
	}

	protected get entitlementGrants() {
		return this.state.entitlementGrants;
	}
	protected get accompanistMembershipGrants() {
		return this.state.accompanistMembershipGrants;
	}
	async ensureReady() {}
	async upsertUser(
		user: Parameters<AppUserMembershipRepository["upsertUser"]>[0],
	) {
		return inMemUpsertUser(this.state, user);
	}
	async findMembershipByUserId(userId: string) {
		return inMemFindMembershipByUserId(this.state, userId);
	}
	async listMembershipsByUserId(userId: string) {
		return inMemListMembershipsByUserId(this.state, userId);
	}
	async findMembershipByUserAndSlug(userId: string, slug: string) {
		return inMemFindMembershipByUserAndSlug(this.state, userId, slug);
	}
	async findOrganizationById(organizationId: string) {
		return this.state.organizations.get(organizationId) ?? null;
	}
	async listOrganizationSlugs() {
		return [...this.state.organizationsBySlug.keys()]
			.sort()
			.map((slug) => ({ slug }));
	}
	async findOrganizationBySlug(slug: string) {
		const id = this.state.organizationsBySlug.get(slug);
		return id ? (this.state.organizations.get(id) ?? null) : null;
	}
	async findOrganizationByName(name: string) {
		const id = this.state.organizationsByName.get(name.toLowerCase());
		return id ? (this.state.organizations.get(id) ?? null) : null;
	}
	async findOrganizationByShopDomain(shopDomain: string) {
		return inMemFindOrgByShopDomain(this.state, shopDomain);
	}
	async createOrganization(
		input: Parameters<TenantRepository["createOrganization"]>[0],
	) {
		return inMemCreateOrganization(this.state, input);
	}
	async getOrganizationTimezone(organizationId: string) {
		return inMemGetOrganizationTimezone(this.state, organizationId);
	}
	async updateOrganizationTimezone(organizationId: string, timezone: string) {
		return inMemUpdateOrganizationTimezone(
			this.state,
			organizationId,
			timezone,
		);
	}
	async getAccompanistDivisionPolicy(organizationId: string) {
		return inMemGetAccompanistDivisionPolicy(this.state, organizationId);
	}
	async updateAccompanistDivisionPolicy(
		input: Parameters<TenantRepository["updateAccompanistDivisionPolicy"]>[0],
	) {
		return inMemUpdateAccompanistDivisionPolicy(this.state, input);
	}
	async listAccompanistDivisionPolicyHistory(organizationId: string) {
		return inMemListAccompanistDivisionPolicyHistory(
			this.state,
			organizationId,
		);
	}
	async getRegistrationAgeConfiguration(organizationId: string) {
		return this.state.registrationAgeConfigurations.get(organizationId) ?? null;
	}
	async updateRegistrationAgeConfiguration(
		input: Parameters<
			TenantRepository["updateRegistrationAgeConfiguration"]
		>[0],
	) {
		return inMemUpdateRegistrationAgeConfiguration(this.state, input);
	}
	async createMembership(
		input: Parameters<AppUserMembershipRepository["createMembership"]>[0],
	) {
		return inMemCreateMembership(this.state, input);
	}
	async dismissWelcome(userId: string, organizationId: string) {
		return inMemDismissWelcome(this.state, userId, organizationId);
	}
	async createInvite(
		input: Parameters<AppUserMembershipRepository["createInvite"]>[0],
	) {
		return inMemCreateInvite(this.state, input);
	}
	async findInviteByToken(token: string) {
		return inMemFindInviteByToken(this.state, token);
	}
	async markInviteAccepted(token: string) {
		inMemMarkInviteAccepted(this.state, token);
	}
	async listAdminUsers(organizationId: string, currentUserId: string) {
		return inMemListAdminUsers(this.state, organizationId, currentUserId);
	}
	async deleteMembership(
		input: Parameters<AppUserMembershipRepository["deleteMembership"]>[0],
	) {
		inMemDeleteMembership(this.state, input);
	}
	async cancelInvite(
		input: Parameters<AppUserMembershipRepository["cancelInvite"]>[0],
	) {
		inMemCancelInvite(this.state, input);
	}
}

/** In-memory adapter base implementing division and festival contracts. */
class InMemoryDivisionFestivalAdapter
	extends InMemoryTenantAdapterBase
	implements DivisionFestivalRepository
{
	async listDivisions(organizationId: string, activeOnly = false) {
		return orderedDivisions(this.state, organizationId, activeOnly);
	}
	async createDivision(
		input: Parameters<DivisionFestivalRepository["createDivision"]>[0],
	) {
		return inMemCreateDivision(this.state, input);
	}
	async updateDivision(
		input: Parameters<DivisionFestivalRepository["updateDivision"]>[0],
	) {
		return inMemUpdateDivision(this.state, input);
	}
	async reorderDivisions(organizationId: string, divisionIds: string[]) {
		return inMemReorderDivisions(this.state, organizationId, divisionIds);
	}
	async listFestivals(organizationId: string) {
		return [...this.state.festivals.values()].filter(
			(f) => f.organizationId === organizationId,
		);
	}
	async createFestival(
		input: Parameters<DivisionFestivalRepository["createFestival"]>[0],
	) {
		return inMemCreateFestival(this.state, input);
	}
	async findFestivalByName(organizationId: string, name: string) {
		return (
			[...this.state.festivals.values()].find(
				(f) =>
					f.organizationId === organizationId &&
					f.name.toLowerCase() === name.toLowerCase(),
			) ?? null
		);
	}
	async findFestivalByShortName(organizationId: string, shortName: string) {
		return (
			[...this.state.festivals.values()].find(
				(f) => f.organizationId === organizationId && f.shortName === shortName,
			) ?? null
		);
	}
	async setPrimaryFestival(organizationId: string, festivalId: string) {
		return inMemSetPrimaryFestival(this.state, organizationId, festivalId);
	}
	async updateFestivalRegistrationWindow(
		organizationId: string,
		festivalId: string,
		input: Parameters<
			DivisionFestivalRepository["updateFestivalRegistrationWindow"]
		>[2],
	) {
		return inMemUpdateFestivalRegistrationWindow(
			this.state,
			organizationId,
			festivalId,
			input,
		);
	}
}

/** In-memory adapter base implementing S09 tenant-org and catalog-repertoire contracts. */
export class InMemoryTenantCatalogAdapter
	extends InMemoryDivisionFestivalAdapter
	implements RegistrationCatalogRepository
{
	async listRegistrationCatalogValues(
		organizationId: string,
		kind: Parameters<
			RegistrationCatalogRepository["listRegistrationCatalogValues"]
		>[1],
		activeOnly = false,
	) {
		return inMemListRegistrationCatalogValues(
			this.state,
			organizationId,
			kind,
			activeOnly,
		);
	}
	async listFestivalClassSubtypes(
		organizationId: string,
		festivalId: string,
		activeOnly = false,
	) {
		return inMemListRegistrationCatalogValues(
			this.state,
			organizationId,
			"class_subtype",
			activeOnly,
		).filter((v) =>
			this.state.festivalClassSubtypeIds.has(`${festivalId}:${v.id}`),
		);
	}
	async associateFestivalClassSubtype(
		input: Parameters<
			RegistrationCatalogRepository["associateFestivalClassSubtype"]
		>[0],
	) {
		inMemAssociateFestivalClassSubtype(this.state, input);
	}
	async createRegistrationCatalogValue(
		input: Parameters<
			RegistrationCatalogRepository["createRegistrationCatalogValue"]
		>[0],
	) {
		return inMemCreateRegistrationCatalogValue(this.state, input);
	}
	async updateRegistrationCatalogValue(
		input: Parameters<
			RegistrationCatalogRepository["updateRegistrationCatalogValue"]
		>[0],
	) {
		return inMemUpdateRegistrationCatalogValue(this.state, input);
	}
	async reorderRegistrationCatalogValues(
		organizationId: string,
		kind: Parameters<
			RegistrationCatalogRepository["reorderRegistrationCatalogValues"]
		>[1],
		ids: string[],
	) {
		return inMemReorderRegistrationCatalogValues(
			this.state,
			organizationId,
			kind,
			ids,
		);
	}
	async createFestivalClassConfigurationWithCapacityAudit(
		input: Parameters<
			RegistrationCatalogRepository["createFestivalClassConfigurationWithCapacityAudit"]
		>[0],
		actorUid?: string,
	) {
		return inMemCreateClassWithAudit(this.state, input, actorUid, (audit) =>
			this.recordFestivalClassCapacityAudit(audit),
		);
	}
	async updateFestivalClassConfigurationWithCapacityAudit(
		input: Parameters<
			RegistrationCatalogRepository["updateFestivalClassConfigurationWithCapacityAudit"]
		>[0],
		actorUid?: string,
		countPlaced?: () => Promise<number>,
	) {
		return inMemUpdateClassWithAudit(
			this.state,
			input,
			actorUid,
			countPlaced,
			(audit) => this.recordFestivalClassCapacityAudit(audit),
		);
	}
	async createFestivalClassConfiguration(
		input: Parameters<
			RegistrationCatalogRepository["createFestivalClassConfiguration"]
		>[0],
	) {
		return withInMemoryCapacityLock(() =>
			createClassConfigurationUnlocked(this.state, input),
		);
	}
	async updateFestivalClassConfiguration(
		input: Parameters<
			RegistrationCatalogRepository["updateFestivalClassConfiguration"]
		>[0],
	) {
		return withInMemoryCapacityLock(() =>
			updateClassConfigurationUnlocked(this.state, input),
		);
	}
	async findFestivalClassConfigurationsByIds(
		organizationId: string,
		festivalId: string,
		classIds: string[],
	) {
		return [...new Set(classIds)]
			.map((id) => this.state.festivalClassConfigurations.get(id))
			.filter(
				(r): r is NonNullable<typeof r> =>
					r?.organizationId === organizationId && r.festivalId === festivalId,
			)
			.map((r) => ({ ...r }));
	}
	findFestivalClassConfigurationById(
		organizationId: string,
		festivalId: string,
		classId: string,
	): Promise<
		Awaited<
			ReturnType<
				RegistrationCatalogRepository["findFestivalClassConfigurationById"]
			>
		>
	>;
	findFestivalClassConfigurationById(
		organizationId: string,
		classId: string,
	): Promise<
		Awaited<
			ReturnType<
				RegistrationCatalogRepository["findFestivalClassConfigurationById"]
			>
		>
	>;
	async findFestivalClassConfigurationById(
		organizationId: string,
		festivalIdOrClassId: string,
		classId?: string,
	) {
		const targetId = classId ?? festivalIdOrClassId;
		const record = this.state.festivalClassConfigurations.get(targetId);
		if (!record || record.organizationId !== organizationId) return null;
		if (classId !== undefined && record.festivalId !== festivalIdOrClassId) {
			return null;
		}
		return { ...record };
	}
	async findActiveFestivalClassByShortName(
		organizationId: string,
		festivalShortName: string,
		classId: string,
		festivalId?: string,
	) {
		const record = this.state.festivalClassConfigurations.get(classId);
		const festival = record && this.state.festivals.get(record.festivalId);
		if (
			!record ||
			!festival ||
			record.organizationId !== organizationId ||
			festival.organizationId !== organizationId ||
			!record.isActive ||
			festival.shortName.trim().toLowerCase() !==
				festivalShortName.trim().toLowerCase() ||
			(festivalId?.trim() && festival.id !== festivalId.trim())
		) {
			return null;
		}
		return { ...record };
	}
	async listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly = false,
	) {
		return [...this.state.festivalClassConfigurations.values()]
			.filter(
				(r) =>
					r.organizationId === organizationId &&
					r.festivalId === festivalId &&
					(!activeOnly || r.isActive),
			)
			.map((r) => ({ ...r }));
	}
	async recordFestivalClassCapacityAudit(
		input: Parameters<
			RegistrationCatalogRepository["recordFestivalClassCapacityAudit"]
		>[0],
	) {
		return inMemRecordCapacityAudit(this.state, input);
	}
	async listFestivalClassCapacityAudits(
		organizationId: string,
		festivalClassId: string,
	) {
		return this.state.festivalClassCapacityAudits
			.filter(
				(r) =>
					r.organizationId === organizationId &&
					r.festivalClassId === festivalClassId,
			)
			.slice()
			.reverse()
			.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
			.map((r) => ({ ...r }));
	}
}
