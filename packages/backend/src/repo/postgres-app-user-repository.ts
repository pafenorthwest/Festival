import type { AppUserRecord } from "@festival/common";
import { sql } from "bun";
import type {
	AppUserRepository,
	InsertLoginEventInput,
	UpsertAppUserInput,
} from "./app-user-repository.js";

interface AppUserRow {
	id: string;
	firebase_uid: string;
	email: string;
	full_name: string | null;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

function sanitizeSchemaName(schema: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
		throw new Error(
			`Invalid DB_SCHEMA "${schema}". Only letters, digits, and underscores are allowed, and the name must not start with a digit.`,
		);
	}

	return schema;
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

export function buildAppUserMigrationSql(schema: string): string {
	const safeSchema = sanitizeSchemaName(schema);

	return `
		CREATE EXTENSION IF NOT EXISTS pgcrypto;

		CREATE TABLE IF NOT EXISTS ${safeSchema}.app_user (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			firebase_uid VARCHAR(128) NOT NULL UNIQUE,
			email VARCHAR(320) NOT NULL,
			full_name VARCHAR(255),
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE TABLE IF NOT EXISTS ${safeSchema}.user_login_event (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID NOT NULL REFERENCES ${safeSchema}.app_user(id) ON DELETE CASCADE,
			firebase_uid VARCHAR(128) NOT NULL,
			provider VARCHAR(64) NOT NULL,
			ip_address INET,
			user_agent TEXT,
			login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_user_login_user_id
			ON ${safeSchema}.user_login_event(user_id);

		CREATE INDEX IF NOT EXISTS idx_user_login_firebase_uid
			ON ${safeSchema}.user_login_event(firebase_uid);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower
			ON ${safeSchema}.app_user(lower(email));
	`;
}

export class PostgresAppUserRepository implements AppUserRepository {
	private readonly schema: string;
	private readyPromise?: Promise<void>;

	constructor(schema: string) {
		this.schema = sanitizeSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		this.readyPromise ??= this.runMigrations();
		await this.readyPromise;
	}

	private async runMigrations(): Promise<void> {
		await sql.unsafe(buildAppUserMigrationSql(this.schema));
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
