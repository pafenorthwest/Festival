import { describe, expect, it } from "bun:test";
import {
	acquireAccompanistMembership,
	customerAccompanistMembershipSignInPath,
} from "../src/lib/api.js";
import { loadAfterCustomerSession } from "../src/pages/accompanistMembershipGate.js";

const page = await Bun.file(
	new URL("../src/pages/AccompanistMembershipPage.tsx", import.meta.url),
).text();

describe("accompanist membership authentication gate", () => {
	it("requires an unchecked sharing consent checkbox before submission", () => {
		expect(page).toContain(
			"[staffAccessConsent, setStaffAccessConsent] = createSignal(false)",
		);
		expect(page).toContain("checked={staffAccessConsent()}");
		expect(page).toContain(
			"setStaffAccessConsent(event.currentTarget.checked)",
		);
		expect(page).toContain(
			"if (!staffAccessConsent() || submitting()) return;",
		);
		expect(page).toContain("disabled={!staffAccessConsent() || submitting()}");
		expect(page).toContain("Required to acquire this membership.");
		expect(page).toContain('<a href="/privacy-policy">Privacy Policy</a>');
		expect(page).toContain("staffAccessConsent: staffAccessConsent()");
		expect(page).toContain("setStaffAccessConsent(false)");
	});

	it("sends affirmative sharing consent in the membership request", async () => {
		const originalFetch = globalThis.fetch;
		let requestBody: unknown;
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({ membership: { id: "membership-1" } }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch;
		try {
			await acquireAccompanistMembership("festival", "csrf", {
				name: "Ava",
				email: "ava@example.com",
				city: "Seattle",
				phone: "206-555-0100",
				divisionIds: ["division-1"],
				staffAccessConsent: true,
			});
			expect(requestBody).toMatchObject({ staffAccessConsent: true });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("does not start protected profile and form requests for an anonymous session", async () => {
		let protectedLoads = 0;
		const result = await loadAfterCustomerSession(
			async () => ({ session: { authenticated: false } }),
			async () => {
				protectedLoads += 1;
				return "protected data";
			},
		);

		expect(result).toEqual({
			authenticated: false,
			session: { session: { authenticated: false } },
		});
		expect(protectedLoads).toBe(0);
		expect(page).toContain("setNeedsSignIn(true)");
	});

	it("starts protected profile and form requests only after an authenticated session", async () => {
		const callOrder: string[] = [];
		const result = await loadAfterCustomerSession(
			async () => {
				callOrder.push("session");
				return { session: { authenticated: true } };
			},
			async () => {
				callOrder.push("protected");
				return "protected data";
			},
		);

		expect(result).toEqual({
			authenticated: true,
			session: { session: { authenticated: true } },
			protectedData: "protected data",
		});
		expect(callOrder).toEqual(["session", "protected"]);
		expect(page).toContain("getCustomerProfile(props.slug)");
		expect(page).toContain("getAccompanistMembershipForm(props.slug)");
	});

	it("renders the accessible anonymous sign-in dialog without enrollment content", () => {
		expect(page).toContain('role="dialog"');
		expect(page).toContain('aria-modal="true"');
		expect(page).toContain("accompanist-sign-in-title");
		expect(page).toContain("Sign in to continue");
		expect(page).toContain("You'll sign in securely with Shopify");
		expect(page).toContain("Continue to Shopify");
		expect(page).toContain("Cancel");
		expect(page).toContain("trapSignInDialogFocus");
		expect(page).toContain("<Show when={authenticated()}>");
	});

	it("shows validation failures in the admin-style Shopify warning banner", () => {
		expect(page).toContain(
			"reason instanceof ApiError && reason.status === 422",
		);
		expect(page).toContain('class="shopify-warning-banner" role="alert"');
		expect(page).toContain("Accompanist membership needs attention.");
	});

	it("uses only the accompanist page as the Shopify return target", () => {
		const signInPath = new URL(
			customerAccompanistMembershipSignInPath("festival north"),
			"https://festival.example.com",
		);

		expect(signInPath.pathname).toBe(
			"/api/organizations/festival%20north/customer-auth/start",
		);
		expect(signInPath.searchParams.get("returnTo")).toBe(
			"/org/festival%20north/accompanist-membership",
		);
		expect(page).toContain("buildOrgRootPath(props.slug)");
		expect(page).toContain("redirectingToShopify()");
	});

	it("redirects to the organization account memberships page after activation", () => {
		expect(page).toContain("buildOrgCustomerAccountMembershipsPath");
		expect(page).toContain("window.location.assign(");
		expect(page).toContain(
			"buildOrgCustomerAccountMembershipsPath(props.slug)",
		);
	});
});
