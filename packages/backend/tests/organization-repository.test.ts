import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

describe("InMemoryOrganizationRepository currency and findOrganizationById", () => {
	it("defaults defaultCurrencyCode to USD when creating an organization", async () => {
		const repo = new InMemoryOrganizationRepository();
		const org = await repo.createOrganization({
			name: "Test Organization",
			slug: "test-org",
		});

		expect(org.defaultCurrencyCode).toBe("USD");
		expect(org.id).toBeDefined();

		const found = await repo.findOrganizationById(org.id);
		expect(found).toEqual(org);
	});

	it("uses provided defaultCurrencyCode when creating an organization", async () => {
		const repo = new InMemoryOrganizationRepository();
		const org = await repo.createOrganization({
			name: "Canadian Music Festival",
			slug: "cad-festival",
			defaultCurrencyCode: "CAD",
		});

		expect(org.defaultCurrencyCode).toBe("CAD");

		const found = await repo.findOrganizationById(org.id);
		expect(found).toEqual(org);
	});

	it("returns null when findOrganizationById is called with unknown id", async () => {
		const repo = new InMemoryOrganizationRepository();
		const found = await repo.findOrganizationById("non-existent-id");
		expect(found).toBeNull();
	});
});

describe("PostgresOrganizationRepository currency and findOrganizationById", () => {
	let repo: PostgresOrganizationRepository;
	let unsafeSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		repo = new PostgresOrganizationRepository("test_schema");
		spyOn(repo, "ensureReady").mockResolvedValue();
		unsafeSpy = spyOn(sql, "unsafe");
	});

	afterEach(() => {
		unsafeSpy.mockRestore();
	});

	it("findOrganizationById queries by id and maps default_currency_code", async () => {
		const dbRow = {
			id: "org-123",
			name: "Vancouver Music Fest",
			slug: "van-fest",
			timezone: "America/Vancouver",
			default_currency_code: "CAD",
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([dbRow]);

		const org = await repo.findOrganizationById("org-123");
		expect(org).not.toBeNull();
		expect(org?.id).toBe("org-123");
		expect(org?.defaultCurrencyCode).toBe("CAD");
		expect(org?.timezone).toBe("America/Vancouver");
		expect(unsafeSpy).toHaveBeenCalledWith(
			expect.stringContaining("WHERE id = $1"),
			["org-123"],
		);
	});

	it("findOrganizationById returns null when not found", async () => {
		unsafeSpy.mockResolvedValueOnce([]);

		const org = await repo.findOrganizationById("missing-id");
		expect(org).toBeNull();
	});

	it("falls back to USD if default_currency_code is null or undefined", async () => {
		const dbRow = {
			id: "org-legacy",
			name: "Legacy Org",
			slug: "legacy-org",
			timezone: "UTC",
			default_currency_code: null,
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([dbRow]);

		const org = await repo.findOrganizationById("org-legacy");
		expect(org).not.toBeNull();
		expect(org?.defaultCurrencyCode).toBe("USD");
	});

	it("createOrganization passes defaultCurrencyCode and returns mapped record", async () => {
		const returnedRow = {
			id: "new-org-id",
			name: "UK Festival",
			slug: "uk-fest",
			timezone: "UTC",
			default_currency_code: "GBP",
			created_at: "2026-01-01T00:00:00.000Z",
		};
		unsafeSpy.mockResolvedValueOnce([returnedRow]);

		const org = await repo.createOrganization({
			name: "UK Festival",
			slug: "uk-fest",
			defaultCurrencyCode: "GBP",
		});

		expect(org.defaultCurrencyCode).toBe("GBP");
		expect(unsafeSpy).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO test_schema.organizations"),
			expect.arrayContaining(["UK Festival", "uk-fest", "GBP"]),
		);
	});
});

