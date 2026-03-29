import { describe, expect, it } from "bun:test";
import {
	deriveDisplayName,
	ORGANIZATION_ROLES,
	validateOrganizationName,
} from "../src/organization.js";

describe("organization helpers", () => {
	it("validates allowed organization names", () => {
		const result = validateOrganizationName("festival-admins");

		expect(result.valid).toBeTrue();
		expect(result.normalized).toBe("festival-admins");
	});

	it("rejects uppercase characters and invalid punctuation", () => {
		const result = validateOrganizationName("Festival Admins!");

		expect(result.valid).toBeFalse();
		expect(result.errors).toContain(
			"Organization name may only contain lowercase letters and hyphens.",
		);
	});

	it("exports the locked invite role list", () => {
		expect(ORGANIZATION_ROLES).toEqual([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]);
	});

	it("prefers explicit invite acceptance names", () => {
		expect(
			deriveDisplayName({
				name: "Ada Lovelace",
				displayName: "Existing User",
				email: "ada@example.com",
			}),
		).toBe("Ada Lovelace");
	});
});
