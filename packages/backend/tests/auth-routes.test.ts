import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryAppUserRepository } from "../src/repo/in-memory-app-user-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	assertRouteSecurityInventory,
	CURRENT_ROUTE_SECURITY,
} from "../src/routes/route-security.js";

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

async function createTestApp(trustProxyHeaders = false) {
	const appUserRepository = new InMemoryAppUserRepository();
	const result = await createApp({
		env: { port: 3000, trustProxyHeaders },
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
	it("allows local frontend CORS preflights for Firebase session requests", async () => {
		const { app } = await createTestApp();

		const response = await app.fetch(
			new Request("http://test/api/firebase-session", {
				method: "OPTIONS",
				headers: {
					Origin: "http://localhost:5173",
					"Access-Control-Request-Method": "GET",
					"Access-Control-Request-Headers": "authorization,content-type",
				},
			}),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5173",
		);
		expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
			"Authorization",
		);
	});

	it("does not allow unconfigured CORS origins for bootstrap requests", async () => {
		const { app } = await createTestApp();

		const response = await app.fetch(
			new Request("http://test/api/bootstrap", {
				headers: { Origin: "http://malicious.test" },
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("allows the supported localhost, IPv4, and IPv6 development origins", async () => {
		const { app } = await createTestApp();
		const origins = ["localhost", "127.0.0.1", "[::1]"].flatMap((host) =>
			[5172, 5173, 8080].map((port) => `http://${host}:${port}`),
		);

		for (const origin of origins) {
			const response = await app.fetch(
				new Request("http://test/api/bootstrap", {
					headers: { Origin: origin },
				}),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
		}
	});

	it("returns an anonymous bootstrap session without accepting credentials", async () => {
		const { app } = await createTestApp();

		const response = await app.fetch(new Request("http://test/api/bootstrap"));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			session: { authenticated: false },
		});

		const credentialedResponse = await app.fetch(
			new Request("http://test/api/bootstrap", withAuth("user")),
		);
		expect(credentialedResponse.status).toBe(400);
		expect(await credentialedResponse.json()).toEqual({
			error: "Authorization is not accepted on the bootstrap route.",
		});
	});

	it("requires a valid Firebase token for a session without requiring membership", async () => {
		const { app } = await createTestApp();

		const missingResponse = await app.fetch(
			new Request("http://test/api/firebase-session"),
		);
		expect(missingResponse.status).toBe(401);

		const invalidResponse = await app.fetch(
			new Request("http://test/api/firebase-session", withAuth("unknown")),
		);
		expect(invalidResponse.status).toBe(401);

		const response = await app.fetch(
			new Request("http://test/api/firebase-session", withAuth("user")),
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			session: Record<string, unknown>;
		};
		expect(payload).toMatchObject({
			session: {
				authenticated: true,
				user: { uid: "firebase-user", email: "user@example.com" },
			},
		});
		expect(payload.session).not.toHaveProperty("membership");
	});

	it("fails startup validation for missing and duplicate route declarations", () => {
		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/only-route" }],
				[],
			),
		).toThrow("Undeclared routes: GET /only-route.");

		expect(() =>
			assertRouteSecurityInventory(
				[{ method: "GET", path: "/health" }],
				[CURRENT_ROUTE_SECURITY[0], CURRENT_ROUTE_SECURITY[0]],
			),
		).toThrow("Duplicate route security declaration: GET /health");
	});

	it("keeps backend health private and minimal", async () => {
		const { app } = await createTestApp();

		const privateResponse = await app.fetch(
			new Request("http://backend-internal/health"),
		);
		expect(privateResponse.status).toBe(200);
		expect(await privateResponse.json()).toEqual({ status: "ok" });

		const publicApiResponse = await app.fetch(
			new Request("http://test/api/health"),
		);
		expect(publicApiResponse.status).toBe(404);
	});

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

	it("does not trust forwarding metadata from a direct client", async () => {
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
			userAgent: "Festival Route Test",
		});
		expect(appUserRepository.getLoginEvents()[0]?.ipAddress).toBeUndefined();
	});

	it("accepts replaced forwarding metadata only behind the configured proxy boundary", async () => {
		const { app, appUserRepository } = await createTestApp(true);
		await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("user", { method: "POST" }),
			),
		);

		await app.fetch(
			new Request(
				"http://test/api/v1/auth/login-event",
				withAuth("user", {
					method: "POST",
					body: JSON.stringify({ provider: "google" }),
					headers: { "x-forwarded-for": "203.0.113.20, 198.51.100.1" },
				}),
			),
		);

		expect(appUserRepository.getLoginEvents()[0]?.ipAddress).toBe(
			"203.0.113.20",
		);
	});

	it("rejects unsupported mutation content types and oversized bodies", async () => {
		const { app } = await createTestApp();
		const wrongType = await app.fetch(
			new Request("http://test/api/v1/auth/login-event", {
				method: "POST",
				headers: {
					Authorization: "Bearer user",
					"Content-Type": "text/plain",
				},
				body: "not-json",
			}),
		);
		expect(wrongType.status).toBe(415);

		const oversized = await app.fetch(
			new Request("http://test/api/organizations", {
				method: "POST",
				headers: {
					Authorization: "Bearer user",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "x".repeat(70_000) }),
			}),
		);
		expect(oversized.status).toBe(413);
		expect(await oversized.json()).toEqual({
			error: "Request body is too large.",
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

		const extraTokenSegment = await app.fetch(
			new Request("http://test/api/v1/auth/sync", {
				method: "POST",
				headers: { Authorization: "Bearer user unexpected" },
			}),
		);
		expect(extraTokenSegment.status).toBe(401);

		const invalid = await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth("unknown", { method: "POST" }),
			),
		);
		expect(invalid.status).toBe(401);
		expect(await invalid.text()).not.toContain("unknown");

		const canaryToken = "bearer-secret-canary";
		const canaryResponse = await app.fetch(
			new Request(
				"http://test/api/v1/auth/sync",
				withAuth(canaryToken, { method: "POST" }),
			),
		);
		expect(canaryResponse.status).toBe(401);
		expect(await canaryResponse.text()).not.toContain(canaryToken);
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