describe("InMemoryOrganizationRepository targeted membership grant lookups", () => {
	const fixedNow = new Date("2026-09-21T12:00:00.000Z");

	async function setupRepo() {
		const repo = new InMemoryOrganizationRepository(() => fixedNow);
		const org = await repo.createOrganization({
			name: "Lookup Test Org",
			slug: "lookup-test-org",
		});
		const div1 = await repo.createDivision({
			organizationId: org.id,
			displayName: "Junior Piano",
			normalizedName: "junior piano",
		});
		const div2 = await repo.createDivision({
			organizationId: org.id,
			displayName: "Senior Strings",
			normalizedName: "senior strings",
		});
		const teacherOffering = await repo.createMembershipProductRecord({
			organizationId: org.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/t1",
			shopifyVariantGid: "gid://shopify/ProductVariant/tv1",
			productNameSnapshot: "Teacher Membership",
		});
		return { repo, org, div1, div2, teacherOffering };
	}

	it("findActiveTeacherEntitlementGrant returns active teacher_membership grant and null for wrong division, customer, org, expired, revoked, scheduled, or accompanist", async () => {
		const { repo, org, div1, div2, teacherOffering } = await setupRepo();

		await repo.createAccompanistMembershipGrant({
			organizationId: org.id,
			customerId: "acc-only",
			normalizedEmail: "acc@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Acc",
				email: "acc@example.com",
				city: "Seattle",
				phone: "555-0100",
			},
			divisions: [{ divisionId: div1.id, divisionName: div1.displayName }],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "acc-only",
				divisionId: div1.id,
			}),
		).toBeNull();

		await repo.createEntitlementGrantSnapshot({
			organizationId: org.id,
			customerId: "teacher-expired",
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: div1.id,
			divisionNameSnapshot: div1.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-exp",
			shopifyOrderGid: "gid://shopify/Order/exp",
			shopifyOrderLineGid: "gid://shopify/LineItem/exp",
			startsOn: "2025-01-01",
			endsOn: "2026-01-01",
			status: "expired",
			verifiedIdentityEmail: "expired@example.com",
		});
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "teacher-expired",
				divisionId: div1.id,
			}),
		).toBeNull();

		await repo.createEntitlementGrantSnapshot({
			organizationId: org.id,
			customerId: "teacher-scheduled",
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: div1.id,
			divisionNameSnapshot: div1.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-sched",
			shopifyOrderGid: "gid://shopify/Order/sched",
			shopifyOrderLineGid: "gid://shopify/LineItem/sched",
			startsOn: "2027-01-01",
			endsOn: "2028-01-01",
			status: "scheduled",
			verifiedIdentityEmail: "scheduled@example.com",
		});
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "teacher-scheduled",
				divisionId: div1.id,
			}),
		).toBeNull();

		const activeGrant = await repo.createEntitlementGrantSnapshot({
			organizationId: org.id,
			customerId: "teacher-1",
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: div1.id,
			divisionNameSnapshot: div1.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-act",
			shopifyOrderGid: "gid://shopify/Order/act",
			shopifyOrderLineGid: "gid://shopify/LineItem/act",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "teacher1@example.com",
		});

		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "teacher-1",
				divisionId: div1.id,
			}),
		).toEqual(activeGrant);

		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "teacher-1",
				divisionId: div2.id,
			}),
		).toBeNull();
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "other-teacher",
				divisionId: div1.id,
			}),
		).toBeNull();
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: "other-org",
				customerId: "teacher-1",
				divisionId: div1.id,
			}),
		).toBeNull();

		await repo.revokeEntitlement({
			organizationId: org.id,
			entitlementId: activeGrant.id,
			actorUserId: "admin-1",
			reason: "Revoked",
			revokedAtIso: fixedNow.toISOString(),
		});
		expect(
			await repo.findActiveTeacherEntitlementGrant({
				organizationId: org.id,
				customerId: "teacher-1",
				divisionId: div1.id,
			}),
		).toBeNull();
	});

	it("findActiveTeacherEntitlementGrant selects deterministically by earliest createdAtIso then id when multiple active grants match", async () => {
		const { repo, org, div1, teacherOffering } = await setupRepo();
		const baseGrant = await repo.createEntitlementGrantSnapshot({
			organizationId: org.id,
			customerId: "teacher-multi",
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: div1.id,
			divisionNameSnapshot: div1.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-m1",
			shopifyOrderGid: "gid://shopify/Order/m1",
			shopifyOrderLineGid: "gid://shopify/LineItem/m1",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "multi@example.com",
		});

		const internalGrants = (
			repo as unknown as {
				entitlementGrants: Map<string, Record<string, unknown>>;
			}
		).entitlementGrants;
		internalGrants.clear();
		internalGrants.set("grant-b", {
			...baseGrant,
			id: "grant-b",
			createdAtIso: "2026-02-01T00:00:00.000Z",
		});
		internalGrants.set("grant-c", {
			...baseGrant,
			id: "grant-c",
			createdAtIso: "2026-01-15T00:00:00.000Z",
		});
		internalGrants.set("grant-a", {
			...baseGrant,
			id: "grant-a",
			createdAtIso: "2026-01-15T00:00:00.000Z",
		});

		const found = await repo.findActiveTeacherEntitlementGrant({
			organizationId: org.id,
			customerId: "teacher-multi",
			divisionId: div1.id,
		});
		expect(found?.id).toBe("grant-a");
	});

	it("findCurrentAccompanistMembershipGrant returns current accompanist grant, null for expired/revoked or teacher grant, and orders deterministically", async () => {
		const { repo, org, div1, teacherOffering } = await setupRepo();

		await repo.createEntitlementGrantSnapshot({
			organizationId: org.id,
			customerId: "acc-1",
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: div1.id,
			divisionNameSnapshot: div1.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "intent-t-only",
			shopifyOrderGid: "gid://shopify/Order/t-only",
			shopifyOrderLineGid: "gid://shopify/LineItem/t-only",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "acc1@example.com",
		});
		expect(
			await repo.findCurrentAccompanistMembershipGrant({
				organizationId: org.id,
				customerId: "acc-1",
			}),
		).toBeNull();

		await repo.createAccompanistMembershipGrant({
			organizationId: org.id,
			customerId: "acc-expired",
			normalizedEmail: "accexp@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Expired Acc",
				email: "accexp@example.com",
				city: "Seattle",
				phone: "555-0101",
			},
			divisions: [{ divisionId: div1.id, divisionName: div1.displayName }],
			startsOn: "2025-01-01",
			endsOn: "2026-01-01",
		});
		expect(
			await repo.findCurrentAccompanistMembershipGrant({
				organizationId: org.id,
				customerId: "acc-expired",
			}),
		).toBeNull();

		const currentGrant = await repo.createAccompanistMembershipGrant({
			organizationId: org.id,
			customerId: "acc-1",
			normalizedEmail: "acc1@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Active Acc",
				email: "acc1@example.com",
				city: "Seattle",
				phone: "555-0102",
			},
			divisions: [{ divisionId: div1.id, divisionName: div1.displayName }],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});

		expect(
			await repo.findCurrentAccompanistMembershipGrant({
				organizationId: org.id,
				customerId: "acc-1",
			}),
		).toEqual(currentGrant);

		await repo.revokeEntitlement({
			organizationId: org.id,
			entitlementId: currentGrant.id,
			actorUserId: "admin-1",
			reason: "Revoked acc",
			revokedAtIso: fixedNow.toISOString(),
		});
		expect(
			await repo.findCurrentAccompanistMembershipGrant({
				organizationId: org.id,
				customerId: "acc-1",
			}),
		).toBeNull();

		const internalAccGrants = (
			repo as unknown as {
				accompanistMembershipGrants: Map<string, Record<string, unknown>>;
			}
		).accompanistMembershipGrants;
		internalAccGrants.clear();
		internalAccGrants.set("acc-grant-z", {
			...currentGrant,
			id: "acc-grant-z",
			customerId: "acc-multi",
			createdAtIso: "2026-01-10T00:00:00.000Z",
		});
		internalAccGrants.set("acc-grant-a", {
			...currentGrant,
			id: "acc-grant-a",
			customerId: "acc-multi",
			createdAtIso: "2026-01-10T00:00:00.000Z",
		});
		const foundMulti = await repo.findCurrentAccompanistMembershipGrant({
			organizationId: org.id,
			customerId: "acc-multi",
		});
		expect(foundMulti?.id).toBe("acc-grant-a");
	});
});
