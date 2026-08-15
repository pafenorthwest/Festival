import { describe, expect, it } from "bun:test";
import {
	normalizeCustomerAccountDomain,
	validateCustomerAccountSettings,
	validateCustomerProfileInput,
} from "../src/customer-account.js";

describe("Customer Account settings contract", () => {
	it("normalizes a tenant storefront hostname and keeps the secret replace-only", () => {
		expect(
			normalizeCustomerAccountDomain("https://Festival.Example.com/path"),
		).toBe("festival.example.com");
		expect(
			validateCustomerAccountSettings(
				{ storefrontDomain: "festival.example.com", clientId: "client" },
				false,
			),
		).toEqual({
			storefrontDomain: "festival.example.com",
			clientId: "client",
			clientSecret: undefined,
		});
	});
	it("rejects authority and token fields outside the allowlist", () => {
		expect(() =>
			validateCustomerAccountSettings(
				{
					storefrontDomain: "festival.example.com",
					clientId: "client",
					organizationId: "other",
					accessToken: "token",
				},
				false,
			),
		).toThrow("unsupported fields");
	});
});

describe("Customer profile contract", () => {
	it("normalizes the allowlisted customer-editable fields", () => {
		expect(
			validateCustomerProfileInput({
				name: " Adult Customer ",
				email: " CUSTOMER@Example.COM ",
				phone: "+1 (555) 010-0200",
				mailingAddress: {
					line1: " 1 Main St ",
					line2: " Suite 2 ",
					city: " Seattle ",
					region: " WA ",
					postalCode: " 98101 ",
					countryCode: " us ",
				},
			}),
		).toEqual({
			name: "Adult Customer",
			email: "customer@example.com",
			phone: "+1 (555) 010-0200",
			mailingAddress: {
				line1: "1 Main St",
				line2: "Suite 2",
				city: "Seattle",
				region: "WA",
				postalCode: "98101",
				countryCode: "US",
			},
		});
	});
	it("rejects identity and authority fields outside the profile allowlist", () => {
		expect(() =>
			validateCustomerProfileInput({
				name: "Customer",
				email: "customer@example.com",
				phone: "+15550100",
				mailingAddress: {
					line1: "1 Main St",
					city: "Seattle",
					region: "WA",
					postalCode: "98101",
					countryCode: "US",
				},
				customerId: "browser-controlled",
				shopifyCustomerGid: "gid://shopify/Customer/other",
			}),
		).toThrow("unsupported fields");
	});
});
