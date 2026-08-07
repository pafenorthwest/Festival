import { describe, expect, it } from "bun:test";
import {
	buildInvitePath,
	buildOrgPath,
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
			kind: "org",
			slug: "second-festival",
		});
	});

	it("parses organization routes", () => {
		expect(parseRoute("/org/festival-admins")).toEqual({
			kind: "org",
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
		expect(buildOrgPath("festival-admins")).toBe("/org/festival-admins");
		expect(buildOrgPath("second-festival")).toBe("/org/second-festival");
		expect(buildInvitePath("abc123")).toBe("/invite/abc123");
	});
});
