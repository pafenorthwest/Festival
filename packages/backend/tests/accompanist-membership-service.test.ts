import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { AccompanistMembershipService } from "../src/services/accompanist-membership-service.js";

async function setup() {
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
	const offering = await repository.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "accompanist_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Accompanist Membership",
	});
	const service = new AccompanistMembershipService(
		repository,
		{ resolveActiveFreeAccompanistOffering: async () => offering } as never,
		() => new Date("2026-09-12T12:00:00.000Z"),
	);
	return { repository, organization, division, service };
}

describe("AccompanistMembershipService", () => {
	it("creates immutable current membership contact and division snapshots without checkout", async () => {
		const { organization, division, service } = await setup();
		const result = await service.acquire({
			organizationId: organization.id,
			organizationTimezone: "America/Los_Angeles",
			customerId: "customer-1",
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
			payload,
		});
		await expect(
			service.acquire({
				organizationId: organization.id,
				organizationTimezone: "UTC",
				customerId: "customer-1",
				payload,
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("supersedes rather than mutates the prior grant inside the 30-day renewal window", async () => {
		const { repository, organization, division, service } = await setup();
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
			payload,
		});
		const offering = await repository.findMembershipProductRecordByClass(
			organization.id,
			"accompanist_membership",
		);
		if (!offering) throw new Error("Expected accompanist offering.");
		const renewal = new AccompanistMembershipService(
			repository,
			{
				resolveActiveFreeAccompanistOffering: async () => offering,
			} as never,
			() => new Date("2027-08-14T12:00:00.000Z"),
		);
		await renewal.acquire({
			organizationId: organization.id,
			organizationTimezone: "UTC",
			customerId: "customer-1",
			payload: { ...payload, city: "Tacoma" },
		});
		const grants = await repository.listAccompanistMembershipGrants({
			organizationId: organization.id,
		});
		expect(grants).toHaveLength(2);
		expect(grants[0]).toMatchObject({
			status: "superseded",
			isCurrent: false,
			contact: { city: "Seattle" },
		});
		expect(grants[1]).toMatchObject({
			status: "active",
			isCurrent: true,
			contact: { city: "Tacoma" },
		});
	});
});
