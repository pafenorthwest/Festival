import { afterEach, describe, expect, it } from "bun:test";
import { updateAdminMembershipProduct } from "../src/lib/api.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	fetchCalls = [];
});

describe("Teacher membership offering edit UI and API contract (Issue #73)", () => {
	it("sends only editable Teacher offering fields to the tenant-scoped Admin endpoint", async () => {
		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: String(url), init });
			return Promise.resolve(
				mockJsonResponse({
					membershipProduct: {
						id: "offering-123",
						name: "Updated Teacher Membership",
						description: "Updated description",
						variantName: "Standard",
						entitlementClass: "teacher_membership",
						durationDays: 365,
						isActive: true,
						price: { amount: "85.00", currencyCode: "USD" },
						createdAtIso: "2026-01-01T00:00:00.000Z",
					},
				}),
			);
		}) as typeof fetch;

		const response = await updateAdminMembershipProduct(
			"firebase-admin-token",
			"pafe",
			"offering-123",
			{
				name: "Updated Teacher Membership",
				description: "Updated description",
				price: "85.00",
			},
		);

		expect(response.membershipProduct.name).toBe("Updated Teacher Membership");
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0]?.url).toBe(
			"/api/organizations/pafe/admin/membership-products/offering-123",
		);
		expect(fetchCalls[0]?.init?.method).toBe("POST");
		expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
			name: "Updated Teacher Membership",
			description: "Updated description",
			price: "85.00",
		});
	});

	it("wires active-only Teacher offering Edit action, validation, and manual reconciliation error display in AdminMembershipProductsPage", async () => {
		const pageSource = await Bun.file(
			new URL("../src/pages/AdminMembershipProductsPage.tsx", import.meta.url),
		).text();
		const editFormSource = await Bun.file(
			new URL("../src/pages/AdminTeacherOfferingEditForm.tsx", import.meta.url),
		).text();
		const combined = `${pageSource}\n${editFormSource}`;

		expect(combined).toContain("updateAdminMembershipProduct");
		expect(combined).toContain("membershipProduct.isActive");
		expect(combined).toContain(
			'membershipProduct.entitlementClass ===\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t"teacher_membership"',
		);
		expect(combined).toContain("Edit");
		expect(combined).toContain("Edit Teacher Membership");
		expect(combined).toContain("Save Changes");
		expect(combined).toContain("validateMembershipProductInput");
		expect(combined).toContain("Membership offering updated.");
	});
});
