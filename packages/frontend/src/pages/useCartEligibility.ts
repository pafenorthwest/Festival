import type {
	ClassEligibilityResult,
	ProposedPurchaseLineItem,
} from "@festival/common";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	onCleanup,
} from "solid-js";
import {
	type EvaluateRegistrationEligibilityResponse,
	evaluateRegistrationEligibility,
} from "../lib/api.js";
import {
	cartItemsToLineItemInputs,
	type RegistrationCartItem,
	type RegistrationCartState,
} from "./registrationCartState.js";

export function getEligibilityKey(childId: string, classId: string): string {
	return `${childId}:${classId}`;
}

export type CartEligibilityEvaluator = (
	slug: string,
	festivalSlug: string,
	items: ProposedPurchaseLineItem[],
	csrfToken?: string,
) => Promise<EvaluateRegistrationEligibilityResponse>;

export interface UseCartEligibilityOptions {
	slug: string | Accessor<string>;
	festivalSlug: string | Accessor<string>;
	csrfToken?: string | Accessor<string | undefined>;
	cart: RegistrationCartState;
	evaluator?: CartEligibilityEvaluator;
}

export interface CartEligibilityState {
	isEvaluating: Accessor<boolean>;
	error: Accessor<string | null>;
	results: Accessor<Map<string, ClassEligibilityResult>>;
	resultsMap: Accessor<Record<string, ClassEligibilityResult>>;
	getResult: (
		childId: string,
		classId: string,
	) => ClassEligibilityResult | undefined;
	isItemEligible: (childId: string, classId: string) => boolean | undefined;
	hasIneligibleItems: Accessor<boolean>;
	ineligibleCount: Accessor<number>;
	isCartEligible: Accessor<boolean>;
	recheck: () => Promise<void>;
}

export function useCartEligibility(
	options: UseCartEligibilityOptions,
): CartEligibilityState {
	const [isEvaluating, setIsEvaluating] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [results, setResults] = createSignal<
		Map<string, ClassEligibilityResult>
	>(new Map());

	let currentRequestId = 0;

	const resolveSlug = () =>
		typeof options.slug === "function" ? options.slug() : options.slug;
	const resolveFestivalSlug = () =>
		typeof options.festivalSlug === "function"
			? options.festivalSlug()
			: options.festivalSlug;
	const resolveCsrfToken = () =>
		typeof options.csrfToken === "function"
			? options.csrfToken()
			: options.csrfToken;

	async function performEvaluation(
		items: RegistrationCartItem[],
	): Promise<void> {
		const slug = resolveSlug();
		const festivalSlug = resolveFestivalSlug();
		const csrfToken = resolveCsrfToken();

		if (!slug || !festivalSlug || items.length === 0) {
			setResults(new Map());
			setError(null);
			setIsEvaluating(false);
			return;
		}

		const requestId = ++currentRequestId;
		setIsEvaluating(true);
		setError(null);

		try {
			const proposedItems = cartItemsToLineItemInputs(items);
			const evaluator = options.evaluator ?? evaluateRegistrationEligibility;
			const res = await evaluator(slug, festivalSlug, proposedItems, csrfToken);

			if (requestId !== currentRequestId) return;

			const map = new Map<string, ClassEligibilityResult>();
			for (const r of res.results) {
				map.set(getEligibilityKey(r.childId, r.festivalClassId), r);
			}

			setResults(map);
			setError(null);
		} catch (err) {
			if (requestId !== currentRequestId) return;
			setError(
				err instanceof Error
					? err.message
					: "Failed to evaluate class eligibility.",
			);
		} finally {
			if (requestId === currentRequestId) {
				setIsEvaluating(false);
			}
		}
	}

	createEffect(() => {
		const items = options.cart.items();
		void performEvaluation(items);
	});

	onCleanup(() => {
		currentRequestId++;
	});

	function getResult(
		childId: string,
		classId: string,
	): ClassEligibilityResult | undefined {
		return results().get(getEligibilityKey(childId, classId));
	}

	function isItemEligible(
		childId: string,
		classId: string,
	): boolean | undefined {
		const r = getResult(childId, classId);
		if (!r) return undefined;
		return (
			Boolean(r.isEligible) &&
			Boolean(r.eligible) &&
			r.reasonCode === "AVAILABLE"
		);
	}

	const hasIneligibleItems = createMemo(() => {
		const items = options.cart.items();
		if (items.length === 0) return false;
		const map = results();
		return items.some((item) => {
			const r = map.get(getEligibilityKey(item.childId, item.classId));
			return Boolean(
				r && (!r.isEligible || !r.eligible || r.reasonCode !== "AVAILABLE"),
			);
		});
	});

	const ineligibleCount = createMemo(() => {
		const items = options.cart.items();
		if (items.length === 0) return 0;
		const map = results();
		return items.filter((item) => {
			const r = map.get(getEligibilityKey(item.childId, item.classId));
			return Boolean(
				r && (!r.isEligible || !r.eligible || r.reasonCode !== "AVAILABLE"),
			);
		}).length;
	});

	const isCartEligible = createMemo(() => {
		const items = options.cart.items();
		if (items.length === 0) return false;
		if (isEvaluating() || error() || hasIneligibleItems()) return false;
		const map = results();
		return (
			items.length > 0 &&
			items.every((item) => {
				const r = map.get(getEligibilityKey(item.childId, item.classId));
				return Boolean(
					r?.isEligible && r.eligible && r.reasonCode === "AVAILABLE",
				);
			})
		);
	});

	const resultsMap = createMemo(() => {
		const map = results();
		const record: Record<string, ClassEligibilityResult> = {};
		for (const [key, value] of map.entries()) {
			record[key] = value;
		}
		return record;
	});

	return {
		isEvaluating,
		error,
		results,
		resultsMap,
		getResult,
		isItemEligible,
		hasIneligibleItems,
		ineligibleCount,
		isCartEligible,
		recheck: () => performEvaluation(options.cart.items()),
	};
}
