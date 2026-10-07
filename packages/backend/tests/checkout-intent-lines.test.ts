import { describe, expect, it } from "bun:test";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";

describe("checkout intent lines", () => {
	it("synthesizes 1 intent line when no lines are provided", async () => {
		const repository = new InMemoryCheckoutRepository();
		const result = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-single",
			intentType: "class_entry",
			festivalClassId: "class-single",
			childId: "child-single",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		expect(result.kind).toBe("created");
		if (result.kind !== "created") throw new Error("Expected created");
		expect(result.intent.lines).toBeDefined();
		expect(result.intent.lines).toHaveLength(1);
		const line = result.intent.lines?.[0];
		expect(line?.lineIndex).toBe(0);
		expect(line?.lineType).toBe("class_entry");
		expect(line?.festivalClassId).toBe("class-single");
		expect(line?.childId).toBe("child-single");
		expect(line?.amount).toBe("75.00");
		expect(line?.currencyCode).toBe("USD");
	});

	it("supports multiple intent lines and links registration metadata per line", async () => {
		const repository = new InMemoryCheckoutRepository();
		const lineInput = (n: number) => ({
			shopifyProductGid: `gid://shopify/Product/${n}`,
			shopifyVariantGid: `gid://shopify/ProductVariant/${n}`,
			amount: "75.00",
			currencyCode: "USD",
			festivalClassId: `class-${n}`,
			childId: `child-${n}`,
		});
		const result = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-multi",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			amount: "150.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
			lines: [lineInput(1), lineInput(2)],
		});
		expect(result.kind).toBe("created");
		if (result.kind !== "created") throw new Error("Expected created");
		expect(result.intent.lines).toHaveLength(2);
		const [line1, line2] = result.intent.lines ?? [];
		expect(line1?.festivalClassId).toBe("class-1");
		expect(line2?.festivalClassId).toBe("class-2");

		await repository.insertRegistrationMetadata({
			id: "reg-line-1",
			organizationId: "org-a",
			festivalId: "fest-1",
			checkoutIntentId: result.intent.id,
			checkoutIntentLineId: line1?.id,
			teacherMembershipId: "teach-1",
			accompanistMembershipId: null,
			repertoireJson: [],
		});
		await repository.insertRegistrationMetadata({
			id: "reg-line-2",
			organizationId: "org-a",
			festivalId: "fest-1",
			checkoutIntentId: result.intent.id,
			checkoutIntentLineId: line2?.id,
			teacherMembershipId: "teach-1",
			accompanistMembershipId: null,
			repertoireJson: [],
		});

		await repository.linkRegistrationMetadataToEntitlement({
			checkoutIntentLineId: line1?.id,
			classEntitlementId: "ent-1",
		});
		await repository.linkRegistrationMetadataToEntitlement({
			checkoutIntentLineId: line2?.id,
			classEntitlementId: "ent-2",
		});

		const meta1 = await repository.getRegistrationMetadataByEntitlementId(
			"org-a",
			"ent-1",
		);
		const meta2 = await repository.getRegistrationMetadataByEntitlementId(
			"org-a",
			"ent-2",
		);
		expect(meta1?.checkoutIntentLineId).toBe(line1?.id);
		expect(meta2?.checkoutIntentLineId).toBe(line2?.id);
	});

	it("links registration metadata by checkoutIntentId for backwards compatibility", async () => {
		const repository = new InMemoryCheckoutRepository();
		const result = await repository.createIntent({
			organizationId: "org-a",
			customerId: "customer-a",
			sessionId: "session-a",
			idempotencyKey: "key-compat",
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			amount: "75.00",
			currencyCode: "USD",
			expiresAtIso: "2030-01-01T00:00:00.000Z",
		});
		if (result.kind !== "created") throw new Error("Expected created");

		await repository.insertRegistrationMetadata({
			id: "reg-compat-1",
			organizationId: "org-a",
			festivalId: "fest-1",
			checkoutIntentId: result.intent.id,
			teacherMembershipId: "teach-1",
			accompanistMembershipId: null,
			repertoireJson: [],
		});

		await repository.linkRegistrationMetadataToEntitlement({
			checkoutIntentId: result.intent.id,
			classEntitlementId: "ent-compat",
		});

		const meta = await repository.getRegistrationMetadataByEntitlementId(
			"org-a",
			"ent-compat",
		);
		expect(meta?.id).toBe("reg-compat-1");
		expect(meta?.classEntitlementId).toBe("ent-compat");
	});
});
