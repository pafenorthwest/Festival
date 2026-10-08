import type {
	AcceptInviteInput,
	AddCatalogWorkInput,
	AdminCustomerSearchResponse,
	AdminCustomerSearchResult,
	BillingAdjustment,
	BillingAdjustmentType,
	BillingAdjustmentValidationResult,
	BillingLedgerDirection,
	BillingLedgerEntry,
	BillingLedgerEntryType,
	BillingMismatchRecord,
	BillingMismatchType,
	BookShiftsOutcome,
	CanonicalContributor,
	CanonicalWork,
	ClaimReviewInput,
	ClassCheckoutLineItemInput,
	ClassEligibilityResult,
	ClassRegistrationMetadata,
	CommunicationValidationResult,
	CoverageGapShift,
	CoverageGapsSummary,
	CreateBillingAdjustmentInput,
	CreateFestivalClassInput,
	CreateFestivalInput,
	CreateFestivalResponse,
	CreateInviteInput,
	CreateInviteResponse,
	CreateMembershipProductInput,
	CreateMembershipProductResponse,
	CreateMessageTemplateInput,
	CreateOrganizationDivisionInput,
	CreateOrganizationInput,
	CreateOrganizationResponse,
	CreditBalance,
	CustomerAccountSettingsResponse,
	CustomerMembershipStatusResponse,
	CustomerOrdersResponse,
	CustomerProfileResponse,
	CustomerSessionResponse,
	DismissWelcomeResponse,
	DropRegistrationInput,
	DropRegistrationResult,
	DropRegistrationValidationResult,
	EvaluatePurchaseEligibilityResponse,
	FestivalClassConfigurationDto,
	FestivalSummary,
	FlagReviewInput,
	InviteSummary,
	MembershipProductsListResponse,
	MembershipPurchaseSelectionResponse,
	MessageChannel,
	MessageDeliveryStatus,
	MessageEvent,
	MessageLog,
	MessageLogStatus,
	MessageTemplate,
	NormalizeReviewInput,
	OrganizationAdminUsersResponse,
	OrganizationDivision,
	OrganizationDivisionListResponse,
	OrganizationFestivalListResponse,
	OrganizationLandingResponse,
	OrganizationMembershipListResponse,
	OrganizationTimezoneResponse,
	ProposedPurchaseLineItem,
	PublicMembershipProductsListResponse,
	PublicOrganizationDivisionListResponse,
	PublicOrganizationLandingResponse,
	RefundEvent,
	RefundEventStatus,
	RegistrationAccompanistSummary,
	RegistrationActorRole,
	RegistrationAgeConfiguration,
	RegistrationCatalogValue,
	RegistrationChangeAction,
	RegistrationChangeLog,
	RegistrationEligibleClass,
	RegistrationTeacherSummary,
	RegistrationValidationResult,
	ReorderOrganizationDivisionsInput,
	RepertoireFlagReason,
	RepertoirePiece,
	RepertoireReviewItem,
	RepertoireReviewQueueFilter,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
	ResolveFlagInput,
	SaveCustomerAccountSettingsInput,
	SaveCustomerAccountSettingsResponse,
	SaveShopifyIntegrationInput,
	SaveShopifyIntegrationResponse,
	SessionResponse,
	ShiftCoverageEntry,
	ShiftCoverageStatus,
	ShopifyIntegrationDiagnosticsResponse,
	ShopifyIntegrationSettingsResponse,
	TransferRegistrationInput,
	TransferRegistrationResult,
	TransferRegistrationValidationResult,
	TriggerMessageEventInput,
	UpdateCustomerProfileInput,
	UpdateFestivalClassInput,
	UpdateMessageTemplateInput,
	UpdateOrganizationDivisionInput,
	UpdateOrganizationTimezoneInput,
	VolunteerAssignment,
	VolunteerRecord,
	WaitlistPromotionResult,
} from "@festival/common";
import {
	assertValidCreateBillingAdjustmentInput,
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	BILLING_ADJUSTMENT_TYPES,
	BILLING_LEDGER_DIRECTIONS,
	BILLING_LEDGER_ENTRY_TYPES,
	BILLING_MISMATCH_TYPES,
	extractTemplateVariables,
	isBillingAdjustmentType,
	isBillingLedgerDirection,
	isBillingLedgerEntryType,
	isBillingMismatchType,
	isMessageChannel,
	isMessageDeliveryStatus,
	isMessageLogStatus,
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
	isRepertoireReviewStatus,
	MESSAGE_CHANNELS,
	MESSAGE_DELIVERY_STATUSES,
	MESSAGE_LOG_STATUSES,
	REFUND_EVENT_STATUSES,
	REGISTRATION_ACTOR_ROLES,
	REGISTRATION_CHANGE_ACTIONS,
	REPERTOIRE_FLAG_REASONS,
	REPERTOIRE_REVIEW_STATUSES,
	renderTemplate,
	validateCreateBillingAdjustmentInput,
	validateCreateMessageTemplateInput,
	validateDropRegistrationInput,
	validateTransferRegistrationInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
} from "@festival/common";
import { getFirebaseAuth } from "./firebase-auth.js";
import { buildOrgCheckoutRecoveryPath } from "./routes.js";

const API_BASE = import.meta.env.FRONT_API_BASE ?? "";

export interface VolunteerRole {
	id: string;
	organizationId: string;
	slug: string;
	displayName: string;
	description: string;
	detailsUrl: string | null;
	isRoomProctor: boolean;
	createdAtIso: string;
}

export interface VolunteerShift {
	id: string;
	organizationId: string;
	roleId: string;
	date: string;
	period: "AM" | "PM";
	timeText: string | null;
	division: string | null;
	adjudicator: string | null;
	createdAtIso: string;
}

export interface CreateVolunteerRoleInput {
	slug: string;
	displayName: string;
	description: string;
	detailsUrl?: string | null;
	isRoomProctor: boolean;
}

export interface CreateVolunteerShiftInput {
	date: string;
	period: "AM" | "PM";
	timeText?: string | null;
	division?: string | null;
	adjudicator?: string | null;
}

export interface UpdateVolunteerRoleInput {
	displayName: string;
	description: string;
	detailsUrl?: string | null;
	isRoomProctor: boolean;
}

export interface UpdateVolunteerShiftInput {
	date: string;
	period: "AM" | "PM";
	timeText?: string | null;
	division?: string | null;
	adjudicator?: string | null;
}

