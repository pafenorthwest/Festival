export interface AppEnv {
  port: number;
  shopifyStoreDomain?: string;
  shopifyAdminAccessToken?: string;
  shopifyStorefrontToken?: string;
  stripeSecretKey?: string;
}

export function loadEnv(): AppEnv {
  const portRaw = process.env.PORT ?? "3000";
  const port = Number.parseInt(portRaw, 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${portRaw}`);
  }

  return {
    port,
    shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN,
    shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    shopifyStorefrontToken: process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY
  };
}
