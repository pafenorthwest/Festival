import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const users: Record<string, AuthenticatedUser> = {
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider",
			},
		};
		const user = users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const organization = await repository.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});
	const user = await repository.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: user.id,
		role: "Admin",
		origin: "creator",
	});
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuth(),
	});
	return { app, organization };
}

describe("org-info routes", () => {
	describe("GET /api/organizations/:slug (tenant)", () => {
		it("returns org landing for an authenticated tenant member", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe", {
				headers: { Authorization: "Bearer admin" },
			});
			expect(response.status).toBe(200);
		});

		it("returns 401 for an unauthenticated request", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe");
			expect(response.status).toBe(401);
		});

		it("returns 403 for a user who is not a member of the org", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe", {
				headers: { Authorization: "Bearer outsider" },
			});
			expect(response.status).toBe(403);
		});
	});

	describe("POST /api/organizations/:slug/welcome/dismiss (tenant)", () => {
		it("returns 200 for an authenticated admin member", async () => {
			const { app } = await createTestApp();
			const response = await app.request(
				"/api/organizations/pafe/welcome/dismiss",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: "{}",
				},
			);
			expect(response.status).toBe(200);
		});

		it("returns 401 for an unauthenticated request", async () => {
			const { app } = await createTestApp();
			const response = await app.request(
				"/api/organizations/pafe/welcome/dismiss",
				{
					method: "POST",
				},
			);
			expect(response.status).toBe(401);
		});
	});

	describe("GET /api/organizations/:slug/primary (public)", () => {
		// getPrimaryFestivalPath returns { status: 404, path: "" } for fresh org (no festivals)
		// This is a 200 OK JSON response — not an HTTP 404
		it("returns 200 with primary festival path (404 status field for no primary)", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe/primary");
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toMatchObject({ status: 404, path: "" });
		});
	});

	describe("GET /api/organizations/:slug/festivals/:festivalShortName (public)", () => {
		// getPublicFestival throws AppError("Festival not found.", 404) for non-existent festival
		it("returns 404 for a non-existent festival", async () => {
			const { app } = await createTestApp();
			const response = await app.request(
				"/api/organizations/pafe/festivals/spring-2027",
			);
			expect(response.status).toBe(404);
		});
	});

	describe("GET /api/organizations/:slug/divisions (public)", () => {
		// listPublicDivisions returns { divisions: [] } for fresh org — 200 OK
		it("returns 200 with an empty divisions list", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe/divisions");
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toMatchObject({ divisions: [] });
		});
	});

	describe("GET /api/organizations/:slug/landing (public)", () => {
		// getPublicLanding returns { organization, festivals: [] } for fresh org — 200 OK
		it("returns 200 with org landing data", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/api/organizations/pafe/landing");
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toMatchObject({
				organization: { name: "Pacific Festival", slug: "pafe" },
				festivals: [],
			});
		});
	});
});