export type {
	AddCatalogWorkInput,
	AdminCustomerSearchResponse,
	AdminCustomerSearchResult,
	BillingAdjustment,
	BillingAdjustmentType,
	BillingAdjustmentValidationResult,
	BillingLedgerDirection,
	BillingLedgerEntry,
	BillingLedgerEntryType,
	BillingMismatchRecord,
	BillingMismatchType,
	BookShiftsOutcome,
	CanonicalContributor,
	CanonicalWork,
	ClaimReviewInput,
	ClassCheckoutLineItemInput,
	ClassEligibilityResult,
	CommunicationValidationResult,
	CoverageGapShift,
	CoverageGapsSummary,
	CreateBillingAdjustmentInput,
	CreateMessageTemplateInput,
	CreditBalance,
	DropRegistrationInput,
	DropRegistrationResult,
	DropRegistrationValidationResult,
	EvaluatePurchaseEligibilityResponse,
	FlagReviewInput,
	MessageChannel,
	MessageDeliveryStatus,
	MessageEvent,
	MessageLog,
	MessageLogStatus,
	MessageTemplate,
	NormalizeReviewInput,
	ProposedPurchaseLineItem,
	RefundEvent,
	RefundEventStatus,
	RegistrationActorRole,
	RegistrationChangeAction,
	RegistrationChangeLog,
	RegistrationValidationResult,
	RepertoireFlagReason,
	RepertoireReviewItem,
	RepertoireReviewQueueFilter,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
	ResolveFlagInput,
	ShiftCoverageEntry,
	ShiftCoverageStatus,
	TransferRegistrationInput,
	TransferRegistrationResult,
	TransferRegistrationValidationResult,
	TriggerMessageEventInput,
	UpdateMessageTemplateInput,
	VolunteerAssignment,
	VolunteerRecord,
	WaitlistPromotionResult,
};
export {
	assertValidCreateBillingAdjustmentInput,
	assertValidDropRegistrationInput,
	assertValidTransferRegistrationInput,
	BILLING_ADJUSTMENT_TYPES,
	BILLING_LEDGER_DIRECTIONS,
	BILLING_LEDGER_ENTRY_TYPES,
	BILLING_MISMATCH_TYPES,
	extractTemplateVariables,
	isBillingAdjustmentType,
	isBillingLedgerDirection,
	isBillingLedgerEntryType,
	isBillingMismatchType,
	isMessageChannel,
	isMessageDeliveryStatus,
	isMessageLogStatus,
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
	isRepertoireReviewStatus,
	MESSAGE_CHANNELS,
	MESSAGE_DELIVERY_STATUSES,
	MESSAGE_LOG_STATUSES,
	REFUND_EVENT_STATUSES,
	REGISTRATION_ACTOR_ROLES,
	REGISTRATION_CHANGE_ACTIONS,
	REPERTOIRE_FLAG_REASONS,
	REPERTOIRE_REVIEW_STATUSES,
	renderTemplate,
	validateCreateBillingAdjustmentInput,
	validateCreateMessageTemplateInput,
	validateDropRegistrationInput,
	validateTransferRegistrationInput,
	validateTriggerMessageEventInput,
	validateUpdateMessageTemplateInput,
};

export interface VolunteerShiftListing extends VolunteerShift {
	available: boolean;
	role: VolunteerRole;
	shift: VolunteerShift;
}

export interface VolunteerScheduleEntry {
	assignment: VolunteerAssignment;
	shift: VolunteerShift;
	role: VolunteerRole;
}

export interface VolunteerCoverageGapsResponse extends CoverageGapsSummary {
	openShifts: number;
	unfilled: CoverageGapShift[];
}

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
	}
}

async function resolveAuthToken(
	explicitToken?: string | null,
): Promise<string | null> {
	if (explicitToken) return explicitToken;
	try {
		const auth = getFirebaseAuth();
		if (auth?.currentUser) {
			return await auth.currentUser.getIdToken();
		}
	} catch {
		// Ignore if auth is unavailable
	}
	return null;
}

async function requestJson<T>(
	path: string,
	init?: RequestInit,
	idToken?: string | null,
	base = API_BASE,
): Promise<T> {
	const response = await fetch(`${base}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
			...(init?.headers ?? {}),
		},
	});

	const payload = (await response.json()) as
		| T
		| { error?: string; code?: string };
	if (!response.ok) {
		throw new ApiError(
			(payload as { error?: string }).error ?? `Request failed for ${path}`,
			response.status,
			(payload as { code?: string }).code,
		);
	}

	return payload as T;
}

export function getCustomerAccountSettings(idToken: string, slug: string) {
	return requestJson<CustomerAccountSettingsResponse>(
		`/api/organizations/${slug}/admin/shopify-customer-account`,
		undefined,
		idToken,
	);
}

export function saveCustomerAccountSettings(
	idToken: string,
	slug: string,
	input: SaveCustomerAccountSettingsInput,
) {
	return requestJson<SaveCustomerAccountSettingsResponse>(
		`/api/organizations/${slug}/admin/shopify-customer-account`,
		{ method: "POST", body: JSON.stringify(input) },
		idToken,
	);
}

export function customerSignInPath(slug: string, checkoutReturn = false) {
	const returnTo = `/org/${slug}/account/memberships${checkoutReturn ? "?checkout=processing" : ""}`;
	return `/api/organizations/${slug}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function customerMembershipPurchaseSignInPath(
	slug: string,
	offeringId: string,
) {
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?offering=${encodeURIComponent(offeringId)}`;
}

export function customerAccompanistMembershipSignInPath(slug: string) {
	const encodedSlug = encodeURIComponent(slug);
	const returnTo = `/org/${encodedSlug}/accompanist-membership`;
	return `/api/organizations/${encodedSlug}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function getCustomerSession(slug: string) {
	return requestJson<CustomerSessionResponse>(
		`/api/organizations/${slug}/customer/session`,
		undefined,
		undefined,
		"",
	);
}

export function getCustomerOrders(slug: string, after?: string) {
	return requestJson<CustomerOrdersResponse>(
		`/api/organizations/${slug}/customer/orders${after ? `?after=${encodeURIComponent(after)}` : ""}`,
		undefined,
		undefined,
		"",
	);
}

export function getCustomerMembershipStatus(slug: string) {
	return requestJson<CustomerMembershipStatusResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/membership-status`,
		undefined,
		undefined,
		"",
	);
}

export function getCustomerProfile(slug: string) {
	return requestJson<CustomerProfileResponse>(
		`/api/organizations/${slug}/customer/profile`,
		undefined,
		undefined,
		"",
	);
}

export interface CustomerChildDto {
	id: string;
	displayName: string;
	hasCurrentValidAgeSnapshot: boolean;
}
export function getCustomerChildren(slug: string) {
	return requestJson<{ children: CustomerChildDto[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/children`,
		undefined,
		undefined,
		"",
	);
}
export function createCustomerChild(
	slug: string,
	csrfToken: string,
	input: { displayName: string; birthday: string },
) {
	return requestJson<{ child: CustomerChildDto }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/children`,
		{
			method: "POST",
			headers: { "X-CSRF-Token": csrfToken },
			body: JSON.stringify(input),
		},
		undefined,
		"",
	);
}
export function refreshCustomerChildAgeSnapshot(
	slug: string,
	childId: string,
	csrfToken: string,
	birthday: string,
) {
	return requestJson(
		`/api/organizations/${encodeURIComponent(slug)}/customer/children/${encodeURIComponent(childId)}/age-snapshot`,
		{
			method: "POST",
			headers: { "X-CSRF-Token": csrfToken },
			body: JSON.stringify({ birthday }),
		},
		undefined,
		"",
	);
}

export function updateCustomerProfile(
	slug: string,
	csrfToken: string,
	input: UpdateCustomerProfileInput,
) {
	return requestJson<CustomerProfileResponse>(
		`/api/organizations/${slug}/customer/profile`,
		{
			method: "POST",
			headers: { "X-CSRF-Token": csrfToken },
			body: JSON.stringify(input),
		},
		undefined,
		"",
	);
}

export function logoutCustomer(slug: string, csrfToken: string): void {
	const form = document.createElement("form");
	form.method = "POST";
	form.action = `/api/organizations/${slug}/customer/logout`;
	const input = document.createElement("input");
	input.type = "hidden";
	input.name = "csrfToken";
	input.value = csrfToken;
	form.append(input);
	document.body.append(form);
	form.submit();
}

export function getBootstrap() {
	return requestJson<SessionResponse>("/api/bootstrap");
}

export function getFirebaseSession(idToken: string) {
	return requestJson<SessionResponse>(
		"/api/firebase-session",
		undefined,
		idToken,
	);
}

export function getMemberships(idToken: string) {
	return requestJson<OrganizationMembershipListResponse>(
		"/api/memberships",
		undefined,
		idToken,
	);
}

export function createOrganization(
	idToken: string,
	input: CreateOrganizationInput,
) {
	return requestJson<CreateOrganizationResponse>(
		"/api/organizations",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function createInvite(idToken: string, input: CreateInviteInput) {
	return requestJson<CreateInviteResponse>(
		"/api/invites",
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export async function getInvite(token: string) {
	return requestJson<{ invite: InviteSummary }>(`/api/invites/${token}`);
}

export function acceptInvite(
	idToken: string,
	token: string,
	input: AcceptInviteInput,
) {
	return requestJson(
		`/api/invites/${token}/accept`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	) as Promise<{
		organization: OrganizationLandingResponse["organization"];
		membership: OrganizationLandingResponse["membership"];
	}>;
}

export function getOrganization(idToken: string, slug: string) {
	return requestJson<OrganizationLandingResponse>(
		`/api/organizations/${slug}`,
		undefined,
		idToken,
	);
}

export function getPublicOrganizationLanding(slug: string) {
	return requestJson<PublicOrganizationLandingResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/landing`,
	);
}

export function getPrimaryFestivalPath(slug: string) {
	return requestJson<{ status: 301 | 404; path: string }>(
		`/api/organizations/${encodeURIComponent(slug)}/primary`,
	);
}

export function getPublicFestival(slug: string, festivalSlug: string) {
	return requestJson<{ festival: FestivalSummary }>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalSlug)}`,
	);
}

export function getAdminFestival(
	idToken: string,
	slug: string,
	festivalSlug: string,
) {
	return requestJson<{ festival: FestivalSummary }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}`,
		undefined,
		idToken,
	);
}

