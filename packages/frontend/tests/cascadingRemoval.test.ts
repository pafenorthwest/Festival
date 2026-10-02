import { describe, expect, it, mock } from "bun:test";
import type { ClassEligibilityResult } from "@festival/common";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);

const { createRoot } = clientSolid;
const { createRegistrationCart } = await import(
	"../src/pages/registrationCartState.js"
);
const {
	findDependentCartItems,
	hasDependentCartItems,
	isSatisfiedByEntitlement,
	getRequiredSubtypeId,
	hasRemainingProvider,
} = await import("../src/pages/cascadingRemoval.js");

const cartViewSource = await Bun.file(
	new URL(
		"../src/components/FestivalRegistrationCartView.tsx",
		import.meta.url,
	),
).text();

const modalSource = await Bun.file(
	new URL("../src/components/CascadingRemovalModal.tsx", import.meta.url),
).text();

type CartItemInput = Parameters<typeof createRegistrationCart>[0][0];

function item(
	overrides: Partial<CartItemInput> & {
		lineId: string;
		classId: string;
		childId: string;
	},
) {
	return {
		childName: "Alice",
		divisionId: "div-1",
		divisionName: "Junior",
		teacherId: "teacher-1",
		teacherName: "Mozart",
		className: "Class",
		priceCents: 3000,
		pieces: [],
		...overrides,
	};
}

describe("cascadingRemoval unit helpers", () => {
	it("isSatisfiedByEntitlement checks entitlement presence in satisfiedPrerequisites", () => {
		const resWithEntitlement: ClassEligibilityResult = {
			childId: "c-1",
			festivalClassId: "cls-1",
			eligible: true,
			isEligible: true,
			reasonCode: "AVAILABLE",
			satisfiedPrerequisites: [
				{ requiredSubtypeId: "sub-solo", satisfiedBy: "entitlement" },
			],
		};
		const resWithProposed: ClassEligibilityResult = {
			childId: "c-1",
			festivalClassId: "cls-1",
			eligible: true,
			isEligible: true,
			reasonCode: "AVAILABLE",
			satisfiedPrerequisites: [
				{ requiredSubtypeId: "sub-solo", satisfiedBy: "proposed_item" },
			],
		};

		expect(isSatisfiedByEntitlement(resWithEntitlement, "sub-solo")).toBe(true);
		expect(isSatisfiedByEntitlement(resWithEntitlement, "sub-duet")).toBe(
			false,
		);
		expect(isSatisfiedByEntitlement(resWithProposed, "sub-solo")).toBe(false);
		expect(isSatisfiedByEntitlement(undefined, "sub-solo")).toBe(false);
	});

	it("getRequiredSubtypeId extracts requiredSubtypeId across various descriptor formats", () => {
		const plain = item({ lineId: "1", classId: "c1", childId: "k1" });
		const withItemDesc = {
			...plain,
			dependencyDescriptor: { requiredSubtypeId: "sub-from-item" },
		};
		const resSatisfied: ClassEligibilityResult = {
			childId: "k1",
			festivalClassId: "c1",
			eligible: true,
			isEligible: true,
			reasonCode: "AVAILABLE",
			satisfiedPrerequisites: [{ requiredSubtypeId: "sub-from-satisfied" }],
		};
		const resDesc: ClassEligibilityResult = {
			childId: "k1",
			festivalClassId: "c1",
			eligible: false,
			isEligible: false,
			reasonCode: "MISSING_PREREQUISITE",
			dependencyDescriptor: { requiredSubtypeId: "sub-from-result" },
		};

		expect(getRequiredSubtypeId(plain, resSatisfied)).toBe(
			"sub-from-satisfied",
		);
		expect(getRequiredSubtypeId(plain, resDesc)).toBe("sub-from-result");
		expect(getRequiredSubtypeId(withItemDesc, undefined)).toBe("sub-from-item");
		expect(getRequiredSubtypeId(plain, undefined)).toBeUndefined();
	});

	it("hasRemainingProvider detects whether other items provide the subtype for the child", () => {
		const items = [
			item({
				lineId: "1",
				classId: "c1",
				childId: "child-1",
				classSubtypeId: "sub-solo",
			}),
			item({
				lineId: "2",
				classId: "c2",
				childId: "child-1",
				classSubtypeId: "sub-solo",
			}),
			item({
				lineId: "3",
				classId: "c3",
				childId: "child-2",
				classSubtypeId: "sub-solo",
			}),
		];

		expect(hasRemainingProvider(items, "child-1", "sub-solo")).toBe(true);
		expect(hasRemainingProvider(items, "child-1", "sub-master")).toBe(false);
		expect(hasRemainingProvider(items, "child-3", "sub-solo")).toBe(false);
	});
});

