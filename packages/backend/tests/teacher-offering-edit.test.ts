import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { MembershipCheckoutService } from "../src/checkout/membership-checkout-service.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import type { AppError } from "../src/errors/app-error.js";
import { ShopifyScopeError, ShopifyUserError } from "../src/shopify/errors.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import {
	assertConfirmedTeacherProductUpdate,
	toAppError,
	toManualReconciliationError,
} from "../src/shopify/shopify-membership-product-helpers.js";
import {
	FailingUpdateProductRepository,
	PRODUCT_GID,
	setupFixture,
	shopifyProduct,
	tenantFor,
	VARIANT_GID,
} from "./helpers/teacher-offering-edit-fixture.js";

describe("ShopifyMembershipProductService.updateMembershipProduct (Issue #73)", () => {
	it("updates active Teacher offering details, confirms via readback, and refreshes Admin and public read contracts", async () => {
		const { repository, organization, offering, client, audit, service } =
			await setupFixture();

		const updated = await service.updateMembershipProduct(
			tenantFor(organization),
			offering.id,
			{
				name: "  Updated Teacher Membership  ",
				description: "  Updated annual teacher membership details.  ",
				price: "85",
			},
		);

		expect(client.productDetailsUpdates).toEqual([
			{
				productId: PRODUCT_GID,
				name: "Updated Teacher Membership",
				description: "Updated annual teacher membership details.",
			},
		]);
		expect(client.variantUpdates).toEqual([
			{ productId: PRODUCT_GID, variantId: VARIANT_GID, price: "85" },
		]);
		expect(updated).toMatchObject({
			id: offering.id,
			name: "Updated Teacher Membership",
			description: "Updated annual teacher membership details.",
			variantName: "Standard",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			price: { amount: "85.00", currencyCode: "USD" },
		});

		const adminList = await service.listMembershipProductsForOrganization(
			tenantFor(organization),
		);
		expect(adminList[0]).toMatchObject({
			id: offering.id,
			name: "Updated Teacher Membership",
			description: "Updated annual teacher membership details.",
			price: { amount: "85.00", currencyCode: "USD" },
		});

		const publicService = new PublicMembershipProductService(repository, {
			readProduct: async () => ({
				id: client.currentProduct.id,
				title: client.currentProduct.title,
				description: client.currentProduct.description ?? "",
				availableForSale: true,
				variant: {
					id: client.currentProduct.variants[0].id,
					availableForSale: true,
					price: client.currentProduct.variants[0].price,
				},
			}),
		});
		const publicList = await publicService.list(organization.slug);
		expect(publicList.membershipProducts[0]).toMatchObject({
			id: offering.id,
			name: "Updated Teacher Membership",
			description: "Updated annual teacher membership details.",
			price: { amount: "85.00", currencyCode: "USD" },
		});
		expect(audit.records.map((r) => [r.operation, r.result])).toEqual([
			["productUpdate", "success"],
			["productVariantUpdate", "success"],
		]);
	});

	it("allows clearing the description on an active Teacher offering", async () => {
		const { organization, offering, client, service } = await setupFixture();
		const updated = await service.updateMembershipProduct(
			tenantFor(organization),
			offering.id,
			{ name: "Teacher Membership", description: "   ", price: "0.00" },
		);
		expect(client.productDetailsUpdates[0]?.description).toBe("");
		expect(updated.description).toBe("");
		expect(updated.price).toEqual({ amount: "0.00", currencyCode: "USD" });
		expect(client.readProductGids).toHaveLength(1);
	});

	it("preserves existing Shopify product description when description is omitted and accepts <p>-wrapped HTML readback", async () => {
		const { organization, offering, client, service } = await setupFixture();
		const updated = await service.updateMembershipProduct(
			tenantFor(organization),
			offering.id,
			{ name: "Teacher Membership", price: "80.00" },
		);
		expect(client.productDetailsUpdates[0]?.description).toBe(
			"Annual membership for teachers.",
		);
		expect(updated.description).toBe("Annual membership for teachers.");
		expect(client.readProductGids).toHaveLength(2);

		client.customReadResponse = [
			shopifyProduct({
				title: "Teacher Membership HTML",
				description: "<p>Updated details</p>\r\n",
				variants: [
					{
						...shopifyProduct().variants[0],
						price: { amount: "82.00", currencyCode: "USD" },
					},
				],
			}),
		];
		const htmlConfirmed = await service.updateMembershipProduct(
			tenantFor(organization),
			offering.id,
			{
				name: "Teacher Membership HTML",
				description: "Updated details",
				price: "82.00",
			},
		);
		expect(htmlConfirmed.name).toBe("Teacher Membership HTML");
		expect(htmlConfirmed.price).toEqual({
			amount: "82.00",
			currencyCode: "USD",
		});
	});

	it("preserves historical checkout intents, paid orders, validation decisions, and entitlement grants while using the new price for subsequent checkouts", async () => {
		const { repository, organization, offering, client, service } =
			await setupFixture();
		const division = await repository.createDivision({
			organizationId: organization.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const checkoutRepo = new InMemoryCheckoutRepository();
		const commerceRepo = new InMemoryMembershipCommerceRepository(repository);

		const existingOutcome = await checkoutRepo.createIntent({
			organizationId: organization.id,
			customerId: "cust-historical",
			sessionId: "sess-1",
			idempotencyKey: "idem-historical",
			offeringId: offering.id,
			entitlementClass: "teacher_membership",
			durationDays: offering.durationDays,
			shopifyProductGid: offering.shopifyProductGid,
			shopifyVariantGid: offering.shopifyVariantGid,
			policyVersion: "v1",
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			staffAccessConsent: true,
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2026-12-01T00:00:00.000Z",
		});
		if (existingOutcome.kind !== "created") throw new Error("Expected intent.");
		await checkoutRepo.resolveIntent(existingOutcome.intent.id, "approved");

		const delivery = await commerceRepo.recordDelivery({
			organizationId: organization.id,
			shopDomain: "pafe.myshopify.com",
			webhookId: "wh-1",
			topic: "orders/paid",
			apiVersion: "2026-07",
			shopifyOrderGid: "gid://shopify/Order/hist-1",
			payloadSha256: "a".repeat(64),
			receivedAtIso: "2026-01-15T00:00:00.000Z",
		});
		if (delivery.kind !== "accepted") throw new Error("Expected delivery.");
		await commerceRepo.claimDelivery(delivery.delivery.id);

		const finalized = await commerceRepo.finalizeDecision({
			deliveryId: delivery.delivery.id,
			decision: {
				organizationId: organization.id,
				shopifyOrderGid: "gid://shopify/Order/hist-1",
				shopifyOrderLineGid: "gid://shopify/LineItem/hist-1",
				checkoutIntentId: existingOutcome.intent.id,
				customerId: "cust-historical",
				status: "approved",
				updatedAtIso: "2026-01-15T00:00:00.000Z",
			},
			projection: {
				organizationId: organization.id,
				shopifyOrderGid: "gid://shopify/Order/hist-1",
				shopifyCustomerGid: "gid://shopify/Customer/cust-historical",
				correlationId: existingOutcome.intent.correlationId,
				fullyPaidAtIso: "2026-01-15T00:00:00.000Z",
				currencyCode: "USD",
				updatedAtIso: "2026-01-15T00:00:00.000Z",
			},
			grant: {
				organizationId: organization.id,
				customerId: "cust-historical",
				entitlementClass: "teacher_membership",
				offeringId: offering.id,
				durationDays: 365,
				divisionId: division.id,
				divisionNameSnapshot: division.displayName,
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: existingOutcome.intent.id,
				shopifyOrderGid: "gid://shopify/Order/hist-1",
				shopifyOrderLineGid: "gid://shopify/LineItem/hist-1",
				startsOn: "2026-01-15",
				endsOn: "2027-01-15",
				status: "active",
				verifiedIdentityEmail: "teacher@example.com",
			},
		});

		await service.updateMembershipProduct(
			tenantFor(organization),
			offering.id,
			{
				name: "Teacher Membership 2027",
				description: "Updated description",
				price: "95.00",
			},
		);

		const preservedIntent = await checkoutRepo.findIntentByCorrelation(
			organization.id,
			existingOutcome.intent.correlationId,
		);
		expect(preservedIntent?.amount).toBe("75.00");
		const [preservedDecision] = await commerceRepo.listCustomerDecisions(
			organization.id,
			"cust-historical",
		);
		expect(preservedDecision?.id).toBe(finalized.decision.id);
		const grants = await repository.listEntitlementGrantSnapshots(
			organization.id,
			"cust-historical",
		);
		expect(grants[0]?.paidAmount).toBe("75.00");

		const publicService = new PublicMembershipProductService(repository, {
			readProduct: async () => ({
				id: client.currentProduct.id,
				title: client.currentProduct.title,
				description: client.currentProduct.description ?? "",
				availableForSale: true,
				variant: {
					id: client.currentProduct.variants[0].id,
					availableForSale: true,
					price: client.currentProduct.variants[0].price,
				},
			}),
		});
		let createdCorrelationId = "";
		const checkoutService = new MembershipCheckoutService(
			repository,
			publicService,
			checkoutRepo,
			{
				createCart: async ({ correlationId }) => {
					createdCorrelationId = correlationId;
					return { shopifyCartId: "gid://shopify/Cart/new-1" };
				},
				checkout: async () => ({
					checkoutUrl: "https://pafe.myshopify.com/cart/c/new-1",
				}),
			},
			commerceRepo,
		);
		await checkoutService.start({
			organizationId: organization.id,
			organizationSlug: organization.slug,
			customerId: "cust-new",
			sessionId: "sess-new",
			integrationVersion: 1,
			buyerAccessToken: "buyer-token",
			idempotencyKey: "idem-new-checkout",
			offeringId: offering.id,
			divisionId: division.id,
			staffAccessConsent: true,
		});
		const newIntent = await checkoutRepo.findIntentByCorrelation(
			organization.id,
			createdCorrelationId,
		);
		expect(newIntent?.amount).toBe("95.00");
	});

	it("rejects cross-tenant, unknown, retired, Accompanist, unsupported-field, and invalid-input requests before Shopify or audit access", async () => {
		const { repository, organization, offering, client, audit, service } =
			await setupFixture();
		const otherOrg = await repository.createOrganization({
			name: "Other Org",
			slug: "other",
		});
		await expect(
			service.updateMembershipProduct(tenantFor(otherOrg), offering.id, {
				name: "Valid Name",
				price: "50.00",
			}),
		).rejects.toMatchObject({ status: 404 });

		const accompanistOffering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "accompanist_membership",
			durationDays: 180,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/acc-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/acc-1",
			productNameSnapshot: "Accompanist Membership",
		});
		await expect(
			service.updateMembershipProduct(
				tenantFor(organization),
				accompanistOffering.id,
				{ name: "Attempted Edit", price: "25.00" },
			),
		).rejects.toMatchObject({ status: 404 });

		for (const badPayload of [
			{ name: "Valid Name", price: "50.00", durationDays: 180 },
			{ name: "Valid Name", price: "50.00", shopifyProductGid: "evil" },
			{ name: "   ", price: "50.00" },
			{ name: "Valid Name", price: "-10.00" },
			{ name: "Valid Name", price: "10.999" },
		]) {
			await expect(
				service.updateMembershipProduct(
					tenantFor(organization),
					offering.id,
					badPayload,
				),
			).rejects.toMatchObject({ status: 400 });
		}

		await service.retireMembershipOffering(
			tenantFor(organization),
			offering.id,
		);
		await expect(
			service.updateMembershipProduct(tenantFor(organization), offering.id, {
				name: "Edit Retired",
				price: "60.00",
			}),
		).rejects.toMatchObject({ status: 409 });

		expect(client.productDetailsUpdates).toHaveLength(0);
		expect(audit.readyCalls).toBe(0);
	});

	it("does not update local snapshot when initial Shopify productUpdate fails and records bounded failure audit", async () => {
		const { repository, organization, offering, client, audit, service } =
			await setupFixture();
		client.updateDetailsError = new ShopifyUserError(
			"Upstream rejected update client-secret-canary",
			"req-fail-1",
		);
		await expect(
			service.updateMembershipProduct(tenantFor(organization), offering.id, {
				name: "Should Not Persist",
				price: "90.00",
			}),
		).rejects.toMatchObject({ status: 502 });
		const [stored] = await repository.listMembershipProductRecords(
			organization.id,
		);
		expect(stored?.productNameSnapshot).toBe("Teacher Membership");
		expect(JSON.stringify(audit.records)).not.toContain("client-secret-canary");
	});

	it("surfaces manual reconciliation without rollback or secret leakage when readback or local persistence fails after Shopify mutation", async () => {
		const { repository, organization, offering, client, service } =
			await setupFixture();
		client.customReadResponse = [
			shopifyProduct({
				title: "Updated Name",
				variants: [
					{
						...shopifyProduct().variants[0],
						id: "gid://shopify/ProductVariant/mismatched-variant",
						price: { amount: "85.00", currencyCode: "USD" },
					},
				],
			}),
		];
		await expect(
			service.updateMembershipProduct(tenantFor(organization), offering.id, {
				name: "Updated Name",
				price: "85.00",
			}),
		).rejects.toMatchObject({
			status: 502,
			code: "manual_reconciliation_required",
			details: {
				reconciliationRequired: true,
				offeringId: offering.id,
				organizationId: organization.id,
				shopifyProductGid: PRODUCT_GID,
				shopifyVariantGid: VARIANT_GID,
			},
		});
		expect(client.deletedProductGids).toHaveLength(0);
		const [stored] = await repository.listMembershipProductRecords(
			organization.id,
		);
		expect(stored?.productNameSnapshot).toBe("Teacher Membership");

		const failingFixture = await setupFixture(
			new FailingUpdateProductRepository(),
		);
		try {
			await failingFixture.service.updateMembershipProduct(
				tenantFor(failingFixture.organization),
				failingFixture.offering.id,
				{ name: "Updated Name", price: "85.00" },
			);
			throw new Error("Expected manual reconciliation error.");
		} catch (error) {
			const appError = error as AppError;
			expect(appError.code).toBe("manual_reconciliation_required");
			expect(appError.cause).toBeInstanceOf(Error);
			expect((appError.cause as Error).message).toContain(
				"database write failure",
			);
			expect(failingFixture.logger.errors).toEqual([
				{
					message:
						"Shopify membership product update requires manual reconciliation.",
					context: {
						operation: "shopify.membershipProduct.reconcile",
						offeringId: failingFixture.offering.id,
						organizationId: failingFixture.organization.id,
						shopifyProductGid: PRODUCT_GID,
						shopifyVariantGid: VARIANT_GID,
						errorName: "Error",
						errorCode: undefined,
					},
				},
			]);
			const serialized = JSON.stringify({
				message: appError.message,
				details: appError.details,
				audit: failingFixture.audit.records,
				logs: failingFixture.logger.errors,
			});
			expect(serialized).not.toContain("client-secret-canary");
			expect(serialized).not.toContain("bearer-canary");
		}
		expect(failingFixture.client.deletedProductGids).toHaveLength(0);
	});

	it("verifies helper contracts for status readback, dynamic scope error mapping, and manual reconciliation cause attachment", () => {
		const dummyOffering = {
			id: "off-1",
			organizationId: "org-1",
			productCategory: "membership" as const,
			entitlementClass: "teacher_membership" as const,
			durationDays: 365,
			isActive: true,
			shopifyProductGid: PRODUCT_GID,
			shopifyVariantGid: VARIANT_GID,
			productNameSnapshot: "Teacher Membership",
			createdAtIso: "2026-01-01T00:00:00.000Z",
			updatedAtIso: "2026-01-01T00:00:00.000Z",
		};

		expect(() =>
			assertConfirmedTeacherProductUpdate(
				shopifyProduct({
					title: "Teacher Membership",
					description: "Annual membership for teachers.",
					status: "DRAFT",
				}),
				dummyOffering,
				{
					name: "Teacher Membership",
					description: "Annual membership for teachers.",
					price: "75.00",
				},
			),
		).toThrow(
			"Shopify membership product readback did not match the updated values.",
		);

		const mappedScopeError = toAppError(new ShopifyScopeError());
		expect(mappedScopeError.status).toBe(409);
		expect(mappedScopeError.message).toBe(
			"Shopify integration is missing a required product scope. Save and verify Shopify settings after approving the required scope.",
		);
		expect(mappedScopeError.message).not.toContain("write_inventory");

		const underlyingCause = new Error("readback failure");
		const manualError = toManualReconciliationError(
			dummyOffering,
			underlyingCause,
		);
		expect(manualError.cause).toBe(underlyingCause);
	});
});