export function customerLandingSignInPath(slug: string) {
	const returnTo = `/org/${encodeURIComponent(slug)}`;
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function customerFestivalRegistrationSignInPath(
	slug: string,
	festivalSlug: string,
) {
	const encodedSlug = encodeURIComponent(slug);
	const returnTo = `/org/${encodedSlug}/festival/${encodeURIComponent(festivalSlug)}/register`;
	return `/api/organizations/${encodedSlug}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function getMembershipProducts(slug: string) {
	return requestJson<PublicMembershipProductsListResponse>(
		`/api/organizations/${slug}/membership-products`,
	);
}

export function acquireAccompanistMembership(
	slug: string,
	csrfToken: string,
	input: {
		name: string;
		email: string;
		city: string;
		phone: string;
		divisionIds: string[];
	},
) {
	return requestJson<{
		membership: {
			id: string;
			startsOn: string;
			endsOn: string;
			status: string;
		};
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/accompanist-membership`,
		{
			method: "POST",
			headers: { "X-CSRF-Token": csrfToken },
			body: JSON.stringify(input),
		},
		undefined,
		"",
	);
}

export function getAccompanistMembershipForm(slug: string) {
	return requestJson<{
		policy: { policy: "exactly_one" | "one_to_two" | "one_to_all" };
		divisions: OrganizationDivision[];
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/accompanist-membership`,
		undefined,
		undefined,
		"",
	);
}

export function getPublicDivisions(slug: string) {
	return requestJson<PublicOrganizationDivisionListResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/divisions`,
		undefined,
		undefined,
		"",
	);
}

export function resumeCustomerMembershipPurchase(
	slug: string,
	offeringId: string,
) {
	return requestJson<MembershipPurchaseSelectionResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/membership-purchase/${encodeURIComponent(offeringId)}`,
		undefined,
		undefined,
		"",
	);
}

export function startCustomerCheckout(
	slug: string,
	csrfToken: string,
	offeringId: string,
	divisionId: string,
	staffAccessConsent: boolean,
	idempotencyKey: string,
) {
	return requestJson<{ checkoutUrl: string }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/checkout`,
		{
			method: "POST",
			headers: {
				"X-CSRF-Token": csrfToken,
				"Idempotency-Key": idempotencyKey,
			},
			body: JSON.stringify({
				offeringId,
				divisionId,
				staffAccessConsent,
			}),
		},
		undefined,
		"",
	);
}

export function getAdminMembershipProducts(idToken: string, slug: string) {
	return requestJson<MembershipProductsListResponse>(
		`/api/organizations/${slug}/admin/membership-products`,
		undefined,
		idToken,
	);
}

export function retireAdminMembershipProduct(
	idToken: string,
	slug: string,
	offeringId: string,
) {
	return requestJson<{ retired: true }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/membership-products/${encodeURIComponent(offeringId)}/retire`,
		{ method: "POST", body: JSON.stringify({ confirmed: true }) },
		idToken,
	);
}

export function getAdminAccompanistPolicy(idToken: string, slug: string) {
	return requestJson<{
		policy: {
			policy: "exactly_one" | "one_to_two" | "one_to_all";
		};
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/accompanist-policy`,
		undefined,
		idToken,
	);
}

