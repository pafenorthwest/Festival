import { describe, expect, it } from "bun:test";
import type {
	ClassEntitlement,
	FestivalClassConfiguration,
	RegistrationCatalogValue,
} from "../src/index.js";
import {
	evaluatePurchaseEligibility,
	isCandidateLineItem,
	stripCandidateMarker,
} from "../src/purchase-eligibility.js";

const ORG_ID = "org-1";
const FESTIVAL_ID = "fest-1";
const DIVISION_ID = "div-piano";
const SUBTYPE_SOLO = "subtype-solo";
const SUBTYPE_MASTERCLASS = "subtype-masterclass";

function createSubtype(
	id: string,
	displayName: string,
	requiredSubtypeId?: string,
): RegistrationCatalogValue {
	return {
		id,
		type: "class_subtype",
		code: id,
		displayName,
		organizationId: ORG_ID,
		requiredSubtypeId: requiredSubtypeId ?? null,
		isActive: true,
		sortOrder: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

function createClass(
	id: string,
	classSubtypeId: string,
	overrides: Partial<FestivalClassConfiguration> = {},
): FestivalClassConfiguration {
	return {
		id,
		organizationId: ORG_ID,
		festivalId: FESTIVAL_ID,
		divisionId: DIVISION_ID,
		classSubtypeId,
		displayName: `Class ${id}`,
		price: "50.00",
		minimumAge: 6,
		maximumAge: 18,
		isActive: true,
		maximumPerformancePieces: 1,
		sortOrder: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function createEntitlement(
	festivalClassId: string,
	childId: string,
	status: ClassEntitlement["status"] = "confirmed",
): ClassEntitlement {
	return {
		id: `ent-${festivalClassId}-${childId}`,
		organizationId: ORG_ID,
		festivalId: FESTIVAL_ID,
		festivalClassId,
		childId,
		status,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

describe("candidate class eligibility isolation", () => {
	const soloSubtype = createSubtype(SUBTYPE_SOLO, "Piano Solo");
	const masterclassSubtype = createSubtype(
		SUBTYPE_MASTERCLASS,
		"Piano Concerto",
		SUBTYPE_SOLO,
	);
	const soloClass = createClass("class-solo", SUBTYPE_SOLO);
	const concertoClass = createClass("class-concerto", SUBTYPE_MASTERCLASS);
	const subtypes = [soloSubtype, masterclassSubtype];
	const classes = [soloClass, concertoClass];

	it("detects candidate line items correctly", () => {
		expect(
			isCandidateLineItem({
				childId: "c1",
				festivalClassId: "cls1",
				isCandidate: true,
			}),
		).toBe(true);
		expect(
			isCandidateLineItem({
				id: "candidate:cls1",
				childId: "c1",
				festivalClassId: "cls1",
			}),
		).toBe(true);
		expect(
			isCandidateLineItem({
				id: "item-123",
				childId: "c1",
				festivalClassId: "cls1",
			}),
		).toBe(false);
	});

	it("prevents unselected candidate classes from cross-enabling each other", () => {
		// Both solo and concerto are candidate classes in the selector; cart is empty
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "advisory",
			items: [
				{
					id: "candidate:class-solo",
					childId: "child-1",
					festivalClassId: "class-solo",
					isCandidate: true,
				},
				{
					id: "candidate:class-concerto",
					childId: "child-1",
					festivalClassId: "class-concerto",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.results).toHaveLength(2);
		expect(res.results[0].festivalClassId).toBe("class-solo");
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[0].isEligible).toBe(true);

		// Concerto requires solo. Solo is only another candidate, so concerto is NOT enabled!
		expect(res.results[1].festivalClassId).toBe("class-concerto");
		expect(res.results[1].reasonCode).toBe("MISSING_PREREQUISITE");
		expect(res.results[1].isEligible).toBe(false);
		expect(res.results[1].missingPrerequisite?.requiredSubtypeName).toBe(
			"Piano Solo",
		);
	});

	it("evaluates candidate as eligible when prerequisite is in current cart", () => {
		// Solo is in cart; concerto is candidate
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "advisory",
			items: [
				{
					id: "cart-item-1",
					childId: "child-1",
					festivalClassId: "class-solo",
				},
				{
					id: "candidate:class-concerto",
					childId: "child-1",
					festivalClassId: "class-concerto",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.results).toHaveLength(2);
		// Cart item solo is available
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		// Candidate concerto is available because solo is in cart
		expect(res.results[1].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].isEligible).toBe(true);
		expect(res.results[1].satisfiedPrerequisites?.[0].satisfiedBy).toBe(
			"proposed_item",
		);
	});

	it("returns ALREADY_REGISTERED when candidate class is already in the cart", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "advisory",
			items: [
				{
					id: "cart-item-solo",
					childId: "child-1",
					festivalClassId: "class-solo",
				},
				{
					id: "candidate:class-solo",
					childId: "child-1",
					festivalClassId: "class-solo",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.results[1].reasonCode).toBe("ALREADY_REGISTERED");
		expect(res.results[1].isEligible).toBe(false);
	});

	it("returns ALREADY_REGISTERED when candidate class has completed registration entitlement", () => {
		const entitlement = createEntitlement("class-solo", "child-1");
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "advisory",
			items: [
				{
					id: "candidate:class-solo",
					childId: "child-1",
					festivalClassId: "class-solo",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [entitlement],
		});

		expect(res.results[0].reasonCode).toBe("ALREADY_REGISTERED");
		expect(res.results[0].isEligible).toBe(false);
	});

	it("does not count candidates against each other for capacity", () => {
		const limitedClass = createClass("class-limited", SUBTYPE_SOLO, {
			capacity: 1,
		});
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "advisory",
			items: [
				{
					id: "candidate:user-a",
					childId: "child-1",
					festivalClassId: "class-limited",
					isCandidate: true,
				},
				{
					id: "candidate:user-b",
					childId: "child-2",
					festivalClassId: "class-limited",
					isCandidate: true,
				},
			],
			classes: [limitedClass],
			subtypes,
			activeEntitlements: [],
		});

		// Both are candidates and evaluated in isolation, so both see capacity as available
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("AVAILABLE");
	});

	it("stripCandidateMarker removes isCandidate and strips candidate ID prefix", () => {
		expect(
			stripCandidateMarker({
				id: "candidate:cls1",
				childId: "c1",
				festivalClassId: "cls1",
				isCandidate: true,
			}),
		).toEqual({
			id: "cls1",
			childId: "c1",
			festivalClassId: "cls1",
		});

		expect(
			stripCandidateMarker({
				id: "candidate-cls2",
				childId: "c1",
				festivalClassId: "cls2",
				isCandidate: true,
			}),
		).toEqual({
			id: "cls2",
			childId: "c1",
			festivalClassId: "cls2",
		});

		expect(
			stripCandidateMarker({
				id: "candidate_cls3",
				childId: "c1",
				festivalClassId: "cls3",
				isCandidate: true,
			}),
		).toEqual({
			id: "cls3",
			childId: "c1",
			festivalClassId: "cls3",
		});
	});
});

describe("checkout cart eligibility isolation from candidate markers", () => {
	const soloSubtype = createSubtype(SUBTYPE_SOLO, "Piano Solo");
	const masterclassSubtype = createSubtype(
		SUBTYPE_MASTERCLASS,
		"Piano Concerto",
		SUBTYPE_SOLO,
	);
	const soloClass = createClass("class-solo", SUBTYPE_SOLO);
	const concertoClass = createClass("class-concerto", SUBTYPE_MASTERCLASS);
	const subtypes = [soloSubtype, masterclassSubtype];
	const classes = [soloClass, concertoClass];

	it("candidate markers on checkout payload do not bypass prerequisites or ignore failures in cart mode", () => {
		// Payload with 1 eligible line (solo) and 1 ineligible candidate-marked line (concerto for different child without solo prerequisite)
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "cart",
			items: [
				{
					id: "line-1",
					childId: "child-1",
					festivalClassId: "class-solo",
				},
				{
					id: "candidate:class-concerto",
					childId: "child-2",
					festivalClassId: "class-concerto",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.results).toHaveLength(2);
		expect(res.results[0].festivalClassId).toBe("class-solo");
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[0].isEligible).toBe(true);

		// Concerto line was marked as candidate, but cart mode evaluates all lines together
		expect(res.results[1].festivalClassId).toBe("class-concerto");
		expect(res.results[1].reasonCode).toBe("MISSING_PREREQUISITE");
		expect(res.results[1].isEligible).toBe(false);

		// Top-level isEligible MUST be false (candidate failure is not ignored!)
		expect(res.isEligible).toBe(false);
		expect(res.eligible).toBe(false);
	});

	it("defaults to cart evaluation mode and blocks checkout when candidate line fails prerequisite", () => {
		// When mode is omitted (default), cart evaluation mode applies
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [
				{
					id: "line-1",
					childId: "child-1",
					festivalClassId: "class-solo",
				},
				{
					id: "candidate:class-concerto",
					childId: "child-2",
					festivalClassId: "class-concerto",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[1].reasonCode).toBe("MISSING_PREREQUISITE");
	});

	it("evaluates complete checkout cart normally and succeeds when all prerequisites are met", () => {
		// Both solo and concerto in cart for child-1: solo satisfies concerto prerequisite in same cart
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			mode: "cart",
			items: [
				{
					id: "line-1",
					childId: "child-1",
					festivalClassId: "class-solo",
				},
				{
					id: "candidate:class-concerto",
					childId: "child-1",
					festivalClassId: "class-concerto",
					isCandidate: true,
				},
			],
			classes,
			subtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].satisfiedPrerequisites?.[0].satisfiedBy).toBe(
			"proposed_item",
		);
	});
});
