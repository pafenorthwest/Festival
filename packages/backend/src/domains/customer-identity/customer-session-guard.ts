import { AppError, type OrganizationRecord } from "@festival/common";
import type {
	BoundedAsyncCache,
	CustomerAccountTransport,
	ShopifySecretKeyring,
} from "../../infra/s10-infra.js";
import {
	buildSessionTouchInput,
	refreshSessionTokens,
} from "./customer-token-refresh.js";
import {
	type ApiDiscovery,
	type Discovery,
	resolveUrls,
} from "./oauth-discovery.js";
import { decryptTokenBundle, type TokenBundle } from "./oauth-tokens.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerIntegrationRepository,
	CustomerProfileRepository,
	CustomerSessionRecord,
	CustomerSessionRepository,
	FestivalCustomerRecord,
} from "./types.js";

export interface SessionGuardContext {
	publicOrigin: string;
	idleMs: number;
	now: () => Date;
	transport: CustomerAccountTransport;
	keyring: ShopifySecretKeyring;
	jwksCache: BoundedAsyncCache<string, readonly Record<string, unknown>[]>;
	jwksTtlMs: number;
	refreshes: Map<string, Promise<CustomerSessionRecord>>;
	integrations: CustomerIntegrationRepository;
	sessions: CustomerSessionRepository;
	profiles: Pick<CustomerProfileRepository, "getCustomer">;
	loadOrganizationBySlug(slug: string): Promise<OrganizationRecord | null>;
	discover(
		integration: CustomerAccountIntegrationRecord,
	): Promise<{ oidc: Discovery; api: ApiDiscovery }>;
}

export { buildSessionTouchInput } from "./customer-token-refresh.js";

export async function validateSessionRecord(
	ctx: SessionGuardContext,
	sessionId: string,
	organizationId: string,
) {
	if (ctx.sessions.findSessionCustomerAndIntegration) {
		const res = await ctx.sessions.findSessionCustomerAndIntegration(
			sessionId,
			organizationId,
		);
		if (!res || "organizationMismatch" in res) {
			throw new AppError("Customer session is invalid.", 401);
		}
		return assertSessionActive(ctx, res);
	}
	const s = await ctx.sessions.getSession(sessionId);
	if (!s || s.organizationId !== organizationId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const [customer, integration] = await Promise.all([
		ctx.profiles.getCustomer(organizationId, s.customerId),
		ctx.integrations.getIntegration(organizationId),
	]);
	return assertSessionActive(ctx, { session: s, customer, integration });
}

async function assertSessionActive(
	ctx: SessionGuardContext,
	loaded: {
		session: CustomerSessionRecord;
		customer: FestivalCustomerRecord | null;
		integration: CustomerAccountIntegrationRecord | null;
	},
) {
	const now = ctx.now();
	const { session: s, customer, integration } = loaded;
	const stale =
		Boolean(s.revokedAtIso) ||
		new Date(s.expiresAtIso) <= now ||
		new Date(s.lastSeenAtIso).getTime() + ctx.idleMs <= now.getTime();
	if (
		stale ||
		!customer ||
		customer.shopifyCustomerGid !== s.shopifyCustomerGid ||
		!integration ||
		integration.integrationVersion !== s.integrationVersion
	) {
		await ctx.sessions.revokeSession(s.sessionId, now.toISOString());
		throw new AppError("Customer session is invalid.", 401);
	}
	return { session: s, integration, customer };
}

export async function resolveAccessBundle(
	ctx: SessionGuardContext,
	session: CustomerSessionRecord,
	integration: CustomerAccountIntegrationRecord,
): Promise<{ session: CustomerSessionRecord; bundle: TokenBundle }> {
	const bundle = decryptTokenBundle(
		ctx.keyring,
		session.organizationId,
		session.encryptedTokens,
	);
	if (
		new Date(bundle.accessExpiresAtIso).getTime() >
		ctx.now().getTime() + 30_000
	) {
		return { session, bundle };
	}
	let pending = ctx.refreshes.get(session.sessionId);
	if (!pending) {
		pending = refreshSessionTokens(ctx, session, integration).finally(() =>
			ctx.refreshes.delete(session.sessionId),
		);
		ctx.refreshes.set(session.sessionId, pending);
	}
	const updated = await pending;
	return {
		session: updated,
		bundle: decryptTokenBundle(
			ctx.keyring,
			updated.organizationId,
			updated.encryptedTokens,
		),
	};
}

export async function requireCsrfValidatedSession(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
	csrf: string | undefined,
	origin: string | undefined,
) {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const valid = await validateSessionRecord(ctx, sessionId, org.id);
	if (
		!csrf ||
		csrf !== valid.session.csrfToken ||
		origin !== ctx.publicOrigin
	) {
		throw new AppError("CSRF validation failed.", 403);
	}
	const touched = await ctx.sessions.touchSession(
		buildSessionTouchInput(ctx.idleMs, valid.session, ctx.now()),
	);
	if (!touched) throw new AppError("Customer session is invalid.", 401);
	return { org, valid, touched };
}

export async function readSessionStatusFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId?: string,
) {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) return { session: { authenticated: false as const } };
	try {
		const { session } = await validateSessionRecord(ctx, sessionId, org.id);
		const touched = await ctx.sessions.touchSession(
			buildSessionTouchInput(ctx.idleMs, session, ctx.now()),
		);
		if (!touched) throw new AppError("Customer session is invalid.", 401);
		return {
			session: {
				authenticated: true as const,
				csrfToken: touched.csrfToken,
				expiresAtIso: touched.expiresAtIso,
			},
		};
	} catch (error) {
		if (!(error instanceof AppError) || error.status !== 401) throw error;
		return { session: { authenticated: false as const } };
	}
}

