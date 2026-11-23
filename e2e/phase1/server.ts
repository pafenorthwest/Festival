import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../packages/backend/src/app.js";
import { InMemoryCheckoutRepository } from "../../packages/backend/src/checkout/checkout-repository.js";
import { PostgresCheckoutRepository } from "../../packages/backend/src/checkout/postgres-checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../../packages/backend/src/commerce/membership-commerce-repository.js";
import { PostgresMembershipCommerceRepository } from "../../packages/backend/src/commerce/postgres-membership-commerce-repository.js";
import {
	type AppEnv,
	buildDatabaseUrl,
	LOCAL_API_ORIGINS,
} from "../../packages/backend/src/config/env.js";
import { CustomerAccountService } from "../../packages/backend/src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../../packages/backend/src/customer/in-memory-customer-account-repository.js";
import { PostgresCustomerAccountRepository } from "../../packages/backend/src/customer/postgres-customer-account-repository.js";
import {
	InMemoryRepertoireRepository,
	PostgresRepertoireRepository,
} from "../../packages/backend/src/repertoire/index.js";
import { InMemoryOrganizationRepository } from "../../packages/backend/src/repo/in-memory-organization-repository.js";
import { PostgresOrganizationRepository } from "../../packages/backend/src/repo/postgres-organization-repository.js";
import { ShopifyMembershipProductService } from "../../packages/backend/src/shopify/shopify-membership-product-service.js";
import {
	createE2eCustomerAccountTransport,
	createE2eShopifyProductClient,
} from "./helpers/e2e-shopify-mocks.js";
import {
	createE2eAuthVerifier,
	handleFirebaseEmulatorRequest,
} from "./helpers/firebase-emulator-mock.js";
import {
	createE2eSecretKeyring,
	E2E_SECRET_KEY_ID,
	E2E_SECRET_KEYS_JSON,
	type E2eCustomerRole,
	seedE2eEnvironment,
} from "./helpers/seed-e2e.js";

const VALID_ROLES = new Set<E2eCustomerRole>([
	"teacher",
	"accompanist-prospect",
	"logout",
]);

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const DIST_DIR = resolve(tmpdir(), "festival-e2e-frontend-dist");

function buildFrontend(origin: string): void {
	const viteBin = join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
	const result = Bun.spawnSync(
		[
			"bun",
			viteBin,
			"build",
			"packages/frontend",
			"--outDir",
			DIST_DIR,
			"--emptyOutDir",
		],
		{
			cwd: REPO_ROOT,
			env: {
				...process.env,
				FRONT_FIREBASE_API_KEY: "e2e-api-key",
				FRONT_FIREBASE_AUTH_DOMAIN: "festival-e2e.firebaseapp.com",
				FRONT_FIREBASE_PROJECT_ID: "festival-e2e",
				FRONT_FIREBASE_APP_ID: "1:000000000000:web:e2e",
				FRONT_FIREBASE_AUTH_EMULATOR_URL: `${origin}/__e2e/firebase-auth`,
				FRONT_PUBLIC_ORIGIN: origin,
			},
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`Frontend Vite build failed with exit code ${result.exitCode}.`,
		);
	}
}

function createRuntimeEnv(
	port: number,
	origin: string,
	databaseUrl?: string,
): AppEnv {
	const databaseSchema = databaseUrl
		? process.env.DB_SCHEMA?.trim() || "orgs"
		: undefined;
	return {
		port,
		databaseUrl,
		databaseSchema,
		databasePoolMax: 20,
		firebaseProjectId: "festival-e2e",
		festivalSecretKeysJson: E2E_SECRET_KEYS_JSON,
		festivalActiveSecretKeyId: E2E_SECRET_KEY_ID,
		allowedApiOrigins: [origin, ...LOCAL_API_ORIGINS],
		trustProxyHeaders: false,
		publicOrigin: "https://e2e.festival.example.org",
		customerSessionIdleDays: 7,
		customerSessionAbsoluteDays: 30,
		enableDropTransfer: true,
	};
}

function syncPostgresEnv(databaseUrl: string, databaseSchema: string): void {
	process.env.DATABASE_URL = databaseUrl;
	process.env.DB_SCHEMA = databaseSchema;
	const parsed = new URL(databaseUrl);
	process.env.DB_USER ??= decodeURIComponent(parsed.username);
	process.env.DB_PASSWORD ??= decodeURIComponent(parsed.password);
	process.env.DB_HOST ??= parsed.hostname;
	process.env.DB_PORT ??= parsed.port || "5432";
	process.env.DATABASE ??= decodeURIComponent(
		parsed.pathname.replace(/^\/+/, ""),
	);
	const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
	process.env.DB_SSL ??= sslMode && sslMode !== "disable" ? "true" : "false";
}