export function saveAdminAccompanistPolicy(
	idToken: string,
	slug: string,
	policy: "exactly_one" | "one_to_two" | "one_to_all",
) {
	return requestJson(
		`/api/organizations/${encodeURIComponent(slug)}/admin/accompanist-policy`,
		{ method: "POST", body: JSON.stringify({ policy }) },
		idToken,
	);
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

export function listStaffRoster(
	idToken: string,
	slug: string,
): Promise<StaffMembershipRosterEntry[]>;
export function listStaffRoster(
	slug: string,
): Promise<StaffMembershipRosterEntry[]>;
export async function listStaffRoster(
	idTokenOrSlug: string,
	maybeSlug?: string,
): Promise<StaffMembershipRosterEntry[]> {
	const [idToken, slug] = maybeSlug
		? [idTokenOrSlug, maybeSlug]
		: [undefined, idTokenOrSlug];
	const response = await requestJson<{
		roster: StaffMembershipRosterEntry[];
		accompanists: StaffMembershipRosterEntry[];
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/staff/accompanists`,
		undefined,
		idToken,
	);
	return response.roster ?? response.accompanists ?? [];
}

export const listAccompanists = listStaffRoster;

export function getStaffAccompanists(idToken: string, slug: string) {
	return requestJson<{
		accompanists: StaffMembershipRosterEntry[];
		roster: StaffMembershipRosterEntry[];
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/staff/accompanists`,
		undefined,
		idToken,
	);
}

export function createMembershipProduct(
	idToken: string,
	slug: string,
	input: CreateMembershipProductInput,
) {
	return requestJson<CreateMembershipProductResponse>(
		`/api/organizations/${slug}/admin/membership-products`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function dismissWelcome(idToken: string, slug: string) {
	return requestJson<DismissWelcomeResponse>(
		`/api/organizations/${slug}/welcome/dismiss`,
		{
			method: "POST",
		},
		idToken,
	);
}

export function getAdminUsers(idToken: string, slug: string) {
	return requestJson<OrganizationAdminUsersResponse>(
		`/api/organizations/${slug}/admin/users`,
		undefined,
		idToken,
	);
}

export function deleteAdminMembership(
	idToken: string,
	slug: string,
	membershipId: string,
) {
	return requestJson(
		`/api/organizations/${slug}/admin/memberships/${membershipId}`,
		{
			method: "DELETE",
		},
		idToken,
	);
}

export function cancelAdminInvite(
	idToken: string,
	slug: string,
	inviteId: string,
) {
	return requestJson(
		`/api/organizations/${slug}/admin/invites/${inviteId}`,
		{
			method: "DELETE",
		},
		idToken,
	);
}

export function getFestivals(idToken: string, slug: string) {
	return requestJson<OrganizationFestivalListResponse>(
		`/api/organizations/${slug}/admin/festivals`,
		undefined,
		idToken,
	);
}

export function createFestival(
	idToken: string,
	slug: string,
	input: CreateFestivalInput,
) {
	return requestJson<CreateFestivalResponse>(
		`/api/organizations/${slug}/admin/festivals`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function setPrimaryFestival(
	idToken: string,
	slug: string,
	festivalShortName: string,
) {
	return requestJson<CreateFestivalResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalShortName)}/primary`,
		{ method: "POST" },
		idToken,
	);
}

export function getAdminDivisions(idToken: string, slug: string) {
	return requestJson<OrganizationDivisionListResponse>(
		`/api/organizations/${slug}/admin/divisions`,
		undefined,
		idToken,
	);
}

export const listDivisions = getAdminDivisions;

export function createAdminDivision(
	idToken: string,
	slug: string,
	input: CreateOrganizationDivisionInput,
) {
	return requestJson<{ division: OrganizationDivision }>(
		`/api/organizations/${slug}/admin/divisions`,
		{ method: "POST", body: JSON.stringify(input) },
		idToken,
	);
}

export function updateAdminDivision(
	idToken: string,
	slug: string,
	divisionId: string,
	input: UpdateOrganizationDivisionInput,
) {
	return requestJson<{ division: OrganizationDivision }>(
		`/api/organizations/${slug}/admin/divisions/${divisionId}`,
		{ method: "POST", body: JSON.stringify(input) },
		idToken,
	);
}

export function reorderAdminDivisions(
	idToken: string,
	slug: string,
	input: ReorderOrganizationDivisionsInput,
) {
	return requestJson<OrganizationDivisionListResponse>(
		`/api/organizations/${slug}/admin/divisions/reorder`,
		{ method: "POST", body: JSON.stringify(input) },
		idToken,
	);
}

export function getAdminTimezone(idToken: string, slug: string) {
	return requestJson<OrganizationTimezoneResponse>(
		`/api/organizations/${slug}/admin/timezone`,
		undefined,
		idToken,
	);
}

export function updateAdminTimezone(
	idToken: string,
	slug: string,
	input: UpdateOrganizationTimezoneInput,
) {
	return requestJson<OrganizationTimezoneResponse>(
		`/api/organizations/${slug}/admin/timezone`,
		{ method: "POST", body: JSON.stringify(input) },
		idToken,
	);
}

export function getAdminRegistrationConfiguration(
	idToken: string,
	slug: string,
) {
	return requestJson<{
		ageConfiguration: RegistrationAgeConfiguration | null;
		classSubtypes: RegistrationCatalogValue[];
		instruments: RegistrationCatalogValue[];
	}>(
		`/api/organizations/${slug}/admin/registration-configuration`,
		undefined,
		idToken,
	);
}

export function listFestivalClassSubtypes(
	idToken: string,
	slug: string,
	festivalSlug: string,
) {
	return requestJson<{ classSubtypes: RegistrationCatalogValue[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/class-subtypes`,
		undefined,
		idToken,
	);
}

export type PianoType = "upright" | "grand";

export interface RoomPianoConfiguration {
	pianoType: PianoType;
	count: number;
}

export interface Room {
	id: string;
	organizationId: string;
	festivalId: string;
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
	createdAtIso: string;
}

export interface CreateRoomInput {
	name: string;
	pianoConfigurations: RoomPianoConfiguration[];
}

export function listRooms(idToken: string, slug: string, festivalSlug: string) {
	return requestJson<{ rooms: Room[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/rooms`,
		undefined,
		idToken,
	);
}

export function createRoom(
	idToken: string,
	slug: string,
	festivalSlug: string,
	input: CreateRoomInput,
) {
	return requestJson<Room>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/rooms`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function createFestivalClassSubtype(
	idToken: string,
	slug: string,
	festivalSlug: string,
	displayName: string,
	requiredSubtypeId?: string | null,
) {
	return requestJson<{ value: RegistrationCatalogValue }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/class-subtypes`,
		{
			method: "POST",
			body: JSON.stringify({
				displayName,
				...(requiredSubtypeId !== undefined
					? { requiredSubtypeId: requiredSubtypeId || null }
					: {}),
			}),
		},
		idToken,
	);
}

export function updateAdminClassSubtype(
	idToken: string,
	slug: string,
	id: string,
	input: {
		displayName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	},
) {
	return requestJson<{ value: RegistrationCatalogValue }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/class-subtypes/${encodeURIComponent(id)}`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function updateAdminRegistrationAgeDate(
	idToken: string,
	slug: string,
	registrationAgeDate: string,
) {
	return requestJson<{ ageConfiguration: RegistrationAgeConfiguration }>(
		`/api/organizations/${slug}/admin/registration-age-date`,
		{
			method: "POST",
			body: JSON.stringify({ registrationAgeDate }),
		},
		idToken,
	);
}

export function getShopifySettings(idToken: string, slug: string) {
	return requestJson<ShopifyIntegrationSettingsResponse>(
		`/api/organizations/${slug}/admin/shopify`,
		undefined,
		idToken,
	);
}

export function saveShopifySettings(
	idToken: string,
	slug: string,
	input: SaveShopifyIntegrationInput,
) {
	return requestJson<SaveShopifyIntegrationResponse>(
		`/api/organizations/${slug}/admin/shopify`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function getVolunteerRoles(
	idToken: string,
	slug: string,
	festivalShortName: string,
) {
	return requestJson<VolunteerRole[]>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles`,
		undefined,
		idToken,
	);
}

export function createVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	input: CreateVolunteerRoleInput,
) {
	return requestJson<VolunteerRole>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function getVolunteerShiftsForRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
) {
	return requestJson<VolunteerShift[]>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}/shifts`,
		undefined,
		idToken,
	);
}

export function createVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	input: CreateVolunteerShiftInput,
) {
	return requestJson<VolunteerShift>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}/shifts`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function updateVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	input: UpdateVolunteerRoleInput,
) {
	return requestJson<VolunteerRole>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function deleteVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
) {
	return requestJson<{ status: string }>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}`,
		{
			method: "DELETE",
		},
		idToken,
	);
}

export function updateVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	shiftId: string,
	input: UpdateVolunteerShiftInput,
) {
	return requestJson<VolunteerShift>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}/shifts/${encodeURIComponent(shiftId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function deleteVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	shiftId: string,
) {
	return requestJson<{ status: string }>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/roles/${encodeURIComponent(roleId)}/shifts/${encodeURIComponent(shiftId)}`,
		{
			method: "DELETE",
		},
		idToken,
	);
}

export async function listVolunteerShifts(
	slug: string,
	festivalShortName: string,
	options?: { availableOnly?: boolean; idToken?: string },
): Promise<VolunteerShiftListing[]> {
	const token = await resolveAuthToken(options?.idToken);
	const query = options?.availableOnly ? "?available=true" : "";
	return requestJson<VolunteerShiftListing[]>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/shifts${query}`,
		undefined,
		token,
	);
}

export async function bookVolunteerShifts(
	slug: string,
	festivalShortName: string,
	shiftIds: string[],
	idToken?: string,
): Promise<BookShiftsOutcome> {
	const token = await resolveAuthToken(idToken);
	return requestJson<BookShiftsOutcome>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/book`,
		{
			method: "POST",
			body: JSON.stringify({ shiftIds }),
		},
		token,
	);
}

export async function getMyVolunteerSchedule(
	slug: string,
	festivalShortName: string,
	idToken?: string,
): Promise<VolunteerScheduleEntry[]> {
	const token = await resolveAuthToken(idToken);
	return requestJson<VolunteerScheduleEntry[]>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/my-schedule`,
		undefined,
		token,
	);
}

export async function cancelVolunteerAssignment(
	slug: string,
	festivalShortName: string,
	assignmentId: string,
	idToken?: string,
): Promise<VolunteerAssignment> {
	const token = await resolveAuthToken(idToken);
	return requestJson<VolunteerAssignment>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/assignments/${encodeURIComponent(assignmentId)}/cancel`,
		{
			method: "POST",
		},
		token,
	);
}

export async function getVolunteerCoverageGaps(
	slug: string,
	festivalShortName: string,
	idToken?: string,
): Promise<VolunteerCoverageGapsResponse> {
	const token = await resolveAuthToken(idToken);
	return requestJson<VolunteerCoverageGapsResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/coverage-gaps`,
		undefined,
		token,
	);
}

export async function enrollVolunteer(
	slug: string,
	festivalShortName: string,
	input: { name: string; phone: string },
	idToken?: string,
): Promise<VolunteerRecord> {
	const token = await resolveAuthToken(idToken);
	return requestJson<VolunteerRecord>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/volunteers/enroll`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export function runShopifyDiagnostics(idToken: string, slug: string) {
	return requestJson<ShopifyIntegrationDiagnosticsResponse>(
		`/api/organizations/${slug}/admin/shopify/diagnostics`,
		{ method: "POST" },
		idToken,
	);
}

export function listFestivalClasses(
	idToken: string,
	slug: string,
	festivalSlug: string,
): Promise<FestivalClassConfigurationDto[]> {
	return requestJson<FestivalClassConfigurationDto[]>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/classes`,
		undefined,
		idToken,
	);
}

