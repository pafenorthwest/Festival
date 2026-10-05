import { describe, expect, it, mock } from "bun:test";
import type { RegistrationEligibleClass } from "@festival/common";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);

const { createRoot, createSignal } = clientSolid;
const { createRegistrationCart } = await import(
	"../src/pages/registrationCartState.js"
);
const { useClassOptionEligibility } = await import(
	"../src/pages/useClassOptionEligibility.js"
);

const regPageSource = await Bun.file(
	new URL("../src/pages/FestivalClassRegistrationPage.tsx", import.meta.url),
).text();

const flushTicks = async (delayMs = 25) => {
	await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const soloClass: RegistrationEligibleClass = {
	id: "class-solo-1",
	displayName: "Piano Solo",
	divisionId: "div-piano",
	classSubtypeId: "subtype-solo",
	minimumAge: 6,
	maximumAge: 18,
	price: "45.00",
	isActive: true,
	maximumPerformancePieces: 1,
};

const concertoClass: RegistrationEligibleClass = {
	id: "class-concerto-1",
	displayName: "Piano Concerto",
	divisionId: "div-piano",
	classSubtypeId: "subtype-concerto",
	minimumAge: 6,
	maximumAge: 18,
	price: "60.00",
	isActive: true,
	maximumPerformancePieces: 1,
};

describe("useClassOptionEligibility hook", () => {
	it("initializes empty and does not evaluate when child or classes are empty", async () => {
		await new Promise<void>((resolve) => {
			createRoot((dispose) => {
				let evaluatorCalled = false;
				const cart = createRegistrationCart();
				const [childId] = createSignal("");
				const [classes] = createSignal<RegistrationEligibleClass[]>([]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					csrfToken: "csrf-123",
					childId,
					classes,
					cart,
					evaluator: async () => {
						evaluatorCalled = true;
						return { results: [] };
					},
				});

				expect(hook.isEvaluating()).toBe(false);
				expect(hook.error()).toBeNull();
				expect(hook.getOption("class-solo-1")).toBeUndefined();
				expect(evaluatorCalled).toBe(false);

				dispose();
				resolve();
			});
		});
	});

	it("batches cart items and candidate classes with candidate line identifiers", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				cart.addItem({
					childId: "child-other",
					childName: "Other Performer",
					divisionId: "div-piano",
					divisionName: "Piano",
					teacherId: "teacher-1",
					teacherName: "Teacher",
					classId: "class-existing",
					className: "Existing Class",
					priceCents: 4500,
					pieces: [],
				});

				const [childId] = createSignal("child-1");
				const [classes] = createSignal<RegistrationEligibleClass[]>([
					soloClass,
					concertoClass,
				]);

				let receivedItems: unknown[] = [];

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					csrfToken: "csrf-token",
					childId,
					classes,
					cart,
					evaluator: async (_slug, _fest, items) => {
						receivedItems = items;
						return {
							results: [
								{
									childId: "child-1",
									festivalClassId: soloClass.id,
									eligible: true,
									isEligible: true,
									reasonCode: "AVAILABLE",
								},
								{
									childId: "child-1",
									festivalClassId: concertoClass.id,
									eligible: false,
									isEligible: false,
									reasonCode: "MISSING_PREREQUISITE",
									missingPrerequisite: {
										requiredSubtypeId: "subtype-solo",
										requiredSubtypeName: "Piano Solo",
									},
								},
							],
						};
					},
				});

				await flushTicks();

				expect(receivedItems.length).toBe(3); // 1 cart item + 2 candidate classes
				const candidates = (
					receivedItems as Array<{ isCandidate?: boolean; id?: string }>
				).filter((i) => i.isCandidate);
				expect(candidates.length).toBe(2);
				expect(candidates[0].id).toBe(`candidate:${soloClass.id}`);
				expect(candidates[1].id).toBe(`candidate:${concertoClass.id}`);

				// Check solo option
				const soloOpt = hook.getOption(soloClass.id);
				expect(soloOpt).toBeDefined();
				expect(soloOpt?.isEligible).toBe(true);
				expect(soloOpt?.reasonCode).toBe("AVAILABLE");
				expect(hook.isEligible(soloClass.id)).toBe(true);
				expect(hook.formatOption(soloClass)).toBe(
					"Piano Solo · $45.00 (6–18 yrs)",
				);

				// Check concerto option
				const concertoOpt = hook.getOption(concertoClass.id);
				expect(concertoOpt).toBeDefined();
				expect(concertoOpt?.isEligible).toBe(false);
				expect(concertoOpt?.reasonCode).toBe("MISSING_PREREQUISITE");
				expect(concertoOpt?.reasonText).toBe(
					"Requires Piano Solo in cart or completed registration",
				);
				expect(concertoOpt?.badgeText).toBe(
					"Requires Piano Solo in cart or completed registration",
				);
				expect(hook.isEligible(concertoClass.id)).toBe(false);
				expect(hook.formatOption(concertoClass)).toContain(
					"Requires Piano Solo in cart or completed registration",
				);
				expect(hook.selectedReason(concertoClass.id)).toBe(
					"Requires Piano Solo in cart or completed registration",
				);

				dispose();
				resolve();
			});
		});
	});

	it("disables option with 'Already in cart' when item is already in cart for performer", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				cart.addItem({
					childId: "child-1",
					childName: "Alex",
					divisionId: "div-piano",
					divisionName: "Piano",
					teacherId: "teacher-1",
					teacherName: "Teacher",
					classId: soloClass.id,
					className: soloClass.displayName,
					priceCents: 4500,
					pieces: [],
				});

				const [childId] = createSignal("child-1");
				const [classes] = createSignal<RegistrationEligibleClass[]>([
					soloClass,
				]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({ results: [] }),
				});

				await flushTicks();

				const opt = hook.getOption(soloClass.id);
				expect(opt).toBeDefined();
				expect(opt?.isEligible).toBe(false);
				expect(opt?.reasonCode).toBe("IN_CART");
				expect(opt?.reasonText).toBe("Already in cart");
				expect(opt?.badgeText).toBe("Already in cart");
				expect(hook.formatOption(soloClass)).toContain("Already in cart");

				dispose();
				resolve();
			});
		});
	});

	it("formats 'Already registered' when server returns ALREADY_REGISTERED", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const [childId] = createSignal("child-1");
				const [classes] = createSignal<RegistrationEligibleClass[]>([
					soloClass,
				]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({
						results: [
							{
								childId: "child-1",
								festivalClassId: soloClass.id,
								eligible: false,
								isEligible: false,
								reasonCode: "ALREADY_REGISTERED",
								message: "Performer is already registered for this class.",
							},
						],
					}),
				});

				await flushTicks();

				const opt = hook.getOption(soloClass.id);
				expect(opt?.isEligible).toBe(false);
				expect(opt?.reasonCode).toBe("ALREADY_REGISTERED");
				expect(opt?.reasonText).toBe("Already registered");
				expect(hook.formatOption(soloClass)).toContain("Already registered");

				dispose();
				resolve();
			});
		});
	});

	it("re-evaluates reactively when cart items change", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const [childId] = createSignal("child-1");
				const [classes] = createSignal<RegistrationEligibleClass[]>([
					concertoClass,
				]);

				let callCount = 0;

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "spring-2026",
					childId,
					classes,
					cart,
					evaluator: async (_s, _f, items) => {
						callCount++;
						const hasSoloInCart = items.some(
							(i) =>
								i.childId === "child-1" && i.festivalClassId === soloClass.id,
						);
						return {
							results: [
								{
									childId: "child-1",
									festivalClassId: concertoClass.id,
									eligible: hasSoloInCart,
									isEligible: hasSoloInCart,
									reasonCode: hasSoloInCart
										? "AVAILABLE"
										: "MISSING_PREREQUISITE",
									missingPrerequisite: hasSoloInCart
										? undefined
										: {
												requiredSubtypeId: "subtype-solo",
												requiredSubtypeName: "Piano Solo",
											},
								},
							],
						};
					},
				});

				await flushTicks();
				expect(callCount).toBe(1);
				expect(hook.isEligible(concertoClass.id)).toBe(false);

				// Add prerequisite to cart
				cart.addItem({
					childId: "child-1",
					childName: "Alex",
					divisionId: "div-piano",
					divisionName: "Piano",
					teacherId: "teacher-1",
					teacherName: "Teacher",
					classId: soloClass.id,
					className: soloClass.displayName,
					priceCents: 4500,
					pieces: [],
				});

				await flushTicks();
				expect(callCount).toBe(2);
				expect(hook.isEligible(concertoClass.id)).toBe(true);
				expect(hook.getOption(concertoClass.id)?.reasonCode).toBe("AVAILABLE");

				dispose();
				resolve();
			});
		});
	});
});

describe("FestivalClassRegistrationPage source contract for candidate eligibility", () => {
	it("wires useClassOptionEligibility hook and guards class selection", () => {
		expect(regPageSource).toContain("useClassOptionEligibility");
		expect(regPageSource).toContain("classOptionEligibility");
		expect(regPageSource).toContain("classOptionEligibility.isEligible");
		expect(regPageSource).toContain("classOptionEligibility.formatOption");
		expect(regPageSource).toContain("classOptionEligibility.selectedReason");
	});

	it("disables ineligible option in the class select and renders reason text", () => {
		expect(regPageSource).toContain('id="registration-class"');
		expect(regPageSource).toContain(
			"disabled={!classOptionEligibility.isEligible(c.id)}",
		);
		expect(regPageSource).toContain("{classOptionEligibility.formatOption(c)}");
	});

	it("keeps FestivalClassRegistrationPage strictly under 500 lines", () => {
		const lines = regPageSource.split("\n").length;
		expect(lines).toBeLessThan(500);
	});
});
