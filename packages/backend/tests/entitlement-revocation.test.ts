import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

describe("entitlement revocation", () => {
	it("is tenant-scoped and idempotently preserves the original audit record", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await repository.createOrganization({
			name: "Festival",
			slug: "festival",
		});
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const product = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});
		const grant = await repository.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer",
			entitlementClass: "teacher_membership",
			offeringId: product.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "10.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "shopper@example.com",
		});
		const first = await repository.revokeEntitlement({
			organizationId: organization.id,
			entitlementId: grant.id,
			actorUserId: "admin",
			reason: "Refunded",
			revokedAtIso: "2026-02-01T00:00:00.000Z",
		});
		const second = await repository.revokeEntitlement({
			...first.revocation,
			entitlementId: grant.id,
			actorUserId: "other-admin",
			reason: "Changed",
		});
		expect(first.existing).toBe(false);
		expect(second).toMatchObject({
			existing: true,
			revocation: { reason: "Refunded" },
		});
		expect(
			await repository.listEntitlementGrantSnapshots(
				organization.id,
				"customer",
			),
		).toMatchObject([{ status: "revoked" }]);
	});
});
