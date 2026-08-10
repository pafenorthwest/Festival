import { describe, expect, it } from "bun:test";
import {
	normalizeShopifyStoreDomain,
	validateShopifySettingsInput,
} from "../src/shopify.js";

describe("Shopify settings contract", () => {
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
