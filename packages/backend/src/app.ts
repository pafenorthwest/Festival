import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createFirebaseAuthVerifier } from "./auth/firebase-auth-verifier.js";
import type { AuthVerifier } from "./auth/types.js";
import {
	type CheckoutRepository,
	InMemoryCheckoutRepository,
} from "./checkout/checkout-repository.js";
import { MembershipCheckoutService } from "./checkout/membership-checkout-service.js";
import { PostgresCheckoutRepository } from "./checkout/postgres-checkout-repository.js";
import { ShopifyMembershipCheckoutClient } from "./checkout/shopify-membership-checkout-client.js";
import {
	InMemoryMembershipCommerceRepository,
	type MembershipCommerceRepository,
} from "./commerce/membership-commerce-repository.js";
import { MembershipStatusService } from "./commerce/membership-status-service.js";
import { PostgresMembershipCommerceRepository } from "./commerce/postgres-membership-commerce-repository.js";
import { ShopifyOrderProjectionService } from "./commerce/shopify-order-projection-service.js";
import { ShopifyWebhookService } from "./commerce/shopify-webhook-service.js";
import { type AppEnv, LOCAL_API_ORIGINS, loadEnv } from "./config/env.js";
import type { CustomerAccountRepository } from "./customer/customer-account-repository.js";
import { CustomerAccountService } from "./customer/customer-account-service.js";
import { PostgresCustomerAccountRepository } from "./customer/postgres-customer-account-repository.js";
import type { AppUserRepository } from "./repo/app-user-repository.js";
import { InMemoryAppUserRepository } from "./repo/in-memory-app-user-repository.js";
import type { OrganizationRepository } from "./repo/organization-repository.js";
import { PostgresAppUserRepository } from "./repo/postgres-app-user-repository.js";
import { PostgresOrganizationRepository } from "./repo/postgres-organization-repository.js";
import { buildApiRouter } from "./routes/api-router.js";
import { buildAuthRouter } from "./routes/auth-router.js";
import { assertRouteSecurityInventory } from "./routes/route-security.js";
import { apiRequestSecurity } from "./security/request-security.js";
import { OrganizationService } from "./services/organization-service.js";
import { ShopifyAdminApiClient } from "./shopify/admin-api-client.js";
import { FileShopifyMutationAuditWriter } from "./shopify/admin-mutation-audit.js";
import { ShopifySecretKeyring } from "./shopify/encryption.js";
import { PublicMembershipProductService } from "./shopify/public-membership-product-service.js";
import { ShopifyIntegrationDiagnosticService } from "./shopify/shopify-integration-diagnostic-service.js";
import type { ShopifyIntegrationService } from "./shopify/shopify-integration-service.js";
import { ShopifyIntegrationService as DefaultShopifyIntegrationService } from "./shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "./shopify/shopify-membership-product-service.js";
import { TokenlessShopifyPublicCatalogClient } from "./shopify/shopify-public-catalog-client.js";

export interface CreateAppOptions {
	env?: AppEnv;
	repository?: OrganizationRepository;
	appUserRepository?: AppUserRepository;
	authVerifier?: AuthVerifier;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	publicMembershipProductService?: PublicMembershipProductService;
	shopifyIntegrationDiagnosticService?: ShopifyIntegrationDiagnosticService;
	customerAccountRepository?: CustomerAccountRepository;
	customerAccountService?: CustomerAccountService;
	checkoutRepository?: CheckoutRepository;
	membershipCheckoutService?: MembershipCheckoutService;
	commerceRepository?: MembershipCommerceRepository;
	shopifyOrderProjectionService?: ShopifyOrderProjectionService;
	shopifyWebhookService?: ShopifyWebhookService;
	membershipStatusService?: MembershipStatusService;
}

