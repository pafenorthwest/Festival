import express from "express";
import { loadEnv } from "./config/env.js";
import { ShopifyAdminClient } from "./clients/shopify-admin-client.js";
import { ShopifyStorefrontClient } from "./clients/shopify-storefront-client.js";
import { StripeClient } from "./clients/stripe-client.js";
import { InMemoryRepository } from "./repo/in-memory-repository.js";
import { RegistrationService } from "./services/registration-service.js";
import { buildApiRouter } from "./routes/api-router.js";

export function createApp() {
  const env = loadEnv();

  const repository = new InMemoryRepository();
  const shopifyAdminClient = new ShopifyAdminClient({
    shopDomain: env.shopifyStoreDomain,
    accessToken: env.shopifyAdminAccessToken
  });
  const shopifyStorefrontClient = new ShopifyStorefrontClient({
    shopDomain: env.shopifyStoreDomain,
    storefrontAccessToken: env.shopifyStorefrontToken
  });
  const stripeClient = new StripeClient({ secretKey: env.stripeSecretKey });

  const registrationService = new RegistrationService(
    repository,
    shopifyAdminClient,
    shopifyStorefrontClient,
    stripeClient
  );

  const app = express();
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.use("/api", buildApiRouter(registrationService));

  return { app, env };
}
