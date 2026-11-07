import { afterEach, describe, expect, it } from "bun:test";
import {
	type MembershipProductSummary,
	validateMembershipProductInput,
} from "@festival/common";
import { createRoot } from "solid-js";
import type { FestivalAppController } from "../src/app/useFestivalAppController.js";
import { updateAdminMembershipProduct } from "../src/lib/api.js";
import {
	canEditTeacherOffering,
	createTeacherOfferingEditState,
	isTeacherOfferingPriceInvalid,
	TEACHER_OFFERING_UPDATED_MESSAGE,
} from "../src/pages/AdminTeacherOfferingEditForm.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function mockJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const activeTeacherOffering: MembershipProductSummary = {
	id: "offering-123",
	name: "Teacher Membership",
	description: "Annual teacher membership",
	variantName: "Standard",
	entitlementClass: "teacher_membership",
	durationDays: 365,
	isActive: true,
	price: { amount: "75.00", currencyCode: "USD" },
	createdAtIso: "2026-01-01T00:00:00.000Z",
};

function createFakeApp(loadedSlugs: string[] = []): FestivalAppController {
	return {
		route: () => ({ kind: "org-admin-memberships", slug: "pafe" }),
		firebaseUser: () => ({
			getIdToken: async () => "firebase-admin-token",
		}),
		loadMembershipProducts: async (slug: string) => {
			loadedSlugs.push(slug);
		},
	} as unknown as FestivalAppController;
}

afterEach(() => {
	fetchCalls = [];
	globalThis.fetch = originalFetch;
});

describe("Teacher membership offering edit UI and API contract (Issue #73)", () => {
	it("sends only editable Teacher offering fields to the tenant-scoped Admin endpoint", async () => {
		globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
			fetchCalls.push({ url: String(url), init });
			return Promise.resolve(
				mockJsonResponse({
					membershipProduct: {
						...activeTeacherOffering,
						name: "Updated Teacher Membership",
						description: "Updated description",
						price: { amount: "85.00", currencyCode: "USD" },
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

	it("allows editing only active Teacher offerings and scopes price aria-invalid to price validation", async () => {
		expect(canEditTeacherOffering(activeTeacherOffering)).toBe(true);
		expect(
			canEditTeacherOffering({
				...activeTeacherOffering,
				isActive: false,
			}),
		).toBe(false);
		expect(
			canEditTeacherOffering({
				...activeTeacherOffering,
				entitlementClass: "accompanist_membership",
			}),
		).toBe(false);
		expect(TEACHER_OFFERING_UPDATED_MESSAGE).toBe(
			"Membership offering updated.",
		);

		expect(isTeacherOfferingPriceInvalid(false, "")).toBe(false);
		expect(isTeacherOfferingPriceInvalid(true, "85.00")).toBe(false);
		expect(isTeacherOfferingPriceInvalid(true, "")).toBe(true);
		expect(isTeacherOfferingPriceInvalid(true, "85.999")).toBe(true);

		await createRoot(async (dispose) => {
			try {
				const loadedSlugs: string[] = [];
				let savedCount = 0;
				const state = createTeacherOfferingEditState({
					app: createFakeApp(loadedSlugs),
					offering: activeTeacherOffering,
					onClose: () => {},
					onSaved: () => {
						savedCount += 1;
					},
				});

				expect(state.name()).toBe("Teacher Membership");
				expect(state.description()).toBe("Annual teacher membership");
				expect(state.price()).toBe("75.00");
				expect(state.nameInvalid()).toBe(false);
				expect(state.priceInvalid()).toBe(false);

				// Empty name with valid price flags nameInvalid only, not priceInvalid
				state.setName("   ");
				state.setPrice("85.00");
				await state.submit();
				expect(state.attempted()).toBe(true);
				expect(state.nameInvalid()).toBe(true);
				expect(state.priceInvalid()).toBe(false);
				expect(fetchCalls).toHaveLength(0);

				// Valid name with invalid price flags priceInvalid only
				state.setName("Updated Teacher Membership");
				state.setPrice("85.999");
				await state.submit();
				expect(state.nameInvalid()).toBe(false);
				expect(state.priceInvalid()).toBe(true);
				expect(fetchCalls).toHaveLength(0);

				// Manual reconciliation error is surfaced in saveError without calling onSaved
				globalThis.fetch = ((
					url: string | URL | Request,
					init?: RequestInit,
				) => {
					fetchCalls.push({ url: String(url), init });
					return Promise.resolve(
						mockJsonResponse(
							{
								error:
									"Shopify update succeeded, but Festival could not confirm or persist the updated Teacher membership offering. Manual reconciliation is required.",
								code: "manual_reconciliation_required",
							},
							502,
						),
					);
				}) as typeof fetch;

				state.setPrice("85.00");
				state.setDescription("  Updated description  ");
				await state.submit();
				expect(fetchCalls).toHaveLength(1);
				expect(state.saveError()).toContain(
					"Manual reconciliation is required.",
				);
				expect(savedCount).toBe(0);
				expect(loadedSlugs).toEqual([]);

				// Successful save reloads membership products and invokes onSaved
				globalThis.fetch = ((
					url: string | URL | Request,
					init?: RequestInit,
				) => {
					fetchCalls.push({ url: String(url), init });
					return Promise.resolve(
						mockJsonResponse({
							membershipProduct: {
								...activeTeacherOffering,
								name: "Updated Teacher Membership",
								description: "Updated description",
								price: { amount: "85.00", currencyCode: "USD" },
							},
						}),
					);
				}) as typeof fetch;

				await state.submit();
				expect(fetchCalls).toHaveLength(2);
				expect(state.saveError()).toBe("");
				expect(loadedSlugs).toEqual(["pafe"]);
				expect(savedCount).toBe(1);
			} finally {
				dispose();
			}
		});
	});

	it("validates membership product input for valid and invalid name and price formats", () => {
		expect(
			validateMembershipProductInput({
				name: "  Teacher Membership  ",
				description: "  Annual membership  ",
				price: "85.00",
			}),
		).toEqual({
			valid: true,
			errors: [],
			input: {
				name: "Teacher Membership",
				description: "Annual membership",
				price: "85.00",
			},
		});

		const emptyName = validateMembershipProductInput({
			name: "   ",
			price: "85.00",
		});
		expect(emptyName.valid).toBe(false);
		expect(emptyName.errors).toContain("Membership product name is required.");

		const missingPrice = validateMembershipProductInput({
			name: "Teacher Membership",
			price: "   ",
		});
		expect(missingPrice.valid).toBe(false);
		expect(missingPrice.errors).toContain(
			"Membership product price is required.",
		);

		for (const invalidPrice of ["-10.00", "85.999", "01.00", "abc", "75."]) {
			const invalidPriceResult = validateMembershipProductInput({
				name: "Teacher Membership",
				price: invalidPrice,
			});
			expect(invalidPriceResult.valid).toBe(false);
			expect(invalidPriceResult.errors).toContain(
				"Membership product price must be a non-negative decimal string with at most 2 decimal places.",
			);
		}
	});
});
