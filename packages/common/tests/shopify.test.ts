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
});
