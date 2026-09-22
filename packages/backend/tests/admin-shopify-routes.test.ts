import { describe, expect, it, mock } from "bun:test";
import type { AuthenticatedUser } from "@festival/common";
import { Hono } from "hono";
import type { AuthVerifier } from "../src/auth/types.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { buildAdminShopifyRoutes } from "../src/routes/admin-shopify/admin-shopify.routes.js";
import type { ShopifyIntegrationDiagnosticService } from "../src/shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "../src/shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const users: Record<string, AuthenticatedUser> = {
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin",
			},
			reader: {
				uid: "uid-reader",
				email: "reader@example.com",
				displayName: "Reader",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider",
			},
		};
		const user = users[token];
		if (!user) throw new Error(`Unknown token: ${token}`);
		return user;
	}
}

interface TestAppOptions {
	shopifyIntegrationService?: ShopifyIntegrationService | null;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService | null;
	shopifyMembershipProductService?: ShopifyMembershipProductService | null;
	customerAccountService?: CustomerAccountService | null;
}

async function createTestApp(options: TestAppOptions = {}) {
	const repository = new InMemoryOrganizationRepository();
	const organization = await repository.createOrganization({
		name: "Pacific Festival",
		slug: "pafe",
	});

	const adminUser = await repository.upsertUser({
		uid: "uid-admin",
		email: "admin@example.com",
		displayName: "Admin",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: adminUser.id,
		role: "Admin",
		origin: "creator",
	});

	const readerUser = await repository.upsertUser({
		uid: "uid-reader",
		email: "reader@example.com",
		displayName: "Reader",
	});
	await repository.createMembership({
		organizationId: organization.id,
		userId: readerUser.id,
		role: "Reader",
		origin: "invite",
	});

	await repository.upsertUser({
		uid: "uid-outsider",
		email: "outsider@example.com",
		displayName: "Outsider",
	});

	const division = await repository.createDivision({
		organizationId: organization.id,
		displayName: "Piano",
		normalizedName: "piano",
	});

	const product = await repository.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Teacher Membership",
	});

	const entitlementGrant = await repository.createEntitlementGrantSnapshot({
		organizationId: organization.id,
		customerId: "cust-1",
		entitlementClass: "teacher_membership",
		offeringId: product.id,
		durationDays: 365,
		divisionId: division.id,
		divisionNameSnapshot: division.displayName,
		paidAmount: "10.00",
		paidCurrencyCode: "USD",
		checkoutIntentId: "checkout-1",
		shopifyOrderGid: "gid://shopify/Order/1",
		shopifyOrderLineGid: "gid://shopify/LineItem/1",
		startsOn: "2026-01-01",
		endsOn: "2027-01-01",
		status: "active",
		verifiedIdentityEmail: "shopper@example.com",
	});

	const getSettingsForTenantMock = mock(async () => ({
		settings: {
			storeDomain: "test.myshopify.com",
			clientId: "client-id",
			verificationStatus: "verified",
		},
	}));
	const saveAndTestForTenantMock = mock(async (_tenant, input) => ({
		valid: true,
		settings: input,
	}));

	const shopifyIntegrationService =
		options.shopifyIntegrationService === null
			? undefined
			: (options.shopifyIntegrationService ??
				({
					getSettingsForTenant: getSettingsForTenantMock,
					saveAndTestForTenant: saveAndTestForTenantMock,
				} as unknown as ShopifyIntegrationService));

	const runForTenantMock = mock(async () => ({
		overallStatus: "healthy",
		checks: [],
	}));

	const shopifyIntegrationDiagnosticService =
		options.shopifyIntegrationDiagnosticService === null
			? undefined
			: (options.shopifyIntegrationDiagnosticService ??
				({
					runForTenant: runForTenantMock,
				} as unknown as ShopifyIntegrationDiagnosticService));

	const listMembershipProductsMock = mock(async () => [
		{ id: "prod-1", name: "Teacher Membership" },
	]);
	const createMembershipProductMock = mock(async (_tenant, payload) => ({
		id: "prod-new",
		...(typeof payload === "object" && payload !== null ? payload : {}),
	}));
	const retireMembershipOfferingMock = mock(async () => ({
		retired: true,
	}));
	const createAccompanistOfferingMock = mock(async (_tenant, payload) => ({
		id: "acc-new",
		...(typeof payload === "object" && payload !== null ? payload : {}),
	}));
	const updateAccompanistOfferingMock = mock(
		async (_tenant, offeringId, payload) => ({
			id: offeringId,
			...(typeof payload === "object" && payload !== null ? payload : {}),
		}),
	);

	const shopifyMembershipProductService =
		options.shopifyMembershipProductService === null
			? undefined
			: (options.shopifyMembershipProductService ??
				({
					listMembershipProductsForOrganization: listMembershipProductsMock,
					createMembershipProduct: createMembershipProductMock,
					retireMembershipOffering: retireMembershipOfferingMock,
					createAccompanistOffering: createAccompanistOfferingMock,
					updateAccompanistOffering: updateAccompanistOfferingMock,
				} as unknown as ShopifyMembershipProductService));

	const getSettingsMock = mock(async () => ({
		settings: { clientId: "cust-account-id" },
	}));
	const saveAndVerifyMock = mock(async (_orgId, _slug, input) => ({
		settings: input,
	}));
	const searchAdminCustomersMock = mock(async (_orgId, query, adminUid) => ({
		customers: [{ id: "cust-1", name: "Test Customer" }],
		adminUid,
		query,
	}));
	const adminCustomerProfileMock = mock(
		async (_orgId, customerId, adminUid) => ({
			customerId,
			adminUid,
			profile: { name: "Test Customer" },
		}),
	);

	const customerAccountService =
		options.customerAccountService === null
			? undefined
			: (options.customerAccountService ??
				({
					getSettings: getSettingsMock,
					saveAndVerify: saveAndVerifyMock,
					searchAdminCustomers: searchAdminCustomersMock,
					adminCustomerProfile: adminCustomerProfileMock,
				} as unknown as CustomerAccountService));

	const authVerifier = new FakeAuth();
	const app = new Hono();
	app.route(
		"/",
		buildAdminShopifyRoutes({
			repository,
			authVerifier,
			shopifyIntegrationService,
			shopifyIntegrationDiagnosticService,
			shopifyMembershipProductService,
			customerAccountService,
		}),
	);

	return {
		app,
		organization,
		repository,
		entitlementGrant,
		mocks: {
			getSettingsForTenantMock,
			saveAndTestForTenantMock,
			runForTenantMock,
			listMembershipProductsMock,
			createMembershipProductMock,
			retireMembershipOfferingMock,
			createAccompanistOfferingMock,
			updateAccompanistOfferingMock,
			getSettingsMock,
			saveAndVerifyMock,
			searchAdminCustomersMock,
			adminCustomerProfileMock,
		},
	};
}

