import { describe, expect, it } from "bun:test";
import {
	AVAILABILITY_HOURS,
	DEFAULT_AVAILABLE_HOURS,
	type SaveCustomerFestivalAvailabilityRequest,
} from "@festival/common";
import { Hono } from "hono";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAvailabilityRepository } from "../src/customer/customer-availability-repository.js";
import { CustomerAvailabilityService } from "../src/customer/customer-availability-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCustomerRoutes } from "../src/routes/customer/customer.routes.js";
import { buildCustomerAvailabilityRoutes } from "../src/routes/customer/customer-availability.routes.js";

const ORIGIN = "https://festival.example.com";
const VALID_CSRF = "csrf-token-1";

interface SessionStub {
	organizationSlug: string;
	organizationId: string;
	customerId: string;
	csrfToken: string;
}

function createAuthStub(sessions: Map<string, SessionStub>) {
	return {
		customerReadAccess: async (slug: string, sessionId?: string) => {
			const s = sessionId ? sessions.get(sessionId) : undefined;
			if (!s || s.organizationSlug !== slug) {
				throw new AppError("Customer session is invalid.", 401);
			}
			return { organizationId: s.organizationId, customerId: s.customerId };
		},
		formAccess: async (
			slug: string,
			sessionId?: string,
			csrf?: string,
			origin?: string,
		) => {
			const s = sessionId ? sessions.get(sessionId) : undefined;
			if (!s || s.organizationSlug !== slug) {
				throw new AppError("Customer session is invalid.", 401);
			}
			if (!csrf || csrf !== s.csrfToken || origin !== ORIGIN) {
				throw new AppError("CSRF validation failed.", 403);
			}
			return {
				organizationId: s.organizationId,
				organizationTimezone: "UTC",
				customerId: s.customerId,
				name: "Test Customer",
				email: "customer@example.com",
			};
		},
	} as unknown as CustomerAccountService;
}

async function createAvailabilityFixture() {
	const now = new Date("2026-06-15T12:00:00.000Z");
	const organizations = new InMemoryOrganizationRepository(() => now);
	const accounts = new InMemoryCustomerAccountRepository();
	const availabilityRepo = new InMemoryCustomerAvailabilityRepository();

	const org = await organizations.createOrganization({
		name: "Spring Music Org",
		slug: "spring-org",
	});
	const otherOrg = await organizations.createOrganization({
		name: "Other Music Org",
		slug: "other-org",
	});
	const division = await organizations.createDivision({
		organizationId: org.id,
		displayName: "Piano",
		normalizedName: "piano",
	});

	const primaryFestival = await organizations.createFestival({
		id: "fest-primary",
		organizationId: org.id,
		code: "SP26",
		shortName: "spring-2026",
		name: "Spring Festival 2026",
		startDate: "2026-07-10",
		endDate: "2026-07-12",
	});
	await organizations.setPrimaryFestival(org.id, primaryFestival.id);

	const secondaryFestival = await organizations.createFestival({
		id: "fest-fall",
		organizationId: org.id,
		code: "FA26",
		shortName: "fall-2026",
		name: "Fall Festival 2026",
		startDate: "2026-10-01",
		endDate: "2026-10-02",
	});

	const otherOrgFestival = await organizations.createFestival({
		id: "fest-other-org",
		organizationId: otherOrg.id,
		code: "OT26",
		shortName: "other-2026",
		name: "Other Org Festival",
		startDate: "2026-08-01",
		endDate: "2026-08-01",
	});

	const sessions = new Map<string, SessionStub>();
	let customerSeq = 0;

	async function registerCustomer(organization = org) {
		customerSeq += 1;
		const sessionId = `sess_${customerSeq}`;
		const { customer } = await accounts.createCustomerSession({
			sessionId,
			organizationId: organization.id,
			shopifyCustomerGid: `gid://shopify/Customer/${customerSeq}`,
			encryptedTokens: "enc",
			csrfToken: VALID_CSRF,
			integrationVersion: 1,
			createdAtIso: now.toISOString(),
			lastSeenAtIso: now.toISOString(),
			expiresAtIso: "2026-12-31T00:00:00.000Z",
		});
		sessions.set(sessionId, {
			organizationSlug: organization.slug,
			organizationId: organization.id,
			customerId: customer.id,
			csrfToken: VALID_CSRF,
		});
		return { customer, sessionId };
	}

	async function grantActiveAccompanist(
		customerId: string,
		email = `${customerId}@example.com`,
	) {
		return organizations.createAccompanistMembershipGrant({
			organizationId: org.id,
			customerId,
			normalizedEmail: email,
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Accompanist Name",
				email,
				city: "Seattle",
				phone: "555-0100",
			},
			divisions: [{ divisionId: division.id, divisionName: "Piano" }],
			startsOn: "2026-01-01",
			endsOn: "2026-12-31",
		});
	}

	const accountService = createAuthStub(sessions);
	const availabilityService = new CustomerAvailabilityService(
		availabilityRepo,
		organizations,
		accounts,
		accountService,
		() => now,
	);

	const app = new Hono();
	app.route(
		"/organizations/:slug/customer-account",
		buildCustomerAvailabilityRoutes({
			customerAvailabilityService: availabilityService,
		}),
	);
	app.route(
		"/organizations/:slug/customer",
		buildCustomerRoutes({
			customerAccountService: accountService,
		}),
	);

	return {
		org,
		otherOrg,
		primaryFestival,
		secondaryFestival,
		otherOrgFestival,
		accounts,
		organizations,
		availabilityRepo,
		availabilityService,
		app,
		registerCustomer,
		grantActiveAccompanist,
		addChild: (parentCustomerId: string, displayName: string) =>
			accounts.createChild({
				organizationId: org.id,
				parentCustomerId,
				displayName,
			}),
	};
}

