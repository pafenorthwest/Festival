import { describe, expect, it } from "bun:test";
import type {
	EntitlementGrantSnapshot,
	TeacherProfileRecord,
} from "@festival/common";
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

	it("resolves active teacher_membership divisionName from teacher profile while preserving historical snapshots on superseded, expired, and revoked entries", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const grants = [
			createEntitlementGrant({
				id: "grant-expired",
				checkoutIntentId: "intent-expired",
				startsOn: "2024-08-14",
				endsOn: "2025-08-14",
				status: "expired",
			}),
			createEntitlementGrant({
				id: "grant-revoked",
				checkoutIntentId: "intent-revoked",
				startsOn: "2025-08-14",
				endsOn: "2026-08-14",
				status: "revoked",
			}),
			createEntitlementGrant({
				id: "grant-superseded",
				checkoutIntentId: "intent-superseded",
				startsOn: "2026-08-14",
				endsOn: "2027-08-14",
				supersededOn: "2027-07-20",
				status: "superseded",
			}),
			createEntitlementGrant({
				id: "grant-active",
				checkoutIntentId: "intent-active",
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				status: "active",
			}),
		];
		const profile: TeacherProfileRecord = {
			id: "prof-1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: "Prof. Lee",
			teacher_color: "#2563EB",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["div-strings"],
			created_at: "2026-08-14T12:00:00.000Z",
			updated_at: "2027-07-20T12:00:00.000Z",
		};
		const baseDeps = createDeps(now, grants);
		const service = new MembershipEntitlementService({
			...baseDeps,
			organizations: {
				...baseDeps.organizations,
				listDivisions: async () => [
					{
						id: "div-piano",
						organizationId: "org-1",
						displayName: "Piano",
						normalizedName: "piano",
						displayOrder: 0,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
					{
						id: "div-strings",
						organizationId: "org-1",
						displayName: "Strings",
						normalizedName: "strings",
						displayOrder: 1,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
				],
			},
			directory: {
				getTeacherProfile: async () => profile,
				listTeacherProfiles: async () => [profile],
			},
		} as unknown as MembershipEntitlementServiceDeps);

		const response = await service.listCustomerMembershipStatus(
			"org-1",
			"cust-1",
		);
		expect(
			response.memberships.map((entry) => ({
				status: entry.status,
				divisionName: "divisionName" in entry ? entry.divisionName : undefined,
			})),
		).toEqual([
			{ status: "expired", divisionName: "Piano" },
			{ status: "revoked", divisionName: "Piano" },
			{ status: "superseded", divisionName: "Piano" },
			{ status: "active", divisionName: "Strings" },
		]);
	});

	it("falls back to grant.divisionNameSnapshot on active teacher_membership when getTeacherProfile returns null", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const grants = [
			createEntitlementGrant({
				id: "grant-active",
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				status: "active",
			}),
		];
		const baseDeps = createDeps(now, grants);
		const service = new MembershipEntitlementService({
			...baseDeps,
			organizations: {
				...baseDeps.organizations,
				listDivisions: async () => [
					{
						id: "div-piano",
						organizationId: "org-1",
						displayName: "Piano",
						normalizedName: "piano",
						displayOrder: 0,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
				],
			},
			directory: {
				getTeacherProfile: async () => null,
				listTeacherProfiles: async () => [],
			},
		} as unknown as MembershipEntitlementServiceDeps);

		const response = await service.listCustomerMembershipStatus(
			"org-1",
			"cust-1",
		);
		expect(response.memberships).toMatchObject([
			{
				status: "active",
				divisionName: "Piano",
			},
		]);
	});
});

describe("MembershipEntitlementService.listCurrentRoster", () => {
	it("resolves active Teacher roster entry divisions from teacher profile", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const grants = [
			createEntitlementGrant({
				id: "grant-1",
				customerId: "cust-1",
				divisionId: "div-piano",
				divisionNameSnapshot: "Piano",
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				status: "active",
			}),
		];
		const profile: TeacherProfileRecord = {
			id: "prof-1",
			organization_id: "org-1",
			customer_id: "cust-1",
			display_name: "Prof. Lee",
			teacher_color: "#2563EB",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["div-strings"],
			created_at: "2026-08-14T12:00:00.000Z",
			updated_at: "2027-07-20T12:00:00.000Z",
		};
		const baseDeps = createDeps(now, grants);
		const service = new MembershipEntitlementService({
			...baseDeps,
			organizations: {
				...baseDeps.organizations,
				listDivisions: async () => [
					{
						id: "div-piano",
						organizationId: "org-1",
						displayName: "Piano",
						normalizedName: "piano",
						displayOrder: 0,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
					{
						id: "div-strings",
						organizationId: "org-1",
						displayName: "Strings",
						normalizedName: "strings",
						displayOrder: 1,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
				],
			},
			directory: {
				getTeacherProfile: async () => profile,
				listTeacherProfiles: async () => [profile],
			},
		} as unknown as MembershipEntitlementServiceDeps);

		const { roster } = await service.listCurrentRoster("org-1");
		expect(roster).toHaveLength(1);
		expect(roster[0]?.divisions).toEqual([
			{ divisionId: "div-strings", divisionName: "Strings" },
		]);
	});

	it("falls back to grant snapshot when no teacher_profiles row exists for teacher customer", async () => {
		const now = new Date("2027-07-25T18:00:00.000Z");
		const grants = [
			createEntitlementGrant({
				id: "grant-1",
				customerId: "cust-1",
				divisionId: "div-piano",
				divisionNameSnapshot: "Piano",
				startsOn: "2027-07-20",
				endsOn: "2028-08-13",
				status: "active",
			}),
		];
		const baseDeps = createDeps(now, grants);
		const service = new MembershipEntitlementService({
			...baseDeps,
			organizations: {
				...baseDeps.organizations,
				listDivisions: async () => [
					{
						id: "div-piano",
						organizationId: "org-1",
						displayName: "Piano",
						normalizedName: "piano",
						displayOrder: 0,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
				],
			},
			directory: {
				getTeacherProfile: async () => null,
				listTeacherProfiles: async () => [],
			},
		} as unknown as MembershipEntitlementServiceDeps);

		const { roster } = await service.listCurrentRoster("org-1");
		expect(roster).toHaveLength(1);
		expect(roster[0]?.divisions).toEqual([
			{ divisionId: "div-piano", divisionName: "Piano" },
		]);
	});
});
