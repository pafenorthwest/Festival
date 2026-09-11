import { describe, expect, it } from "bun:test";
import { customerLandingSignInPath } from "../src/lib/api.js";

const page = await Bun.file(
	new URL("../src/pages/OrganizationRootPage.tsx", import.meta.url),
).text();
const appHeader = await Bun.file(
	new URL("../src/components/AppHeader.tsx", import.meta.url),
).text();
const app = await Bun.file(new URL("../src/App.tsx", import.meta.url)).text();
const sideNavigation = await Bun.file(
	new URL("../src/components/OrganizationSideNavigation.tsx", import.meta.url),
).text();
const styles = await Bun.file(
	new URL("../src/styles.css", import.meta.url),
).text();

describe("public organization landing page", () => {
	it("uses the shared sidebar only for the approved organization routes", () => {
		expect(app).toContain("isOrganizationPageRoute(route)");
		expect(app).toContain("OrganizationSideNavigation");
		expect(sideNavigation).toContain('aria-label="Organization navigation"');
		expect(sideNavigation).toContain("buildOrgCustomerAccountMembershipsPath");
		expect(sideNavigation).toContain("buildOrgCustomerAccountContactPath");
		expect(sideNavigation).toContain("buildOrgCustomerAccountOrdersPath");
		expect(sideNavigation).toContain("buildOrgRootPath");
		expect(sideNavigation).toContain("Accounts");
		expect(sideNavigation).toContain("Festival");
	});

	it("provides a non-persistent responsive icon-only sidebar toggle", () => {
		expect(sideNavigation).toContain("window.matchMedia");
		expect(sideNavigation).toContain("(max-width: 720px)");
		expect(sideNavigation).toContain("Expand navigation");
		expect(sideNavigation).toContain("Collapse navigation");
		expect(sideNavigation).toContain("card_membership");
		expect(sideNavigation).toContain("contact_page");
		expect(sideNavigation).toContain("receipt_long");
		expect(sideNavigation).toContain("home");
		expect(sideNavigation).toContain('aria-label="Memberships"');
		expect(sideNavigation).toContain('aria-label="Contact Information"');
		expect(sideNavigation).toContain('aria-label="Order History"');
		expect(sideNavigation).toContain('aria-label="Home"');
		expect(styles).toContain(".organization-side-navigation.is-collapsed");
	});

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
		expect(appHeader).toContain("/account/memberships`}");
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