describe("admin shopify routes", () => {
	describe("Shopify settings", () => {
		describe("GET /organizations/:slug/admin/shopify", () => {
			it("returns 200 with settings when requested by admin", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.settings).toBeDefined();
				expect(body.settings.storeDomain).toBe("test.myshopify.com");
			});

			it("returns 403 for non-admin user", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						headers: { Authorization: "Bearer reader" },
					},
				);
				expect(response.status).toBe(403);
			});

			it("returns 401 when unauthenticated", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
				);
				expect(response.status).toBe(401);
			});

			it("returns 503 when shopifyIntegrationService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyIntegrationService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
				const body = await response.json();
				expect(body.error).toContain("Shopify integration is not configured");
			});
		});

		describe("POST /organizations/:slug/admin/shopify", () => {
			it("returns 200 for valid settings payload", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					storeUrl: "https://fest.myshopify.com",
					clientId: "client-123",
					clientSecret: "secret-456",
					storefrontPrivateToken: "token-789",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.valid).toBe(true);
				expect(body.settings).toEqual(payload);
			});

			it("returns 400 when payload contains unexpected fields", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					storeUrl: "https://fest.myshopify.com",
					clientId: "client-123",
					clientSecret: "secret-456",
					unexpectedField: "malicious-value",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Shopify settings cannot include browser-controlled fields",
				);
			});

			it("returns 503 when shopifyIntegrationService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyIntegrationService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							storeUrl: "https://fest.myshopify.com",
							clientId: "client-123",
							clientSecret: "secret-456",
						}),
					},
				);
				expect(response.status).toBe(503);
			});
		});
	});

	describe("Shopify diagnostics", () => {
		describe("POST /organizations/:slug/admin/shopify/diagnostics", () => {
			it("returns 200 for bodyless diagnostic request", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify/diagnostics`,
					{
						method: "POST",
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.overallStatus).toBe("healthy");
			});

			it("returns 400 when request includes a body", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify/diagnostics`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ unwanted: "body" }),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Request body is not accepted for diagnostics",
				);
			});

			it("returns 400 when request includes non-zero Content-Length", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify/diagnostics`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Length": "12",
						},
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Request body is not accepted for diagnostics",
				);
			});

			it("returns 503 when shopifyIntegrationDiagnosticService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyIntegrationDiagnosticService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify/diagnostics`,
					{
						method: "POST",
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
				const body = await response.json();
				expect(body.error).toContain("Shopify diagnostics are unavailable");
			});
		});
	});

	describe("Customer account settings", () => {
		describe("GET /organizations/:slug/admin/shopify-customer-account", () => {
			it("returns 200 with customer account settings", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify-customer-account`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.settings).toBeDefined();
				expect(body.settings.clientId).toBe("cust-account-id");
			});

			it("returns 503 when customerAccountService is undefined", async () => {
				const { app, organization } = await createTestApp({
					customerAccountService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify-customer-account`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
			});
		});

		describe("POST /organizations/:slug/admin/shopify-customer-account", () => {
			it("returns 200 when updating customer account settings", async () => {
				const { app, organization } = await createTestApp();
				const payload = { clientId: "new-cust-id" };
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify-customer-account`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.settings).toEqual(payload);
			});

			it("returns 503 when customerAccountService is undefined", async () => {
				const { app, organization } = await createTestApp({
					customerAccountService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/shopify-customer-account`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ clientId: "new-cust-id" }),
					},
				);
				expect(response.status).toBe(503);
			});
		});
	});

	describe("Admin customers", () => {
		describe("GET /organizations/:slug/admin/customers", () => {
			it("returns 200 and forwards admin UID", async () => {
				const { app, organization, mocks } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/customers?query=john`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.customers).toBeDefined();
				expect(mocks.searchAdminCustomersMock).toHaveBeenCalledWith(
					organization.id,
					"john",
					"uid-admin",
				);
			});

			it("returns 503 when customerAccountService is undefined", async () => {
				const { app, organization } = await createTestApp({
					customerAccountService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/customers`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
			});
		});

		describe("GET /organizations/:slug/admin/customers/:customerId", () => {
			it("returns 200 and forwards admin UID", async () => {
				const { app, organization, mocks } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/customers/cust-123`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.customerId).toBe("cust-123");
				expect(mocks.adminCustomerProfileMock).toHaveBeenCalledWith(
					organization.id,
					"cust-123",
					"uid-admin",
				);
			});

			it("returns 503 when customerAccountService is undefined", async () => {
				const { app, organization } = await createTestApp({
					customerAccountService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/customers/cust-123`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
			});
		});
	});

	describe("Membership products", () => {
		describe("GET /organizations/:slug/admin/membership-products", () => {
			it("returns 200 with membership products list", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.membershipProducts).toBeDefined();
				expect(Array.isArray(body.membershipProducts)).toBe(true);
			});

			it("returns 503 when shopifyMembershipProductService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyMembershipProductService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products`,
					{
						headers: { Authorization: "Bearer admin" },
					},
				);
				expect(response.status).toBe(503);
			});
		});

		describe("POST /organizations/:slug/admin/membership-products", () => {
			it("returns 201 for valid membership product payload", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Teacher Membership",
					description: "Annual subscription for teachers",
					price: "35.00",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(201);
				const body = await response.json();
				expect(body.membershipProduct).toBeDefined();
				expect(body.membershipProduct.name).toBe("Teacher Membership");
			});

			it("returns 400 when payload contains forbidden fields", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Teacher Membership",
					description: "Annual subscription",
					price: "35.00",
					forbiddenField: "not-allowed",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Membership product request cannot include browser-controlled fields",
				);
			});

			it("returns 503 when shopifyMembershipProductService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyMembershipProductService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: "Teacher Membership",
							price: "35.00",
						}),
					},
				);
				expect(response.status).toBe(503);
			});
		});

		describe("POST /organizations/:slug/admin/membership-products/:offeringId/retire", () => {
			it("returns 200 when confirmed: true", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products/offering-123/retire`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ confirmed: true }),
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.retired).toBe(true);
			});

			it("returns 400 when confirmed is false", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products/offering-123/retire`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ confirmed: false }),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Membership offering retirement must be confirmed",
				);
			});

			it("returns 400 when confirmed is omitted", async () => {
				const { app, organization } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products/offering-123/retire`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({}),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Membership offering retirement must be confirmed",
				);
			});

			it("returns 503 when shopifyMembershipProductService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyMembershipProductService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/membership-products/offering-123/retire`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ confirmed: true }),
					},
				);
				expect(response.status).toBe(503);
			});
		});
	});

	describe("Accompanist offerings", () => {
		describe("POST /organizations/:slug/admin/accompanist-offering", () => {
			it("returns 201 for valid accompanist offering payload", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Accompanist Annual",
					description: "Access for registered accompanists",
					price: "50.00",
					durationDays: 365,
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(201);
				const body = await response.json();
				expect(body.membershipProduct).toBeDefined();
				expect(body.membershipProduct.name).toBe("Accompanist Annual");
			});

			it("returns 400 when payload contains forbidden fields", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Accompanist Annual",
					price: "50.00",
					durationDays: 365,
					extraField: "forbidden",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Accompanist offering request cannot include browser-controlled fields",
				);
			});

			it("returns 503 when shopifyMembershipProductService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyMembershipProductService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: "Accompanist Annual",
							price: "50.00",
							durationDays: 365,
						}),
					},
				);
				expect(response.status).toBe(503);
			});
		});

		describe("POST /organizations/:slug/admin/accompanist-offering/:offeringId", () => {
			it("returns 200 for valid update payload", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Updated Accompanist",
					price: "60.00",
					durationDays: 180,
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering/offering-456`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.membershipProduct).toBeDefined();
				expect(body.membershipProduct.name).toBe("Updated Accompanist");
			});

			it("returns 400 when update payload contains forbidden fields", async () => {
				const { app, organization } = await createTestApp();
				const payload = {
					name: "Updated Accompanist",
					price: "60.00",
					unauthorizedProperty: "malicious",
				};
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering/offering-456`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Accompanist offering request cannot include browser-controlled fields",
				);
			});

			it("returns 503 when shopifyMembershipProductService is undefined", async () => {
				const { app, organization } = await createTestApp({
					shopifyMembershipProductService: null,
				});
				const response = await app.request(
					`/organizations/${organization.slug}/admin/accompanist-offering/offering-456`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							name: "Updated Accompanist",
							price: "60.00",
						}),
					},
				);
				expect(response.status).toBe(503);
			});
		});
	});

	describe("Entitlement revocation", () => {
		describe("POST /organizations/:slug/admin/entitlements/:entitlementId/revoke", () => {
			it("returns 200 with valid reason", async () => {
				const { app, organization, entitlementGrant } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/entitlements/${entitlementGrant.id}/revoke`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ reason: "Member requested refund" }),
					},
				);
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.revocation).toBeDefined();
				expect(body.revocation.entitlementId).toBe(entitlementGrant.id);
				expect(body.revocation.reason).toBe("Member requested refund");
				expect(body.existing).toBe(false);
			});

			it("returns 400 when reason is missing or empty", async () => {
				const { app, organization, entitlementGrant } = await createTestApp();
				const responseEmptyObj = await app.request(
					`/organizations/${organization.slug}/admin/entitlements/${entitlementGrant.id}/revoke`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({}),
					},
				);
				expect(responseEmptyObj.status).toBe(400);
				const bodyEmpty = await responseEmptyObj.json();
				expect(bodyEmpty.error).toContain("A revocation reason is required");

				const responseWhitespace = await app.request(
					`/organizations/${organization.slug}/admin/entitlements/${entitlementGrant.id}/revoke`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ reason: "   " }),
					},
				);
				expect(responseWhitespace.status).toBe(400);
				const bodyWhitespace = await responseWhitespace.json();
				expect(bodyWhitespace.error).toContain(
					"A revocation reason is required",
				);
			});

			it("returns 400 when payload contains extra fields", async () => {
				const { app, organization, entitlementGrant } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/entitlements/${entitlementGrant.id}/revoke`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer admin",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							reason: "Valid reason",
							unexpectedField: "not allowed",
						}),
					},
				);
				expect(response.status).toBe(400);
				const body = await response.json();
				expect(body.error).toContain(
					"Entitlement revocation request cannot include browser-controlled fields",
				);
			});

			it("returns 403 for non-admin user", async () => {
				const { app, organization, entitlementGrant } = await createTestApp();
				const response = await app.request(
					`/organizations/${organization.slug}/admin/entitlements/${entitlementGrant.id}/revoke`,
					{
						method: "POST",
						headers: {
							Authorization: "Bearer reader",
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ reason: "Valid reason" }),
					},
				);
				expect(response.status).toBe(403);
			});
		});
	});
});
