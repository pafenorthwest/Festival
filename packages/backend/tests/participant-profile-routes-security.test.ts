import { describe, expect, it } from "bun:test";
import type { PublicDirectoryProfileDto } from "@festival/common";
import { CUSTOMER_SESSION_COOKIE } from "../src/customer/customer-account-service.js";
import { setupTestApp } from "./participant-profile-test-harness.js";

type App = Awaited<ReturnType<typeof setupTestApp>>["app"];
type Kind = "teacher" | "accompanist";

const PLURAL: Record<Kind, string> = {
	teacher: "teachers",
	accompanist: "accompanists",
};

function customerRequest(
	app: App,
	path: string,
	init: { method?: string; headers?: Record<string, string>; body?: string },
) {
	return app.request(`/api/customer/orgs/${path}`, {
		method: init.method ?? "GET",
		headers: init.headers,
		body: init.body,
	});
}

function sessionHeaders(extra: Record<string, string> = {}) {
	return {
		"Content-Type": "application/json",
		Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1`,
		"X-CSRF-Token": "csrf-token-1",
		...extra,
	};
}

async function putProfile(
	app: App,
	kind: Kind,
	body: Record<string, unknown>,
): Promise<{ id: string; approval_status: string; division_ids: string[] }> {
	const res = await customerRequest(app, `org-a/profiles/${kind}`, {
		method: "PUT",
		headers: sessionHeaders(),
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(200);
	return res.json();
}

function validProfileBody(
	kind: Kind,
	divisionId: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return kind === "teacher"
		? {
				displayName: "Name",
				publicDirectoryOptIn: true,
				...overrides,
			}
		: {
				displayName: "Name",
				publicDirectoryOptIn: true,
				divisionIds: [divisionId],
				...overrides,
			};
}

function patchTeacherDivisions(
	app: App,
	slug: string,
	profileId: string,
	token: string | null,
	body: unknown,
) {
	return app.request(
		`/api/admin/orgs/${slug}/profiles/teachers/${profileId}/divisions`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
		},
	);
}

function patchApproval(
	app: App,
	target: { kind: Kind; slug: string; id: string },
	token: string | null,
	approvalStatus: string,
) {
	return app.request(
		`/api/admin/orgs/${target.slug}/profiles/${PLURAL[target.kind]}/${target.id}/approval`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: JSON.stringify({ approvalStatus }),
		},
	);
}

async function directoryNames(app: App): Promise<string[]> {
	const res = await app.request("/api/org-info/org-a/directory/profiles");
	expect(res.status).toBe(200);
	const profiles: PublicDirectoryProfileDto[] = await res.json();
	return profiles.map((p) => p.displayName);
}

describe("Participant profile routes: security and consent", () => {
	for (const kind of ["teacher", "accompanist"] as const) {
		it(`rejects ${kind} profile creation without membership`, async () => {
			const { app, repository, orgA, divA1 } = await setupTestApp({
				withMemberships: false,
			});
			const response = await customerRequest(app, `org-a/profiles/${kind}`, {
				method: "PUT",
				headers: sessionHeaders(),
				body: JSON.stringify(
					validProfileBody(kind, divA1.id, { displayName: "Nonmember" }),
				),
			});
			expect(response.status).toBe(403);
			expect(await response.json()).toMatchObject({
				code: "active_membership_required",
			});
			const profile =
				kind === "teacher"
					? await repository.getTeacherProfile(orgA.id, "cust-1")
					: await repository.getAccompanistProfile(orgA.id, "cust-1");
			expect(profile).toBeNull();
		});

		describe(`${kind} customer endpoints`, () => {
			it("rejects an org-a session used against org-b URLs", async () => {
				const { app, divB1 } = await setupTestApp();
				const getRes = await customerRequest(app, `org-b/profiles/${kind}`, {
					headers: sessionHeaders(),
				});
				expect(getRes.status).toBe(401);
				const putRes = await customerRequest(app, `org-b/profiles/${kind}`, {
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify(
						validProfileBody(kind, divB1.id, { displayName: "Cross Org" }),
					),
				});
				expect(putRes.status).toBe(401);
			});

			it("requires session and CSRF on PUT", async () => {
				const { app, divA1 } = await setupTestApp();
				const body = JSON.stringify(validProfileBody(kind, divA1.id));
				const { Cookie: _cookie, ...noCookie } = sessionHeaders();
				const { "X-CSRF-Token": _csrf, ...noCsrf } = sessionHeaders();
				const path = `org-a/profiles/${kind}`;
				const noSession = await customerRequest(app, path, {
					method: "PUT",
					headers: noCookie,
					body,
				});
				expect(noSession.status).toBe(401);
				const missingCsrf = await customerRequest(app, path, {
					method: "PUT",
					headers: noCsrf,
					body,
				});
				expect(missingCsrf.status).toBe(403);
			});

			it("rejects bearer tokens on customer GET", async () => {
				const { app } = await setupTestApp();
				const res = await customerRequest(app, `org-a/profiles/${kind}`, {
					headers: sessionHeaders({ Authorization: "Bearer admin-org-a" }),
				});
				expect(res.status).toBe(400);
			});

			it("rejects malformed JSON and unknown fields with 400", async () => {
				const { app, divA1 } = await setupTestApp();
				const path = `org-a/profiles/${kind}`;
				const malformed = await customerRequest(app, path, {
					method: "PUT",
					headers: sessionHeaders(),
					body: "{not json",
				});
				expect(malformed.status).toBe(400);
				const unknown = await customerRequest(app, path, {
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify({
						...validProfileBody(kind, divA1.id),
						approvalStatus: "approved",
					}),
				});
				expect(unknown.status).toBe(400);
			});
		});

		describe(`${kind} admin approval`, () => {
			it("enforces tenant, role, and authentication on PATCH", async () => {
				const { app, divA1 } = await setupTestApp();
				const created = await putProfile(
					app,
					kind,
					validProfileBody(kind, divA1.id, { displayName: "Approval Target" }),
				);
				const inOrgB = { kind, slug: "org-b", id: created.id };
				const inOrgA = { kind, slug: "org-a", id: created.id };
				const crossTenant = await patchApproval(
					app,
					inOrgB,
					"admin-org-b",
					"approved",
				);
				expect(crossTenant.status).toBe(404);
				const readOnly = await patchApproval(
					app,
					inOrgA,
					"member-org-a",
					"approved",
				);
				expect(readOnly.status).toBe(403);
				const unauthenticated = await patchApproval(
					app,
					inOrgA,
					null,
					"approved",
				);
				expect(unauthenticated.status).toBe(401);
			});
		});

		describe(`${kind} public directory consent`, () => {
			it("hides approved profile after opt-out and hides rejected profile", async () => {
				const { app, divA1 } = await setupTestApp();
				const body = validProfileBody(kind, divA1.id, {
					displayName: "Consent Target",
				});
				const created = await putProfile(app, kind, body);
				const target = { kind, slug: "org-a", id: created.id };
				await patchApproval(app, target, "admin-org-a", "approved");
				expect(await directoryNames(app)).toEqual(["Consent Target"]);

				const optedOut = await putProfile(app, kind, {
					...body,
					publicDirectoryOptIn: false,
				});
				expect(optedOut.approval_status).toBe("approved");
				expect(await directoryNames(app)).toEqual([]);

				await putProfile(app, kind, body);
				await patchApproval(app, target, "admin-org-a", "rejected");
				expect(await directoryNames(app)).toEqual([]);
			});
		});
	}

	describe("teacher division ownership and admin PATCH security", () => {
		it("rejects customer divisionIds on teacher PUT without mutating stored divisions and preserves admin division updates", async () => {
			const { app, repository, orgA, divA1, divA2 } = await setupTestApp();
			const createWithDivs = await customerRequest(
				app,
				"org-a/profiles/teacher",
				{
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify({
						displayName: "Teacher One",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
					}),
				},
			);
			expect(createWithDivs.status).toBe(400);
			expect(await repository.getTeacherProfile(orgA.id, "cust-1")).toBeNull();

			const created = await putProfile(app, "teacher", {
				displayName: "Teacher One",
				publicDirectoryOptIn: true,
			});
			expect(created.division_ids).toEqual([divA1.id]);

			const updateWithDivs = await customerRequest(
				app,
				"org-a/profiles/teacher",
				{
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify({
						displayName: "Tamper Divisions",
						publicDirectoryOptIn: true,
						divisionIds: [divA2.id],
					}),
				},
			);
			expect(updateWithDivs.status).toBe(400);
			expect(
				(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
			).toEqual([divA1.id]);

			const adminPatch = await patchTeacherDivisions(
				app,
				"org-a",
				created.id,
				"admin-org-a",
				{ divisionIds: [divA2.id] },
			);
			expect(adminPatch.status).toBe(200);

			const edited = await putProfile(app, "teacher", {
				displayName: "Teacher Renamed",
				publicDirectoryOptIn: false,
			});
			expect(edited.division_ids).toEqual([divA2.id]);
		});

		it("enforces auth, tenant isolation, strict single-division validation, approval preservation, and zip_code redaction on admin teacher divisions PATCH", async () => {
			const { app, repository, orgA, divA1, divA2, divB1 } =
				await setupTestApp();
			const divInactive = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Archived Division",
				normalizedName: "archived-division",
			});
			await repository.updateDivision({
				organizationId: orgA.id,
				divisionId: divInactive.id,
				isActive: false,
			});

			const approved = await putProfile(app, "teacher", {
				displayName: "Approved Teacher",
				publicDirectoryOptIn: true,
			});
			const pendingRes = await customerRequest(app, "org-a/profiles/teacher", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
					Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-2`,
					"X-CSRF-Token": "csrf-token-2",
				},
				body: JSON.stringify({
					displayName: "Pending Teacher",
					publicDirectoryOptIn: false,
				}),
			});
			expect(pendingRes.status).toBe(200);
			const pending = await pendingRes.json();

			const rawProfiles = (
				repository as unknown as {
					state: { teacherProfiles: Map<string, Record<string, unknown>> };
				}
			).state.teacherProfiles;
			const storedApproved = rawProfiles.get(approved.id);
			expect(storedApproved).toBeDefined();
			rawProfiles.set(approved.id, {
				...(storedApproved ?? {}),
				zip_code: "98101",
			});

			for (const [slug, id, token, divId, expectedStatus] of [
				["org-a", approved.id, null, divA2.id, 401],
				["org-a", approved.id, "member-org-a", divA2.id, 403],
				["org-a", approved.id, "admin-org-b", divA2.id, 403],
				[
					"org-a",
					"00000000-0000-0000-0000-000000000000",
					"admin-org-a",
					divA2.id,
					404,
				],
				["org-b", approved.id, "admin-org-b", divB1.id, 404],
			] as const) {
				const res = await patchTeacherDivisions(app, slug, id, token, {
					divisionIds: [divId],
				});
				expect(res.status).toBe(expectedStatus);
			}

			for (const badPayload of [
				"{malformed",
				{ divisionIds: [] },
				{ divisionIds: [divA1.id, divA2.id] },
				{ divisionIds: [divA1.id, divA1.id] },
				{ divisionIds: ["invalid-uuid"] },
				{ divisionIds: [divInactive.id] },
				{ divisionIds: [divB1.id] },
				{ divisionIds: [divA2.id], extraField: true },
			]) {
				const res = await patchTeacherDivisions(
					app,
					"org-a",
					approved.id,
					"admin-org-a",
					badPayload,
				);
				expect(res.status).toBe(400);
				expect(
					(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
				).toEqual([divA1.id]);
			}

			const okApproved = await patchTeacherDivisions(
				app,
				"org-a",
				approved.id,
				"admin-org-a",
				{ divisionIds: [divA2.id] },
			);
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
					displayName: "Approved Teacher",
					role: "Teacher",
					approvedDivisions: [{ id: divA2.id, name: divA2.displayName }],
				},
			]);

			const okPending = await patchTeacherDivisions(
				app,
				"org-a",
				pending.id,
				"admin-org-a",
				{ divisionIds: [divA2.id] },
			);
			expect(okPending.status).toBe(200);
			expect((await okPending.json()).approval_status).toBe("pending");

			await patchApproval(
				app,
				{ kind: "teacher", slug: "org-a", id: approved.id },
				"admin-org-a",
				"rejected",
			);
			const okRejected = await patchTeacherDivisions(
				app,
				"org-a",
				approved.id,
				"admin-org-a",
				{ divisionIds: [divA1.id] },
			);
			expect(okRejected.status).toBe(200);
			expect((await okRejected.json()).approval_status).toBe("rejected");
		});
	});

	describe("accompanist division policy and dual-role isolation", () => {
		it("enforces org accompanist division policy without mutating DB and keeps dual-role teacher divisions isolated", async () => {
			const { app, repository, orgA, divA1, divA2, divB1 } =
				await setupTestApp();
			const divA3 = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Percussion A",
				normalizedName: "percussion-a",
			});
			const divInactive = await repository.createDivision({
				organizationId: orgA.id,
				displayName: "Inactive A",
				normalizedName: "inactive-a",
			});
			await repository.updateDivision({
				organizationId: orgA.id,
				divisionId: divInactive.id,
				isActive: false,
			});

			const putAccompanistRaw = (divisionIds: string[]) =>
				customerRequest(app, "org-a/profiles/accompanist", {
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify({
						displayName: "Dual Role Accompanist",
						publicDirectoryOptIn: true,
						divisionIds,
					}),
				});

			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "exactly_one",
			});
			expect((await putAccompanistRaw([divA1.id])).status).toBe(200);
			for (const invalidIds of [
				[],
				[divA1.id, divA2.id],
				[divA1.id, divA1.id],
				[divInactive.id],
				[divB1.id],
			]) {
				expect((await putAccompanistRaw(invalidIds)).status).toBe(400);
				expect(
					(await repository.getAccompanistProfile(orgA.id, "cust-1"))
						?.division_ids,
				).toEqual([divA1.id]);
			}

			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "one_to_two",
			});
			expect((await putAccompanistRaw([divA1.id, divA2.id])).status).toBe(200);
			expect(
				(await putAccompanistRaw([divA1.id, divA2.id, divA3.id])).status,
			).toBe(400);
			expect(
				(await repository.getAccompanistProfile(orgA.id, "cust-1"))
					?.division_ids,
			).toEqual([divA1.id, divA2.id].sort());

			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "one_to_all",
			});
			expect((await putAccompanistRaw([])).status).toBe(400);
			expect((await putAccompanistRaw([divInactive.id])).status).toBe(400);
			expect(
				(await putAccompanistRaw([divA1.id, divA2.id, divA3.id])).status,
			).toBe(200);

			const teacher = await putProfile(app, "teacher", {
				displayName: "Dual Role Teacher",
				publicDirectoryOptIn: true,
			});
			expect(teacher.division_ids).toEqual([divA1.id]);

			const rejectedTeacherDivs = await customerRequest(
				app,
				"org-a/profiles/teacher",
				{
					method: "PUT",
					headers: sessionHeaders(),
					body: JSON.stringify({
						displayName: "Dual Role Teacher",
						publicDirectoryOptIn: true,
						divisionIds: [divA2.id],
					}),
				},
			);
			expect(rejectedTeacherDivs.status).toBe(400);

			await repository.updateAccompanistDivisionPolicy({
				organizationId: orgA.id,
				policy: "exactly_one",
			});
			expect((await putAccompanistRaw([divA2.id])).status).toBe(200);
			expect(
				(await repository.getTeacherProfile(orgA.id, "cust-1"))?.division_ids,
			).toEqual([divA1.id]);
		});
	});
});
