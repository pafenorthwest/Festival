import { describe, expect, it } from "bun:test";
import { getCustomerMembershipStatus } from "../src/lib/api.js";

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
	it("loads the tenant-scoped customer membership status with cookie credentials", async () => {
		const originalFetch = globalThis.fetch;
		let request: { url: string; init?: RequestInit } | undefined;
		globalThis.fetch = (async (
			url: string | URL | Request,
			init?: RequestInit,
		) => {
			request = {
				url:
					typeof url === "string"
						? url
						: url instanceof URL
							? url.toString()
							: url.url,
				init,
			};
			return new Response(
				JSON.stringify({
					memberships: [
						{
							status: "processing",
							entitlementClass: "teacher_membership",
							displayName: "Teacher Membership",
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;
		try {
			const response = await getCustomerMembershipStatus("festival north");
			expect(response.memberships[0]?.status).toBe("processing");
			expect(request?.url).toBe(
				"/api/organizations/festival%20north/customer/membership-status",
			);
			expect(request?.init?.credentials).toBe("include");
			expect(request?.init?.headers).not.toHaveProperty("Authorization");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("keeps customer calls behind API helpers and renders only the allowlisted order DTO", () => {
		expect(page).toContain("getCustomerSession");
		expect(page).toContain("getCustomerMembershipStatus");
		expect(page).toContain("getCustomerOrders");
		expect(page).toContain("getCustomerProfile");
		expect(page).toContain("updateCustomerProfile");
		expect(page).toContain("void loadOrders().catch");
		expect(page).not.toContain("const [, profileResponse] = await Promise.all");
		expect(page).toContain("Mailing address");
		expect(page).toContain("These details are stored in Festival");
		expect(page).toContain("Shopify.");
		expect(page).toContain("order.financialStatus");
		expect(page).toContain("order.fulfillmentStatus");
		expect(page).not.toMatch(
			/firstName|lastName|emailAddress|phoneNumber|accessToken|refreshToken|idToken/,
		);
		expect(api).toContain('credentials: "include"');
		expect(api).toContain("form.action = `/api/organizations/");
		expect(api).toContain("/customer/logout`;");
		expect(api).toContain("/customer/profile");
		expect(api).toContain("/customer/membership-status");
		expect(api).toContain('"X-CSRF-Token": csrfToken');
	});

	it("renders Festival membership states separately and bounds polling", () => {
		expect(page).toContain("Festival memberships");
		expect(page).toContain("Shopify orders");
		expect(page.indexOf("Festival memberships")).toBeLessThan(
			page.indexOf("Shopify orders"),
		);
		expect(page).toContain("Loading Festival membership status");
		expect(page).toContain("No Festival memberships found.");
		expect(page).toContain("membership status could not be loaded");
		expect(page).toContain("Membership validation is still processing");
		expect(page).toContain("Refresh membership status");
		expect(page).toContain('aria-live="polite"');
		expect(page).toContain("membershipRequestInFlight");
		expect(page).toContain("MEMBERSHIP_POLL_INTERVAL_MS");
		expect(page).toContain("setTimeout");
		expect(page).toContain("clearTimeout");
		expect(page).toContain("onCleanup");
		expect(page).toContain("membershipInitialSignature");
		expect(page).toContain("removeCheckoutProcessingQuery");
		expect(page).not.toContain("reasonCode");
		expect(page).not.toMatch(
			/shopifyOrderGid|shopifyOrderLineGid|checkoutIntentId|accessToken|refreshToken|idToken/,
		);
	});
	it("keeps Customer Account Admin credentials separate and replace-only", () => {
		expect(admin).toContain("Shopify Customer Accounts");
		expect(admin).toContain("Leave blank to keep existing secret");
		expect(admin).toContain("Callback URL");
		expect(admin).toContain("Save & Verify");
		expect(admin).not.toContain("accessToken");
	});
});
