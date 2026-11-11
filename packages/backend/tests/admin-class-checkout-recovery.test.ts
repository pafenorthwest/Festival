import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { ClassCheckoutService } from "../src/checkout/class-checkout-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminClassCheckoutRecoveryRoutes } from "../src/routes/admin-class-checkout-recovery.routes.js";

function mockRecoveryService(calls: unknown[]): ClassCheckoutService {
	const record =
		<T>(value: T) =>
		async (input: unknown) => {
			calls.push(input);
			return value;
		};
	return {
		listRecoveries: record([
			{
				recoveryReference: "recovery",
				status: "recovery_required",
				reasonCode: "checkout_creation_unknown",
				generation: 2,
			},
		]),
		resolveRecovery: record({
			status: "rejected",
			recoveryReference: "recovery",
			generation: 3,
		}),
		reapExpiredRecoveries: record(2),
	} as unknown as ClassCheckoutService;
}

async function fixture(
	options: { publicOrigin?: string } = {
		publicOrigin: "https://festival.example",
	},
) {
	const repository = new InMemoryOrganizationRepository();
	const organization = await repository.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	for (const [uid, role] of [
		["admin", "Admin"],
		["reader", "Reader"],
	] as const) {
		const user = await repository.upsertUser({
			uid,
			email: `${uid}@example.com`,
			displayName: uid,
		});
		await repository.createMembership({
			organizationId: organization.id,
			userId: user.id,
			role,
			origin: "creator",
		});
	}
	const calls: unknown[] = [];
	const app = new Hono();
	app.route(
		"/api",
		buildAdminClassCheckoutRecoveryRoutes({
			repository,
			classCheckoutService: mockRecoveryService(calls),
			publicOrigin: options.publicOrigin,
			authVerifier: {
				verify: async (uid: string): Promise<AuthenticatedUser> => ({
					uid,
					email: `${uid}@example.com`,
					displayName: uid,
				}),
			},
		}),
	);
	return { app, calls, organization };
}

