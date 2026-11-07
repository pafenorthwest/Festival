import type {
	ClassEligibilityResult,
	ProposedPurchaseLineItem,
} from "@festival/common";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import {
	type EvaluateRegistrationEligibilityResponse,
	evaluateRegistrationEligibility,
} from "../lib/api.js";

export type EligibilityEvaluator = (
	slug: string,
	festivalSlug: string,
	items: ProposedPurchaseLineItem[],
	csrfToken?: string,
) => Promise<EvaluateRegistrationEligibilityResponse>;

interface EligibilityEvaluationOptions {
	slug: string | Accessor<string>;
	festivalSlug: string | Accessor<string>;
	csrfToken?: string | Accessor<string | undefined>;
	evaluator?: EligibilityEvaluator;
}

function resolveOption(
	value: string | undefined | Accessor<string | undefined>,
) {
	return typeof value === "function" ? value() : value;
}

export function createEligibilityEvaluation(
	options: EligibilityEvaluationOptions,
	errorMessage: string,
) {
	const [isEvaluating, setIsEvaluating] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [results, setResults] = createSignal<
		Map<string, ClassEligibilityResult>
	>(new Map());
	let currentRequestId = 0;

	onCleanup(() => currentRequestId++);

	async function evaluate(
		ready: boolean,
		buildItems: () => ProposedPurchaseLineItem[],
		resultKey: (result: ClassEligibilityResult) => string | undefined,
	): Promise<void> {
		const slug = resolveOption(options.slug);
		const festivalSlug = resolveOption(options.festivalSlug);
		const csrfToken = resolveOption(options.csrfToken);
		// Empty inputs must also invalidate an in-flight evaluation.
		const requestId = ++currentRequestId;

		if (!slug || !festivalSlug || !ready) {
			setResults(new Map());
			setError(null);
			setIsEvaluating(false);
			return;
		}

		setIsEvaluating(true);
		setError(null);
		try {
			const items = buildItems();
			const evaluator = options.evaluator ?? evaluateRegistrationEligibility;
			const response = await evaluator(slug, festivalSlug, items, csrfToken);
			if (requestId !== currentRequestId) return;

			const map = new Map<string, ClassEligibilityResult>();
			for (const result of response.results) {
				const key = resultKey(result);
				if (key !== undefined) map.set(key, result);
			}
			setResults(map);
			setError(null);
		} catch (err) {
			if (requestId !== currentRequestId) return;
			setError(err instanceof Error ? err.message : errorMessage);
		} finally {
			if (requestId === currentRequestId) setIsEvaluating(false);
		}
	}

	return { isEvaluating, error, results, evaluate };
}
