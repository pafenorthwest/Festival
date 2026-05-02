import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryAppUserRepository } from "../src/repo/in-memory-app-user-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) {
			throw new AppError(`Unknown token ${token}`, 401);
		}

		return user;
	}
}

async function createTestApp() {
	const appUserRepository = new InMemoryAppUserRepository();
	const result = await createApp({
		env: { port: 3000 },
		repository: new InMemoryOrganizationRepository(),
		appUserRepository,
		authVerifier: new FakeAuthVerifier({
			user: {
				uid: "firebase-user",
				email: "USER@example.com",
				displayName: "User One",
			},
			renamed: {
				uid: "firebase-user",
				email: "renamed@example.com",
				displayName: "Renamed User",
			},
		}),
	});

	return { ...result, appUserRepository };
}

function withAuth(token: string, init?: RequestInit): RequestInit {
	return {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			...(init?.headers ?? {}),
		},
	};
}

describe("auth routes", () => {
	it("syncs a new user and updates an existing user without duplicates", async () => {
		const { app } = await createTestApp();

		const createResponse = await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);
		expect(createResponse.status).toBe(200);
		const created = (await createResponse.json()) as {
			user: {
				id: string;
				firebaseUid: string;
				email: string;
				fullName: string;
			};
		};
		expect(created.user.firebaseUid).toBe("firebase-user");
		expect(created.user.email).toBe("user@example.com");
		expect(created.user.fullName).toBe("User One");

		const updateResponse = await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("renamed", { method: "POST" }),
			),
		);
		expect(updateResponse.status).toBe(200);
		const updated = (await updateResponse.json()) as {
			user: { id: string; email: string; fullName: string };
		};
		expect(updated.user.id).toBe(created.user.id);
		expect(updated.user.email).toBe("renamed@example.com");
		expect(updated.user.fullName).toBe("Renamed User");
	});

	it("returns the current synced user", async () => {
		const { app } = await createTestApp();
		await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);

		const response = await app.fetch(
			new Request("http://test/api/v1/auth/me", withAuth("user")),
		);

		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			user: { firebaseUid: string; email: string; fullName: string };
		};
		expect(data.user).toMatchObject({
			firebaseUid: "firebase-user",
			email: "user@example.com",
			fullName: "User One",
		});
	});

	it("requires sync before current user and login event endpoints", async () => {
		const { app } = await createTestApp();

		const meResponse = await app.fetch(
			new Request("http://test/api/v1/auth/me", withAuth("user")),
		);
		expect(meResponse.status).toBe(404);

		const loginResponse = await app.fetch(
			new Request(
				"http://test/api/v1/auth/login-event",
				withAuth("user", {
					method: "POST",
					body: JSON.stringify({ provider: "google" }),
				}),
			),
		);
		expect(loginResponse.status).toBe(404);
	});

	it("records login metadata for a synced user", async () => {
		const { app, appUserRepository } = await createTestApp();
		await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/v1/auth/login-event",
				withAuth("user", {
					method: "POST",
					body: JSON.stringify({ provider: "google" }),
					headers: {
						"user-agent": "Festival Route Test",
						"x-forwarded-for": "203.0.113.20, 198.51.100.1",
					},
				}),
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: "ok" });
		expect(appUserRepository.getLoginEvents()).toHaveLength(1);
		expect(appUserRepository.getLoginEvents()[0]).toMatchObject({
			firebaseUid: "firebase-user",
			provider: "google",
			ipAddress: "203.0.113.20",
			userAgent: "Festival Route Test",
		});
	});

	it("rejects missing, invalid, and malformed auth requests", async () => {
		const { app } = await createTestApp();

		const missing = await app.fetch(
			new Request("http://test/api/v1/auth/sync", { method: "POST" }),
		);
		expect(missing.status).toBe(401);

		const malformed = await app.fetch(
			new Request("http://test/api/v1/auth/sync", {
				method: "POST",
				headers: { Authorization: "Basic abc" },
			}),
		);
		expect(malformed.status).toBe(401);

		const invalid = await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("unknown", { method: "POST" }),
			),
		);
		expect(invalid.status).toBe(401);
	});

	it("validates login provider", async () => {
		const { app } = await createTestApp();
		await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/v1/auth/login-event",
				withAuth("user", {
					method: "POST",
					body: JSON.stringify({ provider: "github" }),
				}),
			),
		);

		expect(response.status).toBe(400);
	});

	it("rejects non-object login event bodies", async () => {
		const { app } = await createTestApp();
		await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/v1/auth/login-event",
				withAuth("user", {
					method: "POST",
					body: "null",
				}),
			),
		);

		expect(response.status).toBe(400);
	});
});
