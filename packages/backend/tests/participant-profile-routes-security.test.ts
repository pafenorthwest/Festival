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
): Promise<{ id: string; approval_status: string }> {
	const res = await customerRequest(app, `org-a/profiles/${kind}`, {
		method: "PUT",
		headers: sessionHeaders(),
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(200);
	return res.json();
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
				body: JSON.stringify({
					displayName: "Nonmember",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				}),
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
					body: JSON.stringify({
						displayName: "Cross Org",
						publicDirectoryOptIn: true,
						divisionIds: [divB1.id],
					}),
				});
				expect(putRes.status).toBe(401);
			});

			it("requires session and CSRF on PUT", async () => {
				const { app, divA1 } = await setupTestApp();
				const body = JSON.stringify({
					displayName: "Name",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				});
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
						displayName: "Name",
						publicDirectoryOptIn: true,
						divisionIds: [divA1.id],
						approvalStatus: "approved",
					}),
				});
				expect(unknown.status).toBe(400);
			});
		});

		describe(`${kind} admin approval`, () => {
			it("enforces tenant, role, and authentication on PATCH", async () => {
				const { app, divA1 } = await setupTestApp();
				const created = await putProfile(app, kind, {
					displayName: "Approval Target",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				});
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
				const body = {
					displayName: "Consent Target",
					publicDirectoryOptIn: true,
					divisionIds: [divA1.id],
				};
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
});
