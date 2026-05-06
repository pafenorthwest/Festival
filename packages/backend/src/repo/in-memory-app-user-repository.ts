import { randomUUID } from "node:crypto";
import type { AppUserRecord } from "@festival/common";
import type {
	AppUserRepository,
	InsertLoginEventInput,
	UpsertAppUserInput,
} from "./app-user-repository.js";

export interface InMemoryLoginEventRecord extends InsertLoginEventInput {
	id: string;
	loginAtIso: string;
}

/**
 * Test/local AppUserRepository implementation.
 *
 * createApp decides whether this is used: callers can inject it directly for
 * tests, and createApp falls back to it when no DB_SCHEMA-backed Postgres app
 * user repository can be constructed. Runtime environments with DB_SCHEMA use
 * PostgresAppUserRepository instead.
 */
export class InMemoryAppUserRepository implements AppUserRepository {
	private readonly users = new Map<string, AppUserRecord>();
	private readonly usersByFirebaseUid = new Map<string, string>();
	private readonly usersByLowerEmail = new Map<string, string>();
	private readonly loginEvents: InMemoryLoginEventRecord[] = [];

	async ensureReady(): Promise<void> {}

	async findAppUserByFirebaseUid(
		firebaseUid: string,
	): Promise<AppUserRecord | null> {
		const userId = this.usersByFirebaseUid.get(firebaseUid);
		if (!userId) {
			return null;
		}

		return this.users.get(userId) ?? null;
	}

	async upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord> {
		const email = input.email.trim().toLowerCase();
		if (!email) {
			throw new Error("App user email is required.");
		}

		const existingId = this.usersByFirebaseUid.get(input.firebaseUid);
		const conflictingUserId = this.usersByLowerEmail.get(email);
		if (conflictingUserId && conflictingUserId !== existingId) {
			throw new Error(`App user email already exists: ${email}`);
		}

		if (existingId) {
			const existing = this.users.get(existingId);
			if (!existing) {
				throw new Error(`App user not found for id ${existingId}`);
			}

			this.usersByLowerEmail.delete(existing.email.toLowerCase());
			const updated: AppUserRecord = {
				...existing,
				email,
				fullName: input.fullName?.trim() || undefined,
				updatedAtIso: new Date().toISOString(),
			};
			this.users.set(existingId, updated);
			this.usersByLowerEmail.set(email, existingId);
			return updated;
		}

		const now = new Date().toISOString();
		const created: AppUserRecord = {
			id: randomUUID(),
			firebaseUid: input.firebaseUid,
			email,
			fullName: input.fullName?.trim() || undefined,
			isActive: true,
			createdAtIso: now,
			updatedAtIso: now,
		};

		this.users.set(created.id, created);
		this.usersByFirebaseUid.set(created.firebaseUid, created.id);
		this.usersByLowerEmail.set(created.email.toLowerCase(), created.id);
		return created;
	}

	async insertLoginEvent(input: InsertLoginEventInput): Promise<void> {
		this.loginEvents.push({
			...input,
			id: randomUUID(),
			loginAtIso: new Date().toISOString(),
		});
	}

	getLoginEvents(): InMemoryLoginEventRecord[] {
		return [...this.loginEvents];
	}
}
