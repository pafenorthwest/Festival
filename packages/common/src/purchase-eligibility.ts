import type {
	ClassEntitlement,
	ClassEntitlementStatus,
} from "./entitlements.js";
import type {
	FestivalClassConfiguration,
	RegistrationCatalogValue,
} from "./organization.js";
import type { RepertoirePiece } from "./registration.js";

export const ELIGIBILITY_REASON_CODES = [
	"AVAILABLE",
	"ALREADY_REGISTERED",
	"MISSING_PREREQUISITE",
	"REGISTRATION_CLOSED",
	"CLASS_NOT_AVAILABLE",
	"SOLD_OUT",
] as const;

export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];

export function isEligibilityReasonCode(
	value: unknown,
): value is EligibilityReasonCode {
	return (
		typeof value === "string" &&
		ELIGIBILITY_REASON_CODES.includes(value as EligibilityReasonCode)
	);
}

export interface SubtypeDependencyDescriptor {
	requiredSubtypeId: string;
	requiredSubtypeName?: string;
	divisionId?: string;
	minimumAge?: number;
	maximumAge?: number;
	classSubtypeId?: string;
	festivalClassId?: string;
}

export interface ProposedPurchaseLineItem {
	id?: string;
	childId: string;
	festivalClassId: string;
	teacherId?: string;
	accompanistId?: string | null;
	pieces?: RepertoirePiece[];
}

export interface ClassEligibilityResult {
	childId: string;
	festivalClassId: string;
	eligible: boolean;
	isEligible: boolean;
	reasonCode: EligibilityReasonCode;
	message?: string;
	dependencyDescriptor?: SubtypeDependencyDescriptor;
	missingPrerequisite?: SubtypeDependencyDescriptor;
	lineItemId?: string;
}

export interface EvaluatePurchaseEligibilityInput {
	organizationId: string;
	festivalId: string;
	items: ProposedPurchaseLineItem[];
	classes:
		| Map<string, FestivalClassConfiguration>
		| FestivalClassConfiguration[];
	subtypes: Map<string, RegistrationCatalogValue> | RegistrationCatalogValue[];
	activeEntitlements: ClassEntitlement[];
	isRegistrationOpen?: boolean;
}

export interface EvaluatePurchaseEligibilityResponse {
	isEligible: boolean;
	eligible: boolean;
	results: ClassEligibilityResult[];
	items: ClassEligibilityResult[];
}

export interface ClassCheckoutLineItemInput extends ProposedPurchaseLineItem {
	id?: string;
	festivalClassId: string;
	childId: string;
	teacherId: string;
	accompanistId?: string | null;
	pieces: RepertoirePiece[];
}

export interface StartMultiLineClassCheckoutInput {
	organizationId: string;
	festivalId?: string;
	festivalShortName?: string;
	customerId: string;
	sessionId: string;
	idempotencyKey: string;
	buyerAccessToken: string;
	integrationVersion?: string | number;
	items: ClassCheckoutLineItemInput[];
}

interface EvaluationContext {
	organizationId: string;
	festivalId: string;
	isRegistrationOpen: boolean;
	classesMap: Map<string, FestivalClassConfiguration>;
	subtypesMap: Map<string, RegistrationCatalogValue>;
	activeEntitlements: ClassEntitlement[];
	items: ProposedPurchaseLineItem[];
}

function normalizeClasses(
	classes:
		| Map<string, FestivalClassConfiguration>
		| FestivalClassConfiguration[],
): Map<string, FestivalClassConfiguration> {
	if (classes instanceof Map) return classes;
	const map = new Map<string, FestivalClassConfiguration>();
	for (const cls of classes) {
		map.set(cls.id, cls);
	}
	return map;
}

function normalizeSubtypes(
	subtypes: Map<string, RegistrationCatalogValue> | RegistrationCatalogValue[],
): Map<string, RegistrationCatalogValue> {
	if (subtypes instanceof Map) return subtypes;
	const map = new Map<string, RegistrationCatalogValue>();
	for (const sub of subtypes) {
		map.set(sub.id, sub);
	}
	return map;
}

function isActiveEntitlement(status: ClassEntitlementStatus): boolean {
	return status !== "cancelled" && status !== "revoked";
}

