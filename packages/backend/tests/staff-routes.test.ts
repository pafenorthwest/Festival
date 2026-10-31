import { describe, expect, it } from "bun:test";
import {
	type AuthenticatedUser,
	addCalendarDays,
	type EntitlementReportResponse,
} from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildStaffRoutes } from "../src/routes/staff/staff.routes.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";

const FIXED_TEST_DATE = new Date("2026-06-01T12:00:00.000Z");

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

async function createTestApp(
	withAccompanistService = true,
	now: () => Date = () => FIXED_TEST_DATE,
) {
	const repository = new InMemoryOrganizationRepository(now);
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
		? new AccompanistMembershipService(repository, now)
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

async function seedDivisionsAndProduct(
	repo: InMemoryOrganizationRepository,
	orgId: string,
) {
	const piano = await repo.createDivision({
		organizationId: orgId,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const strings = await repo.createDivision({
		organizationId: orgId,
		displayName: "Strings",
		normalizedName: "strings",
	});
	const product = await repo.createMembershipProductRecord({
		organizationId: orgId,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/teacher",
		shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
		productNameSnapshot: "Annual Teacher Pass",
	});
	return { piano, strings, product };
}

async function seedTeacherGrants(
	repo: InMemoryOrganizationRepository,
	orgId: string,
	pianoId: string,
	pianoName: string,
	stringsId: string,
	stringsName: string,
	productId: string,
) {
	repo.setCustomerContact(orgId, {
		customerId: "c-alice",
		name: "Alice Adams",
		email: "alice@example.com",
	});
	repo.setCustomerContact(orgId, {
		customerId: "c-bob",
		email: "bob@example.com",
	});
	repo.setCustomerContact(orgId, {
		customerId: "c-dave",
		name: "Dave Davis",
		email: "dave@example.com",
	});

	for (const [id, divId, divName, startsOn, status] of [
		["c-alice", pianoId, pianoName, "2026-01-01", "active"],
		["c-bob", pianoId, pianoName, "2026-01-01", "active"],
		["c-dave", stringsId, stringsName, "2024-01-01", "expired"],
	] as const) {
		const endsOn = addCalendarDays(startsOn, 365);
		await repo.createEntitlementGrantSnapshot({
			organizationId: orgId,
			customerId: id,
			entitlementClass: "teacher_membership",
			offeringId: productId,
			durationDays: 365,
			divisionId: divId,
			divisionNameSnapshot: divName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: `checkout-${id}`,
			shopifyOrderGid: `gid://shopify/Order/${id}`,
			shopifyOrderLineGid: `gid://shopify/LineItem/${id}`,
			startsOn,
			endsOn,
			status,
			verifiedIdentityEmail: `${id}@example.com`,
		});
	}
}

async function seedAccompanistGrant(
	repo: InMemoryOrganizationRepository,
	orgId: string,
	stringsId: string,
	stringsName: string,
) {
	await repo.createAccompanistMembershipGrant({
		organizationId: orgId,
		customerId: "c-charlie",
		source: "accompanist_form",
		offeringNameSnapshot: "Accompanist Membership",
		startsOn: "2026-01-01",
		endsOn: "2027-01-01",
		contact: {
			name: "Charlie",
			email: "charlie@example.com",
			city: "Vancouver",
			phone: "+1 604 555 0100",
		},
		divisions: [{ divisionId: stringsId, divisionName: stringsName }],
		normalizedEmail: "charlie@example.com",
	});
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
	describe("staffRoutes - Admin Entitlement Report", () => {
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

		it("returns populated entries with status derivation and division mapping", async () => {
			const { app, organization, repository } = await createTestApp();
			const { piano, strings, product } = await seedDivisionsAndProduct(
				repository,
				organization.id,
			);
			await seedTeacherGrants(
				repository,
				organization.id,
				piano.id,
				piano.displayName,
				strings.id,
				strings.displayName,
				product.id,
			);
			await seedAccompanistGrant(
				repository,
				organization.id,
				strings.id,
				strings.displayName,
			);

			const response = await get(app, organization.slug, "admin");
			expect(response.status).toBe(200);
			expect(response.headers.get("Cache-Control")).toBe("no-store");

			const body = (await response.json()) as EntitlementReportResponse;
			expect(body.total).toBe(4);
			expect(body.page).toBe(1);
			expect(body.pageSize).toBe(25);
			expect(body.totalPages).toBe(1);
			expect(body.divisions).toEqual([
				{ divisionId: piano.id, divisionName: "Piano" },
				{ divisionId: strings.id, divisionName: "Strings" },
			]);

			const alice = body.entries.find(
				(e) => e.customerEmail === "alice@example.com",
			);
			expect(alice).toMatchObject({
				entitlementClass: "teacher_membership",
				customerName: "Alice Adams",
				customerEmail: "alice@example.com",
				offeringName: "Annual Teacher Pass",
				source: "teacher_checkout",
				status: "active",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				divisions: [{ divisionId: piano.id, divisionName: "Piano" }],
			});

			const charlie = body.entries.find(
				(e) => e.customerEmail === "charlie@example.com",
			);
			expect(charlie).toMatchObject({
				entitlementClass: "accompanist_membership",
				customerName: "Charlie",
				customerEmail: "charlie@example.com",
				offeringName: "Accompanist Membership",
				source: "accompanist_form",
				status: "active",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				divisions: [{ divisionId: strings.id, divisionName: "Strings" }],
			});

			const dave = body.entries.find(
				(e) => e.customerEmail === "dave@example.com",
			);
			expect(dave).toMatchObject({
				entitlementClass: "teacher_membership",
				customerName: "Dave Davis",
				customerEmail: "dave@example.com",
				status: "expired",
				divisions: [{ divisionId: strings.id, divisionName: "Strings" }],
			});
		});

		it("filters by query parameters and paginates over the HTTP route", async () => {
			const { app, organization, repository } = await createTestApp();
			const { piano, strings, product } = await seedDivisionsAndProduct(
				repository,
				organization.id,
			);
			await seedTeacherGrants(
				repository,
				organization.id,
				piano.id,
				piano.displayName,
				strings.id,
				strings.displayName,
				product.id,
			);
			await seedAccompanistGrant(
				repository,
				organization.id,
				strings.id,
				strings.displayName,
			);

			const activeRes = await get(
				app,
				organization.slug,
				"admin",
				"?status=active",
			);
			expect(activeRes.status).toBe(200);
			const activeBody = (await activeRes.json()) as EntitlementReportResponse;
			expect(activeBody.total).toBe(3);
			expect(activeBody.entries.every((e) => e.status === "active")).toBe(true);

			const expiredRes = await get(
				app,
				organization.slug,
				"admin",
				"?status=expired",
			);
			expect(expiredRes.status).toBe(200);
			const expiredBody =
				(await expiredRes.json()) as EntitlementReportResponse;
			expect(expiredBody.total).toBe(1);
			expect(expiredBody.entries[0].customerEmail).toBe("dave@example.com");

			const searchRes = await get(
				app,
				organization.slug,
				"admin",
				"?search=bob@example.com",
			);
			expect(searchRes.status).toBe(200);
			const searchBody = (await searchRes.json()) as EntitlementReportResponse;
			expect(searchBody.total).toBe(1);
			expect(searchBody.entries[0].customerEmail).toBe("bob@example.com");

			const divisionRes = await get(
				app,
				organization.slug,
				"admin",
				`?divisionId=${piano.id}`,
			);
			expect(divisionRes.status).toBe(200);
			const divisionBody =
				(await divisionRes.json()) as EntitlementReportResponse;
			expect(divisionBody.total).toBe(2);
			expect(
				divisionBody.entries.every((e) =>
					e.divisions.some((d) => d.divisionId === piano.id),
				),
			).toBe(true);

			const page1Res = await get(
				app,
				organization.slug,
				"admin",
				"?page=1&pageSize=2",
			);
			expect(page1Res.status).toBe(200);
			const page1Body = (await page1Res.json()) as EntitlementReportResponse;
			expect(page1Body.entries).toHaveLength(2);
			expect(page1Body.page).toBe(1);
			expect(page1Body.pageSize).toBe(2);
			expect(page1Body.total).toBe(4);
			expect(page1Body.totalPages).toBe(2);

			const page2Res = await get(
				app,
				organization.slug,
				"admin",
				"?page=2&pageSize=2",
			);
			expect(page2Res.status).toBe(200);
			const page2Body = (await page2Res.json()) as EntitlementReportResponse;
			expect(page2Body.entries).toHaveLength(2);
			expect(page2Body.page).toBe(2);
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
