import { describe, expect, it } from "bun:test";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

describe("membership commerce repository", () => {
	it("reclaims an interrupted processing delivery after its lease expires", async () => {
		let now = new Date("2026-08-28T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			undefined,
			() => now,
		);
		const recorded = await commerce.recordDelivery({
			organizationId: organization.id,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-0000000000000001",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: now.toISOString(),
		});
		if (recorded.kind !== "accepted") throw new Error("Expected delivery.");
		expect(await commerce.claimDelivery(recorded.delivery.id)).toMatchObject({
			status: "processing",
		});

		now = new Date("2026-08-28T18:16:00.000Z");
		expect(
			await commerce.listReclaimableDeliveries(
				organization.id,
				10,
				"2026-08-28T18:01:00.000Z",
			),
		).toMatchObject([{ id: recorded.delivery.id, status: "failed" }]);
	});

	it("checks scheduled entitlements within their own membership class", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		await organizations.createAccompanistMembershipGrant({
			organizationId: organization.id,
			customerId: "customer-1",
			normalizedEmail: "shopper@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Ava",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
			},
			divisions: [
				{ divisionId: division.id, divisionName: division.displayName },
			],
			startsOn: "2026-09-01",
			endsOn: "2027-09-01",
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);

		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"accompanist_membership",
				"2026-08-14",
			),
		).toBe(true);
		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"teacher_membership",
				"2026-08-14",
			),
		).toBe(false);
	});

	it("does not treat a scheduled Teacher entitlement as an Accompanist renewal", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const offering = await organizations.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/teacher",
			shopifyVariantGid: "gid://shopify/ProductVariant/teacher",
			productNameSnapshot: "Teacher Membership",
		});
		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-teacher",
			shopifyOrderGid: "gid://shopify/Order/teacher",
			shopifyOrderLineGid: "gid://shopify/LineItem/teacher",
			startsOn: "2026-09-01",
			endsOn: "2027-09-01",
			status: "scheduled",
			verifiedIdentityEmail: "shopper@example.com",
		});
		const commerce = new InMemoryMembershipCommerceRepository(organizations);

		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"teacher_membership",
				"2026-08-14",
			),
		).toBe(true);
		expect(
			await commerce.hasScheduledEntitlement(
				organization.id,
				"customer-1",
				"accompanist_membership",
				"2026-08-14",
			),
		).toBe(false);
	});
});
