import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

async function createOrganization(repository: InMemoryOrganizationRepository) {
	return repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
}

describe("product repository", () => {
	it("defines the bounded offering migration and immutable grant schema", async () => {
		const source = await readFile(
			new URL(
				"../src/repo/postgres-organization-repository.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(source).toContain("ADD COLUMN IF NOT EXISTS duration_days INTEGER");
		expect(source).toContain("WHEN '1_year' THEN 365");
		expect(source).toContain("duration_days > 0 AND duration_days <= 36500");
		expect(source).toContain("idx_products_org_active_entitlement_class");
		expect(source).toContain(
			"CREATE TABLE IF NOT EXISTS $" + "{schema}.entitlement_grants",
		);
		expect(source).toContain("shopify_order_line_gid TEXT NOT NULL UNIQUE");
		expect(source).toContain("CHECK (ends_on > starts_on)");
		expect(source).not.toContain(
			"entitlement_period IS NULL OR entitlement_period IN",
		);
		expect(source).not.toContain(
			"UPDATE $" + "{this.schema}.entitlement_grants",
		);
	});

	it("creates and lists membership product associations", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		const created = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.listMembershipProductRecords(organization.id),
		).resolves.toEqual([created]);
		await expect(
			repository.findMembershipProductRecordByClass(
				organization.id,
				TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			),
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

	it("persists immutable tenant/customer-scoped entitlement snapshots", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "High Strings",
			normalizedName: "high strings",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/grant",
			shopifyVariantGid: "gid://shopify/ProductVariant/grant",
			productNameSnapshot: "Teacher Membership",
		});

		const grant = await repository.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active",
		});

		await repository.updateDivision({
			organizationId: organization.id,
			divisionId: division.id,
			displayName: "Renamed Strings",
			normalizedName: "renamed strings",
		});
		await repository.updateMembershipProductRecord({
			organizationId: organization.id,
			productId: offering.id,
			productNameSnapshot: "Renamed Teacher Membership",
			durationDays: 30,
		});
		(grant as { divisionNameSnapshot: string }).divisionNameSnapshot =
			"tampered";

		await expect(
			repository.listEntitlementGrantSnapshots(organization.id, "customer-1"),
		).resolves.toMatchObject([
			{
				divisionNameSnapshot: "High Strings",
				durationDays: 365,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
			},
		]);
		await expect(
			repository.listEntitlementGrantSnapshots(
				organization.id,
				"other-customer",
			),
		).resolves.toEqual([]);
	});

	it("rejects cross-tenant and duplicate grant correlations", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const otherOrganization = await repository.createOrganization({
			name: "Other Festival",
			slug: "other",
		});
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Brass",
			normalizedName: "brass",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/correlation",
			shopifyVariantGid: "gid://shopify/ProductVariant/correlation",
			productNameSnapshot: "Teacher Membership",
		});
		const input = {
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-intent-unique",
			shopifyOrderGid: "gid://shopify/Order/unique",
			shopifyOrderLineGid: "gid://shopify/LineItem/unique",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active" as const,
		};

		await expect(
			repository.createEntitlementGrantSnapshot({
				...input,
				organizationId: otherOrganization.id,
			}),
		).rejects.toThrow("offering was not found");
		await repository.createEntitlementGrantSnapshot(input);
		await expect(
			repository.createEntitlementGrantSnapshot({
				...input,
				shopifyOrderGid: "gid://shopify/Order/other",
			}),
		).rejects.toThrow("correlation is already recorded");
	});

	it("enforces unique Shopify Product GIDs", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				durationDays: 30,
				isActive: false,
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
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				durationDays: 30,
				isActive: false,
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				productNameSnapshot: "Accompanist Membership",
			}),
		).rejects.toThrow("Shopify variant is already associated.");
	});

	it("enforces one active Teacher Membership offering per organization", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);

		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			productNameSnapshot: "Teacher Membership",
		});

		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				durationDays: 30,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				productNameSnapshot: "Teacher Monthly Membership",
			}),
		).rejects.toThrow(
			"Membership product already exists for this organization.",
		);

		await repository.updateMembershipProductRecord({
			organizationId: organization.id,
			productId: (
				await repository.findMembershipProductRecordByClass(
					organization.id,
					TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				)
			)?.id as string,
			isActive: false,
		});
		await expect(
			repository.createMembershipProductRecord({
				organizationId: organization.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				durationDays: 30,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				productNameSnapshot: "Replacement Teacher Membership",
			}),
		).resolves.toMatchObject({ isActive: true, durationDays: 30 });
	});
});
