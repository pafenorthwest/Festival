import { describe, expect, it } from "bun:test";

const page = await Bun.file(
	new URL("../src/pages/CustomerAccountPage.tsx", import.meta.url),
).text();
const admin = await Bun.file(
	new URL("../src/components/CustomerAccountAdminCard.tsx", import.meta.url),
).text();
const api = await Bun.file(
	new URL("../src/lib/api.ts", import.meta.url),
).text();

describe("customer account frontend boundary", () => {
	it("keeps customer calls behind API helpers and renders only the allowlisted order DTO", () => {
		expect(page).toContain("getCustomerSession");
		expect(page).toContain("getCustomerOrders");
		expect(page).toContain("order.financialStatus");
		expect(page).toContain("order.fulfillmentStatus");
		expect(page).not.toMatch(
			/firstName|lastName|emailAddress|phoneNumber|accessToken|refreshToken|idToken/,
		);
		expect(api).toContain('credentials: "include"');
		expect(api).toContain("form.action = `/api/organizations/");
		expect(api).toContain("/customer/logout`;");
	});
	it("keeps Customer Account Admin credentials separate and replace-only", () => {
		expect(admin).toContain("Shopify Customer Accounts");
		expect(admin).toContain("Leave blank to keep existing secret");
		expect(admin).toContain("Callback URL");
		expect(admin).toContain("Save & Verify");
		expect(admin).not.toContain("accessToken");
	});
});
