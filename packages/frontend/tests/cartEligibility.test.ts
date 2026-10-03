import { describe, expect, it, mock } from "bun:test";
import type { ClassEligibilityResult } from "@festival/common";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);

const { createRoot } = clientSolid;
const { createRegistrationCart } = await import(
	"../src/pages/registrationCartState.js"
);
const { getEligibilityKey, useCartEligibility } = await import(
	"../src/pages/useCartEligibility.js"
);

const cartViewSource = await Bun.file(
	new URL(
		"../src/components/FestivalRegistrationCartView.tsx",
		import.meta.url,
	),
).text();

const flushTicks = async (delayMs = 20) => {
	await new Promise((resolve) => setTimeout(resolve, delayMs));
};

describe("useCartEligibility hook", () => {
	it("initializes with empty state and does not evaluate when cart is empty", async () => {
		await new Promise<void>((resolve) => {
			createRoot((dispose) => {
				let evaluatorCalled = false;
				const cart = createRegistrationCart();
				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					csrfToken: "csrf-token-1",
					cart,
					evaluator: async () => {
						evaluatorCalled = true;
						return { results: [] };
					},
				});

				expect(eligibility.isEvaluating()).toBe(false);
				expect(eligibility.error()).toBeNull();
				expect(eligibility.results().size).toBe(0);
				expect(eligibility.hasIneligibleItems()).toBe(false);
				expect(eligibility.ineligibleCount()).toBe(0);
				expect(eligibility.isCartEligible()).toBe(false);
				expect(evaluatorCalled).toBe(false);

				dispose();
				resolve();
			});
		});
	});

	it("evaluates added items reactively and populates results map", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const mockResult: ClassEligibilityResult = {
					childId: "child-1",
					festivalClassId: "cls-1",
					eligible: true,
					isEligible: true,
					reasonCode: "AVAILABLE",
					message: "Class is available.",
				};

				let receivedItems: unknown = null;
				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					csrfToken: "csrf-123",
					cart,
					evaluator: async (_slug, _fest, items, csrf) => {
						receivedItems = items;
						expect(csrf).toBe("csrf-123");
						return { results: [mockResult] };
					},
				});

				cart.addItem({
					childId: "child-1",
					childName: "Alice",
					divisionId: "div-1",
					divisionName: "Junior",
					teacherId: "teacher-1",
					teacherName: "Mozart",
					classId: "cls-1",
					className: "Piano Solo",
					priceCents: 3000,
					pieces: [],
				});

				// Wait for reactive microtask
				await flushTicks();

				expect(receivedItems).toEqual([
					{
						childId: "child-1",
						classId: "cls-1",
						festivalClassId: "cls-1",
						teacherId: "teacher-1",
						accompanistId: null,
						pieces: [],
					},
				]);

				const key = getEligibilityKey("child-1", "cls-1");
				expect(key).toBe("child-1:cls-1");
				expect(eligibility.results().has(key)).toBe(true);
				expect(eligibility.getResult("child-1", "cls-1")).toEqual(mockResult);
				expect(eligibility.isItemEligible("child-1", "cls-1")).toBe(true);
				expect(eligibility.hasIneligibleItems()).toBe(false);
				expect(eligibility.ineligibleCount()).toBe(0);
				expect(eligibility.isCartEligible()).toBe(true);

				dispose();
				resolve();
			});
		});
	});

	it("identifies missing prerequisite and marks cart ineligible", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const prereqResult: ClassEligibilityResult = {
					childId: "child-1",
					festivalClassId: "cls-adv",
					eligible: false,
					isEligible: false,
					reasonCode: "MISSING_PREREQUISITE",
					message: "Missing prerequisite subtype Solo Piano",
					missingPrerequisite: {
						requiredSubtypeId: "sub-solo",
						requiredSubtypeName: "Solo Piano",
					},
				};

				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					cart,
					evaluator: async () => ({ results: [prereqResult] }),
				});

				cart.addItem({
					childId: "child-1",
					childName: "Alice",
					divisionId: "div-1",
					divisionName: "Junior",
					teacherId: "t-1",
					teacherName: "Teach",
					classId: "cls-adv",
					className: "Advanced Concerto",
					priceCents: 5000,
					pieces: [],
				});

				await flushTicks();

				expect(eligibility.isItemEligible("child-1", "cls-adv")).toBe(false);
				expect(eligibility.hasIneligibleItems()).toBe(true);
				expect(eligibility.ineligibleCount()).toBe(1);
				expect(eligibility.isCartEligible()).toBe(false);
				expect(
					eligibility.getResult("child-1", "cls-adv")?.missingPrerequisite
						?.requiredSubtypeName,
				).toBe("Solo Piano");

				dispose();
				resolve();
			});
		});
	});

	it("re-evaluates reactively when ineligible item is removed from cart", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				let evaluationCallCount = 0;

				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					cart,
					evaluator: async (_s, _f, items) => {
						evaluationCallCount++;
						const results: ClassEligibilityResult[] = items.map((item) => {
							if (item.festivalClassId === "cls-ineligible") {
								return {
									childId: item.childId,
									festivalClassId: item.festivalClassId,
									eligible: false,
									isEligible: false,
									reasonCode: "MISSING_PREREQUISITE",
									message: "Missing prerequisite.",
								};
							}
							return {
								childId: item.childId,
								festivalClassId: item.festivalClassId,
								eligible: true,
								isEligible: true,
								reasonCode: "AVAILABLE",
							};
						});
						return { results };
					},
				});

				cart.addItem({
					childId: "c-1",
					childName: "Alice",
					divisionId: "d-1",
					divisionName: "Junior",
					teacherId: "t-1",
					teacherName: "Teach",
					classId: "cls-eligible",
					className: "Level 1",
					priceCents: 2000,
					pieces: [],
				});

				const badItem = cart.addItem({
					childId: "c-1",
					childName: "Alice",
					divisionId: "d-1",
					divisionName: "Junior",
					teacherId: "t-1",
					teacherName: "Teach",
					classId: "cls-ineligible",
					className: "Level 10",
					priceCents: 4000,
					pieces: [],
				});

				await flushTicks();

				expect(eligibility.hasIneligibleItems()).toBe(true);
				expect(eligibility.ineligibleCount()).toBe(1);
				expect(eligibility.isCartEligible()).toBe(false);

				// Remove the bad item
				cart.removeItem(badItem.lineId);

				await flushTicks();

				expect(eligibility.hasIneligibleItems()).toBe(false);
				expect(eligibility.ineligibleCount()).toBe(0);
				expect(eligibility.isCartEligible()).toBe(true);
				expect(evaluationCallCount).toBeGreaterThanOrEqual(2);

				// Clear cart
				cart.clearCart();
				await flushTicks();

				expect(eligibility.results().size).toBe(0);
				expect(eligibility.hasIneligibleItems()).toBe(false);
				expect(eligibility.isCartEligible()).toBe(false);

				dispose();
				resolve();
			});
		});
	});

	it("handles evaluator errors and exposes error state", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					cart,
					evaluator: async () => {
						throw new Error("Eligibility service temporarily unavailable.");
					},
				});

				cart.addItem({
					childId: "c-1",
					childName: "Alice",
					divisionId: "d-1",
					divisionName: "Junior",
					teacherId: "t-1",
					teacherName: "Teach",
					classId: "cls-1",
					className: "Piano 1",
					priceCents: 2000,
					pieces: [],
				});

				await flushTicks();

				expect(eligibility.isEvaluating()).toBe(false);
				expect(eligibility.error()).toBe(
					"Eligibility service temporarily unavailable.",
				);
				expect(eligibility.isCartEligible()).toBe(false);

				dispose();
				resolve();
			});
		});
	});

	it("discards stale evaluation responses if items change during flight", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				let resolveFirstCall: ((value: unknown) => void) | null = null;

				let call = 0;
				const eligibility = useCartEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					cart,
					evaluator: async () => {
						call++;
						if (call === 1) {
							return new Promise((res) => {
								resolveFirstCall = res;
							});
						}
						return {
							results: [
								{
									childId: "c-2",
									festivalClassId: "cls-fast",
									eligible: true,
									isEligible: true,
									reasonCode: "AVAILABLE",
								},
							],
						};
					},
				});

				cart.addItem({
					lineId: "first",
					childId: "c-1",
					childName: "Alice",
					divisionId: "d-1",
					divisionName: "Div",
					teacherId: "t-1",
					teacherName: "T",
					classId: "cls-slow",
					className: "Slow",
					priceCents: 1000,
					pieces: [],
				});

				await flushTicks();
				expect(eligibility.isEvaluating()).toBe(true);

				// Add second item before first call resolves
				cart.addItem({
					lineId: "second",
					childId: "c-2",
					childName: "Bob",
					divisionId: "d-1",
					divisionName: "Div",
					teacherId: "t-1",
					teacherName: "T",
					classId: "cls-fast",
					className: "Fast",
					priceCents: 1000,
					pieces: [],
				});

				await flushTicks();

				// Second call has resolved
				expect(eligibility.results().has("c-2:cls-fast")).toBe(true);

				// Now first call resolves with stale data
				if (resolveFirstCall) {
					(resolveFirstCall as (v: unknown) => void)({
						results: [
							{
								childId: "c-1",
								festivalClassId: "cls-stale",
								eligible: true,
								isEligible: true,
								reasonCode: "AVAILABLE",
							},
						],
					});
				}

				await flushTicks();

				// Stale response must NOT overwrite results
				expect(eligibility.results().has("c-1:cls-stale")).toBe(false);

				dispose();
				resolve();
			});
		});
	});
});

