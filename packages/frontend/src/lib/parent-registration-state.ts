import { type Accessor, createSignal, type Setter } from "solid-js";
import {
	createRegistrationCart,
	type RegistrationCartState,
} from "../pages/registrationCartState.js";
import {
	clearCartCheckoutIdempotencyKey,
	getOrCreateCartCheckoutIdempotencyKey,
} from "../pages/checkoutIdempotency.js";

export {
	clearCartCheckoutIdempotencyKey,
	getOrCreateCartCheckoutIdempotencyKey,
};

export interface ParentRegistrationWorkspace {
	cart: RegistrationCartState;
	childId: Accessor<string>;
	setChildId: Setter<string>;
	divisionId: Accessor<string>;
	setDivisionId: Setter<string>;
	teacherId: Accessor<string>;
	setTeacherId: Setter<string>;
}

/** Parent navigation state lives only for this application instance. */
export function createParentRegistrationState() {
	const workspaces = new Map<string, ParentRegistrationWorkspace>();
	const sessionTokens = new Map<string, string>();
	const [activeFestivals, setActiveFestivals] = createSignal<
		Record<string, string>
	>({});

	function workspace(slug: string, festivalSlug: string) {
		const key = JSON.stringify([slug, festivalSlug]);
		let current = workspaces.get(key);
		if (!current) {
			const [childId, setChildId] = createSignal("");
			const [divisionId, setDivisionId] = createSignal("");
			const [teacherId, setTeacherId] = createSignal("");
			current = {
				cart: createRegistrationCart([], { slug, festivalSlug }),
				childId,
				setChildId,
				divisionId,
				setDivisionId,
				teacherId,
				setTeacherId,
			};
			workspaces.set(key, current);
		}
		return current;
	}

	function clear(slug?: string) {
		for (const [key, current] of workspaces) {
			const [organizationSlug] = JSON.parse(key) as [string, string];
			if (slug && slug !== organizationSlug) continue;
			current.cart.clearCart();
			current.setChildId("");
			current.setDivisionId("");
			current.setTeacherId("");
		}
		if (slug) sessionTokens.delete(slug);
		else sessionTokens.clear();
	}

	function bindSession(slug: string, csrfToken: string) {
		const previousToken = sessionTokens.get(slug);
		if (previousToken && previousToken !== csrfToken) clear(slug);
		sessionTokens.set(slug, csrfToken);
	}

	return {
		workspace,
		activeFestival: (slug: string) =>
			Object.hasOwn(activeFestivals(), slug) ? activeFestivals()[slug] : null,
		setActiveFestival: (slug: string, festivalSlug: string) => {
			if (activeFestivals()[slug] === festivalSlug) return;
			setActiveFestivals((current) => ({ ...current, [slug]: festivalSlug }));
		},
		clear,
		bindSession,
	};
}

export type ParentRegistrationState = ReturnType<
	typeof createParentRegistrationState
>;
