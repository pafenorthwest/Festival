import { randomUUID } from "node:crypto";
import type {
	AccompanistDivisionSelectionPolicy,
	AuthenticatedUser,
	OrganizationAdminUserEntry,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
	RegistrationAgeConfiguration,
} from "@festival/common";
import type { InMemoryOrgState } from "./in-memory-org-state.js";
import type {
	AccompanistDivisionPolicyHistoryRecord,
	AccompanistDivisionPolicyRecord,
	CreateInviteRecordInput,
	CreateMembershipInput,
	InviteWithOrganization,
	MembershipWithOrganization,
} from "./organization-repository.js";

export function inMemUpsertUser(
	state: InMemoryOrgState,
	user: AuthenticatedUser,
): OrganizationUserRecord {
	const existingId = state.usersByUid.get(user.uid);
	if (existingId) {
		const existing = state.users.get(existingId);
		if (!existing) {
			throw new Error(`In-memory user not found for id ${existingId}`);
		}
		const updated: OrganizationUserRecord = {
			...existing,
			email: user.email.toLowerCase(),
			displayName: user.displayName,
			disassociated: false,
		};
		state.users.set(existingId, updated);
		return updated;
	}
	const created: OrganizationUserRecord = {
		id: randomUUID(),
		firebaseUid: user.uid,
		email: user.email.toLowerCase(),
		displayName: user.displayName,
		disassociated: false,
		createdAtIso: new Date().toISOString(),
	};
	state.users.set(created.id, created);
	state.usersByUid.set(created.firebaseUid, created.id);
	return created;
}

function membershipWithOrganization(
	state: InMemoryOrgState,
	membershipId: string,
): MembershipWithOrganization | null {
	const membership = state.memberships.get(membershipId);
	if (!membership) return null;
	const organization = state.organizations.get(membership.organizationId);
	return organization ? { membership, organization } : null;
}

export function inMemFindMembershipByUserId(
	state: InMemoryOrgState,
	userId: string,
): MembershipWithOrganization | null {
	const membershipIds = state.membershipsByUserId.get(userId);
	const membershipId = membershipIds?.values().next().value;
	return membershipId ? membershipWithOrganization(state, membershipId) : null;
}

export function inMemListMembershipsByUserId(
	state: InMemoryOrgState,
	userId: string,
): MembershipWithOrganization[] {
	const membershipIds = state.membershipsByUserId.get(userId);
	if (!membershipIds) return [];
	return [...membershipIds]
		.map((id) => membershipWithOrganization(state, id))
		.filter((m): m is MembershipWithOrganization => m !== null);
}

export function inMemFindMembershipByUserAndSlug(
	state: InMemoryOrgState,
	userId: string,
	slug: string,
): MembershipWithOrganization | null {
	const organizationId = state.organizationsBySlug.get(slug);
	if (!organizationId) return null;
	const membershipId = state.membershipsByUserAndOrganization.get(
		`${userId}:${organizationId}`,
	);
	return membershipId ? membershipWithOrganization(state, membershipId) : null;
}

export function inMemCreateOrganization(
	state: InMemoryOrgState,
	input: { name: string; slug: string; defaultCurrencyCode?: string },
): OrganizationRecord {
	const organization: OrganizationRecord = {
		id: randomUUID(),
		name: input.name,
		slug: input.slug,
		timezone: "UTC",
		defaultCurrencyCode: input.defaultCurrencyCode ?? "USD",
		createdAtIso: new Date().toISOString(),
	};
	state.organizations.set(organization.id, organization);
	state.organizationsBySlug.set(organization.slug, organization.id);
	state.organizationsByName.set(
		organization.name.toLowerCase(),
		organization.id,
	);
	return organization;
}

export function inMemGetOrganizationTimezone(
	state: InMemoryOrgState,
	organizationId: string,
): string {
	const organization = state.organizations.get(organizationId);
	if (!organization) throw new Error("Organization not found.");
	return organization.timezone;
}

export function inMemUpdateOrganizationTimezone(
	state: InMemoryOrgState,
	organizationId: string,
	timezone: string,
): string {
	const organization = state.organizations.get(organizationId);
	if (!organization) throw new Error("Organization not found.");
	state.organizations.set(organizationId, { ...organization, timezone });
	return timezone;
}

export function inMemCreateMembership(
	state: InMemoryOrgState,
	input: CreateMembershipInput,
): OrganizationMembershipRecord {
	const key = `${input.userId}:${input.organizationId}`;
	if (state.membershipsByUserAndOrganization.has(key)) {
		throw new Error("Membership already exists for this organization.");
	}
	const membership: OrganizationMembershipRecord = {
		id: randomUUID(),
		organizationId: input.organizationId,
		userId: input.userId,
		role: input.role,
		origin: input.origin,
		joinedAtIso: new Date().toISOString(),
	};
	state.memberships.set(membership.id, membership);
	const userMemberships =
		state.membershipsByUserId.get(membership.userId) ?? new Set<string>();
	userMemberships.add(membership.id);
	state.membershipsByUserId.set(membership.userId, userMemberships);
	state.membershipsByUserAndOrganization.set(key, membership.id);
	return membership;
}

export function inMemCreateInvite(
	state: InMemoryOrgState,
	input: CreateInviteRecordInput,
): OrganizationInviteRecord {
	const invite: OrganizationInviteRecord = {
		id: randomUUID(),
		token: randomUUID(),
		organizationId: input.organizationId,
		email: input.email.toLowerCase(),
		role: input.role,
		invitedByUserId: input.invitedByUserId,
		createdAtIso: new Date().toISOString(),
	};
	state.invites.set(invite.id, invite);
	state.invitesByToken.set(invite.token, invite.id);
	return invite;
}

