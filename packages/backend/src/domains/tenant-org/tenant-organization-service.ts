import {
	type AccompanistDivisionSelectionPolicy,
	AppError,
	type AuthenticatedUser,
	type CreateOrganizationInput,
	type CreateOrganizationResponse,
	type DismissWelcomeResponse,
	deriveDisplayName,
	isValidIanaTimezone,
	type OrganizationLandingResponse,
	type OrganizationMembershipListResponse,
	type OrganizationSession,
	type SessionResponse,
	type UpdateOrganizationTimezoneInput,
	validateOrganizationName,
	validateOrganizationShortName,
} from "@festival/common";
import {
	type DomainCacheInvalidator,
	emitDomainInvalidation,
	type S09InvalidationSink,
	type TenantContext,
} from "../../infra/s09-infra.js";
import type { AppUserMembershipRepository } from "./app-user-membership-repository.js";
import { toSessionMembership } from "./tenant-mappers.js";
import type { TenantRepository } from "./tenant-repository.js";

function normalizeUserIdentity(identity: AuthenticatedUser): AuthenticatedUser {
	return {
		...identity,
		displayName: deriveDisplayName(identity),
		email: identity.email.toLowerCase(),
	};
}

/** Handles tenant organizations, user sessions, timezones, and accompanist policies. */
export class TenantOrganizationService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(
		private readonly tenants: TenantRepository,
		private readonly memberships: AppUserMembershipRepository,
		private readonly options?: { enableDropTransfer?: boolean },
	) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	async getSession(identity?: AuthenticatedUser): Promise<SessionResponse> {
		if (!identity) {
			return { session: { authenticated: false } };
		}
		const user = await this.memberships.upsertUser(
			normalizeUserIdentity(identity),
		);
		const membership = await this.memberships.findMembershipByUserId(user.id);
		const session: OrganizationSession = {
			authenticated: true,
			user: {
				uid: user.firebaseUid,
				email: user.email,
				displayName: user.displayName,
			},
			membership: membership ? toSessionMembership(membership) : undefined,
		};
		return { session };
	}

	async listMemberships(
		identity: AuthenticatedUser,
	): Promise<OrganizationMembershipListResponse> {
		const user = await this.memberships.upsertUser(
			normalizeUserIdentity(identity),
		);
		const memberships = await this.memberships.listMembershipsByUserId(user.id);
		return { memberships: memberships.map(toSessionMembership) };
	}

	async createOrganization(
		identity: AuthenticatedUser,
		input: CreateOrganizationInput,
	): Promise<CreateOrganizationResponse> {
		const nameCheck = validateOrganizationName(input.name);
		const slugCheck = validateOrganizationShortName(input.shortName);
		const errors = [...nameCheck.errors, ...slugCheck.errors];
		if (errors.length > 0) throw new AppError(errors.join(" "), 400);

		const user = await this.memberships.upsertUser(
			normalizeUserIdentity(identity),
		);
		if (await this.tenants.findOrganizationBySlug(slugCheck.normalized)) {
			throw new AppError("Organization short name is already registered.", 409);
		}
		if (await this.tenants.findOrganizationByName(nameCheck.normalized)) {
			throw new AppError("Organization name is already registered.", 409);
		}

		const organization = await this.tenants.createOrganization({
			name: nameCheck.normalized,
			slug: slugCheck.normalized,
			defaultCurrencyCode: input.defaultCurrencyCode,
		});
		const membership = await this.memberships.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role: "Admin",
			origin: "creator",
		});

		emitDomainInvalidation(this.cacheInvalidator, {
			type: "OrgUpdated",
			organizationId: organization.id,
			slug: organization.slug,
		});
		return {
			organization,
			membership: toSessionMembership({ membership, organization }),
		};
	}

	async getTimezoneForTenant(tenant: TenantContext) {
		return {
			timezone: await this.tenants.getOrganizationTimezone(
				tenant.organization.id,
			),
		};
	}

	async updateTimezoneForTenant(
		tenant: TenantContext,
		input: UpdateOrganizationTimezoneInput,
	) {
		const trimmed = input.timezone?.trim() ?? "";
		if (!isValidIanaTimezone(trimmed)) {
			throw new AppError(
				"Organization timezone must be a valid IANA timezone.",
				400,
			);
		}
		const timezone = await this.tenants.updateOrganizationTimezone(
			tenant.organization.id,
			trimmed,
		);
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "OrgUpdated",
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
		});
		return { timezone };
	}

	async getAccompanistDivisionPolicy(organizationId: string) {
		return this.tenants.getAccompanistDivisionPolicy(organizationId);
	}

	async updateAccompanistDivisionPolicy(options: {
		organizationId: string;
		policy: AccompanistDivisionSelectionPolicy;
	}) {
		const updated = await this.tenants.updateAccompanistDivisionPolicy(options);
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "FestivalCatalogUpdated",
			organizationId: options.organizationId,
		});
		return updated;
	}

	async getOrganizationLanding(
		identity: AuthenticatedUser,
		slug: string,
	): Promise<OrganizationLandingResponse> {
		const user = await this.memberships.upsertUser(
			normalizeUserIdentity(identity),
		);
		const membership = await this.memberships.findMembershipByUserAndSlug(
			user.id,
			slug,
		);
		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}
		return {
			organization: membership.organization,
			membership: toSessionMembership(membership),
			features: { dropTransfer: Boolean(this.options?.enableDropTransfer) },
		};
	}

	getOrganizationLandingForTenant(
		tenant: TenantContext,
	): OrganizationLandingResponse {
		return {
			organization: tenant.organization,
			membership: toSessionMembership({
				membership: tenant.membership,
				organization: tenant.organization,
			}),
			features: { dropTransfer: Boolean(this.options?.enableDropTransfer) },
		};
	}

	async dismissWelcome(
		identity: AuthenticatedUser,
		slug: string,
	): Promise<DismissWelcomeResponse> {
		const user = await this.memberships.upsertUser(
			normalizeUserIdentity(identity),
		);
		const membership = await this.memberships.findMembershipByUserAndSlug(
			user.id,
			slug,
		);
		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}
		if (membership.membership.origin !== "invite") {
			return { membership: toSessionMembership(membership) };
		}
		const updated = await this.memberships.dismissWelcome(
			user.id,
			membership.organization.id,
		);
		return {
			membership: toSessionMembership({
				membership: updated,
				organization: membership.organization,
			}),
		};
	}

	async dismissWelcomeForTenant(
		tenant: TenantContext,
	): Promise<DismissWelcomeResponse> {
		if (tenant.membership.origin !== "invite") {
			return {
				membership: toSessionMembership({
					membership: tenant.membership,
					organization: tenant.organization,
				}),
			};
		}
		const updated = await this.memberships.dismissWelcome(
			tenant.user.id,
			tenant.organization.id,
		);
		return {
			membership: toSessionMembership({
				membership: updated,
				organization: tenant.organization,
			}),
		};
	}
}