async function bootApp(port: number, origin: string) {
	const databaseUrl =
		process.env.DATABASE_URL?.trim() ||
		(process.env.DB_HOST?.trim() ? buildDatabaseUrl() : undefined);
	const mode: "postgres" | "in-memory" = databaseUrl ? "postgres" : "in-memory";
	const env = createRuntimeEnv(port, origin, databaseUrl);
	if (databaseUrl && env.databaseSchema) {
		syncPostgresEnv(databaseUrl, env.databaseSchema);
	}
	const keyring = createE2eSecretKeyring();
	const authVerifier = createE2eAuthVerifier();

	const repository = env.databaseSchema
		? new PostgresOrganizationRepository(env.databaseSchema)
		: new InMemoryOrganizationRepository();
	const customerAccountRepository = env.databaseSchema
		? new PostgresCustomerAccountRepository(env.databaseSchema)
		: new InMemoryCustomerAccountRepository();
	const repertoireRepository = env.databaseSchema
		? new PostgresRepertoireRepository(env.databaseSchema)
		: new InMemoryRepertoireRepository();
	const checkoutRepository = env.databaseSchema
		? new PostgresCheckoutRepository(env.databaseSchema)
		: new InMemoryCheckoutRepository();
	const commerceRepository = env.databaseSchema
		? new PostgresMembershipCommerceRepository(env.databaseSchema)
		: new InMemoryMembershipCommerceRepository(repository, checkoutRepository);

	await repository.ensureReady();
	await customerAccountRepository.ensureReady();
	if (repertoireRepository instanceof PostgresRepertoireRepository) {
		await repertoireRepository.ensureReady();
	}
	if (commerceRepository instanceof PostgresMembershipCommerceRepository) {
		await commerceRepository.ensureReady();
	}
	if (checkoutRepository instanceof PostgresCheckoutRepository) {
		await checkoutRepository.ensureReady();
	}

	const seeded = await seedE2eEnvironment({
		organizations: repository,
		accounts: customerAccountRepository,
		repertoire: repertoireRepository,
		keyring,
	});

	const customerAccountService = new CustomerAccountService(
		customerAccountRepository,
		repository,
		keyring,
		{
			publicOrigin: origin,
			transport: createE2eCustomerAccountTransport(origin),
		},
		commerceRepository,
		checkoutRepository,
		repertoireRepository,
	);

	const shopifyMembershipProductService = new ShopifyMembershipProductService(
		repository,
		keyring,
		createE2eShopifyProductClient(repository),
		{ record() {} },
	);

	const runtime = await createApp({
		env,
		repository,
		customerAccountRepository,
		repertoireRepository,
		commerceRepository,
		checkoutRepository,
		authVerifier,
		customerAccountService,
		shopifyMembershipProductService,
	});

	return { mode, seeded, runtime };
}

function serveStaticFile(pathname: string): Response {
	const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
	const candidate = resolve(DIST_DIR, rel);
	if (
		candidate.startsWith(DIST_DIR) &&
		existsSync(candidate) &&
		statSync(candidate).isFile()
	) {
		return new Response(Bun.file(candidate));
	}
	const fallback = join(DIST_DIR, "index.html");
	return new Response(Bun.file(fallback), {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

async function main() {
	const port = Number(process.env.E2E_PORT ?? "4173");
	const origin = `http://127.0.0.1:${port}`;

	buildFrontend(origin);
	const { mode, seeded, runtime } = await bootApp(port, origin);

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		async fetch(req) {
			const url = new URL(req.url);
			const { pathname } = url;

			if (pathname === "/__e2e/health" && req.method === "GET") {
				return Response.json({
					ok: true,
					mode,
					origin,
					slug: seeded.slug,
					organizationId: seeded.organizationId,
					festivalId: seeded.festivalId,
				});
			}

			if (pathname === "/__e2e/session" && req.method === "POST") {
				const body = (await req.json().catch(() => ({}))) as { role?: unknown };
				const role =
					typeof body.role === "string" &&
					VALID_ROLES.has(body.role as E2eCustomerRole)
						? (body.role as E2eCustomerRole)
						: undefined;
				if (!role) {
					return Response.json(
						{ error: "Invalid E2E customer role." },
						{ status: 400 },
					);
				}
				const session = await seeded.mintCustomerSession(role);
				return Response.json(session);
			}

			if (
				pathname.startsWith("/__e2e/firebase-auth/") ||
				pathname.startsWith("/identitytoolkit.googleapis.com/") ||
				pathname.startsWith("/securetoken.googleapis.com/")
			) {
				const subpath = pathname.startsWith("/__e2e/firebase-auth/")
					? pathname.slice("/__e2e/firebase-auth/".length)
					: pathname.slice(1);
				const handled = await handleFirebaseEmulatorRequest(req, subpath);
				if (handled) return handled;
				return Response.json(
					{ error: `Unsupported firebase emulator path: ${subpath}` },
					{ status: 404 },
				);
			}

			if (pathname === "/__e2e/oidc/logout") {
				const rawTarget = url.searchParams.get("post_logout_redirect_uri");
				let location = `${origin}/org/${seeded.slug}/account`;
				if (rawTarget) {
					try {
						const parsed = new URL(rawTarget);
						if (parsed.origin === origin) {
							location = parsed.toString();
						}
					} catch {
						// Ignore invalid redirect URI and fall back to account page
					}
				}
				return Response.redirect(location, 302);
			}

			if (pathname.startsWith("/api/") || pathname === "/health") {
				return runtime.app.fetch(req);
			}

			return serveStaticFile(pathname);
		},
	});

	console.log(`[e2e-server] listening on ${origin} (mode=${mode})`);

	const shutdown = async () => {
		server.stop();
		await runtime.stopReaper();
		await runtime.drain();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

await main();