export function inMemFindInviteByToken(
	state: InMemoryOrgState,
	token: string,
): InviteWithOrganization | null {
	const inviteId = state.invitesByToken.get(token);
	if (!inviteId) return null;
	const invite = state.invites.get(inviteId);
	if (!invite) return null;
	const organization = state.organizations.get(invite.organizationId);
	return organization ? { invite, organization } : null;
}

export function inMemMarkInviteAccepted(
	state: InMemoryOrgState,
	token: string,
): void {
	const inviteId = state.invitesByToken.get(token);
	if (!inviteId) return;
	const invite = state.invites.get(inviteId);
	if (!invite) return;
	state.invites.set(inviteId, {
		...invite,
		acceptedAtIso: new Date().toISOString(),
	});
}

export function inMemListAdminUsers(
	state: InMemoryOrgState,
	organizationId: string,
	currentUserId: string,
): OrganizationAdminUserEntry[] {
	const acceptedUsers = [...state.memberships.values()]
		.filter((membership) => membership.organizationId === organizationId)
		.map((membership) => {
			const user = state.users.get(membership.userId);
			if (!user) {
				throw new Error(`User not found for membership ${membership.id}`);
			}
			return {
				id: membership.id,
				email: user.email,
				role: membership.role,
				status: "accepted" as const,
				isSelf: membership.userId === currentUserId,
			};
		});
	const pendingUsers = [...state.invites.values()]
		.filter(
			(invite) =>
				invite.organizationId === organizationId && !invite.acceptedAtIso,
		)
		.map((invite) => ({
			id: invite.id,
			email: invite.email,
			role: invite.role,
			status: "pending" as const,
			isSelf: false,
		}));
	return [...acceptedUsers, ...pendingUsers];
}

export function inMemDeleteMembership(
	state: InMemoryOrgState,
	input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	},
): void {
	const membership = state.memberships.get(input.membershipId);
	if (!membership || membership.organizationId !== input.organizationId) {
		throw new Error("Membership not found.");
	}
	if (membership.userId === input.currentUserId) {
		throw new Error("Admins cannot delete their own membership.");
	}
	state.memberships.delete(input.membershipId);
	state.membershipsByUserId.get(membership.userId)?.delete(input.membershipId);
	state.membershipsByUserAndOrganization.delete(
		`${membership.userId}:${membership.organizationId}`,
	);
	const user = state.users.get(membership.userId);
	if (user) {
		state.users.set(user.id, { ...user, disassociated: true });
	}
}

export function inMemCancelInvite(
	state: InMemoryOrgState,
	input: { organizationId: string; inviteId: string },
): void {
	const invite = state.invites.get(input.inviteId);
	if (!invite || invite.organizationId !== input.organizationId) {
		throw new Error("Invite not found.");
	}
	state.invites.delete(input.inviteId);
	state.invitesByToken.delete(invite.token);
}

export function inMemDismissWelcome(
	state: InMemoryOrgState,
	userId: string,
	organizationId: string,
): OrganizationMembershipRecord {
	const membershipId = state.membershipsByUserAndOrganization.get(
		`${userId}:${organizationId}`,
	);
	if (!membershipId) {
		throw new Error(`Membership not found for user ${userId}`);
	}
	const membership = state.memberships.get(membershipId);
	if (!membership || membership.organizationId !== organizationId) {
		throw new Error(`Membership not found for organization ${organizationId}`);
	}
	const updated: OrganizationMembershipRecord = {
		...membership,
		welcomeDismissedAtIso: new Date().toISOString(),
	};
	state.memberships.set(membership.id, updated);
	return updated;
}

export function inMemGetAccompanistDivisionPolicy(
	state: InMemoryOrgState,
	organizationId: string,
): AccompanistDivisionPolicyRecord {
	return (
		state.accompanistPolicies.get(organizationId) ?? {
			organizationId,
			policy: "exactly_one",
			updatedAtIso: new Date().toISOString(),
		}
	);
}

export function inMemUpdateAccompanistDivisionPolicy(
	state: InMemoryOrgState,
	input: { organizationId: string; policy: AccompanistDivisionSelectionPolicy },
): AccompanistDivisionPolicyRecord {
	if (!state.organizations.has(input.organizationId)) {
		throw new Error("Organization not found.");
	}
	const record: AccompanistDivisionPolicyRecord = {
		organizationId: input.organizationId,
		policy: input.policy,
		updatedAtIso: new Date().toISOString(),
	};
	state.accompanistPolicies.set(input.organizationId, record);
	state.accompanistPolicyHistory.push({
		id: randomUUID(),
		...record,
		createdAtIso: record.updatedAtIso,
	});
	return record;
}

export function inMemListAccompanistDivisionPolicyHistory(
	state: InMemoryOrgState,
	organizationId: string,
): AccompanistDivisionPolicyHistoryRecord[] {
	return state.accompanistPolicyHistory
		.filter((record) => record.organizationId === organizationId)
		.map((record) => ({ ...record }));
}

export function inMemUpdateRegistrationAgeConfiguration(
	state: InMemoryOrgState,
	input: { organizationId: string; registrationAgeDate: string },
): RegistrationAgeConfiguration {
	if (!state.organizations.has(input.organizationId)) {
		throw new Error("Organization not found.");
	}
	const record = {
		organizationId: input.organizationId,
		registrationAgeDate: input.registrationAgeDate,
		updatedAtIso: new Date().toISOString(),
	};
	state.registrationAgeConfigurations.set(input.organizationId, record);
	return record;
}
