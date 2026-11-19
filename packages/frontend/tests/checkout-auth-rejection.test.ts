import { afterEach, describe, expect, it } from "bun:test";
import type {
	ClassCheckoutRecoveryStatusDto,
	CustomerSessionResponse,
} from "@festival/common";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { createCustomerIdentityState } from "../src/domains/customer/CustomerIdentityContext.js";
import {
	type CheckoutRecoveryActionContext,
	createCheckoutRecoveryHandlers,
} from "../src/domains/registration/registrationPageActions.js";
import { createParentRegistrationState } from "../src/lib/parent-registration-state.js";
import type { AppRoute } from "../src/lib/routes.js";

const originalFetch = globalThis.fetch;
const disposers: Array<() => void> = [];
afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const dispose of disposers.splice(0)) dispose();
});

function authenticated(csrfToken: string): CustomerSessionResponse {
	return {
		session: {
			authenticated: true,
			csrfToken,
			expiresAtIso: "2027-01-01T00:00:00.000Z",
		},
	};
}

async function mountCheckout() {
	let response = authenticated("session-a");
	let nextSessionRead: (() => Promise<CustomerSessionResponse>) | undefined;
	let sessionReads = 0;
	let recheck = async () => {};
	let checkoutError: string | null = null;
	let submitting = false;
	let disposed = false;
	const view = createRoot((dispose) => {
		disposers.push(dispose);
		onCleanup(() => {
			disposed = true;
		});
		const parentRegistration = createParentRegistrationState();
		const [route] = createSignal<AppRoute>({ kind: "org-root", slug: "org" });
		const identity = createCustomerIdentityState(
			{ route, parentRegistration },
			async () => {
				sessionReads++;
				return nextSessionRead ? nextSessionRead() : response;
			},
			{
				read: async () => ({ checkout: null }),
				resume: async () => ({ checkoutUrl: "https://shop.example/checkout" }),
			},
		);
		const workspace = parentRegistration.workspace("org", "festival");
		const getCsrf = () => {
			const session = identity.customerSession();
			return session.authenticated ? session.csrfToken : "";
		};
		const handlers = createCheckoutRecoveryHandlers({
			slug: "org",
			festivalSlug: "festival",
			getCsrf,
			refreshCustomerSession: identity.refreshCustomerSession,
			cart: workspace.cart,
			eligibility: {
				recheck: () => recheck(),
				isCartEligible: () => true,
			} as CheckoutRecoveryActionContext["eligibility"],
			isSubmittingCheckout: () => submitting,
			setIsSubmittingCheckout: (value) => {
				submitting = value;
			},
			setCheckoutError: (value) => {
				checkoutError = value;
			},
			setDiscoveredRestart: () => {},
			checkoutRestartReference: () => null,
			isDisposed: () => disposed,
			setHandingOff: () => {},
			isHandingOff: () => false,
			setCompleteHandoff: () => {},
			getCompleteHandoff: () => undefined,
		});
		return { ...handlers, identity, workspace, getCsrf, dispose };
	});
	await Bun.sleep(0);
	view.workspace.setChildId("child-1");
	const line = view.workspace.cart.addItem({
		childId: "child-1",
		childName: "Performer",
		divisionId: "division",
		divisionName: "Division",
		teacherId: "teacher",
		classId: "class",
		className: "Class",
		priceCents: 1200,
		pieces: [{ title: "Minuet", composer: "Bach", durationSeconds: 90 }],
	});
	return {
		...view,
		cart: view.workspace.cart,
		line,
		sessionReads: () => sessionReads,
		checkoutError: () => checkoutError,
		isSubmitting: () => submitting,
		setSessionResponse(value: CustomerSessionResponse) {
			response = value;
		},
		setNextSessionRead(read: () => Promise<CustomerSessionResponse>) {
			nextSessionRead = read;
		},
		setRecheck(check: () => Promise<void>) {
			recheck = check;
		},
	};
}

function rejectCheckout(
	status: number,
	recovery?: ClassCheckoutRecoveryStatusDto,
) {
	const requests: Array<{ csrf: string | null; key: string | null }> = [];
	globalThis.fetch = (async (_url, init) => {
		const headers = new Headers(init?.headers);
		requests.push({
			csrf: headers.get("X-CSRF-Token"),
			key: headers.get("Idempotency-Key"),
		});
		return Response.json(
			{
				error: "Customer authentication failed.",
				...(recovery ? { recovery } : {}),
			},
			{ status },
		);
	}) as typeof fetch;
	return requests;
}

const recovery: ClassCheckoutRecoveryStatusDto = {
	status: "recovery_required",
	recoveryReference: "recovery-1",
	reasonCode: "checkout_creation_unknown",
	retryAllowed: false,
};

