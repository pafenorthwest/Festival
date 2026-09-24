import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
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

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const app = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			member: {
				uid: "uid-member",
				email: "member@example.com",
				displayName: "Regular Member",
			},
			"division-chair": {
				uid: "uid-division-chair",
				email: "division-chair@example.com",
				displayName: "Dana Chair",
			},
		}),
	});
	return { ...app, repository };
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

const VOLUNTEERS_BASE =
	"http://test/api/organizations/pafe/festivals/spring/volunteers";

async function createOrgAndFestivalAsAdmin(app: { fetch: typeof fetch }) {
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
}

function createRolePayload(overrides: Record<string, unknown> = {}) {
	return {
		slug: "room-proctor",
		displayName: "Room Proctor",
		description: "Proctor a room during a session.",
		isRoomProctor: true,
		...overrides,
	};
}

describe("volunteer role and shift routes", () => {
	it("lets an admin create a role and rejects a non-admin", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const nonAdminResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		expect(nonAdminResponse.status).toBe(403);

		const createResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { id: string };

		const listResponse = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/roles`, withAuth("admin")),
		);
		const roles = (await listResponse.json()) as Array<{
			id: string;
			displayName: string;
		}>;
		expect(roles.find((role) => role.id === created.id)?.displayName).toBe(
			"Room Proctor",
		);
	});

	it("also lets a Division Chair create a role (broader than plain Admin)", async () => {
		const { app, repository } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) throw new Error("Expected organization to exist.");
		const user = await repository.upsertUser({
			uid: "uid-division-chair",
			email: "division-chair@example.com",
			displayName: "Dana Chair",
		});
		await repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role: "Division Chair",
			origin: "invite",
		});

		const response = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("division-chair", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		expect(response.status).toBe(201);
	});

	it("rejects a role with an invalid slug", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload({ slug: "Not A Slug!" })),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("creates a shift for a role and enforces Room Proctor fields", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const roleResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		const role = (await roleResponse.json()) as { id: string };

		const missingFieldsResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "AM" }),
				}),
			),
		);
		expect(missingFieldsResponse.status).toBe(400);

		const createShiftResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						date: "2027-03-31",
						period: "AM",
						division: "Piano",
						adjudicator: "Dr Brown",
					}),
				}),
			),
		);
		expect(createShiftResponse.status).toBe(201);

		const listShiftsResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin"),
			),
		);
		const shifts = (await listShiftsResponse.json()) as unknown[];
		expect(shifts).toHaveLength(1);
	});

	it("404s when creating a shift for a role that doesn't exist", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/missing-role/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "AM" }),
				}),
			),
		);
		expect(response.status).toBe(404);
	});

	it("does not expose a role from another festival through shift routes", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);
		const roleResponse = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		const role = (await roleResponse.json()) as { id: string };

		await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Fall Festival",
						shortName: "fall",
						startDate: "2027-10-01",
						endDate: "2027-10-05",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request(
				`http://test/api/organizations/pafe/festivals/fall/volunteers/roles/${role.id}/shifts`,
				withAuth("admin"),
			),
		);
		expect(response.status).toBe(404);
	});
});
