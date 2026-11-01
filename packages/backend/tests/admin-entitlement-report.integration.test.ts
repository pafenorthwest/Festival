import { beforeAll, describe, expect, test } from "bun:test";
import {
	type AuthenticatedUser,
	addCalendarDays,
	type EntitlementReportResponse,
	type OrganizationDivision,
	type OrganizationRecord,
	type OrganizationRole,
	type ProductRecord,
} from "@festival/common";
import { sql } from "bun";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { buildStaffRoutes } from "../src/routes/staff/staff.routes.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";
import { currentPostgresFixture } from "./postgres-test-fixture.js";

const integrationDescribe = process.env.POSTGRES_INTEGRATION_URL
	? describe
	: describe.skip;
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

const currentSchema = currentPostgresFixture("admin_entitlement_report");
const FIXED_TEST_DATE = new Date("2026-06-01T12:00:00.000Z");

class FakeAuthVerifier implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		if (token === "admin") {
			return {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin",
			};
		}
		if (token === "viewer") {
			return {
				uid: "uid-viewer",
				email: "viewer@example.com",
				displayName: "Viewer",
			};
		}
		throw new Error(`Unknown token: ${token}`);
	}
}

interface SeedContext {
	app: Hono;
	organization: OrganizationRecord;
	pianoDivision: OrganizationDivision;
	stringsDivision: OrganizationDivision;
	product: ProductRecord;
}

async function seedUsers(
	repo: PostgresOrganizationRepository,
	orgId: string,
): Promise<void> {
	for (const [uid, email, role, origin] of [
		["uid-admin", "admin@example.com", "Admin", "creator"],
		["uid-viewer", "viewer@example.com", "Viewer", "invite"],
	] as const) {
		const user = await repo.upsertUser({ uid, email, displayName: role });
		await repo.createMembership({
			organizationId: orgId,
			userId: user.id,
			role: role as OrganizationRole,
			origin,
		});
	}
}

async function seedDivisionsAndProduct(
	repo: PostgresOrganizationRepository,
	orgId: string,
): Promise<{
	piano: OrganizationDivision;
	strings: OrganizationDivision;
	product: ProductRecord;
}> {
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

async function seedCustomers(
	client: typeof sql,
	schema: string,
	orgId: string,
): Promise<void> {
	const customers = [
		["c-alice", "gid://shopify/Customer/1", "Alice Adams", "alice@example.com"],
		["c-bob", "gid://shopify/Customer/2", null, "bob@example.com"],
		["c-charlie", "gid://shopify/Customer/3", "Charlie", "charlie@example.com"],
		["c-dave", "gid://shopify/Customer/4", "Dave Davis", "dave@example.com"],
	] as const;

	for (const [id, gid, name, email] of customers) {
		await client.unsafe(
			`INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
			[id, orgId, gid, name, email],
		);
	}
}

interface EntitlementSeedInput {
	repo: PostgresOrganizationRepository;
	orgId: string;
	piano: OrganizationDivision;
	strings: OrganizationDivision;
	product: ProductRecord;
}

async function seedTeacherGrants(input: EntitlementSeedInput): Promise<void> {
	const { repo, orgId, piano, strings, product } = input;
	const grants = [
		[
			"c-alice",
			piano,
			"2026-01-01",
			"2027-01-01",
			"active",
			"alice@example.com",
		],
		["c-bob", piano, "2026-01-01", "2027-01-01", "active", "bob@example.com"],
		[
			"c-dave",
			strings,
			"2024-01-01",
			addCalendarDays("2024-01-01", 365),
			"expired",
			"dave@example.com",
		],
	] as const;
	for (const [id, div, startsOn, endsOn, status, email] of grants) {
		await repo.createEntitlementGrantSnapshot({
			organizationId: orgId,
			customerId: id,
			entitlementClass: "teacher_membership",
			offeringId: product.id,
			durationDays: 365,
			divisionId: div.id,
			divisionNameSnapshot: div.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: `checkout-${id}`,
			shopifyOrderGid: `gid://shopify/Order/${id}`,
			shopifyOrderLineGid: `gid://shopify/LineItem/${id}`,
			startsOn,
			endsOn,
			status,
			verifiedIdentityEmail: email,
		});
	}
}

async function seedAccompanistGrant(
	input: EntitlementSeedInput,
): Promise<void> {
	await input.repo.createAccompanistMembershipGrant({
		organizationId: input.orgId,
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
		divisions: [
			{
				divisionId: input.strings.id,
				divisionName: input.strings.displayName,
			},
		],
		normalizedEmail: "charlie@example.com",
	});
}

function requestReport(
	app: Hono,
	slug: string,
	options: { token?: string; query?: string } = {},
): Promise<Response> {
	const headers = options.token
		? { Authorization: `Bearer ${options.token}` }
		: {};
	return app.request(
		`/organizations/${slug}/admin/entitlements${options.query ?? ""}`,
		{ headers },
	);
}

