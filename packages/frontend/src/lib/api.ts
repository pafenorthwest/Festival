import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateFestivalResponse,
	CreateInviteInput,
	CreateInviteResponse,
	CreateMembershipProductInput,
	CreateMembershipProductResponse,
	CreateOrganizationDivisionInput,
	CreateOrganizationInput,
	CreateOrganizationResponse,
	CustomerAccountSettingsResponse,
	CustomerMembershipStatusResponse,
	CustomerOrdersResponse,
	CustomerProfileResponse,
	CustomerSessionResponse,
	DismissWelcomeResponse,
	InviteSummary,
	MembershipProductsListResponse,
	MembershipPurchaseSelectionResponse,
	OrganizationAdminUsersResponse,
	OrganizationDivision,
	OrganizationDivisionListResponse,
	OrganizationFestivalListResponse,
	OrganizationLandingResponse,
	OrganizationMembershipListResponse,
	OrganizationTimezoneResponse,
	PublicMembershipProductsListResponse,
	ReorderOrganizationDivisionsInput,
	SaveCustomerAccountSettingsInput,
	SaveCustomerAccountSettingsResponse,
	SaveShopifyIntegrationInput,
	SaveShopifyIntegrationResponse,
	SessionResponse,
	ShopifyIntegrationDiagnosticsResponse,
	ShopifyIntegrationSettingsResponse,
	UpdateCustomerProfileInput,
	UpdateOrganizationDivisionInput,
	UpdateOrganizationTimezoneInput,
} from "@festival/common";

const API_BASE = import.meta.env.FRONT_API_BASE ?? "";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
	}
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

export function customerSignInPath(slug: string) {
	const returnTo = `/org/${slug}/account`;
	return `/api/organizations/${slug}/customer-auth/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export function customerMembershipPurchaseSignInPath(
	slug: string,
	offeringId: string,
) {
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?offering=${encodeURIComponent(offeringId)}`;
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

export function getMembershipProducts(slug: string) {
	return requestJson<PublicMembershipProductsListResponse>(
		`/api/organizations/${slug}/membership-products`,
	);
}

export function getPublicDivisions(slug: string) {
	return requestJson<OrganizationDivisionListResponse>(
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

export function getAdminDivisions(idToken: string, slug: string) {
	return requestJson<OrganizationDivisionListResponse>(
		`/api/organizations/${slug}/admin/divisions`,
		undefined,
		idToken,
	);
}

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

export function runShopifyDiagnostics(idToken: string, slug: string) {
	return requestJson<ShopifyIntegrationDiagnosticsResponse>(
		`/api/organizations/${slug}/admin/shopify/diagnostics`,
		{ method: "POST" },
		idToken,
	);
}
