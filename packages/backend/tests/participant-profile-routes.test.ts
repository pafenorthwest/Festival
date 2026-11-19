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
			const { app } = await setupTestApp();

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
					}),
				},
			);
			expect(bearerRes.status).toBe(400);
		});

		it("seeds customer teacher divisions from active grant on create, rejects divisionIds with 400, and preserves admin-updated divisions across edits", async () => {
			const { app, repository, orgA, divA1, divA2 } = await setupTestApp();

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

			// Customer Teacher PUT sending divisionIds -> 400 and does not create profile
			const createWithDivisionsRes = await app.request(
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
			expect(createWithDivisionsRes.status).toBe(400);
			expect(await repository.getTeacherProfile(orgA.id, "cust-1")).toBeNull();

			// Valid first-time PUT seeds division_ids server-side from active teacher_membership grant
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
					}),
				},
			);
			expect(putRes.status).toBe(200);
			const created = await putRes.json();
			expect(created.display_name).toBe("Alice Teacher");
			expect(created.customer_id).toBe("cust-1");
			expect(created.approval_status).toBe("approved");
			expect(created.division_ids).toEqual([divA1.id]);

			// Subsequent customer Teacher PUT sending divisionIds -> 400 and leaves stored division_ids unchanged
			const customerDivAttempt = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Attempted Division Edit",
						publicDirectoryOptIn: true,
						divisionIds: [divA2.id],
					}),
				},
			);
			expect(customerDivAttempt.status).toBe(400);
			expect(
				(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
			).toEqual([divA1.id]);

			// Admin updates teacher profile division away from original grant division
			const adminDivRes = await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${created.id}/divisions`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ divisionIds: [divA2.id] }),
				},
			);
			expect(adminDivRes.status).toBe(200);
			expect((await adminDivRes.json()).division_ids).toEqual([divA2.id]);

			// Subsequent customer Teacher edits (displayName / publicDirectoryOptIn) preserve existing.division_ids
			const optOutRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Alice Renamed",
						publicDirectoryOptIn: false,
					}),
				},
			);
			expect(optOutRes.status).toBe(200);
			const optedOut = await optOutRes.json();
			expect(optedOut.display_name).toBe("Alice Renamed");
			expect(optedOut.public_directory_opt_in).toBe(false);
			expect(optedOut.division_ids).toEqual([divA2.id]);

			// GET own profile -> 200 with preserved division_ids
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
			expect(fetched.division_ids).toEqual([divA2.id]);

			// Customer 2 cannot see Customer 1's profile
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
			expect(created.approval_status).toBe("approved");

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
				const valid: Record<string, unknown> =
					kind === "teacher"
						? {
								displayName: "Valid Name",
								publicDirectoryOptIn: true,
							}
						: {
								displayName: "Valid Name",
								publicDirectoryOptIn: true,
								divisionIds: [divA1.id],
							};
				const invalidBodies: Array<Record<string, unknown>> =
					kind === "teacher"
						? [
								{ ...valid, displayName: "   " },
								{ ...valid, displayName: "x".repeat(500) },
								{ ...valid, publicDirectoryOptIn: "yes" },
								{ ...valid, divisionIds: [divA1.id] },
								{ ...valid, divisionIds: "not-an-array" },
							]
						: [
								{ ...valid, displayName: "   " },
								{ ...valid, displayName: "x".repeat(500) },
								{ ...valid, publicDirectoryOptIn: "yes" },
								{ ...valid, divisionIds: [] },
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
				const res = await putProfile(
					app,
					kind === "teacher"
						? {
								displayName: "Valid Name",
								publicDirectoryOptIn: true,
							}
						: {
								displayName: "Valid Name",
								publicDirectoryOptIn: true,
								divisionIds: [divA1.id],
							},
				);
				expect(res.status).toBe(500);
				const text = await res.text();
				expect(text).not.toContain(secret);
			});
		}

		it("enforces accompanist division policies (exactly_one, one_to_two, one_to_all) without DB mutation and preserves dual-role independence", async () => {
			const { app, repository, orgA, divA1, divA2, divB1 } =
				await setupTestApp();
			const divA3 = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Winds A",
				normalizedName: "winds-a",
			});
			const divInactive = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Retired A",
				normalizedName: "retired-a",
			});
			await repository.updateDivision({
				organizationId: orgA.id,
				divisionId: divInactive.id,
				isActive: false,
			});

			const putAccompanist = (divisionIds: string[]) =>
				app.request("/api/customer/orgs/org-a/profiles/accompanist", {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Dual Participant",
						publicDirectoryOptIn: true,
						divisionIds,
					}),
				});

			// Policy: exactly_one
			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "exactly_one",
			});
			expect((await putAccompanist([divA1.id])).status).toBe(200);
			for (const badIds of [
				[],
				[divA1.id, divA2.id],
				[divA1.id, divA1.id],
				["not-a-uuid"],
				[divInactive.id],
				[divB1.id],
			]) {
				const res = await putAccompanist(badIds);
				expect(res.status).toBe(400);
				expect(
					(await repository.getAccompanistProfile(orgA.id, "cust-1"))
						?.division_ids,
				).toEqual([divA1.id]);
			}

			// Policy: one_to_two
			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "one_to_two",
			});
			expect((await putAccompanist([divA1.id, divA2.id])).status).toBe(200);
			const expectedTwo = [divA1.id, divA2.id].sort();
			expect(
				(await repository.getAccompanistProfile(orgA.id, "cust-1"))
					?.division_ids,
			).toEqual(expectedTwo);
			for (const badIds of [
				[],
				[divA1.id, divA2.id, divA3.id],
				[divA1.id, divInactive.id],
			]) {
				const res = await putAccompanist(badIds);
				expect(res.status).toBe(400);
				expect(
					(await repository.getAccompanistProfile(orgA.id, "cust-1"))
						?.division_ids,
				).toEqual(expectedTwo);
			}

			// Policy: one_to_all
			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "one_to_all",
			});
			expect((await putAccompanist([])).status).toBe(400);
			expect((await putAccompanist([divInactive.id])).status).toBe(400);
			expect(
				(await putAccompanist([divA1.id, divA2.id, divA3.id])).status,
			).toBe(200);

			// Dual-role independence: cust-1 also holds active teacher_membership in divA1
			const createTeacher = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Dual Teacher",
						publicDirectoryOptIn: true,
					}),
				},
			);
			expect(createTeacher.status).toBe(200);
			expect((await createTeacher.json()).division_ids).toEqual([divA1.id]);

			// Teacher PUT still rejects divisionIds with 400
			const teacherWithDivs = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName: "Dual Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA2.id],
					}),
				},
			);
			expect(teacherWithDivs.status).toBe(400);
			expect(
				(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
			).toEqual([divA1.id]);

			// Updating Accompanist divisions within policy does NOT affect Teacher divisions
			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "one_to_two",
			});
			const accUpdate = await putAccompanist([divA2.id, divA3.id]);
			expect(accUpdate.status).toBe(200);
			expect((await accUpdate.json()).division_ids).toEqual(
				[divA2.id, divA3.id].sort(),
			);
			const teacherGet = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
				},
			);
			expect(teacherGet.status).toBe(200);
			expect((await teacherGet.json()).division_ids).toEqual([divA1.id]);
		});
	});

	describe("Admin Approval Endpoints", () => {
		it("lists teacher and accompanist profiles with tenant isolation", async () => {
			const { app } = await setupTestApp();

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
			const { app } = await setupTestApp();

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

		it("updates teacher profile single division via Admin PATCH with strict validation, approval preservation, and contact redaction", async () => {
			const { app, repository, orgA, divA1, divA2, divB1 } =
				await setupTestApp();
			const divInactive = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Inactive Division",
				normalizedName: "inactive-division",
			});
			await repository.updateDivision({
				organizationId: orgA.id,
				divisionId: divInactive.id,
				isActive: false,
			});

			// Create opted-in teacher (approved) and opted-out teacher (pending)
			const createApprovedRes = await app.request(
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
					}),
				},
			);
			const approvedProfile = await createApprovedRes.json();

			const createPendingRes = await app.request(
				"/api/customer/orgs/org-a/profiles/teacher",
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2`,
						"X-CSRF-Token": "csrf-token-2",
					},
					body: JSON.stringify({
						displayName: "Charlie Pending",
						publicDirectoryOptIn: false,
					}),
				},
			);
			const pendingProfile = await createPendingRes.json();
			expect(pendingProfile.approval_status).toBe("pending");

			// Seed stored zip_code on in-memory teacher profile without staff consent to verify redaction
			const rawProfiles = (
				repository as unknown as {
					state: { teacherProfiles: Map<string, Record<string, unknown>> };
				}
			).state.teacherProfiles;
			const storedApproved = rawProfiles.get(approvedProfile.id);
			expect(storedApproved).toBeDefined();
			rawProfiles.set(approvedProfile.id, {
				...(storedApproved ?? {}),
				zip_code: "98101",
			});

			const patchDivisions = (
				slug: string,
				profileId: string,
				body: unknown,
				token: string | null = "admin-org-a",
			) =>
				app.request(
					`/api/admin/orgs/${slug}/profiles/teachers/${profileId}/divisions`,
					{
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify(body),
					},
				);

			// 401 unauthenticated
			expect(
				(
					await patchDivisions(
						"org-a",
						approvedProfile.id,
						{ divisionIds: [divA2.id] },
						null,
					)
				).status,
			).toBe(401);

			// 403 non-Admin member and cross-org user
			expect(
				(
					await patchDivisions(
						"org-a",
						approvedProfile.id,
						{ divisionIds: [divA2.id] },
						"member-org-a",
					)
				).status,
			).toBe(403);
			expect(
				(
					await patchDivisions(
						"org-a",
						approvedProfile.id,
						{ divisionIds: [divA2.id] },
						"admin-org-b",
					)
				).status,
			).toBe(403);

			// 404 unknown profileId or profileId belonging to another org
			expect(
				(
					await patchDivisions(
						"org-a",
						"00000000-0000-0000-0000-000000000000",
						{ divisionIds: [divA2.id] },
					)
				).status,
			).toBe(404);
			expect(
				(
					await patchDivisions(
						"org-b",
						approvedProfile.id,
						{ divisionIds: [divB1.id] },
						"admin-org-b",
					)
				).status,
			).toBe(404);

			// 400 without mutating DB on 0, 2, duplicate, invalid UUID, inactive, cross-org, or unknown field
			for (const invalidBody of [
				{ divisionIds: [] },
				{ divisionIds: [divA1.id, divA2.id] },
				{ divisionIds: [divA1.id, divA1.id] },
				{ divisionIds: ["not-a-uuid"] },
				{ divisionIds: [divInactive.id] },
				{ divisionIds: [divB1.id] },
				{ divisionIds: [divA2.id], approvalStatus: "approved" },
			]) {
				const res = await patchDivisions(
					"org-a",
					approvedProfile.id,
					invalidBody,
				);
				expect(res.status).toBe(400);
				expect(
					(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
				).toEqual([divA1.id]);
			}

			// 200 on approved profile: updates division_ids, preserves approved, redacts zip_code, updates public directory
			const okApproved = await patchDivisions("org-a", approvedProfile.id, {
				divisionIds: [divA2.id],
			});
			expect(okApproved.status).toBe(200);
			const updatedApproved = await okApproved.json();
			expect(updatedApproved.division_ids).toEqual([divA2.id]);
			expect(updatedApproved.approval_status).toBe("approved");
			expect(updatedApproved.zip_code).toBeUndefined();

			const directoryRes = await app.request(
				"/api/org-info/org-a/directory/profiles",
			);
			const directory: PublicDirectoryProfileDto[] = await directoryRes.json();
			expect(directory).toMatchObject([
				{
					displayName: "Alice Teacher",
					role: "Teacher",
					approvedDivisions: [{ id: divA2.id, name: divA2.displayName }],
				},
			]);

			// 200 on pending profile preserves pending
			const okPending = await patchDivisions("org-a", pendingProfile.id, {
				divisionIds: [divA2.id],
			});
			expect(okPending.status).toBe(200);
			const updatedPending = await okPending.json();
			expect(updatedPending.division_ids).toEqual([divA2.id]);
			expect(updatedPending.approval_status).toBe("pending");

			// 200 on sticky rejected profile preserves rejected
			await app.request(
				`/api/admin/orgs/org-a/profiles/teachers/${approvedProfile.id}/approval`,
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer admin-org-a",
					},
					body: JSON.stringify({ approvalStatus: "rejected" }),
				},
			);
			const okRejected = await patchDivisions("org-a", approvedProfile.id, {
				divisionIds: [divA1.id],
			});
			expect(okRejected.status).toBe(200);
			const updatedRejected = await okRejected.json();
			expect(updatedRejected.division_ids).toEqual([divA1.id]);
			expect(updatedRejected.approval_status).toBe("rejected");
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

			// Create teacher 1 (opted in -> auto-approved immediately under D1)
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
					}),
				},
			);
			const t1 = await t1Res.json();
			expect(t1.approval_status).toBe("approved");

			// Create teacher 2 (opted out)
			await app.request("/api/customer/orgs/org-a/profiles/teacher", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2`,
					"X-CSRF-Token": "csrf-token-2",
				},
				body: JSON.stringify({
					displayName: "Charlie OptedOut",
					publicDirectoryOptIn: false,
				}),
			});

			// Create accompanist 1 (opted in -> auto-approved immediately under #416)
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
			expect(a1.approval_status).toBe("approved");

			// Active memberships are seeded by setupTestApp.

			// Public GET (unauthenticated)
			const publicRes = await app.request(
				"/api/org-info/org-a/directory/profiles",
			);
			expect(publicRes.status).toBe(200);
			const profiles: PublicDirectoryProfileDto[] = await publicRes.json();

			// Only approved + opted-in (Alice and Bob; Charlie opted out)
			expect(profiles.length).toBe(2);

			// Teachers first, then accompanists
			expect(profiles[0].role).toBe("Teacher");
			expect(profiles[0].displayName).toBe("Alice Teacher");
			expect(profiles[0].isActiveMember).toBe(true);
			expect(profiles[0].teacherColor).toBeDefined();

			expect(profiles[1].role).toBe("Accompanist");
			expect(profiles[1].displayName).toBe("Bob Accompanist");
			expect(profiles[1].isActiveMember).toBe(true);
			expect(profiles[1].teacherColor).toBeUndefined();

			// Zero private info leaked across all returned profiles
			for (const profile of profiles) {
				const keys = Object.keys(profile);
				for (const forbidden of FORBIDDEN_PUBLIC_DIRECTORY_FIELDS) {
					expect(keys.includes(forbidden)).toBe(false);
				}
			}
		});

		it("keeps approved teacher in public directory across customer name edits and admin division edits and enforces admin hide/reinstate", async () => {
			const { app, divA1, divA2 } = await setupTestApp();
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
					}),
				});
			const patchTeacher = (profileId: string, approvalStatus: string) =>
				app.request(
					`/api/admin/orgs/org-a/profiles/teachers/${profileId}/approval`,
					{
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer admin-org-a",
						},
						body: JSON.stringify({ approvalStatus }),
					},
				);
			const patchTeacherDivisions = (
				profileId: string,
				divisionIds: string[],
			) =>
				app.request(
					`/api/admin/orgs/org-a/profiles/teachers/${profileId}/divisions`,
					{
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer admin-org-a",
						},
						body: JSON.stringify({ divisionIds }),
					},
				);
			const listDirectory = async (): Promise<PublicDirectoryProfileDto[]> =>
				(await app.request("/api/org-info/org-a/directory/profiles")).json();
			const listDirectoryNames = async () =>
				(await listDirectory()).map((p) => p.displayName);

			const created = await (await putTeacher("Alice Teacher")).json();
			expect(created.approval_status).toBe("approved");
			expect(await listDirectory()).toMatchObject([
				{
					displayName: "Alice Teacher",
					approvedDivisions: [{ id: divA1.id, name: divA1.displayName }],
				},
			]);

			const divEditRes = await patchTeacherDivisions(created.id, [divA2.id]);
			expect(divEditRes.status).toBe(200);
			expect((await divEditRes.json()).approval_status).toBe("approved");

			const editRes = await putTeacher("Alice Renamed");
			expect(editRes.status).toBe(200);
			const edited = await editRes.json();
			expect(edited.approval_status).toBe("approved");
			expect(edited.division_ids).toEqual([divA2.id]);
			expect(await listDirectory()).toMatchObject([
				{
					displayName: "Alice Renamed",
					approvedDivisions: [{ id: divA2.id, name: divA2.displayName }],
				},
			]);

			const hideRes = await patchTeacher(created.id, "rejected");
			expect(hideRes.status).toBe(200);
			expect(await listDirectoryNames()).toEqual([]);

			const blockedBypass = await (await putTeacher("Alice Bypass")).json();
			expect(blockedBypass.approval_status).toBe("rejected");
			expect(await listDirectoryNames()).toEqual([]);

			const reinstateRes = await patchTeacher(created.id, "approved");
			expect(reinstateRes.status).toBe(200);
			expect(await listDirectoryNames()).toEqual(["Alice Bypass"]);
		});

		it("auto-approves accompanist in public directory, keeps approved across edits, and enforces sticky admin hide/reinstate", async () => {
			const { app, divA1, divA2 } = await setupTestApp();
			const putAccompanist = (
				displayName: string,
				divisionIds = [divA1.id],
				publicDirectoryOptIn = true,
			) =>
				app.request("/api/customer/orgs/org-a/profiles/accompanist", {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
						"X-CSRF-Token": "csrf-token-1",
					},
					body: JSON.stringify({
						displayName,
						publicDirectoryOptIn,
						divisionIds,
					}),
				});
			const patchAccompanist = (profileId: string, approvalStatus: string) =>
				app.request(
					`/api/admin/orgs/org-a/profiles/accompanists/${profileId}/approval`,
					{
						method: "PATCH",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer admin-org-a",
						},
						body: JSON.stringify({ approvalStatus }),
					},
				);
			const listDirectoryNames = async () => {
				const items: PublicDirectoryProfileDto[] = await (
					await app.request("/api/org-info/org-a/directory/profiles")
				).json();
				return items.map((p) => p.displayName);
			};

			const created = await (await putAccompanist("Bob Accompanist")).json();
			expect(created.approval_status).toBe("approved");
			expect(await listDirectoryNames()).toEqual(["Bob Accompanist"]);

			const editRes = await putAccompanist("Bob Renamed", [divA2.id]);
			expect(editRes.status).toBe(200);
			expect((await editRes.json()).approval_status).toBe("approved");
			expect(await listDirectoryNames()).toEqual(["Bob Renamed"]);

			const hideRes = await patchAccompanist(created.id, "rejected");
			expect(hideRes.status).toBe(200);
			expect(await listDirectoryNames()).toEqual([]);

			const blockedBypass = await (
				await putAccompanist("Bob Bypass", [divA1.id], true)
			).json();
			expect(blockedBypass.approval_status).toBe("rejected");
			expect(await listDirectoryNames()).toEqual([]);

			const reinstateRes = await patchAccompanist(created.id, "approved");
			expect(reinstateRes.status).toBe(200);
			expect(await listDirectoryNames()).toEqual(["Bob Bypass"]);
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