export function createFestivalClass(
	idToken: string,
	slug: string,
	festivalSlug: string,
	input: CreateFestivalClassInput,
): Promise<FestivalClassConfigurationDto> {
	return requestJson<FestivalClassConfigurationDto>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/classes`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function updateFestivalClass(
	idToken: string,
	slug: string,
	festivalSlug: string,
	classId: string,
	input: UpdateFestivalClassInput,
): Promise<FestivalClassConfigurationDto> {
	return requestJson<FestivalClassConfigurationDto>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/festivals/${encodeURIComponent(festivalSlug)}/classes/${encodeURIComponent(classId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
		idToken,
	);
}

export function listRegistrationTeachers(
	slug: string,
	festivalSlug: string,
	childIdOrParams?: string | { childId?: string; divisionId?: string },
	divisionId?: string,
): Promise<{ teachers: RegistrationTeacherSummary[] }> {
	let childId = "";
	let divId = "";
	if (typeof childIdOrParams === "object" && childIdOrParams !== null) {
		childId = childIdOrParams.childId ?? "";
		divId = childIdOrParams.divisionId ?? "";
	} else if (typeof childIdOrParams === "string") {
		childId = childIdOrParams;
		divId = divisionId ?? "";
	}
	const searchParams = new URLSearchParams();
	if (childId) searchParams.set("childId", childId);
	if (divId) searchParams.set("divisionId", divId);
	const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
	return requestJson<{ teachers: RegistrationTeacherSummary[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/teachers${query}`,
		undefined,
		undefined,
		"",
	);
}

export function listRegistrationEligibleClasses(
	slug: string,
	festivalSlug: string,
	childIdOrParams?:
		| string
		| { childId?: string; divisionId?: string; teacherId?: string },
	divisionId?: string,
	teacherId?: string,
): Promise<{ classes: RegistrationEligibleClass[] }> {
	let childId = "";
	let divId = "";
	let tId = "";
	if (typeof childIdOrParams === "object" && childIdOrParams !== null) {
		childId = childIdOrParams.childId ?? "";
		divId = childIdOrParams.divisionId ?? "";
		tId = childIdOrParams.teacherId ?? "";
	} else if (typeof childIdOrParams === "string") {
		childId = childIdOrParams;
		divId = divisionId ?? "";
		tId = teacherId ?? "";
	}
	const searchParams = new URLSearchParams();
	if (childId) searchParams.set("childId", childId);
	if (divId) searchParams.set("divisionId", divId);
	if (tId) searchParams.set("teacherId", tId);
	const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
	return requestJson<{ classes: RegistrationEligibleClass[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/eligible-classes${query}`,
		undefined,
		undefined,
		"",
	);
}

export function listRegistrationAccompanists(
	slug: string,
	festivalSlug: string,
): Promise<{ accompanists: RegistrationAccompanistSummary[] }> {
	return requestJson<{ accompanists: RegistrationAccompanistSummary[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/accompanists`,
		undefined,
		undefined,
		"",
	);
}

export interface EvaluateRegistrationEligibilityInput {
	items: ProposedPurchaseLineItem[];
	csrfToken?: string;
}

export interface EvaluateRegistrationEligibilityResponse {
	results: ClassEligibilityResult[];
}

export function evaluateRegistrationEligibility(
	slug: string,
	festivalSlug: string,
	itemsOrInputOrCsrf:
		| ProposedPurchaseLineItem[]
		| EvaluateRegistrationEligibilityInput
		| string,
	itemsOrCsrf?: ProposedPurchaseLineItem[] | string,
): Promise<EvaluateRegistrationEligibilityResponse> {
	let items: ProposedPurchaseLineItem[] = [];
	let csrfToken = "";

	if (typeof itemsOrInputOrCsrf === "string") {
		csrfToken = itemsOrInputOrCsrf;
		if (Array.isArray(itemsOrCsrf)) {
			items = itemsOrCsrf;
		} else if (
			typeof itemsOrCsrf === "object" &&
			itemsOrCsrf !== null &&
			"items" in itemsOrCsrf
		) {
			items = (itemsOrCsrf as EvaluateRegistrationEligibilityInput).items;
		}
	} else if (Array.isArray(itemsOrInputOrCsrf)) {
		items = itemsOrInputOrCsrf;
		if (typeof itemsOrCsrf === "string") {
			csrfToken = itemsOrCsrf;
		}
	} else if (
		typeof itemsOrInputOrCsrf === "object" &&
		itemsOrInputOrCsrf !== null
	) {
		items = itemsOrInputOrCsrf.items ?? [];
		csrfToken =
			itemsOrInputOrCsrf.csrfToken ??
			(typeof itemsOrCsrf === "string" ? itemsOrCsrf : "");
	}

	const headers: Record<string, string> = {};
	if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

	return requestJson<EvaluateRegistrationEligibilityResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/eligibility`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ items }),
		},
		undefined,
		"",
	);
}

export interface StartClassCheckoutInput {
	festivalClassId?: string;
	childId?: string;
	teacherId?: string;
	pieces?: RepertoirePiece[];
	divisionId?: string;
	accompanistId?: string;
	festivalId?: string;
	festivalShortName?: string;
	currency?: string;
	currencyCode?: string;
	lineItems?: ProposedPurchaseLineItem[] | ClassCheckoutLineItemInput[];
	items?: ProposedPurchaseLineItem[] | ClassCheckoutLineItemInput[];
}

export interface StartClassCheckoutResponse {
	checkoutUrl: string;
	correlationId: string;
}

export function startClassCheckout(
	slug: string,
	festivalSlug: string,
	csrfTokenOrInput:
		| string
		| (StartClassCheckoutInput & {
				csrfToken?: string;
				idempotencyKey?: string;
		  }),
	inputOrToken?: string | StartClassCheckoutInput,
	idempotencyKeyOrInput?: string | StartClassCheckoutInput,
): Promise<StartClassCheckoutResponse> {
	let csrfToken = "";
	let idempotencyKey = "";
	let input: StartClassCheckoutInput = {} as StartClassCheckoutInput;

	if (typeof csrfTokenOrInput === "object" && csrfTokenOrInput !== null) {
		const { csrfToken: c, idempotencyKey: k, ...rest } = csrfTokenOrInput;
		csrfToken = (typeof inputOrToken === "string" ? inputOrToken : c) ?? "";
		idempotencyKey =
			(typeof idempotencyKeyOrInput === "string" ? idempotencyKeyOrInput : k) ??
			"";
		input = rest as StartClassCheckoutInput;
	} else if (typeof csrfTokenOrInput === "string") {
		csrfToken = csrfTokenOrInput;
		if (typeof inputOrToken === "string") {
			idempotencyKey = inputOrToken;
			input =
				(idempotencyKeyOrInput as StartClassCheckoutInput) ??
				({} as StartClassCheckoutInput);
		} else if (typeof inputOrToken === "object" && inputOrToken !== null) {
			input = inputOrToken as StartClassCheckoutInput;
			idempotencyKey =
				(typeof idempotencyKeyOrInput === "string"
					? idempotencyKeyOrInput
					: "") ?? "";
		}
	}
	if (!idempotencyKey && typeof crypto !== "undefined" && crypto.randomUUID) {
		idempotencyKey = crypto.randomUUID();
	}

	const headers: Record<string, string> = {};
	if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
	if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

	const payloadToSend = { ...input };
	delete (payloadToSend as Record<string, unknown>).csrfToken;
	delete (payloadToSend as Record<string, unknown>).idempotencyKey;

	if (
		"items" in (payloadToSend as Record<string, unknown>) &&
		!payloadToSend.lineItems
	) {
		payloadToSend.lineItems = (
			payloadToSend as unknown as { items: ProposedPurchaseLineItem[] }
		).items;
		delete (payloadToSend as Record<string, unknown>).items;
	}

	return requestJson<StartClassCheckoutResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/checkout`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(payloadToSend),
		},
		undefined,
		"",
	);
}