function privateTokenMatches(
	provided: string | undefined,
	expected: string | undefined,
): boolean {
	if (!provided || !expected) return false;
	const actualBytes = Buffer.from(provided, "utf8");
	const expectedBytes = Buffer.from(expected, "utf8");
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

export async function createApp(options: CreateAppOptions = {}) {
	const env =
		options.env ??
		loadEnv({
			requireDatabase: !options.repository,
			requireFirebaseAdmin: !options.authVerifier,
		});

	if (env.databaseUrl) {
		process.env.DATABASE_URL = env.databaseUrl;
	}

	const repository =
		options.repository ??
		new PostgresOrganizationRepository(
			env.databaseSchema ??
				(() => {
					throw new Error("DB_SCHEMA is required for the runtime repository.");
				})(),
		);
	await repository.ensureReady();

	const authVerifier =
		options.authVerifier ??
		createFirebaseAuthVerifier(
			env as Required<Pick<AppEnv, "firebaseProjectId">> & AppEnv,
		);
	const appUserRepository =
		options.appUserRepository ??
		(env.databaseSchema
			? new PostgresAppUserRepository(env.databaseSchema)
			: new InMemoryAppUserRepository());
	await appUserRepository.ensureReady();
	const organizationService = new OrganizationService(repository);
	const shopifyAdminApiClient = new ShopifyAdminApiClient();
	const secretKeyring = ShopifySecretKeyring.fromEnvironment(
		env.festivalSecretKeysJson,
		env.festivalActiveSecretKeyId,
	);
	const shopifyIntegrationService =
		options.shopifyIntegrationService ??
		(secretKeyring
			? new DefaultShopifyIntegrationService(
					repository,
					secretKeyring,
					shopifyAdminApiClient,
				)
			: undefined);
	const shopifyMembershipProductService =
		options.shopifyMembershipProductService ??
		(secretKeyring
			? new ShopifyMembershipProductService(
					repository,
					secretKeyring,
					shopifyAdminApiClient,
					new FileShopifyMutationAuditWriter(),
				)
			: undefined);
	const shopifyPublicCatalogClient = new TokenlessShopifyPublicCatalogClient();
	const publicMembershipProductService =
		options.publicMembershipProductService ??
		new PublicMembershipProductService(
			repository,
			shopifyPublicCatalogClient,
			secretKeyring ?? undefined,
		);
	const shopifyIntegrationDiagnosticService =
		options.shopifyIntegrationDiagnosticService ??
		new ShopifyIntegrationDiagnosticService(
			repository,
			shopifyPublicCatalogClient,
			secretKeyring ?? undefined,
		);
	const customerAccountRepository =
		options.customerAccountRepository ??
		(env.databaseSchema
			? new PostgresCustomerAccountRepository(env.databaseSchema)
			: undefined);
	if (customerAccountRepository) await customerAccountRepository.ensureReady();
	const customerAccountService =
		options.customerAccountService ??
		(secretKeyring && customerAccountRepository && env.publicOrigin
			? new CustomerAccountService(
					customerAccountRepository,
					repository,
					secretKeyring,
					{
						publicOrigin: env.publicOrigin,
						idleDays: env.customerSessionIdleDays,
						absoluteDays: env.customerSessionAbsoluteDays,
						transportOptions: {
							dnsMaxEntries: env.customerDnsCacheMaxEntries,
							dnsTtlMs: (env.customerDnsCacheTtlSeconds ?? 60) * 1_000,
							maxEntryBytes: env.customerCacheMaxEntryBytes,
							maxTotalBytes: Math.floor(
								(env.customerCacheMaxTotalBytes ?? 16 * 1_024 * 1_024) / 4,
							),
						},
						discoveryCacheMaxEntries: env.customerDiscoveryCacheMaxEntries,
						discoveryCacheTtlMs:
							(env.customerDiscoveryCacheTtlSeconds ?? 300) * 1_000,
						discoveryCacheMaxTotalBytes: Math.floor(
							(env.customerCacheMaxTotalBytes ?? 16 * 1_024 * 1_024) / 4,
						),
						jwksCacheMaxEntries: env.customerJwksCacheMaxEntries,
						jwksCacheTtlMs: (env.customerJwksCacheTtlSeconds ?? 300) * 1_000,
						jwksCacheMaxTotalBytes: Math.floor(
							(env.customerCacheMaxTotalBytes ?? 16 * 1_024 * 1_024) / 2,
						),
						cacheMaxEntryBytes: env.customerCacheMaxEntryBytes,
					},
				)
			: undefined);
	const checkoutRepository =
		options.checkoutRepository ??
		(env.databaseSchema
			? new PostgresCheckoutRepository(env.databaseSchema)
			: new InMemoryCheckoutRepository());
	if (checkoutRepository instanceof PostgresCheckoutRepository)
		await checkoutRepository.ensureReady();
	const commerceRepository =
		options.commerceRepository ??
		(env.databaseSchema
			? new PostgresMembershipCommerceRepository(env.databaseSchema)
			: new InMemoryMembershipCommerceRepository(
					repository,
					checkoutRepository,
				));
	await commerceRepository.ensureReady();
	const membershipCheckoutService =
		options.membershipCheckoutService ??
		(secretKeyring
			? new MembershipCheckoutService(
					repository,
					publicMembershipProductService,
					checkoutRepository,
					new ShopifyMembershipCheckoutClient(repository, secretKeyring),
					commerceRepository,
				)
			: undefined);
	const shopifyOrderProjectionService =
		options.shopifyOrderProjectionService ??
		new ShopifyOrderProjectionService(
			repository,
			checkoutRepository,
			commerceRepository,
			shopifyAdminApiClient,
			secretKeyring,
			customerAccountRepository,
		);
	const shopifyWebhookService =
		options.shopifyWebhookService ??
		new ShopifyWebhookService(
			repository,
			commerceRepository,
			secretKeyring,
			shopifyOrderProjectionService,
		);
	const membershipStatusService =
		options.membershipStatusService ??
		new MembershipStatusService(repository, commerceRepository);

	const app = new Hono();
	const allowedApiOrigins = new Set(env.allowedApiOrigins ?? LOCAL_API_ORIGINS);
	app.post("/api/shopify/webhooks/orders-paid", (c) =>
		shopifyWebhookService.handle(c),
	);
	app.post("/api/internal/reconcile/shopify-orders", async (c) => {
		const expectedToken = env.reconciliationToken;
		if (
			!privateTokenMatches(
				c.req.header("X-Festival-Reconciliation-Token"),
				expectedToken,
			) ||
			c.req.header("Cookie") !== undefined ||
			c.req.header("Authorization") !== undefined ||
			c.req.header("Origin") !== undefined
		) {
			return c.json({ error: "Not found." }, 404);
		}
		try {
			const body = await c.req.json();
			if (
				!body ||
				typeof body !== "object" ||
				Array.isArray(body) ||
				Object.keys(body).length !== 1 ||
				typeof (body as { organizationId?: unknown }).organizationId !==
					"string" ||
				!(body as { organizationId: string }).organizationId.trim() ||
				(body as { organizationId: string }).organizationId.length > 256
			) {
				return c.json({ error: "Reconciliation request is invalid." }, 400);
			}
			return c.json(
				await shopifyOrderProjectionService.reconcile(
					(body as { organizationId: string }).organizationId,
				),
			);
		} catch {
			return c.json({ error: "Shopify order reconciliation failed." }, 503);
		}
	});

	app.use(
		"/api/*",
		cors({
			origin: (origin) => (allowedApiOrigins.has(origin) ? origin : undefined),
			allowHeaders: ["Authorization", "Content-Type", "X-CSRF-Token"],
			allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
			credentials: true,
		}),
	);
	app.use("/api/*", apiRequestSecurity());

	app.get("/health", (c) => {
		return c.json({ status: "ok" });
	});

	app.route(
		"/api",
		buildApiRouter(
			organizationService,
			authVerifier,
			shopifyIntegrationService,
			shopifyMembershipProductService,
			customerAccountService,
			publicMembershipProductService,
			shopifyIntegrationDiagnosticService,
			membershipCheckoutService,
			membershipStatusService,
		),
	);
	app.route(
		"/api/v1/auth",
		buildAuthRouter(
			authVerifier,
			appUserRepository,
			env.trustProxyHeaders ?? false,
		),
	);
	assertRouteSecurityInventory(app.routes);

	return { app, env };
}
