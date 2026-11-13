import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRecoveryRepository } from "../../../src/checkout/checkout-recovery-repository.js";
import { InMemoryCheckoutRepository } from "../../../src/checkout/checkout-repository.js";
import {
	CheckoutRecoveryService,
	type ClassCheckoutDomainEvent,
	ClassCheckoutEventBus,
	ClassEligibilityService,
	DropTransferService,
	MembershipCheckoutService,
	WaitlistService,
} from "../../../src/domains/class-checkout/index.js";
import { InMemoryRegistrationChangeRepository } from "../../../src/registration/in-memory-registration-change-repository.js";
import { InMemoryWaitlistRepository } from "../../../src/waitlist/in-memory-waitlist-repository.js";

function makeClass(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		organizationId: "org-1",
		festivalId: "fest-1",
		displayName: `Class ${id}`,
		classSubtypeId: "sub-1",
		divisionId: "div-1",
		minimumAge: 6,
		maximumAge: 18,
		price: "50.00",
		maximumPerformancePieces: 2 as const,
		performanceMinutes: 10,
		capacity: 1,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		isActive: true,
		createdAtIso: "2026-01-01T00:00:00.000Z",
		updatedAtIso: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("ClassCheckout domain services & events", () => {
	it("subscribes, delivers, and unsubscribes on ClassCheckoutEventBus", () => {
		const bus = new ClassCheckoutEventBus();
		const events: ClassCheckoutDomainEvent[] = [];
		const off = bus.subscribe((ev) => events.push(ev));
		bus.emit({
			type: "CheckoutIntentResolved",
			organizationId: "org-1",
			customerId: "cust-1",
			checkoutIntentId: "int-1",
		});
		off();
		bus.emit({
			type: "ClassCapacityChanged",
			organizationId: "org-1",
			festivalId: "fest-1",
			festivalClassId: "cls-1",
		});
		expect(events).toHaveLength(1);
		expect(events[0]?.type).toBe("CheckoutIntentResolved");
	});

	it("evaluates prerequisite class eligibility even when preloaded classes are supplied", async () => {
		const target = makeClass("cls-target", {
			prerequisiteFestivalClassId: "cls-prereq",
		});
		const prereq = makeClass("cls-prereq");
		const service = new ClassEligibilityService(
			{
				getOrganizationTimezone: async () => "UTC",
			} as never,
			{
				findFestivalClassConfigurationById: async (_org: string, id: string) =>
					id === "cls-prereq" ? prereq : null,
				listFestivalClassConfigurations: async () => [target, prereq],
				listRegistrationCatalogValues: async () => [],
			} as never,
			{} as never,
			{
				listClassEntitlements: async () => [
					{
						id: "e-prereq",
						organizationId: "org-1",
						festivalId: "fest-1",
						festivalClassId: "cls-prereq",
						parentCustomerId: "cust-1",
						childId: "child-1",
						checkoutIntentId: "i-0",
						shopifyOrderGid: "o-0",
						shopifyOrderLineGid: "l-0",
						paidAmountCents: 5000,
						paidCurrencyCode: "USD",
						status: "confirmed",
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				],
			} as never,
			() => new Date("2026-06-01T00:00:00.000Z"),
		);

		const res = await service.evaluateEligibility(
			{
				organizationId: "org-1",
				customerId: "cust-1",
				items: [{ festivalClassId: "cls-target", childId: "child-1" }],
			},
			{
				children: new Map([
					[
						"child-1",
						{
							id: "child-1",
							displayName: "Alice",
							ageSnapshot: {
								age: 10,
								createdAtIso: "2026-01-01T00:00:00.000Z",
								validUntilIso: "2028-01-01T00:00:00.000Z",
							},
						},
					],
				]),
				festival: {
					id: "fest-1",
					organizationId: "org-1",
					code: "F1",
					shortName: "f1",
					isPrimary: true,
					name: "Fest",
					startDate: "2027-06-01",
					endDate: "2027-06-02",
					registrationOpensAt: "2026-01-01T00:00:00.000Z",
					registrationClosesAt: "2027-05-01T00:00:00.000Z",
					createdAtIso: "2026-01-01T00:00:00.000Z",
				},
				isRegistrationOpen: true,
				classes: [target],
				subtypes: [],
			},
		);
		expect(res.isEligible).toBeTrue();
	});

	it("starts membership checkout and emits CheckoutIntentResolved", async () => {
		const bus = new ClassCheckoutEventBus();
		const events: ClassCheckoutDomainEvent[] = [];
		bus.subscribe((ev) => events.push(ev));
		const service = new MembershipCheckoutService(
			{
				getOrganizationTimezone: async () => "UTC",
				getShopifyIntegration: async () => ({
					shopDomain: "shop.example.com",
					integrationVersion: 1,
				}),
				getOrganizationStorefrontConfig: async () => ({
					storefrontDomain: "shop.example.com",
					integrationVersion: 1,
				}),
			} as never,
			{
				listDivisions: async () => [
					{ id: "div-1", displayName: "Piano", isActive: true },
				],
				findMembershipProductRecordByClass: async () => ({
					shopifyProductGid: "gid://shopify/Product/1",
					shopifyVariantGid: "gid://shopify/ProductVariant/1",
				}),
			} as never,
			{ listEntitlementGrantSnapshots: async () => [] } as never,
			new InMemoryCheckoutRepository(),
			{
				createCart: async () => ({ shopifyCartId: "gid://shopify/Cart/1" }),
				checkout: async () => ({
					checkoutUrl: "https://shop.example.com/checkouts/1",
				}),
			},
			{
				list: async () => ({
					membershipProducts: [
						{
							id: "off-1",
							name: "Teacher Membership",
							description: "",
							durationDays: 365,
							price: { amount: "75.00", currencyCode: "USD" },
						},
					],
				}),
			} as never,
			() => new Date(),
			bus,
		);

		const res = await service.start({
			organizationId: "org-1",
			organizationSlug: "fest",
			customerId: "cust-1",
			sessionId: "sess-1",
			idempotencyKey: "key-1",
			buyerAccessToken: "tok",
			offeringId: "off-1",
			divisionId: "div-1",
			staffAccessConsent: true,
		});
		expect(res.checkoutUrl).toBe("https://shop.example.com/checkouts/1");
		expect(events.map((e) => e.type)).toEqual(["CheckoutIntentResolved"]);
	});

	it("emits ClassCapacityChanged on waitlist join/withdraw", async () => {
		const bus = new ClassCheckoutEventBus();
		const events: ClassCheckoutDomainEvent[] = [];
		bus.subscribe((ev) => events.push(ev));
		const service = new WaitlistService({
			waitlistRepo: new InMemoryWaitlistRepository(),
			catalog: {
				findFestivalClassConfigurationById: async () =>
					makeClass("cls-1", { capacity: 1 }),
				listFestivals: async () => [],
			} as never,
			customers: {
				findChild: async () => ({ id: "child-1", displayName: "Alice" }),
			} as never,
			entitlementCount: async () => 1,
			hasActiveEntitlementFn: async () => false,
			eventBus: bus,
		});

		const firstJoin = await service.joinWaitlist({
			organizationId: "org-1",
			festivalClassId: "cls-1",
			parentCustomerId: "cust-1",
			childId: "child-1",
		});
		const repeatJoin = await service.joinWaitlist({
			organizationId: "org-1",
			festivalClassId: "cls-1",
			parentCustomerId: "cust-1",
			childId: "child-1",
		});
		await service.withdrawWaitlist({
			organizationId: "org-1",
			festivalClassId: "cls-1",
			childId: "child-1",
			parentCustomerId: "cust-1",
		});
		expect(firstJoin.action).toBe("joined");
		expect(repeatJoin.alreadyJoined).toBeTrue();
		expect(events.map((e) => e.type)).toEqual([
			"ClassCapacityChanged",
			"ClassCapacityChanged",
		]);
	});

	it("drops confirmed registration, promotes top waitlisted, refunds, and emits ClassCapacityChanged", async () => {
		const bus = new ClassCheckoutEventBus();
		const events: ClassCheckoutDomainEvent[] = [];
		bus.subscribe((ev) => events.push(ev));
		const store = new Map([
			[
				"e-1",
				{
					id: "e-1",
					organizationId: "org-1",
					festivalId: "fest-1",
					festivalClassId: "cls-1",
					parentCustomerId: "cust-1",
					childId: "child-1",
					checkoutIntentId: "i-1",
					shopifyOrderGid: "gid://shopify/Order/1",
					shopifyOrderLineGid: "gid://shopify/LineItem/1",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "confirmed" as const,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
			[
				"e-2",
				{
					id: "e-2",
					organizationId: "org-1",
					festivalId: "fest-1",
					festivalClassId: "cls-1",
					parentCustomerId: "cust-2",
					childId: "child-2",
					checkoutIntentId: "i-2",
					shopifyOrderGid: "gid://shopify/Order/2",
					shopifyOrderLineGid: "gid://shopify/LineItem/2",
					paidAmountCents: 5000,
					paidCurrencyCode: "USD",
					status: "waitlisted" as const,
					createdAt: "2026-01-02T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
				},
			],
		]);
		const service = new DropTransferService({
			entitlements: {
				getClassEntitlement: async (_o: string, id: string) =>
					store.get(id) ?? null,
				listClassEntitlements: async (f: {
					festivalClassId?: string;
					status?: string;
				}) =>
					[...store.values()].filter(
						(e) =>
							(!f.festivalClassId || e.festivalClassId === f.festivalClassId) &&
							(!f.status || e.status === f.status),
					),
				updateClassEntitlement: async (
					_o: string,
					id: string,
					updates: { status?: string },
				) => {
					const cur = store.get(id);
					if (!cur) return null;
					const next = { ...cur, ...updates };
					store.set(id, next as never);
					return next as never;
				},
				updateClassEntitlementStatus: async (
					_o: string,
					id: string,
					status: string,
				) => {
					const cur = store.get(id);
					if (!cur) return null;
					const next = { ...cur, status };
					store.set(id, next as never);
					return next as never;
				},
			} as never,
			changeRepo: new InMemoryRegistrationChangeRepository(),
			capacityResolver: async () => 1,
			refundProvider: {
				supportsLineTargetedRefund: true,
				createRefund: async (req) => ({
					id: "gid://shopify/Refund/1",
					orderId: req.orderId,
					allocations: [
						{
							shopifyOrderLineId: req.shopifyOrderLineId,
							amountCents: req.amountCents,
							currency: req.currency,
						},
					],
				}),
			},
			eventBus: bus,
		});

		const result = await service.dropRegistration({
			organizationId: "org-1",
			classEntitlementId: "e-1",
			issueRefund: true,
			actorUid: "cust-1",
		});
		expect(result.classEntitlement?.status).toBe("cancelled");
		expect(result.promotedWaitlistEntitlements).toHaveLength(1);
		expect(result.promotedWaitlistEntitlements?.[0]?.classEntitlementId).toBe(
			"e-2",
		);
		expect(result.refundEvent?.status).toBe("completed");
		expect(events.map((e) => e.type)).toEqual([
			"ClassCapacityChanged",
			"ClassCapacityChanged",
		]);
	});

	it("creates and resumes checkout recovery requests and invalidates source intent", async () => {
		const bus = new ClassCheckoutEventBus();
		const events: ClassCheckoutDomainEvent[] = [];
		bus.subscribe((ev) => events.push(ev));
		const recoveryRepo = new InMemoryCheckoutRecoveryRepository();
		recoveryRepo.addIntent({
			id: "int-src",
			correlationId: "corr-src",
			organizationId: "org-1",
			customerId: "cust-1",
			sessionId: "sess-1",
			idempotencyKey: "key-src",
			intentType: "membership",
			offeringId: "off-1",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			festivalClassId: null,
			childId: null,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			divisionId: "div-1",
			divisionNameSnapshot: "Piano",
			staffAccessConsent: true,
			amount: "75.00",
			currencyCode: "USD",
			cartReference: null,
			status: "failed",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			createdAtIso: "2026-01-01T00:00:00.000Z",
		});
		const service = new CheckoutRecoveryService({
			recoveryRepo,
			checkoutRepo: new InMemoryCheckoutRepository(),
			organizations: {
				findOrganizationById: async () => ({
					id: "org-1",
					name: "Fest Org",
					slug: "fest",
				}),
				getShopifyIntegration: async () => ({
					shopDomain: "shop.example.com",
					integrationVersion: 1,
				}),
				getOrganizationStorefrontConfig: async () => ({
					storefrontDomain: "shop.example.com",
					integrationVersion: 1,
				}),
			} as never,
			catalog: {
				findMembershipProductRecordByClass: async () => ({
					shopifyProductGid: "gid://shopify/Product/1",
					shopifyVariantGid: "gid://shopify/ProductVariant/1",
				}),
			} as never,
			customers: { getCustomer: async () => null } as never,
			listings: {
				list: async () => ({
					membershipProducts: [
						{
							id: "off-1",
							name: "Teacher Membership",
							description: "",
							durationDays: 365,
							price: { amount: "75.00", currencyCode: "USD" },
						},
					],
				}),
			} as never,
			storefront: {
				createCart: async () => ({ shopifyCartId: "gid://shopify/Cart/2" }),
				checkout: async () => ({
					checkoutUrl: "https://shop.example.com/checkouts/2",
				}),
			},
			publicOrigin: "https://app.example.com",
			eventBus: bus,
			now: () => new Date(),
		});

		const created = await service.createRecovery({
			organizationId: "org-1",
			customerId: "cust-1",
			sourceCheckoutIntentId: "int-src",
			actorUid: "admin-1",
		});
		const review = await service.getRecoveryReviewDto(created.token, "org-1");
		expect(review.offering.id).toBe("off-1");

		const resumed = await service.resumeCustomerCheckout({
			organizationId: "org-1",
			token: created.token,
			customer: {
				customerId: "cust-1",
				sessionId: "sess-2",
				buyerAccessToken: "tok",
			},
		});
		expect(resumed.checkoutUrl).toBe("https://shop.example.com/checkouts/2");
		expect(
			await recoveryRepo.listRecoverableIntents("org-1", "cust-1"),
		).toEqual([]);

		await service.invalidateIntent({
			organizationId: "org-1",
			intentId: "int-src",
			actorUid: "admin-1",
		});
		expect(events.map((e) => e.type)).toEqual(["CheckoutIntentResolved"]);
	});
});
