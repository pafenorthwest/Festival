import { describe, expect, it } from "bun:test";
import type {
	AccompanistMembershipGrant,
	ClassEntitlement,
	ClassRegistrationMetadata,
	FestivalChildAgeSnapshot,
} from "@festival/common";
import {
	loadSchedulingAvailability,
	loadSchedulingRoster,
	type SchedulingRosterSources,
	selectAgeSnapshotAt,
	sumRepertoireSeconds,
} from "../src/domains/catalog-repertoire/index.js";

function snapshot(
	id: string,
	age: number,
	createdAtIso: string,
	end: { supersededAtIso?: string; validUntilIso?: string } = {},
): FestivalChildAgeSnapshot {
	return {
		id,
		childId: "child-1",
		organizationId: "org",
		age,
		createdAtIso,
		validUntilIso: end.validUntilIso ?? "2099-01-01T00:00:00.000Z",
		...(end.supersededAtIso ? { supersededAtIso: end.supersededAtIso } : {}),
	};
}

describe("selectAgeSnapshotAt", () => {
	const first = snapshot("s1", 10, "2027-01-01T00:00:00.000Z", {
		supersededAtIso: "2027-03-01T00:00:00.000Z",
	});
	const second = snapshot("s2", 11, "2027-03-01T00:00:00.000Z");

	it("picks the snapshot in force at registration time", () => {
		expect(
			selectAgeSnapshotAt([second, first], "2027-02-01T00:00:00.000Z")?.id,
		).toBe("s1");
		expect(
			selectAgeSnapshotAt([first, second], "2027-03-01T00:00:00.000Z")?.id,
		).toBe("s2");
		expect(
			selectAgeSnapshotAt([first, second], "2027-01-01T00:00:00.000Z")?.id,
		).toBe("s1");
	});

	it("returns null before the first snapshot, after expiry, or for bad input", () => {
		expect(selectAgeSnapshotAt([first], "2026-12-31T23:59:59.000Z")).toBeNull();
		const expiring = snapshot("s3", 9, "2027-01-01T00:00:00.000Z", {
			validUntilIso: "2027-02-01T00:00:00.000Z",
		});
		expect(selectAgeSnapshotAt([expiring], "2027-02-01T00:00:00.000Z")).toBe(
			null,
		);
		expect(
			selectAgeSnapshotAt([expiring], "2027-01-15T00:00:00.000Z")?.id,
		).toBe("s3");
		expect(selectAgeSnapshotAt([first], "not-a-date")).toBeNull();
		expect(selectAgeSnapshotAt([], "2027-02-01T00:00:00.000Z")).toBeNull();
	});

	it("prefers supersededAt over validUntil as the end of a snapshot", () => {
		const superseded = snapshot("s4", 9, "2027-01-01T00:00:00.000Z", {
			supersededAtIso: "2027-01-10T00:00:00.000Z",
			validUntilIso: "2028-01-01T00:00:00.000Z",
		});
		expect(
			selectAgeSnapshotAt([superseded], "2027-01-20T00:00:00.000Z"),
		).toBeNull();
	});
});

describe("sumRepertoireSeconds", () => {
	it("prefers relational items and falls back to legacy JSON", () => {
		const piece = { title: "t", composer: "c", durationSeconds: 90 };
		expect(sumRepertoireSeconds(null)).toBe(0);
		expect(
			sumRepertoireSeconds({
				repertoireItems: [],
				repertoireJson: [piece, piece],
			}),
		).toBe(180);
		expect(
			sumRepertoireSeconds({
				repertoireItems: [
					{
						durationSeconds: 60,
					} as ClassRegistrationMetadata["repertoireItems"][number],
				],
				repertoireJson: [piece, piece],
			}),
		).toBe(60);
	});
});

function entitlement(
	id: string,
	childId: string,
	parentCustomerId: string,
): ClassEntitlement {
	return {
		id,
		organizationId: "org",
		festivalId: "fest",
		festivalClassId: "class-1",
		parentCustomerId,
		childId,
		checkoutIntentId: `intent-${id}`,
		shopifyOrderGid: `order-${id}`,
		shopifyOrderLineGid: `line-${id}`,
		paidAmountCents: 100,
		paidCurrencyCode: "USD",
		status: "confirmed",
		createdAt: "2027-02-05T00:00:00.000Z",
		updatedAt: "2027-02-05T00:00:00.000Z",
	};
}

