import { describe, expect, it } from "bun:test";
import type { EntitlementGrantSnapshot } from "@festival/common";
import {
	MembershipEntitlementService,
	type MembershipEntitlementServiceDeps,
} from "../src/domains/teacher-directory/index.js";

function createEntitlementGrant(
	overrides: Partial<EntitlementGrantSnapshot>,
): EntitlementGrantSnapshot {
	return {
		id: "grant-1",
		organizationId: "org-1",
		customerId: "cust-1",
		entitlementClass: "teacher_membership",
		offeringId: "off-1",
		durationDays: 365,
		divisionId: "div-piano",
		divisionNameSnapshot: "Piano",
		paidAmount: "75.00",
		paidCurrencyCode: "USD",
		checkoutIntentId: "intent-1",
		shopifyOrderGid: "gid://shopify/Order/1",
		shopifyOrderLineGid: "gid://shopify/LineItem/1",
		startsOn: "2026-08-14",
		endsOn: "2027-08-14",
		status: "active",
		createdAtIso: "2026-08-14T12:00:00.000Z",
		...overrides,
	};
}

function createDeps(
	now: Date,
	grants: EntitlementGrantSnapshot[],
	decisions: Array<{ status: string }> = [],
): MembershipEntitlementServiceDeps {
	return {
		now: () => now,
		organizations: {
			getOrganizationTimezone: async () => "America/Los_Angeles",
			listDivisions: async () => [],
		},
		entitlements: {
			listEntitlementGrantSnapshots: async (_orgId, customerId) =>
				grants.filter(
					(grant) => !customerId || grant.customerId === customerId,
				),
			findMembershipCustomerContacts: async () => new Map(),
			createAccompanistMembershipGrant: async () => {
				throw new Error("Unexpected call");
			},
			listAccompanistMembershipGrants: async () => [],
		},
		products: {
			findMembershipProductRecordByClass: async () => ({
				id: "off-1",
				organizationId: "org-1",
				productCategory: "membership",
				entitlementClass: "teacher_membership",
				durationDays: 365,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				productNameSnapshot: "Teacher Membership",
				createdAtIso: "2026-01-01T00:00:00.000Z",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			}),
			listMembershipProductRecords: async () => [],
			getAccompanistDivisionPolicy: async () => ({
				organizationId: "org-1",
				policy: "one_to_all",
				updatedAtIso: "2026-01-01T00:00:00.000Z",
			}),
		},
		commerce: {
			listCustomerDecisions: async () => decisions,
		},
	};
}

describe("MembershipEntitlementService.listCustomerMembershipStatus", () => {
	it("maps supersededOn for superseded grants and null for non-superseded grants", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const grants = [
			createEntitlementGrant({
				id: "grant-prior",
				paidAmount: "75.00",
				checkoutIntentId: "intent-prior",
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				supersededOn: "2027-07-20",
				status: "superseded",
			}),
			createEntitlementGrant({
				id: "grant-renewed",
				paidAmount: "85.00",
				checkoutIntentId: "intent-renewed",
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				status: "active",
			}),
		];

		const service = new MembershipEntitlementService(createDeps(now, grants));
		const response = await service.listCustomerMembershipStatus(
			"org-1",
			"cust-1",
		);

		expect(response.memberships).toEqual([
			{
				status: "superseded",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Piano",
				paidAmount: "75.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				supersededOn: "2027-07-20",
			},
			{
				status: "active",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				divisionName: "Piano",
				paidAmount: "85.00",
				paidCurrencyCode: "USD",
				durationDays: 365,
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				supersededOn: null,
			},
		]);
	});

	it("maps validation states alongside grants", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const service = new MembershipEntitlementService(
			createDeps(
				now,
				[],
				[
					{ status: "pending_validation" },
					{ status: "rejected" },
					{ status: "needs_review" },
				],
			),
		);
		const response = await service.listCustomerMembershipStatus(
			"org-1",
			"cust-1",
		);
		expect(response.memberships).toEqual([
			{
				status: "processing",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
			},
			{
				status: "rejected",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				reasonCode: "validation_rejected",
			},
			{
				status: "needs_review",
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				reasonCode: "validation_needs_review",
			},
		]);
	});
});
