import { describe, expect, it } from "bun:test";
import {
	deriveShopifyCapabilities,
	normalizeEffectiveShopifyScopes,
	normalizeShopifyStoreDomain,
	validateMembershipProductInput,
	validateShopifySettingsInput,
} from "../src/shopify.js";

describe("Shopify settings contract", () => {
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
	it("normalizes valid membership product creation input", () => {
		expect(
			validateMembershipProductInput({
				name: " Teacher Membership ",
				description: " Annual membership. ",
				price: "75.00",
				membershipType: "teacher",
				entitlementPeriod: "1_year",
			}),
		).toEqual({
			valid: true,
			errors: [],
			input: {
				name: "Teacher Membership",
				description: "Annual membership.",
				price: "75.00",
				membershipType: "teacher",
				entitlementPeriod: "1_year",
			},
		});
	});

	it("rejects missing membership product names", () => {
		expect(
			validateMembershipProductInput({
				name: " ",
				price: "75.00",
				membershipType: "teacher",
				entitlementPeriod: "1_year",
			}).errors,
		).toContain("Membership product name is required.");
	});

	it("rejects invalid membership product prices", () => {
		for (const price of ["", "-1.00", "1.999", "abc", "01.00"]) {
			expect(
				validateMembershipProductInput({
					name: "Teacher Membership",
					price,
					membershipType: "teacher",
					entitlementPeriod: "1_year",
				}).valid,
			).toBeFalse();
		}
	});

	it("rejects unsupported membership product options", () => {
		const result = validateMembershipProductInput({
			name: "Teacher Membership",
			price: "75.00",
			membershipType: "student",
			entitlementPeriod: "2_years",
		});

		expect(result.errors).toEqual([
			"Membership product type must be teacher or accompanist.",
			"Membership entitlement period must be 1_day, 1_month, or 1_year.",
		]);
		expect(result.input).toEqual({
			name: "Teacher Membership",
			price: "75.00",
		});
	});
});