integrationDescribe("Admin Entitlement Report Route Integration", () => {
	let context: SeedContext;

	beforeAll(async () => {
		const schema = await currentSchema();
		const fixture = { client: sql, schema };
		const repository = new PostgresOrganizationRepository(fixture.schema);

		const organization = await repository.createOrganization({
			name: "Pacific Festival",
			slug: "pafe",
		});
		await fixture.client.unsafe(
			`UPDATE ${fixture.schema}.organizations SET timezone = $1 WHERE id = $2`,
			["America/Los_Angeles", organization.id],
		);

		await seedUsers(repository, organization.id);
		const { piano, strings, product } = await seedDivisionsAndProduct(
			repository,
			organization.id,
		);
		await seedCustomers(fixture.client, fixture.schema, organization.id);

		const grantInput = {
			repo: repository,
			orgId: organization.id,
			piano,
			strings,
			product,
		};
		await seedTeacherGrants(grantInput);
		await seedAccompanistGrant(grantInput);

		const app = new Hono().route(
			"/",
			buildStaffRoutes({
				repository,
				authVerifier: new FakeAuthVerifier(),
				accompanistMembershipService: new AccompanistMembershipService(
					repository,
					() => FIXED_TEST_DATE,
				),
			}),
		);

		context = {
			app,
			organization,
			pianoDivision: piano,
			stringsDivision: strings,
			product,
		};
	});

	integrationTest("returns 401 when no auth header is provided", async () => {
		const response = await requestReport(
			context.app,
			context.organization.slug,
		);
		expect(response.status).toBe(401);
	});

	integrationTest(
		"returns 403 when authenticated as non-admin user",
		async () => {
			const response = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "viewer" },
			);
			expect(response.status).toBe(403);
		},
	);

	integrationTest(
		"returns 200 with Cache-Control: no-store header for admin user",
		async () => {
			const response = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin" },
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		},
	);

	integrationTest(
		"verifies response structure with items, total, page, pageSize, and hasMore",
		async () => {
			const response = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin" },
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as EntitlementReportResponse;

			const items = body.entries;
			expect(Array.isArray(items)).toBe(true);
			expect(items).toHaveLength(4);
			expect(body.total).toBe(4);
			expect(body.page).toBe(1);
			expect(body.pageSize).toBe(25);
			expect(body.totalPages).toBe(1);

			const hasMore = body.page < body.totalPages;
			expect(hasMore).toBe(false);
			expect(body.divisions.length).toBeGreaterThanOrEqual(2);
		},
	);

	integrationTest(
		"verifies entitlement data mapped accurately from PostgreSQL tables",
		async () => {
			const response = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin" },
			);
			const body = (await response.json()) as EntitlementReportResponse;

			const alice = body.entries.find(
				(entry) => entry.customerEmail === "alice@example.com",
			);
			expect(alice).toBeDefined();
			expect(alice).toMatchObject({
				entitlementClass: "teacher_membership",
				customerName: "Alice Adams",
				customerEmail: "alice@example.com",
				offeringName: "Annual Teacher Pass",
				source: "teacher_checkout",
				status: "active",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				divisions: [
					{
						divisionId: context.pianoDivision.id,
						divisionName: "Piano",
					},
				],
			});

			const charlie = body.entries.find(
				(entry) => entry.customerEmail === "charlie@example.com",
			);
			expect(charlie).toBeDefined();
			expect(charlie).toMatchObject({
				entitlementClass: "accompanist_membership",
				customerName: "Charlie",
				customerEmail: "charlie@example.com",
				offeringName: "Accompanist Membership",
				source: "accompanist_form",
				status: "active",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				divisions: [
					{
						divisionId: context.stringsDivision.id,
						divisionName: "Strings",
					},
				],
			});
		},
	);

	integrationTest(
		"verifies sorting including email fallback when customerName is null",
		async () => {
			const response = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin" },
			);
			const body = (await response.json()) as EntitlementReportResponse;

			const sortKeys = body.entries.map(
				(entry) => entry.customerName ?? entry.customerEmail,
			);
			expect(sortKeys).toEqual([
				"Alice Adams",
				"bob@example.com",
				"Charlie",
				"Dave Davis",
			]);

			const bob = body.entries[1];
			expect(bob.customerName).toBeUndefined();
			expect(bob.customerEmail).toBe("bob@example.com");
		},
	);

	integrationTest(
		"verifies query parameter filtering by status, search, and division",
		async () => {
			const expiredRes = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin", query: "?status=expired" },
			);
			const expiredBody =
				(await expiredRes.json()) as EntitlementReportResponse;
			expect(expiredBody.entries).toHaveLength(1);
			expect(expiredBody.entries[0].customerName).toBe("Dave Davis");
			expect(expiredBody.entries[0].status).toBe("expired");

			const searchRes = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin", query: "?search=bob@example.com" },
			);
			const searchBody = (await searchRes.json()) as EntitlementReportResponse;
			expect(searchBody.entries).toHaveLength(1);
			expect(searchBody.entries[0].customerEmail).toBe("bob@example.com");

			const stringsRes = await requestReport(
				context.app,
				context.organization.slug,
				{
					token: "admin",
					query: `?divisionId=${context.stringsDivision.id}`,
				},
			);
			const stringsBody =
				(await stringsRes.json()) as EntitlementReportResponse;
			expect(stringsBody.entries).toHaveLength(2);
			expect(
				stringsBody.entries.every((entry) =>
					entry.divisions.some(
						(d) => d.divisionId === context.stringsDivision.id,
					),
				),
			).toBe(true);
		},
	);

	integrationTest(
		"verifies pagination slicing and hasMore flag with custom pageSize",
		async () => {
			const page1Res = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin", query: "?page=1&pageSize=2" },
			);
			const page1Body = (await page1Res.json()) as EntitlementReportResponse;
			expect(page1Body.entries).toHaveLength(2);
			expect(page1Body.page).toBe(1);
			expect(page1Body.pageSize).toBe(2);
			expect(page1Body.total).toBe(4);
			expect(page1Body.totalPages).toBe(2);
			expect(page1Body.page < page1Body.totalPages).toBe(true);

			const page2Res = await requestReport(
				context.app,
				context.organization.slug,
				{ token: "admin", query: "?page=2&pageSize=2" },
			);
			const page2Body = (await page2Res.json()) as EntitlementReportResponse;
			expect(page2Body.entries).toHaveLength(2);
			expect(page2Body.page).toBe(2);
			expect(page2Body.page < page2Body.totalPages).toBe(false);
		},
	);
});
