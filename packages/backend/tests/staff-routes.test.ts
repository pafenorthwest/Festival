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
			chair: {
				uid: "uid-chair",
				email: "chair@example.com",
				displayName: "Chair",
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

	const chair = await repository.upsertUser({
		uid: "uid-chair",
		email: "chair@example.com",
		displayName: "Chair",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: chair.id,
		role: "Division Chair",
		origin: "invite",
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
	describe("GET /organizations/:slug/admin/entitlements", () => {
		const get = (
			app: Hono,
			slug: string,
			token: string | undefined,
			query = "",
		) =>
			app.request(`/organizations/${slug}/admin/entitlements${query}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {},
			});

		it("returns the report with a no-store header for an admin", async () => {
			const { app, organization } = await createTestApp();
			const response = await get(app, organization.slug, "admin");
			expect(response.status).toBe(200);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(await response.json()).toEqual({
				entries: [],
				total: 0,
				page: 1,
				pageSize: 25,
				totalPages: 1,
				divisions: [],
			});
		});

		it("accepts page, pageSize, and division filters", async () => {
			const { app, organization } = await createTestApp();
			const response = await get(
				app,
				organization.slug,
				"admin",
				"?page=2&pageSize=10&divisionId=d1",
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				page: 1,
				pageSize: 10,
				total: 0,
			});
		});

		it("rejects unauthenticated callers", async () => {
			const { app, organization } = await createTestApp();
			expect((await get(app, organization.slug, undefined)).status).toBe(401);
		});

		it("rejects non-admin members and non-members", async () => {
			const { app, organization } = await createTestApp();
			expect((await get(app, organization.slug, "chair")).status).toBe(403);
			expect((await get(app, organization.slug, "outsider")).status).toBe(403);
		});

		it("rejects an admin of another organization", async () => {
			const { app, repository } = await createTestApp();
			const other = await repository.createOrganization({
				name: "Other Festival",
				slug: "other",
			});
			expect((await get(app, other.slug, "admin")).status).toBe(403);
		});

		it("rejects invalid filters", async () => {
			const { app, organization } = await createTestApp();
			expect(
				(await get(app, organization.slug, "admin", "?status=bogus")).status,
			).toBe(400);
			expect(
				(await get(app, organization.slug, "admin", "?entitlementClass=bogus"))
					.status,
			).toBe(400);
			for (const query of [
				"?page=0",
				"?page=abc",
				"?pageSize=0",
				"?pageSize=101",
				`?divisionId=${"x".repeat(201)}`,
			]) {
				expect((await get(app, organization.slug, "admin", query)).status).toBe(
					400,
				);
			}
		});

		it("returns 503 when the membership service is not configured", async () => {
			const { app, organization } = await createTestApp(false);
			expect((await get(app, organization.slug, "admin")).status).toBe(503);
		});
	});
});
