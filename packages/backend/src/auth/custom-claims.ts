import type { OrganizationRole } from "@festival/common";
import { sql } from "bun";

/**
 * The "Firebase admin/volunteer intent" claims that specs/VOLUNTEER-PORTAL.md
 * and #194 describe: a person's organization role(s) and the festivals
 * they've enrolled as a volunteer for, stamped directly onto their
 * Firebase ID token.
 *
 * These claims are currently write-only. Every request is still
 * authorized against the database — requireTenantRole, requireAdminIntent,
 * and requireVolunteerScope all still look the membership/enrollment up
 * fresh each time (see auth/tenant-context.ts and auth/volunteer-context.ts).
 * A stale or missing claim never grants or denies access by itself.
 * This exists so the token reflects intent, per the spec, and so a
 * future change can start trusting the claim as a fast path without a
 * data migration. Until then, this is bookkeeping, not enforcement.
 *
 * Known gap: removing a membership does not currently clear the
 * matching orgRoles entry (see admin-org.routes.ts's delete-membership
 * route). Since nothing reads these claims for authorization yet, a
 * stale entry has no practical effect — but it should be cleaned up
 * before anything starts trusting this claim.
 */
export interface VolunteerIntentClaims {
	orgRoles?: Record<string, OrganizationRole>;
	volunteerFestivals?: Record<string, string[]>;
}

export interface CustomClaimsWriter {
	setOrgRole(
		uid: string,
		organizationId: string,
		role: OrganizationRole,
	): Promise<void>;
	addVolunteerFestival(
		uid: string,
		organizationId: string,
		festivalId: string,
	): Promise<void>;
}

/**
 * The slice of firebase-admin's Auth interface this needs — just enough
 * to read a user's existing claims and replace them. Kept minimal (and
 * separate from firebase-admin's own Auth type) so it can be faked in
 * tests without spinning up the Admin SDK.
 */
export interface FirebaseAuthLike {
	getUser(uid: string): Promise<{ customClaims?: object | undefined }>;
	setCustomUserClaims(uid: string, claims: object | null): Promise<void>;
}

/**
 * Serializes read/merge/write claim updates for one Firebase user. The
 * production implementation must coordinate across backend instances, not
 * merely within one process.
 */
export interface CustomClaimsLock {
	withLock<T>(uid: string, operation: () => Promise<T>): Promise<T>;
}

/**
 * A transaction-scoped PostgreSQL advisory lock. PostgreSQL releases the lock
 * when the transaction completes, including if Firebase rejects the write.
 */
export class PostgresCustomClaimsLock implements CustomClaimsLock {
	async withLock<T>(uid: string, operation: () => Promise<T>): Promise<T> {
		return sql.begin(async (transaction) => {
			await transaction.unsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
				[`festival:firebase-custom-claims:${uid}`],
			);
			return operation();
		});
	}
}

/**
 * Writes claims are never allowed to fail the request that triggered
 * them — creating an org, accepting an invite, and enrolling as a
 * volunteer must all succeed even if this fails (e.g. missing Firebase
 * write credentials, a transient Admin SDK error).
 */
export class FirebaseCustomClaimsWriter implements CustomClaimsWriter {
	constructor(
		private readonly auth: FirebaseAuthLike,
		private readonly lock: CustomClaimsLock,
	) {}

	private async withClaims(
		uid: string,
		update: (current: VolunteerIntentClaims) => VolunteerIntentClaims,
	): Promise<void> {
		const retryDelaysMs = [100, 200];
		for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
			try {
				await this.lock.withLock(uid, async () => {
					const user = await this.auth.getUser(uid);
					const current = (user.customClaims ?? {}) as VolunteerIntentClaims;
					await this.auth.setCustomUserClaims(uid, update(current));
				});
				return;
			} catch (error) {
				const retryDelayMs = retryDelaysMs[attempt];
				if (retryDelayMs !== undefined) {
					await Bun.sleep(retryDelayMs);
					continue;
				}
				console.error("Failed to update Firebase custom claims", error);
			}
		}
	}

	async setOrgRole(
		uid: string,
		organizationId: string,
		role: OrganizationRole,
	) {
		await this.withClaims(uid, (current) => ({
			...current,
			orgRoles: { ...current.orgRoles, [organizationId]: role },
		}));
	}

	async addVolunteerFestival(
		uid: string,
		organizationId: string,
		festivalId: string,
	) {
		await this.withClaims(uid, (current) => {
			const existing = current.volunteerFestivals?.[organizationId] ?? [];
			const festivals = existing.includes(festivalId)
				? existing
				: [...existing, festivalId];
			return {
				...current,
				volunteerFestivals: {
					...current.volunteerFestivals,
					[organizationId]: festivals,
				},
			};
		});
	}

	/**
	 * Rebuild Festival-managed keys from Postgres while retaining keys owned by
	 * other Firebase consumers. Unlike request-time updates, callers receive a
	 * rejection so a scheduled reconciliation can report and retry failures.
	 */
	async replaceVolunteerIntentClaims(
		uid: string,
		loadClaims: () => Promise<VolunteerIntentClaims>,
	): Promise<void> {
		const retryDelaysMs = [100, 200];
		let lastError: unknown;
		for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
			try {
				await this.lock.withLock(uid, async () => {
					// Load Postgres state only after acquiring the same lock used for
					// Firebase replacement. Otherwise a request-time update can land
					// between an earlier snapshot and this replacement, then be lost.
					const claims = await loadClaims();
					const user = await this.auth.getUser(uid);
					const current = (user.customClaims ?? {}) as Record<string, unknown>;
					const {
						orgRoles: _orgRoles,
						volunteerFestivals: _volunteerFestivals,
						...other
					} = current;
					await this.auth.setCustomUserClaims(uid, {
						...other,
						...(claims.orgRoles && Object.keys(claims.orgRoles).length > 0
							? { orgRoles: claims.orgRoles }
							: {}),
						...(claims.volunteerFestivals &&
						Object.keys(claims.volunteerFestivals).length > 0
							? { volunteerFestivals: claims.volunteerFestivals }
							: {}),
					});
				});
				return;
			} catch (error) {
				lastError = error;
				const retryDelayMs = retryDelaysMs[attempt];
				if (retryDelayMs !== undefined) await Bun.sleep(retryDelayMs);
			}
		}
		throw lastError;
	}
}

/** Used when Firebase write credentials aren't configured (local dev, tests). */
export class NoopCustomClaimsWriter implements CustomClaimsWriter {
	async setOrgRole(): Promise<void> {}
	async addVolunteerFestival(): Promise<void> {}
}
