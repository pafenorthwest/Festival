import { describe, expect, it } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";

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
async function app(
	customerAccountService = service(),
	publicMembershipProductService?: PublicMembershipProductService,
) {
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
		publicMembershipProductService,
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
	it("validates a local offering before auth start and again before callback cookie issuance", async () => {
		const resolutions: Array<[string, string]> = [];
		const publicService = {
			resolvePurchasable: async (slug: string, offeringId: string) => {
				resolutions.push([slug, offeringId]);
				return {
					selection: {
						offeringId,
						organizationSlug: slug,
						entitlementClass: "teacher_membership" as const,
					},
				};
			},
		} as unknown as PublicMembershipProductService;
		let startArguments: unknown[] = [];
		const a = await app(
			service({
				start: async (...args: unknown[]) => {
					startArguments = args;
					return "https://accounts.shopify.com/auth";
				},
				callback: async (...args: unknown[]) => {
					const validate = args[2] as (
						slug: string,
						offeringId: string,
					) => Promise<unknown>;
					await validate("festival", "offering_123");
					return {
						sessionId: "opaque-session",
						returnTo: "/org/festival/membership?purchase=offering_123",
						organizationSlug: "festival",
						offeringId: "offering_123",
						maxAgeSeconds: 3600,
					};
				},
			}),
			publicService,
		);
		const start = await a.request(
			"/api/organizations/festival/customer-auth/start?offering=offering_123",
		);
		expect(start.status).toBe(302);
		expect(startArguments).toEqual(["festival", undefined, "offering_123"]);
		const callback = await a.request(
			"/api/customer-auth/callback?state=state&code=code",
		);
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location")).toBe(
			"/org/festival/membership?purchase=offering_123",
		);
		expect(resolutions).toEqual([
			["festival", "offering_123"],
			["festival", "offering_123"],
		]);

		const unsupported = await a.request(
			"/api/organizations/festival/customer-auth/start?shopifyVariantGid=gid%3A%2F%2Fshopify%2FProductVariant%2F1",
		);
		expect(unsupported.status).toBe(400);
		const duplicate = await a.request(
			"/api/organizations/festival/customer-auth/start?offering=offering_123&offering=offering_456",
		);
		expect(duplicate.status).toBe(400);
	});

	it("denies anonymous purchase continuation and returns only a revalidated local selection", async () => {
		const calls: Array<[string, string]> = [];
		const publicService = {
			resolvePurchasable: async (slug: string, offeringId: string) => {
				calls.push([slug, offeringId]);
				return {
					selection: {
						offeringId,
						organizationSlug: slug,
						entitlementClass: "teacher_membership" as const,
					},
				};
			},
		} as unknown as PublicMembershipProductService;
		const a = await app(service(), publicService);
		const anonymous = await a.request(
			"/api/organizations/festival/customer/membership-purchase/offering_123",
		);
		expect(anonymous.status).toBe(401);
		expect(calls).toHaveLength(0);
		const authenticated = await a.request(
			"/api/organizations/festival/customer/membership-purchase/offering_123",
			{ headers: { Cookie: "festival_customer_session=opaque-session" } },
		);
		expect(authenticated.status).toBe(200);
		expect(authenticated.headers.get("cache-control")).toBe("no-store");
		expect(await authenticated.json()).toEqual({
			selection: {
				offeringId: "offering_123",
				organizationSlug: "festival",
				entitlementClass: "teacher_membership",
			},
		});
		expect(calls).toEqual([["festival", "offering_123"]]);
	});

	it("does not issue a session cookie when callback offering revalidation fails", async () => {
		const publicService = {
			resolvePurchasable: async () => {
				throw new AppError("Membership selection is unavailable.", 409);
			},
		} as unknown as PublicMembershipProductService;
		const a = await app(
			service({
				callback: async (...args: unknown[]) => {
					const validate = args[2] as (
						slug: string,
						offeringId: string,
					) => Promise<unknown>;
					await validate("festival", "offering_123");
					return {
						sessionId: "must-not-be-issued",
						returnTo: "/org/festival/membership?purchase=offering_123",
						organizationSlug: "festival",
						offeringId: "offering_123",
						maxAgeSeconds: 3600,
					};
				},
			}),
			publicService,
		);
		const response = await a.request(
			"/api/customer-auth/callback?state=state&code=code",
		);
		expect(response.status).toBe(409);
		expect(response.headers.get("set-cookie")).toBeNull();
	});

	it("redirects an OAuth denial to a safe local failure state without a cookie", async () => {
		const a = await app(
			service({
				authenticationFailure: async () =>
					"/org/festival/membership?purchaseError=authentication",
			}),
		);
		const response = await a.request(
			"/api/customer-auth/callback?error=access_denied&state=opaque-state",
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"/org/festival/membership?purchaseError=authentication",
		);
		expect(response.headers.get("set-cookie")).toBeNull();
	});
});
