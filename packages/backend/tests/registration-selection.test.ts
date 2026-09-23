import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	CUSTOMER_SESSION_COOKIE,
	CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";

class MockAuthVerifier implements AuthVerifier {
	async verify() {
		return { uid: "test-user", email: "test@example.com" };
	}
}

async function createSelectionFixture() {
	let currentDate = new Date("2026-06-01T12:00:00.000Z");
	const now = () => currentDate;

	const organizations = new InMemoryOrganizationRepository(now);
	const repository = new InMemoryCustomerAccountRepository();
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("keyring");

	const org = await organizations.createOrganization({
		name: "Pacific Northwest Festival",
		slug: "pnw-festival",
	});
	await organizations.updateOrganizationTimezone(org.id, "America/Vancouver");
	await organizations.updateRegistrationAgeConfiguration({
		organizationId: org.id,
		registrationAgeDate: "2026-06-01",
	});

	const otherOrg = await organizations.createOrganization({
		name: "Other Org",
		slug: "other-org",
	});

	const pianoDivision = await organizations.createDivision({
		organizationId: org.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const stringsDivision = await organizations.createDivision({
		organizationId: org.id,
		displayName: "Strings",
		normalizedName: "strings",
	});

	const festival = await organizations.createFestival({
		organizationId: org.id,
		name: "Spring Festival 2026",
		shortName: "spring-2026",
		startsOn: "2026-06-01",
		endsOn: "2026-06-10",
		status: "draft",
	});

	const service = new CustomerAccountService(
		repository,
		organizations,
		keyring,
		{
			publicOrigin: "https://festival.example.com",
			now,
		},
	);

	async function createCustomer(
		name: string,
		email: string,
		shopifyGid = randomUUID(),
		orgId = org.id,
	) {
		const { customer } = await repository.createCustomerSession({
			sessionId: randomUUID(),
			organizationId: orgId,
			shopifyCustomerGid: `gid://shopify/Customer/${shopifyGid}`,
			encryptedTokens: "tokens",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: now().toISOString(),
			touchedAtIso: now().toISOString(),
			expiresAtIso: now().toISOString(),
			absoluteExpiresAtIso: now().toISOString(),
			tokenExpiresAtIso: now().toISOString(),
		});
		await repository.applyCustomerProfile({
			organizationId: orgId,
			customerId: customer.id,
			source: "shopify",
			profile: { name, email },
			updatedAtIso: now().toISOString(),
		});
		organizations.setCustomerName(customer.id, name);
		return customer;
	}

	// Helper to register parent customer and valid session
	async function createParentSession(
		customerEmail = "parent@example.com",
		orgId = org.id,
		slug = "pnw-festival",
	) {
		const sessionId = randomUUID();
		const csrfToken = "csrf-test-token";
		const createdAtIso = now().toISOString();
		const expiresAtIso = new Date(
			now().getTime() + 7 * 86_400_000,
		).toISOString();

		if (!(await repository.getIntegration(orgId))) {
			await repository.upsertIntegration({
				organizationId: orgId,
				storefrontDomain: "store.example.com",
				clientId: "client-id",
				encryptedClientSecret: keyring.encrypt("secret", {
					organizationId: orgId,
					purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
				}),
				apiVersion: "2026-07",
				readiness: "ready",
				canReadOrders: true,
				integrationVersion: 1,
				updatedAtIso: createdAtIso,
			});
		}

		const { customer } = await repository.createCustomerSession({
			sessionId,
			organizationId: orgId,
			shopifyCustomerGid: `gid://shopify/Customer/${randomUUID().slice(0, 8)}`,
			encryptedTokens: keyring.encrypt(
				JSON.stringify({ accessToken: "token", idToken: "id-token" }),
				{ organizationId: orgId, purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE },
			),
			csrfToken,
			integrationVersion: 1,
			createdAtIso,
			touchedAtIso: createdAtIso,
			expiresAtIso,
			absoluteExpiresAtIso: new Date(
				now().getTime() + 30 * 86_400_000,
			).toISOString(),
			tokenExpiresAtIso: expiresAtIso,
		});

		await repository.applyCustomerProfile({
			organizationId: orgId,
			customerId: customer.id,
			source: "shopify",
			profile: {
				name: "Jane Parent",
				email: customerEmail,
			},
			updatedAtIso: createdAtIso,
		});

		return { customer, sessionId, csrfToken, slug };
	}

	return {
		organizations,
		repository,
		keyring,
		service,
		org,
		otherOrg,
		festival,
		pianoDivision,
		stringsDivision,
		now,
		setDate: (d: Date) => {
			currentDate = d;
		},
		createCustomer,
		createParentSession,
	};
}

describe("Registration Selection APIs (#143)", () => {
	it("rejects unauthenticated requests and invalid sessions", async () => {
		const f = await createSelectionFixture();

		await expect(
			f.service.listRegistrationTeachers(
				f.org.slug,
				f.festival.shortName,
				undefined,
				"child-id",
				f.pianoDivision.id,
			),
		).rejects.toThrow("Customer session is invalid.");

		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				"invalid-session",
				"child-id",
				f.pianoDivision.id,
				"teacher-id",
			),
		).rejects.toThrow("Customer session is invalid.");

		await expect(
			f.service.listRegistrationAccompanists(
				f.org.slug,
				f.festival.shortName,
				"non-existent-session",
			),
		).rejects.toThrow("Customer session is invalid.");
	});

	it("rejects non-existent festival or missing/cross-tenant child", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		await expect(
			f.service.listRegistrationTeachers(
				f.org.slug,
				"non-existent-festival",
				parent.sessionId,
				"child-1",
				f.pianoDivision.id,
			),
		).rejects.toThrow("Festival was not found.");

		await expect(
			f.service.listRegistrationTeachers(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				"non-existent-child",
				f.pianoDivision.id,
			),
		).rejects.toThrow("Child was not found.");

		// Create child for different parent
		const otherParent = await f.createParentSession("other@example.com");
		const otherChild = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: otherParent.customer.id,
			displayName: "Other Child",
		});

		// Parent cannot access another parent's child
		await expect(
			f.service.listRegistrationTeachers(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				otherChild.id,
				f.pianoDivision.id,
			),
		).rejects.toThrow("Child was not found.");
	});

	it("enforces 90-day age snapshot validity and rejects expired snapshots with 409", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Tommy",
		});

		// 1. Child with no age snapshot -> throws 409
		await expect(
			f.service.listRegistrationTeachers(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
			),
		).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("expired or missing"),
		});

		// 2. Child with expired age snapshot (> 90 days) -> throws 409
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 10,
			validUntilIso: new Date(f.now().getTime() - 1000).toISOString(),
		});

		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				"teacher-1",
			),
		).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("expired or missing"),
		});

		// 3. Refresh snapshot -> now valid
		const validUntil = new Date(
			f.now().getTime() + 90 * 86_400_000,
		).toISOString();
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 10,
			validUntilIso: validUntil,
		});

		// Active division check works
		const teacherResult = await f.service.listRegistrationTeachers(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
			child.id,
			f.pianoDivision.id,
		);
		expect(teacherResult.teachers).toEqual([]);
	});

	it("returns only active teachers entitled in the requested division, with allowlisted fields", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Sarah",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 12,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		// Create offering for teacher memberships
		const offering = await f.organizations.createMembershipProductRecord({
			organizationId: f.org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/100",
			shopifyVariantGid: "gid://shopify/ProductVariant/100",
			productNameSnapshot: "Teacher Membership",
		});

		// Teacher 1: Piano division, active
		const teacher1Customer = await f.createCustomer(
			"Professor Mozart",
			"teacher1@example.com",
			"t1",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: teacher1Customer.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "teacher1@example.com",
		});

		// Teacher 2: Strings division, active (should not show for Piano)
		const teacher2Customer = await f.createCustomer(
			"Maestro Paganini",
			"teacher2@example.com",
			"t2",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: teacher2Customer.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.stringsDivision.id,
			divisionNameSnapshot: "Strings",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-2",
			shopifyOrderGid: "gid://shopify/Order/2",
			shopifyOrderLineGid: "gid://shopify/LineItem/2",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "teacher2@example.com",
		});

		// Teacher 3: Piano division, EXPIRED
		const teacher3Customer = await f.createCustomer(
			"Expired Beethoven",
			"teacher3@example.com",
			"t3",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: teacher3Customer.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-3",
			shopifyOrderGid: "gid://shopify/Order/3",
			shopifyOrderLineGid: "gid://shopify/LineItem/3",
			startsOn: "2025-01-01",
			endsOn: "2026-01-01", // Expired relative to 2026-06-01
			status: "active",
			verifiedIdentityEmail: "teacher3@example.com",
		});

		// Query Piano division teachers
		const pianoTeachers = await f.service.listRegistrationTeachers(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
			child.id,
			f.pianoDivision.id,
		);

		expect(pianoTeachers.teachers).toEqual([
			{
				id: teacher1Customer.id,
				name: "Professor Mozart",
			},
		]);

		// Verify strict redaction: no emails, phone numbers, or tokens
		const json = JSON.stringify(pianoTeachers);
		expect(json).not.toContain("teacher1@example.com");
		expect(json).not.toContain("gid://shopify");
		expect(json).not.toContain("50.00");

		// Query Strings division teachers
		const stringsTeachers = await f.service.listRegistrationTeachers(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
			child.id,
			f.stringsDivision.id,
		);
		expect(stringsTeachers.teachers).toEqual([
			{
				id: teacher2Customer.id,
				name: "Maestro Paganini",
			},
		]);
	});

	it("validates server-side teacher eligibility when selecting classes, failing without information leakage", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Lucas",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 11,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		// Inactive, absent, cross-tenant, or strings teacher fails for Piano
		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				"non-existent-teacher-id",
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});
	});

	it("filters classes strictly by child age boundaries (inclusive) and division", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Emma",
		});
		// Child age: 10
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 10,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const offering = await f.organizations.createMembershipProductRecord({
			organizationId: f.org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/200",
			shopifyVariantGid: "gid://shopify/ProductVariant/200",
			productNameSnapshot: "Teacher Membership",
		});

		const teacher = await f.createCustomer(
			"Chopin",
			"piano.teacher@example.com",
			"t-piano",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: teacher.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-piano-1",
			shopifyOrderGid: "gid://shopify/Order/10",
			shopifyOrderLineGid: "gid://shopify/LineItem/10",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "piano.teacher@example.com",
		});

		// Catalog subtype
		const subtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.org.id,
			kind: "class_subtype",
			displayName: "Competitive Solo",
			normalizedName: "competitive_solo",
		});

		// Class 1: Piano, Age 8-10 (Child age 10 == maximumAge: INCLUDED)
		const class1 = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Junior Piano Solo",
			classSubtypeId: subtype.id,
			divisionId: f.pianoDivision.id,
			minimumAge: 8,
			maximumAge: 10,
			price: "35.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 5,
			capacity: 25,
			shopifyProductGid: "gid://shopify/Product/c1",
			shopifyVariantGid: "gid://shopify/ProductVariant/c1",
		});

		// Class 2: Piano, Age 10-14 (Child age 10 == minimumAge: INCLUDED)
		const class2 = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Intermediate Piano Solo",
			classSubtypeId: subtype.id,
			divisionId: f.pianoDivision.id,
			minimumAge: 10,
			maximumAge: 14,
			price: "45.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 8,
			capacity: 20,
			shopifyProductGid: "gid://shopify/Product/c2",
			shopifyVariantGid: "gid://shopify/ProductVariant/c2",
		});

		// Class 3: Piano, Age 12-16 (Child age 10 < 12: EXCLUDED)
		await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Senior Piano Solo",
			classSubtypeId: subtype.id,
			divisionId: f.pianoDivision.id,
			minimumAge: 12,
			maximumAge: 16,
			price: "55.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 12,
			capacity: 15,
			shopifyProductGid: "gid://shopify/Product/c3",
			shopifyVariantGid: "gid://shopify/ProductVariant/c3",
		});

		// Class 4: Piano, Age 5-8 (Child age 10 > 8: EXCLUDED)
		await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Primary Piano Solo",
			classSubtypeId: subtype.id,
			divisionId: f.pianoDivision.id,
			minimumAge: 5,
			maximumAge: 8,
			price: "25.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 3,
			capacity: 30,
			shopifyProductGid: "gid://shopify/Product/c4",
			shopifyVariantGid: "gid://shopify/ProductVariant/c4",
		});

		// Class 5: Strings, Age 10-12 (Different division: EXCLUDED)
		await f.organizations.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Junior Violin Solo",
			classSubtypeId: subtype.id,
			divisionId: f.stringsDivision.id,
			minimumAge: 10,
			maximumAge: 12,
			price: "35.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 5,
			capacity: 25,
			shopifyProductGid: "gid://shopify/Product/c5",
			shopifyVariantGid: "gid://shopify/ProductVariant/c5",
		});

		const result = await f.service.listRegistrationEligibleClasses(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
			child.id,
			f.pianoDivision.id,
			teacher.id,
		);

		expect(result.classes.map((c) => c.id).sort()).toEqual(
			[class1.id, class2.id].sort(),
		);
		expect(result.classes.map((c) => c.displayName)).toContain(
			"Junior Piano Solo",
		);
		expect(result.classes.map((c) => c.displayName)).toContain(
			"Intermediate Piano Solo",
		);

		// Verify allowlisted DTO redaction: no internal shopify product/variant GIDs leaked to parent
		const json = JSON.stringify(result);
		expect(json).not.toContain("gid://shopify/Product/c1");
		expect(json).not.toContain("gid://shopify/ProductVariant/c1");
	});

	it("returns active accompanists across divisions without division restriction", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		// Accompanist 1: Active
		await f.organizations.createAccompanistMembershipGrant({
			organizationId: f.org.id,
			customerId: "cust-acc-1",
			normalizedEmail: "accompanist1@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Clara Schumann",
				email: "accompanist1@example.com",
				city: "Seattle",
				phone: "555-0101",
			},
			divisions: [{ divisionId: f.pianoDivision.id, divisionName: "Piano" }],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});

		// Accompanist 2: Active in Strings (still selectable!)
		await f.organizations.createAccompanistMembershipGrant({
			organizationId: f.org.id,
			customerId: "cust-acc-2",
			normalizedEmail: "accompanist2@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Johannes Brahms",
				email: "accompanist2@example.com",
				city: "Bellevue",
				phone: "555-0102",
			},
			divisions: [
				{ divisionId: f.stringsDivision.id, divisionName: "Strings" },
			],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});

		// Accompanist 3: Expired
		await f.organizations.createAccompanistMembershipGrant({
			organizationId: f.org.id,
			customerId: "cust-acc-3",
			normalizedEmail: "accompanist3@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Franz Liszt",
				email: "accompanist3@example.com",
				city: "Tacoma",
				phone: "555-0103",
			},
			divisions: [{ divisionId: f.pianoDivision.id, divisionName: "Piano" }],
			startsOn: "2025-01-01",
			endsOn: "2026-01-01", // Expired relative to 2026-06-01
		});

		const result = await f.service.listRegistrationAccompanists(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
		);

		expect(result.accompanists).toEqual([
			{ id: "cust-acc-1", name: "Clara Schumann" },
			{ id: "cust-acc-2", name: "Johannes Brahms" },
		]);

		// Verify PII redaction: no contact email, phone, or city returned to parent
		const json = JSON.stringify(result);
		expect(json).not.toContain("555-0101");
		expect(json).not.toContain("accompanist1@example.com");
		expect(json).not.toContain("Seattle");
	});

	it("serves HTTP selection endpoints with strict cookie authentication and error status codes", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Zoe",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 14,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const { app } = await createApp({
			env: { port: 3000, trustProxyHeaders: false },
			repository: f.organizations,
			authVerifier: new MockAuthVerifier(),
			customerAccountService: f.service,
		});

		// 1. Unauthenticated request -> 401
		const unauthRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/teachers?childId=${child.id}&divisionId=${f.pianoDivision.id}`,
		);
		expect(unauthRes.status).toBe(401);

		// 2. Authenticated request with cookie -> 200
		const authCookie = `${CUSTOMER_SESSION_COOKIE}=${parent.sessionId}`;
		const authRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/teachers?childId=${child.id}&divisionId=${f.pianoDivision.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(authRes.status).toBe(200);
		const authJson = await authRes.json();
		expect(authJson).toHaveProperty("teachers");
		expect(Array.isArray(authJson.teachers)).toBe(true);

		// 3. Accompanists endpoint -> 200
		const accRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/accompanists`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(accRes.status).toBe(200);
		const accJson = await accRes.json();
		expect(accJson).toHaveProperty("accompanists");

		// 4. Ineligible teacher selection in eligible-classes -> 400
		const classRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=bogus-teacher`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(classRes.status).toBe(400);
		const classError = await classRes.json();
		expect(classError.error).toBe(
			"Selected teacher is not eligible in this division.",
		);
	});

	it("excludes accompanists and non-teacher entitlement classes from active teachers in division (#143)", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Clara",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 10,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		// Create teacher offering & grant
		const teacherOffering = await f.organizations.createMembershipProductRecord(
			{
				organizationId: f.org.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/301",
				shopifyVariantGid: "gid://shopify/ProductVariant/301",
				productNameSnapshot: "Teacher Membership",
			},
		);

		const teacherCustomer = await f.createCustomer(
			"Teacher Bach",
			"teacher.bach@example.com",
			"t-bach",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: teacherCustomer.id,
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-bach",
			shopifyOrderGid: "gid://shopify/Order/301",
			shopifyOrderLineGid: "gid://shopify/LineItem/301",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "teacher.bach@example.com",
		});

		// Create active accompanist in the same piano division
		await f.organizations.createAccompanistMembershipGrant({
			organizationId: f.org.id,
			customerId: "cust-acc-piano",
			normalizedEmail: "acc.piano@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Accompanist Liszt",
				email: "acc.piano@example.com",
				city: "Vancouver",
				phone: "555-0199",
			},
			divisions: [{ divisionId: f.pianoDivision.id, divisionName: "Piano" }],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});
		f.organizations.setCustomerName("cust-acc-piano", "Accompanist Liszt");

		// Also create non-teacher grant in entitlementGrants
		const accompanistOffering =
			await f.organizations.createMembershipProductRecord({
				organizationId: f.org.id,
				entitlementClass: "accompanist_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/302",
				shopifyVariantGid: "gid://shopify/ProductVariant/302",
				productNameSnapshot: "Accompanist Offering",
			});
		const nonTeacherCustomer = await f.createCustomer(
			"Non-Teacher Member",
			"nonteacher@example.com",
			"t-nonteacher",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: nonTeacherCustomer.id,
			entitlementClass: "accompanist_membership",
			offeringId: accompanistOffering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-nonteacher",
			shopifyOrderGid: "gid://shopify/Order/302",
			shopifyOrderLineGid: "gid://shopify/LineItem/302",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "nonteacher@example.com",
		});

		// Verify repository method directly excludes accompanists / non-teachers
		const repoTeachers = await f.organizations.listActiveTeachersForDivision(
			f.org.id,
			f.pianoDivision.id,
		);
		expect(repoTeachers).toEqual([
			{
				id: teacherCustomer.id,
				name: "Teacher Bach",
			},
		]);

		// Verify customer service method excludes accompanists / non-teachers
		const serviceTeachers = await f.service.listRegistrationTeachers(
			f.org.slug,
			f.festival.shortName,
			parent.sessionId,
			child.id,
			f.pianoDivision.id,
		);
		expect(serviceTeachers.teachers).toEqual([
			{
				id: teacherCustomer.id,
				name: "Teacher Bach",
			},
		]);
	});

	it("rejects class eligibility for teacher with inactive or revoked entitlement (#189)", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Oliver",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 10,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const offering = await f.organizations.createMembershipProductRecord({
			organizationId: f.org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/189-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/189-1",
			productNameSnapshot: "Teacher Membership",
		});

		// 1. Revoked teacher entitlement
		const revokedTeacher = await f.createCustomer(
			"Revoked Teacher",
			"revoked.teacher@example.com",
			"t-revoked",
		);
		const revokedGrant = await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: revokedTeacher.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-revoked-1",
			shopifyOrderGid: "gid://shopify/Order/revoked-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/revoked-1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "revoked.teacher@example.com",
		});
		await f.organizations.revokeEntitlement({
			organizationId: f.org.id,
			entitlementId: revokedGrant.id,
			actorUserId: "admin-actor",
			reason: "Revoked for policy violation",
			revokedAtIso: f.now().toISOString(),
		});

		// 2. Future / inactive teacher entitlement
		const futureTeacher = await f.createCustomer(
			"Future Teacher",
			"future.teacher@example.com",
			"t-future",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: futureTeacher.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-future-1",
			shopifyOrderGid: "gid://shopify/Order/future-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/future-1",
			startsOn: "2026-07-01",
			endsOn: "2027-07-01",
			status: "active",
			verifiedIdentityEmail: "future.teacher@example.com",
		});

		const { app } = await createApp({
			env: { port: 3000, trustProxyHeaders: false },
			repository: f.organizations,
			authVerifier: new MockAuthVerifier(),
			customerAccountService: f.service,
		});
		const authCookie = `${CUSTOMER_SESSION_COOKIE}=${parent.sessionId}`;

		// Direct service calls
		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				revokedTeacher.id,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});

		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				futureTeacher.id,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});

		// HTTP API calls
		const revokedRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=${revokedTeacher.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(revokedRes.status).toBe(400);
		const revokedJson = await revokedRes.json();
		expect(revokedJson).toEqual({
			error: "Selected teacher is not eligible in this division.",
		});

		const futureRes = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=${futureTeacher.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(futureRes.status).toBe(400);
		const futureJson = await futureRes.json();
		expect(futureJson).toEqual({
			error: "Selected teacher is not eligible in this division.",
		});
	});

	it("rejects class eligibility for teacher with expired entitlement (#189)", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Sophie",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 11,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const offering = await f.organizations.createMembershipProductRecord({
			organizationId: f.org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/189-2",
			shopifyVariantGid: "gid://shopify/ProductVariant/189-2",
			productNameSnapshot: "Teacher Membership",
		});

		const expiredTeacher = await f.createCustomer(
			"Expired Teacher",
			"expired.teacher@example.com",
			"t-expired",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: expiredTeacher.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.pianoDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-expired-1",
			shopifyOrderGid: "gid://shopify/Order/expired-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/expired-1",
			startsOn: "2025-01-01",
			endsOn: "2026-01-01",
			status: "active",
			verifiedIdentityEmail: "expired.teacher@example.com",
		});

		const { app } = await createApp({
			env: { port: 3000, trustProxyHeaders: false },
			repository: f.organizations,
			authVerifier: new MockAuthVerifier(),
			customerAccountService: f.service,
		});
		const authCookie = `${CUSTOMER_SESSION_COOKIE}=${parent.sessionId}`;

		// Direct service call
		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				expiredTeacher.id,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});

		// HTTP API call
		const res = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=${expiredTeacher.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json).toEqual({
			error: "Selected teacher is not eligible in this division.",
		});
	});

	it("rejects class eligibility for teacher belonging to another tenant (#189)", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Liam",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 12,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const otherDivision = await f.organizations.createDivision({
			organizationId: f.otherOrg.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const otherOffering = await f.organizations.createMembershipProductRecord({
			organizationId: f.otherOrg.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/189-3",
			shopifyVariantGid: "gid://shopify/ProductVariant/189-3",
			productNameSnapshot: "Teacher Membership",
		});

		const otherTenantTeacher = await f.createCustomer(
			"Other Tenant Teacher",
			"other.tenant.teacher@example.com",
			"t-other-tenant-189",
			f.otherOrg.id,
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.otherOrg.id,
			customerId: otherTenantTeacher.id,
			entitlementClass: "teacher_membership",
			offeringId: otherOffering.id,
			durationDays: 365,
			divisionId: otherDivision.id,
			divisionNameSnapshot: "Piano",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-other-tenant-1",
			shopifyOrderGid: "gid://shopify/Order/other-tenant-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/other-tenant-1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "other.tenant.teacher@example.com",
		});

		const { app } = await createApp({
			env: { port: 3000, trustProxyHeaders: false },
			repository: f.organizations,
			authVerifier: new MockAuthVerifier(),
			customerAccountService: f.service,
		});
		const authCookie = `${CUSTOMER_SESSION_COOKIE}=${parent.sessionId}`;

		// Direct service call against f.org
		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				otherTenantTeacher.id,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});

		// HTTP API call against f.org
		const res = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=${otherTenantTeacher.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json).toEqual({
			error: "Selected teacher is not eligible in this division.",
		});
	});

	it("rejects class eligibility for teacher entitled only in a different division (#189)", async () => {
		const f = await createSelectionFixture();
		const parent = await f.createParentSession();

		const child = await f.repository.createChild({
			organizationId: f.org.id,
			parentCustomerId: parent.customer.id,
			displayName: "Mia",
		});
		await f.repository.createChildAgeSnapshot({
			organizationId: f.org.id,
			childId: child.id,
			age: 9,
			validUntilIso: new Date(
				f.now().getTime() + 90 * 86_400_000,
			).toISOString(),
		});

		const offering = await f.organizations.createMembershipProductRecord({
			organizationId: f.org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/189-4",
			shopifyVariantGid: "gid://shopify/ProductVariant/189-4",
			productNameSnapshot: "Teacher Membership",
		});

		// Teacher entitled only in Strings division
		const stringsTeacher = await f.createCustomer(
			"Strings Only Teacher",
			"strings.only@example.com",
			"t-strings-only",
		);
		await f.organizations.createEntitlementGrantSnapshot({
			organizationId: f.org.id,
			customerId: stringsTeacher.id,
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: f.stringsDivision.id,
			divisionNameSnapshot: "Strings",
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-strings-only-1",
			shopifyOrderGid: "gid://shopify/Order/strings-only-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/strings-only-1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "strings.only@example.com",
		});

		const { app } = await createApp({
			env: { port: 3000, trustProxyHeaders: false },
			repository: f.organizations,
			authVerifier: new MockAuthVerifier(),
			customerAccountService: f.service,
		});
		const authCookie = `${CUSTOMER_SESSION_COOKIE}=${parent.sessionId}`;

		// Direct service call for Piano division with Strings teacher
		await expect(
			f.service.listRegistrationEligibleClasses(
				f.org.slug,
				f.festival.shortName,
				parent.sessionId,
				child.id,
				f.pianoDivision.id,
				stringsTeacher.id,
			),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected teacher is not eligible in this division.",
		});

		// HTTP API call for Piano division with Strings teacher
		const res = await app.request(
			`/api/organizations/${f.org.slug}/customer/festivals/${f.festival.shortName}/registration/eligible-classes?childId=${child.id}&divisionId=${f.pianoDivision.id}&teacherId=${stringsTeacher.id}`,
			{
				headers: {
					Cookie: authCookie,
				},
			},
		);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json).toEqual({
			error: "Selected teacher is not eligible in this division.",
		});
	});
});
