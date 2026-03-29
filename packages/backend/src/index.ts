import { createApp } from "./app.js";

const { app, env } = await createApp();

const server = Bun.serve({
	port: env.port,
	fetch: app.fetch,
});

console.log(
	`festival backend listening on port ${server.port} (firebase + postgres org flow)`,
);
