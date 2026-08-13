import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");

async function readConfig(path: string): Promise<string> {
	return Bun.file(resolve(repositoryRoot, path)).text();
}

describe("repository nginx security policy", () => {
	for (const configPath of [
		"nginx/festival.conf",
		"docker/nginx.festival.conf",
	]) {
		it(`hardens ${configPath} as an explicit public boundary`, async () => {
			const config = await readConfig(configPath);

			for (const routeMarker of [
				"bootstrap",
				"firebase-session",
				"memberships",
				"organizations",
				"invites",
				"admin/users",
				"admin/(?:festivals|shopify|shopify-customer-account)",
				"admin/membership-products",
				"customer-auth/callback",
				"customer-auth/start|customer/session|customer/orders",
				"customer/logout",
				"v1/auth/sync",
				"v1/auth/login-event",
				"v1/auth/me",
			]) {
				expect(config).toContain(routeMarker);
			}

			expect(config).toContain("limit_except GET OPTIONS");
			expect(config).toContain("limit_except POST OPTIONS");
			expect(config).toContain("limit_except DELETE OPTIONS");
			expect(config).toContain("limit_except GET POST OPTIONS");
			expect(config).toContain("location /api/ { return 404; }");
			expect(config).toContain("location = /api { return 404; }");
			expect(config).toContain(
				"webhooks|internal|metrics|ready|readiness|debug",
			);
			expect(config).toContain("location = /health { return 404; }");
			expect(config).toContain("location = /healthz");
			expect(config).toContain("limit_except GET { deny all; }");
			expect(config).toContain('return 200 \'{"status":"ok"}\'');
			expect(config).toContain("try_files $uri $uri/ /index.html");
			expect(config).toContain("client_max_body_size 64k");
			expect(config).toContain("festival_safe");
			expect(config).toContain("$request_method $uri $status");
			expect(config).not.toContain("$request_uri");
			expect(config).not.toContain("$http_authorization");
			expect(config).toContain(
				'add_header X-Content-Type-Options "nosniff" always',
			);
		});
	}

	it("replaces inbound forwarding headers in both upstream variants", async () => {
		const configs = await Promise.all([
			readConfig("nginx/festival.conf"),
			readConfig("docker/nginx.festival.conf"),
		]);

		for (const config of configs) {
			expect(config).toContain("X-Forwarded-For $remote_addr");
			expect(config).not.toContain("$proxy_add_x_forwarded_for");
			expect(config).toContain("proxy_connect_timeout 5s");
			expect(config).toContain("proxy_read_timeout 15s");
		}
	});

	it("preserves only the intended host and container upstream difference", async () => {
		const host = await readConfig("nginx/festival.conf");
		const container = await readConfig("docker/nginx.festival.conf");

		expect(host).toContain("proxy_pass http://127.0.0.1:3000");
		expect(container).toContain("proxy_pass http://backend:3000");
	});
});
