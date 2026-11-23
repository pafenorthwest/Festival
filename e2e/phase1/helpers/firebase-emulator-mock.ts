import type { AuthenticatedUser } from "@festival/common";
import type { AuthVerifier } from "../../../packages/backend/src/auth/types.js";

export interface E2eStaffUser {
	uid: string;
	email: string;
	displayName: string;
}

export const DEFAULT_E2E_ADMIN_USER: E2eStaffUser = {
	uid: "seed-admin-pafe-1",
	email: "admin@pafe-northwest.example.org",
	displayName: "PAFE Admin",
};

const KNOWN_STAFF_USERS = new Map<string, E2eStaffUser>([
	[DEFAULT_E2E_ADMIN_USER.email.toLowerCase(), DEFAULT_E2E_ADMIN_USER],
	[
		"chair@pafe-northwest.example.org",
		{
			uid: "seed-chair-pafe-1",
			email: "chair@pafe-northwest.example.org",
			displayName: "Marcus Sterling",
		},
	],
]);

const PROJECT_ID = "festival-e2e";
const refreshTokens = new Map<string, E2eStaffUser>();

function toBase64Url(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function fromBase64Url(segment: string): Record<string, unknown> {
	const decoded = Buffer.from(segment, "base64url").toString("utf8");
	const parsed: unknown = JSON.parse(decoded);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Invalid JWT payload.");
	}
	return parsed as Record<string, unknown>;
}

export function resolveE2eStaffUser(emailRaw?: string): E2eStaffUser {
	const normalized = emailRaw?.trim().toLowerCase();
	if (!normalized) {
		return DEFAULT_E2E_ADMIN_USER;
	}
	const known = KNOWN_STAFF_USERS.get(normalized);
	if (known) {
		return known;
	}
	const slug = normalized.replace(/[^a-z0-9]+/g, "-").slice(0, 32);
	return {
		uid: `e2e-staff-${slug || "user"}`,
		email: normalized,
		displayName: "E2E Staff",
	};
}

export function mintE2eStaffJwt(
	user: E2eStaffUser = DEFAULT_E2E_ADMIN_USER,
): string {
	const nowSec = Math.floor(Date.now() / 1000);
	const header = { alg: "none", typ: "JWT" };
	const payload = {
		iss: `https://securetoken.google.com/${PROJECT_ID}`,
		aud: PROJECT_ID,
		auth_time: nowSec,
		user_id: user.uid,
		sub: user.uid,
		iat: nowSec,
		exp: nowSec + 3600,
		email: user.email,
		email_verified: true,
		name: user.displayName,
		firebase: {
			identities: { email: [user.email] },
			sign_in_provider: "emailLink",
		},
	};
	return `${toBase64Url(header)}.${toBase64Url(payload)}.e2e-sig`;
}

export function decodeE2eStaffJwt(token: string): AuthenticatedUser {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[0] || !parts[1]) {
		throw new Error("Invalid bearer token.");
	}
	const claims = fromBase64Url(parts[1]);
	const uid =
		typeof claims.sub === "string"
			? claims.sub
			: typeof claims.user_id === "string"
				? claims.user_id
				: "";
	const email = typeof claims.email === "string" ? claims.email : "";
	const displayName =
		typeof claims.name === "string" && claims.name.trim()
			? claims.name.trim()
			: DEFAULT_E2E_ADMIN_USER.displayName;
	if (!uid || !email) {
		throw new Error("Invalid bearer token claims.");
	}
	return { uid, email, displayName };
}

export function createE2eAuthVerifier(): AuthVerifier {
	return {
		async verify(token: string): Promise<AuthenticatedUser> {
			return decodeE2eStaffJwt(token);
		},
	};
}

function corsHeaders(req: Request): Headers {
	const origin = req.headers.get("origin") ?? "*";
	return new Headers({
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":
			req.headers.get("access-control-request-headers") ??
			"Content-Type, Authorization, X-Client-Version, X-Firebase-Client, X-Firebase-Gmpid",
		"Content-Type": "application/json",
	});
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: corsHeaders(req),
	});
}

async function parseRequestBody(req: Request): Promise<Record<string, string>> {
	const contentType = req.headers.get("content-type") ?? "";
	const raw = await req.text();
	if (!raw.trim()) return {};
	if (contentType.includes("application/x-www-form-urlencoded")) {
		const params = new URLSearchParams(raw);
		const result: Record<string, string> = {};
		for (const [key, value] of params.entries()) {
			result[key] = value;
		}
		return result;
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

function issueRefreshToken(user: E2eStaffUser): string {
	const token = `e2e-refresh-${user.uid}`;
	refreshTokens.set(token, user);
	return token;
}

export async function handleFirebaseEmulatorRequest(
	req: Request,
	subpath: string,
): Promise<Response | null> {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: corsHeaders(req) });
	}
	const normalized = subpath.replace(/^\/+/, "");

	if (normalized === "identitytoolkit.googleapis.com/v1/accounts:sendOobCode") {
		const body = await parseRequestBody(req);
		return jsonResponse(req, {
			kind: "identitytoolkit#GetOobConfirmationCodeResponse",
			email: body.email ?? DEFAULT_E2E_ADMIN_USER.email,
		});
	}

	if (
		normalized ===
		"identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink"
	) {
		const body = await parseRequestBody(req);
		const user = resolveE2eStaffUser(body.email);
		const idToken = mintE2eStaffJwt(user);
		const refreshToken = issueRefreshToken(user);
		return jsonResponse(req, {
			kind: "identitytoolkit#EmailLinkSigninResponse",
			localId: user.uid,
			email: user.email,
			displayName: user.displayName,
			idToken,
			refreshToken,
			expiresIn: "3600",
			isNewUser: false,
		});
	}

	if (normalized === "identitytoolkit.googleapis.com/v1/accounts:lookup") {
		const body = await parseRequestBody(req);
		let user = DEFAULT_E2E_ADMIN_USER;
		if (body.idToken) {
			try {
				const decoded = decodeE2eStaffJwt(body.idToken);
				user = {
					uid: decoded.uid,
					email: decoded.email,
					displayName: decoded.displayName,
				};
			} catch {
				// Fall back to default admin user
			}
		}
		return jsonResponse(req, {
			kind: "identitytoolkit#GetAccountInfoResponse",
			users: [
				{
					localId: user.uid,
					email: user.email,
					displayName: user.displayName,
					emailVerified: true,
					validSince: "1700000000",
					lastLoginAt: String(Date.now()),
					createdAt: "1700000000000",
					providerUserInfo: [
						{
							providerId: "password",
							email: user.email,
							displayName: user.displayName,
							rawId: user.email,
						},
					],
				},
			],
		});
	}

	if (normalized === "securetoken.googleapis.com/v1/token") {
		const body = await parseRequestBody(req);
		const tokenKey = body.refresh_token ?? body.refreshToken ?? "";
		const user = refreshTokens.get(tokenKey) ?? DEFAULT_E2E_ADMIN_USER;
		const idToken = mintE2eStaffJwt(user);
		const refreshToken = issueRefreshToken(user);
		return jsonResponse(req, {
			access_token: idToken,
			expires_in: "3600",
			token_type: "Bearer",
			refresh_token: refreshToken,
			id_token: idToken,
			user_id: user.uid,
			project_id: PROJECT_ID,
		});
	}

	return null;
}
