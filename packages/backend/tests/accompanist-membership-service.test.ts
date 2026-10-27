import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { AccompanistMembershipConflictError } from "../src/repo/organization-repository.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";

async function setup() {
	let now = new Date("2026-09-12T12:00:00.000Z");
	const repository = new InMemoryOrganizationRepository(() => now);
	const organization = await repository.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const division = await repository.createDivision({
		organizationId: organization.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const service = new AccompanistMembershipService(repository, () => now);
	return {
		repository,
		organization,
		division,
		service,
		setNow(value: string) {
			now = new Date(value);
		},
	};
}

describe("AccompanistMembershipService", () => {
	for (const staffAccessConsent of [undefined, false, "true", 1, null]) {
		it(`rejects direct acquisition with consent ${String(staffAccessConsent)} without creating a grant`, async () => {
			const { repository, organization, division, service } = await setup();
			await expect(
				service.acquire({
					organizationId: organization.id,
					organizationTimezone: "UTC",
					customerId: "customer-1",
					verifiedShopifyCustomerEmail: "shopper@example.com",
					payload: {
						name: "Ava Piano",
						email: "ava@example.com",
						city: "Seattle",
						phone: "+1 206 555 0100",
						divisionIds: [division.id],
						staffAccessConsent,
					},
				}),
			).rejects.toMatchObject({ status: 400 });
			expect(
				await repository.listAccompanistMembershipGrants({
					organizationId: organization.id,
				}),
			).toEqual([]);
		});
	}

	it("creates immutable current membership contact and division snapshots without checkout", async () => {
		const { organization, division, service } = await setup();
		const result = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "America/Los_Angeles",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "SHOPPER@example.com",
			payload: {
				name: "Ava Piano",
				email: "AVA@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				staffAccessConsent: true,
				divisionIds: [division.id],
			},
		});
		expect(result.membership).toMatchObject({
			status: "active",
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
		});
	});

	it("rejects a current membership outside the renewal window", async () => {
		const { organization, division, service } = await setup();
		const payload = {
			name: "Ava Piano",
			email: "ava@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			staffAccessConsent: true,
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload,
		});
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				verifiedShopifyCustomerEmail: "shopper@example.com",
				payload,
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("allows reacquisition after a prior entitlement is revoked", async () => {
		const { repository, organization, division, service } = await setup();
		const input = {
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Piano",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				staffAccessConsent: true,
				divisionIds: [division.id],
			},
		};
		await service.acquire(input);
		const [prior] = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
			customerId: input.customerId,
		});
		if (!prior) throw new Error("Expected Accompanist entitlement.");
		await repository.revokeEntitlement({
			organizationId: organization.id,
			entitlementId: prior.id,
			actorUserId: "admin",
			reason: "Refunded",
			revokedAtIso: "2026-09-12T13:00:00.000Z",
		});

		await expect(service.acquire(input)).resolves.toMatchObject({
			membership: { status: "active" },
		});
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
				customerId: input.customerId,
			}),
		).toMatchObject([{ status: "revoked" }, { status: "active" }]);
	});

	it("returns a conflict when the repository settles a concurrent acquisition", async () => {
		const { repository, organization, division, service } = await setup();
		repository.createAccompanistMembershipGrant = async () => {
			throw new AccompanistMembershipConflictError();
		};
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				verifiedShopifyCustomerEmail: "shopper@example.com",
				payload: {
					name: "Ava Piano",
					email: "ava@example.com",
					city: "Seattle",
					phone: "+1 206 555 0100",
					staffAccessConsent: true,
					divisionIds: [division.id],
				},
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("keeps the prior grant and schedules a successor inside the 30-day renewal window", async () => {
		const { repository, organization, division, service, setNow } =
			await setup();
		const payload = {
			name: "Ava Piano",
			email: "ava@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			staffAccessConsent: true,
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload,
		});
		setNow("2027-08-14T12:00:00.000Z");
		const scheduled = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: { ...payload, city: "Tacoma" },
		});
		expect(scheduled.membership.status).toBe("scheduled");
		const grants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
		});
		expect(grants).toHaveLength(2);
		expect(grants[0]).toMatchObject({
			status: "active",
			isCurrent: true,
			contact: { city: "Seattle" },
		});
		expect(grants[1]).toMatchObject({
			status: "scheduled",
			isCurrent: false,
			contact: { city: "Tacoma" },
		});
		expect(grants[1]?.startsOn).toBe(grants[0]?.endsOn);
		expect(await service.listCurrentRoster(organization.id)).toMatchObject({
			accompanists: [{ startsOn: "2026-09-12" }],
		});
	});

	it("derives expired status and excludes expired grants from current-only reads", async () => {
		const { repository, organization, division, service, setNow } =
			await setup();
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Piano",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				staffAccessConsent: true,
				divisionIds: [division.id],
			},
		});
		setNow("2027-09-12T12:00:00.000Z");
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
			}),
		).toMatchObject([{ status: "expired", isCurrent: false }]);
		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
				currentOnly: true,
			}),
		).toEqual([]);
	});

	it("uses the verified Shopify email instead of the submitted contact email", async () => {
		const { repository, organization, division, service } = await setup();
		const payload = {
			name: "Ava Piano",
			email: "shared-contact@example.com",
			city: "Seattle",
			phone: "+1 206 555 0100",
			staffAccessConsent: true,
			divisionIds: [division.id],
		};
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "SHOPPER@One.example",
			payload,
		});
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-2",
			verifiedShopifyCustomerEmail: "SHOPPER@Two.example",
			payload,
		});
		const grants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
		});
		expect(grants).toHaveLength(2);
		expect(grants.map((grant) => grant.normalizedEmail)).toEqual([
			"shopper@one.example",
			"shopper@two.example",
		]);
		expect(grants.map((grant) => grant.contact.email)).toEqual([
			"shared-contact@example.com",
			"shared-contact@example.com",
		]);
	});

	it("rejects submission without a verified Shopify customer email", async () => {
		const { organization, division, service } = await setup();
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				payload: {
					name: "Ava Piano",
					email: "ava@example.com",
					city: "Seattle",
					phone: "+1 206 555 0100",
					staffAccessConsent: true,
					divisionIds: [division.id],
				},
			}),
		).rejects.toMatchObject({ status: 422 });
	});

	it("allows a customer holding a Teacher membership to simultaneously acquire an Accompanist membership", async () => {
		const { repository, organization, division, service } = await setup();
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/teacher",
			shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
			productNameSnapshot: "Teacher Membership",
		});
		await repository.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-teacher-1",
			shopifyOrderGid: "gid://shopify/Order/teacher-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/teacher-1",
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
			status: "active",
			verifiedIdentityEmail: "shopper@example.com",
		});

		const result = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Accompanist",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				staffAccessConsent: true,
				divisionIds: [division.id],
			},
		});

		expect(result.membership).toMatchObject({
			status: "active",
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
		});

		const teacherGrants = await repository.listEntitlementGrantSnapshots(
			organization.id,
			"customer-1",
		);
		const accompanistGrants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
			customerId: "customer-1",
		});

		expect(teacherGrants).toHaveLength(1);
		expect(teacherGrants[0].status).toBe("active");
		expect(accompanistGrants).toHaveLength(1);
		expect(accompanistGrants[0].status).toBe("active");
	});

	describe("listCurrentRoster", () => {
		it("includes active teachers and accompanists in a unified sorted roster", async () => {
			const { repository, organization, division, service } = await setup();

			await service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "cust-accompanist",
				verifiedShopifyCustomerEmail: "acc@example.com",
				payload: {
					name: "Beth Accompanist",
					email: "acc@example.com",
					city: "Seattle",
					phone: "+1 206 555 0101",
					staffAccessConsent: true,
					divisionIds: [division.id],
				},
			});

			const offering = await repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/teacher",
				shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
				productNameSnapshot: "Teacher Membership",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-teacher-active",
				shopifyOrderGid: "gid://shopify/Order/teacher-active",
				shopifyOrderLineGid: "gid://shopify/LineItem/teacher-active",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				status: "active",
				verifiedIdentityEmail: "teacher@example.com",
			});

			repository.setCustomerContact(organization.id, {
				customerId: "cust-teacher",
				name: "Aaron Teacher",
				email: "teacher@example.com",
				phone: "+1 206 555 0102",
				city: "Bellevue",
			});

			const result = await service.listCurrentRoster(organization.id);
			expect(result.roster).toHaveLength(2);

			expect(result.roster[0]).toEqual({
				membershipType: "Teacher",
				offeringName: "Teacher Membership",
				source: "teacher_checkout",
				status: "active",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				name: "Aaron Teacher",
				email: "teacher@example.com",
				phone: "+1 206 555 0102",
				city: "Bellevue",
				divisions: [
					{
						divisionId: division.id,
						divisionName: division.displayName,
					},
				],
			});

			expect(result.roster[1]).toEqual({
				membershipType: "Accompanist",
				offeringName: "Accompanist Membership",
				source: "accompanist_form",
				status: "active",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				name: "Beth Accompanist",
				email: "acc@example.com",
				phone: "+1 206 555 0101",
				city: "Seattle",
				divisions: [
					{
						divisionId: division.id,
						divisionName: division.displayName,
					},
				],
			});

			expect(result.accompanists).toHaveLength(1);
			expect(result.accompanists[0].name).toBe("Beth Accompanist");
		});

		it("resolves teacher contact from customer profile with fallback email", async () => {
			const { repository, organization, division, service } = await setup();

			const offering = await repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/teacher",
				shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
				productNameSnapshot: "Annual Teacher Pass",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher-profile",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "80.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-teacher-profile",
				shopifyOrderGid: "gid://shopify/Order/teacher-profile",
				shopifyOrderLineGid: "gid://shopify/LineItem/teacher-profile",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				status: "active",
				verifiedIdentityEmail: "identity-email@example.com",
			});

			repository.setCustomerContact(organization.id, {
				customerId: "cust-teacher-profile",
				name: "Clara Schumann",
				phone: "+1 425 555 1234",
				city: "Kirkland",
			});

			const { roster } = await service.listCurrentRoster(organization.id);
			expect(roster).toHaveLength(1);
			expect(roster[0]).toMatchObject({
				membershipType: "Teacher",
				offeringName: "Annual Teacher Pass",
				name: "Clara Schumann",
				email: "identity-email@example.com",
				phone: "+1 425 555 1234",
				city: "Kirkland",
			});
		});

		it("enforces strict allowlist and redacts sensitive commercial metadata", async () => {
			const { repository, organization, division, service } = await setup();

			const offering = await repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/teacher",
				shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
				productNameSnapshot: "Teacher Membership",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher-sensitive",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "99.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-secret-123",
				shopifyOrderGid: "gid://shopify/Order/secret-gid-456",
				shopifyOrderLineGid: "gid://shopify/LineItem/secret-line-789",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				status: "active",
				verifiedIdentityEmail: "sensitive@example.com",
			});

			repository.setCustomerContact(organization.id, {
				customerId: "cust-teacher-sensitive",
				name: "Secret Teacher",
				email: "sensitive@example.com",
			});

			const { roster } = await service.listCurrentRoster(organization.id);
			expect(roster).toHaveLength(1);
			const entry = roster[0] as unknown as Record<string, unknown>;

			expect(entry.checkoutIntentId).toBeUndefined();
			expect(entry.shopifyOrderGid).toBeUndefined();
			expect(entry.shopifyOrderLineGid).toBeUndefined();
			expect(entry.paidAmount).toBeUndefined();
			expect(entry.paidCurrencyCode).toBeUndefined();
			expect(entry.customerId).toBeUndefined();

			const allowedKeys = new Set([
				"membershipType",
				"offeringName",
				"source",
				"status",
				"startsOn",
				"endsOn",
				"name",
				"email",
				"phone",
				"city",
				"divisions",
			]);
			for (const key of Object.keys(entry)) {
				expect(allowedKeys.has(key)).toBe(true);
			}
		});

		it("handles absent optional contact fields gracefully", async () => {
			const { repository, organization, division, service } = await setup();

			const offering = await repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/teacher",
				shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
				productNameSnapshot: "Teacher Membership",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher-minimal",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-minimal",
				shopifyOrderGid: "gid://shopify/Order/minimal",
				shopifyOrderLineGid: "gid://shopify/LineItem/minimal",
				startsOn: "2026-09-12",
				endsOn: "2027-09-12",
				status: "active",
				verifiedIdentityEmail: "minimal@example.com",
			});

			const { roster } = await service.listCurrentRoster(organization.id);
			expect(roster).toHaveLength(1);
			expect(roster[0].phone).toBeUndefined();
			expect(roster[0].city).toBeUndefined();
			expect(roster[0].email).toBe("minimal@example.com");
			expect(roster[0].name).toBeUndefined();
		});

		it("excludes revoked, expired, and scheduled teacher grants from current roster", async () => {
			const { repository, organization, division, service } = await setup();

			const offering = await repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/teacher",
				shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
				productNameSnapshot: "Teacher Membership",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher-future",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-future",
				shopifyOrderGid: "gid://shopify/Order/future",
				shopifyOrderLineGid: "gid://shopify/LineItem/future",
				startsOn: "2027-01-01",
				endsOn: "2028-01-01",
				status: "scheduled",
				verifiedIdentityEmail: "future@example.com",
			});

			await repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "cust-teacher-past",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-past",
				shopifyOrderGid: "gid://shopify/Order/past",
				shopifyOrderLineGid: "gid://shopify/LineItem/past",
				startsOn: "2025-01-01",
				endsOn: "2026-01-01",
				status: "expired",
				verifiedIdentityEmail: "past@example.com",
			});

			const { roster } = await service.listCurrentRoster(organization.id);
			expect(roster).toEqual([]);
		});
	});
});

