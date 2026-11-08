import { describe, expect, it } from "bun:test";
import type {
	CustomerClassRegistrationItem,
	RepertoirePiece,
} from "@festival/common";
import {
	canEditPurchasedRegistration,
	groupPurchasedRegistrations,
	KEEP_CURRENT_ACCOMPANIST,
	purchasedRegistrationReadOnlyReason,
	purchasedRegistrationUpdate,
	validatePurchasedRegistrationPieces,
} from "../src/pages/PurchasedRegistrationHelpers.js";

const cutoff = "2027-04-03T07:00:00.000Z";
const piece: RepertoirePiece = {
	title: "Concerto in A Major",
	composer: "Mozart",
	movement: "I. Allegro",
	durationSeconds: 180,
	catalogWorkId: "catalog-work-1",
};
function registration(
	id = "registration-1",
	childId = "child-1",
	festivalId = "festival-1",
): CustomerClassRegistrationItem {
	return {
		entitlement: {
			id,
			childId,
			festivalId,
			festivalClassId: "class-1",
			status: "confirmed",
			createdAt: "2027-03-01T00:00:00Z",
			updatedAt: "2027-03-01T00:00:00Z",
		},
		festivalClass: {
			id: "class-1",
			festivalId,
			displayName: "Piano Concerto",
			classSubtypeId: "concerto",
			divisionId: "piano",
			minimumAge: 9,
			maximumAge: 10,
			price: "45.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 8,
			capacity: 20,
			isActive: true,
		},
		child: { id: childId, name: "Alex Chen" },
		metadata: {
			id: "metadata-1",
			festivalId,
			classEntitlementId: id,
			teacherMembershipId: "teacher-membership",
			teacherName: null,
			accompanistMembershipId: "accompanist-membership",
			repertoireJson: [piece],
			repertoireItems: [],
		},
		paidAtIso: null,
		metadataEditCutoffIso: cutoff,
		canEditMetadata: true,
	};
}

describe("purchased registration policy and data", () => {
	it("groups by child identity rather than display name, and filters festivals before grouping", () => {
		const first = registration();
		const second = registration("registration-2", "child-2");
		const historical = registration("registration-3", "child-1", "festival-2");
		const grouped = groupPurchasedRegistrations([first, second, historical]);
		expect(grouped).toHaveLength(2);
		expect(grouped[0].registrations).toEqual([first, historical]);
		expect(grouped[1].registrations).toEqual([second]);
		expect(
			groupPurchasedRegistrations([first, second, historical], "festival-2"),
		).toEqual([
			{ childId: "child-1", name: "Alex Chen", registrations: [historical] },
		]);
	});
	it("uses an explicit historical fallback without inventing a performer name", () => {
		const item = { ...registration(), child: undefined };
		expect(groupPurchasedRegistrations([item])[0].name).toBe(
			"Performer name unavailable",
		);
	});
	it("honors the server edit flag and exact timezone-resolved cutoff boundary", () => {
		const item = registration();
		const instant = Date.parse(cutoff);
		expect(canEditPurchasedRegistration(item, instant - 1)).toBe(true);
		expect(canEditPurchasedRegistration(item, instant)).toBe(false);
		expect(canEditPurchasedRegistration(item, instant + 1)).toBe(false);
		expect(
			canEditPurchasedRegistration(
				{ ...item, canEditMetadata: false },
				instant - 1,
			),
		).toBe(false);
		expect(purchasedRegistrationReadOnlyReason(item, instant)).toContain(
			"cutoff has passed",
		);
	});
	it("keeps incomplete historical registrations read-only", () => {
		const item = registration();
		for (const incomplete of [
			{ ...item, metadata: null },
			{ ...item, festivalClass: undefined },
			{ ...item, metadataEditCutoffIso: null },
			{ ...item, metadataEditCutoffIso: "not-a-date" },
		]) {
			expect(
				canEditPurchasedRegistration(incomplete, Date.parse(cutoff) - 1),
			).toBe(false);
		}
	});
	it("preserves an unknown existing accompanist and catalog identity during repertoire-only updates", () => {
		const update = purchasedRegistrationUpdate(
			[piece],
			KEEP_CURRENT_ACCOMPANIST,
		);
		expect(update).not.toHaveProperty("accompanistId");
		expect(update.pieces?.[0]).toEqual(piece);
		expect(update.pieces?.[0]).not.toBe(piece);
	});
	it("sends only explicit accompanist changes through the existing API contract", () => {
		expect(
			purchasedRegistrationUpdate([piece], "active-customer").accompanistId,
		).toBe("active-customer");
		expect(purchasedRegistrationUpdate([piece], "").accompanistId).toBeNull();
	});
	it("rejects invalid whole-second durations and class policy violations rather than normalizing them away", () => {
		const configuration = registration().festivalClass;
		if (!configuration) throw new Error("fixture");
		expect(
			validatePurchasedRegistrationPieces([piece], configuration),
		).toBeNull();
		expect(validatePurchasedRegistrationPieces([], configuration)).toContain(
			"At least one",
		);
		expect(
			validatePurchasedRegistrationPieces([piece, piece, piece], configuration),
		).toContain("no more than 2");
		expect(
			validatePurchasedRegistrationPieces(
				[{ ...piece, durationSeconds: 0 }],
				configuration,
			),
		).toContain("positive integer");
		expect(
			validatePurchasedRegistrationPieces(
				[{ ...piece, durationSeconds: 1.5 }],
				configuration,
			),
		).toContain("positive integer");
		expect(
			validatePurchasedRegistrationPieces(
				[{ ...piece, durationSeconds: 481 }],
				configuration,
			),
		).toContain("8 minutes");
		expect(
			validatePurchasedRegistrationPieces(
				[{ ...piece, title: "" }],
				configuration,
			),
		).toContain("title");
	});
});
