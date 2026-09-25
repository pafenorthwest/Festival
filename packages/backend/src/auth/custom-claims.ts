import type { OrganizationRole } from "@festival/common";

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
 * Writes claims are never allowed to fail the request that triggered
 * them — creating an org, accepting an invite, and enrolling as a
 * volunteer must all succeed even if this fails (e.g. missing Firebase
 * write credentials, a transient Admin SDK error).
 */
export class FirebaseCustomClaimsWriter implements CustomClaimsWriter {
	constructor(private readonly auth: FirebaseAuthLike) {}

	private async withClaims(
		uid: string,
		update: (current: VolunteerIntentClaims) => VolunteerIntentClaims,
	): Promise<void> {
		try {
			const user = await this.auth.getUser(uid);
			const current = (user.customClaims ?? {}) as VolunteerIntentClaims;
			await this.auth.setCustomUserClaims(uid, update(current));
		} catch (error) {
			console.error("Failed to update Firebase custom claims", error);
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
}

/** Used when Firebase write credentials aren't configured (local dev, tests). */
export class NoopCustomClaimsWriter implements CustomClaimsWriter {
	async setOrgRole(): Promise<void> {}
	async addVolunteerFestival(): Promise<void> {}
}
