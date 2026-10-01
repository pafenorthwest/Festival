import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminOrgRoutes } from "../src/routes/admin-org/admin-org.routes.js";
import { buildAdminRegistrationRoutes } from "../src/routes/admin-registration/admin-registration.routes.js";
import { OrganizationService } from "../src/services/organization-service.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		if (token === "admin") {
			return {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin",
			};
		}
		throw new Error(`Unknown token: ${token}`);
	}
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const organizationService = new OrganizationService(repository);
	const organization = await repository.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});
	const user = await repository.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: user.id,
		role: "Admin",
		origin: "creator",
	});

	const authVerifier = new FakeAuth();
	const app = new Hono();
	app.route(
		"/",
		buildAdminRegistrationRoutes({ organizationService, authVerifier }),
	);
	app.route("/", buildAdminOrgRoutes({ organizationService, authVerifier }));

	return { app, organization, repository };
}

describe("admin subtype dependency routes", () => {
	it("creates a subtype with requiredSubtypeId", async () => {
		const { app, organization } = await createTestApp();
		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Solo" }),
			},
		);
		expect(subARes.status).toBe(201);
		const subA = (await subARes.json()).value;

		const subBRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Concerto",
					requiredSubtypeId: subA.id,
				}),
			},
		);
		expect(subBRes.status).toBe(201);
		const subB = (await subBRes.json()).value;
		expect(subB.requiredSubtypeId).toBe(subA.id);
	});

	it("updates a subtype to add or change requiredSubtypeId", async () => {
		const { app, organization } = await createTestApp();
		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Solo" }),
			},
		);
		const subA = (await subARes.json()).value;

		const subBRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Duet" }),
			},
		);
		const subB = (await subBRes.json()).value;

		const updateRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes/${subB.id}`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requiredSubtypeId: subA.id }),
			},
		);
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()).value;
		expect(updated.requiredSubtypeId).toBe(subA.id);
	});

	it("removes requiredSubtypeId when set to null", async () => {
		const { app, organization } = await createTestApp();
		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Solo" }),
			},
		);
		const subA = (await subARes.json()).value;

		const subBRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Concerto",
					requiredSubtypeId: subA.id,
				}),
			},
		);
		const subB = (await subBRes.json()).value;
		expect(subB.requiredSubtypeId).toBe(subA.id);

		const removeRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes/${subB.id}`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requiredSubtypeId: null }),
			},
		);
		expect(removeRes.status).toBe(200);
		const updated = (await removeRes.json()).value;
		expect(updated.requiredSubtypeId).toBeNull();
	});

	it("returns 400 for self-dependency request", async () => {
		const { app, organization } = await createTestApp();
		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Solo" }),
			},
		);
		const subA = (await subARes.json()).value;

		const updateRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes/${subA.id}`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requiredSubtypeId: subA.id }),
			},
		);
		expect(updateRes.status).toBe(400);
		const body = await updateRes.json();
		expect(body.error).toBe("Class subtype cannot depend on itself.");
	});

	it("returns 400 for circular dependency request", async () => {
		const { app, organization } = await createTestApp();
		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Sub A" }),
			},
		);
		const subA = (await subARes.json()).value;

		const subBRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Sub B",
					requiredSubtypeId: subA.id,
				}),
			},
		);
		const subB = (await subBRes.json()).value;

		// Try making A depend on B -> cycle A -> B -> A
		const cycleRes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes/${subA.id}`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requiredSubtypeId: subB.id }),
			},
		);
		expect(cycleRes.status).toBe(400);
		const body = await cycleRes.json();
		expect(body.error).toBe("Class subtype dependency cycle detected.");
	});

	it("returns 400 when requiredSubtypeId does not exist", async () => {
		const { app, organization } = await createTestApp();
		const res = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Sub A",
					requiredSubtypeId: "missing-id",
				}),
			},
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Required class subtype was not found.");
	});

	it("returns 400 when requiredSubtypeId has invalid type", async () => {
		const { app, organization } = await createTestApp();
		const res = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Sub A",
					requiredSubtypeId: 12345,
				}),
			},
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("Required class subtype must be a string or null.");
	});

	it("rejects requiredSubtypeId on instruments create route", async () => {
		const { app, organization } = await createTestApp();
		const res = await app.request(
			`/organizations/${organization.slug}/admin/instruments`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Violin",
					requiredSubtypeId: "some-id",
				}),
			},
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain(
			"cannot include browser-controlled fields: requiredSubtypeId",
		);
	});

	it("rejects requiredSubtypeId on instruments update route", async () => {
		const { app, organization } = await createTestApp();
		const createRes = await app.request(
			`/organizations/${organization.slug}/admin/instruments`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Violin" }),
			},
		);
		expect(createRes.status).toBe(201);
		const inst = (await createRes.json()).value;

		const updateRes = await app.request(
			`/organizations/${organization.slug}/admin/instruments/${inst.id}`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ requiredSubtypeId: "some-id" }),
			},
		);
		expect(updateRes.status).toBe(400);
		const body = await updateRes.json();
		expect(body.error).toContain(
			"cannot include browser-controlled fields: requiredSubtypeId",
		);
	});

	it("creates a festival class subtype with requiredSubtypeId", async () => {
		const { app, organization, repository } = await createTestApp();
		const festival = await repository.createFestival({
			organizationId: organization.id,
			name: "Spring Festival 2027",
			shortName: "spring2027",
			startDate: "2027-05-01",
			endDate: "2027-05-05",
		});

		const subARes = await app.request(
			`/organizations/${organization.slug}/admin/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ displayName: "Solo" }),
			},
		);
		const subA = (await subARes.json()).value;

		const res = await app.request(
			`/organizations/${organization.slug}/admin/festivals/${festival.shortName}/class-subtypes`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer admin",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					displayName: "Chamber",
					requiredSubtypeId: subA.id,
				}),
			},
		);
		expect(res.status).toBe(201);
		const val = (await res.json()).value;
		expect(val.displayName).toBe("Chamber");
		expect(val.requiredSubtypeId).toBe(subA.id);
	});
});
