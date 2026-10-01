import { describe, expect, it } from "bun:test";
import type {
	ClassEntitlement,
	FestivalClassConfiguration,
	ProposedPurchaseLineItem,
	RegistrationCatalogValue,
} from "../src/index.js";
import {
	evaluatePurchaseEligibility,
	isEligibilityReasonCode,
} from "../src/index.js";

const ORG_ID = "org-1";
const FESTIVAL_ID = "fest-1";
const DIVISION_PIANO = "div-piano";
const SUBTYPE_SOLO = "sub-solo";
const SUBTYPE_MASTERCLASS = "sub-masterclass";

function createSubtype(
	id: string,
	displayName: string,
	requiredSubtypeId?: string | null,
): RegistrationCatalogValue {
	return {
		id,
		organizationId: ORG_ID,
		displayName,
		isActive: true,
		displayOrder: 1,
		requiredSubtypeId: requiredSubtypeId ?? null,
		createdAtIso: "2026-01-01T00:00:00.000Z",
		updatedAtIso: "2026-01-01T00:00:00.000Z",
	};
}

function createClass(
	id: string,
	subtypeId: string,
	opts: Partial<FestivalClassConfiguration> = {},
): FestivalClassConfiguration {
	return {
		id,
		organizationId: ORG_ID,
		festivalId: FESTIVAL_ID,
		displayName: `Class ${id}`,
		classSubtypeId: subtypeId,
		divisionId: DIVISION_PIANO,
		minimumAge: 8,
		maximumAge: 10,
		price: "50.00",
		maximumPerformancePieces: 1,
		performanceMinutes: 10,
		capacity: 100,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		createdAtIso: "2026-01-01T00:00:00.000Z",
		updatedAtIso: "2026-01-01T00:00:00.000Z",
		...opts,
	};
}

function createEntitlement(
	festivalClassId: string,
	childId: string,
	status: ClassEntitlement["status"] = "confirmed",
	opts: Partial<ClassEntitlement> = {},
): ClassEntitlement {
	return {
		id: `ent-${festivalClassId}-${childId}`,
		organizationId: ORG_ID,
		festivalId: FESTIVAL_ID,
		festivalClassId,
		parentCustomerId: "cust-1",
		childId,
		checkoutIntentId: "intent-1",
		shopifyOrderGid: "gid://shopify/Order/1",
		shopifyOrderLineGid: "gid://shopify/LineItem/1",
		paidAmountCents: 5000,
		paidCurrencyCode: "USD",
		status,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...opts,
	};
}

