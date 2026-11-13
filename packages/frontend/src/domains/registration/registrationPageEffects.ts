import { useBeforeLeave } from "@solidjs/router";
import { createEffect, createResource, onCleanup } from "solid-js";
import {
	discoverClassCheckoutRestart,
	getPublicDivisions,
	getPublicFestival,
	listCustomerClassRegistrations,
} from "../../lib/api.js";
import type { useRegistrationOptions } from "../../pages/festivalRegistrationHooks.js";
import type { RegistrationCart } from "./registrationPageActions.js";

const PURCHASED_HISTORY_TIMEOUT_MS = 5_000;

export function createRegistrationResources(
	slug: string,
	festivalSlug: string,
	authenticated: () => boolean,
) {
	const [festival] = createResource(
		() => [slug, festivalSlug] as const,
		([s, shortName]) => getPublicFestival(s, shortName),
	);
	const [divisions, { refetch: retryDivisions }] = createResource(
		() => slug,
		getPublicDivisions,
	);
	const [purchased] = createResource(
		() => (authenticated() ? ([slug, festivalSlug] as const) : false),
		async ([s, shortName]) => {
			const controller = new AbortController();
			const timer = setTimeout(
				() => controller.abort(),
				PURCHASED_HISTORY_TIMEOUT_MS,
			);
			try {
				return await listCustomerClassRegistrations(s, shortName, {
					signal: controller.signal,
				});
			} finally {
				clearTimeout(timer);
			}
		},
	);
	return { festival, divisions, retryDivisions, purchased };
}

export function setupRestartDiscoveryEffect(params: {
	view: () => "workspace" | "class" | "cart";
	authenticated: () => boolean;
	slug: string;
	festivalSlug: string;
	setDiscoveredRestart: (ref: string | null) => void;
}) {
	createEffect(() => {
		if (params.view() !== "cart" || !params.authenticated()) {
			params.setDiscoveredRestart(null);
			return;
		}
		let active = true;
		let request = 0;
		function discoverRestart() {
			const current = ++request;
			params.setDiscoveredRestart(null);
			void discoverClassCheckoutRestart(params.slug, params.festivalSlug)
				.then(({ recoveryReference }) => {
					if (active && request === current) {
						params.setDiscoveredRestart(recoveryReference);
					}
				})
				.catch(() => {});
		}
		function pageShow(event: PageTransitionEvent) {
			if (event.persisted) discoverRestart();
		}
		window.addEventListener("pageshow", pageShow);
		onCleanup(() => {
			active = false;
			window.removeEventListener("pageshow", pageShow);
		});
		discoverRestart();
	});
}

export function setupLeaveAndRedirectGuards(params: {
	view: () => "workspace" | "class" | "cart";
	authenticated: () => boolean;
	slug: string;
	registerPath: () => string;
	navigate: (path: string) => void;
	options: ReturnType<typeof useRegistrationOptions>;
	activeDraft: () => boolean;
	confirmDiscard: () => boolean;
	clearForm: () => void;
	isAdding: () => boolean;
	isSubmittingCheckout: () => boolean;
	isHandingOff: () => boolean;
	setAllowLeave: (val: boolean) => void;
	setCheckoutError: (err: string | null) => void;
}) {
	useBeforeLeave((event) => {
		if (params.isSubmittingCheckout()) {
			event.preventDefault();
			return;
		}
		if (!params.confirmDiscard()) event.preventDefault();
		else {
			params.setAllowLeave(false);
			params.clearForm();
		}
	});
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (
			!params.isHandingOff() &&
			(params.activeDraft() || params.isSubmittingCheckout())
		) {
			event.preventDefault();
			event.returnValue = "";
		}
	};
	const requestSignOut = (event: Event) => {
		if (params.isAdding() || params.isSubmittingCheckout()) {
			event.preventDefault();
			params.setCheckoutError(
				"Please wait for the registration request to finish before signing out.",
			);
			return;
		}
		if (!params.confirmDiscard()) event.preventDefault();
		else params.setAllowLeave(true);
	};
	window.addEventListener("beforeunload", beforeUnload);
	window.addEventListener("festival:request-sign-out", requestSignOut);
	onCleanup(() => {
		window.removeEventListener("beforeunload", beforeUnload);
		window.removeEventListener("festival:request-sign-out", requestSignOut);
	});
	createEffect(() => {
		if (
			params.view() !== "cart" &&
			params.authenticated() &&
			params.options.childrenLoaded() &&
			!params.options.childrenLoading() &&
			!params.options.childrenError() &&
			params.options.children().length === 0
		) {
			params.navigate(
				`/org/${params.slug}/account/children?returnTo=${encodeURIComponent(params.registerPath())}`,
			);
		}
	});
}

export function createCheckoutRestartRef(
	cart: RegistrationCart,
	festivalSlug: string,
	discoveredRestart: () => string | null,
) {
	return () => {
		const recovery = cart.checkoutRecovery();
		if (
			recovery?.festivalShortName &&
			recovery.festivalShortName !== festivalSlug
		) {
			return null;
		}
		const reference = recovery?.restartAllowed
			? recovery.recoveryReference
			: recovery || cart.checkoutSubmission()
				? null
				: discoveredRestart();
		return reference === cart.lastRestoredRecoveryReference()
			? null
			: reference;
	};
}
