import { Hono } from "hono";
import { ShopifyAdminClient } from "./clients/shopify-admin-client.js";
import { ShopifyStorefrontClient } from "./clients/shopify-storefront-client.js";
import { StripeClient } from "./clients/stripe-client.js";
import { loadEnv } from "./config/env.js";
import { InMemoryRepository } from "./repo/in-memory-repository.js";
import { buildApiRouter } from "./routes/api-router.js";
import { RegistrationService } from "./services/registration-service.js";

export function createApp() {
	const env = loadEnv();

	const repository = new InMemoryRepository();
	const shopifyAdminClient = new ShopifyAdminClient({
		shopDomain: env.shopifyStoreDomain,
		accessToken: env.shopifyAdminAccessToken,
	});
	const shopifyStorefrontClient = new ShopifyStorefrontClient({
		shopDomain: env.shopifyStoreDomain,
		storefrontAccessToken: env.shopifyStorefrontToken,
	});
	const stripeClient = new StripeClient({ secretKey: env.stripeSecretKey });

	const registrationService = new RegistrationService(
		repository,
		shopifyAdminClient,
		shopifyStorefrontClient,
		stripeClient,
	);

	const app = new Hono();

	// GET /health
	app.get("/health", (c) => {
		return c.json({ status: "ok" });
	});

	// Mount /api router
	app.route("/api", buildApiRouter(registrationService));

	return { app, env };
}
