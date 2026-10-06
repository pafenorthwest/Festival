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

const ROOMS_BASE =
	"http://test/api/organizations/pafe/admin/festivals/spring/rooms";

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

function createRoomPayload(overrides: Record<string, unknown> = {}) {
	return {
		name: "Recital Hall",
		pianoConfigurations: [{ pianoType: "upright", count: 1 }],
		...overrides,
	};
}

describe("admin rooms routes", () => {
	it("lets an admin create a room and rejects a non-admin", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const nonAdminResponse = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify(createRoomPayload()),
				}),
			),
		);
		expect(nonAdminResponse.status).toBe(403);

		const createResponse = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRoomPayload()),
				}),
			),
		);
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as {
			id: string;
			name: string;
			pianoConfigurations: Array<{ pianoType: string; count: number }>;
		};
		expect(created.name).toBe("Recital Hall");
		expect(created.pianoConfigurations).toEqual([
			{ pianoType: "upright", count: 1 },
		]);

		const listResponse = await app.fetch(
			new Request(ROOMS_BASE, withAuth("admin")),
		);
		expect(listResponse.status).toBe(200);
		const { rooms } = (await listResponse.json()) as {
			rooms: Array<{ id: string }>;
		};
		expect(rooms.find((room) => room.id === created.id)).toBeTruthy();
	});

	it("allows a room with both upright and grand pianos summing to the max of 3", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRoomPayload({
							pianoConfigurations: [
								{ pianoType: "upright", count: 2 },
								{ pianoType: "grand", count: 1 },
							],
						}),
					),
				}),
			),
		);
		expect(response.status).toBe(201);
	});

	it("rejects a room whose total piano count exceeds 3", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRoomPayload({
							pianoConfigurations: [
								{ pianoType: "upright", count: 2 },
								{ pianoType: "grand", count: 2 },
							],
						}),
					),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("rejects a non-positive or non-integer piano count", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRoomPayload({
							pianoConfigurations: [{ pianoType: "upright", count: 0 }],
						}),
					),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("rejects a room with no name", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRoomPayload({ name: "" })),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("rejects a request with browser-controlled fields outside the allowlist", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRoomPayload({ organizationId: "someone-elses-org" }),
					),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("404s for an unknown festival", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals/does-not-exist/rooms",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRoomPayload()),
				}),
			),
		);
		expect(response.status).toBe(404);
	});

	it("keeps rooms scoped to their own festival", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);
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

		await app.fetch(
			new Request(
				ROOMS_BASE,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRoomPayload({ name: "Spring Room" })),
				}),
			),
		);
		await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals/fall/rooms",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRoomPayload({ name: "Fall Room" })),
				}),
			),
		);

		const springRooms = (await (
			await app.fetch(new Request(ROOMS_BASE, withAuth("admin")))
		).json()) as { rooms: Array<{ name: string }> };
		expect(springRooms.rooms.map((room) => room.name)).toEqual(["Spring Room"]);
	});
});
