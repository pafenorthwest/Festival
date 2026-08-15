import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class Auth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		if (!new Set(["admin", "reader", "outsider"]).has(token))
			throw new Error("invalid");
		return {
			uid: token,
			email: `${token}@example.com`,
			displayName: token,
		};
	}
}
function service(overrides: Record<string, unknown> = {}) {
	return {
		getSettings: async () => ({ settings: null }),
		saveAndVerify: async () => ({ settings: {} }),
		start: async () => "https://accounts.shopify.com/auth",
		callback: async () => ({
			sessionId: "opaque-session",
			returnTo: "/org/festival/account",
			maxAgeSeconds: 3600,
		}),
		session: async (_slug: string, id?: string) => ({
			session: id
				? {
						authenticated: true,
						csrfToken: "csrf",
						expiresAtIso: "2026-09-01T00:00:00.000Z",
					}
				: { authenticated: false },
		}),
		orders: async () => ({
			orders: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
		logout: async () => "https://accounts.shopify.com/logout",
		customerProfile: async () => ({
			profile: {
				name: "Customer",
				email: "customer@example.com",
				mailingAddress: null,
				phone: null,
				updatedAtIso: "2026-08-14T00:00:00.000Z",
			},
		}),
		updateCustomerProfile: async () => ({
			profile: {
				name: "Updated",
				email: "customer@example.com",
				mailingAddress: null,
				phone: null,
				updatedAtIso: "2026-08-14T00:00:00.000Z",
			},
		}),
		searchAdminCustomers: async () => ({ customers: [] }),
		adminCustomerProfile: async () => ({
			customerId: "cus_internal",
			profile: {
				name: "Customer",
				email: "customer@example.com",
				mailingAddress: null,
				phone: null,
				updatedAtIso: "2026-08-14T00:00:00.000Z",
			},
		}),
		...overrides,
	} as unknown as CustomerAccountService;
}
async function app(customerAccountService = service()) {
	const repository = new InMemoryOrganizationRepository();
	const organization = await repository.createOrganization({
		name: "Festival",
		slug: "festival",
	});
	const user = await repository.upsertUser({
		uid: "admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: user.id,
		role: "Admin",
		origin: "creator",
	});
	const reader = await repository.upsertUser({
		uid: "reader",
		email: "reader@example.com",
		displayName: "Reader",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: reader.id,
		role: "Read Only",
		origin: "invite",
	});
	const created = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new Auth(),
		customerAccountService,
	});
	return created.app;
}

describe("customer account routes", () => {
	it("issues only an opaque secure HttpOnly SameSite cookie at callback", async () => {
		const a = await app();
		const response = await a.request(
			"/api/customer-auth/callback?state=state&code=code",
		);
		expect(response.status).toBe(302);
		const cookie = response.headers.get("set-cookie") ?? "";
		expect(cookie).toContain("festival_customer_session=opaque-session");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).not.toContain("access_token");
	});
	it("does not treat a Firebase bearer token as a customer session", async () => {
		const a = await app();
		const response = await a.request(
			"/api/organizations/festival/customer/session",
			{ headers: { Authorization: "Bearer admin" } },
		);
		expect(response.status).toBe(400);
	});
	it("reads and updates only the cookie-authenticated customer profile", async () => {
		let updateArguments: unknown[] = [];
		const a = await app(
			service({
				updateCustomerProfile: async (...args: unknown[]) => {
					updateArguments = args;
					return {
						profile: {
							name: "Updated",
							email: "updated@example.com",
							mailingAddress: null,
							phone: null,
							updatedAtIso: "2026-08-14T00:00:00.000Z",
						},
					};
				},
			}),
		);
		const read = await a.request(
			"/api/organizations/festival/customer/profile",
			{ headers: { Cookie: "festival_customer_session=opaque-session" } },
		);
		expect(read.status).toBe(200);
		expect(await read.json()).not.toHaveProperty("customerId");
		const rejected = await a.request(
			"/api/organizations/festival/customer/profile",
			{ headers: { Authorization: "Bearer admin" } },
		);
		expect(rejected.status).toBe(400);
		const updated = await a.request(
			"/api/organizations/festival/customer/profile",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: "festival_customer_session=opaque-session",
					Origin: "https://festival.example.com",
					"X-CSRF-Token": "csrf",
				},
				body: JSON.stringify({ name: "Updated" }),
			},
		);
		expect(updated.status).toBe(200);
		expect(updateArguments).toEqual([
			"festival",
			"opaque-session",
			"csrf",
			"https://festival.example.com",
			{ name: "Updated" },
		]);
	});
	it("keeps Customer Account Admin settings behind Firebase tenant Admin authorization", async () => {
		const a = await app();
		const response = await a.request(
			"/api/organizations/festival/admin/shopify-customer-account",
		);
		expect(response.status).toBe(401);
	});
	it("passes the authenticated Admin actor to customer search auditing", async () => {
		let searchArguments: unknown[] = [];
		const a = await app(
			service({
				searchAdminCustomers: async (...args: unknown[]) => {
					searchArguments = args;
					return { customers: [] };
				},
			}),
		);
		const response = await a.request(
			"/api/organizations/festival/admin/customers?query=customer",
			{ headers: { Authorization: "Bearer admin" } },
		);
		expect(response.status).toBe(200);
		expect(searchArguments[1]).toBe("customer");
		expect(searchArguments[2]).toBe("admin");
		const nonAdmin = await a.request(
			"/api/organizations/festival/admin/customers?query=customer",
			{ headers: { Authorization: "Bearer reader" } },
		);
		expect(nonAdmin.status).toBe(403);
		const otherTenant = await a.request(
			"/api/organizations/festival/admin/customers?query=customer",
			{ headers: { Authorization: "Bearer outsider" } },
		);
		expect(otherTenant.status).toBe(403);
	});
	it("performs logout as a server redirect and clears the opaque cookie", async () => {
		const a = await app();
		const response = await a.request(
			"/api/organizations/festival/customer/logout",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Cookie: "festival_customer_session=opaque-session",
					Origin: "https://festival.example.com",
				},
				body: "csrfToken=csrf",
			},
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://accounts.shopify.com/logout",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"festival_customer_session=",
		);
	});
});
