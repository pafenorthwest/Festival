import { Hono } from "hono";
import { cors } from "hono/cors";
import { createFirebaseAuthVerifier } from "./auth/firebase-auth-verifier.js";
import type { AuthVerifier } from "./auth/types.js";
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
import type { ShopifyIntegrationService } from "./shopify/shopify-integration-service.js";
import { ShopifyIntegrationService as DefaultShopifyIntegrationService } from "./shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "./shopify/shopify-membership-product-service.js";

export interface CreateAppOptions {
	env?: AppEnv;
	repository?: OrganizationRepository;
	appUserRepository?: AppUserRepository;
	authVerifier?: AuthVerifier;
	shopifyIntegrationService?: ShopifyIntegrationService;
	shopifyMembershipProductService?: ShopifyMembershipProductService;
	customerAccountRepository?: CustomerAccountRepository;
	customerAccountService?: CustomerAccountService;
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
					},
				)
			: undefined);

	const app = new Hono();
	const allowedApiOrigins = new Set(env.allowedApiOrigins ?? LOCAL_API_ORIGINS);

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