const ALL_ON_ONE_PAGE = { page: 1, pageSize: 100 };

describe("AccompanistMembershipService.listEntitlementReport", () => {
	async function seedReport() {
		const context = await setup();
		const { repository, organization, division, service } = context;
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/teacher",
			shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
			productNameSnapshot: "Annual Teacher Pass",
		});
		const teacherGrant = (
			customerId: string,
			overrides: { startsOn: string; endsOn: string; status: string },
		) =>
			repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId,
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: `checkout-${customerId}`,
				shopifyOrderGid: `gid://shopify/Order/${customerId}`,
				shopifyOrderLineGid: `gid://shopify/LineItem/${customerId}`,
				verifiedIdentityEmail: `${customerId}@example.com`,
				...overrides,
			} as Parameters<typeof repository.createEntitlementGrantSnapshot>[0]);
		await teacherGrant("cust-active", {
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
			status: "active",
		});
		await teacherGrant("cust-expired", {
			startsOn: "2025-01-01",
			endsOn: "2026-01-01",
			status: "expired",
		});
		await teacherGrant("cust-scheduled", {
			startsOn: "2027-01-01",
			endsOn: "2028-01-01",
			status: "scheduled",
		});
		const revokedGrant = await teacherGrant("cust-revoked", {
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
			status: "active",
		});
		await repository.revokeEntitlement({
			organizationId: organization.id,
			entitlementId: revokedGrant.id,
			actorUserId: "admin-user",
			reason: "Refunded",
			revokedAtIso: "2026-09-13T00:00:00.000Z",
		});
		for (const [id, name] of [
			["cust-active", "Aaron Teacher"],
			["cust-expired", "Erin Expired"],
			["cust-scheduled", "Sam Scheduled"],
			["cust-revoked", "Rita Revoked"],
		] as const) {
			repository.setCustomerContact(organization.id, {
				customerId: id,
				name,
				email: `${id}@example.com`,
				phone: "+1 206 555 0199",
				city: "Private City",
			});
		}
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "cust-accompanist",
			verifiedShopifyCustomerEmail: "acc@example.com",
			payload: {
				name: "Beth Accompanist",
				email: "acc@example.com",
				city: "Seattle",
				phone: "+1 206 555 0101",
				staffAccessConsent: true,
				divisionIds: [division.id],
			},
		});
		return context;
	}

	it("lists teacher and accompanist entitlements in every lifecycle status, sorted by customer", async () => {
		const { organization, service } = await seedReport();
		const { entries } = await service.listEntitlementReport(
			organization.id,
			{},
			ALL_ON_ONE_PAGE,
		);
		expect(
			entries.map((entry) => [
				entry.customerName,
				entry.entitlementClass,
				entry.status,
			]),
		).toEqual([
			["Aaron Teacher", "teacher_membership", "active"],
			["Beth Accompanist", "accompanist_membership", "active"],
			["Erin Expired", "teacher_membership", "expired"],
			["Rita Revoked", "teacher_membership", "revoked"],
			["Sam Scheduled", "teacher_membership", "scheduled"],
		]);
		expect(entries[0]).toMatchObject({
			offeringName: "Annual Teacher Pass",
			source: "teacher_checkout",
			startsOn: "2026-09-12",
			endsOn: "2027-09-12",
			customerEmail: "cust-active@example.com",
		});
		expect(entries[1]).toMatchObject({
			offeringName: "Accompanist Membership",
			source: "accompanist_form",
		});
	});

	it("filters by entitlement class, status, and customer search", async () => {
		const { organization, service } = await seedReport();
		const names = async (
			filters: Parameters<typeof service.listEntitlementReport>[1],
		) =>
			(
				await service.listEntitlementReport(
					organization.id,
					filters,
					ALL_ON_ONE_PAGE,
				)
			).entries.map((entry) => entry.customerName);
		expect(await names({ entitlementClass: "accompanist_membership" })).toEqual(
			["Beth Accompanist"],
		);
		expect(await names({ status: "expired" })).toEqual(["Erin Expired"]);
		expect(await names({ search: "RITA" })).toEqual(["Rita Revoked"]);
		expect(await names({ search: "cust-sched" })).toEqual(["Sam Scheduled"]);
		expect(
			await names({ entitlementClass: "teacher_membership", status: "active" }),
		).toEqual(["Aaron Teacher"]);
		expect(await names({ search: "no such customer" })).toEqual([]);
	});

	it("returns only the fields needed for the report and never another organization's grants", async () => {
		const { repository, organization, service } = await seedReport();
		const other = await repository.createOrganization({
			name: "Other Festival",
			slug: "other",
		});
		const report = await service.listEntitlementReport(
			organization.id,
			{},
			ALL_ON_ONE_PAGE,
		);
		const { entries } = report;
		for (const entry of entries) {
			expect(Object.keys(entry).sort()).toEqual(
				[
					"customerEmail",
					"customerName",
					"divisions",
					"endsOn",
					"entitlementClass",
					"id",
					"offeringName",
					"source",
					"startsOn",
					"status",
				].sort(),
			);
		}
		expect(JSON.stringify(report)).not.toContain("Private City");
		expect(JSON.stringify(report)).not.toContain("555");
		expect(
			await service.listEntitlementReport(other.id, {}, ALL_ON_ONE_PAGE),
		).toEqual({
			entries: [],
			total: 0,
			page: 1,
			pageSize: 100,
			totalPages: 1,
			divisions: [],
		});
	});

	it("filters by division and lists every division as a filter option", async () => {
		const { repository, organization, service } = await seedReport();
		const voice = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Voice",
			normalizedName: "voice",
		});
		await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "cust-singer",
			verifiedShopifyCustomerEmail: "singer@example.com",
			payload: {
				name: "Vera Voice",
				email: "singer@example.com",
				city: "Seattle",
				phone: "+1 206 555 0102",
				staffAccessConsent: true,
				divisionIds: [voice.id],
			},
		});
		const voiceOnly = await service.listEntitlementReport(
			organization.id,
			{ divisionId: voice.id },
			ALL_ON_ONE_PAGE,
		);
		expect(voiceOnly.entries.map((entry) => entry.customerName)).toEqual([
			"Vera Voice",
		]);
		expect(voiceOnly.total).toBe(1);
		// Options ignore the active filters so the dropdown never shrinks.
		expect(voiceOnly.divisions.map((d) => d.divisionName)).toEqual([
			"Piano",
			"Voice",
		]);
		const unknown = await service.listEntitlementReport(
			organization.id,
			{ divisionId: "no-such-division" },
			ALL_ON_ONE_PAGE,
		);
		expect(unknown.entries).toEqual([]);
	});

	it("paginates the sorted, filtered entries", async () => {
		const { organization, service } = await seedReport();
		const names = (page: number, filters = {}) =>
			service
				.listEntitlementReport(organization.id, filters, { page, pageSize: 2 })
				.then((report) => ({
					names: report.entries.map((entry) => entry.customerName),
					page: report.page,
					total: report.total,
					totalPages: report.totalPages,
				}));
		expect(await names(1)).toEqual({
			names: ["Aaron Teacher", "Beth Accompanist"],
			page: 1,
			total: 5,
			totalPages: 3,
		});
		expect(await names(3)).toEqual({
			names: ["Sam Scheduled"],
			page: 3,
			total: 5,
			totalPages: 3,
		});
		expect((await names(9)).page).toBe(3);
		expect(await names(1, { status: "expired" })).toEqual({
			names: ["Erin Expired"],
			page: 1,
			total: 1,
			totalPages: 1,
		});
	});
});
