import { describe, expect, it } from "bun:test";
import {
	buildFestivalAdminClassesPath,
	buildFestivalAdminPath,
	buildFestivalVolunteersPath,
	buildInvitePath,
	buildOrgAdminAccompanistsPath,
	buildOrgAdminDivisionsPath,
	buildOrgAdminFestivalsPath,
	buildOrgAdminIntegrationsPath,
	buildOrgAdminMembershipsPath,
	buildOrgAdminRosterPath,
	buildOrgAdminSettingsPath,
	buildOrgAdminUsersPath,
	buildOrgCustomerAccountContactPath,
	buildOrgCustomerAccountMembershipsPath,
	buildOrgCustomerAccountOrdersPath,
	buildOrgCustomerAccountPath,
	buildOrgMembershipPath,
	buildOrgPath,
	buildOrgRootPath,
	buildPrivacyPolicyPath,
	isOrganizationPageRoute,
	parseRoute,
} from "../src/lib/routes.js";

describe("route helpers", () => {
	it("parses onboarding routes", () => {
		expect(parseRoute("/")).toEqual({ kind: "home" });
		expect(parseRoute("/privacy-policy")).toEqual({
			kind: "privacy-policy",
		});
		expect(parseRoute("/create-organization")).toEqual({
			kind: "create-org",
		});
		expect(parseRoute("/invite/abc-123")).toEqual({
			kind: "invite",
			token: "abc-123",
		});
		expect(parseRoute("/org/second-festival")).toEqual({
			kind: "org-root",
			slug: "second-festival",
		});
	});

	it("parses organization routes", () => {
		expect(parseRoute("/org/festival-admins/")).toEqual({
			kind: "org-root",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins")).toEqual({
			kind: "org-root",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/membership")).toEqual({
			kind: "org-membership",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account")).toEqual({
			kind: "org-customer-account-legacy",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account/")).toEqual({
			kind: "org-customer-account-legacy",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account/memberships")).toEqual({
			kind: "org-customer-account-memberships",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account/contact")).toEqual({
			kind: "org-customer-account-contact",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account/orders")).toEqual({
			kind: "org-customer-account-orders",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin")).toEqual({
			kind: "org-admin",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/users")).toEqual({
			kind: "org-admin-users",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/integrations")).toEqual({
			kind: "org-admin-integrations",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/memberships")).toEqual({
			kind: "org-admin-memberships",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/festivals")).toEqual({
			kind: "org-admin-festivals",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/divisions")).toEqual({
			kind: "org-admin-divisions",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/settings")).toEqual({
			kind: "org-admin-settings",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/roster")).toEqual({
			kind: "org-admin-roster",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/admin/accompanists")).toEqual({
			kind: "org-admin-roster",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/festival/jun-27")).toEqual({
			kind: "festival-public",
			slug: "festival-admins",
			festivalSlug: "jun-27",
		});
		expect(parseRoute("/org/festival-admins/festival/jun-27/admin")).toEqual({
			kind: "festival-admin",
			slug: "festival-admins",
			festivalSlug: "jun-27",
		});
		expect(
			parseRoute("/org/festival-admins/festival/jun-27/admin/classes"),
		).toEqual({
			kind: "festival-admin-classes",
			slug: "festival-admins",
			festivalSlug: "jun-27",
		});
	});

	it("identifies public organization pages without treating Festival Admin routes as public", () => {
		expect(isOrganizationPageRoute(parseRoute("/org/festival-admins"))).toBe(
			true,
		);
		expect(
			isOrganizationPageRoute(parseRoute("/org/festival-admins/membership")),
		).toBe(true);
		expect(
			isOrganizationPageRoute(parseRoute("/org/festival-admins/account")),
		).toBe(true);
		expect(
			isOrganizationPageRoute(
				parseRoute("/org/festival-admins/account/children"),
			),
		).toBe(true);
		expect(
			isOrganizationPageRoute(
				parseRoute("/org/festival-admins/festival/jun-27/admin/classes"),
			),
		).toBe(false);
		expect(
			isOrganizationPageRoute(
				parseRoute("/org/festival-admins/festival/jun-27/admin"),
			),
		).toBe(false);
		expect(
			isOrganizationPageRoute(parseRoute("/org/festival-admins/admin")),
		).toBe(false);
		expect(isOrganizationPageRoute(parseRoute("/"))).toBe(false);
	});

	it("parses invite routes", () => {
		expect(parseRoute("/invite/token-123")).toEqual({
			kind: "invite",
			token: "token-123",
		});
		expect(parseRoute("/invite/anything")).toEqual({
			kind: "invite",
			token: "anything",
		});
	});

	it("builds org and invite paths", () => {
		expect(buildOrgPath("festival-admins")).toBe("/org/festival-admins/admin");
		expect(buildFestivalAdminClassesPath("festival-admins", "jun-27")).toBe(
			"/org/festival-admins/festival/jun-27/admin/classes",
		);
		expect(buildFestivalAdminPath("festival-admins", "jun-27")).toBe(
			"/org/festival-admins/festival/jun-27/admin",
		);
		expect(buildOrgRootPath("festival-admins")).toBe("/org/festival-admins");
		expect(buildOrgMembershipPath("festival-admins")).toBe(
			"/org/festival-admins/membership",
		);
		expect(buildOrgCustomerAccountPath("festival-admins")).toBe(
			"/org/festival-admins/account/memberships",
		);
		expect(buildOrgCustomerAccountMembershipsPath("festival-admins")).toBe(
			"/org/festival-admins/account/memberships",
		);
		expect(buildOrgCustomerAccountContactPath("festival-admins")).toBe(
			"/org/festival-admins/account/contact",
		);
		expect(buildOrgCustomerAccountOrdersPath("festival-admins")).toBe(
			"/org/festival-admins/account/orders",
		);
		expect(buildOrgAdminUsersPath("festival-admins")).toBe(
			"/org/festival-admins/admin/users",
		);
		expect(buildOrgAdminIntegrationsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/integrations",
		);
		expect(buildOrgAdminMembershipsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/memberships",
		);
		expect(buildOrgAdminFestivalsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/festivals",
		);
		expect(buildOrgAdminDivisionsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/divisions",
		);
		expect(buildOrgAdminRosterPath("festival-admins")).toBe(
			"/org/festival-admins/admin/roster",
		);
		expect(buildOrgAdminAccompanistsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/roster",
		);
		expect(buildOrgAdminSettingsPath("festival-admins")).toBe(
			"/org/festival-admins/admin/settings",
		);
		expect(buildOrgPath("second-festival")).toBe("/org/second-festival/admin");
		expect(buildInvitePath("abc123")).toBe("/invite/abc123");
		expect(buildPrivacyPolicyPath()).toBe("/privacy-policy");
	});

	it("routes the public festival volunteer page without treating it as the festival page", () => {
		expect(parseRoute("/org/pafe/festival/spring/volunteers")).toEqual({
			kind: "festival-volunteers",
			slug: "pafe",
			festivalSlug: "spring",
		});
		expect(parseRoute("/org/pafe/festival/spring")).toEqual({
			kind: "festival-public",
			slug: "pafe",
			festivalSlug: "spring",
		});
		expect(buildFestivalVolunteersPath("pafe", "spring")).toBe(
			"/org/pafe/festival/spring/volunteers",
		);
		expect(
			parseRoute(buildFestivalVolunteersPath("pafe", "spring")),
		).toMatchObject({ kind: "festival-volunteers" });
	});
});
