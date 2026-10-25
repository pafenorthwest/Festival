import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
	FORBIDDEN_PUBLIC_DIRECTORY_FIELDS,
	getDeterministicTeacherColor,
	type ProfileApprovalStatus,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
	validatePublicDirectoryProfileDto,
} from "@festival/common";
import { sql } from "bun";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

const VALID_DIV_1 = "11111111-1111-4111-8111-111111111111";
const VALID_DIV_2 = "22222222-2222-4222-8222-222222222222";

describe("InMemoryOrganizationRepository - Profiles", () => {
	let repo: InMemoryOrganizationRepository;
	let orgAId: string;
	let orgBId: string;
	let div1Id: string;
	let div2Id: string;
	let foreignDivId: string;

	beforeEach(async () => {
		repo = new InMemoryOrganizationRepository(
			() => new Date("2026-05-15T12:00:00Z"),
		);
		const orgA = await repo.createOrganization({
			name: "Festival Org A",
			slug: "org-a",
		});
		const orgB = await repo.createOrganization({
			name: "Festival Org B",
			slug: "org-b",
		});
		orgAId = orgA.id;
		orgBId = orgB.id;

		const d1 = await repo.createDivision({
			organizationId: orgAId,
			displayName: "Strings",
			normalizedName: "strings",
		});
		div1Id = d1.id;

		const d2 = await repo.createDivision({
			organizationId: orgAId,
			displayName: "Piano",
			normalizedName: "piano",
		});
		div2Id = d2.id;

		const dForeign = await repo.createDivision({
			organizationId: orgBId,
			displayName: "Foreign Winds",
			normalizedName: "foreign winds",
		});
		foreignDivId = dForeign.id;
	});

	describe("Teacher Profiles", () => {
		it("upserts a new teacher profile with pending approval and deterministic color", async () => {
			const profile = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id, div2Id],
			});

			expect(profile.id).toBeDefined();
			expect(profile.organization_id).toBe(orgAId);
			expect(profile.customer_id).toBe("cust-teacher-1");
			expect(profile.display_name).toBe("Alice Teacher");
			expect(profile.public_directory_opt_in).toBe(true);
			expect(profile.approval_status).toBe("pending");
			expect(profile.division_ids).toEqual([div1Id, div2Id]);
			expect(profile.teacher_color).toBe(
				getDeterministicTeacherColor("cust-teacher-1"),
			);

			const byId = await repo.getTeacherProfileById(orgAId, profile.id);
			expect(byId).toEqual(profile);

			const byCustomer = await repo.getTeacherProfile(orgAId, "cust-teacher-1");
			expect(byCustomer).toEqual(profile);
		});

		it("updating only teacher public_directory_opt_in or division order preserves approval_status", async () => {
			const created = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: false,
				divisionIds: [div1Id, div2Id],
			});

			const approved = await repo.updateTeacherProfileApproval(
				orgAId,
				created.id,
				"approved",
			);
			expect(approved?.approval_status).toBe("approved");

			const updated = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div2Id, div1Id],
			});

			expect(updated.id).toBe(created.id);
			expect(updated.public_directory_opt_in).toBe(true);
			expect(updated.approval_status).toBe("approved");
		});

		it("renaming an approved teacher profile resets approval_status to pending", async () => {
			const created = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, created.id, "approved");

			const updated = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Updated",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});

			expect(updated.id).toBe(created.id);
			expect(updated.display_name).toBe("Alice Updated");
			expect(updated.approval_status).toBe("pending");
		});

		it("changing approved teacher divisions resets approval_status to pending", async () => {
			const created = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, created.id, "approved");

			const updated = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div2Id],
			});

			expect(updated.division_ids).toEqual([div2Id]);
			expect(updated.approval_status).toBe("pending");
		});

		it("editing a rejected teacher profile returns it to pending", async () => {
			const created = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, created.id, "rejected");

			const updated = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Fixed",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});

			expect(updated.approval_status).toBe("pending");
		});

		it("rejects upsert when division does not belong to organization", async () => {
			await expect(
				repo.upsertTeacherProfile({
					organizationId: orgAId,
					customerId: "cust-teacher-1",
					displayName: "Alice Teacher",
					publicDirectoryOptIn: true,
					divisionIds: [foreignDivId],
				}),
			).rejects.toThrow(
				/One or more divisions do not belong to the organization/,
			);
		});

		it("lists teacher profiles sorted by display name and tenant isolated", async () => {
			await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-2",
				displayName: "Zoe Teacher",
				publicDirectoryOptIn: false,
				divisionIds: [],
			});
			await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-1",
				displayName: "Adam Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.upsertTeacherProfile({
				organizationId: orgBId,
				customerId: "cust-t-b",
				displayName: "Bob OrgB Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [foreignDivId],
			});

			const listA = await repo.listTeacherProfiles(orgAId);
			expect(listA.length).toBe(2);
			expect(listA[0].display_name).toBe("Adam Teacher");
			expect(listA[1].display_name).toBe("Zoe Teacher");

			const listB = await repo.listTeacherProfiles(orgBId);
			expect(listB.length).toBe(1);
			expect(listB[0].display_name).toBe("Bob OrgB Teacher");
		});

		it("enforces tenant isolation for gets and approval updates", async () => {
			const profileA = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-teacher-1",
				displayName: "Alice Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});

			expect(await repo.getTeacherProfile(orgBId, "cust-teacher-1")).toBeNull();
			expect(await repo.getTeacherProfileById(orgBId, profileA.id)).toBeNull();
			expect(
				await repo.updateTeacherProfileApproval(
					orgBId,
					profileA.id,
					"approved",
				),
			).toBeNull();
		});
	});

	describe("Accompanist Profiles", () => {
		it("upserts an accompanist profile with pending approval and contact info", async () => {
			repo.setCustomerContact(orgAId, {
				customerId: "cust-acc-1",
				phone: "555-123-4567",
				email: "accompanist@example.com",
			});

			const profile = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Accompanist",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});

			expect(profile.id).toBeDefined();
			expect(profile.organization_id).toBe(orgAId);
			expect(profile.customer_id).toBe("cust-acc-1");
			expect(profile.display_name).toBe("Bob Accompanist");
			expect(profile.approval_status).toBe("pending");
			expect(profile.phone).toBe("555-123-4567");
			expect(profile.email).toBe("accompanist@example.com");

			const byCustomer = await repo.getAccompanistProfile(orgAId, "cust-acc-1");
			expect(byCustomer).toEqual(profile);

			const byId = await repo.getAccompanistProfileById(orgAId, profile.id);
			expect(byId).toEqual(profile);
		});

		it("updating only accompanist public_directory_opt_in preserves approval_status", async () => {
			const created = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Initial",
				publicDirectoryOptIn: false,
				divisionIds: [div1Id],
			});

			await repo.updateAccompanistProfileApproval(
				orgAId,
				created.id,
				"approved",
			);

			const updated = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Initial",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});

			expect(updated.public_directory_opt_in).toBe(true);
			expect(updated.approval_status).toBe("approved");
		});

		it("editing accompanist name or divisions resets approval_status to pending", async () => {
			const created = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Initial",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateAccompanistProfileApproval(
				orgAId,
				created.id,
				"approved",
			);

			const renamed = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Updated",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			expect(renamed.display_name).toBe("Bob Updated");
			expect(renamed.approval_status).toBe("pending");

			await repo.updateAccompanistProfileApproval(
				orgAId,
				created.id,
				"rejected",
			);
			const redivided = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob Updated",
				publicDirectoryOptIn: true,
				divisionIds: [div2Id],
			});
			expect(redivided.division_ids).toEqual([div2Id]);
			expect(redivided.approval_status).toBe("pending");
		});

		it("rejects upsert when division belongs to different organization", async () => {
			await expect(
				repo.upsertAccompanistProfile({
					organizationId: orgAId,
					customerId: "cust-acc-1",
					displayName: "Bob Accompanist",
					publicDirectoryOptIn: true,
					divisionIds: [foreignDivId],
				}),
			).rejects.toThrow(
				/One or more divisions do not belong to the organization/,
			);
		});

		it("enforces tenant isolation on accompanist profile queries", async () => {
			const profileA = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-1",
				displayName: "Bob OrgA",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});

			expect(await repo.getAccompanistProfile(orgBId, "cust-acc-1")).toBeNull();
			expect(
				await repo.getAccompanistProfileById(orgBId, profileA.id),
			).toBeNull();
			expect(
				await repo.updateAccompanistProfileApproval(
					orgBId,
					profileA.id,
					"approved",
				),
			).toBeNull();
		});
	});

	describe("Public Directory Profiles (getPublicDirectoryProfiles)", () => {
		it("strictly filters for public_directory_opt_in = true AND approval_status = 'approved'", async () => {
			const t1 = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-approved-optin",
				displayName: "Teacher Approved OptIn",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, t1.id, "approved");

			await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-pending-optin",
				displayName: "Teacher Pending OptIn",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			// remains pending

			const t3 = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-approved-nooptin",
				displayName: "Teacher Approved NoOptIn",
				publicDirectoryOptIn: false,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, t3.id, "approved");

			const a1 = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-a-approved-optin",
				displayName: "Accompanist Approved OptIn",
				publicDirectoryOptIn: true,
				divisionIds: [div2Id],
			});
			await repo.updateAccompanistProfileApproval(orgAId, a1.id, "approved");

			const a2 = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-a-rejected-optin",
				displayName: "Accompanist Rejected OptIn",
				publicDirectoryOptIn: true,
				divisionIds: [div2Id],
			});
			await repo.updateAccompanistProfileApproval(orgAId, a2.id, "rejected");

			const directory = await repo.getPublicDirectoryProfiles(orgAId);

			expect(directory.length).toBe(2);
			expect(directory[0].displayName).toBe("Teacher Approved OptIn");
			expect(directory[0].role).toBe("Teacher");
			expect(directory[1].displayName).toBe("Accompanist Approved OptIn");
			expect(directory[1].role).toBe("Accompanist");
		});

		it("returns teachers first, then accompanists", async () => {
			const a1 = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-a-1",
				displayName: "Aaron Accompanist",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateTeacherProfileApproval(orgAId, a1.id, "approved");
			await repo.updateAccompanistProfileApproval(orgAId, a1.id, "approved");

			const t1 = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-1",
				displayName: "Zoe Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateTeacherProfileApproval(orgAId, t1.id, "approved");

			const directory = await repo.getPublicDirectoryProfiles(orgAId);

			expect(directory.length).toBe(2);
			expect(directory[0].role).toBe("Teacher");
			expect(directory[0].displayName).toBe("Zoe Teacher");
			expect(directory[1].role).toBe("Accompanist");
			expect(directory[1].displayName).toBe("Aaron Accompanist");
		});

		it("resolves active membership status accurately for teachers and accompanists", async () => {
			const tActive = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-active",
				displayName: "Active Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, tActive.id, "approved");

			const tInactive = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-inactive",
				displayName: "Inactive Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, tInactive.id, "approved");

			// Active teacher entitlement grant for tActive
			const product = await repo.createMembershipProductRecord({
				organizationId: orgAId,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				productNameSnapshot: "Teacher Membership",
				durationDays: 365,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				isActive: true,
			});

			await repo.createEntitlementGrantSnapshot({
				organizationId: orgAId,
				customerId: "cust-t-active",
				divisionId: div1Id,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
				divisionNameSnapshot: "Strings",
				paidAmount: "50.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "intent-1",
				shopifyOrderGid: "gid://shopify/Order/1",
				shopifyOrderLineGid: "gid://shopify/Line/1",
				durationDays: 365,
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				offeringId: product.id,
				source: "shopify_order",
				status: "active",
				verifiedIdentityEmail: "active@example.com",
			});

			const directory = await repo.getPublicDirectoryProfiles(orgAId);

			const activeTeacherDto = directory.find(
				(d) => d.displayName === "Active Teacher",
			);
			const inactiveTeacherDto = directory.find(
				(d) => d.displayName === "Inactive Teacher",
			);

			expect(activeTeacherDto?.isActiveMember).toBe(true);
			expect(inactiveTeacherDto?.isActiveMember).toBe(false);
		});

		it("resolves division names and strictly omits foreign divisions", async () => {
			const t1 = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-divs",
				displayName: "Multi Division Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [div1Id, div2Id],
			});
			await repo.updateTeacherProfileApproval(orgAId, t1.id, "approved");

			const directory = await repo.getPublicDirectoryProfiles(orgAId);
			expect(directory.length).toBe(1);
			expect(directory[0].approvedDivisions).toEqual([
				{ id: div2Id, name: "Piano" },
				{ id: div1Id, name: "Strings" },
			]);
		});

		it("assigns deterministic teacher color for teachers and omits it for accompanists", async () => {
			const t1 = await repo.upsertTeacherProfile({
				organizationId: orgAId,
				customerId: "cust-t-color",
				displayName: "Color Teacher",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateTeacherProfileApproval(orgAId, t1.id, "approved");

			const a1 = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-a-nocolor",
				displayName: "NoColor Accompanist",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateAccompanistProfileApproval(orgAId, a1.id, "approved");

			const directory = await repo.getPublicDirectoryProfiles(orgAId);
			expect(directory[0].teacherColor).toBe(
				getDeterministicTeacherColor("cust-t-color"),
			);
			expect(directory[1].teacherColor).toBeUndefined();
		});

		it("strictly matches PublicDirectoryProfileDto without leaking private fields", async () => {
			repo.setCustomerContact("cust-acc-privacy", {
				phone: "555-999-8888",
				email: "private@example.com",
			});

			const a1 = await repo.upsertAccompanistProfile({
				organizationId: orgAId,
				customerId: "cust-acc-privacy",
				displayName: "Privacy Test Accompanist",
				publicDirectoryOptIn: true,
				divisionIds: [],
			});
			await repo.updateAccompanistProfileApproval(orgAId, a1.id, "approved");

			const directory = await repo.getPublicDirectoryProfiles(orgAId);
			expect(directory.length).toBe(1);

			// Validate with strict contract validator
			const validated = validatePublicDirectoryProfileDto(directory[0]);
			expect(validated).toEqual(directory[0]);

			// Explicit check for forbidden fields
			const rawDto = directory[0] as unknown as Record<string, unknown>;
			for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
				expect(rawDto[forbidden]).toBeUndefined();
			}
		});
	});
});

