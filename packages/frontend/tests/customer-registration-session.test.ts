import { describe, expect, it } from "bun:test";
import type { CustomerSessionResponse } from "@festival/common";
import { createEffect, createRoot, createSignal, untrack } from "solid-js";
import { createCustomerIdentityState } from "../src/domains/customer/CustomerIdentityContext.js";
import {
	createParentRegistrationState,
	type ParentRegistrationWorkspace,
} from "../src/lib/parent-registration-state.js";
import type { AppRoute } from "../src/lib/routes.js";

const slug = "draft-session-test";
const otherSlug = "other-draft-session-test";
const festivalSlug = "spring";
const entry = {
	childId: "performer-1",
	childName: "Sample Performer",
	divisionId: "piano",
	divisionName: "Piano",
	teacherId: "teacher-1",
	teacherName: "Sample Teacher",
	classId: "solo",
	className: "Solo",
	priceCents: 4500,
	pieces: [{ title: "Minuet", composer: "Bach", durationSeconds: 90 }],
};

function authenticated(
	csrfToken: string,
	expiresAtIso = "2027-01-01T00:00:00.000Z",
): CustomerSessionResponse {
	return { session: { authenticated: true, csrfToken, expiresAtIso } };
}

const anonymous = { session: { authenticated: false } } as const;

function addDraft(workspace: ParentRegistrationWorkspace) {
	workspace.setChildId(entry.childId);
	workspace.setDivisionId(entry.divisionId);
	workspace.setTeacherId(entry.teacherId);
	workspace.cart.addItem(entry);
	return workspace.cart.beginCheckout();
}

function readDraft(workspace: ParentRegistrationWorkspace) {
	return {
		cartCount: workspace.cart.itemCount(),
		childId: workspace.childId(),
		divisionId: workspace.divisionId(),
		teacherId: workspace.teacherId(),
		checkout: workspace.cart.checkoutSubmission(),
	};
}

const emptyDraft = {
	cartCount: 0,
	childId: "",
	divisionId: "",
	teacherId: "",
	checkout: null,
};

function mountCustomerIdentity() {
	return createRoot((dispose) => {
		const parentRegistration = createParentRegistrationState();
		const workspace = parentRegistration.workspace(slug, festivalSlug);
		const otherWorkspace = parentRegistration.workspace(
			otherSlug,
			festivalSlug,
		);
		const [route, setRoute] = createSignal<AppRoute>({
			kind: "org-root",
			slug,
		});
		const requests: ReturnType<
			typeof Promise.withResolvers<CustomerSessionResponse>
		>[] = [];
		const identity = createCustomerIdentityState(
			{ route, parentRegistration },
			() => {
				const request = Promise.withResolvers<CustomerSessionResponse>();
				requests.push(request);
				return request.promise;
			},
			{
				read: async () => ({ checkout: null }),
				resume: async () => ({ checkoutUrl: "https://shop.example/checkout" }),
			},
		);
		const observed: Array<{
			csrfToken: string;
			draft: ReturnType<typeof readDraft>;
		}> = [];
		createEffect(() => {
			const session = identity.customerSession();
			if (session.authenticated) {
				observed.push({
					csrfToken: session.csrfToken,
					draft: untrack(() => readDraft(workspace)),
				});
			}
		});
		return {
			...identity,
			setRoute,
			requests,
			workspace,
			otherWorkspace,
			observed,
			dispose,
		};
	});
}

