import { randomUUID } from "node:crypto";
import {
	type AcceptInviteInput,
	type AcceptInviteResponse,
	type AuthenticatedUser,
	type CreateFestivalInput,
	type CreateFestivalResponse,
	type CreateInviteInput,
	type CreateInviteResponse,
	type CreateOrganizationInput,
	type CreateOrganizationResponse,
	type DismissWelcomeResponse,
	deriveDisplayName,
	type FestivalRecord,
	type FestivalSummary,
	type InviteSummary,
	isOrganizationRole,
	type OrganizationAdminUsersResponse,
	type OrganizationFestivalListResponse,
	type OrganizationLandingResponse,
	type OrganizationMembershipListResponse,
	type OrganizationMembershipRecord,
	type OrganizationRecord,
	type OrganizationSession,
	type SessionMembership,
	type SessionResponse,
	validateFestivalDates,
	validateFestivalName,
	validateOrganizationName,
	validateOrganizationShortName,
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

function toFestivalSummary(record: FestivalRecord): FestivalSummary {
	return {
		id: record.id,
		code: record.code,
		name: record.name,
		startDate: record.startDate,
		endDate: record.endDate,
		createdAtIso: record.createdAtIso,
	};
}

function deriveFestivalCode(id: string): string {
	return id.replaceAll("-", "").slice(0, 6);
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
		const nameValidation = validateOrganizationName(input.name);
		const shortNameValidation = validateOrganizationShortName(input.shortName);
		const errors = [...nameValidation.errors, ...shortNameValidation.errors];
		if (errors.length > 0) {
			throw new AppError(errors.join(" "), 400);
		}

		const user = await this.repository.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});

		const existingOrganization = await this.repository.findOrganizationBySlug(
			shortNameValidation.normalized,
		);
		if (existingOrganization) {
			throw new AppError("Organization short name is already registered.", 409);
		}

		const organization = await this.repository.createOrganization({
			name: nameValidation.normalized,
			slug: shortNameValidation.normalized,
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

		const normalizedEmail = input.email.trim().toLowerCase();
		await this.assertUniqueAdminUserEmail(
			tenant.organization.id,
			normalizedEmail,
		);

		const invite = await this.repository.createInvite({
			organizationId: tenant.organization.id,
			email: normalizedEmail,
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

	async listAdminUsersForTenant(
		tenant: TenantContext,
	): Promise<OrganizationAdminUsersResponse> {
		return {
			users: await this.repository.listAdminUsers(
				tenant.organization.id,
				tenant.user.id,
			),
		};
	}

	async deleteMembershipForTenant(
		tenant: TenantContext,
		membershipId: string,
	): Promise<{ status: "deleted" }> {
		const users = await this.repository.listAdminUsers(
			tenant.organization.id,
			tenant.user.id,
		);
		const user = users.find(
			(entry) => entry.status === "accepted" && entry.id === membershipId,
		);
		if (!user) {
			throw new AppError("Membership not found.", 404);
		}

		if (user.isSelf) {
			throw new AppError("Admins cannot delete their own membership.", 400);
		}

		await this.repository.deleteMembership({
			organizationId: tenant.organization.id,
			membershipId,
			currentUserId: tenant.user.id,
		});
		return { status: "deleted" };
	}

	async cancelInviteForTenant(
		tenant: TenantContext,
		inviteId: string,
	): Promise<{ status: "deleted" }> {
		const users = await this.repository.listAdminUsers(
			tenant.organization.id,
			tenant.user.id,
		);
		const user = users.find(
			(entry) => entry.status === "pending" && entry.id === inviteId,
		);
		if (!user) {
			throw new AppError("Invite not found.", 404);
		}

		await this.repository.cancelInvite({
			organizationId: tenant.organization.id,
			inviteId,
		});
		return { status: "deleted" };
	}

	async listFestivalsForTenant(
		tenant: TenantContext,
	): Promise<OrganizationFestivalListResponse> {
		return {
			festivals: (
				await this.repository.listFestivals(tenant.organization.id)
			).map(toFestivalSummary),
		};
	}

	async createFestivalForTenant(
		tenant: TenantContext,
		input: CreateFestivalInput,
	): Promise<CreateFestivalResponse> {
		const nameValidation = validateFestivalName(input.name);
		const dateValidation = validateFestivalDates(input);
		const errors = [...nameValidation.errors, ...dateValidation.errors];
		if (errors.length > 0) {
			throw new AppError(errors.join(" "), 400);
		}

		const existingFestival = await this.repository.findFestivalByName(
			tenant.organization.id,
			nameValidation.normalized,
		);
		if (existingFestival) {
			throw new AppError("Festival name is already registered.", 409);
		}

		const id = randomUUID();
		const festival = await this.repository.createFestival({
			id,
			organizationId: tenant.organization.id,
			code: deriveFestivalCode(id),
			name: nameValidation.normalized,
			startDate: dateValidation.startDate,
			endDate: dateValidation.endDate,
		});

		return {
			festival: toFestivalSummary(festival),
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

	private async assertUniqueAdminUserEmail(
		organizationId: string,
		email: string,
	): Promise<void> {
		const users = await this.repository.listAdminUsers(organizationId, "");
		const exists = users.some(
			(user) => user.email.toLowerCase() === email.toLowerCase(),
		);
		if (exists) {
			throw new AppError("That email has already been added.", 409);
		}
	}
}
