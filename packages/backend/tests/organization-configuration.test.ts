import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { OrganizationService } from "../src/services/organization-service.js";

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}
	async verify(token: string): Promise<AuthenticatedUser> {
		const user = this.users[token];
		if (!user) throw new Error("Invalid token");
		return user;
	}
}

const users = {
	admin: { uid: "admin", email: "admin@example.com", displayName: "Admin" },
	other: { uid: "other", email: "other@example.com", displayName: "Other" },
	reviewer: {
		uid: "reviewer",
		email: "reviewer@example.com",
		displayName: "Reviewer",
	},
};

function request(token: string | undefined, method = "GET", body?: unknown) {
	return {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	};
}

async function setup() {
	const repository = new InMemoryOrganizationRepository();
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier(users),
	});
	for (const [token, name, shortName] of [
		["admin", "Festival Admins", "pafe"],
		["other", "Other Festival", "other"],
	] as const) {
		const response = await app.request(
			"/api/organizations",
			request(token, "POST", { name, shortName }),
		);
		expect(response.status).toBe(201);
	}
	return { app, repository };
}

describe("organization division and timezone configuration", () => {
	it("assigns unique deterministic orders to concurrent creates", async () => {
		const { app } = await setup();
		const responses = await Promise.all(
			["Strings", "Brass"].map((displayName) =>
				app.request(
					"/api/organizations/pafe/admin/divisions",
					request("admin", "POST", { displayName }),
				),
			),
		);
		expect(responses.map((response) => response.status)).toEqual([201, 201]);
		const listing = await app.request(
			"/api/organizations/pafe/admin/divisions",
			request("admin"),
		);
		expect(
			(await listing.json()).divisions.map(
				(division: { displayOrder: number }) => division.displayOrder,
			),
		).toEqual([0, 1]);
	});

	it("normalizes names, preserves stable IDs, orders divisions, and exposes an active-only allowlist", async () => {
		const { app, repository } = await setup();
		const create = async (displayName: string) => {
			const response = await app.request(
				"/api/organizations/pafe/admin/divisions",
				request("admin", "POST", { displayName }),
			);
			return { response, body: await response.json() };
		};

		const high = await create("  High   Strings  ");
		const brass = await create("Brass");
		expect(high.response.status).toBe(201);
		expect(high.body.division.displayName).toBe("High Strings");

		const duplicate = await create("high strings");
		expect(duplicate.response.status).toBe(409);

		const reorder = await app.request(
			"/api/organizations/pafe/admin/divisions/reorder",
			request("admin", "POST", {
				divisionIds: [brass.body.division.id, high.body.division.id],
			}),
		);
		expect(reorder.status).toBe(200);
		expect(
			(await reorder.json()).divisions.map((item: { id: string }) => item.id),
		).toEqual([brass.body.division.id, high.body.division.id]);

		const update = await app.request(
			`/api/organizations/pafe/admin/divisions/${high.body.division.id}`,
			request("admin", "POST", { displayName: "Strings", isActive: false }),
		);
		const updated = (await update.json()).division;
		expect(updated.id).toBe(high.body.division.id);
		expect(updated.isActive).toBe(false);

		const publicResponse = await app.request(
			"/api/organizations/pafe/divisions",
		);
		expect(publicResponse.status).toBe(200);
		expect(await publicResponse.json()).toEqual({
			divisions: [
				{ id: brass.body.division.id, displayName: "Brass", displayOrder: 0 },
			],
		});
		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) throw new Error("Expected Organization.");
		const service = new OrganizationService(repository);
		expect(
			(
				await service.requireSelectableDivision(
					organization.id,
					brass.body.division.id,
				)
			).id,
		).toBe(brass.body.division.id);
		await expect(
			service.requireSelectableDivision(organization.id, high.body.division.id),
		).rejects.toThrow("Division is not available for a new purchase.");
	});

	it("validates IANA timezones and derives organization authority from tenant context", async () => {
		const { app, repository } = await setup();
		const initial = await app.request(
			"/api/organizations/pafe/admin/timezone",
			request("admin"),
		);
		expect(await initial.json()).toEqual({ timezone: "UTC" });

		const invalid = await app.request(
			"/api/organizations/pafe/admin/timezone",
			request("admin", "POST", { timezone: "Pacific/Nowhere" }),
		);
		expect(invalid.status).toBe(400);

		const valid = await app.request(
			"/api/organizations/pafe/admin/timezone",
			request("admin", "POST", { timezone: "America/Los_Angeles" }),
		);
		expect(await valid.json()).toEqual({ timezone: "America/Los_Angeles" });

		const browserAuthority = await app.request(
			"/api/organizations/pafe/admin/divisions",
			request("admin", "POST", {
				displayName: "Piano",
				organizationId: "other",
			}),
		);
		expect(browserAuthority.status).toBe(400);

		const crossTenant = await app.request(
			"/api/organizations/pafe/admin/divisions",
			request("other"),
		);
		expect(crossTenant.status).toBe(403);

		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) throw new Error("Expected Organization.");
		const reviewer = await repository.upsertUser(users.reviewer);
		await repository.createMembership({
			organizationId: organization.id,
			userId: reviewer.id,
			role: "Read Only",
			origin: "invite",
		});
		const nonAdmin = await app.request(
			"/api/organizations/pafe/admin/timezone",
			request("reviewer", "POST", { timezone: "UTC" }),
		);
		expect(nonAdmin.status).toBe(403);
	});

	it("sanitizes unexpected repository failures while preserving invalid-order responses", async () => {
		const { app, repository } = await setup();
		const created = await app.request(
			"/api/organizations/pafe/admin/divisions",
			request("admin", "POST", { displayName: "Strings" }),
		);
		expect(created.status).toBe(201);

		const invalidOrder = await app.request(
			"/api/organizations/pafe/admin/divisions/reorder",
			request("admin", "POST", { divisionIds: [] }),
		);
		expect(invalidOrder.status).toBe(400);
		expect(await invalidOrder.json()).toEqual({
			error:
				"Division order must contain every organization division exactly once.",
		});

		repository.reorderDivisions = async () => {
			throw new Error("database connection details");
		};
		const repositoryFailure = await app.request(
			"/api/organizations/pafe/admin/divisions/reorder",
			request("admin", "POST", { divisionIds: [] }),
		);
		expect(repositoryFailure.status).toBe(500);
		expect(await repositoryFailure.json()).toEqual({
			error: "Internal server error.",
		});
	});
});
