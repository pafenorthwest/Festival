import type {
	AuthenticatedUser,
	FestivalRecord,
	OrganizationAdminUserEntry,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
	ShopifyVerificationStatus,
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

export interface CreateFestivalRecordInput {
	id: string;
	organizationId: string;
	code: string;
	name: string;
	startDate: string;
	endDate: string;
}

export interface ShopifyIntegrationRecord {
	organizationId: string;
	storeDomain: string;
	clientId: string;
	encryptedClientSecret: string;
	verificationStatus: ShopifyVerificationStatus;
	verifiedAtIso?: string;
	lastTestedAtIso?: string;
	lastError?: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface UpsertShopifyIntegrationInput {
	organizationId: string;
	storeDomain: string;
	clientId: string;
	encryptedClientSecret: string;
}

export interface UpdateShopifyVerificationInput {
	organizationId: string;
	verificationStatus: Exclude<ShopifyVerificationStatus, "unknown">;
	verifiedAtIso?: string;
	lastTestedAtIso: string;
	lastError?: string;
}

export interface OrganizationRepository {
	ensureReady(): Promise<void>;
	upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord>;
	findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null>;
	listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]>;
	findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null>;
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	findOrganizationByName(name: string): Promise<OrganizationRecord | null>;
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
	listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]>;
	deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void>;
	cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void>;
	listFestivals(organizationId: string): Promise<FestivalRecord[]>;
	createFestival(input: CreateFestivalRecordInput): Promise<FestivalRecord>;
	findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null>;
	dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord>;
	getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationRecord | null>;
	upsertShopifyIntegration(
		input: UpsertShopifyIntegrationInput,
	): Promise<ShopifyIntegrationRecord>;
	updateShopifyVerification(
		input: UpdateShopifyVerificationInput,
	): Promise<ShopifyIntegrationRecord>;
}
