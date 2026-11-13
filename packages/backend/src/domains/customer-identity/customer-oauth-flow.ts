import { randomUUID } from "node:crypto";
import {
	AppError,
	CUSTOMER_ACCOUNT_API_VERSION,
	type CustomerAccountSettings,
	type CustomerOrdersResponse,
	type OrganizationRecord,
	type SaveCustomerAccountSettingsResponse,
	validateCustomerAccountSettings,
} from "@festival/common";
import {
	type BoundedAsyncCache,
	type CustomerAccountTransport,
	type DomainCacheInvalidator,
	emitS10DomainEvent,
	type S10DomainEventListener,
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	type ShopifySecretKeyring,
} from "../../infra/s10-infra.js";
import {
	type ApiDiscovery,
	type Discovery,
	hashOAuthState,
	isRecord,
	jsonChild,
	OAUTH_STATE_TTL_MS,
	parseCustomerOrdersPayload,
	randomOpaque,
	resolveStartReturnTo,
	resolveUrls,
	safeAuthError,
	transportJson,
} from "./oauth-discovery.js";
import {
	exchangeOAuthTokens,
	extractVerifiedShopifyEmail,
	type TokenBundle,
	verifyCustomerIdToken,
} from "./oauth-tokens.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerIntegrationRepository,
	CustomerProfileRepository,
	CustomerSessionRecord,
	CustomerSessionRepository,
} from "./types.js";

export interface OAuthFlowContext {
	publicOrigin: string;
	absoluteMs: number;
	now: () => Date;
	transport: CustomerAccountTransport;
	keyring: ShopifySecretKeyring;
	jwksCache: BoundedAsyncCache<string, readonly Record<string, unknown>[]>;
	jwksTtlMs: number;
	discoveryCache: BoundedAsyncCache<
		string,
		{ oidc: Discovery; api: ApiDiscovery }
	>;
	integrations: CustomerIntegrationRepository;
	sessions: CustomerSessionRepository;
	profiles: Pick<
		CustomerProfileRepository,
		"getCustomer" | "recordVerifiedShopifyEmail"
	>;
	loadOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	discover(
		integration: CustomerAccountIntegrationRecord,
	): Promise<{ oidc: Discovery; api: ApiDiscovery }>;
	validSession(
		sessionId: string,
		organizationId: string,
	): Promise<{
		session: CustomerSessionRecord;
		integration: CustomerAccountIntegrationRecord;
	}>;
	access(
		session: CustomerSessionRecord,
		integration: CustomerAccountIntegrationRecord,
	): Promise<{ session: CustomerSessionRecord; bundle: TokenBundle }>;
	sessionTouchInput(
		session: CustomerSessionRecord,
		seenAt: Date,
	): {
		sessionId: string;
		organizationId: string;
		integrationVersion: number;
		seenAtIso: string;
		idleCutoffIso: string;
	};
	getInvalidator(): DomainCacheInvalidator | undefined;
	localListeners: Set<S10DomainEventListener>;
}

export function formatIntegrationSettings(
	publicOrigin: string,
	record: CustomerAccountIntegrationRecord,
	slug: string,
): CustomerAccountSettings {
	return {
		storefrontDomain: record.storefrontDomain,
		clientId: record.clientId,
		hasClientSecret: true,
		...resolveUrls(publicOrigin, slug),
		apiVersion: CUSTOMER_ACCOUNT_API_VERSION,
		readiness: record.readiness,
		canReadOrders: record.canReadOrders,
		integrationVersion: record.integrationVersion,
		verifiedAtIso: record.verifiedAtIso,
		lastError: record.lastError,
		updatedAtIso: record.updatedAtIso,
	};
}

async function verifySavedDiscovery(
	ctx: OAuthFlowContext,
	organizationId: string,
	saved: CustomerAccountIntegrationRecord,
): Promise<CustomerAccountIntegrationRecord> {
	try {
		await ctx.discover(saved);
		return ctx.integrations.setIntegrationReadiness(organizationId, {
			readiness: "ready",
			canReadOrders: false,
			verifiedAtIso: ctx.now().toISOString(),
		});
	} catch {
		return ctx.integrations.setIntegrationReadiness(organizationId, {
			readiness: "failed",
			canReadOrders: false,
			lastError: "Customer Account discovery verification failed.",
		});
	}
}

