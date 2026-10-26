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

const flushTicks = async (delayMs = 25) => {
	await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const baseClass: RegistrationEligibleClass = {
	id: "class-1",
	displayName: "Solo Piano Level 1",
	divisionId: "div-1",
	classSubtypeId: "sub-1",
	minimumAge: 5,
	maximumAge: 18,
	price: "50.00",
	maximumPerformancePieces: 2,
	performanceMinutes: 5,
	capacity: 10,
};

describe("useClassOptionEligibility - waitlist detection and formatting", () => {
	it("detects waitlist when class has availability='waitlist'", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const waitlistClass: RegistrationEligibleClass = {
					...baseClass,
					id: "class-wl-1",
					displayName: "Waitlist Class",
					availability: "waitlist",
				};
				const [childId] = createSignal("child-1");
				const [classes] = createSignal([waitlistClass]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "fest-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({ results: [] }),
				});

				expect(hook.isWaitlist(waitlistClass.id)).toBe(true);
				expect(hook.isEligible(waitlistClass.id)).toBe(false);
				expect(hook.formatOption(waitlistClass)).toBe(
					"Waitlist Class · $50.00 (5–18 yrs) [Waitlist]",
				);
				expect(hook.selectedReason(waitlistClass.id)).toBeNull();

				const opt = hook.getOption(waitlistClass.id);
				expect(opt?.isEligible).toBe(false);
				expect(opt?.reasonCode).toBe("SOLD_OUT");
				expect(opt?.badgeText).toBe("Waitlist");

				dispose();
				resolve();
			});
		});
	});

	it("detects waitlist when server evaluation returns availability='waitlist'", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const normalClass: RegistrationEligibleClass = {
					...baseClass,
					id: "class-server-wl",
					displayName: "Popular Class",
				};
				const [childId] = createSignal("child-1");
				const [classes] = createSignal([normalClass]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "fest-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({
						results: [
							{
								childId: "child-1",
								festivalClassId: normalClass.id,
								eligible: false,
								isEligible: false,
								reasonCode: "SOLD_OUT",
								availability: "waitlist",
							},
						],
					}),
				});

				expect(hook.isWaitlist(normalClass.id)).toBe(false);
				await flushTicks();

				expect(hook.isWaitlist(normalClass.id)).toBe(true);
				expect(hook.isEligible(normalClass.id)).toBe(false);
				expect(hook.formatOption(normalClass)).toBe(
					"Popular Class · $50.00 (5–18 yrs) [Waitlist]",
				);
				expect(hook.selectedReason(normalClass.id)).toBeNull();

				dispose();
				resolve();
			});
		});
	});

	it("detects waitlist when server evaluation returns reasonCode='SOLD_OUT'", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const soldOutClass: RegistrationEligibleClass = {
					...baseClass,
					id: "class-sold-out",
					displayName: "Full Class",
				};
				const [childId] = createSignal("child-1");
				const [classes] = createSignal([soldOutClass]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "fest-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({
						results: [
							{
								childId: "child-1",
								festivalClassId: soldOutClass.id,
								eligible: false,
								isEligible: false,
								reasonCode: "SOLD_OUT",
								message: "Class capacity reached.",
							},
						],
					}),
				});

				await flushTicks();

				expect(hook.isWaitlist(soldOutClass.id)).toBe(true);
				expect(hook.isEligible(soldOutClass.id)).toBe(false);
				expect(hook.formatOption(soldOutClass)).toBe(
					"Full Class · $50.00 (5–18 yrs) [Waitlist]",
				);
				expect(hook.selectedReason(soldOutClass.id)).toBeNull();

				dispose();
				resolve();
			});
		});
	});

	it("ensures waitlist availability remains active even if festival registration window is closed", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const closedWaitlistClass: RegistrationEligibleClass = {
					...baseClass,
					id: "class-closed-wl",
					displayName: "Closed But Waitlist",
					availability: "waitlist",
					isRegistrationOpen: false,
				};
				const [childId] = createSignal("child-1");
				const [classes] = createSignal([closedWaitlistClass]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "fest-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({ results: [] }),
				});

				expect(hook.isWaitlist(closedWaitlistClass.id)).toBe(true);
				expect(hook.isEligible(closedWaitlistClass.id)).toBe(false);
				// Suffix must be [Waitlist], NOT (Registration closed)
				expect(hook.formatOption(closedWaitlistClass)).toBe(
					"Closed But Waitlist · $50.00 (5–18 yrs) [Waitlist]",
				);
				expect(hook.formatOption(closedWaitlistClass)).not.toContain(
					"Registration closed",
				);

				const opt = hook.getOption(closedWaitlistClass.id);
				expect(opt?.badgeText).toBe("Waitlist");
				expect(opt?.reasonText).toBe("Waitlist");

				dispose();
				resolve();
			});
		});
	});

	it("returns false for isWaitlist when class is available or nonexistent", async () => {
		await new Promise<void>((resolve) => {
			createRoot(async (dispose) => {
				const cart = createRegistrationCart();
				const [childId] = createSignal("child-1");
				const [classes] = createSignal([baseClass]);

				const hook = useClassOptionEligibility({
					slug: "test-org",
					festivalSlug: "fest-2026",
					childId,
					classes,
					cart,
					evaluator: async () => ({ results: [] }),
				});

				expect(hook.isWaitlist(undefined)).toBe(false);
				expect(hook.isWaitlist("nonexistent")).toBe(false);
				expect(hook.isWaitlist(baseClass.id)).toBe(false);

				dispose();
				resolve();
			});
		});
	});
});
