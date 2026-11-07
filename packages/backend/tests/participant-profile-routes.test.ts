import { describe, expect, it } from "bun:test";
import {
	FORBIDDEN_PUBLIC_DIRECTORY_FIELDS,
	type PublicDirectoryProfileDto,
} from "@festival/common";
import { CUSTOMER_SESSION_COOKIE } from "../src/customer/customer-account-service.js";
import { setupTestApp } from "./participant-profile-test-harness.js";

describe("Participant Profiles API End-to-End", () => {
	describe("Customer Participant Profile Endpoints", () => {
		it("enforces customer session and CSRF on teacher profile PUT", async () => {
			const { app, divA1 } = await setupTestApp();

			// 1. Missing session cookie -> 401
			const noCookieRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(noCookieRes.status).toBe(401);

			// 2. Missing CSRF token -> 403
			const noCsrfRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(noCsrfRes.status).toBe(403);

			// 3. Bearer token forbidden on customer route -> 400
			const bearerRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(bearerRes.status).toBe(400);
		});

		it("upserts and retrieves customer own teacher profile, failing on invalid division IDs", async () => {
			const { app, divA1, divB1 } = await setupTestApp();

			// Initial GET before create -> 404
			const initialGet = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					},
				},
			);
			expect(initialGet.status).toBe(404);

			// Reject foreign division ID from org-b -> 400
			const foreignDivRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divB1.id],
					}),
				},
			);
			expect(foreignDivRes.status).toBe(400);

			// Valid PUT
			const putRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(putRes.status).toBe(200);
			const created = await putRes.json();
			expect(created.display_name).toBe("Alice Teacher");
			expect(created.customer_id).toBe("cust-1");
			expect(created.approval_status).toBe("pending");

			// GET own profile -> 200
			const getRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					},
				},
			);
			expect(getRes.status).toBe(200);
			const fetched = await getRes.json();
			expect(fetched.id).toBe(created.id);
			expect(fetched.customer_id).toBe("cust-1");

			// Customer 2 cannot see or update Customer 1's profile
			const cust2Get = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2`,
					},
				},
			);
			expect(cust2Get.status).toBe(404);
		});

		it("upserts and retrieves customer own accompanist profile", async () => {
			const { app, divA1 } = await setupTestApp();

			// Valid PUT accompanist
			const putRes = await app.request(
				"/api/customer/orgs/org-a/profiles/accompanist",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Bob Accompanist",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(putRes.status).toBe(200);
			const created = await putRes.json();
			expect(created.display_name).toBe("Bob Accompanist");
			expect(created.customer_id).toBe("cust-1");
			expect(created.approval_status).toBe("pending");

			// GET own profile
			const getRes = await app.request(
				"/api/customer/orgs/org-a/profiles/accompanist",
				{
					headers: {
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					},
				},
			);
			expect(getRes.status).toBe(200);
			const fetched = await getRes.json();
			expect(fetched.id).toBe(created.id);
		});

		for (const kind of ["teacher", "accompanist"] as const) {
			const putProfile = (
				app: Awaited<ReturnType<typeof setupTestApp>>["app"],
				body: Record<string, unknown>,
			) =>
				app.request(`/api/customer/orgs/org-a/profiles/${kind}`, {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify(body),
				});

			it(`returns 400 for invalid ${kind} profile payloads`, async () => {
				const { app, divA1, divB1 } = await setupTestApp();
				const valid = {
					displayName: "Valid Name",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				};
				const invalidBodies: Array<Record<string, unknown>> = [
					{ ...valid, displayName: "   " },
					{ ...valid, displayName: "x".repeat(500) },
					{ ...valid, publicDirectoryOptIn: "yes" },
					{ ...valid, divisionIds: "not-an-array" },
					{ ...valid, divisionIds: [divB1.id] },
					{ ...valid, divisionIds: ["unknown-division-id"] },
				];
				for (const body of invalidBodies) {
					const res = await putProfile(app, body);
					expect(res.status).toBe(400);
					const json = await res.json();
					expect(typeof json.error).toBe("string");
				}
			});

			it(`returns generic 500 when ${kind} profile repository fails unexpectedly`, async () => {
				const { app, repository, divA1 } = await setupTestApp();
				const secret = "relation festival.secret_table does not exist";
				const failing = async () => {
					throw new Error(secret);
				};
				if (kind === "teacher") {
					repository.upsertTeacherProfile = failing;
				} else {
					repository.upsertAccompanistProfile = failing;
				}
				const res = await putProfile(app, {
					displayName: "Valid Name",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				});
				expect(res.status).toBe(500);
				const text = await res.text();
				expect(text).not.toContain(secret);
			});
		}
	});

	describe("Admin Approval Endpoints", () => {
		it("lists teacher and accompanist profiles with tenant isolation", async () => {
			const { app, divA1 } = await setupTestApp();

			// Create a teacher profile in org-a
			await app.request("/api/customer/orgs/org-a/profiles/teacher", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
					"X-CSRF-Token": "csrf-token-1",
				},
				body: JSON.stringify({
					displayName: "Alice Teacher",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				}),
			});

			// Admin of org-a can list
			const adminRes = await app.request(
				"/api/admin/orgs/org-a/profiles/teachers",
				{
					headers: { Authorization: "Bearer admin-org-a" },
				},
			);
			expect(adminRes.status).toBe(200);
			const list = await adminRes.json();
			expect(Array.isArray(list)).toBe(true);
			expect(list.length).toBe(1);
			expect(list[0].display_name).toBe("Alice Teacher");

			// Admin of org-b attempting cross-tenant access to org-a -> 403
			const crossTenantRes = await app.request(
				"/api/admin/orgs/org-a/profiles/teachers",
				{
					headers: { Authorization: "Bearer admin-org-b" },
				},
			);
			expect(crossTenantRes.status).toBe(403);

			// Non-admin member of org-a -> 403
			const memberRes = await app.request(
				"/api/admin/orgs/org-a/profiles/teachers",
				{
					headers: { Authorization: "Bearer member-org-a" },
				},
			);
			expect(memberRes.status).toBe(403);

			// Unauthenticated -> 401
			const unauthRes = await app.request(
				"/api/admin/orgs/org-a/profiles/teachers",
			);
			expect(unauthRes.status).toBe(401);
		});

		it("approves and rejects teacher profiles", async () => {
			const { app, divA1 } = await setupTestApp();

			// Create teacher profile
			const createRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			const created = await createRes.json();
			const profileId = created.id;

			// Approve
			const approveRes = await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${profileId}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);
			expect(approveRes.status).toBe(200);
			const approved = await approveRes.json();
			expect(approved.approval_status).toBe("approved");

			// Reject
			const rejectRes = await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${profileId}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "rejected" }),
				},
			);
			expect(rejectRes.status).toBe(200);
			const rejected = await rejectRes.json();
			expect(rejected.approval_status).toBe("rejected");

			// Invalid status -> 400
			const invalidRes = await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${profileId}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "invalid-status" }),
				},
			);
			expect(invalidRes.status).toBe(400);

			// Non-existent profileId -> 404
			const notFoundRes = await app.request(
				"/api/admin/orgs/org-a/profiles/teachers/00000000-0000-0000-0000-000000000000/approval",
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);
			expect(notFoundRes.status).toBe(404);
		});

		it("approves and rejects accompanist profiles", async () => {
			const { app, divA1 } = await setupTestApp();

			// Create accompanist profile
			const createRes = await app.request(
				"/api/customer/orgs/org-a/profiles/accompanist",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Bob Accompanist",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			const created = await createRes.json();
			const profileId = created.id;

			// List accompanists
			const listRes = await app.request(
				"/api/admin/orgs/org-a/profiles/accompanists",
				{
					headers: { Authorization: "Bearer admin-org-a" },
				},
			);
			expect(listRes.status).toBe(200);
			const list = await listRes.json();
			expect(list.length).toBe(1);

			// Approve accompanist
			const approveRes = await app.request(
				`/api/admin/orgs/org-a/profiles/accompanists/${profileId}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);
			expect(approveRes.status).toBe(200);
			const approved = await approveRes.json();
			expect(approved.approval_status).toBe("approved");
		});
	});

	describe("Public Directory Profiles Endpoint", () => {
		it("returns approved and opted-in profiles only with no private fields leaked", async () => {
			const { app, divA1 } = await setupTestApp();

			// Create teacher 1 (opted in, approved)
			const t1Res = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			const t1 = await t1Res.json();
			await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${t1.id}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);

			// Create teacher 2 (pending approval)
			await app.request("/api/customer/orgs/org-a/profiles/teacher", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2`,
					"X-CSRF-Token": "csrf-token-2",
				},
				body: JSON.stringify({
					displayName: "Charlie Pending",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				}),
			});

			// Create accompanist 1 (opted in, approved)
			const a1Res = await app.request(
				"/api/customer/orgs/org-a/profiles/accompanist",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Bob Accompanist",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			const a1 = await a1Res.json();
			await app.request(
				`/api/admin/orgs/org-a/profiles/accompanists/${a1.id}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);

			// Active memberships are seeded by setupTestApp.

			// Public GET (unauthenticated)
			const publicRes = await app.request(
				"/api/org-info/org-a/directory/profiles",
			);
			expect(publicRes.status).toBe(200);
			const profiles: PublicDirectoryProfileDto[] = await publicRes.json();

			// Only approved + opted-in (Alice and Bob; Charlie is pending)
			expect(profiles.length).toBe(2);

			// Teachers first, then accompanists
			expect(profiles[0].role).toBe("Teacher");
			expect(profiles[0].displayName).toBe("Alice Teacher");
			expect(profiles[0].isActiveMember).toBe(true);
			expect(profiles[0].teacherColor).toBeDefined();

			expect(profiles[1].role).toBe("Accompanist");
			expect(profiles[1].displayName).toBe("Bob Accompanist");
			expect(profiles[1].teacherColor).toBeUndefined();

			// Zero private info leaked across all returned profiles
			for (const profile of profiles) {
				const keys = Object.keys(profile);
				for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
					expect(keys.includes(forbidden)).toBe(false);
				}
			}
		});

		it("removes approved teacher from public directory after display name edit", async () => {
			const { app, divA1 } = await setupTestApp();
			const putTeacher = (displayName: string) =>
				app.request("/api/customer/orgs/org-a/profiles/teacher", {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName,
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				});

			const created = await (await putTeacher("Alice Teacher")).json();
			await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${created.id}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "approved" }),
				},
			);
			const before: PublicDirectoryProfileDto[] = await (
				await app.request("/api/org-info/org-a/directory/profiles")
			).json();
			expect(before.map((p) => p.displayName)).toEqual(["Alice Teacher"]);

			const editRes = await putTeacher("Alice Renamed");
			expect(editRes.status).toBe(200);
			const edited = await editRes.json();
			expect(edited.approval_status).toBe("pending");

			const after: PublicDirectoryProfileDto[] = await (
				await app.request("/api/org-info/org-a/directory/profiles")
			).json();
			expect(after).toEqual([]);
		});

		it("returns 404 for nonexistent organization", async () => {
			const { app } = await setupTestApp();
			const res = await app.request(
				"/api/org-info/nonexistent-org/directory/profiles",
			);
			expect(res.status).toBe(404);
		});
	});
});
