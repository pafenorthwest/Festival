import { describe, expect, it } from "bun:test";
import { customerAccompanistMembershipSignInPath } from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/AccompanistMembershipPage.tsx", import.meta.url),
).text();

describe("accompanist membership authentication gate", () => {
	it("checks the customer session before protected profile and form requests", () => {
		const session = page.indexOf("await getCustomerSession(props.slug)");
		const profile = page.indexOf("getCustomerProfile(props.slug)");
		const form = page.indexOf("getAccompanistMembershipForm(props.slug)");

		expect(session).toBeGreaterThan(-1);
		expect(profile).toBeGreaterThan(session);
		expect(form).toBeGreaterThan(session);
		expect(page).toContain("setNeedsSignIn(true)");
		expect(page).not.toContain("Promise.all([\n\t\t\t\tgetCustomerSession");
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
});