describe("CustomerAvailabilityService & routes", () => {
	it("resolves all 5 subject combinations with default 8am-5pm available and 5-6pm unavailable", async () => {
		const fx = await createAvailabilityFixture();
		const summary = (s: {
			subjectType: string;
			subjectId: string;
			label: string;
		}) => ({
			subjectType: s.subjectType,
			subjectId: s.subjectId,
			label: s.label,
		});

		const cNeither = await fx.registerCustomer();
		const resNeither = await fx.availabilityService.getAvailability(
			fx.org.slug,
			cNeither.sessionId,
		);
		expect(resNeither.selectedFestivalId).toBe(fx.primaryFestival.id);
		expect(resNeither.dates).toEqual([
			"2026-07-10",
			"2026-07-11",
			"2026-07-12",
		]);
		expect(resNeither.subjects).toEqual([]);

		const cAccompanist = await fx.registerCustomer();
		await fx.grantActiveAccompanist(cAccompanist.customer.id);
		const resAccompanist = await fx.availabilityService.getAvailability(
			fx.org.slug,
			cAccompanist.sessionId,
		);
		expect(resAccompanist.subjects.map(summary)).toEqual([
			{
				subjectType: "accompanist",
				subjectId: cAccompanist.customer.id,
				label: "Accompanist",
			},
		]);
		for (const day of resAccompanist.subjects[0]?.days ?? []) {
			expect(day.availableHours).toEqual([...DEFAULT_AVAILABLE_HOURS]);
			expect(day.availableHours).not.toContain(17);
			expect(AVAILABILITY_HOURS).toContain(17);
		}

		const cOneChild = await fx.registerCustomer();
		const soloChild = await fx.addChild(cOneChild.customer.id, "Clara");
		const resOneChild = await fx.availabilityService.getAvailability(
			fx.org.slug,
			cOneChild.sessionId,
		);
		const defaultHours = [...DEFAULT_AVAILABLE_HOURS];
		expect(resOneChild.subjects).toEqual([
			{
				subjectType: "child",
				subjectId: soloChild.id,
				label: "Clara",
				days: [
					{ date: "2026-07-10", availableHours: defaultHours },
					{ date: "2026-07-11", availableHours: defaultHours },
					{ date: "2026-07-12", availableHours: defaultHours },
				],
			},
		]);

		const cMulti = await fx.registerCustomer();
		const childA = await fx.addChild(cMulti.customer.id, "Felix");
		const childB = await fx.addChild(cMulti.customer.id, "Fanny");
		const resMulti = await fx.availabilityService.getAvailability(
			fx.org.slug,
			cMulti.sessionId,
		);
		expect(resMulti.subjects.map(summary)).toEqual([
			{ subjectType: "child", subjectId: childA.id, label: "Felix" },
			{ subjectType: "child", subjectId: childB.id, label: "Fanny" },
		]);

		const cBoth = await fx.registerCustomer();
		await fx.grantActiveAccompanist(cBoth.customer.id);
		const bothChild1 = await fx.addChild(cBoth.customer.id, "Wolfgang");
		const bothChild2 = await fx.addChild(cBoth.customer.id, "Nannerl");
		const resBoth = await fx.availabilityService.getAvailability(
			fx.org.slug,
			cBoth.sessionId,
		);
		expect(resBoth.subjects.map(summary)).toEqual([
			{
				subjectType: "accompanist",
				subjectId: cBoth.customer.id,
				label: "Accompanist",
			},
			{ subjectType: "child", subjectId: bothChild1.id, label: "Wolfgang" },
			{ subjectType: "child", subjectId: bothChild2.id, label: "Nannerl" },
		]);
	});

	it("persists custom hour blocks across reloads via HTTP GET and PUT routes", async () => {
		const fx = await createAvailabilityFixture();
		const { customer, sessionId } = await fx.registerCustomer();
		await fx.grantActiveAccompanist(customer.id);
		const child = await fx.addChild(customer.id, "Leo");

		const savePayload: SaveCustomerFestivalAvailabilityRequest = {
			festivalId: fx.primaryFestival.id,
			subjects: [
				{
					subjectType: "accompanist",
					subjectId: customer.id,
					days: [
						{ date: "2026-07-10", availableHours: [8, 9, 17] },
						{ date: "2026-07-11", availableHours: [] },
					],
				},
				{
					subjectType: "child",
					subjectId: child.id,
					days: [{ date: "2026-07-12", availableHours: [13, 14, 15, 16, 17] }],
				},
			],
		};

		const putRes = await fx.app.request(
			`/organizations/${fx.org.slug}/customer-account/availability`,
			{
				method: "PUT",
				headers: {
					Cookie: `${CUSTOMER_SESSION_COOKIE}=${sessionId}`,
					"Content-Type": "application/json",
					"X-CSRF-Token": VALID_CSRF,
					Origin: ORIGIN,
				},
				body: JSON.stringify(savePayload),
			},
		);
		expect(putRes.status).toBe(200);

		const getRes = await fx.app.request(
			`/organizations/${fx.org.slug}/customer-account/availability`,
			{
				method: "GET",
				headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=${sessionId}` },
			},
		);
		expect(getRes.status).toBe(200);
		const body = await getRes.json();
		const d = [...DEFAULT_AVAILABLE_HOURS];
		expect(body.subjects).toEqual([
			{
				subjectType: "accompanist",
				subjectId: customer.id,
				label: "Accompanist",
				days: [
					{ date: "2026-07-10", availableHours: [8, 9, 17] },
					{ date: "2026-07-11", availableHours: [] },
					{ date: "2026-07-12", availableHours: d },
				],
			},
			{
				subjectType: "child",
				subjectId: child.id,
				label: "Leo",
				days: [
					{ date: "2026-07-10", availableHours: d },
					{ date: "2026-07-11", availableHours: d },
					{ date: "2026-07-12", availableHours: [13, 14, 15, 16, 17] },
				],
			},
		]);
	});

	it("isolates availability across multiple festivals and organizations", async () => {
		const fx = await createAvailabilityFixture();
		const { customer, sessionId } = await fx.registerCustomer();
		const child = await fx.addChild(customer.id, "Maya");

		await fx.availabilityService.saveAvailability(
			fx.org.slug,
			sessionId,
			VALID_CSRF,
			ORIGIN,
			{
				festivalId: fx.primaryFestival.id,
				subjects: [
					{
						subjectType: "child",
						subjectId: child.id,
						days: [{ date: "2026-07-10", availableHours: [8, 9] }],
					},
				],
			},
		);

		const secondaryView = await fx.availabilityService.getAvailability(
			fx.org.slug,
			sessionId,
			fx.secondaryFestival.id,
		);
		expect(secondaryView.selectedFestivalId).toBe(fx.secondaryFestival.id);
		expect(secondaryView.dates).toEqual(["2026-10-01", "2026-10-02"]);
		expect(secondaryView.subjects[0]?.days).toEqual([
			{ date: "2026-10-01", availableHours: [...DEFAULT_AVAILABLE_HOURS] },
			{ date: "2026-10-02", availableHours: [...DEFAULT_AVAILABLE_HOURS] },
		]);

		const notFound = { status: 404, code: "festival_not_found" };
		await expect(
			fx.availabilityService.getAvailability(
				fx.org.slug,
				sessionId,
				fx.otherOrgFestival.id,
			),
		).rejects.toMatchObject(notFound);

		await expect(
			fx.availabilityService.saveAvailability(
				fx.org.slug,
				sessionId,
				VALID_CSRF,
				ORIGIN,
				{ festivalId: fx.otherOrgFestival.id, subjects: [] },
			),
		).rejects.toMatchObject(notFound);
	});

	it("rejects unauthorized subject writes, invalid payloads, and missing CSRF/session", async () => {
		const fx = await createAvailabilityFixture();
		const parentA = await fx.registerCustomer();
		const parentB = await fx.registerCustomer();
		const childB = await fx.addChild(parentB.customer.id, "Other Child");
		const childA = await fx.addChild(parentA.customer.id, "Own Child");

		const saveForA = (
			subjectType: "accompanist" | "child",
			subjectId: string,
			date: string,
			availableHours: number[],
		) =>
			fx.availabilityService.saveAvailability(
				fx.org.slug,
				parentA.sessionId,
				VALID_CSRF,
				ORIGIN,
				{
					festivalId: fx.primaryFestival.id,
					subjects: [
						{ subjectType, subjectId, days: [{ date, availableHours }] },
					],
				},
			);

		const forbidden = { status: 403, code: "forbidden_availability_subject" };
		const invalid = { status: 400, code: "invalid_availability" };

		await expect(
			saveForA("accompanist", parentA.customer.id, "2026-07-10", [8, 9]),
		).rejects.toMatchObject(forbidden);

		await expect(
			saveForA("child", childB.id, "2026-07-10", [8, 9]),
		).rejects.toMatchObject(forbidden);

		await expect(
			saveForA("child", childA.id, "2026-07-10", [7, 18]),
		).rejects.toMatchObject(invalid);

		await expect(
			saveForA("child", childA.id, "2026-07-15", [8, 9]),
		).rejects.toMatchObject(invalid);

		const unauthRes = await fx.app.request(
			`/organizations/${fx.org.slug}/customer-account/availability`,
		);
		expect(unauthRes.status).toBe(401);

		const noCsrfRes = await fx.app.request(
			`/organizations/${fx.org.slug}/customer-account/availability`,
			{
				method: "PUT",
				headers: {
					Cookie: `${CUSTOMER_SESSION_COOKIE}=${parentA.sessionId}`,
					"Content-Type": "application/json",
					Origin: ORIGIN,
				},
				body: JSON.stringify({
					festivalId: fx.primaryFestival.id,
					subjects: [],
				}),
			},
		);
		expect(noCsrfRes.status).toBe(403);
	});

	it("upsertAvailability refuses to overwrite records owned by a different customer", async () => {
		const repo = new InMemoryCustomerAvailabilityRepository();
		const baseEntry = {
			organizationId: "org-1",
			festivalId: "fest-1",
			customerId: "cust-owner",
			subjectType: "child" as const,
			subjectId: "child-1",
			festivalDate: "2026-07-10",
			availableHours: [9, 10],
		};

		await repo.upsertAvailability([baseEntry]);

		const initial = await repo.listAvailability({
			organizationId: "org-1",
			festivalId: "fest-1",
			customerId: "cust-owner",
		});
		expect(initial).toHaveLength(1);
		expect(initial[0]?.availableHours).toEqual([9, 10]);

		// Attempt overwrite by another customer
		await repo.upsertAvailability([
			{
				...baseEntry,
				customerId: "cust-attacker",
				availableHours: [14, 15],
			},
		]);

		const ownerAfter = await repo.listAvailability({
			organizationId: "org-1",
			festivalId: "fest-1",
			customerId: "cust-owner",
		});
		expect(ownerAfter).toHaveLength(1);
		expect(ownerAfter[0]?.availableHours).toEqual([9, 10]);

		const attackerAfter = await repo.listAvailability({
			organizationId: "org-1",
			festivalId: "fest-1",
			customerId: "cust-attacker",
		});
		expect(attackerAfter).toHaveLength(0);

		// Legitimate update by original owner succeeds
		await repo.upsertAvailability([
			{
				...baseEntry,
				customerId: "cust-owner",
				availableHours: [11, 12],
			},
		]);

		const ownerUpdated = await repo.listAvailability({
			organizationId: "org-1",
			festivalId: "fest-1",
			customerId: "cust-owner",
		});
		expect(ownerUpdated[0]?.availableHours).toEqual([11, 12]);
	});
});