export interface CustomerClassRegistrationItem {
	entitlement: {
		id: string;
		status: string;
		orderId?: string;
		lineItemId?: string;
		createdAt?: string;
		updatedAt?: string;
		festivalId?: string;
		festivalSlug?: string;
		festivalShortName?: string;
		festivalClassId?: string;
		divisionId?: string;
		teacherId?: string;
		childId?: string;
		[key: string]: unknown;
	};
	festivalClass?: {
		id: string;
		displayName: string;
		price?: string;
		divisionId?: string;
		festivalSlug?: string;
		festivalShortName?: string;
		[key: string]: unknown;
	};
	child?: { id: string; name: string };
	metadata?: ClassRegistrationMetadata | null;
	festivalSlug?: string;
	festivalShortName?: string;
}

export interface CustomerClassRegistrationsResponse {
	registrations: CustomerClassRegistrationItem[];
}

export function listCustomerClassRegistrations(
	slug: string,
	festivalSlug?: string,
): Promise<CustomerClassRegistrationsResponse> {
	const path = festivalSlug
		? `/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/class-registrations`
		: `/api/organizations/${encodeURIComponent(slug)}/customer/class-registrations`;
	return requestJson<CustomerClassRegistrationsResponse>(
		path,
		undefined,
		undefined,
		"",
	);
}

export interface UpdateRegistrationMetadataInput {
	pieces?: RepertoirePiece[];
	accompanistId?: string | null;
	[key: string]: unknown;
}

export function updateRegistrationMetadata(
	slug: string,
	festivalSlug: string,
	registrationId: string,
	csrfTokenOrInput: string | UpdateRegistrationMetadataInput,
	inputOrCsrfToken?: UpdateRegistrationMetadataInput | string,
): Promise<{ metadata: ClassRegistrationMetadata }> {
	let csrfToken = "";
	let input: UpdateRegistrationMetadataInput = {};

	if (typeof csrfTokenOrInput === "string") {
		csrfToken = csrfTokenOrInput;
		input = (inputOrCsrfToken as UpdateRegistrationMetadataInput) ?? {};
	} else if (
		typeof csrfTokenOrInput === "object" &&
		csrfTokenOrInput !== null
	) {
		input = csrfTokenOrInput;
		csrfToken =
			(typeof inputOrCsrfToken === "string" ? inputOrCsrfToken : "") ?? "";
	}

	const headers: Record<string, string> = {};
	if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

	return requestJson<{ metadata: ClassRegistrationMetadata }>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/festivals/${encodeURIComponent(festivalSlug)}/registration/class-registrations/${encodeURIComponent(registrationId)}/metadata`,
		{
			method: "PATCH",
			headers,
			body: JSON.stringify(input),
		},
		undefined,
		"",
	);
}

export function dropCustomerRegistration(
	slug: string,
	registrationId: string,
	input?: Partial<DropRegistrationInput>,
): Promise<DropRegistrationResult> {
	return requestJson<DropRegistrationResult>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/class-registrations/${encodeURIComponent(registrationId)}/drop`,
		{
			method: "POST",
			body: JSON.stringify(input ?? {}),
		},
		undefined,
		"",
	);
}

