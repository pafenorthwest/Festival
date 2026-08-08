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
	disassociated: boolean;
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

export type OrganizationInviteStatus = "pending" | "accepted";
export type OrganizationAdminUserStatus = "accepted" | "pending";

export interface OrganizationAdminUserEntry {
	id: string;
	email: string;
	role: OrganizationRole;
	status: OrganizationAdminUserStatus;
	isSelf: boolean;
}

export interface OrganizationAdminUsersResponse {
	users: OrganizationAdminUserEntry[];
}

export interface DeleteOrganizationAdminUserResponse {
	status: "deleted";
}

export interface FestivalRecord {
	id: string;
	organizationId: string;
	code: string;
	name: string;
	startDate: string;
	endDate: string;
	createdAtIso: string;
}

export interface FestivalSummary {
	id: string;
	code: string;
	name: string;
	startDate: string;
	endDate: string;
	createdAtIso: string;
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

export interface OrganizationMembershipListResponse {
	memberships: SessionMembership[];
}

export interface CreateOrganizationInput {
	name: string;
	shortName: string;
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
	status: OrganizationInviteStatus;
	acceptedAtIso?: string;
}

export interface CreateInviteResponse {
	invite: InviteSummary;
}

export interface CreateFestivalInput {
	name: string;
	startDate: string;
	endDate: string;
}

export interface CreateFestivalResponse {
	festival: FestivalSummary;
}

export interface OrganizationFestivalListResponse {
	festivals: FestivalSummary[];
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
	return value.trim().replace(/\s+/g, " ");
}

export function normalizeOrganizationShortName(value: string): string {
	return value.trim().toLowerCase();
}

export function normalizeFestivalName(value: string): string {
	return value.trim().replace(/\s+/g, " ");
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

	if (normalized.length > 255) {
		errors.push("Organization name must be 255 characters or less.");
	}

	if (!/^[A-Za-z0-9-]+(?: [A-Za-z0-9-]+)*$/.test(normalized)) {
		errors.push(
			"Organization name may only contain letters, numbers, spaces, and hyphens.",
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

export function validateOrganizationShortName(
	value: string,
): OrganizationNameValidation {
	const normalized = normalizeOrganizationShortName(value);
	const errors: string[] = [];

	if (normalized.length === 0) {
		errors.push("Organization short name is required.");
	}

	if (normalized.length > 16) {
		errors.push("Organization short name must be 16 characters or less.");
	}

	if (!/^[a-z0-9-]+$/.test(normalized)) {
		errors.push(
			"Organization short name may only contain letters, numbers, and hyphens.",
		);
	}

	if (normalized.startsWith("-") || normalized.endsWith("-")) {
		errors.push("Organization short name may not start or end with a hyphen.");
	}

	if (normalized.includes("--")) {
		errors.push("Organization short name may not contain consecutive hyphens.");
	}

	return {
		valid: errors.length === 0,
		errors,
		normalized,
	};
}

export function validateFestivalName(
	value: string,
): OrganizationNameValidation {
	const normalized = normalizeFestivalName(value);
	const errors: string[] = [];

	if (normalized.length === 0) {
		errors.push("Festival name is required.");
	}

	if (normalized.length > 255) {
		errors.push("Festival name must be 255 characters or less.");
	}

	if (!/^[A-Za-z0-9()]+(?: [A-Za-z0-9()]+)*$/.test(normalized)) {
		errors.push(
			"Festival name may only contain letters, numbers, spaces, and parentheses.",
		);
	}

	return {
		valid: errors.length === 0,
		errors,
		normalized,
	};
}

export interface FestivalDateValidation {
	valid: boolean;
	errors: string[];
	startDate: string;
	endDate: string;
}

export function todayDateOnly(now = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export function validateFestivalDates(input: {
	startDate: string;
	endDate: string;
	today?: string;
}): FestivalDateValidation {
	const startDate = input.startDate.trim();
	const endDate = input.endDate.trim();
	const today = input.today ?? todayDateOnly();
	const errors: string[] = [];
	const datePattern = /^\d{4}-\d{2}-\d{2}$/;

	if (!datePattern.test(startDate)) {
		errors.push("Festival start date is required.");
	}

	if (!datePattern.test(endDate)) {
		errors.push("Festival end date is required.");
	}

	if (datePattern.test(startDate) && startDate < today) {
		errors.push("Festival start date cannot be in the past.");
	}

	if (
		datePattern.test(startDate) &&
		datePattern.test(endDate) &&
		endDate < startDate
	) {
		errors.push("Festival end date must be the same as or after start date.");
	}

	return {
		valid: errors.length === 0,
		errors,
		startDate,
		endDate,
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
