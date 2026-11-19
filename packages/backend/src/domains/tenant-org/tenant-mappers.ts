import type {
	AccompanistDivisionSelectionPolicy,
	AppUserRecord,
	OrganizationAdminUserEntry,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
	SessionMembership,
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

export interface OrganizationRow {
	id: string;
	name: string;
	slug: string;
	timezone?: string | null;
	default_currency_code?: string | null;
	created_at: Date | string;
}

export interface UserRow {
	id: string;
	firebase_uid: string;
	email: string;
	display_name: string;
	disassociated: boolean;
	created_at: Date | string;
}

export interface MembershipRow {
	id: string;
	organization_id: string;
	user_id: string;
	role: OrganizationMembershipRecord["role"];
	origin: OrganizationMembershipRecord["origin"];
	joined_at: Date | string;
	welcome_dismissed_at: Date | string | null;
}

export interface MembershipJoinRow extends MembershipRow {
	organization_name: string;
	organization_slug: string;
	organization_created_at: Date | string;
	organization_timezone?: string | null;
	organization_default_currency_code?: string | null;
}

export interface InviteJoinRow {
	id: string;
	token: string;
	organization_id: string;
	email: string;
	role: OrganizationInviteRecord["role"];
	invited_by_user_id: string;
	created_at: Date | string;
	accepted_at: Date | string | null;
	organization_name: string;
	organization_slug: string;
	organization_created_at: Date | string;
	organization_timezone?: string | null;
	organization_default_currency_code?: string | null;
}

export interface AppUserRow {
	id: string;
	firebase_uid: string;
	email: string;
	full_name: string | null;
	is_active: boolean;
	created_at: Date | string;
	updated_at: Date | string;
}

export interface AdminUserRow {
	id: string;
	email: string;
	role: OrganizationAdminUserEntry["role"];
	status: OrganizationAdminUserEntry["status"];
	user_id: string | null;
}

export function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

export function toOptionalIso(
	value: Date | string | null | undefined,
): string | undefined {
	if (value === null || value === undefined) return undefined;
	return toIso(value);
}

export function toDateOnly(value: Date | string): string {
	return value instanceof Date
		? value.toISOString().slice(0, 10)
		: String(value).slice(0, 10);
}

export function mapOrganization(row: OrganizationRow): OrganizationRecord {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		timezone: row.timezone ?? "UTC",
		defaultCurrencyCode: row.default_currency_code ?? "USD",
		createdAtIso: toIso(row.created_at),
	};
}

export function mapOrganizationUser(row: UserRow): OrganizationUserRecord {
	return {
		id: row.id,
		firebaseUid: row.firebase_uid,
		email: row.email,
		displayName: row.display_name,
		disassociated: row.disassociated,
		createdAtIso: toIso(row.created_at),
	};
}

export function mapMembership(
	row: MembershipRow,
): OrganizationMembershipRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		userId: row.user_id,
		role: row.role,
		origin: row.origin,
		joinedAtIso: toIso(row.joined_at),
		welcomeDismissedAtIso: toOptionalIso(row.welcome_dismissed_at),
	};
}

export function mapMembershipWithOrganization(
	row: MembershipJoinRow,
): MembershipWithOrganization {
	return {
		membership: mapMembership(row),
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			timezone: row.organization_timezone ?? "UTC",
			defaultCurrencyCode: row.organization_default_currency_code ?? "USD",
			createdAtIso: toIso(row.organization_created_at),
		},
	};
}

export function mapInviteWithOrganization(
	row: InviteJoinRow,
): InviteWithOrganization {
	return {
		invite: {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso: toIso(row.created_at),
			acceptedAtIso: toOptionalIso(row.accepted_at),
		},
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			timezone: row.organization_timezone ?? "UTC",
			defaultCurrencyCode: row.organization_default_currency_code ?? "USD",
			createdAtIso: toIso(row.organization_created_at),
		},
	};
}

export function mapAppUser(row: AppUserRow): AppUserRecord {
	return {
		id: row.id,
		firebaseUid: row.firebase_uid,
		email: row.email,
		fullName: row.full_name ?? undefined,
		isActive: row.is_active,
		createdAtIso: toIso(row.created_at),
		updatedAtIso: toIso(row.updated_at),
	};
}

export function toSessionMembership(
	record: MembershipWithOrganization,
): SessionMembership {
	const { membership, organization } = record;
	return {
		organizationId: organization.id,
		organizationName: organization.name,
		organizationSlug: organization.slug,
		role: membership.role,
		showWelcome:
			membership.origin === "invite" && !membership.welcomeDismissedAtIso,
	};
}
