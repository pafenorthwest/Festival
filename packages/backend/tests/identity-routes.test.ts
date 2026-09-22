import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { Hono } from "hono";
import { buildIdentityRoutes } from "../src/routes/identity/identity.routes.js";
import { OrganizationService } from "../src/services/organization-service.js";

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
	
	const authVerifier = new FakeAuth();
	const organizationService = new OrganizationService(repository);
	const app = new Hono();
	app.route("/", buildIdentityRoutes({ organizationService, authVerifier }));

	return { app, organization, repository };
}

describe("identity routes", () => {
	describe("GET /bootstrap", () => {
		it("returns session data for unauthenticated request", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/bootstrap");
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.session.authenticated).toBe(false);
			expect(body.session.user).toBeUndefined();
		});

		it("returns 400 when Authorization header is present", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/bootstrap", {
				headers: { Authorization: "Bearer admin" },
			});
			expect(response.status).toBe(400);
		});
	});

	describe("GET /firebase-session", () => {
		it("returns session data for authenticated user", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/firebase-session", {
				headers: { Authorization: "Bearer admin" },
			});
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.session.authenticated).toBe(true);
			expect(body.session.user).toBeDefined();
			expect(body.session.user.uid).toBe("uid-admin");
		});

		it("returns 401 for unauthenticated request", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/firebase-session");
			expect(response.status).toBe(401);
		});
	});

	describe("GET /memberships", () => {
		it("returns memberships for authenticated user", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/memberships", {
				headers: { Authorization: "Bearer admin" },
			});
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.memberships).toBeInstanceOf(Array);
			expect(body.memberships.length).toBe(1);
			expect(body.memberships[0].organizationSlug).toBe("pafe");
		});

		it("returns empty array for user with no memberships", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/memberships", {
				headers: { Authorization: "Bearer outsider" },
			});
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.memberships).toBeInstanceOf(Array);
			expect(body.memberships.length).toBe(0);
		});
	});

	describe("POST /organizations", () => {
		it("creates a new organization for authenticated user", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/organizations", {
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ name: "New Festival", shortName: "newfest" }),
			});
			if (response.status !== 201) {
				console.error(await response.text());
			}
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.organization.slug).toBe("newfest");
		});
	});

	describe("POST /invites", () => {
		it("creates an invite when user is admin of the org", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/invites", {
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ organizationSlug: "pafe", role: "Admin", email: "invitee@example.com" }),
			});
			if (response.status !== 201) {
				console.error(await response.text());
			}
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.invite.token).toBeDefined();
		});

		it("returns 403 when user is not a member of the org", async () => {
			const { app } = await createTestApp();
			const response = await app.request("/invites", {
				method: "POST",
				headers: {
					Authorization: "Bearer outsider",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ organizationSlug: "pafe", role: "Admin" }),
			});
			expect(response.status).toBe(403);
		});
	});
});