export async function saveAndVerifyIntegrationFlow(
	ctx: OAuthFlowContext,
	organizationId: string,
	slug: string,
	input: unknown,
): Promise<SaveCustomerAccountSettingsResponse> {
	const current = await ctx.integrations.getIntegration(organizationId);
	const parsed = validateCustomerAccountSettings(
		input,
		!current || Boolean(isRecord(input) && input.clientSecret),
	);
	const secret =
		parsed.clientSecret ??
		(current
			? ctx.keyring.decrypt(current.encryptedClientSecret, {
					organizationId,
					purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
				})
			: undefined);
	if (!secret) {
		throw new AppError("Customer Account client secret is required.", 400);
	}
	const saved = await ctx.integrations.upsertIntegration({
		organizationId,
		storefrontDomain: parsed.storefrontDomain,
		clientId: parsed.clientId,
		encryptedClientSecret: ctx.keyring.encrypt(secret, {
			organizationId,
			purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
		}),
	});
	ctx.discoveryCache.deleteWhere((key) =>
		key.startsWith(`${organizationId}\0`),
	);
	emitS10DomainEvent(
		ctx.getInvalidator(),
		{ type: "CustomerIntegrationRotated", organizationId },
		ctx.localListeners,
	);
	const updated = await verifySavedDiscovery(ctx, organizationId, saved);
	return {
		settings: formatIntegrationSettings(ctx.publicOrigin, updated, slug),
	};
}

export async function startCustomerOAuthFlow(
	ctx: OAuthFlowContext,
	slug: string,
	returnTo?: string,
	offeringId?: string,
): Promise<string> {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org) throw new AppError("Organization not found.", 404);
	const integration = await ctx.integrations.getIntegration(org.id);
	if (!integration || integration.readiness !== "ready") throw safeAuthError();
	const expected = resolveStartReturnTo(slug, returnTo, offeringId);
	const state = randomOpaque();
	const nonce = randomOpaque();
	await ctx.sessions.putOAuthState({
		stateHash: hashOAuthState(state),
		organizationId: org.id,
		nonce,
		returnTo: expected,
		offeringId,
		expiresAtIso: new Date(
			ctx.now().getTime() + OAUTH_STATE_TTL_MS,
		).toISOString(),
	});
	const { oidc } = await ctx.discover(integration);
	const url = new URL(oidc.authorization_endpoint);
	url.search = new URLSearchParams({
		scope: "openid email customer-account-api:full",
		client_id: integration.clientId,
		response_type: "code",
		redirect_uri: resolveUrls(ctx.publicOrigin, slug).callbackUrl,
		state,
		nonce,
	}).toString();
	return url.toString();
}

async function runGraphql(
	ctx: OAuthFlowContext,
	integration: CustomerAccountIntegrationRecord,
	api: ApiDiscovery,
	accessToken: string,
	query: string,
	variables?: Record<string, unknown>,
) {
	const result = await transportJson(
		ctx.transport,
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
	if (Array.isArray(result.errors) && result.errors.length) {
		throw new AppError("Customer order access is unavailable.", 403);
	}
	return result;
}

async function verifyCallbackCustomerGid(
	ctx: OAuthFlowContext,
	org: OrganizationRecord,
	integration: CustomerAccountIntegrationRecord,
	state: { nonce: string },
	code: string,
) {
	const discovered = await ctx.discover(integration);
	const bundle = await exchangeOAuthTokens(
		integration,
		discovered.oidc,
		new URLSearchParams({
			grant_type: "authorization_code",
			client_id: integration.clientId,
			redirect_uri: resolveUrls(ctx.publicOrigin, org.slug).callbackUrl,
			code,
		}),
		{ transport: ctx.transport, keyring: ctx.keyring, now: ctx.now },
	);
	const claims = await verifyCustomerIdToken(
		bundle.idToken,
		integration,
		discovered.oidc,
		{
			transport: ctx.transport,
			jwksCache: ctx.jwksCache,
			jwksTtlMs: ctx.jwksTtlMs,
			now: ctx.now,
			nonce: state.nonce,
		},
	);
	const gidResult = await runGraphql(
		ctx,
		integration,
		discovered.api,
		bundle.accessToken,
		"query FestivalCustomerIdentity { customer { id } }",
	);
	const customerGid = jsonChild(gidResult.data, "customer")?.id;
	if (
		typeof customerGid !== "string" ||
		!customerGid.startsWith("gid://shopify/Customer/")
	) {
		throw safeAuthError();
	}
	return { bundle, claims, customerGid };
}

export async function completeCustomerOAuthCallbackFlow(
	ctx: OAuthFlowContext,
	stateValue: string | undefined,
	code: string | undefined,
	validateOffering?: (slug: string, offeringId: string) => Promise<unknown>,
) {
	if (!stateValue || !code) {
		throw new AppError("Customer authentication response is invalid.", 400);
	}
	const state = await ctx.sessions.consumeOAuthState(
		hashOAuthState(stateValue),
		ctx.now().toISOString(),
	);
	if (!state) {
		throw new AppError("Customer authentication response is invalid.", 400);
	}
	const integration = await ctx.integrations.getIntegration(
		state.organizationId,
	);
	if (!integration) throw safeAuthError();
	const slug = state.returnTo.split("/")[2] ?? "";
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || org.id !== state.organizationId) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	if (state.offeringId) {
		if (!validateOffering) throw safeAuthError();
		await validateOffering(org.slug, state.offeringId);
	}
	const { bundle, claims, customerGid } = await verifyCallbackCustomerGid(
		ctx,
		org,
		integration,
		state,
		code,
	);
	return persistCallbackSession(ctx, org, integration, bundle, claims, {
		customerGid,
		state,
	});
}

