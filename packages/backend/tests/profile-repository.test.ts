import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	addCalendarDays,
	FORBIDDEN_PUBLIC_DIRECTORY_FIELDS,
	getDeterministicTeacherColor,
	type ProfileApprovalStatus,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validatePublicDirectoryProfileDto,
} from "@festival/common";
import { sql } from "bun";
import {
	PostgresCustomerIntegrationRepository,
	PostgresCustomerSessionRepository,
} from "../src/domains/customer-identity/index.js";
import {
	PostgresMembershipEntitlementRepository,
	PostgresMembershipProductRepository,
	PostgresTeacherDirectoryRepository,
} from "../src/domains/teacher-directory/index.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const VALID_DIV_1 = "11111111-1111-4111-8111-111111111111";
const VALID_DIV_2 = "22222222-2222-4222-8222-222222222222";
const currentSchema = currentPostgresFixture("prof_repo");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? it : it.skip;

async function setupDirectoryFixture(schema: string) {
	const orgRepo = new PostgresOrganizationRepository(schema);
	const integrations = new PostgresCustomerIntegrationRepository(schema);
	const sessions = new PostgresCustomerSessionRepository(schema);
	const directory = new PostgresTeacherDirectoryRepository(schema);
	const products = new PostgresMembershipProductRepository(schema);
	const entitlements = new PostgresMembershipEntitlementRepository(schema);
	const orgA = await orgRepo.createOrganization({
		name: "Festival Org A",
		slug: "org-a",
	});
	await integrations.upsertIntegration({
		organizationId: orgA.id,
		storefrontDomain: "org-a.myshopify.com",
		clientId: "cid",
		encryptedClientSecret: "enc",
	});
	const orgB = await orgRepo.createOrganization({
		name: "Festival Org B",
		slug: "org-b",
	});
	const div1 = await orgRepo.createDivision({
		organizationId: orgA.id,
		displayName: "Strings",
		normalizedName: "strings",
	});
	const div2 = await orgRepo.createDivision({
		organizationId: orgA.id,
		displayName: "Piano",
		normalizedName: "piano",
	});
	const foreignDiv = await orgRepo.createDivision({
		organizationId: orgB.id,
		displayName: "Foreign Winds",
		normalizedName: "foreign winds",
	});
	const offering = await products.createMembershipProductRecord({
		organizationId: orgA.id,
		entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		productNameSnapshot: "Teacher Membership",
		durationDays: 365,
		shopifyProductGid: "gid://shopify/Product/prof-shared",
		shopifyVariantGid: "gid://shopify/ProductVariant/prof-shared",
		isActive: true,
	});
	const seedCustomer = async (tag: string, orgId = orgA.id) => {
		const now = new Date().toISOString();
		const { customer } = await sessions.createCustomerSession({
			sessionId: randomUUID(),
			organizationId: orgId,
			shopifyCustomerGid: `gid://shopify/Customer/${tag}`,
			encryptedTokens: "tok",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: now,
			lastSeenAtIso: now,
			expiresAtIso: "2099-01-01T00:00:00.000Z",
		});
		return customer.id;
	};
	const startsOn = new Date(Date.now() - 10 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const endsOn = addCalendarDays(startsOn, 365);
	return {
		orgRepo,
		directory,
		entitlements,
		seedCustomer,
		startsOn,
		endsOn,
		orgAId: orgA.id,
		orgBId: orgB.id,
		div1Id: div1.id,
		div2Id: div2.id,
		foreignDivId: foreignDiv.id,
		offeringId: offering.id,
		seedActiveTeacherGrant: (customerId: string) =>
			entitlements.createEntitlementGrantSnapshot({
				organizationId: orgA.id,
				customerId,
				divisionId: div1.id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				divisionNameSnapshot: "Strings",
				paidAmount: "50.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: `intent-${customerId}`,
				shopifyOrderGid: `gid://shopify/Order/${customerId}`,
				shopifyOrderLineGid: `gid://shopify/Line/${customerId}`,
				durationDays: 365,
				startsOn,
				endsOn,
				offeringId: offering.id,
				status: "active",
				verifiedIdentityEmail: `${customerId}@example.com`,
			}),
	};
}

describe("PostgresTeacherDirectoryRepository - Integration", () => {
	integrationTest(
		"upserts teacher profiles with #361 opt-in approval rules and deterministic colors",
		async () => {
			const schema = await currentSchema();
			try {
				const f = await setupDirectoryFixture(schema);
				const custT1 = await f.seedCustomer("cust-t1");
				const custT2 = await f.seedCustomer("cust-t2");
				const optedIn = await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custT1,
					displayName: "Prof. Alice",
					publicDirectoryOptIn: true,
					divisionIds: [f.div2Id, f.div1Id],
				});
				expect(optedIn.approval_status).toBe("approved");
				expect(optedIn.teacher_color).toBe(
					getDeterministicTeacherColor(custT1),
				);
				expect(optedIn.division_ids).toEqual([f.div1Id, f.div2Id].sort());

				const pending = await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custT2,
					displayName: "Prof. Bob",
					publicDirectoryOptIn: false,
					divisionIds: [f.div1Id],
				});
				expect(pending.approval_status).toBe("pending");
				const transitioned = await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custT2,
					displayName: "Prof. Bob",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				expect(transitioned.approval_status).toBe("approved");

				await f.directory.updateTeacherProfileApproval(
					f.orgAId,
					optedIn.id,
					"rejected",
				);
				const rejected = await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custT1,
					displayName: "Prof. Alice Renamed",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				expect(rejected.approval_status).toBe("rejected");
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"rejects foreign divisions, enforces accompanist reapproval on edit, and isolates tenants",
		async () => {
			const schema = await currentSchema();
			try {
				const f = await setupDirectoryFixture(schema);
				const custTBad = await f.seedCustomer("cust-t-bad");
				const custA1 = await f.seedCustomer("cust-a1");
				await expect(
					f.directory.upsertTeacherProfile({
						organizationId: f.orgAId,
						customerId: custTBad,
						displayName: "Foreign Div",
						publicDirectoryOptIn: true,
						divisionIds: [f.foreignDivId],
					}),
				).rejects.toThrow(/divisions/i);

				const acc = await f.directory.upsertAccompanistProfile({
					organizationId: f.orgAId,
					customerId: custA1,
					displayName: "Accompanist One",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				expect(acc.approval_status).toBe("pending");
				await f.directory.updateAccompanistProfileApproval(
					f.orgAId,
					acc.id,
					"approved",
				);
				const optToggle = await f.directory.upsertAccompanistProfile({
					organizationId: f.orgAId,
					customerId: custA1,
					displayName: "Accompanist One",
					publicDirectoryOptIn: false,
					divisionIds: [f.div1Id],
				});
				expect(optToggle.approval_status).toBe("approved");
				const edited = await f.directory.upsertAccompanistProfile({
					organizationId: f.orgAId,
					customerId: custA1,
					displayName: "Accompanist Renamed",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				expect(edited.approval_status).toBe("pending");
				expect(
					await f.directory.getAccompanistProfile(f.orgBId, custA1),
				).toBeNull();
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);

	integrationTest(
		"returns public directory with active teacher and accompanist memberships only and no leaked PII",
		async () => {
			const schema = await currentSchema();
			try {
				const f = await setupDirectoryFixture(schema);
				const custTActive = await f.seedCustomer("cust-t-active");
				const custTNoMem = await f.seedCustomer("cust-t-nomem");
				const custAActive = await f.seedCustomer("cust-a-active");
				await f.seedActiveTeacherGrant(custTActive);
				await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custTActive,
					displayName: "Active Teacher",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				await f.directory.upsertTeacherProfile({
					organizationId: f.orgAId,
					customerId: custTNoMem,
					displayName: "No Membership Teacher",
					publicDirectoryOptIn: true,
					divisionIds: [f.div1Id],
				});
				await f.entitlements.createAccompanistMembershipGrant({
					organizationId: f.orgAId,
					customerId: custAActive,
					normalizedEmail: "acc@example.com",
					offeringNameSnapshot: "Accompanist Membership",
					source: "accompanist_form",
					contact: {
						name: "Ava Accompanist",
						email: "acc@example.com",
						city: "Seattle",
						phone: "555-999-8888",
					},
					divisions: [{ divisionId: f.div2Id, divisionName: "Piano" }],
					startsOn: f.startsOn,
					endsOn: f.endsOn,
				});
				const acc = await f.directory.upsertAccompanistProfile({
					organizationId: f.orgAId,
					customerId: custAActive,
					displayName: "Approved Accompanist",
					publicDirectoryOptIn: true,
					divisionIds: [f.div2Id],
				});
				await f.directory.updateAccompanistProfileApproval(
					f.orgAId,
					acc.id,
					"approved",
				);

				const directory = await f.directory.getPublicDirectoryProfiles(
					f.orgAId,
				);
				expect(directory.map((d) => d.displayName)).toEqual([
					"Active Teacher",
					"Approved Accompanist",
				]);
				expect(directory[0]?.teacherColor).toBe(
					getDeterministicTeacherColor(custTActive),
				);
				expect(directory[1]?.teacherColor).toBeUndefined();
				for (const item of directory) {
					expect(validatePublicDirectoryProfileDto(item)).toEqual(item);
					const raw = item as unknown as Record<string, unknown>;
					for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
						expect(raw[forbidden]).toBeUndefined();
					}
				}
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});

describe("PostgresTeacherDirectoryRepository - Profile Queries", () => {
	let repo: PostgresTeacherDirectoryRepository;
	let unsafeSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		repo = new PostgresTeacherDirectoryRepository("test_schema");
		spyOn(repo, "ensureReady").mockResolvedValue();
		unsafeSpy = spyOn(sql, "unsafe");
	});

	afterEach(() => {
		unsafeSpy.mockRestore();
	});

	it("getTeacherProfile queries teacher_profiles and maps fields correctly", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				organization_id: "org-1",
				customer_id: "cust-t-1",
				display_name: "Postgres Teacher",
				public_directory_opt_in: true,
				approval_status: "approved",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
				zip_code: "90210",
				division_ids: [VALID_DIV_1],
			},
		]);

		const profile = await repo.getTeacherProfile("org-1", "cust-t-1");
		expect(profile).not.toBeNull();
		expect(profile?.id).toBe("prof-t-1");
		expect(profile?.display_name).toBe("Postgres Teacher");
		expect(profile?.teacher_color).toBe(
			getDeterministicTeacherColor("cust-t-1"),
		);
		expect(profile?.zip_code).toBe("90210");
		expect(profile?.division_ids).toEqual([VALID_DIV_1]);
	});

	it("getAccompanistProfile queries accompanist_profiles and maps phone and email", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-a-1",
				organization_id: "org-1",
				customer_id: "cust-a-1",
				display_name: "Postgres Accompanist",
				public_directory_opt_in: true,
				approval_status: "pending",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
				phone: "555-555-5555",
				email: "acc@example.com",
				zip_code: "10001",
				division_ids: [VALID_DIV_2],
			},
		]);

		const profile = await repo.getAccompanistProfile("org-1", "cust-a-1");
		expect(profile).not.toBeNull();
		expect(profile?.id).toBe("prof-a-1");
		expect(profile?.phone).toBe("555-555-5555");
		expect(profile?.email).toBe("acc@example.com");
		expect(profile?.zip_code).toBe("10001");
	});

	it("updateTeacherProfileApproval validates status and updates DB", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: "prof-t-1" }]);
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				organization_id: "org-1",
				customer_id: "cust-t-1",
				display_name: "Teacher",
				public_directory_opt_in: true,
				approval_status: "approved",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
				division_ids: [],
			},
		]);

		const updated = await repo.updateTeacherProfileApproval(
			"org-1",
			"prof-t-1",
			"approved",
		);
		expect(updated?.approval_status).toBe("approved");

		await expect(
			repo.updateTeacherProfileApproval(
				"org-1",
				"prof-t-1",
				"invalid" as unknown as ProfileApprovalStatus,
			),
		).rejects.toThrow(/Approval status must be one of/);
	});

	it("getPublicDirectoryProfiles returns active teachers then accompanists and omits non-member teachers", async () => {
		unsafeSpy.mockResolvedValueOnce([{ customer_id: "cust-t-1" }]);
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				customer_id: "cust-t-1",
				display_name: "Teacher 1",
				divisions: [{ id: VALID_DIV_1, name: "Strings" }],
			},
			{
				id: "prof-t-2",
				customer_id: "cust-t-inactive",
				display_name: "Inactive Teacher",
				divisions: [],
			},
		]);
		unsafeSpy.mockResolvedValueOnce([]);
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-a-1",
				customer_id: "cust-a-1",
				display_name: "Accompanist 1",
				divisions: [],
			},
		]);

		const directory = await repo.getPublicDirectoryProfiles("org-1");
		expect(directory.length).toBe(2);
		expect(directory[0].displayName).toBe("Teacher 1");
		expect(directory[0].role).toBe("Teacher");
		expect(directory[0].isActiveMember).toBe(true);
		expect(directory[0].teacherColor).toBe(
			getDeterministicTeacherColor("cust-t-1"),
		);
		expect(directory[1].displayName).toBe("Accompanist 1");
		expect(directory[1].role).toBe("Accompanist");
		expect(directory[1].isActiveMember).toBe(false);
		expect(directory[1].teacherColor).toBeUndefined();
	});

	it("upsertTeacherProfile validates division ownership and auto-approves opted-in insert", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: VALID_DIV_1 }]);
		let profileInsertQuery = "";
		const divisionWrites: Array<{ query: string; params: unknown }> = [];
		const mockTransaction = {
			unsafe: async (query: unknown, params?: unknown) => {
				if (
					typeof query === "string" &&
					query.includes("INSERT INTO test_schema.teacher_profiles")
				) {
					profileInsertQuery = query;
					return [{ id: "prof-t-1" }];
				}
				if (
					typeof query === "string" &&
					query.includes("DELETE FROM test_schema.teacher_profile_divisions")
				) {
					divisionWrites.push({ query, params });
					return [];
				}
				if (
					typeof query === "string" &&
					query.includes("INSERT INTO test_schema.teacher_profile_divisions")
				) {
					divisionWrites.push({ query, params });
					return [];
				}
				return [];
			},
		};
		const beginSpy = spyOn(sql, "begin").mockImplementation((async (
			callback: (tx: typeof mockTransaction) => Promise<unknown>,
		) => callback(mockTransaction)) as unknown as typeof sql.begin);
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				organization_id: "org-1",
				customer_id: "cust-t-1",
				display_name: "Teacher New",
				public_directory_opt_in: true,
				approval_status: "approved",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				division_ids: [VALID_DIV_1],
			},
		]);

		const result = await repo.upsertTeacherProfile({
			organizationId: "org-1",
			customerId: "cust-t-1",
			displayName: "Teacher New",
			publicDirectoryOptIn: true,
			divisionIds: [VALID_DIV_1],
		});

		expect(result.id).toBe("prof-t-1");
		expect(result.display_name).toBe("Teacher New");
		expect(result.approval_status).toBe("approved");
		expect(profileInsertQuery).toContain("'approved'");
		expect(result.division_ids).toEqual([VALID_DIV_1]);
		expect(divisionWrites).toEqual([
			{
				query: expect.stringContaining(
					"WHERE teacher_profile_id = $1 AND organization_id = $2",
				),
				params: ["prof-t-1", "org-1"],
			},
			{
				query: expect.stringContaining(
					"(teacher_profile_id, organization_id, division_id)",
				),
				params: ["prof-t-1", "org-1", VALID_DIV_1],
			},
		]);
		beginSpy.mockRestore();
	});

	function mockExistingProfileTransaction(
		table: "teacher" | "accompanist",
		existing: { display_name: string; division_ids: string[] },
	) {
		const calls: Array<{ query: string; params: unknown[] }> = [];
		const transaction = {
			unsafe: async (query: string, params: unknown[] = []) => {
				calls.push({ query, params });
				if (query.includes(`FROM test_schema.${table}_profiles`)) {
					return [{ id: "prof-1", display_name: existing.display_name }];
				}
				if (query.includes(`SELECT division_id FROM test_schema.${table}`)) {
					return existing.division_ids.map((division_id) => ({
						division_id,
					}));
				}
				if (query.includes(`INSERT INTO test_schema.${table}_profiles `)) {
					return [{ id: "prof-1" }];
				}
				return [];
			},
		};
		const beginSpy = spyOn(sql, "begin").mockImplementation((async (
			callback: (tx: typeof transaction) => Promise<unknown>,
		) => callback(transaction)) as unknown as typeof sql.begin);
		return { calls, beginSpy };
	}

	function mockLoadedProfile(displayName: string, divisionIds: string[]) {
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-1",
				organization_id: "org-1",
				customer_id: "cust-1",
				display_name: displayName,
				public_directory_opt_in: true,
				approval_status: "pending",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				division_ids: divisionIds,
			},
		]);
	}

	function findUpsertCall(
		calls: Array<{ query: string; params: unknown[] }>,
		table: string,
	) {
		const lockIndex = calls.findIndex(
			(c) =>
				c.query.includes(`FROM test_schema.${table}_profiles`) &&
				c.query.includes("FOR UPDATE"),
		);
		const upsertIndex = calls.findIndex((c) =>
			c.query.includes(`INSERT INTO test_schema.${table}_profiles `),
		);
		return { lockIndex, upsert: calls[upsertIndex], upsertIndex };
	}

	it("upsertTeacherProfile never resets approval to pending on update and preserves rejected status", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: VALID_DIV_1 }]);
		const { calls, beginSpy } = mockExistingProfileTransaction("teacher", {
			display_name: "Old Name",
			division_ids: [VALID_DIV_1],
		});
		mockLoadedProfile("New Name", [VALID_DIV_1]);

		await repo.upsertTeacherProfile({
			organizationId: "org-1",
			customerId: "cust-1",
			displayName: "New Name",
			publicDirectoryOptIn: true,
			divisionIds: [VALID_DIV_1],
		});

		const { upsert } = findUpsertCall(calls, "teacher");
		const updateClause = upsert.query.split("DO UPDATE SET")[1] ?? "";
		expect(updateClause).not.toContain("'pending'");
		expect(updateClause).toContain("'rejected'");
		beginSpy.mockRestore();
	});

	it("upsertAccompanistProfile resets approval when division set changes", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: VALID_DIV_2 }]);
		const { calls, beginSpy } = mockExistingProfileTransaction("accompanist", {
			display_name: "Acc Name",
			division_ids: [VALID_DIV_1],
		});
		mockLoadedProfile("Acc Name", [VALID_DIV_2]);

		await repo.upsertAccompanistProfile({
			organizationId: "org-1",
			customerId: "cust-1",
			displayName: "Acc Name",
			publicDirectoryOptIn: true,
			divisionIds: [VALID_DIV_2],
		});

		const { lockIndex, upsert, upsertIndex } = findUpsertCall(
			calls,
			"accompanist",
		);
		expect(lockIndex).toBeGreaterThanOrEqual(0);
		expect(lockIndex).toBeLessThan(upsertIndex);
		expect(upsert.query).toContain("approval_status = CASE WHEN $6");
		expect(upsert.params[5]).toBe(true);
		beginSpy.mockRestore();
	});

	it("upsertTeacherProfile rejects divisions that do not belong to organization", async () => {
		unsafeSpy.mockResolvedValueOnce([]);
		await expect(
			repo.upsertTeacherProfile({
				organizationId: "org-1",
				customerId: "cust-t-1",
				displayName: "Teacher New",
				publicDirectoryOptIn: true,
				divisionIds: [VALID_DIV_1],
			}),
		).rejects.toThrow(
			/One or more divisions do not belong to the organization/,
		);
	});

	it("upsertAccompanistProfile rejects divisions that do not belong to organization", async () => {
		unsafeSpy.mockResolvedValueOnce([]);
		await expect(
			repo.upsertAccompanistProfile({
				organizationId: "org-1",
				customerId: "cust-a-1",
				displayName: "Acc New",
				publicDirectoryOptIn: true,
				divisionIds: [VALID_DIV_1],
			}),
		).rejects.toThrow(
			/One or more divisions do not belong to the organization/,
		);
	});

	it("listTeacherProfiles and listAccompanistProfiles query DB ordered by display name", async () => {
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				organization_id: "org-1",
				customer_id: "cust-t-1",
				display_name: "Teacher 1",
				public_directory_opt_in: false,
				approval_status: "pending",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				division_ids: [],
			},
		]);
		const teachers = await repo.listTeacherProfiles("org-1");
		expect(teachers.length).toBe(1);
		expect(teachers[0].display_name).toBe("Teacher 1");

		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-a-1",
				organization_id: "org-1",
				customer_id: "cust-a-1",
				display_name: "Accompanist 1",
				public_directory_opt_in: false,
				approval_status: "pending",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
				division_ids: [],
			},
		]);
		const accompanists = await repo.listAccompanistProfiles("org-1");
		expect(accompanists.length).toBe(1);
		expect(accompanists[0].display_name).toBe("Accompanist 1");

		for (const call of unsafeSpy.mock.calls.slice(-2)) {
			expect(String(call[0])).toMatch(
				/ORDER BY lower\((tp|ap)\.display_name\) COLLATE "C" ASC, \1\.display_name COLLATE "C" ASC, \1\.id COLLATE "C" ASC/,
			);
		}
	});

	it("getTeacherProfileById and getAccompanistProfileById return null when not found", async () => {
		unsafeSpy.mockResolvedValueOnce([]);
		expect(await repo.getTeacherProfileById("org-1", "missing-id")).toBeNull();
		unsafeSpy.mockResolvedValueOnce([]);
		expect(
			await repo.getAccompanistProfileById("org-1", "missing-id"),
		).toBeNull();
	});

	it("updateAccompanistProfileApproval updates status and returns updated record", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: "prof-a-1" }]);
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-a-1",
				organization_id: "org-1",
				customer_id: "cust-a-1",
				display_name: "Accompanist",
				public_directory_opt_in: true,
				approval_status: "approved",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-02T00:00:00.000Z",
				division_ids: [],
			},
		]);
		const updated = await repo.updateAccompanistProfileApproval(
			"org-1",
			"prof-a-1",
			"approved",
		);
		expect(updated?.approval_status).toBe("approved");
	});
});