describe("class checkout operator recovery routes", () => {
	const base = "/api/organizations/festival/admin/class-checkout-recoveries";
	const headers = {
		Authorization: "Bearer admin",
		Origin: "https://festival.example",
		"X-CSRF-Token": "operator-command",
		"Content-Type": "application/json",
	};
	it("requires admin tenant membership for evidence and resolution", async () => {
		const f = await fixture();
		for (const token of ["reader", "outsider"]) {
			const result = await f.app.request(base, {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(result.status).toBe(403);
		}
		expect((await f.app.request(base)).status).toBe(401);
		expect(f.calls).toHaveLength(0);
	});
	it("scopes evidence listings to the resolved organization and optional customer", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}?customerId=parent`, {
			headers,
		});
		expect(result.status).toBe(200);
		expect(result.headers.get("Cache-Control")).toBe("no-store");
		expect(f.calls).toEqual([
			{ organizationId: f.organization.id, customerId: "parent" },
		]);
		expect(await result.json()).toMatchObject({
			recoveries: [{ status: "recovery_required" }],
		});
	});
	it("requires a bounded reason, action, generation, and CSRF evidence", async () => {
		const f = await fixture();
		for (const body of [
			{},
			{ action: "recreate" },
			{ action: "abandon_unknown", expectedGeneration: -1, reason: "reviewed" },
			{ action: "abandon_unknown", expectedGeneration: 2, reason: "" },
		]) {
			expect(
				(
					await f.app.request(`${base}/recovery/resolve`, {
						method: "POST",
						headers,
						body: JSON.stringify(body),
					})
				).status,
			).toBe(400);
		}
		expect(
			(
				await f.app.request(`${base}/recovery/resolve`, {
					method: "POST",
					headers: {
						Authorization: "Bearer admin",
						"Content-Type": "application/json",
					},
					body: "{}",
				})
			).status,
		).toBe(403);
		expect(f.calls).toHaveLength(0);
	});
	it("forwards explicit abandonment acknowledgement and actor with compare-and-set generation", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/recovery/resolve`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				action: "abandon_unknown",
				expectedGeneration: 2,
				reason: "Reviewed the unresolved provider call",
				acknowledgeUnknown: true,
			}),
		});
		expect(result.status).toBe(200);
		expect(f.calls).toEqual([
			{
				organizationId: f.organization.id,
				recoveryReference: "recovery",
				expectedGeneration: 2,
				actorId: "admin",
				reason: "Reviewed the unresolved provider call",
				action: "abandon_unknown",
				shopifyCartId: undefined,
				evidenceEventId: undefined,
				acknowledgeUnknown: true,
			},
		]);
	});
	it("runs an authorized tenant-scoped expired-lease recovery pass", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/reap`, {
			method: "POST",
			headers,
		});
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ recoveredCount: 2 });
		expect(f.calls).toEqual([{ organizationId: f.organization.id }]);
	});
	it("rejects cross-origin Origin header on POST /reap with 403", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/reap`, {
			method: "POST",
			headers: {
				...headers,
				Origin: "https://evil.example",
			},
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("rejects literal 'null' Origin header on POST /reap with 403", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/reap`, {
			method: "POST",
			headers: {
				...headers,
				Origin: "null",
				Referer: "https://festival.example/admin",
			},
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("rejects forged X-Forwarded-Host when Origin and Referer are omitted on POST /reap", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/reap`, {
			method: "POST",
			headers: {
				Authorization: "Bearer admin",
				"X-CSRF-Token": "operator-command",
				"Content-Type": "application/json",
				"X-Forwarded-Host": "festival.example",
				"X-Forwarded-Proto": "https",
				Host: "festival.example",
			},
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("rejects cross-origin Origin header on POST /recovery/resolve with 403", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/recovery/resolve`, {
			method: "POST",
			headers: {
				...headers,
				Origin: "https://evil.example",
			},
			body: JSON.stringify({
				action: "abandon_unknown",
				expectedGeneration: 2,
				reason: "Reviewed the unresolved provider call",
				acknowledgeUnknown: true,
			}),
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("rejects literal 'null' Origin header on POST /recovery/resolve with 403", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/recovery/resolve`, {
			method: "POST",
			headers: {
				...headers,
				Origin: "null",
				Referer: "https://festival.example/admin",
			},
			body: JSON.stringify({
				action: "abandon_unknown",
				expectedGeneration: 2,
				reason: "Reviewed the unresolved provider call",
				acknowledgeUnknown: true,
			}),
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("rejects forged X-Forwarded-Host when Origin and Referer are omitted on POST /recovery/resolve", async () => {
		const f = await fixture();
		const result = await f.app.request(`${base}/recovery/resolve`, {
			method: "POST",
			headers: {
				Authorization: "Bearer admin",
				"X-CSRF-Token": "operator-command",
				"Content-Type": "application/json",
				"X-Forwarded-Host": "festival.example",
				"X-Forwarded-Proto": "https",
				Host: "festival.example",
			},
			body: JSON.stringify({
				action: "abandon_unknown",
				expectedGeneration: 2,
				reason: "Reviewed the unresolved provider call",
				acknowledgeUnknown: true,
			}),
		});
		expect(result.status).toBe(403);
		expect(await result.json()).toEqual({ error: "CSRF validation failed." });
		expect(f.calls).toHaveLength(0);
	});
	it("fails closed with 403 when publicOrigin is omitted on POST /reap and POST /recovery/resolve", async () => {
		const f = await fixture({ publicOrigin: undefined });
		const reapResult = await f.app.request(`${base}/reap`, {
			method: "POST",
			headers,
		});
		expect(reapResult.status).toBe(403);
		expect(await reapResult.json()).toEqual({
			error: "CSRF validation failed.",
		});
		const resolveResult = await f.app.request(`${base}/recovery/resolve`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				action: "abandon_unknown",
				expectedGeneration: 2,
				reason: "Reviewed the unresolved provider call",
				acknowledgeUnknown: true,
			}),
		});
		expect(resolveResult.status).toBe(403);
		expect(await resolveResult.json()).toEqual({
			error: "CSRF validation failed.",
		});
		expect(f.calls).toHaveLength(0);
	});
});
