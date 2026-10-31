import type {
	EligibilityReasonCode,
	ProposedPurchaseLineItem,
	RegistrationEligibleClass,
} from "@festival/common";
import { type Accessor, createEffect } from "solid-js";
import { createEligibilityEvaluation } from "./createEligibilityEvaluation.js";
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
	isWaitlist: (classId: string | undefined) => boolean;
	formatOption: (cls: RegistrationEligibleClass) => string;
	selectedReason: (classId: string) => string | null;
	recheck: () => Promise<void>;
}

export function useClassOptionEligibility(
	options: UseClassOptionEligibilityOptions,
): ClassOptionEligibilityState {
	const { isEvaluating, error, results, evaluate } =
		createEligibilityEvaluation(
			options,
			"Failed to evaluate class option eligibility.",
		);

	function performEvaluation(
		currentChildId: string,
		classList: RegistrationEligibleClass[],
		cartItems: RegistrationCartItem[],
	): Promise<void> {
		return evaluate(
			Boolean(currentChildId && classList.length > 0),
			() => {
				const cartLineInputs = cartItemsToLineItemInputs(cartItems);
				const candidateItems: ProposedPurchaseLineItem[] = classList.map(
					(c) => ({
						id: `candidate:${c.id}`,
						childId: currentChildId,
						festivalClassId: c.id,
						isCandidate: true,
					}),
				);
				return [...cartLineInputs, ...candidateItems];
			},
			(result) => {
				if (result.childId !== currentChildId) return undefined;
				return result.lineItemId?.startsWith("candidate:")
					? result.lineItemId.slice("candidate:".length)
					: result.festivalClassId;
			},
		);
	}

	createEffect(() => {
		const cid = options.childId();
		const classList = options.classes();
		const cartItems = options.cart.items();
		void performEvaluation(cid, classList, cartItems);
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

		if (isWaitlist(classId)) {
			const base = formatClassOption(cls);
			return {
				classId,
				isEligible: false,
				reasonCode: "SOLD_OUT",
				reasonText: "Waitlist",
				badgeText: "Waitlist",
				formattedOption: `${base} [Waitlist]`,
			};
		}

		if (cls.isRegistrationOpen === false) {
			const base = formatClassOption(cls);
			return {
				classId,
				isEligible: false,
				reasonCode: "REGISTRATION_CLOSED",
				reasonText: "Registration closed",
				badgeText: "Registration closed",
				formattedOption: `${base} (Registration closed)`,
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

	function isWaitlist(classId: string | undefined): boolean {
		if (!classId) return false;
		const classList = options.classes();
		const cls = classList.find((c) => c.id === classId);
		const serverResult = results().get(classId);
		if (
			serverResult &&
			!serverResult.eligible &&
			serverResult.reasonCode !== "SOLD_OUT" &&
			serverResult.availability !== "waitlist"
		) {
			return false;
		}
		return (
			cls?.availability === "waitlist" ||
			serverResult?.availability === "waitlist" ||
			serverResult?.reasonCode === "SOLD_OUT"
		);
	}

	function isEligible(classId: string): boolean {
		if (!classId) return false;
		const opt = getOption(classId);
		return opt ? opt.isEligible : true;
	}

	function selectedReason(classId: string): string | null {
		if (!classId || isWaitlist(classId)) return null;
		const opt = getOption(classId);
		return opt && !opt.isEligible ? opt.reasonText : null;
	}

	function formatOption(cls: RegistrationEligibleClass): string {
		const base = formatClassOption(cls);
		if (isWaitlist(cls.id)) {
			return `${base} [Waitlist]`;
		}
		const opt = getOption(cls.id);
		if (opt) return opt.formattedOption;
		return cls.isRegistrationOpen === false
			? `${base} (Registration closed)`
			: base;
	}

	return {
		isEvaluating,
		error,
		getOption,
		isEligible,
		isWaitlist,
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
