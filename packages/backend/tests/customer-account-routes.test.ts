import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class Auth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		if (token !== "admin") throw new Error("invalid");
		return { uid: "admin", email: "admin@example.com", displayName: "Admin" };
	}
}
function service() {
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
	} as unknown as CustomerAccountService;
}
async function app() {
	const repository = new InMemoryOrganizationRepository();
	const created = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new Auth(),
		customerAccountService: service(),
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
	it("keeps Customer Account Admin settings behind Firebase tenant Admin authorization", async () => {
		const a = await app();
		const response = await a.request(
			"/api/organizations/festival/admin/shopify-customer-account",
		);
		expect(response.status).toBe(401);
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
