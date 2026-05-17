import {
	type AcceptInviteInput,
	type AcceptInviteResponse,
	type AuthenticatedUser,
	type CreateInviteInput,
	type CreateInviteResponse,
	type CreateOrganizationInput,
	type CreateOrganizationResponse,
	type DismissWelcomeResponse,
	deriveDisplayName,
	type InviteSummary,
	isOrganizationRole,
	type OrganizationLandingResponse,
	type OrganizationMembershipListResponse,
	type OrganizationMembershipRecord,
	type OrganizationRecord,
	type OrganizationSession,
	type SessionMembership,
	type SessionResponse,
	validateOrganizationName,
} from "@festival/common";
import type { TenantContext } from "../auth/tenant-context.js";
import { AppError } from "../errors/app-error.js";
import type {
	MembershipWithOrganization,
	OrganizationRepository,
} from "../repo/organization-repository.js";

function toSessionMembership(
	record: MembershipWithOrganization,
): SessionMembership {
	return {
		organizationId: record.organization.id,
		organizationName: record.organization.name,
		organizationSlug: record.organization.slug,
		role: record.membership.role,
		showWelcome:
			record.membership.origin === "invite" &&
			!record.membership.welcomeDismissedAtIso,
	};
}

function toInviteSummary(input: {
	token: string;
	organization: OrganizationRecord;
	email: string;
	role: OrganizationMembershipRecord["role"];
	acceptedAtIso?: string;
}): InviteSummary {
	return {
		token: input.token,
		organizationName: input.organization.name,
		organizationSlug: input.organization.slug,
		email: input.email,
		role: input.role,
		status: input.acceptedAtIso ? "accepted" : "pending",
		acceptedAtIso: input.acceptedAtIso,
	};
}

export class OrganizationService {
	constructor(readonly repository: OrganizationRepository) {}

	async getSession(identity?: AuthenticatedUser): Promise<SessionResponse> {
		if (!identity) {
			return {
				session: {
					authenticated: false,
				},
			};
		}

		const user = await this.repository.upsertUser({
			...identity,
			email: identity.email.toLowerCase(),
			displayName: deriveDisplayName(identity),
		});
		const memberships = await this.repository.listMembershipsByUserId(user.id);

		const session: OrganizationSession = {
			authenticated: true,
			user: {
				uid: user.firebaseUid,
				email: user.email,
				displayName: user.displayName,
			},
		};

		if (memberships[0]) {
			session.membership = toSessionMembership(memberships[0]);
		}

		return { session };
	}