function matchesDivisionAndAge(
	candidate: FestivalClassConfiguration,
	target: FestivalClassConfiguration,
): boolean {
	return (
		candidate.divisionId === target.divisionId &&
		candidate.minimumAge === target.minimumAge &&
		candidate.maximumAge === target.maximumAge
	);
}

function hasEntitlementPrerequisite(
	targetClass: FestivalClassConfiguration,
	requiredSubtypeId: string,
	childId: string,
	ctx: EvaluationContext,
): boolean {
	return ctx.activeEntitlements.some((entitlement) => {
		if (
			entitlement.organizationId !== ctx.organizationId ||
			entitlement.festivalId !== ctx.festivalId ||
			entitlement.childId !== childId ||
			entitlement.status !== "confirmed"
		) {
			return false;
		}
		const prereqClass = ctx.classesMap.get(entitlement.festivalClassId);
		if (!prereqClass) return false;
		return (
			prereqClass.classSubtypeId === requiredSubtypeId &&
			matchesDivisionAndAge(prereqClass, targetClass)
		);
	});
}

function hasProposedItemPrerequisite(
	targetClass: FestivalClassConfiguration,
	requiredSubtypeId: string,
	childId: string,
	itemIndex: number,
	ctx: EvaluationContext,
): boolean {
	return ctx.items.some((otherItem, otherIndex) => {
		if (otherIndex === itemIndex || otherItem.childId !== childId) {
			return false;
		}
		const otherClass = ctx.classesMap.get(otherItem.festivalClassId);
		if (!otherClass?.isActive) return false;
		if (
			otherClass.organizationId !== ctx.organizationId ||
			otherClass.festivalId !== ctx.festivalId
		) {
			return false;
		}
		return (
			otherClass.classSubtypeId === requiredSubtypeId &&
			matchesDivisionAndAge(otherClass, targetClass)
		);
	});
}

function buildDependencyDescriptor(
	targetClass: FestivalClassConfiguration,
	requiredSubtypeId: string,
	ctx: EvaluationContext,
): SubtypeDependencyDescriptor {
	const requiredSubtype = ctx.subtypesMap.get(requiredSubtypeId);
	return {
		requiredSubtypeId,
		requiredSubtypeName: requiredSubtype?.displayName,
		divisionId: targetClass.divisionId,
		minimumAge: targetClass.minimumAge,
		maximumAge: targetClass.maximumAge,
		classSubtypeId: targetClass.classSubtypeId,
		festivalClassId: targetClass.id,
	};
}

function checkDuplicateRegistration(
	item: ProposedPurchaseLineItem,
	itemIndex: number,
	ctx: EvaluationContext,
): ClassEligibilityResult | null {
	const hasEntitlement = ctx.activeEntitlements.some(
		(e) =>
			e.childId === item.childId &&
			e.festivalClassId === item.festivalClassId &&
			isActiveEntitlement(e.status),
	);
	if (hasEntitlement) {
		return {
			childId: item.childId,
			festivalClassId: item.festivalClassId,
			eligible: false,
			isEligible: false,
			reasonCode: "ALREADY_REGISTERED",
			message: "Performer is already registered for this class.",
			...(item.id ? { lineItemId: item.id } : {}),
		};
	}

	const isDuplicateInItems = ctx.items
		.slice(0, itemIndex)
		.some(
			(prev) =>
				prev.childId === item.childId &&
				prev.festivalClassId === item.festivalClassId,
		);
	if (isDuplicateInItems) {
		return {
			childId: item.childId,
			festivalClassId: item.festivalClassId,
			eligible: false,
			isEligible: false,
			reasonCode: "ALREADY_REGISTERED",
			message:
				"Duplicate class registration for the same performer in this request.",
			...(item.id ? { lineItemId: item.id } : {}),
		};
	}
	return null;
}

