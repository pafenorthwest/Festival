import type { CustomerSessionResponse } from "@festival/common";
import {
	batch,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
	type ParentProps,
	useContext,
} from "solid-js";
import { useFestivalShell } from "../../app/FestivalShellContext.js";
import type { FestivalAppController } from "../../app/useFestivalAppController.js";
import {
	getCustomerSession,
	getPendingClassCheckout,
	resumePendingClassCheckout,
} from "../../lib/api.js";
import { isOrganizationPageRoute } from "../../lib/routes.js";
import {
	createPendingCheckoutState,
	type PendingCheckoutDependencies,
} from "./pending-checkout-state.js";

export type CustomerSession = CustomerSessionResponse["session"];

export function createCustomerIdentityState(
	shell: Pick<FestivalAppController, "route" | "parentRegistration">,
	fetchSession = getCustomerSession,
	pendingDependencies: PendingCheckoutDependencies = {
		read: getPendingClassCheckout,
		resume: resumePendingClassCheckout,
	},
) {
	const unauthenticated: CustomerSession = { authenticated: false };
	const [customerSession, setCustomerSession] =
		createSignal<CustomerSession>(unauthenticated);
	const [isCustomerSessionLoading, setIsCustomerSessionLoading] =
		createSignal(false);
	let latestRequest = 0;
	let disposed = false;
	const pendingCheckout = createPendingCheckoutState(pendingDependencies);
	const activeOrgSlug = createMemo(() => {
		const r = shell.route();
		return isOrganizationPageRoute(r) && "slug" in r ? r.slug : null;
	});

	async function refreshCustomerSession(
		slugOverride?: string,
	): Promise<CustomerSession> {
		const targetSlug = activeOrgSlug();
		if (
			disposed ||
			(slugOverride !== undefined && slugOverride !== targetSlug)
		) {
			return unauthenticated;
		}
		const request = ++latestRequest;
		if (!targetSlug) {
			batch(() => {
				pendingCheckout.clear(true);
				setCustomerSession(unauthenticated);
				setIsCustomerSessionLoading(false);
			});
			return unauthenticated;
		}

		const isCurrentRequest = () =>
			!disposed && request === latestRequest && activeOrgSlug() === targetSlug;
		setIsCustomerSessionLoading(true);
		try {
			const { session } = await fetchSession(targetSlug);
			if (!isCurrentRequest()) return unauthenticated;
			batch(() => {
				if (session.authenticated) {
					shell.parentRegistration.bindSession(targetSlug, session.csrfToken);
					pendingCheckout.bindOwner(targetSlug, session.csrfToken);
					void pendingCheckout.refresh();
				} else {
					shell.parentRegistration.clear(targetSlug);
					pendingCheckout.clearOrganization(targetSlug);
				}
				setCustomerSession(session);
			});
			return session;
		} catch {
			if (isCurrentRequest()) {
				batch(() => {
					pendingCheckout.clear(true);
					setCustomerSession(unauthenticated);
				});
			}
			return unauthenticated;
		} finally {
			if (isCurrentRequest()) setIsCustomerSessionLoading(false);
		}
	}

	createEffect(
		on(activeOrgSlug, (slug) => {
			batch(() => {
				if (pendingCheckout.ownerSlug() !== slug) pendingCheckout.clear(true);
				setCustomerSession(unauthenticated);
				void refreshCustomerSession();
			});
		}),
	);
	let returnRefresh: Promise<unknown> | null = null;
	const refreshOnReturn = () => {
		if (
			disposed ||
			(typeof document !== "undefined" && document.visibilityState === "hidden")
		)
			return;
		if (!returnRefresh) {
			returnRefresh = refreshCustomerSession().finally(() => {
				returnRefresh = null;
			});
		}
	};
	if (typeof window !== "undefined") {
		window.addEventListener("pageshow", refreshOnReturn);
		window.addEventListener("focus", refreshOnReturn);
	}
	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", refreshOnReturn);
	}
	onCleanup(() => {
		disposed = true;
		pendingCheckout.clear();
		if (typeof window !== "undefined") {
			window.removeEventListener("pageshow", refreshOnReturn);
			window.removeEventListener("focus", refreshOnReturn);
		}
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", refreshOnReturn);
		}
	});

	return {
		customerSession,
		isCustomerSessionLoading,
		refreshCustomerSession,
		pendingCheckout,
	};
}

export type CustomerIdentityContextValue = ReturnType<
	typeof createCustomerIdentityState
>;

const CustomerIdentityContext = createContext<CustomerIdentityContextValue>();

export function CustomerIdentityProvider(props: ParentProps) {
	const value = createCustomerIdentityState(useFestivalShell());
	return (
		<CustomerIdentityContext.Provider value={value}>
			{props.children}
		</CustomerIdentityContext.Provider>
	);
}

export function useOptionalCustomerIdentity():
	| CustomerIdentityContextValue
	| undefined {
	return useContext(CustomerIdentityContext);
}

export function useCustomerIdentity(): CustomerIdentityContextValue {
	const context = useContext(CustomerIdentityContext);
	if (!context) {
		throw new Error(
			"useCustomerIdentity must be used within a CustomerIdentityProvider.",
		);
	}
	return context;
}
