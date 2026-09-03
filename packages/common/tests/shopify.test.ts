import { describe, expect, it } from "bun:test";
import {
	deriveShopifyCapabilities,
	isMembershipProductPurchasable,
	normalizeEffectiveShopifyScopes,
	normalizeShopifyStoreDomain,
	SHOPIFY_WEBHOOK_FAILURE_CATEGORIES,
	SHOPIFY_WEBHOOK_READINESS_STATUSES,
	validateMembershipProductInput,
	validateShopifySettingsInput,
} from "../src/shopify.js";

describe("Shopify settings contract", () => {
	it("keeps webhook readiness and failure values closed and allowlisted", () => {
		expect(SHOPIFY_WEBHOOK_READINESS_STATUSES).toEqual([
			"unknown",
			"checking",
			"ready",
			"failed",
		]);
		expect(SHOPIFY_WEBHOOK_FAILURE_CATEGORIES).toEqual([
			"configuration",
			"missing_scope",
			"permission",
			"protected_data",
			"callback",
			"transport",
			"upstream",
		]);
	});
	it("normalizes Shopify write access to include its implied read access", () => {
		expect(
			normalizeEffectiveShopifyScopes([
				"write_products",
				"read_orders",
				"write_products",
			]),
		).toEqual(["read_orders", "read_products", "write_products"]);
		expect(
			deriveShopifyCapabilities(["read_orders", "write_products"]),
		).toEqual({
			read_products: "granted",
			write_products: "granted",
			read_orders: "granted",
			write_orders: "disabled",
		});
	});

	it("derives bounded capabilities without enabling future order writes", () => {
		expect(
			deriveShopifyCapabilities([
				"write_orders",
				"read_products",
				"unknown_future_scope",
			]),
		).toEqual({
			read_products: "granted",
			write_products: "missing",
			read_orders: "missing",
			write_orders: "disabled",
		});
	});
	it("normalizes Shopify store URLs to myshopify.com domains", () => {
		expect(
			normalizeShopifyStoreDomain(
				" https://Example-Shop.myshopify.com/admin/settings ",
			),
		).toBe("example-shop.myshopify.com");
	});

	it("requires a secret for new settings but allows retaining an existing one", () => {
		expect(
			validateShopifySettingsInput(
				{
					storeUrl: "example.myshopify.com",
					clientId: "client-id",
					clientSecret: "",
				},
				{ requireClientSecret: true },
			).valid,
		).toBeFalse();

		expect(
			validateShopifySettingsInput(
				{
					storeUrl: "example.myshopify.com",
					clientId: "client-id",
					clientSecret: "",
				},
				{ requireClientSecret: false },
			).valid,
		).toBeTrue();
	});

	it("returns validation errors for malformed settings payloads", () => {
		expect(
			validateShopifySettingsInput({}, { requireClientSecret: true }).errors,
		).toEqual([
			"Shopify store URL is required.",
			"Shopify client ID is required.",
			"Shopify client secret is required.",
		]);

		expect(
			validateShopifySettingsInput(null, { requireClientSecret: false }).errors,
		).toEqual([
			"Shopify store URL is required.",
			"Shopify client ID is required.",
		]);

		expect(
			validateShopifySettingsInput(
				{ storeUrl: 123, clientId: false, clientSecret: [] },
				{ requireClientSecret: true },
			).errors,
		).toEqual([
			"Shopify store URL is required.",
			"Shopify client ID is required.",
			"Shopify client secret is required.",
		]);
	});
});

describe("Shopify membership product contract", () => {
	it("requires both Festival and current Shopify availability", () => {
		expect(
			isMembershipProductPurchasable({ isActive: true, status: "ACTIVE" }),
		).toBeTrue();
		expect(
			isMembershipProductPurchasable({ isActive: false, status: "ACTIVE" }),
		).toBeFalse();
		expect(
			isMembershipProductPurchasable({ isActive: true, status: "DRAFT" }),
		).toBeFalse();
	});

	it("normalizes valid membership product creation input", () => {
		expect(
			validateMembershipProductInput({
				name: " Teacher Membership ",
				description: " Annual membership. ",
				price: "75.00",
			}),
		).toEqual({
			valid: true,
			errors: [],
			input: {
				name: "Teacher Membership",
				description: "Annual membership.",
				price: "75.00",
			},
		});
	});

	it("rejects missing membership product names", () => {
		expect(
			validateMembershipProductInput({
				name: " ",
				price: "75.00",
			}).errors,
		).toContain("Membership product name is required.");
	});

	it("rejects invalid membership product prices", () => {
		for (const price of ["", "-1.00", "1.999", "abc", "01.00"]) {
			expect(
				validateMembershipProductInput({
					name: "Teacher Membership",
					price,
				}).valid,
			).toBeFalse();
		}
	});

	it("does not accept entitlement authority fields from browser input", () => {
		const result = validateMembershipProductInput({
			name: "Teacher Membership",
			price: "75.00",
			organizationId: "attacker-org",
			entitlementClass: "attacker_class",
			durationDays: 1,
			shopifyProductGid: "gid://shopify/Product/attacker",
			shopifyVariantGid: "gid://shopify/ProductVariant/attacker",
			currencyCode: "ZZZ",
		});

		expect(result.valid).toBeTrue();
		expect(result.input).toEqual({
			name: "Teacher Membership",
			price: "75.00",
		});
	});
});
