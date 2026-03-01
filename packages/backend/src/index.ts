import { createApp } from "./app.js";

const { app, env } = createApp();

app.listen(env.port, () => {
  const mode = env.shopifyStoreDomain && env.shopifyAdminAccessToken ? "live integrations" : "mock integrations";
  console.log(`festival backend listening on port ${env.port} (${mode})`);
});
