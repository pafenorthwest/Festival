import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateFestivalResponse,
	CreateInviteInput,
	CreateInviteResponse,
	CreateOrganizationDivisionInput,
	CreateOrganizationInput,
	CreateOrganizationResponse,
	DismissWelcomeResponse,
	FestivalSummary,
	InviteSummary,
	OrganizationAdminUsersResponse,
	OrganizationDivision,
	OrganizationDivisionListResponse,
	OrganizationFestivalListResponse,
	OrganizationLandingResponse,
	OrganizationTimezoneResponse,
	ReorderOrganizationDivisionsInput,
	SaveShopifyIntegrationInput,
	SaveShopifyIntegrationResponse,
	ShopifyIntegrationDiagnosticsResponse,
	ShopifyIntegrationSettingsResponse,
	StaffMembershipRosterEntry,
	UpdateFestivalRegistrationWindowInput,
	UpdateOrganizationDivisionInput,
	UpdateOrganizationTimezoneInput,
} from "@festival/common";
import { hc } from "hono/client";
import type {
	CatalogRoutesType,
	CommerceRoutesType,
	OrgAdminRoutesType,
} from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	resolveAuthToken,
	rpcCall,
	unwrapRpcResponse,
} from "./client.js";

export type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateFestivalResponse,
	CreateInviteInput,
	CreateInviteResponse,
	CreateOrganizationDivisionInput,
	CreateOrganizationInput,
	CreateOrganizationResponse,
	DismissWelcomeResponse,
	FestivalSummary,
	InviteSummary,
	OrganizationAdminUsersResponse,
	OrganizationDivision,
	OrganizationDivisionListResponse,
	OrganizationFestivalListResponse,
	OrganizationLandingResponse,
	OrganizationTimezoneResponse,
	ReorderOrganizationDivisionsInput,
	SaveShopifyIntegrationInput,
	SaveShopifyIntegrationResponse,
	ShopifyIntegrationDiagnosticsResponse,
	ShopifyIntegrationSettingsResponse,
	StaffMembershipRosterEntry,
	UpdateFestivalRegistrationWindowInput,
	UpdateOrganizationDivisionInput,
	UpdateOrganizationTimezoneInput,
} from "@festival/common";

export type AccompanistPolicyValue =
	| "exactly_one"
	| "one_to_two"
	| "one_to_all";

type AcceptInviteResponse = {
	organization: OrganizationLandingResponse["organization"];
	membership: OrganizationLandingResponse["membership"];
};

function orgAdminClient(idToken?: string | null) {
	return hc<OrgAdminRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken }),
	});
}

const orgScope = (idToken?: string | null) =>
	orgAdminClient(idToken).organizations[":slug"];
const slugParam = (slug: string) => ({ slug: encodeURIComponent(slug) });
const festParam = (slug: string, festivalShortName: string) => ({
	slug: encodeURIComponent(slug),
	festivalShortName: encodeURIComponent(festivalShortName),
});

export function createOrganization(
	idToken: string,
	input: CreateOrganizationInput,
): Promise<CreateOrganizationResponse> {
	const endpoint = orgAdminClient(idToken).organizations;
	return rpcCall(endpoint.$post({ json: input }), endpoint.$path());
}

export function createInvite(
	idToken: string,
	input: CreateInviteInput,
): Promise<CreateInviteResponse> {
	const endpoint = orgAdminClient(idToken).invites;
	return rpcCall(endpoint.$post({ json: input }), endpoint.$path());
}

export function getInvite(token: string): Promise<{ invite: InviteSummary }> {
	const param = { token: encodeURIComponent(token) };
	const endpoint = orgAdminClient().invites[":token"];
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function acceptInvite(
	idToken: string,
	token: string,
	input: AcceptInviteInput,
): Promise<AcceptInviteResponse> {
	const param = { token: encodeURIComponent(token) };
	const endpoint = orgAdminClient(idToken).invites[":token"].accept;
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function getOrganization(
	idToken: string,
	slug: string,
): Promise<OrganizationLandingResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function dismissWelcome(
	idToken: string,
	slug: string,
): Promise<DismissWelcomeResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).welcome.dismiss;
	return rpcCall(endpoint.$post({ param }), endpoint.$path({ param }));
}

export function getAdminUsers(
	idToken: string,
	slug: string,
): Promise<OrganizationAdminUsersResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.users;
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function deleteAdminMembership(
	idToken: string,
	slug: string,
	membershipId: string,
): Promise<{ deleted: boolean }> {
	const param = {
		...slugParam(slug),
		membershipId: encodeURIComponent(membershipId),
	};
	const endpoint = orgScope(idToken).admin.memberships[":membershipId"];
	return rpcCall(endpoint.$delete({ param }), endpoint.$path({ param }));
}

export function cancelAdminInvite(
	idToken: string,
	slug: string,
	inviteId: string,
): Promise<{ cancelled: boolean }> {
	const param = { ...slugParam(slug), inviteId: encodeURIComponent(inviteId) };
	const endpoint = orgScope(idToken).admin.invites[":inviteId"];
	return rpcCall(endpoint.$delete({ param }), endpoint.$path({ param }));
}

export function getFestivals(
	idToken: string,
	slug: string,
): Promise<OrganizationFestivalListResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.festivals;
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function createFestival(
	idToken: string,
	slug: string,
	input: CreateFestivalInput,
): Promise<CreateFestivalResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.festivals;
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function setPrimaryFestival(
	idToken: string,
	slug: string,
	festivalShortName: string,
): Promise<CreateFestivalResponse> {
	const param = festParam(slug, festivalShortName);
	const endpoint =
		orgScope(idToken).admin.festivals[":festivalShortName"].primary;
	return rpcCall(endpoint.$post({ param }), endpoint.$path({ param }));
}