describe("PostgresOrganizationRepository - Profile Queries", () => {
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
		unsafeSpy.mockResolvedValueOnce([{ id: "prof-t-1" }]); // update
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
		]); // getTeacherProfileById

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

	it("getPublicDirectoryProfiles returns teachers then accompanists with active member status", async () => {
		// 1. active teacher rows
		unsafeSpy.mockResolvedValueOnce([{ customer_id: "cust-t-1" }]);
		// 2. approved opted-in teachers
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				customer_id: "cust-t-1",
				display_name: "Teacher 1",
				divisions: [{ id: VALID_DIV_1, name: "Strings" }],
			},
		]);
		// 3. active accompanist rows (none)
		unsafeSpy.mockResolvedValueOnce([]);
		// 4. approved opted-in accompanists
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

	it("upsertTeacherProfile validates division ownership and upserts record", async () => {
		// Mock division lookup: valid division belongs to org
		unsafeSpy.mockResolvedValueOnce([{ id: VALID_DIV_1 }]);

		const mockTransaction = {
			unsafe: async (query: unknown) => {
				if (
					typeof query === "string" &&
					query.includes("INSERT INTO test_schema.teacher_profiles")
				) {
					return [{ id: "prof-t-1" }];
				}
				if (
					typeof query === "string" &&
					query.includes("DELETE FROM test_schema.teacher_profile_divisions")
				) {
					return [];
				}
				if (
					typeof query === "string" &&
					query.includes("INSERT INTO test_schema.teacher_profile_divisions")
				) {
					return [];
				}
				return [];
			},
		};
		const beginSpy = spyOn(sql, "begin").mockImplementation(
			async (callback: (tx: typeof mockTransaction) => Promise<unknown>) => {
				return callback(mockTransaction);
			},
		);

		// getTeacherProfileById return
		unsafeSpy.mockResolvedValueOnce([
			{
				id: "prof-t-1",
				organization_id: "org-1",
				customer_id: "cust-t-1",
				display_name: "Teacher New",
				public_directory_opt_in: true,
				approval_status: "pending",
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
		expect(result.approval_status).toBe("pending");
		expect(result.division_ids).toEqual([VALID_DIV_1]);

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
		const beginSpy = spyOn(sql, "begin").mockImplementation(
			async (callback: (tx: typeof transaction) => Promise<unknown>) =>
				callback(transaction),
		);
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

	it("upsertTeacherProfile locks existing row and resets approval when display name changes", async () => {
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

		const { lockIndex, upsert, upsertIndex } = findUpsertCall(calls, "teacher");
		expect(lockIndex).toBeGreaterThanOrEqual(0);
		expect(lockIndex).toBeLessThan(upsertIndex);
		expect(upsert.query).toContain("approval_status = CASE WHEN $6");
		expect(upsert.params[5]).toBe(true);
		beginSpy.mockRestore();
	});

	it("upsertTeacherProfile preserves approval when name and division set are unchanged", async () => {
		unsafeSpy.mockResolvedValueOnce([{ id: VALID_DIV_1 }, { id: VALID_DIV_2 }]);
		const { calls, beginSpy } = mockExistingProfileTransaction("teacher", {
			display_name: "Same Name",
			division_ids: [VALID_DIV_2, VALID_DIV_1],
		});
		mockLoadedProfile("Same Name", [VALID_DIV_1, VALID_DIV_2]);

		await repo.upsertTeacherProfile({
			organizationId: "org-1",
			customerId: "cust-1",
			displayName: "Same Name",
			publicDirectoryOptIn: false,
			divisionIds: [VALID_DIV_1, VALID_DIV_2],
		});

		const { upsert } = findUpsertCall(calls, "teacher");
		expect(upsert.params[5]).toBe(false);
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
		// Return empty array for division lookup
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
