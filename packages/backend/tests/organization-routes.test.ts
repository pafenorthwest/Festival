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
		const payload: CreateOrganizationInput = { name: "festival-admins" };

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
			organization: { slug: string };
		};
		expect(data.organization.slug).toBe("festival-admins");
		expect(data.membership.role).toBe("Admin");
	});

	it("rejects duplicate organization names", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);

		const duplicate = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({ name: "festival-admins" }),
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
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);
		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ name: "festival-board" }),
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
		).toEqual(["festival-admins", "festival-board"]);
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
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/festival-admins",
				withAuth("outsider"),
			),
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
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "festival-admins",
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
			organizationSlug: "festival-admins",
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
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "festival-admins",
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
						organizationSlug: "festival-admins",
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
						organizationSlug: "festival-admins",
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
					body: JSON.stringify({ name: "festival-admins" }),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "festival-admins",
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
});
