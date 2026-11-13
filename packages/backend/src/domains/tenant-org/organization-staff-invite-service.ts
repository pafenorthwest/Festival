import {
	type AcceptInviteInput,
	type AcceptInviteResponse,
	AppError,
	type AuthenticatedUser,
	type CreateInviteInput,
	type CreateInviteResponse,
	deriveDisplayName,
	type InviteSummary,
	isOrganizationRole,
	type OrganizationAdminUsersResponse,
} from "@festival/common";
import type { TenantContext } from "../../infra/s09-infra.js";
import type { AppUserMembershipRepository } from "./app-user-membership-repository.js";
import { toSessionMembership } from "./tenant-mappers.js";

function toInviteSummary(
	invite: {
		token: string;
		email: string;
		role: InviteSummary["role"];
		acceptedAtIso?: string;
	},
	organization: { name: string; slug: string },
): InviteSummary {
	return {
		token: invite.token,
		organizationName: organization.name,
		organizationSlug: organization.slug,
		email: invite.email,
		role: invite.role,
		status: invite.acceptedAtIso ? "accepted" : "pending",
		acceptedAtIso: invite.acceptedAtIso,
	};
}

/** Handles staff invitations and membership administration for an organization. */
export class OrganizationStaffInviteService {
	constructor(private readonly memberships: AppUserMembershipRepository) {}

	async createInvite(
		identity: AuthenticatedUser,
		input: CreateInviteInput,
	): Promise<CreateInviteResponse> {
		if (!isOrganizationRole(input.role)) {
			throw new AppError(`Unsupported role: ${input.role}`, 400);
		}
		const user = await this.memberships.upsertUser({
			...identity,
			displayName: deriveDisplayName(identity),
			email: identity.email.toLowerCase(),
		});
		const membership = await this.memberships.findMembershipByUserAndSlug(
			user.id,
			input.organizationSlug,
		);
		if (!membership) {
			throw new AppError("Organization membership not found.", 404);
		}
		if (membership.membership.role !== "Admin") {
			throw new AppError("Only Admin members can invite users.", 403);
		}

		await this.assertUniqueAdminUserEmail(
			membership.organization.id,
			input.email,
		);
		const invite = await this.memberships.createInvite({
			organizationId: membership.organization.id,
			email: input.email.trim().toLowerCase(),
			role: input.role,
			invitedByUserId: user.id,
		});
		return { invite: toInviteSummary(invite, membership.organization) };
	}

	async createInviteForTenant(
		tenant: TenantContext,
		input: Omit<CreateInviteInput, "organizationSlug">,
	): Promise<CreateInviteResponse> {
		if (!isOrganizationRole(input.role)) {
			throw new AppError(`Unsupported role: ${input.role}`, 400);
		}
		if (tenant.membership.role !== "Admin") {
			throw new AppError("Organization access denied.", 403);
		}
		await this.assertUniqueAdminUserEmail(tenant.organization.id, input.email);
		const invite = await this.memberships.createInvite({
			organizationId: tenant.organization.id,
			email: input.email.trim().toLowerCase(),
			role: input.role,
			invitedByUserId: tenant.user.id,
		});
		return { invite: toInviteSummary(invite, tenant.organization) };
	}

	async listAdminUsersForTenant(
		tenant: TenantContext,
	): Promise<OrganizationAdminUsersResponse> {
		const users = await this.memberships.listAdminUsers(
			tenant.organization.id,
			tenant.user.id,
		);
		return { users };
	}

	async deleteMembershipForTenant(tenant: TenantContext, membershipId: string) {
		try {
			await this.memberships.deleteMembership({
				organizationId: tenant.organization.id,
				membershipId,
				currentUserId: tenant.user.id,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			if (message === "Membership not found.") {
				throw new AppError("Membership not found.", 404);
			}
			if (message === "Admins cannot delete their own membership.") {
				throw new AppError("Admins cannot delete their own membership.", 400);
			}
			throw error;
		}
		return { status: "deleted" as const };
	}

	async cancelInviteForTenant(tenant: TenantContext, inviteId: string) {
		try {
			await this.memberships.cancelInvite({
				organizationId: tenant.organization.id,
				inviteId,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			if (message === "Invite not found.") {
				throw new AppError("Invite not found.", 404);
			}
			throw error;
		}
		return { status: "deleted" as const };
	}

	async getInvite(token: string): Promise<{ invite: InviteSummary }> {
		const record = await this.memberships.findInviteByToken(token);
		if (!record) throw new AppError("Invite not found.", 404);
		return { invite: toInviteSummary(record.invite, record.organization) };
	}

	async acceptInvite(
		identity: AuthenticatedUser,
		token: string,
		input: AcceptInviteInput,
	): Promise<AcceptInviteResponse> {
		const record = await this.memberships.findInviteByToken(token);
		if (!record) throw new AppError("Invite not found.", 404);
		const normalizedEmail = identity.email.toLowerCase();
		if (record.invite.email.toLowerCase() !== normalizedEmail) {
			throw new AppError(
				"Invite email does not match the authenticated user.",
				403,
			);
		}
		if (record.invite.acceptedAtIso) {
			throw new AppError("Invite has already been accepted.", 409);
		}

		const user = await this.memberships.upsertUser({
			...identity,
			displayName: deriveDisplayName({
				email: normalizedEmail,
				displayName: identity.displayName,
				name: input.name,
			}),
			email: normalizedEmail,
		});
		const existingMembership =
			await this.memberships.findMembershipByUserAndSlug(
				user.id,
				record.organization.slug,
			);
		const membership =
			existingMembership?.membership ??
			(await this.memberships.createMembership({
				organizationId: record.organization.id,
				userId: user.id,
				role: record.invite.role,
				origin: "invite",
			}));
		await this.memberships.markInviteAccepted(token);

		return {
			organization: record.organization,
			membership: toSessionMembership({
				membership,
				organization: record.organization,
			}),
		};
	}

	private async assertUniqueAdminUserEmail(
		organizationId: string,
		email: string,
	): Promise<void> {
		const users = await this.memberships.listAdminUsers(organizationId, "");
		const exists = users.some(
			(user) => user.email.toLowerCase() === email.toLowerCase(),
		);
		if (exists) {
			throw new AppError("That email has already been added.", 409);
		}
	}
}
