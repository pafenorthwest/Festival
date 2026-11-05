import { describe, expect, it } from "bun:test";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "../src/commerce/membership-status-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

describe("MembershipStatusService", () => {
	it("maps supersededOn for superseded grants and null for non-superseded grants", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository(() => now);
		const organization = await organizations.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		await organizations.updateOrganizationTimezone(
			organization.id,
			"America/Los_Angeles",
		);
		const piano = await organizations.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const offering = await organizations.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "cust-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-prior",
			shopifyOrderGid: "gid://shopify/Order/prior",
			shopifyOrderLineGid: "gid://shopify/LineItem/prior",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			supersededOn: "2027-07-20",
			status: "superseded",
			verifiedIdentityEmail: "teacher@example.test",
		});

		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "cust-1",
			entitlementClass: "teacher_membership",
			offeringId: offering.id,
			durationDays: 365,
			divisionId: piano.id,
			divisionNameSnapshot: piano.displayName,
			paidAmount: "85.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-renewed",
			shopifyOrderGid: "gid://shopify/Order/renewed",
			shopifyOrderLineGid: "gid://shopify/LineItem/renewed",
			startsOn: "2027-07-20",
			endsOn: "2028-07-19",
			status: "active",
			verifiedIdentityEmail: "teacher@example.test",
		});

		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			undefined,
			() => now,
		);
		const service = new MembershipStatusService(
			organizations,
			commerce,
			() => now,
		);

		const response = await service.listForCustomer(organization.id, "cust-1");
		expect(response.memberships).toEqual([
			{
				status: "superseded",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Piano",
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				supersededOn: "2027-07-20",
			},
			{
				status: "active",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Piano",
				paidAmount: "85.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				supersededOn: null,
			},
		]);
	});
});
