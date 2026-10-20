import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { RepertoirePiece } from "@festival/common";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import {
	ClassCheckoutService,
	type ClassCheckoutStorefront,
	type StartClassCheckoutInput,
} from "../src/checkout/class-checkout-service.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";

interface RegistrationWindowTestFixtureOptions {
	now?: Date;
	timezone?: string;
	registrationOpensAt?: string | null;
	registrationClosesAt?: string | null;
	festivalStartDate?: string;
	festivalEndDate?: string;
	capacity?: number;
	placedCount?: number;
}

async function createRegistrationWindowFixture(
	options: RegistrationWindowTestFixtureOptions = {},
) {
	let currentNow = options.now ?? new Date("2026-06-01T12:00:00.000Z");
	const nowFn = () => currentNow;
	const setNow = (next: Date) => {
		currentNow = next;
	};

	const organizations = new InMemoryOrganizationRepository(nowFn);
	const customers = new InMemoryCustomerAccountRepository();
	const checkout = new InMemoryCheckoutRepository(nowFn);
	const commerce = new InMemoryMembershipCommerceRepository();

	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("Failed to initialize test keyring.");

	const organization = await organizations.createOrganization({
		name: "Registration Window Test Org",
		slug: "reg-window-org",
	});
	if (options.timezone) {
		await organizations.updateOrganizationTimezone(
			organization.id,
			options.timezone,
		);
	}
	await organizations.updateRegistrationAgeConfiguration({
		organizationId: organization.id,
		registrationAgeDate: "2026-06-01",
	});

	const storeDomain = "reg-window.myshopify.com";
	await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain,
		clientId: "client-id",
		encryptedClientSecret: "encrypted-secret",
	});

	await customers.upsertIntegration({
		organizationId: organization.id,
		storefrontDomain: "store.example.com",
		clientId: "client-id",
		encryptedClientSecret: keyring.encrypt("secret", {
			organizationId: organization.id,
			purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
		}),
		apiVersion: "2026-07",
		readiness: "ready",
		canReadOrders: true,
		integrationVersion: 1,
		updatedAtIso: currentNow.toISOString(),
	});

	const division = await organizations.createDivision({
		organizationId: organization.id,
		displayName: "Piano",
		normalizedName: "piano",
	});

	const subtype = await organizations.createRegistrationCatalogValue({
		organizationId: organization.id,
		kind: "class_subtype",
		displayName: "Solo Piano",
		normalizedName: "solo piano",
	});

	const festival = await organizations.createFestival({
		id: "fest-window-1",
		organizationId: organization.id,
		code: "WIN2026",
		shortName: "spring-2026",
		name: "Spring Festival 2026",
		startDate: options.festivalStartDate ?? "2026-06-01",
		endDate: options.festivalEndDate ?? "2026-06-10",
		registrationOpensAt: options.registrationOpensAt ?? null,
		registrationClosesAt: options.registrationClosesAt ?? null,
	});
	await organizations.setPrimaryFestival(organization.id, festival.id);

	const capacity = options.capacity ?? 10;
	const classConfig = await organizations.createFestivalClassConfiguration({
		organizationId: organization.id,
		festivalId: festival.id,
		displayName: "Junior Piano Solo",
		classSubtypeId: subtype.id,
		divisionId: division.id,
		minimumAge: 8,
		maximumAge: 14,
		price: "45.00",
		maximumPerformancePieces: 2,
		performanceMinutes: 10,
		capacity,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/100",
		shopifyVariantGid: "gid://shopify/ProductVariant/200",
	});

	const placedCount = options.placedCount ?? 0;
	for (let i = 0; i < placedCount; i++) {
		await commerce.createClassEntitlement({
			organizationId: organization.id,
			festivalId: festival.id,
			festivalClassId: classConfig.id,
			parentCustomerId: `other-parent-${i}`,
			childId: `other-child-${i}`,
			checkoutIntentId: `other-intent-${i}`,
			shopifyOrderGid: `gid://shopify/Order/other-${i}`,
			shopifyOrderLineGid: `gid://shopify/OrderLineItem/other-${i}`,
			paidAmountCents: 4500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});
	}

	const sessionId = "sess-window-test-1";
	const { customer } = await customers.createCustomerSession({
		sessionId,
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/555",
		encryptedTokens: keyring.encrypt(
			JSON.stringify({ accessToken: "token", idToken: "id-token" }),
			{
				organizationId: organization.id,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			},
		),
		csrfToken: "csrf-token-window",
		integrationVersion: 1,
		createdAtIso: currentNow.toISOString(),
		touchedAtIso: currentNow.toISOString(),
		lastSeenAtIso: currentNow.toISOString(),
		expiresAtIso: new Date(
			currentNow.getTime() + 30 * 86_400_000,
		).toISOString(),
		absoluteExpiresAtIso: new Date(
			currentNow.getTime() + 60 * 86_400_000,
		).toISOString(),
		tokenExpiresAtIso: new Date(
			currentNow.getTime() + 30 * 86_400_000,
		).toISOString(),
	});

	const child = await customers.createChild({
		organizationId: organization.id,
		parentCustomerId: customer.id,
		displayName: "Clara Performer",
	});
	await customers.createChildAgeSnapshot({
		organizationId: organization.id,
		childId: child.id,
		age: 10,
		createdAtIso: currentNow.toISOString(),
		validUntilIso: new Date(
			currentNow.getTime() + 60 * 86_400_000,
		).toISOString(),
	});

	const teacherOffering = await organizations.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/teacher-1",
		shopifyVariantGid: "gid://shopify/ProductVariant/teacher-1",
		productNameSnapshot: "Teacher Membership",
	});
	const teacherId = "teacher-window-1";
	organizations.setCustomerName(teacherId, "Teacher Clara");
	await organizations.createEntitlementGrantSnapshot({
		organizationId: organization.id,
		customerId: teacherId,
		entitlementClass: "teacher_membership",
		offeringId: teacherOffering.id,
		durationDays: 365,
		divisionId: division.id,
		divisionNameSnapshot: division.displayName,
		paidAmount: "50.00",
		paidCurrencyCode: "USD",
		checkoutIntentId: "teacher-intent-1",
		shopifyOrderGid: "gid://shopify/Order/teacher-1",
		shopifyOrderLineGid: "gid://shopify/LineItem/teacher-1",
		startsOn: "2026-01-01",
		endsOn: "2027-01-01",
		status: "active",
		verifiedIdentityEmail: "teacher@example.com",
	});

	let createCartCalls = 0;
	let checkoutCalls = 0;
	const storefront: ClassCheckoutStorefront = {
		createCart: async () => {
			createCartCalls += 1;
			return { shopifyCartId: `gid://shopify/Cart/${createCartCalls}` };
		},
		checkout: async () => {
			checkoutCalls += 1;
			return {
				checkoutUrl: `https://${storeDomain}/checkouts/c-${checkoutCalls}`,
			};
		},
	};

	const checkoutService = new ClassCheckoutService(
		organizations,
		customers,
		checkout,
		storefront,
		commerce,
		nowFn,
	);
	const customerAccountService = new CustomerAccountService(
		customers,
		organizations,
		keyring,
		{
			publicOrigin: "https://festival.example.com",
			now: nowFn,
		},
		commerce,
		checkout,
	);

	const defaultPieces: RepertoirePiece[] = [
		{
			title: "Sonatina in C Major",
			composer: "Muzio Clementi",
			durationSeconds: 120,
		},
	];

	const buildCheckoutInput = (): StartClassCheckoutInput => ({
		organizationId: organization.id,
		customerId: customer.id,
		sessionId,
		idempotencyKey: randomUUID(),
		festivalClassId: classConfig.id,
		childId: child.id,
		buyerAccessToken: "buyer-token",
		teacherId,
		pieces: defaultPieces,
	});

	return {
		organizations,
		customers,
		checkout,
		commerce,
		organization,
		division,
		festival,
		classConfig,
		customer,
		sessionId,
		child,
		teacherId,
		checkoutService,
		customerAccountService,
		buildCheckoutInput,
		setNow,
		getCreateCartCalls: () => createCartCalls,
		getCheckoutCalls: () => checkoutCalls,
	};
}

