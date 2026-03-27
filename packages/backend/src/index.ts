import { createApp } from "./app.js";

const { app, env } = createApp();

const mode =
	env.shopifyStoreDomain && env.shopifyAdminAccessToken
		? "live integrations"
		: "mock integrations";

const server = Bun.serve({
	port: env.port,
	fetch: app.fetch,
});

console.log(`festival backend listening on port ${server.port} (${mode})`);