function metadata(
	entitlementId: string,
	accompanistMembershipId: string | null,
): ClassRegistrationMetadata {
	return {
		id: `meta-${entitlementId}`,
		organizationId: "org",
		festivalId: "fest",
		checkoutIntentId: `intent-${entitlementId}`,
		classEntitlementId: entitlementId,
		teacherMembershipId: "teacher-mem",
		accompanistMembershipId,
		repertoireJson: [{ title: "t", composer: "c", durationSeconds: 120 }],
		repertoireItems: [],
		registrationSnapshot: null,
		createdAt: new Date("2027-02-01T00:00:00.000Z"),
	};
}

describe("loadSchedulingRoster", () => {
	it("joins metadata, child names, age snapshots, and accompanist grants without a batch metadata method", async () => {
		const childLookups: string[] = [];
		let grantLookups = 0;
		const metadataById = new Map([
			["e1", metadata("e1", "grant-1")],
			["e2", metadata("e2", "grant-missing")],
		]);
		const sources: SchedulingRosterSources = {
			entitlements: {
				async listClassEntitlements(filter) {
					expect(filter).toEqual({
						organizationId: "org",
						festivalId: "fest",
						status: "confirmed",
					});
					return [
						entitlement("e1", "child-1", "parent-1"),
						entitlement("e2", "child-2", "parent-1"),
						entitlement("e3", "child-1", "parent-1"),
					];
				},
			},
			registrations: {
				async getRegistrationMetadataByEntitlementId(_org, id) {
					return metadataById.get(id) ?? null;
				},
			},
			children: {
				async findChildrenByIds(_org, parentId, ids) {
					childLookups.push(`${parentId}:${[...ids].sort().join(",")}`);
					return ids.map((id) => ({
						id,
						organizationId: "org",
						parentCustomerId: parentId,
						displayName: id === "child-1" ? "Ada" : "Ben",
						createdAtIso: "2026-01-01T00:00:00.000Z",
					}));
				},
				async listChildAgeSnapshots(_org, childId) {
					return childId === "child-1"
						? [
								snapshot("s1", 10, "2027-01-01T00:00:00.000Z", {
									supersededAtIso: "2027-02-03T00:00:00.000Z",
								}),
								snapshot("s2", 11, "2027-02-03T00:00:00.000Z"),
							]
						: [];
				},
			},
			accompanists: {
				async listAccompanistMembershipGrants() {
					grantLookups += 1;
					return [
						{ id: "grant-1", customerId: "acc-customer" },
					] as AccompanistMembershipGrant[];
				},
			},
			availability: {
				async listAvailabilityForFestival() {
					return [];
				},
			},
		};
		const roster = await loadSchedulingRoster(sources, {
			organizationId: "org",
			festivalId: "fest",
		});
		expect(childLookups).toEqual(["parent-1:child-1,child-2"]);
		expect(grantLookups).toBe(1);
		expect(roster).toEqual([
			{
				entitlementId: "e1",
				festivalClassId: "class-1",
				childId: "child-1",
				childName: "Ada",
				ageAtRegistration: 10,
				teacherMembershipId: "teacher-mem",
				teacherName: null,
				accompanist: {
					membershipId: "grant-1",
					customerId: "acc-customer",
					name: null,
				},
				repertoireSeconds: 120,
				registeredAtIso: "2027-02-01T00:00:00.000Z",
			},
			expect.objectContaining({
				entitlementId: "e2",
				childName: "Ben",
				ageAtRegistration: null,
				accompanist: {
					membershipId: "grant-missing",
					customerId: null,
					name: null,
				},
			}),
			// No metadata: entitlement creation time decides the age snapshot.
			expect.objectContaining({
				entitlementId: "e3",
				ageAtRegistration: 11,
				teacherMembershipId: null,
				accompanist: null,
				repertoireSeconds: 0,
				registeredAtIso: "2027-02-05T00:00:00.000Z",
			}),
		]);
	});

	it("maps saved availability rows", async () => {
		const rows = await loadSchedulingAvailability(
			{
				availability: {
					async listAvailabilityForFestival() {
						return [
							{
								subjectType: "child",
								subjectId: "child-1",
								festivalDate: "2027-04-05",
								availableHours: [9, 10],
							},
						];
					},
				},
			},
			{ organizationId: "org", festivalId: "fest" },
		);
		expect(rows).toEqual([
			{
				subjectType: "child",
				subjectId: "child-1",
				festivalDate: "2027-04-05",
				availableHours: [9, 10],
			},
		]);
	});
});
