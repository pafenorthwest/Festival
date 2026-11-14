import type {
	AppUserResponse,
	LoginEventInput,
	LoginEventResponse,
	OrganizationMembershipListResponse,
	PublicOrganizationListResponse,
	SessionResponse,
} from "@festival/common";
import { hc } from "hono/client";
import type {
	AuthRoutesType,
	OrgAdminRoutesType,
} from "../../../../backend/dist/routes/api-router.js";
import {
	buildFestivalCartPath,
	buildFestivalRegistrationPath,
	buildOrgCheckoutRecoveryPath,
} from "../routes.js";
import { apiPrefix, createRpcFetch, rpcCall } from "./client.js";

function createOrgAdminClient(useApiBase = true, idToken?: string) {
	return hc<OrgAdminRoutesType>(apiPrefix(useApiBase), {
		fetch: createRpcFetch({ idToken }),
	});
}

function createAuthClient(useApiBase = true, idToken?: string) {
	return hc<AuthRoutesType>(`${apiPrefix(useApiBase)}/v1/auth`, {
		fetch: createRpcFetch({ idToken }),
	});
}

export function listPublicOrganizations(): Promise<PublicOrganizationListResponse> {
	const endpoint = createOrgAdminClient().organizations;
	return rpcCall(endpoint.$get(), `${apiPrefix(true)}${endpoint.$path()}`);
}

export async function getBootstrap(): Promise<SessionResponse> {
	const endpoint = createOrgAdminClient().bootstrap;
	return rpcCall(endpoint.$get(), `${apiPrefix(true)}${endpoint.$path()}`);
}

export async function getFirebaseSession(
	idToken: string,
): Promise<SessionResponse> {
	const endpoint = createOrgAdminClient(true, idToken)["firebase-session"];
	return rpcCall(endpoint.$get(), `${apiPrefix(true)}${endpoint.$path()}`);
}

export async function getMemberships(
	idToken: string,
): Promise<OrganizationMembershipListResponse> {
	const endpoint = createOrgAdminClient(true, idToken).memberships;
	return rpcCall(endpoint.$get(), `${apiPrefix(true)}${endpoint.$path()}`);
}

export async function syncAuthSession(
	idToken: string,
): Promise<AppUserResponse> {
	const endpoint = createAuthClient(true, idToken).sync;
	return rpcCall(
		endpoint.$post(),
		`${apiPrefix(true)}/v1/auth${endpoint.$path()}`,
	);
}

export async function recordLoginEvent(
	idToken: string,
	input: LoginEventInput,
): Promise<LoginEventResponse> {
	const endpoint = createAuthClient(true, idToken)["login-event"];
	return rpcCall(
		endpoint.$post({ json: input }),
		`${apiPrefix(true)}/v1/auth${endpoint.$path()}`,
	);
}

export async function getAuthMe(idToken: string): Promise<AppUserResponse> {
	const endpoint = createAuthClient(true, idToken).me;
	return rpcCall(
		endpoint.$get(),
		`${apiPrefix(true)}/v1/auth${endpoint.$path()}`,
	);
}

export function customerSignInPath(
	slug: string,
	checkoutReturn = false,
): string {
	const returnTo = `/org/${slug}/account/memberships${
		checkoutReturn ? "?checkout=processing" : ""
	}`;
	return `/api/organizations/${slug}/customer-auth/start?returnTo=${encodeURIComponent(
		returnTo,
	)}`;
}

export function customerMembershipPurchaseSignInPath(
	slug: string,
	offeringId: string,
): string {
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?offering=${encodeURIComponent(
		offeringId,
	)}`;
}

export function customerAccompanistMembershipSignInPath(slug: string): string {
	const encodedSlug = encodeURIComponent(slug);
	const returnTo = `/org/${encodedSlug}/accompanist-membership`;
	return `/api/organizations/${encodedSlug}/customer-auth/start?returnTo=${encodeURIComponent(
		returnTo,
	)}`;
}

export function customerLandingSignInPath(slug: string): string {
	const returnTo = `/org/${encodeURIComponent(slug)}`;
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?returnTo=${encodeURIComponent(
		returnTo,
	)}`;
}

export function customerFestivalRegistrationSignInPath(
	slug: string,
	festivalSlug: string,
	target: "register" | "cart" = "register",
): string {
	const encodedSlug = encodeURIComponent(slug);
	const encodedFestivalSlug = encodeURIComponent(festivalSlug);
	const returnTo =
		target === "cart"
			? buildFestivalCartPath(encodedSlug, encodedFestivalSlug)
			: buildFestivalRegistrationPath(encodedSlug, encodedFestivalSlug);
	return `/api/organizations/${encodedSlug}/customer-auth/start?returnTo=${encodeURIComponent(
		returnTo,
	)}`;
}

export function customerCheckoutRecoverySignInPath(
	slug: string,
	token: string,
): string {
	const returnTo = buildOrgCheckoutRecoveryPath(slug, token);
	return `/api/organizations/${encodeURIComponent(slug)}/customer-auth/start?returnTo=${encodeURIComponent(
		returnTo,
	)}`;
}
