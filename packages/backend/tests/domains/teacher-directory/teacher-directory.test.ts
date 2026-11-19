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
import { sql } from "bun";
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
import { InMemoryOrganizationRepository } from "../../../src/repo/in-memory-organization-repository.js";
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
				findOrganizationBySlug: async (slug: string) =>
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
				listDivisions: async () => [
					{
						id: "11111111-1111-4111-8111-111111111111",
						organizationId: "org-1",
						displayName: "Piano",
						normalizedName: "piano",
						displayOrder: 0,
						isActive: true,
						createdAtIso: "2026-01-01T00:00:00.000Z",
						updatedAtIso: "2026-01-01T00:00:00.000Z",
					},
					{
						id: "22222222-2222-4222-8222-222222222222",
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
			products: {
				getAccompanistDivisionPolicy: async () => ({
					organizationId: "org-1",
					policy: "exactly_one",
					updatedAtIso: "2026-01-01T00:00:00.000Z",
				}),
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
									divisionId: "11111111-1111-4111-8111-111111111111",
									divisionNameSnapshot: "Piano",
									status: "active",
								} as EntitlementGrantSnapshot,
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
				getTeacherProfile: async (_o: string, cid: string) =>
					profiles.get(cid) ?? null,
				upsertTeacherProfile: async (input: {
					organizationId: string;
					customerId: string;
					displayName: string;
					publicDirectoryOptIn: boolean;
					divisionIds?: string[];
				}) => {
					const existing = profiles.get(input.customerId);
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
						division_ids: input.divisionIds ?? existing?.division_ids ?? [],
						created_at: "2026-01-01T00:00:00.000Z",
						updated_at: "2026-01-01T00:00:00.000Z",
					};
					profiles.set(input.customerId, rec);
					return rec;
				},
				updateTeacherProfileApproval: async (
					_o: string,
					_pid: string,
					status: TeacherProfileRecord["approval_status"],
				) => {
					const existing = profiles.get("cust-1");
					if (!existing) return null;
					const updated = { ...existing, approval_status: status };
					profiles.set("cust-1", updated);
					return updated;
				},
				updateTeacherProfileDivisions: async (
					_o: string,
					_pid: string,
					divisionIds: string[],
				) => {
					const existing = profiles.get("cust-1");
					if (!existing) return null;
					const updated = { ...existing, division_ids: divisionIds };
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
		} as unknown as ConstructorParameters<
			typeof ParticipantDirectoryService
		>[0]);
		service.onDomainEvent((e) => events.push(e));
		const tCtx = { orgSlug: "fest", sessionId: "s-1", csrfToken: "c" };
		const tBody = {
			displayName: "Prof. Lee",
			publicDirectoryOptIn: true,
		};

		await expect(
			service.upsertTeacherProfile(tCtx, tBody),
		).rejects.toMatchObject({
			status: 403,
			code: "active_membership_required",
		});

		activeGrant = true;
		await expect(
			service.upsertTeacherProfile(tCtx, {
				...tBody,
				divisionIds: ["11111111-1111-4111-8111-111111111111"],
			}),
		).rejects.toMatchObject({
			status: 400,
		});

		const created = await service.upsertTeacherProfile(tCtx, tBody);
		expect(created.approval_status).toBe("approved");
		expect(created.division_ids).toEqual([
			"11111111-1111-4111-8111-111111111111",
		]);
		expect(
			(await service.listTeacherProfiles("org-1", "admin"))[0]?.zip_code,
		).toBeUndefined();
		expect(
			(
				await service.updateTeacherProfileApproval(
					"org-1",
					"prof-1",
					{ approvalStatus: "rejected" },
					"admin",
				)
			).approval_status,
		).toBe("rejected");
		const updatedDivisions = await (
			service as unknown as {
				updateTeacherProfileDivisions: (
					organizationId: string,
					profileId: string,
					payload: { divisionIds: string[] },
					adminUserId?: string,
				) => Promise<TeacherProfileRecord>;
			}
		).updateTeacherProfileDivisions(
			"org-1",
			"prof-1",
			{ divisionIds: ["22222222-2222-4222-8222-222222222222"] },
			"admin",
		);
		expect(updatedDivisions.division_ids).toEqual([
			"22222222-2222-4222-8222-222222222222",
		]);
		expect(updatedDivisions.approval_status).toBe("rejected");
		expect(updatedDivisions.zip_code).toBeUndefined();
		const expectedEvent = {
			type: "TeacherDirectoryChanged",
			organizationId: "org-1",
			role: "teacher",
			profileId: "prof-1",
		};
		expect(events).toEqual([expectedEvent, expectedEvent, expectedEvent]);
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
					const created = {
						...input,
						id: "acc-1",
						status: "active",
						isCurrent: true,
						createdAtIso: "2026-09-12T12:00:00.000Z",
					} as AccompanistMembershipGrant;
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
			},
		});
		expect(res.membership.status).toBe("active");
		expect(busEvents).toEqual(["MembershipChanged"]);
		expect(localEvents).toEqual([
			{ type: "MembershipChanged", organizationId: "org-1" },
		]);
	});

	it("enforces #361 accompanist parity: active-grant opt-in gate, auto-approval, and sticky rejected status", async () => {
		const repo = new InMemoryOrganizationRepository(
			() => new Date("2026-06-01T12:00:00.000Z"),
		);
		const org = await repo.createOrganization({ name: "Fest", slug: "fest" });
		const div1 = await repo.createDivision({
			organizationId: org.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const div2 = await repo.createDivision({
			organizationId: org.id,
			displayName: "Strings",
			normalizedName: "strings",
		});
		let cid = "cust-acc-1";
		let hasActiveAccompanist = false;
		const service = new ParticipantDirectoryService({
			organizations: repo,
			directory: repo,
			entitlements: {
				listEntitlementGrantSnapshots: async () => [],
				findCurrentAccompanistMembershipGrant: async () =>
					hasActiveAccompanist
						? ({
								id: "acc-g1",
								organizationId: org.id,
								customerId: cid,
								status: "active",
								isCurrent: true,
							} as AccompanistMembershipGrant)
						: null,
			},
			customerAccess: {
				customerReadAccess: async () => ({
					organizationId: org.id,
					customerId: cid,
					sessionId: "s-acc",
				}),
				formAccess: async () => ({
					organizationId: org.id,
					organizationTimezone: "UTC",
					customerId: cid,
					name: "Ava",
					email: "acc@example.com",
					verifiedShopifyCustomerEmail: "acc@example.com",
				}),
			} as unknown as NonNullable<
				ConstructorParameters<
					typeof ParticipantDirectoryService
				>[0]["customerAccess"]
			>,
		});
		const ctx = { orgSlug: "fest", sessionId: "s-acc", csrfToken: "c" };
		const save = (
			displayName: string,
			publicDirectoryOptIn: boolean,
			divisionIds = [div1.id],
		) =>
			service.upsertAccompanistProfile(ctx, {
				displayName,
				publicDirectoryOptIn,
				divisionIds,
			});

		await expect(save("Ava", true)).rejects.toMatchObject({
			status: 403,
			code: "active_membership_required",
		});
		hasActiveAccompanist = true;
		const created = await save("Ava Accompanist", true);
		expect(created.approval_status).toBe("approved");
		expect(
			(await save("Ava Renamed", true, [div1.id, div2.id])).approval_status,
		).toBe("approved");

		hasActiveAccompanist = false;
		await expect(save("Ava Lapsed OptIn", true)).rejects.toMatchObject({
			status: 403,
			code: "active_membership_required",
		});
		expect(
			(await save("Ava Lapsed OptOut", false)).public_directory_opt_in,
		).toBe(false);

		hasActiveAccompanist = true;
		await service.updateAccompanistProfileApproval(
			org.id,
			created.id,
			{ approvalStatus: "rejected" },
			"admin",
		);
		expect((await save("Ava Renewed", true, [div2.id])).approval_status).toBe(
			"rejected",
		);

		cid = "cust-acc-2";
		expect((await save("Ben OptedOut", false)).approval_status).toBe("pending");
		expect((await save("Ben OptedOut", true)).approval_status).toBe("approved");
	});

	integrationTest(
		"persists teacher and accompanist profiles, products, and entitlements across split Postgres repositories",
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
				await new PostgresCustomerIntegrationRepository(
					schema,
				).upsertIntegration({
					organizationId: org.id,
					storefrontDomain: "dir-org.myshopify.com",
					clientId: "cid",
					encryptedClientSecret: "enc",
				});
				const sessions = new PostgresCustomerSessionRepository(schema);
				const now = new Date().toISOString();
				const mkCust = async (gid: string) =>
					(
						await sessions.createCustomerSession({
							sessionId: randomUUID(),
							organizationId: org.id,
							shopifyCustomerGid: gid,
							encryptedTokens: "tok",
							csrfToken: "csrf",
							integrationVersion: 1,
							createdAtIso: now,
							lastSeenAtIso: now,
							expiresAtIso: "2099-01-01T00:00:00.000Z",
						})
					).customer;
				const customer = await mkCust("gid://shopify/Customer/td1");
				const accCustomer = await mkCust("gid://shopify/Customer/td2");
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
				const startsOn = new Date(Date.now() - 86_400_000)
					.toISOString()
					.slice(0, 10);
				const endsOn = addCalendarDays(startsOn, 365);
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
					endsOn,
					status: "active",
					verifiedIdentityEmail: "teacher@example.com",
				});
				const accGrant = await entitlements.createAccompanistMembershipGrant({
					organizationId: org.id,
					customerId: accCustomer.id,
					normalizedEmail: "acc@example.com",
					offeringNameSnapshot: "Accompanist Membership",
					source: "accompanist_form",
					contact: {
						name: "Ava Accompanist",
						email: "acc@example.com",
						city: "Seattle",
						phone: "206-555-0100",
					},
					divisions: [{ divisionId: div.id, divisionName: div.displayName }],
					startsOn,
					endsOn,
				});
				const saved = await directory.upsertTeacherProfile({
					organizationId: org.id,
					customerId: customer.id,
					displayName: "Dr. Keys",
					publicDirectoryOptIn: true,
					divisionIds: [div.id],
				});
				expect(saved.approval_status).toBe("approved");
				const accSaved = await directory.upsertAccompanistProfile({
					organizationId: org.id,
					customerId: accCustomer.id,
					displayName: "Ava Accompanist",
					publicDirectoryOptIn: true,
					divisionIds: [div.id],
				});
				expect(accSaved.approval_status).toBe("approved");
				const listNames = async () =>
					(await directory.getPublicDirectoryProfiles(org.id)).map(
						(p) => p.displayName,
					);
				expect(await listNames()).toEqual(["Dr. Keys", "Ava Accompanist"]);

				await sql.unsafe(
					`UPDATE ${schema}.membership_entitlements SET superseded_on = CURRENT_DATE WHERE id = $1`,
					[accGrant.id],
				);
				expect(await listNames()).toEqual(["Dr. Keys"]);

				await directory.updateAccompanistProfileApproval(
					org.id,
					accSaved.id,
					"rejected",
				);
				const stillRejected = await directory.upsertAccompanistProfile({
					organizationId: org.id,
					customerId: accCustomer.id,
					displayName: "Ava Edited",
					publicDirectoryOptIn: true,
					divisionIds: [div.id],
				});
				expect(stillRejected.approval_status).toBe("rejected");
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
