import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { CustomerSessionResponse } from "@festival/common";
import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import { createCustomerIdentityState } from "../src/domains/customer/CustomerIdentityContext.js";
import { createParentRegistrationState } from "../src/lib/parent-registration-state.js";
import type { AppRoute } from "../src/lib/routes.js";

const slug = "org-alpha";
const otherSlug = "org-beta";
const festivalSlug = "spring-2027";

function authenticated(
	csrfToken: string,
	expiresAtIso = "2027-01-01T00:00:00.000Z",
): CustomerSessionResponse {
	return { session: { authenticated: true, csrfToken, expiresAtIso } };
}

const anonymous: CustomerSessionResponse = {
	session: { authenticated: false },
};

function mountScopeIdentity(
	initialRoute: AppRoute = { kind: "org-root", slug },
) {
	return createRoot((dispose) => {
		const parentRegistration = createParentRegistrationState();
		const [route, setRoute] = createSignal<AppRoute>(initialRoute);
		const requests: ReturnType<
			typeof Promise.withResolvers<CustomerSessionResponse>
		>[] = [];
		const fetchedSlugs: string[] = [];
		const checkoutReads: string[] = [];
		const identity = createCustomerIdentityState(
			{ route, parentRegistration },
			(targetSlug) => {
				fetchedSlugs.push(targetSlug);
				const request = Promise.withResolvers<CustomerSessionResponse>();
				requests.push(request);
				return request.promise;
			},
			{
				read: async (targetSlug) => {
					checkoutReads.push(targetSlug);
					return { checkout: null };
				},
				resume: async () => ({ checkoutUrl: "https://shop.example/checkout" }),
			},
		);
		const authTransitions: boolean[] = [];
		const isAuthenticated = createMemo(
			() => identity.customerSession().authenticated,
		);
		createEffect(() => {
			authTransitions.push(isAuthenticated());
		});
		return {
			...identity,
			setRoute,
			requests,
			fetchedSlugs,
			checkoutReads,
			authTransitions,
			dispose,
		};
	});
}

