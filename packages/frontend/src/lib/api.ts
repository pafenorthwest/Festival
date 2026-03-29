import type {
	AcceptInviteInput,
	CreateInviteInput,
	CreateInviteResponse,
	CreateOrganizationInput,
	CreateOrganizationResponse,
	DismissWelcomeResponse,
	InviteSummary,
	OrganizationLandingResponse,
	SessionResponse,
} from "@festival/common";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function requestJson<T>(
	path: string,
	init?: RequestInit,
	idToken?: string | null,
): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
			...(init?.headers ?? {}),
		},
	});

	const payload = (await response.json()) as T | { error?: string };
	if (!response.ok) {
		throw new Error(
			(payload as { error?: string }).error ?? `Request failed for ${path}`,
		);
	}

	return payload as T;
}

export function getSession(idToken?: string | null) {
	return requestJson<SessionResponse>("/api/session", undefined, idToken);
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

export function dismissWelcome(idToken: string, slug: string) {
	return requestJson<DismissWelcomeResponse>(
		`/api/organizations/${slug}/welcome/dismiss`,
		{
			method: "POST",
		},
		idToken,
	);
}
