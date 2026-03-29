import { randomUUID } from "node:crypto";
import type {
	AuthenticatedUser,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
} from "@festival/common";
import type {
	CreateInviteRecordInput,
	CreateMembershipInput,
	InviteWithOrganization,
	MembershipWithOrganization,
	OrganizationRepository,
} from "./organization-repository.js";

export class InMemoryOrganizationRepository implements OrganizationRepository {
	private readonly users = new Map<string, OrganizationUserRecord>();
	private readonly usersByUid = new Map<string, string>();
	private readonly organizations = new Map<string, OrganizationRecord>();
	private readonly organizationsBySlug = new Map<string, string>();
	private readonly memberships = new Map<string, OrganizationMembershipRecord>();
	private readonly membershipsByUserId = new Map<string, string>();
	private readonly invites = new Map<string, OrganizationInviteRecord>();
	private readonly invitesByToken = new Map<string, string>();

	async ensureReady(): Promise<void> {}

	async upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord> {
		const existingId = this.usersByUid.get(user.uid);
		if (existingId) {
			const existing = this.users.get(existingId);
			if (!existing) {
				throw new Error(`In-memory user not found for id ${existingId}`);
			}

			const updated: OrganizationUserRecord = {
				...existing,
				email: user.email.toLowerCase(),
				displayName: user.displayName,
			};
			this.users.set(existingId, updated);
			return updated;
		}

		const created: OrganizationUserRecord = {
			id: randomUUID(),
			firebaseUid: user.uid,
			email: user.email.toLowerCase(),
			displayName: user.displayName,
			createdAtIso: new Date().toISOString(),
		};

		this.users.set(created.id, created);
		this.usersByUid.set(created.firebaseUid, created.id);
		return created;
	}

	async findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null> {
		const membershipId = this.membershipsByUserId.get(userId);
		if (!membershipId) {
			return null;
		}

		const membership = this.memberships.get(membershipId);
		if (!membership) {
			return null;
		}

		const organization = this.organizations.get(membership.organizationId);
		if (!organization) {
			return null;
		}

		return { membership, organization };
	}

	async findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null> {
		const membershipWithOrganization = await this.findMembershipByUserId(userId);
		if (
			!membershipWithOrganization ||
			membershipWithOrganization.organization.slug !== slug
		) {
			return null;
		}

		return membershipWithOrganization;
	}

	async findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
		const organizationId = this.organizationsBySlug.get(slug);
		if (!organizationId) {
			return null;
		}

		return this.organizations.get(organizationId) ?? null;
	}

	async createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord> {
		const organization: OrganizationRecord = {
			id: randomUUID(),
			name: input.name,
			slug: input.slug,
			createdAtIso: new Date().toISOString(),
		};

		this.organizations.set(organization.id, organization);
		this.organizationsBySlug.set(organization.slug, organization.id);
		return organization;
	}

	async createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord> {
		const membership: OrganizationMembershipRecord = {
			id: randomUUID(),
			organizationId: input.organizationId,
			userId: input.userId,
			role: input.role,
			origin: input.origin,
			joinedAtIso: new Date().toISOString(),
		};

		this.memberships.set(membership.id, membership);
		this.membershipsByUserId.set(membership.userId, membership.id);
		return membership;
	}

	async createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord> {
		const invite: OrganizationInviteRecord = {
			id: randomUUID(),
			token: randomUUID(),
			organizationId: input.organizationId,
			email: input.email.toLowerCase(),
			role: input.role,
			invitedByUserId: input.invitedByUserId,
			createdAtIso: new Date().toISOString(),
		};

		this.invites.set(invite.id, invite);
		this.invitesByToken.set(invite.token, invite.id);
		return invite;
	}

	async findInviteByToken(token: string): Promise<InviteWithOrganization | null> {
		const inviteId = this.invitesByToken.get(token);
		if (!inviteId) {
			return null;
		}

		const invite = this.invites.get(inviteId);
		if (!invite) {
			return null;
		}

		const organization = this.organizations.get(invite.organizationId);
		if (!organization) {
			return null;
		}

		return { invite, organization };
	}

	async markInviteAccepted(token: string): Promise<void> {
		const inviteId = this.invitesByToken.get(token);
		if (!inviteId) {
			return;
		}

		const invite = this.invites.get(inviteId);
		if (!invite) {
			return;
		}

		this.invites.set(inviteId, {
			...invite,
			acceptedAtIso: new Date().toISOString(),
		});
	}

	async dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord> {
		const membershipId = this.membershipsByUserId.get(userId);
		if (!membershipId) {
			throw new Error(`Membership not found for user ${userId}`);
		}

		const membership = this.memberships.get(membershipId);
		if (!membership || membership.organizationId !== organizationId) {
			throw new Error(`Membership not found for organization ${organizationId}`);
		}

		const updated: OrganizationMembershipRecord = {
			...membership,
			welcomeDismissedAtIso: new Date().toISOString(),
		};

		this.memberships.set(membership.id, updated);
		return updated;
	}
}
