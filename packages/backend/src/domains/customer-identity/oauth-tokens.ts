import { createPublicKey, verify as verifySignature } from "node:crypto";
import { AppError } from "@festival/common";
import {
	type BoundedAsyncCache,
	type CustomerAccountTransport,
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	type ShopifySecretKeyring,
} from "../../infra/s10-infra.js";
import {
	type Discovery,
	isRecord,
	type JsonRecord,
	safeAuthError,
	transportJson,
} from "./oauth-discovery.js";
import type { CustomerAccountIntegrationRecord } from "./types.js";

export interface TokenBundle {
	accessToken: string;
	refreshToken: string;
	idToken: string;
	accessExpiresAtIso: string;
	refreshExpiresAtIso?: string;
	issuer: string;
}

interface TokenResponse {
	access_token?: unknown;
	refresh_token?: unknown;
	id_token?: unknown;
	expires_in?: unknown;
	refresh_token_expires_in?: unknown;
}

export interface TokenExchangeContext {
	transport: CustomerAccountTransport;
	keyring: ShopifySecretKeyring;
	now: () => Date;
	existingIdToken?: string;
}

export interface IdTokenVerifyContext {
	transport: CustomerAccountTransport;
	jwksCache: BoundedAsyncCache<string, readonly JsonRecord[]>;
	jwksTtlMs: number;
	now: () => Date;
}

function decodePart(value: string): JsonRecord {
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
}

function audienceIncludes(value: unknown, clientId: string): boolean {
	return (
		value === clientId || (Array.isArray(value) && value.includes(clientId))
	);
}

export async function exchangeOAuthTokens(
	integration: CustomerAccountIntegrationRecord,
	oidc: Discovery,
	body: URLSearchParams,
	ctx: TokenExchangeContext,
): Promise<TokenBundle> {
	const secret = ctx.keyring.decrypt(integration.encryptedClientSecret, {
		organizationId: integration.organizationId,
		purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	});
	const payload = await transportJson(
		ctx.transport,
		new URL(oidc.token_endpoint),
		integration.storefrontDomain,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Basic ${Buffer.from(`${integration.clientId}:${secret}`).toString("base64")}`,
			},
			body,
		},
	);
	const t = payload as TokenResponse;
	const idToken =
		typeof t.id_token === "string" ? t.id_token : ctx.existingIdToken;
	if (
		typeof t.access_token !== "string" ||
		typeof t.refresh_token !== "string" ||
		!idToken ||
		typeof t.expires_in !== "number" ||
		!Number.isFinite(t.expires_in) ||
		t.expires_in <= 0
	) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	const nowMs = ctx.now().getTime();
	return {
		accessToken: t.access_token,
		refreshToken: t.refresh_token,
		idToken,
		accessExpiresAtIso: new Date(nowMs + t.expires_in * 1000).toISOString(),
		refreshExpiresAtIso:
			typeof t.refresh_token_expires_in === "number" &&
			Number.isFinite(t.refresh_token_expires_in) &&
			t.refresh_token_expires_in > 0
				? new Date(nowMs + t.refresh_token_expires_in * 1000).toISOString()
				: undefined,
		issuer: oidc.issuer,
	};
}

async function loadSigningKeys(
	integration: CustomerAccountIntegrationRecord,
	discovery: Discovery,
	ctx: IdTokenVerifyContext,
	force = false,
): Promise<readonly JsonRecord[]> {
	const key = `${discovery.issuer}\0${discovery.jwks_uri}`;
	return ctx.jwksCache.getOrLoad(
		key,
		async () => {
			const payload = await transportJson(
				ctx.transport,
				new URL(discovery.jwks_uri),
				integration.storefrontDomain,
			);
			if (!Array.isArray(payload.keys)) throw safeAuthError();
			const value = payload.keys.filter(
				(candidate): candidate is JsonRecord =>
					isRecord(candidate) &&
					typeof candidate.kid === "string" &&
					candidate.kty === "RSA" &&
					(candidate.alg === undefined || candidate.alg === "RS256") &&
					(candidate.use === undefined || candidate.use === "sig"),
			);
			if (!value.length) throw safeAuthError();
			return {
				value,
				ttlMs: ctx.jwksTtlMs,
				bytes: Buffer.byteLength(JSON.stringify(value)),
			};
		},
		force,
	);
}

export async function verifyCustomerIdToken(
	token: string,
	integration: CustomerAccountIntegrationRecord,
	discovery: Discovery,
	ctx: IdTokenVerifyContext & { nonce?: string },
): Promise<JsonRecord> {
	const parts = token.split(".");
	const [encodedHeader, encodedClaims, encodedSignature] = parts;
	if (
		parts.length !== 3 ||
		!encodedHeader ||
		!encodedClaims ||
		!encodedSignature
	) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	const header = decodePart(encodedHeader);
	const claims = decodePart(encodedClaims);
	if (header.alg !== "RS256" || typeof header.kid !== "string") {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	let keys = await loadSigningKeys(integration, discovery, ctx);
	let jwk = keys.find((key) => key.kid === header.kid);
	if (!jwk) {
		keys = await loadSigningKeys(integration, discovery, ctx, true);
		jwk = keys.find((key) => key.kid === header.kid);
	}
	if (!jwk) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	let valid = false;
	try {
		valid = verifySignature(
			"RSA-SHA256",
			Buffer.from(`${encodedHeader}.${encodedClaims}`),
			createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }),
			Buffer.from(encodedSignature, "base64url"),
		);
	} catch {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	if (
		!valid ||
		claims.iss !== discovery.issuer ||
		!audienceIncludes(claims.aud, integration.clientId) ||
		typeof claims.exp !== "number" ||
		claims.exp * 1000 <= ctx.now().getTime() ||
		(ctx.nonce !== undefined && claims.nonce !== ctx.nonce)
	) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	return claims;
}

export function extractVerifiedShopifyEmail(
	claims: JsonRecord,
): string | undefined {
	if (claims.email_verified !== true || typeof claims.email !== "string") {
		return undefined;
	}
	const email = claims.email.trim().toLowerCase();
	return email || undefined;
}

export function decryptTokenBundle(
	keyring: ShopifySecretKeyring,
	organizationId: string,
	encryptedTokens: string,
): TokenBundle {
	try {
		return JSON.parse(
			keyring.decrypt(encryptedTokens, {
				organizationId,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
		) as TokenBundle;
	} catch {
		throw new AppError("Customer session is invalid.", 401);
	}
}
