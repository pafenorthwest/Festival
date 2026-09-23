import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildStaffRoutes } from "../src/routes/staff/staff.routes.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";

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

async function createTestApp(withAccompanistService = true) {
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
	const accompanistMembershipService = withAccompanistService
		? new AccompanistMembershipService(repository)
		: undefined;

	const app = new Hono();
	app.route(
		"/",
		buildStaffRoutes({
			repository,
			authVerifier,
			accompanistMembershipService,
		}),
	);

	return { app, organization, repository };
}

describe("staff routes", () => {
	describe("GET /organizations/:slug/staff/accompanists", () => {
		it("returns 200 and roster when requested by an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/staff/accompanists`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.accompanists).toBeDefined();
			expect(Array.isArray(body.accompanists)).toBe(true);
		});

		it("returns 503 when AccompanistMembershipService is undefined", async () => {
			const { app, organization } = await createTestApp(false);
			const response = await app.request(
				`/organizations/${organization.slug}/staff/accompanists`,
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.error).toBe("Accompanist roster is unavailable.");
		});

		it("returns 403 for unauthorized users", async () => {
			const { app, organization } = await createTestApp();
			const response = await app.request(
				`/organizations/${organization.slug}/staff/accompanists`,
				{
					headers: { Authorization: "Bearer outsider" },
				},
			);
			expect(response.status).toBe(403);
		});
	});
});
