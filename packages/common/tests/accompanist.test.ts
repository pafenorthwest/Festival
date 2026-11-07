import { describe, expect, it } from "bun:test";
import {
	isAccompanistMembershipGrantActive,
	validateAccompanistContact,
} from "../src/accompanist.js";

describe("Accompanist membership helpers", () => {
	it("isAccompanistMembershipGrantActive returns true only when status is active and isCurrent is true", () => {
		expect(
			isAccompanistMembershipGrantActive({
				status: "active",
				isCurrent: true,
			}),
		).toBe(true);

		expect(
			isAccompanistMembershipGrantActive({
				status: "active",
				isCurrent: false,
			}),
		).toBe(false);

		expect(
			isAccompanistMembershipGrantActive({
				status: "scheduled",
				isCurrent: true,
			}),
		).toBe(false);

		expect(
			isAccompanistMembershipGrantActive({
				status: "superseded",
				isCurrent: false,
			}),
		).toBe(false);

		expect(
			isAccompanistMembershipGrantActive({
				status: "expired",
				isCurrent: false,
			}),
		).toBe(false);

		expect(
			isAccompanistMembershipGrantActive({
				status: "revoked",
				isCurrent: false,
			}),
		).toBe(false);
	});

	it("validateAccompanistContact validates and normalizes contact input", () => {
		const valid = validateAccompanistContact({
			name: " Jane Doe ",
			email: " JANE@EXAMPLE.COM ",
			city: " Seattle ",
			phone: " 555-1234 ",
		});
		expect(valid).toEqual({
			name: "Jane Doe",
			email: "jane@example.com",
			city: "Seattle",
			phone: "555-1234",
		});
	});
});