export async function resolveCheckoutAccessFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
	csrf: string | undefined,
	origin: string | undefined,
) {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const valid = await validateSessionRecord(ctx, sessionId, org.id);
	if (
		!csrf ||
		csrf !== valid.session.csrfToken ||
		origin !== ctx.publicOrigin
	) {
		throw new AppError("CSRF validation failed.", 403);
	}
	const { session, bundle } = await resolveAccessBundle(
		ctx,
		valid.session,
		valid.integration,
	);
	const touched = await ctx.sessions.touchSession(
		buildSessionTouchInput(ctx.idleMs, session, ctx.now()),
	);
	if (!touched) throw new AppError("Customer session is invalid.", 401);
	return {
		organizationId: org.id,
		organizationSlug: org.slug,
		customerId: valid.customer.id,
		sessionId: touched.sessionId,
		integrationVersion: touched.integrationVersion,
		shopifyCustomerAccessToken: bundle.accessToken,
	};
}

export async function resolveFormAccessFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
	csrf: string | undefined,
	origin: string | undefined,
) {
	const { org, valid } = await requireCsrfValidatedSession(
		ctx,
		slug,
		sessionId,
		csrf,
		origin,
	);
	return {
		organizationId: org.id,
		organizationTimezone: org.timezone,
		customerId: valid.customer.id,
		name: valid.customer.name.value,
		email: valid.customer.email.value,
		verifiedShopifyCustomerEmail:
			valid.customer.email.source === "shopify"
				? valid.customer.email.value
				: undefined,
	};
}

export async function resolveCustomerReadAccessFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
) {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const valid = await validateSessionRecord(ctx, sessionId, org.id);
	const touched = await ctx.sessions.touchSession(
		buildSessionTouchInput(ctx.idleMs, valid.session, ctx.now()),
	);
	if (!touched) throw new AppError("Customer session is invalid.", 401);
	return { organizationId: org.id, customerId: valid.customer.id };
}

export async function resolveCustomerCheckoutSessionFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
) {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const valid = await validateSessionRecord(ctx, sessionId, org.id);
	const { session, bundle } = await resolveAccessBundle(
		ctx,
		valid.session,
		valid.integration,
	);
	const touched = await ctx.sessions.touchSession(
		buildSessionTouchInput(ctx.idleMs, session, ctx.now()),
	);
	if (!touched) throw new AppError("Customer session is invalid.", 401);
	return {
		organizationId: org.id,
		organizationSlug: org.slug,
		customerId: valid.customer.id,
		sessionId: touched.sessionId,
		integrationVersion: touched.integrationVersion,
		buyerAccessToken: bundle.accessToken,
	};
}

export async function logoutCustomerFlow(
	ctx: SessionGuardContext,
	slug: string,
	sessionId: string | undefined,
	csrf: string | undefined,
	origin: string | undefined,
): Promise<string> {
	const org = await ctx.loadOrganizationBySlug(slug);
	if (!org || !sessionId) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const { session, integration } = await validateSessionRecord(
		ctx,
		sessionId,
		org.id,
	);
	if (!csrf || csrf !== session.csrfToken || origin !== ctx.publicOrigin) {
		throw new AppError("CSRF validation failed.", 403);
	}
	const bundle = decryptTokenBundle(
		ctx.keyring,
		session.organizationId,
		session.encryptedTokens,
	);
	const { oidc } = await ctx.discover(integration);
	await ctx.sessions.revokeSession(sessionId, ctx.now().toISOString());
	if (oidc.issuer !== bundle.issuer) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const url = new URL(oidc.end_session_endpoint);
	url.searchParams.set("id_token_hint", bundle.idToken);
	url.searchParams.set(
		"post_logout_redirect_uri",
		resolveUrls(ctx.publicOrigin, slug).logoutUrl,
	);
	return url.toString();
}
