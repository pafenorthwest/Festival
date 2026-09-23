import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
	CUSTOMER_SESSION_COOKIE,
	type CustomerAccountService,
} from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import {
	assertAllowedCustomerAuthStartQuery,
	assertNoBearerPrincipal,
	buildCustomerAuthRoutes,
	type CustomerAuthRoutesOptions,
} from "../src/routes/customer-auth/customer-auth.routes.js";
import type { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";

function fakeCustomerAccountService(
	overrides: Partial<Record<keyof CustomerAccountService, unknown>> = {},
): CustomerAccountService {
	return {
		getSettings: async () => ({ settings: null }),
		saveAndVerify: async () => ({ settings: {} }),
		start: async (slug: string, returnTo?: string, offeringId?: string) =>
			`https://accounts.shopify.com/auth?slug=${slug}${
				returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""
			}${offeringId ? `&offering=${offeringId}` : ""}`,
		callback: async () => ({
			sessionId: "sess_12345",
			returnTo: "/org/festival/account",
			organizationSlug: "festival",
			offeringId: undefined,
			maxAgeSeconds: 3600,
		}),
		session: async (_slug: string, id?: string) => ({
			session: id ? { authenticated: true } : { authenticated: false },
		}),
		orders: async () => ({
			orders: [],
			pageInfo: { hasNextPage: false, endCursor: null },
		}),
		logout: async () => "https://accounts.shopify.com/logout",
		customerProfile: async () => ({
			profile: { name: "Customer", email: "customer@example.com" },
		}),
		authenticationFailure: async (state?: string) =>
			`/org/festival/membership?purchaseError=authentication${
				state ? `&state=${state}` : ""
			}`,
		...overrides,
	} as unknown as CustomerAccountService;
}

function fakePublicMembershipProductService(
	overrides: Partial<
		Record<keyof PublicMembershipProductService, unknown>
	> = {},
): PublicMembershipProductService {
	return {
		list: async (slug: string) => ({
			organization: { slug, name: "Test Org" },
			membershipProducts: [],
		}),
		resolvePurchasable: async (slug: string, offeringId: string) => ({
			selection: {
				offeringId,
				organizationSlug: slug,
				entitlementClass: "teacher_membership" as const,
			},
		}),
		...overrides,
	} as unknown as PublicMembershipProductService;
}

function createTestApp(options: CustomerAuthRoutesOptions = {}) {
	const app = new Hono();
	app.route("/", buildCustomerAuthRoutes(options));
	return app;
}

describe("customer auth routes", () => {
	describe("helper functions", () => {
		describe("assertNoBearerPrincipal", () => {
			it("does not throw when value is undefined", () => {
				expect(() => assertNoBearerPrincipal(undefined)).not.toThrow();
			});

			it("throws AppError with 400 when Authorization header is provided", () => {
				expect(() => assertNoBearerPrincipal("Bearer token")).toThrow(AppError);
				try {
					assertNoBearerPrincipal("Bearer token");
				} catch (error) {
					expect(error).toBeInstanceOf(AppError);
					expect((error as AppError).status).toBe(400);
					expect((error as AppError).message).toBe(
						"Bearer authorization is not accepted on customer routes.",
					);
				}
			});
		});

		describe("assertAllowedCustomerAuthStartQuery", () => {
			it("allows valid query parameters (returnTo, offering)", () => {
				expect(() =>
					assertAllowedCustomerAuthStartQuery(
						"https://example.com/start?returnTo=/account&offering=off_1",
					),
				).not.toThrow();
				expect(() =>
					assertAllowedCustomerAuthStartQuery("https://example.com/start"),
				).not.toThrow();
			});

			it("throws AppError with 400 for unsupported query parameters", () => {
				expect(() =>
					assertAllowedCustomerAuthStartQuery(
						"https://example.com/start?unsupported=val",
					),
				).toThrow(AppError);
				try {
					assertAllowedCustomerAuthStartQuery(
						"https://example.com/start?shopifyVariantGid=123",
					);
				} catch (error) {
					expect(error).toBeInstanceOf(AppError);
					expect((error as AppError).status).toBe(400);
					expect((error as AppError).message).toContain("unsupported fields");
				}
			});

			it("throws AppError with 400 for duplicate query parameters", () => {
				expect(() =>
					assertAllowedCustomerAuthStartQuery(
						"https://example.com/start?offering=off_1&offering=off_2",
					),
				).toThrow(AppError);
			});
		});
	});

	describe("GET /organizations/:slug/customer-auth/start", () => {
		it("fails if Authorization Bearer header is present (assertNoBearerPrincipal)", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService(),
			});
			const response = await app.request(
				"/organizations/festival/customer-auth/start",
				{
					headers: { Authorization: "Bearer admin" },
				},
			);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe(
				"Bearer authorization is not accepted on customer routes.",
			);
		});

		it("fails with 400 if invalid query params are passed (assertAllowedCustomerAuthStartQuery)", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService(),
			});
			const unsupported = await app.request(
				"/organizations/festival/customer-auth/start?shopifyVariantGid=gid%3A%2F%2Fshopify%2FProductVariant%2F1",
			);
			expect(unsupported.status).toBe(400);
			const duplicate = await app.request(
				"/organizations/festival/customer-auth/start?offering=off_1&offering=off_2",
			);
			expect(duplicate.status).toBe(400);
		});

		it("fails with 503 if customerAccountService is not configured", async () => {
			const app = createTestApp({ customerAccountService: undefined });
			const response = await app.request(
				"/organizations/festival/customer-auth/start",
			);
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.error).toBe(
				"Customer Account integration is not configured.",
			);
		});

		it("resolves purchasable if offering query param is present", async () => {
			const resolved: Array<[string, string]> = [];
			const publicService = fakePublicMembershipProductService({
				resolvePurchasable: async (slug: string, offeringId: string) => {
					resolved.push([slug, offeringId]);
					return {
						selection: {
							offeringId,
							organizationSlug: slug,
							entitlementClass: "teacher_membership" as const,
						},
					};
				},
			});
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService(),
				publicMembershipProductService: publicService,
			});

			const response = await app.request(
				"/organizations/festival/customer-auth/start?offering=off_123",
			);
			expect(response.status).toBe(302);
			expect(resolved).toEqual([["festival", "off_123"]]);
		});

		it("fails with 503 if offering is present but publicMembershipProductService is not configured", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService(),
				publicMembershipProductService: undefined,
			});
			const response = await app.request(
				"/organizations/festival/customer-auth/start?offering=off_123",
			);
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.error).toBe("Membership information is unavailable.");
		});

		it("successfully redirects to URL returned by customerAccountService.start", async () => {
			let startArgs: unknown[] = [];
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					start: async (...args: unknown[]) => {
						startArgs = args;
						return "https://accounts.shopify.com/authorize?client_id=123";
					},
				}),
			});

			const response = await app.request(
				"/organizations/festival/customer-auth/start?returnTo=%2Forg%2Ffestival%2Fmembership",
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"https://accounts.shopify.com/authorize?client_id=123",
			);
			expect(startArgs).toEqual([
				"festival",
				"/org/festival/membership",
				undefined,
			]);
		});

		it("successfully redirects to URL returned by customerAccountService.start with offering", async () => {
			let startArgs: unknown[] = [];
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					start: async (...args: unknown[]) => {
						startArgs = args;
						return "https://accounts.shopify.com/authorize?client_id=123&offering=off_123";
					},
				}),
				publicMembershipProductService: fakePublicMembershipProductService(),
			});

			const response = await app.request(
				"/organizations/festival/customer-auth/start?returnTo=%2Forg%2Ffestival%2Fmembership&offering=off_123",
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"https://accounts.shopify.com/authorize?client_id=123&offering=off_123",
			);
			expect(startArgs).toEqual([
				"festival",
				"/org/festival/membership",
				"off_123",
			]);
		});
	});

	describe("GET /customer-auth/callback", () => {
		it("fails if Authorization Bearer header is present", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService(),
			});
			const response = await app.request(
				"/customer-auth/callback?state=state&code=code",
				{
					headers: { Authorization: "Bearer token" },
				},
			);
			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error).toBe(
				"Bearer authorization is not accepted on customer routes.",
			);
		});

		it("fails with 503 if customerAccountService is not configured", async () => {
			const app = createTestApp({ customerAccountService: undefined });
			const response = await app.request(
				"/customer-auth/callback?state=state&code=code",
			);
			expect(response.status).toBe(503);
			const body = await response.json();
			expect(body.error).toBe(
				"Customer Account integration is not configured.",
			);
		});

		it("handles error query param by redirecting to customerAccountService.authenticationFailure(state)", async () => {
			let failureState: unknown = null;
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					authenticationFailure: async (state?: string) => {
						failureState = state;
						return "/org/festival/membership?purchaseError=authentication";
					},
				}),
			});

			const response = await app.request(
				"/customer-auth/callback?error=access_denied&state=my-state",
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"/org/festival/membership?purchaseError=authentication",
			);
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(failureState).toBe("my-state");
		});

		it("handles successful callback: sets CUSTOMER_SESSION_COOKIE and redirects to returnTo", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					callback: async () => ({
						sessionId: "sess_xyz_789",
						returnTo: "/org/festival/membership?purchase=completed",
						organizationSlug: "festival",
						offeringId: undefined,
						maxAgeSeconds: 7200,
					}),
				}),
			});

			const response = await app.request(
				"/customer-auth/callback?state=valid-state&code=valid-code",
			);
			expect(response.status).toBe(302);
			expect(response.headers.get("location")).toBe(
				"/org/festival/membership?purchase=completed",
			);

			const cookie = response.headers.get("set-cookie") ?? "";
			expect(cookie).toContain(`${CUSTOMER_SESSION_COOKIE}=sess_xyz_789`);
			expect(cookie).toContain("HttpOnly");
			expect(cookie).toContain("Secure");
			expect(cookie).toContain("SameSite=Lax");
			expect(cookie).toContain("Path=/api/");
			expect(cookie).toContain("Max-Age=7200");
		});

		it("executes revalidation callback when offering was selected during callback", async () => {
			const resolutions: Array<[string, string]> = [];
			const publicService = fakePublicMembershipProductService({
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
			});

			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					callback: async (
						_state?: string,
						_code?: string,
						validator?: (slug: string, offeringId: string) => Promise<unknown>,
					) => {
						if (validator) {
							await validator("festival", "offering_999");
						}
						return {
							sessionId: "sess_revalidated",
							returnTo: "/org/festival/checkout",
							organizationSlug: "festival",
							offeringId: "offering_999",
							maxAgeSeconds: 3600,
						};
					},
				}),
				publicMembershipProductService: publicService,
			});

			const response = await app.request(
				"/customer-auth/callback?state=state&code=code",
			);
			expect(response.status).toBe(302);
			expect(resolutions).toEqual([["festival", "offering_999"]]);
		});

		it("fails with 503 if revalidation is invoked but publicMembershipProductService is missing", async () => {
			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					callback: async (
						_state?: string,
						_code?: string,
						validator?: (slug: string, offeringId: string) => Promise<unknown>,
					) => {
						if (validator) {
							await validator("festival", "offering_999");
						}
						return {
							sessionId: "must_not_issue",
							returnTo: "/dest",
							organizationSlug: "festival",
							offeringId: "offering_999",
							maxAgeSeconds: 3600,
						};
					},
				}),
				publicMembershipProductService: undefined,
			});

			const response = await app.request(
				"/customer-auth/callback?state=state&code=code",
			);
			expect(response.status).toBe(503);
			expect(response.headers.get("set-cookie")).toBeNull();
		});

		it("fails and sets no cookie when revalidation throws AppError", async () => {
			const publicService = fakePublicMembershipProductService({
				resolvePurchasable: async () => {
					throw new AppError("Membership selection is unavailable.", 409);
				},
			});

			const app = createTestApp({
				customerAccountService: fakeCustomerAccountService({
					callback: async (
						_state?: string,
						_code?: string,
						validator?: (slug: string, offeringId: string) => Promise<unknown>,
					) => {
						if (validator) {
							await validator("festival", "offering_999");
						}
						return {
							sessionId: "must_not_issue",
							returnTo: "/dest",
							organizationSlug: "festival",
							offeringId: "offering_999",
							maxAgeSeconds: 3600,
						};
					},
				}),
				publicMembershipProductService: publicService,
			});

			const response = await app.request(
				"/customer-auth/callback?state=state&code=code",
			);
			expect(response.status).toBe(409);
			expect(response.headers.get("set-cookie")).toBeNull();
		});
	});
});