	async listMemberships(
		identity: AuthenticatedUser,
	): Promise<OrganizationMembershipListResponse> {
		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});

		return {
			memberships: (await this.repository.listMembershipsByUserId(user.id)).map(
				toSessionMembership,
			),
		};
	}

	async createOrganization(
		identity: AuthenticatedUser,
		input: CreateOrganizationInput,
	): Promise<CreateOrganizationResponse> {
		const validation = validateOrganizationName(input.name);
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}

		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});

		const existingOrganization = await this.repository.findOrganizationBySlug(
			validation.normalized,
		);
		if (existingOrganization) {
			throw new AppError("Organization name is already registered.", 409);
		}

		const organization = await this.repository.createOrganization({
			name: validation.normalized,
			slug: validation.normalized,
		});
		const membership = await this.repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role: "Admin",
			origin: "creator",
		});

		return {
			organization,
			membership: toSessionMembership({ membership, organization }),
		};
	}

	async createInvite(
		identity: AuthenticatedUser,
		input: CreateInviteInput,
	): Promise<CreateInviteResponse> {
		if (!isOrganizationRole(input.role)) {
			throw new AppError(`Unsupported role: ${input.role}`, 400);
		}

		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});
		const membership = await this.repository.findMembershipByUserAndSlug(
			user.id,
			input.organizationSlug,
		);

		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}

		if (membership.membership.role !== "Admin") {
			throw new AppError("Only Admin members can invite users.", 403);
		}

		const invite = await this.repository.createInvite({
			organizationId: membership.organization.id,
			email: input.email.toLowerCase(),
			role: input.role,
			invitedByUserId: user.id,
		});

		return {
			invite: toInviteSummary({
				token: invite.token,
				organization: membership.organization,
				email: invite.email,
				role: invite.role,
				acceptedAtIso: invite.acceptedAtIso,
			}),
		};
	}

	async createInviteForTenant(
		tenant: TenantContext,
		input: CreateInviteInput,
	): Promise<CreateInviteResponse> {
		if (!isOrganizationRole(input.role)) {
			throw new AppError(`Unsupported role: ${input.role}`, 400);
		}

		if (input.organizationSlug !== tenant.organization.slug) {
			throw new AppError("Organization access denied.", 403);
		}

		const invite = await this.repository.createInvite({
			organizationId: tenant.organization.id,
			email: input.email.toLowerCase(),
			role: input.role,
			invitedByUserId: tenant.user.id,
		});

		return {
			invite: toInviteSummary({
				token: invite.token,
				organization: tenant.organization,
				email: invite.email,
				role: invite.role,
				acceptedAtIso: invite.acceptedAtIso,
			}),
		};
	}

	async getInvite(token: string): Promise<{ invite: InviteSummary }> {
		const invite = await this.repository.findInviteByToken(token);
		if (!invite) {
			throw new AppError("Invite not found.", 404);
		}

		return {
			invite: toInviteSummary({
				token: invite.invite.token,
				organization: invite.organization,
				email: invite.invite.email,
				role: invite.invite.role,
				acceptedAtIso: invite.invite.acceptedAtIso,
			}),
		};
	}

	async acceptInvite(
		identity: AuthenticatedUser,
		token: string,
		input: AcceptInviteInput,
	): Promise<AcceptInviteResponse> {
		const invite = await this.repository.findInviteByToken(token);
		if (!invite) {
			throw new AppError("Invite not found.", 404);
		}

		if (invite.invite.email.toLowerCase() !== identity.email.toLowerCase()) {
			throw new AppError(
				"Invite email does not match the authenticated user.",
				403,
			);
		}

		const user = await this.repository.upsertUser({
			uid: identity.uid,
			email: identity.email.toLowerCase(),
			displayName: deriveDisplayName({
				email: identity.email,
				displayName: identity.displayName,
				name: input.name,
			}),
		});

		const existingMembership =
			await this.repository.findMembershipByUserAndSlug(
				user.id,
				invite.organization.slug,
			);

		if (invite.invite.acceptedAtIso) {
			throw new AppError("Invite has already been accepted.", 409);
		}

		let membership = existingMembership?.membership;
		if (!membership) {
			membership = await this.repository.createMembership({
				organizationId: invite.organization.id,
				userId: user.id,
				role: invite.invite.role,
				origin: "invite",
			});
		}

		await this.repository.markInviteAccepted(token);

		return {
			organization: invite.organization,
			membership: toSessionMembership({
				membership,
				organization: invite.organization,
			}),
		};
	}

	async getOrganizationLanding(
		identity: AuthenticatedUser,
		slug: string,
	): Promise<OrganizationLandingResponse> {
		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});
		const membership = await this.repository.findMembershipByUserAndSlug(
			user.id,
			slug,
		);

		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}

		return {
			organization: membership.organization,
			membership: toSessionMembership(membership),
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
		};
	}

	async dismissWelcome(
		identity: AuthenticatedUser,
		slug: string,
	): Promise<DismissWelcomeResponse> {
		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});
		const membership = await this.repository.findMembershipByUserAndSlug(
			user.id,
			slug,
		);

		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}

		if (membership.membership.origin !== "invite") {
			return {
				membership: toSessionMembership(membership),
			};
		}

		const updatedMembership = await this.repository.dismissWelcome(
			user.id,
			membership.organization.id,
		);

		return {
			membership: toSessionMembership({
				membership: updatedMembership,
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

		const updatedMembership = await this.repository.dismissWelcome(
			tenant.user.id,
			tenant.organization.id,
		);

		return {
			membership: toSessionMembership({
				membership: updatedMembership,
				organization: tenant.organization,
			}),
		};
	}
}
