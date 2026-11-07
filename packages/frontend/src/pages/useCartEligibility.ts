import type { ClassEligibilityResult } from "@festival/common";
import { type Accessor, createEffect, createMemo } from "solid-js";
import {
	createEligibilityEvaluation,
	type EligibilityEvaluator,
} from "./createEligibilityEvaluation.js";
import {
	cartItemsToLineItemInputs,
	type RegistrationCartItem,
	type RegistrationCartState,
} from "./registrationCartState.js";

export function getEligibilityKey(childId: string, classId: string): string {
	return `${childId}:${classId}`;
}

export type CartEligibilityEvaluator = EligibilityEvaluator;

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
	const { isEvaluating, error, results, evaluate } =
		createEligibilityEvaluation(
			options,
			"Failed to evaluate class eligibility.",
		);

	function performEvaluation(items: RegistrationCartItem[]): Promise<void> {
		return evaluate(
			items.length > 0,
			() => cartItemsToLineItemInputs(items),
			(result) => getEligibilityKey(result.childId, result.festivalClassId),
		);
	}

	createEffect(() => {
		const items = options.cart.items();
		void performEvaluation(items);
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