describe("customer session registration drafts", () => {
	it("clears only the captured submitted lines after returning through home and another organization", async () => {
		const view = mountCustomerIdentity();
		try {
			view.requests[0].resolve(authenticated("session-a"));
			await Bun.sleep(0);
			const submitted = addDraft(view.workspace);
			view.pendingCheckout.markHandoff("spring:submitted-a", () => {
				view.workspace.cart.completeCheckout(submitted);
			});
			view.setRoute({ kind: "home" });
			await Bun.sleep(0);
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
			expect(view.pendingCheckout.checkout()).toBeNull();
			expect(view.workspace.cart.checkoutSubmission()).toBe(submitted);
			view.setRoute({ kind: "org-root", slug: otherSlug });
			view.requests[1].resolve(authenticated("session-b"));
			await Bun.sleep(0);
			const otherSubmitted = addDraft(view.otherWorkspace);
			view.pendingCheckout.markHandoff("spring:submitted-b", () => {
				view.otherWorkspace.cart.completeCheckout(otherSubmitted);
			});
			view.setRoute({ kind: "org-root", slug });
			view.requests[2].resolve(authenticated("session-a"));
			await Bun.sleep(0);
			expect(view.workspace.cart.itemCount()).toBe(0);
			expect(view.workspace.cart.checkoutSubmission()).toBeNull();
			expect(view.otherWorkspace.cart.itemCount()).toBe(1);
			expect(view.otherWorkspace.cart.checkoutSubmission()).toBe(
				otherSubmitted,
			);
			view.setRoute({ kind: "org-root", slug: otherSlug });
			view.requests[3].resolve(authenticated("session-b"));
			await Bun.sleep(0);
			expect(view.otherWorkspace.cart.itemCount()).toBe(0);
			expect(view.otherWorkspace.cart.checkoutSubmission()).toBeNull();
		} finally {
			view.dispose();
		}
	});

	it("invalidates a changed account's handoff while preserving the other organization's submitted draft", async () => {
		const view = mountCustomerIdentity();
		let oldCompletions = 0;
		try {
			view.requests[0].resolve(authenticated("session-a"));
			await Bun.sleep(0);
			const submitted = addDraft(view.workspace);
			view.pendingCheckout.markHandoff("spring:old-owner", () => {
				oldCompletions++;
				view.workspace.cart.completeCheckout(submitted);
			});
			view.setRoute({ kind: "org-root", slug: otherSlug });
			view.requests[1].resolve(authenticated("session-b"));
			await Bun.sleep(0);
			const otherSubmitted = addDraft(view.otherWorkspace);
			view.pendingCheckout.markHandoff("spring:other-owner", () => {
				view.otherWorkspace.cart.completeCheckout(otherSubmitted);
			});
			view.setRoute({ kind: "org-root", slug });
			view.requests[2].resolve(authenticated("new-owner-session-a"));
			await Bun.sleep(0);
			expect(oldCompletions).toBe(0);
			expect(readDraft(view.workspace)).toEqual(emptyDraft);
			const newOwnerDraft = addDraft(view.workspace);
			await view.pendingCheckout.refresh();
			expect(oldCompletions).toBe(0);
			expect(view.workspace.cart.checkoutSubmission()).toBe(newOwnerDraft);
			expect(view.workspace.cart.itemCount()).toBe(1);
			expect(view.otherWorkspace.cart.checkoutSubmission()).toBe(
				otherSubmitted,
			);
			view.setRoute({ kind: "org-root", slug: otherSlug });
			view.requests[3].resolve(authenticated("session-b"));
			await Bun.sleep(0);
			expect(view.otherWorkspace.cart.itemCount()).toBe(0);
			expect(view.workspace.cart.checkoutSubmission()).toBe(newOwnerDraft);
		} finally {
			view.dispose();
		}
	});

	it("starts checkout verification before publishing the authenticated customer", async () => {
		const pending = Promise.withResolvers<{ checkout: null }>();
		let blockedWhenPublished: boolean | undefined;
		const view = createRoot((dispose) => {
			const parentRegistration = createParentRegistrationState();
			const [route] = createSignal<AppRoute>({ kind: "org-root", slug });
			const identity = createCustomerIdentityState(
				{ route, parentRegistration },
				async () => authenticated("session-a"),
				{
					read: async () => pending.promise,
					resume: async () => ({
						checkoutUrl: "https://shop.example/checkout",
					}),
				},
			);
			createEffect(() => {
				if (identity.customerSession().authenticated) {
					blockedWhenPublished = untrack(identity.pendingCheckout.isBlocked);
				}
			});
			return { ...identity, dispose };
		});
		try {
			await Bun.sleep(0);
			expect(blockedWhenPublished).toBe(true);
			expect(view.pendingCheckout.isChecking()).toBe(true);
			pending.resolve({ checkout: null });
			await view.pendingCheckout.refresh();
			expect(view.pendingCheckout.isBlocked()).toBe(false);
		} finally {
			view.dispose();
		}
	});

	it("coalesces browser return events and clears private checkout data on confirmed sign-out", async () => {
		const originalWindow = globalThis.window;
		const events = new EventTarget();
		globalThis.window = events as Window & typeof globalThis;
		let sessionReads = 0;
		let checkoutReads = 0;
		let session: CustomerSessionResponse = authenticated("session-a");
		const view = createRoot((dispose) => {
			const parentRegistration = createParentRegistrationState();
			const [route] = createSignal<AppRoute>({ kind: "org-root", slug });
			return {
				...createCustomerIdentityState(
					{ route, parentRegistration },
					async () => {
						sessionReads++;
						return session;
					},
					{
						read: async () => {
							checkoutReads++;
							return {
								checkout: {
									state: "partially_paid" as const,
									recoveryReference: "reference",
									festivalShortName: festivalSlug,
									registrationCount: 1,
									registrations: [],
									resumeAllowed: false,
									reasonCode: "partially_paid",
									verifiedAtIso: "2026-11-15T12:00:00.000Z",
								},
							};
						},
						resume: async () => ({
							checkoutUrl: "https://shop.example/checkout",
						}),
					},
				),
				dispose,
			};
		});
		try {
			await Bun.sleep(0);
			expect(checkoutReads).toBe(1);
			events.dispatchEvent(new Event("focus"));
			events.dispatchEvent(new Event("pageshow"));
			events.dispatchEvent(new Event("focus"));
			await Bun.sleep(0);
			expect(sessionReads).toBe(2);
			expect(checkoutReads).toBe(2);
			expect(view.pendingCheckout.checkout()?.state).toBe("partially_paid");
			session = anonymous;
			events.dispatchEvent(new Event("focus"));
			await Bun.sleep(0);
			expect(view.customerSession().authenticated).toBe(false);
			expect(view.pendingCheckout.checkout()).toBeNull();
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
		} finally {
			view.dispose();
			globalThis.window = originalWindow;
		}
	});

	it("preserves a same-session refresh and clears the draft before publishing a replacement session", async () => {
		const view = mountCustomerIdentity();
		try {
			view.requests[0].resolve(authenticated("session-a"));
			await Bun.sleep(0);
			expect(view.customerSession().authenticated).toBe(true);
			const checkout = addDraft(view.workspace);
			addDraft(view.otherWorkspace);
			const existingDraft = readDraft(view.workspace);
			const otherDraft = readDraft(view.otherWorkspace);

			const refreshed = authenticated("session-a", "2027-01-02T00:00:00.000Z");
			const refresh = view.refreshCustomerSession();
			view.requests[1].resolve(refreshed);
			await refresh;
			expect(view.customerSession()).toEqual(refreshed.session);
			expect(readDraft(view.workspace)).toEqual(existingDraft);
			expect(view.workspace.cart.getCheckoutIdempotencyKey()).toBe(
				checkout.idempotencyKey,
			);

			view.setRoute({ kind: "festival-cart", slug, festivalSlug });
			expect(view.requests).toHaveLength(2);
			expect(view.customerSession().authenticated).toBe(true);
			const replacement = view.refreshCustomerSession();
			view.requests[2].resolve(authenticated("session-b"));
			await replacement;
			expect(view.observed.at(-1)).toEqual({
				csrfToken: "session-b",
				draft: emptyDraft,
			});
			expect(readDraft(view.workspace)).toEqual(emptyDraft);
			expect(readDraft(view.otherWorkspace)).toEqual(otherDraft);
			expect(addDraft(view.workspace).idempotencyKey).not.toBe(
				checkout.idempotencyKey,
			);
		} finally {
			view.dispose();
		}
	});

	it("clears on a confirmed anonymous session and ignores stale or failed reads", async () => {
		const view = mountCustomerIdentity();
		try {
			view.requests[0].resolve(authenticated("session-a"));
			await Bun.sleep(0);
			addDraft(view.workspace);
			const existingDraft = readDraft(view.workspace);

			view.setRoute({ kind: "festival-cart", slug, festivalSlug });
			expect(view.requests).toHaveLength(1);
			const staleRead = view.refreshCustomerSession();
			const refresh = view.refreshCustomerSession();
			view.requests[2].resolve(authenticated("session-a"));
			await refresh;
			view.requests[1].resolve(anonymous);
			await staleRead;
			expect(readDraft(view.workspace)).toEqual(existingDraft);
			expect(view.customerSession()).toEqual(
				authenticated("session-a").session,
			);

			const unavailable = view.refreshCustomerSession();
			view.requests[3].reject(new Error("Connection lost"));
			await unavailable;
			expect(readDraft(view.workspace)).toEqual(existingDraft);

			const signedOut = view.refreshCustomerSession();
			view.requests[4].resolve(anonymous);
			await signedOut;
			expect(readDraft(view.workspace)).toEqual(emptyDraft);
			expect(view.customerSession()).toEqual(anonymous.session);
		} finally {
			view.dispose();
		}
	});
});
