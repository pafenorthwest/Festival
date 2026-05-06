export const ORGANIZATION_ROLES = [
	"Admin",
	"Division Chair",
	"Music Reviewer",
	"Concert Chair",
	"Read Only",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface AuthenticatedUser {
	uid: string;
	email: string;
	displayName: string;
}

export interface OrganizationRecord {
	id: string;
	name: string;
	slug: string;
	createdAtIso: string;
}

export interface OrganizationUserRecord {
	id: string;
	firebaseUid: string;
	email: string;
	displayName: string;
	createdAtIso: string;
}

export type AuthLoginProvider = "google" | "password";

export interface AppUserRecord {
	id: string;
	firebaseUid: string;
	email: string;
	fullName?: string;
	isActive: boolean;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface AppUserPayload {
	id: string;
	firebaseUid: string;
	email: string;
	fullName?: string;
}

export interface AppUserResponse {
	user: AppUserPayload;
}

export interface LoginEventInput {
	provider: AuthLoginProvider;
}

export interface LoginEventResponse {
	status: "ok";
}

export interface OrganizationMembershipRecord {
	id: string;
	organizationId: string;
	userId: string;
	role: OrganizationRole;
	joinedAtIso: string;
	origin: "creator" | "invite";
	welcomeDismissedAtIso?: string;
}

export interface OrganizationInviteRecord {
	id: string;
	token: string;
	organizationId: string;
	email: string;
	role: OrganizationRole;
	invitedByUserId: string;
	createdAtIso: string;
	acceptedAtIso?: string;
}

export interface SessionMembership {
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	role: OrganizationRole;
	showWelcome: boolean;
}

export interface OrganizationSession {
	authenticated: boolean;
	user?: AuthenticatedUser;
	membership?: SessionMembership;
}

export interface SessionResponse {
	session: OrganizationSession;
}

export interface CreateOrganizationInput {
	name: string;
}

export interface CreateOrganizationResponse {
	organization: OrganizationRecord;
	membership: SessionMembership;
}

export interface CreateInviteInput {
	organizationSlug: string;
	email: string;
	role: OrganizationRole;
}

export interface InviteSummary {
	token: string;
	organizationName: string;
	organizationSlug: string;
	email: string;
	role: OrganizationRole;
	acceptedAtIso?: string;
}

export interface CreateInviteResponse {
	invite: InviteSummary;
}

export interface AcceptInviteInput {
	name: string;
}

export interface AcceptInviteResponse {
	organization: OrganizationRecord;
	membership: SessionMembership;
}

export interface OrganizationLandingResponse {
	organization: OrganizationRecord;
	membership: SessionMembership;
}

export interface DismissWelcomeResponse {
	membership: SessionMembership;
}

export function isOrganizationRole(value: string): value is OrganizationRole {
	return ORGANIZATION_ROLES.includes(value as OrganizationRole);
}

export function isAuthLoginProvider(
	value: unknown,
): value is AuthLoginProvider {
	return value === "google" || value === "password";
}

export function normalizeOrganizationName(value: string): string {
	return value.trim().toLowerCase();
}

export interface OrganizationNameValidation {
	valid: boolean;
	errors: string[];
	normalized: string;
}

export function validateOrganizationName(
	value: string,
): OrganizationNameValidation {
	const normalized = normalizeOrganizationName(value);
	const errors: string[] = [];

	if (normalized.length === 0) {
		errors.push("Organization name is required.");
	}

	if (normalized.length > 40) {
		errors.push("Organization name must be 40 characters or less.");
	}

	if (!/^[a-z-]+$/.test(normalized)) {
		errors.push(
			"Organization name may only contain lowercase letters and hyphens.",
		);
	}

	if (normalized.startsWith("-") || normalized.endsWith("-")) {
		errors.push("Organization name may not start or end with a hyphen.");
	}

	if (normalized.includes("--")) {
		errors.push("Organization name may not contain consecutive hyphens.");
	}

	return {
		valid: errors.length === 0,
		errors,
		normalized,
	};
}

export function deriveDisplayName(input: {
	displayName?: string | null;
	email: string;
	name?: string;
}): string {
	const explicitName = input.name?.trim();
	if (explicitName) {
		return explicitName;
	}

	const authDisplayName = input.displayName?.trim();
	if (authDisplayName) {
		return authDisplayName;
	}

	return input.email.split("@")[0] ?? input.email;
}
