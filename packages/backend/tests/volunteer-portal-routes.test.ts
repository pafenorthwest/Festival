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
			volunteer2: {
				uid: "uid-volunteer2",
				email: "volunteer2@example.com",
				displayName: "Volunteer Two",
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
		slug: "greeter",
		displayName: "Greeter",
		description: "Greet volunteers and guests.",
		isRoomProctor: false,
		...overrides,
	};
}

describe("volunteer portal routes", () => {
	it("allows authenticated volunteers without admin role to browse /roles", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);

		const response = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/roles`, withAuth("member")),
		);
		expect(response.status).toBe(200);
		const roles = (await response.json()) as Array<{ slug: string }>;
		expect(roles.length).toBeGreaterThan(0);
	});

	it("browses shifts with role info and checks availability via GET /shifts", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const roleRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(createRolePayload()),
				}),
			),
		);
		const role = (await roleRes.json()) as { id: string };

		const shiftRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "AM" }),
				}),
			),
		);
		const shift = (await shiftRes.json()) as { id: string };

		const shiftsResponse = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/shifts`, withAuth("member")),
		);
		expect(shiftsResponse.status).toBe(200);
		const shifts = (await shiftsResponse.json()) as Array<{
			id: string;
			available: boolean;
			role: { displayName: string };
		}>;
		expect(shifts).toHaveLength(1);
		expect(shifts[0].id).toBe(shift.id);
		expect(shifts[0].available).toBe(true);
		expect(shifts[0].role.displayName).toBe("Greeter");
	});

	it("manages booking lifecycle, conflicts, schedule, and cancellation", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const roleRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRolePayload({ slug: "usher", displayName: "Usher" }),
					),
				}),
			),
		);
		const role = (await roleRes.json()) as { id: string };

		const s1Res = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "AM" }),
				}),
			),
		);
		const s1 = (await s1Res.json()) as { id: string };

		const s2Res = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "PM" }),
				}),
			),
		);
		const s2 = (await s2Res.json()) as { id: string };

		// 1. Unenrolled user cannot book (404)
		const unenrolledBook = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [s1.id] }),
				}),
			),
		);
		expect(unenrolledBook.status).toBe(404);

		// Enroll member and volunteer2
		await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/enroll`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ name: "Alice Member", phone: "555-1111" }),
				}),
			),
		);
		await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/enroll`,
				withAuth("volunteer2", {
					method: "POST",
					body: JSON.stringify({ name: "Bob Second", phone: "555-2222" }),
				}),
			),
		);

		// 2. Validate { shiftIds } (400)
		const invalidBook = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [] }),
				}),
			),
		);
		expect(invalidBook.status).toBe(400);

		// 3. Check empty schedule
		const emptySchedule = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/my-schedule`, withAuth("member")),
		);
		expect(emptySchedule.status).toBe(200);
		expect(await emptySchedule.json()).toEqual([]);

		// 4. Successful booking
		const bookRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [s1.id] }),
				}),
			),
		);
		expect(bookRes.status).toBe(200);
		const bookData = (await bookRes.json()) as {
			assignments: Array<{ id: string; shiftId: string }>;
		};
		expect(bookData.assignments).toHaveLength(1);
		const assignmentId = bookData.assignments[0].id;

		// 5. GET /shifts reflects booked status & query param filter
		const openShiftsRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/shifts?available=true`,
				withAuth("member"),
			),
		);
		const openShifts = (await openShiftsRes.json()) as Array<{ id: string }>;
		expect(openShifts.map((s) => s.id)).not.toContain(s1.id);
		expect(openShifts.map((s) => s.id)).toContain(s2.id);

		// 6. Conflict 409 when double booking same shift
		const doubleBookRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("volunteer2", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [s1.id] }),
				}),
			),
		);
		expect(doubleBookRes.status).toBe(409);

		// 7. GET /my-schedule returns active assignments
		const scheduleRes = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/my-schedule`, withAuth("member")),
		);
		expect(scheduleRes.status).toBe(200);
		const schedule = (await scheduleRes.json()) as Array<{
			assignment: { id: string };
			shift: { id: string };
			role: { displayName: string };
		}>;
		expect(schedule).toHaveLength(1);
		expect(schedule[0].assignment.id).toBe(assignmentId);
		expect(schedule[0].shift.id).toBe(s1.id);
		expect(schedule[0].role.displayName).toBe("Usher");

		// 8. Non-owner cannot cancel assignment (403)
		const forbiddenCancel = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/assignments/${assignmentId}/cancel`,
				withAuth("volunteer2", { method: "POST" }),
			),
		);
		expect(forbiddenCancel.status).toBe(403);

		// 9. Owner can cancel assignment (200)
		const ownerCancel = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/assignments/${assignmentId}/cancel`,
				withAuth("member", { method: "POST" }),
			),
		);
		expect(ownerCancel.status).toBe(200);

		// 10. Repeated cancel returns 404
		const repeatCancel = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/assignments/${assignmentId}/cancel`,
				withAuth("member", { method: "POST" }),
			),
		);
		expect(repeatCancel.status).toBe(404);

		// 11. Re-booking after cancellation succeeds, and admin can cancel any assignment
		const rebookRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("volunteer2", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [s1.id] }),
				}),
			),
		);
		expect(rebookRes.status).toBe(200);
		const rebookData = (await rebookRes.json()) as {
			assignments: Array<{ id: string }>;
		};
		const newAssignmentId = rebookData.assignments[0].id;

		const adminCancel = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/assignments/${newAssignmentId}/cancel`,
				withAuth("admin", { method: "POST" }),
			),
		);
		expect(adminCancel.status).toBe(200);
	});

	it("manages coverage gaps metrics and enforces admin authorization", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestivalAsAdmin(app);

		const roleRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						createRolePayload({
							slug: "info-booth",
							displayName: "Info Booth",
						}),
					),
				}),
			),
		);
		const role = (await roleRes.json()) as { id: string };

		const shiftRes = await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/roles/${role.id}/shifts`,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ date: "2027-03-31", period: "AM" }),
				}),
			),
		);
		const shift = (await shiftRes.json()) as { id: string };

		// Non-admin cannot view coverage gaps (403)
		const nonAdminRes = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/coverage-gaps`, withAuth("member")),
		);
		expect(nonAdminRes.status).toBe(403);

		// Admin views coverage gaps before any bookings
		const initialGapsRes = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/coverage-gaps`, withAuth("admin")),
		);
		expect(initialGapsRes.status).toBe(200);
		const initialGaps = (await initialGapsRes.json()) as {
			totalShifts: number;
			filledShifts: number;
			openShifts: number;
			coveragePercentage: number;
			gaps: Array<{ shiftId: string }>;
		};
		expect(initialGaps.totalShifts).toBe(1);
		expect(initialGaps.filledShifts).toBe(0);
		expect(initialGaps.openShifts).toBe(1);
		expect(initialGaps.coveragePercentage).toBe(0);
		expect(initialGaps.gaps).toHaveLength(1);
		expect(initialGaps.gaps[0].shiftId).toBe(shift.id);

		// Enroll member and book the shift
		await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/enroll`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ name: "Alice Member", phone: "555-1111" }),
				}),
			),
		);
		await app.fetch(
			new Request(
				`${VOLUNTEERS_BASE}/book`,
				withAuth("member", {
					method: "POST",
					body: JSON.stringify({ shiftIds: [shift.id] }),
				}),
			),
		);

		// Admin views coverage gaps after booking
		const filledGapsRes = await app.fetch(
			new Request(`${VOLUNTEERS_BASE}/coverage-gaps`, withAuth("admin")),
		);
		expect(filledGapsRes.status).toBe(200);
		const filledGaps = (await filledGapsRes.json()) as {
			totalShifts: number;
			filledShifts: number;
			openShifts: number;
			coveragePercentage: number;
			gaps: Array<{ shiftId: string }>;
		};
		expect(filledGaps.totalShifts).toBe(1);
		expect(filledGaps.filledShifts).toBe(1);
		expect(filledGaps.openShifts).toBe(0);
		expect(filledGaps.coveragePercentage).toBe(100);
		expect(filledGaps.gaps).toHaveLength(0);
	});
});
