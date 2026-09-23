import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminOrgRoutes } from "../src/routes/admin-org/admin-org.routes.js";
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
	app.route("/", buildAdminOrgRoutes({ organizationService, authVerifier }));

	return { app, organization, repository };
}

describe("admin org routes", () => {
	describe("GET /organizations/:slug/admin/users", () => {
		it("returns 200 and users list when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/users`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.users).toBeDefined();
			expect(Array.isArray(body.users)).toBe(true);
		});

		it("returns 403 for unauthorized users", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/users`,
				{
					headers: { Authorization: "Bearer outsider" },
				},
			);
			expect(response.status).toBe(403);
		});
	});

	describe("GET /organizations/:slug/admin/festivals", () => {
		it("returns 200 when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/admin/festivals`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.festivals).toBeDefined();
			expect(Array.isArray(body.festivals)).toBe(true);
		});
	});
});
