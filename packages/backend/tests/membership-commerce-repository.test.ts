import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
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

	it("rejects a conflicting paid-order-line replay without replacing its association", async () => {
		const organizations = new InMemoryOrganizationRepository();
		const commerce = new InMemoryMembershipCommerceRepository(organizations);
		const input = {
			organizationId: "organization",
			festivalId: "festival",
			festivalClassId: "class-1",
			parentCustomerId: "customer",
			childId: "child-1",
			checkoutIntentId: "checkout-intent",
			checkoutIntentLineId: "intent-line-1",
			shopifyOrderGid: "gid://shopify/Order/500",
			shopifyOrderLineGid: "gid://shopify/LineItem/500-1",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed" as const,
		};

		const created = await commerce.createClassEntitlement(input);
		await expect(
			commerce.createClassEntitlement({ ...input, childId: "child-2" }),
		).rejects.toThrow("paid-line conflict");
		expect(
			await commerce.findClassEntitlementByOrderLine(
				input.organizationId,
				input.shopifyOrderLineGid,
			),
		).toMatchObject({ id: created.id, childId: "child-1" });
	});

	it("rolls back every class entitlement when a later multi-line link fails", async () => {
		let now = new Date("2026-09-21T18:00:00.000Z");
		const organizations = new InMemoryOrganizationRepository();
		const checkout = new InMemoryCheckoutRepository();
		const commerce = new InMemoryMembershipCommerceRepository(
			organizations,
			checkout,
			() => now,
		);
		const organizationId = "organization";
		const delivery = await commerce.recordDelivery({
			organizationId,
			shopDomain: "festival.myshopify.com",
			webhookId: "webhook-multiline-rollback",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/500",
			payloadSha256: "a".repeat(64),
			receivedAtIso: now.toISOString(),
		});
		if (delivery.kind !== "accepted") throw new Error("Expected delivery.");
		await commerce.claimDelivery(delivery.delivery.id);
		for (const index of [1, 2]) {
			await checkout.insertRegistrationMetadata({
				id: `metadata-${index}`,
				organizationId,
				festivalId: "festival",
				checkoutIntentId: "checkout-intent",
				checkoutIntentLineId: `intent-line-${index}`,
				teacherMembershipId: "teacher-membership",
				accompanistMembershipId: null,
				repertoireJson: [],
			});
		}

		const linkRegistrationMetadata =
			checkout.linkRegistrationMetadataToEntitlement.bind(checkout);
		let linkCount = 0;
		let firstLinkedEntitlementId: string | undefined;
		const provisional = Promise.withResolvers<void>();
		const releaseRollback = Promise.withResolvers<void>();
		checkout.linkRegistrationMetadataToEntitlement = async (params) => {
			linkCount += 1;
			if (linkCount === 2) {
				provisional.resolve();
				await releaseRollback.promise;
				throw new Error("Second entitlement link failed.");
			}
			await linkRegistrationMetadata(params);
			firstLinkedEntitlementId = params.classEntitlementId;
		};

		const line = (id: string, index: number) => ({
			organizationId,
			festivalId: "festival",
			festivalClassId: `class-${index}`,
			parentCustomerId: "customer",
			childId: `child-${index}`,
			checkoutIntentId: "checkout-intent",
			checkoutIntentLineId: `intent-line-${index}`,
			shopifyOrderGid: "gid://shopify/Order/500",
			shopifyOrderLineGid: id,
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed" as const,
		});

		const finalization = commerce.finalizeDecision({
			deliveryId: delivery.delivery.id,
			decision: {
				organizationId,
				customerId: "customer",
				checkoutIntentId: "checkout-intent",
				shopifyOrderGid: "gid://shopify/Order/500",
				status: "approved",
				updatedAtIso: now.toISOString(),
			},
			classEntitlements: [
				line("gid://shopify/LineItem/500-1", 1),
				line("gid://shopify/LineItem/500-2", 2),
			],
		});
		const rollback = finalization.then(
			() => null,
			(error: unknown) => error,
		);
		await provisional.promise;
		const candidate = await checkout.createIntent({
			organizationId,
			customerId: "candidate",
			sessionId: "candidate",
			idempotencyKey: "candidate",
			shopifyProductGid: "product",
			shopifyVariantGid: "variant",
			amount: "50.00",
			currencyCode: "USD",
			expiresAtIso: "2027-01-01T00:00:00.000Z",
		});
		if (candidate.kind !== "created")
			throw new Error("Expected candidate intent.");
		let checked = false;
		const attachment = checkout.attachCart({
			intentId: candidate.intent.id,
			organizationId,
			customerId: "candidate",
			sessionId: "candidate",
			shopifyCartId: "cart",
			integrationVersion: 1,
			expiresAtIso: "2027-01-01T00:00:00.000Z",
			capacityCheck: async () => {
				checked = true;
				expect(
					await commerce.listClassEntitlements({ organizationId }),
				).toEqual([]);
				return null;
			},
		});
		void attachment.catch(() => undefined);
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(checked).toBe(false);
		} finally {
			releaseRollback.resolve();
		}
		expect(await rollback).toMatchObject({
			message: "Second entitlement link failed.",
		});
		expect((await attachment).status).toBe("ready");
		expect(checked).toBe(true);

		expect(await commerce.listClassEntitlements({ organizationId })).toEqual(
			[],
		);
		expect(firstLinkedEntitlementId).toBeDefined();
		expect(
			await checkout.getRegistrationMetadataByEntitlementId(
				organizationId,
				firstLinkedEntitlementId ?? "",
			),
		).toBeNull();
		now = new Date("2026-09-21T18:16:00.000Z");
		expect(
			await commerce.listReclaimableDeliveries(
				organizationId,
				10,
				"2026-09-21T18:01:00.000Z",
			),
		).toMatchObject([{ id: delivery.delivery.id, status: "failed" }]);
	});
});
