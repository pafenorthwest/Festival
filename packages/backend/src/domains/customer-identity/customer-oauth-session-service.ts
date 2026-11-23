import type {
	CustomerOrdersResponse,
	CustomerSessionResponse,
	OrganizationRecord,
	SaveCustomerAccountSettingsResponse,
} from "@festival/common";
import {
	BoundedAsyncCache,
	type CacheMetrics,
	CustomerAccountTransport,
	type CustomerAccountTransportOptions,
	type DomainCacheInvalidator,
	type S10DomainEventListener,
	type ShopifySecretKeyring,
} from "../../infra/s10-infra.js";
import {
	authFailureFlow,
	completeCustomerOAuthCallbackFlow,
	fetchCustomerOrdersFlow,
	formatIntegrationSettings,
	type OAuthFlowContext,
	saveAndVerifyIntegrationFlow,
	startCustomerOAuthFlow,
} from "./customer-oauth-flow.js";
import {
	buildSessionTouchInput,
	logoutCustomerFlow,
	readSessionStatusFlow,
	requireCsrfValidatedSession,
	resolveAccessBundle,
	resolveCheckoutAccessFlow,
	resolveCustomerCheckoutSessionFlow,
	resolveCustomerReadAccessFlow,
	resolveFormAccessFlow,
	type SessionGuardContext,
	validateSessionRecord,
} from "./customer-session-guard.js";
import {
	type ApiDiscovery,
	CUSTOMER_SESSION_COOKIE,
	type Discovery,
	loadShopifyDiscovery,
	safeAuthError,
} from "./oauth-discovery.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerIdentityOrganizationPort,
	CustomerIntegrationRepository,
	CustomerProfileRepository,
	CustomerSessionRecord,
	CustomerSessionRepository,
} from "./types.js";

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_CACHE_ENTRY_BYTES = 256 * 1024;
const DEFAULT_DISCOVERY_CACHE_BYTES = 4 * 1024 * 1024;
const DEFAULT_JWKS_CACHE_BYTES = 8 * 1024 * 1024;

export { CUSTOMER_SESSION_COOKIE };

export interface CustomerOAuthSessionServiceOptions {
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

export interface CustomerOAuthSessionDeps {
	integrations: CustomerIntegrationRepository;
	sessions: CustomerSessionRepository;
	profiles: Pick<
		CustomerProfileRepository,
		"getCustomer" | "recordVerifiedShopifyEmail"
	>;
	organizations: CustomerIdentityOrganizationPort;
	keyring: ShopifySecretKeyring;
}

function validateOriginAndCaps(options: CustomerOAuthSessionServiceOptions) {
	const origin = new URL(options.publicOrigin);
	if (
		!/^https:$/.test(origin.protocol) &&
		origin.hostname !== "localhost" &&
		origin.hostname !== "127.0.0.1"
	) {
		throw new Error("FESTIVAL_PUBLIC_ORIGIN must use HTTPS.");
	}
	const idleMs = (options.idleDays ?? 7) * 86_400_000;
	const absoluteMs = (options.absoluteDays ?? 30) * 86_400_000;
	if (idleMs <= 0 || absoluteMs <= 0 || idleMs > absoluteMs) {
		throw new Error("Customer session caps are invalid.");
	}
	return { publicOrigin: origin.origin, idleMs, absoluteMs };
}

function createSessionCaches(
	options: CustomerOAuthSessionServiceOptions,
	nowMs: () => number,
) {
	const maxEntryBytes = options.cacheMaxEntryBytes ?? DEFAULT_CACHE_ENTRY_BYTES;
	return {
		discoveryCache: new BoundedAsyncCache<
			string,
			{ oidc: Discovery; api: ApiDiscovery }
		>({
			maxEntries: options.discoveryCacheMaxEntries ?? 1_024,
			maxEntryBytes,
			maxTotalBytes:
				options.discoveryCacheMaxTotalBytes ?? DEFAULT_DISCOVERY_CACHE_BYTES,
			now: nowMs,
		}),
		jwksCache: new BoundedAsyncCache<
			string,
			readonly Record<string, unknown>[]
		>({
			maxEntries: options.jwksCacheMaxEntries ?? 1_024,
			maxEntryBytes,
			maxTotalBytes: options.jwksCacheMaxTotalBytes ?? DEFAULT_JWKS_CACHE_BYTES,
			now: nowMs,
		}),
		organizationBySlugCache: new BoundedAsyncCache<
			string,
			OrganizationRecord | null
		>({
			maxEntries: 256,
			maxEntryBytes: 64 * 1024,
			maxTotalBytes: 1024 * 1024,
			now: nowMs,
		}),
	};
}

function subscribeOAuthCacheInvalidator(
	invalidator: DomainCacheInvalidator,
	caches: {
		discoveryCache: BoundedAsyncCache<
			string,
			{ oidc: Discovery; api: ApiDiscovery }
		>;
		jwksCache: BoundedAsyncCache<string, readonly Record<string, unknown>[]>;
		organizationBySlugCache: BoundedAsyncCache<
			string,
			OrganizationRecord | null
		>;
	},
): () => void {
	return invalidator.subscribe((event) => {
		if (event.type === "OrgUpdated") {
			caches.organizationBySlugCache.deleteWhere(
				(slug, org) => slug === event.slug || org?.id === event.organizationId,
			);
		} else if (event.type === "ShopifySecretRotated") {
			caches.discoveryCache.deleteWhere(
				(key) =>
					!event.organizationId || key.startsWith(`${event.organizationId}\0`),
			);
		} else if (event.type === "CachesCleared") {
			caches.organizationBySlugCache.deleteWhere(() => true);
			caches.discoveryCache.deleteWhere(() => true);
			caches.jwksCache.deleteWhere(() => true);
		}
	});
}

/** Domain service owning Shopify Customer Account OAuth/PKCE, OIDC, and sessions. */
export class CustomerOAuthSessionService {
	readonly publicOrigin: string;
	readonly now: () => Date;
	private readonly idleMs: number;
	private readonly absoluteMs: number;
	private readonly transport: CustomerAccountTransport;
	private readonly discoveryTtlMs: number;
	private readonly jwksTtlMs: number;
	private readonly refreshes = new Map<
		string,
		Promise<CustomerSessionRecord>
	>();
	private readonly discoveryCache: BoundedAsyncCache<
		string,
		{ oidc: Discovery; api: ApiDiscovery }
	>;
	private readonly jwksCache: BoundedAsyncCache<
		string,
		readonly Record<string, unknown>[]
	>;
	private readonly organizationBySlugCache: BoundedAsyncCache<
		string,
		OrganizationRecord | null
	>;
	private invalidator?: DomainCacheInvalidator;
	private unsubscribeInvalidator?: () => void;
	private readonly localListeners = new Set<S10DomainEventListener>();

