import type {
	AccompanistDivisionSelectionPolicy,
	AccompanistMembershipGrant,
	AccompanistProfileRecord,
	AdminCustomerProfileSummary,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
	OrganizationDivision,
	OrganizationRecord,
	ProfileApprovalStatus,
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
} from "@festival/common";
import type {
	CustomerOAuthSessionService,
	CustomerProfileService,
} from "../customer-identity/index.js";

export interface ProductRecord {
	id: string;
	organizationId: string;
	productCategory: "membership";
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	productNameSnapshot: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface CreateMembershipProductRecordInput {
	organizationId: string;
	entitlementClass: EntitlementClass;
	durationDays: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	productNameSnapshot: string;
}

export interface AccompanistDivisionPolicyRecord {
	organizationId: string;
	policy: AccompanistDivisionSelectionPolicy;
	updatedAtIso: string;
}

export interface AccompanistDivisionPolicyHistoryRecord
	extends AccompanistDivisionPolicyRecord {
	id: string;
	createdAtIso: string;
}

export interface CreateAccompanistMembershipGrantInput
	extends Omit<
		AccompanistMembershipGrant,
		"id" | "createdAtIso" | "status" | "isCurrent"
	> {
	supersedeGrantId?: string;
}

export interface EntitlementRevocationRecord {
	id: string;
	entitlementId: string;
	organizationId: string;
	actorUserId: string;
	reason: string;
	revokedAtIso: string;
}

export interface MembershipCustomerContact {
	customerId: string;
	name?: string;
	email?: string;
	phone?: string;
	city?: string;
}

export interface UpsertProfileInput {
	organizationId: string;
	customerId: string;
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
}

export type UpsertTeacherProfileInput = UpsertProfileInput;
export type UpsertAccompanistProfileInput = UpsertProfileInput;

export interface CustomerProfileSessionContext {
	orgSlug: string;
	sessionId: string | undefined;
	csrfToken?: string | undefined;
	requestOrigin?: string | undefined;
}

export interface StaffMembershipRosterEntry {
	membershipType: "Teacher" | "Accompanist";
	offeringName: string;
	source: string;
	status: "active";
	startsOn: string;
	endsOn: string;
	name?: string;
	email?: string;
	phone?: string;
	city?: string;
	divisions: Array<{ divisionId: string; divisionName: string }>;
}

export interface StaffMembershipRosterResult {
	roster: StaffMembershipRosterEntry[];
	accompanists: StaffMembershipRosterEntry[];
}

export interface TeacherDirectoryOrganizationPort {
	findOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	getOrganizationTimezone(organizationId: string): Promise<string>;
	listDivisions(
		organizationId: string,
		activeOnly?: boolean,
	): Promise<OrganizationDivision[]>;
	getPublicShopifyCatalogDomain?(
		organizationId: string,
	): Promise<string | null>;
	getShopifyIntegration?(organizationId: string): Promise<{
		encryptedStorefrontPrivateToken?: string;
	} | null>;
}

export interface TeacherDirectoryCommerceDecisionsPort {
	listCustomerDecisions(
		organizationId: string,
		customerId: string,
	): Promise<ReadonlyArray<{ status: string }>>;
}

export interface TeacherDirectoryCustomerAccessPort {
	customerReadAccess: CustomerOAuthSessionService["customerReadAccess"];
	formAccess: CustomerOAuthSessionService["formAccess"];
	findAdminCustomerProfile?: CustomerProfileService["findAdminCustomerProfile"];
}

export interface TeacherDirectoryRepository {
	ensureReady(): Promise<void>;
	listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string }>>;
	getTeacherProfile(
		organizationId: string,
		customerId: string,
	): Promise<TeacherProfileRecord | null>;
	getTeacherProfileById(
		organizationId: string,
		profileId: string,
	): Promise<TeacherProfileRecord | null>;
	upsertTeacherProfile(
		input: UpsertTeacherProfileInput,
	): Promise<TeacherProfileRecord>;
	updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<TeacherProfileRecord | null>;
	listTeacherProfiles(organizationId: string): Promise<TeacherProfileRecord[]>;
	getAccompanistProfile(
		organizationId: string,
		customerId: string,
	): Promise<AccompanistProfileRecord | null>;
	getAccompanistProfileById(
		organizationId: string,
		profileId: string,
	): Promise<AccompanistProfileRecord | null>;
	upsertAccompanistProfile(
		input: UpsertAccompanistProfileInput,
	): Promise<AccompanistProfileRecord>;
	updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		approvalStatus: ProfileApprovalStatus,
	): Promise<AccompanistProfileRecord | null>;
	listAccompanistProfiles(
		organizationId: string,
	): Promise<AccompanistProfileRecord[]>;
	getPublicDirectoryProfiles(
		organizationId: string,
	): Promise<PublicDirectoryProfileDto[]>;
}

export interface MembershipProductRepository {
	ensureReady(): Promise<void>;
	createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord>;
	updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductRecord | null>;
	listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]>;
	findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null>;
	findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null>;
	findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null>;
	getAccompanistDivisionPolicy(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyRecord>;
	updateAccompanistDivisionPolicy(input: {
		organizationId: string;
		policy: AccompanistDivisionSelectionPolicy;
	}): Promise<AccompanistDivisionPolicyRecord>;
	listAccompanistDivisionPolicyHistory(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyHistoryRecord[]>;
}

export interface MembershipEntitlementRepository {
	ensureReady(): Promise<void>;
	createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot>;
	findActiveTeacherEntitlementGrant(input: {
		organizationId: string;
		customerId: string;
		divisionId: string;
	}): Promise<EntitlementGrantSnapshot | null>;
	listEntitlementGrantSnapshots(
		organizationId: string,
		customerId?: string,
	): Promise<EntitlementGrantSnapshot[]>;
	findMembershipCustomerContacts(
		organizationId: string,
		customerIds: string[],
	): Promise<Map<string, MembershipCustomerContact>>;
	revokeEntitlement(input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	}): Promise<{ revocation: EntitlementRevocationRecord; existing: boolean }>;
	createAccompanistMembershipGrant(
		input: CreateAccompanistMembershipGrantInput,
	): Promise<AccompanistMembershipGrant>;
	findCurrentAccompanistMembershipGrant(input: {
		organizationId: string;
		customerId: string;
	}): Promise<AccompanistMembershipGrant | null>;
	listAccompanistMembershipGrants(input: {
		organizationId: string;
		customerId?: string;
		normalizedEmail?: string;
		currentOnly?: boolean;
	}): Promise<AccompanistMembershipGrant[]>;
}

export type TeacherDirectoryAdminProfileResolver = (
	organizationId: string,
	customerId: string,
	actorUid: string,
) => Promise<AdminCustomerProfileSummary | null>;