describe("customer identity organization session scope", () => {
	it("preserves an in-flight delayed session request across intra-org navigation", async () => {
		const view = mountScopeIdentity();
		try {
			expect(view.requests).toHaveLength(1);
			expect(view.isCustomerSessionLoading()).toBe(true);

			view.setRoute({ kind: "festival-register", slug, festivalSlug });
			view.setRoute({ kind: "festival-cart", slug, festivalSlug });

			expect(view.requests).toHaveLength(1);
			expect(view.fetchedSlugs).toEqual([slug]);
			expect(view.isCustomerSessionLoading()).toBe(true);

			const expected = authenticated("csrf-1");
			view.requests[0].resolve(expected);
			await Bun.sleep(0);

			expect(view.customerSession()).toEqual(expected.session);
			expect(view.isCustomerSessionLoading()).toBe(false);
			expect(view.checkoutReads).toEqual([slug]);
		} finally {
			view.dispose();
		}
	});

	it("navigates intra-org post-auth without unauthenticated flash or duplicate session/checkout reads", async () => {
		const view = mountScopeIdentity();
		try {
			view.requests[0].resolve(authenticated("csrf-1"));
			await Bun.sleep(0);
			expect(view.authTransitions).toEqual([false, true]);
			expect(view.checkoutReads).toEqual([slug]);

			const intraOrgRoutes: AppRoute[] = [
				{ kind: "festival-public", slug, festivalSlug },
				{ kind: "festival-register", slug, festivalSlug },
				{ kind: "festival-cart", slug, festivalSlug },
				{ kind: "org-customer-account-orders", slug },
			];
			for (const nextRoute of intraOrgRoutes) {
				view.setRoute(nextRoute);
				expect(view.customerSession().authenticated).toBe(true);
			}
			await Bun.sleep(0);

			expect(view.authTransitions).toEqual([false, true]);
			expect(view.requests).toHaveLength(1);
			expect(view.checkoutReads).toEqual([slug]);
		} finally {
			view.dispose();
		}
	});

	it("refreshes on focus/pageshow without flashing unauthenticated even when navigating intra-org mid-refresh", async () => {
		const originalWindow = globalThis.window;
		const events = new EventTarget();
		globalThis.window = events as Window & typeof globalThis;
		const view = mountScopeIdentity();
		try {
			view.requests[0].resolve(authenticated("csrf-1"));
			await Bun.sleep(0);
			expect(view.authTransitions).toEqual([false, true]);
			expect(view.checkoutReads).toEqual([slug]);

			events.dispatchEvent(new Event("focus"));
			events.dispatchEvent(new Event("pageshow"));
			expect(view.requests).toHaveLength(2);
			expect(view.customerSession().authenticated).toBe(true);
			expect(view.authTransitions).toEqual([false, true]);

			view.setRoute({ kind: "festival-cart", slug, festivalSlug });
			expect(view.requests).toHaveLength(2);
			expect(view.customerSession().authenticated).toBe(true);

			const refreshed = authenticated("csrf-1", "2027-02-01T00:00:00.000Z");
			view.requests[1].resolve(refreshed);
			await Bun.sleep(0);

			expect(view.customerSession()).toEqual(refreshed.session);
			expect(view.authTransitions).toEqual([false, true]);
			expect(view.checkoutReads).toEqual([slug, slug]);
		} finally {
			view.dispose();
			globalThis.window = originalWindow;
		}
	});

	it("resets on org switch, non-customer routes, and sign-out while dropping stale prior-org responses", async () => {
		const view = mountScopeIdentity();
		try {
			view.requests[0].resolve(authenticated("csrf-1"));
			await Bun.sleep(0);
			expect(view.customerSession().authenticated).toBe(true);

			const staleSlugRefresh = view.refreshCustomerSession();
			expect(view.requests).toHaveLength(2);

			view.setRoute({ kind: "org-root", slug: otherSlug });
			expect(view.customerSession()).toEqual({ authenticated: false });
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
			expect(view.requests).toHaveLength(3);

			view.requests[1].resolve(authenticated("stale-csrf-1"));
			await staleSlugRefresh;
			expect(view.customerSession()).toEqual({ authenticated: false });

			view.requests[2].resolve(authenticated("csrf-other"));
			await Bun.sleep(0);
			expect(view.customerSession()).toEqual(
				authenticated("csrf-other").session,
			);
			expect(view.pendingCheckout.ownerSlug()).toBe(otherSlug);

			view.setRoute({ kind: "home" });
			expect(view.customerSession()).toEqual({ authenticated: false });
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
			view.setRoute({ kind: "org-admin-users", slug: otherSlug });
			expect(view.customerSession()).toEqual({ authenticated: false });
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
			expect(view.fetchedSlugs).toEqual([slug, slug, otherSlug]);

			view.setRoute({ kind: "org-root", slug });
			view.requests[3].resolve(authenticated("csrf-2"));
			await Bun.sleep(0);
			const signOut = view.refreshCustomerSession();
			view.requests[4].resolve(anonymous);
			await signOut;
			expect(view.customerSession()).toEqual({ authenticated: false });
			expect(view.pendingCheckout.ownerSlug()).toBeNull();
		} finally {
			view.dispose();
		}
	});

	it("mounts ClassRegistrationProvider only on the registration route and not on checkout recovery", () => {
		const source = readFileSync(
			new URL("../src/app/AppRoutes.tsx", import.meta.url),
			"utf8",
		);
		expect(source.match(/<ClassRegistrationProvider\b/g)).toHaveLength(1);
		expect(source).toMatch(
			/function RegistrationLayout[\s\S]*?<ClassRegistrationProvider\b/,
		);
		expect(source).toMatch(
			/path="\/festival\/:festivalSlug\/register"\s+component=\{RegistrationLayout\}/,
		);

		const recoveryStart = source.indexOf('path="/checkout-recovery/:token"');
		expect(recoveryStart).toBeGreaterThan(-1);
		const tail = source.slice(recoveryStart);
		const boundary = tail.search(/<Route\b|<\/>/);
		const recoveryRoute = boundary === -1 ? tail : tail.slice(0, boundary);

		expect(recoveryRoute).toContain("Pages.CustomerCheckoutRecoveryPage");
		expect(recoveryRoute).not.toContain("ClassRegistrationProvider");
		expect(recoveryRoute).not.toContain("useParams");
	});
});