describe("findDependentCartItems detection algorithm", () => {
	it("returns empty array when target line is not found or has no subtype", () => {
		const items = [item({ lineId: "1", classId: "c1", childId: "ch1" })];
		expect(findDependentCartItems("missing", items)).toEqual([]);
		expect(findDependentCartItems("1", items)).toEqual([]);
	});

	it("detects single dependent cart item requiring target item's subtype", () => {
		const solo = item({
			lineId: "line-solo",
			classId: "cls-solo",
			className: "Solo Piano",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const master = item({
			lineId: "line-master",
			classId: "cls-master",
			className: "Masterclass",
			childId: "child-1",
			classSubtypeId: "subtype-master",
		});
		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-1:cls-master": {
				childId: "child-1",
				festivalClassId: "cls-master",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
				satisfiedPrerequisites: [
					{
						requiredSubtypeId: "subtype-solo",
						satisfiedBy: "proposed_item",
						sourceFestivalClassId: "cls-solo",
					},
				],
			},
		};

		const dependents = findDependentCartItems(
			"line-solo",
			[solo, master],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(1);
		expect(dependents[0].lineId).toBe("line-master");
		expect(
			hasDependentCartItems(
				"line-solo",
				[solo, master],
				(ch, cl) => resultsMap[`${ch}:${cl}`],
			),
		).toBe(true);
	});

	it("detects multiple direct dependent cart items requiring target item's subtype", () => {
		const solo = item({
			lineId: "line-solo",
			classId: "cls-solo",
			className: "Solo Piano",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const mc1 = item({
			lineId: "line-mc-1",
			classId: "cls-mc-1",
			className: "Masterclass 1",
			childId: "child-1",
			classSubtypeId: "subtype-master",
		});
		const mc2 = item({
			lineId: "line-mc-2",
			classId: "cls-mc-2",
			className: "Masterclass 2",
			childId: "child-1",
			classSubtypeId: "subtype-master",
		});

		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-1:cls-mc-1": {
				childId: "child-1",
				festivalClassId: "cls-mc-1",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
			},
			"child-1:cls-mc-2": {
				childId: "child-1",
				festivalClassId: "cls-mc-2",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
			},
		};

		const dependents = findDependentCartItems(
			"line-solo",
			[solo, mc1, mc2],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(2);
		expect(dependents.map((d) => d.lineId)).toEqual(["line-mc-1", "line-mc-2"]);
	});

	it("detects multi-tier transitive cascading dependencies (A -> B -> C)", () => {
		const solo = item({
			lineId: "line-solo",
			classId: "cls-solo",
			className: "Solo Qualifying",
			childId: "child-1",
			classSubtypeId: "sub-solo",
		});
		const mc = item({
			lineId: "line-master",
			classId: "cls-master",
			className: "Masterclass",
			childId: "child-1",
			classSubtypeId: "sub-master",
		});
		const gala = item({
			lineId: "line-showcase",
			classId: "cls-showcase",
			className: "Showcase Gala",
			childId: "child-1",
			classSubtypeId: "sub-showcase",
		});

		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-1:cls-master": {
				childId: "child-1",
				festivalClassId: "cls-master",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "sub-solo" },
			},
			"child-1:cls-showcase": {
				childId: "child-1",
				festivalClassId: "cls-showcase",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "sub-master" },
			},
		};

		const dependents = findDependentCartItems(
			"line-solo",
			[solo, mc, gala],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(2);
		expect(dependents.map((d) => d.lineId)).toEqual([
			"line-master",
			"line-showcase",
		]);
	});

	it("does not cascade if prerequisite is satisfied by confirmed entitlement", () => {
		const solo = item({
			lineId: "line-solo",
			classId: "cls-solo",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const mc = item({
			lineId: "line-master",
			classId: "cls-master",
			childId: "child-1",
			classSubtypeId: "subtype-master",
		});
		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-1:cls-master": {
				childId: "child-1",
				festivalClassId: "cls-master",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
				satisfiedPrerequisites: [
					{ requiredSubtypeId: "subtype-solo", satisfiedBy: "entitlement" },
				],
			},
		};

		const dependents = findDependentCartItems(
			"line-solo",
			[solo, mc],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(0);
	});

	it("does not cascade if another item in cart still satisfies the required subtype", () => {
		const solo1 = item({
			lineId: "line-solo-1",
			classId: "cls-solo-1",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const solo2 = item({
			lineId: "line-solo-2",
			classId: "cls-solo-2",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const mc = item({
			lineId: "line-master",
			classId: "cls-master",
			childId: "child-1",
			classSubtypeId: "subtype-master",
		});

		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-1:cls-master": {
				childId: "child-1",
				festivalClassId: "cls-master",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
			},
		};

		const dependents = findDependentCartItems(
			"line-solo-1",
			[solo1, solo2, mc],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(0);
	});

	it("does not cascade across different performers", () => {
		const soloChild1 = item({
			lineId: "line-solo-c1",
			classId: "cls-solo",
			childId: "child-1",
			classSubtypeId: "subtype-solo",
		});
		const mcChild2 = item({
			lineId: "line-master-c2",
			classId: "cls-master",
			childId: "child-2",
			classSubtypeId: "subtype-master",
		});

		const resultsMap: Record<string, ClassEligibilityResult> = {
			"child-2:cls-master": {
				childId: "child-2",
				festivalClassId: "cls-master",
				eligible: true,
				isEligible: true,
				reasonCode: "AVAILABLE",
				dependencyDescriptor: { requiredSubtypeId: "subtype-solo" },
			},
		};

		const dependents = findDependentCartItems(
			"line-solo-c1",
			[soloChild1, mcChild2],
			(ch, cl) => resultsMap[`${ch}:${cl}`],
		);
		expect(dependents).toHaveLength(0);
	});
});

describe("RegistrationCartState removeItems", () => {
	it("removes multiple items in a single batch update", () => {
		createRoot((dispose) => {
			const cart = createRegistrationCart();
			cart.addItem(
				item({
					lineId: "item-1",
					classId: "c-1",
					childId: "k-1",
					className: "Item 1",
				}),
			);
			cart.addItem(
				item({
					lineId: "item-2",
					classId: "c-2",
					childId: "k-1",
					className: "Item 2",
				}),
			);
			cart.addItem(
				item({
					lineId: "item-3",
					classId: "c-3",
					childId: "k-1",
					className: "Item 3",
				}),
			);

			expect(cart.itemCount()).toBe(3);

			cart.removeItems(["item-1", "item-2"]);

			expect(cart.itemCount()).toBe(1);
			expect(cart.items()[0].lineId).toBe("item-3");

			cart.removeItems([]);
			expect(cart.itemCount()).toBe(1);

			dispose();
		});
	});
});

describe("CascadingRemovalModal & Cart View UX specifications", () => {
	it("CascadingRemovalModal defines accessible dialog attributes and warning elements", () => {
		expect(modalSource).toContain('role="dialog"');
		expect(modalSource).toContain('aria-modal="true"');
		expect(modalSource).toContain('id="cascading-removal-title"');
		expect(modalSource).toContain('id="cascading-removal-description"');
		expect(modalSource).toContain("cascading-removal-warning");
		expect(modalSource).toContain("cascading-dependents-list");
	});

	it("CascadingRemovalModal provides Remove All (X + dependents) and Cancel choices", () => {
		expect(modalSource).toContain("Remove All");
		expect(modalSource).toContain("dependents");
		expect(modalSource).toContain("Cancel");
		expect(modalSource).toContain('data-testid="confirm-cascading-removal"');
		expect(modalSource).toContain('data-testid="cancel-cascading-removal"');
		expect(modalSource).toContain("props.onConfirmRemoveAll");
		expect(modalSource).toContain("props.onCancel");
	});

	it("FestivalRegistrationCartView integrates cascading removal modal and handler", () => {
		expect(cartViewSource).toContain("CascadingRemovalModal");
		expect(cartViewSource).toContain("findDependentCartItems");
		expect(cartViewSource).toContain("handleRemoveClick");
		expect(cartViewSource).toContain("handleConfirmRemoveAll");
		expect(cartViewSource).toContain("handleCancelCascadingRemoval");
		expect(cartViewSource).toContain("isCascadingModalOpen");
		expect(cartViewSource).toContain("cascadingTarget");
		expect(cartViewSource).toContain("cascadingDependents");
	});
});