async function persistCallbackSession(
	ctx: OAuthFlowContext,
	org: OrganizationRecord,
	integration: CustomerAccountIntegrationRecord,
	bundle: TokenBundle,
	claims: Record<string, unknown>,
	extra: {
		customerGid: string;
		state: { returnTo: string; offeringId?: string };
	},
) {
	const now = ctx.now();
	const sessionId = randomUUID();
	const expiresAt = new Date(
		Math.min(
			now.getTime() + ctx.absoluteMs,
			bundle.refreshExpiresAtIso
				? new Date(bundle.refreshExpiresAtIso).getTime()
				: Number.POSITIVE_INFINITY,
		),
	);
	const { customer } = await ctx.sessions.createCustomerSession({
		sessionId,
		organizationId: org.id,
		shopifyCustomerGid: extra.customerGid,
		encryptedTokens: ctx.keyring.encrypt(JSON.stringify(bundle), {
			organizationId: org.id,
			purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
		}),
		csrfToken: randomOpaque(),
		integrationVersion: integration.integrationVersion,
		createdAtIso: now.toISOString(),
		lastSeenAtIso: now.toISOString(),
		expiresAtIso: expiresAt.toISOString(),
	});
	const verifiedEmail = extractVerifiedShopifyEmail(claims);
	if (verifiedEmail) {
		await ctx.profiles.recordVerifiedShopifyEmail({
			organizationId: org.id,
			customerId: customer.id,
			email: verifiedEmail,
			verifiedAtIso: now.toISOString(),
		});
	}
	return {
		sessionId,
		returnTo: extra.state.returnTo,
		organizationSlug: org.slug,
		offeringId: extra.state.offeringId,
		maxAgeSeconds: Math.max(
			1,
			Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
		),
	};
}

export async function authFailureFlow(
	ctx: OAuthFlowContext,
	stateValue: string | undefined,
): Promise<string> {
	if (!stateValue) {
		throw new AppError("Customer authentication response is invalid.", 400);
	}
	const state = await ctx.sessions.consumeOAuthState(
		hashOAuthState(stateValue),
		ctx.now().toISOString(),
	);
	if (!state) {
		throw new AppError("Customer authentication response is invalid.", 400);
	}
	const slug = state.returnTo.split("/")[2] ?? "";
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || org.id !== state.organizationId) {
		throw new AppError("Customer authentication response is invalid.", 401);
	}
	return state.offeringId
		? `/org/${org.slug}/membership?purchaseError=authentication`
		: `/org/${org.slug}/account?authError=authentication`;
}

export async function fetchCustomerOrdersFlow(
	ctx: OAuthFlowContext,
	slug: string,
	sessionId: string | undefined,
	after?: string,
): Promise<CustomerOrdersResponse> {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const valid = await ctx.validSession(sessionId, org.id);
	const { session, bundle } = await ctx.access(
		valid.session,
		valid.integration,
	);
	const { api, oidc } = await ctx.discover(valid.integration);
	if (oidc.issuer !== bundle.issuer) {
		await ctx.sessions.revokeSession(
			session.sessionId,
			ctx.now().toISOString(),
		);
		throw new AppError("Customer session is invalid.", 401);
	}
	const query = `query FestivalOrders($after: String) { customer { orders(first: 20, after: $after) { nodes { number createdAt totalPrice { amount currencyCode } financialStatus fulfillmentStatus cancelledAt cancelReason totalRefunded { amount currencyCode } lineItems(first: 50) { nodes { title quantity totalPrice { amount currencyCode } } } } pageInfo { hasNextPage endCursor } } } }`;
	let result: Record<string, unknown>;
	try {
		result = await runGraphql(
			ctx,
			valid.integration,
			api,
			bundle.accessToken,
			query,
			{ after: after || null },
		);
		await ctx.integrations.setIntegrationReadiness(org.id, {
			readiness: "ready",
			canReadOrders: true,
			verifiedAtIso: ctx.now().toISOString(),
		});
	} catch (error) {
		await ctx.integrations.setIntegrationReadiness(org.id, {
			readiness: "failed",
			canReadOrders: false,
			lastError: "Customer order access is unavailable.",
		});
		throw error;
	}
	const touched = await ctx.sessions.touchSession(
		ctx.sessionTouchInput(session, ctx.now()),
	);
	if (!touched) throw new AppError("Customer session is invalid.", 401);
	return parseCustomerOrdersPayload(result);
}
