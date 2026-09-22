import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { OrganizationService } from "../src/services/organization-service.js";
import { buildAdminRegistrationRoutes } from "../src/routes/admin-registration/admin-registration.routes.js";

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
	const organizationService = new OrganizationService(repository);
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

	const app = new Hono();
	app.route("/", buildAdminRegistrationRoutes({ organizationService, authVerifier }));

	return { app, organization, repository };
}

describe("admin registration routes", () => {
	describe("GET /organizations/:slug/admin/accompanist-policy", () => {
		it("returns 200 and policy when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/accompanist-policy`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.policy).toBeDefined();
		});

		it("returns 403 for unauthorized users", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/accompanist-policy`,
				{
					headers: { Authorization: "Bearer outsider" },
				},
			);
			expect(response.status).toBe(403);
		});
	});

	describe("GET /organizations/:slug/admin/registration-configuration", () => {
		it("returns 200 when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/registration-configuration`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.classSubtypes).toBeDefined();
			expect(body.instruments).toBeDefined();
		});
	});

	describe("POST /organizations/:slug/admin/class-subtypes", () => {
		it("returns 201 when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/class-subtypes`,
				{
					method: "POST",
					headers: { 
						Authorization: "Bearer admin",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ displayName: "Solo" })
				},
			);
			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.value.displayName).toBe("Solo");
		});
	});
});
