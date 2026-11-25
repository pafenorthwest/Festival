import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const port = Number(process.env.E2E_PORT ?? "4173");
const localBaseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./e2e",
	outputDir: process.env.CI
		? "test-results"
		: path.join(os.tmpdir(), "festival-playwright-results"),
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	reporter: process.env.CI
		? [["github"], ["html", { open: "never" }]]
		: [["list"]],
	use: {
		baseURL: externalBaseUrl || localBaseUrl,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: externalBaseUrl
		? undefined
		: {
				command: "bun e2e/phase1/server.ts",
				url: `${localBaseUrl}/__e2e/health`,
				reuseExistingServer: !process.env.CI,
				timeout: 120_000,
				env: {
					...process.env,
					E2E_PORT: String(port),
				},
			},
});
