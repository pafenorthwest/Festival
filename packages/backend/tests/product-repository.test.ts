import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

async function createOrganization(repository: InMemoryOrganizationRepository) {
	return repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
}

describe("product repository", () => {
	it("creates and lists membership product associations", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		const created = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			membershipType: "teacher",
			entitlementPeriod: "1_year",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.listMembershipProductRecords(organization.id),
		).resolves.toEqual([created]);
		await expect(
			repository.findMembershipProductRecordByType(organization.id, "teacher"),
		).resolves.toEqual(created);
		await expect(
			repository.findProductRecordByShopifyProductGid(
				"gid://shopify/Product/1",
			),
		).resolves.toEqual(created);
		await expect(
			repository.findProductRecordByShopifyVariantGid(
				"gid://shopify/ProductVariant/1",
			),
		).resolves.toEqual(created);
	});

	it("enforces unique Shopify Product GIDs", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			membershipType: "teacher",
			entitlementPeriod: "1_year",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				membershipType: "accompanist",
				entitlementPeriod: "1_month",
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				productNameSnapshot: "Accompanist Membership",
			}),
		).rejects.toThrow("Shopify product is already associated.");
	});

	it("enforces unique Shopify Variant GIDs", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			membershipType: "teacher",
			entitlementPeriod: "1_year",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				membershipType: "accompanist",
				entitlementPeriod: "1_month",
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				productNameSnapshot: "Accompanist Membership",
			}),
		).rejects.toThrow("Shopify variant is already associated.");
	});

	it("enforces one membership product per organization membership type", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			membershipType: "teacher",
			entitlementPeriod: "1_year",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				membershipType: "teacher",
				entitlementPeriod: "1_month",
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				productNameSnapshot: "Teacher Monthly Membership",
			}),
		).rejects.toThrow(
			"Membership product already exists for this organization.",
		);
	});
});
