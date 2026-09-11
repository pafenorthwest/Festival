import { describe, expect, it } from "bun:test";
import {
	customerSignInPath,
	getCustomerMembershipStatus,
} from "../src/lib/api.js";

const membershipsPage = await Bun.file(
	new URL("../src/pages/CustomerAccountMembershipsPage.tsx", import.meta.url),
).text();
const contactPage = await Bun.file(
	new URL("../src/pages/CustomerAccountContactPage.tsx", import.meta.url),
).text();
const ordersPage = await Bun.file(
	new URL("../src/pages/CustomerAccountOrdersPage.tsx", import.meta.url),
).text();
const layout = await Bun.file(
	new URL("../src/pages/CustomerAccountPageLayout.tsx", import.meta.url),
).text();
const admin = await Bun.file(
	new URL("../src/components/CustomerAccountAdminCard.tsx", import.meta.url),
).text();
const api = await Bun.file(
	new URL("../src/lib/api.ts", import.meta.url),
).text();

describe("customer account frontend boundary", () => {
	it("retains checkout processing on sign-in only for an explicit checkout return", () => {
		const returned = new URL(
			customerSignInPath("pafe", true),
			"https://festival.example.com",
		);
		expect(returned.searchParams.get("returnTo")).toBe(
			"/org/pafe/account/memberships?checkout=processing",
		);
		const ordinary = new URL(
			customerSignInPath("pafe"),
			"https://festival.example.com",
		);
		expect(ordinary.searchParams.get("returnTo")).toBe(
			"/org/pafe/account/memberships",
		);
	});

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
		expect(layout).toContain("getCustomerSession");
		expect(membershipsPage).toContain("getCustomerMembershipStatus");
		expect(contactPage).toContain("getCustomerProfile");
		expect(contactPage).toContain("updateCustomerProfile");
		expect(contactPage).toContain("Mailing address");
		expect(contactPage).toContain("These details are stored in Festival");
		expect(ordersPage).toContain("getCustomerOrders");
		expect(ordersPage).toContain("order.financialStatus");
		expect(ordersPage).toContain("order.fulfillmentStatus");
		expect(ordersPage).not.toMatch(
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
		expect(membershipsPage).toContain("Festival memberships");
		expect(membershipsPage).toContain("Loading Festival membership status");
		expect(membershipsPage).toContain("No Festival memberships found.");
		expect(membershipsPage).toContain("membership status could not be loaded");
		expect(membershipsPage).toContain(
			"Membership validation is still processing",
		);
		expect(membershipsPage).toContain("Refresh membership status");
		expect(membershipsPage).toContain('aria-live="polite"');
		expect(membershipsPage).toContain("membershipRequestInFlight");
		expect(membershipsPage).toContain("MEMBERSHIP_POLL_INTERVAL_MS");
		expect(membershipsPage).toContain("setTimeout");
		expect(membershipsPage).toContain("clearTimeout");
		expect(membershipsPage).toContain("onCleanup");
		expect(membershipsPage).toContain("membershipInitialSignature");
		expect(membershipsPage).toContain("removeCheckoutProcessingQuery");
		expect(membershipsPage).not.toContain("reasonCode");
		expect(membershipsPage).not.toMatch(
			/shopifyOrderGid|shopifyOrderLineGid|checkoutIntentId|accessToken|refreshToken|idToken/,
		);
	});

	it("keeps account authentication in the shared header and account controls consistently styled", () => {
		expect(layout).toContain("Sign in using the header to view your account.");
		expect(layout).not.toContain("customerSignInPath");
		expect(contactPage).not.toContain("logoutCustomer");
		expect(contactPage).toContain('type="button"');
		expect(ordersPage).toContain('type="button"');
		expect(membershipsPage).toContain('type="button"');
	});
	it("keeps Customer Account Admin credentials separate and replace-only", () => {
		expect(admin).toContain("Shopify Customer Accounts");
		expect(admin).toContain("Leave blank to keep existing secret");
		expect(admin).toContain("Callback URL");
		expect(admin).toContain("Save & Verify");
		expect(admin).not.toContain("accessToken");
	});
});
