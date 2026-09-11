import { describe, expect, it } from "bun:test";
import { customerLandingSignInPath } from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/OrganizationRootPage.tsx", import.meta.url),
).text();
const appHeader = await Bun.file(
	new URL("../src/components/AppHeader.tsx", import.meta.url),
).text();
const styles = await Bun.file(
	new URL("../src/styles.css", import.meta.url),
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

	it("renders Home and the account icon before the customer auth control", () => {
		const home = appHeader.indexOf('class="org-landing-home-link"');
		const account = appHeader.indexOf('class="customer-account-link"');
		const auth = appHeader.indexOf('class="customer-auth-button"');

		expect(home).toBeGreaterThan(-1);
		expect(home).toBeLessThan(account);
		expect(account).toBeLessThan(auth);
		expect(appHeader).toContain("href={`/org/");
		expect(appHeader).toContain("/account`}");
		expect(appHeader).toContain('class="material-symbols-outlined"');
		expect(appHeader).toContain("person");
		expect(styles).toContain(".customer-account-link.is-authenticated");
		expect(styles).toContain("padding-inline: 1rem;");
		expect(styles).toContain("color: transparent;");
		expect(styles).toContain("color: var(--bullet-ink);");
		expect(styles).toContain("opacity: 0;");
		expect(styles).toContain("opacity: 1;");
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
		expect(page).toContain(
			'class="button secondary-button compact-header-button all-memberships-link"',
		);
		expect(appHeader).toContain('variant="compact-header"');
		expect(appHeader).toContain("onClick={login}");
		expect(appHeader).toContain(
			'window.location.assign(customerLandingSignInPath(slug() ?? ""));',
		);
		expect(appHeader).not.toContain(
			'<a\n\t\t\t\t\t\t\t\t\tclass="button secondary-button compact-header-button customer-auth-button"',
		);
	});
});
