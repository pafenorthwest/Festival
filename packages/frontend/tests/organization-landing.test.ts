import { describe, expect, it } from "bun:test";
import { customerLandingSignInPath } from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/OrganizationRootPage.tsx", import.meta.url),
).text();
const appHeader = await Bun.file(
	new URL("../src/components/AppHeader.tsx", import.meta.url),
).text();

describe("public organization landing page", () => {
	it("uses the shared Organization Page header for customer authentication", () => {
		expect(customerLandingSignInPath("pafe")).toBe(
			"/api/organizations/pafe/customer-auth/start?returnTo=%2Forg%2Fpafe",
		);
		expect(appHeader).toContain("isOrganizationPageRoute");
		expect(appHeader).toContain("getCustomerSession");
		expect(appHeader).toContain("logoutCustomer");
		expect(appHeader).toContain('class="org-landing-header"');
		expect(page).not.toContain('class="org-landing-header"');
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