describe("evaluatePurchaseEligibility", () => {
	const soloSubtype = createSubtype(SUBTYPE_SOLO, "Solo");
	const masterclassSubtype = createSubtype(
		SUBTYPE_MASTERCLASS,
		"Masterclass",
		SUBTYPE_SOLO,
	);
	const soloClass = createClass("class-solo", SUBTYPE_SOLO);
	const masterclassClass = createClass(
		"class-masterclass",
		SUBTYPE_MASTERCLASS,
	);

	const defaultSubtypes = [soloSubtype, masterclassSubtype];
	const defaultClasses = [soloClass, masterclassClass];

	it("returns REGISTRATION_CLOSED when registration window is closed", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-solo" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
			isRegistrationOpen: false,
		});

		expect(res.isEligible).toBe(false);
		expect(res.results).toHaveLength(1);
		expect(res.results[0].reasonCode).toBe("REGISTRATION_CLOSED");
		expect(res.results[0].eligible).toBe(false);
	});

	it("returns CLASS_NOT_AVAILABLE for missing or inactive class", () => {
		const inactiveClass = createClass("class-inactive", SUBTYPE_SOLO, {
			isActive: false,
		});
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [
				{ childId: "child-1", festivalClassId: "class-nonexistent" },
				{ childId: "child-1", festivalClassId: "class-inactive" },
			],
			classes: [...defaultClasses, inactiveClass],
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("CLASS_NOT_AVAILABLE");
		expect(res.results[1].reasonCode).toBe("CLASS_NOT_AVAILABLE");
	});

	it("returns CLASS_NOT_AVAILABLE for class from another festival/organization", () => {
		const foreignClass = createClass("class-foreign", SUBTYPE_SOLO, {
			festivalId: "other-festival",
		});
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-foreign" }],
			classes: [foreignClass],
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("CLASS_NOT_AVAILABLE");
	});

	it("returns ALREADY_REGISTERED when active entitlement exists for same child and class", () => {
		const entitlement = createEntitlement("class-solo", "child-1", "confirmed");
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-solo" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [entitlement],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("ALREADY_REGISTERED");
	});

	it("ignores cancelled and revoked entitlements for duplicate detection", () => {
		const cancelled = createEntitlement("class-solo", "child-1", "cancelled");
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-solo" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [cancelled],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
	});

	it("detects duplicate (childId, festivalClassId) within proposed items", () => {
		const items: ProposedPurchaseLineItem[] = [
			{ id: "item-1", childId: "child-1", festivalClassId: "class-solo" },
			{ id: "item-2", childId: "child-1", festivalClassId: "class-solo" },
		];
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items,
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("ALREADY_REGISTERED");
		expect(res.results[1].lineItemId).toBe("item-2");
	});

	it("returns AVAILABLE when class has no prerequisite", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-solo" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[0].eligible).toBe(true);
	});

	it("satisfies prerequisite via active confirmed entitlement in same org, festival, child, division, age", () => {
		const soloEntitlement = createEntitlement(
			"class-solo",
			"child-1",
			"confirmed",
		);
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-masterclass" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [soloEntitlement],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
	});

	it("fails prerequisite when entitlement belongs to a different child", () => {
		const otherChildEntitlement = createEntitlement(
			"class-solo",
			"child-2",
			"confirmed",
		);
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-masterclass" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [otherChildEntitlement],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("MISSING_PREREQUISITE");
		expect(res.results[0].dependencyDescriptor?.requiredSubtypeId).toBe(
			SUBTYPE_SOLO,
		);
		expect(res.results[0].dependencyDescriptor?.requiredSubtypeName).toBe(
			"Solo",
		);
	});

	it("fails prerequisite when entitlement is for a different division or age group", () => {
		const stringsSoloClass = createClass("class-strings-solo", SUBTYPE_SOLO, {
			divisionId: "div-strings",
		});
		const stringsEntitlement = createEntitlement(
			"class-strings-solo",
			"child-1",
			"confirmed",
		);
		const olderSoloClass = createClass("class-older-solo", SUBTYPE_SOLO, {
			minimumAge: 11,
			maximumAge: 13,
		});
		const olderEntitlement = createEntitlement(
			"class-older-solo",
			"child-1",
			"confirmed",
		);

		const resDiv = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-masterclass" }],
			classes: [...defaultClasses, stringsSoloClass],
			subtypes: defaultSubtypes,
			activeEntitlements: [stringsEntitlement],
		});
		expect(resDiv.results[0].reasonCode).toBe("MISSING_PREREQUISITE");

		const resAge = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-masterclass" }],
			classes: [...defaultClasses, olderSoloClass],
			subtypes: defaultSubtypes,
			activeEntitlements: [olderEntitlement],
		});
		expect(resAge.results[0].reasonCode).toBe("MISSING_PREREQUISITE");
	});

	it("fails prerequisite when entitlement is waitlisted, cancelled, or revoked", () => {
		const waitlistedEntitlement = createEntitlement(
			"class-solo",
			"child-1",
			"waitlisted",
		);
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-masterclass" }],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [waitlistedEntitlement],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("MISSING_PREREQUISITE");
	});

	it("satisfies prerequisite via proposed items for same performer in same division and age group", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [
				{ childId: "child-1", festivalClassId: "class-solo" },
				{ childId: "child-1", festivalClassId: "class-masterclass" },
			],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("AVAILABLE");
	});

	it("satisfies prerequisite via proposed items regardless of item order in cart", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [
				{ childId: "child-1", festivalClassId: "class-masterclass" },
				{ childId: "child-1", festivalClassId: "class-solo" },
			],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("AVAILABLE");
	});

	it("fails prerequisite when proposed item is for a different performer", () => {
		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [
				{ childId: "child-2", festivalClassId: "class-solo" },
				{ childId: "child-1", festivalClassId: "class-masterclass" },
			],
			classes: defaultClasses,
			subtypes: defaultSubtypes,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
		expect(res.results[1].reasonCode).toBe("MISSING_PREREQUISITE");
	});

	it("returns SOLD_OUT when class capacity is reached", () => {
		const smallClass = createClass("class-small", SUBTYPE_SOLO, {
			capacity: 1,
		});
		const existing = createEntitlement(
			"class-small",
			"child-other",
			"confirmed",
		);

		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-small" }],
			classes: [smallClass],
			subtypes: defaultSubtypes,
			activeEntitlements: [existing],
		});

		expect(res.isEligible).toBe(false);
		expect(res.results[0].reasonCode).toBe("SOLD_OUT");
	});

	it("accepts classes and subtypes passed as Maps or Arrays", () => {
		const classesMap = new Map<string, FestivalClassConfiguration>([
			["class-solo", soloClass],
		]);
		const subtypesMap = new Map<string, RegistrationCatalogValue>([
			[SUBTYPE_SOLO, soloSubtype],
		]);

		const res = evaluatePurchaseEligibility({
			organizationId: ORG_ID,
			festivalId: FESTIVAL_ID,
			items: [{ childId: "child-1", festivalClassId: "class-solo" }],
			classes: classesMap,
			subtypes: subtypesMap,
			activeEntitlements: [],
		});

		expect(res.isEligible).toBe(true);
		expect(res.results[0].reasonCode).toBe("AVAILABLE");
	});

	it("validates eligibility reason code type guard", () => {
		expect(isEligibilityReasonCode("AVAILABLE")).toBe(true);
		expect(isEligibilityReasonCode("SOLD_OUT")).toBe(true);
		expect(isEligibilityReasonCode("INVALID_CODE")).toBe(false);
	});
});
