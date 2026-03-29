import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
	envPrefix: "FRONT_",
	plugins: [solidPlugin()],
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:3000",
		},
	},
	build: {
		target: "esnext",
	},
});
