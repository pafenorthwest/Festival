import { describe, expect, it } from "bun:test";
import {
	normalizeCustomerAccountDomain,
	validateCustomerAccountSettings,
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