export function updateFestivalRegistrationWindow(
	idToken: string,
	slug: string,
	festivalShortName: string,
	input: UpdateFestivalRegistrationWindowInput,
): Promise<CreateFestivalResponse> {
	const param = festParam(slug, festivalShortName);
	const endpoint =
		orgScope(idToken).admin.festivals[":festivalShortName"][
			"registration-window"
		];
	return rpcCall(
		endpoint.$put({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function getAdminFestival(
	idToken: string,
	slug: string,
	festivalShortName: string,
): Promise<{ festival: FestivalSummary }> {
	const param = festParam(slug, festivalShortName);
	const endpoint = orgScope(idToken).admin.festivals[":festivalShortName"];
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export async function getAdminDivisions(
	idToken: string,
	slug: string,
): Promise<OrganizationDivisionListResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.divisions;
	return unwrapRpcResponse(
		await endpoint.$get({ param }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
}

export const listDivisions = getAdminDivisions;

export async function createAdminDivision(
	idToken: string,
	slug: string,
	input: CreateOrganizationDivisionInput,
): Promise<{ division: OrganizationDivision }> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.divisions;
	return unwrapRpcResponse(
		await endpoint.$post({ param, json: input }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
}

export async function updateAdminDivision(
	idToken: string,
	slug: string,
	divisionId: string,
	input: UpdateOrganizationDivisionInput,
): Promise<{ division: OrganizationDivision }> {
	const param = {
		...slugParam(slug),
		divisionId: encodeURIComponent(divisionId),
	};
	const endpoint = orgScope(idToken).admin.divisions[":divisionId"];
	return unwrapRpcResponse(
		await endpoint.$post({ param, json: input }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
}

export async function reorderAdminDivisions(
	idToken: string,
	slug: string,
	input: ReorderOrganizationDivisionsInput,
): Promise<OrganizationDivisionListResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.divisions.reorder;
	return unwrapRpcResponse(
		await endpoint.$post({ param, json: input }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
}

export async function getAdminTimezone(
	idToken: string,
	slug: string,
): Promise<OrganizationTimezoneResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.timezone;
	return unwrapRpcResponse(
		await endpoint.$get({ param }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
}

export async function updateAdminTimezone(
	idToken: string,
	slug: string,
	input: UpdateOrganizationTimezoneInput,
): Promise<OrganizationTimezoneResponse> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).admin.timezone;
	return unwrapRpcResponse(
		await endpoint.$post({ param, json: input }),
		`${apiPrefix(true)}${endpoint.$path({ param })}`,
	);
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
	const slug = maybeSlug ?? idTokenOrSlug;
	const idToken =
		maybeSlug === undefined
			? await resolveAuthToken(undefined)
			: await resolveAuthToken(idTokenOrSlug);
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).staff.accompanists;
	const response = await rpcCall<{
		roster?: StaffMembershipRosterEntry[];
		accompanists?: StaffMembershipRosterEntry[];
	}>(
		endpoint.$get({ param }),
		orgScope(idToken).staff.accompanists.$path({ param }),
	);
	return response.roster ?? response.accompanists ?? [];
}

export const listAccompanists = listStaffRoster;

export function getStaffAccompanists(
	idToken: string,
	slug: string,
): Promise<{
	accompanists: StaffMembershipRosterEntry[];
	roster: StaffMembershipRosterEntry[];
}> {
	const param = slugParam(slug);
	const endpoint = orgScope(idToken).staff.accompanists;
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

function catalogOrg(idToken?: string | null) {
	return hc<CatalogRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken }),
	}).organizations[":slug"];
}

export function getAdminAccompanistPolicy(
	idToken: string,
	slug: string,
): Promise<{ policy: { policy: AccompanistPolicyValue } }> {
	const param = slugParam(slug);
	const endpoint = catalogOrg(idToken).admin["accompanist-policy"];
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function saveAdminAccompanistPolicy(
	idToken: string,
	slug: string,
	policy: AccompanistPolicyValue,
): Promise<{ policy: { policy: AccompanistPolicyValue } }> {
	const param = slugParam(slug);
	const endpoint = catalogOrg(idToken).admin["accompanist-policy"];
	return rpcCall(
		endpoint.$post({ param, json: { policy } }),
		endpoint.$path({ param }),
	);
}

function commerceOrg(idToken?: string | null) {
	return hc<CommerceRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken }),
	}).organizations[":slug"];
}

export function getShopifySettings(
	idToken: string,
	slug: string,
): Promise<ShopifyIntegrationSettingsResponse> {
	const param = slugParam(slug);
	const endpoint = commerceOrg(idToken).admin.shopify;
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function saveShopifySettings(
	idToken: string,
	slug: string,
	input: SaveShopifyIntegrationInput,
): Promise<SaveShopifyIntegrationResponse> {
	const param = slugParam(slug);
	const endpoint = commerceOrg(idToken).admin.shopify;
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function runShopifyDiagnostics(
	idToken: string,
	slug: string,
): Promise<ShopifyIntegrationDiagnosticsResponse> {
	const param = slugParam(slug);
	const endpoint = commerceOrg(idToken).admin.shopify.diagnostics;
	return rpcCall(endpoint.$post({ param }), endpoint.$path({ param }));
}
