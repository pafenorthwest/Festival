import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";

describe("checkout repository", () => {
	it("keeps Shopify cart IDs behind opaque tenant and customer-bound references", async () => {
		const repository = new InMemoryCheckoutRepository();
		const intent = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		const cart = await repository.attachCart({
			intentId: intent.id,
			shopifyCartId: "gid://shopify/Cart/private",
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			integrationVersion: 1,
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(cart.reference).not.toContain("shopify");
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-a",
				"2029-01-01T00:00:00.000Z",
			),
		).toEqual(cart);
		expect(
			await repository.getCart(
				cart.reference,
				"org-b",
				"customer-a",
				"2029-01-01T00:00:00.000Z",
			),
		).toBeNull();
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-b",
				"2029-01-01T00:00:00.000Z",
			),
		).toBeNull();
		expect(
			await repository.getCart(
				cart.reference,
				"org-a",
				"customer-a",
				"2031-01-01T00:00:00.000Z",
			),
		).toBeNull();
	});

	it("creates a non-secret correlation ID for an intent", async () => {
		const repository = new InMemoryCheckoutRepository();
		const intent = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			offeringId: "offering-a",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(intent.correlationId).toBeTruthy();
		expect(intent.correlationId).not.toContain("cart-a");
	});
});
