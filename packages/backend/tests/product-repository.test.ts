import { describe, expect, it } from "bun:test";
import {
	ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildCanonicalPostgresSchemaSql } from "../src/repo/postgres-schema.js";

async function createOrganization(repository: InMemoryOrganizationRepository) {
	return repository.createOrganization({
		name: "Festival Admins",
		slug: "pafe",
	});
}

describe("product repository", () => {
	it("defines the bounded offering and canonical entitlement schema", () => {
		const source = buildCanonicalPostgresSchemaSql("schema");
		expect(source).toContain("duration_days > 0 AND duration_days <= 36500");
		expect(source).toContain("idx_products_org_active_entitlement_class");
		expect(source).toContain(
			"CREATE TABLE IF NOT EXISTS schema.membership_entitlements",
		);
		expect(source).toContain("membership_entitlement_divisions");
		expect(source).toContain("teacher_membership_entitlement_details");
		expect(source).toContain("EXCLUDE USING gist");
		expect(source).not.toContain("schema.entitlement_grants");
		expect(source).toContain("shopify_order_line_gid TEXT NOT NULL UNIQUE");
		expect(source).toContain("CHECK (ends_on > starts_on)");
		expect(source).not.toMatch(/ALTER TABLE|entitlement_period/);
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
			verifiedIdentityEmail: "shopper@example.com",
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
			verifiedIdentityEmail: "shopper@example.com",
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

	it("rejects an entitlement whose offering has a different class", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Woodwinds",
			normalizedName: "woodwinds",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: ACCOMPANIST_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/accompanist",
			shopifyVariantGid: "gid://shopify/ProductVariant/accompanist",
			productNameSnapshot: "Accompanist Membership",
		});

		await expect(
			repository.createEntitlementGrantSnapshot({
				organizationId: organization.id,
				customerId: "customer-1",
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "checkout-intent-class",
				shopifyOrderGid: "gid://shopify/Order/class",
				shopifyOrderLineGid: "gid://shopify/LineItem/class",
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				status: "active",
				verifiedIdentityEmail: "shopper@example.com",
			}),
		).rejects.toThrow("offering was not found");
	});

	it("binds a verified Shopify identity email to only one customer", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Percussion",
			normalizedName: "percussion",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/identity",
			shopifyVariantGid: "gid://shopify/ProductVariant/identity",
			productNameSnapshot: "Teacher Membership",
		});
		const input = {
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active" as const,
			verifiedIdentityEmail: "Shopper@Example.com",
		};
		await repository.createEntitlementGrantSnapshot({
			...input,
			customerId: "customer-1",
			checkoutIntentId: "checkout-identity-1",
			shopifyOrderGid: "gid://shopify/Order/identity-1",
			shopifyOrderLineGid: "gid://shopify/LineItem/identity-1",
		});

		await expect(
			repository.createEntitlementGrantSnapshot({
				...input,
				customerId: "customer-2",
				verifiedIdentityEmail: "shopper@example.com",
				checkoutIntentId: "checkout-identity-2",
				shopifyOrderGid: "gid://shopify/Order/identity-2",
				shopifyOrderLineGid: "gid://shopify/LineItem/identity-2",
			}),
		).rejects.toThrow("identity email belongs to another customer");
	});

	it("does not bind identity email when Teacher entitlement validation fails", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Strings",
			normalizedName: "strings",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/binding",
			shopifyVariantGid: "gid://shopify/ProductVariant/binding",
			productNameSnapshot: "Teacher Membership",
		});
		const input = {
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active" as const,
			verifiedIdentityEmail: "shopper@example.com",
		};
		await expect(
			repository.createEntitlementGrantSnapshot({
				...input,
				customerId: "customer-1",
				offeringId: "missing-offering",
				checkoutIntentId: "checkout-binding-invalid",
				shopifyOrderGid: "gid://shopify/Order/binding-invalid",
				shopifyOrderLineGid: "gid://shopify/LineItem/binding-invalid",
			}),
		).rejects.toThrow("offering was not found");
		await expect(
			repository.createEntitlementGrantSnapshot({
				...input,
				customerId: "customer-2",
				offeringId: offering.id,
				checkoutIntentId: "checkout-binding-valid",
				shopifyOrderGid: "gid://shopify/Order/binding-valid",
				shopifyOrderLineGid: "gid://shopify/LineItem/binding-valid",
			}),
		).resolves.toMatchObject({ customerId: "customer-2" });
	});

	it("allows one Shopify customer to hold Teacher and Accompanist entitlements", async () => {
		const repository = new InMemoryOrganizationRepository();
		const organization = await createOrganization(repository);
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Voice",
			normalizedName: "voice",
		});
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/dual-membership",
			shopifyVariantGid: "gid://shopify/ProductVariant/dual-membership",
			productNameSnapshot: "Teacher Membership",
		});

		await repository.createAccompanistMembershipGrant({
			organizationId: organization.id,
			customerId: "customer-1",
			normalizedEmail: "shopper@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Ava Accompanist",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
			},
			divisions: [
				{ divisionId: division.id, divisionName: division.displayName },
			],
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
		});
		await repository.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-dual-membership",
			shopifyOrderGid: "gid://shopify/Order/dual-membership",
			shopifyOrderLineGid: "gid://shopify/LineItem/dual-membership",
			startsOn: "2026-08-14",
			endsOn: "2027-08-14",
			status: "active",
			verifiedIdentityEmail: "shopper@example.com",
		});

		expect(
			await repository.listAccompanistMembershipGrants({
				organizationId: organization.id,
				customerId: "customer-1",
			}),
		).toHaveLength(1);
		expect(
			await repository.listEntitlementGrantSnapshots(
				organization.id,
				"customer-1",
			),
		).toHaveLength(1);
	});

	it("derives Teacher entitlement lifecycle instead of persisting an input status", async () => {
		let now = new Date("2026-08-14T12:00:00.000Z");
		const repository = new InMemoryOrganizationRepository(() => now);
		const organization = await createOrganization(repository);
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
			shopifyProductGid: "gid://shopify/Product/lifecycle",
			shopifyVariantGid: "gid://shopify/ProductVariant/lifecycle",
			productNameSnapshot: "Teacher Membership",
		});
		await repository.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: "customer-1",
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			offeringId: offering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "75.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "checkout-lifecycle",
			shopifyOrderGid: "gid://shopify/Order/lifecycle",
			shopifyOrderLineGid: "gid://shopify/LineItem/lifecycle",
			startsOn: "2026-09-01",
			endsOn: "2027-09-01",
			status: "active",
			verifiedIdentityEmail: "shopper@example.com",
		});

		const statuses = async () =>
			(
				await repository.listEntitlementGrantSnapshots(
					organization.id,
					"customer-1",
				)
			)[0]?.status;
		expect(await statuses()).toBe("scheduled");
		now = new Date("2026-09-01T12:00:00.000Z");
		expect(await statuses()).toBe("active");
		now = new Date("2027-09-01T12:00:00.000Z");
		expect(await statuses()).toBe("expired");
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
