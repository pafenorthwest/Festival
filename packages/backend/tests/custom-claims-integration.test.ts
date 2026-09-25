import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser, OrganizationRole } from "@festival/common";
import { createApp } from "../src/app.js";
import type { CustomClaimsWriter } from "../src/auth/custom-claims.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new Error(`Unknown token ${token}`);
		return user;
	}
}

class FakeCustomClaimsWriter implements CustomClaimsWriter {
	orgRoleCalls: Array<{
		uid: string;
		organizationId: string;
		role: OrganizationRole;
	}> = [];
	volunteerFestivalCalls: Array<{
		uid: string;
		organizationId: string;
		festivalId: string;
	}> = [];

	async setOrgRole(
		uid: string,
		organizationId: string,
		role: OrganizationRole,
	) {
		this.orgRoleCalls.push({ uid, organizationId, role });
	}

	async addVolunteerFestival(
		uid: string,
		organizationId: string,
		festivalId: string,
	) {
		this.volunteerFestivalCalls.push({ uid, organizationId, festivalId });
	}
}

function withAuth(token: string, init?: RequestInit): RequestInit {
	return {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			...(init?.headers ?? {}),
		},
	};
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const customClaimsWriter = new FakeCustomClaimsWriter();
	const app = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			invitee: {
				uid: "uid-invitee",
				email: "invitee@example.com",
				displayName: "Invitee User",
			},
			volunteer: {
				uid: "uid-volunteer",
				email: "volunteer@example.com",
				displayName: "Vera Volunteer",
			},
		}),
		customClaimsWriter,
	});
	return { ...app, repository, customClaimsWriter };
}

describe("custom claims are stamped alongside the existing database checks", () => {
	it("stamps the creator's org role on organization creation", async () => {
		const { app, customClaimsWriter } = await createTestApp();

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "Festival Admins", shortName: "pafe" }),
				}),
			),
		);
		expect(response.status).toBe(201);

		expect(customClaimsWriter.orgRoleCalls).toHaveLength(1);
		expect(customClaimsWriter.orgRoleCalls[0]?.uid).toBe("uid-admin");
		expect(customClaimsWriter.orgRoleCalls[0]?.role).toBe("Admin");
	});

	it("stamps the invitee's org role on invite acceptance", async () => {
		const { app, customClaimsWriter } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "Festival Admins", shortName: "pafe" }),
				}),
			),
		);
		customClaimsWriter.orgRoleCalls.length = 0;

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Division Chair",
					}),
				}),
			),
		);
		const invite = (await inviteResponse.json()) as {
			invite: { token: string };
		};

		const acceptResponse = await app.fetch(
			new Request(
				`http://test/api/invites/${invite.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invitee User" }),
				}),
			),
		);
		expect(acceptResponse.status).toBe(201);

		expect(customClaimsWriter.orgRoleCalls).toHaveLength(1);
		expect(customClaimsWriter.orgRoleCalls[0]).toEqual({
			uid: "uid-invitee",
			organizationId: expect.any(String),
			role: "Division Chair",
		});
	});

	it("stamps the volunteer's festival enrollment on enroll", async () => {
		const { app, customClaimsWriter } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "Festival Admins", shortName: "pafe" }),
				}),
			),
		);
		await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Spring Festival",
						shortName: "spring",
						startDate: "2027-03-01",
						endDate: "2027-03-05",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/enroll",
				withAuth("volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vera Volunteer", phone: "555-0100" }),
				}),
			),
		);
		expect(response.status).toBe(200);

		expect(customClaimsWriter.volunteerFestivalCalls).toHaveLength(1);
		expect(customClaimsWriter.volunteerFestivalCalls[0]).toEqual({
			uid: "uid-volunteer",
			organizationId: expect.any(String),
			festivalId: expect.any(String),
		});
	});

	it("still succeeds when no custom claims writer is configured", async () => {
		const repository = new InMemoryOrganizationRepository();
		const app = await createApp({
			env: { port: 3000 },
			repository,
			authVerifier: new (class implements AuthVerifier {
				async verify(): Promise<AuthenticatedUser> {
					return {
						uid: "uid-admin",
						email: "admin@example.com",
						displayName: "Admin User",
					};
				}
			})(),
		});

		const response = await app.app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "Festival Admins", shortName: "pafe" }),
				}),
			),
		);
		expect(response.status).toBe(201);
	});
});