export function transferCustomerRegistration(
	slug: string,
	registrationId: string,
	input:
		| TransferRegistrationInput
		| { targetFestivalClassId: string; reason?: string },
): Promise<TransferRegistrationResult> {
	return requestJson<TransferRegistrationResult>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/class-registrations/${encodeURIComponent(registrationId)}/transfer`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		undefined,
		"",
	);
}

export async function dropAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId?: Partial<DropRegistrationInput> | string,
	tokenOrInput?: string | Partial<DropRegistrationInput>,
): Promise<DropRegistrationResult> {
	let slug = slugOrToken;
	let festivalShortName = festivalOrSlug;
	let registrationId = regIdOrFestival;
	let input: Partial<DropRegistrationInput> = {};
	let idToken: string | undefined;

	if (typeof inputOrRegId === "string") {
		idToken = slugOrToken;
		slug = festivalOrSlug;
		festivalShortName = regIdOrFestival;
		registrationId = inputOrRegId;
		input = (
			typeof tokenOrInput === "object" && tokenOrInput !== null
				? tokenOrInput
				: {}
		) as Partial<DropRegistrationInput>;
	} else {
		if (typeof inputOrRegId === "object" && inputOrRegId !== null) {
			input = inputOrRegId;
		}
		if (typeof tokenOrInput === "string") {
			idToken = tokenOrInput;
		}
	}

	const token = await resolveAuthToken(idToken);
	return requestJson<DropRegistrationResult>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/registrations/${encodeURIComponent(registrationId)}/drop`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function transferAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId:
		| TransferRegistrationInput
		| { targetFestivalClassId: string; reason?: string }
		| string,
	tokenOrInput?:
		| string
		| TransferRegistrationInput
		| { targetFestivalClassId: string; reason?: string },
): Promise<TransferRegistrationResult> {
	let slug = slugOrToken;
	let festivalShortName = festivalOrSlug;
	let registrationId = regIdOrFestival;
	let input = (
		typeof inputOrRegId === "object" ? inputOrRegId : {}
	) as TransferRegistrationInput;
	let idToken: string | undefined;

	if (typeof inputOrRegId === "string") {
		idToken = slugOrToken;
		slug = festivalOrSlug;
		festivalShortName = regIdOrFestival;
		registrationId = inputOrRegId;
		input = (
			typeof tokenOrInput === "object" && tokenOrInput !== null
				? tokenOrInput
				: {}
		) as TransferRegistrationInput;
	} else if (typeof tokenOrInput === "string") {
		idToken = tokenOrInput;
	}

	const token = await resolveAuthToken(idToken);
	return requestJson<TransferRegistrationResult>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/registrations/${encodeURIComponent(registrationId)}/transfer`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function promoteAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId?: { reason?: string } | string,
	tokenOrInput?: string | { reason?: string },
): Promise<WaitlistPromotionResult> {
	let slug = slugOrToken;
	let festivalShortName = festivalOrSlug;
	let registrationId = regIdOrFestival;
	let input: { reason?: string } = {};
	let idToken: string | undefined;

	if (typeof inputOrRegId === "string") {
		idToken = slugOrToken;
		slug = festivalOrSlug;
		festivalShortName = regIdOrFestival;
		registrationId = inputOrRegId;
		input = (
			typeof tokenOrInput === "object" && tokenOrInput !== null
				? tokenOrInput
				: {}
		) as { reason?: string };
	} else {
		if (typeof inputOrRegId === "object" && inputOrRegId !== null) {
			input = inputOrRegId;
		}
		if (typeof tokenOrInput === "string") {
			idToken = tokenOrInput;
		}
	}

	const token = await resolveAuthToken(idToken);
	return requestJson<WaitlistPromotionResult>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/registrations/${encodeURIComponent(registrationId)}/promote`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function getRegistrationChangeLog(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	idToken?: string,
): Promise<{ changeLogs: RegistrationChangeLog[] }> {
	let slug = slugOrToken;
	let festivalShortName = festivalOrSlug;
	let registrationId = regIdOrFestival;
	let tokenToResolve = idToken;

	if (
		slugOrToken.includes(".") ||
		(idToken && regIdOrFestival.length > 0 && slugOrToken.length > 40)
	) {
		tokenToResolve = slugOrToken;
		slug = festivalOrSlug;
		festivalShortName = regIdOrFestival;
		registrationId = idToken ?? "";
	}

	const token = await resolveAuthToken(tokenToResolve);
	return requestJson<{ changeLogs: RegistrationChangeLog[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/festivals/${encodeURIComponent(festivalShortName)}/registrations/${encodeURIComponent(registrationId)}/change-log`,
		undefined,
		token,
	);
}

export interface NormalizeRepertoireReviewInput {
	normalizedTitle: string;
	normalizedComposer: string;
	imslpUrl?: string | null;
	notes?: string | null;
	status?: RepertoireReviewStatus;
	canonicalWorkId?: string | null;
	canonicalContributorId?: string | null;
	reviewItemId?: string;
}

export interface FlagRepertoireReviewInput {
	reason: RepertoireFlagReason | string;
	notes?: string | null;
	reviewItemId?: string;
}

export interface ResolveRepertoireFlagInput {
	flagId?: string;
	resolutionNotes?: string | null;
	notes?: string | null;
	status?: RepertoireReviewStatus;
	reviewItemId?: string;
}

export interface AddRepertoireCatalogWorkInput {
	title: string;
	composer: string;
	composerName?: string;
	imslpUrl?: string | null;
	organizationId?: string;
}

export async function listRepertoireReviewQueue(
	slug: string,
	filter?: RepertoireReviewQueueFilter & {
		claimedByUid?: string | null;
		flaggedOnly?: boolean;
		offset?: number;
		sync?: boolean;
	},
	idToken?: string,
): Promise<{
	items: RepertoireReviewItem[];
	summary: RepertoireReviewQueueSummary;
}> {
	const token = await resolveAuthToken(idToken);
	const params = new URLSearchParams();
	if (filter) {
		if (filter.status) {
			const status = Array.isArray(filter.status)
				? filter.status.join(",")
				: filter.status;
			if (status) params.set("status", status);
		}
		if (filter.claimedByUid) {
			params.set("claimedByUid", filter.claimedByUid);
		}
		if (filter.flaggedOnly !== undefined) {
			params.set("flaggedOnly", String(filter.flaggedOnly));
		} else if (filter.isFlagged !== undefined) {
			params.set("flaggedOnly", String(filter.isFlagged));
		}
		const search = filter.search ?? filter.searchQuery;
		if (search) {
			params.set("search", search);
		}
		if (typeof filter.limit === "number") {
			params.set("limit", String(filter.limit));
		}
		if (typeof filter.offset === "number") {
			params.set("offset", String(filter.offset));
		}
		if (filter.sync !== undefined) {
			params.set("sync", String(filter.sync));
		}
	}
	const queryString = params.toString();
	const query = queryString ? `?${queryString}` : "";
	return requestJson<{
		items: RepertoireReviewItem[];
		summary: RepertoireReviewQueueSummary;
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue${query}`,
		undefined,
		token,
	);
}

export async function claimRepertoireReview(
	slug: string,
	reviewId: string,
	options?: { reviewerName?: string; idToken?: string },
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(options?.idToken);
	return requestJson<{ item: RepertoireReviewItem }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue/${encodeURIComponent(reviewId)}/claim`,
		{
			method: "POST",
			body: JSON.stringify(
				options?.reviewerName ? { reviewerName: options.reviewerName } : {},
			),
		},
		token,
	);
}

export async function unclaimRepertoireReview(
	slug: string,
	reviewId: string,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ item: RepertoireReviewItem }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue/${encodeURIComponent(reviewId)}/unclaim`,
		{
			method: "POST",
		},
		token,
	);
}

export async function normalizeRepertoireReview(
	slug: string,
	reviewId: string,
	input: NormalizeRepertoireReviewInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ item: RepertoireReviewItem }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue/${encodeURIComponent(reviewId)}/normalize`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function flagRepertoireReview(
	slug: string,
	reviewId: string,
	input: FlagRepertoireReviewInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ item: RepertoireReviewItem }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue/${encodeURIComponent(reviewId)}/flag`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function resolveRepertoireFlag(
	slug: string,
	reviewId: string,
	input?: ResolveRepertoireFlagInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ item: RepertoireReviewItem }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/queue/${encodeURIComponent(reviewId)}/resolve-flag`,
		{
			method: "POST",
			body: JSON.stringify(input ?? {}),
		},
		token,
	);
}

export async function searchRepertoireCatalog(
	slug: string,
	query: string,
	options?: { limit?: number; idToken?: string },
): Promise<{ works: CanonicalWork[] }> {
	const token = await resolveAuthToken(options?.idToken);
	const params = new URLSearchParams({ q: query });
	if (typeof options?.limit === "number") {
		params.set("limit", String(options.limit));
	}
	return requestJson<{ works: CanonicalWork[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/catalog?${params.toString()}`,
		undefined,
		token,
	);
}

export async function addRepertoireCatalogWork(
	slug: string,
	input: AddRepertoireCatalogWorkInput,
	idToken?: string,
): Promise<{ work: CanonicalWork }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ work: CanonicalWork }>(
		`/api/organizations/${encodeURIComponent(slug)}/repertoire/catalog`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export interface CreateBillingAdjustmentPayload {
	organizationId?: string;
	customerId: string;
	adminUserId?: string;
	adjustmentType: BillingAdjustmentType;
	amountCents: number;
	currencyCode?: string;
	reason: string;
	referenceType?: string | null;
	referenceId?: string | null;
	approvedDecisionId?: string | null;
	notes?: string | null;
	entryType?: BillingLedgerEntryType;
	direction?: BillingLedgerDirection;
}

export async function listBillingMismatches(
	slug: string,
	idToken?: string,
): Promise<{ mismatches: BillingMismatchRecord[] }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ mismatches: BillingMismatchRecord[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/billing/mismatches`,
		undefined,
		token,
	);
}

export async function getCustomerCreditBalance(
	slug: string,
	customerId: string,
	idToken?: string,
): Promise<{ creditBalance: CreditBalance }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ creditBalance: CreditBalance }>(
		`/api/organizations/${encodeURIComponent(slug)}/billing/customers/${encodeURIComponent(customerId)}/credit-balance`,
		undefined,
		token,
	);
}

export async function getCustomerBillingLedger(
	slug: string,
	customerId: string,
	idToken?: string,
): Promise<{
	ledger: BillingLedgerEntry[];
	ledgerEntries: BillingLedgerEntry[];
}> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{
		ledger: BillingLedgerEntry[];
		ledgerEntries: BillingLedgerEntry[];
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/billing/customers/${encodeURIComponent(customerId)}/ledger`,
		undefined,
		token,
	);
}

export async function listBillingAdjustments(
	slug: string,
	customerId?: string,
	idToken?: string,
): Promise<{ adjustments: BillingAdjustment[] }> {
	const token = await resolveAuthToken(idToken);
	const query = customerId
		? `?customerId=${encodeURIComponent(customerId)}`
		: "";
	return requestJson<{ adjustments: BillingAdjustment[] }>(
		`/api/organizations/${encodeURIComponent(slug)}/billing/adjustments${query}`,
		undefined,
		token,
	);
}

