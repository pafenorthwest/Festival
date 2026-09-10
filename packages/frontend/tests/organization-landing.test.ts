import { describe, expect, it } from "bun:test";
import { customerLandingSignInPath } from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/OrganizationRootPage.tsx", import.meta.url),
).text();

describe("public organization landing page", () => {
	it("uses only Shopify Customer Account authentication", () => {
		expect(customerLandingSignInPath("pafe")).toBe(
			"/api/organizations/pafe/customer-auth/start?returnTo=%2Forg%2Fpafe",
		);
		expect(page).toContain("getCustomerSession");
		expect(page).toContain("logoutCustomer");
		expect(page).not.toContain("handleLogout");
	});

	it("renders the approved banner sequence and destinations", () => {
		const teachers = page.indexOf('class="role-banner teachers"');
		const parents = page.indexOf('class="role-banner parents"');
		const volunteers = page.indexOf('class="role-banner volunteers"');
		const accompanists = page.indexOf('class="role-banner accompanists"');
		expect(teachers).toBeGreaterThan(-1);
		expect(teachers).toBeLessThan(parents);
		expect(parents).toBeLessThan(volunteers);
		expect(volunteers).toBeLessThan(accompanists);
		expect(page).toContain("All Memberships");
	});
});
