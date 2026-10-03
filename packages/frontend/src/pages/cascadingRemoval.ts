import type {
	ClassEligibilityResult,
	SubtypeDependencyDescriptor,
} from "@festival/common";
import type { RegistrationCartItem } from "./registrationCartState.js";

export type EligibilityLookupFn = (
	childId: string,
	classId: string,
) => ClassEligibilityResult | undefined;

export interface DirectDependencyContext {
	result?: ClassEligibilityResult;
	remainingItems: RegistrationCartItem[];
}

interface PrerequisiteCohort {
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
}

export function isSatisfiedByEntitlement(
	result: ClassEligibilityResult | undefined,
	requiredSubtypeId: string,
): boolean {
	if (!result?.satisfiedPrerequisites) return false;
	return result.satisfiedPrerequisites.some(
		(p) =>
			p.requiredSubtypeId === requiredSubtypeId &&
			p.satisfiedBy === "entitlement",
	);
}

export function getRequiredSubtypeId(
	candidate: RegistrationCartItem,
	result: ClassEligibilityResult | undefined,
): string | undefined {
	if (result?.satisfiedPrerequisites) {
		const found = result.satisfiedPrerequisites.find((p) =>
			Boolean(p.requiredSubtypeId),
		);
		if (found?.requiredSubtypeId) return found.requiredSubtypeId;
	}
	const desc = result?.dependencyDescriptor || result?.missingPrerequisite;
	if (desc?.requiredSubtypeId) return desc.requiredSubtypeId;
	const itemDesc = (
		candidate as { dependencyDescriptor?: SubtypeDependencyDescriptor }
	).dependencyDescriptor;
	return itemDesc?.requiredSubtypeId;
}

export function hasRemainingProvider(
	remainingItems: RegistrationCartItem[],
	childId: string,
	subtypeId: string,
	cohort?: PrerequisiteCohort,
): boolean {
	return remainingItems.some(
		(item) =>
			item.childId === childId &&
			item.classSubtypeId === subtypeId &&
			(!cohort || matchesCohort(item, cohort)),
	);
}

function prerequisiteCohort(
	candidate: RegistrationCartItem,
	result: ClassEligibilityResult | undefined,
): PrerequisiteCohort | undefined {
	const descriptor =
		result?.dependencyDescriptor ?? result?.missingPrerequisite;
	const divisionId = descriptor?.divisionId ?? candidate.divisionId;
	const minimumAge = descriptor?.minimumAge ?? candidate.minimumAge;
	const maximumAge = descriptor?.maximumAge ?? candidate.maximumAge;
	if (
		!divisionId ||
		typeof minimumAge !== "number" ||
		typeof maximumAge !== "number"
	) {
		return undefined;
	}
	return { divisionId, minimumAge, maximumAge };
}

function matchesCohort(
	provider: RegistrationCartItem,
	cohort: PrerequisiteCohort,
): boolean {
	return (
		provider.divisionId === cohort.divisionId &&
		provider.minimumAge === cohort.minimumAge &&
		provider.maximumAge === cohort.maximumAge
	);
}

export function isItemDirectlyDependent(
	candidate: RegistrationCartItem,
	provider: RegistrationCartItem,
	context: DirectDependencyContext,
): boolean {
	if (!provider.classSubtypeId || candidate.childId !== provider.childId) {
		return false;
	}
	const reqSubtypeId = getRequiredSubtypeId(candidate, context.result);
	if (!reqSubtypeId || reqSubtypeId !== provider.classSubtypeId) {
		return false;
	}
	const cohort = prerequisiteCohort(candidate, context.result);
	if (!cohort || !matchesCohort(provider, cohort)) {
		return false;
	}
	if (isSatisfiedByEntitlement(context.result, reqSubtypeId)) {
		return false;
	}
	return !hasRemainingProvider(
		context.remainingItems,
		candidate.childId,
		reqSubtypeId,
		cohort,
	);
}

export function findDependentCartItems(
	targetLineId: string,
	cartItems: RegistrationCartItem[],
	getResult?: EligibilityLookupFn,
): RegistrationCartItem[] {
	const target = cartItems.find((i) => i.lineId === targetLineId);
	if (!target?.classSubtypeId) return [];

	const removedIds = new Set<string>([target.lineId]);
	const dependents: RegistrationCartItem[] = [];
	const queue: RegistrationCartItem[] = [target];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current?.classSubtypeId) continue;

		const remaining = cartItems.filter((i) => !removedIds.has(i.lineId));
		const candidates = remaining.filter((i) => i.childId === current.childId);

		for (const candidate of candidates) {
			const result = getResult?.(candidate.childId, candidate.classId);
			const isDep = isItemDirectlyDependent(candidate, current, {
				result,
				remainingItems: remaining.filter((i) => i.lineId !== candidate.lineId),
			});
			if (isDep) {
				removedIds.add(candidate.lineId);
				dependents.push(candidate);
				queue.push(candidate);
			}
		}
	}

	return dependents;
}

export function hasDependentCartItems(
	targetLineId: string,
	cartItems: RegistrationCartItem[],
	getResult?: EligibilityLookupFn,
): boolean {
	return findDependentCartItems(targetLineId, cartItems, getResult).length > 0;
}
