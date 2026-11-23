import { AppError } from "@festival/common";
import { SHOPIFY_CUSTOMER_TOKENS_PURPOSE } from "../../infra/s10-infra.js";
import type { SessionGuardContext } from "./customer-session-guard.js";
import { type Discovery, safeAuthError } from "./oauth-discovery.js";
import {
	decryptTokenBundle,
	exchangeOAuthTokens,
	type TokenBundle,
	verifyCustomerIdToken,
} from "./oauth-tokens.js";
import type {
	CustomerAccountIntegrationRecord,
	CustomerSessionRecord,
	CustomerSessionRepository,
} from "./types.js";

export function buildSessionTouchInput(
	idleMs: number,
	session: CustomerSessionRecord,
	seenAt: Date,
) {
	return {
		sessionId: session.sessionId,
		organizationId: session.organizationId,
		integrationVersion: session.integrationVersion,
		seenAtIso: seenAt.toISOString(),
		idleCutoffIso: new Date(seenAt.getTime() - idleMs).toISOString(),
	};
}

const repositoryRefreshes = new WeakMap<
	CustomerSessionRepository,
	Map<string, Promise<CustomerSessionRecord>>
>();

function withRepositoryRefreshLock(
	sessions: CustomerSessionRepository,
	sessionId: string,
	operation: () => Promise<CustomerSessionRecord>,
): Promise<CustomerSessionRecord> {
	let locks = repositoryRefreshes.get(sessions);
	if (!locks) {
		locks = new Map();
		repositoryRefreshes.set(sessions, locks);
	}
	const sessionLocks = locks;
	const existing = sessionLocks.get(sessionId);
	if (existing) return existing;
	const pending = operation().finally(() => {
		if (sessionLocks.get(sessionId) === pending) {
			sessionLocks.delete(sessionId);
		}
	});
	sessionLocks.set(sessionId, pending);
	return pending;
}

function isActiveSession(
	ctx: SessionGuardContext,
	session: CustomerSessionRecord | null,
	integration: CustomerAccountIntegrationRecord,
): session is CustomerSessionRecord {
	const now = ctx.now().getTime();
	return Boolean(
		session &&
			!session.revokedAtIso &&
			session.organizationId === integration.organizationId &&
			session.integrationVersion === integration.integrationVersion &&
			Date.parse(session.expiresAtIso) > now &&
			Date.parse(session.lastSeenAtIso) + ctx.idleMs > now,
	);
}

async function exchangeRefreshedTokens(
	ctx: SessionGuardContext,
	input: {
		latest: CustomerSessionRecord;
		integration: CustomerAccountIntegrationRecord;
		current: TokenBundle;
		oidc: Discovery;
	},
): Promise<TokenBundle> {
	const { latest, integration, current, oidc } = input;
	try {
		if (oidc.issuer !== current.issuer) {
			throw new AppError("Customer session is invalid.", 401);
		}
		const next = await exchangeOAuthTokens(
			integration,
			oidc,
			new URLSearchParams({
				grant_type: "refresh_token",
				client_id: integration.clientId,
				refresh_token: current.refreshToken,
			}),
			{
				transport: ctx.transport,
				keyring: ctx.keyring,
				now: ctx.now,
				existingIdToken: current.idToken,
			},
		);
		if (next.idToken !== current.idToken) {
			await verifyCustomerIdToken(next.idToken, integration, oidc, {
				transport: ctx.transport,
				jwksCache: ctx.jwksCache,
				jwksTtlMs: ctx.jwksTtlMs,
				now: ctx.now,
			});
		}
		return next;
	} catch (error) {
		if (error instanceof AppError && error.status === 401) {
			await ctx.sessions.revokeSession(
				latest.sessionId,
				ctx.now().toISOString(),
				latest.encryptedTokens,
			);
		}
		throw error;
	}
}

async function refreshLockedSession(
	ctx: SessionGuardContext,
	session: CustomerSessionRecord,
	integration: CustomerAccountIntegrationRecord,
): Promise<CustomerSessionRecord> {
	const latest = await ctx.sessions.getSession(session.sessionId);
	if (!isActiveSession(ctx, latest, integration)) {
		throw new AppError("Customer session is invalid.", 401);
	}
	const current = decryptTokenBundle(
		ctx.keyring,
		latest.organizationId,
		latest.encryptedTokens,
	);
	if (Date.parse(current.accessExpiresAtIso) > ctx.now().getTime() + 30_000) {
		return latest;
	}
	const { oidc } = await ctx.discover(integration);
	const next = await exchangeRefreshedTokens(ctx, {
		latest,
		integration,
		current,
		oidc,
	});
	const updated = await ctx.sessions.replaceSessionTokens({
		...buildSessionTouchInput(ctx.idleMs, latest, ctx.now()),
		expectedEncryptedTokens: latest.encryptedTokens,
		replacementEncryptedTokens: ctx.keyring.encrypt(JSON.stringify(next), {
			organizationId: latest.organizationId,
			purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
		}),
		replacementExpiresAtIso: next.refreshExpiresAtIso ?? latest.expiresAtIso,
	});
	if (updated) return updated;
	const peer = await ctx.sessions.getSession(session.sessionId);
	if (
		isActiveSession(ctx, peer, integration) &&
		peer.encryptedTokens !== latest.encryptedTokens
	) {
		return peer;
	}
	throw new AppError("Customer session is invalid.", 401);
}

export async function refreshSessionTokens(
	ctx: SessionGuardContext,
	session: CustomerSessionRecord,
	integration: CustomerAccountIntegrationRecord,
): Promise<CustomerSessionRecord> {
	try {
		return await withRepositoryRefreshLock(
			ctx.sessions,
			session.sessionId,
			() =>
				ctx.sessions.withSessionRefreshLock
					? ctx.sessions.withSessionRefreshLock(session.sessionId, (sessions) =>
							refreshLockedSession({ ...ctx, sessions }, session, integration),
						)
					: refreshLockedSession(ctx, session, integration),
		);
	} catch (error) {
		if (error instanceof AppError) throw error;
		throw safeAuthError();
	}
}
