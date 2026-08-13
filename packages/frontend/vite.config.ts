import { defineConfig, loadEnv } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "FRONT_");
	const configuredOrigin =
		process.env.FRONT_PUBLIC_ORIGIN?.trim() || env.FRONT_PUBLIC_ORIGIN?.trim();
	const publicOrigin = configuredOrigin ? new URL(configuredOrigin) : undefined;

	if (
		publicOrigin &&
		publicOrigin.protocol !== "http:" &&
		publicOrigin.protocol !== "https:"
	) {
		throw new Error("FRONT_PUBLIC_ORIGIN must use http or https.");
	}

	return {
		envPrefix: "FRONT_",
		plugins: [solidPlugin()],
		server: {
			host: "0.0.0.0",
			port: 5173,
			...(publicOrigin
				? {
						allowedHosts: [publicOrigin.hostname],
						hmr: {
							protocol: publicOrigin.protocol === "https:" ? "wss" : "ws",
							host: publicOrigin.hostname,
							clientPort: Number(
								publicOrigin.port ||
									(publicOrigin.protocol === "https:" ? 443 : 80),
							),
						},
					}
				: {}),
			proxy: {
				"/api": "http://127.0.0.1:3000",
			},
		},
		build: {
			target: "esnext",
		},
	};
});
