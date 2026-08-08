import { describe, expect, it } from "bun:test";
import type {
	AuthenticatedUser,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		if (token === "invalid") {
			throw new Error("Invalid token");
		}

		const user = this.users[token];
		if (!user) {
			throw new Error(`Unknown token ${token}`);
		}

		return user;
	}
}

async function createTestApp() {
	return createApp({
		env: { port: 3000 },
		repository: new InMemoryOrganizationRepository(),
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
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider User",
			},
		}),
	});
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

describe("organization routes", () => {
	it("creates an organization and records the creator as Admin", async () => {
		const { app } = await createTestApp();
		const payload: CreateOrganizationInput = {
			name: "Festival Admins",
			shortName: "pafe",
		};

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(payload),
				}),
			),
		);

		expect(response.status).toBe(201);
		const data = (await response.json()) as {
			membership: { role: string };
			organization: { name: string; slug: string };
		};
		expect(data.organization.name).toBe("Festival Admins");
		expect(data.organization.slug).toBe("pafe");
		expect(data.membership.role).toBe("Admin");
	});

	it("rejects duplicate organization names", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const duplicate = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Board",
						shortName: "pafe",
					}),
				}),
			),
		);

		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toMatchObject({
			error: "Organization short name is already registered.",
		});
	});

	it("rejects duplicate organization display names with different short names", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const duplicate = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						name: "festival admins",
						shortName: "board",
					}),
				}),
			),
		);

		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toMatchObject({
			error: "Organization name is already registered.",
		});
	});

	it("lists the authenticated user's organization memberships", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Board",
						shortName: "board",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request("http://test/api/memberships", withAuth("admin")),
		);

		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			memberships: Array<{ organizationSlug: string; role: string }>;
		};
		expect(data.memberships).toHaveLength(2);
		expect(
			data.memberships.map((membership) => membership.organizationSlug),
		).toEqual(["pafe", "board"]);
		expect(
			data.memberships.every((membership) => membership.role === "Admin"),
		).toBeTrue();
	});

	it("rejects unauthorized organization access", async () => {
		const { app } = await createTestApp();
		const response = await app.fetch(
			new Request("http://test/api/organizations/festival-admins"),
		);

		expect(response.status).toBe(401);
	});

	it("rejects malformed and invalid authorization headers", async () => {
		const { app } = await createTestApp();

		const malformed = await app.fetch(
			new Request("http://test/api/organizations/festival-admins", {
				headers: { Authorization: "Basic admin" },
			}),
		);
		expect(malformed.status).toBe(401);
		await expect(malformed.json()).resolves.toMatchObject({
			error: "Authorization header must use Bearer token format.",
		});

		const invalid = await app.fetch(
			new Request(
				"http://test/api/organizations/festival-admins",
				withAuth("invalid"),
			),
		);
		expect(invalid.status).toBe(401);
		await expect(invalid.json()).resolves.toMatchObject({
			error: "Invalid token",
		});
	});

	it("rejects cross-tenant organization access without returning org data", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request("http://test/api/organizations/pafe", withAuth("outsider")),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "Organization access denied.",
		});
	});

	it("creates and accepts an allowed-role invite", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Music Reviewer",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(inviteResponse.status).toBe(201);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string; role: string; status: string };
		};
		expect(inviteData.invite.role).toBe("Music Reviewer");
		expect(inviteData.invite.status).toBe("pending");

		const lookupResponse = await app.fetch(
			new Request(`http://test/api/invites/${inviteData.invite.token}`),
		);
		expect(lookupResponse.status).toBe(200);
		const lookupData = (await lookupResponse.json()) as {
			invite: {
				organizationSlug: string;
				email: string;
				role: string;
				status: string;
			};
		};
		expect(lookupData.invite).toMatchObject({
			organizationSlug: "pafe",
			email: "invitee@example.com",
			role: "Music Reviewer",
			status: "pending",
		});

		const acceptResponse = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reviewer" }),
				}),
			),
		);

		expect(acceptResponse.status).toBe(201);
		const acceptData = (await acceptResponse.json()) as {
			membership: { role: string; showWelcome: boolean };
		};
		expect(acceptData.membership.role).toBe("Music Reviewer");
		expect(acceptData.membership.showWelcome).toBeTrue();
	});

	it("rejects admin-only invite creation for non-admin organization members", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};

		await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);

		const nonAdminInvite = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "outsider@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(nonAdminInvite.status).toBe(403);
		await expect(nonAdminInvite.json()).resolves.toEqual({
			error: "Insufficient organization role.",
		});
	});

	it("rejects invite creation for non-members and unknown invite tokens", async () => {
		const { app } = await createTestApp();

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(inviteResponse.status).toBe(403);
		await expect(inviteResponse.json()).resolves.toEqual({
			error: "Organization access denied.",
		});

		const lookupResponse = await app.fetch(
			new Request("http://test/api/invites/missing-token"),
		);
		expect(lookupResponse.status).toBe(404);
	});

	it("rejects duplicate invite acceptance", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};

		const firstAccept = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);
		expect(firstAccept.status).toBe(201);

		const secondAccept = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);

		expect(secondAccept.status).toBe(409);
		await expect(secondAccept.json()).resolves.toMatchObject({
			error: "Invite has already been accepted.",
		});
	});

	it("lists accepted and pending admin users, blocks duplicates, and deletes rows", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Music Reviewer",
					} satisfies CreateInviteInput),
				}),
			),
		);
		expect(inviteResponse.status).toBe(201);

		const duplicateInvite = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "INVITEE@example.com",
						role: "Admin",
					} satisfies CreateInviteInput),
				}),
			),
		);
		expect(duplicateInvite.status).toBe(409);

		const usersResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("admin"),
			),
		);
		expect(usersResponse.status).toBe(200);
		const usersData = (await usersResponse.json()) as {
			users: Array<{
				id: string;
				email: string;
				status: "accepted" | "pending";
				isSelf: boolean;
			}>;
		};
		expect(usersData.users.map((user) => user.status)).toEqual([
			"accepted",
			"pending",
		]);
		expect(usersData.users[0]?.isSelf).toBeTrue();

		const selfDelete = await app.fetch(
			new Request(
				`http://test/api/organizations/pafe/admin/memberships/${usersData.users[0]?.id}`,
				withAuth("admin", { method: "DELETE" }),
			),
		);
		expect(selfDelete.status).toBe(400);

		const pendingDelete = await app.fetch(
			new Request(
				`http://test/api/organizations/pafe/admin/invites/${usersData.users[1]?.id}`,
				withAuth("admin", { method: "DELETE" }),
			),
		);
		expect(pendingDelete.status).toBe(200);

		const afterDelete = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("admin"),
			),
		);
		const afterDeleteData = (await afterDelete.json()) as {
			users: Array<{ email: string }>;
		};
		expect(afterDeleteData.users.map((user) => user.email)).toEqual([
			"admin@example.com",
		]);
	});

	it("requires Admin role for admin users and festivals subpages", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};
		await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Read Only User" }),
				}),
			),
		);

		const usersResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("invitee"),
			),
		);
		const festivalsResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("invitee"),
			),
		);

		expect(usersResponse.status).toBe(403);
		expect(festivalsResponse.status).toBe(403);
	});

	it("creates and lists organization festivals with validation", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const createResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Spring Festival (West)",
						startDate: "2027-06-10",
						endDate: "2027-06-12",
					}),
				}),
			),
		);
		expect(createResponse.status).toBe(201);
		const createData = (await createResponse.json()) as {
			festival: { code: string; name: string };
		};
		expect(createData.festival.name).toBe("Spring Festival (West)");
		expect(createData.festival.code).toHaveLength(6);

		const duplicateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "spring festival (west)",
						startDate: "2027-06-10",
						endDate: "2027-06-12",
					}),
				}),
			),
		);
		expect(duplicateResponse.status).toBe(409);

		const invalidDateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Summer Festival",
						startDate: "2027-06-12",
						endDate: "2027-06-10",
					}),
				}),
			),
		);
		expect(invalidDateResponse.status).toBe(400);

		const pastDateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Past Festival",
						startDate: "2020-06-10",
						endDate: "2020-06-12",
					}),
				}),
			),
		);
		expect(pastDateResponse.status).toBe(400);
		await expect(pastDateResponse.json()).resolves.toMatchObject({
			error: "Festival start date cannot be in the past.",
		});

		const listResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin"),
			),
		);
		const listData = (await listResponse.json()) as {
			festivals: Array<{ name: string; startDate: string; endDate: string }>;
		};
		expect(listData.festivals).toHaveLength(1);
		expect(listData.festivals[0]).toMatchObject({
			name: "Spring Festival (West)",
			startDate: "2027-06-10",
			endDate: "2027-06-12",
		});
	});
});
