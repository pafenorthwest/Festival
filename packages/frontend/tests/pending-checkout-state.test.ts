import { describe, expect, it } from "bun:test";
import type {
	PendingClassCheckoutDto,
	PendingClassCheckoutResponse,
} from "@festival/common";
import { createRoot } from "solid-js";
import {
	createPendingCheckoutState,
	type PendingCheckoutDependencies,
} from "../src/domains/customer/pending-checkout-state.js";
import { createRegistrationCart } from "../src/pages/registrationCartState.js";

const ready: PendingClassCheckoutDto = {
	state: "ready",
	recoveryReference: "checkout-reference",
	festivalShortName: "spring",
	registrationCount: 1,
	registrations: [],
	resumeAllowed: true,
	reasonCode: "checkout_ready",
	verifiedAtIso: "2026-11-15T12:00:00.000Z",
};
const partial: PendingClassCheckoutDto = {
	...ready,
	state: "partially_paid",
	resumeAllowed: false,
	payment: {
		receivedAmount: "40.00",
		outstandingAmount: "60.00",
		currencyCode: "USD",
	},
};

function mount(
	read: PendingCheckoutDependencies["read"],
	resume = async () => ({
		checkoutUrl: "https://festival.myshopify.com/checkout/existing",
	}),
) {
	return createRoot((dispose) => ({
		...createPendingCheckoutState({ read, resume }),
		dispose,
	}));
}

