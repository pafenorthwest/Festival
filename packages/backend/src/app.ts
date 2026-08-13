import { Hono } from "hono";
import { cors } from "hono/cors";
import { createFirebaseAuthVerifier } from "./auth/firebase-auth-verifier.js";
import type { AuthVerifier } from "./auth/types.js";
import { type AppEnv, LOCAL_API_ORIGINS, loadEnv } from "./config/env.js";
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
import { AesSecretEncryptor } from "./shopify/encryption.js";
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
	const encryptor = env.aesEncryptionKey
		? new AesSecretEncryptor(env.aesEncryptionKey)
		: undefined;
	const shopifyIntegrationService =
		options.shopifyIntegrationService ??
		(encryptor
			? new DefaultShopifyIntegrationService(
					repository,
					encryptor,
					shopifyAdminApiClient,
				)
			: undefined);
	const shopifyMembershipProductService =
		options.shopifyMembershipProductService ??
		(encryptor
			? new ShopifyMembershipProductService(
					repository,
					encryptor,
					shopifyAdminApiClient,
				)
			: undefined);

	const app = new Hono();
	const allowedApiOrigins = new Set(env.allowedApiOrigins ?? LOCAL_API_ORIGINS);

	app.use(
		"/api/*",
		cors({
			origin: (origin) => (allowedApiOrigins.has(origin) ? origin : undefined),
			allowHeaders: ["Authorization", "Content-Type"],
			allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
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