describe("FestivalRegistrationCartView reactive UI & gating", () => {
	it("renders subtle eligible indicator when item is eligible", () => {
		expect(cartViewSource).toContain("badge badge-active");
		expect(cartViewSource).toContain("✓ Eligible");
		expect(cartViewSource).toContain("itemResult()?.isEligible");
	});

	it("renders evaluating badge while async evaluation is in progress", () => {
		expect(cartViewSource).toContain("isEvaluating()");
		expect(cartViewSource).toContain("badge badge-neutral");
		expect(cartViewSource).toContain("Evaluating…");
	});

	it("renders ineligible alert with missing prerequisite subtype or reason message", () => {
		expect(cartViewSource).toContain("cart-item-ineligible-alert");
		expect(cartViewSource).toContain("Ineligible:");
		expect(cartViewSource).toContain(
			"missingPrerequisite?.requiredSubtypeName",
		);
		expect(cartViewSource).toContain(
			"dependencyDescriptor?.requiredSubtypeName",
		);
		expect(cartViewSource).toContain("itemResult()?.message");
	});

	it("displays banner when cart contains any ineligible items", () => {
		expect(cartViewSource).toContain("cart-ineligible-banner");
		expect(cartViewSource).toContain("hasIneligible()");
		expect(cartViewSource).toMatch(
			/One or more items in your cart are[\s\S]*?not eligible for registration/,
		);
	});

	it("displays eligibility error message if check fails", () => {
		expect(cartViewSource).toContain("cart-eligibility-error");
		expect(cartViewSource).toContain("Eligibility check failed:");
		expect(cartViewSource).toContain("props.eligibility?.error()");
	});

	it("gates checkout button on submitting, evaluating, ineligibility, and error", () => {
		expect(cartViewSource).toContain("isCheckoutDisabled");
		expect(cartViewSource).toContain("disabled={isCheckoutDisabled()}");
		expect(cartViewSource).toContain("isEvaluating()");
		expect(cartViewSource).toContain("hasIneligible()");
		expect(cartViewSource).toContain("props.isSubmitting");
		expect(cartViewSource).toContain("Evaluating eligibility…");
		expect(cartViewSource).toContain("Resolve Ineligible Items");
	});

	it("renders performer group headers with subtotal and class count", () => {
		expect(cartViewSource).toContain("cart-performer-group");
		expect(cartViewSource).toContain("cart-performer-group-header");
		expect(cartViewSource).toContain("Performer Subtotal:");
		expect(cartViewSource).toContain("Performer: {group.childName}");
	});

	it("displays fee breakdown summary panel with entry count and total", () => {
		expect(cartViewSource).toContain("cart-fee-breakdown-panel");
		expect(cartViewSource).toContain("Registration Fee Subtotal:");
		expect(cartViewSource).toContain(
			"Total: {props.cart.totalPriceFormatted()}",
		);
		expect(cartViewSource).toContain("performerGroups().length");
	});

	it("renders checkout error banner when error prop is present", () => {
		expect(cartViewSource).toContain("cart-checkout-error-banner");
		expect(cartViewSource).toContain("props.error");
	});
});