export async function createBillingAdjustment(
	slug: string,
	input: CreateBillingAdjustmentPayload,
	idToken?: string,
): Promise<{
	adjustment: BillingAdjustment;
	ledgerEntry: BillingLedgerEntry;
	creditBalance: CreditBalance;
	alreadyExisted?: boolean;
}> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{
		adjustment: BillingAdjustment;
		ledgerEntry: BillingLedgerEntry;
		creditBalance: CreditBalance;
		alreadyExisted?: boolean;
	}>(
		`/api/organizations/${encodeURIComponent(slug)}/billing/adjustments`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export interface TriggerEventResult {
	status: MessageDeliveryStatus;
	success: boolean;
	event: MessageEvent;
	log?: MessageLog;
	error?: string;
	duplicate?: boolean;
}

export async function listCommunicationTemplates(
	slug: string,
	filters?: { channel?: MessageChannel; isActive?: boolean },
	idToken?: string,
): Promise<MessageTemplate[]> {
	const token = await resolveAuthToken(idToken);
	const params = new URLSearchParams();
	if (filters?.channel) params.set("channel", filters.channel);
	if (typeof filters?.isActive === "boolean") {
		params.set("isActive", String(filters.isActive));
	}
	const query = params.toString() ? `?${params.toString()}` : "";
	return requestJson<MessageTemplate[]>(
		`/api/organizations/${encodeURIComponent(slug)}/communication/templates${query}`,
		undefined,
		token,
	);
}

export async function createCommunicationTemplate(
	slug: string,
	input: CreateMessageTemplateInput,
	idToken?: string,
): Promise<MessageTemplate> {
	const token = await resolveAuthToken(idToken);
	return requestJson<MessageTemplate>(
		`/api/organizations/${encodeURIComponent(slug)}/communication/templates`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function updateCommunicationTemplate(
	slug: string,
	templateId: string,
	input: UpdateMessageTemplateInput,
	idToken?: string,
): Promise<MessageTemplate> {
	const token = await resolveAuthToken(idToken);
	return requestJson<MessageTemplate>(
		`/api/organizations/${encodeURIComponent(slug)}/communication/templates/${encodeURIComponent(templateId)}`,
		{
			method: "PATCH",
			body: JSON.stringify(input),
		},
		token,
	);
}

export async function listCommunicationLogs(
	slug: string,
	filters?: {
		channel?: MessageChannel;
		status?: MessageLogStatus;
		eventId?: string;
		limit?: number;
		offset?: number;
	},
	idToken?: string,
): Promise<MessageLog[]> {
	const token = await resolveAuthToken(idToken);
	const params = new URLSearchParams();
	if (filters?.channel) params.set("channel", filters.channel);
	if (filters?.status) params.set("status", filters.status);
	if (filters?.eventId) params.set("eventId", filters.eventId);
	if (typeof filters?.limit === "number") {
		params.set("limit", String(filters.limit));
	}
	if (typeof filters?.offset === "number") {
		params.set("offset", String(filters.offset));
	}
	const query = params.toString() ? `?${params.toString()}` : "";
	return requestJson<MessageLog[]>(
		`/api/organizations/${encodeURIComponent(slug)}/communication/logs${query}`,
		undefined,
		token,
	);
}

export async function triggerCommunicationEvent(
	slug: string,
	input: TriggerMessageEventInput,
	idToken?: string,
): Promise<TriggerEventResult> {
	const token = await resolveAuthToken(idToken);
	return requestJson<TriggerEventResult>(
		`/api/organizations/${encodeURIComponent(slug)}/communication/events`,
		{
			method: "POST",
			body: JSON.stringify(input),
		},
		token,
	);
}

export interface AdminCheckoutIntent {
	id: string;
	correlationId: string;
	organizationId: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	intentType: string;
	offeringId: string | null;
	entitlementClass: string | null;
	durationDays: number | null;
	festivalClassId: string | null;
	childId: string | null;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	policyVersion: string | null;
	divisionId: string | null;
	divisionNameSnapshot: string | null;
	staffAccessConsent: boolean;
	amount: string;
	currencyCode: string;
	cartReference: string | null;
	status: string;
	expiresAtIso: string;
	createdAtIso: string;
}

export interface AdminCheckoutIntentListResponse {
	intents: AdminCheckoutIntent[];
}

export interface RecoveryReviewDto {
	recoveryRequest: {
		id: string;
		status:
			| "pending"
			| "consumed"
			| "expired"
			| "cancelled"
			| "invalidated"
			| string;
		expiresAtIso: string;
		createdAtIso: string;
	};
	sourceIntent: AdminCheckoutIntent;
	offering: {
		id: string;
		name: string;
		available: boolean;
		price: {
			amount: string;
			currencyCode: string;
		};
	} | null;
	division: {
		id: string;
		displayName: string;
	} | null;
}

export interface RecoveryCheckoutResult {
	checkoutUrl: string;
}

export interface AdminCheckoutRecoveryResult {
	recoveryUrl: string;
	rawToken: string;
	tokenHash: string;
	recoveryRequest: unknown;
}

export async function searchAdminCustomers(
	slug: string,
	query: string,
	idToken?: string,
): Promise<AdminCustomerSearchResponse> {
	const token = await resolveAuthToken(idToken);
	const params = new URLSearchParams({ query });
	return requestJson<AdminCustomerSearchResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/customers?${params.toString()}`,
		undefined,
		token,
	);
}

export async function getAdminCustomerCheckoutIntents(
	slug: string,
	customerId: string,
	idToken?: string,
): Promise<AdminCheckoutIntentListResponse> {
	const token = await resolveAuthToken(idToken);
	return requestJson<AdminCheckoutIntentListResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/customers/${encodeURIComponent(customerId)}/checkout-intents`,
		undefined,
		token,
	);
}

export async function invalidateAdminCheckoutIntent(
	slug: string,
	intentId: string,
	idToken?: string,
	reason?: string,
): Promise<{ success: boolean; intentId: string }> {
	const token = await resolveAuthToken(idToken);
	return requestJson<{ success: boolean; intentId: string }>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/checkout-intents/${encodeURIComponent(intentId)}/invalidate`,
		{
			method: "POST",
			headers: {
				"X-CSRF-Token": token || "admin-csrf",
			},
			body: JSON.stringify(reason ? { reason } : {}),
		},
		token,
	);
}

export async function recoverAdminCheckoutIntent(
	slug: string,
	intentId: string,
	idToken?: string,
	options?: { customerId?: string; expiresInHours?: number },
): Promise<AdminCheckoutRecoveryResult> {
	const token = await resolveAuthToken(idToken);
	return requestJson<AdminCheckoutRecoveryResult>(
		`/api/organizations/${encodeURIComponent(slug)}/admin/checkout-intents/${encodeURIComponent(intentId)}/recover`,
		{
			method: "POST",
			headers: {
				"X-CSRF-Token": token || "admin-csrf",
			},
			body: JSON.stringify(options ?? {}),
		},
		token,
	);
}

export async function getCustomerCheckoutRecoveryReview(
	slug: string,
	token: string,
): Promise<RecoveryReviewDto> {
	return requestJson<RecoveryReviewDto>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/checkout-recovery/${encodeURIComponent(token)}`,
		undefined,
		undefined,
		"",
	);
}

export async function resumeCustomerCheckoutRecovery(
	slug: string,
	token: string,
	csrfToken?: string,
): Promise<RecoveryCheckoutResult> {
	const headers: Record<string, string> = {};
	if (csrfToken) {
		headers["X-CSRF-Token"] = csrfToken;
	}
	return requestJson<RecoveryCheckoutResult>(
		`/api/organizations/${encodeURIComponent(slug)}/customer/checkout-recovery/${encodeURIComponent(token)}/checkout`,
		{
			method: "POST",
			headers,
		},
		undefined,
		"",
	);
}

export function customerCheckoutRecoverySignInPath(
	slug: string,
	token: string,
): string {
	const returnTo = buildOrgCheckoutRecoveryPath(slug, token);
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}
