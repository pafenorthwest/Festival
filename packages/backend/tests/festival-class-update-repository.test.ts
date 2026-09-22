import { describe, expect, it } from "bun:test";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";

describe("festival class updates and registration metadata repository lookups", () => {
	it("updates festival class configuration in memory", async () => {
		const orgRepo = new InMemoryOrganizationRepository();
		const org = await orgRepo.createOrganization({
			name: "Test Festival Org",
			slug: "test-festival-org",
		});
		const festival = await orgRepo.createFestival({
			id: "fest-1",
			organizationId: org.id,
			code: "TF2026",
			shortName: "tf2026",
			name: "Test Festival 2026",
			startDate: "2026-05-01",
			endDate: "2026-05-10",
		});
		const division = await orgRepo.createDivision({
			organizationId: org.id,
			displayName: "Strings",
			normalizedName: "strings",
		});
		const subtype = await orgRepo.createRegistrationCatalogValue({
			organizationId: org.id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		const created = await orgRepo.createFestivalClassConfiguration({
			organizationId: org.id,
			festivalId: festival.id,
			displayName: "Strings Solo Beginner",
			classSubtypeId: subtype.id,
			divisionId: division.id,
			minimumAge: 6,
			maximumAge: 10,
			price: "35.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 5,
			capacity: 20,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
		});

		const updated = await orgRepo.updateFestivalClassConfiguration({
			id: created.id,
			organizationId: org.id,
			festivalId: festival.id,
			displayName: "Strings Solo Intermediate",
			price: "40.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 8,
			capacity: 15,
			isActive: false,
		});

		expect(updated.id).toBe(created.id);
		expect(updated.displayName).toBe("Strings Solo Intermediate");
		expect(updated.price).toBe("40.00");
		expect(updated.maximumPerformancePieces).toBe(2);
		expect(updated.performanceMinutes).toBe(8);
		expect(updated.capacity).toBe(15);
		expect(updated.isActive).toBe(false);
		// Unchanged fields preserved
		expect(updated.classSubtypeId).toBe(subtype.id);
		expect(updated.divisionId).toBe(division.id);
		expect(updated.minimumAge).toBe(6);
		expect(updated.maximumAge).toBe(10);
		expect(updated.shopifyProductGid).toBe("gid://shopify/Product/1");
		expect(updated.shopifyVariantGid).toBe("gid://shopify/ProductVariant/1");

		// Throws when not found
		await expect(
			orgRepo.updateFestivalClassConfiguration({
				id: "non-existent",
				organizationId: org.id,
				festivalId: festival.id,
				displayName: "Does not exist",
			}),
		).rejects.toThrow("Festival class configuration not found.");
	});

	it("looks up registration metadata by class entitlement ID in checkout repository", async () => {
		const checkoutRepo = new InMemoryCheckoutRepository();
		const orgId = "org-1";
		const festivalId = "fest-1";
		const intentId = "intent-1";
		const entitlementId = "entitlement-1";

		const inserted = await checkoutRepo.insertRegistrationMetadata({
			id: "reg-meta-1",
			organizationId: orgId,
			festivalId,
			checkoutIntentId: intentId,
			teacherMembershipId: "teacher-mem-1",
			accompanistMembershipId: null,
			repertoireJson: [
				{
					title: "Moonlight Sonata",
					composer: "Beethoven",
					durationMinutes: 6,
				},
			],
		});

		// Before linking, lookup by entitlement returns null
		const notFoundBeforeLink =
			await checkoutRepo.getRegistrationMetadataByEntitlementId(
				orgId,
				entitlementId,
			);
		expect(notFoundBeforeLink).toBeNull();

		// Link to entitlement
		await checkoutRepo.linkRegistrationMetadataToEntitlement({
			checkoutIntentId: intentId,
			classEntitlementId: entitlementId,
		});

		// After linking, lookup succeeds
		const found = await checkoutRepo.getRegistrationMetadataByEntitlementId(
			orgId,
			entitlementId,
		);
		expect(found).not.toBeNull();
		expect(found?.id).toBe(inserted.id);
		expect(found?.organizationId).toBe(orgId);
		expect(found?.classEntitlementId).toBe(entitlementId);
		expect(found?.teacherMembershipId).toBe("teacher-mem-1");
		expect(found?.repertoireJson).toEqual([
			{
				title: "Moonlight Sonata",
				composer: "Beethoven",
				durationMinutes: 6,
			},
		]);

		// Lookup with wrong organization returns null
		const wrongOrg = await checkoutRepo.getRegistrationMetadataByEntitlementId(
			"wrong-org",
			entitlementId,
		);
		expect(wrongOrg).toBeNull();
	});
});
