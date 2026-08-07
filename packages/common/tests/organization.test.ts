import { describe, expect, it } from "bun:test";
import {
	deriveDisplayName,
	ORGANIZATION_ROLES,
	validateOrganizationName,
	validateOrganizationShortName,
} from "../src/organization.js";

describe("organization helpers", () => {
	it("validates allowed organization names", () => {
		const result = validateOrganizationName("Performing Arts Festival");

		expect(result.valid).toBeTrue();
		expect(result.normalized).toBe("Performing Arts Festival");
	});

	it("rejects invalid organization name punctuation", () => {
		const result = validateOrganizationName("Festival Admins!");

		expect(result.valid).toBeFalse();
		expect(result.errors).toContain(
			"Organization name may only contain letters, numbers, spaces, and hyphens.",
		);
	});

	it("validates and normalizes organization short names", () => {
		const result = validateOrganizationShortName("PAFE");

		expect(result.valid).toBeTrue();
		expect(result.normalized).toBe("pafe");
	});

	it("rejects long or invalid organization short names", () => {
		const result = validateOrganizationShortName("Festival!");

		expect(result.valid).toBeFalse();
		expect(result.errors).toContain(
			"Organization short name must be 6 characters or less.",
		);
		expect(result.errors).toContain(
			"Organization short name may only contain letters, numbers, and hyphens.",
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
