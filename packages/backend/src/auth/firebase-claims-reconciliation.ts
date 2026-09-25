import type { OrganizationRole } from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../repo/postgres-schema.js";
import type { VolunteerIntentClaims } from "./custom-claims.js";

/** The Postgres-owned data used to rebuild Festival's managed Firebase claims. */
export interface FirebaseClaimsSource {
	listUids(): Promise<string[]>;
	loadClaims(uid: string): Promise<VolunteerIntentClaims>;
}

/**
 * Deliberately separate from the best-effort request-time writer: a scheduler
 * must be able to observe a failed write and exit non-zero.
 */
export interface FirebaseClaimsReconciliationWriter {
	replaceVolunteerIntentClaims(
		uid: string,
		loadClaims: () => Promise<VolunteerIntentClaims>,
	): Promise<void>;
}

interface ClaimRow {
	firebase_uid: string;
	organization_id: string;
	role: OrganizationRole | null;
	festival_id: string | null;
}

/** Reads every Firebase UID that has a Festival membership or volunteer record. */
export class PostgresFirebaseClaimsSource implements FirebaseClaimsSource {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async listUids(): Promise<string[]> {
		await initializePostgresSchema(this.schema);
		const rows = (await sql.unsafe(
			`SELECT firebase_uid FROM ${this.schema}.users ORDER BY firebase_uid`,
		)) as Array<{ firebase_uid: string }>;
		return rows.map((row) => row.firebase_uid);
	}

	async loadClaims(uid: string): Promise<VolunteerIntentClaims> {
		const rows = (await sql.unsafe(
			`SELECT u.firebase_uid, m.organization_id, m.role, NULL::text AS festival_id
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.users u ON u.id = m.user_id
			 WHERE u.firebase_uid = $1
			 UNION ALL
			 SELECT firebase_uid, organization_id, NULL::text AS role, festival_id
			 FROM ${this.schema}.volunteers
			 WHERE firebase_uid = $1`,
			[uid],
		)) as ClaimRow[];

		const claims: VolunteerIntentClaims = {};
		for (const row of rows) {
			if (row.role) {
				claims.orgRoles = {
					...claims.orgRoles,
					[row.organization_id]: row.role,
				};
			}
			if (row.festival_id) {
				const festivals =
					claims.volunteerFestivals?.[row.organization_id] ?? [];
				claims.volunteerFestivals = {
					...claims.volunteerFestivals,
					[row.organization_id]: festivals.includes(row.festival_id)
						? festivals
						: [...festivals, row.festival_id],
				};
			}
		}
		return claims;
	}
}

export interface FirebaseClaimsReconciliationResult {
	discoveredCount: number;
	processedCount: number;
	failedCount: number;
}

export class FirebaseClaimsReconciliationService {
	constructor(
		private readonly source: FirebaseClaimsSource,
		private readonly writer: FirebaseClaimsReconciliationWriter,
	) {}

	async reconcile(): Promise<FirebaseClaimsReconciliationResult> {
		const uids = await this.source.listUids();
		let processedCount = 0;
		let failedCount = 0;
		for (const uid of uids) {
			try {
				await this.writer.replaceVolunteerIntentClaims(uid, () =>
					this.source.loadClaims(uid),
				);
				processedCount += 1;
			} catch (error) {
				failedCount += 1;
				console.error("Failed to reconcile Firebase custom claims", {
					uid,
					error,
				});
			}
		}
		return { discoveredCount: uids.length, processedCount, failedCount };
	}
}