function checkCapacitySoldOut(
	targetClass: FestivalClassConfiguration,
	item: ProposedPurchaseLineItem,
	itemIndex: number,
	ctx: EvaluationContext,
): ClassEligibilityResult | null {
	if (targetClass.capacity === undefined || targetClass.capacity === null) {
		return null;
	}
	const activeCount = ctx.activeEntitlements.filter(
		(e) =>
			e.festivalClassId === targetClass.id && isActiveEntitlement(e.status),
	).length;
	const itemsAheadCount = ctx.items
		.slice(0, itemIndex)
		.filter((prev) => prev.festivalClassId === targetClass.id).length;

	if (
		targetClass.capacity <= 0 ||
		activeCount + itemsAheadCount >= targetClass.capacity
	) {
		return {
			childId: item.childId,
			festivalClassId: item.festivalClassId,
			eligible: false,
			isEligible: false,
			reasonCode: "SOLD_OUT",
			message: "Class capacity is full.",
			...(item.id ? { lineItemId: item.id } : {}),
		};
	}
	return null;
}

function evaluateItemEligibility(
	item: ProposedPurchaseLineItem,
	itemIndex: number,
	ctx: EvaluationContext,
): ClassEligibilityResult {
	if (!ctx.isRegistrationOpen) {
		return {
			childId: item.childId,
			festivalClassId: item.festivalClassId,
			eligible: false,
			isEligible: false,
			reasonCode: "REGISTRATION_CLOSED",
			message: "Registration is closed for this festival.",
			...(item.id ? { lineItemId: item.id } : {}),
		};
	}

	const targetClass = ctx.classesMap.get(item.festivalClassId);
	if (
		!targetClass?.isActive ||
		targetClass.organizationId !== ctx.organizationId ||
		targetClass.festivalId !== ctx.festivalId
	) {
		return {
			childId: item.childId,
			festivalClassId: item.festivalClassId,
			eligible: false,
			isEligible: false,
			reasonCode: "CLASS_NOT_AVAILABLE",
			message: "Class is not available or inactive.",
			...(item.id ? { lineItemId: item.id } : {}),
		};
	}

	const duplicateResult = checkDuplicateRegistration(item, itemIndex, ctx);
	if (duplicateResult) return duplicateResult;

	const subtype = ctx.subtypesMap.get(targetClass.classSubtypeId);
	const requiredSubtypeId = subtype?.requiredSubtypeId?.trim();
	if (requiredSubtypeId) {
		const satisfiedByEntitlement = hasEntitlementPrerequisite(
			targetClass,
			requiredSubtypeId,
			item.childId,
			ctx,
		);
		const satisfiedByProposed = hasProposedItemPrerequisite(
			targetClass,
			requiredSubtypeId,
			item.childId,
			itemIndex,
			ctx,
		);
		if (!satisfiedByEntitlement && !satisfiedByProposed) {
			const descriptor = buildDependencyDescriptor(
				targetClass,
				requiredSubtypeId,
				ctx,
			);
			return {
				childId: item.childId,
				festivalClassId: item.festivalClassId,
				eligible: false,
				isEligible: false,
				reasonCode: "MISSING_PREREQUISITE",
				message: `Missing prerequisite: class requires subtype "${descriptor.requiredSubtypeName ?? requiredSubtypeId}" in the same division and age group.`,
				dependencyDescriptor: descriptor,
				missingPrerequisite: descriptor,
				...(item.id ? { lineItemId: item.id } : {}),
			};
		}
	}

	const soldOutResult = checkCapacitySoldOut(targetClass, item, itemIndex, ctx);
	if (soldOutResult) return soldOutResult;

	return {
		childId: item.childId,
		festivalClassId: item.festivalClassId,
		eligible: true,
		isEligible: true,
		reasonCode: "AVAILABLE",
		message: "Class is available for registration.",
		...(item.id ? { lineItemId: item.id } : {}),
	};
}

export function evaluatePurchaseEligibility(
	input: EvaluatePurchaseEligibilityInput,
): EvaluatePurchaseEligibilityResponse {
	const ctx: EvaluationContext = {
		organizationId: input.organizationId,
		festivalId: input.festivalId,
		isRegistrationOpen: input.isRegistrationOpen !== false,
		classesMap: normalizeClasses(input.classes),
		subtypesMap: normalizeSubtypes(input.subtypes),
		activeEntitlements: input.activeEntitlements,
		items: input.items,
	};

	const results = input.items.map((item, index) =>
		evaluateItemEligibility(item, index, ctx),
	);
	const isEligible =
		ctx.isRegistrationOpen &&
		results.every((r) => r.reasonCode === "AVAILABLE");

	return {
		isEligible,
		eligible: isEligible,
		results,
		items: results,
	};
}
