import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type {
	AccompanistMembershipGrant,
	EntitlementGrantSnapshot,
	TeacherProfileRecord,
} from "@festival/common";
import {
	addCalendarDays,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import {
	PostgresCustomerIntegrationRepository,
	PostgresCustomerSessionRepository,
} from "../../../src/domains/customer-identity/index.js";
import {
	MembershipEntitlementService,
	ParticipantDirectoryService,
	PostgresMembershipEntitlementRepository,
	PostgresMembershipProductRepository,
	PostgresTeacherDirectoryRepository,
} from "../../../src/domains/teacher-directory/index.js";
import { DomainCacheInvalidator } from "../../../src/lib/domain-cache-invalidator.js";
import { PostgresOrganizationRepository } from "../../../src/repo/postgres-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("dom_teacher_dir");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

describe("domains/teacher-directory", () => {
	it("enforces #361 opt-in rules, preserves admin customerAccess this-binding, and emits TeacherDirectoryChanged", async () => {
		const profiles = new Map<string, TeacherProfileRecord>();
		let activeGrant = false;
		const invalidator = new DomainCacheInvalidator();
		const events: unknown[] = [];

		const service = new ParticipantDirectoryService({
			cacheInvalidator: invalidator,
			organizations: {
				findOrganizationBySlug: async (slug) =>
					slug === "fest"
						? {
								id: "org-1",
								slug: "fest",
								name: "Festival",
								timezone: "UTC",
								defaultCurrencyCode: "USD",
								createdAtIso: "2026-01-01T00:00:00.000Z",
							}
						: null,
			},
			entitlements: {
				listEntitlementGrantSnapshots: async (): Promise<
					EntitlementGrantSnapshot[]
				> =>
					activeGrant
						? [
								{
									id: "g-1",
									organizationId: "org-1",
									customerId: "cust-1",
									entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
									offeringId: "off-1",
									durationDays: 365,
									divisionId: "div-1",
									divisionNameSnapshot: "Piano",
									paidAmount: "50.00",
									paidCurrencyCode: "USD",
									checkoutIntentId: "ci-1",
									shopifyOrderGid: "gid://shopify/Order/1",
									shopifyOrderLineGid: "gid://shopify/Line/1",
									startsOn: "2026-01-01",
									endsOn: "2027-01-01",
									status: "active",
									createdAtIso: "2026-01-01T00:00:00.000Z",
								},
							]
						: [],
				findCurrentAccompanistMembershipGrant: async () => null,
			},
			customerAccess: {
				customerReadAccess: async () => ({
					organizationId: "org-1",
					customerId: "cust-1",
					sessionId: "s-1",
				}),
				formAccess: async () => ({
					organizationId: "org-1",
					organizationTimezone: "UTC",
					customerId: "cust-1",
					name: "Teacher",
					email: "t@example.com",
					verifiedShopifyCustomerEmail: "t@example.com",
				}),
				async findAdminCustomerProfile(this: { consented?: boolean }) {
					return this.consented
						? {
								customerId: "cust-1",
								profile: {
									name: "Teacher",
									email: "t@example.com",
									mailingAddress: { postalCode: "98101" },
									phone: "",
									updatedAtIso: "2026-01-01T00:00:00.000Z",
								},
							}
						: null;
				},
			} as unknown as NonNullable<
				ConstructorParameters<
					typeof ParticipantDirectoryService
				>[0]["customerAccess"]
			>,
			directory: {
				getTeacherProfile: async (_o, cid) => profiles.get(cid) ?? null,
				upsertTeacherProfile: async (input) => {
					const rec: TeacherProfileRecord = {
						id: "prof-1",
						organization_id: input.organizationId,
						customer_id: input.customerId,
						display_name: input.displayName,
						teacher_color: "#2563EB",
						public_directory_opt_in: input.publicDirectoryOptIn,
						approval_status: input.publicDirectoryOptIn
							? "approved"
							: "pending",
						zip_code: "98101",
						division_ids: input.divisionIds,
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					};
					profiles.set(input.customerId, rec);
					return rec;
				},
				updateTeacherProfileApproval: async (_o, _pid, status) => {
					const existing = profiles.get("cust-1");
					if (!existing) return null;
					const updated = { ...existing, approval_status: status };
					profiles.set("cust-1", updated);
					return updated;
				},
				listTeacherProfiles: async () => [...profiles.values()],
				getAccompanistProfile: async () => null,
				upsertAccompanistProfile: async () => {
					throw new Error("unused");
				},
				updateAccompanistProfileApproval: async () => null,
				listAccompanistProfiles: async () => [],
				getPublicDirectoryProfiles: async () => [],
			},
		});
		service.onDomainEvent((e) => events.push(e));

		await expect(
			service.upsertTeacherProfile(
				{ orgSlug: "fest", sessionId: "s-1", csrfToken: "c" },
				{
					displayName: "Prof. Lee",
					publicDirectoryOptIn: true,
					divisionIds: ["11111111-1111-4111-8111-111111111111"],
				},
			),
		).rejects.toMatchObject({
			status: 403,
			code: "active_membership_required",
		});

		activeGrant = true;
		const saved = await service.upsertTeacherProfile(
			{ orgSlug: "fest", sessionId: "s-1", csrfToken: "c" },
			{
				displayName: "Prof. Lee",
				publicDirectoryOptIn: true,
				divisionIds: ["11111111-1111-4111-8111-111111111111"],
			},
		);
		expect(saved.approval_status).toBe("approved");

		const unconsentedList = await service.listTeacherProfiles("org-1", "admin");
		expect(unconsentedList[0]?.zip_code).toBeUndefined();

		const toggled = await service.updateTeacherProfileApproval(
			"org-1",
			"prof-1",
			{ approvalStatus: "rejected" },
			"admin",
		);
		expect(toggled.approval_status).toBe("rejected");
		expect(events).toEqual([
			{
				type: "TeacherDirectoryChanged",
				organizationId: "org-1",
				role: "teacher",
				profileId: "prof-1",
			},
			{
				type: "TeacherDirectoryChanged",
				organizationId: "org-1",
				role: "teacher",
				profileId: "prof-1",
			},
		]);
	});

	it("emits MembershipChanged on accompanist acquisition via DomainCacheInvalidator and local listener", async () => {
		const invalidator = new DomainCacheInvalidator();
		const busEvents: string[] = [];
		const localEvents: unknown[] = [];
		invalidator.subscribe((e) => busEvents.push(e.type));

		const grants: AccompanistMembershipGrant[] = [];
		const service = new MembershipEntitlementService({
			now: () => new Date("2026-09-12T12:00:00.000Z"),
			cacheInvalidator: invalidator,
			organizations: {
				getOrganizationTimezone: async () => "UTC",
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
			products: {
				findMembershipProductRecordByClass: async () => null,
				listMembershipProductRecords: async () => [],
				getAccompanistDivisionPolicy: async () => ({
					organizationId: "org-1",
					policy: "one_to_all",
					updatedAtIso: "2026-01-01T00:00:00.000Z",
				}),
			},
			entitlements: {
				listEntitlementGrantSnapshots: async () => [],
				findMembershipCustomerContacts: async () => new Map(),
				listAccompanistMembershipGrants: async () => grants,
				createAccompanistMembershipGrant: async (input) => {
					const created: AccompanistMembershipGrant = {
						...input,
						id: "acc-1",
						status: "active",
						isCurrent: true,
						createdAtIso: "2026-09-12T12:00:00.000Z",
					};
					grants.push(created);
					return created;
				},
			},
		});
		service.onDomainEvent((e) => localEvents.push(e));

		const res = await service.acquireAccompanistMembership({
			organizationId: "org-1",
			organizationTimezone: "UTC",
			customerId: "cust-1",
			verifiedShopifyCustomerEmail: "shopper@example.com",
			payload: {
				name: "Ava Piano",
				email: "ava@example.com",
				city: "Seattle",
				phone: "+1 206 555 0100",
				divisionIds: ["div-piano"],
				staffAccessConsent: true,
			},
		});
		expect(res.membership.status).toBe("active");
		expect(busEvents).toEqual(["MembershipChanged"]);
		expect(localEvents).toEqual([
			{ type: "MembershipChanged", organizationId: "org-1" },
		]);
	});

	integrationTest(
		"persists teacher profiles, products, and entitlements across split Postgres repositories",
		async () => {
			const schema = await currentSchema();
			try {
				const orgRepo = new PostgresOrganizationRepository(schema);
				const org = await orgRepo.createOrganization({
					name: "Dir Org",
					slug: "dir-org",
				});
				const div = await orgRepo.createDivision({
					organizationId: org.id,
					displayName: "Piano",
					normalizedName: "piano",
				});
				const integrations = new PostgresCustomerIntegrationRepository(schema);
				const sessions = new PostgresCustomerSessionRepository(schema);
				await integrations.upsertIntegration({
					organizationId: org.id,
					storefrontDomain: "dir-org.myshopify.com",
					clientId: "cid",
					encryptedClientSecret: "enc",
				});
				const now = new Date().toISOString();
				const { customer } = await sessions.createCustomerSession({
					sessionId: randomUUID(),
					organizationId: org.id,
					shopifyCustomerGid: "gid://shopify/Customer/td1",
					encryptedTokens: "tok",
					csrfToken: "csrf",
					integrationVersion: 1,
					createdAtIso: now,
					lastSeenAtIso: now,
					expiresAtIso: "2099-01-01T00:00:00.000Z",
				});
				const directory = new PostgresTeacherDirectoryRepository(schema);
				const products = new PostgresMembershipProductRepository(schema);
				const entitlements = new PostgresMembershipEntitlementRepository(
					schema,
				);

				const offering = await products.createMembershipProductRecord({
					organizationId: org.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/td1",
					shopifyVariantGid: "gid://shopify/ProductVariant/td1",
					productNameSnapshot: "Teacher Membership",
				});
				const startsOn = new Date(Date.now() - 10 * 86_400_000)
					.toISOString()
					.slice(0, 10);
				await entitlements.createEntitlementGrantSnapshot({
					organizationId: org.id,
					customerId: customer.id,
					entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
					offeringId: offering.id,
					durationDays: 365,
					divisionId: div.id,
					divisionNameSnapshot: div.displayName,
					paidAmount: "75.00",
					paidCurrencyCode: "USD",
					checkoutIntentId: "intent-td-1",
					shopifyOrderGid: "gid://shopify/Order/td-1",
					shopifyOrderLineGid: "gid://shopify/LineItem/td-1",
					startsOn,
					endsOn: addCalendarDays(startsOn, 365),
					status: "active",
					verifiedIdentityEmail: "teacher@example.com",
				});
				const saved = await directory.upsertTeacherProfile({
					organizationId: org.id,
					customerId: customer.id,
					displayName: "Dr. Keys",
					publicDirectoryOptIn: true,
					divisionIds: [div.id],
				});
				expect(saved.approval_status).toBe("approved");
				const publicList = await directory.getPublicDirectoryProfiles(org.id);
				expect(publicList.map((p) => p.displayName)).toEqual(["Dr. Keys"]);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