describe("checkout authentication rejection recovery", () => {
	it.each([
		401, 403,
	])("releases a fresh submission after repeated %s responses and keeps the same-session cart editable", async (status) => {
		const view = await mountCheckout();
		const requests = rejectCheckout(status);
		const originalKey = view.cart.getCheckoutIdempotencyKey();
		await view.handleCartCheckout();
		expect(view.sessionReads()).toBe(2);
		expect(view.cart.checkoutSubmission()).toBeNull();
		expect(view.cart.items()).toEqual([view.line]);
		expect(requests).toEqual([{ csrf: "session-a", key: originalKey }]);
		await view.handleCartCheckout();
		expect(view.sessionReads()).toBe(3);
		expect(view.cart.checkoutSubmission()).toBeNull();
		expect(view.cart.checkoutRecovery()).toBeNull();
		expect(view.isSubmitting()).toBe(false);
		expect(requests).toEqual([
			{ csrf: "session-a", key: originalKey },
			{ csrf: "session-a", key: originalKey },
		]);
		view.cart.removeItem(view.line.lineId);
		expect(view.cart.itemCount()).toBe(0);
	});

	it("clears the old draft when refresh discovers a replacement session and sends no automatic retry", async () => {
		const view = await mountCheckout();
		const requests = rejectCheckout(403);
		view.setSessionResponse(authenticated("session-b"));
		await view.handleCartCheckout();
		expect(view.getCsrf()).toBe("session-b");
		expect(view.workspace.childId()).toBe("");
		expect(view.cart.itemCount()).toBe(0);
		expect(view.cart.checkoutSubmission()).toBeNull();
		expect(view.checkoutError()).toBeNull();
		await view.handleCartCheckout();
		expect(requests).toHaveLength(1);
		expect(requests[0].csrf).toBe("session-a");
	});

	it("ignores an eligibility result after the customer session changes", async () => {
		const view = await mountCheckout();
		const requests = rejectCheckout(403);
		const eligibility = Promise.withResolvers<void>();
		view.setRecheck(() => eligibility.promise);
		const checkout = view.handleCartCheckout();
		view.setSessionResponse(authenticated("session-b"));
		await view.identity.refreshCustomerSession("org");
		eligibility.resolve();
		await checkout;
		expect(view.getCsrf()).toBe("session-b");
		expect(view.cart.itemCount()).toBe(0);
		expect(requests).toEqual([]);
	});

	it("ignores a session refresh result after checkout disposal", async () => {
		const view = await mountCheckout();
		const requests = rejectCheckout(403);
		const refresh = Promise.withResolvers<CustomerSessionResponse>();
		const started = Promise.withResolvers<void>();
		view.setNextSessionRead(() => {
			started.resolve();
			return refresh.promise;
		});
		const checkout = view.handleCartCheckout();
		await started.promise;
		view.dispose();
		refresh.resolve(authenticated("session-b"));
		await checkout;
		expect(view.getCsrf()).toBe("session-a");
		expect(view.cart.items()).toEqual([view.line]);
		expect(view.checkoutError()).toBeNull();
		expect(requests).toHaveLength(1);
	});

	it("keeps an existing uncertain submission locked after an auth rejection", async () => {
		const view = await mountCheckout();
		const requests = rejectCheckout(403);
		const submission = view.cart.beginCheckout();
		await view.handleCartCheckout();
		expect(view.cart.checkoutSubmission()).toBe(submission);
		expect(view.sessionReads()).toBe(1);
		expect(requests).toHaveLength(1);
		expect(() => view.cart.removeItem(view.line.lineId)).toThrow();
	});

	it("keeps saved recovery evidence locked after an auth rejection on retry", async () => {
		const view = await mountCheckout();
		rejectCheckout(401);
		const retryable = { ...recovery, retryAllowed: true };
		view.cart.setCheckoutRecovery(retryable);
		await view.handleCartCheckout();
		expect(view.cart.checkoutRecovery()).toEqual(retryable);
		expect(view.cart.checkoutSubmission()).not.toBeNull();
		expect(view.sessionReads()).toBe(1);
		expect(() => view.cart.removeItem(view.line.lineId)).toThrow();
	});

	it("preserves recovery evidence supplied with an auth rejection", async () => {
		const view = await mountCheckout();
		rejectCheckout(403, recovery);
		await view.handleCartCheckout();
		expect(view.cart.checkoutRecovery()).toEqual(recovery);
		expect(view.cart.checkoutSubmission()).not.toBeNull();
		expect(view.sessionReads()).toBe(1);
		expect(() => view.cart.removeItem(view.line.lineId)).toThrow();
	});

	it("keeps an existing recovery locked after a status request is rejected", async () => {
		const view = await mountCheckout();
		rejectCheckout(403);
		const submission = view.cart.beginCheckout();
		view.cart.setCheckoutRecovery(recovery);
		await view.handleRefreshCheckout();
		expect(view.cart.checkoutRecovery()).toEqual(recovery);
		expect(view.cart.checkoutSubmission()).toBe(submission);
		expect(view.sessionReads()).toBe(1);
		expect(() => view.cart.removeItem(view.line.lineId)).toThrow();
	});
});
