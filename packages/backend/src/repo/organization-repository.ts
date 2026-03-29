import type {
	AuthenticatedUser,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
} from "@festival/common";

export interface MembershipWithOrganization {
	membership: OrganizationMembershipRecord;
	organization: OrganizationRecord;
}

export interface InviteWithOrganization {
	invite: OrganizationInviteRecord;
	organization: OrganizationRecord;
}

export interface CreateMembershipInput {
	organizationId: string;
	userId: string;
	role: OrganizationMembershipRecord["role"];
	origin: OrganizationMembershipRecord["origin"];
}

export interface CreateInviteRecordInput {
	organizationId: string;
	email: string;
	role: OrganizationInviteRecord["role"];
	invitedByUserId: string;
}

export interface OrganizationRepository {
	ensureReady(): Promise<void>;
	upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord>;
	findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null>;
	findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord>;
	createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord>;
	createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord>;
	findInviteByToken(token: string): Promise<InviteWithOrganization | null>;
	markInviteAccepted(token: string): Promise<void>;
	dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord>;
}
