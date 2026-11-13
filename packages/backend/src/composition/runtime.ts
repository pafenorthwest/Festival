import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AppEnv, LOCAL_API_ORIGINS } from "../config/env.js";
import type { DomainCacheInvalidator } from "../lib/domain-cache-invalidator.js";
import { buildApiRouter } from "../routes/api-router.js";
import { buildAuthRouter } from "../routes/auth-router.js";
import {
	buildPrivateRuntimeRouter,
	hasForbiddenBrowserHeaders,
} from "../routes/private-runtime.routes.js";
import { assertRouteSecurityInventory } from "../routes/route-security.js";
import { PeriodicLeaseReaper } from "../runtime/periodic-lease-reaper.js";
import { apiRequestSecurity } from "../security/request-security.js";
import type { AuthComposition } from "./auth.js";
import type { CatalogRepertoireComposition } from "./catalog-repertoire.js";
import type { ClassCheckoutComposition } from "./class-checkout.js";
import type { CommerceProjectionComposition } from "./commerce-projection.js";
import type { CustomerIdentityComposition } from "./customer-identity.js";
import type { TeacherDirectoryComposition } from "./teacher-directory.js";
import type { TenantOrgComposition } from "./tenant-org.js";
import type { VolunteersCommsComposition } from "./volunteers-comms.js";

export interface RuntimeDependencies {
	env: AppEnv;
	cacheInvalidator: DomainCacheInvalidator;
	auth: AuthComposition;
	tenantOrg: TenantOrgComposition;
	catalogRepertoire: CatalogRepertoireComposition;
	customerIdentity: CustomerIdentityComposition;
	teacherDirectory: TeacherDirectoryComposition;
	commerceProjection: CommerceProjectionComposition;
	classCheckout: ClassCheckoutComposition;
	volunteersComms: VolunteersCommsComposition;
}

export function bindDomainCacheInvalidators(deps: RuntimeDependencies): void {
	const { cacheInvalidator, tenantOrg, customerIdentity, commerceProjection } =
		deps;
	tenantOrg.organizationService.bindCacheInvalidator?.(cacheInvalidator);
	customerIdentity.customerAccountService?.bindCacheInvalidator?.(
		cacheInvalidator,
	);
	commerceProjection.publicMembershipProductService.bindCacheInvalidator?.(
		cacheInvalidator,
	);
	commerceProjection.shopifyMembershipProductService?.bindCacheInvalidator?.(
		cacheInvalidator,
	);
	commerceProjection.shopifyIntegrationService?.bindCacheInvalidator?.(
		cacheInvalidator,
	);
	commerceProjection.shopifyWebhookService.bindCacheInvalidator?.(
		cacheInvalidator,
	);
}

function isNonBrowserApiSubpath(path: string): boolean {
	return (
		path === "/api/internal" ||
		path.startsWith("/api/internal/") ||
		path === "/api/shopify/webhooks/orders-paid"
	);
}

function configureApiMiddleware(app: Hono, env: AppEnv): void {
	const allowedApiOrigins = new Set(env.allowedApiOrigins ?? LOCAL_API_ORIGINS);
	const publicCors = cors({
		origin: (origin) => (allowedApiOrigins.has(origin) ? origin : undefined),
		allowHeaders: ["Authorization", "Content-Type", "X-CSRF-Token"],
		allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		credentials: true,
	});
	const publicRequestSecurity = apiRequestSecurity();

	app.use("/api/*", async (c, next) => {
		if (isNonBrowserApiSubpath(c.req.path)) {
			return c.json({ error: "Not found." }, 404);
		}
		return publicCors(c, next);
	});
	app.use("/api/*", async (c, next) => {
		if (isNonBrowserApiSubpath(c.req.path)) {
			return c.json({ error: "Not found." }, 404);
		}
		return publicRequestSecurity(c, next);
	});
}