	constructor(
		private readonly deps: CustomerOAuthSessionDeps,
		options: CustomerOAuthSessionServiceOptions,
	) {
		const validated = validateOriginAndCaps(options);
		this.publicOrigin = validated.publicOrigin;
		this.idleMs = validated.idleMs;
		this.absoluteMs = validated.absoluteMs;
		this.now = options.now ?? (() => new Date());
		this.transport =
			options.transport ??
			new CustomerAccountTransport(options.transportOptions);
		this.discoveryTtlMs = options.discoveryCacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		this.jwksTtlMs = options.jwksCacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
		const caches = createSessionCaches(options, () => this.now().getTime());
		this.discoveryCache = caches.discoveryCache;
		this.jwksCache = caches.jwksCache;
		this.organizationBySlugCache = caches.organizationBySlugCache;
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.unsubscribeInvalidator?.();
		this.invalidator = invalidator;
		this.unsubscribeInvalidator = subscribeOAuthCacheInvalidator(invalidator, {
			discoveryCache: this.discoveryCache,
			jwksCache: this.jwksCache,
			organizationBySlugCache: this.organizationBySlugCache,
		});
	}

	onDomainEvent(listener: S10DomainEventListener): () => void {
		this.localListeners.add(listener);
		return () => this.localListeners.delete(listener);
	}

	private guardCtx(): SessionGuardContext {
		return {
			publicOrigin: this.publicOrigin,
			idleMs: this.idleMs,
			now: this.now,
			transport: this.transport,
			keyring: this.deps.keyring,
			jwksCache: this.jwksCache,
			jwksTtlMs: this.jwksTtlMs,
			refreshes: this.refreshes,
			integrations: this.deps.integrations,
			sessions: this.deps.sessions,
			profiles: this.deps.profiles,
			loadOrganizationBySlug: (s) => this.loadOrganizationBySlug(s),
			discover: (i) => this.discover(i),
		};
	}

	private flowCtx(): OAuthFlowContext {
		return {
			...this.guardCtx(),
			profiles: this.deps.profiles,
			absoluteMs: this.absoluteMs,
			discoveryCache: this.discoveryCache,
			validSession: (id, orgId) => this.validSession(id, orgId),
			access: (s, i) => resolveAccessBundle(this.guardCtx(), s, i),
			sessionTouchInput: (s, seenAt) => this.sessionTouchInput(s, seenAt),
			getInvalidator: () => this.invalidator,
			localListeners: this.localListeners,
		};
	}

	loadOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
		return this.organizationBySlugCache.getOrLoad(slug, async () => {
			const value = await this.deps.organizations.findOrganizationBySlug(slug);
			return {
				value,
				ttlMs: DEFAULT_CACHE_TTL_MS,
				bytes: Buffer.byteLength(JSON.stringify(value ?? null)),
			};
		});
	}

	private async discover(integration: CustomerAccountIntegrationRecord) {
		const key = `${integration.organizationId}\0${integration.integrationVersion}\0${integration.storefrontDomain}`;
		try {
			return await this.discoveryCache.getOrLoad(key, async () => {
				const value = await loadShopifyDiscovery(
					this.transport,
					integration.storefrontDomain,
				);
				return {
					value,
					ttlMs: this.discoveryTtlMs,
					bytes: Buffer.byteLength(JSON.stringify(value)),
				};
			});
		} catch {
			throw safeAuthError();
		}
	}

	sessionTouchInput(session: CustomerSessionRecord, seenAt: Date) {
		return buildSessionTouchInput(this.idleMs, session, seenAt);
	}
	validSession(sessionId: string, organizationId: string) {
		return validateSessionRecord(this.guardCtx(), sessionId, organizationId);
	}
	requireCsrfSession(
		slug: string,
		sessionId: string | undefined,
		csrf: string | undefined,
		origin: string | undefined,
	) {
		return requireCsrfValidatedSession(
			this.guardCtx(),
			slug,
			sessionId,
			csrf,
			origin,
		);
	}
	getSettings = (...args: [string, string]) =>
		this.deps.integrations.getIntegration(args[0]).then((record) => ({
			settings: record
				? formatIntegrationSettings(this.publicOrigin, record, args[1])
				: null,
		}));
	saveAndVerify = (
		...args: [string, string, unknown]
	): Promise<SaveCustomerAccountSettingsResponse> =>
		saveAndVerifyIntegrationFlow(this.flowCtx(), ...args);
	start = (...args: [string, string?, string?]): Promise<string> =>
		startCustomerOAuthFlow(this.flowCtx(), ...args);
	callback = (
		stateValue: string | undefined,
		code: string | undefined,
		validateOffering?: (slug: string, offeringId: string) => Promise<unknown>,
	) =>
		completeCustomerOAuthCallbackFlow(
			this.flowCtx(),
			stateValue,
			code,
			validateOffering,
		);
	authenticationFailure = (stateValue: string | undefined): Promise<string> =>
		authFailureFlow(this.flowCtx(), stateValue);
	session = (
		slug: string,
		sessionId?: string,
	): Promise<CustomerSessionResponse> =>
		readSessionStatusFlow(this.guardCtx(), slug, sessionId);
	checkoutAccess = (
		...args: [
			string,
			string | undefined,
			string | undefined,
			string | undefined,
		]
	) => resolveCheckoutAccessFlow(this.guardCtx(), ...args);
	formAccess = (
		...args: [
			string,
			string | undefined,
			string | undefined,
			string | undefined,
		]
	) => resolveFormAccessFlow(this.guardCtx(), ...args);
	customerSession = (
		...args: [
			string,
			string | undefined,
			string | undefined,
			string | undefined,
		]
	) => this.formAccess(...args);
	customerReadAccess = (slug: string, sessionId: string | undefined) =>
		resolveCustomerReadAccessFlow(this.guardCtx(), slug, sessionId);
	validateSession = (slug: string, sessionToken: string) =>
		this.customerReadAccess(slug, sessionToken);
	customerCheckoutSession = (slug: string, sessionId: string | undefined) =>
		resolveCustomerCheckoutSessionFlow(this.guardCtx(), slug, sessionId);
	orders = (
		slug: string,
		sessionId: string | undefined,
		after?: string,
	): Promise<CustomerOrdersResponse> =>
		fetchCustomerOrdersFlow(this.flowCtx(), slug, sessionId, after);
	logout = (
		...args: [
			string,
			string | undefined,
			string | undefined,
			string | undefined,
		]
	): Promise<string> => logoutCustomerFlow(this.guardCtx(), ...args);
	cacheMetrics(): {
		dns: CacheMetrics;
		discovery: CacheMetrics;
		jwks: CacheMetrics;
		organizationBySlug: CacheMetrics;
	} {
		return {
			dns: this.transport.metrics(),
			discovery: this.discoveryCache.metrics(),
			jwks: this.jwksCache.metrics(),
			organizationBySlug: this.organizationBySlugCache.metrics(),
		};
	}
}
