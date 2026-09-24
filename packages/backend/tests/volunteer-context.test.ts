import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import {
	type ApiVariables,
	getRequiredIdentity,
	requireAuth,
	requireTenant,
} from "../src/auth/tenant-context.js";
import type { AuthVerifier } from "../src/auth/types.js";
import {
	requireAdminIntent,
	VOLUNTEER_ADMIN_ROLES,
} from "../src/auth/volunteer-context.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { InMemoryVolunteerRepository } from "../src/volunteers/volunteer-repository.js";

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new Error(`Unknown token ${token}`);
		return user;
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
	const volunteerRepository = new InMemoryVolunteerRepository();
	const app = await createApp({
		env: { port: 3000 },
		repository,
		volunteerRepository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			volunteer: {
				uid: "uid-volunteer",
				email: "volunteer@example.com",
				displayName: "Vera Volunteer",
			},
			"other-volunteer": {
				uid: "uid-other-volunteer",
				email: "other-volunteer@example.com",
				displayName: "Vic Volunteer",
			},
		}),
	});
	return { ...app, repository, volunteerRepository };
}

async function createOrgAndFestival(app: { fetch: typeof fetch }) {
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
}

describe("volunteer enrollment (requireVolunteerScope)", () => {
	it("returns roles only from the festival named in the URL", async () => {
		const { app, repository, volunteerRepository } = await createTestApp();
		await createOrgAndFestival(app);
		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) throw new Error("Expected test organization.");
		const spring = await repository.findFestivalByShortName(
			organization.id,
			"spring",
		);
		const fall = await repository.findFestivalByShortName(
			organization.id,
			"fall",
		);
		if (!spring || !fall) throw new Error("Expected test festivals.");

		const springRole = await volunteerRepository.createRole({
			organizationId: organization.id,
			festivalId: spring.id,
			slug: "spring-role",
			displayName: "Spring Role",
			description: "Spring role",
			detailsUrl: null,
			isRoomProctor: false,
		});
		await volunteerRepository.createRole({
			organizationId: organization.id,
			festivalId: fall.id,
			slug: "fall-role",
			displayName: "Fall Role",
			description: "Fall role",
			detailsUrl: null,
			isRoomProctor: false,
		});

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/roles",
				withAuth("volunteer"),
			),
		);

		expect(response.status).toBe(200);
		expect(
			((await response.json()) as Array<{ id: string }>).map((role) => role.id),
		).toEqual([springRole.id]);
	});

	it("lets a non-member enroll as a volunteer for a festival", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestival(app);

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
		const body = (await response.json()) as {
			firebaseUid: string;
			festivalId: string;
			name: string;
		};
		expect(body.firebaseUid).toBe("uid-volunteer");
		expect(body.name).toBe("Vera Volunteer");
	});

	it("rejects an unauthenticated enrollment request", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestival(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/enroll",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "Vera Volunteer", phone: "555-0100" }),
				},
			),
		);

		expect(response.status).toBe(401);
	});

	it("404s for an unknown organization or festival", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestival(app);

		const badOrg = await app.fetch(
			new Request(
				"http://test/api/organizations/does-not-exist/festivals/spring/volunteers/enroll",
				withAuth("volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vera Volunteer", phone: "555-0100" }),
				}),
			),
		);
		expect(badOrg.status).toBe(404);

		const badFestival = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/does-not-exist/volunteers/enroll",
				withAuth("volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vera Volunteer", phone: "555-0100" }),
				}),
			),
		);
		expect(badFestival.status).toBe(404);
	});

	it("rejects a missing name or phone", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestival(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/enroll",
				withAuth("volunteer", {
					method: "POST",
					body: JSON.stringify({}),
				}),
			),
		);
		expect(response.status).toBe(400);
	});

	it("updates the same enrollment on re-enrollment, and keeps festivals separate", async () => {
		const { app } = await createTestApp();
		await createOrgAndFestival(app);

		const first = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/enroll",
				withAuth("other-volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vic", phone: "555-0101" }),
				}),
			),
		);
		const firstBody = (await first.json()) as { id: string };

		const second = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/spring/volunteers/enroll",
				withAuth("other-volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vic Updated", phone: "555-0102" }),
				}),
			),
		);
		const secondBody = (await second.json()) as { id: string; name: string };
		expect(secondBody.id).toBe(firstBody.id);
		expect(secondBody.name).toBe("Vic Updated");

		const otherFestival = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/festivals/fall/volunteers/enroll",
				withAuth("other-volunteer", {
					method: "POST",
					body: JSON.stringify({ name: "Vic", phone: "555-0101" }),
				}),
			),
		);
		const otherFestivalBody = (await otherFestival.json()) as { id: string };
		expect(otherFestivalBody.id).not.toBe(firstBody.id);
	});
});

describe("requireAdminIntent", () => {
	async function createTestAppWithGuardedRoute() {
		const repository = new InMemoryOrganizationRepository();
		const authVerifier = new FakeAuthVerifier({
			"role-holder": {
				uid: "uid-role-holder",
				email: "role-holder@example.com",
				displayName: "Role Holder",
			},
		});

		const router = new Hono<{ Variables: Partial<ApiVariables> }>();
		router.get(
			"/organizations/:slug/volunteer-admin-check",
			requireAuth(authVerifier),
			requireTenant(repository),
			requireAdminIntent(),
			(c) => c.json({ role: getRequiredIdentity(c) && "ok" }),
		);

		const organization = await repository.createOrganization({
			name: "Festival Admins",
			slug: "pafe",
		});
		const user = await repository.upsertUser({
			uid: "uid-role-holder",
			email: "role-holder@example.com",
			displayName: "Role Holder",
		});

		return { router, repository, organization, user };
	}

	it.each(VOLUNTEER_ADMIN_ROLES)("allows the %s role", async (role) => {
		const { router, repository, organization, user } =
			await createTestAppWithGuardedRoute();
		await repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role,
			origin: "invite",
		});

		const response = await router.fetch(
			new Request("http://test/organizations/pafe/volunteer-admin-check", {
				headers: { Authorization: "Bearer role-holder" },
			}),
		);
		expect(response.status).toBe(200);
	});

	it.each([
		"Music Reviewer",
		"Read Only",
	] as const)("blocks the %s role", async (role) => {
		const { router, repository, organization, user } =
			await createTestAppWithGuardedRoute();
		await repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role,
			origin: "invite",
		});

		const response = await router.fetch(
			new Request("http://test/organizations/pafe/volunteer-admin-check", {
				headers: { Authorization: "Bearer role-holder" },
			}),
		);
		expect(response.status).toBe(403);
	});
});