describe("Festival registration window eligibility (#263)", () => {
	it("fails closed with REGISTRATION_CLOSED when registration window is unset even during festival event dates", async () => {
		const f = await createRegistrationWindowFixture({
			now: new Date("2026-06-05T12:00:00.000Z"),
			festivalStartDate: "2026-06-01",
			festivalEndDate: "2026-06-10",
			registrationOpensAt: null,
			registrationClosesAt: null,
		});

		const selection =
			await f.customerAccountService.listRegistrationEligibleClasses(
				f.organization.slug,
				f.festival.shortName,
				f.sessionId,
				f.child.id,
				f.division.id,
				f.teacherId,
			);
		expect(selection.classes).toHaveLength(1);
		expect(selection.classes[0]?.isRegistrationOpen).toBe(false);

		const advisory = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalShortName: f.festival.shortName,
			mode: "advisory",
			items: [
				{
					id: `candidate:${f.classConfig.id}`,
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
					isCandidate: true,
				},
			],
		});
		expect(advisory.isEligible).toBe(false);
		expect(advisory.results[0]).toMatchObject({
			childId: f.child.id,
			festivalClassId: f.classConfig.id,
			isEligible: false,
			reasonCode: "REGISTRATION_CLOSED",
		});

		const cartEval = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			mode: "cart",
			items: [{ childId: f.child.id, festivalClassId: f.classConfig.id }],
		});
		expect(cartEval.isEligible).toBe(false);
		expect(cartEval.results[0]?.reasonCode).toBe("REGISTRATION_CLOSED");

		await expect(
			f.checkoutService.start(f.buildCheckoutInput()),
		).rejects.toMatchObject({
			status: 400,
			code: "registration_closed",
			message: "Registration is closed for this festival.",
			details: {
				failures: [
					expect.objectContaining({
						childId: f.child.id,
						festivalClassId: f.classConfig.id,
						reasonCode: "REGISTRATION_CLOSED",
					}),
				],
			},
		});

		expect(f.getCreateCartCalls()).toBe(0);
		expect(f.getCheckoutCalls()).toBe(0);
		expect(
			(f.checkout as unknown as { intents: Map<string, unknown> }).intents.size,
		).toBe(0);
		expect(
			await f.commerce.listClassEntitlements({
				organizationId: f.organization.id,
				festivalId: f.festival.id,
			}),
		).toHaveLength(0);
	});

	it("enforces exact inclusive open and close boundary instants across selection, cart, and checkout", async () => {
		const opensAtIso = "2026-06-01T16:00:00.000Z";
		const closesAtIso = "2026-06-15T23:59:59.000Z";
		const f = await createRegistrationWindowFixture({
			now: new Date("2026-06-01T15:59:59.999Z"),
			registrationOpensAt: opensAtIso,
			registrationClosesAt: closesAtIso,
		});

		// 1. 1ms before open -> closed
		const beforeOpenEval = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			items: [{ childId: f.child.id, festivalClassId: f.classConfig.id }],
		});
		expect(beforeOpenEval.isEligible).toBe(false);
		expect(beforeOpenEval.results[0]?.reasonCode).toBe("REGISTRATION_CLOSED");
		await expect(
			f.checkoutService.start(f.buildCheckoutInput()),
		).rejects.toMatchObject({
			status: 400,
			code: "registration_closed",
		});
		expect(f.getCreateCartCalls()).toBe(0);

		// 2. Exact open instant -> eligible
		f.setNow(new Date(opensAtIso));
		const atOpenEval = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			items: [{ childId: f.child.id, festivalClassId: f.classConfig.id }],
		});
		expect(atOpenEval.isEligible).toBe(true);
		expect(atOpenEval.results[0]?.reasonCode).toBe("AVAILABLE");

		// 3. Exact close instant -> eligible and checkout succeeds
		f.setNow(new Date(closesAtIso));
		const atCloseEval = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			items: [{ childId: f.child.id, festivalClassId: f.classConfig.id }],
		});
		expect(atCloseEval.isEligible).toBe(true);
		expect(atCloseEval.results[0]?.reasonCode).toBe("AVAILABLE");
		const checkoutRes = await f.checkoutService.start(f.buildCheckoutInput());
		expect(checkoutRes.checkoutUrl).toContain("https://");
		expect(f.getCreateCartCalls()).toBe(1);

		// 4. 1ms after close -> closed
		f.setNow(new Date("2026-06-15T23:59:59.001Z"));
		const afterCloseEval = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			items: [{ childId: f.child.id, festivalClassId: f.classConfig.id }],
		});
		expect(afterCloseEval.isEligible).toBe(false);
		expect(afterCloseEval.results[0]?.reasonCode).toBe("REGISTRATION_CLOSED");
	});

	it("evaluates local registration windows using the organization's configured IANA timezone", async () => {
		// 2026-06-01T13:30:00.000Z is 09:30 EDT in America/New_York (open for 09:00 local)
		// but 06:30 PDT in America/Los_Angeles (closed for 09:00 local).
		const instant = new Date("2026-06-01T13:30:00.000Z");

		const nyFixture = await createRegistrationWindowFixture({
			now: instant,
			timezone: "America/New_York",
			registrationOpensAt: "2026-06-01T09:00",
			registrationClosesAt: "2026-06-15T17:00",
		});
		const laFixture = await createRegistrationWindowFixture({
			now: instant,
			timezone: "America/Los_Angeles",
			registrationOpensAt: "2026-06-01T09:00",
			registrationClosesAt: "2026-06-15T17:00",
		});

		const nyEval = await nyFixture.checkoutService.evaluateEligibility({
			organizationId: nyFixture.organization.id,
			customerId: nyFixture.customer.id,
			festivalId: nyFixture.festival.id,
			items: [
				{
					childId: nyFixture.child.id,
					festivalClassId: nyFixture.classConfig.id,
				},
			],
		});
		expect(nyEval.isEligible).toBe(true);
		expect(nyEval.results[0]?.reasonCode).toBe("AVAILABLE");

		const laEval = await laFixture.checkoutService.evaluateEligibility({
			organizationId: laFixture.organization.id,
			customerId: laFixture.customer.id,
			festivalId: laFixture.festival.id,
			items: [
				{
					childId: laFixture.child.id,
					festivalClassId: laFixture.classConfig.id,
				},
			],
		});
		expect(laEval.isEligible).toBe(false);
		expect(laEval.results[0]?.reasonCode).toBe("REGISTRATION_CLOSED");
	});

	it("returns REGISTRATION_CLOSED for purchase while preserving waitlist availability metadata when a full class is evaluated after registration closes", async () => {
		const f = await createRegistrationWindowFixture({
			now: new Date("2026-06-20T00:00:00.000Z"),
			registrationOpensAt: "2026-05-01T00:00:00.000Z",
			registrationClosesAt: "2026-05-31T23:59:59.999Z",
			capacity: 1,
			placedCount: 1,
		});

		const selection =
			await f.customerAccountService.listRegistrationEligibleClasses(
				f.organization.slug,
				f.festival.shortName,
				f.sessionId,
				f.child.id,
				f.division.id,
				f.teacherId,
			);
		expect(selection.classes[0]).toMatchObject({
			id: f.classConfig.id,
			availability: "waitlist",
			capacity: 1,
			placedCount: 1,
			isRegistrationOpen: false,
		});

		const advisory = await f.checkoutService.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival.id,
			mode: "advisory",
			items: [
				{
					id: `candidate:${f.classConfig.id}`,
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
					isCandidate: true,
				},
			],
		});
		expect(advisory.isEligible).toBe(false);
		expect(advisory.results[0]).toMatchObject({
			reasonCode: "REGISTRATION_CLOSED",
			availability: "waitlist",
			capacity: 1,
			placedCount: 1,
		});

		await expect(
			f.checkoutService.start(f.buildCheckoutInput()),
		).rejects.toMatchObject({
			status: 400,
			code: "registration_closed",
			message: "Registration is closed for this festival.",
		});
		expect(f.getCreateCartCalls()).toBe(0);
	});
});
