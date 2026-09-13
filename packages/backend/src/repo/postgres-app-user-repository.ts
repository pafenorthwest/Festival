import type { AppUserRecord } from "@festival/common";
import { sql } from "bun";
import type {
	AppUserRepository,
	InsertLoginEventInput,
	UpsertAppUserInput,
} from "./app-user-repository.js";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "./postgres-schema.js";

interface AppUserRow {
	id: string;
	firebase_uid: string;
	email: string;
	full_name: string | null;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

function mapAppUser(row: AppUserRow): AppUserRecord {
	return {
		id: row.id,
		firebaseUid: row.firebase_uid,
		email: row.email,
		fullName: row.full_name ?? undefined,
		isActive: row.is_active,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

export class PostgresAppUserRepository implements AppUserRepository {
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async findAppUserByFirebaseUid(
		firebaseUid: string,
	): Promise<AppUserRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT id, firebase_uid, email, full_name, is_active, created_at, updated_at
			 FROM ${this.schema}.app_user
			 WHERE firebase_uid = $1
			 LIMIT 1`,
			[firebaseUid],
		)) as AppUserRow[];

		return rows[0] ? mapAppUser(rows[0]) : null;
	}

	async upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord> {
		await this.ensureReady();

		const email = input.email.trim().toLowerCase();
		if (!email) {
			throw new Error("App user email is required.");
		}

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.app_user (
				firebase_uid,
				email,
				full_name
			) VALUES ($1, $2, $3)
			ON CONFLICT (firebase_uid) DO UPDATE
			SET
				email = excluded.email,
				full_name = excluded.full_name,
				updated_at = NOW()
			RETURNING id, firebase_uid, email, full_name, is_active, created_at, updated_at`,
			[input.firebaseUid, email, input.fullName?.trim() || null],
		)) as AppUserRow[];

		return mapAppUser(row);
	}

	async insertLoginEvent(input: InsertLoginEventInput): Promise<void> {
		await this.ensureReady();

		await sql.unsafe(
			`INSERT INTO ${this.schema}.user_login_event (
				user_id,
				firebase_uid,
				provider,
				ip_address,
				user_agent
			) VALUES ($1, $2, $3, $4, $5)`,
			[
				input.userId,
				input.firebaseUid,
				input.provider,
				input.ipAddress ?? null,
				input.userAgent ?? null,
			],
		);
	}
}
