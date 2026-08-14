import {
	createHash,
	createPublicKey,
	randomBytes,
	randomUUID,
	verify as verifySignature,
} from "node:crypto";
import type {
	CustomerAccountSettings,
	CustomerOrdersResponse,
	CustomerSessionResponse,
	SaveCustomerAccountSettingsResponse,
} from "@festival/common";
import {
	CUSTOMER_ACCOUNT_API_VERSION,
	validateCustomerAccountSettings,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	type ShopifySecretKeyring,
} from "../shopify/encryption.js";
import { BoundedAsyncCache, type CacheMetrics } from "./bounded-async-cache.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerAccountRepository,
	CustomerSessionRecord,
} from "./customer-account-repository.js";
import {
	CustomerAccountTransport,
	type CustomerAccountTransportOptions,
} from "./customer-account-transport.js";

const OAUTH_STATE_TTL_MS = 10 * 60_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_CACHE_ENTRY_BYTES = 256 * 1024;
const DEFAULT_DISCOVERY_CACHE_BYTES = 4 * 1024 * 1024;
const DEFAULT_JWKS_CACHE_BYTES = 8 * 1024 * 1024;
export const CUSTOMER_SESSION_COOKIE = "festival_customer_session";

interface Discovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	end_session_endpoint: string;
	jwks_uri: string;
	scopes_supported?: string[];
}
interface ApiDiscovery {
	graphql_api: string;
}
interface TokenBundle {
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
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function child(value: unknown, key: string): JsonRecord | undefined {
	return isRecord(value) && isRecord(value[key]) ? value[key] : undefined;
}

function randomOpaque(bytes = 32) {
	return randomBytes(bytes).toString("base64url");
}
function hash(value: string) {
	return createHash("sha256").update(value).digest("base64url");
}
function safeError() {
	return new AppError("Customer Account authentication is unavailable.", 503);
}
function decodePart(value: string): Record<string, unknown> {
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
}
function audienceIncludes(value: unknown, clientId: string) {
	return (
		value === clientId || (Array.isArray(value) && value.includes(clientId))
	);
}
function hasExplicitAuthorityPort(value: string) {
	const authority = /^https:\/\/([^/]+)/i.exec(value)?.[1] ?? "";
	const host = authority.includes("@")
		? (authority.split("@").at(-1) ?? "")
		: authority;
	return host.startsWith("[") || /:\d+$/.test(host);
}
function money(value: unknown) {
	if (
		!isRecord(value) ||
		typeof value.amount !== "string" ||
		typeof value.currencyCode !== "string"
	)
		throw safeError();
	return { amount: value.amount, currencyCode: value.currencyCode };
}

export interface CustomerAccountServiceOptions {
	publicOrigin: string;
	idleDays?: number;
	absoluteDays?: number;
	now?: () => Date;
	transport?: CustomerAccountTransport;
	transportOptions?: CustomerAccountTransportOptions;
	discoveryCacheMaxEntries?: number;
	discoveryCacheTtlMs?: number;
	discoveryCacheMaxTotalBytes?: number;
	jwksCacheMaxEntries?: number;
	jwksCacheTtlMs?: number;
	jwksCacheMaxTotalBytes?: number;
	cacheMaxEntryBytes?: number;
}

export class CustomerAccountService {
	private now: () => Date;
	private refreshes = new Map<string, Promise<CustomerSessionRecord>>();
	private publicOrigin: string;
	private idleMs: number;
	private absoluteMs: number;
	private transport: CustomerAccountTransport;
	private discoveryTtlMs: number;
	private jwksTtlMs: number;
	private discoveryCache: BoundedAsyncCache<
		string,
		{ oidc: Discovery; api: ApiDiscovery }
	>;
	private jwksCache: BoundedAsyncCache<string, readonly JsonRecord[]>;
	constructor(
		private repository: CustomerAccountRepository,
		private organizations: OrganizationRepository,
		private keyring: ShopifySecretKeyring,
		options: CustomerAccountServiceOptions,
	) {
		const origin = new URL(options.publicOrigin);
		if (
			!/^https:$/.test(origin.protocol) &&
			origin.hostname !== "localhost" &&
			origin.hostname !== "127.0.0.1"
		)
			throw new Error("FESTIVAL_PUBLIC_ORIGIN must use HTTPS.");
		this.publicOrigin = origin.origin;
		this.idleMs = (options.idleDays ?? 7) * 86_400_000;
		this.absoluteMs = (options.absoluteDays ?? 30) * 86_400_000;
		if (
			this.idleMs <= 0 ||
			this.absoluteMs <= 0 ||
			this.idleMs > this.absoluteMs
		)
			throw new Error("Customer session caps are invalid.");
		this.now = options.now ?? (() => new Date());
		this.transport =
			options.transport ??
			new CustomerAccountTransport(options.transportOptions);
		this.discoveryTtlMs = options.discoveryCacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.jwksTtlMs = options.jwksCacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		const maxEntryBytes =
			options.cacheMaxEntryBytes ?? DEFAULT_CACHE_ENTRY_BYTES;
		this.discoveryCache = new BoundedAsyncCache({
			maxEntries: options.discoveryCacheMaxEntries ?? 1_024,
			maxEntryBytes,
			maxTotalBytes:
				options.discoveryCacheMaxTotalBytes ?? DEFAULT_DISCOVERY_CACHE_BYTES,
			now: () => this.now().getTime(),
		});
		this.jwksCache = new BoundedAsyncCache({
			maxEntries: options.jwksCacheMaxEntries ?? 1_024,
			maxEntryBytes,
			maxTotalBytes: options.jwksCacheMaxTotalBytes ?? DEFAULT_JWKS_CACHE_BYTES,
			now: () => this.now().getTime(),
		});
	}
	private urls(slug: string) {
		return {
			callbackUrl: `${this.publicOrigin}/api/customer-auth/callback`,
			logoutUrl: `${this.publicOrigin}/org/${encodeURIComponent(slug)}/account`,
		};
	}
	private settings(
		record: CustomerAccountIntegrationRecord,
		slug: string,
	): CustomerAccountSettings {
		const urls = this.urls(slug);
		return {
			storefrontDomain: record.storefrontDomain,
			clientId: record.clientId,
			hasClientSecret: true,
			...urls,
			apiVersion: CUSTOMER_ACCOUNT_API_VERSION,
			readiness: record.readiness,
			canReadOrders: record.canReadOrders,
			integrationVersion: record.integrationVersion,
			verifiedAtIso: record.verifiedAtIso,
			lastError: record.lastError,
			updatedAtIso: record.updatedAtIso,
		};
	}
	async getSettings(organizationId: string, slug: string) {
		const record = await this.repository.getIntegration(organizationId);
		return { settings: record ? this.settings(record, slug) : null };
	}
	async saveAndVerify(
		organizationId: string,
		slug: string,
		input: unknown,
	): Promise<SaveCustomerAccountSettingsResponse> {
		const current = await this.repository.getIntegration(organizationId);
		const parsed = validateCustomerAccountSettings(
			input,
			!current || Boolean(isRecord(input) && input.clientSecret),
		);
		const secret =
			parsed.clientSecret ??
			(current
				? this.keyring.decrypt(current.encryptedClientSecret, {
						organizationId,
						purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
					})
				: undefined);
		if (!secret)
			throw new AppError("Customer Account client secret is required.", 400);
		const encrypted = this.keyring.encrypt(secret, {
			organizationId,
			purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
		});
		const saved = await this.repository.upsertIntegration({
			organizationId,
			storefrontDomain: parsed.storefrontDomain,
			clientId: parsed.clientId,
			encryptedClientSecret: encrypted,
		});
		this.discoveryCache.deleteWhere((key) =>
			key.startsWith(`${organizationId}\0`),
		);
		try {
			await this.discover(saved);
			const updated = await this.repository.setIntegrationReadiness(
				organizationId,
				{
					readiness: "ready",
					canReadOrders: false,
					verifiedAtIso: this.now().toISOString(),
				},
			);
			return { settings: this.settings(updated, slug) };
		} catch {
			const updated = await this.repository.setIntegrationReadiness(
				organizationId,
				{
					readiness: "failed",
					canReadOrders: false,
					lastError: "Customer Account discovery verification failed.",
				},
			);
			return { settings: this.settings(updated, slug) };
		}
	}
	private async json(
		url: URL,
		configuredDomain: string,
		init?: RequestInit,
	): Promise<JsonRecord> {
		try {
			return await this.transport.json(url, configuredDomain, {
				...init,
				headers: {
					"User-Agent": "Festival-Customer-BFF/1.0",
					...(init?.headers ?? {}),
				},
			});
		} catch {
			throw safeError();
		}
	}
	private async loadDiscovery(
		domain: string,
	): Promise<{ oidc: Discovery; api: ApiDiscovery }> {
		const [oidcCandidate, apiCandidate] = await Promise.all([
			this.json(
				new URL(`https://${domain}/.well-known/openid-configuration`),
				domain,
			),
			this.json(
				new URL(`https://${domain}/.well-known/customer-account-api`),
				domain,
			),
		]);
		for (const field of [
			"issuer",
			"authorization_endpoint",
			"token_endpoint",
			"end_session_endpoint",
			"jwks_uri",
		] as const)
			if (typeof oidcCandidate[field] !== "string") throw safeError();
		if (typeof apiCandidate.graphql_api !== "string") throw safeError();
		const oidc = oidcCandidate as unknown as Discovery;
		const api = apiCandidate as unknown as ApiDiscovery;
		for (const endpoint of [
			oidc.authorization_endpoint,
			oidc.token_endpoint,
			oidc.end_session_endpoint,
			oidc.jwks_uri,
			api.graphql_api,
		]) {
			if (hasExplicitAuthorityPort(endpoint)) throw safeError();
			this.transport.assertDestination(new URL(endpoint), domain);
		}
		const graph = new URL(api.graphql_api);
		if (
			!graph.pathname.includes(`/customer/api/${CUSTOMER_ACCOUNT_API_VERSION}/`)
		)
			throw safeError();
		const issuer = new URL(oidc.issuer);
		const issuerHost = issuer.hostname.toLowerCase();
		if (
			issuer.protocol !== "https:" ||
			issuer.username ||
			issuer.password ||
			issuer.port ||
			hasExplicitAuthorityPort(oidc.issuer) ||
			(issuerHost !== domain.toLowerCase() &&
				issuerHost !== "shopify.com" &&
				!issuerHost.endsWith(".shopify.com"))
		)
			throw safeError();
		return { oidc, api };
	}
	private async discover(integration: CustomerAccountIntegrationRecord) {
		const key = `${integration.organizationId}\0${integration.integrationVersion}\0${integration.storefrontDomain}`;
		try {
			return await this.discoveryCache.getOrLoad(key, async () => {
				const value = await this.loadDiscovery(integration.storefrontDomain);
				return {
					value,
					ttlMs: this.discoveryTtlMs,
					bytes: Buffer.byteLength(JSON.stringify(value)),
				};
			});
		} catch {
			throw safeError();
		}
	}
	async start(slug: string, returnTo?: string) {
		const organization = await this.organizations.findOrganizationBySlug(slug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const integration = await this.repository.getIntegration(organization.id);
		if (!integration || integration.readiness !== "ready") throw safeError();
		const expected = `/org/${slug}/account`;
		if (returnTo && returnTo !== expected)
			throw new AppError("Return target is invalid.", 400);
		const state = randomOpaque(),
			nonce = randomOpaque();
		await this.repository.putOAuthState({
			stateHash: hash(state),
			organizationId: organization.id,
			nonce,
			returnTo: expected,
			expiresAtIso: new Date(
				this.now().getTime() + OAUTH_STATE_TTL_MS,
			).toISOString(),
		});
		const { oidc } = await this.discover(integration);
		const url = new URL(oidc.authorization_endpoint);
		url.search = new URLSearchParams({
			scope: "openid email customer-account-api:full",
			client_id: integration.clientId,
			response_type: "code",
			redirect_uri: this.urls(slug).callbackUrl,
			state,
			nonce,
		}).toString();
		return url.toString();
	}
	private secret(integration: CustomerAccountIntegrationRecord) {
		return this.keyring.decrypt(integration.encryptedClientSecret, {
			organizationId: integration.organizationId,
			purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
		});
	}
	private async tokens(
		integration: CustomerAccountIntegrationRecord,
		oidc: Discovery,
		body: URLSearchParams,
		existingIdToken?: string,
	): Promise<TokenBundle> {
		const payload = await this.json(
			new URL(oidc.token_endpoint),
			integration.storefrontDomain,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Basic ${Buffer.from(`${integration.clientId}:${this.secret(integration)}`).toString("base64")}`,
				},
				body,
			},
		);
		const t = payload as TokenResponse;
		const idToken =
			typeof t.id_token === "string" ? t.id_token : existingIdToken;
		if (
			typeof t.access_token !== "string" ||
			typeof t.refresh_token !== "string" ||
			!idToken ||
			typeof t.expires_in !== "number" ||
			!Number.isFinite(t.expires_in) ||
			t.expires_in <= 0
		)
			throw new AppError("Customer authentication response is invalid.", 401);
		return {
			accessToken: t.access_token,
			refreshToken: t.refresh_token,
			idToken,
			accessExpiresAtIso: new Date(
				this.now().getTime() + t.expires_in * 1000,
			).toISOString(),
			refreshExpiresAtIso:
				typeof t.refresh_token_expires_in === "number" &&
				Number.isFinite(t.refresh_token_expires_in) &&
				t.refresh_token_expires_in > 0
					? new Date(
							this.now().getTime() + t.refresh_token_expires_in * 1000,
						).toISOString()
					: undefined,
			issuer: oidc.issuer,
		};
	}
	private async verifyIdToken(
		token: string,
		integration: CustomerAccountIntegrationRecord,
		discovery: Discovery,
		nonce?: string,
	) {
		const parts = token.split(".");
		if (parts.length !== 3)
			throw new AppError("Customer authentication response is invalid.", 401);
		const [encodedHeader, encodedClaims, encodedSignature] = parts;
		if (!encodedHeader || !encodedClaims || !encodedSignature)
			throw new AppError("Customer authentication response is invalid.", 401);
		const header = decodePart(encodedHeader),
			claims = decodePart(encodedClaims);
		if (header.alg !== "RS256" || typeof header.kid !== "string")
			throw new AppError("Customer authentication response is invalid.", 401);
		let keys = await this.signingKeys(integration, discovery);
		let jwk = keys.find((key) => key.kid === header.kid);
		if (!jwk) {
			keys = await this.signingKeys(integration, discovery, true);
			jwk = keys.find((key) => key.kid === header.kid);
		}
		if (!jwk)
			throw new AppError("Customer authentication response is invalid.", 401);
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
			claims.exp * 1000 <= this.now().getTime() ||
			(nonce !== undefined && claims.nonce !== nonce)
		)
			throw new AppError("Customer authentication response is invalid.", 401);
		return claims;
	}
	private async signingKeys(
		integration: CustomerAccountIntegrationRecord,
		discovery: Discovery,
		force = false,
	) {
		const key = `${discovery.issuer}\0${discovery.jwks_uri}`;
		return this.jwksCache.getOrLoad(
			key,
			async () => {
				const payload = await this.json(
					new URL(discovery.jwks_uri),
					integration.storefrontDomain,
				);
				if (!Array.isArray(payload.keys)) throw safeError();
				const value = payload.keys.filter(
					(candidate): candidate is JsonRecord =>
						isRecord(candidate) &&
						typeof candidate.kid === "string" &&
						candidate.kty === "RSA" &&
						(candidate.alg === undefined || candidate.alg === "RS256") &&
						(candidate.use === undefined || candidate.use === "sig"),
				);
				if (!value.length) throw safeError();
				return {
					value,
					ttlMs: this.jwksTtlMs,
					bytes: Buffer.byteLength(JSON.stringify(value)),
				};
			},
			force,
		);
	}
	cacheMetrics(): {
		dns: CacheMetrics;
		discovery: CacheMetrics;
		jwks: CacheMetrics;
	} {
		return {
			dns: this.transport.metrics(),
			discovery: this.discoveryCache.metrics(),
			jwks: this.jwksCache.metrics(),
		};
	}
	private async customerGid(
		integration: CustomerAccountIntegrationRecord,
		api: ApiDiscovery,
		accessToken: string,
	) {
		const result = await this.graphql(
			integration,
			api,
			accessToken,
			"query FestivalCustomerIdentity { customer { id } }",
		);
		const id = child(result.data, "customer")?.id;
		if (typeof id !== "string" || !id.startsWith("gid://shopify/Customer/"))
			throw safeError();
		return id;
	}
	private async graphql(
		integration: CustomerAccountIntegrationRecord,
		api: ApiDiscovery,
		accessToken: string,
		query: string,
		variables?: Record<string, unknown>,
	) {
		const result = await this.json(
			new URL(api.graphql_api),
			integration.storefrontDomain,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: accessToken,
				},
				body: JSON.stringify({ query, variables }),
			},
		);
		if (Array.isArray(result.errors) && result.errors.length)
			throw new AppError("Customer order access is unavailable.", 403);
		return result;
	}
	async callback(stateValue: string | undefined, code: string | undefined) {
		if (!stateValue || !code)
			throw new AppError("Customer authentication response is invalid.", 400);
		const state = await this.repository.consumeOAuthState(
			hash(stateValue),
			this.now().toISOString(),
		);
		if (!state)
			throw new AppError("Customer authentication response is invalid.", 400);
		const integration = await this.repository.getIntegration(
			state.organizationId,
		);
		if (!integration) throw safeError();
		const org = await this.organizations.findOrganizationBySlug(
			state.returnTo.split("/")[2] ?? "",
		);
		if (!org || org.id !== state.organizationId)
			throw new AppError("Customer authentication response is invalid.", 401);
		const discovered = await this.discover(integration);
		const bundle = await this.tokens(
			integration,
			discovered.oidc,
			new URLSearchParams({
				grant_type: "authorization_code",
				client_id: integration.clientId,
				redirect_uri: this.urls(org.slug).callbackUrl,
				code,
			}),
		);
		await this.verifyIdToken(
			bundle.idToken,
			integration,
			discovered.oidc,
			state.nonce,
		);
		const customerGid = await this.customerGid(
			integration,
			discovered.api,
			bundle.accessToken,
		);
		const now = this.now(),
			sessionId = randomUUID(),
			csrfToken = randomOpaque();
		const expiresAt = new Date(
			Math.min(
				now.getTime() + this.absoluteMs,
				bundle.refreshExpiresAtIso
					? new Date(bundle.refreshExpiresAtIso).getTime()
					: Number.POSITIVE_INFINITY,
			),
		);
		const encrypted = this.keyring.encrypt(JSON.stringify(bundle), {
			organizationId: org.id,
			purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
		});
		await this.repository.createSession({
			sessionId,
			organizationId: org.id,
			shopifyCustomerGid: customerGid,
			encryptedTokens: encrypted,
			csrfToken,
			integrationVersion: integration.integrationVersion,
			createdAtIso: now.toISOString(),
			lastSeenAtIso: now.toISOString(),
			expiresAtIso: expiresAt.toISOString(),
		});
		return {
			sessionId,
			returnTo: state.returnTo,
			maxAgeSeconds: Math.max(
				1,
				Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
			),
		};
	}
	private decrypt(session: CustomerSessionRecord): TokenBundle {
		try {
			return JSON.parse(
				this.keyring.decrypt(session.encryptedTokens, {
					organizationId: session.organizationId,
					purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
				}),
			);
		} catch {
			throw new AppError("Customer session is invalid.", 401);
		}
	}
	private async validSession(sessionId: string, organizationId: string) {
		const s = await this.repository.getSession(sessionId),
			now = this.now();
		if (s && s.organizationId !== organizationId) {
			throw new AppError("Customer session is invalid.", 401);
		}
		if (
			!s ||
			s.revokedAtIso ||
			new Date(s.expiresAtIso) <= now ||
			new Date(s.lastSeenAtIso).getTime() + this.idleMs <= now.getTime()
		) {
			if (s)
				await this.repository.revokeSession(s.sessionId, now.toISOString());
			throw new AppError("Customer session is invalid.", 401);
		}
		const integration = await this.repository.getIntegration(organizationId);
		if (
			!integration ||
			integration.integrationVersion !== s.integrationVersion
		) {
			await this.repository.revokeSession(s.sessionId, now.toISOString());
			throw new AppError("Customer session is invalid.", 401);
		}
		return { session: s, integration };
	}
	private sessionTouch(session: CustomerSessionRecord, seenAt: Date) {
		return {
			sessionId: session.sessionId,
			organizationId: session.organizationId,
			integrationVersion: session.integrationVersion,
			seenAtIso: seenAt.toISOString(),
			idleCutoffIso: new Date(seenAt.getTime() - this.idleMs).toISOString(),
		};
	}
	private async access(
		session: CustomerSessionRecord,
		integration: CustomerAccountIntegrationRecord,
	) {
		let bundle = this.decrypt(session);
		if (
			new Date(bundle.accessExpiresAtIso).getTime() >
			this.now().getTime() + 30_000
		)
			return { session, bundle };
		let pending = this.refreshes.get(session.sessionId);
		if (!pending) {
			pending = (async () => {
				const latest = await this.repository.getSession(session.sessionId);
				if (
					!latest ||
					latest.revokedAtIso ||
					latest.integrationVersion !== integration.integrationVersion
				)
					throw new AppError("Customer session is invalid.", 401);
				const current = this.decrypt(latest);
				if (
					new Date(current.accessExpiresAtIso).getTime() >
					this.now().getTime() + 30_000
				)
					return latest;
				const { oidc } = await this.discover(integration);
				try {
					if (oidc.issuer !== current.issuer)
						throw new AppError("Customer session is invalid.", 401);
					const next = await this.tokens(
						integration,
						oidc,
						new URLSearchParams({
							grant_type: "refresh_token",
							client_id: integration.clientId,
							refresh_token: current.refreshToken,
						}),
						current.idToken,
					);
					if (next.idToken !== current.idToken)
						await this.verifyIdToken(next.idToken, integration, oidc);
					const seenAt = this.now();
					const replacementEncryptedTokens = this.keyring.encrypt(
						JSON.stringify(next),
						{
							organizationId: latest.organizationId,
							purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
						},
					);
					const updated = await this.repository.replaceSessionTokens({
						...this.sessionTouch(latest, seenAt),
						expectedEncryptedTokens: latest.encryptedTokens,
						replacementEncryptedTokens,
						replacementExpiresAtIso:
							next.refreshExpiresAtIso ?? latest.expiresAtIso,
					});
					if (!updated) throw new AppError("Customer session is invalid.", 401);
					return updated;
				} catch {
					await this.repository.revokeSession(
						latest.sessionId,
						this.now().toISOString(),
					);
					throw new AppError("Customer session is invalid.", 401);
				}
			})().finally(() => this.refreshes.delete(session.sessionId));
			this.refreshes.set(session.sessionId, pending);
		}
		const updated = await pending;
		bundle = this.decrypt(updated);
		return { session: updated, bundle };
	}
	async session(
		slug: string,
		sessionId?: string,
	): Promise<CustomerSessionResponse> {
		const org = await this.organizations.findOrganizationBySlug(slug);
		if (!org || !sessionId) return { session: { authenticated: false } };
		try {
			const { session } = await this.validSession(sessionId, org.id);
			const touched = await this.repository.touchSession(
				this.sessionTouch(session, this.now()),
			);
			if (!touched) throw new AppError("Customer session is invalid.", 401);
			return {
				session: {
					authenticated: true,
					csrfToken: touched.csrfToken,
					expiresAtIso: touched.expiresAtIso,
				},
			};
		} catch (error) {
			if (!(error instanceof AppError) || error.status !== 401) throw error;
			return { session: { authenticated: false } };
		}
	}
	async orders(
		slug: string,
		sessionId: string | undefined,
		after?: string,
	): Promise<CustomerOrdersResponse> {
		const org = await this.organizations.findOrganizationBySlug(slug);
		if (!org || !sessionId)
			throw new AppError("Customer session is invalid.", 401);
		const valid = await this.validSession(sessionId, org.id);
		const { session, bundle } = await this.access(
			valid.session,
			valid.integration,
		);
		const { api, oidc } = await this.discover(valid.integration);
		if (oidc.issuer !== bundle.issuer) {
			await this.repository.revokeSession(
				session.sessionId,
				this.now().toISOString(),
			);
			throw new AppError("Customer session is invalid.", 401);
		}
		const query = `query FestivalOrders($after: String) { customer { orders(first: 20, after: $after) { nodes { number createdAt totalPrice { amount currencyCode } financialStatus fulfillmentStatus cancelledAt cancelReason totalRefunded { amount currencyCode } lineItems(first: 50) { nodes { title quantity totalPrice { amount currencyCode } } } } pageInfo { hasNextPage endCursor } } } }`;
		let result: JsonRecord;
		try {
			result = await this.graphql(
				valid.integration,
				api,
				bundle.accessToken,
				query,
				{ after: after || null },
			);
			await this.repository.setIntegrationReadiness(org.id, {
				readiness: "ready",
				canReadOrders: true,
				verifiedAtIso: this.now().toISOString(),
			});
		} catch (error) {
			await this.repository.setIntegrationReadiness(org.id, {
				readiness: "failed",
				canReadOrders: false,
				lastError: "Customer order access is unavailable.",
			});
			throw error;
		}
		const connection = child(child(result.data, "customer"), "orders");
		if (!connection || !Array.isArray(connection.nodes)) throw safeError();
		const orders = connection.nodes.map((value: unknown) => {
			if (!isRecord(value)) throw safeError();
			const o = value;
			const rawLines =
				isRecord(o.lineItems) && Array.isArray(o.lineItems.nodes)
					? o.lineItems.nodes
					: [];
			return {
				orderNumber: String(o.number ?? ""),
				createdAtIso: String(o.createdAt ?? ""),
				total: money(o.totalPrice),
				financialStatus:
					typeof o.financialStatus === "string" ? o.financialStatus : null,
				fulfillmentStatus: String(o.fulfillmentStatus ?? ""),
				cancellation: o.cancelledAt
					? {
							cancelledAtIso: String(o.cancelledAt),
							reason:
								typeof o.cancelReason === "string" ? o.cancelReason : null,
						}
					: null,
				refund:
					isRecord(o.totalRefunded) && Number(o.totalRefunded.amount) > 0
						? { total: money(o.totalRefunded) }
						: null,
				lineItems: rawLines.map((lineValue: unknown) => {
					if (!isRecord(lineValue)) throw safeError();
					return {
						title: String(lineValue.title ?? ""),
						quantity: Number(lineValue.quantity),
						total: money(lineValue.totalPrice),
					};
				}),
			};
		});
		const touched = await this.repository.touchSession(
			this.sessionTouch(session, this.now()),
		);
		if (!touched) throw new AppError("Customer session is invalid.", 401);
		return {
			orders,
			pageInfo: {
				hasNextPage: Boolean(
					isRecord(connection.pageInfo) && connection.pageInfo.hasNextPage,
				),
				endCursor:
					isRecord(connection.pageInfo) &&
					typeof connection.pageInfo.endCursor === "string"
						? connection.pageInfo.endCursor
						: null,
			},
		};
	}
	async logout(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
	) {
		const org = await this.organizations.findOrganizationBySlug(slug);
		if (!org || !sessionId)
			throw new AppError("Customer session is invalid.", 401);
		const { session, integration } = await this.validSession(sessionId, org.id);
		if (!csrf || csrf !== session.csrfToken || origin !== this.publicOrigin)
			throw new AppError("CSRF validation failed.", 403);
		const bundle = this.decrypt(session);
		const { oidc } = await this.discover(integration);
		if (oidc.issuer !== bundle.issuer) {
			await this.repository.revokeSession(sessionId, this.now().toISOString());
			throw new AppError("Customer session is invalid.", 401);
		}
		await this.repository.revokeSession(sessionId, this.now().toISOString());
		const url = new URL(oidc.end_session_endpoint);
		url.searchParams.set("id_token_hint", bundle.idToken);
		url.searchParams.set("post_logout_redirect_uri", this.urls(slug).logoutUrl);
		return url.toString();
	}
}
