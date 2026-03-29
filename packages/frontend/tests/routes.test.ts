import { describe, expect, it } from "bun:test";
import {
	buildInvitePath,
	buildOrgPath,
	parseRoute,
} from "../src/lib/routes.js";

describe("route helpers", () => {
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
	});

	it("builds org and invite paths", () => {
		expect(buildOrgPath("festival-admins")).toBe("/org/festival-admins");
		expect(buildInvitePath("abc123")).toBe("/invite/abc123");
	});
});