function mountApiRouter(app: Hono, deps: RuntimeDependencies): void {
	const {
		env,
		auth,
		tenantOrg,
		catalogRepertoire,
		customerIdentity,
		teacherDirectory,
		commerceProjection,
		classCheckout,
		volunteersComms,
	} = deps;
	app.route(
		"/api",
		buildApiRouter({
			organizationService: tenantOrg.organizationService,
			authVerifier: auth.authVerifier,
			shopifyIntegrationService: commerceProjection.shopifyIntegrationService,
			shopifyMembershipProductService:
				commerceProjection.shopifyMembershipProductService,
			customerAccountService: customerIdentity.customerAccountService,
			customerAvailabilityService: customerIdentity.customerAvailabilityService,
			publicMembershipProductService:
				commerceProjection.publicMembershipProductService,
			shopifyIntegrationDiagnosticService:
				commerceProjection.shopifyIntegrationDiagnosticService,
			membershipCheckoutService: classCheckout.membershipCheckoutService,
			membershipStatusService: teacherDirectory.membershipStatusService,
			accompanistMembershipService:
				teacherDirectory.accompanistMembershipService,
			commerceRepository: commerceProjection.commerceRepository,
			checkoutRepository: classCheckout.checkoutRepository,
			shopifyOrderProjectionService:
				commerceProjection.shopifyOrderProjectionService,
			volunteerRepository: volunteersComms.volunteerRepository,
			classCheckoutService: classCheckout.classCheckoutService,
			customClaimsWriter: auth.customClaimsWriter,
			repertoireRepository: catalogRepertoire.repertoireRepository,
			dropTransferService: classCheckout.dropTransferService,
			enableDropTransfer: Boolean(env.enableDropTransfer),
			registrationChangeRepository: classCheckout.registrationChangeRepository,
			billingReconciliationService:
				commerceProjection.billingReconciliationService,
			communicationService: volunteersComms.communicationService,
			checkoutRecoveryService: classCheckout.checkoutRecoveryService,
			participantProfileService: customerIdentity.participantProfileService,
			waitlistService: classCheckout.waitlistService,
			publicOrigin: env.publicOrigin,
		}),
	);
}

function createLifecycleControls(
	env: AppEnv,
	commerceProjection: CommerceProjectionComposition,
) {
	const { shopifyWebhookService } = commerceProjection;
	const reaper = env.databaseSchema
		? new PeriodicLeaseReaper({
				schema: env.databaseSchema,
				webhookBatchLimit: (limit) =>
					shopifyWebhookService.getAvailableReclaimSlots(limit),
				onReclaimedWebhookIds: (ids) =>
					shopifyWebhookService.enqueueReclaimedDeliveries(ids),
			})
		: undefined;
	const drain = () => shopifyWebhookService.drain();
	const stopReaper = (): Promise<void> =>
		reaper ? reaper.stop() : Promise.resolve();
	return { reaper, drain, stopReaper };
}

export function buildRuntimeApp(deps: RuntimeDependencies) {
	const { env, auth, tenantOrg, commerceProjection } = deps;
	const app = new Hono();

	app.post("/api/shopify/webhooks/orders-paid", (c) =>
		commerceProjection.shopifyWebhookService.handle(c),
	);
	app.route(
		"/api/internal",
		buildPrivateRuntimeRouter({
			env,
			repository: tenantOrg.repository,
			commerceRepository: commerceProjection.commerceRepository,
			shopifyOrderProjectionService:
				commerceProjection.shopifyOrderProjectionService,
			shopifyWebhookService: commerceProjection.shopifyWebhookService,
			firebaseClaimsReconciliationService:
				auth.firebaseClaimsReconciliationService,
			hasShopifyKeyring: Boolean(commerceProjection.secretKeyring),
		}),
	);

	configureApiMiddleware(app, env);

	app.get("/health", (c) => {
		c.header("Cache-Control", "no-store");
		if (hasForbiddenBrowserHeaders(c)) {
			return c.json({ error: "Not found." }, 404);
		}
		return c.json({ status: "ok" });
	});

	mountApiRouter(app, deps);
	app.route(
		"/api/v1/auth",
		buildAuthRouter(
			auth.authVerifier,
			tenantOrg.appUserRepository,
			env.trustProxyHeaders ?? false,
		),
	);
	assertRouteSecurityInventory(app.routes);

	const lifecycle = createLifecycleControls(env, commerceProjection);
	return { app, env, ...lifecycle };
}
