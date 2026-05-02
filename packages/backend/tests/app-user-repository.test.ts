import { describe, expect, it } from "bun:test";
import { InMemoryAppUserRepository } from "../src/repo/in-memory-app-user-repository.js";
import { buildAppUserMigrationSql } from "../src/repo/postgres-app-user-repository.js";

describe("app user repository", () => {
	it("builds the app user and login event schema without organization tables", () => {
		const ddl = buildAppUserMigrationSql("tenant_schema").replace(/\s+/g, " ");

		expect(ddl).toContain("CREATE TABLE IF NOT EXISTS tenant_schema.app_user");
		expect(ddl).toContain("id UUID PRIMARY KEY DEFAULT gen_random_uuid()");
		expect(ddl).toContain("firebase_uid VARCHAR(128) NOT NULL UNIQUE");
		expect(ddl).toContain("email VARCHAR(320) NOT NULL");
		expect(ddl).toContain("full_name VARCHAR(255)");
		expect(ddl).toContain("is_active BOOLEAN NOT NULL DEFAULT TRUE");
		expect(ddl).toContain(
			"CREATE TABLE IF NOT EXISTS tenant_schema.user_login_event",
		);
		expect(ddl).toContain(
			"user_id UUID NOT NULL REFERENCES tenant_schema.app_user(id) ON DELETE CASCADE",
		);
		expect(ddl).toContain("ip_address INET");
		expect(ddl).toContain("CREATE INDEX IF NOT EXISTS idx_user_login_user_id");
		expect(ddl).toContain(
			"CREATE INDEX IF NOT EXISTS idx_user_login_firebase_uid",
		);
		expect(ddl).toContain(
			"CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_lower",
		);
		expect(ddl).not.toContain("organizations");
		expect(ddl).not.toContain("memberships");
		expect(ddl).not.toContain("invites");
	});

	it("upserts users by Firebase UID and updates changed profile fields", async () => {
		const repository = new InMemoryAppUserRepository();

		const created = await repository.upsertAppUser({
			firebaseUid: "firebase-1",
			email: "USER@example.com",
			fullName: "Original Name",
		});
		const updated = await repository.upsertAppUser({
			firebaseUid: "firebase-1",
			email: "updated@example.com",
			fullName: "Updated Name",
		});

		expect(updated.id).toBe(created.id);
		expect(updated.email).toBe("updated@example.com");
		expect(updated.fullName).toBe("Updated Name");
		await expect(
			repository.findAppUserByFirebaseUid("firebase-1"),
		).resolves.toEqual(updated);
	});

	it("enforces case-insensitive email uniqueness", async () => {
		const repository = new InMemoryAppUserRepository();
		await repository.upsertAppUser({
			firebaseUid: "firebase-1",
			email: "User@Example.com",
			fullName: "First User",
		});

		await expect(
			repository.upsertAppUser({
				firebaseUid: "firebase-2",
				email: "user@example.com",
				fullName: "Second User",
			}),
		).rejects.toThrow("App user email already exists: user@example.com");
	});

	it("records append-only login events", async () => {
		const repository = new InMemoryAppUserRepository();
		const user = await repository.upsertAppUser({
			firebaseUid: "firebase-1",
			email: "user@example.com",
			fullName: "User Name",
		});

		await repository.insertLoginEvent({
			userId: user.id,
			firebaseUid: user.firebaseUid,
			provider: "google",
			ipAddress: "203.0.113.10",
			userAgent: "Festival Tests",
		});
		await repository.insertLoginEvent({
			userId: user.id,
			firebaseUid: user.firebaseUid,
			provider: "password",
		});

		const events = repository.getLoginEvents();
		expect(events).toHaveLength(2);
		expect(events[0]).toMatchObject({
			userId: user.id,
			firebaseUid: "firebase-1",
			provider: "google",
			ipAddress: "203.0.113.10",
			userAgent: "Festival Tests",
		});
		expect(events[1]).toMatchObject({
			userId: user.id,
			firebaseUid: "firebase-1",
			provider: "password",
		});
	});
});
