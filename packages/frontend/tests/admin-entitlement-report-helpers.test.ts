import { describe, expect, it } from "bun:test";
import {
	entitlementPageNumbers,
	entitlementStatusBadgeClass,
	formatEntitlementClass,
	formatEntitlementCustomer,
	formatEntitlementDivisions,
	formatEntitlementPageRange,
	formatEntitlementSource,
	formatEntitlementStatus,
} from "../src/pages/adminEntitlementReportHelpers.js";

describe("admin entitlement report helpers", () => {
	it("labels classes, sources, and statuses for display", () => {
		expect(formatEntitlementClass("teacher_membership")).toBe("Teacher");
		expect(formatEntitlementClass("accompanist_membership")).toBe(
			"Accompanist",
		);
		expect(formatEntitlementSource("teacher_checkout")).toBe(
			"Shopify checkout",
		);
		expect(formatEntitlementSource("accompanist_form")).toBe(
			"Accompanist form",
		);
		expect(formatEntitlementStatus("scheduled")).toBe("Scheduled");
	});

	it("uses a distinct badge style for every lifecycle status", () => {
		const classes = (
			["active", "scheduled", "expired", "revoked"] as const
		).map(entitlementStatusBadgeClass);
		expect(new Set(classes).size).toBe(4);
	});

	it("falls back from name to email to a placeholder for the customer", () => {
		expect(
			formatEntitlementCustomer({
				customerName: " Ava ",
				customerEmail: "ava@example.com",
			}),
		).toEqual({ primary: "Ava", secondary: "ava@example.com" });
		expect(
			formatEntitlementCustomer({ customerEmail: "ava@example.com" }),
		).toEqual({ primary: "ava@example.com" });
		expect(formatEntitlementCustomer({})).toEqual({
			primary: "Unknown customer",
		});
	});

	it("joins division names and shows a dash when there are none", () => {
		expect(
			formatEntitlementDivisions([
				{ divisionId: "1", divisionName: "Piano" },
				{ divisionId: "2", divisionName: "Strings" },
			]),
		).toBe("Piano, Strings");
		expect(formatEntitlementDivisions([])).toBe("—");
	});
});

describe("entitlement report paging helpers", () => {
	it("describes the visible range", () => {
		expect(
			formatEntitlementPageRange({
				total: 100,
				page: 2,
				pageSize: 25,
				entries: new Array(25),
			}),
		).toBe("Showing 26\u201350 of 100");
		expect(
			formatEntitlementPageRange({
				total: 51,
				page: 3,
				pageSize: 25,
				entries: new Array(1),
			}),
		).toBe("Showing 51\u201351 of 51");
		expect(
			formatEntitlementPageRange({
				total: 0,
				page: 1,
				pageSize: 25,
				entries: [],
			}),
		).toBe("0 entitlements");
	});

	it("lists page buttons with gaps only where two or more pages are skipped", () => {
		expect(entitlementPageNumbers(1, 1)).toEqual([1]);
		expect(entitlementPageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
		expect(entitlementPageNumbers(1, 10)).toEqual([1, 2, "gap", 10]);
		expect(entitlementPageNumbers(5, 10)).toEqual([
			1,
			"gap",
			4,
			5,
			6,
			"gap",
			10,
		]);
		expect(entitlementPageNumbers(10, 10)).toEqual([1, "gap", 9, 10]);
		expect(entitlementPageNumbers(3, 10)).toEqual([1, 2, 3, 4, "gap", 10]);
	});
});
