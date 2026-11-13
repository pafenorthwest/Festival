import {
	type AppUserRecord,
	type AuthenticatedUser,
	type AuthLoginProvider,
	deriveDisplayName,
} from "@festival/common";
import { sql } from "bun";
import {
	defaultPostgresSchemaName,
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s09-infra.js";
import { type AppUserRow, mapAppUser } from "./tenant-mappers.js";

export interface UpsertAppUserInput {
	firebaseUid: string;
	email: string;
	fullName?: string;
}

export interface InsertLoginEventInput {
	userId: string;
	firebaseUid: string;
	provider: AuthLoginProvider;
	ipAddress?: string;
	userAgent?: string;
}

export interface AppUserRepository {
	ensureReady(): Promise<void>;
	findAppUserByFirebaseUid(firebaseUid: string): Promise<AppUserRecord | null>;
	upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord>;
	insertLoginEvent(input: InsertLoginEventInput): Promise<void>;
}

export function appUserInputFromIdentity(
	user: AuthenticatedUser,
): UpsertAppUserInput {
	return {
		firebaseUid: user.uid,
		email: user.email.toLowerCase(),
		fullName: user.displayName ?? deriveDisplayName(user),
	};
}

/** PostgreSQL implementation of AppUserRepository for app_user and user_login_event. */
export class PostgresAppUserRepository implements AppUserRepository {
	private readonly schema: string;

	constructor(schemaName = defaultPostgresSchemaName()) {
		this.schema = postgresSchemaName(schemaName);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async findAppUserByFirebaseUid(
		firebaseUid: string,
	): Promise<AppUserRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id::text, firebase_uid, email, full_name, is_active, created_at, updated_at
			 FROM ${this.schema}.app_user
			 WHERE firebase_uid = $1
			 LIMIT 1`,
			[firebaseUid],
		)) as AppUserRow[];
		return rows[0] ? mapAppUser(rows[0]) : null;
	}

	async upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.app_user (firebase_uid, email, full_name)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (firebase_uid) DO UPDATE SET
			   email = EXCLUDED.email,
			   full_name = COALESCE(EXCLUDED.full_name, ${this.schema}.app_user.full_name),
			   updated_at = NOW()
			 RETURNING id::text, firebase_uid, email, full_name, is_active, created_at, updated_at`,
			[input.firebaseUid, input.email.toLowerCase(), input.fullName ?? null],
		)) as AppUserRow[];
		if (!rows[0]) throw new Error("Failed to upsert app_user.");
		return mapAppUser(rows[0]);
	}

	async insertLoginEvent(input: InsertLoginEventInput): Promise<void> {
		await this.ensureReady();
		await sql.unsafe(
			`INSERT INTO ${this.schema}.user_login_event
			   (user_id, firebase_uid, provider, ip_address, user_agent)
			 VALUES ($1::uuid, $2, $3, $4::inet, $5)`,
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
