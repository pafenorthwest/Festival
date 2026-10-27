import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import {
	assertRouteSecurityInventory,
	CURRENT_ROUTE_SECURITY,
} from "../src/routes/route-security.js";

const repositoryRoot = resolve(import.meta.dir, "../../..");

async function readConfig(path: string): Promise<string> {
	return Bun.file(resolve(repositoryRoot, path)).text();
}

interface ConfigDirective {
	name: string;
	args: string[];
	children?: ConfigDirective[];
}

// Keep nested limit_except blocks and quoted JSON intact when reading locations.
function readLocations(config: string): ConfigDirective[] {
	const tokens =
		config
			.match(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};]+/g)
			?.filter((token) => !token.startsWith("#")) ?? [];
	let position = 0;
	function readBlock(nested = false): ConfigDirective[] {
		const directives: ConfigDirective[] = [];
		while (position < tokens.length) {
			if (tokens[position] === "}") {
				if (!nested) throw new Error("Unexpected closing Nginx brace.");
				position++;
				return directives;
			}
			const words: string[] = [];
			while (
				position < tokens.length &&
				!["{", "}", ";"].includes(tokens[position] ?? "")
			) {
				const token = tokens[position++] ?? "";
				words.push(/^["']/.test(token) ? token.slice(1, -1) : token);
			}
			const end = tokens[position++];
			const name = words.shift();
			if (!name || (end !== "{" && end !== ";")) {
				throw new Error("Invalid Nginx directive.");
			}
			directives.push({
				name,
				args: words,
				...(end === "{" ? { children: readBlock(true) } : {}),
			});
		}
		if (nested) throw new Error("Unclosed Nginx block.");
		return directives;
	}
	const servers = readBlock().filter(
		(directive) => directive.name === "server",
	);
	if (servers.length !== 1) throw new Error("Expected one Nginx server.");
	return servers[0]?.children?.filter((node) => node.name === "location") ?? [];
}

function selectLocation(
	locations: ConfigDirective[],
	path: string,
): ConfigDirective | undefined {
	const exact = locations.find(
		({ args }) => args[0] === "=" && args[1] === path,
	);
	if (exact) return exact;
	const prefix = locations
		.filter(
			({ args }) =>
				path.startsWith(args[0] === "^~" ? (args[1] ?? "") : (args[0] ?? "")) &&
				(args.length === 1 || args[0] === "^~"),
		)
		.sort(
			(a, b) => (b.args.at(-1)?.length ?? 0) - (a.args.at(-1)?.length ?? 0),
		)[0];
	if (prefix?.args[0] === "^~") return prefix;
	return (
		locations.find(
			({ args }) =>
				(args[0] === "~" || args[0] === "~*") &&
				new RegExp(args[1] ?? "", args[0] === "~*" ? "i" : "").test(path),
		) ?? prefix
	);
}

function proxiesRoute(
	locations: ConfigDirective[],
	method: string,
	path: string,
): boolean {
	const directives = selectLocation(locations, path)?.children ?? [];
	const denied = directives.some((node) => {
		if (node.name === "deny" && node.args[0] === "all") return true;
		if (node.name !== "limit_except") return false;
		const allowed =
			node.args.includes(method) ||
			(method === "HEAD" && node.args.includes("GET"));
		return (
			!allowed &&
			node.children?.some(
				(child) => child.name === "deny" && child.args[0] === "all",
			)
		);
	});
	return (
		!denied &&
		!directives.some((node) => node.name === "return") &&
		directives.some((node) => node.name === "proxy_pass")
	);
}

function missingPublicRoutes(
	locations: ConfigDirective[],
	routes: readonly { method: string; path: string }[],
): string[] {
	return routes.flatMap((route) => {
		const path = route.path.replace(/:[^/]+/g, "example");
		const methods = route.method === "GET" ? ["GET", "HEAD"] : [route.method];
		return methods
			.filter((method) => !proxiesRoute(locations, method, path))
			.map((method) => `${method} ${route.path}`);
	});
}

describe("repository nginx security policy", () => {
	it("proxies every runtime public Docker API route and keeps private routes closed", async () => {
		const { app } = await createApp({
			env: { port: 3000 },
			enableDropTransfer: true,
			repository: new InMemoryOrganizationRepository(),
			authVerifier: {
				verify: async () => {
					throw new Error("Inventory does not authenticate.");
				},
			},
		});
		assertRouteSecurityInventory(app.routes, CURRENT_ROUTE_SECURITY);
		const declarations = new Map<string, string>(
			CURRENT_ROUTE_SECURITY.map((route) => [
				`${route.method} ${route.path}`,
				route.authenticationClass,
			]),
		);
		const registered = [
			...new Map(
				app.routes
					.filter((route) => route.method !== "ALL")
					.map((route) => [`${route.method} ${route.path}`, route]),
			).values(),
		];
		const isPrivate = (route: { method: string; path: string }) =>
			declarations.get(`${route.method} ${route.path}`)?.startsWith("private-");
		const locations = readLocations(
			await readConfig("docker/nginx.festival.conf"),
		);
		expect(
			missingPublicRoutes(
				locations,
				registered.filter((route) => !isPrivate(route)),
			),
		).toEqual([]);
		const privateRoutes = registered.filter(isPrivate);
		expect(
			privateRoutes.map(({ method, path }) => `${method} ${path}`).sort(),
		).toEqual([
			"GET /health",
			"POST /api/internal/reconcile/firebase-claims",
			"POST /api/internal/reconcile/shopify-orders",
		]);
		for (const route of privateRoutes) {
			const block = selectLocation(locations, route.path);
			expect(
				block?.children?.some(
					(node) => node.name === "return" && node.args[0] === "404",
				),
			).toBe(true);
			for (const method of [
				"GET",
				"HEAD",
				"POST",
				"PATCH",
				"DELETE",
				"OPTIONS",
			]) {
				expect(proxiesRoute(locations, method, route.path)).toBe(false);
			}
		}
		expect(proxiesRoute(locations, "GET", "/api/not-an-existing-route")).toBe(
			false,
		);
		expect(
			selectLocation(locations, "/api/not-an-existing-route")?.children?.some(
				(node) => node.name === "return" && node.args[0] === "404",
			),
		).toBe(true);
	});

	it("detects an omitted Docker location and an omitted supported method", async () => {
		const locations = readLocations(
			await readConfig("docker/nginx.festival.conf"),
		);
		const route = {
			method: "PATCH",
			path: "/api/organizations/:slug/communication/templates/:templateId",
		};
		const selected = selectLocation(
			locations,
			route.path.replace(/:[^/]+/g, "example"),
		);
		expect(missingPublicRoutes(locations, [route])).toEqual([]);
		expect(
			missingPublicRoutes(
				locations.filter((node) => node !== selected),
				[route],
			),
		).toEqual([`PATCH ${route.path}`]);
		const withoutPatch = locations.map((node) =>
			node !== selected
				? node
				: {
						...node,
						children: node.children?.map((child) =>
							child.name !== "limit_except"
								? child
								: {
										...child,
										args: child.args.filter((method) => method !== "PATCH"),
									},
						),
					},
		);
		expect(missingPublicRoutes(withoutPatch, [route])).toEqual([
			`PATCH ${route.path}`,
		]);
		expect(
			proxiesRoute(
				locations,
				"DELETE",
				route.path.replace(/:[^/]+/g, "example"),
			),
		).toBe(false);
	});

	it("evaluates exact, ordered regex, and prefix locations with nested blocks", () => {
		const locations = readLocations(`
			server {
				# Braces in a quoted response must not terminate a location.
				location = /healthz { return 200 '{"status":"ok"}'; }
				location / { try_files $uri $uri/ /index.html; }
				location /api/ { return 404; }
				location ~ ^/api/example$ {
					limit_except GET { deny all; }
					proxy_pass http://backend:3000;
				}
				location ~ ^/api/ { return 404; }
				location = /api/example { return 404; }
			}
		`);
		expect(proxiesRoute(locations, "GET", "/api/example")).toBe(false);
		const withoutExact = locations.filter((node) => node.args[0] !== "=");
		expect(
			missingPublicRoutes(withoutExact, [
				{ method: "GET", path: "/api/example" },
			]),
		).toEqual([]);
		expect(proxiesRoute(withoutExact, "POST", "/api/example")).toBe(false);
		const prefixes = locations.filter((node) => node.args.length === 1);
		expect(selectLocation(prefixes, "/api/example")?.args).toEqual(["/api/"]);
		expect(proxiesRoute(prefixes, "GET", "/api/example")).toBe(false);
	});

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
				"admin/entitlements",
				"admin/(?:festivals(?:/[^/]+(?:/primary|/rooms)?)?|shopify|shopify-customer-account)",
				"admin/shopify/diagnostics",
				"admin/membership-products",
				"membership-products(?:/[^/]+/retire)?",
				"admin/customers",
				"admin/customers/[^/]+/checkout-intents",
				"admin/checkout-intents/[^/]+/(?:invalidate|recover)",
				"customer-auth/callback",
				"customer-auth/start|customer/session|customer/orders|customer/membership-status",
				"customer/membership-purchase/[^/]+",
				"customer/checkout",
				"customer/checkout-recovery/[^/]+/checkout",
				"customer/checkout-recovery/[^/]+",
				"customer/logout",
				"customer/profile",
				"festivals/[^/]+/volunteers/(?:roles(?:/[^/]+(?:/shifts(?:/[^/]+)?)?)?|enroll)",
				"shopify/webhooks/orders-paid",
				"v1/auth/sync",
				"v1/auth/login-event",
				"v1/auth/me",
			]) {
				expect(config).toContain(routeMarker);
			}

			expect(config).toContain("limit_except GET OPTIONS");
			expect(config).toContain("limit_except POST OPTIONS");
			expect(config).toMatch(
				/location ~ \^\/api\/organizations\/\[\^\/\]\+\/admin\/membership-products\$ \{\s+limit_except GET POST OPTIONS \{ deny all; \}/,
			);
			expect(
				config.indexOf(
					"location ~ ^/api/organizations/[^/]+/admin/membership-products$",
				),
			).toBeLessThan(
				config.indexOf(
					"organizations/[^/]+/admin/membership-products(?:/[^/]+/retire)?",
				),
			);
			expect(config).toContain("limit_except DELETE OPTIONS");
			expect(config).toContain("limit_except GET POST OPTIONS");
			expect(config).toContain("limit_except GET POST PATCH DELETE OPTIONS");
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
			expect(config).toMatch(
				/location ~ \^\/api\/organizations\/\[\^\/\]\+\/customer\/checkout\$ \{\s+limit_except POST OPTIONS \{ deny all; \}/,
			);
			expect(config).toMatch(
				/location = \/api\/shopify\/webhooks\/orders-paid \{\s+limit_except POST \{ deny all; \}/,
			);
			expect(config).not.toContain("location ~ ^/api/shopify/webhooks");
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