describe("customer pending checkout state", () => {
	it("restores a fresh session and coalesces simultaneous verification", async () => {
		const response = Promise.withResolvers<PendingClassCheckoutResponse>();
		let reads = 0;
		const state = mount(async (slug) => {
			expect(slug).toBe("pafe");
			reads++;
			return response.promise;
		});
		try {
			state.bindOwner("pafe", "new-session");
			expect(state.isBlocked()).toBe(true);
			const first = state.refresh();
			const second = state.refresh();
			expect(first).toBe(second);
			response.resolve({ checkout: ready });
			await first;
			expect(reads).toBe(1);
			expect(state.checkout()?.registrationCount).toBe(1);
			expect(state.checkout()?.festivalShortName).toBe("spring");
			expect(state.isBlocked()).toBe(true);
		} finally {
			state.dispose();
		}
	});

	it("retains partial payment and the registration block through outages and later completion", async () => {
		let response: PendingClassCheckoutResponse | Error = { checkout: partial };
		const state = mount(async () => {
			if (response instanceof Error) throw response;
			return response;
		});
		try {
			state.bindOwner("pafe", "session");
			await state.refresh();
			expect(state.checkout()?.payment?.receivedAmount).toBe("40.00");
			expect(await state.resume()).toBeNull();
			response = new Error("Shopify is unavailable");
			await state.refresh();
			expect(state.phase()).toBe("error");
			expect(state.checkout()).toEqual(partial);
			expect(state.isBlocked()).toBe(true);
			response = {
				checkout: { ...ready, state: "processing", resumeAllowed: false },
			};
			await state.refresh();
			expect(state.isBlocked()).toBe(true);
			response = { checkout: null };
			await state.refresh();
			expect(state.checkout()).toBeNull();
			expect(state.isBlocked()).toBe(false);
		} finally {
			state.dispose();
		}
	});

	it.each([
		"account",
		"organization",
		"sign-out",
	])("ignores old responses after %s changes", async (change) => {
		const oldRead = Promise.withResolvers<PendingClassCheckoutResponse>();
		const newRead = Promise.withResolvers<PendingClassCheckoutResponse>();
		let reads = 0;
		const state = mount(() =>
			++reads === 1 ? oldRead.promise : newRead.promise,
		);
		try {
			state.bindOwner("pafe", "session-a");
			const oldRequest = state.refresh();
			await Bun.sleep(0);
			if (change === "sign-out") state.clear();
			else
				state.bindOwner(
					change === "organization" ? "other" : "pafe",
					"session-b",
				);
			const currentRequest = state.refresh();
			oldRead.resolve({ checkout: partial });
			await oldRequest;
			expect(state.checkout()).toBeNull();
			if (change === "sign-out") {
				expect(state.phase()).toBe("idle");
				expect(state.isBlocked()).toBe(false);
			} else {
				expect(state.isBlocked()).toBe(true);
				newRead.resolve({ checkout: ready });
				await currentRequest;
				expect(state.checkout()).toEqual(ready);
			}
		} finally {
			state.dispose();
		}
	});

	it("does not let a read begun before handoff clear the frozen submitted selections", async () => {
		const oldRead = Promise.withResolvers<PendingClassCheckoutResponse>();
		let response: PendingClassCheckoutResponse = { checkout: ready };
		let reads = 0;
		const state = mount(() =>
			++reads === 1 ? oldRead.promise : Promise.resolve(response),
		);
		const cart = createRegistrationCart();
		cart.addItem({
			childId: "performer",
			childName: "Performer",
			divisionId: "piano",
			divisionName: "Piano",
			teacherId: "teacher",
			classId: "solo",
			className: "Solo",
			priceCents: 10000,
			pieces: [],
		});
		const submission = cart.beginCheckout();
		let completions = 0;
		try {
			state.bindOwner("pafe", "session");
			const earlier = state.refresh();
			await Bun.sleep(0);
			state.markHandoff("spring:key", () => {
				completions++;
				cart.completeCheckout(submission);
			});
			oldRead.resolve({ checkout: null });
			await earlier;
			expect(cart.itemCount()).toBe(1);
			expect(cart.checkoutSubmission()).toBe(submission);
			expect(state.isBlocked()).toBe(true);
			await state.refresh();
			expect(cart.itemCount()).toBe(1);
			response = { checkout: null };
			await state.refresh();
			await state.refresh();
			expect(cart.itemCount()).toBe(0);
			expect(completions).toBe(1);
		} finally {
			state.dispose();
		}
	});

	it("uses current-session CSRF for resume and withholds an old owner's navigation URL", async () => {
		const result = Promise.withResolvers<{ checkoutUrl: string }>();
		const requests: string[][] = [];
		const state = createRoot((dispose) => ({
			...createPendingCheckoutState({
				read: async () => ({ checkout: ready }),
				resume: async (slug, reference, csrf) => {
					requests.push([slug, reference, csrf]);
					return result.promise;
				},
			}),
			dispose,
		}));
		try {
			state.bindOwner("pafe", "new-session");
			await state.refresh();
			const resume = state.resume();
			expect(await state.resume()).toBeNull();
			expect(requests).toEqual([
				["pafe", ready.recoveryReference, "new-session"],
			]);
			state.bindOwner("pafe", "different-customer-session");
			result.resolve({
				checkoutUrl: "https://festival.myshopify.com/checkout/existing",
			});
			expect(await resume).toBeNull();
			expect(state.isResuming()).toBe(false);
		} finally {
			state.dispose();
		}
	});

	it("withholds a resume URL if another live read has confirmed the checkout is resolved", async () => {
		const result = Promise.withResolvers<{ checkoutUrl: string }>();
		let response: PendingClassCheckoutResponse = { checkout: ready };
		const state = mount(
			async () => response,
			() => result.promise,
		);
		try {
			state.bindOwner("pafe", "session");
			await state.refresh();
			const resume = state.resume();
			response = { checkout: null };
			await state.refresh();
			result.resolve({
				checkoutUrl: "https://festival.myshopify.com/checkout/old",
			});
			expect(await resume).toBeNull();
			expect(state.isBlocked()).toBe(false);
		} finally {
			state.dispose();
		}
	});

	it("keeps malformed or failed discovery blocked instead of treating it as an empty cart", async () => {
		const state = mount(async () => ({}) as PendingClassCheckoutResponse);
		try {
			state.bindOwner("pafe", "session");
			await state.refresh();
			expect(state.phase()).toBe("error");
			expect(state.checkout()).toBeNull();
			expect(state.isBlocked()).toBe(true);
		} finally {
			state.dispose();
		}
	});

	it("retains organization-scoped handoffs across navigation and resolves only the returning owner", async () => {
		const state = mount(async () => ({ checkout: null }));
		const completed: string[] = [];
		try {
			state.bindOwner("org-a", "session-a");
			await state.refresh();
			state.markHandoff("cart-a", () => completed.push("a"));
			state.clear(true);
			expect(state.checkout()).toBeNull();
			expect(state.ownerSlug()).toBeNull();
			state.bindOwner("org-b", "session-b");
			await state.refresh();
			expect(completed).toEqual([]);
			state.markHandoff("cart-b", () => completed.push("b"));
			state.clear(true);
			state.bindOwner("org-a", "session-a");
			await state.refresh();
			expect(completed).toEqual(["a"]);
			state.clear(true);
			state.bindOwner("org-b", "session-b");
			await state.refresh();
			expect(completed).toEqual(["a", "b"]);
		} finally {
			state.dispose();
		}
	});

	it("drops replaced or signed-out organization callbacks without dropping another organization's handoff", async () => {
		const state = mount(async () => ({ checkout: null }));
		const completed: string[] = [];
		try {
			state.bindOwner("org-a", "session-a");
			state.markHandoff("old-cart-a", () => completed.push("old-a"));
			state.clear(true);
			state.bindOwner("org-b", "session-b");
			state.markHandoff("cart-b", () => completed.push("b"));
			state.clear(true);
			state.bindOwner("org-a", "replacement-session-a");
			await state.refresh();
			expect(completed).toEqual([]);
			state.markHandoff("signed-out-cart-a", () =>
				completed.push("signed-out-a"),
			);
			state.clearOrganization("org-a");
			state.bindOwner("org-a", "replacement-session-a");
			await state.refresh();
			expect(completed).toEqual([]);
			state.clear(true);
			state.bindOwner("org-b", "session-b");
			await state.refresh();
			expect(completed).toEqual(["b"]);
		} finally {
			state.dispose();
		}
	});
});
