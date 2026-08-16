import { describe, expect, it } from "bun:test";
import {
	buildInvitePath,
	buildOrgAdminFestivalsPath,
	buildOrgAdminDivisionsPath,
	buildOrgAdminIntegrationsPath,
	buildOrgAdminMembershipsPath,
	buildOrgAdminUsersPath,
	buildOrgCustomerAccountPath,
	buildOrgMembershipPath,
	buildOrgPath,
	buildOrgRootPath,
	parseRoute,
} from "../src/lib/routes.js";

describe("route helpers", () => {
	it("parses onboarding routes", () => {
		expect(parseRoute("/")).toEqual({ kind: "home" });
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
		expect(parseRoute("/org/festival-admins")).toEqual({
			kind: "org-root",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/membership")).toEqual({
			kind: "org-membership",
			slug: "festival-admins",
		});
		expect(parseRoute("/org/festival-admins/account")).toEqual({
			kind: "org-customer-account",
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
		expect(buildOrgRootPath("festival-admins")).toBe("/org/festival-admins");
		expect(buildOrgMembershipPath("festival-admins")).toBe(
			"/org/festival-admins/membership",
		);
		expect(buildOrgCustomerAccountPath("festival-admins")).toBe(
			"/org/festival-admins/account",
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
		expect(buildOrgPath("second-festival")).toBe("/org/second-festival/admin");
		expect(buildInvitePath("abc123")).toBe("/invite/abc123");
	});
});
