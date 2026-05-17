import { Hono } from "hono";
import { cors } from "hono/cors";
import { createFirebaseAuthVerifier } from "./auth/firebase-auth-verifier.js";
import type { AuthVerifier } from "./auth/types.js";
import type { AppEnv } from "./config/env.js";
import { loadEnv } from "./config/env.js";
import type { AppUserRepository } from "./repo/app-user-repository.js";
import { InMemoryAppUserRepository } from "./repo/in-memory-app-user-repository.js";
import type { OrganizationRepository } from "./repo/organization-repository.js";
import { PostgresAppUserRepository } from "./repo/postgres-app-user-repository.js";
import { PostgresOrganizationRepository } from "./repo/postgres-organization-repository.js";
import { buildApiRouter } from "./routes/api-router.js";
import { buildAuthRouter } from "./routes/auth-router.js";
import { OrganizationService } from "./services/organization-service.js";

export interface CreateAppOptions {
	env?: AppEnv;
	repository?: OrganizationRepository;
	appUserRepository?: AppUserRepository;
	authVerifier?: AuthVerifier;
}

const allowedApiOrigins = new Set([
	"http://localhost:5173",
	"http://127.0.0.1:5173",
]);

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

	const app = new Hono();

	app.use(
		"/api/*",
		cors({
			origin: (origin) =>
				allowedApiOrigins.has(origin) ? origin : undefined,
			allowHeaders: ["Authorization", "Content-Type"],
			allowMethods: ["GET", "POST", "OPTIONS"],
		}),
	);

	app.get("/health", (c) => {
		return c.json({ status: "ok" });
	});

	app.route("/api", buildApiRouter(organizationService, authVerifier));
	app.route("/api/v1/auth", buildAuthRouter(authVerifier, appUserRepository));

	return { app, env };
}
