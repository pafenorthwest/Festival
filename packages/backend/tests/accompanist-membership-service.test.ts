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
