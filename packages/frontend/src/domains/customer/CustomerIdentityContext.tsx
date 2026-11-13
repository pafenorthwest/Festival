import type { CustomerSessionResponse } from "@festival/common";
import {
	createContext,
	createEffect,
	createSignal,
	onCleanup,
	type ParentProps,
	useContext,
} from "solid-js";
import { useFestivalShell } from "../../app/FestivalShellContext.js";
import { getCustomerSession } from "../../lib/api.js";
import { isOrganizationPageRoute } from "../../lib/routes.js";

export type CustomerSession = CustomerSessionResponse["session"];

function createCustomerIdentityState() {
	const shell = useFestivalShell();
	const [customerSession, setCustomerSession] = createSignal<CustomerSession>({
		authenticated: false,
	});
	const [isCustomerSessionLoading, setIsCustomerSessionLoading] =
		createSignal(false);

	async function refreshCustomerSession(
		slugOverride?: string,
	): Promise<CustomerSession> {
		const targetSlug = slugOverride ?? shell.slug;
		if (!targetSlug) {
			const unauthenticated: CustomerSession = { authenticated: false };
			setCustomerSession(unauthenticated);
			setIsCustomerSessionLoading(false);
			return unauthenticated;
		}

		setIsCustomerSessionLoading(true);
		try {
			const response = await getCustomerSession(targetSlug);
			setCustomerSession(response.session);
			return response.session;
		} catch {
			const unauthenticated: CustomerSession = { authenticated: false };
			setCustomerSession(unauthenticated);
			return unauthenticated;
		} finally {
			setIsCustomerSessionLoading(false);
		}
	}

	createEffect(() => {
		const currentRoute = shell.route();
		if (!isOrganizationPageRoute(currentRoute)) {
			setCustomerSession({ authenticated: false });
			setIsCustomerSessionLoading(false);
			return;
		}

		let active = true;
		setCustomerSession({ authenticated: false });
		setIsCustomerSessionLoading(true);
		void getCustomerSession((currentRoute as { slug: string }).slug)
			.then((response) => {
				if (active) setCustomerSession(response.session);
			})
			.catch(() => {
				if (active) setCustomerSession({ authenticated: false });
			})
			.finally(() => {
				if (active) setIsCustomerSessionLoading(false);
			});
		onCleanup(() => {
			active = false;
		});
	});

	return {
		customerSession,
		isCustomerSessionLoading,
		refreshCustomerSession,
		setCustomerSession,
		setIsCustomerSessionLoading,
	};
}

export type CustomerIdentityContextValue = ReturnType<
	typeof createCustomerIdentityState
>;

const CustomerIdentityContext = createContext<CustomerIdentityContextValue>();

export function CustomerIdentityProvider(props: ParentProps) {
	const value = createCustomerIdentityState();
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
