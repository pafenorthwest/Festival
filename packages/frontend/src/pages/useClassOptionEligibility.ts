import type {
	ClassEligibilityResult,
	EligibilityReasonCode,
	ProposedPurchaseLineItem,
	RegistrationEligibleClass,
} from "@festival/common";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { evaluateRegistrationEligibility } from "../lib/api.js";
import { formatClassOption } from "./festivalRegistrationHelpers.js";
import {
	cartItemsToLineItemInputs,
	type RegistrationCartItem,
	type RegistrationCartState,
} from "./registrationCartState.js";
import type { CartEligibilityEvaluator } from "./useCartEligibility.js";

export type OptionEligibilityReasonCode =
	| EligibilityReasonCode
	| "IN_CART"
	| "AVAILABLE";

export interface ClassOptionEligibilityInfo {
	classId: string;
	isEligible: boolean;
	reasonCode: OptionEligibilityReasonCode;
	reasonText: string;
	badgeText: string;
	formattedOption: string;
}

export interface UseClassOptionEligibilityOptions {
	slug: string | Accessor<string>;
	festivalSlug: string | Accessor<string>;
	csrfToken?: string | Accessor<string | undefined>;
	childId: Accessor<string>;
	classes: Accessor<RegistrationEligibleClass[]>;
	cart: RegistrationCartState;
	evaluator?: CartEligibilityEvaluator;
}

export interface ClassOptionEligibilityState {
	isEvaluating: Accessor<boolean>;
	error: Accessor<string | null>;
	getOption: (classId: string) => ClassOptionEligibilityInfo | undefined;
	isEligible: (classId: string) => boolean;
	formatOption: (cls: RegistrationEligibleClass) => string;
	selectedReason: (classId: string) => string | null;
	recheck: () => Promise<void>;
}

export function useClassOptionEligibility(
	options: UseClassOptionEligibilityOptions,
): ClassOptionEligibilityState {
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
		currentChildId: string,
		classList: RegistrationEligibleClass[],
		cartItems: RegistrationCartItem[],
	): Promise<void> {
		const slug = resolveSlug();
		const festivalSlug = resolveFestivalSlug();
		const csrfToken = resolveCsrfToken();

		if (!slug || !festivalSlug || !currentChildId || classList.length === 0) {
			setResults(new Map());
			setError(null);
			setIsEvaluating(false);
			return;
		}

		const requestId = ++currentRequestId;
		setIsEvaluating(true);
		setError(null);

		try {
			const cartLineInputs = cartItemsToLineItemInputs(cartItems);
			const candidateItems: ProposedPurchaseLineItem[] = classList.map((c) => ({
				id: `candidate:${c.id}`,
				childId: currentChildId,
				festivalClassId: c.id,
				isCandidate: true,
			}));

			const batchItems: ProposedPurchaseLineItem[] = [
				...cartLineInputs,
				...candidateItems,
			];

			const evaluator = options.evaluator ?? evaluateRegistrationEligibility;
			const res = await evaluator(slug, festivalSlug, batchItems, csrfToken);

			if (requestId !== currentRequestId) return;

			const map = new Map<string, ClassEligibilityResult>();
			for (const r of res.results) {
				if (r.childId === currentChildId) {
					const key = r.lineItemId?.startsWith("candidate:")
						? r.lineItemId.slice("candidate:".length)
						: r.festivalClassId;
					map.set(key, r);
				}
			}
			setResults(map);
			setError(null);
		} catch (err) {
			if (requestId !== currentRequestId) return;
			setError(
				err instanceof Error
					? err.message
					: "Failed to evaluate class option eligibility.",
			);
		} finally {
			if (requestId === currentRequestId) {
				setIsEvaluating(false);
			}
		}
	}

	createEffect(() => {
		const cid = options.childId();
		const classList = options.classes();
		const cartItems = options.cart.items();
		void performEvaluation(cid, classList, cartItems);
	});

	onCleanup(() => {
		currentRequestId++;
	});

	function getOption(classId: string): ClassOptionEligibilityInfo | undefined {
		if (!classId) return undefined;
		const classList = options.classes();
		const cls = classList.find((c) => c.id === classId);
		if (!cls) return undefined;

		const cid = options.childId();
		const inCart = Boolean(cid && options.cart.hasItem(cid, classId));
		if (inCart) {
			const base = formatClassOption(cls);
			return {
				classId,
				isEligible: false,
				reasonCode: "IN_CART",
				reasonText: "Already in cart",
				badgeText: "Already in cart",
				formattedOption: `${base} (Already in cart)`,
			};
		}

		const serverResult = results().get(classId);
		if (!serverResult) {
			const base = formatClassOption(cls);
			return {
				classId,
				isEligible: true,
				reasonCode: "AVAILABLE",
				reasonText: "",
				badgeText: "",
				formattedOption: base,
			};
		}

		const isEligible = Boolean(
			serverResult.isEligible &&
				serverResult.eligible &&
				serverResult.reasonCode === "AVAILABLE",
		);

		let reasonText = "";
		if (!isEligible) {
			if (serverResult.reasonCode === "MISSING_PREREQUISITE") {
				const prereqName =
					serverResult.missingPrerequisite?.requiredSubtypeName ||
					serverResult.dependencyDescriptor?.requiredSubtypeName ||
					"prerequisite";
				reasonText = `Requires ${prereqName} in cart or completed registration`;
			} else if (serverResult.reasonCode === "ALREADY_REGISTERED") {
				reasonText = "Already registered";
			} else if (serverResult.reasonCode === "SOLD_OUT") {
				reasonText = "Capacity full / Sold out";
			} else if (serverResult.reasonCode === "REGISTRATION_CLOSED") {
				reasonText = "Registration closed";
			} else {
				reasonText = serverResult.message || "Not available";
			}
		}

		const base = formatClassOption(cls);
		const formattedOption = isEligible ? base : `${base} (${reasonText})`;

		return {
			classId,
			isEligible,
			reasonCode: serverResult.reasonCode,
			reasonText,
			badgeText: reasonText,
			formattedOption,
		};
	}

	function isEligible(classId: string): boolean {
		if (!classId) return false;
		const opt = getOption(classId);
		return opt ? opt.isEligible : true;
	}

	function selectedReason(classId: string): string | null {
		if (!classId) return null;
		const opt = getOption(classId);
		return opt && !opt.isEligible ? opt.reasonText : null;
	}

	function formatOption(cls: RegistrationEligibleClass): string {
		const opt = getOption(cls.id);
		return opt ? opt.formattedOption : formatClassOption(cls);
	}

	return {
		isEvaluating,
		error,
		getOption,
		isEligible,
		formatOption,
		selectedReason,
		recheck: () =>
			performEvaluation(
				options.childId(),
				options.classes(),
				options.cart.items(),
			),
	};
}
